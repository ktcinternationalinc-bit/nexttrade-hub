// v55.83-IQ — Wave ESTIMATE import → Hub PROFORMAS, scoped per silo. Mirrors import-invoices:
// paginates all estimates + line items, dedupes by wave_estimate_id (re-run updates, never
// duplicates), links to imported customers via wave_customer_id (flagged placeholder if missing),
// writes accounting_proformas (+ accounting_proforma_items), stamps provenance, writes a report +
// wave_sync_log. Server-side service-role client (bypasses RLS). Read-only on Wave. SWC-safe.
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

function num(m) { if (!m || m.value == null) { return 0; } var v = Number(String(m.value).replace(/,/g, '')); return isNaN(v) ? 0 : v; }
function curOf(n) { if (n.total && n.total.currency && n.total.currency.code) { return n.total.currency.code; } return 'USD'; }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

function gqlEstimates(token, bid, page) {
  // Field shape mirrors the invoices query; estimates is read-only so a wrong field surfaces as a
  // GraphQL error (captured below), never a money mutation.
  var query = 'query($bid: ID!, $page: Int!) { business(id:$bid){ id estimates(page:$page,pageSize:25){'
    + ' pageInfo{ currentPage totalPages totalCount } edges{ node{'
    + ' id estimateNumber status estimateDate expiryDate memo'
    + ' total{ value currency{ code } }'
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
  var _gate = await assertPermission(admin, userId, 'wave.import.run', request);
  if (!_gate.ok) { return Response.json({ ok: false, error: _gate.error }, { status: _gate.status }); }

  var startedAt = new Date().toISOString();
  var report = { created: 0, updated: 0, skipped: 0, errors: [], lineItems: 0, placeholders: [], total: 0, businessId: businessId, timestamp: startedAt, samples: [] };

  try {
    var bizRes = await admin.from('businesses').select('id').order('created_at').limit(1);
    var internalBusinessId = bizRes && bizRes.data && bizRes.data[0] ? bizRes.data[0].id : null;

    var custMap = await fetchAllMap(admin, 'accounting_customers', 'wave_customer_id', businessId);
    var estMap = await fetchAllMap(admin, 'accounting_proformas', 'wave_estimate_id', businessId);

    var page = 1; var totalPages = 1; var safety = 0;
    while (page <= totalPages) {
      safety++; if (safety > 500) { report.errors.push('Stopped after 500 pages (safety).'); break; }
      var resp = await gqlEstimates(waveToken, businessId, page);
      if (!resp.ok || (resp.json && resp.json.errors)) {
        var msg = resp.json && resp.json.errors ? resp.json.errors.map(function (e) { return e.message; }).join(' | ') : ('HTTP ' + resp.status);
        report.errors.push('Wave read (page ' + page + '): ' + msg);
        break;
      }
      var conn = resp.json && resp.json.data && resp.json.data.business && resp.json.data.business.estimates;
      if (!conn) { report.errors.push('No estimates on page ' + page + ' (check the business id / token).'); break; }
      if (conn.pageInfo && conn.pageInfo.totalPages) { totalPages = conn.pageInfo.totalPages; }
      var edges = conn.edges || [];

      var ei;
      for (ei = 0; ei < edges.length; ei++) {
        var n = edges[ei].node;
        if (!n || !n.id) { continue; }
        report.total++;
        try {
          // Link customer (create flagged placeholder if missing, same as invoice import).
          var acctCustomerId = null;
          if (n.customer && n.customer.id) {
            if (custMap[n.customer.id]) { acctCustomerId = custMap[n.customer.id]; }
            else {
              var ph = await admin.from('accounting_customers').insert({
                company_name: n.customer.name || ('Wave customer ' + n.customer.id), wave_customer_id: n.customer.id,
                needs_review: true, business_id: internalBusinessId, wave_business_id: businessId, created_by: userId
              }).select('id').maybeSingle();
              if (ph && ph.data) { acctCustomerId = ph.data.id; custMap[n.customer.id] = ph.data.id; report.placeholders.push(n.customer.name || n.customer.id); }
              else if (ph && ph.error) { report.errors.push('Placeholder customer for estimate ' + (n.estimateNumber || n.id) + ': ' + ph.error.message); }
            }
          }

          var total = r2(num(n.total));
          var fields = {
            business_id: internalBusinessId,
            wave_business_id: businessId,
            proforma_number: n.estimateNumber || n.id,
            accounting_customer_id: acctCustomerId,
            proforma_date: n.estimateDate || null,
            valid_until: n.expiryDate || null,
            notes: n.memo || null,
            total_amount: total,
            currency: curOf(n),
            status: 'sent',
            wave_status: n.status || null,
            wave_estimate_id: n.id,
            wave_sync_status: 'synced',
            source: 'wave_import',
            is_historical: true,
            last_synced_at: startedAt,
            updated_by: userId
          };

          var proformaId = estMap[n.id] || null;
          if (proformaId) {
            var upd = await admin.from('accounting_proformas').update(fields).eq('id', proformaId).eq('wave_business_id', businessId);
            if (upd && upd.error) { report.errors.push('Update estimate ' + (n.estimateNumber || n.id) + ': ' + upd.error.message); report.skipped++; continue; }
            report.updated++;
          } else {
            fields.created_by = userId;
            var ins = await admin.from('accounting_proformas').insert(fields).select('id').maybeSingle();
            if (ins && ins.error) { report.errors.push('Insert estimate ' + (n.estimateNumber || n.id) + ': ' + ins.error.message); report.skipped++; continue; }
            proformaId = ins && ins.data ? ins.data.id : null;
            if (proformaId) { estMap[n.id] = proformaId; }
            report.created++;
          }

          // Line items: delete-then-insert (dedupe-safe), keyed on proforma_id.
          if (proformaId) {
            try { await admin.from('accounting_proforma_items').delete().eq('proforma_id', proformaId); } catch (eDel) {}
            var items = n.items || []; var z;
            for (z = 0; z < items.length; z++) {
              var it = items[z];
              var liRes = await admin.from('accounting_proforma_items').insert({
                proforma_id: proformaId, business_id: internalBusinessId,
                description: (it.product && it.product.name ? (it.product.name + (it.description ? (' — ' + it.description) : '')) : (it.description || 'Item')),
                quantity: Number(it.quantity) || 1, unit_price: Number(it.price) || 0,
                line_total: r2(num(it.total)), created_by: userId
              });
              if (liRes && !liRes.error) { report.lineItems++; }
            }
          }

          if (report.samples.length < 6) { report.samples.push({ estimate: n.estimateNumber, total: total, status: n.status, lines: (n.items || []).length }); }
        } catch (rowErr) {
          report.errors.push('Estimate ' + (n.estimateNumber || n.id) + ': ' + ((rowErr && rowErr.message) || 'unknown'));
          report.skipped++;
        }
      }
      page++;
    }

    try {
      await admin.from('wave_sync_log').insert({
        business_id: internalBusinessId, wave_business_id: businessId, entity_type: 'estimate', wave_record_id: businessId, action: 'import',
        started_at: startedAt, completed_at: new Date().toISOString(),
        records_pulled: report.total, records_pushed: 0,
        success: report.errors.length === 0, response_payload: report,
        error_message: report.errors.length ? report.errors.join(' | ').slice(0, 4000) : null, attempted_by: userId
      });
    } catch (logErr) { /* non-fatal */ }

    return Response.json({ ok: report.errors.length === 0, report: report });
  } catch (e) {
    report.errors.push('Fatal: ' + ((e && e.message) || 'unknown'));
    return Response.json({ ok: false, error: (e && e.message) || 'Import failed', report: report });
  }
}

export async function GET() { return Response.json({ ok: true, route: '/api/wave/import-estimates', marker: 'v55.83-IQ' }); }
