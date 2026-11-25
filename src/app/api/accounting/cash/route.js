// v55.83-YF — Accounting → 💵 Cash on Hand (Max, 23 Nov 2026: "make sure we have a cash on hand to pay invoices"; reading 1: money that
// actually moves in cash). Actions: summary · open_invoices · open_bills · deposit_lines · receive_invoice · pay_bill · deposit ·
// deposit_pair · adjust · undo. Cash on Hand is a PRIVATE account: seeing it needs Accounting Access + the private-account rule (super
// admin or "Bank: See private accounts"). Recording needs the "Cash on Hand: record" switch (cash.manage, super admin grants it); a cash
// count (adjust) is super admin only. Every write is ONE database function (sql/v55-83-YF-cash-on-hand.sql): locked, never below zero,
// closed-month check, audited, nothing deleted. The caller comes from the verified sign-in only. SWC-safe: var + concatenation.
import { payrollBillScope, payrollFilteredDb, requestNamesPayroll } from '../../../../lib/payroll-bills'; // v55.83-ZD
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { assertPermission, loadUserPermissions } from '../../../../lib/server-permissions';
import { US_WAVE_BUSINESS_ID } from '../../../../lib/business-of';
import { privateScope } from '../../../../lib/private-accounts-server';
import { windowFloorFor } from '../../../../lib/visibility-window-server';
import { todayET } from '../../../../lib/et-time';
import { occupiedLines } from '../../../../lib/bank-line-exclusive'; // v55.83-YF — one bank line, one use

var API_BUILD_MARKER = 'v55.83-YF-cash-on-hand';
var CASH = 'manual-acct-cash-on-hand-us';
var SQL_MISSING = 'Cash on Hand is not switched on yet: the database step sql/v55-83-YF-cash-on-hand.sql is needed (Max runs it). Nothing was changed.';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function bad(msg, status, extra) { return NextResponse.json(Object.assign({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, extra || {}), { status: status || 400 }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function guardMsg(err) { var m = String((err && err.message) || 'error'); var i = m.indexOf('HUB_GUARD: '); return i >= 0 ? m.substring(i + 11) : 'The database refused this (' + m + '). Nothing was changed.'; }

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return bad(who.error, who.status || 401); }
    var userId = who.userId;
    // v55.83-ZD — payroll bills: SUPER ADMIN ONLY. Who is calling + the payroll list, read once (fails closed); for anyone else a request
    // naming a payroll bill / wire package is "not found", and every read below leaves payroll out (so every total excludes it).
    var payZD = await payrollBillScope(db, userId); if (payZD.error) { return Response.json({ ok: false, error: payZD.error }, { status: payZD.status }); }
    if (requestNamesPayroll(payZD, body)) { return Response.json({ ok: false, error: 'Not found.' }, { status: 404 }); }
    db = payrollFilteredDb(db, payZD);
    var p1 = await assertPermission(db, userId, 'accounting.view', req);
    if (!p1 || p1.ok !== true) { return bad('This needs "Accounting Access" (P1).', 403); }
    var action = String(body.action || 'summary');
    var READS = { summary: 1, open_invoices: 1, open_bills: 1, deposit_lines: 1 };
    var WRITES = { receive_invoice: 1, pay_bill: 1, deposit: 1, deposit_pair: 1, adjust: 1, undo: 1 };
    if (!READS[action] && !WRITES[action]) { return bad('Unknown action.'); }
    // Cash on Hand is a private account: the private-account rule decides who sees it at all
    var scope = await privateScope(db, userId);
    if (scope.error) { return bad(scope.error + ' — nothing shown.', 503); }
    if (!scope.all) { return bad('Cash on Hand is a private account: it needs the super admin or the "Bank: See private accounts" switch.', 403); }
    var ctx = await loadUserPermissions(db, userId); var isSuper = !!(ctx && ctx.isSuperAdmin === true);
    var mg = await assertPermission(db, userId, 'cash.manage', req); var canRecord = !!(mg && mg.ok === true);
    if (WRITES[action] && !canRecord) { return bad('Recording cash needs the "Cash on Hand: record" switch (the super admin grants it).', 403); }
    if (action === 'adjust' && !isSuper) { return bad('A cash count change is for the super admin only.', 403); }
    var inst = await db.rpc('hub_cash_installed'); var installed = !inst.error && inst.data === true;
    if (!installed) {
      if (action === 'summary') { return NextResponse.json({ ok: true, installed: false, sql_missing: SQL_MISSING, api_build_marker: API_BUILD_MARKER }); }
      return bad(SQL_MISSING, 409);
    }
    var fl = await windowFloorFor(db, (p1 && p1.ctx) || null);
    if (fl.error) { return bad(fl.error, 503); }
    var floor = fl.floor;

    if (action === 'summary') {
      var bq = await db.rpc('hub_cash_balance', { p_on: null });
      if (bq.error) { return bad('The cash balance could not be read (' + bq.error.message + ').', 503); }
      var eq = db.from('cash_entries').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(500);
      if (floor) { eq = eq.gte('entry_date', floor); }
      var er = await eq;
      if (er.error) { return bad('The cash book could not be read (' + er.error.message + ').', 503); }
      var invIds = []; var billIds = [];
      (er.data || []).forEach(function (e) { if (e.invoice_id && invIds.indexOf(e.invoice_id) < 0) { invIds.push(e.invoice_id); } if (e.bill_id && billIds.indexOf(e.bill_id) < 0) { billIds.push(e.bill_id); } });
      var invOf = {}; var billOf = {};
      if (invIds.length) { var iq = await db.from('accounting_invoices').select('id, invoice_number').in('id', invIds); if (iq.error) { return bad('The invoices could not be read (' + iq.error.message + ').', 503); } (iq.data || []).forEach(function (x) { invOf[x.id] = x.invoice_number || ''; }); }
      if (billIds.length) { var bq2 = await db.from('vendor_bills').select('id, vendor_name, bill_number').in('id', billIds); if (bq2.error) { return bad('The bills could not be read (' + bq2.error.message + ').', 503); } (bq2.data || []).forEach(function (x) { billOf[x.id] = (x.vendor_name || '') + ' ' + (x.bill_number || ''); }); }
      var rows = (er.data || []).map(function (e) {
        return { id: e.id, kind: e.kind, amount: r2(e.amount), date: e.entry_date, person: e.person, reference: e.reference, note: e.note || null, voided: e.voided === true, void_reason: e.void_reason || null,
          invoice: e.invoice_id ? (invOf[e.invoice_id] || '(invoice)') : null, bill: e.bill_id ? (billOf[e.bill_id] || '(bill)') : null, paired: !!e.deposit_bank_transaction_id,
          direction: (e.kind === 'receive_invoice' || e.kind === 'adjust_in') ? 'in' : 'out' };
      });
      return NextResponse.json({ ok: true, installed: true, balance: r2(bq.data), entries: rows, can_record: canRecord, can_adjust: isSuper, window_from: floor || null, today: todayET(), api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'open_invoices') {
      var q = String(body.q || '').trim().toLowerCase();
      var oi = await db.from('accounting_invoices').select('id, invoice_number, invoice_date, total_amount, balance_due, payment_status, accounting_customer_id, currency, record_status')
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).neq('payment_status', 'paid').order('invoice_date', { ascending: false }).limit(1000);
      if (oi.error) { return bad('The invoices could not be read (' + oi.error.message + ').', 503); }
      var custIds = []; (oi.data || []).forEach(function (x) { if (x.accounting_customer_id && custIds.indexOf(x.accounting_customer_id) < 0) { custIds.push(x.accounting_customer_id); } });
      var custOf = {};
      for (var ci = 0; ci < custIds.length; ci += 200) { var cq = await db.from('accounting_customers').select('id, company_name').in('id', custIds.slice(ci, ci + 200)); if (!cq.error) { (cq.data || []).forEach(function (c) { custOf[c.id] = c.company_name || ''; }); } }
      var list = (oi.data || []).filter(function (x) { return r2(x.balance_due) > 0.004 && (x.record_status || 'active') === 'active' && String(x.currency || 'USD').toUpperCase() === 'USD' && (!floor || !x.invoice_date || x.invoice_date >= floor); })
        .map(function (x) { return { id: x.id, number: x.invoice_number, date: x.invoice_date, customer: custOf[x.accounting_customer_id] || '', total: r2(x.total_amount), due: r2(x.balance_due) }; })
        .filter(function (x) { return !q || (String(x.number || '').toLowerCase().indexOf(q) >= 0 || String(x.customer).toLowerCase().indexOf(q) >= 0); });
      return NextResponse.json({ ok: true, invoices: list.slice(0, 100), api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'open_bills') {
      var q2 = String(body.q || '').trim().toLowerCase();
      var ob = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, currency, record_status, disputed').eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('record_status', 'active').order('bill_date', { ascending: false }).limit(1000);
      if (ob.error) { return bad('The bills could not be read (' + ob.error.message + ').', 503); }
      var bills = (ob.data || []).filter(function (b) { return String(b.currency || 'USD').toUpperCase() === 'USD' && b.disputed !== true && (!floor || !b.bill_date || b.bill_date >= floor) && (!q2 || (String(b.vendor_name || '') + ' ' + String(b.bill_number || '')).toLowerCase().indexOf(q2) >= 0); });
      var ids = bills.map(function (b) { return b.id; }); var paid = {}; var held = {};
      for (var bi = 0; bi < ids.length; bi += 200) {
        var pq = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', ids.slice(bi, bi + 200));
        if (pq.error) { return bad('The payments could not be read (' + pq.error.message + ').', 503); }
        (pq.data || []).forEach(function (p) { if (p.voided !== true) { paid[p.bill_id] = r2((paid[p.bill_id] || 0) + r2(p.amount)); } });
        var wq = await db.from('wire_package_lines').select('bill_id, amount, is_open').in('bill_id', ids.slice(bi, bi + 200));
        if (wq.error && !/does not exist|schema cache/i.test(String(wq.error.message || ''))) { return bad('The open wires could not be read (' + wq.error.message + ').', 503); }
        ((wq && wq.data) || []).forEach(function (w) { if (w.is_open === true) { held[w.bill_id] = r2((held[w.bill_id] || 0) + r2(w.amount)); } });
      }
      var out = bills.map(function (b) { return { id: b.id, vendor: b.vendor_name, number: b.bill_number, date: b.bill_date, total: r2(b.total_amount), owed: r2(r2(b.total_amount) - (paid[b.id] || 0) - (held[b.id] || 0)) }; })
        .filter(function (b) { return b.owed > 0.004; });
      return NextResponse.json({ ok: true, bills: out.slice(0, 100), note: 'Vendor credits applied (if any) and the database caps are checked again when you pay.', api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'deposit_lines') {
      var amt0 = r2(body.amount); if (!(amt0 > 0)) { return bad('Enter the amount deposited.'); }
      var since = isDate(body.since) ? body.since : null;
      var dq = db.from('bank_transactions').select('id, date, posted_date, amount_abs, name, merchant_name, account_id, transfer_group_id, matched_invoice_id, linked_id')
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'in').neq('pending', true).neq('review_status', 'duplicate').neq('account_id', CASH).is('matched_invoice_id', null).is('transfer_group_id', null)
        .order('date', { ascending: false }).limit(500);
      if (since) { dq = dq.gte('date', since); }
      var dr = await dq;
      if (dr.error) { return bad('The bank lines could not be read (' + dr.error.message + ').', 503); }
      var cand = (dr.data || []).filter(function (x) { return !x.linked_id && Math.abs(r2(x.amount_abs) - amt0) < 0.005; }).slice(0, 50); var taken = {}; // the exact amount (checked in code: cents)
      // v55.83-YF (Codex 24 Nov) — only a line with NO other use is offered: parked deposit, split, customer credit, payment, match, money back,
      // vendor refund or another cash deposit (the same list the database checks when pairing)
      var occ = await occupiedLines(db, cand.map(function (x) { return x.id; }));
      if (occ.error) { return bad(occ.error + ' Nothing shown.', 503); }
      taken = occ.taken;
      return NextResponse.json({ ok: true, lines: cand.filter(function (x) { return !taken[x.id]; }).map(function (x) { return { id: x.id, date: String(x.posted_date || x.date || '').substring(0, 10), who: x.merchant_name || x.name || '', amount: r2(x.amount_abs) }; }), api_build_marker: API_BUILD_MARKER });
    }

    // writes
    var rid = String(body.request_id || '').trim().substring(0, 80);
    var common = { entry_date: body.entry_date, person: String(body.person || '').trim().substring(0, 120), reference: String(body.reference || '').trim().substring(0, 120), note: body.note ? String(body.note).substring(0, 300) : null, request_id: rid, actor: userId };
    if (action !== 'undo' && action !== 'deposit_pair') {
      if (!rid) { return bad('Missing click id — reload the page and try again.'); }
      if (!isDate(body.entry_date)) { return bad('Pick the date the cash moved.'); }
      if (floor && body.entry_date < floor) { return bad('That date is before your history window.', 403); }
      if (!(r2(body.amount) > 0)) { return bad('The amount must be above zero.'); }
    }
    var fn = null; var p = null;
    if (action === 'receive_invoice') { fn = 'hub_cash_receive_invoice'; p = Object.assign({ invoice_id: body.invoice_id, amount: r2(body.amount) }, common); }
    else if (action === 'pay_bill') { fn = 'hub_cash_pay_bill'; p = Object.assign({ bill_id: body.bill_id, amount: r2(body.amount) }, common); }
    else if (action === 'deposit') { fn = 'hub_cash_deposit'; p = Object.assign({ amount: r2(body.amount), bank_transaction_id: body.bank_transaction_id || null }, common); }
    else if (action === 'adjust') { fn = 'hub_cash_adjust'; p = Object.assign({ amount: r2(body.amount), direction: body.direction }, common); }
    else if (action === 'deposit_pair') { fn = 'hub_cash_deposit_pair'; p = { entry_id: body.entry_id, bank_transaction_id: body.bank_transaction_id, actor: userId }; }
    else if (action === 'undo') { if (String(body.reason || '').trim().length < 3) { return bad('Say why, in a few words.'); } fn = 'hub_cash_undo'; p = { entry_id: body.entry_id, reason: String(body.reason).trim().substring(0, 300), actor: userId }; }
    // the record a write is about must be KTC USA's and inside the person's history window
    if (action === 'receive_invoice') {
      var iv = await db.from('accounting_invoices').select('id, wave_business_id, invoice_date').eq('id', body.invoice_id || '').maybeSingle();
      if (iv.error) { return bad('The invoice could not be read (' + iv.error.message + ').', 503); }
      if (!iv.data || iv.data.wave_business_id !== US_WAVE_BUSINESS_ID || (floor && iv.data.invoice_date && iv.data.invoice_date < floor)) { return bad('Invoice not found.', 404); }
    }
    if (action === 'pay_bill') {
      var bl = await db.from('vendor_bills').select('id, wave_business_id, bill_date').eq('id', body.bill_id || '').maybeSingle();
      if (bl.error) { return bad('The bill could not be read (' + bl.error.message + ').', 503); }
      if (!bl.data || bl.data.wave_business_id !== US_WAVE_BUSINESS_ID || (floor && bl.data.bill_date && bl.data.bill_date < floor)) { return bad('Bill not found.', 404); }
    }
    if (action === 'undo' || action === 'deposit_pair') {
      var ce2 = await db.from('cash_entries').select('id, entry_date').eq('id', body.entry_id || '').maybeSingle();
      if (ce2.error) { return bad('The cash entry could not be read (' + ce2.error.message + ').', 503); }
      if (!ce2.data || (floor && ce2.data.entry_date < floor)) { return bad('Cash entry not found.', 404); }
    }
    var rr = await db.rpc(fn, { p: p });
    if (rr.error) { return bad(guardMsg(rr.error), 409); }
    return NextResponse.json(Object.assign({ api_build_marker: API_BUILD_MARKER }, rr.data));
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'error', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

