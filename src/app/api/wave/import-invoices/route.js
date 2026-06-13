// v55.83-AT — Wave INVOICE import execution (money-critical). Paginates all
// invoices + line items, dedupes by wave_invoice_id (re-run updates, never
// duplicates), links to imported customers via wave_customer_id (creates a
// flagged placeholder if missing), sets paid/due/status, keeps Wave paid in
// wave_imported_paid (NO phantom payment rows), stamps sync fields, writes a
// report + wave_sync_log. Server-side service-role client. SWC-safe.
import { createClient } from '@supabase/supabase-js';

function num(m) { if (!m || m.value == null) { return 0; } var v = Number(String(m.value).replace(/,/g, '')); return isNaN(v) ? 0 : v; }
function curOf(n) {
  if (n.total && n.total.currency && n.total.currency.code) { return n.total.currency.code; }
  return 'USD';
}
function isDraftStatus(st) { return st === 'DRAFT'; }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
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
    + ' total{ value currency{ code } } amountPaid{ value } amountDue{ value }'
    + ' customer{ id name }'
    + ' items{ product{ name } description quantity price total{ value } } } } } } }';
  return fetch('https://gql.waveapps.com/graphql/public', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ query: query, variables: { bid: bid, page: page } })
  }).then(function (r) { return r.json().then(function (j) { return { status: r.status, ok: r.ok, json: j }; }); });
}

function fetchAllMap(admin, table, col, businessId) {
  var map = {}; var from = 0; var pageSize = 1000; var guard = 0;
  function loop() {
    guard++;
    if (guard > 100) { return Promise.resolve(map); }
    var q = admin.from(table).select('id, ' + col).not(col, 'is', null);
    if (businessId) { q = q.eq('wave_business_id', businessId); }
    return q.range(from, from + pageSize - 1).then(function (res) {
      if (res.error || !res.data || res.data.length === 0) { return map; }
      res.data.forEach(function (row) { map[row[col]] = row.id; });
      if (res.data.length < pageSize) { return map; }
      from += pageSize;
      return loop();
    });
  }
  return loop();
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
  var report = { created: 0, updated: 0, skipped: 0, errors: [], lineItems: 0, placeholders: [], total: 0, businessId: businessId, timestamp: startedAt, samples: [] };

  try {
    // PREFLIGHT — confirm tables + required columns exist; one clear error if not.
    var chkInv = await admin.from('accounting_invoices').select('wave_invoice_id, wave_imported_paid, balance_due, last_synced_hash, due_date').limit(1);
    if (chkInv.error) { return Response.json({ ok: false, error: 'Schema check failed on accounting_invoices: ' + chkInv.error.message + '. Run the v55.83-AT SQL migration first, then re-import.' }); }
    var chkItems = await admin.from('accounting_invoice_items').select('invoice_id, quantity, unit_price, line_total, business_id').limit(1);
    if (chkItems.error) { return Response.json({ ok: false, error: 'Schema check failed on accounting_invoice_items: ' + chkItems.error.message + '. Run the accounting SQL migrations first, then re-import.' }); }

    var bizRes = await admin.from('businesses').select('id').order('created_at', { ascending: true }).limit(1);
    var internalBusinessId = bizRes && bizRes.data && bizRes.data[0] ? bizRes.data[0].id : null;

    // preload customer + invoice maps (FULLY paginated — not capped at 1000) for linking + dedupe
    var custMap = await fetchAllMap(admin, 'accounting_customers', 'wave_customer_id', businessId);
    var invMap = await fetchAllMap(admin, 'accounting_invoices', 'wave_invoice_id', businessId);

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
                needs_review: true, business_id: internalBusinessId, wave_business_id: businessId, created_by: userId
              }).select('id').single();
              if (ph && ph.data) { acctCustomerId = ph.data.id; custMap[n.customer.id] = ph.data.id; report.placeholders.push(n.customer.name || n.customer.id); }
              else if (ph && ph.error) { report.errors.push('Placeholder customer for invoice ' + (n.invoiceNumber || n.id) + ': ' + ph.error.message); }
            }
          }

          // --- line items computed FIRST. Wave's per-line and invoice 'total' come
          // back 0/null via the API, but quantity + unit price import correctly,
          // so compute line_total = qty * unit_price (use Wave line total only if > 0). ---
          var items = n.items || [];
          var itemRows = [];
          var sumLines = 0;
          for (var k = 0; k < items.length; k++) {
            var it = items[k];
            var q = it.quantity != null ? Number(it.quantity) : 0;
            var up = it.price != null ? Number(it.price) : 0;
            var waveLine = num(it.total);
            var lt = (waveLine && waveLine > 0) ? r2(waveLine) : r2(q * up);
            sumLines += lt;
            itemRows.push({
              business_id: internalBusinessId,
              invoice_id: null,
              description: it.description || (it.product && it.product.name) || null,
              quantity: q,
              unit_price: up,
              line_total: lt,
              product_ref: it.product && it.product.name ? it.product.name : null,
              sort_order: k
            });
          }
          sumLines = r2(sumLines);

          // --- totals: prefer Wave value when present (> 0), else compute from parts.
          // Identity used: Total = Paid + Due. amountDue maps reliably from Wave. ---
          var waveTotal = num(n.total);
          var total = (waveTotal && waveTotal > 0) ? r2(waveTotal) : sumLines;
          var due = (n.amountDue && n.amountDue.value != null) ? r2(num(n.amountDue)) : null;
          var wavePaid = num(n.amountPaid);
          var paid;
          if (wavePaid && wavePaid > 0) { paid = r2(wavePaid); }
          else if (due != null) { paid = r2(total - due); }
          else { paid = 0; }
          if (paid < 0) { paid = 0; }
          var balance = (due != null) ? due : r2(total - paid);

          if (report.samples.length < 6) {
            report.samples.push({ invoice: n.invoiceNumber, waveTotal: waveTotal, sumLines: sumLines, total: total, wavePaid: wavePaid, paid: paid, due: due, balance: balance, lines: items.length });
          }

          var fields = {
            invoice_number: n.invoiceNumber || null,
            invoice_date: n.invoiceDate || null,
            due_date: n.dueDate || null,
            notes: n.memo || null,
            total_amount: total,
            amount_paid: paid,
            wave_imported_paid: paid,
            balance_due: balance,
            payment_status: payStatus(total, balance, paid),
            approval_status: isDraftStatus(n.status) ? 'draft' : 'approved',
            wave_status: n.status || null,
            currency: curOf(n),
            accounting_customer_id: acctCustomerId,
            wave_invoice_id: n.id,
            source: 'wave_import',
            is_historical: true,
            wave_sync_status: 'synced',
            last_synced_at: startedAt,
            last_synced_hash: fingerprint(n, total, paid),
            business_id: internalBusinessId,
            wave_business_id: businessId,
            updated_by: userId
          };

          var invoiceId = null;
          if (invMap[n.id]) {
            var upd = await admin.from('accounting_invoices').update(fields).eq('id', invMap[n.id]).eq('wave_business_id', businessId);
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
            await admin.from('accounting_invoice_items').delete().eq('invoice_id', invoiceId);
            if (itemRows.length) {
              for (var z = 0; z < itemRows.length; z++) { itemRows[z].invoice_id = invoiceId; }
              var li = await admin.from('accounting_invoice_items').insert(itemRows);
              if (li && li.error) { report.errors.push('Line items invoice ' + (n.invoiceNumber || n.id) + ': ' + li.error.message); }
              else { report.lineItems += itemRows.length; }
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
