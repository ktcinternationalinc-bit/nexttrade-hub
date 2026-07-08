// /api/accounting/bank-write — v55.83-IP.
// CORE WORKFLOW FIX. The Bank Review write operations (categorize a bank transaction, link a
// transaction to an invoice, set review status, unmatch) were done DIRECTLY from the browser via the
// Supabase client. That client runs as the "authenticated" role and is subject to row-level-security.
// This app authenticates by EMAIL (users.id != auth.uid()), so any RLS policy keyed to auth.uid()
// silently filters those writes to ZERO rows — the save "succeeds" but nothing persists, and nothing
// can then transfer to Wave. THIS endpoint performs the same writes with the SERVICE-ROLE key, which
// bypasses RLS entirely, so categorize + link ALWAYS persist regardless of the live DB's RLS state.
// Permission is enforced in code (assertPermission). SWC-safe: var + string concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { classifyApplication, roundMoney, isPaymentVoid, bankAllocationStatus, summarizeBankAllocation } from '../../../../lib/payment-matching';

var API_BUILD_MARKER = 'v55.83-IP-bank-write';
var API_ROUTE = '/api/accounting/bank-write';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

// v55.83-JF — server-side money-conservation check for a bank transaction. This is the AUTHORITATIVE
// gate: the route uses the service-role key (bypasses RLS), so the client-side allocation gating in
// JC is not enough — a direct POST could otherwise approve a partially-allocated deposit. Sums every
// piecewise disposition (non-void invoice payments + saved split lines + OPEN unapplied deposits) and
// compares to the transaction amount. Returns the bankAllocationStatus verdict.
async function allocationForTxn(db, txnId) {
  var tR = await db.from('bank_transactions').select('amount, amount_abs').eq('id', txnId).limit(1);
  if (tR && tR.error) { throw tR.error; }
  var t = (tR && tR.data && tR.data.length) ? tR.data[0] : null;
  if (!t) { return { missing: true }; }
  var total = Number(t.amount_abs != null ? t.amount_abs : Math.abs(Number(t.amount) || 0));
  var pR = await db.from('accounting_invoice_payments').select('amount, voided, sync_status').eq('bank_transaction_id', txnId);
  if (pR && pR.error) { throw pR.error; }
  // v55.83-JK — select linked_type so summarizeBankAllocation can EXCLUDE invoice-linked splits (their
  // dollars are already counted as the payment row — counting both double-counts, the bug Codex caught).
  var sR = await db.from('bank_transaction_splits').select('split_amount, linked_type').eq('bank_transaction_id', txnId);
  if (sR && sR.error) { throw sR.error; }
  var uR = await db.from('unapplied_deposits').select('amount, status').eq('bank_transaction_id', txnId);
  if (uR && uR.error) { throw uR.error; }
  // v55.83-JI schema-safe — status only (customer_credits has no guaranteed `voided` column; unmatch
  // sets reversed credits to status='void', excluded by the open-status check in summarizeBankAllocation).
  var cR = await db.from('customer_credits').select('amount, status').eq('source_transaction_id', txnId);
  if (cR && cR.error) { throw cR.error; }
  return summarizeBankAllocation({ total: total, payments: (pR && pR.data) || [], splits: (sR && sR.data) || [], unapplied: (uR && uR.data) || [], credits: (cR && cR.data) || [] });
}

// Server-side invoice recompute — mirrors BankReviewTab.recomputeInvoice + push-payment.
// paid = wave_imported_paid + SUM(non-void Hub payment rows). Never writes a negative balance.
async function recompute(db, invId) {
  if (!invId) { return; }
  var invR = await db.from('accounting_invoices').select('total_amount, wave_imported_paid').eq('id', invId);
  if (invR && invR.error) { throw invR.error; }
  var inv = (invR && invR.data && invR.data.length) ? invR.data[0] : null;
  if (!inv) { return; }
  var payR = await db.from('accounting_invoice_payments').select('amount, voided, sync_status').eq('accounting_invoice_id', invId);
  if (payR && payR.error) { throw payR.error; }
  var total = Number(inv.total_amount) || 0;
  var paid = Number(inv.wave_imported_paid) || 0;
  var rows = (payR && payR.data) || [];
  var i;
  for (i = 0; i < rows.length; i++) { if (!isPaymentVoid(rows[i])) { paid += Number(rows[i].amount) || 0; } }
  paid = roundMoney(paid);
  var bal = roundMoney(Math.max(0, total - paid));
  var st = paid <= 0.0001 ? 'unpaid' : (bal <= 0.0001 ? 'paid' : 'partial');
  var upd = await db.from('accounting_invoices').update({ amount_paid: paid, balance_due: bal, payment_status: st }).eq('id', invId);
  if (upd && upd.error) { throw upd.error; }
  return { amount_paid: paid, balance_due: bal, payment_status: st };
}

function normDuplicateText(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80); }
function txnAmountCents(t) { return Math.round(Number(t && t.amount_abs != null ? t.amount_abs : Math.abs(Number(t && t.amount) || 0)) * 100); }
function duplicateKeyForRow(t, acctMap, activeBiz) {
  if (!t) { return null; }
  var d = String(t.posted_date || t.date || '').substring(0, 10);
  if (!d || t.pending === true || !t.account_id) { return null; }
  var pa = acctMap && acctMap[t.account_id] ? acctMap[t.account_id] : null;
  var accountKey = pa && pa.mask ? ('mask:' + pa.mask) : ('acct:' + t.account_id);
  var bankKey = normDuplicateText(t.bank_source || '');
  var desc = t.check_number ? ('check' + normDuplicateText(t.check_number)) : normDuplicateText(t.name || t.merchant_name || '');
  if (!desc || txnAmountCents(t) <= 0) { return null; }
  return String(t.wave_business_id || activeBiz || 'no-silo') + '|' + bankKey + '|' + accountKey + '|' + d + '|' + String(t.direction || '') + '|' + String(t.iso_currency || '') + '|' + txnAmountCents(t) + '|' + String(t.channel || '') + '|' + desc;
}

async function protectedBankTxnIds(db, rowsOrIds) {
  var ids = [];
  (rowsOrIds || []).forEach(function (x) { var id = typeof x === 'string' ? x : (x && x.id); if (id && ids.indexOf(id) < 0) { ids.push(id); } });
  var protectedIds = {};
  function mark(id) { if (id) { protectedIds[id] = true; } }
  (rowsOrIds || []).forEach(function (x) {
    if (!x || typeof x === 'string') { return; }
    if (x.review_status === 'approved' || x.review_status === 'reviewed' || x.review_status === 'ignored' || x.review_status === 'needs_clarification') { mark(x.id); }
    if (x.matched_invoice_id || x.linked_id || x.linked_type) { mark(x.id); }
  });
  if (!ids.length) { return protectedIds; }
  var mR = await db.from('payment_matches').select('bank_transaction_id, voided').in('bank_transaction_id', ids);
  if (mR && mR.error) { throw mR.error; }
  ((mR && mR.data) || []).forEach(function (m) { if (m && m.voided !== true) { mark(m.bank_transaction_id); } });
  var pR = await db.from('accounting_invoice_payments').select('bank_transaction_id, voided, sync_status').in('bank_transaction_id', ids);
  if (pR && pR.error) { throw pR.error; }
  ((pR && pR.data) || []).forEach(function (p) { if (p && !isPaymentVoid(p)) { mark(p.bank_transaction_id); } });
  var sR = await db.from('bank_transaction_splits').select('bank_transaction_id').in('bank_transaction_id', ids);
  if (sR && sR.error) { throw sR.error; }
  ((sR && sR.data) || []).forEach(function (s) { mark(s && s.bank_transaction_id); });
  var uR = await db.from('unapplied_deposits').select('bank_transaction_id, status').in('bank_transaction_id', ids);
  if (uR && uR.error) { throw uR.error; }
  ((uR && uR.data) || []).forEach(function (u) { if (!u.status || u.status === 'open') { mark(u.bank_transaction_id); } });
  var cR = await db.from('customer_credits').select('source_transaction_id, status').in('source_transaction_id', ids);
  if (cR && cR.error) { throw cR.error; }
  ((cR && cR.data) || []).forEach(function (c) { if (!c.status || c.status === 'open') { mark(c.source_transaction_id); } });
  return protectedIds;
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var by = body.user_id || null;
    var action = body.action || '';

    // Permission per action. v55.83-JJ — split-save and park-unapplied allocate money, so they need
    // payments.match (same as match/unmatch/status), per Codex's launch-safe rule.
    var permKey = (action === 'match_invoice' || action === 'unmatch' || action === 'save_splits' || action === 'create_unapplied' || action === 'update_match' || action === 'mark_review_duplicates') ? 'payments.match'
      : (action === 'set_status' ? 'payments.match' : 'bank.classify');
    var gate = await assertPermission(db, by, permKey, req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error, api_build_marker: API_BUILD_MARKER }, { status: gate.status }); }

    // ── set_status: review status on a bank transaction ──
    if (action === 'set_status') {
      // v55.83-JF — AUTHORITATIVE money-conservation gate. Block reviewed/approved server-side when
      // the transaction is partially (or over-) allocated. This closes the direct-route bypass Codex
      // flagged: the client gate alone could be skipped by POSTing straight to this service-role route.
      if (body.status === 'reviewed' || body.status === 'approved') {
        var alloc = await allocationForTxn(db, body.bank_transaction_id);
        if (alloc && alloc.missing) { return NextResponse.json({ ok: false, error: 'Transaction not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
        if (alloc && alloc.overAllocated) { return NextResponse.json({ ok: false, error: 'Over-allocated by ' + Math.abs(alloc.remaining) + ' — fix the lines before marking ' + body.status + '.', allocation: alloc, api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
        if (alloc && !alloc.complete) { return NextResponse.json({ ok: false, error: alloc.remaining + ' of this ' + alloc.total + ' transaction is unallocated. Every dollar must be allocated (invoice payment / split / unapplied / explicit Uncategorized) before it can be ' + body.status + '.', allocation: alloc, api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
      }
      if (body.status === 'duplicate') {
        var dRows = await db.from('bank_transactions').select('id, review_status, matched_invoice_id, linked_id, linked_type').eq('id', body.bank_transaction_id).limit(1);
        if (dRows && dRows.error) { return NextResponse.json({ ok: false, error: dRows.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
        var dRow = (dRows && dRows.data && dRows.data.length) ? dRows.data[0] : null;
        if (!dRow) { return NextResponse.json({ ok: false, error: 'Transaction not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
        var dProt = await protectedBankTxnIds(db, [dRow]);
        if (dProt[dRow.id]) { return NextResponse.json({ ok: false, error: 'This transaction has accounting activity or protected status, so it cannot be marked duplicate from Bank Review. Reverse/unmatch or review it manually first.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
      }
      var sPatch = { review_status: body.status, updated_by: by };
      if (body.status === 'reviewed' || body.status === 'approved') { sPatch.reviewed_by = by; sPatch.reviewed_at = new Date().toISOString(); }
      if (body.notes != null) { sPatch.notes = body.notes; }
      var sRes = await db.from('bank_transactions').update(sPatch).eq('id', body.bank_transaction_id).select();
      if (sRes && sRes.error) { return NextResponse.json({ ok: false, error: sRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(sRes && sRes.data && sRes.data.length)) { return NextResponse.json({ ok: false, error: 'No row updated (transaction not found).', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      return NextResponse.json({ ok: true, row: sRes.data[0], api_build_marker: API_BUILD_MARKER });
    }

    // ── mark_review_duplicates: Accounting Bank Review scoped duplicate cleanup ──
    // Marks only high-confidence relink extras duplicate. No deletes, no voids, no payment/match/split edits.
    if (action === 'mark_review_duplicates') {
      var rawIds = body.duplicate_transaction_ids || [];
      var ids = [];
      rawIds.forEach(function (id) { if (id && ids.indexOf(id) < 0) { ids.push(id); } });
      if (!ids.length) { return NextResponse.json({ ok: true, marked: 0, skipped: 0, api_build_marker: API_BUILD_MARKER }); }
      var candR = await db.from('bank_transactions').select('id, wave_business_id, bank_source, account_id, posted_date, date, direction, amount, amount_abs, iso_currency, name, merchant_name, check_number, channel, pending, review_status, matched_invoice_id, linked_id, linked_type, updated_at, created_at').in('id', ids);
      if (candR && candR.error) { return NextResponse.json({ ok: false, error: candR.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var candidates = (candR && candR.data) || [];
      if (!candidates.length) { return NextResponse.json({ ok: true, marked: 0, skipped: ids.length, api_build_marker: API_BUILD_MARKER }); }
      var dates = []; var bizs = [];
      candidates.forEach(function (t) {
        var d = String(t.posted_date || t.date || '').substring(0, 10);
        if (d && dates.indexOf(d) < 0) { dates.push(d); }
        if (t.wave_business_id && bizs.indexOf(t.wave_business_id) < 0) { bizs.push(t.wave_business_id); }
      });
      var allQ = db.from('bank_transactions').select('id, wave_business_id, bank_source, account_id, posted_date, date, direction, amount, amount_abs, iso_currency, name, merchant_name, check_number, channel, pending, review_status, matched_invoice_id, linked_id, linked_type, updated_at, created_at');
      if (dates.length) { allQ = allQ.in('date', dates); }
      if (bizs.length) { allQ = allQ.in('wave_business_id', bizs); }
      var allR = await allQ.limit(2000);
      if (allR && allR.error) { return NextResponse.json({ ok: false, error: allR.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var allRows = (allR && allR.data) || [];
      var acctIds = [];
      allRows.forEach(function (t) { if (t.account_id && acctIds.indexOf(t.account_id) < 0) { acctIds.push(t.account_id); } });
      var acctMap = {};
      if (acctIds.length) {
        var paR = await db.from('plaid_accounts').select('plaid_account_id, mask').in('plaid_account_id', acctIds);
        if (paR && paR.error) { return NextResponse.json({ ok: false, error: paR.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
        ((paR && paR.data) || []).forEach(function (a) { if (a && a.plaid_account_id) { acctMap[a.plaid_account_id] = a; } });
      }
      var prot = await protectedBankTxnIds(db, allRows);
      function score(t) {
        var s = 0;
        if (prot[t.id]) { s += 1000; }
        if (t.review_status === 'approved') { s += 500; }
        if (t.review_status === 'reviewed') { s += 350; }
        if (t.review_status === 'duplicate') { s -= 800; }
        if (t.matched_invoice_id || t.linked_id || t.linked_type) { s += 250; }
        if (t.updated_at) { s += Math.min(20, String(t.updated_at).length); }
        return s;
      }
      var groups = {};
      allRows.forEach(function (t) {
        var k = duplicateKeyForRow(t, acctMap, t.wave_business_id || null);
        if (!k) { return; }
        if (!groups[k]) { groups[k] = []; }
        groups[k].push(t);
      });
      var markMap = {}; var candidateMap = {};
      candidates.forEach(function (t) { candidateMap[t.id] = t; });
      Object.keys(groups).forEach(function (k) {
        var g = groups[k];
        if (!g || g.length < 2) { return; }
        var seenAcct = {};
        g.forEach(function (t) { if (t.account_id) { seenAcct[t.account_id] = true; } });
        if (Object.keys(seenAcct).length < 2) { return; }
        var sorted = g.slice().sort(function (a, b) {
          var ds = score(b) - score(a);
          if (ds !== 0) { return ds; }
          return String(a.created_at || a.updated_at || '').localeCompare(String(b.created_at || b.updated_at || ''));
        });
        var keeper = sorted[0];
        sorted.slice(1).forEach(function (t) {
          if (!candidateMap[t.id]) { return; }
          if (prot[t.id]) { return; }
          if ((t.review_status || 'unreviewed') === 'duplicate') { return; }
          if (keeper && keeper.id !== t.id) { markMap[t.id] = true; }
        });
      });
      var markIds = Object.keys(markMap);
      if (!markIds.length) { return NextResponse.json({ ok: true, marked: 0, skipped: candidates.length, api_build_marker: API_BUILD_MARKER }); }
      var md = await db.from('bank_transactions').update({ review_status: 'duplicate', updated_by: by }).in('id', markIds).select('id');
      if (md && md.error) { return NextResponse.json({ ok: false, error: md.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      return NextResponse.json({ ok: true, marked: (md && md.data ? md.data.length : markIds.length), skipped: candidates.length - markIds.length, api_build_marker: API_BUILD_MARKER });
    }

    // ── create_unapplied: park part/all of a deposit as an open unapplied deposit (service-role) ──
    // v55.83-JJ — was a browser dbInsert (RLS-exposed). Only marks reviewed when the park completes
    // the deposit's allocation; never auto-reviews a still-partial deposit.
    if (action === 'create_unapplied') {
      var ut = body.txn || {};
      var uAmt = roundMoney(Number(body.amount));
      if (!ut.id) { return NextResponse.json({ ok: false, error: 'txn.id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(uAmt > 0)) { return NextResponse.json({ ok: false, error: 'Amount must be greater than zero.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var uCur = await db.from('bank_transactions').select('review_status, business_id, wave_business_id').eq('id', ut.id).limit(1);
      if (uCur && uCur.error) { return NextResponse.json({ ok: false, error: uCur.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var uRow0 = (uCur && uCur.data && uCur.data.length) ? uCur.data[0] : null;
      if (!uRow0) { return NextResponse.json({ ok: false, error: 'Transaction not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      if (uRow0.review_status === 'approved') { return NextResponse.json({ ok: false, error: 'Transaction is approved — reopen it first.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
      // v55.83-JK (Codex) — reject OVER-PARK before writing anything: the new park plus what's already
      // allocated must not exceed the deposit. Previously we inserted first, then checked.
      var uPre = await allocationForTxn(db, ut.id);
      if (uPre && !uPre.missing && uPre.total > 0 && roundMoney(uPre.allocated + uAmt) > uPre.total + 0.01) {
        return NextResponse.json({ ok: false, error: 'Parking ' + uAmt + ' would over-allocate this ' + uPre.total + ' deposit (' + uPre.allocated + ' already allocated; ' + roundMoney(uPre.total - uPre.allocated) + ' remaining).', allocation: uPre, api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
      var uSilo = body.wave_business_id || uRow0.wave_business_id || ut.wave_business_id || null;
      var uIns = await db.from('unapplied_deposits').insert({ business_id: uRow0.business_id || ut.business_id || null, wave_business_id: uSilo, bank_transaction_id: ut.id, accounting_customer_id: body.customer_id || null, amount: uAmt, status: 'open', notes: body.notes || null, created_by: by }).select();
      if (uIns && uIns.error) { return NextResponse.json({ ok: false, error: 'Could not save the unapplied deposit: ' + uIns.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(uIns && uIns.data && uIns.data.length)) { return NextResponse.json({ ok: false, error: 'Saved nothing (0 rows).', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
      var uAlloc = await allocationForTxn(db, ut.id);
      var uPatch = { classification: body.classification || ut.classification || 'customer_payment', updated_by: by };
      if (body.customer_id) { uPatch.accounting_customer_id = body.customer_id; }
      if (uRow0.review_status === 'unreviewed' && uAlloc && uAlloc.complete) { uPatch.review_status = 'reviewed'; uPatch.reviewed_by = by; uPatch.reviewed_at = new Date().toISOString(); }
      await db.from('bank_transactions').update(uPatch).eq('id', ut.id);
      return NextResponse.json({ ok: true, allocation: uAlloc, marked_reviewed: uPatch.review_status === 'reviewed', api_build_marker: API_BUILD_MARKER });
    }

    // ── save_splits: split a deposit across categories/invoices (service-role, atomic-ish) ──
    // v55.83-JJ — was a browser dbInsert chain (RLS-exposed). A split must FULLY allocate the deposit
    // (sum === amount_abs within a cent); invoice-linked lines also create the match + payment + recompute
    // (mirrors match_invoice, incl. per-line overpayment → credit/unapplied). Marks reviewed only when
    // allocationForTxn is complete after all writes.
    if (action === 'save_splits') {
      var t = body.txn || {};
      var rows = body.rows || [];
      if (!t.id) { return NextResponse.json({ ok: false, error: 'txn.id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!rows.length) { return NextResponse.json({ ok: false, error: 'No split lines provided.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var tCur = await db.from('bank_transactions').select('review_status, direction, business_id, wave_business_id, amount, amount_abs, classification').eq('id', t.id).limit(1);
      if (tCur && tCur.error) { return NextResponse.json({ ok: false, error: tCur.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var tRow = (tCur && tCur.data && tCur.data.length) ? tCur.data[0] : null;
      if (!tRow) { return NextResponse.json({ ok: false, error: 'Transaction not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      if (tRow.review_status === 'approved') { return NextResponse.json({ ok: false, error: 'Transaction is approved — reopen it first.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
      var depAmt = roundMoney(Number(tRow.amount_abs != null ? tRow.amount_abs : Math.abs(Number(tRow.amount) || 0)));
      var biz = tRow.business_id || t.business_id || null;
      var silo = body.wave_business_id || tRow.wave_business_id || t.wave_business_id || null;
      var isOut = tRow.direction === 'out';
      // v55.83-JK (Codex) — VALIDATE EVERYTHING BEFORE ANY WRITE. Per-line amounts/money-out, the
      // exact-allocation contract, AND every invoice reference (exists + same business) are checked up
      // front, so a bad invoice ref can't leave half-written split rows behind.
      var sum = 0; var ri2; var invIds = [];
      for (ri2 = 0; ri2 < rows.length; ri2++) {
        var amt2 = roundMoney(Number(rows[ri2].amount));
        if (!(amt2 > 0)) { return NextResponse.json({ ok: false, error: 'Every split line must be greater than zero.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
        if (isOut && rows[ri2].invoice_id) { return NextResponse.json({ ok: false, error: 'This is an OUTGOING transaction — split lines cannot link to a customer invoice.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
        if (rows[ri2].invoice_id) { invIds.push(rows[ri2].invoice_id); }
        sum = roundMoney(sum + amt2);
      }
      if (Math.abs(sum - depAmt) > 0.01) { return NextResponse.json({ ok: false, error: 'Split lines total ' + sum + ' but the transaction is ' + depAmt + '. A split must allocate the full amount.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
      // Pre-fetch + validate ALL referenced invoices before writing.
      var invMap = {};
      if (invIds.length) {
        var preInv = await db.from('accounting_invoices').select('id, business_id, wave_business_id, total_amount, wave_imported_paid, accounting_customer_id, invoice_number, wave_invoice_id').in('id', invIds);
        if (preInv && preInv.error) { return NextResponse.json({ ok: false, error: preInv.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
        var pinv = (preInv && preInv.data) || []; var pq;
        for (pq = 0; pq < pinv.length; pq++) { invMap[pinv[pq].id] = pinv[pq]; }
        for (ri2 = 0; ri2 < invIds.length; ri2++) {
          var ivchk = invMap[invIds[ri2]];
          if (!ivchk) { return NextResponse.json({ ok: false, error: 'Split references an invoice that was not found (' + invIds[ri2] + ').', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
          if (biz && ivchk.business_id && biz !== ivchk.business_id) { return NextResponse.json({ ok: false, error: 'A split line links an invoice from another business.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
        }
      }
      // Write phase. Track everything created so a mid-way DB failure can be rolled back.
      var createdSplitIds = []; var createdMatchIds = []; var createdPaymentIds = [];
      async function rollbackSplits() {
        try { if (createdPaymentIds.length) { await db.from('accounting_invoice_payments').delete().in('id', createdPaymentIds); } } catch (e1) {}
        try { if (createdMatchIds.length) { await db.from('payment_matches').delete().in('id', createdMatchIds); } } catch (e2) {}
        try { if (createdSplitIds.length) { await db.from('bank_transaction_splits').delete().in('id', createdSplitIds); } } catch (e3) {}
      }
      var results = []; var k2;
      for (k2 = 0; k2 < rows.length; k2++) {
        var r = rows[k2];
        var amt3 = roundMoney(Number(r.amount));
        var splitRow = { business_id: biz, bank_transaction_id: t.id, split_amount: amt3, category: r.category || null, linked_type: r.invoice_id ? 'invoice' : (r.customer_id ? 'customer' : null), linked_id: r.invoice_id || r.customer_id || null, notes: r.notes || null, created_by: by };
        if (r.wave_account_id) { splitRow.category = r.wave_account_name || r.category || null; splitRow.wave_business_id = silo; splitRow.wave_account_id = r.wave_account_id; splitRow.wave_account_name = r.wave_account_name || null; splitRow.category_source = 'wave'; splitRow.category_status = 'pending_wave_sync'; }
        var sIns = await db.from('bank_transaction_splits').insert(splitRow).select();
        if (sIns && sIns.error) {
          // schema fallback: retry with base columns only (HE Wave-split columns may be absent)
          if (splitRow.wave_account_id) {
            var baseRow = { business_id: biz, bank_transaction_id: t.id, split_amount: amt3, category: splitRow.category, linked_type: splitRow.linked_type, linked_id: splitRow.linked_id, notes: splitRow.notes, created_by: by };
            var sIns2 = await db.from('bank_transaction_splits').insert(baseRow).select();
            if (sIns2 && sIns2.error) { await rollbackSplits(); return NextResponse.json({ ok: false, error: 'Split line save failed (rolled back): ' + sIns2.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
            if (sIns2 && sIns2.data && sIns2.data.length) { createdSplitIds.push(sIns2.data[0].id); }
          } else { await rollbackSplits(); return NextResponse.json({ ok: false, error: 'Split line save failed (rolled back): ' + sIns.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
        } else if (sIns && sIns.data && sIns.data.length) { createdSplitIds.push(sIns.data[0].id); }
        if (r.invoice_id) {
          var inv2 = invMap[r.invoice_id];
          // anti-double-count: paid so far on the invoice
          var ipR = await db.from('accounting_invoice_payments').select('amount, voided, sync_status').eq('accounting_invoice_id', inv2.id);
          var paidNow2 = Number(inv2.wave_imported_paid) || 0; var ipr2 = (ipR && ipR.data) || []; var yy;
          for (yy = 0; yy < ipr2.length; yy++) { if (!isPaymentVoid(ipr2[yy])) { paidNow2 += Number(ipr2[yy].amount) || 0; } }
          var cc = classifyApplication(Number(inv2.total_amount) || 0, roundMoney(paidNow2), amt3);
          var mI = await db.from('payment_matches').insert({ business_id: biz, wave_business_id: silo, bank_transaction_id: t.id, invoice_id: inv2.id, matched_amount: cc.applied_to_invoice, match_type: cc.type, is_manual_override: true, notes: r.notes || 'split', matched_by: by, created_by: by }).select();
          if (mI && mI.error) { await rollbackSplits(); return NextResponse.json({ ok: false, error: 'Split match save failed (rolled back): ' + mI.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
          var mId = (mI && mI.data && mI.data.length) ? mI.data[0].id : null;
          if (mId) { createdMatchIds.push(mId); }
          var pI = await db.from('accounting_invoice_payments').insert({ business_id: biz, wave_business_id: silo, accounting_invoice_id: inv2.id, accounting_customer_id: inv2.accounting_customer_id || null, amount: cc.applied_to_invoice, payment_date: t.posted_date || t.date || null, source: 'plaid_match', bank_transaction_id: t.id, payment_match_id: mId, wave_payment_id: null, sync_status: 'pending_wave_sync', wave_invoice_id: inv2.wave_invoice_id || null, wave_customer_id: body.wave_customer_id || null, memo: r.notes || 'split', created_by: by }).select();
          if (pI && pI.error) { await rollbackSplits(); return NextResponse.json({ ok: false, error: 'Split payment save failed (rolled back): ' + pI.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
          if (pI && pI.data && pI.data.length) { createdPaymentIds.push(pI.data[0].id); }
          if (cc.overpayment > 0) {
            var credCust = inv2.accounting_customer_id || null;
            if (credCust) { await db.from('customer_credits').insert({ business_id: biz, wave_business_id: silo, accounting_customer_id: credCust, source_transaction_id: t.id, amount: cc.overpayment, status: 'open', notes: 'Overpayment on invoice ' + (inv2.invoice_number || inv2.id) + ' (split)', created_by: by }); }
            else { await db.from('unapplied_deposits').insert({ business_id: biz, wave_business_id: silo, bank_transaction_id: t.id, accounting_customer_id: null, amount: cc.overpayment, status: 'open', notes: 'Overpayment on invoice ' + (inv2.invoice_number || inv2.id) + ' (split, no customer)', created_by: by }); }
          }
          await recompute(db, inv2.id);
          results.push({ invoice_id: inv2.id, applied: cc.applied_to_invoice, overpayment: cc.overpayment });
        }
      }
      // Stamp the transaction; mark reviewed only if fully allocated now.
      var spAlloc = await allocationForTxn(db, t.id);
      var spPatch = { classification: tRow.classification || 'customer_payment', updated_by: by };
      if (body.accounting_customer_id) { spPatch.accounting_customer_id = body.accounting_customer_id; }
      if (tRow.review_status === 'unreviewed' && spAlloc && spAlloc.complete) { spPatch.review_status = 'reviewed'; spPatch.reviewed_by = by; spPatch.reviewed_at = new Date().toISOString(); }
      await db.from('bank_transactions').update(spPatch).eq('id', t.id);
      return NextResponse.json({ ok: true, lines: rows.length, results: results, allocation: spAlloc, marked_reviewed: spPatch.review_status === 'reviewed', api_build_marker: API_BUILD_MARKER });
    }

    // ── classify / set_wave_category: categorization on a bank transaction ──
    if (action === 'classify' || action === 'set_wave_category') {
      // v55.83-MN — Max directive: Hub category changes are allowed even after a prior Wave push. Wave's
      // public API still cannot update/delete the old money transaction, so the next Hub->Wave sync creates
      // a fresh categorized money transaction; duplicate cleanup is an operator concern, not a Hub blocker.
      var preRes = await db.from('bank_transactions').select('category_status, wave_transaction_id, wave_account_id').eq('id', body.bank_transaction_id);
      var preRow = (preRes && preRes.data && preRes.data.length) ? preRes.data[0] : null;
      var changingCat = !!(body.patch && Object.prototype.hasOwnProperty.call(body.patch, 'wave_account_id') && body.patch.wave_account_id !== (preRow ? preRow.wave_account_id : null));
      // v55.83-JH (Codex P0) — NEVER trust the raw client patch. Whitelist only categorization fields,
      // so a direct POST can't set arbitrary columns (e.g. approved_by) on bank_transactions. And the
      // categorize actions (bank.classify permission) may ONLY ever auto-advance to 'reviewed', never
      // 'approved' — approval is a separate, higher-permission action via set_status.
      var CLASSIFY_FIELDS = { classification: 1, category_status: 1, category_source: 1, wave_account_id: 1, wave_account_name: 1, wave_account_type: 1, wave_account_subtype: 1, review_status: 1, accounting_customer_id: 1 };
      var rawPatch = body.patch || {};
      var cPatch = {};
      var fk;
      for (fk in rawPatch) { if (Object.prototype.hasOwnProperty.call(rawPatch, fk) && CLASSIFY_FIELDS[fk]) { cPatch[fk] = rawPatch[fk]; } }
      if (cPatch.review_status === 'approved') { delete cPatch.review_status; } // approval never comes through categorize
      if (changingCat) { cPatch.category_status = 'pending_wave_sync'; }
      cPatch.updated_by = by;
      // v55.83-JG (Codex P0) — classify/set_wave_category patches carry review_status:'reviewed' to
      // auto-advance an unreviewed txn. That bypassed the set_status money-conservation gate: a partly
      // matched deposit could become reviewed just by picking a category. So if this patch would
      // promote to reviewed/approved, verify full allocation first; if not fully allocated, STRIP the
      // promotion (the categorization still saves, but the txn stays unreviewed until every dollar is
      // allocated). Categorizing itself is always allowed — only the silent auto-review is gated.
      var autoReviewStripped = false;
      if (cPatch.review_status === 'reviewed' || cPatch.review_status === 'approved') {
        var cAlloc = await allocationForTxn(db, body.bank_transaction_id);
        if (cAlloc && cAlloc.missing) { return NextResponse.json({ ok: false, error: 'Transaction not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
        if (cAlloc && (!cAlloc.complete || cAlloc.overAllocated)) { delete cPatch.review_status; delete cPatch.reviewed_by; delete cPatch.reviewed_at; autoReviewStripped = true; }
        else { cPatch.reviewed_by = by; cPatch.reviewed_at = new Date().toISOString(); } // v55.83-JP (audit) — a reviewed txn must record who/when, like set_status
      }
      var cRes = await db.from('bank_transactions').update(cPatch).eq('id', body.bank_transaction_id).select();
      if (cRes && cRes.error) { return NextResponse.json({ ok: false, error: cRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(cRes && cRes.data && cRes.data.length)) { return NextResponse.json({ ok: false, error: 'No row updated (transaction not found).', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      return NextResponse.json({ ok: true, row: cRes.data[0], auto_review_stripped: autoReviewStripped, api_build_marker: API_BUILD_MARKER });
    }

    // ── match_invoice: link a deposit to an invoice (the core workflow) ──
    if (action === 'match_invoice') {
      var t = body.txn; var inv = body.invoice;
      if (!t || !inv) { return NextResponse.json({ ok: false, error: 'txn and invoice are required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var apply = roundMoney(Number(body.amount));
      if (!(apply > 0)) { return NextResponse.json({ ok: false, error: 'Amount must be greater than zero.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var biz = t.business_id || inv.business_id || null;
      var siloId = body.wave_business_id || inv.wave_business_id || t.wave_business_id || null;
      // v55.83-JP (audit) — SERVER-SIDE silo guard. The client checks same-silo, but this service-role
      // route bypasses RLS, so a direct call could cross-match a 6338 deposit to a 6353 invoice. Refuse
      // when the deposit and the invoice declare different Wave businesses. Re-read both from the DB so
      // we don't trust client-supplied silo tags.
      var tSiloRes = await db.from('bank_transactions').select('wave_business_id').eq('id', t.id);
      var iSiloRes = await db.from('accounting_invoices').select('wave_business_id').eq('id', inv.id);
      var tSilo = (tSiloRes && tSiloRes.data && tSiloRes.data.length) ? tSiloRes.data[0].wave_business_id : null;
      var iSilo = (iSiloRes && iSiloRes.data && iSiloRes.data.length) ? iSiloRes.data[0].wave_business_id : null;
      if (tSilo && iSilo && tSilo !== iSilo) {
        return NextResponse.json({ ok: false, error: 'Cross-silo match blocked: this deposit belongs to a different Wave business than the invoice. Match within the same silo.', txn_silo: tSilo, invoice_silo: iSilo, api_build_marker: API_BUILD_MARKER }, { status: 409 });
      }

      // Over-apply guard across this deposit (server-authoritative).
      var depositAmt = roundMoney(Number(t.amount_abs != null ? t.amount_abs : (t.amount || 0)));
      var existR = await db.from('accounting_invoice_payments').select('amount, voided, sync_status, bank_transaction_id').eq('bank_transaction_id', t.id);
      if (existR && existR.error) { return NextResponse.json({ ok: false, error: existR.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var already = 0; var er = (existR && existR.data) || []; var z;
      for (z = 0; z < er.length; z++) { if (!isPaymentVoid(er[z])) { already += Number(er[z].amount) || 0; } }
      if (depositAmt > 0 && roundMoney(already + apply) > depositAmt + 0.01) {
        return NextResponse.json({ ok: false, error: 'Cannot apply ' + apply + ' — deposit is ' + depositAmt + ' and ' + already + ' is already applied. Remaining: ' + roundMoney(depositAmt - already) + '.', api_build_marker: API_BUILD_MARKER }, { status: 400 });
      }

      // Current paid on the invoice (anti-double-count).
      var invPayR = await db.from('accounting_invoice_payments').select('amount, voided, sync_status').eq('accounting_invoice_id', inv.id);
      if (invPayR && invPayR.error) { return NextResponse.json({ ok: false, error: invPayR.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var paidNow = Number(inv.wave_imported_paid) || 0;
      var ipr = (invPayR && invPayR.data) || []; var y;
      for (y = 0; y < ipr.length; y++) { if (!isPaymentVoid(ipr[y])) { paidNow += Number(ipr[y].amount) || 0; } }
      paidNow = roundMoney(paidNow);
      var invTotal = Number(inv.total_amount) || 0;
      var c = classifyApplication(invTotal, paidNow, apply);

      // 1) match row
      var mIns = await db.from('payment_matches').insert({ business_id: biz, wave_business_id: siloId, bank_transaction_id: t.id, invoice_id: inv.id, matched_amount: c.applied_to_invoice, match_type: c.type, is_manual_override: false, notes: body.notes || null, matched_by: by, created_by: by }).select();
      if (mIns && mIns.error) { return NextResponse.json({ ok: false, error: 'Could not save the match: ' + mIns.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var matchId = (mIns && mIns.data && mIns.data.length) ? mIns.data[0].id : null;

      // 2) payment row (the Wave-bound item)
      var pIns = await db.from('accounting_invoice_payments').insert({ business_id: biz, wave_business_id: siloId, accounting_invoice_id: inv.id, accounting_customer_id: inv.accounting_customer_id || null, amount: c.applied_to_invoice, payment_date: t.posted_date || t.date || null, source: 'plaid_match', bank_transaction_id: t.id, payment_match_id: matchId, wave_payment_id: null, sync_status: 'pending_wave_sync', wave_invoice_id: inv.wave_invoice_id || null, wave_customer_id: body.wave_customer_id || null, memo: body.notes || null, created_by: by });
      if (pIns && pIns.error) {
        // atomic rollback: void the orphan match
        try { await db.from('payment_matches').update({ voided: true }).eq('id', matchId); } catch (eR) {}
        return NextResponse.json({ ok: false, error: 'Linked match created but the payment could not be saved (rolled back): ' + pIns.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 });
      }

      // 3) overpayment → credit / unapplied deposit
      if (c.overpayment > 0) {
        var creditCustId = body.credit_customer_id || inv.accounting_customer_id || null;
        if (creditCustId) {
          await db.from('customer_credits').insert({ business_id: biz, wave_business_id: siloId, accounting_customer_id: creditCustId, source_transaction_id: t.id, amount: c.overpayment, status: 'open', notes: 'Overpayment on invoice ' + (inv.invoice_number || inv.id), created_by: by });
        } else {
          await db.from('unapplied_deposits').insert({ business_id: biz, wave_business_id: siloId, bank_transaction_id: t.id, accounting_customer_id: null, amount: c.overpayment, status: 'open', notes: 'Overpayment on invoice ' + (inv.invoice_number || inv.id) + ' (no customer)', created_by: by });
        }
      }

      // 4) stamp the bank transaction so the Hub shows the relationship.
      // v55.83-JC — ACCOUNTING INTEGRITY (money conservation): only auto-flip an unreviewed deposit
      // to 'reviewed' when this match (plus prior payments + the overpayment routed to credit/
      // unapplied) FULLY allocates the deposit. A partial match must leave it unreviewed so the
      // remaining amount is still surfaced for allocation — never silently "done".
      var allocatedAfter = roundMoney(already + c.applied_to_invoice + (c.overpayment || 0));
      var depositRemaining = depositAmt > 0 ? roundMoney(depositAmt - allocatedAfter) : 0;
      var fullyAllocated = !(depositAmt > 0) || depositRemaining <= 0.01;
      var nextStatus = (t.review_status === 'unreviewed' && fullyAllocated) ? 'reviewed' : t.review_status;
      var txnPatch = { classification: t.classification || 'customer_payment', accounting_customer_id: body.match_customer_id || t.accounting_customer_id || inv.accounting_customer_id || null, linked_type: 'invoice', linked_id: inv.id, matched_invoice_id: inv.id, review_status: nextStatus, updated_by: by };
      var txnRes = await db.from('bank_transactions').update(txnPatch).eq('id', t.id);
      if (txnRes && txnRes.error) { /* non-fatal: the money rows are the source of truth */ }

      // 5) recompute the invoice balance
      // v55.83-JP (audit) — recompute is best-effort: the match + payment rows are the source of truth.
      // If recompute throws (a transient read error), do NOT 500 after the money rows are already
      // written — return ok with a flag so the client refreshes balances instead of showing a stale one.
      var recomputed = null; var recomputeFailed = false;
      try { recomputed = await recompute(db, inv.id); } catch (eRc) { recomputeFailed = true; }

      return NextResponse.json({ ok: true, match_id: matchId, applied: c.applied_to_invoice, overpayment: c.overpayment, type: c.type, invoice: recomputed, recompute_failed: recomputeFailed, deposit_remaining: depositRemaining, fully_allocated: fullyAllocated, review_status: nextStatus, api_build_marker: API_BUILD_MARKER });
    }

    // ── unmatch: reverse a match (re-categorize / delete) ──
    if (action === 'unmatch') {
      var bid = body.bank_transaction_id;
      if (!bid) { return NextResponse.json({ ok: false, error: 'bank_transaction_id required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      // v55.83-JP (audit) — silo guard: when the caller declares which silo it's acting in, refuse to
      // void another silo's payments by a guessed txn id. The txn is re-read from the DB.
      if (body.wave_business_id) {
        var umSiloRes = await db.from('bank_transactions').select('wave_business_id').eq('id', bid);
        var umSilo = (umSiloRes && umSiloRes.data && umSiloRes.data.length) ? umSiloRes.data[0].wave_business_id : null;
        if (umSilo && umSilo !== body.wave_business_id) {
          return NextResponse.json({ ok: false, error: 'Cross-silo unmatch blocked: this transaction belongs to a different Wave business.', txn_silo: umSilo, api_build_marker: API_BUILD_MARKER }, { status: 409 });
        }
      }
      // Block reversing a Wave-synced payment (would desync Hub from Wave).
      var payRows = await db.from('accounting_invoice_payments').select('id, accounting_invoice_id, wave_payment_id, sync_status, voided').eq('bank_transaction_id', bid);
      if (payRows && payRows.error) { return NextResponse.json({ ok: false, error: payRows.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var pr = (payRows && payRows.data) || []; var k;
      for (k = 0; k < pr.length; k++) { if (pr[k] && !isPaymentVoid(pr[k]) && (pr[k].wave_payment_id || pr[k].sync_status === 'synced' || pr[k].sync_status === 'manual_done')) { return NextResponse.json({ ok: false, error: 'This payment was already pushed to Wave — reverse it in Wave, do not unmatch locally.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); } }
      var invIds = {};
      for (k = 0; k < pr.length; k++) { if (pr[k] && pr[k].accounting_invoice_id) { invIds[pr[k].accounting_invoice_id] = true; } }
      await db.from('accounting_invoice_payments').update({ voided: true, sync_status: 'void' }).eq('bank_transaction_id', bid);
      await db.from('payment_matches').update({ voided: true }).eq('bank_transaction_id', bid);
      try { await db.from('customer_credits').update({ status: 'void' }).eq('source_transaction_id', bid).eq('status', 'open'); } catch (eC) {}
      var ik = Object.keys(invIds); var w;
      for (w = 0; w < ik.length; w++) { await recompute(db, ik[w]); }
      await db.from('bank_transactions').update({ linked_type: null, linked_id: null, matched_invoice_id: null, updated_by: by }).eq('id', bid);
      return NextResponse.json({ ok: true, unmatched_invoices: ik.length, api_build_marker: API_BUILD_MARKER });
    }

    // ── update_match: change an existing match's invoice and/or amount safely (Codex P0 money-safety).
    // Ordering is APPLY-NEW-FIRST, THEN REVERSE-OLD, with restore on any failure: the original match
    // stays intact until the new match+payment are written; if reversing the old rows then fails, the
    // old rows are restored and the new rows voided so the deposit is NEVER left half-changed. BLOCKS if
    // the existing payment was already pushed to Wave (returns needs_wave_reversal) — never silently
    // overwrites a synced row. Recomputes the OLD invoice(s) + the NEW invoice. No orphans/duplicates.
    if (action === 'update_match') {
      var uTid = body.bank_transaction_id; var uNewInv = body.new_invoice_id; var uNewAmt = roundMoney(Number(body.amount));
      if (!uTid || !uNewInv) { return NextResponse.json({ ok: false, error: 'bank_transaction_id and new_invoice_id are required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(uNewAmt > 0)) { return NextResponse.json({ ok: false, error: 'Amount must be greater than zero.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var uTxR = await db.from('bank_transactions').select('id, business_id, wave_business_id, amount, amount_abs, posted_date, date, classification, accounting_customer_id, review_status').eq('id', uTid).limit(1);
      var uTx = (uTxR && uTxR.data && uTxR.data.length) ? uTxR.data[0] : null;
      if (!uTx) { return NextResponse.json({ ok: false, error: 'Transaction not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      if (uTx.review_status === 'approved') { return NextResponse.json({ ok: false, error: 'Transaction is approved — reopen it first.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
      var uDep = roundMoney(Number(uTx.amount_abs != null ? uTx.amount_abs : Math.abs(Number(uTx.amount) || 0)));
      if (uDep > 0 && uNewAmt > uDep + 0.01) { return NextResponse.json({ ok: false, error: 'Amount ' + uNewAmt + ' exceeds the deposit ' + uDep + '.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
      // existing payments — block if ANY active one is already in Wave (no silent local overwrite).
      var uExP = await db.from('accounting_invoice_payments').select('id, accounting_invoice_id, wave_payment_id, sync_status, voided').eq('bank_transaction_id', uTid);
      if (uExP && uExP.error) { return NextResponse.json({ ok: false, error: uExP.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var uEx = (uExP && uExP.data) || []; var uq; var oldInvIds = {};
      for (uq = 0; uq < uEx.length; uq++) {
        var pp = uEx[uq];
        if (!isPaymentVoid(pp) && (pp.wave_payment_id || pp.sync_status === 'synced' || pp.sync_status === 'manual_done')) {
          return NextResponse.json({ ok: false, error: 'This payment was already pushed to Wave — reverse/remove it in Wave, then re-import, before changing the match here. (No silent local overwrite.)', needs_wave_reversal: true, api_build_marker: API_BUILD_MARKER }, { status: 409 });
        }
        if (pp.accounting_invoice_id) { oldInvIds[pp.accounting_invoice_id] = true; }
      }
      // fetch the NEW invoice (server-authoritative).
      var uNiR = await db.from('accounting_invoices').select('id, business_id, wave_business_id, total_amount, wave_imported_paid, accounting_customer_id, invoice_number, wave_invoice_id').eq('id', uNewInv).limit(1);
      var uNi = (uNiR && uNiR.data && uNiR.data.length) ? uNiR.data[0] : null;
      if (!uNi) { return NextResponse.json({ ok: false, error: 'New invoice not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      if (uTx.wave_business_id && uNi.wave_business_id && uTx.wave_business_id !== uNi.wave_business_id) {
        return NextResponse.json({ ok: false, error: 'Cross-silo: the new invoice belongs to a different Wave business than this deposit.', api_build_marker: API_BUILD_MARKER }, { status: 409 });
      }
      var uBiz = uTx.business_id || uNi.business_id || null;
      var uSilo = body.wave_business_id || uNi.wave_business_id || uTx.wave_business_id || null;
      var ZERO_UUID = '00000000-0000-0000-0000-000000000000';
      // v55.83-KG (Codex money-safety): APPLY-NEW-FIRST, THEN REVERSE-OLD, with full restore on any
      // failure. The old version voided the old rows BEFORE the new insert, so a failed new insert left
      // the deposit unmatched. Now the original match stays intact until the new one is safely written;
      // if reversing the old rows fails, we restore them to their prior state and void the new rows so
      // the deposit is never left half-changed (Supabase UPDATE is per-statement atomic; we snapshot +
      // restore across statements).
      // Snapshot old matches + old open credits/unapplied (old payments are already in uEx) so we can
      // restore EVERY money row on failure (v55.83-KJ — Codex: don't leave overpayment artifacts orphaned).
      var uOldMatchR = await db.from('payment_matches').select('id, voided').eq('bank_transaction_id', uTid);
      var uOldMatches = (uOldMatchR && uOldMatchR.data) || [];
      var uOldCredR = await db.from('customer_credits').select('id').eq('source_transaction_id', uTid).eq('status', 'open');
      var uOldCredits = (uOldCredR && uOldCredR.data) || [];
      var uOldUnapR = await db.from('unapplied_deposits').select('id').eq('bank_transaction_id', uTid).eq('status', 'open');
      var uOldUnapplied = (uOldUnapR && uOldUnapR.data) || [];
      // anti-double-count on the NEW invoice — EXCLUDE this deposit's (to-be-voided) payments so the
      // calc is correct regardless of the void timing.
      var uIpR = await db.from('accounting_invoice_payments').select('amount, voided, sync_status, bank_transaction_id').eq('accounting_invoice_id', uNi.id);
      var uPaid = Number(uNi.wave_imported_paid) || 0; var uipr = (uIpR && uIpR.data) || []; var uy;
      for (uy = 0; uy < uipr.length; uy++) { if (!isPaymentVoid(uipr[uy]) && uipr[uy].bank_transaction_id !== uTid) { uPaid += Number(uipr[uy].amount) || 0; } }
      var uCc = classifyApplication(Number(uNi.total_amount) || 0, roundMoney(uPaid), uNewAmt);
      // 1) APPLY NEW FIRST (old still intact). Match.
      var uMi = await db.from('payment_matches').insert({ business_id: uBiz, wave_business_id: uSilo, bank_transaction_id: uTid, invoice_id: uNi.id, matched_amount: uCc.applied_to_invoice, match_type: uCc.type, is_manual_override: true, notes: 'match edit', matched_by: by, created_by: by }).select();
      if (uMi && uMi.error) { return NextResponse.json({ ok: false, error: 'Could not save the updated match (no change made): ' + uMi.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var uMid = (uMi && uMi.data && uMi.data.length) ? uMi.data[0].id : null;
      // Payment. If this fails, void the new match → original match is untouched.
      var uPi = await db.from('accounting_invoice_payments').insert({ business_id: uBiz, wave_business_id: uSilo, accounting_invoice_id: uNi.id, accounting_customer_id: uNi.accounting_customer_id || null, amount: uCc.applied_to_invoice, payment_date: uTx.posted_date || uTx.date || null, source: 'plaid_match', bank_transaction_id: uTid, payment_match_id: uMid, wave_payment_id: null, sync_status: 'pending_wave_sync', wave_invoice_id: uNi.wave_invoice_id || null, wave_customer_id: body.wave_customer_id || null, memo: 'match edit', created_by: by }).select();
      if (uPi && uPi.error) { try { await db.from('payment_matches').update({ voided: true }).eq('id', uMid); } catch (eR) {} return NextResponse.json({ ok: false, error: 'Could not save the payment — NO change was made, your original match is intact: ' + uPi.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var uPid = (uPi && uPi.data && uPi.data.length) ? uPi.data[0].id : null;
      // overpayment → credit/unapplied (track ids so we can exclude/roll them back).
      var uCreditId = null; var uUnapId = null;
      if (uCc.overpayment > 0) {
        var uCredCust = body.credit_customer_id || uNi.accounting_customer_id || null;
        var uOvErr = null;
        if (uCredCust) { var uCrIns = await db.from('customer_credits').insert({ business_id: uBiz, wave_business_id: uSilo, accounting_customer_id: uCredCust, source_transaction_id: uTid, amount: uCc.overpayment, status: 'open', notes: 'Overpayment on invoice ' + (uNi.invoice_number || uNi.id) + ' (match edit)', created_by: by }).select(); if (uCrIns && uCrIns.error) { uOvErr = uCrIns.error.message; } else if (uCrIns && uCrIns.data && uCrIns.data.length) { uCreditId = uCrIns.data[0].id; } }
        else { var uUnIns = await db.from('unapplied_deposits').insert({ business_id: uBiz, wave_business_id: uSilo, bank_transaction_id: uTid, accounting_customer_id: null, amount: uCc.overpayment, status: 'open', notes: 'Overpayment (match edit, no customer)', created_by: by }).select(); if (uUnIns && uUnIns.error) { uOvErr = uUnIns.error.message; } else if (uUnIns && uUnIns.data && uUnIns.data.length) { uUnapId = uUnIns.data[0].id; } }
        // v55.83-KJ — if the overpayment artifact can't be recorded, DON'T proceed to void the old rows
        // (that would lose money). Roll back the new match+payment → original match intact.
        if (uOvErr) { try { await db.from('accounting_invoice_payments').update({ voided: true, sync_status: 'void' }).eq('id', uPid); } catch (eOv1) {} try { await db.from('payment_matches').update({ voided: true }).eq('id', uMid); } catch (eOv2) {} return NextResponse.json({ ok: false, error: 'Could not record the overpayment — NO change was made, your original match is intact: ' + uOvErr, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      }
      // 2) REVERSE OLD (exclude the rows we just created). Void matches first, then payments, so a
      // failure restore is straightforward. Each UPDATE is per-statement atomic.
      var uVoidErr = null;
      var uVm = await db.from('payment_matches').update({ voided: true }).eq('bank_transaction_id', uTid).neq('id', uMid || ZERO_UUID);
      if (uVm && uVm.error) { uVoidErr = 'matches: ' + uVm.error.message; }
      if (!uVoidErr) { var uVp = await db.from('accounting_invoice_payments').update({ voided: true, sync_status: 'void' }).eq('bank_transaction_id', uTid).neq('id', uPid || ZERO_UUID); if (uVp && uVp.error) { uVoidErr = 'payments: ' + uVp.error.message; } }
      // v55.83-KJ (Codex) — these voids are NO LONGER swallowed: a failure triggers the restore path so we
      // can't leave a duplicate open credit/deposit while returning success.
      if (!uVoidErr) { var uVc = await db.from('customer_credits').update({ status: 'void' }).eq('source_transaction_id', uTid).eq('status', 'open').neq('id', uCreditId || ZERO_UUID); if (uVc && uVc.error) { uVoidErr = 'old credits: ' + uVc.error.message; } }
      if (!uVoidErr) { var uVu = await db.from('unapplied_deposits').update({ status: 'void' }).eq('bank_transaction_id', uTid).eq('status', 'open').neq('id', uUnapId || ZERO_UUID); if (uVu && uVu.error) { uVoidErr = 'old unapplied: ' + uVu.error.message; } }
      if (uVoidErr) {
        // RESTORE every old money row to prior state + void the new rows → original match intact, no change.
        var uri;
        for (uri = 0; uri < uOldMatches.length; uri++) { if (uOldMatches[uri].id !== uMid) { try { await db.from('payment_matches').update({ voided: uOldMatches[uri].voided === true }).eq('id', uOldMatches[uri].id); } catch (eRM) {} } }
        for (uri = 0; uri < uEx.length; uri++) { if (uEx[uri].id !== uPid) { try { await db.from('accounting_invoice_payments').update({ voided: uEx[uri].voided === true, sync_status: uEx[uri].sync_status || null }).eq('id', uEx[uri].id); } catch (eRP) {} } }
        for (uri = 0; uri < uOldCredits.length; uri++) { try { await db.from('customer_credits').update({ status: 'open' }).eq('id', uOldCredits[uri].id); } catch (eRC) {} }
        for (uri = 0; uri < uOldUnapplied.length; uri++) { try { await db.from('unapplied_deposits').update({ status: 'open' }).eq('id', uOldUnapplied[uri].id); } catch (eRU) {} }
        try { await db.from('accounting_invoice_payments').update({ voided: true, sync_status: 'void' }).eq('id', uPid); } catch (eVN) {}
        try { await db.from('payment_matches').update({ voided: true }).eq('id', uMid); } catch (eVM) {}
        if (uCreditId) { try { await db.from('customer_credits').update({ status: 'void' }).eq('id', uCreditId); } catch (eVC) {} }
        if (uUnapId) { try { await db.from('unapplied_deposits').update({ status: 'void' }).eq('id', uUnapId); } catch (eVU) {} }
        try { await recompute(db, uNi.id); } catch (eRR) {}
        var uok0; for (uok0 in oldInvIds) { try { await recompute(db, uok0); } catch (eRR2) {} }
        return NextResponse.json({ ok: false, error: 'Could not complete the change cleanly (' + uVoidErr + '). Restored your original match — nothing was changed. Please retry; if it persists, screenshot for Claude.', restored: true, api_build_marker: API_BUILD_MARKER }, { status: 500 });
      }
      // 3) recompute OLD invoice(s) + the NEW invoice — surface (not swallow) any recompute/restamp issue
      // so the caller knows balances/linkage may be momentarily stale (v55.83-KJ, Codex).
      var uWarn = null;
      var uOldKeys = Object.keys(oldInvIds); var uok;
      for (uok = 0; uok < uOldKeys.length; uok++) { if (uOldKeys[uok] !== uNi.id) { try { await recompute(db, uOldKeys[uok]); } catch (eR1) { uWarn = 'recompute (old invoice) failed: ' + ((eR1 && eR1.message) || eR1); } } }
      var uRecomputed = null; try { uRecomputed = await recompute(db, uNi.id); } catch (eR2) { uWarn = 'recompute (new invoice) failed: ' + ((eR2 && eR2.message) || eR2); }
      // 4) re-stamp the deposit to the new invoice.
      var uStamp = await db.from('bank_transactions').update({ classification: uTx.classification || 'customer_payment', linked_type: 'invoice', linked_id: uNi.id, matched_invoice_id: uNi.id, accounting_customer_id: body.match_customer_id || uNi.accounting_customer_id || uTx.accounting_customer_id || null, updated_by: by }).eq('id', uTid);
      if (uStamp && uStamp.error) { uWarn = 'transaction re-link failed: ' + uStamp.error.message; }
      return NextResponse.json({ ok: true, applied: uCc.applied_to_invoice, overpayment: uCc.overpayment, type: uCc.type, new_invoice_id: uNi.id, invoice: uRecomputed, reversed_invoices: uOldKeys.length, warning: uWarn, api_build_marker: API_BUILD_MARKER });
    }

    // ── assign_account_silo: account-level bank→silo mapping + repair existing rows (v55.83-IV) ──
    if (action === 'assign_account_silo') {
      var pacct = body.plaid_account_id;
      var newBiz = body.wave_business_id || null;
      if (!pacct) { return NextResponse.json({ ok: false, error: 'plaid_account_id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var nowIso = new Date().toISOString();
      // 1) set the per-account assignment. v55.83-JX (Max live: "Could not find the 'assigned_at' column
      // of plaid_accounts") — the audit columns (assigned_by/assigned_at/assignment_source) don't exist
      // on the live table, which failed the WHOLE assignment. Try the full payload, then fall back to
      // just wave_business_id so the silo assignment ALWAYS lands. Surface the real DB reason on failure.
      var aRes = await db.from('plaid_accounts').update({ wave_business_id: newBiz, assigned_by: by, assigned_at: nowIso, assignment_source: 'manual' }).eq('plaid_account_id', pacct).select('plaid_account_id');
      if (aRes && aRes.error && /column|assigned_at|assigned_by|assignment_source|schema cache/i.test(aRes.error.message || '')) {
        aRes = await db.from('plaid_accounts').update({ wave_business_id: newBiz }).eq('plaid_account_id', pacct).select('plaid_account_id');
      }
      if (aRes && aRes.error) { return NextResponse.json({ ok: false, error: 'Could not set account assignment: ' + aRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(aRes && aRes.data && aRes.data.length)) { return NextResponse.json({ ok: false, error: 'Account ' + pacct + ' not found in plaid_accounts (0 rows updated) — re-sync the connection first.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      // 2) REPAIR: restamp existing bank_transactions for this account to the new silo
      var rRes = await db.from('bank_transactions').update({ wave_business_id: newBiz, updated_by: by }).eq('account_id', pacct).select('id');
      if (rRes && rRes.error) { return NextResponse.json({ ok: false, error: 'Assignment saved but restamping existing transactions failed: ' + rRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var restamped = (rRes && rRes.data) ? rRes.data.length : 0;
      // 3) audit
      try { await db.from('bank_data_assignment_audit').insert({ record_type: 'plaid_account', transaction_count: restamped, new_wave_business_id: newBiz, assigned_by: by, notes: 'account-level assignment for plaid_account ' + pacct }); } catch (eAud) {}
      return NextResponse.json({ ok: true, restamped: restamped, plaid_account_id: pacct, wave_business_id: newBiz, api_build_marker: API_BUILD_MARKER });
    }

    // ── assign_connection_silo: connection-level silo assignment + restamp (service-role, schema-safe) ──
    // v55.83-JX — was a browser write that also tried assigned_at/assigned_by (missing columns) and was
    // RLS-exposed. Stamps bank_connections.wave_business_id + restamps its transactions + stamps its
    // still-unassigned accounts to the same silo. Writes ONLY wave_business_id (no audit columns).
    if (action === 'assign_connection_silo') {
      var cid = body.connection_id; var cBiz = body.wave_business_id || null;
      if (!cid) { return NextResponse.json({ ok: false, error: 'connection_id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var ccRes = await db.from('bank_connections').update({ wave_business_id: cBiz }).eq('id', cid).select('id');
      if (ccRes && ccRes.error) { return NextResponse.json({ ok: false, error: 'Could not assign the connection: ' + ccRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(ccRes && ccRes.data && ccRes.data.length)) { return NextResponse.json({ ok: false, error: 'Connection not found (0 rows).', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      var ctRes = await db.from('bank_transactions').update({ wave_business_id: cBiz, updated_by: by }).eq('connection_id', cid).select('id');
      if (ctRes && ctRes.error) { return NextResponse.json({ ok: false, error: 'Connection assigned but restamping transactions failed: ' + ctRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      // stamp this connection's UNASSIGNED accounts to the same silo (preserve deliberate per-account picks)
      try { await db.from('plaid_accounts').update({ wave_business_id: cBiz }).eq('connection_id', cid).is('wave_business_id', null); } catch (ePa) {}
      return NextResponse.json({ ok: true, restamped: (ctRes && ctRes.data) ? ctRes.data.length : 0, connection_id: cid, wave_business_id: cBiz, api_build_marker: API_BUILD_MARKER });
    }

    // ── archive_connection: hide a duplicate/relinked connection without deleting its data (service-role) ──
    // v55.83-JX (Max: "only one group per silo") — lets the admin clean up duplicate Chase groups.
    // Sets status='archived' so it drops out of the active list; transactions/matches are untouched.
    if (action === 'archive_connection') {
      var acid = body.connection_id;
      if (!acid) { return NextResponse.json({ ok: false, error: 'connection_id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var arRes = await db.from('bank_connections').update({ status: 'archived' }).eq('id', acid).select('id');
      if (arRes && arRes.error) { return NextResponse.json({ ok: false, error: 'Could not archive the connection: ' + arRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(arRes && arRes.data && arRes.data.length)) { return NextResponse.json({ ok: false, error: 'Connection not found (0 rows).', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      return NextResponse.json({ ok: true, connection_id: acid, api_build_marker: API_BUILD_MARKER });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action: ' + action, api_build_marker: API_BUILD_MARKER }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER, route: API_ROUTE });
}
