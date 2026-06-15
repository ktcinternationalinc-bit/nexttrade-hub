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

var WAVE_URL = 'https://gql.waveapps.com/graphql/public';
var APPROVED_PUSH_BUSINESS_ID = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';
var API_BUILD_MARKER = 'v55.83-FL-push-payment-real';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function gql(token, query, variables) {
  return fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: query, variables: variables || {} }) }).then(function (r) { return r.json(); });
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

    // SECURITY: this route uses the service role, so it MUST verify the caller has the
    // specific permission server-side. super_admin resolves to all permissions; other users
    // need wave.payments.push (via grant or role). CRON bearer bypasses for scheduled use.
    var _perm = await assertPermission(db, by, 'wave.payments.push', req);
    if (!_perm.ok) { return NextResponse.json({ ok: false, error: _perm.error, api_build_marker: API_BUILD_MARKER }, { status: _perm.status }); }

    if (!token) { return NextResponse.json({ ok: false, error: 'Wave token not configured.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (!hubId) { return NextResponse.json({ ok: false, error: 'No payment row id provided.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    // Hard guard: only the approved (KANDIL EGYPT) business may receive pushes.
    if (waveBusinessId !== APPROVED_PUSH_BUSINESS_ID) {
      return NextResponse.json({ ok: false, error: 'Payment push is only allowed to the approved Wave business.', api_build_marker: API_BUILD_MARKER }, { status: 403 });
    }

    // Load the payment row.
    var payRes = await db.from('accounting_invoice_payments').select('*').eq('id', hubId);
    var pay = (payRes && payRes.data && payRes.data.length) ? payRes.data[0] : null;
    if (!pay) { return NextResponse.json({ ok: false, error: 'Payment row not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
    if (pay.voided === true || pay.sync_status === 'void') { return NextResponse.json({ ok: false, error: 'Payment is voided.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (pay.wave_payment_id) { return NextResponse.json({ ok: false, error: 'Payment already pushed (has wave_payment_id).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    // Resolve invoiceId (Wave) — from the payment row, else its invoice.
    var invWaveId = pay.wave_invoice_id || null;
    if (!invWaveId && pay.accounting_invoice_id) {
      var invRes = await db.from('accounting_invoices').select('wave_invoice_id, wave_business_id').eq('id', pay.accounting_invoice_id);
      var invRow = (invRes && invRes.data && invRes.data.length) ? invRes.data[0] : null;
      if (invRow) { invWaveId = invRow.wave_invoice_id || null; }
    }
    if (!invWaveId) { return NextResponse.json({ ok: false, error: 'Invoice is not in Wave yet (no wave_invoice_id). Push the invoice first.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    // Verify the bank transaction still exists (orphan guard) unless it was a manual payment.
    if (pay.bank_transaction_id) {
      var btRes = await db.from('bank_transactions').select('id').eq('id', pay.bank_transaction_id);
      if (!(btRes && btRes.data && btRes.data.length)) {
        return NextResponse.json({ ok: false, error: 'Bank deposit for this payment no longer exists (orphaned). Void it instead of pushing.', api_build_marker: API_BUILD_MARKER }, { status: 400 });
      }
    }

    // paymentAccountId from per-business settings.
    var setRes = await db.from('wave_business_settings').select('default_payment_account_id, default_payment_account_name').eq('wave_business_id', waveBusinessId);
    var settings = (setRes && setRes.data && setRes.data.length) ? setRes.data[0] : null;
    var paymentAccountId = settings ? settings.default_payment_account_id : null;
    if (!paymentAccountId) { return NextResponse.json({ ok: false, error: 'No Wave payment account configured for this business. Set one in Wave Sync > Settings > Wave Payment Account.', api_build_marker: API_BUILD_MARKER, needs_payment_account: true }, { status: 400 }); }

    var amount = Number(pay.amount) || 0;
    if (!(amount > 0)) { return NextResponse.json({ ok: false, error: 'Payment amount must be positive.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    var paymentDate = pay.payment_date;
    if (!paymentDate) { return NextResponse.json({ ok: false, error: 'Payment date is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    var paymentMethod = body.payment_method || 'OTHER';
    var exchangeRate = body.exchange_rate != null ? body.exchange_rate : 1;

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
      return NextResponse.json({ ok: false, error: 'Payment is already syncing or no longer pending (it may have been pushed already). Refresh and check.', api_build_marker: API_BUILD_MARKER }, { status: 409 });
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
      try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'payment', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: joined, attempted_by: by }); } catch (e2) {}
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
      try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'payment', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: ieJoined, attempted_by: by }); } catch (e4) {}
      return NextResponse.json({ ok: false, error: ieJoined, input_errors: inputErrors, api_build_marker: API_BUILD_MARKER }, { status: 200 });
    }

    // Success — save the REAL wave_payment_id, never a fake one.
    var wavePaymentId = result.invoicePayment && result.invoicePayment.id ? result.invoicePayment.id : null;
    if (!wavePaymentId) {
      // Succeeded but no id returned — do NOT fabricate one; flag for review.
      try { await db.from('accounting_invoice_payments').update({ sync_status: 'sync_failed', sync_error: 'Wave reported success but returned no payment id.' }).eq('id', hubId); } catch (e5) {}
      return NextResponse.json({ ok: false, error: 'Wave reported success but returned no payment id.', api_build_marker: API_BUILD_MARKER }, { status: 200 });
    }

    try {
      await db.from('accounting_invoice_payments').update({ wave_payment_id: wavePaymentId, sync_status: 'synced', last_synced_at: new Date().toISOString(), sync_error: null }).eq('id', hubId);
    } catch (e6) {}

    // Recompute the Hub invoice so amount_paid/balance/status reflect the now-synced payment.
    if (pay.accounting_invoice_id) {
      try {
        var allPays = await db.from('accounting_invoice_payments').select('amount, voided, sync_status').eq('accounting_invoice_id', pay.accounting_invoice_id);
        var invR = await db.from('accounting_invoices').select('total_amount, wave_imported_paid').eq('id', pay.accounting_invoice_id);
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
          await db.from('accounting_invoices').update({ amount_paid: paid, balance_due: bal, payment_status: st }).eq('id', pay.accounting_invoice_id);
        }
      } catch (eRecomp) {}
    }
    try {
      await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'payment', hub_record_id: hubId, action: 'push', dry_run: false, success: true, response_payload: { wave_payment_id: wavePaymentId, amount: amount }, attempted_by: by });
    } catch (e7) {}

    return NextResponse.json({ ok: true, synced: true, wave_payment_id: wavePaymentId, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
