// /api/wave/push-customer — push ONE Hub-created customer to the selected Wave business.
// TEST-business only in this build. Every call: server-side re-checks the silo guard,
// requires writes_enabled + allow_customer_push, blocks production, writes wave_sync_log,
// pushes via Wave GraphQL customerCreate, reads the customer back, and only then saves
// wave_customer_id + marks synced. SWC-safe: var + string concat, no template literals.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Minimal inline copy of the silo guard's push rules (server cannot import the JSX-tree
// component, but the rules must match wave-silo-guard.assertCanPush exactly).
function canPush(reg, record, waveBusinessId, action, unlockPhrase, dryRun) {
  if (!waveBusinessId) { return { ok: false, message: 'No accounting silo selected.' }; }
  if (!reg) { return { ok: false, message: 'This Wave business is not registered.' }; }
  // v55.83-EF — HARD GUARD: a real push may only target the approved KANDIL EGYPT test business.
  var APPROVED = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';
  if (dryRun !== true && waveBusinessId !== APPROVED && !(reg.is_production !== false && reg.production_push_unlocked === true)) { return { ok: false, message: 'Push blocked: target Wave business is not the approved test business and is not an unlocked production business.' }; }
  if (!record || !record.wave_business_id) { return { ok: false, message: 'Record is not assigned to a silo.' }; }
  if (record.wave_business_id !== waveBusinessId) { return { ok: false, message: 'Record belongs to a different silo.' }; }
  if (action === 'customer' && record.wave_customer_id) { return { ok: false, message: 'Customer already exists in Wave.' }; }
  if (reg.writes_enabled !== true) { return { ok: false, message: 'Writes are disabled for ' + (reg.label || waveBusinessId) + '.' }; }
  if (reg.allow_customer_push !== true) { return { ok: false, message: 'Customer push is not enabled for ' + (reg.label || waveBusinessId) + '.' }; }
  // v55.83-HI — production push allowed ONLY when a super admin has flipped production_push_unlocked
  // (on top of writes_enabled + allow_customer_push checked above). Absent/false → locked (default).
  if (reg.is_production !== false && reg.production_push_unlocked !== true) {
    return { ok: false, message: 'Production push is locked. A super admin must enable real production push for ' + (reg.label || waveBusinessId) + '.' };
  }
  return { ok: true };
}

function logSync(db, row) {
  return db.from('wave_sync_log').insert(row).then(function () {}).catch(function () {});
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var waveBusinessId = body.wave_business_id;
    var hubId = body.hub_record_id;
    var dryRun = body.dry_run === true;
    var unlockPhrase = body.unlock_phrase || '';
    var by = body.user_id || null;
    var _gate = await assertPermission(db, by, 'wave.customers.push', req);
    if (!_gate.ok) { return NextResponse.json({ ok: false, error: _gate.error }, { status: _gate.status }); }

    if (!waveBusinessId || !hubId) { return NextResponse.json({ error: 'wave_business_id and hub_record_id are required.' }, { status: 400 }); }

    var regRes = await db.from('wave_business_registry').select('*').eq('wave_business_id', waveBusinessId).single();
    var reg = regRes && regRes.data;
    var custRes = await db.from('accounting_customers').select('*').eq('id', hubId).single();
    var cust = custRes && custRes.data;
    if (!cust) { return NextResponse.json({ error: 'Customer not found.' }, { status: 404 }); }

    var verdict = canPush(reg, cust, waveBusinessId, 'customer', unlockPhrase, dryRun);
    if (!verdict.ok) {
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'customer', hub_record_id: hubId, action: 'push', dry_run: dryRun, success: false, error_message: verdict.message, attempted_by: by });
      return NextResponse.json({ error: verdict.message, blocked: true }, { status: 409 });
    }
    if (dryRun) {
      var pvName = cust.company_name || cust.contact_name || cust.name || '';
      var pvContact = cust.contact_name || ((cust.first_name || '') + ' ' + (cust.last_name || '')).trim() || null;
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'customer', hub_record_id: hubId, action: 'dry_run', dry_run: true, success: true, request_payload: { preview: { name: pvName, contact: pvContact, email: cust.email || null } }, attempted_by: by });
      return NextResponse.json({ dry_run: true, would_create: { name: pvName, contact: pvContact, email: cust.email || null } });
    }

    var token = process.env.WAVE_ACCESS_TOKEN;
    if (!token) { return NextResponse.json({ error: 'No Wave token configured (WAVE_ACCESS_TOKEN).' }, { status: 400 }); }

    // v55.83-EG — map Hub name fields into Wave's customer + primary-contact fields.
    // Wave: input.name = display/customer name; firstName/lastName = primary contact.
    var displayName = cust.company_name || cust.contact_name || cust.name || '';
    var firstName = '';
    var lastName = '';
    if (cust.first_name || cust.last_name) {
      firstName = cust.first_name || '';
      lastName = cust.last_name || '';
    } else if (cust.contact_name && String(cust.contact_name).trim()) {
      var parts = String(cust.contact_name).trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    }

    // Wave GraphQL customerCreate. Only include contact fields when we actually have them
    // (never overwrite with blank strings).
    var input = { businessId: waveBusinessId, name: displayName };
    if (cust.email) { input.email = cust.email; }
    if (firstName) { input.firstName = firstName; }
    if (lastName) { input.lastName = lastName; }
    var mutation = 'mutation($input: CustomerCreateInput!){ customerCreate(input:$input){ didSucceed inputErrors{ message path code } customer{ id name firstName lastName email } } }';
    var variables = { input: input };
    var reqPayload = { query: mutation, variables: variables };

    var resp = await fetch(WAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(reqPayload)
    });
    var data = await resp.json();
    var cc = data && data.data && data.data.customerCreate;
    var ok = cc && cc.didSucceed && cc.customer && cc.customer.id;

    await logSync(db, {
      wave_business_id: waveBusinessId, entity_type: 'customer', hub_record_id: hubId,
      wave_record_id: ok ? cc.customer.id : null, action: 'push', dry_run: false,
      request_payload: reqPayload, response_payload: data, success: !!ok,
      error_message: ok ? null : 'Wave customerCreate failed — see response_payload', attempted_by: by
    });

    if (!ok) { return NextResponse.json({ error: 'Wave did not accept the customer. See sync log.', response: data }, { status: 502 }); }

    // Read-back verify
    var readQ = 'query($bid:ID!,$cid:ID!){ business(id:$bid){ customer(id:$cid){ id name firstName lastName email } } }';
    var readResp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: readQ, variables: { bid: waveBusinessId, cid: cc.customer.id } }) });
    var readData = await readResp.json();
    var rb = readData && readData.data && readData.data.business && readData.data.business.customer;
    var verified = rb && rb.id === cc.customer.id;

    // v55.83-EH — ALWAYS save the Wave customer id back to the exact Hub row once Wave
    // created it (ok === true above). Previously this was gated on a strict name match,
    // so a customer with only contact_name (display name != company_name) would push to
    // Wave but never get linked back, leaving wave_customer_id blank and blocking its
    // invoice. The id is authoritative; verification is recorded separately.
    await db.from('accounting_customers').update({
      wave_customer_id: cc.customer.id,
      wave_sync_status: verified ? 'synced' : 'pushed_unverified'
    }).eq('id', hubId);
    await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'customer', hub_record_id: hubId, wave_record_id: cc.customer.id, action: 'read_back', dry_run: false, response_payload: readData, success: !!verified, error_message: verified ? null : 'Read-back name/id check soft-failed (id still linked)', attempted_by: by });

    return NextResponse.json({ success: true, wave_customer_id: cc.customer.id, verified: !!verified });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e) }, { status: 500 });
  }
}
