// /api/wave/push-invoice — push ONE Hub-created, approved invoice to the selected Wave
// business (TEST only). Requires the invoice's customer to already be in Wave. Same guard
// + sync_log + read-back pattern as push-customer. SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function canPush(reg, record, waveBusinessId, unlockPhrase, dryRun) {
  if (!waveBusinessId) { return { ok: false, message: 'No accounting silo selected.' }; }
  if (!reg) { return { ok: false, message: 'This Wave business is not registered.' }; }
  // v55.83-EF — HARD GUARD: a real push may only target the approved KANDIL EGYPT test business.
  var APPROVED = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';
  if (dryRun !== true && waveBusinessId !== APPROVED) { return { ok: false, message: 'Push blocked: target Wave business is not the approved KANDIL EGYPT test business.' }; }
  if (!record || !record.wave_business_id) { return { ok: false, message: 'Invoice is not assigned to a silo.' }; }
  if (record.wave_business_id !== waveBusinessId) { return { ok: false, message: 'Invoice belongs to a different silo.' }; }
  if (record.wave_invoice_id) { return { ok: false, message: 'Invoice already exists in Wave.' }; }
  if (record.is_historical === true || record.source === 'wave_import') { return { ok: false, message: 'Historical/imported invoice cannot be pushed.' }; }
  if (record.approval_status && record.approval_status !== 'approved') { return { ok: false, message: 'Invoice is not approved.' }; }
  if (reg.writes_enabled !== true) { return { ok: false, message: 'Writes are disabled for ' + (reg.label || waveBusinessId) + '.' }; }
  if (reg.allow_invoice_push !== true) { return { ok: false, message: 'Invoice push is not enabled for ' + (reg.label || waveBusinessId) + '.' }; }
  if (reg.is_production !== false) { return { ok: false, message: 'Production writes are disabled in this build. Test business only.' }; }
  return { ok: true };
}

function logSync(db, row) { return db.from('wave_sync_log').insert(row).then(function () {}).catch(function () {}); }

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var waveBusinessId = body.wave_business_id;
    var hubId = body.hub_record_id;
    var dryRun = body.dry_run === true;
    var by = body.user_id || null;
    if (!waveBusinessId || !hubId) { return NextResponse.json({ error: 'wave_business_id and hub_record_id are required.' }, { status: 400 }); }

    var regRes = await db.from('wave_business_registry').select('*').eq('wave_business_id', waveBusinessId).single();
    var reg = regRes && regRes.data;
    var invRes = await db.from('accounting_invoices').select('*').eq('id', hubId).single();
    var inv = invRes && invRes.data;
    if (!inv) { return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 }); }

    var verdict = canPush(reg, inv, waveBusinessId, body.unlock_phrase || '', dryRun);
    if (!verdict.ok) {
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'push', dry_run: dryRun, success: false, error_message: verdict.message, attempted_by: by });
      return NextResponse.json({ error: verdict.message, blocked: true }, { status: 409 });
    }

    // Customer must already be in Wave (push customer first).
    var custRes = await db.from('accounting_customers').select('id, company_name, name, wave_customer_id, wave_business_id').eq('id', inv.accounting_customer_id).single();
    var cust = custRes && custRes.data;
    if (!cust || !cust.wave_customer_id) {
      var cn = cust ? (cust.company_name || cust.name || cust.id) : '(unknown)';
      var cid = cust ? cust.id : '(none)';
      var msg = 'Push this customer first: "' + cn + '" (Hub id ' + cid + ') has no Wave customer id yet for this business. Go to Pending Sync, push that customer, then retry the invoice.';
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'push', dry_run: dryRun, success: false, error_message: msg, response_payload: { invoice_number: inv.invoice_number, hub_customer_name: cn, hub_customer_id: cid, wave_customer_id: cust ? cust.wave_customer_id : null, wave_business_id: waveBusinessId }, attempted_by: by });
      return NextResponse.json({ error: msg, blocked: true, needs_customer: { name: cn, hub_id: cid } }, { status: 409 });
    }
    if (cust.wave_business_id && cust.wave_business_id !== waveBusinessId) {
      var msgS = 'The invoice customer belongs to a different business than the one selected. Cannot push across silos.';
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'push', dry_run: dryRun, success: false, error_message: msgS, attempted_by: by });
      return NextResponse.json({ error: msgS, blocked: true }, { status: 409 });
    }

    var itemsRes = await db.from('accounting_invoice_items').select('*').eq('invoice_id', hubId);
    var items = (itemsRes && itemsRes.data) || [];

    if (dryRun) {
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'dry_run', dry_run: true, success: true, attempted_by: by });
      return NextResponse.json({ dry_run: true, would_create: { invoice_number: inv.invoice_number, total: inv.total_amount, line_items: items.length, customer: cust.company_name || cust.name } });
    }

    var token = process.env.WAVE_ACCESS_TOKEN;
    if (!token) { return NextResponse.json({ error: 'No Wave token configured (WAVE_ACCESS_TOKEN).' }, { status: 400 }); }

    // Wave invoiceCreate. Field shape per public schema — MUST be validated against the
    // Wave sandbox before relying on it (line-item product mapping in particular).
    var lineItems = [];
    var k;
    for (k = 0; k < items.length; k++) {
      lineItems.push({ description: items[k].description || 'Item', quantity: Number(items[k].quantity) || 1, unitPrice: Number(items[k].unit_price) || 0 });
    }
    var mutation = 'mutation($input: InvoiceCreateInput!){ invoiceCreate(input:$input){ didSucceed inputErrors{ message path } invoice{ id invoiceNumber total{ value } } } }';
    var variables = { input: { businessId: waveBusinessId, customerId: cust.wave_customer_id, invoiceNumber: String(inv.invoice_number), invoiceDate: inv.invoice_date || null, dueDate: inv.due_date || null, items: lineItems } };
    var reqPayload = { query: mutation, variables: variables };

    var resp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(reqPayload) });
    var data = await resp.json();
    var ic = data && data.data && data.data.invoiceCreate;
    var ok = ic && ic.didSucceed && ic.invoice && ic.invoice.id;

    await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: ok ? ic.invoice.id : null, action: 'push', dry_run: false, request_payload: reqPayload, response_payload: data, success: !!ok, error_message: ok ? null : 'Wave invoiceCreate failed — see response_payload', attempted_by: by });

    if (!ok) { return NextResponse.json({ error: 'Wave did not accept the invoice. See sync log.', response: data }, { status: 502 }); }

    var verified = String(ic.invoice.invoiceNumber) === String(inv.invoice_number);
    if (verified) { await db.from('accounting_invoices').update({ wave_invoice_id: ic.invoice.id, wave_sync_status: 'synced' }).eq('id', hubId); }
    await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: ic.invoice.id, action: 'read_back', dry_run: false, response_payload: data, success: !!verified, error_message: verified ? null : 'Read-back mismatch', attempted_by: by });

    return NextResponse.json({ success: true, wave_invoice_id: ic.invoice.id, verified: !!verified });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e) }, { status: 500 });
  }
}
