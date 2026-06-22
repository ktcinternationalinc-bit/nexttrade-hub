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

var API_BUILD_MARKER = 'v55.83-LJ-import-transaction-csv';

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
      amount: findCol(headers, ['amount', 'total'], ['running', 'balance']),
      // v55.83-LI (Codex #3) — support SEPARATE Debit/Credit columns (debit = money out, credit = in).
      debit: findCol(headers, ['debit', 'withdrawal'], ['balance']),
      credit: findCol(headers, ['credit', 'deposit'], ['balance']),
      // v55.83-LJ (Codex) — detect invoice/customer reference columns. A CSV row that references an invoice
      // is a PAYMENT, not a plain categorization, and must NOT be applied as a category (that linkage is the
      // readable invoice-payment path's job). Such rows are routed to needs_manual_invoice_link.
      invoice: findCol(headers, ['invoice'], ['date']),
      customer: findCol(headers, ['customer', 'contact', 'client']),
      // category column — prefer "category", then "account", but AVOID the bank-account column name
      category: findCol(headers, ['category'], null)
    };
    if (ci.category < 0) { ci.category = findCol(headers, ['account'], ['bank', 'asset', 'checking']); }
    var hasAmount = (ci.amount >= 0) || (ci.debit >= 0) || (ci.credit >= 0);
    var detected = { date: ci.date >= 0 ? headers[ci.date] : null, description: ci.desc >= 0 ? headers[ci.desc] : null, amount: ci.amount >= 0 ? headers[ci.amount] : null, debit: ci.debit >= 0 ? headers[ci.debit] : null, credit: ci.credit >= 0 ? headers[ci.credit] : null, category: ci.category >= 0 ? headers[ci.category] : null, invoice: ci.invoice >= 0 ? headers[ci.invoice] : null, customer: ci.customer >= 0 ? headers[ci.customer] : null };
    if (ci.date < 0 || !hasAmount || ci.category < 0) {
      return NextResponse.json({ ok: false, error: 'Could not detect the required columns. Need a Date column, an Amount (or Debit/Credit) column, and a Category/Account column. Detected headers: ' + JSON.stringify(headers), detected_columns: detected, api_build_marker: API_BUILD_MARKER }, { status: 400 });
    }
    // v55.83-LI (Codex #2/#3) — signed amount from the row: Debit/Credit are unambiguous (debit=out,
    // credit=in); a lone signed Amount uses its sign (Wave: negative = withdrawal). Direction is then
    // a HARD match filter so an IN and an OUT of the same amount can never be cross-matched.
    function rowSigned(rowArr) {
      if (ci.debit >= 0 || ci.credit >= 0) {
        var dv = ci.debit >= 0 ? Math.abs(parseAmount(rowArr[ci.debit]) || 0) : 0;
        var cv = ci.credit >= 0 ? Math.abs(parseAmount(rowArr[ci.credit]) || 0) : 0;
        if (dv > 0 && cv === 0) { return -dv; }
        if (cv > 0 && dv === 0) { return cv; }
        if (ci.amount >= 0) { var a = parseAmount(rowArr[ci.amount]); return a == null ? null : a; }
        return cv - dv;
      }
      return parseAmount(rowArr[ci.amount]);
    }

    // Hub candidates: this silo's transactions that are not invoice-matched and not already pushed. (Codex
    // #5) "pushed" is widened to also exclude any row carrying a Wave transaction id, not just status.
    var btRes = await db.from('bank_transactions').select('id, name, merchant_name, amount, amount_abs, posted_date, date, direction, wave_account_id, wave_account_name, category_source, category_status, matched_invoice_id, wave_transaction_id, wave_business_id').eq('wave_business_id', waveBusinessId);
    var cands = ((btRes && btRes.data) || []).filter(function (t) { return !t.matched_invoice_id && t.category_status !== 'synced' && !t.wave_transaction_id; });

    // Wave categories for name->id resolution.
    var catRes = await db.from('wave_categories').select('wave_account_id, wave_account_name').eq('wave_business_id', waveBusinessId);
    var catByName = {}; ((catRes && catRes.data) || []).forEach(function (c) { var k = norm(c.wave_account_name); if (k && !catByName[k]) { catByName[k] = c; } });

    function rowHash(rowArr) { var s = rowArr.join(''); var h = 0; var i; for (i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return String(h); }
    var allowOverride = body.override_conflicts === true; // Codex #4 — explicit opt-in to replace an existing category
    var used = {}; var matched = []; var ambiguous = []; var conflicts = []; var unmatched = []; var needsInvoiceLink = []; var r;
    for (r = 1; r < grid.length; r++) {
      var rowArr = grid[r];
      var cDate = parseDate(rowArr[ci.date]);
      var cSigned = rowSigned(rowArr);
      var cDesc = ci.desc >= 0 ? rowArr[ci.desc] : '';
      var cCat = rowArr[ci.category];
      // v55.83-LJ (Codex #1) — a row that references an invoice is a PAYMENT, not a categorization. Do NOT
      // apply it as a category; route it to needs_manual_invoice_link so the blotter never implies the
      // invoice relationship is known from a category import (that linkage is the payment path's job).
      var cInv = ci.invoice >= 0 ? String(rowArr[ci.invoice] || '').trim() : '';
      var cCust = ci.customer >= 0 ? String(rowArr[ci.customer] || '').trim() : '';
      if (cInv) { needsInvoiceLink.push({ row: r, date: cDate, amount: cSigned == null ? null : roundMoney(Math.abs(cSigned)), invoice: cInv, customer: cCust, category: cCat, reason: 'CSV row references invoice ' + cInv + ' — this is a PAYMENT; reconcile via invoice-payment sync, not category import' }); continue; }
      if (cSigned == null || !cDate || !String(cCat || '').trim()) { unmatched.push({ row: r, date: cDate, amount: cSigned, category: cCat, reason: 'missing date/amount/category in CSV row' }); continue; }
      var target = roundMoney(Math.abs(cSigned));
      var csvDir = cSigned < 0 ? 'out' : 'in';
      // Codex #1 — collect ALL plausible candidates (amount==, DIRECTION==, within window). >1 => ambiguous.
      var hits = []; var k;
      for (k = 0; k < cands.length; k++) {
        var t = cands[k];
        if (used[t.id]) { continue; }
        var amt = roundMoney(t.amount_abs != null ? t.amount_abs : Math.abs(Number(t.amount) || 0));
        if (amt !== target) { continue; }
        if (t.direction && t.direction !== csvDir) { continue; } // Codex #2 — never cross IN/OUT
        var td = String(t.posted_date || t.date || '').slice(0, 10);
        if (!td) { continue; }
        var dd = dayDiff(cDate, td);
        if (dd > windowDays) { continue; }
        var score = (1 - dd / (windowDays + 1)) * 0.5 + sim(cDesc, t.name || t.merchant_name) * 0.5;
        hits.push({ t: t, score: score });
      }
      if (hits.length === 0) { unmatched.push({ row: r, date: cDate, amount: target, direction: csvDir, category: cCat, description: cDesc, reason: 'no Hub transaction with same amount + direction within ' + windowDays + ' days' }); continue; }
      if (hits.length > 1) { ambiguous.push({ row: r, date: cDate, amount: target, direction: csvDir, category: cCat, description: cDesc, candidate_count: hits.length, hub_ids: hits.map(function (h) { return h.t.id; }), reason: hits.length + ' Hub transactions match amount+direction+date — resolve manually (NOT auto-applied)' }); continue; }
      var best = hits[0].t;
      var resolved = catByName[norm(cCat)] || null;
      // Codex #4 — an existing DIFFERENT Hub category is a conflict; do not silently overwrite. Widened
      // (LJ) to ANY existing category (a label-only wave_account_name counts, not just a resolved id).
      var hasExistingCat = !!(best.wave_account_id || best.wave_account_name);
      var wouldChange = resolved ? (best.wave_account_id !== resolved.wave_account_id) : (norm(best.wave_account_name) !== norm(cCat));
      if (hasExistingCat && wouldChange && !allowOverride) {
        conflicts.push({ row: r, hub_id: best.id, hub_name: best.name, amount: target, direction: csvDir, existing_category: best.wave_account_name, existing_account_id: best.wave_account_id || null, existing_source: best.category_source, existing_status: best.category_status, csv_category: cCat, reason: 'Hub already has a different category — re-run with “override existing Hub categories” to replace' });
        continue;
      }
      used[best.id] = true;
      matched.push({ row: r, hub_id: best.id, hub_name: best.name, hub_date: String(best.posted_date || best.date || '').slice(0, 10), amount: target, direction: csvDir, csv_category: cCat, resolved_wave_account_id: resolved ? resolved.wave_account_id : null, resolved_wave_account_name: resolved ? resolved.wave_account_name : null, category_resolved: !!resolved, overwrote: hasExistingCat, row_hash: rowHash(rowArr), raw_row: rowArr.join(' | ').slice(0, 300), before: { wave_account_id: best.wave_account_id || null, wave_account_name: best.wave_account_name || null, category_source: best.category_source || null, category_status: best.category_status || null }, score: Math.round(hits[0].score * 100) / 100 });
    }

    if (isDry) {
      return NextResponse.json({ ok: true, dry_run: true, detected_columns: detected, matched_count: matched.length, ambiguous_count: ambiguous.length, conflict_count: conflicts.length, unmatched_count: unmatched.length, needs_manual_invoice_link_count: needsInvoiceLink.length, hub_candidate_count: cands.length, category_unresolved_count: matched.filter(function (m) { return !m.category_resolved; }).length, matched: matched, ambiguous: ambiguous, conflicts: conflicts, unmatched: unmatched, needs_manual_invoice_link: needsInvoiceLink, api_build_marker: API_BUILD_MARKER });
    }

    // APPLY. Codex #6 — a RESOLVED category name (maps to this silo's Wave chart) is marked 'synced' (it is
    // a real Wave account already in Wave). An UNRESOLVED name keeps the label but category_status='local_only'
    // so it can NEVER masquerade as fully reflected in Wave. Codex #7 — full per-row audit + batch id.
    var batchId = 'csv-' + Date.now();
    var appliedAt = new Date().toISOString();
    var applied = 0; var appliedUnresolved = 0; var applyErrors = []; var auditRows = []; var m;
    for (m = 0; m < matched.length; m++) {
      var mm = matched[m];
      var patch = { category_source: 'wave_csv', updated_by: by };
      if (mm.resolved_wave_account_id) { patch.wave_account_id = mm.resolved_wave_account_id; patch.wave_account_name = mm.resolved_wave_account_name; patch.category_status = 'synced'; }
      else { patch.wave_account_name = mm.csv_category; patch.category_status = 'local_only'; }
      // Codex #5 — never overwrite an already-pushed row (status synced OR a Wave txn id present).
      var upd = await db.from('bank_transactions').update(patch).eq('id', mm.hub_id).neq('category_status', 'synced').is('wave_transaction_id', null).select('id');
      if (upd && upd.error) { applyErrors.push({ hub_id: mm.hub_id, error: upd.error.message }); }
      else if (upd && upd.data && upd.data.length) {
        applied++; if (!mm.resolved_wave_account_id) { appliedUnresolved++; }
        // Codex #7 (LJ) — full before/after audit per row: raw row + hash, matched bank txn id, who/when.
        auditRows.push({ matched_bank_transaction_id: mm.hub_id, csv_row: mm.row, row_hash: mm.row_hash, raw_row: mm.raw_row, before: mm.before, after: { wave_account_id: patch.wave_account_id || null, wave_account_name: patch.wave_account_name, category_source: 'wave_csv', category_status: patch.category_status }, resolved: mm.category_resolved, overwrote: mm.overwrote, applied_by: by, applied_at: appliedAt });
      }
    }
    try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'bank_transaction', action: 'import_csv', dry_run: false, success: applyErrors.length === 0, error_message: applyErrors.length ? (applyErrors.length + ' row(s) failed') : null, response_payload: { batch_id: batchId, filename: body.filename || null, applied_at: appliedAt, applied_by: by, detected_columns: detected, applied: applied, applied_unresolved_local_only: appliedUnresolved, matched: matched.length, ambiguous: ambiguous.length, conflicts: conflicts.length, unmatched: unmatched.length, needs_manual_invoice_link: needsInvoiceLink.length, override_conflicts: allowOverride, rows: auditRows }, attempted_by: by }); } catch (eLog) {}

    return NextResponse.json({ ok: true, dry_run: false, applied: applied, applied_unresolved_local_only: appliedUnresolved, matched_count: matched.length, ambiguous_count: ambiguous.length, conflict_count: conflicts.length, unmatched_count: unmatched.length, needs_manual_invoice_link_count: needsInvoiceLink.length, category_unresolved_count: matched.filter(function (mx) { return !mx.category_resolved; }).length, apply_errors: applyErrors, batch_id: batchId, detected_columns: detected, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/import-transaction-csv', marker: API_BUILD_MARKER }); }
