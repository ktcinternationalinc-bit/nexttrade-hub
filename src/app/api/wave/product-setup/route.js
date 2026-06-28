// /api/wave/product-setup — separate from invoice push. Lets a super_admin FIND or CREATE
// the reusable "NextTrade Hub Item" Wave product for a business, then saves its id into
// wave_business_settings.default_invoice_product_id. Invoice push reads that id and never
// creates products itself. SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var API_BUILD_MARKER = 'v55.83-MS-product-setup-mirror-select';
var API_ROUTE = '/api/wave/product-setup';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';
var APPROVED_PUSH_BUSINESS_ID = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';

function admin() {
  var url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(url, key, { auth: { persistSession: false } });
}

function saveDefault(db, bid, pid, pname, source) {
  var row = { wave_business_id: bid, default_invoice_product_id: pid, default_invoice_product_name: pname, source: source, updated_at: new Date().toISOString() };
  return db.from('wave_business_settings').upsert(row, { onConflict: 'wave_business_id' }).select().then(function (r) {
    if (r && r.error) { return { ok: false, error: r.error.message || String(r.error) }; }
    return { ok: true, row: (r && r.data && r.data.length) ? r.data[0] : row };
  }).catch(function (e) { return { ok: false, error: (e && e.message) || String(e) }; });
}

function waveMessages(payload) {
  var out = [];
  try {
    if (payload && payload.errors && payload.errors.length) {
      var i; for (i = 0; i < payload.errors.length; i++) { if (payload.errors[i] && payload.errors[i].message) { out.push(payload.errors[i].message); } }
    }
    var pc = payload && payload.data && payload.data.productCreate;
    if (pc && pc.inputErrors && pc.inputErrors.length) {
      var j; for (j = 0; j < pc.inputErrors.length; j++) {
        var ie = pc.inputErrors[j] || {};
        out.push((ie.message || 'Wave input error') + (ie.path ? (' [' + (Array.isArray(ie.path) ? ie.path.join('.') : ie.path) + ']') : ''));
      }
    }
  } catch (e) {}
  return out;
}

export async function GET() {
  return NextResponse.json({ route: API_ROUTE, api_build_marker: API_BUILD_MARKER });
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var bid = body.wave_business_id;

    // SECURITY: service-role route — requires wave.settings.manage (super_admin = all).
    var _perm = await assertPermission(db, body.user_id, 'wave.settings.manage', req);
    if (!_perm.ok) { return NextResponse.json({ error: _perm.error, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: _perm.status }); }
    var mode = body.mode || 'find';
    if (!bid) { return NextResponse.json({ error: 'wave_business_id is required.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
    if (bid === 'REAL_KTC_WAVE_BUSINESS_ID' || bid === 'TEST_WAVE_BUSINESS_ID') { return NextResponse.json({ error: 'Placeholder business id is not a real Wave business. Connect a real Wave business first.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
    // v55.83-IN — allow the approved test business OR a PRODUCTION business that a super admin has
    // unlocked (production_push_unlocked=true). This is CONFIG ONLY (sets the default invoice product);
    // real invoice/customer/payment pushes stay gated by writes_enabled + allow_*_push. Without this,
    // real KTC could never configure its default product from the Hub. assertPermission above already
    // required wave.settings.manage.
    if (bid !== APPROVED_PUSH_BUSINESS_ID) {
      var _regRes = await db.from('wave_business_registry').select('production_push_unlocked, is_production, label').eq('wave_business_id', bid).single();
      var _reg = _regRes && _regRes.data;
      // v55.83-IN (Codex) — require a real PRODUCTION registry row that is unlocked, not just the flag.
      if (!(_reg && _reg.is_production !== false && _reg.production_push_unlocked === true)) {
        return NextResponse.json({ error: 'Product setup is allowed for the approved test business, or a production business a super admin has unlocked. Open Wave Sync Center → Settings, enable "REAL production Wave push" for this business, then retry.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 403 });
      }
    }
    var token = process.env.WAVE_ACCESS_TOKEN;
    if (!token) { return NextResponse.json({ error: 'No Wave token configured (WAVE_ACCESS_TOKEN).', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }

    // LIST: return products for the selection dropdown
    if (mode === 'list') {
      var lq = 'query($bid:ID!){ business(id:$bid){ products(page:1,pageSize:100){ edges{ node{ id name isSold isArchived } } } } }';
      var lr = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: lq, variables: { bid: bid } }) });
      var ld = await lr.json();
      var ledges = ld && ld.data && ld.data.business && ld.data.business.products && ld.data.business.products.edges;
      var products = [];
      if (ledges) { var li; for (li = 0; li < ledges.length; li++) { if (ledges[li].node) { products.push(ledges[li].node); } } }
      return NextResponse.json({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE, products: products, wave: ld });
    }

    // v55.83-MS (Codex Round-3) — CACHED: the picker's source. Return the silo's Wave products from the
    // wave_products MIRROR (populated by /api/wave/sync-products across ALL pages), RLS-proof via service-role.
    // This is catalog-first — no live page-1 query, so products beyond the first 100 appear in the dropdown.
    if (mode === 'cached') {
      var cres = await db.from('wave_products').select('wave_product_id, name, description, is_sold, is_archived').eq('wave_business_id', bid).order('name', { ascending: true });
      var crows = (cres && cres.data) || [];
      var cprods = []; var cci;
      for (cci = 0; cci < crows.length; cci++) { cprods.push({ id: crows[cci].wave_product_id, name: crows[cci].name, isSold: crows[cci].is_sold, isArchived: crows[cci].is_archived }); }
      return NextResponse.json({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE, products: cprods, source: 'mirror', count: cprods.length });
    }

    // FIND: locate exact "NextTrade Hub Item" (or a provided product id) and save it
    if (mode === 'find' || mode === 'select') {
      if (mode === 'select' && body.product_id) {
        // v55.83-MS (Codex delta 4) — verify the chosen product via the wave_products MIRROR (sync-products
        // pulls ALL pages), not a live page-1/100 query, so products beyond the first 100 are selectable.
        // Reject archived / not-sold choices for the default fallback.
        var mres = await db.from('wave_products').select('wave_product_id, name, is_sold, is_archived').eq('wave_business_id', bid).eq('wave_product_id', body.product_id);
        var mrows = (mres && mres.data) || [];
        var match = mrows.length ? mrows[0] : null;
        if (!match) { return NextResponse.json({ error: 'That product was not found in the cached Wave product list for this business. Click "Refresh from Wave" to pull the latest products, then pick again.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
        if (match.is_archived === true) { return NextResponse.json({ error: 'That product is archived in Wave. Pick an active, sold product.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
        if (match.is_sold === false) { return NextResponse.json({ error: 'That product is not marked as sold (income) in Wave. Pick a sold product for invoices.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
        var savedSel = await saveDefault(db, bid, match.wave_product_id, match.name, 'manual_selected');
        if (!savedSel.ok) { return NextResponse.json({ error: 'Could not save the default product to the database: ' + savedSel.error, api_build_marker: API_BUILD_MARKER, route: API_ROUTE, saved: false, db_error: savedSel.error }, { status: 500 }); }
        return NextResponse.json({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE, saved: true, default_invoice_product_id: match.wave_product_id, default_invoice_product_name: match.name, source: 'manual_selected', saved_row: savedSel.row });
      }
      var fq = 'query($bid:ID!){ business(id:$bid){ products(page:1,pageSize:100){ edges{ node{ id name isSold isArchived } } } } }';
      var fr = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: fq, variables: { bid: bid } }) });
      var fd = await fr.json();
      var fedges = fd && fd.data && fd.data.business && fd.data.business.products && fd.data.business.products.edges;
      var foundId = null;
      var foundName = null;
      if (fedges) { var fi; for (fi = 0; fi < fedges.length; fi++) { if (fedges[fi].node && fedges[fi].node.name === 'NextTrade Hub Item' && fedges[fi].node.isArchived !== true) { foundId = fedges[fi].node.id; foundName = fedges[fi].node.name; } } }
      if (!foundId) { return NextResponse.json({ error: 'No product named exactly "NextTrade Hub Item" found in Wave. Create it in Wave (marked as sold, with an income account) or use Create, then try again.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE, found: false, wave: fd }, { status: 404 }); }
      var savedF = await saveDefault(db, bid, foundId, foundName, 'found_exact_name');
      if (!savedF.ok) { return NextResponse.json({ error: 'Could not save the default product to the database: ' + savedF.error, api_build_marker: API_BUILD_MARKER, route: API_ROUTE, saved: false, db_error: savedF.error }, { status: 500 }); }
      return NextResponse.json({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE, saved: true, default_invoice_product_id: foundId, default_invoice_product_name: foundName, source: 'found_exact_name', saved_row: savedF.row });
    }

    // CREATE: attempt productCreate HERE (isolated from invoice push), report exact Wave error
    if (mode === 'create') {
      var acctQ = 'query($bid:ID!){ business(id:$bid){ accounts(page:1,pageSize:50,types:[INCOME]){ edges{ node{ id name subtype{ name value } } } } } }';
      var acResp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: acctQ, variables: { bid: bid } }) });
      var acData = await acResp.json();
      var acEdges = acData && acData.data && acData.data.business && acData.data.business.accounts && acData.data.business.accounts.edges;
      var incomeAccountId = body.income_account_id || ((acEdges && acEdges.length && acEdges[0].node) ? acEdges[0].node.id : null);
      if (!incomeAccountId) { return NextResponse.json({ error: 'No Wave income account available. Pick or create an income account in Wave first.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE, accounts: acData }, { status: 502 }); }
      var pcMut = 'mutation($input: ProductCreateInput!){ productCreate(input:$input){ didSucceed inputErrors{ message path code } product{ id name } } }';
      // v55.83-MH - current live Wave rejects ProductCreateInput.isSold/isBought, so do not send them.
      var pcVars = { input: { businessId: bid, name: 'NextTrade Hub Item', unitPrice: '0', description: 'Reusable Hub invoice line item', incomeAccountId: incomeAccountId } };
      var pcResp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: pcMut, variables: pcVars }) });
      var pcData = await pcResp.json();
      var pc = pcData && pcData.data && pcData.data.productCreate;
      if (pc && pc.didSucceed && pc.product && pc.product.id) {
        var savedC = await saveDefault(db, bid, pc.product.id, pc.product.name || 'NextTrade Hub Item', 'created');
        if (!savedC.ok) { return NextResponse.json({ error: 'Product created in Wave but could not save default to database: ' + savedC.error, api_build_marker: API_BUILD_MARKER, route: API_ROUTE, saved: false, db_error: savedC.error, default_invoice_product_id: pc.product.id }, { status: 500 }); }
        return NextResponse.json({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE, saved: true, default_invoice_product_id: pc.product.id, source: 'created', saved_row: savedC.row });
      }
      var reasons = waveMessages(pcData);
      return NextResponse.json({ error: 'Wave rejected product creation' + (reasons.length ? (': ' + reasons.join(' | ')) : '.'), wave_error_summary: reasons.join('\n'), api_build_marker: API_BUILD_MARKER, route: API_ROUTE, request: { query: pcMut, variables: pcVars }, response: pcData, accounts: acData }, { status: 502 });
    }

    return NextResponse.json({ error: 'Unknown mode. Use list, find, select, or create.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 500 });
  }
}
