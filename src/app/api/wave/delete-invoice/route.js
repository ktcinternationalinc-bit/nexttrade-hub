// /api/wave/delete-invoice — v55.83-NC (Max Aug 11 2026): "Can we actually
// delete an invoice from the accounting side that will then delete from wave"
//
// Before this route, an invoice with a Wave copy could not be deleted from the
// Hub AT ALL — record-lifecycle treats wave_invoice_id as a hard-delete blocker
// (correctly: a plain Hub delete would leave a live Wave invoice with no owner,
// billing a customer for a record the Hub no longer knows about).
//
// ORDER OF OPERATIONS — Wave FIRST, Hub second, and the reason matters:
//   1. Wave invoiceDelete. If Wave refuses → STOP, nothing changed anywhere.
//   2. Unlink the Hub row immediately (truthful even if step 3 dies).
//   3. Hub cascade: payments (unpushed only — pushed ones blocked earlier),
//      then line items, then the invoice row.
// If it ran the other way, a Wave refusal would leave the Hub record gone and
// the Wave invoice alive — the exact orphan the lifecycle blocker exists to
// prevent. This way the worst crash outcome is a Hub invoice with no Wave
// copy, which the normal lifecycle Delete can finish off.
//
// MONEY GUARD (same line as replace-invoice): any payment already pushed to
// Wave blocks the whole delete. The Hub never deletes payments in Wave.
// Wave-imported invoices are refused — the Hub never deletes a Wave-authored
// record; delete it in Wave and re-import.
//
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission, loadUserPermissions } from '../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../lib/verified-caller'; // v55.83-UM
import { canDeleteInvoices, INVOICE_DELETE_DENIED, lifecycleRefusal, LIFECYCLE_SQL_MISSING } from '../../../../lib/invoice-delete-access'; // v55.83-UM
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business-shared';

var API_BUILD_MARKER = 'v55.83-NC-delete-invoice';
var API_ROUTE = '/api/wave/delete-invoice';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function logSync(db, row) { return db.from('wave_sync_log').insert(row).then(function () {}).catch(function () {}); }

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var waveBusinessId = body.wave_business_id;
    var hubId = body.hub_record_id;
    // v55.83-UM — the verified signed-in person (never a user id sent by the browser) and the invoice-delete rule
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return NextResponse.json({ ok: false, error: who.error }, { status: who.status || 401 }); }
    var by = who.userId;
    var _ctxD = await loadUserPermissions(db, by);
    if (!canDeleteInvoices(_ctxD.isSuperAdmin, _ctxD.mp, _ctxD.deny)) { return NextResponse.json({ ok: false, error: INVOICE_DELETE_DENIED }, { status: 403 }); }

    var _gate = await assertPermission(db, by, 'wave.invoices.push', req);
    if (!_gate.ok) { return NextResponse.json({ ok: false, error: _gate.error }, { status: _gate.status }); }
    if (!hubId) { return NextResponse.json({ error: 'hub_record_id is required.' }, { status: 400 }); }
    if (body.confirm_delete !== true) {
      return NextResponse.json({ error: 'confirm_delete:true is required — this permanently deletes the invoice from Wave AND the Hub.', blocked: true }, { status: 400 });
    }

    var invRes = await db.from('accounting_invoices').select('*').eq('id', hubId).single();
    var inv = invRes && invRes.data;
    if (!inv) { return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 }); }

    var invLogCtx = { invoice_number: inv.invoice_number, customer_name: null, amount: inv.total_amount };
    function logInv(row) { try { row.request_payload = Object.assign({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, invLogCtx, row.request_payload || {}); } catch (e) {} return logSync(db, row); }

    // The Hub never deletes a Wave-authored record.
    if (inv.source === 'wave_import' || inv.is_historical === true) {
      var msgImp = 'This invoice was imported FROM Wave. Delete it inside Wave itself, then run Wave Import — the Hub mirror will drop on the next sync.';
      await logInv({ wave_business_id: waveBusinessId || inv.wave_business_id, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: inv.wave_invoice_id || null, action: 'delete', dry_run: false, success: false, error_message: msgImp, attempted_by: by });
      return NextResponse.json({ error: msgImp, blocked: true }, { status: 409 });
    }

    // ── PAYMENT GUARDS ──
    // Pushed-to-Wave payments: hard block (money in Wave is never auto-deleted).
    var wavePayRes = await db.from('accounting_invoice_payments')
      .select('id, amount, payment_date, wave_payment_id')
      .eq('accounting_invoice_id', hubId)
      .not('wave_payment_id', 'is', null);
    var wavePays = (wavePayRes && wavePayRes.data) || [];
    if (wavePays.length > 0) {
      var pp = []; var pi;
      for (pi = 0; pi < wavePays.length; pi++) { pp.push((wavePays[pi].payment_date || '?') + ' for ' + (wavePays[pi].amount != null ? wavePays[pi].amount : '?')); }
      var payMsg = 'Cannot delete: ' + wavePays.length + ' payment(s) are recorded against the Wave copy (' + pp.join('; ') + '). Delete those payments inside Wave first — the Hub will never delete payments for you.';
      await logInv({ wave_business_id: waveBusinessId || inv.wave_business_id, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: inv.wave_invoice_id, action: 'delete', dry_run: false, success: false, error_message: payMsg, response_payload: { reason: 'wave_payments_exist', wave_payment_count: wavePays.length }, attempted_by: by });
      return NextResponse.json({ error: payMsg, blocked: true, reason: 'wave_payments_exist' }, { status: 409 });
    }
    // v55.83-UM (Codex 21:35 P1; Max's rule: never delete data) — Hub payment records are NEVER deleted any more, not even with a
    // confirmation: an invoice with any payment record is voided or archived instead. Checked BEFORE anything is sent to Wave.
    var hubPayRes = await db.from('accounting_invoice_payments')
      .select('id')
      .eq('accounting_invoice_id', hubId);
    if (hubPayRes && hubPayRes.error) { return NextResponse.json({ ok: false, error: 'Could not check its payments (' + hubPayRes.error.message + ') — nothing was deleted anywhere.' }, { status: 500 }); }
    var hubPays = (hubPayRes && hubPayRes.data) || [];
    if (hubPays.length > 0) {
      return NextResponse.json({ ok: false, error: 'This invoice has ' + hubPays.length + ' Hub payment record(s). Payments are never deleted — void or archive the invoice instead. Nothing was deleted anywhere.', blocked: true, reason: 'hub_payments_block', hub_payment_count: hubPays.length }, { status: 409 });
    }
    // v55.83-UM (Codex 21:50 P1) — BEFORE anything is sent to Wave, the database step runs every check on THIS invoice for THIS person and
    // changes nothing (check_only): its state (archived / void / cancelled), payments and payment matches, imported-from-Wave, and the
    // person's business. Any blocker → zero Wave calls, zero changes. (It also proves the step is installed.)
    var pre = await db.rpc('hub_invoice_lifecycle_check', { p: { kind: 'invoice', action: 'delete', id: hubId, actor: by, is_super: _ctxD.isSuperAdmin === true, after_wave_delete: true, check_only: true } });
    if (pre.error) {
      var preMissing = /hub_invoice_lifecycle_check/.test(String(pre.error.message || '')) && /does not exist|Could not find|schema cache/i.test(String(pre.error.message || ''));
      return NextResponse.json({ ok: false, error: (preMissing ? LIFECYCLE_SQL_MISSING : 'Could not check the invoice (' + pre.error.message + ').') + ' Nothing was deleted anywhere.', blocked: true }, { status: preMissing ? 409 : 500 });
    }
    if (!pre.data || pre.data.ok !== true || pre.data.check_only !== true) {
      var preWhy = lifecycleRefusal(pre.data || {}, 'invoice', 'delete');
      return NextResponse.json({ ok: false, error: preWhy.msg + ' Nothing was deleted anywhere.', blocked: true, reason: (pre.data && pre.data.code) || 'refused' }, { status: preWhy.status });
    }

    // ── STEP 1: Wave delete (only when a Wave copy exists) ──
    var deletedInWave = false;
    var oldWaveId = inv.wave_invoice_id || null;
    if (oldWaveId) {
      if (!waveBusinessId) { return NextResponse.json({ error: 'wave_business_id is required to delete the Wave copy.' }, { status: 400 }); }
      var regRes = await db.from('wave_business_registry').select('*').eq('wave_business_id', waveBusinessId).single();
      var reg = regRes && regRes.data;
      // Same gate ladder as replace-invoice — a delete must clear every bar a push would.
      var gateMsg = null;
      if (isPlaceholderWaveBusiness(waveBusinessId)) { gateMsg = 'This silo is not connected to a real Wave business yet (placeholder id).'; }
      else if (!reg) { gateMsg = 'This Wave business is not registered.'; }
      else if (inv.wave_business_id && inv.wave_business_id !== waveBusinessId) { gateMsg = 'Invoice belongs to a different silo.'; }
      else if (reg.writes_enabled !== true) { gateMsg = 'Writes are disabled for ' + (reg.label || waveBusinessId) + '.'; }
      else if (reg.allow_invoice_push !== true) { gateMsg = 'Invoice push is not enabled for ' + (reg.label || waveBusinessId) + '.'; }
      else {
        var APPROVED = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';
        if (waveBusinessId !== APPROVED && !(reg.is_production !== false && reg.production_push_unlocked === true)) { gateMsg = 'Delete blocked: target Wave business is not the approved test business and is not an unlocked production business.'; }
        else if (reg.is_production !== false && reg.production_push_unlocked !== true) { gateMsg = 'Production push is locked. A super admin must enable real production push for ' + (reg.label || waveBusinessId) + '.'; }
      }
      if (gateMsg) {
        await logInv({ wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: oldWaveId, action: 'delete', dry_run: false, success: false, error_message: gateMsg, attempted_by: by });
        return NextResponse.json({ error: gateMsg, blocked: true }, { status: 409 });
      }

      var token = process.env.WAVE_ACCESS_TOKEN;
      if (!token) { return NextResponse.json({ error: 'No Wave token configured (WAVE_ACCESS_TOKEN).' }, { status: 400 }); }

      var delMut = 'mutation($input: InvoiceDeleteInput!){ invoiceDelete(input:$input){ didSucceed inputErrors{ message code path } } }';
      var delVars = { input: { invoiceId: oldWaveId } };
      var resp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: delMut, variables: delVars }) });
      var data = await resp.json();
      if (data && typeof data === 'object') { data.api_build_marker = API_BUILD_MARKER; data.route = API_ROUTE; }
      var idl = data && data.data && data.data.invoiceDelete;
      var delOk = !!(idl && idl.didSucceed);
      var _parts = []; var _i;
      if (data && data.errors && data.errors.length) { for (_i = 0; _i < data.errors.length; _i++) { if (data.errors[_i] && data.errors[_i].message) { _parts.push(data.errors[_i].message); } } }
      if (idl && idl.inputErrors && idl.inputErrors.length) { for (_i = 0; _i < idl.inputErrors.length; _i++) { var _e = idl.inputErrors[_i]; if (_e && _e.message) { _parts.push(_e.message); } } }
      var delReason = _parts.length ? _parts.join(' | ') : (resp.ok ? 'Wave reported didSucceed=false with no error detail.' : ('HTTP ' + resp.status));

      if (!delOk) {
        await logInv({ wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: oldWaveId, action: 'delete', dry_run: false, request_payload: { query: delMut, variables: delVars }, response_payload: data, success: false, error_message: delReason, attempted_by: by });
        return NextResponse.json({ error: 'Wave refused to delete the invoice: ' + delReason + ' — nothing was deleted anywhere.', response: data, api_build_marker: API_BUILD_MARKER }, { status: 502 });
      }
      deletedInWave = true;
      // Truthful immediately: the Wave copy is gone even if the Hub steps below fail.
      var unl = await db.from('accounting_invoices').update({ wave_invoice_id: null, wave_status: null, wave_sync_status: null }).eq('id', hubId).eq('wave_invoice_id', oldWaveId).select('id');
      var unlinked = !(unl && unl.error) && ((unl && unl.data) || []).length > 0; // UM (Codex 21:50) — only claimed when it really happened
      await logInv({ wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: oldWaveId, action: 'delete', dry_run: false, response_payload: data, success: true, attempted_by: by });
    }

    // ── STEP 2 (v55.83-UM): the Hub part in ONE locked database step — items + invoice, its bank lines back to review; payments
    // are never deleted (any payment record → refused, re-checked under the lock). All of it or none of it.
    var hubDel = await db.rpc('hub_invoice_lifecycle', { p: { kind: 'invoice', action: 'delete', id: hubId, actor: by, is_super: _ctxD.isSuperAdmin === true, after_wave_delete: true } });
    var hubRes = (hubDel && hubDel.data) || {};
    var invErr = hubDel && hubDel.error ? (hubDel.error.message || String(hubDel.error)) : (!hubRes.ok ? lifecycleRefusal(hubRes, 'invoice', 'delete').msg : null);

    if (invErr) {
      // Wave copy (if any) is already gone and unlinked — say exactly where we are.
      // only reachable when something changed in the moment between the check above and here (e.g. a payment was recorded meanwhile)
      var partial = 'The Hub invoice was NOT deleted: ' + invErr + (deletedInWave ? ' Its Wave copy WAS already deleted' + (unlinked ? ' and the Hub invoice no longer points to it' : ' but the Hub invoice STILL shows the old Wave link — tell the super admin') + '. The invoice is still in the Hub: void or archive it there (Delete will refuse it for the same reason).' : '');
      await logInv({ wave_business_id: waveBusinessId || inv.wave_business_id, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: oldWaveId, action: 'delete', dry_run: false, success: false, error_message: partial, attempted_by: by });
      return NextResponse.json({ ok: false, deleted_in_wave: deletedInWave, error: partial, api_build_marker: API_BUILD_MARKER }, { status: 500 });
    }

    var summary = {
      ok: true,
      deleted_in_wave: deletedInWave,
      old_wave_invoice_id: oldWaveId,
      hub_payments_deleted: 0, // v55.83-UM — payments are never deleted
      released_bank_lines: hubRes.released || 0,
      invoice_number: inv.invoice_number,
      api_build_marker: API_BUILD_MARKER, route: API_ROUTE
    };
    await logInv({ wave_business_id: waveBusinessId || inv.wave_business_id, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: oldWaveId, action: 'delete', dry_run: false, success: true, response_payload: summary, attempted_by: by });
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'delete-invoice failed', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 500 });
  }
}
