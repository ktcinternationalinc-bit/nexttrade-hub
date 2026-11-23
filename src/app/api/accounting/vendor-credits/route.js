// v55.83-YD — Bills → "Vendor credits" (Max, 23 Nov 2026: "make sure we have ... credit memo for bills").
// Actions: list · bills_for (the open bills of the credit's vendor) · create · apply (one or more bills) · unapply · void ·
// refund_candidates · refund. Reading needs Accounting Access + "Bills: view"; changing needs "Bills: manage". The caller comes from
// the verified sign-in only. Every write is ONE database function (sql/v55-83-YD-vendor-credits.sql) that locks, checks and audits:
// never more than the credit has left, never more than a bill still owes (payments, open wires and other credits counted), same
// vendor / company / currency, nothing deleted. Employees see only the permitted history window; payroll vendors stay masked.
// SWC-safe: var + string concatenation.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { assertPermission } from '../../../../lib/server-permissions';
import { US_WAVE_BUSINESS_ID } from '../../../../lib/business-of';
import { windowFloorFor } from '../../../../lib/visibility-window-server';
import { payrollScope, isPayrollVendorName } from '../../../../lib/payroll-visibility';
import { creditLeft, vendorKeyOf } from '../../../../lib/vendor-credits';
import { loadBillCredits, vendorCreditsInstalled } from '../../../../lib/vendor-credits-server';
import { privateScope, isPrivateRow } from '../../../../lib/private-accounts-server';

var API_BUILD_MARKER = 'v55.83-YD-vendor-credits';
var SQL_MISSING = 'Vendor credits are not switched on yet: the database step sql/v55-83-YD-vendor-credits.sql is needed (Max runs it). Nothing was changed.';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function bad(msg, status, extra) { return NextResponse.json(Object.assign({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, extra || {}), { status: status || 400 }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function guardMsg(err) { var m = String((err && err.message) || 'error'); var i = m.indexOf('HUB_GUARD: '); return i >= 0 ? m.substring(i + 11) : 'The database refused this (' + m + '). Nothing was changed.'; }
async function fetchAll(buildQ) {
  var out = []; var from = 0;
  for (var pg = 0; pg < 50; pg++) {
    var r = await buildQ().range(from, from + 999);
    if (r.error) { throw new Error(r.error.message); }
    var rows = r.data || []; out = out.concat(rows);
    if (rows.length < 1000) { break; }
    from += 1000;
  }
  return out;
}

// what each of these bills still owes: total − live payments − open wire lines − credits applied. null when anything cannot be read.
async function owedFor(db, bills) {
  var ids = bills.map(function (b) { return b.id; }); var paid = {}; var wire = {};
  for (var i = 0; i < ids.length; i += 200) {
    var part = ids.slice(i, i + 200);
    var pq = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', part);
    if (pq.error) { return { error: 'The payments could not be read (' + pq.error.message + ').' }; }
    (pq.data || []).forEach(function (p) { if (p.voided !== true) { paid[p.bill_id] = r2((paid[p.bill_id] || 0) + r2(p.amount)); } });
    var wq = await db.from('wire_package_lines').select('bill_id, amount, is_open').in('bill_id', part);
    if (wq.error) { return { error: 'The open wires could not be read (' + wq.error.message + ').' }; }
    (wq.data || []).forEach(function (w) { if (w.is_open === true) { wire[w.bill_id] = r2((wire[w.bill_id] || 0) + r2(w.amount)); } });
  }
  var cr = await loadBillCredits(db, ids);
  if (cr.error) { return { error: cr.error }; }
  var out = {};
  bills.forEach(function (b) { var c = cr.byBill[b.id] || 0; out[b.id] = { paid: paid[b.id] || 0, on_wires: wire[b.id] || 0, credited: c, owed: r2(r2(b.total_amount) - (paid[b.id] || 0) - (wire[b.id] || 0) - c) }; });
  return { byBill: out };
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return bad(who.error, who.status || 401); }
    var userId = who.userId;
    var p1 = await assertPermission(db, userId, 'accounting.view', req);
    if (!p1 || p1.ok !== true) { return bad('This needs "Accounting Access" (P1).', 403); }
    var action = String(body.action || 'list');
    var READS = { list: 1, bills_for: 1, refund_candidates: 1 };
    var WRITES = { create: 1, apply: 1, unapply: 1, void: 1, refund: 1 };
    if (!READS[action] && !WRITES[action]) { return bad('Unknown action.'); }
    var mg = await assertPermission(db, userId, 'bills.manage', req); var canManage = !!(mg && mg.ok === true);
    if (!canManage) {
      var vw = await assertPermission(db, userId, 'bills.view', req);
      if (!vw || vw.ok !== true) { return bad('This needs the "Bills: view" permission.', 403); }
      if (WRITES[action]) { return bad('Recording or applying a vendor credit needs the "Bills: manage" permission.', 403); }
    }
    var tot = await assertPermission(db, userId, 'accounting.view_totals', req); var canTotals = !!(tot && tot.ok === true);
    var fl = await windowFloorFor(db, (p1 && p1.ctx) || null);
    if (fl.error) { return bad(fl.error, 503); }
    var floor = fl.floor;
    var pay = await payrollScope(db, userId, req);
    var installed = await vendorCreditsInstalled(db);
    if (!installed) {
      if (action === 'list') { return NextResponse.json({ ok: true, installed: false, sql_missing: SQL_MISSING, credits: [], can_manage: canManage, api_build_marker: API_BUILD_MARKER }); }
      return bad(SQL_MISSING, 409);
    }
    var hidden = function (vendor) { return !pay.canSee && isPayrollVendorName(vendor); };
    var outside = function (d) { return !!floor && (!d || String(d).substring(0, 10) < floor); };

    if (action === 'list') {
      var credits = await fetchAll(function () { return db.from('vendor_credits').select('*').eq('wave_business_id', US_WAVE_BUSINESS_ID).order('credit_date', { ascending: false }).order('id', { ascending: true }); });
      credits = credits.filter(function (c) { return !hidden(c.vendor_name) && !outside(c.credit_date); });
      var cIds = credits.map(function (c) { return c.id; }); var apps = [];
      for (var i = 0; i < cIds.length; i += 200) {
        var aq = await db.from('vendor_credit_applications').select('*').in('credit_id', cIds.slice(i, i + 200));
        if (aq.error) { return bad('The credit applications could not be read (' + aq.error.message + ') — nothing shown.', 503); }
        apps = apps.concat(aq.data || []);
      }
      var billIds = []; apps.forEach(function (a) { if (a.bill_id && billIds.indexOf(a.bill_id) < 0) { billIds.push(a.bill_id); } });
      var billOf = {};
      for (var k = 0; k < billIds.length; k += 200) {
        var bq = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, currency').in('id', billIds.slice(k, k + 200));
        if (bq.error) { return bad('The bills could not be read (' + bq.error.message + ').', 503); }
        (bq.data || []).forEach(function (b) { billOf[b.id] = b; });
      }
      var rows = credits.map(function (c) {
        var mine = apps.filter(function (a) { return a.credit_id === c.id; });
        var lf = creditLeft(c, mine);
        return { id: c.id, vendor_name: c.vendor_name, credit_number: c.credit_number, credit_date: c.credit_date, currency: c.currency, category: c.category, reason: c.reason,
          attachment_path: c.attachment_path, record_status: c.record_status, void_reason: c.void_reason, total: lf.total, applied: lf.applied, refunded: lf.refunded, left: lf.left,
          uses: mine.map(function (a) { var b = a.bill_id ? billOf[a.bill_id] : null; return { id: a.id, kind: a.kind, amount: r2(a.amount), date: a.applied_date, voided: a.voided === true, void_reason: a.void_reason || null,
            bill_id: a.bill_id || null, bill: b ? ((b.bill_number || '(no number)') + ' · ' + (b.bill_date || '')) : null, bank_transaction_id: a.bank_transaction_id || null, reason: a.reason || null }; }) };
      });
      var sum = null;
      if (canTotals) { sum = { count: rows.length, left: r2(rows.reduce(function (s, x) { return s + (x.record_status === 'active' ? x.left : 0); }, 0)) }; }
      return NextResponse.json({ ok: true, installed: true, credits: rows, totals: sum, can_manage: canManage, window_from: floor || null, api_build_marker: API_BUILD_MARKER });
    }

    // the credit a write / bills_for / refund_candidates is about
    var credit = null;
    if (action !== 'create' && action !== 'unapply') {
      var cq = await db.from('vendor_credits').select('*').eq('id', body.credit_id || '').maybeSingle();
      if (cq.error) { return bad('The credit memo could not be read (' + cq.error.message + ').', 503); }
      credit = cq.data;
      if (!credit || credit.wave_business_id !== US_WAVE_BUSINESS_ID || hidden(credit.vendor_name) || outside(credit.credit_date)) { return bad('Credit memo not found.', 404); }
    }

    if (action === 'bills_for') {
      var vk = vendorKeyOf(credit.vendor_name);
      var bills = (await fetchAll(function () { return db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, due_date, currency, total_amount, record_status, disputed').eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('record_status', 'active').order('id', { ascending: true }); }))
        .filter(function (b) { return vendorKeyOf(b.vendor_name) === vk && String(b.currency || 'USD').toUpperCase() === credit.currency && b.disputed !== true && !outside(b.bill_date); });
      var ow = await owedFor(db, bills);
      if (ow.error) { return bad(ow.error + ' Nothing shown.', 503); }
      var list = bills.map(function (b) { var o = ow.byBill[b.id]; return { id: b.id, bill_number: b.bill_number, bill_date: b.bill_date, due_date: b.due_date, total: r2(b.total_amount), paid: o.paid, on_wires: o.on_wires, credited: o.credited, owed: o.owed }; })
        .filter(function (b) { return b.owed > 0.004; });
      return NextResponse.json({ ok: true, bills: list, api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'refund_candidates') {
      var since = String(credit.credit_date || '').substring(0, 10);
      var lq = await db.from('bank_transactions').select('id, date, posted_date, amount_abs, name, merchant_name, account_id, transfer_group_id, matched_invoice_id, iso_currency')
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'in').neq('pending', true).neq('review_status', 'duplicate').is('matched_invoice_id', null).gte('date', since).order('date', { ascending: false }).limit(300);
      if (lq.error) { return bad('The money-in lines could not be read (' + lq.error.message + ').', 503); }
      var scopeR = await privateScope(db, userId);
      var cand = (lq.data || []).filter(function (x) { return !x.transfer_group_id && String(x.iso_currency || 'USD').toUpperCase() === credit.currency && !isPrivateRow(x, scopeR) && (scopeR.all || !!x.account_id); });
      var cand2 = []; var taken = {};
      for (var c2 = 0; c2 < cand.length; c2 += 200) {
        var part = cand.slice(c2, c2 + 200).map(function (x) { return x.id; });
        var ap = await db.from('vendor_credit_applications').select('bank_transaction_id, voided').in('bank_transaction_id', part);
        if (ap.error) { return bad('The refunds already recorded could not be read (' + ap.error.message + ').', 503); }
        (ap.data || []).forEach(function (x) { if (x.voided !== true) { taken[x.bank_transaction_id] = true; } });
        var ip = await db.from('accounting_invoice_payments').select('bank_transaction_id, voided').in('bank_transaction_id', part);
        if (ip.error) { return bad('The customer payments could not be read (' + ip.error.message + ').', 503); }
        (ip.data || []).forEach(function (x) { if (x.voided !== true) { taken[x.bank_transaction_id] = true; } });
        var pm = await db.from('party_money_entries').select('bank_transaction_id, kind').eq('kind', 'refund').in('bank_transaction_id', part);
        if (pm.error && !/does not exist|schema cache/i.test(String(pm.error.message || ''))) { return bad('The RTM / NextTrade money back could not be read (' + pm.error.message + ').', 503); }
        ((pm && pm.data) || []).forEach(function (x) { taken[x.bank_transaction_id] = true; });
      }
      var used = await db.from('vendor_credit_applications').select('amount, kind, voided, credit_id').eq('credit_id', credit.id);
      if (used.error) { return bad('The credit could not be read (' + used.error.message + ').', 503); }
      var leftNow = creditLeft(credit, used.data || []).left;
      cand.forEach(function (x) { if (!taken[x.id] && r2(x.amount_abs) <= leftNow + 0.004) { cand2.push({ id: x.id, date: String(x.posted_date || x.date || '').substring(0, 10), who: x.merchant_name || x.name || '', amount: r2(x.amount_abs) }); } });
      return NextResponse.json({ ok: true, credit_left: leftNow, lines: cand2.slice(0, 60), api_build_marker: API_BUILD_MARKER });
    }

    // writes
    var rid = String(body.request_id || '').trim().substring(0, 80);
    if (!rid && (action === 'create' || action === 'apply' || action === 'refund')) { return bad('Missing click id — reload the page and try again.'); } // undo / void are repeat-safe on their own
    if (action === 'create') {
      if (!String(body.vendor_name || '').trim() || !String(body.credit_number || '').trim()) { return bad('Enter the vendor and the credit memo number.'); }
      if (!isDate(body.credit_date)) { return bad('Pick the credit memo date.'); }
      if (outside(body.credit_date)) { return bad('That date is before your history window.', 403); }
      if (hidden(body.vendor_name)) { return bad('Payroll vendors need the "Payroll / salaries: view" switch.', 403); }
      var amt = r2(body.amount); if (!(amt > 0)) { return bad('The amount must be above zero.'); }
      if (String(body.reason || '').trim().length < 3) { return bad('Say what the credit is for, in a few words.'); }
      var cr = await db.rpc('hub_vendor_credit_create', { p: { wave_business_id: US_WAVE_BUSINESS_ID, vendor_name: String(body.vendor_name).trim(), credit_number: String(body.credit_number).trim(), credit_date: body.credit_date,
        currency: String(body.currency || 'USD').toUpperCase(), amount: amt, category: body.category || null, reason: String(body.reason).trim().substring(0, 300), attachment_path: body.attachment_path || null, request_id: rid, actor: userId } });
      if (cr.error) { return bad(guardMsg(cr.error), 409); }
      return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, cr.data));
    }
    if (action === 'apply') {
      var lines = Array.isArray(body.bills) ? body.bills : [];
      if (!lines.length) { return bad('Pick the bills to apply the credit to.'); }
      if (lines.length > 50) { return bad('At most 50 bills at once.'); }
      var date = body.applied_date || null; if (date && !isDate(date)) { return bad('Pick the date.'); }
      if (date && outside(date)) { return bad('That date is before your history window.', 403); }
      var seen = {}; var done = [];
      for (var li = 0; li < lines.length; li++) {
        var ln = lines[li] || {}; var a2 = r2(ln.amount);
        if (!ln.bill_id || seen[ln.bill_id]) { return bad('Each bill once, please.'); } seen[ln.bill_id] = true;
        if (!(a2 > 0)) { return bad('Every amount must be above zero.'); }
        var bq2 = await db.from('vendor_bills').select('id, wave_business_id, vendor_name, bill_date').eq('id', ln.bill_id).maybeSingle();
        if (bq2.error) { return bad('The bill could not be read (' + bq2.error.message + ').', 503); }
        if (!bq2.data || bq2.data.wave_business_id !== US_WAVE_BUSINESS_ID || hidden(bq2.data.vendor_name) || outside(bq2.data.bill_date)) { return bad('Bill not found.', 404); }
        // each bill is its own database step (its own lock and check); a refusal stops here and says which bills were already done
        var ar = await db.rpc('hub_vendor_credit_apply', { p: { credit_id: credit.id, bill_id: ln.bill_id, amount: a2, applied_date: date, reason: body.reason ? String(body.reason).substring(0, 300) : null, request_id: rid + ':' + ln.bill_id, actor: userId } });
        if (ar.error) { return bad(guardMsg(ar.error) + (done.length ? ' (' + done.length + ' bill(s) before it were already credited and stay so.)' : ''), 409, { done: done }); }
        done.push(ar.data);
      }
      return NextResponse.json({ ok: true, action: 'apply', applied: done, api_build_marker: API_BUILD_MARKER });
    }
    if (action === 'unapply') {
      if (String(body.reason || '').trim().length < 3) { return bad('Say why, in a few words.'); }
      var aq2 = await db.from('vendor_credit_applications').select('id, credit_id').eq('id', body.application_id || '').maybeSingle();
      if (aq2.error) { return bad('The credit application could not be read (' + aq2.error.message + ').', 503); }
      if (!aq2.data) { return bad('Not found.', 404); }
      var cq2 = await db.from('vendor_credits').select('id, wave_business_id, vendor_name, credit_date').eq('id', aq2.data.credit_id).maybeSingle();
      if (cq2.error || !cq2.data || cq2.data.wave_business_id !== US_WAVE_BUSINESS_ID || hidden(cq2.data.vendor_name) || outside(cq2.data.credit_date)) { return bad('Not found.', 404); }
      var ur = await db.rpc('hub_vendor_credit_unapply', { p: { application_id: aq2.data.id, reason: String(body.reason).trim().substring(0, 300), actor: userId } });
      if (ur.error) { return bad(guardMsg(ur.error), 409); }
      return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, ur.data));
    }
    if (action === 'void') {
      if (String(body.reason || '').trim().length < 3) { return bad('Say why, in a few words.'); }
      var vr = await db.rpc('hub_vendor_credit_void', { p: { credit_id: credit.id, reason: String(body.reason).trim().substring(0, 300), actor: userId } });
      if (vr.error) { return bad(guardMsg(vr.error), 409); }
      return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, vr.data));
    }
    if (action === 'refund') {
      var lq2 = await db.from('bank_transactions').select('id, wave_business_id, account_id').eq('id', body.bank_transaction_id || '').maybeSingle();
      if (lq2.error) { return bad('The money-in line could not be read (' + lq2.error.message + ').', 503); }
      var scopeW = await privateScope(db, userId);
      if (!lq2.data || lq2.data.wave_business_id !== US_WAVE_BUSINESS_ID || isPrivateRow(lq2.data, scopeW) || (!scopeW.all && !lq2.data.account_id)) { return bad('Money-in line not found.', 404); }
      var rr = await db.rpc('hub_vendor_credit_refund', { p: { credit_id: credit.id, bank_transaction_id: lq2.data.id, reason: body.reason ? String(body.reason).substring(0, 300) : null, request_id: rid, actor: userId } });
      if (rr.error) { return bad(guardMsg(rr.error), 409); }
      return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, rr.data));
    }
    return bad('Unknown action.');
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'error', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
