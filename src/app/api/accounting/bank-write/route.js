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
import { classifyApplication, roundMoney, isPaymentVoid, bankAllocationStatus } from '../../../../lib/payment-matching';

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
  var paid = 0; var split = 0; var unapplied = 0;
  var pR = await db.from('accounting_invoice_payments').select('amount, voided, sync_status').eq('bank_transaction_id', txnId);
  if (pR && pR.error) { throw pR.error; }
  var pr = (pR && pR.data) || []; var i;
  for (i = 0; i < pr.length; i++) { if (!isPaymentVoid(pr[i])) { paid += Number(pr[i].amount) || 0; } }
  var sR = await db.from('bank_transaction_splits').select('split_amount').eq('bank_transaction_id', txnId);
  if (sR && sR.error) { throw sR.error; }
  var sr = (sR && sR.data) || [];
  for (i = 0; i < sr.length; i++) { split += Number(sr[i].split_amount) || 0; }
  var uR = await db.from('unapplied_deposits').select('amount, status').eq('bank_transaction_id', txnId);
  if (uR && uR.error) { throw uR.error; }
  var ur = (uR && uR.data) || [];
  for (i = 0; i < ur.length; i++) { if (!ur[i].status || ur[i].status === 'open') { unapplied += Number(ur[i].amount) || 0; } }
  return bankAllocationStatus({ txnAmount: total, paid: paid, split: split, unapplied: unapplied });
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

    // Permission per action.
    var permKey = (action === 'match_invoice' || action === 'unmatch') ? 'payments.match'
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

    // ── classify / set_wave_category: categorization on a bank transaction ──
    if (action === 'classify' || action === 'set_wave_category') {
      var cPatch = body.patch || {};
      cPatch.updated_by = by;
      var cRes = await db.from('bank_transactions').update(cPatch).eq('id', body.bank_transaction_id).select();
      if (cRes && cRes.error) { return NextResponse.json({ ok: false, error: cRes.error.message, api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
      if (!(cRes && cRes.data && cRes.data.length)) { return NextResponse.json({ ok: false, error: 'No row updated (transaction not found).', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
      return NextResponse.json({ ok: true, row: cRes.data[0], api_build_marker: API_BUILD_MARKER });
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
