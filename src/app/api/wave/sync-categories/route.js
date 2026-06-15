// /api/wave/sync-categories — pull Wave Chart of Accounts (Account objects) INTO Hub's
// wave_categories table, scoped per Wave business. READ-ONLY on Wave (never writes to
// Wave). Dedupes/updates by (wave_business_id, wave_account_id) so re-runs update in
// place and never duplicate. TEST businesses only by default (production opt-in via
// ?includeProduction=true), matching the "test data first" rule. CRON_SECRET protected.
// SWC-safe: var + string concat, no template literals/arrows/const.
//
// Wave API note (from the CC investigation): Account objects ARE readable via GraphQL.
// The GraphQL field shape below follows Wave's public schema but should be validated
// against live Wave; the raw response is stored in raw_payload + logged so any shape
// mismatch is visible without guessing.
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function hashOf(s) {
  // tiny stable fingerprint so unchanged categories can be skipped on future runs
  var h = 0; var i; var str = String(s || '');
  for (i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return String(h);
}

async function fetchAccounts(token, businessId) {
  var query = 'query($bid: ID!, $page: Int!){ business(id:$bid){ accounts(page:$page, pageSize:100){ pageInfo{ currentPage totalPages } edges{ node{ id name type{ name value } subtype{ name value } isArchived } } } } }';
  var out = [];
  var page = 1;
  var guard = 0;
  while (guard < 50) {
    guard = guard + 1;
    var resp = await fetch(WAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ query: query, variables: { bid: businessId, page: page } })
    });
    var data = await resp.json();
    var acc = data && data.data && data.data.business && data.data.business.accounts;
    if (!acc) { return { error: 'Unexpected Wave response', raw: data }; }
    var edges = acc.edges || [];
    var j;
    for (j = 0; j < edges.length; j++) { if (edges[j] && edges[j].node) { out.push(edges[j].node); } }
    var pi = acc.pageInfo || {};
    if (!pi.totalPages || page >= pi.totalPages) { break; }
    page = page + 1;
  }
  return { accounts: out };
}

async function runSync(request) {
  var db = admin();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, error: 'Server database key missing.' }, { status: 500 });
  }

  // Auth: CRON bearer OR a user with wave.categories.pull (super_admin = all).
  var bodyJson = null;
  try { bodyJson = await request.clone().json(); } catch (eB) { bodyJson = null; }
  var _perm = await assertPermission(db, (bodyJson && bodyJson.user_id) || null, 'wave.categories.pull', request);
  if (!_perm.ok) { return Response.json({ ok: false, error: _perm.error }, { status: _perm.status }); }

  var token = process.env.WAVE_ACCESS_TOKEN;
  if (!token) { return Response.json({ ok: false, error: 'No Wave token configured (WAVE_ACCESS_TOKEN).' }, { status: 400 }); }

  var includeProduction = false;
  try { var u = new URL(request.url); if (u.searchParams.get('includeProduction') === 'true') { includeProduction = true; } } catch (eUrl) {}
  if (!includeProduction && bodyJson && bodyJson.includeProduction === true) { includeProduction = true; }

  // Optional: scope to a single business id from the body (UI passes the active silo).
  var onlyBiz = (bodyJson && bodyJson.wave_business_id) ? bodyJson.wave_business_id : null;

  var regRes = await db.from('wave_business_registry').select('wave_business_id, label, is_production');
  var allBiz = (regRes && regRes.data) || [];
  var businesses = includeProduction ? allBiz : allBiz.filter(function (x) { return x.is_production === false; });
  if (onlyBiz) { businesses = businesses.filter(function (x) { return x.wave_business_id === onlyBiz; }); }
  if (businesses.length === 0) {
    return Response.json({ ok: true, scope: includeProduction ? 'all_businesses' : 'test_only', message: 'No matching Wave businesses to sync categories for.', results: [] });
  }

  var results = [];
  var i;
  for (i = 0; i < businesses.length; i++) {
    var biz = businesses[i];
    var fetched = await fetchAccounts(token, biz.wave_business_id);
    if (fetched.error) {
      try { await db.from('wave_sync_log').insert({ wave_business_id: biz.wave_business_id, entity_type: 'category', action: 'pull', dry_run: false, success: false, error_message: fetched.error, response_payload: fetched.raw || null, attempted_at: new Date().toISOString() }); } catch (e1) {}
      results.push({ business: biz.label, wave_business_id: biz.wave_business_id, ok: false, error: fetched.error });
      continue;
    }
    var accounts = fetched.accounts || [];
    var created = 0; var updated = 0; var skipped = 0; var errors = [];
    var k;
    for (k = 0; k < accounts.length; k++) {
      var a = accounts[k];
      var typeName = (a.type && (a.type.name || a.type.value)) || null;
      var subName = (a.subtype && (a.subtype.name || a.subtype.value)) || null;
      var fp = hashOf((a.name || '') + '|' + (typeName || '') + '|' + (subName || '') + '|' + (a.isArchived ? '1' : '0'));
      var rowPayload = {
        wave_business_id: biz.wave_business_id,
        wave_account_id: a.id,
        wave_account_name: a.name || null,
        wave_account_type: typeName,
        type: typeName,
        subtype: subName,
        is_active: a.isArchived === true ? false : true,
        raw_payload: a,
        last_synced_at: new Date().toISOString(),
        last_synced_hash: fp
      };
      try {
        var existing = await db.from('wave_categories').select('id, last_synced_hash').eq('wave_business_id', biz.wave_business_id).eq('wave_account_id', a.id).limit(1);
        var exRow = existing && existing.data && existing.data[0];
        if (exRow) {
          if (exRow.last_synced_hash === fp) { skipped = skipped + 1; }
          else { await db.from('wave_categories').update(rowPayload).eq('id', exRow.id); updated = updated + 1; }
        } else {
          await db.from('wave_categories').insert(rowPayload); created = created + 1;
        }
      } catch (eUp) { errors.push((a.id || '?') + ': ' + ((eUp && eUp.message) || String(eUp))); }
    }

    try { await db.from('wave_sync_log').insert({ wave_business_id: biz.wave_business_id, entity_type: 'category', action: 'pull', dry_run: false, success: errors.length === 0, response_payload: { total: accounts.length, created: created, updated: updated, skipped: skipped, errors: errors }, error_message: errors.length ? (errors.length + ' error(s)') : null, attempted_at: new Date().toISOString() }); } catch (e2) {}

    results.push({ business: biz.label, wave_business_id: biz.wave_business_id, ok: errors.length === 0, total: accounts.length, created: created, updated: updated, skipped: skipped, errors: errors });
  }

  return Response.json({ ok: true, ran_at: new Date().toISOString(), scope: includeProduction ? 'all_businesses' : 'test_only', businesses: businesses.length, results: results });
}

export async function GET(request) { return runSync(request); }
export async function POST(request) { return runSync(request); }
