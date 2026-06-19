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

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var by = body.user_id || null;
    var action = body.action || '';

    // Permission per action. v55.83-JJ — split-save and park-unapplied allocate money, so they need
    // payments.match (same as match/unmatch/status), per Codex's launch-safe rule.
    var permKey = (action === 'match_invoice' || action === 'unmatch' || action === 'save_splits' || action === 'create_unapplied') ? 'payments.match'
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
      var sPatch = { review_status: body.status, updated_by: by };
      if (body.status === 'reviewed' || body.status === 'approved') { sPatch.reviewed_by = by; sPatch.reviewed_at = new Date().toISOString(); }
      if (body.notes != null) { sPatch.notes = body.notes; }
      var sRes = await db.from('bank_transactions').update(sPatch).eq('id', body.bank_transaction_id).select();
      if (sRes && sRes.error) { return NextResponse.json({ ok: false, error: sRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(sRes && sRes.data && sRes.data.length)) { return NextResponse.json({ ok: false, error: 'No row updated (transaction not found).', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      return NextResponse.json({ ok: true, row: sRes.data[0], api_build_marker: API_BUILD_MARKER });
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
      var recomputed = await recompute(db, inv.id);

      return NextResponse.json({ ok: true, match_id: matchId, applied: c.applied_to_invoice, overpayment: c.overpayment, type: c.type, invoice: recomputed, deposit_remaining: depositRemaining, fully_allocated: fullyAllocated, review_status: nextStatus, api_build_marker: API_BUILD_MARKER });
    }

    // ── unmatch: reverse a match (re-categorize / delete) ──
    if (action === 'unmatch') {
      var bid = body.bank_transaction_id;
      if (!bid) { return NextResponse.json({ ok: false, error: 'bank_transaction_id required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
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

    // ── assign_account_silo: account-level bank→silo mapping + repair existing rows (v55.83-IV) ──
    if (action === 'assign_account_silo') {
      var pacct = body.plaid_account_id;
      var newBiz = body.wave_business_id || null;
      if (!pacct) { return NextResponse.json({ ok: false, error: 'plaid_account_id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var nowIso = new Date().toISOString();
      // 1) set the per-account assignment
      var aRes = await db.from('plaid_accounts').update({ wave_business_id: newBiz, assigned_by: by, assigned_at: nowIso, assignment_source: 'manual' }).eq('plaid_account_id', pacct).select('id');
      if (aRes && aRes.error) { return NextResponse.json({ ok: false, error: 'Could not set account assignment: ' + aRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      // 2) REPAIR: restamp existing bank_transactions for this account to the new silo
      var rRes = await db.from('bank_transactions').update({ wave_business_id: newBiz, updated_by: by }).eq('account_id', pacct).select('id');
      if (rRes && rRes.error) { return NextResponse.json({ ok: false, error: 'Assignment saved but restamping existing transactions failed: ' + rRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      var restamped = (rRes && rRes.data) ? rRes.data.length : 0;
      // 3) audit
      try { await db.from('bank_data_assignment_audit').insert({ record_type: 'plaid_account', transaction_count: restamped, new_wave_business_id: newBiz, assigned_by: by, notes: 'account-level assignment for plaid_account ' + pacct }); } catch (eAud) {}
      return NextResponse.json({ ok: true, restamped: restamped, plaid_account_id: pacct, wave_business_id: newBiz, api_build_marker: API_BUILD_MARKER });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action: ' + action, api_build_marker: API_BUILD_MARKER }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER, route: API_ROUTE });
}
