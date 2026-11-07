// v55.83-PB — VENDOR BILLS (AP) + CASH FLOW (Max, Nov 5): "add a vendors bill
// side and create a dashboard... to see how money will move in and out for a
// period of time... compare what funds coming in to pay bills".
//
// RULES:
// • Bills are US-business records (the verified Wave business), USD.
// • A bill is paid by recording a payment, ideally linked to the REAL bank
//   transaction (direction out, settled). Overpaying a bill is rejected.
// • Cash flow = settled bank reality (money that actually moved) alongside
//   open AR due (expected in) vs open bills (due out). Never guessed.
// • Permissions: bills.view to read, bills.manage to write (super admin both).
import { NextResponse } from 'next/server';
import { assertPermission } from '../../../../lib/server-permissions';
import { createClient } from '@supabase/supabase-js';
import { businessOfInvoice, US_WAVE_BUSINESS_ID } from '../../../../lib/business-of';
import { isArEligible } from '../../../../lib/ar-eligibility';
import { isPaymentVoid } from '../../../../lib/payment-matching';
import { billOpenBalance, billStatus, cashflowSummary } from '../../../../lib/cashflow';
import { forecastBuckets, tagRows, BUCKETS } from '../../../../lib/aging';
import { readBillFromBase64 } from '../../../../lib/bill-extract-server';
import { billDupVerdict } from '../../../../lib/bill-dup-server'; // v55.83-QH
import { audit } from '../../../../lib/audit-server'; // v55.83-QI
import { learnRule, suggestCategory } from '../../../../lib/expense-rules-server'; // v55.83-PJ — bills remember vendor categories

var API_BUILD_MARKER = 'v55.83-PB-bills';
var PAGE = 1000; var MAX_ROWS = 20000;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
async function fetchAll(buildQ) {
  var out = []; var from = 0;
  while (out.length < MAX_ROWS) {
    var res = await buildQ().range(from, from + PAGE - 1);
    if (res.error) { throw new Error(res.error.message); }
    var rows = res.data || [];
    for (var i = 0; i < rows.length; i++) { out.push(rows[i]); }
    if (rows.length < PAGE) { break; }
    from += PAGE;
  }
  return out;
}
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

async function loadBills(db) {
  var bills;
  try {
    // v55.83-QB — paid_via: which third party (RTM Capital) pays this bill.
    bills = await fetchAll(function () {
      return db.from('vendor_bills')
        .select('id, vendor_name, bill_number, bill_date, due_date, currency, total_amount, category, notes, record_status, created_at, attachment_path, validation_status, validated_by, validated_at, validation_notes, disputed, dispute_ticket_id, dispute_reason, paid_via')
        .order('due_date', { ascending: true, nullsFirst: false });
    });
  } catch (eQB) {
    try {
      // QB column not migrated yet — everything else still works.
      bills = await fetchAll(function () {
        return db.from('vendor_bills')
          .select('id, vendor_name, bill_number, bill_date, due_date, currency, total_amount, category, notes, record_status, created_at, attachment_path, validation_status, validated_by, validated_at, validation_notes, disputed, dispute_ticket_id, dispute_reason')
          .order('due_date', { ascending: true, nullsFirst: false });
      });
    } catch (ePC2) { bills = null; }
  }
  if (!bills) {
    // v55.83-PC column not migrated yet — the list still works, just without 📎 links.
    bills = await fetchAll(function () {
      return db.from('vendor_bills')
        .select('id, vendor_name, bill_number, bill_date, due_date, currency, total_amount, category, notes, record_status, created_at')
        .order('due_date', { ascending: true, nullsFirst: false });
    });
  }
  var pays = await fetchAll(function () {
    return db.from('vendor_bill_payments')
      .select('id, bill_id, amount, paid_date, bank_transaction_id, method, voided, created_at')
      .order('paid_date', { ascending: false });
  });
  return { bills: bills, pays: pays };
}
function decorate(bills, pays) {
  return bills.map(function (b) {
    var bal = billOpenBalance(b, pays);
    var st = billStatus(b, pays);
    if (b.disputed === true && st !== 'VOID') { st = 'DISPUTED'; }
    return Object.assign({}, b, { paid: bal.paid, open: bal.open, status: st });
  });
}
// Payable = active, open, and NOT disputed (Max: disputed bills are excluded
// from what-we-owe totals until the dispute resolves).
// v55.83-QB: via-RTM bills are paid by the third party, never from our bank —
// they stay OUT of what-we-owe totals, cash forecasts and shortage math.
function isPayable(b) { return b.record_status === 'active' && b.disputed !== true && !b.paid_via && b.open > 0.005; }

// Canonical open AR per invoice (same formula as the dashboard/Open Balances),
// US business only, live + AR-eligible.
async function loadOpenUsInvoices(db) {
  var invs = await fetchAll(function () {
    return db.from('accounting_invoices')
      .select('id, invoice_number, release_number, invoice_date, due_date, currency, total_amount, wave_imported_paid, record_status, approval_status, wave_status, wave_invoice_id, wave_business_id, source, accounting_customer_id')
      .order('created_at', { ascending: false });
  });
  var pays = await fetchAll(function () {
    return db.from('accounting_invoice_payments')
      .select('id, accounting_invoice_id, amount, voided, sync_status');
  });
  var custs = await fetchAll(function () {
    return db.from('accounting_customers').select('id, company_name, contact_name, business_tag');
  });
  var tagById = {}; custs.forEach(function (c) { tagById[c.id] = c.business_tag || null; });
  var nameById = {}; custs.forEach(function (c) { nameById[c.id] = c.company_name || c.contact_name || ''; });
  var paidBy = {};
  pays.forEach(function (p) {
    if (isPaymentVoid(p)) { return; }
    paidBy[p.accounting_invoice_id] = (paidBy[p.accounting_invoice_id] || 0) + (Number(p.amount) || 0);
  });
  var out = [];
  invs.forEach(function (inv) {
    if (!isArEligible(inv)) { return; }
    if (businessOfInvoice(inv, tagById) !== 'US') { return; }
    if ((inv.currency || 'USD') !== 'USD') { return; }
    var open = r2((Number(inv.total_amount) || 0) - (Number(inv.wave_imported_paid) || 0) - (paidBy[inv.id] || 0));
    if (open <= 0.005) { return; }
    var totA = r2(Number(inv.total_amount) || 0);
    out.push({
      id: inv.id, invoice_number: inv.invoice_number, release_number: inv.release_number || null, customer: nameById[inv.accounting_customer_id] || '',
      invoice_date: inv.invoice_date, due_date: inv.due_date, open_balance: open,
      total: totA, paid: r2(totA - open), // PO: original + paid visible in every drill
    });
  });
  return out;
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var action = body.action;
    var userId = body.user_id;
    if (!userId) { return NextResponse.json({ error: 'user_id required' }, { status: 400 }); }

    var WRITE_ACTIONS = { save_bill: 1, void_bill: 1, record_payment: 1, void_payment: 1, extract_bill: 1, validate_bill: 1, reopen_validation: 1, dispute_bill: 1, resolve_dispute: 1, rtm_flag: 1, advance_flag: 1, ingest_bill_file: 1 }; // v55.83-QB/QF/QG
    // v55.83-PW (Max, 10:56): three clear LEVELS. Writes still need
    // Bills: Manage. READS accept ANY totals-level permission — the explicit
    // "Accounting: See Money Totals" (ACCT-008), or the older Bills/AR views
    // (backward compatible: nobody loses access they had yesterday).
    var gate = null;
    if (WRITE_ACTIONS[action]) {
      gate = await assertPermission(db, userId, 'bills.manage', req);
    } else {
      var READ_KEYS = ['bills.view', 'bills.manage', 'accounting.view_totals', 'ar.view_invoice_balances'];
      for (var gk = 0; gk < READ_KEYS.length; gk++) {
        gate = await assertPermission(db, userId, READ_KEYS[gk], req);
        if (gate && gate.ok === true) { break; }
      }
    }
    if (!gate || gate.ok !== true) {
      return NextResponse.json({ error: 'This needs the "' + (WRITE_ACTIONS[action] ? 'Bills: Manage' : 'Accounting: See Money Totals (or Bills/AR: View)') + '" permission — grant it in Settings → Permissions.' }, { status: gate && gate.status ? gate.status : 403 });
    }
    // v55.83-QI (Max 12:33/12:35) — three visibility levels, resolved ONCE:
    //   canTotals — sees the numbers on cards (accounting.view_totals);
    //   canRows   — totals masked ••• but can open cards and see rows
    //               (accounting.view_underlying);
    //   canDates  — may move date filters beyond the defaults
    //               (accounting.change_dates). Super admin passes all.
    var visT = await assertPermission(db, userId, 'accounting.view_totals', req);
    var canTotals = !!visT.ok;
    var canRows = canTotals;
    if (!canRows) { var visU = await assertPermission(db, userId, 'accounting.view_underlying', req); canRows = !!visU.ok; }
    var visD = await assertPermission(db, userId, 'accounting.change_dates', req);
    var canDates = !!visD.ok;
    var ROW_KEYS = { drills: 1, rows: 1, in_rows: 1, bills_due: 1, expected_in: 1 };
    function maskVis(node, inRows) {
      if (node == null) { return node; }
      if (typeof node === 'number') { return inRows ? node : null; }
      if (Array.isArray(node)) {
        if (!inRows && !canRows) { return []; } // no totals AND no underlying → no rows either
        return node.map(function (x) { return maskVis(x, inRows); });
      }
      if (typeof node === 'object') {
        var o = {}; var k;
        for (k in node) {
          if (!Object.prototype.hasOwnProperty.call(node, k)) { continue; }
          o[k] = maskVis(node[k], inRows || ROW_KEYS[k] === 1);
        }
        return o;
      }
      return node;
    }

    // ── list: bills with status + payments
    if (action === 'list') {
      var L = await loadBills(db);
      var rows = decorate(L.bills, L.pays);
      var totals = { open: 0, overdue: 0, open_count: 0 };
      var today = new Date().toISOString().substring(0, 10);
      rows.forEach(function (b) {
        if (!isPayable(b)) { return; }
        totals.open = r2(totals.open + b.open); totals.open_count++;
        if (b.due_date && b.due_date < today) { totals.overdue = r2(totals.overdue + b.open); }
      });
      return NextResponse.json({ ok: true, marker: API_BUILD_MARKER, bills: rows, payments: L.pays, totals: totals });
    }

    // ── save_bill: create or update (active bills only)
    if (action === 'save_bill') {
      var bl = body.bill || {};
      var vendor = String(bl.vendor_name || '').trim();
      var amt = r2(bl.total_amount);
      if (!vendor) { return NextResponse.json({ error: 'Vendor name is required.' }, { status: 400 }); }
      if (!(amt > 0)) { return NextResponse.json({ error: 'Amount must be above zero.' }, { status: 400 }); }
      if (!isDate(bl.bill_date)) { return NextResponse.json({ error: 'Bill date is required (YYYY-MM-DD).' }, { status: 400 }); }
      if (bl.due_date && !isDate(bl.due_date)) { return NextResponse.json({ error: 'Due date must be YYYY-MM-DD.' }, { status: 400 }); }
      var fields = {
        vendor_name: vendor, bill_number: String(bl.bill_number || '').trim() || null,
        bill_date: bl.bill_date, due_date: bl.due_date || null,
        total_amount: amt, category: String(bl.category || '').trim() || null,
        notes: String(bl.notes || '').trim() || null,
        wave_business_id: US_WAVE_BUSINESS_ID, currency: 'USD', updated_at: new Date().toISOString(),
      };
      // v55.83-PC — the scanned/imported file's storage path travels with the bill.
      if (String(bl.attachment_path || '').trim()) { fields.attachment_path = String(bl.attachment_path).trim().substring(0, 300); }
      // v55.83-QB — "Paid via RTM Capital": a third party pays this bill, so it
      // stays OUT of what-we-owe and cash forecasts; it is covered from the RTM
      // payment (All Transactions → 🏢 RTM), never paid from our bank directly.
      if (Object.prototype.hasOwnProperty.call(bl, 'paid_via')) { fields.paid_via = String(bl.paid_via || '').trim().substring(0, 60) || null; }
      if (bl.id) {
        var cur = await db.from('vendor_bills').select('id, record_status, total_amount').eq('id', bl.id).maybeSingle();
        if (cur.error || !cur.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
        if (cur.data.record_status !== 'active') { return NextResponse.json({ error: 'This bill is void — it cannot be edited.' }, { status: 409 }); }
        var payR = await db.from('vendor_bill_payments').select('id, bill_id, amount, voided').eq('bill_id', bl.id);
        var paidSoFar = 0; (payR.data || []).forEach(function (p) { if (p.voided !== true) { paidSoFar += Number(p.amount) || 0; } });
        if (amt + 0.005 < paidSoFar) { return NextResponse.json({ error: 'Amount cannot be below what is already paid (' + r2(paidSoFar).toFixed(2) + '). Void the payments first.' }, { status: 409 }); }
        var up = await db.from('vendor_bills').update(fields).eq('id', bl.id).select('id').maybeSingle();
        var qbWarnU = null;
        if (up.error && /paid_via/.test(up.error.message || '')) { // QB SQL not run yet — save the rest and SAY so
          delete fields.paid_via;
          up = await db.from('vendor_bills').update(fields).eq('id', bl.id).select('id').maybeSingle();
          if (!up.error) { qbWarnU = 'Saved WITHOUT the via-RTM flag — run sql/v55-83-QB-rtm-third-party.sql to store it.'; }
        }
        if (up.error) { throw new Error(up.error.message); }
        var learnedU = null;
        if (fields.category) { learnedU = await learnRule(db, vendor, fields.category, userId); } // v55.83-PJ — a changed pick updates the rule
        await audit(db, userId, 'bill_updated', 'vendor_bill', bl.id, { vendor: vendor, amount: amt, category: fields.category || null, paid_via: fields.paid_via || null }); // v55.83-QI
        return NextResponse.json({ ok: true, id: bl.id, updated: true, rule_learned: learnedU, warning: qbWarnU || undefined });
      }
      // v55.83-PJ (Max): "remember and categorize later on with new bills
      // automatically when imported" — no category given? use the vendor's
      // remembered one. Category given? remember it for next time. Fail-soft.
      var autoCat = null;
      if (!fields.category) {
        autoCat = await suggestCategory(db, vendor);
        if (autoCat) { fields.category = autoCat; }
      }
      fields.created_by = userId;
      var ins = await db.from('vendor_bills').insert(fields).select('id').maybeSingle();
      if (ins.error && fields.paid_via && /paid_via/.test(ins.error.message || '')) { // QB SQL not run yet
        delete fields.paid_via;
        ins = await db.from('vendor_bills').insert(fields).select('id').maybeSingle();
        if (ins.error) { throw new Error(ins.error.message); }
        return NextResponse.json({ ok: true, id: ins.data && ins.data.id, created: true, warning: 'Saved WITHOUT the via-RTM flag — run sql/v55-83-QB-rtm-third-party.sql to store it.' });
      }
      if (ins.error && fields.attachment_path && /attachment_path/.test(ins.error.message || '')) {
        // PC SQL not run yet — save the bill anyway, just without the file link, and SAY so.
        delete fields.attachment_path;
        ins = await db.from('vendor_bills').insert(fields).select('id').maybeSingle();
        if (ins.error) { throw new Error(ins.error.message); }
        return NextResponse.json({ ok: true, id: ins.data && ins.data.id, created: true, warning: 'Saved WITHOUT the file link — run sql/v55-83-PC-bill-attachments.sql to store attachments.' });
      }
      if (ins.error) { throw new Error(ins.error.message); }
      var learnedB = null;
      if (fields.category && !autoCat) { learnedB = await learnRule(db, vendor, fields.category, userId); }
      await audit(db, userId, 'bill_created', 'vendor_bill', ins.data && ins.data.id, { vendor: vendor, amount: amt, category: fields.category || null, paid_via: fields.paid_via || null }); // v55.83-QI
      return NextResponse.json({ ok: true, id: ins.data && ins.data.id, created: true, auto_category: autoCat, rule_learned: learnedB });
    }

    // ── void_bill (reversible record_status; nothing is deleted)
    if (action === 'void_bill') {
      if (!body.id) { return NextResponse.json({ error: 'id required.' }, { status: 400 }); }
      var vb = await db.from('vendor_bills').update({ record_status: 'void', updated_at: new Date().toISOString() }).eq('id', body.id).select('id').maybeSingle();
      if (vb.error) { throw new Error(vb.error.message); }
      if (!vb.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      return NextResponse.json({ ok: true, voided: true });
    }

    // ── record_payment: pay a bill, optionally linked to a real OUT bank txn
    if (action === 'record_payment') {
      var billId = body.bill_id; var pAmt = r2(body.amount);
      if (!billId || !(pAmt > 0) || !isDate(body.paid_date)) {
        return NextResponse.json({ error: 'bill_id, positive amount and paid_date (YYYY-MM-DD) are required.' }, { status: 400 });
      }
      var bRow = await db.from('vendor_bills').select('id, record_status, total_amount, vendor_name').eq('id', billId).maybeSingle();
      if (bRow.error || !bRow.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      if (bRow.data.record_status !== 'active') { return NextResponse.json({ error: 'This bill is void.' }, { status: 409 }); }
      var exPays = await db.from('vendor_bill_payments').select('id, bill_id, amount, voided').eq('bill_id', billId);
      if (exPays.error) { throw new Error(exPays.error.message); }
      var bal = billOpenBalance(bRow.data, exPays.data || []);
      if (pAmt > bal.open + 0.005) {
        return NextResponse.json({ error: 'That overpays the bill — open balance is ' + bal.open.toFixed(2) + '.' }, { status: 409 });
      }
      var bankId = body.bank_transaction_id || null;
      if (bankId) {
        var tx = await db.from('bank_transactions').select('id, direction, pending, amount_abs, iso_currency, wave_business_id').eq('id', bankId).maybeSingle();
        if (tx.error || !tx.data) { return NextResponse.json({ error: 'Bank transaction not found.' }, { status: 404 }); }
        if (tx.data.direction !== 'out') { return NextResponse.json({ error: 'A bill is paid by MONEY OUT — that bank transaction is money in.' }, { status: 409 }); }
        if (tx.data.pending === true) { return NextResponse.json({ error: 'That bank transaction is still pending — link it once it settles.' }, { status: 409 }); }
        if (pAmt > (Number(tx.data.amount_abs) || 0) + 0.005) { return NextResponse.json({ error: 'Payment is larger than the bank transaction (' + r2(tx.data.amount_abs).toFixed(2) + ').' }, { status: 409 }); }
        var already = await db.from('vendor_bill_payments').select('id, amount, voided').eq('bank_transaction_id', bankId);
        var used = 0; (already.data || []).forEach(function (p) { if (p.voided !== true) { used += Number(p.amount) || 0; } });
        if (used + pAmt > (Number(tx.data.amount_abs) || 0) + 0.005) {
          return NextResponse.json({ error: 'That bank transaction is already allocated to bills for ' + r2(used).toFixed(2) + ' — only ' + r2(tx.data.amount_abs - used).toFixed(2) + ' remains.' }, { status: 409 });
        }
      }
      var pIns = await db.from('vendor_bill_payments').insert({
        bill_id: billId, amount: pAmt, paid_date: body.paid_date,
        bank_transaction_id: bankId, method: String(body.method || '').trim() || null, created_by: userId,
      }).select('id').maybeSingle();
      if (pIns.error) { throw new Error(pIns.error.message); }
      await audit(db, userId, 'bill_payment_recorded', 'vendor_bill', billId, { amount: pAmt, paid_date: body.paid_date, bank_transaction_id: bankId, method: String(body.method || '').trim() || null }); // v55.83-QI
      return NextResponse.json({ ok: true, payment_id: pIns.data && pIns.data.id });
    }

    // ── void_payment
    if (action === 'void_payment') {
      if (!body.id) { return NextResponse.json({ error: 'id required.' }, { status: 400 }); }
      var vp = await db.from('vendor_bill_payments').update({ voided: true }).eq('id', body.id).select('id').maybeSingle();
      if (vp.error) { throw new Error(vp.error.message); }
      if (!vp.data) { return NextResponse.json({ error: 'Payment not found.' }, { status: 404 }); }
      return NextResponse.json({ ok: true, voided: true });
    }

    // ── cashflow: money in/out for a period + expected vs due
    if (action === 'cashflow') {
      var fromD = isDate(body.from) ? body.from : '2026-11-01';
      var toD = isDate(body.to) ? body.to : new Date().toISOString().substring(0, 10);
      // v55.83-QI — date filters beyond the default need accounting.change_dates
      var cfLocked = false;
      if (!canDates) {
        var cfTod = new Date().toISOString().substring(0, 10);
        if (fromD < '2026-06-01') { fromD = '2026-06-01'; cfLocked = true; }
        if (toD > cfTod) { toD = cfTod; cfLocked = true; }
      }
      var today2 = new Date().toISOString().substring(0, 10);
      var bank = await fetchAll(function () {
        return db.from('bank_transactions')
          .select('id, direction, amount_abs, pending, date, posted_date, iso_currency, wave_business_id, name, merchant_name, classification, matched_invoice_id')
          .eq('wave_business_id', US_WAVE_BUSINESS_ID)
          .gte('date', fromD).lte('date', toD);
      });
      var bankTx = bank.map(function (t) {
        return { direction: t.direction, amount_abs: t.amount_abs, pending: t.pending, date: t.posted_date || t.date };
      });
      var openInvs = await loadOpenUsInvoices(db);
      var L2 = await loadBills(db);
      var openBills = decorate(L2.bills, L2.pays).filter(isPayable);
      var summary = cashflowSummary({ from: fromD, to: toD, today: today2, bankTx: bankTx, invoices: openInvs, openBills: openBills });
      var dueBills = openBills
        .filter(function (b) { var d = b.due_date || b.bill_date; return d >= fromD && d <= toD; })
        .map(function (b) { return { id: b.id, vendor_name: b.vendor_name, bill_number: b.bill_number, due_date: b.due_date, open: b.open, category: b.category }; });
      var expIn = openInvs
        .filter(function (v) { var d = v.due_date || v.invoice_date; return d && d >= fromD && d <= toD; })
        .sort(function (a, b2) { return b2.open_balance - a.open_balance; }).slice(0, 50);
      // v55.83-PL (Max, Nov 7 04:02): "these cards should be clickable and the
      // underlying data that supports these numbers should be displayed below."
      // Every card gets its rows; sums are computed over ALL rows server-side
      // so the Σ equals the card to the cent even when the list is capped.
      var CAPL = 300;
      var inRowsL = []; var outRowsL = []; var sumInL = 0; var sumOutL = 0;
      bank.forEach(function (t) {
        if (t.pending === true) { return; }
        var dL = t.posted_date || t.date;
        if (!(dL >= fromD && dL <= toD)) { return; }
        var amtL = Number(t.amount_abs) || 0;
        var rowL = { ref: dL, who: t.merchant_name || t.name || '(no description)', date: dL, amount: r2(amtL), source: 'Bank feed (settled)' };
        if (t.direction === 'in') { inRowsL.push(rowL); sumInL += amtL; }
        else if (t.direction === 'out') { outRowsL.push(rowL); sumOutL += amtL; }
      });
      // v55.83-PM (Max, Nov 7 04:12): "we should then also have all sales -
      // which are related to sales... as a card" — SALES RECEIVED = settled
      // deposits in the period that are MATCHED TO AN INVOICE or categorized
      // customer_payment. Same period/settled filters as CAME IN, so sales
      // are always a subset of it.
      var salesRowsL = []; var sumSalesL = 0;
      bank.forEach(function (t) {
        if (t.pending === true || t.direction !== 'in') { return; }
        var dS = t.posted_date || t.date;
        if (!(dS >= fromD && dS <= toD)) { return; }
        var isSales = !!t.matched_invoice_id || t.classification === 'customer_payment';
        if (!isSales) { return; }
        var amtS = Number(t.amount_abs) || 0;
        sumSalesL += amtS;
        salesRowsL.push({ ref: dS, who: t.merchant_name || t.name || '(no description)', date: dS, amount: r2(amtS),
          source: t.matched_invoice_id ? 'Deposit matched to an invoice' : 'Deposit categorized customer_payment' });
      });
      var byAmtL = function (a2, b3) { return b3.amount - a2.amount; };
      inRowsL.sort(byAmtL); outRowsL.sort(byAmtL); salesRowsL.sort(byAmtL);
      // v55.83-PS (Max, 05:33: "expected in... for what period?") — WHAT'S
      // AHEAD is now truly AHEAD: open invoices/bills falling due in the NEXT
      // 30 DAYS FROM TODAY, whatever period the cards above are set to. Money
      // already overdue lives in the Late strip, aged — never double-sold as
      // "expected". Same Apr-1 creation cutoff as the forecast.
      var aheadToF = new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10);
      var expAllL = openInvs
        .filter(function (v) { if ((v.invoice_date || '') < '2026-04-01') { return false; } var d2 = v.due_date || v.invoice_date; return d2 && d2 >= today2 && d2 <= aheadToF; })
        .map(function (v) { return { invoice_id: v.id || null, ref: v.invoice_number || v.id, rel: v.release_number || null, who: v.customer || '', date: v.invoice_date, due: v.due_date || null, total: v.total, paid: v.paid, open: r2(v.open_balance), amount: r2(v.open_balance), source: 'Open invoice · due ' + (v.due_date || '(invoice date ' + v.invoice_date + ')') }; })
        .sort(byAmtL);
      var sumExpL = 0; expAllL.forEach(function (r3) { sumExpL += r3.amount; });
      var billsAheadL = openBills.filter(function (b5) { var d5 = b5.due_date || b5.bill_date; return d5 && d5 >= today2 && d5 <= aheadToF; });
      var billRowsL = billsAheadL
        .map(function (b4) { return { ref: b4.bill_number || b4.id, who: b4.vendor_name || '', date: b4.bill_date, due: b4.due_date || null, total: r2(b4.total_amount), paid: r2(b4.paid), open: r2(b4.open), amount: r2(b4.open), source: 'Open bill' + (b4.category ? ' · ' + b4.category : '') }; })
        .sort(byAmtL);
      var sumBillL = 0; billRowsL.forEach(function (r4) { sumBillL += r4.amount; });
      var drillsL = {
        sales_in: { count: salesRowsL.length, sum: r2(sumSalesL), rows: salesRowsL.slice(0, CAPL) },
        came_in: { count: inRowsL.length, sum: r2(sumInL), rows: inRowsL.slice(0, CAPL) },
        went_out: { count: outRowsL.length, sum: r2(sumOutL), rows: outRowsL.slice(0, CAPL) },
        expected_in: { count: expAllL.length, sum: r2(sumExpL), rows: expAllL.slice(0, CAPL) },
        bills_due: { count: billRowsL.length, sum: r2(sumBillL), rows: billRowsL.slice(0, CAPL) },
      };
      var aheadL = { from: today2, to: aheadToF,
        expected_in: r2(sumExpL), expected_in_count: expAllL.length,
        due_out: r2(sumBillL), due_out_count: billRowsL.length,
        projected_net: r2(sumExpL - sumBillL) };
      var cfPayload = { summary: summary, ahead: aheadL, sales_in: r2(sumSalesL), sales_in_count: salesRowsL.length, bills_due: dueBills, expected_in: expIn, drills: drillsL };
      if (!canTotals) { cfPayload = maskVis(cfPayload, false); } // v55.83-QI — tiered card visibility
      cfPayload.ok = true; cfPayload.marker = API_BUILD_MARKER; cfPayload.from = fromD; cfPayload.to = toD;
      cfPayload.totals_masked = !canTotals; cfPayload.rows_visible = canRows; cfPayload.date_filters_locked = cfLocked;
      return NextResponse.json(cfPayload);
    }

    // ── validate_bill: validation is NOT a formality (Max). All three checks
    // must be explicitly confirmed; who/when/how land on the bill AND in the
    // append-only audit trail. Unsupported validations are an accountability
    // issue — the trail is built to be audited.
    if (action === 'validate_bill') {
      var ck = body.checks || {};
      if (ck.matches_records !== true || ck.goods_received !== true || ck.charges_accurate !== true) {
        return NextResponse.json({ error: 'All three checks must be confirmed: matches our records, goods/services received, charges accurate. Validation is not a formality.' }, { status: 400 });
      }
      var vNotes = String(body.notes || '').trim();
      if (vNotes.length < 10) { return NextResponse.json({ error: 'Describe HOW you verified it (at least a sentence) — this record will be audited.' }, { status: 400 }); }
      var vb2 = await db.from('vendor_bills').select('id, record_status, validation_status, vendor_name, bill_number').eq('id', body.id).maybeSingle();
      if (vb2.error || !vb2.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      if (vb2.data.record_status !== 'active') { return NextResponse.json({ error: 'This bill is void.' }, { status: 409 }); }
      var vPatch = { validation_status: 'validated', validated_by: userId, validated_at: new Date().toISOString(),
        validation_notes: vNotes.substring(0, 1000), updated_at: new Date().toISOString() };
      if (String(body.warehouse_reference || '').trim()) { vPatch.warehouse_reference = String(body.warehouse_reference).trim().substring(0, 120); }
      if (String(body.attachment_path || '').trim()) { vPatch.validation_attachment_path = String(body.attachment_path).trim().substring(0, 300); }
      var vUp = await db.from('vendor_bills').update(vPatch).eq('id', body.id).select('id').maybeSingle();
      if (vUp.error) { throw new Error(vUp.error.message); }
      await db.from('vendor_bill_events').insert({ bill_id: body.id, kind: 'validated', actor_id: userId,
        details: { checks: { matches_records: true, goods_received: true, charges_accurate: true }, notes: vNotes.substring(0, 1000), attachment_path: vPatch.validation_attachment_path || null,
          warehouse_reference: vPatch.warehouse_reference || null, system_match: body.system_match || null } });
      await audit(db, userId, 'bill_validated', 'vendor_bill', body.id, { notes: vNotes.substring(0, 200) }); // v55.83-QI
      return NextResponse.json({ ok: true, validated: true });
    }
    if (action === 'reopen_validation') {
      var rNote = String(body.reason || '').trim();
      if (rNote.length < 5) { return NextResponse.json({ error: 'Say why the validation is being reopened — it goes on the audit trail.' }, { status: 400 }); }
      var rUp = await db.from('vendor_bills').update({ validation_status: 'pending', updated_at: new Date().toISOString() }).eq('id', body.id).select('id').maybeSingle();
      if (rUp.error) { throw new Error(rUp.error.message); }
      if (!rUp.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      await db.from('vendor_bill_events').insert({ bill_id: body.id, kind: 'validation_reopened', actor_id: userId, details: { reason: rNote.substring(0, 500) } });
      return NextResponse.json({ ok: true });
    }

    // ── dispute_bill: a dispute without a ticket does not exist (Max). Creates
    // a hub ticket with owner + follow-up date; the bill leaves payable totals.
    if (action === 'dispute_bill') {
      var dReason = String(body.reason || '').trim();
      if (dReason.length < 10) { return NextResponse.json({ error: 'A dispute needs a real reason (at least a sentence).' }, { status: 400 }); }
      var dBill = await db.from('vendor_bills').select('id, vendor_name, bill_number, total_amount, due_date, record_status, disputed').eq('id', body.id).maybeSingle();
      if (dBill.error || !dBill.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      if (dBill.data.disputed === true) { return NextResponse.json({ error: 'Already disputed — work the existing ticket.' }, { status: 409 }); }
      var fup = /^\d{4}-\d{2}-\d{2}$/.test(String(body.follow_up_date || '')) ? body.follow_up_date : new Date(Date.now() + 7 * 864e5).toISOString().substring(0, 10);
      var tnum = 'BILL-' + new Date().toISOString().substring(0, 10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 900 + 100);
      var tIns = await db.from('tickets').insert({
        ticket_number: tnum,
        title: '⚠ DISPUTED BILL: ' + dBill.data.vendor_name + (dBill.data.bill_number ? ' · ' + dBill.data.bill_number : '') + ' — $' + (Number(dBill.data.total_amount) || 0).toFixed(2),
        description: 'DISPUTED VENDOR BILL\nVendor: ' + dBill.data.vendor_name + '\nBill #: ' + (dBill.data.bill_number || '—') + '\nAmount: $' + (Number(dBill.data.total_amount) || 0).toFixed(2) + '\nDue: ' + (dBill.data.due_date || '—')
          + '\n\nREASON FOR DISPUTE:\n' + dReason
          + '\n\nRULES (per Max): this dispute must have active follow-up. Record every action taken on this ticket. Follow-up due: ' + fup + '. No dispute sits unresolved without progress.',
        priority: 'high', status: 'New', assigned_to: body.assigned_to || userId, created_by: userId, due_date: fup,
      }).select('id').single();
      if (tIns.error) { return NextResponse.json({ error: 'Could not create the dispute ticket: ' + tIns.error.message }, { status: 500 }); }
      var dUp = await db.from('vendor_bills').update({ disputed: true, dispute_ticket_id: tIns.data.id, dispute_reason: dReason.substring(0, 500), updated_at: new Date().toISOString() }).eq('id', body.id);
      if (dUp.error) { throw new Error(dUp.error.message); }
      await db.from('vendor_bill_events').insert({ bill_id: body.id, kind: 'disputed', actor_id: userId, details: { reason: dReason.substring(0, 500), ticket: tnum, follow_up: fup, assigned_to: body.assigned_to || userId } });
      return NextResponse.json({ ok: true, ticket_number: tnum });
    }
    if (action === 'resolve_dispute') {
      var resNote = String(body.resolution || '').trim();
      if (resNote.length < 10) { return NextResponse.json({ error: 'Record HOW the dispute was resolved — it goes on the audit trail.' }, { status: 400 }); }
      var rb = await db.from('vendor_bills').select('id, disputed, dispute_ticket_id').eq('id', body.id).maybeSingle();
      if (rb.error || !rb.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      if (rb.data.disputed !== true) { return NextResponse.json({ error: 'This bill is not disputed.' }, { status: 409 }); }
      var ru = await db.from('vendor_bills').update({ disputed: false, updated_at: new Date().toISOString() }).eq('id', body.id);
      if (ru.error) { throw new Error(ru.error.message); }
      if (rb.data.dispute_ticket_id) {
        try { await db.from('tickets').update({ status: 'Resolved' }).eq('id', rb.data.dispute_ticket_id); } catch (eT) {}
      }
      await db.from('vendor_bill_events').insert({ bill_id: body.id, kind: 'dispute_resolved', actor_id: userId, details: { resolution: resNote.substring(0, 800) } });
      return NextResponse.json({ ok: true });
    }

    // ── due_through: "how much do we owe through <date>" — instant, complete,
    // by vendor, disputed excluded, validated/pending split, no double-counting.
    if (action === 'due_through') {
      var thru = /^\d{4}-\d{2}-\d{2}$/.test(String(body.through || '')) ? body.through : new Date().toISOString().substring(0, 10);
      var LT = await loadBills(db);
      var all = decorate(LT.bills, LT.pays);
      var due = all.filter(function (b) { return isPayable(b) && (b.due_date || b.bill_date) <= thru; })
        .sort(function (a, b2) { return String(a.due_date || a.bill_date).localeCompare(String(b2.due_date || b2.bill_date)); });
      var disputedExcluded = all.filter(function (b) { return b.record_status === 'active' && b.disputed === true && b.open > 0.005 && (b.due_date || b.bill_date) <= thru; });
      var byVendor = {};
      var total = 0; var validatedOpen = 0; var pendingOpen = 0;
      due.forEach(function (b) {
        total = Math.round((total + b.open) * 100) / 100;
        if (b.validation_status === 'validated') { validatedOpen = Math.round((validatedOpen + b.open) * 100) / 100; } else { pendingOpen = Math.round((pendingOpen + b.open) * 100) / 100; }
        var k = b.vendor_name || '?';
        if (!byVendor[k]) { byVendor[k] = { vendor: k, open: 0, count: 0 }; }
        byVendor[k].open = Math.round((byVendor[k].open + b.open) * 100) / 100; byVendor[k].count++;
      });
      return NextResponse.json({ ok: true, marker: API_BUILD_MARKER, through: thru,
        total_owed: total, bill_count: due.length,
        validated_open: validatedOpen, pending_validation_open: pendingOpen,
        by_vendor: Object.values(byVendor).sort(function (a, b2) { return b2.open - a.open; }),
        bills: due.map(function (b) { return { id: b.id, vendor: b.vendor_name, bill_number: b.bill_number, due_date: b.due_date || b.bill_date, open: b.open, validation: b.validation_status, status: b.status }; }),
        disputed_excluded: disputedExcluded.map(function (b) { return { vendor: b.vendor_name, bill_number: b.bill_number, open: b.open, reason: b.dispute_reason }; }) });
    }

    // ── bill_events: the audit trail for one bill
    if (action === 'bill_events') {
      var ev = await db.from('vendor_bill_events').select('kind, actor_id, details, created_at').eq('bill_id', body.id).order('created_at', { ascending: true });
      if (ev.error) { throw new Error(ev.error.message); }
      return NextResponse.json({ ok: true, events: ev.data || [] });
    }

    // ── extract_bill: read a photographed/PDF bill with the same AI the hub
    // already uses (Anthropic). The model PROPOSES; parseBillExtraction
    // disciplines (invalid dates/amounts become null, never guessed); the
    // HUMAN confirms in the form before anything is saved.
    // ── v55.83-QG (Max 12:19: "can we import multiple documents at the same
    //    time... check for duplicates or previously paid.. still have a human
    //    validation column") — ONE file in, ONE pending-validation bill out,
    //    called once per file by the multi-import queue. Same discipline as
    //    the email-in path: extraction never guesses, exact vendor+number
    //    duplicates are SKIPPED (reported), same-vendor same-amount near-date
    //    look-alikes are CREATED with a loud ⚠ note naming the suspect (and
    //    whether that one is already PAID) — a human decides, always.
    if (action === 'ingest_bill_file') {
      var gB64 = String(body.file_base64 || '');
      var gType = String(body.media_type || '');
      var gName = String(body.filename || 'bill').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60);
      if (!gB64 || !gType) { return NextResponse.json({ error: 'file_base64 and media_type required.' }, { status: 400 }); }
      var gRead = await readBillFromBase64(gB64, gType);
      if (gRead.error) { return NextResponse.json({ ok: true, skipped: true, file: gName, reason: gRead.error }); }
      var gD = gRead.draft;
      // v55.83-QH (Max 12:26) — ONE shared duplicate radar (lib): hard
      // vendor+number duplicates SKIP; shared reference/release/container
      // tokens, same amount near-date, and same vendor+date all WARN loudly
      // (incl. already-PAID), and the bill is still created for a human.
      var gVerdict = await billDupVerdict(db, { vendor_name: gD.vendor_name, bill_number: gD.bill_number, bill_date: gD.bill_date, total_amount: gD.total_amount, notes: gD.notes || '' });
      if (gVerdict.skip) { return NextResponse.json({ ok: true, skipped: true, file: gName, reason: gVerdict.skip }); }
      var gWarn = gVerdict.warn;
      var gCat = gD.category || null;
      if (!gCat) { try { gCat = await suggestCategory(db, gD.vendor_name || ''); } catch (eGC) { gCat = null; } }
      var gPath = 'pv/upload-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '-' + gName;
      var gUpErr = null;
      try {
        var gUp = await db.storage.from('bills-private').upload(gPath, Buffer.from(gB64, 'base64'), { contentType: gType, upsert: false });
        if (gUp.error) { gUpErr = gUp.error.message; }
      } catch (eGU) { gUpErr = (eGU && eGU.message) || 'upload failed'; }
      var gIns = await db.from('vendor_bills').insert({
        vendor_name: gD.vendor_name || ('UNREAD VENDOR (file ' + gName + ')'),
        bill_number: gD.bill_number, bill_date: gD.bill_date || new Date().toISOString().substring(0, 10),
        due_date: gD.due_date, total_amount: gD.total_amount || 0.01,
        category: gCat, currency: 'USD', wave_business_id: US_WAVE_BUSINESS_ID,
        notes: ((gWarn ? gWarn + ' · ' : '') + 'Imported from file ' + gName +
                (gRead.problems.length ? ' · READER FLAGS: ' + gRead.problems.join(' ') : '')).substring(0, 900),
        validation_status: 'pending',
        attachment_path: gUpErr ? null : gPath,
        created_by: userId,
      }).select('id').maybeSingle();
      if (gIns.error) { return NextResponse.json({ ok: true, skipped: true, file: gName, reason: gIns.error.message }); }
      try { await db.from('vendor_bill_events').insert({ bill_id: gIns.data.id, kind: 'file_ingested', actor_id: userId, details: { file: gName, reader_flags: gRead.problems, duplicate_warning: gWarn, attachment_stored: !gUpErr } }); } catch (eGE) {}
      await audit(db, userId, 'bill_imported_from_file', 'vendor_bill', gIns.data.id, { file: gName, duplicate_warning: gWarn }); // v55.83-QI
      return NextResponse.json({ ok: true, created: true, id: gIns.data.id, file: gName,
        vendor: gD.vendor_name || null, amount: gD.total_amount || null,
        duplicate_warning: gWarn, reader_flags: gRead.problems });
    }

    if (action === 'extract_bill') {
      var rd = await readBillFromBase64(String(body.file_base64 || ''), String(body.media_type || ''));
      if (rd.error) { return NextResponse.json({ error: rd.error }, { status: rd.status || 500 }); }
      // v55.83-PJ — the document rarely names a category; the vendor's
      // REMEMBERED one is suggested (clearly marked, human still confirms).
      var sugg = null;
      if (rd.draft && rd.draft.vendor_name && !rd.draft.category) { sugg = await suggestCategory(db, rd.draft.vendor_name); }
      return NextResponse.json({ ok: true, marker: API_BUILD_MARKER, draft: rd.draft, problems: rd.problems, suggested_category: sugg });
    }

    // ── match_reference (PF): the underlying hook for the future warehouse
    // link — look a reference up in the NextTrade warehouse records so the
    // validator can confirm goods were actually received against the system.
    if (action === 'match_reference') {
      var refQ = String(body.reference || '').trim();
      if (refQ.length < 2) { return NextResponse.json({ error: 'Give a reference to look up.' }, { status: 400 }); }
      var mOrders = await db.from('nexttrade_orders')
        .select('release_number, customer_name, order_date, warehouse, container')
        .ilike('release_number', '%' + refQ + '%').limit(10);
      // inv_shipments is the warehouse receiving ledger: shipment_ref + supplier
      // + received date — exactly the evidence "goods were actually received".
      var mShip = await db.from('inv_shipments')
        .select('shipment_ref, status, supplier_name, eta_date, received_date')
        .or('shipment_ref.ilike.%' + refQ + '%,supplier_name.ilike.%' + refQ + '%').limit(10);
      return NextResponse.json({ ok: true,
        warehouse_orders: (mOrders.data || []),
        shipments: (mShip.error ? [] : (mShip.data || [])),
        found: ((mOrders.data || []).length + (mShip.error ? 0 : (mShip.data || []).length)) > 0 });
    }

    // ── drift_status (PF, QA critical #1): classifications changed AFTER the
    // bridge posted them — hub vs ledger divergence, surfaced, never silent.
    if (action === 'drift_status') {
      var dj = await db.rpc('clickbooks_us_classification_drift_job', {});
      if (dj.error) { return NextResponse.json({ ok: true, available: false, note: 'Drift check needs sql/v55-83-PF-tier1.sql.' }); }
      return NextResponse.json({ ok: true, available: true, drift: dj.data });
    }

    // ── deposit_match_candidates (v55.83-PW, Max 10:54: "why can't we do
    //    matching from here as well. can be done in multiple places") — rank
    //    open invoices against one deposit so ANY screen can offer matching.
    //    ALL open invoices qualify (no Apr-1 cutoff: a deposit may well pay
    //    an old invoice). Candidates only — the WRITE goes through bank-write
    //    match_invoice with its silo + over-apply guards.
    // ── v55.83-QB — RTM Capital, the third-party payer (Max, Nov 7 11:38:
    //    "when we select RTM for a transfer... it asks for what bills it's
    //    paid. Then we can select those bills and match those bills to that
    //    payment"). rtm_open_bills lists the via-RTM bills still open to
    //    cover; rtm_flag stamps a money-out transaction as the RTM payment.
    //    The per-bill MONEY writes go through record_payment with
    //    method='rtm' — the same overpay + over-allocation guards as every
    //    bill payment; money math is never duplicated here. ──
    if (action === 'rtm_open_bills') {
      var LR = await loadBills(db);
      var rowsR = decorate(LR.bills, LR.pays).filter(function (b) {
        return b.record_status === 'active' && b.paid_via && b.open > 0.005;
      }).map(function (b) {
        return { id: b.id, vendor_name: b.vendor_name, bill_number: b.bill_number, bill_date: b.bill_date,
          due_date: b.due_date, category: b.category, total_amount: r2(b.total_amount), paid: b.paid, open: b.open, paid_via: b.paid_via };
      });
      return NextResponse.json({ ok: true, bills: rowsR });
    }
    // ── v55.83-QF (Max 12:14): ⏳ ADVANCE — money sent before the bills
    //    exist. Flag now; later the SAME 🔗 match flow attaches the real
    //    bills (record_payment guards unchanged). The flag only makes the
    //    transaction findable until then.
    if (action === 'advance_flag') {
      var txAv = await db.from('bank_transactions').select('id, direction, pending').eq('id', body.bank_transaction_id).maybeSingle();
      if (txAv.error || !txAv.data) { return NextResponse.json({ error: 'Bank transaction not found.' }, { status: 404 }); }
      if (txAv.data.direction !== 'out') { return NextResponse.json({ error: 'An advance is MONEY OUT — that transaction is money in.' }, { status: 409 }); }
      var upAv = await db.from('bank_transactions').update({ advance_flag: body.clear !== true }).eq('id', body.bank_transaction_id).select('id');
      if (upAv.error) { return NextResponse.json({ error: upAv.error.message + (/advance_flag/.test(upAv.error.message || '') ? ' — run sql/v55-83-QF-advance-flag.sql first.' : '') }, { status: 400 }); }
      await audit(db, userId, body.clear === true ? 'advance_flag_cleared' : 'advance_flagged', 'bank_transaction', body.bank_transaction_id, null); // v55.83-QI
      return NextResponse.json({ ok: true, advance: body.clear !== true });
    }
    if (action === 'rtm_flag') {
      var txR = await db.from('bank_transactions').select('id, direction, pending').eq('id', body.bank_transaction_id).maybeSingle();
      if (txR.error || !txR.data) { return NextResponse.json({ error: 'Bank transaction not found.' }, { status: 404 }); }
      if (txR.data.direction !== 'out') { return NextResponse.json({ error: 'An RTM payment is MONEY OUT — that transaction is money in.' }, { status: 409 }); }
      var upR = await db.from('bank_transactions')
        .update({ third_party_payer: body.clear === true ? null : String(body.payer || 'RTM Capital').substring(0, 60) })
        .eq('id', body.bank_transaction_id).select('id');
      if (upR.error) { return NextResponse.json({ error: upR.error.message + (/third_party_payer/.test(upR.error.message || '') ? ' — run sql/v55-83-QB-rtm-third-party.sql first.' : '') }, { status: 400 }); }
      await audit(db, userId, body.clear === true ? 'rtm_flag_cleared' : 'rtm_payment_flagged', 'bank_transaction', body.bank_transaction_id, null); // v55.83-QI
      return NextResponse.json({ ok: true, flagged: body.clear !== true });
    }

    if (action === 'deposit_match_candidates') {
      var txDm = await db.from('bank_transactions').select('id, date, posted_date, amount_abs, name, merchant_name, wave_business_id, matched_invoice_id').eq('id', body.bank_transaction_id).maybeSingle();
      if (txDm.error || !txDm.data) { return NextResponse.json({ ok: false, error: 'Deposit not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      var openDm = await loadOpenUsInvoices(db);
      var amtDm = r2(txDm.data.amount_abs);
      // v55.83-QF (Max 12:08): "have a search to search for something or
      // keyword or phrase or number" — q filters ALL open invoices (ref,
      // release, customer, amount digits) BEFORE scoring, so anything is
      // findable, not just the top-20 best guesses.
      var qDm = String(body.q || '').trim().toLowerCase();
      if (qDm.length >= 1) {
        var qDigits = qDm.replace(/[^0-9.]/g, '');
        openDm = openDm.filter(function (v0) {
          var hay = (String(v0.invoice_number || '') + ' ' + String(v0.release_number || '') + ' ' + String(v0.customer || '')).toLowerCase();
          if (hay.indexOf(qDm) >= 0) { return true; }
          if (qDigits.length >= 3 && (String(v0.open_balance.toFixed(2)).indexOf(qDigits) >= 0 || String((Number(v0.total) || 0).toFixed(2)).indexOf(qDigits) >= 0)) { return true; }
          return false;
        });
      }
      // v55.83-QF — how much of this deposit is ALREADY applied (multi-invoice
      // splits), so the popup can show "remaining" and the amounts prefill it.
      var apDm = 0;
      try {
        var apQ = await db.from('accounting_invoice_payments').select('amount, voided, sync_status').eq('bank_transaction_id', txDm.data.id);
        ((apQ && apQ.data) || []).forEach(function (p0) {
          var st0 = String(p0.sync_status || '').toLowerCase();
          if (p0.voided !== true && st0 !== 'void' && st0 !== 'voided' && st0 !== 'cancelled' && st0 !== 'reversed' && st0 !== 'deleted') { apDm = r2(apDm + (Number(p0.amount) || 0)); }
        });
      } catch (eAp) { apDm = 0; }
      var toksDm = String((txDm.data.merchant_name || '') + ' ' + (txDm.data.name || '')).toLowerCase().split(/[^a-z0-9&]+/).filter(function (t0) { return t0.length >= 3; });
      var scored = openDm.map(function (v) {
        var sc = 0;
        if (Math.abs(v.open_balance - amtDm) <= 0.01) { sc += 100; } // exact open balance
        else if (v.open_balance >= amtDm - 0.01) { sc += 10; }       // deposit fits inside
        var nm = String(v.customer || '').toLowerCase();
        toksDm.forEach(function (t1) { if (nm && nm.indexOf(t1) >= 0) { sc += 25; } });
        return { v: v, sc: sc };
      }).sort(function (a, b) { return b.sc - a.sc || b.v.open_balance - a.v.open_balance; }).slice(0, 20);
      var idsDm = scored.map(function (x) { return x.v.id; });
      var fullDm = idsDm.length ? await db.from('accounting_invoices').select('*').in('id', idsDm) : { data: [] };
      var fullBy = {}; (fullDm.data || []).forEach(function (r8) { fullBy[r8.id] = r8; });
      var candsDm = scored.map(function (x) {
        return { invoice: fullBy[x.v.id] || null, id: x.v.id, ref: x.v.invoice_number, rel: x.v.release_number || null,
          customer: x.v.customer, open: x.v.open_balance, total: x.v.total, due: x.v.due_date, score: x.sc, exact: Math.abs(x.v.open_balance - amtDm) <= 0.01 };
      }).filter(function (c9) { return c9.invoice; });
      var txOutDm = Object.assign({}, txDm.data, { applied: apDm, remaining: Math.max(0, r2(amtDm - apDm)) });
      return NextResponse.json({ ok: true, txn: txOutDm, candidates: candsDm, api_build_marker: API_BUILD_MARKER });
    }

    // ── bill_match_candidates (v55.83-PW, Max 11:02: "must be able to match
    //    bills to payments") — rank OPEN bills against one money-out
    //    transaction, so spending can be matched to bills from All
    //    Transactions too. The WRITE stays record_payment with its overpay +
    //    over-allocation + settled-out guards.
    if (action === 'bill_match_candidates') {
      var txBm = await db.from('bank_transactions').select('id, date, posted_date, amount_abs, name, merchant_name, direction').eq('id', body.bank_transaction_id).maybeSingle();
      if (txBm.error || !txBm.data) { return NextResponse.json({ ok: false, error: 'Transaction not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      if (txBm.data.direction !== 'out') { return NextResponse.json({ ok: false, error: 'Bills are paid by money OUT — this is a deposit.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var LBm = await loadBills(db);
      var openBm = decorate(LBm.bills, LBm.pays).filter(function (b0) { return isPayable(b0); });
      var amtBm = r2(txBm.data.amount_abs);
      // v55.83-QF — same search for bills: vendor, bill number, amount digits.
      var qBm = String(body.q || '').trim().toLowerCase();
      if (qBm.length >= 1) {
        var qDigB = qBm.replace(/[^0-9.]/g, '');
        openBm = openBm.filter(function (b00) {
          var hayB = (String(b00.bill_number || '') + ' ' + String(b00.vendor_name || '') + ' ' + String(b00.category || '')).toLowerCase();
          if (hayB.indexOf(qBm) >= 0) { return true; }
          if (qDigB.length >= 3 && (String(b00.open.toFixed(2)).indexOf(qDigB) >= 0 || String((Number(b00.total_amount) || 0).toFixed(2)).indexOf(qDigB) >= 0)) { return true; }
          return false;
        });
      }
      var apBm = 0;
      try {
        var apQ2 = await db.from('vendor_bill_payments').select('amount, voided').eq('bank_transaction_id', txBm.data.id);
        ((apQ2 && apQ2.data) || []).forEach(function (p1) { if (p1.voided !== true) { apBm = r2(apBm + (Number(p1.amount) || 0)); } });
      } catch (eAp2) { apBm = 0; }
      var toksBm = String((txBm.data.merchant_name || '') + ' ' + (txBm.data.name || '')).toLowerCase().split(/[^a-z0-9&]+/).filter(function (t0) { return t0.length >= 3; });
      var scoredBm = openBm.map(function (b1) {
        var sc = 0;
        if (Math.abs(b1.open - amtBm) <= 0.01) { sc += 100; }
        else if (b1.open >= amtBm - 0.01) { sc += 10; }
        var nm = String(b1.vendor_name || '').toLowerCase();
        toksBm.forEach(function (t1) { if (nm && nm.indexOf(t1) >= 0) { sc += 25; } });
        return { b: b1, sc: sc };
      }).sort(function (a, b2) { return b2.sc - a.sc || b2.b.open - a.b.open; }).slice(0, 20);
      var candsBm = scoredBm.map(function (x) {
        return { bill_id: x.b.id, ref: x.b.bill_number || '—', vendor: x.b.vendor_name || '', open: r2(x.b.open), total: r2(x.b.total_amount), due: x.b.due_date || null, score: x.sc, exact: Math.abs(x.b.open - amtBm) <= 0.01 };
      });
      var txOutBm = Object.assign({}, txBm.data, { applied: apBm, remaining: Math.max(0, r2(amtBm - apBm)) });
      return NextResponse.json({ ok: true, txn: txOutBm, candidates: candsBm, api_build_marker: API_BUILD_MARKER });
    }

    // ── forecast: aging buckets in/out + drill rows + unflagged counts
    // (Max: "what's coming in the next 30 days, 30-60, 60-90, 90 plus...
    //  bills we owe same thing... shortages... click the cards to see the
    //  underlying numbers and where they're coming from")
    if (action === 'forecast') {
      var todayF = new Date().toISOString().substring(0, 10);
      // v55.83-PQ (Max, Nov 7 04:54): "it pulls in invoices that are not
      // matched in the new system and thus showing as old... maybe we should
      // just look at only invoices April 1st on created... and we need to see
      // what will be due." Invoices CREATED before Apr 1, 2026 are mostly
      // pre-hub history whose payments were never matched — they'd all pile
      // into 90+ LATE and drown the real picture. They are EXCLUDED here but
      // COUNTED AND REPORTED (never silently dropped), and they still exist
      // everywhere else (All Invoices, Open Balances, ClickBooks AR).
      var FORECAST_CREATED_FROM = '2026-04-01';
      var allOpenF = await loadOpenUsInvoices(db);
      var exCount = 0; var exSum = 0;
      var openInvsF = allOpenF.filter(function (v) {
        if ((v.invoice_date || '') >= FORECAST_CREATED_FROM) { return true; }
        exCount++; exSum = Math.round((exSum + v.open_balance) * 100) / 100; return false;
      });
      var LF = await loadBills(db);
      var openBillsF = decorate(LF.bills, LF.pays).filter(isPayable);
      var buckets = forecastBuckets(openInvsF, openBillsF, todayF);
      var rows = tagRows(openInvsF, openBillsF, todayF);
      var unrevOut = await db.from('bank_transactions').select('id', { count: 'exact', head: true })
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out').eq('review_status', 'unreviewed').neq('pending', true);
      var unmatchedIn = await db.from('bank_transactions').select('id', { count: 'exact', head: true })
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'in').eq('review_status', 'unreviewed').is('matched_invoice_id', null).neq('pending', true);
      // v55.83-PQ (Max, 04:55): "see how our balances will be" — the projected
      // balance row starts from the REAL bank balance, so it is only included
      // for people with the protected bank-balance permission (same grant as
      // the dashboard). Fail-soft: no permission (or stale map) → no balance
      // row, forecast still works.
      var balF = null;
      try {
        var profF = await db.from('profiles').select('email').eq('id', userId).maybeSingle();
        var emailF = profF.data && profF.data.email ? String(profF.data.email).toLowerCase() : null;
        if (emailF) {
          var idsF = await db.rpc('bank_visibility_identity_map');
          var authF = null;
          (idsF.data || []).forEach(function (r7) { if (String(r7.email || '').toLowerCase() === emailF) { authF = r7.auth_user_id; } });
          if (authF) {
            var superIdsF = String(process.env.HUB_SUPER_ADMIN_AUTH_USER_IDS || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
            var okBal = superIdsF.indexOf(authF) >= 0;
            if (!okBal) {
              var gF = await db.from('financial_visibility_permissions').select('can_view_bank_balances').eq('auth_user_id', authF).maybeSingle();
              okBal = !!(gF.data && gF.data.can_view_bank_balances === true);
            }
            if (okBal) {
              var acF = await db.from('plaid_accounts').select('name, mask, current_balance, iso_currency, updated_at').eq('wave_business_id', US_WAVE_BUSINESS_ID);
              // one row per mask (reconnects leave alias rows) — keep the freshest
              var byMask = {};
              (acF.data || []).forEach(function (a4) {
                if (a4.current_balance === null || a4.current_balance === undefined) { return; }
                var k4 = a4.mask || a4.name || '?';
                if (!byMask[k4] || String(a4.updated_at || '') > String(byMask[k4].updated_at || '')) { byMask[k4] = a4; }
              });
              var tot = 0; var asOf = ''; var accs = [];
              Object.keys(byMask).forEach(function (k5) {
                var a5 = byMask[k5];
                tot = Math.round((tot + (Number(a5.current_balance) || 0)) * 100) / 100;
                if (String(a5.updated_at || '') > asOf) { asOf = String(a5.updated_at || ''); }
                accs.push({ name: a5.name, mask: a5.mask, balance: Math.round((Number(a5.current_balance) || 0) * 100) / 100 });
              });
              if (accs.length) { balF = { total: tot, as_of: asOf.substring(0, 10), accounts: accs }; }
            }
          }
        }
      } catch (eBal) { balF = null; }
      var fcPayload = { buckets: buckets, rows: rows,
        excluded_old: { count: exCount, sum: exSum, before: FORECAST_CREATED_FROM },
        unflagged: { expenses: unrevOut.count || 0, deposits: unmatchedIn.count || 0 } };
      if (!canTotals) { fcPayload = maskVis(fcPayload, false); } // v55.83-QI — tiered card visibility
      fcPayload.ok = true; fcPayload.marker = API_BUILD_MARKER; fcPayload.today = todayF; fcPayload.bucket_order = BUCKETS;
      fcPayload.bank_balance = balF; // its own PROTECTED grant decided this above — null unless granted
      fcPayload.totals_masked = !canTotals; fcPayload.rows_visible = canRows;
      return NextResponse.json(fcPayload);
    }

    // ── period_stats (PH): "a tab from june 1st on for both invoices and
    // bills to see stats" — one period, both sides, monthly breakdown.
    if (action === 'period_stats') {
      var pFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || '')) ? body.from : '2026-06-01';
      var pTo = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to || '')) ? body.to : new Date().toISOString().substring(0, 10);
      // v55.83-QI (Max 12:35): date filters beyond the default are their own permission.
      var pLocked = false;
      if (!canDates) {
        var pTod = new Date().toISOString().substring(0, 10);
        if (pFrom < '2026-06-01') { pFrom = '2026-06-01'; pLocked = true; }
        if (pTo > pTod) { pTo = pTod; pLocked = true; }
        if (String(body.from || '') && body.from !== pFrom) { pLocked = true; }
      }
      function monthOf(d) { return String(d || '').substring(0, 7); }
      function addM(map, m, key, amt) {
        if (!m || m.length !== 7) { return; }
        if (!map[m]) { map[m] = { month: m, invoiced: 0, invoiced_count: 0, collected: 0, collected_count: 0, billed: 0, billed_count: 0, bills_paid: 0, bills_paid_count: 0 }; }
        map[m][key] = r2(map[m][key] + amt); map[m][key + '_count']++;
      }
      // Invoices side (US, canonical eligibility; all invoices in period, not just open)
      var invsP = await fetchAll(function () {
        return db.from('accounting_invoices')
          .select('id, invoice_number, release_number, invoice_date, due_date, currency, total_amount, wave_imported_paid, record_status, approval_status, wave_status, wave_invoice_id, wave_business_id, source, accounting_customer_id')
          .order('created_at', { ascending: false });
      });
      var paysP = await fetchAll(function () {
        return db.from('accounting_invoice_payments').select('id, accounting_invoice_id, amount, payment_date, voided, sync_status');
      });
      var custsP = await fetchAll(function () {
        return db.from('accounting_customers').select('id, company_name, contact_name, business_tag');
      });
      var tagByIdP = {}; custsP.forEach(function (c) { tagByIdP[c.id] = c.business_tag || null; });
      var nameByIdP = {}; custsP.forEach(function (c) { nameByIdP[c.id] = c.company_name || c.contact_name || ''; });
      var usInv = {}; var paidByP = {};
      invsP.forEach(function (inv) {
        if (!isArEligible(inv)) { return; }
        if (businessOfInvoice(inv, tagByIdP) !== 'US') { return; }
        if ((inv.currency || 'USD') !== 'USD') { return; }
        usInv[inv.id] = inv;
      });
      paysP.forEach(function (pp) {
        if (isPaymentVoid(pp)) { return; }
        if (!usInv[pp.accounting_invoice_id]) { return; }
        paidByP[pp.accounting_invoice_id] = (paidByP[pp.accounting_invoice_id] || 0) + (Number(pp.amount) || 0);
      });
      var months = {};
      var invoiced = 0, invCount = 0, stillOpen = 0;
      var rowsInvoiced = []; var rowsOpenInv = []; var rowsCollected = [];
      Object.keys(usInv).forEach(function (k) {
        var inv = usInv[k];
        if (!inv.invoice_date || inv.invoice_date < pFrom || inv.invoice_date > pTo) { return; }
        var amt = r2(inv.total_amount);
        invoiced = r2(invoiced + amt); invCount++;
        addM(months, monthOf(inv.invoice_date), 'invoiced', amt);
        var open = r2(amt - (Number(inv.wave_imported_paid) || 0) - (paidByP[inv.id] || 0));
        rowsInvoiced.push({ invoice_id: inv.id, ref: inv.invoice_number, rel: inv.release_number || null, who: nameByIdP[inv.accounting_customer_id] || '', date: inv.invoice_date, due: inv.due_date || null, total: amt, paid: r2(amt - open), open: open, amount: amt, source: 'Invoice dated in period' }); // PO: dates+balances visible
        if (open > 0.005) {
          stillOpen = r2(stillOpen + open);
          rowsOpenInv.push({ invoice_id: inv.id, ref: inv.invoice_number, rel: inv.release_number || null, who: nameByIdP[inv.accounting_customer_id] || '', date: inv.invoice_date, due: inv.due_date || null, total: amt, paid: r2(amt - open), open: open, amount: open, source: 'Unpaid balance of a period invoice' });
        }
      });
      // v55.83-PP (Max, 04:35): two DIFFERENT questions, kept apart:
      //   collected            = ALL payments received in the period (the
      //                          invoice may be older than the period)
      //   collected_on_period  = payments received in the period ON INVOICES
      //                          CREATED IN THE PERIOD (the cohort)
      var collected = 0, colCount = 0;
      var collectedCohort = 0, colCohortCount = 0; var rowsCollectedCohort = [];
      paysP.forEach(function (pp) {
        if (isPaymentVoid(pp)) { return; }
        var srcInv = usInv[pp.accounting_invoice_id];
        if (!srcInv) { return; }
        if (!pp.payment_date || pp.payment_date < pFrom || pp.payment_date > pTo) { return; }
        var amt2 = r2(pp.amount);
        collected = r2(collected + amt2); colCount++;
        addM(months, monthOf(pp.payment_date), 'collected', amt2);
        var invInPeriod = srcInv.invoice_date && srcInv.invoice_date >= pFrom && srcInv.invoice_date <= pTo;
        var rowC = { invoice_id: srcInv.id, ref: srcInv.invoice_number, rel: srcInv.release_number || null, who: nameByIdP[srcInv.accounting_customer_id] || '', date: pp.payment_date, due: srcInv.due_date || null, total: r2(srcInv.total_amount), amount: amt2,
          source: invInPeriod ? 'Payment on an invoice created in this period' : 'Payment on an OLDER invoice (dated ' + (srcInv.invoice_date || '?') + ')' };
        rowsCollected.push(rowC);
        if (invInPeriod) { collectedCohort = r2(collectedCohort + amt2); colCohortCount++; rowsCollectedCohort.push(rowC); }
      });
      // Bills side
      var LS = await loadBills(db);
      var allB = decorate(LS.bills, LS.pays);
      var billed = 0, billCount = 0, billsOpen = 0, billsDisputed = 0;
      var rowsBilled = []; var rowsOpenBills = []; var rowsBillsPaid = [];
      var billNameById = {}; allB.forEach(function (b) { billNameById[b.id] = b; });
      allB.forEach(function (b) {
        if (b.record_status !== 'active') { return; }
        if (b.bill_date && b.bill_date >= pFrom && b.bill_date <= pTo) {
          billed = r2(billed + (Number(b.total_amount) || 0)); billCount++;
          addM(months, monthOf(b.bill_date), 'billed', r2(b.total_amount));
          rowsBilled.push({ ref: b.bill_number || '—', who: b.vendor_name, date: b.bill_date, due: b.due_date || null, total: r2(b.total_amount), paid: r2(b.paid), open: r2(b.open), amount: r2(b.total_amount), source: b.disputed === true ? 'Bill (DISPUTED)' : 'Bill entered in period' });
          if (b.disputed === true) { billsDisputed = r2(billsDisputed + b.open); }
          else if (b.open > 0.005) {
            billsOpen = r2(billsOpen + b.open);
            rowsOpenBills.push({ ref: b.bill_number || '—', who: b.vendor_name, date: b.bill_date, due: b.due_date || null, total: r2(b.total_amount), paid: r2(b.paid), open: r2(b.open), amount: b.open, source: 'Unpaid balance of a period bill' });
          }
        }
      });
      var billsPaid = 0, billsPaidCount = 0;
      (LS.pays || []).forEach(function (bp) {
        if (bp.voided === true) { return; }
        if (!bp.paid_date || bp.paid_date < pFrom || bp.paid_date > pTo) { return; }
        billsPaid = r2(billsPaid + (Number(bp.amount) || 0)); billsPaidCount++;
        addM(months, monthOf(bp.paid_date), 'bills_paid', r2(bp.amount));
        var pb = billNameById[bp.bill_id] || {};
        rowsBillsPaid.push({ ref: pb.bill_number || '—', who: pb.vendor_name || '?', date: bp.paid_date, due: pb.due_date || null, total: r2(pb.total_amount), amount: r2(bp.amount), source: bp.bank_transaction_id ? 'Bill payment (bank-linked)' : 'Bill payment' });
      });
      var monthRows = Object.values(months).sort(function (a, b2) { return a.month.localeCompare(b2.month); });
      monthRows.forEach(function (m) { m.net = r2(m.collected - m.bills_paid); });
      // v55.83-PQ (Max, 05:05): "categorizing etc should affect the underlying
      // reports" — SPENDING BY CATEGORY: settled money-out in the period,
      // grouped by the category humans/rules picked. Transfers between own
      // accounts are their own line and NEVER counted as spending. Fail-soft
      // on the transfer column until the PQ SQL runs.
      var spend = null;
      try {
        // v55.83-PV (Max, Nov 7 10:34: "tax reports need data for all of 2026
        // to start") — Wave's API exposes no dated payment records, so the
        // bank feed IS the dated 2026 money record (both directions, cash
        // basis). Fetch in AND out; the income side mirrors the spending side.
        var spTx = await fetchAll(function () {
          return db.from('bank_transactions')
            .select('id, date, posted_date, amount_abs, name, merchant_name, classification, transfer_group_id, matched_invoice_id, direction')
            .eq('wave_business_id', US_WAVE_BUSINESS_ID).in('direction', ['in', 'out']).neq('pending', true)
            .gte('date', pFrom).lte('date', pTo).order('date', { ascending: false });
        });
        var catLabels = {}; var catKinds = {};
        try {
          var catsSp = await db.from('expense_categories').select('key, label, kind');
          (catsSp.data || []).forEach(function (c6) { catLabels[c6.key] = c6.label; catKinds[c6.key] = c6.kind || 'expense'; });
        } catch (eC) {}
        // v55.83-PW (Max): QuickBooks-style types. P&L kinds count toward
        // taxable income / deductible spending; not_pnl money (loan principal,
        // owner contributions) NEVER does — that is proper accounting.
        var kindOf = function (k0) { return catKinds[k0] || 'expense'; };
        var byCat = {}; var trf = { count: 0, total: 0 }; var unc = { count: 0, total: 0 }; var totOut = 0;
        var spRows = [];
        var byCatIn = {}; var trfIn = { count: 0, total: 0 }; var uncIn = { count: 0, total: 0 }; var totIn = 0;
        var inRows = [];
        spTx.forEach(function (t6) {
          var d6 = t6.posted_date || t6.date;
          if (!(d6 >= pFrom && d6 <= pTo)) { return; }
          var amt6 = r2(t6.amount_abs);
          var isTrf = !!t6.transfer_group_id || t6.classification === 'transfer';
          if (t6.direction === 'in') {
            // income side: an invoice-matched deposit counts as sales even
            // when nobody also set a classification on it.
            totIn = r2(totIn + amt6);
            var keyI = isTrf ? 'transfer' : (t6.matched_invoice_id ? 'customer_payment' : (t6.classification || null));
            if (inRows.length < 500) { inRows.push({ date: d6, who: t6.merchant_name || t6.name || '', amount: amt6, category: keyI || '', paired: !!t6.transfer_group_id }); }
            if (isTrf) { trfIn.count++; trfIn.total = r2(trfIn.total + amt6); return; }
            if (!keyI) { uncIn.count++; uncIn.total = r2(uncIn.total + amt6); return; }
            if (!byCatIn[keyI]) { byCatIn[keyI] = { key: keyI, label: catLabels[keyI] || keyI, kind: kindOf(keyI), count: 0, total: 0 }; }
            byCatIn[keyI].count++; byCatIn[keyI].total = r2(byCatIn[keyI].total + amt6);
            return;
          }
          totOut = r2(totOut + amt6);
          var key6 = isTrf ? 'transfer' : (t6.classification || null);
          if (spRows.length < 500) { spRows.push({ date: d6, who: t6.merchant_name || t6.name || '', amount: amt6, category: key6 || '', paired: !!t6.transfer_group_id }); }
          if (isTrf) { trf.count++; trf.total = r2(trf.total + amt6); return; }
          if (!key6) { unc.count++; unc.total = r2(unc.total + amt6); return; }
          if (!byCat[key6]) { byCat[key6] = { key: key6, label: catLabels[key6] || key6, kind: kindOf(key6), count: 0, total: 0 }; }
          byCat[key6].count++; byCat[key6].total = r2(byCat[key6].total + amt6);
        });
        var catRows = Object.values(byCat).sort(function (a6, b6) { return b6.total - a6.total; });
        var catRowsIn = Object.values(byCatIn).sort(function (a7, b7) { return b7.total - a7.total; });
        var notPnlOut = { count: 0, total: 0 }; var deductible = 0;
        catRows.forEach(function (c7) { if (c7.kind === 'not_pnl') { notPnlOut.count += c7.count; notPnlOut.total = r2(notPnlOut.total + c7.total); } else { deductible = r2(deductible + c7.total); } });
        var notPnlIn = { count: 0, total: 0 }; var taxable = 0;
        catRowsIn.forEach(function (c8) { if (c8.kind === 'not_pnl') { notPnlIn.count += c8.count; notPnlIn.total = r2(notPnlIn.total + c8.total); } else { taxable = r2(taxable + c8.total); } });
        // v55.83-QB — RTM third-party block. Payments = out-txns stamped
        // third_party_payer in the period; covered bills = method='rtm'
        // payments joined to their bill's category. The DEFAULT reports keep
        // the payment under its own category (ONE professional-fee line for
        // tax); the Stats radio re-buckets into the bills' REAL categories
        // client-side — both views total identically by construction.
        var rtmBlk = null;
        try {
          var rtmTx = await db.from('bank_transactions')
            .select('id, date, posted_date, amount_abs, classification, third_party_payer')
            .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out')
            .not('third_party_payer', 'is', null).neq('pending', true)
            .gte('date', pFrom).lte('date', pTo).limit(2000);
          if (!rtmTx.error) {
            var rtmPayTotal = 0; var rtmPayByCat = {}; var rtmPayCount = 0;
            (rtmTx.data || []).forEach(function (t9) {
              var d9 = t9.posted_date || t9.date;
              if (!(d9 >= pFrom && d9 <= pTo)) { return; }
              var a9 = r2(t9.amount_abs); rtmPayTotal = r2(rtmPayTotal + a9); rtmPayCount++;
              var k9 = t9.classification || 'uncategorized';
              if (!rtmPayByCat[k9]) { rtmPayByCat[k9] = { key: k9, label: catLabels[k9] || k9, total: 0 }; }
              rtmPayByCat[k9].total = r2(rtmPayByCat[k9].total + a9);
            });
            var rtmAllocByCat = {}; var rtmAllocTotal = 0; var rtmRows = [];
            (LS.pays || []).forEach(function (p9) {
              if (p9.method !== 'rtm' || p9.voided === true) { return; }
              if (!(p9.paid_date >= pFrom && p9.paid_date <= pTo)) { return; }
              var b9 = billNameById[p9.bill_id];
              var k10 = (b9 && b9.category) || 'uncategorized';
              var am9 = r2(p9.amount);
              if (!rtmAllocByCat[k10]) { rtmAllocByCat[k10] = { key: k10, label: catLabels[k10] || k10, kind: kindOf(k10), count: 0, total: 0 }; }
              rtmAllocByCat[k10].count++; rtmAllocByCat[k10].total = r2(rtmAllocByCat[k10].total + am9);
              rtmAllocTotal = r2(rtmAllocTotal + am9);
              if (rtmRows.length < 300) { rtmRows.push({ date: p9.paid_date, who: (b9 && b9.vendor_name) || '(bill)', ref: (b9 && b9.bill_number) || '—', category: k10, amount: am9 }); }
            });
            if (rtmPayCount > 0 || rtmAllocTotal > 0) {
              rtmBlk = { payer: 'RTM Capital', payments_total: rtmPayTotal, payments_count: rtmPayCount,
                payments_by_cat: Object.keys(rtmPayByCat).map(function (k) { return rtmPayByCat[k]; }),
                allocations_by_cat: Object.keys(rtmAllocByCat).map(function (k) { return rtmAllocByCat[k]; }).sort(function (x, y) { return y.total - x.total; }),
                allocations_total: rtmAllocTotal, service_fee: r2(rtmPayTotal - rtmAllocTotal), rows: rtmRows };
            }
          }
        } catch (eR9) { rtmBlk = null; }
        spend = { rtm: rtmBlk, categories: catRows, transfers: trf, uncategorized: unc, total_out: totOut,
          real_spending: r2(totOut - trf.total), rows: spRows,
          deductible_spending: deductible, not_pnl_out: notPnlOut,
          in_categories: catRowsIn, in_transfers: trfIn, in_uncategorized: uncIn, total_in: totIn,
          real_income: r2(totIn - trfIn.total), in_rows: inRows,
          taxable_income: taxable, not_pnl_in: notPnlIn };
      } catch (eSp) { spend = null; }
      var psPayload = {
        invoices: { invoiced: invoiced, count: invCount, collected: collected, collected_count: colCount, collected_on_period: collectedCohort, collected_on_period_count: colCohortCount, still_open_from_period: stillOpen },
        bills: { billed: billed, count: billCount, paid: billsPaid, paid_count: billsPaidCount, still_open_from_period: billsOpen, disputed_open: billsDisputed },
        months: monthRows,
        spending: spend,
        // drill rows: every card's exact underlying records ("show where these numbers came from")
        drills: { invoiced: rowsInvoiced, collected: rowsCollected, collected_on_period: rowsCollectedCohort, open_invoices: rowsOpenInv,
                  billed: rowsBilled, bills_paid: rowsBillsPaid, open_bills: rowsOpenBills } };
      if (!canTotals) { psPayload = maskVis(psPayload, false); }
      psPayload.totals_masked = !canTotals; psPayload.rows_visible = canRows; psPayload.date_filters_locked = pLocked;
      psPayload.from = pFrom; psPayload.to = pTo; psPayload.ok = true; psPayload.marker = API_BUILD_MARKER;
      return NextResponse.json(psPayload);
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'Bills request failed.' }, { status: 500 });
  }
}
