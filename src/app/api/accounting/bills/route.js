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
    bills = await fetchAll(function () {
      return db.from('vendor_bills')
        .select('id, vendor_name, bill_number, bill_date, due_date, currency, total_amount, category, notes, record_status, created_at, attachment_path, validation_status, validated_by, validated_at, validation_notes, disputed, dispute_ticket_id, dispute_reason')
        .order('due_date', { ascending: true, nullsFirst: false });
    });
  } catch (ePC) {
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
function isPayable(b) { return b.record_status === 'active' && b.disputed !== true && b.open > 0.005; }

// Canonical open AR per invoice (same formula as the dashboard/Open Balances),
// US business only, live + AR-eligible.
async function loadOpenUsInvoices(db) {
  var invs = await fetchAll(function () {
    return db.from('accounting_invoices')
      .select('id, invoice_number, invoice_date, due_date, currency, total_amount, wave_imported_paid, record_status, approval_status, wave_status, wave_invoice_id, wave_business_id, source, accounting_customer_id')
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
      id: inv.id, invoice_number: inv.invoice_number, customer: nameById[inv.accounting_customer_id] || '',
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

    var WRITE_ACTIONS = { save_bill: 1, void_bill: 1, record_payment: 1, void_payment: 1, extract_bill: 1, validate_bill: 1, reopen_validation: 1, dispute_bill: 1, resolve_dispute: 1 };
    var permKey = WRITE_ACTIONS[action] ? 'bills.manage' : 'bills.view';
    var gate = await assertPermission(db, userId, permKey, req);
    if (!gate || gate.ok !== true) {
      return NextResponse.json({ error: 'This needs the "' + (permKey === 'bills.manage' ? 'Bills: Manage' : 'Bills: View') + '" permission — grant it in Settings → Permissions.' }, { status: gate && gate.status ? gate.status : 403 });
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
      if (bl.id) {
        var cur = await db.from('vendor_bills').select('id, record_status, total_amount').eq('id', bl.id).maybeSingle();
        if (cur.error || !cur.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
        if (cur.data.record_status !== 'active') { return NextResponse.json({ error: 'This bill is void — it cannot be edited.' }, { status: 409 }); }
        var payR = await db.from('vendor_bill_payments').select('id, bill_id, amount, voided').eq('bill_id', bl.id);
        var paidSoFar = 0; (payR.data || []).forEach(function (p) { if (p.voided !== true) { paidSoFar += Number(p.amount) || 0; } });
        if (amt + 0.005 < paidSoFar) { return NextResponse.json({ error: 'Amount cannot be below what is already paid (' + r2(paidSoFar).toFixed(2) + '). Void the payments first.' }, { status: 409 }); }
        var up = await db.from('vendor_bills').update(fields).eq('id', bl.id).select('id').maybeSingle();
        if (up.error) { throw new Error(up.error.message); }
        var learnedU = null;
        if (fields.category) { learnedU = await learnRule(db, vendor, fields.category, userId); } // v55.83-PJ — a changed pick updates the rule
        return NextResponse.json({ ok: true, id: bl.id, updated: true, rule_learned: learnedU });
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
      var expAllL = openInvs
        .filter(function (v) { var d2 = v.due_date || v.invoice_date; return d2 && d2 >= fromD && d2 <= toD; })
        .map(function (v) { return { ref: v.invoice_number || v.id, who: v.customer || '', date: v.invoice_date, due: v.due_date || null, total: v.total, paid: v.paid, open: r2(v.open_balance), amount: r2(v.open_balance), source: 'Open invoice · due ' + (v.due_date || '(invoice date ' + v.invoice_date + ')') }; })
        .sort(byAmtL);
      var sumExpL = 0; expAllL.forEach(function (r3) { sumExpL += r3.amount; });
      var billRowsL = dueBills
        .map(function (b4) { return { ref: b4.bill_number || b4.id, who: b4.vendor_name || '', date: b4.due_date, amount: r2(b4.open), source: 'Open bill' + (b4.category ? ' · ' + b4.category : '') }; })
        .sort(byAmtL);
      var sumBillL = 0; billRowsL.forEach(function (r4) { sumBillL += r4.amount; });
      var drillsL = {
        sales_in: { count: salesRowsL.length, sum: r2(sumSalesL), rows: salesRowsL.slice(0, CAPL) },
        came_in: { count: inRowsL.length, sum: r2(sumInL), rows: inRowsL.slice(0, CAPL) },
        went_out: { count: outRowsL.length, sum: r2(sumOutL), rows: outRowsL.slice(0, CAPL) },
        expected_in: { count: expAllL.length, sum: r2(sumExpL), rows: expAllL.slice(0, CAPL) },
        bills_due: { count: billRowsL.length, sum: r2(sumBillL), rows: billRowsL.slice(0, CAPL) },
      };
      return NextResponse.json({ ok: true, marker: API_BUILD_MARKER, from: fromD, to: toD, summary: summary, sales_in: r2(sumSalesL), sales_in_count: salesRowsL.length, bills_due: dueBills, expected_in: expIn, drills: drillsL });
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

    // ── forecast: aging buckets in/out + drill rows + unflagged counts
    // (Max: "what's coming in the next 30 days, 30-60, 60-90, 90 plus...
    //  bills we owe same thing... shortages... click the cards to see the
    //  underlying numbers and where they're coming from")
    if (action === 'forecast') {
      var todayF = new Date().toISOString().substring(0, 10);
      var openInvsF = await loadOpenUsInvoices(db);
      var LF = await loadBills(db);
      var openBillsF = decorate(LF.bills, LF.pays).filter(isPayable);
      var buckets = forecastBuckets(openInvsF, openBillsF, todayF);
      var rows = tagRows(openInvsF, openBillsF, todayF);
      var unrevOut = await db.from('bank_transactions').select('id', { count: 'exact', head: true })
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out').eq('review_status', 'unreviewed').neq('pending', true);
      var unmatchedIn = await db.from('bank_transactions').select('id', { count: 'exact', head: true })
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'in').eq('review_status', 'unreviewed').is('matched_invoice_id', null).neq('pending', true);
      return NextResponse.json({ ok: true, marker: API_BUILD_MARKER, today: todayF,
        bucket_order: BUCKETS, buckets: buckets, rows: rows,
        unflagged: { expenses: unrevOut.count || 0, deposits: unmatchedIn.count || 0 } });
    }

    // ── period_stats (PH): "a tab from june 1st on for both invoices and
    // bills to see stats" — one period, both sides, monthly breakdown.
    if (action === 'period_stats') {
      var pFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || '')) ? body.from : '2026-06-01';
      var pTo = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to || '')) ? body.to : new Date().toISOString().substring(0, 10);
      function monthOf(d) { return String(d || '').substring(0, 7); }
      function addM(map, m, key, amt) {
        if (!m || m.length !== 7) { return; }
        if (!map[m]) { map[m] = { month: m, invoiced: 0, invoiced_count: 0, collected: 0, collected_count: 0, billed: 0, billed_count: 0, bills_paid: 0, bills_paid_count: 0 }; }
        map[m][key] = r2(map[m][key] + amt); map[m][key + '_count']++;
      }
      // Invoices side (US, canonical eligibility; all invoices in period, not just open)
      var invsP = await fetchAll(function () {
        return db.from('accounting_invoices')
          .select('id, invoice_number, invoice_date, due_date, currency, total_amount, wave_imported_paid, record_status, approval_status, wave_status, wave_invoice_id, wave_business_id, source, accounting_customer_id')
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
        rowsInvoiced.push({ ref: inv.invoice_number, who: nameByIdP[inv.accounting_customer_id] || '', date: inv.invoice_date, due: inv.due_date || null, total: amt, paid: r2(amt - open), open: open, amount: amt, source: 'Invoice dated in period' }); // PO: dates+balances visible
        if (open > 0.005) {
          stillOpen = r2(stillOpen + open);
          rowsOpenInv.push({ ref: inv.invoice_number, who: nameByIdP[inv.accounting_customer_id] || '', date: inv.invoice_date, due: inv.due_date || null, total: amt, paid: r2(amt - open), open: open, amount: open, source: 'Unpaid balance of a period invoice' });
        }
      });
      var collected = 0, colCount = 0;
      paysP.forEach(function (pp) {
        if (isPaymentVoid(pp)) { return; }
        var srcInv = usInv[pp.accounting_invoice_id];
        if (!srcInv) { return; }
        if (!pp.payment_date || pp.payment_date < pFrom || pp.payment_date > pTo) { return; }
        var amt2 = r2(pp.amount);
        collected = r2(collected + amt2); colCount++;
        addM(months, monthOf(pp.payment_date), 'collected', amt2);
        rowsCollected.push({ ref: srcInv.invoice_number, who: nameByIdP[srcInv.accounting_customer_id] || '', date: pp.payment_date, due: srcInv.due_date || null, total: r2(srcInv.total_amount), amount: amt2, source: 'Payment received in period' });
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
      return NextResponse.json({ ok: true, marker: API_BUILD_MARKER, from: pFrom, to: pTo,
        invoices: { invoiced: invoiced, count: invCount, collected: collected, collected_count: colCount, still_open_from_period: stillOpen },
        bills: { billed: billed, count: billCount, paid: billsPaid, paid_count: billsPaidCount, still_open_from_period: billsOpen, disputed_open: billsDisputed },
        months: monthRows,
        // drill rows: every card's exact underlying records ("show where these numbers came from")
        drills: { invoiced: rowsInvoiced, collected: rowsCollected, open_invoices: rowsOpenInv,
                  billed: rowsBilled, bills_paid: rowsBillsPaid, open_bills: rowsOpenBills } });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'Bills request failed.' }, { status: 500 });
  }
}
