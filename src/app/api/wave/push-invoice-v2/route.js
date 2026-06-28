// /api/wave/push-invoice-v2 — BRAND-NEW endpoint (cannot be a stale cache of the old route).
// push ONE Hub-created, approved invoice to the selected Wave
// business (TEST only). Requires the invoice's customer to already be in Wave. Same guard
// + sync_log + read-back pattern as push-customer. SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business-shared';

var API_BUILD_MARKER = 'v55.83-MS-push-invoice-v2-perline-or-default';
var API_ROUTE = '/api/wave/push-invoice-v2';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function canPush(reg, record, waveBusinessId, unlockPhrase, dryRun) {
  if (!waveBusinessId) { return { ok: false, message: 'No accounting silo selected.' }; }
  // v55.83-KO (audit) — name the REAL blocker for a placeholder silo before the lock/approval gate.
  if (isPlaceholderWaveBusiness(waveBusinessId)) { return { ok: false, message: 'This silo is not connected to a real Wave business yet (placeholder id). Bind it under Accounting -> Wave Connection before pushing invoices.' }; }
  if (!reg) { return { ok: false, message: 'This Wave business is not registered.' }; }
  // v55.83-EF — HARD GUARD: a real push may only target the approved KANDIL EGYPT test business.
  var APPROVED = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';
  if (dryRun !== true && waveBusinessId !== APPROVED && !(reg.is_production !== false && reg.production_push_unlocked === true)) { return { ok: false, message: 'Push blocked: target Wave business is not the approved test business and is not an unlocked production business.' }; }
  if (!record || !record.wave_business_id) { return { ok: false, message: 'Invoice is not assigned to a silo.' }; }
  if (record.wave_business_id !== waveBusinessId) { return { ok: false, message: 'Invoice belongs to a different silo.' }; }
  if (record.wave_invoice_id) { return { ok: false, message: 'Invoice already exists in Wave.' }; }
  if (record.is_historical === true || record.source === 'wave_import') { return { ok: false, message: 'Historical/imported invoice cannot be pushed.' }; }
  if (record.approval_status !== 'approved') { return { ok: false, message: 'Invoice must be approved in Hub before it can be pushed to Wave.' }; }
  if (reg.writes_enabled !== true) { return { ok: false, message: 'Writes are disabled for ' + (reg.label || waveBusinessId) + '.' }; }
  if (reg.allow_invoice_push !== true) { return { ok: false, message: 'Invoice push is not enabled for ' + (reg.label || waveBusinessId) + '.' }; }
  // v55.83-HI — production push allowed ONLY when a super admin has flipped production_push_unlocked
  // (on top of writes_enabled + allow_invoice_push checked above). Absent/false → locked (default).
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
      // v55.83-MS (Codex QA #2) — the dry-run shares the REAL product preflight so it returns the SAME blocker
      // a real push would (not a client-only would_create). Customer-in-Wave + cross-silo are already checked
      // above; here resolve the default + check each line for a product (per-line OR fallback default).
      var dryCfgRes = await db.from('wave_business_settings').select('default_invoice_product_id').eq('wave_business_id', waveBusinessId);
      var dryDefault = (dryCfgRes && dryCfgRes.data && dryCfgRes.data.length) ? dryCfgRes.data[0].default_invoice_product_id : null;
      var dryUnmapped = 0; var dk;
      for (dk = 0; dk < items.length; dk++) { if (!items[dk].wave_product_id && !dryDefault) { dryUnmapped++; } }
      if (dryUnmapped > 0) {
        var dMsg = dryUnmapped + ' invoice line(s) have no Wave product and no default is set. In Wave Sync Center → Settings → Default Invoice Product, click "Refresh from Wave" and Choose a Wave product, or pick a Wave product per line on the invoice.';
        await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'dry_run', dry_run: true, success: false, error_message: dMsg, attempted_by: by });
        return NextResponse.json({ dry_run: true, blocked: true, reason: dryDefault ? 'LOCAL_PRECHECK_MISSING_PRODUCT_ID' : 'NO_DEFAULT_PRODUCT_CONFIGURED', error: dMsg, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 200 });
      }
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'dry_run', dry_run: true, success: true, request_payload: { api_build_marker: API_BUILD_MARKER }, attempted_by: by });
      return NextResponse.json({ dry_run: true, ok: true, api_build_marker: API_BUILD_MARKER, route: API_ROUTE, would_create: { invoice_number: inv.invoice_number, total: inv.total_amount, line_items: items.length, customer: cust.company_name || cust.contact_name, default_product: dryDefault || null, note: 'Preflight OK. Each line uses its own selected Wave product, or the configured default as a fallback. Hub line descriptions and amounts push exactly as entered (hideName hides the carrier name). No product is created.' } });
    }

    var token = process.env.WAVE_ACCESS_TOKEN;
    if (!token) { return NextResponse.json({ error: 'No Wave token configured (WAVE_ACCESS_TOKEN).' }, { status: 400 }); }

    // Wave invoiceCreate. Field shape validated live (scripts/introspect-invoice-item.mjs +
    // docs/wave-invoice-item-schema-proof.txt): InvoiceCreateItemInput.productId is REQUIRED;
    // description/quantity/unitPrice are per-line OVERRIDES; InvoiceCreateInput.hideName hides the carrier name.
    // v55.83-MS (Codex Round-3 deltas 1 & 3) — PER-LINE Wave product wins; the configured default is only a
    // FALLBACK for lines with no wave_product_id. The old find-by-name "NextTrade Hub Item" lookup is RETIRED:
    // the default comes solely from wave_business_settings.default_invoice_product_id (set via the catalog
    // picker — pull existing Wave products, pick one, auto-link). A default is REQUIRED only when at least one
    // line is unmapped; if every line already carries its own product, NO default is needed and push proceeds.
    var productId = null;
    var productMode = 'none';
    // configured default product for this business — the ONLY default source (no find-or-create by name)
    var cfgRes = await db.from('wave_business_settings').select('default_invoice_product_id, default_invoice_product_name, source').eq('wave_business_id', waveBusinessId);
    var cfgErr = cfgRes && cfgRes.error ? (cfgRes.error.message || String(cfgRes.error)) : null;
    var cfgRows = (cfgRes && cfgRes.data) || [];
    var cfg = cfgRows.length ? cfgRows[0] : null;
    if (cfg && cfg.default_invoice_product_id) { productId = cfg.default_invoice_product_id; productMode = 'configured_default'; }

    // PER-LINE Wave product: each line uses its own selected wave_product_id; the Settings default is only a
    // FALLBACK for lines with no selection. Wave requires productId per line, but the Hub
    // description/quantity/unitPrice still push exactly (overrides), so line descriptions are preserved.
    var lineItems = [];
    var usedFallback = 0;
    var k;
    for (k = 0; k < items.length; k++) {
      var lineProd = items[k].wave_product_id || productId || null;
      if (!items[k].wave_product_id && productId) { usedFallback++; }
      lineItems.push({ productId: lineProd, description: items[k].description || 'Hub invoice line', quantity: Number(items[k].quantity) || 1, unitPrice: Number(items[k].unit_price) || 0 });
    }

    // v55.83-MS (Codex delta 1) — LOCAL PREFLIGHT: block ONLY when a final line item still has no productId
    // (an unmapped line AND no default to fall back to). If EVERY line is mapped, no default is required and
    // NO_DEFAULT_PRODUCT_CONFIGURED must NOT fire. Catalog-first message — pull products / pick per line,
    // never "Create NextTrade Hub Item".
    var missingProduct = false;
    var ii;
    for (ii = 0; ii < lineItems.length; ii++) { if (!lineItems[ii].productId) { missingProduct = true; } }
    if (missingProduct) {
      var noDefault = (productMode === 'none');
      var blockReason = noDefault ? 'NO_DEFAULT_PRODUCT_CONFIGURED' : 'LOCAL_PRECHECK_MISSING_PRODUCT_ID';
      var setupMsg = 'Some invoice lines have no Wave product. In Wave Sync Center -> Settings -> Default Invoice Product, click "Refresh from Wave" and Choose a Wave product (auto-links as the fallback), or choose a Wave product per line on the invoice. Wave requires a product on every line as an accounting carrier; your line descriptions and amounts still push exactly as entered.';
      var preBlock = { api_build_marker: API_BUILD_MARKER, route: API_ROUTE, reason: blockReason, resolvedProductId: productId, productResolutionMode: productMode, finalItems: lineItems, settings_lookup: { row_found: !!cfg, settings_table_error: cfgErr, default_invoice_product_id: cfg ? cfg.default_invoice_product_id : null, default_invoice_product_name: cfg ? cfg.default_invoice_product_name : null, source: cfg ? cfg.source : null }, message: setupMsg };
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: setupMsg, response_payload: preBlock, request_payload: { api_build_marker: API_BUILD_MARKER, route: API_ROUTE, resolvedProductId: productId, productResolutionMode: productMode, finalItems: lineItems }, attempted_by: by });
      return NextResponse.json({ error: setupMsg, blocked: true, api_build_marker: API_BUILD_MARKER, route: API_ROUTE, reason: blockReason, settings_lookup: { row_found: !!cfg, settings_table_error: cfgErr }, response: preBlock }, { status: 409 });
    }

    var mutation = 'mutation($input: InvoiceCreateInput!){ invoiceCreate(input:$input){ didSucceed inputErrors{ message path code } invoice{ id invoiceNumber status total{ value currency{ code } } } } }';
    // v55.83-MS (Codex delta 2) — hideName:true so Wave shows the Hub line DESCRIPTIONS, not the carrier
    // product's name (the productId is only the required accounting anchor).
    var waveMutationVariables = { input: { businessId: waveBusinessId, customerId: cust.wave_customer_id, invoiceNumber: String(inv.invoice_number), invoiceDate: inv.invoice_date || null, dueDate: inv.due_date || null, hideName: true, items: lineItems } };
    var reqPayload = { api_build_marker: API_BUILD_MARKER, route: API_ROUTE, resolvedProductId: productId, productResolutionMode: productMode, finalItems: lineItems, query: mutation, variables: waveMutationVariables };

    var resp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: mutation, variables: waveMutationVariables }) });
    var data = await resp.json();
    if (data && typeof data === 'object') { data.api_build_marker = API_BUILD_MARKER; data.route = API_ROUTE; }
    var ic = data && data.data && data.data.invoiceCreate;
    var ok = ic && ic.didSucceed && ic.invoice && ic.invoice.id;

    // v55.83-KO (audit) — surface the REAL Wave reason (top-level GraphQL errors[] + invoiceCreate
    // inputErrors[]) instead of the constant "Wave did not accept the invoice", mirroring push-payment.
    var _ipParts = []; var _ip;
    if (data && data.errors && data.errors.length) { for (_ip = 0; _ip < data.errors.length; _ip++) { if (data.errors[_ip] && data.errors[_ip].message) { _ipParts.push(data.errors[_ip].message); } } }
    if (ic && ic.inputErrors && ic.inputErrors.length) { for (_ip = 0; _ip < ic.inputErrors.length; _ip++) { var _ie = ic.inputErrors[_ip]; if (_ie && _ie.message) { _ipParts.push(_ie.message + (_ie.path ? (' [' + (Array.isArray(_ie.path) ? _ie.path.join('.') : _ie.path) + ']') : '')); } } }
    var _icReason = _ipParts.length ? _ipParts.join(' | ') : (resp.ok ? 'Wave reported didSucceed=false with no error detail.' : ('HTTP ' + resp.status));

    await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: ok ? ic.invoice.id : null, action: 'push', dry_run: false, request_payload: reqPayload, response_payload: data, success: !!ok, error_message: ok ? null : _icReason, attempted_by: by });

    if (!ok) { return NextResponse.json({ error: 'Wave rejected the invoice: ' + _icReason, response: data, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 502 }); }

    // v55.83-IN — CURRENCY GUARANTEE. The Hub does not set the Wave invoice currency (Wave derives it
    // from the customer/business), so verify the currency Wave actually assigned MATCHES the Hub
    // invoice currency. A mismatch means the amounts are correct numbers in the WRONG currency — do
    // NOT silently accept it: flag it, mark the row, and surface a clear error.
    var hubCurrency = (inv.currency || 'USD').toUpperCase();
    var waveCurrency = (ic.invoice && ic.invoice.total && ic.invoice.total.currency && ic.invoice.total.currency.code) ? String(ic.invoice.total.currency.code).toUpperCase() : null;
    if (waveCurrency && waveCurrency !== hubCurrency) {
      var curMsg = 'CURRENCY MISMATCH: Hub invoice ' + inv.invoice_number + ' is ' + hubCurrency + ' but Wave created it as ' + waveCurrency + '. Wave takes the currency from the customer — set customer "' + (cust.company_name || cust.contact_name || cust.id) + '" to ' + hubCurrency + ' in Wave, delete this Wave invoice, and re-push. The amounts are otherwise wrong-currency.';
      await db.from('accounting_invoices').update({ wave_invoice_id: ic.invoice.id, wave_status: (ic.invoice.status || null), wave_sync_status: 'currency_mismatch' }).eq('id', hubId);
      await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: ic.invoice.id, action: 'push', dry_run: false, response_payload: data, success: false, error_message: curMsg, attempted_by: by });
      return NextResponse.json({ ok: false, success: false, currency_mismatch: true, hub_currency: hubCurrency, wave_currency: waveCurrency, wave_invoice_id: ic.invoice.id, error: curMsg, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 200 });
    }

    var verified = String(ic.invoice.invoiceNumber) === String(inv.invoice_number);
    // v55.83-FY — capture Wave's own invoice status. Wave creates invoices as DRAFT by default and
    // refuses payments on drafts, so record it: pushed_draft when DRAFT (surfaced for repair in the
    // Sync Center + blocks payment push), else synced. wave_invoice_id is always linked once created.
    var waveStatus = (ic.invoice && ic.invoice.status) ? ic.invoice.status : null;
    // v55.83-IN — AUTO-APPROVE: Wave creates invoices as DRAFT and refuses payments on drafts, which
    // left every pushed invoice stuck on "needs Wave status repair". Immediately approve it in Wave
    // (status-only mutation, surfaces Wave's exact error) so it lands as SAVED and is payment-ready.
    if (waveStatus === 'DRAFT') {
      try {
        var apprMut = 'mutation($input: InvoiceApproveInput!){ invoiceApprove(input:$input){ didSucceed inputErrors{ message path code } invoice{ id status } } }';
        var apprResp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: apprMut, variables: { input: { invoiceId: ic.invoice.id } } }) });
        var apprData = await apprResp.json();
        var ia = apprData && apprData.data && apprData.data.invoiceApprove;
        if (ia && ia.didSucceed && ia.invoice && ia.invoice.id) {
          waveStatus = (ia.invoice.status) ? ia.invoice.status : 'SAVED';
        }
        await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: ic.invoice.id, action: 'approve', dry_run: false, response_payload: apprData, success: !!(ia && ia.didSucceed), error_message: (ia && ia.didSucceed) ? null : 'Auto-approve after create did not succeed — invoice may need manual approval in Wave', attempted_by: by });
      } catch (eAppr) {
        await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: ic.invoice.id, action: 'approve', dry_run: false, success: false, error_message: 'Auto-approve threw: ' + ((eAppr && eAppr.message) || String(eAppr)), attempted_by: by });
      }
    }
    var newSyncStatus = (waveStatus === 'DRAFT') ? 'pushed_draft' : (verified ? 'synced' : 'pushed_unverified');
    await db.from('accounting_invoices').update({ wave_invoice_id: ic.invoice.id, wave_status: waveStatus, wave_sync_status: newSyncStatus }).eq('id', hubId);
    await logSync(db, { wave_business_id: waveBusinessId, entity_type: 'invoice', hub_record_id: hubId, wave_record_id: ic.invoice.id, action: 'read_back', dry_run: false, response_payload: data, success: !!verified, error_message: verified ? null : 'Read-back number mismatch (invoice still linked)', attempted_by: by });

    // v55.83-IN (Codex) — do NOT report a clean success when the invoice is still DRAFT (auto-approve
    // failed). The invoice exists in Wave but can't take payments yet, so surface needs_approval so
    // the UI/caller knows to use "Approve in Wave" rather than treating it as fully synced.
    if (waveStatus === 'DRAFT') {
      return NextResponse.json({ success: true, needs_approval: true, wave_status: 'DRAFT', warning: 'Invoice created in Wave but is still DRAFT (auto-approve did not succeed). Use "Approve in Wave" before pushing a payment.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE, wave_invoice_id: ic.invoice.id, verified: !!verified });
    }
    return NextResponse.json({ success: true, wave_status: waveStatus, api_build_marker: API_BUILD_MARKER, route: API_ROUTE, wave_invoice_id: ic.invoice.id, verified: !!verified });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e) }, { status: 500 });
  }
}

// v55.83-EO — GET returns the build marker so the deployed route version is verifiable
// by visiting /api/wave/push-invoice directly (proves stale vs fresh without a push).
export async function GET() {
  return NextResponse.json({ route: API_ROUTE, api_build_marker: API_BUILD_MARKER });
}
