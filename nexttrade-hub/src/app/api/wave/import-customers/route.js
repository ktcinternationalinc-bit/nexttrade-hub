// v55.83-AN — Wave CUSTOMER import execution (money-safe: customers carry no
// balances). Paginates all customers for a business, dedupes by wave_customer_id,
// creates/updates accounting_customers, writes an import report + wave_sync_log.
// Server-side service-role client (bypasses RLS for bulk import). Re-runnable.
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

function gqlCustomers(token, bid, page) {
  var query = 'query($bid: ID!, $page: Int!) { business(id:$bid){ id customers(page:$page,pageSize:50){'
    + ' pageInfo{ currentPage totalPages totalCount } edges{ node{ id name email phone } } } } }';
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
  if (!supaUrl || !serviceKey) { return Response.json({ ok: false, error: 'Server database key missing (SUPABASE_SERVICE_ROLE_KEY in Vercel).' }); }

  var body = null;
  try { body = await request.json(); } catch (e) { body = {}; }
  var businessId = body && body.businessId;
  var userId = body && body.userId || null;
  if (!businessId) { return Response.json({ ok: false, error: 'Missing businessId.' }); }

  var admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  var _gate = await assertPermission(admin, userId, 'wave.import.run', request);
  if (!_gate.ok) { return Response.json({ ok: false, error: _gate.error }, { status: _gate.status }); }

  var report = { created: 0, updated: 0, skipped: 0, errors: [], total: 0, businessId: businessId, timestamp: new Date().toISOString() };

  try {
    // resolve our internal business_id (separate from Wave's id)
    var bizRes = await admin.from('businesses').select('id').order('created_at', { ascending: true }).limit(1);
    var internalBusinessId = bizRes && bizRes.data && bizRes.data[0] ? bizRes.data[0].id : null;

    // existing wave_customer_id -> accounting_customers.id (for dedupe/update)
    var existing = {};
    var exRes = await admin.from('accounting_customers').select('id, wave_customer_id').not('wave_customer_id', 'is', null).eq('wave_business_id', businessId);
    if (exRes && exRes.data) { exRes.data.forEach(function (row) { existing[row.wave_customer_id] = row.id; }); }

    var page = 1;
    var totalPages = 1;
    var safety = 0;
    while (page <= totalPages && safety < 200) {
      safety++;
      var resp = await gqlCustomers(waveToken, businessId, page);
      var j = resp.json;
      if (!resp.ok || (j && j.errors && j.errors.length)) {
        var msg = j && j.errors && j.errors[0] ? j.errors[0].message : ('HTTP ' + resp.status);
        report.errors.push('Wave read (page ' + page + '): ' + msg);
        break;
      }
      var biz = j && j.data && j.data.business;
      var conn = biz && biz.customers;
      if (!conn) { report.errors.push('No customers connection on page ' + page); break; }
      if (conn.pageInfo && conn.pageInfo.totalPages) { totalPages = conn.pageInfo.totalPages; }
      var edges = conn.edges || [];
      for (var i = 0; i < edges.length; i++) {
        var n = edges[i].node;
        report.total++;
        var fields = {
          company_name: n.name || '(no name)',
          email: n.email || null,
          phone: n.phone || null,
          wave_customer_id: n.id,
          source: 'wave_import',
          wave_sync_status: 'synced',
          business_id: internalBusinessId,
          wave_business_id: businessId
        };
        try {
          if (existing[n.id]) {
            var upd = await admin.from('accounting_customers').update({
              company_name: fields.company_name, email: fields.email, phone: fields.phone,
              source: 'wave_import', wave_sync_status: 'synced', wave_business_id: businessId
            }).eq('id', existing[n.id]).eq('wave_business_id', businessId);
            if (upd && upd.error) { report.errors.push('Update ' + n.id + ': ' + upd.error.message); report.skipped++; }
            else { report.updated++; }
          } else {
            fields.created_by = userId;
            var ins = await admin.from('accounting_customers').insert(fields).select('id').single();
            if (ins && ins.error) { report.errors.push('Insert ' + n.id + ': ' + ins.error.message); report.skipped++; }
            else { report.created++; if (ins && ins.data) { existing[n.id] = ins.data.id; } }
          }
        } catch (rowErr) {
          report.errors.push('Row ' + n.id + ': ' + ((rowErr && rowErr.message) || 'unknown'));
          report.skipped++;
        }
      }
      page++;
    }

    // write sync log (best-effort)
    try {
      await admin.from('wave_sync_log').insert({
        business_id: internalBusinessId, entity_type: 'customer', wave_record_id: businessId,
        action: 'import', success: report.errors.length === 0,
        response_payload: report, error_message: report.errors.length ? report.errors.join(' | ').slice(0, 4000) : null,
        attempted_by: userId
      });
    } catch (logErr) { /* non-fatal */ }

    return Response.json({ ok: true, report: report });
  } catch (e) {
    report.errors.push('Fatal: ' + ((e && e.message) || 'unknown'));
    return Response.json({ ok: false, error: (e && e.message) || 'Import failed', report: report });
  }
}
