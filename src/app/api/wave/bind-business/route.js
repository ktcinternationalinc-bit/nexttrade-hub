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

    // 3) Count (and, unless dry_run, re-stamp) every silo-scoped table from old id -> real id.
    var counts = {}; var total = 0; var errors = [];
    var i;
    for (i = 0; i < SCOPED_TABLES.length; i++) {
      var tbl = SCOPED_TABLES[i];
      try {
        var cRes = await db.from(tbl).select('*', { count: 'exact', head: true }).eq('wave_business_id', fromId);
        if (cRes && cRes.error) { errors.push(tbl + ': ' + cRes.error.message); continue; }
        var n = (cRes && typeof cRes.count === 'number') ? cRes.count : 0;
        counts[tbl] = n; total = total + n;
        if (!dryRun && n > 0) {
          var uRes = await db.from(tbl).update({ wave_business_id: toId }).eq('wave_business_id', fromId);
          if (uRes && uRes.error) { errors.push(tbl + ' (update): ' + uRes.error.message); }
        }
      } catch (eTbl) { errors.push(tbl + ': ' + ((eTbl && eTbl.message) || String(eTbl))); }
    }

    // 4) The registry row itself (rebind its id + adopt the real Wave name as the label if none given).
    var regCount = 0; var regErr = null;
    try {
      var rgC = await db.from('wave_business_registry').select('*', { count: 'exact', head: true }).eq('wave_business_id', fromId);
      regCount = (rgC && typeof rgC.count === 'number') ? rgC.count : 0;
      if (!dryRun && regCount > 0) {
        var regPatch = { wave_business_id: toId };
        if (toLabel) { regPatch.label = toLabel; } else if (realName) { regPatch.label = realName; }
        var rgU = await db.from('wave_business_registry').update(regPatch).eq('wave_business_id', fromId);
        if (rgU && rgU.error) { regErr = rgU.error.message; }
      }
    } catch (eRg) { regErr = (eRg && eRg.message) || String(eRg); }
    if (regErr) { errors.push('wave_business_registry: ' + regErr); }

    return NextResponse.json({
      ok: errors.length === 0,
      dry_run: dryRun,
      from_wave_business_id: fromId,
      to_wave_business_id: toId,
      wave_business_name: realName,
      registry_rows: regCount,
      data_rows_total: total,
      counts: counts,
      errors: errors,
      message: dryRun
        ? ('Preview: binding will re-tag ' + total + ' data row(s) + ' + regCount + ' registry row to "' + (realName || toId) + '". Nothing changed yet.')
        : (errors.length === 0 ? ('Bound to "' + (realName || toId) + '". Re-tagged ' + total + ' data row(s). Now Test/Pull categories.') : ('Bind completed with ' + errors.length + ' error(s) — review them.')),
      api_build_marker: API_BUILD_MARKER
    }, { status: errors.length === 0 ? 200 : 207 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/bind-business', marker: API_BUILD_MARKER }); }
