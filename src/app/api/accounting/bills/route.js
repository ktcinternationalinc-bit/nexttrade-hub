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
import { buildPaidThroughBlocks } from '../../../../lib/paid-through-blocks';
import { FUNDING_DESTINATIONS, fundingIdentity, STARTING_BALANCE_TAX_FROM, hiddenStartingBalances, partyFundsForViewer, HIDDEN_STARTING_BALANCE_REASON } from '../../../../lib/party-funds'; // v55.83-VY — the ONE identity rule · v55.83-XO — the starting-balance tax date
import { loadPartyFunds, isMissingOpeningsTable, openingsUnavailable } from '../../../../lib/party-funds-server'; // v55.83-VY — reads the records and runs the ONE funds calculation // v55.83-SR
// v55.83-WF step C — periodAdjustments (the TX tax adjustments) is no longer used here: a transfer to RTM / NextTrade counts once, in full
import { NextResponse } from 'next/server';
import { assertPermission } from '../../../../lib/server-permissions';
import { createClient } from '@supabase/supabase-js';
import { businessOfInvoice, US_WAVE_BUSINESS_ID } from '../../../../lib/business-of';
import { isArEligible } from '../../../../lib/ar-eligibility';
import { isPaymentVoid } from '../../../../lib/payment-matching';
import { billOpenBalance, billStatus, cashflowSummary } from '../../../../lib/cashflow';
import { forecastBuckets, tagRows, BUCKETS } from '../../../../lib/aging';
import { readBillFromBase64, insertImportedBill, vendorBillType, findExactSameBill, exactDupMessage } from '../../../../lib/bill-extract-server';
import { exactSameWords } from '../../../../lib/bill-dup-scan'; // v55.83-UQ
import { importSort, BILL_TYPE_LABEL } from '../../../../lib/bill-extract';
import { saveBillLines, runPriceCheck, loadLines, loadPriceRules, loadCommissionRules, recheckOpenBills } from '../../../../lib/bill-lines-server'; // v55.83-RQ
import { commissionRuleFor, productInventory, spendReport, periodRange, normText, shapeLine, priceCheck as priceCheckPure, defaultDirectionFor } from '../../../../lib/bill-lines';
import { billDupVerdict } from '../../../../lib/bill-dup-server'; // v55.83-QH
import { scanBills, checkOne, pairKey } from '../../../../lib/bill-dup-scan'; // v55.83-SV — every bill compared with every other bill
import { audit } from '../../../../lib/audit-server'; // v55.83-QI
import { bankLineRemaining, checkBankPayment } from '../../../../lib/bill-bank-pay'; // v55.83-TH
import { addAuditSubjects, billName, bankName } from '../../../../lib/audit-subjects-server'; // v55.83-TH
import { billWireStates, wireStateWords } from '../../../../lib/bill-wire-state'; // v55.83-RZ
import { verifiedCaller } from '../../../../lib/verified-caller';
import { privateScope, dropPrivate, isPrivateRow } from '../../../../lib/private-accounts-server'; // v55.83-TP — private bank accounts // v55.83-TO (Codex P1: verified identity for money actions)
import { autoReviewIfComplete } from '../../../../lib/bank-allocation-server'; // v55.83-QZ2 — review fix
import { maskCashflow, maskPeriodStats, maskForecast } from '../../../../lib/accounting-access'; // v55.83-RE — unified accounting permissions

// v55.83-QO (Max 15:53: "attempted to add bill from document and nothing
// happened") — the AI read of a multi-page PDF outlives Vercel's DEFAULT
// 10s function limit, which killed the request mid-read. 60s fixes it.
export const maxDuration = 60;
import { learnRule } from '../../../../lib/expense-rules-server'; // v55.83-PJ — bills remember vendor categories
import { PENDING_REFUSAL } from '../../../../lib/pending-guard'; // v55.83-XT
import { categoryForNewBill, loadBillRules, provenanceFields } from '../../../../lib/bill-rules-server'; // v55.83-WX — bill category rules first, then the vendor memory

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

// v55.83-SV — pairs a person marked "not a duplicate" (kept as bill events; nothing is ever removed).
async function loadDupDismissed(db) {
  var out = {};
  try {
    var evs = await fetchAll(function () { return db.from('vendor_bill_events').select('bill_id, details').eq('kind', 'dup_dismissed'); });
    evs.forEach(function (e) { var o = e && e.details && e.details.other_id; if (o) { out[pairKey(e.bill_id, o)] = true; } });
  } catch (eDD) { /* events table missing — nothing dismissed */ }
  return out;
}

async function loadBills(db) {
  var bills;
  try {
    // v55.83-QB — paid_via: which third party (RTM Capital) pays this bill.
    // v55.83-RL — + the other reference and inbound / outbound (falls back to the RK set until the RL SQL is run)
    try {
      try { // v55.83-RP — + bill type and where the type / direction came from
        try { // v55.83-WX — + where the category came from (a person, a bill rule, the vendor memory)
          bills = await fetchAll(function () {
            return db.from('vendor_bills')
              .select('id, vendor_name, bill_number, bill_date, due_date, currency, total_amount, category, notes, record_status, created_at, attachment_path, validation_status, validated_by, validated_at, validation_notes, disputed, dispute_ticket_id, dispute_reason, paid_via, release_number, other_reference, shipment_direction, bill_type, bill_type_source, direction_source, category_source, category_rule_id, category_rule_version')
              .order('due_date', { ascending: true, nullsFirst: false });
          });
        } catch (eWX) {
          bills = await fetchAll(function () {
            return db.from('vendor_bills')
              .select('id, vendor_name, bill_number, bill_date, due_date, currency, total_amount, category, notes, record_status, created_at, attachment_path, validation_status, validated_by, validated_at, validation_notes, disputed, dispute_ticket_id, dispute_reason, paid_via, release_number, other_reference, shipment_direction, bill_type, bill_type_source, direction_source')
              .order('due_date', { ascending: true, nullsFirst: false });
          });
        }
      } catch (eRP) {
        bills = await fetchAll(function () {
          return db.from('vendor_bills')
            .select('id, vendor_name, bill_number, bill_date, due_date, currency, total_amount, category, notes, record_status, created_at, attachment_path, validation_status, validated_by, validated_at, validation_notes, disputed, dispute_ticket_id, dispute_reason, paid_via, release_number, other_reference, shipment_direction')
            .order('due_date', { ascending: true, nullsFirst: false });
        });
      }
    } catch (eRL) {
      bills = await fetchAll(function () {
        return db.from('vendor_bills')
          .select('id, vendor_name, bill_number, bill_date, due_date, currency, total_amount, category, notes, record_status, created_at, attachment_path, validation_status, validated_by, validated_at, validation_notes, disputed, dispute_ticket_id, dispute_reason, paid_via, release_number')
          .order('due_date', { ascending: true, nullsFirst: false });
      });
    }
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
  // v55.83-RY — a DELETED bill is gone from the Hub (its row + audit trail stay in the database)
  var delIds = {}; bills = (bills || []).filter(function (b) { if (b.record_status === 'deleted') { delIds[b.id] = true; return false; } return true; });
  pays = (pays || []).filter(function (p) { return !delIds[p.bill_id]; });
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
// v55.83-QZ2 (review fix) — see record_payment. Returns { category, reviewed } or null.
async function carryBillCategory(db, bankId, userId) {
  var tq = await db.from('bank_transactions').select('id, classification, third_party_payer, transfer_group_id, review_status, amount_abs').eq('id', bankId).maybeSingle();
  var t0 = tq && tq.data;
  if (!t0 || t0.classification || t0.third_party_payer || t0.transfer_group_id || t0.review_status === 'duplicate') { return null; }
  var pq = await db.from('vendor_bill_payments').select('bill_id, amount, voided, method').eq('bank_transaction_id', bankId);
  var live = ((pq && pq.data) || []).filter(function (p) { return p.voided !== true; });
  if (!live.length || live.some(function (p) { return p.method === 'rtm'; })) { return null; }
  var bq = await db.from('vendor_bills').select('id, category').in('id', live.map(function (p) { return p.bill_id; }));
  var cats = {}; var missing = false;
  ((bq && bq.data) || []).forEach(function (b) { if (b.category) { cats[b.category] = true; } else { missing = true; } });
  var keys = Object.keys(cats);
  if (missing || keys.length !== 1) { return null; } // mixed or blank → the person picks (or splits)
  var ck = await db.from('expense_categories').select('key').eq('key', keys[0]).limit(1);
  if (ck.error || !ck.data || !ck.data.length) { return null; }
  var up = await db.from('bank_transactions').update({ classification: keys[0], category_source: 'classification', updated_by: userId || null })
    .eq('id', bankId).is('classification', null).select('id');
  if (up.error || !up.data || !up.data.length) { return null; }
  var paid = 0; live.forEach(function (p) { paid += Number(p.amount) || 0; });
  var reviewed = false;
  if (Math.abs(r2(paid) - r2(t0.amount_abs)) <= 0.01) { reviewed = (await autoReviewIfComplete(db, [bankId], userId)).length > 0; }
  return { category: keys[0], reviewed: reviewed };
}

// v55.83-QY — paid-through companies (RTM Capital, NextTrade Industries).
// Read from paid_through_parties; if the QY SQL is not run yet, the two
// known parties are used so nothing breaks.
var PARTY_DEFAULTS = [
  { name: 'RTM Capital', kind: 'service_provider', remainder_label: 'RTM service fee (payments − covered bills)', active: true, sort: 10 },
  { name: 'NextTrade Industries', kind: 'affiliate', remainder_label: 'Advance with NextTrade — awaiting its costs (not an expense yet)', active: true, sort: 20 },
];
async function loadParties(db) {
  try {
    // v55.83-SR — provider_from: from that date the company is one line by category, broken down underneath
    var pr = await db.from('paid_through_parties').select('name, kind, remainder_label, active, sort, provider_from').eq('active', true).order('sort');
    if (pr.error) { pr = await db.from('paid_through_parties').select('name, kind, remainder_label, active, sort').eq('active', true).order('sort'); } // SR SQL not run yet → exactly as before
    if (!pr.error && pr.data && pr.data.length) { return pr.data; }
  } catch (eP) {}
  return PARTY_DEFAULTS;
}
function partyKey(x) { return String(x || '').trim().toLowerCase(); }
// Payable = active, open, and NOT disputed (Max: disputed bills are excluded
// from what-we-owe totals until the dispute resolves).
// v55.83-QB: via-RTM bills are paid by the third party, never from our bank —
// they stay OUT of what-we-owe totals, cash forecasts and shortage math.
// v55.83-RJ (wire review gaps 1–3) — the prepared wire a bill sits on (open line), or null. Fail-soft before the RH SQL.
async function openWireOf(db, billId) {
  try {
    var ol = await db.from('wire_package_lines').select('package_id').eq('bill_id', billId).eq('is_open', true).limit(1);
    if (ol.error || !ol.data || !ol.data.length) { return null; }
    var wp = await db.from('wire_packages').select('seq, status').eq('id', ol.data[0].package_id).maybeSingle();
    if (!wp || !wp.data || wp.data.status === 'cancelled') { return null; }
    return { label: 'WP-' + String(wp.data.seq || 0).padStart(4, '0'), status: wp.data.status };
  } catch (eW) { return null; }
}
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
    // v55.83-WQ (Codex 21 Nov, F3) — EVERY action acts only for the verified signed-in person (bearer token), never for a user_id in the request.
    var whoWQ = await verifiedCaller(req, body, createClient);
    if (whoWQ.error) { return NextResponse.json({ error: whoWQ.error }, { status: whoWQ.status || 401 }); }
    var userId = whoWQ.userId;
    // v55.83-TO (Codex QA 16 Nov, P1) — the actions that MOVE MONEY act only for the verified signed-in person (bearer token);
    // a user_id in the request that is not that person is refused.
    var MONEY_ACTIONS = { record_payment: 1, void_payment: 1, pay_bills_from_bank: 1, bank_lines_for_bills: 1 };
    // the database guards (sql/v55-83-TO-payment-guards.sql) lock the bank line and the bill and refuse any over-payment, for every
    // writer at once. Until they are installed, no bill payment is written here.
    // v55.83-WF (Max: "follow the same protocol as other wires"; Codex 21 Nov 09:05: keep ordinary Pay on company funding routed to
    // Wires → New, and give reconciliation its OWN action). Once Funds-with-company is in the database, money sent to RTM / NextTrade
    // (stamped, or recognised only from its bank text — the ONE identity rule) is never paid from here, confirmed or not:
    //   • new bills → a request to the company (two signatures);
    //   • bills the company ALREADY paid out of it → Bills → Funds with the company → Record bills already paid (before confirming).
    // The database refuses it too (hub_party_payment_route). Direct payments from our bank to a vendor are unchanged; before the step, unchanged.
    async function companyFundsBlock(line) {
      if (!line || line.direction !== 'out' || line.transfer_group_id) { return null; }
      var who = fundingIdentity({ direction: 'out', third_party_payer: line.third_party_payer, name: line.name, merchant_name: line.merchant_name });
      if (!who) { return null; }
      var on = false; try { var wfI = await db.rpc('hub_party_funds_installed'); on = !wfI.error && wfI.data === true; } catch (eWf) { on = false; }
      if (!on) { return null; }
      return NextResponse.json({ error: 'This bank line is money sent to ' + who.payer + (who.basis === 'bank_text' ? ' (recognised from its bank text)' : '') + '. It is not paid from here. New bills: Wires → New → ' + who.payer + ', pick this transfer (the same two signatures as every wire). Bills ' + who.payer + ' ALREADY paid out of it: Bills → 💰 Funds with ' + who.payer + ' → 📎 Record bills already paid' + (who.basis === 'bank_text' ? ' (mark the line as sent to ' + who.payer + ' first, in All Transactions)' : '') + '. Nothing was recorded.', blocked_by: 'company funds' }, { status: 409 });
    }
    async function guardsReady() { try { var gR0 = await db.rpc('hub_payment_guards_installed'); return !gR0.error && gR0.data === true; } catch (eG0) { return false; } }
    var GUARD_OFF = 'Paying bills is switched off until the payment safety update is installed: run sql/v55-83-TO-payment-guards.sql in Supabase (SQL Editor). It makes sure a bank line or a bill can never be paid twice, even when two people click at the same moment.';
    function guardErr(e) {
      var m0 = String((e && e.message) || '');
      if (/HUB_GUARD:/.test(m0)) { return NextResponse.json({ error: 'Not saved — ' + m0.replace(/^[\s\S]*HUB_GUARD:\s*/, '') + ' Nothing was paid. Refresh: someone may have just paid from it.' }, { status: 409 }); }
      if ((e && e.code === '23505') || /_request/.test(m0)) { return null; } // the same click arrived twice — the first one stands
      return NextResponse.json({ error: 'Not saved (' + (m0 || 'database error') + '). Nothing was paid.' }, { status: 500 });
    }
    function readFail(what, e) { return NextResponse.json({ error: 'Could not read ' + what + ' (' + ((e && e.message) || 'error') + ') — nothing was paid. Try again in a moment.' }, { status: 503 }); }
    function missingRel(e) { return /does not exist|schema cache|Could not find the table/i.test(String((e && e.message) || '')); }
    function reqIdOf(b0) { var v0 = b0 && typeof b0.request_id === 'string' ? b0.request_id.trim() : ''; return v0.length >= 8 ? v0.substring(0, 80) : null; }

    var WRITE_ACTIONS = { pay_bills_from_bank: 1, bank_lines_for_bills: 1, save_bill: 1, void_bill: 1, record_payment: 1, void_payment: 1, extract_bill: 1, validate_bill: 1, reopen_validation: 1, dispute_bill: 1, resolve_dispute: 1, rtm_flag: 1, advance_flag: 1, ingest_bill_file: 1, delete_bill: 1, save_lines: 1, price_check: 1, save_validation_progress: 1, price_rule_save: 1, price_rule_off: 1, commission_rule_save: 1, attach_bill_file: 1, dismiss_bill_dup: 1 }; // RQ: lines + price rules — v55.83-QB/QF/QG
    // v55.83-PW (Max, 10:56): three clear LEVELS. Writes still need
    // Bills: Manage. READS accept ANY totals-level permission — the explicit
    // "Accounting: See Money Totals" (ACCT-008), or the older Bills/AR views
    // (backward compatible: nobody loses access they had yesterday).
    // v55.83-RE (Max, Nov 8 15:12 — Unified Accounting Permissions): P1
    // "Accounting Access" is REQUIRED before any other accounting permission
    // takes effect. Reads need P1; writes need P1 + Bills: Manage; the Bills
    // list itself also needs Bills: View/Manage.
    var gate = await assertPermission(db, userId, 'accounting.view', req);
    if (!gate || gate.ok !== true) {
      return NextResponse.json({ error: 'This needs "Accounting Access" (P1) — grant it in Settings → 🏦 Banking & Accounting Access.' }, { status: gate && gate.status ? gate.status : 403 });
    }
    var READ_LIKE_LIST = { list: 1, bill_lines: 1, price_rules_list: 1, bill_reports: 1, bill_history: 1 }; // v55.83-RQ · TH bill_history
    if (WRITE_ACTIONS[action] || READ_LIKE_LIST[action]) {
      var gate2 = await assertPermission(db, userId, 'bills.manage', req);
      if ((!gate2 || gate2.ok !== true) && !WRITE_ACTIONS[action]) { gate2 = await assertPermission(db, userId, 'bills.view', req); }
      if (!gate2 || gate2.ok !== true) {
        return NextResponse.json({ error: 'This needs the "' + (WRITE_ACTIONS[action] ? 'Bills: Manage' : 'Bills: View') + '" permission — grant it in Settings → 🏦 Banking & Accounting Access.' }, { status: gate2 && gate2.status ? gate2.status : 403 });
      }
    }
    // v55.83-RQ — a saved bill's lines (if the form sent them) + the Hub's price check
    async function linesAfterSave(billId, blIn) {
      try {
        var bb = await db.from('vendor_bills').select('*').eq('id', billId).maybeSingle();
        if (!bb.data) { return {}; }
        if (Array.isArray(blIn.lines)) {
          var sl = await saveBillLines(db, bb.data, blIn.lines, blIn._imported ? 'read_from_bill' : 'manual', userId);
          if (!sl.ok) { return { warning: 'The bill was saved, but its lines were not: ' + sl.error + (sl.sql_missing ? ' — run sql/v55-83-RQ-bill-lines-price-rules.sql.' : '') }; }
          await audit(db, userId, 'bill_lines_saved', 'vendor_bill', billId, { lines: sl.lines.length, commission_vendor: sl.commission_rule ? sl.commission_rule.vendor_match : null });
        }
        var pc = await runPriceCheck(db, billId);
        return { check: pc && pc.check ? pc.check : null };
      } catch (eLS) { return { warning: 'The bill was saved; the lines / price check could not run (' + ((eLS && eLS.message) || 'error') + ').' }; }
    }
    async function rulesGate() {
      var gR = await assertPermission(db, userId, 'bills.price_rules', req);
      return !!(gR && gR.ok === true);
    }

    // v55.83-QI (Max 12:33/12:35) — three visibility levels, resolved ONCE:
    //   canTotals — sees the numbers on cards (accounting.view_totals);
    //   canRows   — totals masked ••• but can open cards and see rows
    //               (accounting.view_underlying);
    //   canDates  — may move date filters beyond the defaults
    //               (accounting.change_dates). Super admin passes all.
    var visT = await assertPermission(db, userId, 'accounting.view_totals', req);
    var canTotals = !!visT.ok;
    var canRows = true; // v55.83-RE — card navigation is decided per card group, never blanket-blocked
    var visI = await assertPermission(db, userId, 'accounting.view_invoicing', req);
    var vis = { access: true, fin: canTotals, inv: !!visI.ok, ops: true }; // P1 already passed above
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
      var L = await loadBills(db); var enrichWarn = []; // v55.83-WT
      var rows = decorate(L.bills, L.pays);
      var totals = { open: 0, overdue: 0, open_count: 0 };
      var today = new Date().toISOString().substring(0, 10);
      rows.forEach(function (b) {
        if (!isPayable(b)) { return; }
        totals.open = r2(totals.open + b.open); totals.open_count++;
        if (b.due_date && b.due_date < today) { totals.overdue = r2(totals.overdue + b.open); }
      });
      // v55.83-RQ — the price check on each bill (nothing breaks before the RQ SQL is run)
      try {
        var pcR = await fetchAll(function () { return db.from('vendor_bills').select('id, price_check_status, price_check, price_resolved_note, price_resolved_by, price_resolved_at'); });
        try { var drR = await fetchAll(function () { return db.from('vendor_bills').select('id, validation_draft').not('validation_draft', 'is', null); }); var drBy = {}; drR.forEach(function (x) { drBy[x.id] = x.validation_draft; }); rows.forEach(function (b) { if (drBy[b.id]) { b.validation_draft = drBy[b.id]; } }); } catch (eDR) { /* RU SQL not run */ }
        var pcBy = {}; pcR.forEach(function (x) { pcBy[x.id] = x; });
        rows.forEach(function (b) { var x = pcBy[b.id]; if (x) { b.price_check_status = x.price_check_status; b.price_check = x.price_check; b.price_resolved_note = x.price_resolved_note; b.price_resolved_by = x.price_resolved_by; b.price_resolved_at = x.price_resolved_at; } });
      } catch (ePC) { /* RQ SQL not run yet */ }
      try { var ddCR = await loadCommissionRules(db); rows.forEach(function (b) { var dd = defaultDirectionFor(ddCR, b.vendor_name); if (dd) { b.default_direction = dd; } }); } catch (eDD) { /* RW */ }
      // v55.83-RZ — each bill's wire step: OPEN (on a wire being signed) → READY (both signatures) → SENT → PAID once the bank line is matched
      try {
        var wlRows = await fetchAll(function () { return db.from('wire_package_lines').select('*').eq('is_open', true); }); // v55.83-SB (bug review 7) — paged
        var wpIds = []; wlRows.forEach(function (l) { if (wpIds.indexOf(l.package_id) < 0) { wpIds.push(l.package_id); } });
        if (wpIds.length) {
          var wpR = await db.from('wire_packages').select('*').in('id', wpIds);
          var allWL = await db.from('wire_package_lines').select('*').in('package_id', wpIds);
          var billById = {}; rows.forEach(function (b) { billById[b.id] = b; });
          var wsBy = billWireStates((wpR && wpR.data) || [], (allWL && allWL.data) || [], billById);
          rows.forEach(function (b) { var ws = wsBy[b.id]; if (ws) { b.wire_state = ws; b.wire_state_words = wireStateWords(ws, b.open); } });
        }
      } catch (eWS) { enrichWarn.push('which bills are on a wire being prepared / sent could not be loaded (' + ((eWS && eWS.message) || 'error') + ')'); } // v55.83-WT (Codex 21 Nov) — said, never silent
      // v55.83-SU — link from a bill to the wire / request that paid it (a bill paid in parts can have several)
      try {
        var paidWL = await fetchAll(function () { return db.from('wire_package_lines').select('bill_id, package_id, amount, payment_id, is_open').eq('is_open', false); });
        paidWL = paidWL.filter(function (l) { return !!l.payment_id; });
        var pwIds = []; paidWL.forEach(function (l) { if (pwIds.indexOf(l.package_id) < 0) { pwIds.push(l.package_id); } });
        var pwBy = {};
        for (var pwi = 0; pwi < pwIds.length; pwi += 200) {
          var pwq = await db.from('wire_packages').select('id, seq, status, payee_name, funding_txn_id').in('id', pwIds.slice(pwi, pwi + 200));
          if (pwq.error) { break; }
          (pwq.data || []).forEach(function (w) { pwBy[w.id] = w; });
        }
        var byBillW = {};
        paidWL.forEach(function (l) { var w = pwBy[l.package_id]; if (!w || w.status !== 'attached') { return; }
          (byBillW[l.bill_id] = byBillW[l.bill_id] || []).push({ kind: 'package', id: w.id, label: 'WP-' + String(w.seq || 0).padStart(4, '0'), status: w.status, payee: w.payee_name, request: !!w.funding_txn_id, amount: r2(l.amount), payment_id: l.payment_id }); }); // v55.83-WT — payment_id: which payment this wire carried (the statement check names the wire of each payment)
        rows.forEach(function (b) { if (byBillW[b.id]) { b.paid_by_wires = byBillW[b.id]; } });
      } catch (ePW) { enrichWarn.push('which wire paid each bill could not be loaded (' + ((ePW && ePW.message) || 'error') + ')'); } // v55.83-WT
      // v55.83-SV — compare every live bill with every other one, on every load (never only at entry).
      var dupCount = 0;
      try {
        var dupScan = scanBills(rows, await loadDupDismissed(db));
        rows.forEach(function (b) { var df = dupScan.byId[b.id]; if (df) { b.dup_flag = df; dupCount++; } });
      } catch (eDS) { /* a scan problem never blocks the list */ }
      return NextResponse.json({ ok: true, marker: API_BUILD_MARKER, bills: rows, payments: L.pays, totals: totals, dup_flagged: dupCount, enrich_warnings: enrichWarn }); // v55.83-WT — the statement check says when the wire details are incomplete
    }

    // ── save_bill: create or update (active bills only)
    if (action === 'save_bill') {
      var bl = body.bill || {};
      var vendor = String(bl.vendor_name || '').trim();
      var amt = r2(bl.total_amount);
      if (!vendor) { return NextResponse.json({ error: 'Vendor name is required.' }, { status: 400 }); }
      if (!(amt > 0)) { return NextResponse.json({ error: 'Amount must be above zero.' }, { status: 400 }); }
      if (!isDate(bl.bill_date)) { return NextResponse.json({ error: 'Bill date is required (YYYY-MM-DD).' }, { status: 400 }); }
      // v55.83-RL (Max, Nov 9 12:20: "Billing is always necessary and date is always necessary")
      if (!String(bl.bill_number || '').trim()) { return NextResponse.json({ error: 'The bill # is required.' }, { status: 400 }); }
      if (bl.due_date && !isDate(bl.due_date)) { return NextResponse.json({ error: 'Due date must be YYYY-MM-DD.' }, { status: 400 }); }
      var fields = {
        vendor_name: vendor, bill_number: String(bl.bill_number || '').trim() || null,
        bill_date: bl.bill_date, due_date: bl.due_date || null,
        total_amount: amt, category: String(bl.category || '').trim() || null,
        notes: String(bl.notes || '').trim() || null,
        wave_business_id: US_WAVE_BUSINESS_ID, currency: 'USD', updated_at: new Date().toISOString(),
      };
      // v55.83-RG (Max, Nov 8 15:32: "they all belong to a release number") — the
      // bill's release number, its own field (the wire audit checks it).
      if (Object.prototype.hasOwnProperty.call(bl, 'release_number')) { fields.release_number = String(bl.release_number || '').trim().toUpperCase().substring(0, 40) || null; }
      // v55.83-RL (Max 12:18–12:20) — another reference (BOL / PO / container…) and the INBOUND / OUTBOUND tick:
      // outbound needs the release #, inbound needs the reference (the wire check enforces it)
      if (Object.prototype.hasOwnProperty.call(bl, 'other_reference')) { fields.other_reference = String(bl.other_reference || '').trim().toUpperCase().substring(0, 60) || null; }
      // v55.83-RP (Max, Nov 9 21:04) — the TYPE of bill; a release # with no direction picked = OUTBOUND
      if (Object.prototype.hasOwnProperty.call(bl, 'bill_type')) {
        var btB = String(bl.bill_type || '').toLowerCase();
        if (btB && !BILL_TYPE_LABEL[btB]) { return NextResponse.json({ error: 'Pick the bill type: trucking, shipping, bonded / brokerage or supplier.' }, { status: 400 }); }
        fields.bill_type = btB || null;
        if (Object.prototype.hasOwnProperty.call(bl, 'bill_type_source')) { fields.bill_type_source = btB ? (bl.bill_type_source === 'read_from_bill' || bl.bill_type_source === 'vendor_history' ? bl.bill_type_source : 'manual') : null; }
      }
      if (fields.release_number && !String(bl.shipment_direction || '').trim() && !bl.id) { bl.shipment_direction = 'outbound'; fields.direction_source = 'release_number'; }
      else if (!String(bl.shipment_direction || '').trim() && !bl.id) { var ddN = defaultDirectionFor(await loadCommissionRules(db), vendor); if (ddN) { bl.shipment_direction = ddN; bl.direction_source = 'vendor_default'; } } // RW — e.g. NexPac → inbound
      if (Object.prototype.hasOwnProperty.call(bl, 'shipment_direction')) {
        var dirB = String(bl.shipment_direction || '').toLowerCase();
        if (dirB && dirB !== 'inbound' && dirB !== 'outbound') { return NextResponse.json({ error: 'Pick inbound or outbound.' }, { status: 400 }); }
        fields.shipment_direction = dirB || null;
        if (dirB === 'outbound' && bl.direction_source === 'release_number' && fields.release_number) { fields.direction_source = 'release_number'; } // RP — imported: release # on the bill
        else if (bl.direction_source === 'manual') { fields.direction_source = dirB ? 'manual' : null; }
        else if (bl.direction_source === 'vendor_default' && dirB) { fields.direction_source = 'vendor_default'; } // RW
        if (dirB === 'outbound' && !fields.release_number && !String(bl.release_number || '').trim()) { return NextResponse.json({ error: 'An OUTBOUND bill needs its release #.' }, { status: 400 }); }
        if (dirB === 'inbound' && !fields.other_reference && bl.direction_source !== 'vendor_default') { return NextResponse.json({ error: 'An INBOUND bill needs its reference (BOL / PO / container…).' }, { status: 400 }); } // RW — a pre-picked default never blocks saving (the wire check still asks for the reference)
      }
      // v55.83-PC — the scanned/imported file's storage path travels with the bill.
      if (String(bl.attachment_path || '').trim()) { fields.attachment_path = String(bl.attachment_path).trim().substring(0, 300); }
      // v55.83-QB — "Paid via RTM Capital": a third party pays this bill, so it
      // stays OUT of what-we-owe and cash forecasts; it is covered from the RTM
      // payment (All Transactions → 🏢 RTM), never paid from our bank directly.
      if (Object.prototype.hasOwnProperty.call(bl, 'paid_via')) {
        fields.paid_via = String(bl.paid_via || '').trim().substring(0, 60) || null;
        if (fields.paid_via) { // v55.83-QY — only a registered paid-through company
          var partiesS = await loadParties(db); var hitS = null;
          partiesS.forEach(function (ps) { if (partyKey(ps.name) === partyKey(fields.paid_via)) { hitS = ps.name; } });
          if (!hitS) { return NextResponse.json({ error: 'Unknown "paid via" company "' + fields.paid_via + '".' }, { status: 400 }); }
          fields.paid_via = hitS;
        }
      }
      // v55.83-SV — a bill typed in by hand, edited or copied is checked against every bill on file BEFORE it is saved.
      // A new bill that looks like a certain duplicate (or a second trucking bill for one release) is not saved until
      // the person confirms. An edit is never blocked — it carries the warning back instead.
      var dupSave = { level: null, reasons: [], others: [] };
      try {
        var dupAll = await loadBills(db);
        dupSave = checkOne({ id: bl.id || null, vendor_name: vendor, bill_number: fields.bill_number, bill_date: fields.bill_date, total_amount: amt,
          release_number: Object.prototype.hasOwnProperty.call(fields, 'release_number') ? fields.release_number : bl.release_number,
          other_reference: Object.prototype.hasOwnProperty.call(fields, 'other_reference') ? fields.other_reference : bl.other_reference,
          bill_type: Object.prototype.hasOwnProperty.call(fields, 'bill_type') ? fields.bill_type : bl.bill_type }, dupAll.bills, await loadDupDismissed(db));
      } catch (eDC) { /* a check problem never blocks a save */ }
      // v55.83-UQ (Max: "not accepting them if they are the exact same bill") — the exact same bill is refused outright, "save anyway" or not;
      // an edit that would turn a bill into an exact copy of another one is refused too
      try {
        var exactS = await findExactSameBill(db, { id: bl.id || null, vendor_name: vendor, bill_number: fields.bill_number, bill_date: fields.bill_date, total_amount: amt });
        if (exactS && exactS.id !== bl.id) { return NextResponse.json({ error: exactSameWords(exactS).replace('It was NOT added again.', 'It was NOT saved.'), duplicate: true, duplicate_level: 'exact', duplicate_of: exactS.id }, { status: 409 }); }
      } catch (eEx) { return NextResponse.json({ error: (eEx && eEx.message) || 'Could not check for the same bill — nothing was saved.' }, { status: 500 }); }
      if (!bl.id && dupSave.level === 'strong' && body.confirm_duplicate !== true) {
        return NextResponse.json({ error: 'This looks like a duplicate — it was NOT saved. ' + dupSave.reasons.join(' · '), duplicate: true, duplicate_level: dupSave.level, duplicate_reasons: dupSave.reasons }, { status: 409 });
      }
      var dupWarn = dupSave.level ? ('POSSIBLE DUPLICATE — ' + dupSave.reasons.join(' · ')).substring(0, 600) : null;
      if (!bl.id && dupSave.level === 'strong') { await audit(db, userId, 'bill_duplicate_override', 'vendor_bill', null, { vendor: vendor, bill_number: fields.bill_number, amount: amt, reasons: dupSave.reasons, others: dupSave.others }); }
      if (bl.id) {
        var cur = await db.from('vendor_bills').select('*').eq('id', bl.id).maybeSingle();
        if (cur.error || !cur.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
        if (cur.data.record_status !== 'active') { return NextResponse.json({ error: 'This bill is ' + (cur.data.record_status === 'deleted' ? 'deleted' : 'void') + ' — it cannot be edited.' }, { status: 409 }); }
        // review #1 (v55.83-RV) — what was VALIDATED cannot change under the validation: vendor, bill #, dates, amount, type,
        // direction. A missing release # / reference may still be filled in (blank → value); changing one needs a reopen.
        if (cur.data.validation_status === 'validated') {
          var vChanged = [];
          var vDiff = function (label, a, b) { if (String(a == null ? '' : a).trim().toUpperCase() !== String(b == null ? '' : b).trim().toUpperCase()) { vChanged.push(label); } };
          vDiff('vendor', cur.data.vendor_name, fields.vendor_name); vDiff('bill #', cur.data.bill_number, fields.bill_number); vDiff('bill date', cur.data.bill_date, fields.bill_date);
          if (r2(cur.data.total_amount) !== r2(fields.total_amount)) { vChanged.push('amount'); }
          if (Object.prototype.hasOwnProperty.call(fields, 'bill_type')) { vDiff('type', cur.data.bill_type, fields.bill_type); }
          if (Object.prototype.hasOwnProperty.call(fields, 'shipment_direction')) { vDiff('inbound / outbound', cur.data.shipment_direction, fields.shipment_direction); }
          if (Object.prototype.hasOwnProperty.call(fields, 'release_number') && String(cur.data.release_number || '').trim()) { vDiff('release #', cur.data.release_number, fields.release_number); }
          if (Object.prototype.hasOwnProperty.call(fields, 'other_reference') && String(cur.data.other_reference || '').trim()) { vDiff('reference', cur.data.other_reference, fields.other_reference); }
          if (vChanged.length) { return NextResponse.json({ error: 'This bill is VALIDATED — its ' + vChanged.join(', ') + ' cannot change. Reopen the validation first (✓ VALIDATED → ↩ Reopen), then edit and validate it again.' }, { status: 409 }); }
          delete fields.direction_source; delete fields.bill_type_source;
        }
        var wOn = await openWireOf(db, bl.id);
        if (wOn && wOn.status === 'sent') { return NextResponse.json({ error: 'This bill is on wire ' + wOn.label + ', which was already SENT — it cannot change until that wire is attached to its bank line (🏦 Wires).' }, { status: 409 }); }
        var payR = await db.from('vendor_bill_payments').select('id, bill_id, amount, voided').eq('bill_id', bl.id);
        var paidSoFar = 0; (payR.data || []).forEach(function (p) { if (p.voided !== true) { paidSoFar += Number(p.amount) || 0; } });
        if (amt + 0.005 < paidSoFar) { return NextResponse.json({ error: 'Amount cannot be below what is already paid (' + r2(paidSoFar).toFixed(2) + '). Void the payments first.' }, { status: 409 }); }
        // v55.83-WX — a person who changes the category on the bill makes it THEIRS: no rule ever overwrites it afterwards
        var wxReadyU = (await loadBillRules(db)).ready;
        if (wxReadyU && String(cur.data.category || '') !== String(fields.category || '')) { fields.category_source = fields.category ? 'manual' : null; fields.category_rule_id = null; fields.category_rule_version = null; }
        var up = await db.from('vendor_bills').update(fields).eq('id', bl.id).select('id').maybeSingle();
        var qbWarnU = null;
        if (up.error && /bill_type|direction_source/.test(up.error.message || '')) { delete fields.bill_type; delete fields.bill_type_source; delete fields.direction_source; up = await db.from('vendor_bills').update(fields).eq('id', bl.id).select('id').maybeSingle(); if (!up.error) { qbWarnU = 'Saved WITHOUT the bill type — run sql/v55-83-RP-bill-type.sql to store it.'; } } // RP SQL not run yet
        if (up.error && /other_reference|shipment_direction/.test(up.error.message || '')) { delete fields.other_reference; delete fields.shipment_direction; up = await db.from('vendor_bills').update(fields).eq('id', bl.id).select('id').maybeSingle(); if (!up.error) { qbWarnU = 'Saved WITHOUT the reference / inbound-outbound — run sql/v55-83-RL-wire-override-delete-reference.sql to store them.'; } } // RL SQL not run yet
        if (up.error && /release_number/.test(up.error.message || '')) { delete fields.release_number; up = await db.from('vendor_bills').update(fields).eq('id', bl.id).select('id').maybeSingle(); if (!up.error) { qbWarnU = 'Saved WITHOUT the release number — run sql/v55-83-RG-wires-recon.sql to store it.'; } } // RG SQL not run yet
        if (up.error && /paid_via/.test(up.error.message || '')) { // QB SQL not run yet — save the rest and SAY so
          delete fields.paid_via;
          up = await db.from('vendor_bills').update(fields).eq('id', bl.id).select('id').maybeSingle();
          if (!up.error) { qbWarnU = 'Saved WITHOUT the via-RTM flag — run sql/v55-83-QB-rtm-third-party.sql to store it.'; }
        }
        if (up.error) { throw new Error(up.error.message); }
        var learnedU = null;
        if (fields.category) { learnedU = await learnRule(db, vendor, fields.category, userId); } // v55.83-PJ — a changed pick updates the rule
        await audit(db, userId, 'bill_updated', 'vendor_bill', bl.id, { vendor: vendor, amount: amt, category: fields.category || null, paid_via: fields.paid_via || null }); // v55.83-QI
        var lnU = await linesAfterSave(bl.id, bl);
        return NextResponse.json({ ok: true, id: bl.id, updated: true, rule_learned: learnedU, warning: qbWarnU || lnU.warning || undefined, duplicate_warning: dupWarn || undefined, price_check: lnU.check || undefined });
      }
      // v55.83-PJ (Max): "remember and categorize later on with new bills
      // automatically when imported" — no category given? use the vendor's
      // remembered one. Category given? remember it for next time. Fail-soft.
      // v55.83-WX — bill category rules first (exact amount, range, words; company + currency), then the vendor memory. A tie between
      // rules, or a rule that would deduct a bill already counted in goods / transport profit, leaves the category EMPTY for a person.
      // A category the screen pre-filled from a rule stays "set by rule" only if the same rule still gives it; anything else typed or
      // kept by the person is theirs (manual).
      var autoCat = null; var wxPick = null;
      var wxBill = { vendor_name: vendor, total_amount: amt, currency: fields.currency, wave_business_id: fields.wave_business_id, bill_number: fields.bill_number, notes: fields.notes,
        bill_type: fields.bill_type || bl.bill_type || null, release_number: Object.prototype.hasOwnProperty.call(fields, 'release_number') ? fields.release_number : (bl.release_number || null), other_reference: fields.other_reference || null };
      // (Codex 22 Nov 08:53 P2) the bill's own lines, as they will be saved, go into the rule check: a supplier line that is a
      // product cost blocks a deducted category, and words that appear only on a line count
      var wxLines = Array.isArray(bl.lines) ? bl.lines.slice(0, 60).map(function (l, i) { var lx = l || {}; var tB = fields.bill_type || bl.bill_type || ''; var dk = (tB === 'trucking' || tB === 'shipping' || tB === 'bonded_brokerage') ? 'charge' : 'item'; return shapeLine(Object.assign({}, lx, { line_kind: lx.line_kind || (/commission/i.test(String(lx.description || '')) ? 'commission' : dk) }), i); }) : []; // the same shaping saveBillLines uses
      if (!fields.category || bl.category_rule_id) { wxPick = await categoryForNewBill(db, wxBill, wxLines); }
      // (Codex 22 Nov 09:18 P2) category_rule_id travels ONLY with a category the import screen pre-filled from a rule and the person
      // did not touch (the screen drops it as soon as the category is changed). Such a pre-fill is the rule's, not the person's: when
      // the same rule no longer gives it (e.g. a line was corrected to a product cost), it is NOT kept — the bill gets what the rules
      // give now (or no category, flagged), it is never called manual and it never teaches the vendor memory.
      var wxPrefillDropped = null;
      if (fields.category && bl.category_rule_id) {
        var wxSame = wxPick && wxPick.source === 'rule' && wxPick.category === fields.category && String(wxPick.rule_id) === String(bl.category_rule_id);
        if (!wxSame) { wxPrefillDropped = fields.category; fields.category = null; }
      }
      if (!fields.category) {
        if (wxPick && wxPick.category) { autoCat = wxPick.category; fields.category = autoCat; }
        Object.assign(fields, provenanceFields(wxPick, wxPick && wxPick.ready));
      } else if (bl.category_rule_id) {
        Object.assign(fields, provenanceFields(wxPick, true)); autoCat = fields.category; // the untouched pre-fill still holds: set by rule
      } else {
        Object.assign(fields, provenanceFields({ source: 'manual' }, wxPick ? wxPick.ready : (await loadBillRules(db)).ready)); // picked or typed by the person
      }
      fields.created_by = userId;
      var ins = await db.from('vendor_bills').insert(fields).select('id').maybeSingle();
      if (ins.error && /bill_type|direction_source/.test(ins.error.message || '')) { delete fields.bill_type; delete fields.bill_type_source; delete fields.direction_source; ins = await db.from('vendor_bills').insert(fields).select('id').maybeSingle(); } // RP SQL not run yet
      if (ins.error && /other_reference|shipment_direction/.test(ins.error.message || '')) { delete fields.other_reference; delete fields.shipment_direction; ins = await db.from('vendor_bills').insert(fields).select('id').maybeSingle(); } // RL SQL not run yet
      if (ins.error && /release_number/.test(ins.error.message || '')) { delete fields.release_number; ins = await db.from('vendor_bills').insert(fields).select('id').maybeSingle(); } // RG SQL not run yet — save the rest
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
      var lnC = ins.data && ins.data.id ? await linesAfterSave(ins.data.id, bl) : {};
      return NextResponse.json({ ok: true, id: ins.data && ins.data.id, created: true, auto_category: autoCat, category_source: fields.category_source || null, category_prefill_removed: wxPrefillDropped ? ('The category pre-filled by a rule was not kept: ' + ((wxPick && wxPick.blocked) || 'that rule no longer gives it for this bill') + '. Pick the category on the bill if it is right.') : undefined, category_conflict: wxPick && wxPick.source === 'rule_conflict' ? (wxPick.blocked || ('rules disagree: ' + (wxPick.conflict || []).map(function (r) { return r.name; }).join(' / '))) : undefined, rule_learned: learnedB, warning: lnC.warning || undefined, duplicate_warning: dupWarn || undefined, price_check: lnC.check || undefined });
    }

    // ── void_bill (reversible record_status; nothing is deleted)
    // v55.83-RY (Max, Nov 10 00:11: "add delete bill") — for a bill that should never have been in the Hub (an imported
    // duplicate, a wrong upload). Refused when money was recorded on it or it is on a wire; the row and its audit trail
    // stay (append-only) — it just disappears from every list, report, wire and duplicate check. Void = a real bill cancelled.
    if (action === 'delete_bill') {
      var dReasonB = String(body.reason || '').trim();
      if (dReasonB.length < 5) { return NextResponse.json({ error: 'Say why the bill is deleted (e.g. imported twice) — it goes on the audit trail.' }, { status: 400 }); }
      var dB = await db.from('vendor_bills').select('*').eq('id', body.id).maybeSingle();
      if (dB.error || !dB.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      if (dB.data.record_status === 'deleted') { return NextResponse.json({ error: 'Already deleted.' }, { status: 409 }); }
      var dPays = await db.from('vendor_bill_payments').select('id, amount, voided').eq('bill_id', body.id);
      var livePays = ((dPays && dPays.data) || []).filter(function (p) { return p.voided !== true; });
      if (livePays.length) { return NextResponse.json({ error: 'Money is recorded on this bill (' + livePays.length + ' payment' + (livePays.length === 1 ? '' : 's') + ') — it cannot be deleted. Void the payments first, or Void the bill instead.' }, { status: 409 }); }
      var dWire = await openWireOf(db, body.id);
      if (dWire) { return NextResponse.json({ error: 'This bill is on wire ' + dWire.label + ' — take it off that wire (or delete the wire) first.' }, { status: 409 }); }
      var dLines = []; try { var dl0 = await db.from('vendor_bill_lines').select('line_no, line_kind, description, qty, unit, unit_price, amount').eq('bill_id', body.id); dLines = (dl0 && dl0.data) || []; } catch (eDL) { dLines = []; }
      var dUp = await db.from('vendor_bills').update({ record_status: 'deleted', deleted_by: userId, deleted_at: new Date().toISOString(), delete_reason: dReasonB.substring(0, 500), updated_at: new Date().toISOString() }).eq('id', body.id).neq('record_status', 'deleted').select('id').maybeSingle();
      if (dUp.error && /record_status|deleted_|delete_reason/.test(dUp.error.message || '')) { return NextResponse.json({ error: 'Deleting bills needs sql/v55-83-RY-delete-bill.sql — run it in Supabase first. Nothing was changed.' }, { status: 400 }); }
      if (dUp.error) { throw new Error(dUp.error.message); }
      try { await db.from('vendor_bill_events').insert({ bill_id: body.id, kind: 'deleted', actor_id: userId, details: { reason: dReasonB.substring(0, 500) } }); } catch (eDE) { /* the audit log below is the record */ }
      var dSnap = {}; ['vendor_name', 'bill_number', 'bill_date', 'due_date', 'total_amount', 'category', 'bill_type', 'shipment_direction', 'release_number', 'other_reference', 'validation_status', 'validated_by', 'paid_via', 'attachment_path', 'record_status'].forEach(function (k) { dSnap[k] = dB.data[k] == null ? null : dB.data[k]; });
      await audit(db, userId, 'bill_deleted', 'vendor_bill', body.id, { reason: dReasonB.substring(0, 500), bill: dSnap, lines: dLines, voided_payments: ((dPays && dPays.data) || []).length });
      return NextResponse.json({ ok: true, deleted: true });
    }

    if (action === 'void_bill') {
      if (!body.id) { return NextResponse.json({ error: 'id required.' }, { status: 400 }); }
      var wOnV = await openWireOf(db, body.id);
      if (wOnV) { return NextResponse.json({ error: 'This bill is on wire ' + wOnV.label + ' (' + wOnV.status + ') — ' + (wOnV.status === 'sent' ? 'it was already sent, so it cannot be voided.' : 'untick it on that wire (or cancel the wire) first.') }, { status: 409 }); }
      // v55.83-US (NexPac #14277: a VOIDED copy still held a live $27,885.79 payment) — a bill with a payment that is not undone cannot be
      // voided: the money would hang on a bill nobody sees. Undo the payment first (↩ Undo payment — it stays on record as UNDONE).
      var livePV = await db.from('vendor_bill_payments').select('id, amount, voided').eq('bill_id', body.id);
      if (livePV.error) { return readFail('its payments', livePV.error); }
      var liveP = (livePV.data || []).filter(function (p) { return p.voided !== true; }); // a blank voided flag is a live payment
      if (liveP.length) {
        var lpSum = 0; liveP.forEach(function (p) { lpSum += Number(p.amount) || 0; });
        return NextResponse.json({ error: 'This bill has ' + liveP.length + ' payment(s) totalling $' + r2(lpSum).toFixed(2) + ' that are not undone — undo them first (↩ Undo payment), then void the bill. Nothing was changed.' }, { status: 409 });
      }
      var vb = await db.from('vendor_bills').update({ record_status: 'void', updated_at: new Date().toISOString() }).eq('id', body.id).select('id').maybeSingle();
      if (vb.error) { throw new Error(vb.error.message); }
      if (!vb.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      await audit(db, userId, 'bill_voided', 'vendor_bill', body.id, { reason: String(body.reason || '').substring(0, 500) || null }); // v55.83-RL
      return NextResponse.json({ ok: true, voided: true });
    }

    // ── record_payment: pay a bill, optionally linked to a real OUT bank txn
    if (action === 'record_payment') {
      var billId = body.bill_id; var pAmt = r2(body.amount);
      if (!billId || !(pAmt > 0) || !isDate(body.paid_date)) {
        return NextResponse.json({ error: 'bill_id, positive amount and paid_date (YYYY-MM-DD) are required.' }, { status: 400 });
      }
      if (!(await guardsReady())) { return NextResponse.json({ error: GUARD_OFF }, { status: 503 }); }
      var reqIdR = reqIdOf(body);
      if (reqIdR) { var dupR = await db.from('vendor_bill_payments').select('id').eq('request_id', reqIdR).eq('bill_id', billId).limit(1); if (dupR.error) { return readFail('earlier payments', dupR.error); } if (dupR.data && dupR.data.length) { return NextResponse.json({ ok: true, payment_id: dupR.data[0].id, already_recorded: true }); } }
      var bRow = await db.from('vendor_bills').select('id, record_status, total_amount, vendor_name').eq('id', billId).maybeSingle();
      if (bRow.error) { return readFail('the bill', bRow.error); }
      if (!bRow.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      if (bRow.data.record_status !== 'active') { return NextResponse.json({ error: 'This bill is void.' }, { status: 409 }); }
      // v55.83-RH (Max 16:04) — a bill on a prepared wire is paid BY THAT WIRE (when its bank line is attached), never twice by hand
      try {
        var onWire = await db.from('wire_package_lines').select('package_id').eq('bill_id', billId).eq('is_open', true).limit(1);
        if (onWire.error && !missingRel(onWire.error)) { return readFail('the wires this bill is on', onWire.error); } // TO — fail closed
        if (!onWire.error && onWire.data && onWire.data.length) {
          var wpk = await db.from('wire_packages').select('seq, status').eq('id', onWire.data[0].package_id).maybeSingle();
          if (wpk && wpk.data && wpk.data.status !== 'cancelled') {
            return NextResponse.json({ error: 'This bill is on wire WP-' + String(wpk.data.seq || 0).padStart(4, '0') + ' (' + wpk.data.status + ') — it is recorded paid when that wire is attached to its bank line (🏦 Wires). Remove it from that wire first to pay it another way.' }, { status: 409 });
          }
        }
      } catch (eWp) { /* RH SQL not run yet — nothing to guard */ }
      var exPays = await db.from('vendor_bill_payments').select('id, bill_id, amount, voided').eq('bill_id', billId);
      if (exPays.error) { return readFail('what is already paid on this bill', exPays.error); } // TO — fail closed
      var bal = billOpenBalance(bRow.data, exPays.data || []);
      if (pAmt > bal.open + 0.005) {
        return NextResponse.json({ error: 'That overpays the bill — open balance is ' + bal.open.toFixed(2) + '.' }, { status: 409 });
      }
      var bankId = body.bank_transaction_id || null;
      // v55.83-TH (Max, Nov 16: "cannot pay something in past without it being matched to a bank transaction") — every bill payment
      // recorded here must name the real money-out bank line. (Wire payments are written by the wire itself, not here.)
      if (!bankId) { return NextResponse.json({ error: 'Pick the bank transaction that paid this bill. A payment cannot be recorded without its bank line.' }, { status: 400 }); }
      if (bankId) {
        var tx = await db.from('bank_transactions').select('id, direction, pending, amount_abs, iso_currency, wave_business_id, third_party_payer, name, merchant_name, transfer_group_id').eq('id', bankId).maybeSingle();
        if (tx.error) { return readFail('the bank transaction', tx.error); }
        if (!tx.data) { return NextResponse.json({ error: 'Bank transaction not found.' }, { status: 404 }); }
        var cfR = await companyFundsBlock(tx.data); if (cfR) { return cfR; } // v55.83-WF B2
        if (tx.data.direction !== 'out') { return NextResponse.json({ error: 'A bill is paid by MONEY OUT — that bank transaction is money in.' }, { status: 409 }); }
        if (tx.data.pending === true) { return NextResponse.json({ error: 'That bank transaction is still pending — link it once it settles.' }, { status: 409 }); }
        if (pAmt > (Number(tx.data.amount_abs) || 0) + 0.005) { return NextResponse.json({ error: 'Payment is larger than the bank transaction (' + r2(tx.data.amount_abs).toFixed(2) + ').' }, { status: 409 }); }
        try {
          var sw = await db.from('wire_packages').select('seq, approved_total, payee_name').eq('status', 'sent');
          if (sw.error && !missingRel(sw.error)) { return readFail('the prepared wires', sw.error); } // TO — fail closed
          var hitW = ((sw && sw.data) || []).filter(function (w) { return Math.abs(r2(w.approved_total) - r2(tx.data.amount_abs)) <= 0.005; })[0];
          if (hitW) { return NextResponse.json({ error: 'This bank line (' + r2(tx.data.amount_abs).toFixed(2) + ') looks like prepared wire WP-' + String(hitW.seq || 0).padStart(4, '0') + ' to ' + hitW.payee_name + ', which is waiting for it — attach it in 🏦 Wires instead.' }, { status: 409 }); }
        } catch (eSw) { /* RH SQL not run yet */ }
        var already = await db.from('vendor_bill_payments').select('id, amount, voided').eq('bank_transaction_id', bankId);
        if (already.error) { return readFail('what is already paid from that bank line', already.error); } // TO — fail closed
        var used = 0; (already.data || []).forEach(function (p) { if (p.voided !== true) { used += Number(p.amount) || 0; } });
        if (used + pAmt > (Number(tx.data.amount_abs) || 0) + 0.005) {
          return NextResponse.json({ error: 'That bank transaction is already allocated to bills for ' + r2(used).toFixed(2) + ' — only ' + r2(tx.data.amount_abs - used).toFixed(2) + ' remains.' }, { status: 409 });
        }
      }
      var pIns = await db.from('vendor_bill_payments').insert({
        bill_id: billId, amount: pAmt, paid_date: body.paid_date,
        bank_transaction_id: bankId, method: String(body.method || '').trim() || null, created_by: userId, request_id: reqIdR,
      }).select('id').maybeSingle();
      if (pIns.error) {
        var gE = guardErr(pIns.error); if (gE) { return gE; }
        var dupR2 = await db.from('vendor_bill_payments').select('id').eq('request_id', reqIdR).eq('bill_id', billId).limit(1);
        return NextResponse.json({ ok: true, payment_id: dupR2.data && dupR2.data[0] ? dupR2.data[0].id : null, already_recorded: true });
      }
      // v55.83-QZ2 (review fix) — a bank payment matched to bills used to stay
      // UNCATEGORIZED: the P&L showed it as uncategorized and it never reached
      // the ClickBooks ledger. When the bank row has NO category yet and every
      // bill it pays carries the SAME category, that category rides onto the
      // row (never overwrites a person's pick); when the bills cover the whole
      // payment, the row is finished (reviewed) and reaches the ledger. Never
      // for RTM/NextTrade (paid-through) payments — those stay ONE line in the
      // tax view by design — nor transfers or duplicate copies. Fail-soft.
      var carried = null;
      if (bankId && String(body.method || '').trim() !== 'rtm') {
        try { carried = await carryBillCategory(db, bankId, userId); } catch (eCB) { carried = null; }
      }
      await audit(db, userId, 'bill_payment_recorded', 'vendor_bill', billId, { payment_id: pIns.data && pIns.data.id, amount: pAmt, paid_date: body.paid_date, bank_transaction_id: bankId, method: String(body.method || '').trim() || null, category_carried: carried, partial: pAmt < bal.open - 0.005, open_after: r2(bal.open - pAmt) }); // v55.83-QI · TH
      return NextResponse.json({ ok: true, payment_id: pIns.data && pIns.data.id, category_carried: carried });
    }

    // ── void_payment
    if (action === 'void_payment') {
      if (!body.id) { return NextResponse.json({ error: 'id required.' }, { status: 400 }); }
      // v55.83-TH (Max, Nov 16: "Need to undo a payment from this screen") — undo = the payment is VOIDED (kept on record, never deleted),
      // with a reason; the bill is open again by that amount and the bank line is free again for that amount.
      var vReason = String(body.reason || '').trim();
      var vp0 = await db.from('vendor_bill_payments').select('id, bill_id, amount, paid_date, bank_transaction_id, voided').eq('id', body.id).maybeSingle();
      if (vp0.error) { throw new Error(vp0.error.message); }
      if (!vp0.data) { return NextResponse.json({ error: 'Payment not found.' }, { status: 404 }); }
      if (vp0.data.voided === true) { return NextResponse.json({ error: 'This payment was already undone.' }, { status: 409 }); }
      try {
        var wl = await db.from('wire_package_lines').select('package_id').eq('payment_id', body.id).limit(1);
        if (!wl.error && wl.data && wl.data.length) {
          var wlp = await db.from('wire_packages').select('seq').eq('id', wl.data[0].package_id).maybeSingle();
          var wlab = 'WP-' + String((wlp && wlp.data && wlp.data.seq) || 0).padStart(4, '0');
          return NextResponse.json({ error: 'This payment was recorded by an approved wire (' + wlab + ') — it cannot be undone here. Undo it in 🏦 Wires → open ' + wlab + ' → ↩ Undo (that undoes the whole wire and all its bill payments together).' }, { status: 409 });
        }
      } catch (eWl) { /* RH SQL not run yet */ }
      if (vReason.length < 5) { return NextResponse.json({ error: 'Write why this payment is undone (a short sentence) — it goes on the audit trail.' }, { status: 400 }); }
      var vp = await db.from('vendor_bill_payments').update({ voided: true }).eq('id', body.id).eq('voided', false).select('id').maybeSingle();
      if (vp.error) { throw new Error(vp.error.message); }
      if (!vp.data) { return NextResponse.json({ error: 'The payment did not change — refresh and try again.' }, { status: 409 }); }
      var vBill = await db.from('vendor_bills').select('id, total_amount').eq('id', vp0.data.bill_id).maybeSingle();
      var vPays = await db.from('vendor_bill_payments').select('id, amount, voided').eq('bill_id', vp0.data.bill_id);
      var vOpen = vBill && vBill.data ? billOpenBalance(vBill.data, (vPays && vPays.data) || []).open : null;
      await audit(db, userId, 'bill_payment_voided', 'vendor_bill_payment', body.id, { bill_id: vp0.data.bill_id, amount: r2(vp0.data.amount), paid_date: vp0.data.paid_date, bank_transaction_id: vp0.data.bank_transaction_id || null, reason: vReason.substring(0, 500), open_after: vOpen }); // v55.83-RL · TH
      return NextResponse.json({ ok: true, voided: true, open_after: vOpen });
    }

    // ── v55.83-TH — money-out bank lines a bill can be paid from, with what is still free on each (search by text / amount / dates)
    if (action === 'bank_lines_for_bills') {
      var qB = db.from('bank_transactions').select('id, date, posted_date, amount_abs, name, merchant_name, pending, direction, wave_business_id, account_id')
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out').neq('pending', true);
      if (isDate(body.from)) { qB = qB.gte('date', body.from); }
      if (isDate(body.to)) { qB = qB.lte('date', body.to); }
      var amtB = Number(String(body.amount || '').replace(/[$,\s]/g, ''));
      if (amtB > 0) { qB = qB.gte('amount_abs', r2(amtB - 0.5)).lte('amount_abs', r2(amtB + 0.5)); }
      var txtB = String(body.q || '').trim();
      if (txtB) { var safeB = txtB.replace(/[%,()]/g, ' ').trim(); if (safeB) { qB = qB.or('name.ilike.%' + safeB + '%,merchant_name.ilike.%' + safeB + '%'); } }
      var lb = await qB.order('date', { ascending: false }).limit(150);
      if (lb.error) { throw new Error(lb.error.message); }
      var scopeB = await privateScope(db, userId); if (scopeB.error) { return NextResponse.json({ error: scopeB.error + ' — no bank lines shown.' }, { status: 503 }); } // TP
      lb.data = dropPrivate(lb.data, scopeB);
      var lIds = (lb.data || []).map(function (t) { return t.id; });
      var lPays = lIds.length ? await db.from('vendor_bill_payments').select('bank_transaction_id, amount, voided').in('bank_transaction_id', lIds) : { data: [] };
      if (lPays.error) { return NextResponse.json({ error: 'Could not read what is already paid from these bank lines (' + lPays.error.message + ') — no free amounts are shown rather than wrong ones.' }, { status: 503 }); } // TO — fail closed
      var byTx = {}; ((lPays && lPays.data) || []).forEach(function (p) { (byTx[p.bank_transaction_id] = byTx[p.bank_transaction_id] || []).push(p); });
      var linesB = (lb.data || []).map(function (t) { var rm = bankLineRemaining(t.amount_abs, byTx[t.id] || []); return { id: t.id, date: t.posted_date || t.date, amount: rm.amount, used: rm.used, remaining: rm.remaining, name: String(t.merchant_name || t.name || '').substring(0, 60), label: bankName(t) }; });
      if (body.only_free !== false) { linesB = linesB.filter(function (x) { return x.remaining > 0.005; }); }
      return NextResponse.json({ ok: true, lines: linesB });
    }

    // ── v55.83-TH — pay SEVERAL bills from ONE bank line (Max: keep linking bills until the bank amount is reached; the last one partly).
    // Everything is checked first; then all payments are written in ONE insert (all or nothing).
    if (action === 'pay_bills_from_bank') {
      var bkId = body.bank_transaction_id || null; var picksP = Array.isArray(body.bills) ? body.bills : [];
      if (!bkId) { return NextResponse.json({ error: 'Pick the bank transaction that paid these bills.' }, { status: 400 }); }
      if (!(await guardsReady())) { return NextResponse.json({ error: GUARD_OFF }, { status: 503 }); }
      var reqIdP = reqIdOf(body);
      if (reqIdP) { var dupP = await db.from('vendor_bill_payments').select('id, bill_id, amount').eq('request_id', reqIdP); if (dupP.error) { return readFail('earlier payments', dupP.error); } if (dupP.data && dupP.data.length) { return NextResponse.json({ ok: true, paid: dupP.data.length, already_recorded: true }); } }
      var bk = await db.from('bank_transactions').select('id, date, posted_date, direction, pending, amount_abs, name, merchant_name, wave_business_id, third_party_payer, transfer_group_id').eq('id', bkId).maybeSingle();
      if (bk.error) { return readFail('the bank transaction', bk.error); }
      if (!bk.data) { return NextResponse.json({ error: 'Bank transaction not found.' }, { status: 404 }); }
      var cfP = await companyFundsBlock(bk.data); if (cfP) { return cfP; } // v55.83-WF B2
      var bkPays = await db.from('vendor_bill_payments').select('id, amount, voided').eq('bank_transaction_id', bkId);
      if (bkPays.error) { return readFail('what is already paid from that bank line', bkPays.error); } // TO — fail closed (Codex P1)
      var bkRem = bankLineRemaining(bk.data.amount_abs, (bkPays && bkPays.data) || []);
      var pIdsP = picksP.map(function (x) { return x && x.bill_id; }).filter(Boolean);
      var bRowsP = pIdsP.length ? await db.from('vendor_bills').select('id, vendor_name, bill_number, total_amount, record_status').in('id', pIdsP) : { data: [] };
      var bPaysP = pIdsP.length ? await db.from('vendor_bill_payments').select('id, bill_id, amount, voided').in('bill_id', pIdsP) : { data: [] };
      if (bRowsP.error) { return readFail('the bills', bRowsP.error); }
      if (bPaysP.error) { return readFail('what is already paid on these bills', bPaysP.error); } // TO — fail closed (Codex P1)
      var onWireP = {};
      try { var wlP = pIdsP.length ? await db.from('wire_package_lines').select('bill_id, package_id').in('bill_id', pIdsP).eq('is_open', true) : { data: [] }; if (wlP.error && !missingRel(wlP.error)) { return readFail('the wires these bills are on', wlP.error); } var wpIds = ((wlP && wlP.data) || []).map(function (x) { return x.package_id; }); var wpR = wpIds.length ? await db.from('wire_packages').select('id, seq, status').in('id', wpIds) : { data: [] }; if (wpR.error && !missingRel(wpR.error)) { return readFail('the wires these bills are on', wpR.error); } var wpBy = {}; ((wpR && wpR.data) || []).forEach(function (w) { wpBy[w.id] = w; }); ((wlP && wlP.data) || []).forEach(function (x) { var w = wpBy[x.package_id]; if (w && w.status !== 'cancelled') { onWireP[x.bill_id] = 'WP-' + String(w.seq || 0).padStart(4, '0'); } }); } catch (eWP) { /* RH SQL not run */ }
      var billByP = {}; ((bRowsP && bRowsP.data) || []).forEach(function (b) { billByP[b.id] = b; });
      var paysByP = {}; ((bPaysP && bPaysP.data) || []).forEach(function (x) { (paysByP[x.bill_id] = paysByP[x.bill_id] || []).push(x); });
      var rowsP = picksP.map(function (x) { var b = billByP[x.bill_id]; var open = b ? billOpenBalance(b, paysByP[x.bill_id] || []).open : 0; return { bill_id: x.bill_id, amount: r2(x.amount), open: open, active: !!b && b.record_status === 'active', on_wire: onWireP[x.bill_id] || null, label: b ? billName(b) : 'A bill that was not found' }; });
      var chkP = checkBankPayment({ amount_abs: bk.data.amount_abs, direction: bk.data.direction, pending: bk.data.pending }, bkRem.used, rowsP);
      if (!chkP.ok) { return NextResponse.json({ error: chkP.errors.join(' '), errors: chkP.errors }, { status: 409 }); }
      var paidOnP = isDate(body.paid_date) ? body.paid_date : String(bk.data.posted_date || bk.data.date || '').substring(0, 10);
      var insP = await db.from('vendor_bill_payments').insert(rowsP.map(function (x) { return { bill_id: x.bill_id, amount: x.amount, paid_date: paidOnP, bank_transaction_id: bkId, method: 'bank', created_by: userId, request_id: reqIdP }; })).select('id, bill_id, amount');
      if (insP.error) { var gEP = guardErr(insP.error); if (gEP) { return gEP; } return NextResponse.json({ ok: true, already_recorded: true }); } // the database guard re-checks everything under a lock (TO)
      var carriedP = null; try { carriedP = await carryBillCategory(db, bkId, userId); } catch (eCP) { carriedP = null; }
      for (var ip = 0; ip < rowsP.length; ip++) {
        var pidP = ((insP.data || []).filter(function (x) { return x.bill_id === rowsP[ip].bill_id; })[0] || {}).id || null;
        await audit(db, userId, 'bill_payment_recorded', 'vendor_bill', rowsP[ip].bill_id, { payment_id: pidP, amount: rowsP[ip].amount, paid_date: paidOnP, bank_transaction_id: bkId, method: 'bank', partial: rowsP[ip].amount < rowsP[ip].open - 0.005, open_after: r2(rowsP[ip].open - rowsP[ip].amount) });
      }
      await audit(db, userId, 'bill_payments_from_bank', 'bank_transaction', bkId, { bills: rowsP.length, total: chkP.total, left: chkP.left_after, bank_transaction_id: bkId, category_carried: carriedP });
      return NextResponse.json({ ok: true, paid: (insP.data || []).length, total: chkP.total, left_on_bank_line: chkP.left_after, category_carried: carriedP });
    }

    // ── v55.83-TH — one bill's history in plain words (its own changes, its payments, its validation)
    if (action === 'bill_history') {
      if (!body.id) { return NextResponse.json({ error: 'id required.' }, { status: 400 }); }
      var hRows = [];
      var hPays = await db.from('vendor_bill_payments').select('id').eq('bill_id', body.id);
      var hPayIds = ((hPays && hPays.data) || []).map(function (x) { return x.id; });
      try {
        var hA = await db.from('hub_audit_log').select('at, actor_id, action, entity, entity_id, details').eq('entity', 'vendor_bill').eq('entity_id', String(body.id)).order('at', { ascending: false }).limit(200);
        ((hA && hA.data) || []).forEach(function (r) { r._src = 'hub'; hRows.push(r); });
        if (hPayIds.length) { var hB = await db.from('hub_audit_log').select('at, actor_id, action, entity, entity_id, details').eq('entity', 'vendor_bill_payment').in('entity_id', hPayIds.map(String)).limit(200); ((hB && hB.data) || []).forEach(function (r) { r._src = 'hub'; hRows.push(r); }); }
      } catch (eHA) { /* QI SQL not run */ }
      try { var hE = await db.from('vendor_bill_events').select('created_at, actor_id, kind, details').eq('bill_id', body.id).limit(200); ((hE && hE.data) || []).forEach(function (e) { hRows.push({ at: e.created_at, actor_id: e.actor_id, action: 'bill_' + e.kind, entity: 'vendor_bill', entity_id: body.id, details: e.details, _src: 'events' }); }); } catch (eHE) { /* none */ }
      // the same action recorded twice (hub log + bill events) within a minute shows once
      // v55.83-TO (Codex P2) — only the SAME event written to both logs collapses: a bill-events row is dropped when the hub log has the
      // same action, actor, minute and amount. Two real events (two payments, two undos in one minute) are never merged.
      var hubKeys = {}; hRows.forEach(function (r) { if (r._src === 'hub') { var a0 = r.details && r.details.amount !== undefined ? String(r.details.amount) : ''; hubKeys[r.action + '|' + String(r.at || '').substring(0, 16) + '|' + (r.actor_id || '') + '|' + a0] = true; } });
      hRows = hRows.filter(function (r) { if (r._src !== 'events') { return true; } var a1 = r.details && r.details.amount !== undefined ? String(r.details.amount) : ''; return !hubKeys[r.action + '|' + String(r.at || '').substring(0, 16) + '|' + (r.actor_id || '') + '|' + a1]; });
      hRows.forEach(function (r) { delete r._src; });
      hRows.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
      var hIds = {}; hRows.forEach(function (r) { if (r.actor_id) { hIds[r.actor_id] = true; } });
      var hNames = {}; var hIdl = Object.keys(hIds);
      if (hIdl.length) { try { var hU = await db.from('users').select('id, name, email').in('id', hIdl); ((hU && hU.data) || []).forEach(function (u) { hNames[u.id] = u.name || u.email || u.id; }); } catch (eHU) { /* none */ } }
      hRows.forEach(function (r) { r.who = r.actor_id ? (hNames[r.actor_id] || 'someone') : 'The Hub (automatic)'; });
      try { await addAuditSubjects(db, hRows); } catch (eHS) { /* names are a nicety */ }
      return NextResponse.json({ ok: true, rows: hRows });
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
          .select('id, direction, amount_abs, pending, date, posted_date, iso_currency, wave_business_id, name, merchant_name, classification, matched_invoice_id, transfer_group_id')
          .eq('wave_business_id', US_WAVE_BUSINESS_ID)
          .neq('review_status', 'duplicate') // v55.83-QM — duplicates never count
          .gte('date', fromD).lte('date', toD);
      });
      // v55.83-SO (Max, Nov 15: "Internal transfers must not incorrectly inflate income, expenses, or
      // totals"). Money moved between the company's OWN accounts and LINKED as a transfer is one
      // movement, so it is no longer counted in CAME IN or WENT OUT; it is reported on its own line.
      // v55.83-SQ (Max, Nov 15: "mark transfer but flag it that it is missing second leg") — a line only MARKED
      // transfer, with no linked other side, is treated as a transfer too: NOT counted in or out, and flagged
      // (count + total) so a person links its other side or re-categorizes it.
      var trfBetween = { count: 0, total: 0 }; var trfUnlinked = { count: 0, total: 0 };
      bank.forEach(function (tB) {
        if (tB.pending === true) { return; }
        var dB = tB.posted_date || tB.date;
        if (!(dB >= fromD && dB <= toD)) { return; }
        if (tB.transfer_group_id) { if (tB.direction === 'out') { trfBetween.count++; trfBetween.total = r2(trfBetween.total + (Number(tB.amount_abs) || 0)); } }
        else if (tB.classification === 'transfer') { trfUnlinked.count++; trfUnlinked.total = r2(trfUnlinked.total + (Number(tB.amount_abs) || 0)); }
      });
      bank = bank.filter(function (tB2) { return !tB2.transfer_group_id && tB2.classification !== 'transfer'; });
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
      var cfPayload = { transfers_between: trfBetween, transfers_unlinked: trfUnlinked, summary: summary, ahead: aheadL, sales_in: r2(sumSalesL), sales_in_count: salesRowsL.length, bills_due: dueBills, expected_in: expIn, drills: drillsL };
      cfPayload = maskCashflow(cfPayload, vis); // v55.83-RE — P2 values masked, P1 cards (expected / bills due) stay
      if (!canTotals) { cfPayload.transfers_between = { count: trfBetween.count, total: null }; cfPayload.transfers_unlinked = { count: trfUnlinked.count, total: null }; } // v55.83-SO — money totals stay behind "See Money Totals"
      cfPayload.ok = true; cfPayload.marker = API_BUILD_MARKER; cfPayload.from = fromD; cfPayload.to = toD;
      cfPayload.totals_masked = !canTotals; cfPayload.rows_visible = canRows; cfPayload.vis = vis; cfPayload.date_filters_locked = cfLocked;
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
      var vb2 = await db.from('vendor_bills').select('*').eq('id', body.id).maybeSingle();
      if (vb2.error || !vb2.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      if (vb2.data.record_status !== 'active') { return NextResponse.json({ error: 'This bill is void.' }, { status: 409 }); }
      // v55.83-RO (Max, Nov 9 20:54: "we need to know whether a bill is for inbound or outbound and it should be marked during validation")
      var vDir = String(body.shipment_direction || vb2.data.shipment_direction || '').toLowerCase();
      // v55.83-RP (Max 21:04: "Prior to validation there MUST be a selection of the TYPE of bill and the direction of the bill")
      var vType = String(body.bill_type || vb2.data.bill_type || '').toLowerCase();
      if (!BILL_TYPE_LABEL[vType]) { return NextResponse.json({ error: 'Pick the bill TYPE (trucking, shipping, bonded / brokerage or supplier) — it is part of validating it.' }, { status: 400 }); }
      if (vDir !== 'inbound' && vDir !== 'outbound') { return NextResponse.json({ error: 'Mark the bill Inbound or Outbound — it is part of validating it.' }, { status: 400 }); }
      // v55.83-RQ (Max 21:18: "if there is an issue that the HUB sees, then it should flag it for manual intervention") —
      // the price check runs NOW (with the type picked here); a flagged bill is validated only with a written resolution
      var vResolution = String(body.price_resolution || '').trim();
      if (vType !== vb2.data.bill_type) {
        // v55.83-WZ (Codex 10:52) — the type change is checked by the database (a credit turned into a payable bill can be a second
        // copy of a bill): a refusal stops here with the duplicate message (catch below) and nothing is audited as saved
        var vTU = await db.from('vendor_bills').update({ bill_type: vType, bill_type_source: 'manual' }).eq('id', body.id).select('id').maybeSingle();
        if (vTU.error && /HUB_EXACT_DUPLICATE|HUB_GUARD/.test(vTU.error.message || '')) { throw new Error(vTU.error.message); }
        await audit(db, userId, 'bill_validation_progress_saved', 'vendor_bill', body.id, { bill_type: { from: vb2.data.bill_type || null, to: vType } }); // review #15
      }
      var vPC = await runPriceCheck(db, body.id, null, { actorId: userId });
      var vFlagged = !!(vPC && vPC.ok && vPC.check && vPC.check.status === 'flagged');
      if (vFlagged && vResolution.length < 10 && String(vPC.bill && vPC.bill.price_resolved_note || '').trim().length < 10) {
        return NextResponse.json({ error: 'The Hub\'s price check flagged this bill — write how you resolved it (at least a sentence) before validating.', price_flags: vPC.check.flags }, { status: 409 });
      }
      var vPatch = { validation_status: 'validated', validated_by: userId, validated_at: new Date().toISOString(),
        validation_notes: vNotes.substring(0, 1000), updated_at: new Date().toISOString() };
      if (vFlagged && vResolution.length >= 10) { vPatch.price_resolved_note = vResolution.substring(0, 1000); vPatch.price_resolved_by = userId; vPatch.price_resolved_at = new Date().toISOString(); }
      if (vDir !== vb2.data.shipment_direction) { vPatch.shipment_direction = vDir; vPatch.direction_source = 'validator'; }
      if (vType !== vb2.data.bill_type) { vPatch.bill_type = vType; vPatch.bill_type_source = 'validator'; }
      if (String(body.warehouse_reference || '').trim()) { vPatch.warehouse_reference = String(body.warehouse_reference).trim().substring(0, 120); }
      if (String(body.attachment_path || '').trim()) { vPatch.validation_attachment_path = String(body.attachment_path).trim().substring(0, 300); }
      var vUp = await db.from('vendor_bills').update(vPatch).eq('id', body.id).select('id').maybeSingle();
      if (vUp.error && /bill_type|direction_source/.test(vUp.error.message || '')) { return NextResponse.json({ error: 'The bill type cannot be stored yet — run sql/v55-83-RP-bill-type.sql in Supabase, then validate again.' }, { status: 400 }); }
      if (vUp.error) { throw new Error(vUp.error.message); }
      await db.from('vendor_bill_events').insert({ bill_id: body.id, kind: 'validated', actor_id: userId,
        details: { checks: { matches_records: true, goods_received: true, charges_accurate: true }, notes: vNotes.substring(0, 1000), attachment_path: vPatch.validation_attachment_path || null,
          warehouse_reference: vPatch.warehouse_reference || null, system_match: body.system_match || null } });
      try { await db.from('vendor_bills').update({ validation_draft: null }).eq('id', body.id); } catch (eVD) { /* RU SQL not run */ } // RU — the draft is done
      await audit(db, userId, 'bill_validated', 'vendor_bill', body.id, { notes: vNotes.substring(0, 200), shipment_direction: vDir, direction_was: vb2.data.shipment_direction || null, bill_type: vType, bill_type_was: vb2.data.bill_type || null, bill_type_source_was: vb2.data.bill_type_source || null, price_check: vPC && vPC.check ? vPC.check.status : null, price_flags: vFlagged ? vPC.check.flags.map(function (f) { return f.text; }) : undefined, price_resolution: vFlagged ? (vResolution || vPC.bill.price_resolved_note) : undefined }); // v55.83-QI / RO
      return NextResponse.json({ ok: true, validated: true });
    }
    if (action === 'reopen_validation') {
      var rNote = String(body.reason || '').trim();
      if (rNote.length < 5) { return NextResponse.json({ error: 'Say why the validation is being reopened — it goes on the audit trail.' }, { status: 400 }); }
      // v55.83-RO — a bill on a wire that was already SENT keeps the validation it was paid on
      var wOnR = await openWireOf(db, body.id);
      if (wOnR && wOnR.status === 'sent') { return NextResponse.json({ error: 'This bill is on wire ' + wOnR.label + ', which was already SENT — its validation cannot be reopened now.' }, { status: 409 }); }
      var rUp = await db.from('vendor_bills').update({ validation_status: 'pending', updated_at: new Date().toISOString() }).eq('id', body.id).select('id').maybeSingle();
      if (rUp.error) { throw new Error(rUp.error.message); }
      if (!rUp.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      await db.from('vendor_bill_events').insert({ bill_id: body.id, kind: 'validation_reopened', actor_id: userId, details: { reason: rNote.substring(0, 500) } });
      await audit(db, userId, 'bill_validation_reopened', 'vendor_bill', body.id, { reason: rNote.substring(0, 300), on_wire: wOnR ? wOnR.label : null }); // v55.83-RO
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
      // v55.83-QR (Max, Nov 8 00:41: "able to request amount of bills due for a
      // specific vendor up to a certain period of time") — optional vendor
      // filter, exact name (case/space-insensitive) so a pick never fuzzes
      // into a different vendor. Same isPayable gate — money math unchanged.
      var vendQ = String(body.vendor || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (vendQ) { all = all.filter(function (b) { return String(b.vendor_name || '').trim().toLowerCase().replace(/\s+/g, ' ') === vendQ; }); }
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
      var todayDT = new Date().toISOString().substring(0, 10);
      var overdueNow = 0; due.forEach(function (b) { if ((b.due_date || b.bill_date) < todayDT) { overdueNow = Math.round((overdueNow + b.open) * 100) / 100; } });
      return NextResponse.json({ ok: true, marker: API_BUILD_MARKER, through: thru, vendor: vendQ ? (due[0] ? due[0].vendor_name : body.vendor) : null,
        overdue_now: overdueNow, not_yet_due: Math.round((total - overdueNow) * 100) / 100,
        total_owed: total, bill_count: due.length,
        validated_open: validatedOpen, pending_validation_open: pendingOpen,
        by_vendor: Object.values(byVendor).sort(function (a, b2) { return b2.open - a.open; }),
        bills: due.map(function (b) { return { id: b.id, vendor: b.vendor_name, bill_number: b.bill_number, bill_date: b.bill_date, due_date: b.due_date || b.bill_date, total: Math.round((Number(b.total_amount) || 0) * 100) / 100, paid: b.paid, open: b.open, validation: b.validation_status, status: b.status, category: b.category || null }; }),
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
      // v55.83-VV — a PDF's bill is taken from its bill pages only; the WHOLE file is still stored below, unchanged
      var gRead = await readBillFromBase64(gB64, gType, { billPagesOnly: true, pageCount: typeof body.page_count === 'number' ? body.page_count : null });
      if (gRead.error) { return NextResponse.json({ ok: true, skipped: true, file: gName, reason: gRead.error }); }
      // v55.83-VV (Codex 21:08) — when the pages could not be confirmed (unclear, a second bill in the file, a release that
      // disagrees) NO bill is made here: several-files import has nobody looking at the pages. The file goes through the
      // one-file Import instead, where the pages are shown and the person must confirm before saving. Nothing is stored.
      if (gRead.needs_review === true) { return NextResponse.json({ ok: true, skipped: true, pages_need_review: true, pages: gRead.pages || null, file: gName, reason: 'NOT imported — ' + ((gRead.pages && gRead.pages.words) || 'the pages of this file could not be confirmed') + ' Import this file ON ITS OWN (Import, pick only this file): the pages are shown there and you confirm them before saving.' }); }
      var gD = gRead.draft;
      // v55.83-QH (Max 12:26) — ONE shared duplicate radar (lib): hard
      // vendor+number duplicates SKIP; shared reference/release/container
      // tokens, same amount near-date, and same vendor+date all WARN loudly
      // (incl. already-PAID), and the bill is still created for a human.
      var gVerdict = await billDupVerdict(db, { vendor_name: gD.vendor_name, bill_number: gD.bill_number, bill_date: gD.bill_date, total_amount: gD.total_amount, notes: gD.notes || '' });
      if (gVerdict.skip) { return NextResponse.json({ ok: true, skipped: true, file: gName, reason: gVerdict.skip }); }
      var gWarn = gVerdict.warn;
      var gCat = gD.category || null; var gProv = {};
      if (!gCat) { // v55.83-WX — the bill rules first (with the lines read from the file), then the vendor memory
        try {
          var gPick = await categoryForNewBill(db, { vendor_name: gD.vendor_name || '', total_amount: gD.total_amount, currency: 'USD', wave_business_id: US_WAVE_BUSINESS_ID, bill_number: gD.bill_number, notes: gD.notes || '',
            bill_type: gD.bill_type || null, release_number: gD.release_number || null }, gD.lines || []);
          gCat = gPick.category || null; gProv = provenanceFields(gPick, gPick.ready);
        } catch (eGC) { gCat = null; gProv = {}; }
      }
      var gPath = 'pv/upload-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '-' + gName;
      var gUpErr = null;
      try {
        var gUp = await db.storage.from('bills-private').upload(gPath, Buffer.from(gB64, 'base64'), { contentType: gType, upsert: false });
        if (gUp.error) { gUpErr = gUp.error.message; }
      } catch (eGU) { gUpErr = (eGU && eGU.message) || 'upload failed'; }
      var gIns = await insertImportedBill(db, Object.assign({
        vendor_name: gD.vendor_name || ('UNREAD VENDOR (file ' + gName + ')'),
        bill_number: gD.bill_number, bill_date: gD.bill_date || new Date().toISOString().substring(0, 10),
        due_date: gD.due_date, total_amount: gD.total_amount || 0.01,
        category: gCat, currency: 'USD', wave_business_id: US_WAVE_BUSINESS_ID,
        notes: ((gWarn ? gWarn + ' · ' : '') + 'Imported from file ' + gName +
                ((gRead.pages && gRead.pages.words && gRead.problems.indexOf(gRead.pages.words) < 0) ? ' · ' + gRead.pages.words : '') + // v55.83-VV — which pages the bill was taken from
                (gRead.problems.length ? ' · READER FLAGS: ' + gRead.problems.join(' ') : '')).substring(0, 900),
        validation_status: 'pending',
        attachment_path: gUpErr ? null : gPath,
        created_by: userId,
      }, gProv), gD); // v55.83-RP — type / release / direction sorted on import; WX — where the category came from
      if (gIns.error) { return NextResponse.json({ ok: true, skipped: true, file: gName, reason: gIns.error.message }); }
      try { await db.from('vendor_bill_events').insert({ bill_id: gIns.data.id, kind: 'file_ingested', actor_id: userId, details: { file: gName, reader_flags: gRead.problems, duplicate_warning: gWarn, attachment_stored: !gUpErr, pages: gRead.pages || null, pages_need_review: gRead.needs_review === true, sorted: gIns.sorted || null, price_check: gIns.price_check || null, price_flags: gIns.price_flags || [] } }); } catch (eGE) {}
      await audit(db, userId, 'bill_imported_from_file', 'vendor_bill', gIns.data.id, { file: gName, duplicate_warning: gWarn }); // v55.83-QI
      return NextResponse.json({ ok: true, created: true, id: gIns.data.id, file: gName,
        vendor: gD.vendor_name || null, amount: gD.total_amount || null,
        duplicate_warning: gWarn, reader_flags: gRead.problems, pages: gRead.pages || null, pages_need_review: gRead.needs_review === true, lines_read: gIns.lines_saved || 0, price_check: gIns.price_check || null, price_flags: gIns.price_flags || [] });
    }

    // ── v55.83-RQ — bill lines, price rules, reports ───────────────────────
    if (action === 'bill_lines') {
      // RV — refresh the check first (an older check has no organized columns; rules may have changed since)
      var blMgr = await assertPermission(db, userId, 'bills.manage', req);
      var blFresh = null;
      try { blFresh = await runPriceCheck(db, body.id, null, { actorId: userId, readOnly: !(blMgr && blMgr.ok === true) }); } catch (eBP) { blFresh = null; } // review #14 — a viewer only reads
      var blB = await db.from('vendor_bills').select('*').eq('id', body.id).maybeSingle();
      if (blB.error || !blB.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      var blL = await loadLines(db, body.id);
      if (blL.error) { return NextResponse.json({ ok: true, sql_missing: true, lines: [], note: 'Bill lines need sql/v55-83-RQ-bill-lines-price-rules.sql.' }); }
      var blCR = commissionRuleFor(await loadCommissionRules(db), blB.data.vendor_name);
      var blCheck = blFresh && blFresh.ok && blFresh.unsaved && (blB.data.validation_status !== 'validated' || !blB.data.price_check) ? blFresh.check : (blB.data.price_check || null); // RY — a bill validated before price checks existed shows today's check (not saved)
      return NextResponse.json({ ok: true, can_manage: !!(blMgr && blMgr.ok === true), lines: blL.lines, commission_rule: blCR, price_check: blCheck, price_check_status: blCheck ? blCheck.status : (blB.data.price_check_status || null),
        price_resolved_note: blB.data.price_resolved_note || null, locked: blB.data.validation_status === 'validated', validation_draft: blB.data.validation_draft || null, default_direction: defaultDirectionFor(await loadCommissionRules(db), blB.data.vendor_name) });
    }
    // v55.83-RU (Max, Nov 9 21:48: "please save entries when we validate even if we have not yet fully validated. such as just
    // entering the type or the direction") — the type and direction are saved on the bill at once (audited); the ticks and
    // notes are kept as a DRAFT (validation_draft) until "Mark validated" — a draft never counts as validated.
    if (action === 'save_validation_progress') {
      var vpB = await db.from('vendor_bills').select('*').eq('id', body.id).maybeSingle();
      if (vpB.error || !vpB.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      if (vpB.data.record_status !== 'active') { return NextResponse.json({ error: 'This bill is void.' }, { status: 409 }); }
      if (vpB.data.validation_status === 'validated') { return NextResponse.json({ error: 'This bill is already validated — reopen its validation to change it.' }, { status: 409 }); }
      var vpPatch = {}; var vpChanged = {};
      var vpT = String(body.bill_type || '').toLowerCase();
      if (vpT && !BILL_TYPE_LABEL[vpT]) { return NextResponse.json({ error: 'Unknown bill type.' }, { status: 400 }); }
      if (vpT && vpT !== vpB.data.bill_type) { vpPatch.bill_type = vpT; vpPatch.bill_type_source = 'manual'; vpChanged.bill_type = { from: vpB.data.bill_type || null, to: vpT }; }
      var vpD = String(body.shipment_direction || '').toLowerCase();
      if (vpD && vpD !== 'inbound' && vpD !== 'outbound') { return NextResponse.json({ error: 'Pick inbound or outbound.' }, { status: 400 }); }
      if (vpD && vpD !== vpB.data.shipment_direction) { vpPatch.shipment_direction = vpD; vpPatch.direction_source = 'manual'; vpChanged.shipment_direction = { from: vpB.data.shipment_direction || null, to: vpD }; }
      var vpDr = body.draft && typeof body.draft === 'object' ? body.draft : null;
      var vpWarn = null;
      if (vpDr) {
        var ckD = vpDr.checks || {};
        vpPatch.validation_draft = { checks: { matches_records: ckD.matches_records === true, goods_received: ckD.goods_received === true, charges_accurate: ckD.charges_accurate === true },
          notes: String(vpDr.notes || '').substring(0, 1000), price_resolution: String(vpDr.price_resolution || '').substring(0, 1000),
          warehouse_reference: String(vpDr.warehouse_reference || '').substring(0, 120), by: userId, by_name: null, at: new Date().toISOString() };
        try { var vpU = await db.from('users').select('name').eq('id', userId).maybeSingle(); vpPatch.validation_draft.by_name = (vpU && vpU.data && vpU.data.name) || null; } catch (eVU) { /* name is a nicety */ }
      }
      if (!Object.keys(vpPatch).length) { return NextResponse.json({ ok: true, saved: [] }); }
      var vpUp = await db.from('vendor_bills').update(vpPatch).eq('id', body.id).select('id').maybeSingle();
      if (vpUp.error && /validation_draft/.test(vpUp.error.message || '')) {
        delete vpPatch.validation_draft; vpWarn = 'type and direction saved; the ticks and notes are kept only after sql/v55-83-RU-validation-progress.sql is run';
        vpUp = Object.keys(vpPatch).length ? await db.from('vendor_bills').update(vpPatch).eq('id', body.id).select('id').maybeSingle() : { data: { id: body.id } };
      }
      if (vpUp.error && /HUB_EXACT_DUPLICATE/.test(vpUp.error.message || '')) { throw new Error(vpUp.error.message); } // v55.83-WZ — plain 409 (catch below), nothing saved
      if (vpUp.error) { return NextResponse.json({ error: vpUp.error.message }, { status: 500 }); }
      if (Object.keys(vpChanged).length) {
        await audit(db, userId, 'bill_validation_progress_saved', 'vendor_bill', body.id, vpChanged);
        if (vpChanged.bill_type) { await runPriceCheck(db, body.id); } // the rules may depend on the type
      }
      return NextResponse.json({ ok: true, saved: Object.keys(vpChanged).concat(vpPatch.validation_draft ? ['draft'] : []), warning: vpWarn || undefined });
    }
    if (action === 'save_lines') {
      var slB = await db.from('vendor_bills').select('*').eq('id', body.id).maybeSingle();
      if (slB.error || !slB.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      if (slB.data.record_status !== 'active') { return NextResponse.json({ error: 'This bill is void.' }, { status: 409 }); }
      var slW = await openWireOf(db, body.id);
      if (slW && slW.status === 'sent') { return NextResponse.json({ error: 'This bill is on wire ' + slW.label + ', which was already SENT — its lines cannot change now.' }, { status: 409 }); }
      var slR = await saveBillLines(db, slB.data, Array.isArray(body.lines) ? body.lines : [], 'manual', userId);
      if (!slR.ok) { return NextResponse.json({ error: slR.error + (slR.sql_missing ? ' — run sql/v55-83-RQ-bill-lines-price-rules.sql.' : '') }, { status: slR.status || 500 }); }
      await audit(db, userId, 'bill_lines_saved', 'vendor_bill', body.id, { lines: slR.lines.length, commission_vendor: slR.commission_rule ? slR.commission_rule.vendor_match : null });
      var slPC = await runPriceCheck(db, body.id, null, { actorId: userId });
      return NextResponse.json({ ok: true, lines: slR.lines, price_check: slPC && slPC.check ? slPC.check : null });
    }
    if (action === 'price_check') {
      var pcX = await runPriceCheck(db, body.id, null, { actorId: userId });
      if (!pcX.ok) { return NextResponse.json({ error: pcX.error + (pcX.sql_missing ? ' — run sql/v55-83-RQ-bill-lines-price-rules.sql.' : '') }, { status: 400 }); }
      return NextResponse.json({ ok: true, price_check: pcX.check });
    }
    if (action === 'price_rules_list') {
      var prL = await db.from('bill_price_rules').select('*').order('created_at', { ascending: false });
      if (prL.error) { return NextResponse.json({ ok: true, sql_missing: true, rules: [], commission_rules: [], note: 'Price rules need sql/v55-83-RQ-bill-lines-price-rules.sql.' }); }
      var crL = await db.from('bill_commission_rules').select('*').order('created_at', { ascending: true });
      return NextResponse.json({ ok: true, rules: prL.data || [], commission_rules: (crL && crL.data) || [], can_edit: await rulesGate() });
    }
    if (action === 'price_rule_save') {
      if (!(await rulesGate())) { return NextResponse.json({ error: 'Changing price rules needs “Bills: Price rules” — Settings → 🏦 Banking & Accounting Access.' }, { status: 403 }); }
      var ru = body.rule || {};
      var ruF = {
        vendor_match: String(ru.vendor_match || '').trim().substring(0, 120) || null,
        bill_type: BILL_TYPE_LABEL[String(ru.bill_type || '')] ? ru.bill_type : null,
        item_match: String(ru.item_match || '').trim().substring(0, 160) || null,
        unit: String(ru.unit || '').trim().toUpperCase().substring(0, 20) || null,
        expected_unit_price: ru.expected_unit_price === '' || ru.expected_unit_price == null ? null : Number(String(ru.expected_unit_price).replace(/[$,]/g, '')),
        expected_amount: ru.expected_amount === '' || ru.expected_amount == null ? null : Number(String(ru.expected_amount).replace(/[$,]/g, '')),
        tolerance_pct: ru.tolerance_pct === '' || ru.tolerance_pct == null ? 0 : Number(ru.tolerance_pct), // v55.83-VR (Max, Nov 20: "allowed diff in price rule is 0%") — a rule saved without a figure allows no difference
        applies_to: ru.applies_to === 'billed' ? 'billed' : 'cost',
        note: String(ru.note || '').trim().substring(0, 300) || null, updated_by: userId, updated_at: new Date().toISOString(),
      };
      if (!ruF.vendor_match && !ruF.bill_type && !ruF.item_match) { return NextResponse.json({ error: 'Say what the rule is for: a vendor, a bill type, or the product / service words.' }, { status: 400 }); }
      if (ruF.expected_unit_price == null && ruF.expected_amount == null) { return NextResponse.json({ error: 'Give the expected price — per unit, or a fixed amount.' }, { status: 400 }); }
      if ((ruF.expected_unit_price != null && !(ruF.expected_unit_price >= 0)) || (ruF.expected_amount != null && !(ruF.expected_amount >= 0))) { return NextResponse.json({ error: 'The expected price is not a number.' }, { status: 400 }); }
      if (!(ruF.tolerance_pct >= 0 && ruF.tolerance_pct <= 100)) { return NextResponse.json({ error: 'The allowed difference must be between 0 and 100 %.' }, { status: 400 }); }
      if (ruF.expected_unit_price != null && !ruF.item_match) { return NextResponse.json({ error: 'A per-unit price needs the product / service words (e.g. “Cambridge Seconds”).' }, { status: 400 }); }
      var ruR;
      if (ru.id) {
        var ruOld = await db.from('bill_price_rules').select('*').eq('id', ru.id).maybeSingle();
        ruR = await db.from('bill_price_rules').update(ruF).eq('id', ru.id).select('*').maybeSingle();
        if (!ruR.error) { await audit(db, userId, 'price_rule_changed', 'bill_price_rule', ru.id, { before: ruOld.data || null, after: ruF }); }
      } else {
        ruR = await db.from('bill_price_rules').insert(Object.assign({ created_by: userId }, ruF)).select('*').maybeSingle();
        if (!ruR.error) { await audit(db, userId, 'price_rule_created', 'bill_price_rule', ruR.data && ruR.data.id, ruF); }
      }
      if (ruR.error) { return NextResponse.json({ error: ruR.error.message + (/does not exist/.test(ruR.error.message) ? ' — run sql/v55-83-RQ-bill-lines-price-rules.sql.' : '') }, { status: 400 }); }
      var reN = await recheckOpenBills(db, { actorId: userId });
      return NextResponse.json({ ok: true, rule: ruR.data, rechecked: reN.checked, remaining: reN.remaining });
    }
    if (action === 'price_rule_off') {
      if (!(await rulesGate())) { return NextResponse.json({ error: 'Changing price rules needs “Bills: Price rules”.' }, { status: 403 }); }
      var offR = await db.from('bill_price_rules').update({ active: body.active === true, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', body.id).select('id').maybeSingle();
      if (offR.error || !offR.data) { return NextResponse.json({ error: (offR.error && offR.error.message) || 'Rule not found.' }, { status: 400 }); }
      await audit(db, userId, body.active === true ? 'price_rule_turned_on' : 'price_rule_turned_off', 'bill_price_rule', body.id, {});
      var reN2 = await recheckOpenBills(db, { actorId: userId });
      return NextResponse.json({ ok: true, rechecked: reN2.checked, remaining: reN2.remaining });
    }
    if (action === 'commission_rule_save') {
      if (!(await rulesGate())) { return NextResponse.json({ error: 'Changing commission rules needs “Bills: Price rules”.' }, { status: 403 }); }
      var cru = body.rule || {};
      var crRate = Number(String(cru.rate_pct == null ? '' : cru.rate_pct).replace('%', '')) / 100;
      var crF = { vendor_match: String(cru.vendor_match || '').trim().substring(0, 120), rate: crRate, active: cru.active !== false, note: String(cru.note || '').trim().substring(0, 300) || null, updated_by: userId, updated_at: new Date().toISOString() };
      if (Object.prototype.hasOwnProperty.call(cru, 'default_direction')) { crF.default_direction = cru.default_direction === 'inbound' || cru.default_direction === 'outbound' ? cru.default_direction : null; } // RW
      if (!crF.vendor_match) { return NextResponse.json({ error: 'Which vendor bills cost + a commission?' }, { status: 400 }); }
      if (!(crF.rate > 0 && crF.rate < 1)) { return NextResponse.json({ error: 'The commission % must be between 0 and 100 (e.g. 12.5).' }, { status: 400 }); }
      var crR;
      if (cru.id) { crR = await db.from('bill_commission_rules').update(crF).eq('id', cru.id).select('*').maybeSingle(); }
      else { crR = await db.from('bill_commission_rules').insert(Object.assign({ created_by: userId }, crF)).select('*').maybeSingle(); }
      if (crR.error && /default_direction/.test(crR.error.message || '')) { return NextResponse.json({ error: 'The bills-direction setting needs sql/v55-83-RW-vendor-default-direction.sql — run it in Supabase, then save again.' }, { status: 400 }); }
      if (crR.error) { return NextResponse.json({ error: crR.error.message }, { status: 400 }); }
      await audit(db, userId, cru.id ? 'commission_rule_changed' : 'commission_rule_created', 'bill_commission_rule', crR.data && crR.data.id, crF);
      var reN3 = await recheckOpenBills(db, { actorId: userId });
      return NextResponse.json({ ok: true, rule: crR.data, rechecked: reN3.checked, remaining: reN3.remaining });
    }
    if (action === 'bill_reports') {
      var rpRange = periodRange(String(body.period || 'since_jun1'), body.today || null, { from: body.from, to: body.to });
      var rpL = await loadBills(db);
      var rpLines = [];
      try { rpLines = await fetchAll(function () { return db.from('vendor_bill_lines').select('bill_id, line_no, line_kind, description, item_key, qty, unit, unit_price, amount, cost_amount, commission_amount'); }); } catch (eRL2) { rpLines = []; }
      var linesBy = {}; rpLines.forEach(function (l) { (linesBy[l.bill_id] = linesBy[l.bill_id] || []).push(l); });
      var payBy = {}; var paidBy2 = {};
      (rpL.pays || []).forEach(function (p) { (payBy[p.bill_id] = payBy[p.bill_id] || []).push(p); if (p.voided !== true) { paidBy2[p.bill_id] = (paidBy2[p.bill_id] || 0) + (Number(p.amount) || 0); } });
      var rpCR = await loadCommissionRules(db);
      // bill types live on the bill rows (RP); loadBills may predate them — fetch them apart
      try { var tR = await fetchAll(function () { return db.from('vendor_bills').select('id, bill_type, shipment_direction'); }); var tBy = {}; tR.forEach(function (x) { tBy[x.id] = x; }); rpL.bills.forEach(function (b) { if (tBy[b.id]) { b.bill_type = tBy[b.id].bill_type; b.shipment_direction = tBy[b.id].shipment_direction; } }); } catch (eT) { /* RP not run */ }
      var commBills = rpL.bills.filter(function (b) { return !!commissionRuleFor(rpCR, b.vendor_name); });
      var inv = productInventory(commBills, linesBy, paidBy2, rpRange);
      var spend = spendReport(rpL.bills, linesBy, payBy, rpRange, { skip: function (b) { return !!commissionRuleFor(rpCR, b.vendor_name); } });
      var invTot = inv.reduce(function (a, r) { a.cost += r.cost; a.commission += r.commission; a.billed += r.billed; a.paid += r.paid; return a; }, { cost: 0, commission: 0, billed: 0, paid: 0 });
      ['cost', 'commission', 'billed', 'paid'].forEach(function (k) { invTot[k] = r2(invTot[k]); });
      var noLines = commBills.filter(function (b) { return b.record_status === 'active' && !(linesBy[b.id] || []).length && String(b.bill_date || '') >= rpRange.from && String(b.bill_date || '') <= rpRange.to; }).length;
      return NextResponse.json({ ok: true, range: rpRange, inventory: inv, inventory_totals: invTot, commission_bills_without_lines: noLines, spend: spend,
        commission_vendors: rpCR.map(function (c) { return { vendor: c.vendor_match, rate: Number(c.rate) }; }) });
    }

    if (action === 'extract_bill') {
      // v55.83-VV — body.pages = the pages a person picked ("use these pages instead"); body.page_count = pages counted in the browser
      var rd = await readBillFromBase64(String(body.file_base64 || ''), String(body.media_type || ''), { billPagesOnly: true, pages: body.pages != null ? body.pages : null, pageCount: typeof body.page_count === 'number' ? body.page_count : null });
      if (rd.error) { return NextResponse.json({ error: rd.error }, { status: rd.status || 500 }); }
      // v55.83-PJ — the document rarely names a category; the vendor's
      // REMEMBERED one is suggested (clearly marked, human still confirms).
      var sugg = null; var suggRule = null; var suggWhy = null;
      if (rd.draft && rd.draft.vendor_name && !rd.draft.category) { // v55.83-WX — a bill rule first, then the vendor memory
        var sPick = await categoryForNewBill(db, { vendor_name: rd.draft.vendor_name, total_amount: rd.draft.total_amount, currency: 'USD', wave_business_id: US_WAVE_BUSINESS_ID, bill_number: rd.draft.bill_number, notes: rd.draft.notes || '',
          bill_type: rd.draft.bill_type || null, release_number: rd.draft.release_number || null }, rd.draft.lines || []);
        sugg = sPick.category || null;
        if (sPick.source === 'rule') { suggRule = { id: sPick.rule_id, version: sPick.rule_version }; }
        if (sPick.source === 'rule_conflict') { suggWhy = sPick.blocked || ('bill rules disagree: ' + (sPick.conflict || []).map(function (r) { return r.name; }).join(' / ')); }
      }
      // v55.83-RP — the bill TYPE (read from the bill, else this vendor's validated history) and direction (release # → outbound)
      var sortX = importSort(rd.draft, rd.draft && !rd.draft.bill_type ? await vendorBillType(db, rd.draft.vendor_name) : null, defaultDirectionFor(await loadCommissionRules(db), rd.draft && rd.draft.vendor_name)); // RW
      var pv = null;
      try {
        var pvRules = await loadPriceRules(db); var pvCR = commissionRuleFor(await loadCommissionRules(db), rd.draft && rd.draft.vendor_name);
        var pvLines = ((rd.draft && rd.draft.lines) || []).map(function (l, i) { return shapeLine(Object.assign({}, l, { line_kind: l.line_kind || (sortX.bill_type && sortX.bill_type !== 'supplier' ? 'charge' : 'item') }), i); });
        var pvC = priceCheckPure({ vendor_name: rd.draft && rd.draft.vendor_name, total_amount: rd.draft && rd.draft.total_amount, bill_type: sortX.bill_type }, pvLines, pvRules, pvCR);
        pv = { status: pvC.status, flags: pvC.flags, notes: pvC.notes, checked: pvC.checked, commission_rule: pvCR ? { vendor: pvCR.vendor_match, rate: Number(pvCR.rate) } : null };
      } catch (ePV) { pv = null; }
      return NextResponse.json({ ok: true, marker: API_BUILD_MARKER, draft: rd.draft, problems: rd.problems, pages: rd.pages || null, pages_need_review: rd.needs_review === true, suggested_category: sugg, suggested_category_rule: suggRule, suggested_category_conflict: suggWhy, sorted: sortX, price_preview: pv });
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
    if (action === 'paid_through_parties') { // v55.83-QY
      return NextResponse.json({ ok: true, parties: await loadParties(db) });
    }
    if (action === 'rtm_open_bills') {
      var LR = await loadBills(db);
      var payerQ = partyKey(body.payer); // v55.83-QY — only THAT company's bills
      var rowsR = decorate(LR.bills, LR.pays).filter(function (b) {
        return b.record_status === 'active' && b.paid_via && b.open > 0.005 && (!payerQ || partyKey(b.paid_via) === payerQ);
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
    // v55.83-SN (Max, Nov 14: "where do I view the bill?") — attach the document to a bill that has none.
    // Private path only; a bill that already has its file keeps it (never silently replaced).
    // v55.83-SV — "these two are NOT the same bill": written down with who and why; the flag for that pair goes away.
    // Nothing is deleted. It is a new event on the bill, so it can always be seen later.
    if (action === 'dismiss_bill_dup') {
      var ddReason = String(body.reason || '').trim();
      var ddOthers = Array.isArray(body.other_ids) ? body.other_ids.slice(0, 20) : [];
      if (!body.bill_id || !ddOthers.length) { return NextResponse.json({ error: 'A bill and the bill(s) it was compared with are required.' }, { status: 400 }); }
      if (ddReason.length < 10) { return NextResponse.json({ error: 'Write why these are not the same bill (at least a short sentence).' }, { status: 400 }); }
      var ddCur = await db.from('vendor_bills').select('id').eq('id', body.bill_id).maybeSingle();
      if (ddCur.error || !ddCur.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      for (var ddi = 0; ddi < ddOthers.length; ddi++) {
        var ddIns = await db.from('vendor_bill_events').insert({ bill_id: body.bill_id, kind: 'dup_dismissed', actor_id: userId, details: { other_id: String(ddOthers[ddi]), reason: ddReason.substring(0, 500) } });
        if (ddIns.error) { return NextResponse.json({ error: ddIns.error.message }, { status: 400 }); }
      }
      await audit(db, userId, 'bill_duplicate_dismissed', 'vendor_bill', body.bill_id, { others: ddOthers, reason: ddReason.substring(0, 500) });
      return NextResponse.json({ ok: true });
    }
    if (action === 'attach_bill_file') {
      var afPath = String(body.attachment_path || '').trim();
      if (!body.bill_id || !/^pv\/\d{10,}-[a-zA-Z0-9._-]{1,60}$/.test(afPath)) { return NextResponse.json({ error: 'A bill and a private file path are required.' }, { status: 400 }); }
      var afCur = await db.from('vendor_bills').select('id, record_status, attachment_path').eq('id', body.bill_id).maybeSingle();
      if (afCur.error || !afCur.data) { return NextResponse.json({ error: 'Bill not found.' }, { status: 404 }); }
      if (afCur.data.record_status === 'deleted') { return NextResponse.json({ error: 'This bill was deleted — a file cannot be attached to it.' }, { status: 409 }); }
      if (String(afCur.data.attachment_path || '').trim()) { return NextResponse.json({ error: 'This bill already has its file. It was not replaced.' }, { status: 409 }); }
      var afUp = await db.from('vendor_bills').update({ attachment_path: afPath }).eq('id', body.bill_id).select('id').maybeSingle();
      if (afUp.error) { return NextResponse.json({ error: afUp.error.message }, { status: 400 }); }
      await audit(db, userId, 'bill_file_attached', 'vendor_bill', body.bill_id, { attachment_path: afPath });
      return NextResponse.json({ ok: true });
    }
    if (action === 'advance_flag') {
      var txAv = await db.from('bank_transactions').select('id, direction, pending').eq('id', body.bank_transaction_id).maybeSingle();
      if (txAv.error || !txAv.data) { return NextResponse.json({ error: 'Bank transaction not found.' }, { status: 404 }); }
      if (txAv.data.direction !== 'out') { return NextResponse.json({ error: 'An advance is MONEY OUT — that transaction is money in.' }, { status: 409 }); }
      if (txAv.data.pending === true && body.clear !== true) { return NextResponse.json({ error: PENDING_REFUSAL, pending: true }, { status: 409 }); } // v55.83-XT
      var upAv = await db.from('bank_transactions').update({ advance_flag: body.clear !== true }).eq('id', body.bank_transaction_id).select('id');
      if (upAv.error) { return NextResponse.json({ error: upAv.error.message + (/advance_flag/.test(upAv.error.message || '') ? ' — run sql/v55-83-QF-advance-flag.sql first.' : '') }, { status: 400 }); }
      await audit(db, userId, body.clear === true ? 'advance_flag_cleared' : 'advance_flagged', 'bank_transaction', body.bank_transaction_id, null); // v55.83-QI
      return NextResponse.json({ ok: true, advance: body.clear !== true });
    }
    if (action === 'rtm_flag') {
      var txR = await db.from('bank_transactions').select('id, direction, pending, wave_business_id, account_id').eq('id', body.bank_transaction_id).maybeSingle();
      if (txR.error || !txR.data) { return NextResponse.json({ error: 'Bank transaction not found.' }, { status: 404 }); }
      // v55.83-UD (Codex 11:40) — checked here, not only by what the screen lists: a private line the caller may not see is "not found";
      // only a settled KTC line in one of KTC's own accounts can be marked as a payment to NextTrade / RTM (clearing a mark is always allowed)
      var scopeRF = await privateScope(db, userId); if (scopeRF.error) { return NextResponse.json({ error: scopeRF.error + ' — nothing changed.' }, { status: 503 }); }
      if (isPrivateRow(txR.data, scopeRF)) { return NextResponse.json({ error: 'Bank transaction not found.' }, { status: 404 }); }
      if (body.clear !== true) {
        if (txR.data.wave_business_id !== US_WAVE_BUSINESS_ID) { return NextResponse.json({ error: 'Only a KTC bank line can be a payment to a paid-through company.' }, { status: 409 }); }
        if (txR.data.pending === true) { return NextResponse.json({ error: 'That line is still pending — wait until it settles.' }, { status: 409 }); }
        var acR = await db.from('plaid_accounts').select('plaid_account_id, wave_business_id').eq('plaid_account_id', txR.data.account_id || '').maybeSingle();
        if (acR.error) { return NextResponse.json({ error: 'Could not read the bank account (' + acR.error.message + ') — nothing changed.' }, { status: 503 }); }
        if (!acR.data || acR.data.wave_business_id !== US_WAVE_BUSINESS_ID) { return NextResponse.json({ error: 'That line is not in one of KTC\u2019s own bank accounts.' }, { status: 409 }); }
      }
      if (txR.data.direction !== 'out') { return NextResponse.json({ error: 'A payment to a paid-through company is MONEY OUT — that transaction is money in.' }, { status: 409 }); }
      // v55.83-QY — the payer must be a registered paid-through company
      var partiesF = await loadParties(db);
      var payerF = null;
      partiesF.forEach(function (pf) { if (partyKey(pf.name) === partyKey(body.payer || 'RTM Capital')) { payerF = pf.name; } });
      if (!payerF && body.clear !== true) { return NextResponse.json({ error: 'Unknown paid-through company "' + (body.payer || '') + '".' }, { status: 400 }); }
      var upR = await db.from('bank_transactions')
        .update({ third_party_payer: body.clear === true ? null : payerF })
        .eq('id', body.bank_transaction_id).select('id');
      if (upR.error) { return NextResponse.json({ error: upR.error.message + (/third_party_payer/.test(upR.error.message || '') ? ' — run sql/v55-83-QB-rtm-third-party.sql first.' : '') }, { status: 400 }); }
      // v55.83-RB (gap review) — money sent to a RELATED company (NextTrade) is
      // an advance: marking it is the person's decision, so the row is finished
      // (reviewed, when fully accounted for) and the ClickBooks books record it
      // as "Due from NextTrade Industries" — never as an expense by itself.
      var reviewedF = false;
      var kindF = null; partiesF.forEach(function (pk) { if (pk.name === payerF) { kindF = pk.kind; } });
      if (body.clear !== true && kindF === 'affiliate') { reviewedF = (await autoReviewIfComplete(db, [body.bank_transaction_id], userId)).length > 0; }
      await audit(db, userId, body.clear === true ? 'rtm_flag_cleared' : 'rtm_payment_flagged', 'bank_transaction', body.bank_transaction_id, { payer: payerF, reviewed: reviewedF }); // v55.83-QI
      return NextResponse.json({ ok: true, flagged: body.clear !== true, reviewed: reviewedF });
    }

    // ── v55.83-QM (Max 15:33: "add the matching and category features on
    //    this location as well" — the All Invoices screen): candidates the
    //    OTHER way round — pick an invoice, see the deposits that could pay
    //    it (money in, not pending, not transfer, not duplicate, with money
    //    still unapplied), scored by fit. The write stays bank-write
    //    match_invoice — same guards, money math in one place. ──
    if (action === 'invoice_match_candidates') {
      var invQ = await db.from('accounting_invoices').select('*').eq('id', body.invoice_id).maybeSingle();
      if (invQ.error || !invQ.data) { return NextResponse.json({ ok: false, error: 'Invoice not found.' }, { status: 404 }); }
      var openListQ = await loadOpenUsInvoices(db);
      var invMeta = null;
      openListQ.forEach(function (v9) { if (v9.id === body.invoice_id) { invMeta = v9; } });
      var invOpen = invMeta ? invMeta.open_balance : null;
      var sinceQ = new Date(Date.now() - 240 * 86400000).toISOString().substring(0, 10);
      var txQ = await db.from('bank_transactions')
        .select('id, date, posted_date, amount_abs, name, merchant_name, wave_business_id, matched_invoice_id, transfer_group_id, pending, classification, business_id')
        .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'in')
        .neq('pending', true).neq('review_status', 'duplicate')
        .is('transfer_group_id', null)
        .gte('date', sinceQ).order('date', { ascending: false }).limit(3000);
      if (txQ.error) { return NextResponse.json({ ok: false, error: txQ.error.message }, { status: 400 }); }
      var appQ = {}; // applied per deposit
      try {
        var payQ = await db.from('accounting_invoice_payments').select('bank_transaction_id, amount, voided, sync_status').not('bank_transaction_id', 'is', null).gte('payment_date', sinceQ).limit(20000);
        ((payQ && payQ.data) || []).forEach(function (p9b) {
          var st9 = String(p9b.sync_status || '').toLowerCase();
          if (p9b.voided === true || st9 === 'void' || st9 === 'voided' || st9 === 'cancelled' || st9 === 'reversed' || st9 === 'deleted') { return; }
          appQ[p9b.bank_transaction_id] = r2((appQ[p9b.bank_transaction_id] || 0) + (Number(p9b.amount) || 0));
        });
      } catch (eQp) {}
      var custNmQ = '';
      try {
        if (invQ.data.accounting_customer_id) {
          var cQ = await db.from('accounting_customers').select('company_name, contact_name').eq('id', invQ.data.accounting_customer_id).maybeSingle();
          custNmQ = String((cQ.data && (cQ.data.company_name || cQ.data.contact_name)) || '').toLowerCase();
        }
      } catch (eQc) {}
      var toksQ = custNmQ.split(/[^a-z0-9&]+/).filter(function (t9b) { return t9b.length >= 3; });
      var candsQ = (txQ.data || []).map(function (t9c) {
        var rem9 = r2(t9c.amount_abs - (appQ[t9c.id] || 0));
        if (rem9 <= 0.005) { return null; }
        var sc9 = 0;
        if (invOpen != null && Math.abs(rem9 - invOpen) <= 0.01) { sc9 += 100; }
        else if (invOpen != null && rem9 <= invOpen + 0.01) { sc9 += 10; }
        var hay9 = String((t9c.merchant_name || '') + ' ' + (t9c.name || '')).toLowerCase();
        toksQ.forEach(function (t9d) { if (hay9.indexOf(t9d) >= 0) { sc9 += 25; } });
        return { txn: t9c, remaining: rem9, score: sc9, exact: invOpen != null && Math.abs(rem9 - invOpen) <= 0.01 };
      }).filter(Boolean).sort(function (a9, b9) { return b9.score - a9.score || String(b9.txn.date).localeCompare(String(a9.txn.date)); }).slice(0, 20);
      return NextResponse.json({ ok: true, invoice: invQ.data, invoice_open: invOpen, candidates: candsQ, api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'deposit_match_candidates') {
      var txDm = await db.from('bank_transactions').select('id, date, posted_date, amount_abs, name, merchant_name, wave_business_id, matched_invoice_id, pending').eq('id', body.bank_transaction_id).maybeSingle();
      if (txDm.error || !txDm.data) { return NextResponse.json({ ok: false, error: 'Deposit not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      if (txDm.data.pending === true) { return NextResponse.json({ ok: false, error: PENDING_REFUSAL, pending: true, api_build_marker: API_BUILD_MARKER }, { status: 409 }); } // v55.83-XT
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
      var apDm = 0; var apDetail = [];
      try {
        // v55.83-QQ (Max 16:08: "it should show it somewhere... where they
        // went... so it is clear where I put the money as I split it")
        var apQ = await db.from('accounting_invoice_payments').select('accounting_invoice_id, amount, payment_date, voided, sync_status').eq('bank_transaction_id', txDm.data.id);
        var apInvIds = [];
        ((apQ && apQ.data) || []).forEach(function (p0) {
          var st0 = String(p0.sync_status || '').toLowerCase();
          if (p0.voided !== true && st0 !== 'void' && st0 !== 'voided' && st0 !== 'cancelled' && st0 !== 'reversed' && st0 !== 'deleted') {
            apDm = r2(apDm + (Number(p0.amount) || 0));
            apDetail.push({ kind: 'invoice', invoice_id: p0.accounting_invoice_id, amount: r2(p0.amount), date: p0.payment_date });
            if (apInvIds.indexOf(p0.accounting_invoice_id) < 0) { apInvIds.push(p0.accounting_invoice_id); }
          }
        });
        if (apInvIds.length) {
          var apRefs = await db.from('accounting_invoices').select('id, invoice_number, release_number, accounting_customer_id').in('id', apInvIds.slice(0, 50));
          var apRefBy = {}; ((apRefs && apRefs.data) || []).forEach(function (r0) { apRefBy[r0.id] = r0; });
          apDetail.forEach(function (d0) { var r1 = apRefBy[d0.invoice_id]; if (r1) { d0.ref = r1.invoice_number; d0.rel = r1.release_number || null; } });
          // v55.83-RD (Max, Nov 8 14:24: "description should also be displayed
          // in this area when seeing where it was matched") — who the invoice is
          // for and what it was for (its line descriptions). Fail-soft.
          try {
            var custIdsD = []; ((apRefs && apRefs.data) || []).forEach(function (r4) { if (r4.accounting_customer_id && custIdsD.indexOf(r4.accounting_customer_id) < 0) { custIdsD.push(r4.accounting_customer_id); } });
            var custByD = {};
            if (custIdsD.length) {
              var cuD = await db.from('accounting_customers').select('id, company_name, contact_name').in('id', custIdsD);
              ((cuD && cuD.data) || []).forEach(function (c4) { custByD[c4.id] = c4.company_name || c4.contact_name || ''; });
            }
            var itD = await db.from('accounting_invoice_items').select('invoice_id, description, wave_product_name').in('invoice_id', apInvIds.slice(0, 50));
            var itByD = {};
            ((itD && itD.data) || []).forEach(function (i4) {
              var tx4 = String(i4.description || i4.wave_product_name || '').trim();
              if (!tx4) { return; }
              var arr4 = itByD[i4.invoice_id] = itByD[i4.invoice_id] || [];
              if (arr4.indexOf(tx4) < 0) { arr4.push(tx4); }
            });
            apDetail.forEach(function (d4) {
              var r5 = apRefBy[d4.invoice_id];
              if (r5) { d4.party = custByD[r5.accounting_customer_id] || null; }
              var lines4 = itByD[d4.invoice_id] || [];
              d4.desc = lines4.length ? lines4.slice(0, 3).join(' · ').substring(0, 240) + (lines4.length > 3 ? ' · +' + (lines4.length - 3) + ' more' : '') : null;
            });
          } catch (eDsc) { /* descriptions are a nicety — the amounts above already stand */ }
        }
        // parked (UNCATEGORIZED/unapplied) money counts as placed too
        var apUn = await db.from('unapplied_deposits').select('amount, status').eq('bank_transaction_id', txDm.data.id).eq('status', 'open');
        ((apUn && apUn.data) || []).forEach(function (u0) { apDm = r2(apDm + (Number(u0.amount) || 0)); apDetail.push({ kind: 'unapplied', amount: r2(u0.amount) }); });
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
      var txOutDm = Object.assign({}, txDm.data, { applied: apDm, remaining: Math.max(0, r2(amtDm - apDm)), applied_detail: apDetail });
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
      var apBm = 0; var apDetailB = [];
      try {
        var apQ2 = await db.from('vendor_bill_payments').select('bill_id, amount, paid_date, method, voided').eq('bank_transaction_id', txBm.data.id);
        var apBillIds = [];
        ((apQ2 && apQ2.data) || []).forEach(function (p1) {
          if (p1.voided !== true) {
            apBm = r2(apBm + (Number(p1.amount) || 0));
            apDetailB.push({ kind: p1.method === 'rtm' ? 'rtm_bill' : 'bill', bill_id: p1.bill_id, amount: r2(p1.amount), date: p1.paid_date });
            if (apBillIds.indexOf(p1.bill_id) < 0) { apBillIds.push(p1.bill_id); }
          }
        });
        if (apBillIds.length) {
          var apBr = await db.from('vendor_bills').select('id, vendor_name, bill_number, category, notes').in('id', apBillIds.slice(0, 50));
          var apBrBy = {}; ((apBr && apBr.data) || []).forEach(function (r2b) { apBrBy[r2b.id] = r2b; });
          apDetailB.forEach(function (d1) {
            var r3 = apBrBy[d1.bill_id];
            if (r3) {
              d1.ref = (r3.vendor_name || '') + (r3.bill_number ? ' · ' + r3.bill_number : '');
              d1.party = r3.vendor_name || null;
              // v55.83-RD — what the bill was for
              d1.desc = [r3.category ? String(r3.category).replace(/_/g, ' ') : '', String(r3.notes || '').trim()].filter(Boolean).join(' · ').substring(0, 240) || null;
            }
          });
        }
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
      var txOutBm = Object.assign({}, txBm.data, { applied: apBm, remaining: Math.max(0, r2(amtBm - apBm)), applied_detail: apDetailB });
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
      // v55.83-RE/RF (Max, Nov 8 15:12 + 15:25 "yes in settings bank balances"):
      // Bank Balance is a P2 value AND needs the Bank Balances switch in
      // Settings → 🏦 Banking & Accounting Access (granted only by a super admin; the verified
      // super admin always passes). Both, or no balance.
      try {
        var okBal = false;
        if (vis.fin === true) {
          var profF = await db.from('profiles').select('email').eq('id', userId).maybeSingle();
          var emailF = profF.data && profF.data.email ? String(profF.data.email).toLowerCase() : null;
          if (emailF) {
            var idsF = await db.rpc('bank_visibility_identity_map');
            var authF = null;
            (idsF.data || []).forEach(function (r7) { if (String(r7.email || '').toLowerCase() === emailF) { authF = r7.auth_user_id; } });
            if (authF) {
              var superIdsF = String(process.env.HUB_SUPER_ADMIN_AUTH_USER_IDS || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
              okBal = superIdsF.indexOf(authF) >= 0;
              if (!okBal) {
                var gF = await db.from('financial_visibility_permissions').select('can_view_bank_balances').eq('auth_user_id', authF).maybeSingle();
                okBal = !!(gF.data && gF.data.can_view_bank_balances === true);
              }
            }
          }
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
      } catch (eBal) { balF = null; }
      var fcPayload = { buckets: buckets, rows: rows,
        excluded_old: { count: exCount, sum: exSum, before: FORECAST_CREATED_FROM },
        unflagged: { expenses: unrevOut.count || 0, deposits: unmatchedIn.count || 0 } };
      fcPayload = maskForecast(fcPayload, vis); // v55.83-RE — expected / late / bills due stay (P1); net + balance need P2
      fcPayload.ok = true; fcPayload.marker = API_BUILD_MARKER; fcPayload.today = todayF; fcPayload.bucket_order = BUCKETS;
      fcPayload.bank_balance = vis.fin ? balF : null; // v55.83-RE/RF — P2 + the Bank Balances switch (decided above)
      fcPayload.totals_masked = !canTotals; fcPayload.rows_visible = canRows; fcPayload.vis = vis;
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
      // v55.83-XO (Codex 22 Nov 14:52) — set inside the spending block, answered after it (never swallowed by its catch):
      //   xoStop     — the starting balances could not be read (not "not installed"): 503, nothing shown, no pack
      //   xoRestrict — a starting balance this caller may not see counts in these dates: spending withheld, said so
      var xoStop = null; var xoRestrict = null; var callerIsSuper = !!(visT && visT.ctx && visT.ctx.isSuperAdmin);
      try {
        // v55.83-PV (Max, Nov 7 10:34: "tax reports need data for all of 2026
        // to start") — Wave's API exposes no dated payment records, so the
        // bank feed IS the dated 2026 money record (both directions, cash
        // basis). Fetch in AND out; the income side mirrors the spending side.
        var spTx = await fetchAll(function () {
          return db.from('bank_transactions')
            .select('id, date, posted_date, amount_abs, name, merchant_name, classification, transfer_group_id, matched_invoice_id, direction, third_party_payer')
            .eq('wave_business_id', US_WAVE_BUSINESS_ID).in('direction', ['in', 'out']).neq('pending', true)
            .neq('review_status', 'duplicate') // v55.83-QM — duplicates never count in spending/income
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
        // v55.83-WF step C (Max, 20 Nov 2026, twice through Codex; "it still does not guarantee the full RTM next trade transfer") —
        // THE TAX PRESENTATION: every transfer KTC sent RTM Capital or NextTrade Industries counts ONCE, IN FULL, under
        // "Professional fees", on its own bank date — whatever category the bank line happens to carry (none, "transfer", anything).
        // Nothing is taken out when part of it is still held, and nothing is added when held money later pays a bill or is
        // marked / unmarked as services rendered: those are internal moves, not new payments. Which line is such a transfer is
        // decided by the ONE shared rule (fundingIdentity: stamped for the company, or the bank text names its account). A line
        // paired as a transfer between KTC's own accounts is never one. The INTERNAL view re-buckets from this same key.
        var profKeyP = null;
        Object.keys(catLabels || {}).forEach(function (kP) { if (!profKeyP && /professional/i.test(String(catLabels[kP] || kP))) { profKeyP = kP; } });
        var taxKeyP = profKeyP || '__professional_fees_pt';
        var fundingTax = { count: 0, total: 0, recategorized: 0, recategorized_total: 0, by_party: {} };
        var isFundingLine = function (tF) { if (tF.direction !== 'out' || tF.transfer_group_id) { return null; } return fundingIdentity({ direction: 'out', third_party_payer: tF.third_party_payer, name: tF.name, merchant_name: tF.merchant_name }); };
        // v55.83-WO (Max screenshots via Codex, 21 Nov 00:05, P1) — RETURNED CHECKS are counted NET. A deposit that the bank later
        // returned is two bank lines in this one category: money IN (the deposit) and money OUT (the return). The category's
        // expense is the returns MINUS the deposits categorized into it — a matched pair is 0, not a cost and not income. Both bank
        // lines stay exactly as they are and stay in the gross money-in / money-out totals. Nothing is paired by amount: only a
        // line a person put in this category counts. A separate bank fee for the return has its own category and stays a cost.
        var isContraCat = function (kC) { return !!kC && (kC === 'returned_checks' || /returned\s+checks?/i.test(String(catLabels[kC] || ''))); };
        var contra = { credit_count: 0, credits: 0, debit_count: 0, debits: 0, matched_invoice_credits: 0 };
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
            // WO — a deposit a person categorized as a returned check is that, also when it is matched to an invoice: the match is
            // left alone (nothing is un-matched or marked paid here), but the deposit is not counted as a customer payment.
            var contraIn = !isTrf && isContraCat(t6.classification);
            var keyI = isTrf ? 'transfer' : (contraIn ? t6.classification : (t6.matched_invoice_id ? 'customer_payment' : (t6.classification || null)));
            if (inRows.length < 500 || ((!keyI || contraIn) && inRows.length < 3000)) { inRows.push({ id: t6.id, date: d6, who: t6.merchant_name || t6.name || '', amount: amt6, category: keyI || '', paired: !!t6.transfer_group_id, returned_deposit: contraIn ? true : undefined, matched_invoice: contraIn && t6.matched_invoice_id ? true : undefined }); } // v55.83-TS — id lets Stats save a category right on the row; uncategorized rows are never cut by the cap
            if (isTrf) { trfIn.count++; trfIn.total = r2(trfIn.total + amt6); return; }
            if (!keyI) { uncIn.count++; uncIn.total = r2(uncIn.total + amt6); return; }
            if (contraIn) {
              // money in, shown on the income side as NOT income; and taken off the same category on the spending side
              if (!byCatIn[keyI]) { byCatIn[keyI] = { key: keyI, label: (catLabels[keyI] || keyI) + ' — deposits later returned (netted against the return; not income)', kind: 'not_pnl', count: 0, total: 0 }; }
              byCatIn[keyI].count++; byCatIn[keyI].total = r2(byCatIn[keyI].total + amt6);
              if (!byCat[keyI]) { byCat[keyI] = { key: keyI, label: catLabels[keyI] || keyI, kind: kindOf(keyI), count: 0, total: 0 }; }
              byCat[keyI].count++; byCat[keyI].total = r2(byCat[keyI].total - amt6); byCat[keyI].net = true;
              byCat[keyI].credits = r2((byCat[keyI].credits || 0) + amt6); byCat[keyI].credit_count = (byCat[keyI].credit_count || 0) + 1;
              contra.credit_count++; contra.credits = r2(contra.credits + amt6); if (t6.matched_invoice_id) { contra.matched_invoice_credits++; }
              if (spRows.length < 3000) { spRows.push({ id: t6.id, date: d6, who: t6.merchant_name || t6.name || '', amount: r2(0 - amt6), category: keyI, paired: false, money_in: true, matched_invoice: t6.matched_invoice_id ? true : undefined }); }
              return;
            }
            if (!byCatIn[keyI]) { byCatIn[keyI] = { key: keyI, label: catLabels[keyI] || keyI, kind: kindOf(keyI), count: 0, total: 0 }; }
            byCatIn[keyI].count++; byCatIn[keyI].total = r2(byCatIn[keyI].total + amt6);
            return;
          }
          totOut = r2(totOut + amt6);
          var key6 = isTrf ? 'transfer' : (t6.classification || null);
          var fund6 = isFundingLine(t6); // v55.83-WF step C — money sent to RTM / NextTrade: professional fees, once, in full
          if (fund6) {
            var was6 = key6 || 'uncategorized';
            fundingTax.count++; fundingTax.total = r2(fundingTax.total + amt6);
            fundingTax.by_party[fund6.payer] = r2((fundingTax.by_party[fund6.payer] || 0) + amt6);
            if (was6 !== taxKeyP) { fundingTax.recategorized++; fundingTax.recategorized_total = r2(fundingTax.recategorized_total + amt6); }
            key6 = taxKeyP; isTrf = false;
          }
          var contraOut = !isTrf && !fund6 && isContraCat(key6); // WO — the return itself: listed whatever the cap, so the pair is always inspectable
          if (spRows.length < 500 || ((!key6 || contraOut) && spRows.length < 3000)) { spRows.push({ id: t6.id, date: d6, who: t6.merchant_name || t6.name || '', amount: amt6, category: key6 || '', paired: !!t6.transfer_group_id, funds_sent_to: fund6 ? fund6.payer : undefined, bank_category: fund6 ? (t6.classification || '') : undefined }); } // v55.83-TS
          if (isTrf) { trf.count++; trf.total = r2(trf.total + amt6); return; }
          if (!key6) { unc.count++; unc.total = r2(unc.total + amt6); return; }
          if (!byCat[key6]) { byCat[key6] = { key: key6, label: catLabels[key6] || (key6 === '__professional_fees_pt' ? 'Professional fees' : key6), kind: key6 === '__professional_fees_pt' ? 'expense' : kindOf(key6), count: 0, total: 0 }; }
          byCat[key6].count++; byCat[key6].total = r2(byCat[key6].total + amt6);
          if (contraOut) { byCat[key6].net = true; byCat[key6].debits = r2((byCat[key6].debits || 0) + amt6); byCat[key6].debit_count = (byCat[key6].debit_count || 0) + 1; contra.debit_count++; contra.debits = r2(contra.debits + amt6); }
          if (fund6) { byCat[key6].funds_sent = r2((byCat[key6].funds_sent || 0) + amt6); } // how much of this line is transfers to RTM / NextTrade
        });
        // v55.83-TX (Max, Nov 17) — NextTrade / RTM payments split into bills · extra fee · ADVANCE. An advance is NOT spending:
        // it leaves the payment's category for a not-P&L 'advance held' row. Later, part of it used to pay bills or turned into
        // a fee becomes a professional fee in the period it happened; a fee turned back into advance leaves professional fees.
        var ptSplits = {}; var advNote = null;
        try {
          // the COMPLETE ledger, page by page in a stable order (Supabase returns at most 1,000 rows a request) — never a capped list
          var pmE = { data: [], error: null };
          for (var pmPg = 0; pmPg < 500; pmPg++) {
            var pmR = await db.from('party_money_entries').select('id, party, bucket, amount, kind, bank_transaction_id, bill_id, entry_date, created_at, action_id').order('id', { ascending: true }).range(pmPg * 1000, pmPg * 1000 + 999);
            if (pmR.error) { pmE = { data: null, error: pmR.error }; break; }
            pmE.data = pmE.data.concat(pmR.data || []);
            if (!pmR.data || pmR.data.length < 1000) { break; }
            if (pmPg === 499) { pmE = { data: null, error: { message: 'more than 500,000 advance entries' } }; }
          }
          if (pmE.error) { if (!/does not exist|schema cache|Could not find/i.test(pmE.error.message || '')) { advNote = 'Advances could not be read (' + pmE.error.message + ') — this report counts NextTrade / RTM payments in full.'; } }
          else {
            var lcP = {}; var ldP = {};
            spTx.forEach(function (tP) { lcP[tP.id] = tP.transfer_group_id || tP.classification === 'transfer' ? 'transfer' : (tP.classification || null); ldP[tP.id] = tP.posted_date || tP.date; });
            (pmE.data || []).forEach(function (eP) { if (eP.kind === 'payment_split' && eP.bank_transaction_id && Object.prototype.hasOwnProperty.call(ldP, eP.bank_transaction_id)) { var sp0 = ptSplits[eP.bank_transaction_id] || (ptSplits[eP.bank_transaction_id] = { fee: 0, advance: 0 }); sp0[eP.bucket] = r2(sp0[eP.bucket] + Number(eP.amount)); } });
            // v55.83-WF step C — the TX tax adjustments are RETIRED here: an "advance" no longer leaves the payment's category and
            // using or reclassifying held money no longer adds a professional fee. The transfer already counts once, in full
            // (above). An advance split never reduces what the blocks see either (the whole transfer was sent).
            Object.keys(ptSplits).forEach(function (kS) { ptSplits[kS].advance = 0; });
          }
        } catch (eAdv) { advNote = 'Advances could not be read — this report counts NextTrade / RTM payments in full.'; }
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
        // v55.83-QY — the same block, PER paid-through company (RTM Capital,
        // NextTrade Industries, …). Payments are attributed by the company
        // stamped on the bank transaction; covered bills by the company the
        // bill is "paid via". The unlinked remainder is labeled by the
        // company's kind: service_provider → its FEE; affiliate → an ADVANCE
        // awaiting its costs (NextTrade: never a fee by default).
        // v55.83-XO — which bill payments were paid FROM A STARTING BALANCE (sql/v55-83-XO-starting-balance.sql). Read once: the
        // internal-view blocks and the shared funds calculation below use these SAME rows. Before XO is installed: none.
        // Only a payment whose starting balance is really on file carries it (the shared calculation counts only those too).
        // (Codex 22 Nov 14:52 P2) ONLY a table that is not there yet means "none"; any other read failure stops the report with a 503
        // (xoStop is answered AFTER this block, so no catch here can turn it into figures without the balances).
        var xoPays = LS.pays || []; var xoOf = {}; var xoKnown = {};
        var xoOb = await db.from('party_opening_balances').select('id, party, amount, as_of, visible_to_staff, corrects_id').limit(5000);
        if (xoOb.error && !isMissingOpeningsTable(xoOb.error)) { xoStop = openingsUnavailable(xoOb.error).message; throw new Error('XO_UNAVAILABLE'); }
        if (!xoOb.error) {
          (xoOb.data || []).forEach(function (o0) { xoKnown[o0.id] = true; });
          try { var xoRows = await fetchAll(function () { return db.from('vendor_bill_payments').select('id, party_opening_id').not('party_opening_id', 'is', null).order('id', { ascending: true }); }); (xoRows || []).forEach(function (x0) { xoOf[x0.id] = x0.party_opening_id; }); }
          catch (eXo) { xoStop = openingsUnavailable(eXo).message; throw new Error('XO_UNAVAILABLE'); }
        }
        xoPays = xoPays.map(function (p0) { var oid = xoOf[p0.id] || p0.party_opening_id || null; if (oid && xoKnown[oid]) { return oid === p0.party_opening_id ? p0 : Object.assign({}, p0, { party_opening_id: oid }); } return p0.party_opening_id ? Object.assign({}, p0, { party_opening_id: null }) : p0; });
        // (Codex 14:52 P1) a balance this caller may not see that counts in these dates: the spending block is withheld (an
        // explicit restricted state), never shown recalculated without it. The super admin sees everything.
        // (Codex 18:29 P1) "counts in these dates" = as of on / before the end date, OR a bill paid from it on / before that date.
        if (!xoOb.error) {
          var xoHidden = hiddenStartingBalances(xoOb.data || [], callerIsSuper, pTo, xoPays);
          if (xoHidden.length) { xoRestrict = { reason: HIDDEN_STARTING_BALANCE_REASON, hidden_starting_balances: xoHidden.length }; }
        }
        var rtmBlk = null; var ptBlocks = [];
        try {
          var partiesP = await loadParties(db);
          var rtmTx = await db.from('bank_transactions')
            .select('id, date, posted_date, amount_abs, classification, third_party_payer')
            .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out')
            .not('third_party_payer', 'is', null).neq('pending', true).neq('review_status', 'duplicate')
            .gte('date', pFrom).lte('date', pTo).limit(2000);
          if (!rtmTx.error) {
            // v55.83-SR — the blocks are built by src/lib/paid-through-blocks.js (same sums as before; a company with a
            // provider_from date is split at that date, and lines from it on are broken into bills / service fee / waiting)
            // v55.83-WF step C — every company line sits under the ONE tax key in spend.categories (above), so the blocks name the
            // same key: the internal view takes each payment out of exactly the line it was counted in. bank_category keeps what the bank line itself says.
            var ptLines = (rtmTx.data || []).map(function (t9) { return { id: t9.id, date: t9.posted_date || t9.date, amount: t9.amount_abs, classification: taxKeyP, bank_category: t9.classification, payer: t9.third_party_payer, marked: true }; });
            // v55.83-VY — a transfer whose bank text names the company's own account (ending 9909 / 2061) is money sent to that
            // company even when nobody stamped it. Transfers between KTC's own accounts are never taken. Fail-soft.
            try {
              var destOr = FUNDING_DESTINATIONS.map(function (d0) { return 'name.ilike.%' + d0.suffix + '%,merchant_name.ilike.%' + d0.suffix + '%'; }).join(',');
              var idTx = await db.from('bank_transactions').select('id, date, posted_date, amount_abs, classification, name, merchant_name, transfer_group_id')
                .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out').is('third_party_payer', null).neq('pending', true).neq('review_status', 'duplicate')
                .gte('date', pFrom).lte('date', pTo).or(destOr).limit(2000);
              if (!idTx.error) {
                (idTx.data || []).forEach(function (t8) {
                  if (t8.transfer_group_id) { return; } // paired between KTC's own accounts — never money sent to a company (a bare "transfer" category does not make it one: step C)
                  var id8 = fundingIdentity({ direction: 'out', third_party_payer: null, name: t8.name, merchant_name: t8.merchant_name }); if (!id8) { return; }
                  ptLines.push({ id: t8.id, date: t8.posted_date || t8.date, amount: t8.amount_abs, classification: taxKeyP, bank_category: t8.classification, payer: id8.payer, marked: false, who: t8.merchant_name || t8.name || '' });
                });
              }
            } catch (eId) {}
            var ptReqs = [];
            try {
              var ptIds = ptLines.map(function (x) { return x.id; });
              for (var qi = 0; qi < ptIds.length; qi += 200) {
                var wq = await db.from('wire_packages').select('bank_transaction_id, fee_amount, status, funding_txn_id').in('bank_transaction_id', ptIds.slice(qi, qi + 200));
                if (!wq.error) { ptReqs = ptReqs.concat(wq.data || []); }
              }
            } catch (eWq) { ptReqs = []; }
            ptBlocks = buildPaidThroughBlocks({ parties: partiesP, lines: ptLines, pays: xoPays, billById: billNameById, requests: ptReqs, catLabels: catLabels, kindOf: kindOf, from: pFrom, to: pTo, splits: ptSplits, profKey: taxKeyP }); // TX: + extra fees · WF step C: the one tax key
            ptBlocks.forEach(function (blk) { if (partyKey(blk.payer) === 'rtm capital') { rtmBlk = blk; } });
          }
        } catch (eR9) { rtmBlk = null; ptBlocks = []; }
        // v55.83-VY (Codex 13:07: "integrate helper into the actual route -> report -> FundsSent -> totals/export path") — the shared
        // funds calculation, fed with the WHOLE history of each company (a fee or a bill payment dated in this period can belong
        // to a transfer of an earlier one). Read-only. null when it cannot be worked out — the screen then says so.
        var partyFunds = null;
        try {
          // the reading lives in src/lib/party-funds-server.js (run for real in the test): company lines by mark or destination text,
          // wire packages by funding id OR attached bank line (Codex 13:37), each taken once
          var pfLoaded = await loadPartyFunds(db, { fetchAll: fetchAll, businessId: US_WAVE_BUSINESS_ID, parties: await loadParties(db), pays: xoPays, bills: billNameById, entries: (typeof pmE !== 'undefined' && pmE && pmE.data) || [], from: pFrom, to: pTo });
          partyFunds = pfLoaded.funds;
          // the bill's own file, so the screen can open it (the storage rules decide who may)
          partyFunds.forEach(function (c7) { c7.transfers.forEach(function (t6) { ['lifetime_rows', 'as_of_rows'].forEach(function (k6) { (t6[k6] || []).forEach(function (r6) { var b6 = billNameById[r6.bill_id]; r6.attachment_path = (b6 && b6.attachment_path) || null; }); }); }); (c7.period.applied_rows || []).concat((c7.paid_without_a_transfer && c7.paid_without_a_transfer.period_rows) || []).forEach(function (r5) { var b5 = billNameById[r5.bill_id]; r5.attachment_path = (b5 && b5.attachment_path) || null; }); });
          // v55.83-XO (Codex 22 Nov 18:29 P1) — the WHOLE funds answer as this caller may see it, whatever dates were asked for: for
          // anyone but the super admin a hidden starting balance is left out entirely and its company's current block (whole history,
          // includes it) is withheld; a hidden balance that counts in these dates withholds the report (the explicit restricted state).
          var pfView = partyFundsForViewer(partyFunds, callerIsSuper, pTo); partyFunds = pfView.funds;
          if (pfView.restricted && !xoRestrict) { xoRestrict = { reason: HIDDEN_STARTING_BALANCE_REASON, hidden_starting_balances: pfView.restricted }; }
        } catch (ePf) { partyFunds = null; if (ePf && ePf.code === 'XO_UNAVAILABLE') { xoStop = ePf.message; throw new Error('XO_UNAVAILABLE'); } }
        // v55.83-XO (Max's (b): "NEW EXPENSE WHEN USED AFTER 6/1/2026") — bills paid from a starting balance on or after 1 June
        // 2026 are a new professional-fee expense in the TAX view, on their paid date. The amount is the shared calculation's own
        // period.tax_from_starting_balance (the same figure inside party-funds tax_professional_fees), so the two tax figures can
        // never disagree; only when that calculation could not be made do the blocks (same rows, same date rule) give it. It is
        // not bank money out (total_out / real_spending do not move). The internal view takes it back out of this line (the
        // blocks' from_starting_balance payments_by_cat) and shows the bills in their own categories.
        var sbTaxBy = {}; var sbTaxTotal = 0; var sbTaxCount = 0;
        if (partyFunds) {
          partyFunds.forEach(function (c9) { var a9 = r2((c9.period && c9.period.tax_from_starting_balance) || 0); if (!a9) { return; } sbTaxBy[c9.party] = a9; sbTaxTotal = r2(sbTaxTotal + a9); sbTaxCount += ((c9.period && c9.period.from_starting_balance_rows) || []).filter(function (r9) { return r9.paid_date >= STARTING_BALANCE_TAX_FROM; }).length; });
        } else {
          ptBlocks.forEach(function (b9) { (b9.payments_by_cat || []).forEach(function (p9) { if (p9.from_starting_balance) { sbTaxBy[b9.payer] = r2((sbTaxBy[b9.payer] || 0) + p9.total); sbTaxTotal = r2(sbTaxTotal + p9.total); sbTaxCount += p9.count || 0; } }); });
        }
        fundingTax.transfers_count = fundingTax.count; fundingTax.transfers_total = fundingTax.total;
        fundingTax.from_starting_balance = sbTaxTotal; fundingTax.from_starting_balance_count = sbTaxCount; fundingTax.from_starting_balance_by_party = sbTaxBy;
        if (sbTaxTotal) {
          var sbCat = catRows.filter(function (c9) { return c9.key === taxKeyP; })[0];
          if (!sbCat) { sbCat = { key: taxKeyP, label: catLabels[taxKeyP] || 'Professional fees', kind: taxKeyP === '__professional_fees_pt' ? 'expense' : kindOf(taxKeyP), count: 0, total: 0 }; catRows.push(sbCat); }
          sbCat.total = r2(sbCat.total + sbTaxTotal); sbCat.count += sbTaxCount; sbCat.from_starting_balance = sbTaxTotal;
          if (sbCat.kind !== 'not_pnl') { deductible = r2(deductible + sbTaxTotal); } else { notPnlOut.total = r2(notPnlOut.total + sbTaxTotal); }
          catRows.sort(function (a6, b6) { return b6.total - a6.total; });
          fundingTax.count += sbTaxCount; fundingTax.total = r2(fundingTax.total + sbTaxTotal);
          Object.keys(sbTaxBy).forEach(function (k9) { fundingTax.by_party[k9] = r2((fundingTax.by_party[k9] || 0) + sbTaxBy[k9]); });
        }
        spend = { rtm: rtmBlk, paid_through: ptBlocks, party_funds: partyFunds, categories: catRows, transfers: trf, uncategorized: unc, total_out: totOut,
          real_spending: r2(totOut - trf.total), rows: spRows,
          returned_checks: contra, // WO — returns (money out) and the deposits netted against them (money in); categories carry the NET
          deductible_spending: deductible, not_pnl_out: notPnlOut,
          in_categories: catRowsIn, in_transfers: trfIn, in_uncategorized: uncIn, total_in: totIn,
          real_income: r2(totIn - trfIn.total), in_rows: inRows,
          taxable_income: taxable, not_pnl_in: notPnlIn, advance_note: advNote,
          // v55.83-WF step C — the tax presentation of money sent to RTM / NextTrade: one line, each transfer once, in full
          funds_sent_tax: { key: taxKeyP, label: catLabels[taxKeyP] || 'Professional fees', count: fundingTax.count, total: fundingTax.total, by_party: fundingTax.by_party, recategorized: fundingTax.recategorized, recategorized_total: fundingTax.recategorized_total,
            transfers_count: fundingTax.transfers_count, transfers_total: fundingTax.transfers_total, // v55.83-XO: count / total = transfers + starting-balance uses (1 June 2026 on)
            from_starting_balance: fundingTax.from_starting_balance, from_starting_balance_count: fundingTax.from_starting_balance_count, from_starting_balance_by_party: fundingTax.from_starting_balance_by_party } };
      } catch (eSp) { spend = null; }
      if (xoStop) { return NextResponse.json({ ok: false, unavailable: 'starting_balances', error: 'Could not read ' + xoStop + '. Nothing is shown, so no tax total, P&L or accountant pack is built without them. Try again in a moment.' }, { status: 503 }); }
      if (xoRestrict) { spend = null; } // explicit: spending_restricted below says why — never figures recalculated without the balance
      var psPayload = {
        invoices: { invoiced: invoiced, count: invCount, collected: collected, collected_count: colCount, collected_on_period: collectedCohort, collected_on_period_count: colCohortCount, still_open_from_period: stillOpen },
        bills: { billed: billed, count: billCount, paid: billsPaid, paid_count: billsPaidCount, still_open_from_period: billsOpen, disputed_open: billsDisputed },
        months: monthRows,
        spending: spend,
        // drill rows: every card's exact underlying records ("show where these numbers came from")
        drills: { invoiced: rowsInvoiced, collected: rowsCollected, collected_on_period: rowsCollectedCohort, open_invoices: rowsOpenInv,
                  billed: rowsBilled, bills_paid: rowsBillsPaid, open_bills: rowsOpenBills } };
      psPayload = maskPeriodStats(psPayload, vis); // v55.83-RE — invoice figures P3, bank/financial P2, bills owed P1
      if (xoRestrict) { psPayload.spending = null; psPayload.spending_restricted = { reason: xoRestrict.reason, hidden_starting_balances: xoRestrict.hidden_starting_balances, words: 'Spending, tax and P&L figures for these dates are withheld: they ' + xoRestrict.reason + '. Ask the super admin.' }; } // v55.83-XO
      psPayload.totals_masked = !canTotals; psPayload.rows_visible = canRows; psPayload.vis = vis; psPayload.date_filters_locked = pLocked;
      psPayload.from = pFrom; psPayload.to = pTo; psPayload.ok = true; psPayload.marker = API_BUILD_MARKER;
      return NextResponse.json(psPayload);
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    // v55.83-UQ — the database refused the exact same bill (two people saving it at the same moment): a plain 409, not a server error
    if (/HUB_EXACT_DUPLICATE/.test(String((e && e.message) || ''))) { return NextResponse.json({ error: exactDupMessage(e.message).replace('It was NOT added again', 'It was NOT saved'), duplicate: true, duplicate_level: 'exact' }, { status: 409 }); }
    // v55.83-US — a database guard refused it (payment over what is left / void while paid): a plain 409 with its own words
    if (/HUB_GUARD/.test(String((e && e.message) || ''))) { return NextResponse.json({ error: String(e.message).replace(/^[sS]*HUB_GUARD:s*/, '') + ' Nothing was changed.' }, { status: 409 }); }
    return NextResponse.json({ error: (e && e.message) || 'Bills request failed.' }, { status: 500 });
  }
}
