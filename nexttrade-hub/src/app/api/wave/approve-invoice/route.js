// /api/wave/approve-invoice — v55.83-IN.
// Approve (DRAFT -> SAVED) a Hub invoice that was already pushed to Wave as a DRAFT.
// Wave creates invoices as DRAFT and REFUSES payments on drafts, which left invoices stuck on the
// "needs Wave status repair" block. This calls Wave's invoiceApprove mutation so the user no longer
// has to leave the Hub, open Wave, approve manually, and re-import.
//
// Wave mutation shape mirrors invoiceCreate (same didSucceed/inputErrors/entity envelope). It is
// STATUS-ONLY (moves no money), and we surface Wave's EXACT response on failure (same pattern as
// invoiceCreate/productCreate) so a wrong field can never silently corrupt anything — it just
// reports Wave's accepted fields. SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var API_BUILD_MARKER = 'v55.83-IN-approve-invoice';
var API_ROUTE = '/api/wave/approve-invoice';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Same production/silo gating as push-invoice-v2, but for an invoice that ALREADY exists in Wave
// (so it REQUIRES wave_invoice_id, the opposite of the create guard).
function canApprove(reg, record, waveBusinessId) {
  if (!waveBusinessId) { return { ok: false, message: 'No accounting silo selected.' }; }
  if (!reg) { return { ok: false, message: 'This Wave business is not registered.' }; }
  var APPROVED = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';
  if (waveBusinessId !== APPROVED && !(reg.is_production !== false && reg.production_push_unlocked === true)) { return { ok: false, message: 'Approve blocked: target Wave business is not the approved test business and is not an unlocked production business.' }; }
  if (!record || !record.wave_business_id) { return { ok: false, message: 'Invoice is not assigned to a silo.' }; }
  if (record.wave_business_id !== waveBusinessId) { return { ok: false, message: 'Invoice belongs to a different silo.' }; }
  if (!record.wave_invoice_id) { return { ok: false, message: 'Invoice has not been pushed to Wave yet (no wave_invoice_id) — push it first.' }; }
  if (reg.writes_enabled !== true) { return { ok: false, message: 'Writes are disabled for ' + (reg.label || waveBusinessId) + '.' }; }
  if (reg.allow_invoice_push !== true) { return { ok: false, message: 'Invoice push/approve is not enabled for ' + (reg.label || waveBusinessId) + '.' }; }
  if (reg.is_production !== false && reg.production_push_unlocked !== true) {
    return { ok: false, message: 'Production push is locked. A super admin must enable real production push for ' + (reg.label || waveBusinessId) + '.' };
  }
  return { ok: true };
}

function logSync(db, row) { return db.from('wave_sync_log').insert(row).then(function () {}).catch(function () {}); }

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var waveBusinessId = body.wave_business_id;
    var hubId = body.hub_record_id;
    var by = body.user_id || null;
    var _gate = await assertPermission(db, by, 'wave.invoices.push', req);
    if (!_gate.ok) { return NextResponse.json({ ok: false, error: _gate.error, api_build_marker: API_BUILD_MARKER }, { status: _gate.status }); }
    if (!waveBusinessId || !hubId) { return NextResponse.json({ error: 'wave_business_id and hub_record_id are required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    var regRes = await db.from('wave_business_registry').select('*').eq('wave_business_id', waveBusinessId).single();
    var reg = regRes && regRes.data;
    var invRes = await db.from('accounting_invoices').select('*').eq('id', hubId).single();
    var inv = invRes && invRes.data;
    if (!inv) { return NextResponse.json({ error: 'Invoice not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }

    var verdict = canApprove(reg, inv, waveBusinessId);
    if (!verdict.ok) {
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: inv.wave_invoice_id || null, action: 'approve', dry_run: false, success: false, error_message: verdict.message, attempted_by: by });
      return NextResponse.json({ error: verdict.message, blocked: true, api_build_marker: API_BUILD_MARKER }, { status: 409 });
    }

    var token = process.env.WAVE_ACCESS_TOKEN;
    if (!token) { return NextResponse.json({ error: 'No Wave token configured (WAVE_ACCESS_TOKEN).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    // Wave invoiceApprove — same envelope as invoiceCreate. Input carries the Wave invoice id.
    var mutation = 'mutation($input: InvoiceApproveInput!){ invoiceApprove(input:$input){ didSucceed inputErrors{ message path code } invoice{ id status } } }';
    var variables = { input: { invoiceId: inv.wave_invoice_id } };
    var resp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: mutation, variables: variables }) });
    var data = await resp.json();
    if (data && typeof data === 'object') { data.api_build_marker = API_BUILD_MARKER; data.route = API_ROUTE; }
    var ia = data && data.data && data.data.invoiceApprove;
    var ok = ia && ia.didSucceed && ia.invoice && ia.invoice.id;

    if (!ok) {
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: inv.wave_invoice_id, action: 'approve', dry_run: false, request_payload: { query: mutation, variables: variables, api_build_marker: API_BUILD_MARKER }, response_payload: data, success: false, error_message: 'Wave invoiceApprove failed — see response_payload', attempted_by: by });
      return NextResponse.json({ error: 'Wave did not approve the invoice. See sync log for the exact reason.', response: data, api_build_marker: API_BUILD_MARKER }, { status: 502 });
    }

    // Success — record Wave's real status (SAVED) so the DRAFT block clears immediately.
    var newStatus = (ia.invoice && ia.invoice.status) ? ia.invoice.status : 'SAVED';
    var upd = await db.from('accounting_invoices').update({ wave_status: newStatus, wave_sync_status: 'synced' }).eq('id', hubId);
    if (upd && upd.error) {
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: inv.wave_invoice_id, action: 'approve', dry_run: false, response_payload: data, success: false, error_message: 'Approved in Wave (status=' + newStatus + ') but Hub write-back failed: ' + (upd.error.message || String(upd.error)), attempted_by: by });
      return NextResponse.json({ ok: false, approved_in_wave: true, wave_status: newStatus, error: 'Approved in Wave but the Hub could not record it — run Wave Import to sync the status.', api_build_marker: API_BUILD_MARKER }, { status: 200 });
    }
    await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: inv.wave_invoice_id, action: 'approve', dry_run: false, response_payload: data, success: true, error_message: null, attempted_by: by });
    return NextResponse.json({ success: true, wave_status: newStatus, api_build_marker: API_BUILD_MARKER, route: API_ROUTE });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER, route: API_ROUTE });
}
