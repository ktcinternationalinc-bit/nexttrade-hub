// /api/wave/push-invoice — push ONE Hub-created, approved invoice to the selected Wave
// business (TEST only). Requires the invoice's customer to already be in Wave. Same guard
// + sync_log + read-back pattern as push-customer. SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var API_BUILD_MARKER = 'v55.83-EO-push-invoice-productid-preflight';
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
  if (record.approval_status !== 'approved') { return { ok: false, message: 'Invoice must be approved in Hub before it can be pushed to Wave.' }; }
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
    var _gate = await assertPermission(db, by, 'wave.invoices.push', req);
    if (!_gate.ok) { return NextResponse.json({ ok: false, error: _gate.error }, { status: _gate.status }); }
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
    var custLinkId = inv.accounting_customer_id || null;
    if (!custLinkId) {
      var msgNoLink = 'This invoice has no customer linked (accounting_customer_id is empty). Open the invoice, re-select the customer, and Save before pushing.';
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'push', dry_run: dryRun, success: false, error_message: msgNoLink, response_payload: { invoice_number: inv.invoice_number, accounting_customer_id: null, reason: 'no_customer_link' }, attempted_by: by });
      return NextResponse.json({ error: msgNoLink, blocked: true }, { status: 409 });
    }
    var custRes = await db.from('accounting_customers').select('id, company_name, contact_name, wave_customer_id, wave_business_id').eq('id', custLinkId);
    var custErr = custRes && custRes.error ? (custRes.error.message || String(custRes.error)) : null;
    var custList = (custRes && custRes.data) || [];
    var cust = custList.length > 0 ? custList[0] : null;
    if (custErr || !cust) {
      var msgQ = custErr ? ('Could not read the invoice customer (db error: ' + custErr + ').') : ('The invoice is linked to customer id ' + custLinkId + ' but no such customer row exists. Re-select the customer on the invoice and Save.');
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'push', dry_run: dryRun, success: false, error_message: msgQ, response_payload: { invoice_number: inv.invoice_number, accounting_customer_id: custLinkId, db_error: custErr, reason: custErr ? 'customer_query_error' : 'customer_row_missing' }, attempted_by: by });
      return NextResponse.json({ error: msgQ, blocked: true }, { status: 409 });
    }
    if (!cust.wave_customer_id) {
      var cn = cust.company_name || cust.contact_name || cust.id;
      var msg = 'Push this customer first: "' + cn + '" (Hub id ' + cust.id + ') has no Wave customer id yet for this business. Go to Pending Sync, push that customer, then retry the invoice.';
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'push', dry_run: dryRun, success: false, error_message: msg, response_payload: { invoice_number: inv.invoice_number, hub_customer_name: cn, hub_customer_id: cust.id, accounting_customer_id: custLinkId, wave_customer_id: null, wave_business_id: waveBusinessId, reason: 'customer_no_wave_id' }, attempted_by: by });
      return NextResponse.json({ error: msg, blocked: true, needs_customer: { name: cn, hub_id: cust.id } }, { status: 409 });
    }
    if (cust.wave_business_id && cust.wave_business_id !== waveBusinessId) {
      var msgS = 'The invoice customer belongs to a different business than the one selected. Cannot push across silos.';
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'push', dry_run: dryRun, success: false, error_message: msgS, attempted_by: by });
      return NextResponse.json({ error: msgS, blocked: true }, { status: 409 });
    }

    var itemsRes = await db.from('accounting_invoice_items').select('*').eq('invoice_id', hubId);
    var items = (itemsRes && itemsRes.data) || [];

    if (dryRun) {
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'dry_run', dry_run: true, success: true, request_payload: { api_build_marker: API_BUILD_MARKER }, attempted_by: by });
      return NextResponse.json({ dry_run: true, api_build_marker: API_BUILD_MARKER, would_create: { invoice_number: inv.invoice_number, total: inv.total_amount, line_items: items.length, customer: cust.company_name || cust.contact_name, note: 'On real push, each line will be attached to the reusable Wave product "NextTrade Hub Item" (used if it exists, created once if not). No product is created during a dry run.' } });
    }

    var token = process.env.WAVE_ACCESS_TOKEN;
    if (!token) { return NextResponse.json({ error: 'No Wave token configured (WAVE_ACCESS_TOKEN).' }, { status: 400 }); }

    // Wave invoiceCreate. Field shape per public schema — MUST be validated against the
    // Wave sandbox before relying on it (line-item product mapping in particular).
    // v55.83-EN — Wave requires every invoice line item to reference a productId.
    // Resolve ONE reusable Wave product for this business ("NextTrade Hub Item"): find an
    // existing product, else create one (productCreate needs an income account id).
    var productId = null;
    var productMode = 'none';
    // 1) try to find an existing product on this business
    var listProdQ = 'query($bid:ID!){ business(id:$bid){ products(page:1,pageSize:50){ edges{ node{ id name isSold } } } } }';
    var lpResp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: listProdQ, variables: { bid: waveBusinessId } }) });
    var lpData = await lpResp.json();
    var edges = lpData && lpData.data && lpData.data.business && lpData.data.business.products && lpData.data.business.products.edges;
    if (edges && edges.length) {
      var pi2;
      for (pi2 = 0; pi2 < edges.length; pi2++) {
        if (edges[pi2].node && edges[pi2].node.name === 'NextTrade Hub Item') { productId = edges[pi2].node.id; productMode = 'reused_existing'; }
      }
    }
    // 2) if none usable, create one (needs an income account)
    if (!productId) {
      var acctQ = 'query($bid:ID!){ business(id:$bid){ accounts(page:1,pageSize:50,types:[INCOME]){ edges{ node{ id name } } } } }';
      var acResp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: acctQ, variables: { bid: waveBusinessId } }) });
      var acData = await acResp.json();
      var acEdges = acData && acData.data && acData.data.business && acData.data.business.accounts && acData.data.business.accounts.edges;
      var incomeAccountId = (acEdges && acEdges.length && acEdges[0].node) ? acEdges[0].node.id : null;
      if (!incomeAccountId) {
        await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: 'No Wave income account found to create a product. Add an income account in Wave first.', response_payload: acData, attempted_by: by });
        return NextResponse.json({ error: 'No Wave income account available to create a product for invoice line items.', response: acData }, { status: 502 });
      }
      var pcMut = 'mutation($input: ProductCreateInput!){ productCreate(input:$input){ didSucceed inputErrors{ message path code } product{ id name } } }';
      var pcVars = { input: { businessId: waveBusinessId, name: 'NextTrade Hub Item', unitPrice: 0, incomeAccountId: incomeAccountId } };
      var pcResp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: pcMut, variables: pcVars }) });
      var pcData = await pcResp.json();
      var pc = pcData && pcData.data && pcData.data.productCreate;
      if (pc && pc.didSucceed && pc.product && pc.product.id) { productId = pc.product.id; productMode = 'created_new'; }
      if (!productId) {
        await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: 'Could not create a Wave product for line items — see response_payload', response_payload: pcData, request_payload: { query: pcMut, variables: pcVars }, attempted_by: by });
        return NextResponse.json({ error: 'Could not create a Wave product for line items.', response: pcData }, { status: 502 });
      }
    }

    var lineItems = [];
    var k;
    for (k = 0; k < items.length; k++) {
      lineItems.push({ productId: productId, description: items[k].description || 'Hub invoice line', quantity: Number(items[k].quantity) || 1, unitPrice: Number(items[k].unit_price) || 0 });
    }

    // v55.83-EO — LOCAL PREFLIGHT: never call Wave unless every final line item has a productId.
    var missingProduct = !productId;
    var ii;
    for (ii = 0; ii < lineItems.length; ii++) { if (!lineItems[ii].productId) { missingProduct = true; } }
    if (missingProduct) {
      var preBlock = { api_build_marker: API_BUILD_MARKER, reason: 'LOCAL_PRECHECK_MISSING_PRODUCT_ID', resolvedProductId: productId, productResolutionMode: productMode, finalItems: lineItems, message: 'Invoice push blocked locally before Wave because finalItems are missing productId.' };
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: 'Blocked locally before Wave: line items missing productId (see response_payload).', response_payload: preBlock, request_payload: { api_build_marker: API_BUILD_MARKER, resolvedProductId: productId, productResolutionMode: productMode, finalItems: lineItems }, attempted_by: by });
      return NextResponse.json({ error: preBlock.message, blocked: true, api_build_marker: API_BUILD_MARKER, response: preBlock }, { status: 409 });
    }

    var mutation = 'mutation($input: InvoiceCreateInput!){ invoiceCreate(input:$input){ didSucceed inputErrors{ message path code } invoice{ id invoiceNumber status total{ value } } } }';
    var waveMutationVariables = { input: { businessId: waveBusinessId, customerId: cust.wave_customer_id, invoiceNumber: String(inv.invoice_number), invoiceDate: inv.invoice_date || null, dueDate: inv.due_date || null, items: lineItems } };
    var reqPayload = { api_build_marker: API_BUILD_MARKER, resolvedProductId: productId, productResolutionMode: productMode, finalItems: lineItems, query: mutation, variables: waveMutationVariables };

    var resp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: mutation, variables: waveMutationVariables }) });
    var data = await resp.json();
    if (data && typeof data === 'object') { data.api_build_marker = API_BUILD_MARKER; }
    var ic = data && data.data && data.data.invoiceCreate;
    var ok = ic && ic.didSucceed && ic.invoice && ic.invoice.id;

    await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: ok ? ic.invoice.id : null, action: 'push', dry_run: false, request_payload: reqPayload, response_payload: data, success: !!ok, error_message: ok ? null : 'Wave invoiceCreate failed — see response_payload', attempted_by: by });

    if (!ok) { return NextResponse.json({ error: 'Wave did not accept the invoice. See sync log.', response: data }, { status: 502 }); }

    var verified = String(ic.invoice.invoiceNumber) === String(inv.invoice_number);
    // v55.83-FY — capture Wave's own invoice status (DRAFT vs SAVED). pushed_draft when DRAFT
    // (surfaced for repair + blocks payment push), else synced. wave_invoice_id always linked.
    var waveStatus = (ic.invoice && ic.invoice.status) ? ic.invoice.status : null;
    var newSyncStatus = (waveStatus === 'DRAFT') ? 'pushed_draft' : (verified ? 'synced' : 'pushed_unverified');
    await db.from('accounting_invoices').update({ wave_invoice_id: ic.invoice.id, wave_status: waveStatus, wave_sync_status: newSyncStatus }).eq('id', hubId);
    await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: ic.invoice.id, action: 'read_back', dry_run: false, response_payload: data, success: !!verified, error_message: verified ? null : 'Read-back number mismatch (invoice still linked)', attempted_by: by });

    return NextResponse.json({ success: true, wave_invoice_id: ic.invoice.id, verified: !!verified });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e) }, { status: 500 });
  }
}

// v55.83-EO — GET returns the build marker so the deployed route version is verifiable
// by visiting /api/wave/push-invoice directly (proves stale vs fresh without a push).
export async function GET() {
  return NextResponse.json({ route: 'push-invoice', api_build_marker: API_BUILD_MARKER });
}
