// /api/wave/replace-invoice — v55.83-NA (Max Aug 11 2026): "I want to amend this
// invoice as there was a mistake. currently we cannot amend. I need to be able to
// amend then push it through again so it updates wave without affecting anything
// else."
//
// WHY THIS ROUTE EXISTS
// Wave's public GraphQL API has NO invoiceUpdate mutation. The only way to make
// an already-pushed invoice match its amended Hub copy is: delete the Wave copy,
// then create a fresh one from the current Hub data. push-invoice-v2 hard-blocks
// any record that already has a wave_invoice_id (correctly — that guard prevents
// duplicates), so amend-and-re-push was impossible.
//
// WHAT THIS ROUTE DOES (deliberately only half the job):
//   1. Every safety gate below, then Wave invoiceDelete on the OLD Wave copy.
//   2. On confirmed delete: null out wave_invoice_id on the Hub row and set
//      wave_sync_status='pending_sync'.
// It does NOT create the new Wave invoice. The client immediately calls the
// existing /api/wave/push-invoice-v2, which now passes its own guard because
// wave_invoice_id is null. That route owns product mapping, the currency
// guarantee, DRAFT auto-approve and read-back — duplicating all of that here
// would be a second source of truth that drifts (the exact failure mode the
// Wave PERMANENT RULE exists to prevent).
//
// IF STEP 2 (the re-push) FAILS: the Hub row is truthful — the invoice really is
// not in Wave any more, it shows as pending_sync in the Sync Center, and a
// normal push recovers it. At no point can there be TWO copies in Wave.
//
// PAYMENT SAFETY — the reason most replace attempts should be blocked:
// deleting a Wave invoice that has payments recorded against it either fails in
// Wave or strands the payment. If ANY Hub payment on this invoice has a
// wave_payment_id, the replace is refused with the exact next step. This is
// money — no automation deletes payments.
//
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business-shared';

var API_BUILD_MARKER = 'v55.83-NA-replace-invoice';
var API_ROUTE = '/api/wave/replace-invoice';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function logSync(db, row) { return db.from('wave_sync_log').insert(row).then(function () {}).catch(function () {}); }

// Mirror of push-invoice-v2 canPush, with the wave_invoice_id test INVERTED:
// replace requires the Wave copy to EXIST. Everything else (silo binding,
// production locks, writes/push flags, approval) is identical on purpose — an
// amend must clear every bar a fresh push would.
function canReplace(reg, record, waveBusinessId, dryRun) {
  if (!waveBusinessId) { return { ok: false, message: 'No accounting silo selected.' }; }
  if (isPlaceholderWaveBusiness(waveBusinessId)) { return { ok: false, message: 'This silo is not connected to a real Wave business yet (placeholder id). Bind it under Accounting -> Wave Connection first.' }; }
  if (!reg) { return { ok: false, message: 'This Wave business is not registered.' }; }
  var APPROVED = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';
  if (dryRun !== true && waveBusinessId !== APPROVED && !(reg.is_production !== false && reg.production_push_unlocked === true)) { return { ok: false, message: 'Replace blocked: target Wave business is not the approved test business and is not an unlocked production business.' }; }
  if (!record || !record.wave_business_id) { return { ok: false, message: 'Invoice is not assigned to a silo.' }; }
  if (record.wave_business_id !== waveBusinessId) { return { ok: false, message: 'Invoice belongs to a different silo.' }; }
  if (!record.wave_invoice_id) { return { ok: false, message: 'This invoice has no Wave copy to replace — use the normal Push instead.' }; }
  if (record.source === 'wave_import' || record.is_historical === true) { return { ok: false, message: 'This invoice was imported FROM Wave. Amend it in Wave itself, then re-import — the Hub will not delete a Wave-authored invoice.' }; }
  if (record.approval_status !== 'approved') { return { ok: false, message: 'Approve the amended invoice in the Hub first, then update Wave.' }; }
  if (reg.writes_enabled !== true) { return { ok: false, message: 'Writes are disabled for ' + (reg.label || waveBusinessId) + '.' }; }
  if (reg.allow_invoice_push !== true) { return { ok: false, message: 'Invoice push is not enabled for ' + (reg.label || waveBusinessId) + '.' }; }
  if (reg.is_production !== false && reg.production_push_unlocked !== true) {
    return { ok: false, message: 'Production push is locked. A super admin must enable real production push for ' + (reg.label || waveBusinessId) + '.' };
  }
  return { ok: true };
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var waveBusinessId = body.wave_business_id;
    var hubId = body.hub_record_id;
    var dryRun = body.dry_run === true;
    var by = body.user_id || null;

    var _gate = await assertPermission(db, by, 'wave.invoices.push', req);
    if (!_gate.ok) { return NextResponse.json({ ok: false, error: _gate.error }, { status: _gate.status }); }
    if (!waveBusinessId || !hubId) { return NextResponse.json({ error: 'wave_business_id and hub_record_id are required.' }, { status: 400 }); }
    // Deleting a live accounting record is not a default anyone should stumble
    // into: the caller must say so explicitly.
    if (dryRun !== true && body.confirm_replace !== true) {
      return NextResponse.json({ error: 'confirm_replace:true is required — this deletes the old Wave copy before recreating it.', blocked: true }, { status: 400 });
    }

    var regRes = await db.from('wave_business_registry').select('*').eq('wave_business_id', waveBusinessId).single();
    var reg = regRes && regRes.data;
    var invRes = await db.from('accounting_invoices').select('*').eq('id', hubId).single();
    var inv = invRes && invRes.data;
    if (!inv) { return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 }); }

    var invLogCtx = { invoice_number: inv.invoice_number, customer_name: null, amount: inv.total_amount };
    function logInv(row) { try { row.request_payload = Object.assign({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, invLogCtx, row.request_payload || {}); } catch (e) {} return logSync(db, row); }

    var verdict = canReplace(reg, inv, waveBusinessId, dryRun);
    if (!verdict.ok) {
      await logInv({ wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: inv.wave_invoice_id || null, action: 'replace_delete', dry_run: dryRun, success: false, error_message: verdict.message, attempted_by: by });
      return NextResponse.json({ error: verdict.message, blocked: true }, { status: 409 });
    }

    // ── PAYMENT GUARD — the line that must never be crossed automatically ──
    // Any payment already pushed to Wave for this invoice makes delete unsafe:
    // Wave will either refuse the delete or orphan the payment. Name each one
    // and stop.
    var payRes = await db.from('accounting_invoice_payments')
      .select('id, amount, payment_date, wave_payment_id')
      .eq('accounting_invoice_id', hubId)
      .not('wave_payment_id', 'is', null);
    var wavePays = (payRes && payRes.data) || [];
    if (wavePays.length > 0) {
      var pParts = []; var pi;
      for (pi = 0; pi < wavePays.length; pi++) { pParts.push((wavePays[pi].payment_date || '?') + ' for ' + (wavePays[pi].amount != null ? wavePays[pi].amount : '?')); }
      var payMsg = 'Cannot update this invoice in Wave: ' + wavePays.length + ' payment(s) are already recorded against the Wave copy (' + pParts.join('; ') + '). Delete those payments inside Wave first (Wave keeps their history), then retry — the Hub will never delete payments for you.';
      await logInv({ wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: inv.wave_invoice_id, action: 'replace_delete', dry_run: dryRun, success: false, error_message: payMsg, response_payload: { reason: 'wave_payments_exist', wave_payment_count: wavePays.length }, attempted_by: by });
      return NextResponse.json({ error: payMsg, blocked: true, reason: 'wave_payments_exist', wave_payment_count: wavePays.length }, { status: 409 });
    }

    if (dryRun) {
      await logInv({ wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: inv.wave_invoice_id, action: 'replace_delete', dry_run: true, success: true, attempted_by: by });
      return NextResponse.json({ dry_run: true, ok: true, api_build_marker: API_BUILD_MARKER, route: API_ROUTE, would_do: { delete_wave_invoice: inv.wave_invoice_id, then: 'unlink + pending_sync, client re-pushes via /api/wave/push-invoice-v2', invoice_number: inv.invoice_number } });
    }

    var token = process.env.WAVE_ACCESS_TOKEN;
    if (!token) { return NextResponse.json({ error: 'No Wave token configured (WAVE_ACCESS_TOKEN).' }, { status: 400 }); }

    // ── Wave invoiceDelete — same envelope as invoiceApprove ──
    var delMut = 'mutation($input: InvoiceDeleteInput!){ invoiceDelete(input:$input){ didSucceed inputErrors{ message code path } } }';
    var delVars = { input: { invoiceId: inv.wave_invoice_id } };
    var resp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: delMut, variables: delVars }) });
    var data = await resp.json();
    if (data && typeof data === 'object') { data.api_build_marker = API_BUILD_MARKER; data.route = API_ROUTE; }
    var idl = data && data.data && data.data.invoiceDelete;
    var delOk = !!(idl && idl.didSucceed);

    // Surface Wave's real reason, mirroring push-invoice-v2's error assembly.
    var _parts = []; var _i;
    if (data && data.errors && data.errors.length) { for (_i = 0; _i < data.errors.length; _i++) { if (data.errors[_i] && data.errors[_i].message) { _parts.push(data.errors[_i].message); } } }
    if (idl && idl.inputErrors && idl.inputErrors.length) { for (_i = 0; _i < idl.inputErrors.length; _i++) { var _e = idl.inputErrors[_i]; if (_e && _e.message) { _parts.push(_e.message + (_e.path ? (' [' + (Array.isArray(_e.path) ? _e.path.join('.') : _e.path) + ']') : '')); } } }
    var delReason = _parts.length ? _parts.join(' | ') : (resp.ok ? 'Wave reported didSucceed=false with no error detail.' : ('HTTP ' + resp.status));

    if (!delOk) {
      // Nothing changed anywhere — the old Wave copy still stands, the Hub link
      // still stands. Fully safe to retry after fixing the reason.
      await logInv({ wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: inv.wave_invoice_id, action: 'replace_delete', dry_run: false, request_payload: { query: delMut, variables: delVars }, response_payload: data, success: false, error_message: delReason, attempted_by: by });
      return NextResponse.json({ error: 'Wave refused to delete the old copy: ' + delReason + ' — nothing was changed; the Wave invoice and the Hub link are both intact.', response: data, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 502 });
    }

    // Delete confirmed. Make the Hub truthful IMMEDIATELY: the invoice is no
    // longer in Wave. Keep the old id in wave_replaced_from for the audit trail.
    var oldWaveId = inv.wave_invoice_id;
    var updRes = await db.from('accounting_invoices')
      .update({ wave_invoice_id: null, wave_status: null, wave_sync_status: 'pending_sync' })
      .eq('id', hubId)
      .eq('wave_invoice_id', oldWaveId); // guard against a concurrent relink
    var updErr = updRes && updRes.error ? (updRes.error.message || String(updRes.error)) : null;

    await logInv({ wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: oldWaveId, action: 'replace_delete', dry_run: false, request_payload: { query: delMut, variables: delVars }, response_payload: data, success: true, error_message: updErr ? ('Wave copy deleted but Hub unlink failed: ' + updErr + ' — run replace again or clear wave_invoice_id manually.') : null, attempted_by: by });

    if (updErr) {
      return NextResponse.json({ ok: false, deleted_in_wave: true, error: 'The old Wave copy was deleted, but the Hub could not unlink it (' + updErr + '). Do NOT create the invoice manually in Wave — retry the update from the Hub.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deleted_in_wave: true, old_wave_invoice_id: oldWaveId, next: 'push', message: 'Old Wave copy deleted and unlinked. Now push the invoice to create the amended copy.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'replace-invoice failed', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 500 });
  }
}
