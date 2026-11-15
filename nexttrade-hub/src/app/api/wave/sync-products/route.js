// v55.83-IY — pull the Wave PRODUCT catalog per silo into wave_products (READ-ONLY on Wave). Mirrors
// sync-categories: dedupes by (wave_business_id, wave_product_id); an explicit single-business request
// (wave_business_id) pulls even if production (read-only, safe); bulk pull stays test-only unless
// includeProduction. Service-role + assertPermission(wave.categories.pull). SWC-safe: var + concat.
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business-shared';

var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function fetchProducts(token, businessId) {
  var query = 'query($bid: ID!, $page: Int!){ business(id:$bid){ products(page:$page, pageSize:100){ pageInfo{ currentPage totalPages } edges{ node{ id name description isSold isArchived } } } } }';
  function page(p, acc) {
    var _httpOk = true; var _st = 0;
    return fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: query, variables: { bid: businessId, page: p } }) })
      .then(function (r) { _httpOk = r.ok; _st = r.status; return r.json(); })
      .then(function (j) {
        // v55.83-KO (audit) — don't swallow real failures as an empty catalog. Surface HTTP status,
        // GraphQL errors[], and business===null (token has no access) instead of returning nodes:[].
        if (!_httpOk) { return { error: 'Wave rejected the product read: ' + ((j && j.errors && j.errors[0] && j.errors[0].message) || ('HTTP ' + _st)), raw: j, nodes: acc }; }
        if (!j || j.errors) { return { error: (j && j.errors) ? j.errors.map(function (e) { return e.message; }).join(' | ') : 'Wave product read failed', raw: j, nodes: acc }; }
        if (j.data && Object.prototype.hasOwnProperty.call(j.data, 'business') && j.data.business === null) { return { error: 'Wave returned no business for id ' + businessId + ' — the configured token cannot access it. Bind this silo to a Wave business the token can read (Accounting -> Wave Connection).', raw: j, nodes: acc }; }
        var conn = j.data && j.data.business && j.data.business.products;
        if (!conn) { return { nodes: acc }; }
        (conn.edges || []).forEach(function (e) { if (e && e.node) { acc.push(e.node); } });
        var pi = conn.pageInfo || {};
        if (pi.currentPage && pi.totalPages && pi.currentPage < pi.totalPages && p < 50) { return page(p + 1, acc); }
        return { nodes: acc };
      });
  }
  return page(1, []);
}

export async function POST(request) {
  var token = process.env.WAVE_ACCESS_TOKEN;
  var supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token) { return Response.json({ ok: false, error: 'No Wave token configured.' }); }
  if (!serviceKey) { return Response.json({ ok: false, error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).' }); }
  var db = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

  var bodyJson = null; try { bodyJson = await request.json(); } catch (e) { bodyJson = {}; }
  var _perm = await assertPermission(db, (bodyJson && bodyJson.user_id) || null, 'wave.categories.pull', request);
  if (!_perm.ok) { return Response.json({ ok: false, error: _perm.error }, { status: _perm.status }); }

  var includeProduction = !!(bodyJson && bodyJson.includeProduction === true);
  var onlyBiz = (bodyJson && bodyJson.wave_business_id) ? bodyJson.wave_business_id : null;
  // v55.83-KO (audit) — a placeholder silo id is not a real Wave business; say so instead of round-tripping
  // to Wave and surfacing a confusing raw error (matches sync-categories' guard).
  if (onlyBiz && isPlaceholderWaveBusiness(onlyBiz)) {
    return Response.json({ ok: false, placeholder: true, wave_business_id: onlyBiz, error: 'This silo is not connected to a real Wave business yet — its ID (' + onlyBiz + ') is a placeholder. Go to Accounting -> Wave Connection, Test the connection, and BIND this silo to its real Wave business.' }, { status: 400 });
  }
  var regRes = await db.from('wave_business_registry').select('wave_business_id, label, is_production');
  var allBiz = (regRes && regRes.data) || [];
  // Same rule as category pull: an explicit single-business request pulls even if production (read-only).
  var businesses;
  if (onlyBiz) { businesses = allBiz.filter(function (x) { return x.wave_business_id === onlyBiz; }); }
  else { businesses = includeProduction ? allBiz : allBiz.filter(function (x) { return x.is_production === false; }); }
  if (businesses.length === 0) { return Response.json({ ok: true, message: 'No matching Wave businesses to sync products for.', results: [] }); }

  var results = []; var bi;
  for (bi = 0; bi < businesses.length; bi++) {
    var biz = businesses[bi];
    var fetched = await fetchProducts(token, biz.wave_business_id);
    if (fetched.error) { results.push({ wave_business_id: biz.wave_business_id, label: biz.label, ok: false, error: fetched.error }); continue; }
    var rows = (fetched.nodes || []).map(function (n) {
      return { wave_business_id: biz.wave_business_id, wave_product_id: n.id, name: n.name || null, description: n.description || null, is_sold: n.isSold === true, is_archived: n.isArchived === true, last_synced_at: new Date().toISOString() };
    });
    var upErr = null;
    if (rows.length) { var up = await db.from('wave_products').upsert(rows, { onConflict: 'wave_business_id,wave_product_id' }); if (up && up.error) { upErr = up.error.message; } }
    results.push({ wave_business_id: biz.wave_business_id, label: biz.label, ok: !upErr, pulled: rows.length, error: upErr });
  }
  return Response.json({ ok: results.every(function (r) { return r.ok; }), ran_at: new Date().toISOString(), results: results });
}

export async function GET() { return Response.json({ ok: true, route: '/api/wave/sync-products', marker: 'v55.83-IY' }); }
