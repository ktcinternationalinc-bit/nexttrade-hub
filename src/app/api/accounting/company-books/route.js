// /api/accounting/company-books — v55.83-TW. NEXTRADE and RTM, each its own books (Max, Nov 17 2026).
// Every action names the company ('nextrade' | 'rtm'); a request without one is refused — never treated as KTC.
// Everything is scoped to that company's bank lines (bank_transactions.wave_business_id = NEXTRADE_BOOKS / RTM_BOOKS):
//   accounts · lines · set_category · categories · save_category · category_active · rules · save_rule · rule_active ·
//   apply_rules · totals · mapping · save_mapping (Nextrade) · nextrade_bills (KTC Bills → 🟦 Nextrade bills).
// Categorizing a Nextrade money-out line as an expense makes / updates / voids its KTC bill (src/lib/nextrade-bills-server.js)
// BEFORE the category is saved, so the two never disagree; when the KTC side refuses, the category is not saved.
// Every action acts for the verified signed-in person (bearer token). Reads need the company's view permission, writes
// its manage permission (super admin passes). Nothing is ever deleted. SWC-safe: var + string concatenation only.
import { payrollBillScope, payrollFilteredDb, requestNamesPayroll, payrollBillsNote } from '../../../../lib/payroll-bills'; // v55.83-ZD
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { audit } from '../../../../lib/audit-server';
import { companyByKey, COMPANY_KINDS, categoryKey, bestCompanyRule, companyTotals, normMatch, NEXTRADE_COMPANY_ID } from '../../../../lib/companies';
import { categorizeLine, partyName, wantsBill, loadBillCutoff, beforeCutoff, NEXTRADE_BILL_CUTOFF } from '../../../../lib/nextrade-bills-server'; // v55.83-TW (Codex P1-2): one database function, all or nothing
import { privateScope, dropPrivate, isPrivateRow } from '../../../../lib/private-accounts-server'; // v55.83-TP private bank accounts — respected here too
import { realAccounts, realKeyOf } from '../../../../lib/duplicate-detect'; // v55.83-UB — the same REAL account can have two connections
import { loadBankAccounts } from '../../../../lib/duplicates-server';
import { PENDING_REFUSAL } from '../../../../lib/pending-guard'; // v55.83-XT
import { payrollScope, payrollKeys, maskPayrollLine, maskPayrollBill, isPayrollVendorName, PAYROLL_NOTE } from '../../../../lib/payroll-visibility'; // v55.83-XE — warehouse salaries only for 'payroll.view'
import { learnPlan, linesForRule } from '../../../../lib/company-rule-learn'; // v55.83-VK — the books learn a rule from what a person categorizes
var SQL_MISSING_UD = '"KTC pays this" on a category needs one database update first: run sql/v55-83-UD-pay-nextrade.sql in Supabase (SQL Editor).';
var SQL_MISSING_VK = 'Rules need one small database update before they can categorize lines: run sql/v55-83-VK-rule-apply-guard.sql in Supabase (SQL Editor). Nothing was changed. You can still categorize lines by hand.';
var SQL_MISSING_UB = 'Transfers and category directions need one database update first: run sql/v55-83-UB-company-transfers.sql in Supabase (SQL Editor).';

var API_BUILD_MARKER = 'v55.83-TW-company-books';
export const maxDuration = 60;
var SQL_MISSING_XN = 'The button that stops KTC bills from Nextrade lines before 1 June 2026 needs one database update first: run sql/v55-83-XN-nextrade-june-cutoff.sql in Supabase (SQL Editor). Nothing was changed.';
var SQL_MISSING = 'Nextrade and RTM books need one database update first: run sql/v55-83-TW-company-books.sql in Supabase (SQL Editor).';
var LINE_COLS = 'id, date, posted_date, amount_abs, direction, account_id, name, merchant_name, pending, review_status, wave_business_id, company_category, company_category_source, company_category_at, transfer_group_id';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function missingRel(e) { return /does not exist|schema cache|Could not find the table|company_category/i.test(String((e && e.message) || '')); }
// the is_private column does not exist at all (Postgres 42703 / PostgREST PGRST204) — anything else (permission, network…) is NOT this
function missingPrivateColumn(e) { var c = String((e && e.code) || ''); var m = String((e && e.message) || ''); return (c === '42703' || c === 'PGRST204') && /is_private/.test(m) && /does not exist|schema cache/i.test(m) && !/permission/i.test(m); }
function transactionSource(line) {
  var source = String(line.bank_source || '');
  if (source.startsWith('[CSV]')) { return 'csv'; }
  if (source.startsWith('[PDF]')) { return 'pdf'; }
  if (source.startsWith('[HAND]')) { return 'manual'; }
  var id = String(line.plaid_transaction_id || '');
  if (id.startsWith('manual-hand-')) { return 'manual'; }
  if (id.startsWith('manual-')) { return 'statement'; }
  return id ? 'plaid' : null;
}
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function fail(msg, st) { return NextResponse.json({ ok: false, error: msg }, { status: st || 400 }); }
function readFail(what, e) { return NextResponse.json({ ok: false, error: missingRel(e) ? SQL_MISSING : 'Could not read ' + what + ' (' + ((e && e.message) || 'error') + ') — nothing changed.' }, { status: missingRel(e) ? 409 : 503 }); }

async function pageLines(db, companyId, from, to) {
  var out = [];
  for (var pg = 0; pg < 30; pg++) {
    var r = await db.from('bank_transactions').select(LINE_COLS + (companyId === NEXTRADE_COMPANY_ID ? ', bank_source, plaid_transaction_id' : '')).eq('wave_business_id', companyId)
      .or('review_status.is.null,review_status.neq.duplicate').gte('date', from).lte('date', to)
      .order('date', { ascending: false }).order('id', { ascending: true }).range(pg * 1000, pg * 1000 + 999);
    if (r.error) { return { error: r.error }; }
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < 1000) { return { data: out }; }
  }
  return { data: out, capped: true };
}
async function loadCats(db, companyId) {
  var r = await db.from('company_categories').select('id, key, label, kind, is_payroll, active, sort, direction, makes_ktc_bill').eq('company_id', companyId).order('sort').order('label');
  if (r.error && /makes_ktc_bill/.test(String(r.error.message || ''))) { r = await db.from('company_categories').select('id, key, label, kind, is_payroll, active, sort, direction').eq('company_id', companyId).order('sort').order('label'); if (!r.error) { (r.data || []).forEach(function (c) { c.makes_ktc_bill = null; }); } }
  if (r.error && /direction/.test(String(r.error.message || ''))) { r = await db.from('company_categories').select('id, key, label, kind, is_payroll, active, sort').eq('company_id', companyId).order('sort').order('label'); if (!r.error) { (r.data || []).forEach(function (c) { c.direction = 'any'; }); } }
  return r;
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { return fail('Server key missing.', 500); }
  var db = admin();
  try {
    var body = await req.json();
    var action = String(body.action || '');
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return fail(who.error, who.status || 401); }
    var userId = who.userId;
    // v55.83-ZD — payroll bills: SUPER ADMIN ONLY. Who is calling + the payroll list, read once (fails closed); for anyone else a request
    // naming a payroll bill / wire package is "not found", and every read below leaves payroll out (so every total excludes it).
    var payZD = await payrollBillScope(db, userId); if (payZD.error) { return Response.json({ ok: false, error: payZD.error }, { status: payZD.status }); }
    if (requestNamesPayroll(payZD, body)) { return Response.json({ ok: false, error: 'Not found.' }, { status: 404 }); }
    db = payrollFilteredDb(db, payZD);
    // v55.83-TP (live) — private bank accounts: hidden unless super admin or 'bank.view_private'; fails closed
    var scope = await privateScope(db, userId);
    if (scope.error) { return fail(scope.error + ' — nothing shown.', 503); }
    // v55.83-XE — payroll amounts (warehouse salaries) only for the super admin or 'payroll.view'; fails closed
    var pay = await payrollScope(db, userId, req);

    // KTC Bills → 🟦 Nextrade bills: a KTC screen, so it needs Bills: View / Manage (not the Nextrade permission)
    if (action === 'nextrade_bills') {
      var gb = await assertPermission(db, userId, 'bills.manage', req);
      if (!gb || gb.ok !== true) { gb = await assertPermission(db, userId, 'bills.view', req); }
      if (!gb || gb.ok !== true) { return fail('This needs the "Bills: View" permission.', 403); }
      var lk = await db.from('company_bill_links').select('id, source_bank_transaction_id, bill_id, mode, status, category_key, set_paid_via, message, updated_at').eq('company_id', NEXTRADE_COMPANY_ID).order('updated_at', { ascending: false }).limit(2000);
      if (lk.error) { return missingRel(lk.error) ? NextResponse.json({ ok: true, rows: [], sql_missing: SQL_MISSING }) : readFail('the Nextrade bills', lk.error); }
      var links = (lk.data || []).filter(function (l) { return !!l.bill_id; });
      var billIds = links.map(function (l) { return l.bill_id; }); var lineIds = links.map(function (l) { return l.source_bank_transaction_id; });
      var bills = {}; var lines = {}; var paid = {};
      for (var bi = 0; bi < billIds.length; bi += 200) {
        var chunk = billIds.slice(bi, bi + 200); var lchunk = lineIds.slice(bi, bi + 200);
        var bq = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, due_date, total_amount, category, record_status, paid_via').in('id', chunk);
        var lq = await db.from('bank_transactions').select('id, date, name, merchant_name, amount_abs, account_id').in('id', lchunk);
        var pq = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', chunk);
        if (bq.error || lq.error || pq.error) { return readFail('the Nextrade bills', bq.error || lq.error || pq.error); }
        (bq.data || []).forEach(function (b) { bills[b.id] = b; });
        (lq.data || []).forEach(function (l) { lines[l.id] = l; });
        (pq.data || []).forEach(function (p) { if (p.voided !== true) { paid[p.bill_id] = (paid[p.bill_id] || 0) + (Number(p.amount) || 0); } });
      }
      var catsNb = await loadCats(db, NEXTRADE_COMPANY_ID);
      // v55.83-XE (Codex 22 Nov 08:43 P2) — without the categories nobody can tell which bills are payroll (an ATTACHED bill keeps
      // its own vendor name), so the whole answer is refused: no rows, no totals. Fails closed for everyone, holders included.
      if (!catsNb || catsNb.error) { return readFail('the Nextrade categories (needed to keep payroll hidden)', catsNb ? catsNb.error : null); }
      var payKeys = {}; ((catsNb && catsNb.data) || []).forEach(function (c) { if (c.is_payroll) { payKeys[c.key] = true; } }); // UD: payroll shows as Warehouse staff — no names
      var restrictedNb = 0;
      var rowsNb = links.map(function (l) {
        var ln0 = lines[l.source_bank_transaction_id] || null; var b0 = bills[l.bill_id] || null; var paid0 = Math.round((paid[l.bill_id] || 0) * 100) / 100;
        var isPay = !!payKeys[l.category_key] || !!(b0 && isPayrollVendorName(b0.vendor_name));
        if (ln0 && isPrivateRow(ln0, scope)) { ln0 = { date: ln0.date, name: '(private account)' }; } else if (ln0 && isPay) { ln0 = { date: ln0.date, name: 'Warehouse staff', amount_abs: ln0.amount_abs, account_id: ln0.account_id }; }
        // v55.83-XE — without 'payroll.view' a payroll bill shows as "Warehouse staff" with its date and state only: no amount,
        // no paid amount, no description. The paid / owed state is worked out here, from the real numbers, before they are removed.
        if (isPay && !pay.canSee) {
          if (l.status === 'active') { restrictedNb++; }
          var stateNb = b0 && paid0 >= (Number(b0.total_amount) || 0) - 0.005 ? 'paid' : 'owed';
          return { link: l, bill: maskPayrollBill(b0), line: ln0 ? { date: ln0.date, name: 'Warehouse staff', payroll_restricted: true } : null, paid: null, state: stateNb, payroll_restricted: true };
        }
        // v55.83-ZD — the super admin sees why a bill is payroll (the screen groups them under "Payroll"); nobody else gets payroll rows
        var whyZD = b0 && payZD.isSuper === true ? payZD.pay.ids[b0.id] : null;
        return whyZD && whyZD.length ? { link: l, bill: b0, line: ln0, paid: paid0, payroll_reasons: whyZD } : { link: l, bill: b0, line: ln0, paid: paid0 };
      });
      var gTotN = await assertPermission(db, userId, 'accounting.view_totals', req); // the 'still owed' sum is a sensitive total (Codex P1-1)
      // XE — the "still owed" sum would contain the hidden payroll bills (or reveal them by subtraction): withheld when any is hidden
      // v55.83-XX — per-category "still owed" (the grouped list): the same totals permission, but a hidden payroll bill is simply left out of
      // its group's sum (its amount is never in the answer), so the groups can show while the overall sum is withheld
      return NextResponse.json({ ok: true, rows: rowsNb, can_totals: !!(gTotN && gTotN.ok === true) && restrictedNb === 0, can_group_totals: !!(gTotN && gTotN.ok === true), payroll_restricted: restrictedNb > 0 ? PAYROLL_NOTE : undefined, payroll_note: payrollBillsNote(payZD), api_build_marker: API_BUILD_MARKER }); // ZD — fixed words on the "still owed" total
    }

    var comp = companyByKey(body.company);
    if (!comp) { return fail('Say which company: Nextrade or RTM.'); }
    var WRITES = { set_category: 1, save_category: 1, category_active: 1, save_rule: 1, rule_active: 1, apply_rules: 1, save_mapping: 1, pair_transfer: 1, unpair_transfer: 1, make_missing_bills: 1, set_bill_cutoff: 1 };
    var g = await assertPermission(db, userId, WRITES[action] ? comp.managePerm : comp.viewPerm, req);
    if ((!g || g.ok !== true) && !WRITES[action]) { g = await assertPermission(db, userId, comp.managePerm, req); }
    if (!g || g.ok !== true) { return fail('This needs the "' + comp.label + (WRITES[action] ? ': Manage' : ': View') + '" permission — ask the super admin to grant it in Settings.', 403); }
    var cid = comp.id;
    // v55.83-XN (Max, 21 Nov: "JUST ONE BUTTON TO IGNORE ALL OF THEM FROM CREATING KTC BILLS PRIOR TO JUNE 1 2026") — the button.
    // bill_cutoff: is it on, and how many KTC bills from earlier Nextrade lines it would stop (count; the total only with the totals
    // permission). set_bill_cutoff: ON / OFF, super admin only, one database function (sql/v55-83-XN-nextrade-june-cutoff.sql).
    if (action === 'bill_cutoff' || action === 'set_bill_cutoff') {
      if (comp.key !== 'nextrade') { return fail('Only Nextrade lines make KTC bills.'); }
      var isSuperCB = !!(g.ctx && g.ctx.isSuperAdmin === true);
      if (action === 'set_bill_cutoff') {
        if (!isSuperCB) { return fail('Only the super admin can turn this on or off.', 403); }
        if (body.on !== true && body.on !== false) { return fail('Say ON or OFF.'); }
        var rc = await db.rpc('hub_company_bill_cutoff', { p: { actor: userId, company_id: cid, on: body.on, cutoff_date: NEXTRADE_BILL_CUTOFF } });
        if (rc.error) {
          var mc = String(rc.error.message || '');
          if (/HUB_GUARD:/.test(mc)) { return fail(mc.replace(/^[\s\S]*HUB_GUARD:\s*/, '') + ' Nothing was changed.'); }
          if (/hub_company_bill_cutoff|company_ktc_bill_cutoff|cutoff_voided|does not exist|schema cache/i.test(mc)) { return fail(SQL_MISSING_XN, 409); }
          return fail('Not saved (' + mc + '). Nothing was changed.', 500);
        }
        var dc = rc.data || {};
        await audit(db, userId, body.on ? 'nextrade_bill_cutoff_pressed_on' : 'nextrade_bill_cutoff_pressed_off', 'company', cid, { count: Number(dc.count) || 0, kept: (dc.kept || []).length });
        return NextResponse.json({ ok: true, on: dc.on === true, count: Number(dc.count) || 0, kept: dc.kept || [], api_build_marker: API_BUILD_MARKER });
      }
      var co = await loadBillCutoff(db); if (co.error) { return readFail('the cut-off', co.error); }
      var lkC = await db.from('company_bill_links').select('source_bank_transaction_id, bill_id').eq('company_id', cid).eq('status', 'active').eq('mode', 'created').limit(10000);
      if (lkC.error) { return readFail('the Nextrade bills', lkC.error); }
      var lidC = (lkC.data || []).map(function (l) { return l.source_bank_transaction_id; }); var before = {};
      for (var ci = 0; ci < lidC.length; ci += 200) {
        var lqC = await db.from('bank_transactions').select('id, date').in('id', lidC.slice(ci, ci + 200)).lt('date', NEXTRADE_BILL_CUTOFF);
        if (lqC.error) { return readFail('the Nextrade lines', lqC.error); }
        (lqC.data || []).forEach(function (l) { before[l.id] = true; });
      }
      var billsC = (lkC.data || []).filter(function (l) { return before[l.source_bank_transaction_id]; }).map(function (l) { return l.bill_id; }); var totC = 0;
      for (var bj = 0; bj < billsC.length; bj += 200) {
        var bqC = await db.from('vendor_bills').select('id, total_amount, record_status').in('id', billsC.slice(bj, bj + 200));
        if (bqC.error) { return readFail('the KTC bills', bqC.error); }
        (bqC.data || []).forEach(function (b) { if (b.record_status === 'active') { totC += Number(b.total_amount) || 0; } });
      }
      var stoppedC = null;
      if (co.installed) { var vcC = await db.from('company_bill_links').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', 'void').eq('cutoff_voided', true); stoppedC = vcC.error ? null : (vcC.count || 0); }
      var gTotC = await assertPermission(db, userId, 'accounting.view_totals', req);
      return NextResponse.json({ ok: true, installed: co.installed === true, on: co.on === true, cutoff_date: co.date || NEXTRADE_BILL_CUTOFF, set_at: co.set_at || null,
        would_stop: billsC.length, would_stop_total: gTotC && gTotC.ok === true ? Math.round(totC * 100) / 100 : null, stopped: stoppedC, can_set: isSuperCB, api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'accounts') {
      var ac = await db.from('plaid_accounts').select('plaid_account_id, name, official_name, mask, type, subtype, connection_id, current_balance, updated_at').eq('wave_business_id', cid);
      if (ac.error) { return readFail('the accounts', ac.error); }
      ac.data = dropPrivate(ac.data || [], scope, 'plaid_account_id');
      var connIds = (ac.data || []).map(function (a) { return a.connection_id; }).filter(Boolean);
      var conns = {};
      if (connIds.length) {
        var cq = await db.from('bank_connections').select('id, institution_name, status, plaid_item_id, last_synced, last_sync_status').in('id', Array.from(new Set(connIds)));
        if (cq.error) { return readFail('the connections', cq.error); }
        (cq.data || []).forEach(function (c) { conns[c.id] = c; });
      }
      // v55.83-TW (Codex P1-1) — account balances are a sensitive number: only with 'Bank: View Account Balances'
      var gBal = await assertPermission(db, userId, 'bank_balances.view', req);
      if (!gBal || gBal.ok !== true) { ac.data = ac.data.map(function (a) { var o = Object.assign({}, a); delete o.current_balance; return o; }); }
      return NextResponse.json({ ok: true, accounts: (ac.data || []).map(function (a) {
        var c = conns[a.connection_id] || {};
        var isStatement = c.status === 'manual' || /^manual-/.test(String(c.plaid_item_id || ''));
        var feedType = isStatement ? 'statement' : c.plaid_item_id ? 'plaid' : null;
        return Object.assign({}, a, { institution: c.institution_name || null, connection_status: c.status || null, is_card: a.type === 'credit',
          feed_type: feedType, last_synced: feedType === 'plaid' ? c.last_synced || null : null, last_sync_status: feedType === 'plaid' ? c.last_sync_status || null : null });
      }) });
    }

    if (action === 'categories') {
      var cr = await loadCats(db, cid);
      if (cr.error) { return missingRel(cr.error) ? NextResponse.json({ ok: true, categories: [], kinds: COMPANY_KINDS, sql_missing: SQL_MISSING }) : readFail('the categories', cr.error); }
      return NextResponse.json({ ok: true, categories: cr.data || [], kinds: COMPANY_KINDS });
    }

    if (action === 'save_category') {
      var p = body.category || {};
      var label = String(p.label || '').trim().substring(0, 80);
      if (label.length < 2) { return fail('Type the category name.'); }
      var kind = String(p.kind || 'expense');
      if (!COMPANY_KINDS[kind]) { return fail('Pick what kind of category it is.'); }
      var row = { label: label, kind: kind, is_payroll: p.is_payroll === true && kind === 'expense', sort: Math.max(0, Math.min(999, Number(p.sort) || 100)), updated_by: userId, updated_at: new Date().toISOString() };
      // v55.83-UB (Max: 'add categories on the fly and give it a direction') — money in, money out, or both
      var dirC = String(p.direction || 'any'); if (dirC !== 'in' && dirC !== 'out') { dirC = 'any'; } row.direction = dirC;
      // v55.83-UD — Nextrade only: "KTC pays this (make a KTC bill)": true / false, or null = the usual rule (expenses yes, payroll no)
      if (comp.key === 'nextrade' && Object.prototype.hasOwnProperty.call(p, 'makes_ktc_bill')) { row.makes_ktc_bill = p.makes_ktc_bill === true ? true : p.makes_ktc_bill === false ? false : null; }
      if (p.id) {
        var cu = await db.from('company_categories').select('id, key, kind, is_payroll, label').eq('id', p.id).eq('company_id', cid).maybeSingle();
        if (cu.error) { return readFail('the category', cu.error); }
        if (!cu.data) { return fail('Category not found in ' + comp.label + '.', 404); }
        // v55.83-XE (Codex 11:24) — taking the payroll mark off a category would make every salary line in it visible: the super
        // admin's own action only (audited below with from / to), never a side effect of renaming or changing the kind
        if (cu.data.is_payroll === true && row.is_payroll !== true && !pay.isSuperAdmin) { return fail('Only the super admin can take the payroll mark off a category (it would show the salaries in it). Nothing was changed.', 403); }
        var u = await db.from('company_categories').update(row).eq('id', p.id).eq('company_id', cid).select('id');
        if (u.error && /makes_ktc_bill/.test(String(u.error.message || ''))) { return fail(SQL_MISSING_UD, 409); }
        if (u.error && /direction/.test(String(u.error.message || ''))) { return fail(SQL_MISSING_UB, 409); }
        if (u.error) { return fail('Not saved (' + u.error.message + ').', 500); }
        await audit(db, userId, 'company_category_edited', 'company_category', p.id, { company: comp.label, from: { label: cu.data.label, kind: cu.data.kind, is_payroll: cu.data.is_payroll }, to: { label: row.label, kind: row.kind, is_payroll: row.is_payroll, makes_ktc_bill: row.makes_ktc_bill } });
        // lines already in this category keep it; their KTC bills follow the new kind the next time each is categorized
        return NextResponse.json({ ok: true, id: p.id, note: (cu.data.kind !== row.kind || cu.data.is_payroll !== row.is_payroll || row.makes_ktc_bill !== undefined) && comp.key === 'nextrade' ? 'Lines already in this category keep their KTC bills as they are — use "Make the missing KTC bills" (Nextrade → Transactions) or re-pick the category on a line.' : undefined });
      }
      var key = categoryKey(label);
      if (!key) { return fail('Use letters or numbers in the name.'); }
      row.key = key; row.company_id = cid; row.created_by = userId; row.active = true;
      var ci = await db.from('company_categories').insert(row).select('id').maybeSingle();
      if (ci.error && /makes_ktc_bill/.test(String(ci.error.message || ''))) { return fail(SQL_MISSING_UD, 409); }
      if (ci.error && /direction/.test(String(ci.error.message || ''))) { return fail(SQL_MISSING_UB, 409); }
      if (ci.error) { return fail(ci.error.code === '23505' ? comp.label + ' already has a category called that.' : missingRel(ci.error) ? SQL_MISSING : 'Not saved (' + ci.error.message + ').', ci.error.code === '23505' ? 409 : 500); }
      await audit(db, userId, 'company_category_created', 'company_category', ci.data.id, { company: comp.label, key: key, label: label, kind: kind, is_payroll: row.is_payroll });
      return NextResponse.json({ ok: true, id: ci.data.id, key: key });
    }

    if (action === 'category_active') {
      var ca = await db.from('company_categories').update({ active: body.active === true, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', body.id).eq('company_id', cid).select('id');
      if (ca.error) { return fail('Not saved (' + ca.error.message + ').', 500); }
      if (!ca.data || !ca.data.length) { return fail('Category not found in ' + comp.label + '.', 404); }
      await audit(db, userId, body.active === true ? 'company_category_on' : 'company_category_off', 'company_category', body.id, { company: comp.label });
      return NextResponse.json({ ok: true });
    }

    if (action === 'rules') {
      var rr = await db.from('company_rules').select('id, match_text, category_key, direction, active, hit_count, updated_at').eq('company_id', cid).order('updated_at', { ascending: false }).limit(2000);
      if (rr.error) { return missingRel(rr.error) ? NextResponse.json({ ok: true, rules: [], sql_missing: SQL_MISSING }) : readFail('the rules', rr.error); }
      return NextResponse.json({ ok: true, rules: rr.data || [] });
    }

    if (action === 'save_rule' || action === 'rule_active') {
      if (action === 'rule_active') {
        var ra = await db.from('company_rules').update({ active: body.active === true, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', body.id).eq('company_id', cid).select('id');
        if (ra.error) { return fail('Not saved (' + ra.error.message + ').', 500); }
        if (!ra.data || !ra.data.length) { return fail('Rule not found in ' + comp.label + '.', 404); }
        await audit(db, userId, body.active === true ? 'company_rule_on' : 'company_rule_off', 'company_rule', body.id, { company: comp.label });
        return NextResponse.json({ ok: true });
      }
      var rp = body.rule || {};
      if (rp.lineId) {
        var seed = await db.from('bank_transactions').select('account_id, company_category, pending, transfer_group_id, review_status').eq('wave_business_id', cid).eq('id', rp.lineId).maybeSingle();
        if (seed.error) { return readFail('the source transaction', seed.error); }
        if (!seed.data || isPrivateRow(seed.data, scope)) { return fail('Transaction not found.', 404); }
        if (seed.data.company_category || seed.data.pending || seed.data.transfer_group_id || seed.data.review_status === 'duplicate') { return fail('This transaction is no longer waiting to be categorized. Refresh the page and try again.', 409); }
        var seedAccount = await db.from('plaid_accounts').select('is_private').eq('plaid_account_id', seed.data.account_id).maybeSingle();
        if (seedAccount.error && !missingPrivateColumn(seedAccount.error)) { return readFail('the source account', seedAccount.error); }
        if (seedAccount.data && seedAccount.data.is_private) { return fail('Rules are shared across the company. Use the Rules tab to enter a rule without copying a private transaction.', 403); }
      }
      var mt = normMatch(rp.match_text);
      if (mt.length < 3) { return fail('Type at least 3 letters the description contains.'); }
      var dir = rp.direction === 'in' || rp.direction === 'out' ? rp.direction : 'any';
      var catsR = await loadCats(db, cid);
      if (catsR.error) { return readFail('the categories', catsR.error); }
      var okCat = (catsR.data || []).filter(function (c) { return c.key === rp.category_key && c.active; })[0];
      if (!okCat) { return fail('Pick one of ' + comp.label + '’s categories.'); }
      if (dir !== 'any' && okCat.direction && okCat.direction !== 'any' && okCat.direction !== dir) { return fail('The rule’s direction must match its category.'); }
      var rrow = { match_text: mt, category_key: okCat.key, direction: dir, active: true, updated_by: userId, updated_at: new Date().toISOString() };
      if (rp.id) {
        var ru = await db.from('company_rules').update(rrow).eq('id', rp.id).eq('company_id', cid).select('id');
        if (ru.error) { return fail(ru.error.code === '23505' ? 'There is already a rule for that text.' : 'Not saved (' + ru.error.message + ').', 409); }
        if (!ru.data || !ru.data.length) { return fail('Rule not found in ' + comp.label + '.', 404); }
        await audit(db, userId, 'company_rule_edited', 'company_rule', rp.id, { company: comp.label, match_text: mt, category: okCat.key, direction: dir });
        return NextResponse.json({ ok: true, id: rp.id });
      }
      rrow.company_id = cid; rrow.created_by = userId;
      var rins = await db.from('company_rules').insert(rrow).select('id').maybeSingle();
      if (rins.error) { return fail(rins.error.code === '23505' ? 'There is already a rule for that text — edit it instead.' : 'Not saved (' + rins.error.message + ').', 409); }
      await audit(db, userId, 'company_rule_created', 'company_rule', rins.data.id, { company: comp.label, match_text: mt, category: okCat.key, direction: dir });
      return NextResponse.json({ ok: true, id: rins.data.id });
    }

    var from = isDate(body.from) ? body.from : '2026-01-01';
    var to = isDate(body.to) ? body.to : new Date().toISOString().substring(0, 10);

    if (action === 'totals') { // v55.83-TW (Codex P1-1) — month totals (money in / out / transfers) need the sensitive 'Bank & Financial Summary'
      var gTot = await assertPermission(db, userId, 'accounting.view_totals', req);
      if (!gTot || gTot.ok !== true) { return fail('Totals need the "P2 · Bank & Financial Summary" permission — ask the super admin.', 403); }
    }
    if (action === 'lines' || action === 'totals') {
      var catsL = await loadCats(db, cid);
      if (catsL.error) { return missingRel(catsL.error) ? NextResponse.json({ ok: true, lines: [], categories: [], sql_missing: SQL_MISSING }) : readFail('the categories', catsL.error); }
      var pl = await pageLines(db, cid, from, to);
      if (pl.error) { return readFail('the bank lines', pl.error); }
      pl.data = dropPrivate(pl.data, scope);
      var byKey = {}; (catsL.data || []).forEach(function (c) { byKey[c.key] = c; });
      // payroll shows as "Warehouse staff" — no names (Max)
      var linesOut = (pl.data || []).map(function (l) { var c = byKey[l.company_category]; return (c && c.is_payroll) ? Object.assign({}, l, { name: 'Warehouse staff', merchant_name: null }) : l; });
      // v55.83-XE — without 'payroll.view' a payroll line keeps its date, account and category, but not its amount
      var payK = payrollKeys(catsL.data || []); var hiddenPay = 0;
      if (!pay.canSee) { linesOut = linesOut.map(function (l) { if (payK[l.company_category]) { hiddenPay++; return maskPayrollLine(l); } return l; }); }
      if (action === 'totals') {
        if (pay.canSee || !hiddenPay) { return NextResponse.json({ ok: true, totals: companyTotals(linesOut, catsL.data || []), from: from, to: to, capped: !!pl.capped }); }
        // XE (Codex 11:24: an exact total a payroll amount can be subtracted out of is not shown) — totals WITHOUT payroll, labelled
        // as such; the payroll row itself is listed with no amounts. Never presented as the company's full money out.
        var totNp = companyTotals(linesOut.filter(function (l) { return !l.payroll_restricted; }), catsL.data || []);
        (catsL.data || []).forEach(function (c) { if (payK[c.key] && linesOut.some(function (l) { return l.company_category === c.key; })) { totNp.rows.push({ key: c.key, label: c.label, kind: c.kind, byMonth: {}, total: null, payroll_restricted: true }); } });
        totNp.excludes_payroll = true;
        return NextResponse.json({ ok: true, totals: totNp, from: from, to: to, capped: !!pl.capped, payroll_restricted: PAYROLL_NOTE });
      }
      var links = {}; var ktcMapL = null; var ktcCatsL = null;
      if (comp.key === 'nextrade' && linesOut.length) {
        var lnk = await db.from('company_bill_links').select('source_bank_transaction_id, bill_id, mode, status').eq('company_id', cid).eq('status', 'active').limit(20000);
        if (!lnk.error) { (lnk.data || []).forEach(function (x) { links[x.source_bank_transaction_id] = x; }); }
      }
      if (comp.key === 'nextrade') { // v55.83-VK — the KTC category per Nextrade category, shown and set right on the line
        var mpL = await db.from('company_category_map').select('category_key, ktc_category').eq('company_id', cid);
        var kcL = await db.from('expense_categories').select('key, label, active, kind').eq('active', true).order('sort');
        if (!mpL.error && !kcL.error) { ktcMapL = {}; (mpL.data || []).forEach(function (m) { ktcMapL[m.category_key] = m.ktc_category; }); ktcCatsL = (kcL.data || []).map(function (k) { return { key: k.key, label: k.label }; }); }
      }
      var acR = await db.from('plaid_accounts').select('plaid_account_id, name, mask, type').eq('wave_business_id', cid);
      var accts = {}; ((acR && acR.data) || []).forEach(function (a) { accts[a.plaid_account_id] = a; });
      // v55.83-UB — the other leg of each paired transfer (it may be outside the dates shown)
      var gids = []; linesOut.forEach(function (l) { if (l.transfer_group_id && gids.indexOf(l.transfer_group_id) < 0) { gids.push(l.transfer_group_id); } });
      var legs = {};
      for (var gi = 0; gi < gids.length; gi += 200) {
        var lq = await db.from('bank_transactions').select('id, date, account_id, transfer_group_id, direction').in('transfer_group_id', gids.slice(gi, gi + 200));
        if (lq.error) { return readFail('the transfer pairs', lq.error); }
        (lq.data || []).forEach(function (x) { (legs[x.transfer_group_id] = legs[x.transfer_group_id] || []).push(x); });
      }
      function otherLeg(l) { if (!l.transfer_group_id) { return null; } var o = (legs[l.transfer_group_id] || []).filter(function (x) { return x.id !== l.id; })[0]; if (!o) { return null; } if (isPrivateRow(o, scope)) { return { private: true }; } var oa = accts[o.account_id] || {}; return { id: o.id, date: o.date, account_label: (oa.name || 'account') + (oa.mask ? ' ••' + oa.mask : '') }; } // (Codex 22:50) a private partner leg: nothing about it is returned
      return NextResponse.json({ ok: true, lines: linesOut.map(function (l) {
        var a = accts[l.account_id] || {};
        var row = Object.assign({}, l, { source: transactionSource(l), account_label: (a.name || 'account') + (a.mask ? ' ••' + a.mask : ''), is_card: a.type === 'credit', ktc_bill: links[l.id] || null, transfer_with: otherLeg(l) });
        delete row.bank_source;
        delete row.plaid_transaction_id;
        return row;
      }), categories: catsL.data || [], capped: !!pl.capped, ktc_map: ktcMapL || undefined, ktc_categories: ktcCatsL || undefined, payroll_restricted: hiddenPay ? PAYROLL_NOTE : undefined });
    }

    // the KTC side needs: the party name and the Nextrade → KTC category mapping
    async function nextradeCtx() {
      var mp = await db.from('company_category_map').select('category_key, ktc_category').eq('company_id', NEXTRADE_COMPANY_ID);
      if (mp.error) { return { error: mp.error }; }
      var map = {}; (mp.data || []).forEach(function (m) { map[m.category_key] = m.ktc_category; });
      return { map: map, party: await partyName(db) };
    }
    async function categorize(line, cat, source, nctx, guarded) {
      var label = null;
      if (comp.key === 'nextrade') {
        var acc = await db.from('plaid_accounts').select('name, mask').eq('plaid_account_id', line.account_id).maybeSingle();
        if (acc.error) { return { id: line.id, ok: false, error: 'Could not read the account (' + acc.error.message + ') — nothing changed.' }; }
        label = acc.data ? (acc.data.name || '') + (acc.data.mask ? ' ••' + acc.data.mask : '') : null;
      }
      var res = await categorizeLine(db, line, cat, { actorId: userId, source: source, ktcCategory: cat && nctx ? nctx.map[cat.key] || null : null, party: nctx ? nctx.party : null, accountLabel: label, guarded: guarded === true, allowPayroll: payZD.isSuper === true });
      if (!res.ok) { return { id: line.id, ok: false, error: res.error }; }
      if (res.skipped === true) { return { id: line.id, ok: true, skipped: true, why: res.why }; }
      return { id: line.id, ok: true, ktc: comp.key === 'nextrade' ? res : undefined };
    }

    // v55.83-UD — earlier Nextrade lines whose category (now) says KTC pays it, but that have no KTC bill yet (e.g. warehouse
    // staff payroll categorized before UD). missing_bills lists them; make_missing_bills runs the SAME categorize step on each
    // (one database function per line — one bill per line ever; nothing else changes). Private lines are left out.
    async function missingBillLines() {
      var cm = await loadCats(db, cid); if (cm.error) { return { error: cm.error }; }
      var billCats = {}; (cm.data || []).forEach(function (c) { if (c.active && wantsBill({ direction: 'out' }, c)) { billCats[c.key] = c; } });
      var keys = Object.keys(billCats); if (!keys.length) { return { lines: [], cats: billCats }; }
      var coM = await loadBillCutoff(db); if (coM.error) { return { error: coM.error }; } // v55.83-XN — a line before the cut-off (ON) is not missing a bill
      var out = [];
      for (var mp = 0; mp < 30; mp++) {
        var mr = await db.from('bank_transactions').select(LINE_COLS).eq('wave_business_id', cid).eq('direction', 'out').in('company_category', keys)
          .or('review_status.is.null,review_status.neq.duplicate').order('date', { ascending: true }).order('id', { ascending: true }).range(mp * 1000, mp * 1000 + 999);
        if (mr.error) { return { error: mr.error }; }
        out = out.concat(mr.data || []); if (!mr.data || mr.data.length < 1000) { break; }
      }
      var have = {};
      for (var mi = 0; mi < out.length; mi += 200) {
        var lkM = await db.from('company_bill_links').select('source_bank_transaction_id, status').in('source_bank_transaction_id', out.slice(mi, mi + 200).map(function (l) { return l.id; })).eq('status', 'active');
        if (lkM.error) { return { error: lkM.error }; }
        (lkM.data || []).forEach(function (x) { have[x.source_bank_transaction_id] = true; });
      }
      return { lines: dropPrivate(out.filter(function (l) { return !have[l.id] && !l.pending && !beforeCutoff(l, coM); }), scope), cats: billCats };
    }
    if (action === 'missing_bills' || action === 'make_missing_bills') {
      if (comp.key !== 'nextrade') { return fail('Only Nextrade lines make KTC bills.'); }
      var mb = await missingBillLines(); if (mb.error) { return readFail('the lines without a KTC bill', mb.error); }
      // v55.83-XE — without 'payroll.view': payroll lines are listed (date, "Warehouse staff") with no amount, and are not billed by
      // this person (the bill and its messages carry the amount) — someone with the switch makes those
      function payLine(l) { return !!(mb.cats[l.company_category] && mb.cats[l.company_category].is_payroll); }
      if (action === 'missing_bills') { return NextResponse.json({ ok: true, count: mb.lines.length, payroll_restricted: !pay.canSee && mb.lines.some(payLine) ? PAYROLL_NOTE : undefined, lines: mb.lines.slice(0, 50).map(function (l) { var hid = !pay.canSee && payLine(l); return { id: l.id, date: l.date, amount: hid ? null : l.amount_abs, payroll_restricted: hid || undefined, category: l.company_category, name: payLine(l) ? 'Warehouse staff' : (l.merchant_name || l.name) }; }) }); }
      var heldPay = 0; if (!pay.canSee) { mb.lines = mb.lines.filter(function (l) { if (payLine(l)) { heldPay++; return false; } return true; }); }
      var instM = await db.rpc('hub_company_books_installed'); if (instM.error || instM.data !== true) { return fail(SQL_MISSING, 409); }
      var nctxM = await nextradeCtx(); if (nctxM.error) { return readFail('the category mapping', nctxM.error); }
      var doM = mb.lines.slice(0, 100); var resM = [];
      for (var mj = 0; mj < doM.length; mj++) { resM.push(await categorize(doM[mj], mb.cats[doM[mj].company_category], 'manual', nctxM)); }
      var badM = resM.filter(function (r) { return !r.ok; });
      await audit(db, userId, 'nextrade_missing_bills_made', 'company', cid, { tried: doM.length, made: doM.length - badM.length, failed: badM.length });
      return NextResponse.json({ ok: badM.length === 0, made: doM.length - badM.length, left: mb.lines.length - doM.length + badM.length + heldPay, payroll_left: heldPay || undefined, note: heldPay ? heldPay + ' payroll line(s) left for the super admin (payroll is shown to the super admin only).' : undefined, error: badM.length ? badM.length + ' line(s) not billed: ' + badM.slice(0, 5).map(function (b) { return b.error; }).join(' · ') : undefined });
    }

    // v55.83-VK — learn a rule from each line a person categorized by hand. Best effort: the category is already saved, so a
    // problem here is reported in the answer (state 'failed') and never undoes or blocks the categorizing.
    async function learnFrom(linesDone, cat) {
      var out = [];
      try {
        if (!linesDone.length || !cat || cat.is_payroll === true) { return out; }
        // a private account's description never goes into a rule (rules are shown to everyone who can open the books)
        var priv = {};
        var pq = await db.from('plaid_accounts').select('plaid_account_id, is_private').eq('is_private', true);
        // (Codex 20:27 P2) fail CLOSED: only the exact "column is not there" answer (TP SQL never run: nothing is private) lets learning go on
        if (pq.error) { if (!missingPrivateColumn(pq.error)) { return [{ state: 'failed', error: 'Could not check private accounts — no rule learned.' }]; } }
        else { (pq.data || []).forEach(function (a) { priv[a.plaid_account_id] = true; }); }
        var rq = await db.from('company_rules').select('id, match_text, category_key, direction, active, hit_count').eq('company_id', cid).limit(5000);
        if (rq.error) { return [{ state: 'failed', error: 'Could not read the rules — no rule learned.' }]; }
        var rulesL = rq.data || []; var seen = {}; var touched = [];
        for (var li = 0; li < linesDone.length && touched.length < 20; li++) {
          var ln = linesDone[li];
          if (priv[ln.account_id]) { continue; }
          var plan = learnPlan(rulesL, ln, cat);
          if (plan.op === 'none') { continue; }
          var sk = plan.text + '|' + plan.direction; if (seen[sk]) { continue; } seen[sk] = true;
          var nowL = new Date().toISOString(); var ruleRow = plan.rule || null; var state = plan.op === 'same' || plan.op === 'covered' ? 'kept' : plan.op === 'update' ? 'updated' : 'created';
          if (plan.op === 'update') {
            var upL = await db.from('company_rules').update({ category_key: cat.key, active: true, updated_by: userId, updated_at: nowL }).eq('id', plan.rule.id).eq('company_id', cid).select('id, match_text, category_key, direction, active, hit_count').maybeSingle();
            if (upL.error || !upL.data) { out.push({ state: 'failed', match_text: plan.text, error: 'The rule was not updated (' + ((upL.error && upL.error.message) || 'not found') + ').' }); continue; }
            rulesL = rulesL.map(function (r) { return r.id === upL.data.id ? upL.data : r; }); ruleRow = upL.data;
            await audit(db, userId, 'company_rule_learned', 'company_rule', ruleRow.id, { company: comp.label, match_text: plan.text, direction: plan.direction, from: plan.was, to: cat.key, how: 'updated from a hand-categorized line' });
          } else if (plan.op === 'create') {
            var inL = await db.from('company_rules').insert({ company_id: cid, match_text: plan.text, category_key: cat.key, direction: plan.direction, active: true, created_by: userId, updated_by: userId, updated_at: nowL }).select('id, match_text, category_key, direction, active, hit_count').maybeSingle();
            if (inL.error || !inL.data) {
              if (inL.error && inL.error.code === '23505') { continue; } // someone made the same rule a moment ago — theirs stands
              out.push({ state: 'failed', match_text: plan.text, error: 'The rule was not saved (' + ((inL.error && inL.error.message) || 'error') + ').' }); continue;
            }
            rulesL.push(inL.data); ruleRow = inL.data;
            await audit(db, userId, 'company_rule_learned', 'company_rule', ruleRow.id, { company: comp.label, match_text: plan.text, direction: plan.direction, to: cat.key, how: 'created from a hand-categorized line' });
          }
          touched.push({ rule: ruleRow, state: state, was: plan.was || null });
        }
        if (!touched.length) { return out; }
        // how many OTHER lines (any date, not categorized yet, visible to this person) each of these rules would now categorize
        var open = [];
        for (var op = 0; op < 10; op++) {
          var oq = await db.from('bank_transactions').select(LINE_COLS).eq('wave_business_id', cid).is('company_category', null).is('transfer_group_id', null).not('pending', 'is', true) // v55.83-XT
            .or('review_status.is.null,review_status.neq.duplicate').order('date', { ascending: false }).order('id', { ascending: true }).range(op * 1000, op * 1000 + 999);
          if (oq.error) { open = null; break; }
          open = open.concat(oq.data || []); if (!oq.data || oq.data.length < 1000) { break; }
        }
        var openVis = open ? dropPrivate(open, scope).filter(function (l) { return !priv[l.account_id] || scope.all; }) : null;
        touched.forEach(function (t) {
          out.push({ state: t.state, rule_id: t.rule.id, match_text: t.rule.match_text, direction: t.rule.direction, category_key: t.rule.category_key, was: t.was,
            matches: openVis ? linesForRule(rulesL, t.rule.id, openVis).length : null });
        });
      } catch (e) { out.push({ state: 'failed', error: 'No rule learned (' + ((e && e.message) || 'error') + ').' }); }
      return out;
    }

    var WRITES_CAT = { set_category: 1, apply_rules: 1 };
    if (WRITES_CAT[action]) { var instC = await db.rpc('hub_company_books_installed'); if (instC.error || instC.data !== true) { return fail(SQL_MISSING, 409); } }
    if (action === 'set_category') {
      var ids = Array.isArray(body.ids) ? body.ids.slice(0, 200) : [];
      if (!ids.length) { return fail('Pick the line(s).'); }
      var catsS = await loadCats(db, cid);
      if (catsS.error) { return readFail('the categories', catsS.error); }
      var catS = null;
      if (body.category_key) {
        catS = (catsS.data || []).filter(function (c) { return c.key === body.category_key; })[0] || null;
        if (!catS || !catS.active) { return fail('Pick one of ' + comp.label + '’s categories.'); }
      }
      var lr = await db.from('bank_transactions').select(LINE_COLS).in('id', ids);
      if (lr.error) { return readFail('the lines', lr.error); }
      var wrong = (lr.data || []).filter(function (l) { return l.wave_business_id !== cid || isPrivateRow(l, scope); });
      if (wrong.length || (lr.data || []).length !== ids.length) { return fail('Some of those lines are not ' + comp.label + ' lines — nothing was changed.', 409); }
      if ((lr.data || []).some(function (l) { return l.pending === true; })) { return fail(PENDING_REFUSAL, 409); } // v55.83-XT
      // v55.83-XE (Codex 11:24) — moving a line OUT of payroll (another category, or back to none) would show its salary to everyone
      // who can open the books: the super admin's own action only. Moving a line INTO payroll (hiding it) is open to everyone.
      var payS = payrollKeys(catsS.data || []);
      if (!pay.isSuperAdmin && (lr.data || []).some(function (l) { return payS[l.company_category] && !(catS && payS[catS.key]); })) { return fail('Only the super admin can move a payroll line out of payroll (it would show the salary). Nothing was changed.', 403); }
      var nctx = null;
      if (comp.key === 'nextrade') { nctx = await nextradeCtx(); if (nctx.error) { return readFail('the category mapping', nctx.error); } }
      var results = [];
      for (var i = 0; i < lr.data.length; i++) { results.push(await categorize(lr.data[i], catS, 'manual', nctx)); }
      // XE — a person without the switch never gets a payroll line's KTC-side messages (a duplicate warning names the amount)
      if (!pay.canSee) { results = results.map(function (r) { var ln1 = lr.data.filter(function (x) { return x.id === r.id; })[0]; if (ln1 && (payS[ln1.company_category] || (catS && payS[catS.key]))) { return r.ok ? { id: r.id, ok: true, skipped: r.skipped, payroll_restricted: true } : { id: r.id, ok: false, error: 'Payroll is handled by the super admin only (a payroll line makes a payroll bill) — nothing was saved.' }; } return r; }); }
      var bad = results.filter(function (r) { return !r.ok; });
      // v55.83-VK (Max 19 Nov: "any categories i enter should be learned … a rule should be created and used and automatically
      // updated") — what the person just did becomes this company's rule. Never from payroll lines (names) or private accounts.
      var learned = [];
      if (catS && body.learn !== false) { learned = await learnFrom(lr.data.filter(function (l) { return results.some(function (r) { return r.ok && r.id === l.id; }); }), catS); }
      return NextResponse.json({ ok: bad.length === 0, results: results, saved: results.length - bad.length, learned: learned, error: bad.length ? bad.length + ' line(s) not changed: ' + bad.map(function (b) { return b.error; }).join(' · ') : undefined });
    }

    if (action === 'apply_rules') {
      var catsA = await loadCats(db, cid); var rulesA = await db.from('company_rules').select('id, match_text, category_key, direction, active, hit_count').eq('company_id', cid).eq('active', true);
      if (catsA.error || rulesA.error) { return readFail('the rules', catsA.error || rulesA.error); }
      var byKeyA = {}; (catsA.data || []).forEach(function (c) { if (c.active) { byKeyA[c.key] = c; } });
      if (!(rulesA.data || []).length) { return NextResponse.json({ ok: true, categorized: 0, bills_made: 0, skipped: 0, would: 0, would_bills: 0, problems: [], more: false }); } // no rules: nothing to do
      // v55.83-VK — all_dates: every line not categorized yet (used right after a rule is learned); rule_ids: only what THOSE rules win
      var onlyRules = Array.isArray(body.rule_ids) && body.rule_ids.length ? body.rule_ids.map(String) : null;
      // (Codex 20:27 P1 / P3) rules never write by themselves: every run is a person's press. preview = count only, NOTHING written.
      var previewA = body.preview === true;
      var coA = comp.key === 'nextrade' ? await loadBillCutoff(db) : null; if (coA && coA.error) { coA = null; } // v55.83-XN — preview counts no bill for a line before the cut-off
      if (body.automatic === true) { return fail('Rules are applied only when a person presses Apply.'); }
      // (Codex 20:58 / 21:03) EVERY rule write goes through the VK database step, which categorizes a line only if it is STILL
      // waiting when the line is locked. Not installed, or the check cannot be read → refused, for the dated button too:
      // there is no unguarded way for a rule to write. Counting (preview) and a person's own categorizing are not affected.
      if (!previewA) { var gq = await db.rpc('hub_company_rule_guard_installed'); if (gq.error || gq.data !== true) { return fail(SQL_MISSING_VK, 409); } }
      var plA = await pageLines(db, cid, body.all_dates === true ? '2000-01-01' : from, body.all_dates === true ? '2999-12-31' : to);
      if (plA.error) { return readFail('the bank lines', plA.error); }
      var nctxA = null;
      if (comp.key === 'nextrade') { nctxA = await nextradeCtx(); if (nctxA.error) { return readFail('the category mapping', nctxA.error); } }
      var done = 0; var problems = []; var hits = {}; var billsMade = 0; var tried = 0; var moreA = false; var skippedA = 0; var would = 0; var wouldBills = 0;
      var todo = dropPrivate(plA.data, scope).filter(function (l) { return !l.company_category && l.pending !== true && !l.transfer_group_id; });
      for (var j = 0; j < todo.length; j++) {
        var ln = todo[j];
        var rules = (rulesA.data || []).filter(function (r) {
          var category = byKeyA[r.category_key];
          return category && (r.direction === 'any' || r.direction === ln.direction) && (!category.direction || category.direction === 'any' || category.direction === ln.direction);
        });
        var rule = bestCompanyRule(rules, String(ln.merchant_name || '') + ' ' + String(ln.name || ''));
        if (!rule || !byKeyA[rule.category_key]) { continue; }
        if (onlyRules && onlyRules.indexOf(String(rule.id)) < 0) { continue; }
        if (previewA) { would++; if (comp.key === 'nextrade' && wantsBill(ln, byKeyA[rule.category_key]) && !beforeCutoff(ln, coA)) { wouldBills++; } continue; }
        if (tried >= 300) { moreA = true; break; } // the rest on the next press
        tried++;
        var res = await categorize(ln, byKeyA[rule.category_key], 'rule', nctxA, true);
        if (res.ok && res.skipped === true) { skippedA++; } // someone categorized it (or it changed) a moment ago — left exactly as it is
        else if (res.ok) { done++; hits[rule.id] = (hits[rule.id] || 0) + 1; if (res.ktc && res.ktc.action && res.ktc.action !== 'none') { billsMade++; } } else { problems.push(res.error); }
      }
      if (previewA) { return NextResponse.json({ ok: true, preview: true, would: would, would_bills: wouldBills }); }
      var hitIds = Object.keys(hits);
      for (var h = 0; h < hitIds.length; h++) {
        var rw = (rulesA.data || []).filter(function (r) { return r.id === hitIds[h]; })[0];
        await db.from('company_rules').update({ hit_count: (Number(rw.hit_count) || 0) + hits[hitIds[h]] }).eq('id', hitIds[h]);
      }
      if (done > 0) { await audit(db, userId, 'company_rules_applied', 'company', cid, { company: comp.label, categorized: done, ktc_bills: billsMade, problems: problems.length, all_dates: body.all_dates === true, only_rules: onlyRules, skipped: skippedA, guarded: true }); }
      return NextResponse.json({ ok: true, categorized: done, bills_made: billsMade, skipped: skippedA, problems: problems.slice(0, 20), problem_count: problems.length, more: moreA });
    }

    if (action === 'mapping' || action === 'save_mapping') {
      if (comp.key !== 'nextrade') { return fail('The KTC category mapping is for Nextrade only.'); }
      if (action === 'save_mapping') {
        var ktc = String(body.ktc_category || '').trim() || null;
        var savedMap = await db.rpc('hub_save_nextrade_ktc_mapping', { p: { category_key: String(body.category_key || ''), ktc_category: ktc, actor: userId,
          allow_private: scope.all === true, allow_payroll: payZD.isSuper === true } });
        if (savedMap.error) {
          if (savedMap.error.code === 'PGRST202') { return fail('Install sql/nextrade-ktc-category-mapping.sql to update KTC mappings and linked bills.', 409); }
          if (savedMap.error.code === 'P0001') { return fail(String(savedMap.error.message).replace(/^HUB_GUARD:\s*/, ''), 409); }
          return fail('Could not save the KTC mapping. No changes were applied.', 500);
        }
        return NextResponse.json(savedMap.data);
      }
      var catsK = await loadCats(db, cid);
      var mpK = await db.from('company_category_map').select('category_key, ktc_category').eq('company_id', cid);
      var ktcCats = await db.from('expense_categories').select('key, label, active, kind').eq('active', true).order('sort');
      if (catsK.error || mpK.error || ktcCats.error) { var eK = catsK.error || mpK.error || ktcCats.error; return missingRel(eK) ? NextResponse.json({ ok: true, rows: [], sql_missing: SQL_MISSING }) : readFail('the mapping', eK); }
      var mK = {}; (mpK.data || []).forEach(function (m) { mK[m.category_key] = m.ktc_category; });
      return NextResponse.json({ ok: true, rows: (catsK.data || []).map(function (c) { return Object.assign({}, c, { ktc_category: mK[c.key] || null }); }), ktc_categories: ktcCats.data || [] });
    }

    // ── v55.83-UB — TRANSFERS between the company's own accounts, paired like QuickBooks (same rules as KTC's ↔) ──
    if (action === 'transfer_candidates') {
      var t0r = await db.from('bank_transactions').select(LINE_COLS).eq('id', body.line_id || '').maybeSingle();
      if (t0r.error) { return readFail('the line', t0r.error); }
      var t0 = t0r.data;
      if (!t0 || t0.wave_business_id !== cid || isPrivateRow(t0, scope)) { return fail('That line is not one of ' + comp.label + '\u2019s lines.', 404); }
      if (t0.transfer_group_id) { return fail('This line is already paired — unpair it first.', 409); }
      if (t0.pending === true) { return fail(PENDING_REFUSAL, 409); } // v55.83-XT
      // v55.83-XE — a payroll line is never offered for pairing (pairing takes it out of payroll), and a person without the switch
      // never sees a payroll line among the candidates (the search runs on amounts)
      var catsTc = await loadCats(db, cid); if (catsTc.error) { return readFail('the categories', catsTc.error); }
      var payTc = payrollKeys(catsTc.data || []);
      if (payTc[t0.company_category]) { return fail('A payroll line cannot be paired as a transfer.', 409); }
      var manualT = body.manual === true; var spanT = manualT ? 90 : 10;
      var dT = t0.posted_date || t0.date;
      var loT = new Date(Date.parse(dT) - spanT * 86400000).toISOString().substring(0, 10); var hiT = new Date(Date.parse(dT) + spanT * 86400000).toISOString().substring(0, 10);
      var cq = db.from('bank_transactions').select(LINE_COLS).eq('wave_business_id', cid).eq('direction', t0.direction === 'out' ? 'in' : 'out')
        .gte('date', loT).lte('date', hiT).neq('pending', true).is('transfer_group_id', null).or('review_status.is.null,review_status.neq.duplicate').neq('account_id', t0.account_id || '');
      if (!manualT) { cq = cq.gte('amount_abs', (Number(t0.amount_abs) || 0) - 0.005).lte('amount_abs', (Number(t0.amount_abs) || 0) + 0.005); }
      var cr = await cq.order('date', { ascending: false }).limit(manualT ? 400 : 20);
      if (cr.error) { return readFail('the other accounts\u2019 lines', cr.error); }
      var realT = realAccounts(await loadBankAccounts(db));
      var candT = dropPrivate(cr.data || [], scope).filter(function (c0) { return realKeyOf(c0.account_id, realT) !== realKeyOf(t0.account_id, realT) && !payTc[c0.company_category]; });
      if (manualT) {
        var qT = String(body.q || '').trim().toLowerCase();
        if (qT) { candT = candT.filter(function (c) { return (String(c.merchant_name || '') + ' ' + String(c.name || '') + ' ' + Number(c.amount_abs).toFixed(2) + ' ' + String(c.date)).toLowerCase().indexOf(qT) >= 0; }); }
        var amtT = Number(t0.amount_abs) || 0; candT.sort(function (a1, b1) { return Math.abs(Number(a1.amount_abs) - amtT) - Math.abs(Number(b1.amount_abs) - amtT); }); candT = candT.slice(0, 40);
      }
      var acT = await db.from('plaid_accounts').select('plaid_account_id, name, mask, type').eq('wave_business_id', cid);
      var accT = {}; ((acT && acT.data) || []).forEach(function (a) { accT[a.plaid_account_id] = a; });
      return NextResponse.json({ ok: true, manual: manualT, line: t0, candidates: candT.map(function (c) { var a = accT[c.account_id] || {}; return Object.assign({}, c, { account_label: (a.name || 'account') + (a.mask ? ' ••' + a.mask : ''), is_card: a.type === 'credit', same_amount: Math.abs(Number(c.amount_abs) - Number(t0.amount_abs)) <= 0.005 }); }) });
    }
    if (action === 'pair_transfer' || action === 'unpair_transfer') {
      var instT = await db.rpc('hub_company_transfers_installed');
      if (instT.error || instT.data !== true) { return fail(SQL_MISSING_UB, 409); }
      var rpcT;
      if (action === 'pair_transfer') {
        var ab = await db.from('bank_transactions').select('id, account_id, wave_business_id, company_category').in('id', [body.a || '', body.b || '']);
        if (ab.error) { return readFail('the two lines', ab.error); }
        var catsPt = await loadCats(db, cid); if (catsPt.error) { return readFail('the categories', catsPt.error); }
        var payPt = payrollKeys(catsPt.data || []); // v55.83-XE — pairing takes a line out of payroll: never
        if ((ab.data || []).some(function (x) { return payPt[x.company_category]; })) { return fail('A payroll line cannot be paired as a transfer. Nothing was changed.', 409); }
        if ((ab.data || []).length !== 2 || (ab.data || []).some(function (x) { return x.wave_business_id !== cid || isPrivateRow(x, scope); })) { return fail('Both lines must be ' + comp.label + '\u2019s lines that you can see.', 409); }
        var realP = realAccounts(await loadBankAccounts(db));
        if (realKeyOf(ab.data[0].account_id, realP) === realKeyOf(ab.data[1].account_id, realP)) { return fail('Both lines are in the same bank account (two connections of one account) — that is not a transfer.', 409); }
        rpcT = await db.rpc('hub_company_pair_transfer', { p: { a: body.a, b: body.b, company_id: cid, actor: userId, hidden_accounts: scope.all ? null : Object.keys(scope.hidden || {}), restricted: !scope.all } });
      } else {
        rpcT = await db.rpc('hub_company_unpair_transfer', { p: { transfer_group_id: body.transfer_group_id, company_id: cid, actor: userId, hidden_accounts: scope.all ? null : Object.keys(scope.hidden || {}), restricted: !scope.all } }); // checked per leg inside the locked step
      }
      if (rpcT.error) {
        var mT = String(rpcT.error.message || '');
        if (/HUB_GUARD:/.test(mT)) { return fail(mT.replace(/^[\s\S]*HUB_GUARD:\s*/, '') + ' Nothing was changed.', 409); }
        return fail('Not saved (' + (mT || 'database error') + '). Nothing was changed.', 500);
      }
      return NextResponse.json({ ok: true, result: rpcT.data });
    }

    return fail('Unknown action.');
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'error', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

