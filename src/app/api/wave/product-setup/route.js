// /api/wave/product-setup — separate from invoice push. Lets a super_admin FIND or CREATE
// the reusable "NextTrade Hub Item" Wave product for a business, then saves its id into
// wave_business_settings.default_invoice_product_id. Invoice push reads that id and never
// creates products itself. SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

var API_BUILD_MARKER = 'v55.83-EU-product-setup';
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
  return db.from('wave_business_settings').upsert(row, { onConflict: 'wave_business_id' }).then(function () { return source; }).catch(function () { return source; });
}

export async function GET() {
  return NextResponse.json({ route: API_ROUTE, api_build_marker: API_BUILD_MARKER });
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var bid = body.wave_business_id;
    var mode = body.mode || 'find';
    if (!bid) { return NextResponse.json({ error: 'wave_business_id is required.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
    if (bid === 'REAL_KTC_WAVE_BUSINESS_ID' || bid === 'TEST_WAVE_BUSINESS_ID') { return NextResponse.json({ error: 'Placeholder business id is not a real Wave business. Connect a real Wave business first.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
    if (bid !== APPROVED_PUSH_BUSINESS_ID) { return NextResponse.json({ error: 'Product setup is allowed only for the approved KANDIL EGYPT test business.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 403 }); }
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

    // FIND: locate exact "NextTrade Hub Item" (or a provided product id) and save it
    if (mode === 'find' || mode === 'select') {
      if (mode === 'select' && body.product_id) {
        // Verify the chosen product actually belongs to THIS Wave business before saving.
        var vq = 'query($bid:ID!){ business(id:$bid){ products(page:1,pageSize:100){ edges{ node{ id name isSold isArchived } } } } }';
        var vr = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: vq, variables: { bid: bid } }) });
        var vd = await vr.json();
        var vedges = vd && vd.data && vd.data.business && vd.data.business.products && vd.data.business.products.edges;
        var match = null;
        if (vedges) { var vi; for (vi = 0; vi < vedges.length; vi++) { if (vedges[vi].node && vedges[vi].node.id === body.product_id) { match = vedges[vi].node; } } }
        if (!match) { return NextResponse.json({ error: 'That product does not belong to the selected Wave business. Refresh the product list and try again.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
        if (match.isArchived === true) { return NextResponse.json({ error: 'That product is archived in Wave. Pick an active, sold product.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
        var savedSel = await saveDefault(db, bid, match.id, match.name, 'manual_selected');
        return NextResponse.json({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE, saved: true, default_invoice_product_id: match.id, default_invoice_product_name: match.name, source: savedSel });
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
      return NextResponse.json({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE, saved: true, default_invoice_product_id: foundId, default_invoice_product_name: foundName, mode: savedF });
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
      var pcVars = { input: { businessId: bid, name: 'NextTrade Hub Item', unitPrice: '0', description: 'Reusable Hub invoice line item', incomeAccountId: incomeAccountId } };
      var pcResp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: pcMut, variables: pcVars }) });
      var pcData = await pcResp.json();
      var pc = pcData && pcData.data && pcData.data.productCreate;
      if (pc && pc.didSucceed && pc.product && pc.product.id) {
        var savedC = await saveDefault(db, bid, pc.product.id, pc.product.name || 'NextTrade Hub Item', 'created');
        return NextResponse.json({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE, saved: true, default_invoice_product_id: pc.product.id, mode: savedC });
      }
      return NextResponse.json({ error: 'Wave rejected product creation. See response for the exact reason and accepted fields.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE, request: { query: pcMut, variables: pcVars }, response: pcData, accounts: acData }, { status: 502 });
    }

    return NextResponse.json({ error: 'Unknown mode. Use list, find, select, or create.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 500 });
  }
}
