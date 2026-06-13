// /api/wave/push-customer — push ONE Hub-created customer to the selected Wave business.
// TEST-business only in this build. Every call: server-side re-checks the silo guard,
// requires writes_enabled + allow_customer_push, blocks production, writes wave_sync_log,
// pushes via Wave GraphQL customerCreate, reads the customer back, and only then saves
// wave_customer_id + marks synced. SWC-safe: var + string concat, no template literals.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Minimal inline copy of the silo guard's push rules (server cannot import the JSX-tree
// component, but the rules must match wave-silo-guard.assertCanPush exactly).
function canPush(reg, record, waveBusinessId, action, unlockPhrase) {
  if (!waveBusinessId) { return { ok: false, message: 'No accounting silo selected.' }; }
  if (!reg) { return { ok: false, message: 'This Wave business is not registered.' }; }
  if (!record || !record.wave_business_id) { return { ok: false, message: 'Record is not assigned to a silo.' }; }
  if (record.wave_business_id !== waveBusinessId) { return { ok: false, message: 'Record belongs to a different silo.' }; }
  if (action === 'customer' && record.wave_customer_id) { return { ok: false, message: 'Customer already exists in Wave.' }; }
  if (reg.writes_enabled !== true) { return { ok: false, message: 'Writes are disabled for ' + (reg.label || waveBusinessId) + '.' }; }
  if (reg.allow_customer_push !== true) { return { ok: false, message: 'Customer push is not enabled for ' + (reg.label || waveBusinessId) + '.' }; }
  if (reg.is_production !== false) {
    if ((unlockPhrase || '').trim() !== 'PUSH TO REAL KTC WAVE') { return { ok: false, message: 'Production is locked. Production push is not enabled in this build.' }; }
    return { ok: false, message: 'Production writes are disabled in this build. Test business only.' };
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

    if (!waveBusinessId || !hubId) { return NextResponse.json({ error: 'wave_business_id and hub_record_id are required.' }, { status: 400 }); }

    var regRes = await db.from('wave_business_registry').select('*').eq('wave_business_id', waveBusinessId).single();
    var reg = regRes && regRes.data;
    var custRes = await db.from('accounting_customers').select('*').eq('id', hubId).single();
    var cust = custRes && custRes.data;
    if (!cust) { return NextResponse.json({ error: 'Customer not found.' }, { status: 404 }); }

    var verdict = canPush(reg, cust, waveBusinessId, 'customer', unlockPhrase);
    if (!verdict.ok) {
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'customer', hub_record_id: hubId, action: 'push', dry_run: dryRun, success: false, error_message: verdict.message, attempted_by: by });
      return NextResponse.json({ error: verdict.message, blocked: true }, { status: 409 });
    }
    if (dryRun) {
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'customer', hub_record_id: hubId, action: 'dry_run', dry_run: true, success: true, attempted_by: by });
      return NextResponse.json({ dry_run: true, would_create: { name: cust.company_name || cust.name } });
    }

    var token = process.env.WAVE_ACCESS_TOKEN;
    if (!token) { return NextResponse.json({ error: 'No Wave token configured (WAVE_ACCESS_TOKEN).' }, { status: 400 }); }

    // Wave GraphQL customerCreate. NOTE: field shape per Wave public schema; must be
    // validated against the Wave sandbox before relying on it.
    var mutation = 'mutation($input: CustomerCreateInput!){ customerCreate(input:$input){ didSucceed inputErrors{ message path } customer{ id name email } } }';
    var variables = { input: { businessId: waveBusinessId, name: cust.company_name || cust.name, email: cust.email || null } };
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
    var readQ = 'query($bid:ID!,$cid:ID!){ business(id:$bid){ customer(id:$cid){ id name email } } }';
    var readResp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: readQ, variables: { bid: waveBusinessId, cid: cc.customer.id } }) });
    var readData = await readResp.json();
    var rb = readData && readData.data && readData.data.business && readData.data.business.customer;
    var verified = rb && rb.id === cc.customer.id && rb.name === (cust.company_name || cust.name);

    if (verified) {
      await db.from('accounting_customers').update({ wave_customer_id: cc.customer.id, wave_sync_status: 'synced' }).eq('id', hubId);
    }
    await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'customer', hub_record_id: hubId, wave_record_id: cc.customer.id, action: 'read_back', dry_run: false, response_payload: readData, success: !!verified, error_message: verified ? null : 'Read-back mismatch', attempted_by: by });

    return NextResponse.json({ success: true, wave_customer_id: cc.customer.id, verified: !!verified });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e) }, { status: 500 });
  }
}
