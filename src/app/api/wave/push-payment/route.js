// /api/wave/push-payment — REAL invoice payment push via invoicePaymentCreateManual.
// Confirmed required input fields (from live Wave validation probe v55.83-FA):
//   invoiceId: ID!  paymentAccountId: ID!  amount: Decimal!  paymentDate: Date!
//   paymentMethod: InvoicePaymentMethod!  exchangeRate: Decimal!
// Sources: invoiceId = accounting_invoices.wave_invoice_id; paymentAccountId =
// wave_business_settings.default_payment_account_id; amount/paymentDate from the payment row;
// exchangeRate = 1 (same-currency); paymentMethod defaults to a configurable value and, if
// Wave rejects it, the route returns Wave's accepted enum list so the value can be corrected.
// Never fakes wave_payment_id. KANDIL-only guard via assertCanPush is enforced by the caller's
// silo guard; this route also re-checks the approved business id. SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business-shared';
import { resolveWaveBankAnchor, waveBankCashCandidates } from '../../../../lib/wave-bank-account-resolver';

var WAVE_URL = 'https://gql.waveapps.com/graphql/public';
var APPROVED_PUSH_BUSINESS_ID = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';
var API_BUILD_MARKER = 'v55.83-MP-push-payment-no-feed-owner-block';
var API_ROUTE = '/api/wave/push-payment';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function gql(token, query, variables) {
  return fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: query, variables: variables || {} }) }).then(function (r) { return r.json(); });
}

// Builds the accounting-grade sync-log payload (who / which invoice / which payment / Wave ids),
// so the Sync Log reads like an accounting record, not a developer dump. extra carries the
// result-specific fields: wave_payment_id, error, wave_errors, input_errors, sync_status_after.
function buildLogPayload(ctx, extra) {
  var p = {
    api_build_marker: ctx.api_build_marker,
    route: ctx.route,
    payment: { hub_payment_id: ctx.hub_payment_id, amount: ctx.amount, payment_date: ctx.payment_date, source: ctx.source, bank_transaction_id: ctx.bank_transaction_id, payment_match_id: ctx.payment_match_id },
    invoice: { accounting_invoice_id: ctx.accounting_invoice_id, invoice_number: ctx.invoice_number, wave_invoice_id: ctx.wave_invoice_id },
    customer: { accounting_customer_id: ctx.accounting_customer_id, customer_name: ctx.customer_name, wave_customer_id: ctx.wave_customer_id },
    wave: { wave_payment_id: (extra && extra.wave_payment_id) || null, payment_account_id: ctx.payment_account_id, payment_account_name: ctx.payment_account_name },
    sync_status_before: ctx.sync_status_before
  };
  if (extra) {
    if (extra.sync_status_after != null) { p.sync_status_after = extra.sync_status_after; }
    if (extra.error != null) { p.error = extra.error; }
    if (extra.wave_errors != null) { p.wave_errors = extra.wave_errors; }
    if (extra.input_errors != null) { p.input_errors = extra.input_errors; }
  }
  return p;
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var waveBusinessId = body.wave_business_id;
    var hubId = body.hub_record_id;
    var by = body.user_id || null;
    var isDry = body.dry_run === true;
    var token = process.env.WAVE_ACCESS_TOKEN;
    var pay = null;
    var logCtx = null;

    // v55.83-MG - payment pushes now mirror push-transaction's no-silent-fail rule:
    // every blocked attempt gets a payment row in wave_sync_log with the exact reason.
    async function blocked(reason, status, clientFields, extraPayload) {
      var requestPayload = logCtx || {
        api_build_marker: API_BUILD_MARKER,
        route: API_ROUTE,
        wave_business_id: waveBusinessId || null,
        payment: {
          hub_payment_id: hubId || null,
          source: pay && pay.source ? pay.source : null,
          bank_transaction_id: pay && pay.bank_transaction_id ? pay.bank_transaction_id : null,
          payment_match_id: pay && pay.payment_match_id ? pay.payment_match_id : null
        }
      };
      var responsePayload = logCtx
        ? buildLogPayload(logCtx, Object.assign({ error: reason }, extraPayload || {}))
        : Object.assign({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE, error: reason, payment: { hub_payment_id: hubId || null } }, extraPayload || {});
      try {
        await db.from('wave_sync_log').insert({
          wave_business_id: waveBusinessId || (pay && pay.wave_business_id) || null,
          entity_type: 'payment',
          hub_record_id: hubId || null,
          action: 'push',
          dry_run: !!isDry,
          success: false,
          error_message: reason,
          request_payload: requestPayload,
          response_payload: responsePayload,
          attempted_by: by
        });
      } catch (eBlockedLog) {}
      return NextResponse.json(Object.assign({ ok: false, error: reason, api_build_marker: API_BUILD_MARKER }, clientFields || {}), { status: status || 400 });
    }

    // SECURITY: this route uses the service role, so it MUST verify the caller has the
    // specific permission server-side. super_admin resolves to all permissions; other users
    // need wave.payments.push (via grant or role). CRON bearer bypasses for scheduled use.
    var _perm = await assertPermission(db, by, 'wave.payments.push', req);
    if (!_perm.ok) { return blocked(_perm.error, _perm.status); }

    if (!token) { return blocked('Wave token not configured.', 400); }
    if (!hubId) { return blocked('No payment row id provided.', 400); }
    // v55.83-KO (audit) — name the REAL blocker for a placeholder silo (not the production-lock message).
    if (waveBusinessId && isPlaceholderWaveBusiness(waveBusinessId)) { return blocked('This silo is not connected to a real Wave business yet (placeholder id). Go to Accounting -> Wave Connection and BIND this silo before pushing payments.', 400, { placeholder: true }); }

    // v55.83-HI — allow the approved test business OR a production business a super admin has
    // explicitly unlocked (production_push_unlocked + writes_enabled + allow_payment_push on the
    // registry row). Default (column absent/false) → only the approved test business, exactly as before.
    var _regRes = await db.from('wave_business_registry').select('is_production, writes_enabled, allow_payment_push, production_push_unlocked, label').eq('wave_business_id', waveBusinessId);
    var _preg = (_regRes && _regRes.data && _regRes.data.length) ? _regRes.data[0] : null;
    var _isApprovedTest = (waveBusinessId === APPROVED_PUSH_BUSINESS_ID);
    var _prodUnlocked = !!(_preg && _preg.is_production !== false && _preg.production_push_unlocked === true && _preg.writes_enabled === true && _preg.allow_payment_push === true);
    if (!_isApprovedTest && !_prodUnlocked) {
      return blocked('Production payment push is locked. A super admin must enable real production push (writes_enabled + allow_payment_push + production unlock) for this business.', 403);
    }

    // Load the payment row.
    var payRes = await db.from('accounting_invoice_payments').select('*').eq('id', hubId);
    pay = (payRes && payRes.data && payRes.data.length) ? payRes.data[0] : null;
    if (!pay) { return blocked('Payment row not found.', 404); }
    if (pay.voided === true || pay.sync_status === 'void') { return blocked('Payment is voided.', 400); }
    if (pay.wave_payment_id) { return blocked('Payment already pushed (has wave_payment_id).', 400); }

    // Resolve invoiceId (Wave) — from the payment row, else its invoice.
    var invWaveId = pay.wave_invoice_id || null;
    if (!invWaveId && pay.accounting_invoice_id) {
      var invRes = await db.from('accounting_invoices').select('wave_invoice_id, wave_business_id').eq('id', pay.accounting_invoice_id);
      var invRow = (invRes && invRes.data && invRes.data.length) ? invRes.data[0] : null;
      if (invRow) { invWaveId = invRow.wave_invoice_id || null; }
    }
    if (!invWaveId) { return blocked('Invoice is not in Wave yet (no wave_invoice_id). Push the invoice first.', 400); }

    // Verify the bank transaction still exists (orphan guard) unless it was a manual payment.
    var payBtAccountId = null;
    if (pay.bank_transaction_id) {
      var btRes = await db.from('bank_transactions').select('id, account_id').eq('id', pay.bank_transaction_id);
      if (!(btRes && btRes.data && btRes.data.length)) {
        return blocked('Bank deposit for this payment no longer exists (orphaned). Void it instead of pushing.', 400);
      }
      payBtAccountId = btRes.data[0].account_id || null;
    }

    // v55.83-MC — deposit account via the SHARED resolver: match the payment's OWN bank account to its Wave
    // bank account (so a multi-account silo lands the payment on the account that actually received the
    // money), falling back to the silo default. Removes the forced single global "Wave Payment Account" pick.
    var setRes = await db.from('wave_business_settings').select('default_payment_account_id, default_payment_account_name').eq('wave_business_id', waveBusinessId);
    var settings = (setRes && setRes.data && setRes.data.length) ? setRes.data[0] : null;
    var globalPayAcct = settings ? settings.default_payment_account_id : null;
    var globalPayName = settings ? settings.default_payment_account_name : null;
    var payMask = null;
    if (payBtAccountId) {
      var pmRes = await db.from('plaid_accounts').select('mask').eq('plaid_account_id', payBtAccountId).limit(1);
      payMask = (pmRes && pmRes.data && pmRes.data.length && pmRes.data[0].mask) ? String(pmRes.data[0].mask) : null;
    }
    var payCatsRes = await db.from('wave_categories').select('*').eq('wave_business_id', waveBusinessId);
    var payResolved = resolveWaveBankAnchor({ waveBankAccts: waveBankCashCandidates((payCatsRes && payCatsRes.data) || []), txnMask: payMask, globalAcct: globalPayAcct, globalName: globalPayName });
    var paymentAccountId = payResolved.acct;
    if (!paymentAccountId) { return blocked('No Wave bank/deposit account could be resolved for this payment. Set a default in Wave Sync > Settings, or add a Wave Cash/Bank account matching this deposit\x27s bank.', 400, { needs_payment_account: true }); }
    // v55.83-MP — Max directive: do NOT block on the per-account "feed owner" firewall. The owner explicitly
    // accepts that a payment may double a Wave-fed deposit; the priority is that pushes ALWAYS go through.
    // The feed-owner setting still exists (informational) but no longer blocks. (Was the MC firewall here.)

    var amount = Number(pay.amount) || 0;
    if (!(amount > 0)) { return blocked('Payment amount must be positive.', 400); }
    var paymentDate = pay.payment_date;
    if (!paymentDate) { return blocked('Payment date is required.', 400); }

    var paymentMethod = body.payment_method || 'OTHER';
    // v55.83-IM (QA fix) — exchange_rate was passed to Wave verbatim if the caller supplied it, with
    // no validation. A bad/negative/non-numeric rate would post a WRONG amount to real books. Default
    // to 1 and reject anything that isn't a positive finite number.
    var exchangeRate = 1;
    if (body.exchange_rate != null) {
      var erNum = Number(body.exchange_rate);
      if (!isFinite(erNum) || erNum <= 0) { return blocked('Invalid exchange_rate: must be a positive number.', 400); }
      exchangeRate = erNum;
    }

    // Accounting-grade context for the sync log: resolve invoice number + customer identity.
    var invoiceNumber = null;
    var custWaveId = pay.wave_customer_id || null;
    var invDraftBlocked = false;
    var invSilo = null;
    if (pay.accounting_invoice_id) {
      var invMeta = await db.from('accounting_invoices').select('invoice_number, wave_customer_id, wave_status, wave_sync_status, wave_business_id').eq('id', pay.accounting_invoice_id);
      var invMetaRow = (invMeta && invMeta.data && invMeta.data.length) ? invMeta.data[0] : null;
      if (invMetaRow) {
        invoiceNumber = invMetaRow.invoice_number || null;
        if (!custWaveId) { custWaveId = invMetaRow.wave_customer_id || null; }
        invSilo = invMetaRow.wave_business_id || null;
        if (invMetaRow.wave_status === 'DRAFT' || invMetaRow.wave_sync_status === 'pushed_draft') { invDraftBlocked = true; }
      }
    }
    // v55.83-GE — SILO GUARD: never push a payment whose invoice (or payment row) belongs to a
    // DIFFERENT Wave business than the requested one. Defense beyond the approved-business check.
    if (invSilo && invSilo !== waveBusinessId) {
      return blocked('This payment\'s invoice belongs to a different Wave business than the selected one - cannot push across silos.', 400);
    }
    if (pay.wave_business_id && pay.wave_business_id !== waveBusinessId) {
      return blocked('This payment belongs to a different Wave business than the selected one - cannot push across silos.', 400);
    }
    // v55.83-IN — Wave refuses payments on DRAFT invoices. Instead of blocking and making the user
    // go approve the invoice by hand, AUTO-APPROVE it in Wave first (status-only invoiceApprove),
    // then continue with the payment. Only fall back to a block if approval itself fails.
    if (invDraftBlocked) {
      var apprOk = false;
      var apprResp = null;
      try {
        var apprMut = 'mutation($input: InvoiceApproveInput!){ invoiceApprove(input:$input){ didSucceed inputErrors{ message path code } invoice{ id status } } }';
        apprResp = await gql(token, apprMut, { input: { invoiceId: invWaveId } });
        var ia = apprResp && apprResp.data && apprResp.data.invoiceApprove;
        if (ia && ia.didSucceed) {
          apprOk = true;
          var apprStatus = (ia.invoice && ia.invoice.status) ? ia.invoice.status : 'SAVED';
          try { await db.from('accounting_invoices').update({ wave_status: apprStatus, wave_sync_status: 'synced' }).eq('id', pay.accounting_invoice_id); } catch (eUpd) {}
        }
      } catch (eAppr) { apprResp = { error: (eAppr && eAppr.message) || String(eAppr) }; }
      try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: pay.accounting_invoice_id, wave_record_id: invWaveId, action: 'approve', dry_run: false, success: apprOk, error_message: apprOk ? null : 'Auto-approve before payment push did not succeed', response_payload: apprResp, attempted_by: by }); } catch (eLog) {}
      if (!apprOk) {
        return blocked('Payment cannot be pushed: the Wave invoice is DRAFT and auto-approve did not succeed. Use "Approve in Wave" on the invoice row (or approve it in Wave), then retry.', 200, null, { approve_failed: true, invoice_approve_response: apprResp });
      }
    }
    var customerName = null;
    if (pay.accounting_customer_id) {
      var custRes = await db.from('accounting_customers').select('company_name, name, wave_customer_id').eq('id', pay.accounting_customer_id);
      var custRow = (custRes && custRes.data && custRes.data.length) ? custRes.data[0] : null;
      if (custRow) { customerName = custRow.company_name || custRow.name || null; if (!custWaveId) { custWaveId = custRow.wave_customer_id || null; } }
    }
    logCtx = {
      api_build_marker: API_BUILD_MARKER,
      route: API_ROUTE,
      hub_payment_id: hubId,
      accounting_invoice_id: pay.accounting_invoice_id || null,
      invoice_number: invoiceNumber,
      wave_invoice_id: invWaveId,
      accounting_customer_id: pay.accounting_customer_id || null,
      customer_name: customerName,
      wave_customer_id: custWaveId,
      amount: amount,
      payment_date: paymentDate,
      source: pay.source || null,
      bank_transaction_id: pay.bank_transaction_id || null,
      payment_match_id: pay.payment_match_id || null,
      payment_account_id: paymentAccountId,
      payment_account_name: settings ? (settings.default_payment_account_name || null) : null,
      sync_status_before: pay.sync_status || null
    };

    var inputObj = {
      invoiceId: invWaveId,
      paymentAccountId: paymentAccountId,
      amount: String(amount),
      paymentDate: paymentDate,
      paymentMethod: paymentMethod,
      exchangeRate: String(exchangeRate)
    };

    // DRY RUN: do not send to Wave. Report exactly what would be sent.
    if (isDry) {
      return NextResponse.json({ ok: true, dry_run: true, would_send: inputObj, api_build_marker: API_BUILD_MARKER });
    }

    // Idempotency: claim this row as 'syncing' ONLY if it is still pending and unsynced. If
    // another request already moved it (double-click / concurrent push), abort without sending.
    var claim = await db.from('accounting_invoice_payments')
      .update({ sync_status: 'syncing' })
      .eq('id', hubId)
      .is('wave_payment_id', null)
      .in('sync_status', ['pending_wave_sync', 'manual_wave_action_required', 'payment_schema_pending', 'sync_failed', 'failed'])
      .select();
    if (!(claim && claim.data && claim.data.length)) {
      return blocked('Payment is already syncing or no longer pending (it may have been pushed already). Refresh and check.', 409, null, { sync_status_after: 'syncing' });
    }

    var mutation = 'mutation($input: InvoicePaymentCreateManualInput!){ invoicePaymentCreateManual(input:$input){ didSucceed inputErrors{ message code path } invoicePayment{ id } } }';
    var resp = await gql(token, mutation, { input: inputObj });

    // Top-level GraphQL errors (e.g. invalid enum) — surface accepted values when possible.
    if (resp && resp.errors && resp.errors.length) {
      var msgs = [];
      var ei;
      for (ei = 0; ei < resp.errors.length; ei++) { msgs.push(resp.errors[ei].message); }
      var joined = msgs.join(' | ');
      try { await db.from('accounting_invoice_payments').update({ sync_status: 'sync_failed', sync_error: joined }).eq('id', hubId); } catch (e1) {}
      try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'payment', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: joined, request_payload: logCtx, response_payload: buildLogPayload(logCtx, { error: joined, wave_errors: resp.errors, sync_status_after: 'sync_failed' }), attempted_by: by }); } catch (e2) {}
      return NextResponse.json({ ok: false, error: joined, wave_errors: resp.errors, api_build_marker: API_BUILD_MARKER }, { status: 200 });
    }

    var result = resp && resp.data && resp.data.invoicePaymentCreateManual;
    var didSucceed = result && result.didSucceed === true;
    var inputErrors = (result && result.inputErrors) || [];

    if (!didSucceed || (inputErrors && inputErrors.length)) {
      var ieMsgs = [];
      var ii;
      for (ii = 0; ii < inputErrors.length; ii++) { ieMsgs.push(inputErrors[ii].message + (inputErrors[ii].path ? (' [' + inputErrors[ii].path + ']') : '')); }
      var ieJoined = ieMsgs.length ? ieMsgs.join(' | ') : 'Wave did not confirm the payment (didSucceed false).';
      try { await db.from('accounting_invoice_payments').update({ sync_status: 'sync_failed', sync_error: ieJoined }).eq('id', hubId); } catch (e3) {}
      try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'payment', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: ieJoined, request_payload: logCtx, response_payload: buildLogPayload(logCtx, { error: ieJoined, input_errors: inputErrors, sync_status_after: 'sync_failed' }), attempted_by: by }); } catch (e4) {}
      return NextResponse.json({ ok: false, error: ieJoined, input_errors: inputErrors, api_build_marker: API_BUILD_MARKER }, { status: 200 });
    }

    // Success — save the REAL wave_payment_id, never a fake one.
    var wavePaymentId = result.invoicePayment && result.invoicePayment.id ? result.invoicePayment.id : null;
    if (!wavePaymentId) {
      // Succeeded but no id returned — do NOT fabricate one; flag for review.
      try { await db.from('accounting_invoice_payments').update({ sync_status: 'sync_failed', sync_error: 'Wave reported success but returned no payment id.' }).eq('id', hubId); } catch (e5) {}
      try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'payment', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: 'Wave reported success but returned no payment id.', request_payload: logCtx, response_payload: buildLogPayload(logCtx, { error: 'Wave reported success but returned no payment id.', sync_status_after: 'sync_failed' }), attempted_by: by }); } catch (e5b) {}
      return NextResponse.json({ ok: false, error: 'Wave reported success but returned no payment id.', api_build_marker: API_BUILD_MARKER }, { status: 200 });
    }

    // v55.83-IM (QA fix) — Wave has now recorded a REAL payment. The write-back below is the ONLY
    // place wave_payment_id gets stored on the Hub row. Supabase resolves with {error} (no throw),
    // so the old try/catch was a no-op and a failed write-back returned ok:true with the row left in
    // 'syncing' and NO wave_payment_id — an orphaned Wave payment that a later retry could DUPLICATE.
    // Check the error; retry once storing at least the id (so the dup-guard at the top blocks
    // re-push); if it still fails, surface a manual-reconcile state instead of false success.
    var wb = await db.from('accounting_invoice_payments').update({ wave_payment_id: wavePaymentId, sync_status: 'synced', last_synced_at: new Date().toISOString(), sync_error: null }).eq('id', hubId);
    if (wb && wb.error) {
      var wb2 = await db.from('accounting_invoice_payments').update({ wave_payment_id: wavePaymentId, sync_status: 'synced' }).eq('id', hubId);
      if (wb2 && wb2.error) {
        var reconMsg = 'PAYMENT POSTED TO WAVE (id=' + wavePaymentId + ') BUT THE HUB WRITE-BACK FAILED: ' + ((wb2.error && wb2.error.message) || 'unknown') + '. Do NOT re-push this payment — reconcile manually (set wave_payment_id=' + wavePaymentId + ' on Hub payment ' + hubId + ').';
        try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'payment', hub_record_id: hubId, wave_record_id: wavePaymentId, action: 'push', dry_run: false, success: false, error_message: reconMsg, request_payload: logCtx, response_payload: buildLogPayload(logCtx, { wave_payment_id: wavePaymentId, writeback_error: wb2.error, sync_status_after: 'syncing' }), attempted_by: by }); } catch (e6b) {}
        return NextResponse.json({ ok: false, manual_reconcile: true, wave_payment_id: wavePaymentId, error: reconMsg, api_build_marker: API_BUILD_MARKER }, { status: 200 });
      }
    }

    // Recompute the Hub invoice so amount_paid/balance/status reflect the now-synced payment.
    if (pay.accounting_invoice_id) {
      try {
        var allPays = await db.from('accounting_invoice_payments').select('amount, voided, sync_status').eq('accounting_invoice_id', pay.accounting_invoice_id);
        var invR = await db.from('accounting_invoices').select('total_amount, wave_imported_paid').eq('id', pay.accounting_invoice_id);
        // v55.83-JP (audit) — if EITHER read failed, do NOT write a recomputed balance from a partial
        // result (that would undercount paid and corrupt the canonical balance). The payment is already
        // in Wave; skip the recompute and flag it so the row is reconciled rather than written wrong.
        if ((allPays && allPays.error) || (invR && invR.error)) {
          try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'payment', hub_record_id: hubId, action: 'recompute_skipped', dry_run: false, success: false, error_message: 'Balance recompute skipped after push — read failed: ' + (((allPays && allPays.error) || {}).message || ((invR && invR.error) || {}).message || 'unknown'), attempted_by: by }); } catch (eLg) {}
        } else {
          var invD = (invR && invR.data && invR.data.length) ? invR.data[0] : null;
          if (invD) {
            var total = Number(invD.total_amount) || 0;
            var paid = Number(invD.wave_imported_paid) || 0;
            var rows = (allPays && allPays.data) || [];
            var ri;
            for (ri = 0; ri < rows.length; ri++) {
              var rr = rows[ri];
              var isVoid = (rr.voided === true) || (rr.sync_status === 'void' || rr.sync_status === 'voided' || rr.sync_status === 'cancelled' || rr.sync_status === 'reversed' || rr.sync_status === 'deleted');
              if (!isVoid) { paid = paid + (Number(rr.amount) || 0); }
            }
            paid = Math.round(paid * 100) / 100;
            var bal = Math.round(Math.max(0, total - paid) * 100) / 100;
            var st = paid <= 0.0001 ? 'unpaid' : (bal <= 0.0001 ? 'paid' : 'partial');
            // v55.83-JP (audit) — scope the update by silo too, so a malformed id can't touch another silo's invoice.
            var invUpdQ = db.from('accounting_invoices').update({ amount_paid: paid, balance_due: bal, payment_status: st }).eq('id', pay.accounting_invoice_id);
            if (waveBusinessId) { invUpdQ = invUpdQ.eq('wave_business_id', waveBusinessId); }
            await invUpdQ;
          }
        }
      } catch (eRecomp) {}
    }
    try {
      await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'payment', hub_record_id: hubId, action: 'push', dry_run: false, success: true, request_payload: logCtx, response_payload: buildLogPayload(logCtx, { wave_payment_id: wavePaymentId, sync_status_after: 'synced' }), attempted_by: by });
    } catch (e7) {}

    return NextResponse.json({ ok: true, synced: true, wave_payment_id: wavePaymentId, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    var errMsg = (e && e.message) || String(e);
    try {
      if (typeof hubId !== 'undefined' && hubId) {
        await db.from('accounting_invoice_payments')
          .update({ sync_status: 'sync_failed', sync_error: errMsg })
          .eq('id', hubId)
          .eq('sync_status', 'syncing');
      }
    } catch (eReset) {}
    try {
      await db.from('wave_sync_log').insert({
        wave_business_id: (typeof waveBusinessId !== 'undefined' ? waveBusinessId : null),
        entity_type: 'payment',
        hub_record_id: (typeof hubId !== 'undefined' ? hubId : null),
        action: 'push',
        dry_run: (typeof isDry !== 'undefined' ? !!isDry : false),
        success: false,
        error_message: errMsg,
        request_payload: (typeof logCtx !== 'undefined' && logCtx) ? logCtx : { api_build_marker: API_BUILD_MARKER, route: API_ROUTE, payment: { hub_payment_id: (typeof hubId !== 'undefined' ? hubId : null) } },
        response_payload: (typeof logCtx !== 'undefined' && logCtx) ? buildLogPayload(logCtx, { error: errMsg, sync_status_after: 'sync_failed' }) : { api_build_marker: API_BUILD_MARKER, route: API_ROUTE, error: errMsg },
        attempted_by: (typeof by !== 'undefined' ? by : null)
      });
    } catch (eLogCatch) {}
    return NextResponse.json({ ok: false, error: errMsg, api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
