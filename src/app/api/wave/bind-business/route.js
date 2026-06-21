// /api/wave/bind-business — v55.83-KN. BIND a silo to its REAL Wave business.
//
// The root cause of "Real KTC can't pull categories / push / set products" is that the silo's
// wave_business_id is a SEED PLACEHOLDER (e.g. REAL_KTC_WAVE_BUSINESS_ID), never the real Wave business
// GUID. Wave rejects every call for a fake id. This route re-stamps the registry row + all silo-scoped
// data from the placeholder (or any old id) to the real GUID, after VALIDATING the GUID is a real Wave
// business the configured token can actually read. Super-admin only. dry_run returns the row counts that
// WOULD change so the admin can preview before committing. SWC-safe: var + string concat only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var API_BUILD_MARKER = 'v55.83-KN-bind-business';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';
var PLACEHOLDER_BIDS = { 'REAL_KTC_WAVE_BUSINESS_ID': 1, 'TEST_WAVE_BUSINESS_ID': 1 };
// Every table that carries a silo wave_business_id tag. Schema-safe: a missing table/column is skipped.
var SCOPED_TABLES = [
  'bank_transactions', 'bank_connections', 'plaid_accounts', 'accounting_invoices', 'accounting_customers',
  'accounting_invoice_payments', 'payment_matches', 'accounting_proformas', 'wave_categories',
  'customer_credits', 'unapplied_deposits', 'wave_business_settings', 'wave_sync_log',
  // v55.83-KO (audit P0) — these ALSO carry wave_business_id; omitting them orphaned the silo's Wave
  // product catalog (breaking per-line product selection) + split-level categorizations after a rebind.
  'wave_products', 'bank_transaction_splits'
];

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { return NextResponse.json({ ok: false, error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
  var db = admin();
  try {
    var body = await req.json();
    var by = body.user_id || null;
    var fromId = body.from_wave_business_id ? String(body.from_wave_business_id) : null;
    var toId = body.to_wave_business_id ? String(body.to_wave_business_id) : null;
    var toLabel = body.to_label ? String(body.to_label) : null;
    var dryRun = body.dry_run === true;

    // Binding rewrites accounting scope across the whole silo — super-admin only (same gate as the
    // production-unlock / push settings).
    var gate = await assertPermission(db, by, 'wave.settings.manage', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error || 'Super-admin only.', api_build_marker: API_BUILD_MARKER }, { status: gate.status || 403 }); }

    if (!fromId || !toId) { return NextResponse.json({ ok: false, error: 'from_wave_business_id and to_wave_business_id are required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (fromId === toId) { return NextResponse.json({ ok: false, error: 'The silo is already bound to that Wave business.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (PLACEHOLDER_BIDS[toId]) { return NextResponse.json({ ok: false, error: 'The target is a placeholder id, not a real Wave business.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    // 1) VALIDATE the target GUID is a REAL Wave business the token can read (don't bind to a bogus id).
    var token = process.env.WAVE_ACCESS_TOKEN;
    if (!token) { return NextResponse.json({ ok: false, error: 'No Wave token configured (WAVE_ACCESS_TOKEN).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    var vQuery = 'query($bid: ID!){ business(id:$bid){ id name } }';
    var vResp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: vQuery, variables: { bid: toId } }) });
    var vData = null; try { vData = await vResp.json(); } catch (eV) { vData = null; }
    var vBiz = vData && vData.data && vData.data.business;
    if (!vBiz || !vBiz.id) { return NextResponse.json({ ok: false, error: 'Wave does not recognize that business id for the configured token. Open Wave Connection -> Test connection and copy the exact id of the business you want, then bind to that. (The token can only bind businesses it can access.)', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    var realName = vBiz.name || null;

    // 2) Guard: refuse if another registry row already uses the target id (would collide).
    var existsRes = await db.from('wave_business_registry').select('wave_business_id, label').eq('wave_business_id', toId).limit(1);
    if (existsRes && existsRes.data && existsRes.data.length) { return NextResponse.json({ ok: false, error: 'Another silo ("' + (existsRes.data[0].label || toId) + '") is already bound to that Wave business. Remove/rename it first.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }

    // 3) COUNT every silo-scoped table + the registry row (dry-run preview total). No mutation here.
    // v55.83-KR (Codex caution) — an UNEXPECTED count error must ABORT before any mutation (never skip a
    // table then declare success, which could leave rows on the old id). A genuinely-ABSENT optional table
    // (undefined_table/column) is the only allowed skip, and it's REPORTED (skipped_optional_tables), not
    // silent — so the operator can see exactly what was and wasn't covered.
    var isMissingObjErr = function (err) {
      if (!err) { return false; }
      var c = String(err.code || ''); var m = String(err.message || '').toLowerCase();
      return c === '42P01' || c === '42703' || c.indexOf('PGRST') === 0 || m.indexOf('does not exist') >= 0 || m.indexOf('could not find') >= 0 || m.indexOf('schema cache') >= 0;
    };
    var counts = {}; var total = 0; var skipped = {}; var i;
    for (i = 0; i < SCOPED_TABLES.length; i++) {
      var tbl = SCOPED_TABLES[i];
      var cErr = null; var cRes = null;
      try { cRes = await db.from(tbl).select('*', { count: 'exact', head: true }).eq('wave_business_id', fromId); if (cRes && cRes.error) { cErr = cRes.error; } }
      catch (eC) { cErr = { message: (eC && eC.message) || String(eC) }; }
      if (cErr) {
        if (isMissingObjErr(cErr)) { skipped[tbl] = (cErr.message || 'table/column absent'); counts[tbl] = 0; continue; }
        return NextResponse.json({ ok: false, error: 'Bind aborted BEFORE any change — could not read table "' + tbl + '" to verify what would move: ' + (cErr.message || 'unknown') + '. NOTHING was changed. Retry; if it persists, screenshot for Claude.', api_build_marker: API_BUILD_MARKER }, { status: 500 });
      }
      var n = (cRes && typeof cRes.count === 'number') ? cRes.count : 0;
      counts[tbl] = n; total = total + n;
    }
    var rgC = null; var rgErr = null;
    try { rgC = await db.from('wave_business_registry').select('*', { count: 'exact', head: true }).eq('wave_business_id', fromId); if (rgC && rgC.error) { rgErr = rgC.error; } }
    catch (eRgC) { rgErr = { message: (eRgC && eRgC.message) || String(eRgC) }; }
    if (rgErr) { return NextResponse.json({ ok: false, error: 'Bind aborted BEFORE any change — could not read the registry to verify the silo: ' + (rgErr.message || 'unknown') + '. NOTHING was changed.', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
    var regCount = (rgC && typeof rgC.count === 'number') ? rgC.count : 0;
    var skippedKeys = Object.keys(skipped);

    if (dryRun) {
      return NextResponse.json({ ok: true, dry_run: true, from_wave_business_id: fromId, to_wave_business_id: toId, wave_business_name: realName, registry_rows: regCount, data_rows_total: total, counts: counts, skipped_optional_tables: skipped, message: 'Preview: binding will re-tag ' + total + ' data row(s) + ' + regCount + ' registry row to "' + (realName || toId) + '".' + (skippedKeys.length ? (' Skipped ' + skippedKeys.length + ' absent optional table(s): ' + skippedKeys.join(', ') + '.') : '') + ' Nothing changed yet.', api_build_marker: API_BUILD_MARKER }, { status: 200 });
    }

    // 4) EXECUTE — ALL-OR-NOTHING (Codex live-safety blocker). Re-stamp each table from->to; if ANY fails,
    // ROLL BACK every table already changed (to->from) so silo ownership is NEVER left partial. Registry
    // last. No partial-success path exists anymore: any failure rolls back and returns a hard error.
    var updatedTables = []; var failTbl = null; var failMsg = null; var k;
    for (k = 0; k < SCOPED_TABLES.length; k++) {
      var t2 = SCOPED_TABLES[k];
      if (!counts[t2]) { continue; }
      try {
        var u2 = await db.from(t2).update({ wave_business_id: toId }).eq('wave_business_id', fromId);
        if (u2 && u2.error) { failTbl = t2; failMsg = u2.error.message; break; }
        updatedTables.push(t2);
      } catch (eU) { failTbl = t2; failMsg = (eU && eU.message) || String(eU); break; }
    }
    var regFail = null;
    if (!failTbl) {
      try {
        var regPatch = { wave_business_id: toId };
        if (toLabel) { regPatch.label = toLabel; } else if (realName) { regPatch.label = realName; }
        var rgU = await db.from('wave_business_registry').update(regPatch).eq('wave_business_id', fromId);
        if (rgU && rgU.error) { regFail = rgU.error.message; }
      } catch (eRg) { regFail = (eRg && eRg.message) || String(eRg); }
    }

    if (failTbl || regFail) {
      // roll back every data table we already moved (the registry was updated last, so on a registry
      // failure the data tables moved but the registry didn't — reverse the data tables either way).
      var rbErrors = []; var rb;
      for (rb = 0; rb < updatedTables.length; rb++) {
        try { var rr = await db.from(updatedTables[rb]).update({ wave_business_id: fromId }).eq('wave_business_id', toId); if (rr && rr.error) { rbErrors.push(updatedTables[rb] + ': ' + rr.error.message); } }
        catch (eRB) { rbErrors.push(updatedTables[rb] + ': ' + ((eRB && eRB.message) || String(eRB))); }
      }
      var why = failTbl ? (failTbl + ': ' + failMsg) : ('wave_business_registry: ' + regFail);
      var restoredOk = rbErrors.length === 0;
      return NextResponse.json({ ok: false, restored: restoredOk, from_wave_business_id: fromId, to_wave_business_id: toId,
        error: restoredOk
          ? ('Bind failed and was fully rolled back — NO change was made (' + why + '). Fix the cause and retry.')
          : ('Bind FAILED mid-way and rollback ALSO failed — silo ownership may be inconsistent. DO NOT retry; screenshot for Claude. Failure: ' + why + ' | rollback errors: ' + rbErrors.join('; ')),
        api_build_marker: API_BUILD_MARKER }, { status: 500 });
    }

    return NextResponse.json({ ok: true, dry_run: false, from_wave_business_id: fromId, to_wave_business_id: toId, wave_business_name: realName, registry_rows: regCount, data_rows_total: total, counts: counts, skipped_optional_tables: skipped, message: 'Bound to "' + (realName || toId) + '". Re-tagged ' + total + ' data row(s) + the registry.' + (skippedKeys.length ? (' (' + skippedKeys.length + ' absent optional table(s) skipped: ' + skippedKeys.join(', ') + '.)') : '') + ' Now Test / Pull categories.', api_build_marker: API_BUILD_MARKER }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/bind-business', marker: API_BUILD_MARKER }); }
