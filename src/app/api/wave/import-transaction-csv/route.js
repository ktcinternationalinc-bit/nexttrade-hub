// /api/wave/import-transaction-csv — v55.83-LD. PULL existing Wave categorizations into the Hub.
//
// Wave's public GraphQL API has NO read/list for money transactions (see WAVE_API_TRANSACTION_EVIDENCE.md
// — Business has no transactions/moneyTransactions field; Transaction exposes only `id`). So there is no
// API way to discover how a transaction was categorized directly in Wave's UI. The only out-of-band source
// is Wave's CSV export (Wave → Accounting → Transactions → Export). This route ingests that CSV, matches
// each row to a Hub bank transaction (date + abs(amount) + description), and reflects Wave's category onto
// the Hub row so the Hub knows it is already categorized & posted in Wave (won't be re-pushed).
//
// Read-only intent: it does NOT call Wave. It only WRITES the reflected category onto matched Hub rows
// (and only on apply, not dry_run). dry_run returns a full preview so the user verifies before applying.
// SWC-safe: var + string concat only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business';

var API_BUILD_MARKER = 'v55.83-LD-import-transaction-csv';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function roundMoney(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }

// Minimal CSV parser — handles quoted fields with embedded commas and doubled "" quotes. Returns array of
// arrays. SWC-safe (no regex literals doing heavy lifting; char scan).
function parseCsv(text) {
  var rows = []; var row = []; var field = ''; var i = 0; var inQ = false;
  var s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (inQ) {
      if (ch === '"') { if (s.charAt(i + 1) === '"') { field += '"'; i++; } else { inQ = false; } }
      else { field += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += ch; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.length && !(r.length === 1 && String(r[0]).trim() === ''); });
}

function findCol(headers, patterns, avoid) {
  var i, h;
  for (i = 0; i < headers.length; i++) {
    h = norm(headers[i]);
    var bad = false; var a;
    if (avoid) { for (a = 0; a < avoid.length; a++) { if (h.indexOf(avoid[a]) >= 0) { bad = true; break; } } }
    if (bad) { continue; }
    var p;
    for (p = 0; p < patterns.length; p++) { if (h.indexOf(patterns[p]) >= 0) { return i; } }
  }
  return -1;
}

function parseAmount(v) {
  var s = String(v == null ? '' : v).replace(/[$,\s]/g, '');
  var neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.replace(/[()]/g, ''); }
  var n = Number(s);
  if (!isFinite(n)) { return null; }
  return neg ? -n : n;
}
function parseDate(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) { return null; }
  // ISO yyyy-mm-dd
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { return m[1] + '-' + m[2] + '-' + m[3]; }
  // mm/dd/yyyy or m/d/yy
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    var yr = m[3].length === 2 ? ('20' + m[3]) : m[3];
    var mo = ('0' + m[1]).slice(-2); var da = ('0' + m[2]).slice(-2);
    return yr + '-' + mo + '-' + da;
  }
  return null;
}
function dayDiff(a, b) {
  var da = Date.parse(a + 'T00:00:00Z'); var db2 = Date.parse(b + 'T00:00:00Z');
  if (!isFinite(da) || !isFinite(db2)) { return 9999; }
  return Math.abs(Math.round((da - db2) / 86400000));
}
// simple token-overlap similarity 0..1
function sim(a, b) {
  var ta = norm(a).split(' ').filter(Boolean); var tb = norm(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) { return 0; }
  var setb = {}; var i; for (i = 0; i < tb.length; i++) { setb[tb[i]] = true; }
  var hit = 0; for (i = 0; i < ta.length; i++) { if (setb[ta[i]]) { hit++; } }
  return hit / Math.max(ta.length, tb.length);
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { return NextResponse.json({ ok: false, error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
  var db = admin();
  try {
    var body = await req.json();
    var by = body.user_id || null;
    var waveBusinessId = body.wave_business_id || null;
    var csv = body.csv || '';
    var isDry = body.dry_run !== false; // default to dry-run for safety; must pass dry_run:false to apply
    var windowDays = Number(body.date_window_days) || 4;

    var gate = await assertPermission(db, by, 'bank.classify', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error, api_build_marker: API_BUILD_MARKER }, { status: gate.status }); }
    if (!waveBusinessId) { return NextResponse.json({ ok: false, error: 'wave_business_id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (isPlaceholderWaveBusiness(waveBusinessId)) { return NextResponse.json({ ok: false, error: 'This silo is not connected to a real Wave business yet (placeholder id).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (!String(csv).trim()) { return NextResponse.json({ ok: false, error: 'Paste the CSV exported from Wave (Accounting -> Transactions -> Export).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    var grid = parseCsv(csv);
    if (grid.length < 2) { return NextResponse.json({ ok: false, error: 'CSV has no data rows (need a header row + at least one transaction).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    var headers = grid[0];
    var ci = {
      date: findCol(headers, ['date']),
      desc: findCol(headers, ['description', 'memo', 'notes', 'payee']),
      amount: findCol(headers, ['amount', 'total', 'debit', 'credit']),
      // category column — prefer "category", then "account", but AVOID the bank-account column name
      category: findCol(headers, ['category'], null)
    };
    if (ci.category < 0) { ci.category = findCol(headers, ['account'], ['bank', 'asset', 'checking']); }
    var detected = { date: ci.date >= 0 ? headers[ci.date] : null, description: ci.desc >= 0 ? headers[ci.desc] : null, amount: ci.amount >= 0 ? headers[ci.amount] : null, category: ci.category >= 0 ? headers[ci.category] : null };
    if (ci.date < 0 || ci.amount < 0 || ci.category < 0) {
      return NextResponse.json({ ok: false, error: 'Could not detect the required columns. Need a Date column, an Amount column, and a Category/Account column. Detected headers: ' + JSON.stringify(headers), detected_columns: detected, api_build_marker: API_BUILD_MARKER }, { status: 400 });
    }

    // Hub candidates: this silo's transactions that are not invoice-matched and not already pushed/synced.
    var btRes = await db.from('bank_transactions').select('id, name, merchant_name, amount, amount_abs, posted_date, date, direction, wave_account_id, wave_account_name, category_status, matched_invoice_id, wave_business_id').eq('wave_business_id', waveBusinessId);
    var cands = ((btRes && btRes.data) || []).filter(function (t) { return !t.matched_invoice_id && t.category_status !== 'synced'; });

    // Wave categories for name->id resolution.
    var catRes = await db.from('wave_categories').select('wave_account_id, wave_account_name').eq('wave_business_id', waveBusinessId);
    var catByName = {}; ((catRes && catRes.data) || []).forEach(function (c) { var k = norm(c.wave_account_name); if (k && !catByName[k]) { catByName[k] = c; } });

    var used = {}; var matched = []; var unmatched = []; var r;
    for (r = 1; r < grid.length; r++) {
      var rowArr = grid[r];
      var cDate = parseDate(rowArr[ci.date]);
      var cAmt = parseAmount(rowArr[ci.amount]);
      var cDesc = ci.desc >= 0 ? rowArr[ci.desc] : '';
      var cCat = rowArr[ci.category];
      if (cAmt == null || !cDate || !String(cCat || '').trim()) { unmatched.push({ row: r, date: cDate, amount: cAmt, category: cCat, reason: 'missing date/amount/category in CSV row' }); continue; }
      var target = roundMoney(Math.abs(cAmt));
      // best candidate by amount==, date proximity, description similarity
      var best = null; var bestScore = -1; var k;
      for (k = 0; k < cands.length; k++) {
        var t = cands[k];
        if (used[t.id]) { continue; }
        var amt = roundMoney(t.amount_abs != null ? t.amount_abs : Math.abs(Number(t.amount) || 0));
        if (amt !== target) { continue; }
        var td = String(t.posted_date || t.date || '').slice(0, 10);
        if (!td) { continue; }
        var dd = dayDiff(cDate, td);
        if (dd > windowDays) { continue; }
        var score = (1 - dd / (windowDays + 1)) * 0.5 + sim(cDesc, t.name || t.merchant_name) * 0.5;
        if (score > bestScore) { bestScore = score; best = t; }
      }
      if (!best) { unmatched.push({ row: r, date: cDate, amount: target, category: cCat, description: cDesc, reason: 'no Hub transaction with same amount within ' + windowDays + ' days' }); continue; }
      used[best.id] = true;
      var resolved = catByName[norm(cCat)] || null;
      matched.push({ row: r, hub_id: best.id, hub_name: best.name, hub_date: String(best.posted_date || best.date || '').slice(0, 10), amount: target, csv_category: cCat, resolved_wave_account_id: resolved ? resolved.wave_account_id : null, resolved_wave_account_name: resolved ? resolved.wave_account_name : null, category_resolved: !!resolved, score: Math.round(bestScore * 100) / 100 });
    }

    if (isDry) {
      return NextResponse.json({ ok: true, dry_run: true, detected_columns: detected, matched_count: matched.length, unmatched_count: unmatched.length, hub_candidate_count: cands.length, category_unresolved_count: matched.filter(function (m) { return !m.category_resolved; }).length, matched: matched, unmatched: unmatched, api_build_marker: API_BUILD_MARKER });
    }

    // APPLY: reflect the Wave category onto each matched Hub row. It is already in Wave, so mark synced
    // (won't be re-pushed) and tag the source so it's distinguishable from a Hub-originated push.
    var applied = 0; var applyErrors = []; var m;
    for (m = 0; m < matched.length; m++) {
      var mm = matched[m];
      var patch = { wave_account_name: mm.csv_category, category_source: 'wave_csv', category_status: 'synced', updated_by: by };
      if (mm.resolved_wave_account_id) { patch.wave_account_id = mm.resolved_wave_account_id; patch.wave_account_name = mm.resolved_wave_account_name; }
      var upd = await db.from('bank_transactions').update(patch).eq('id', mm.hub_id).neq('category_status', 'synced').select();
      if (upd && upd.error) { applyErrors.push({ hub_id: mm.hub_id, error: upd.error.message }); }
      else if (upd && upd.data && upd.data.length) { applied++; }
    }
    try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'bank_transaction', action: 'import_csv', dry_run: false, success: applyErrors.length === 0, error_message: applyErrors.length ? (applyErrors.length + ' row(s) failed') : null, response_payload: { applied: applied, matched: matched.length, unmatched: unmatched.length }, attempted_by: by }); } catch (eLog) {}

    return NextResponse.json({ ok: true, dry_run: false, applied: applied, matched_count: matched.length, unmatched_count: unmatched.length, category_unresolved_count: matched.filter(function (mx) { return !mx.category_resolved; }).length, apply_errors: applyErrors, detected_columns: detected, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/import-transaction-csv', marker: API_BUILD_MARKER }); }
