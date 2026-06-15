// /api/wave/schema-check — READ-ONLY Wave schema introspection. Writes nothing to Wave or
// Hub. PROTECTED: requires CRON_SECRET bearer OR a super_admin user_id. Never echoes the
// Wave token, never accepts arbitrary GraphQL (fixed introspection queries only), no-store.
// Confirms invoicePaymentCreateManual existence + exact input fields, paymentMethod enum,
// MoneyInput shape, Invoice.payments, and candidate bank/cash payment accounts. Delete this
// route after the payment build is done. SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

var WAVE_URL = 'https://gql.waveapps.com/graphql/public';
var APPROVED_BUSINESS_ID = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function noStore(json, status) {
  var res = NextResponse.json(json, { status: status || 200 });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res;
}

async function isSuperAdmin(userId) {
  if (!userId) { return false; }
  try {
    var db = admin();
    var r = await db.from('users').select('role').eq('id', userId);
    var row = (r && r.data && r.data.length) ? r.data[0] : null;
    return !!(row && row.role === 'super_admin');
  } catch (e) { return false; }
}

async function gql(token, query) {
  var resp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: query }) });
  return await resp.json();
}

function flattenType(t) {
  if (!t) { return null; }
  var name = t.name; var k = t.kind; var o = t.ofType;
  while (!name && o) { name = o.name; k = o.kind; o = o.ofType; }
  return (name || k);
}

function inputFieldsQuery(typeName) {
  return 'query{ __type(name:"' + typeName + '"){ name inputFields{ name type{ name kind ofType{ name kind ofType{ name kind } } } } } }';
}

function listInputFields(data) {
  var out = [];
  try {
    var ifs = data && data.data && data.data.__type && data.data.__type.inputFields;
    if (ifs) { var i; for (i = 0; i < ifs.length; i++) { out.push({ name: ifs[i].name, type: flattenType(ifs[i].type) }); } }
  } catch (e) {}
  return out;
}

async function runCheck() {
  var token = process.env.WAVE_ACCESS_TOKEN;
  if (!token) { return noStore({ error: 'No Wave token configured.' }, 400); }

  // payment-related mutation names
  var mutListResp = await gql(token, 'query{ __schema{ mutationType{ fields{ name } } } }');
  var mutNames = [];
  try {
    var mf = mutListResp && mutListResp.data && mutListResp.data.__schema && mutListResp.data.__schema.mutationType && mutListResp.data.__schema.mutationType.fields;
    if (mf) { var j; for (j = 0; j < mf.length; j++) { if (mf[j] && mf[j].name && mf[j].name.toLowerCase().indexOf('payment') >= 0) { mutNames.push(mf[j].name); } } }
  } catch (e) {}

  var manualInput = await gql(token, inputFieldsQuery('InvoicePaymentCreateManualInput'));
  var moneyInput = await gql(token, inputFieldsQuery('MoneyInput'));

  // paymentMethod enum values, if it is an enum
  var pmEnum = await gql(token, 'query{ __type(name:"PaymentMethod"){ kind enumValues{ name } } }');
  var pmValues = [];
  try {
    var ev = pmEnum && pmEnum.data && pmEnum.data.__type && pmEnum.data.__type.enumValues;
    if (ev) { var e2; for (e2 = 0; e2 < ev.length; e2++) { pmValues.push(ev[e2].name); } }
  } catch (e) {}

  // Invoice.payments existence + payment field shape
  var invType = await gql(token, 'query{ __type(name:"Invoice"){ fields{ name } } }');
  var invFields = [];
  try {
    var iff = invType && invType.data && invType.data.__type && invType.data.__type.fields;
    if (iff) { var k2; for (k2 = 0; k2 < iff.length; k2++) { invFields.push(iff[k2].name); } }
  } catch (e2) {}

  // candidate payment accounts: bank/cash from Chart of Accounts (read-only)
  var acctQ = 'query($bid:ID!){ business(id:$bid){ isClassicAccounting accounts(page:1,pageSize:100){ edges{ node{ id name type{ value } subtype{ name value } } } } } }';
  var acResp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: acctQ, variables: { bid: APPROVED_BUSINESS_ID } }) });
  var acData = await acResp.json();
  var candidates = [];
  var isClassic = null;
  try {
    var biz = acData && acData.data && acData.data.business;
    isClassic = biz ? biz.isClassicAccounting : null;
    var aedges = biz && biz.accounts && biz.accounts.edges;
    if (aedges) {
      var ai;
      for (ai = 0; ai < aedges.length; ai++) {
        var n = aedges[ai].node;
        if (!n) { continue; }
        var st = (n.subtype && (n.subtype.value || n.subtype.name)) || '';
        var stU = String(st).toUpperCase();
        if (stU.indexOf('CASH') >= 0 || stU.indexOf('BANK') >= 0 || stU.indexOf('MONEY') >= 0) {
          candidates.push({ id: n.id, name: n.name, subtype: st });
        }
      }
    }
  } catch (e) {}

  return noStore({
    ok: true,
    note: 'Read-only introspection. Nothing was written to Wave. Token never exposed.',
    payment_related_mutations: mutNames,
    invoicePaymentCreateManualInput_fields: listInputFields(manualInput),
    moneyInput_fields: listInputFields(moneyInput),
    paymentMethod_enum_values: pmValues,
    invoice_has_payments_field: invFields.indexOf('payments') >= 0,
    invoice_fields: invFields,
    candidate_payment_accounts: candidates,
    isClassicAccounting_context_only: isClassic
  });
}

async function authorize(req, bodyUserId) {
  var auth = (req.headers && req.headers.get && req.headers.get('authorization')) || '';
  var secret = process.env.CRON_SECRET;
  if (secret && auth === ('Bearer ' + secret)) { return true; }
  return await isSuperAdmin(bodyUserId);
}

export async function POST(req) {
  try {
    var body = {};
    try { body = await req.json(); } catch (eB) { body = {}; }
    var okAuth = await authorize(req, body && body.user_id);
    if (!okAuth) { return noStore({ error: 'Unauthorized. Provide CRON_SECRET bearer or a super_admin user_id in the POST body.' }, 401); }
    return await runCheck();
  } catch (e) {
    return noStore({ error: (e && e.message) || String(e) }, 500);
  }
}

export async function GET(req) {
  try {
    // GET supports the CRON_SECRET bearer only (no user_id in URL — avoids logging the id).
    var auth = (req.headers && req.headers.get && req.headers.get('authorization')) || '';
    var secret = process.env.CRON_SECRET;
    if (!(secret && auth === ('Bearer ' + secret))) { return noStore({ error: 'Unauthorized. Use POST with a super_admin user_id in the body, or GET with a CRON_SECRET bearer. (user_id is not accepted in the URL to keep it out of logs.)' }, 401); }
    return await runCheck();
  } catch (e) {
    return noStore({ error: (e && e.message) || String(e) }, 500);
  }
}
