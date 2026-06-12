// v55.83-AT — Wave INVOICE import execution (money-critical). Paginates all
// invoices + line items, dedupes by wave_invoice_id (re-run updates, never
// duplicates), links to imported customers via wave_customer_id (creates a
// flagged placeholder if missing), sets paid/due/status, keeps Wave paid in
// wave_imported_paid (NO phantom payment rows), stamps sync fields, writes a
// report + wave_sync_log. Server-side service-role client. SWC-safe.
import { createClient } from '@supabase/supabase-js';

function num(m) { return m && m.value != null ? Number(m.value) : 0; }
function payStatus(total, due, paid) {
  if (due != null && due <= 0.0001) return 'paid';
  if (paid != null && paid > 0) return 'partial';
  return 'unpaid';
}
function fingerprint(node, total, paid) {
  return [node.invoiceNumber || '', String(total), String(paid), node.status || ''].join('|');
}

function gqlInvoices(token, bid, page) {
  var query = 'query($bid: ID!, $page: Int!) { business(id:$bid){ id invoices(page:$page,pageSize:25){'
    + ' pageInfo{ currentPage totalPages totalCount } edges{ node{'
    + ' id invoiceNumber status invoiceDate dueDate memo'
    + ' total{ value } amountPaid{ value } amountDue{ value }'
    + ' customer{ id name }'
    + ' items{ product{ name } description quantity price total{ value } } } } } } }';
  return fetch('https://gql.waveapps.com/graphql/public', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ query: query, variables: { bid: bid, page: page } })
  }).then(function (r) { return r.json().then(function (j) { return { status: r.status, ok: r.ok, json: j }; }); });
}

export async function POST(request) {
  var waveToken = process.env.WAVE_ACCESS_TOKEN;
  var supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!waveToken) { return Response.json({ ok: false, error: 'No Wave token configured.' }); }
  if (!supaUrl || !serviceKey) { return Response.json({ ok: false, error: 'Server database key missing (SUPABASE_SERVICE_ROLE_KEY).' }); }

  var body = null;
  try { body = await request.json(); } catch (e) { body = {}; }
  var businessId = body && body.businessId;
  var userId = (body && body.userId) || null;
  if (!businessId) { return Response.json({ ok: false, error: 'Missing businessId.' }); }

  var admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  var startedAt = new Date().toISOString();
  var report = { created: 0, updated: 0, skipped: 0, errors: [], lineItems: 0, placeholders: [], total: 0, businessId: businessId, timestamp: startedAt };

  try {
    var bizRes = await admin.from('businesses').select('id').order('created_at', { ascending: true }).limit(1);
    var internalBusinessId = bizRes && bizRes.data && bizRes.data[0] ? bizRes.data[0].id : null;

    // preload customer + invoice maps for linking + dedupe
    var custMap = {};
    var cRes = await admin.from('accounting_customers').select('id, wave_customer_id').not('wave_customer_id', 'is', null);
    if (cRes && cRes.data) { cRes.data.forEach(function (row) { custMap[row.wave_customer_id] = row.id; }); }
    var invMap = {};
    var iRes = await admin.from('accounting_invoices').select('id, wave_invoice_id').not('wave_invoice_id', 'is', null);
    if (iRes && iRes.data) { iRes.data.forEach(function (row) { invMap[row.wave_invoice_id] = row.id; }); }

    var page = 1;
    var totalPages = 1;
    var safety = 0;
    while (page <= totalPages && safety < 500) {
      safety++;
      var resp = await gqlInvoices(waveToken, businessId, page);
      var j = resp.json;
      if (!resp.ok || (j && j.errors && j.errors.length)) {
        var msg = j && j.errors && j.errors[0] ? j.errors[0].message : ('HTTP ' + resp.status);
        report.errors.push('Wave read (page ' + page + '): ' + msg);
        break;
      }
      var conn = j && j.data && j.data.business && j.data.business.invoices;
      if (!conn) { report.errors.push('No invoices on page ' + page); break; }
      if (conn.pageInfo && conn.pageInfo.totalPages) { totalPages = conn.pageInfo.totalPages; }
      var edges = conn.edges || [];

      for (var i = 0; i < edges.length; i++) {
        var n = edges[i].node;
        report.total++;
        try {
          // resolve / create customer link
          var acctCustomerId = null;
          if (n.customer && n.customer.id) {
            if (custMap[n.customer.id]) {
              acctCustomerId = custMap[n.customer.id];
            } else {
              var ph = await admin.from('accounting_customers').insert({
                company_name: (n.customer.name || 'Unknown (Wave)'),
                wave_customer_id: n.customer.id, source: 'wave_import', wave_sync_status: 'synced',
                needs_review: true, business_id: internalBusinessId, created_by: userId
              }).select('id').single();
              if (ph && ph.data) { acctCustomerId = ph.data.id; custMap[n.customer.id] = ph.data.id; report.placeholders.push(n.customer.name || n.customer.id); }
              else if (ph && ph.error) { report.errors.push('Placeholder customer for invoice ' + (n.invoiceNumber || n.id) + ': ' + ph.error.message); }
            }
          }

          var total = num(n.total);
          var paid = num(n.amountPaid);
          var due = num(n.amountDue);
          var fields = {
            invoice_number: n.invoiceNumber || null,
            invoice_date: n.invoiceDate || null,
            due_date: n.dueDate || null,
            notes: n.memo || null,
            total_amount: total,
            amount_paid: paid,
            wave_imported_paid: paid,
            balance_due: due,
            payment_status: payStatus(total, due, paid),
            approval_status: 'approved',
            accounting_customer_id: acctCustomerId,
            wave_invoice_id: n.id,
            source: 'wave_import',
            is_historical: true,
            wave_sync_status: 'synced',
            last_synced_at: startedAt,
            last_synced_hash: fingerprint(n, total, paid),
            business_id: internalBusinessId,
            updated_by: userId
          };

          var invoiceId = null;
          if (invMap[n.id]) {
            var upd = await admin.from('accounting_invoices').update(fields).eq('id', invMap[n.id]);
            if (upd && upd.error) { report.errors.push('Update invoice ' + (n.invoiceNumber || n.id) + ': ' + upd.error.message); report.skipped++; continue; }
            invoiceId = invMap[n.id]; report.updated++;
          } else {
            fields.created_by = userId;
            var ins = await admin.from('accounting_invoices').insert(fields).select('id').single();
            if (ins && ins.error) { report.errors.push('Insert invoice ' + (n.invoiceNumber || n.id) + ': ' + ins.error.message); report.skipped++; continue; }
            invoiceId = ins && ins.data ? ins.data.id : null; if (invoiceId) { invMap[n.id] = invoiceId; } report.created++;
          }

          // line items: delete-then-insert (dedupe-safe on re-run)
          if (invoiceId) {
            await admin.from('accounting_invoice_items').delete().eq('accounting_invoice_id', invoiceId);
            var items = n.items || [];
            if (items.length) {
              var rows = items.map(function (it) {
                return {
                  accounting_invoice_id: invoiceId,
                  description: it.description || (it.product && it.product.name) || null,
                  qty: it.quantity != null ? Number(it.quantity) : null,
                  unit_price: it.price != null ? Number(it.price) : null,
                  line_total: num(it.total),
                  product_ref: it.product && it.product.name ? it.product.name : null
                };
              });
              var li = await admin.from('accounting_invoice_items').insert(rows);
              if (li && li.error) { report.errors.push('Line items invoice ' + (n.invoiceNumber || n.id) + ': ' + li.error.message); }
              else { report.lineItems += rows.length; }
            }
          }
        } catch (rowErr) {
          report.errors.push('Invoice ' + (n.invoiceNumber || n.id) + ': ' + ((rowErr && rowErr.message) || 'unknown'));
          report.skipped++;
        }
      }
      page++;
    }

    try {
      await admin.from('wave_sync_log').insert({
        business_id: internalBusinessId, entity_type: 'invoice', wave_record_id: businessId, action: 'import',
        started_at: startedAt, completed_at: new Date().toISOString(),
        records_pulled: report.total, records_pushed: 0,
        success: report.errors.length === 0,
        response_payload: report,
        error_message: report.errors.length ? report.errors.join(' | ').slice(0, 4000) : null,
        attempted_by: userId
      });
    } catch (logErr) { /* non-fatal */ }

    return Response.json({ ok: true, report: report });
  } catch (e) {
    report.errors.push('Fatal: ' + ((e && e.message) || 'unknown'));
    return Response.json({ ok: false, error: (e && e.message) || 'Import failed', report: report });
  }
}
