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

// Full recursive unwrap: returns { leaf, kind, required, list, tree } walking NON_NULL/LIST/ofType.
function describeType(t) {
  var required = false;
  var list = false;
  var cur = t;
  var tree = [];
  var guard = 0;
  while (cur && guard < 12) {
    guard = guard + 1;
    tree.push(cur.kind + (cur.name ? (':' + cur.name) : ''));
    if (cur.kind === 'NON_NULL') { required = true; }
    if (cur.kind === 'LIST') { list = true; }
    if (cur.name && cur.kind !== 'NON_NULL' && cur.kind !== 'LIST') { break; }
    cur = cur.ofType;
  }
  var leaf = (cur && cur.name) || null;
  var leafKind = (cur && cur.kind) || null;
  return { leaf: leaf, kind: leafKind, required: required, list: list, tree: tree.join(' > ') };
}

function describeInputFields(data) {
  var out = [];
  try {
    var ifs = data && data.data && data.data.__type && data.data.__type.inputFields;
    if (ifs) { var i; for (i = 0; i < ifs.length; i++) { var d = describeType(ifs[i].type); out.push({ name: ifs[i].name, leaf: d.leaf, kind: d.kind, required: d.required, list: d.list, tree: d.tree }); } }
  } catch (e) {}
  return out;
}

function fullTypeQuery(typeName) {
  return 'query{ __type(name:"' + typeName + '"){ name kind enumValues{ name } inputFields{ name type{ kind name ofType{ kind name ofType{ kind name ofType{ kind name } } } } } } }';
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

  // Discover the REAL input type names + fields straight from the mutation signatures, so we
  // never guess type names. For each payment mutation, read its args and the arg's input type.
  var mutMeta = await gql(token, 'query{ __schema{ mutationType{ fields{ name args{ name type{ name kind ofType{ name kind ofType{ name kind } } } } } } } }');
  var targetMutations = { invoicePaymentCreateManual: 1, invoicePaymentPatch: 1 };
  var paymentMutationDetails = [];
  var inputTypeNames = {};
  try {
    var mf = mutMeta && mutMeta.data && mutMeta.data.__schema && mutMeta.data.__schema.mutationType && mutMeta.data.__schema.mutationType.fields;
    if (mf) {
      var mi;
      for (mi = 0; mi < mf.length; mi++) {
        var fld = mf[mi];
        if (fld && fld.name && (targetMutations[fld.name] || fld.name.toLowerCase().indexOf('payment') >= 0)) {
          var args = [];
          if (fld.args) { var ai; for (ai = 0; ai < fld.args.length; ai++) { var ad = describeType(fld.args[ai].type); args.push({ name: fld.args[ai].name, leaf: ad.leaf, required: ad.required, list: ad.list, tree: ad.tree }); if (targetMutations[fld.name] && ad.leaf) { inputTypeNames[ad.leaf] = 1; } } }
          paymentMutationDetails.push({ name: fld.name, args: args });
        }
      }
    }
  } catch (e) {}

  // Now introspect the actual input types found above (recursive describe + required flags).
  var inputTypeFields = {};
  var nestedToProbe = {};
  var keys = Object.keys(inputTypeNames);
  var ki;
  for (ki = 0; ki < keys.length; ki++) {
    var tName = keys[ki];
    var tData = await gql(token, fullTypeQuery(tName));
    var described = describeInputFields(tData);
    inputTypeFields[tName] = described;
    // queue nested INPUT_OBJECT leaves (e.g. an amount/money input) to introspect one level deep
    var di;
    for (di = 0; di < described.length; di++) {
      if (described[di].kind === 'INPUT_OBJECT' && described[di].leaf && !inputTypeNames[described[di].leaf]) { nestedToProbe[described[di].leaf] = 1; }
    }
  }
  // one level of nested input objects (money/amount shapes)
  var nestedFields = {};
  var nk = Object.keys(nestedToProbe);
  var nki;
  for (nki = 0; nki < nk.length; nki++) {
    var nName = nk[nki];
    var nData = await gql(token, fullTypeQuery(nName));
    nestedFields[nName] = describeInputFields(nData);
  }

  // paymentMethod enum: try several names; report whichever is actually an ENUM with values.
  var pmTry = ['InvoicePaymentMethod', 'PaymentMethod', 'PaymentMethodType', 'PaymentMethodEnum'];
  var pmFound = { type: null, kind: null, values: [] };
  var pmi;
  for (pmi = 0; pmi < pmTry.length; pmi++) {
    var pmResp = await gql(token, 'query{ __type(name:"' + pmTry[pmi] + '"){ kind enumValues{ name } } }');
    try {
      var node = pmResp && pmResp.data && pmResp.data.__type;
      if (node && node.kind === 'ENUM' && node.enumValues && node.enumValues.length) { pmFound = { type: pmTry[pmi], kind: 'ENUM', values: [] }; var ei; for (ei = 0; ei < node.enumValues.length; ei++) { pmFound.values.push(node.enumValues[ei].name); } break; }
    } catch (e) {}
  }

  // Invoice type fields + the real type of its payments field (for Wave -> Hub pull).
  var invType = await gql(token, 'query{ __type(name:"Invoice"){ kind fields{ name type{ kind name ofType{ kind name ofType{ kind name } } } } } }');
  var invFields = [];
  var invPaymentsFieldType = null;
  try {
    var iff = invType && invType.data && invType.data.__type && invType.data.__type.fields;
    if (iff) { var k2; for (k2 = 0; k2 < iff.length; k2++) { invFields.push(iff[k2].name); if (iff[k2].name === 'payments' || iff[k2].name === 'payment') { var pd = describeType(iff[k2].type); invPaymentsFieldType = pd.leaf + ' (tree: ' + pd.tree + ')'; } } }
  } catch (e2) {}

  // If Invoice exposes a payments field type, introspect that type's fields too.
  var invoicePaymentTypeFields = null;
  try {
    if (invPaymentsFieldType) {
      var leafName = invPaymentsFieldType.split(' ')[0];
      if (leafName && leafName !== 'null') {
        var ipData = await gql(token, 'query{ __type(name:"' + leafName + '"){ fields{ name type{ kind name ofType{ kind name } } } } }');
        var ipf = ipData && ipData.data && ipData.data.__type && ipData.data.__type.fields;
        if (ipf) { invoicePaymentTypeFields = []; var ip; for (ip = 0; ip < ipf.length; ip++) { invoicePaymentTypeFields.push({ name: ipf[ip].name, type: flattenType(ipf[ip].type) }); } }
      }
    }
  } catch (e3) {}

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
      var aci;
      for (aci = 0; aci < aedges.length; aci++) {
        var n = aedges[aci].node;
        if (!n) { continue; }
        var st = (n.subtype && (n.subtype.value || n.subtype.name)) || '';
        var stU = String(st).toUpperCase();
        if (stU.indexOf('CASH') >= 0 || stU.indexOf('BANK') >= 0 || stU.indexOf('MONEY') >= 0 || stU.indexOf('CREDIT') >= 0) {
          candidates.push({ id: n.id, name: n.name, subtype: st });
        }
      }
    }
  } catch (e) {}

  return noStore({
    ok: true,
    note: 'Read-only introspection. Nothing was written to Wave. Token never exposed.',
    payment_mutation_details: paymentMutationDetails,
    discovered_input_type_fields: inputTypeFields,
    nested_input_type_fields: nestedFields,
    paymentMethod_enum: pmFound,
    invoice_has_payments_field: invFields.indexOf('payments') >= 0,
    invoice_payments_field_type: invPaymentsFieldType,
    invoice_payment_type_fields: invoicePaymentTypeFields,
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
