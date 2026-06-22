// /api/wave/payment-account-setup — per-business Wave PAYMENT ACCOUNT setup. Lets a
// super_admin LIST Wave bank/cash accounts (Chart of Accounts) for a business and SELECT the
// one where invoice payments will be recorded (paymentAccountId for invoicePaymentCreateManual),
// saving it into wave_business_settings.default_payment_account_id. Read-only against Wave
// except the settings upsert. SWC-safe: var + concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';

var API_BUILD_MARKER = 'v55.83-LR-payment-account-setup';
var API_ROUTE = '/api/wave/payment-account-setup';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';
var APPROVED_PUSH_BUSINESS_ID = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';
var BAD_BIDS = { 'REAL_KTC_WAVE_BUSINESS_ID': 1, 'TEST_WAVE_BUSINESS_ID': 1 };

function admin() {
  var url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(url, key, { auth: { persistSession: false } });
}

function gql(token, query, variables) {
  return fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: query, variables: variables || {} }) }).then(function (r) { return r.json(); });
}

// v55.83-LR — PAGINATE ALL pages (was page 1 / pageSize 200, so a chart with >200 accounts hid the real
// Cash/Bank account → "200 accounts, 0 usable"). Also detect cash/bank by subtype OR (asset + bank-ish
// name), and skip archived, so the deposit account is actually selectable.
function listAccounts(token, bid) {
  var q = 'query($bid:ID!,$page:Int!){ business(id:$bid){ accounts(page:$page,pageSize:100){ pageInfo{ currentPage totalPages } edges{ node{ id name isArchived type{ value name } subtype{ name value } } } } } }';
  var out = []; var page = 1; var guard = 0;
  function loop() {
    return gql(token, q, { bid: bid, page: page }).then(function (j) {
      var acc = j && j.data && j.data.business && j.data.business.accounts;
      var edges = (acc && acc.edges) || [];
      var i;
      for (i = 0; i < edges.length; i++) {
        var n = edges[i].node;
        if (!n || n.isArchived === true) { continue; }
        var st = (n.subtype && (n.subtype.value || n.subtype.name)) || '';
        var stU = String(st).toUpperCase();
        var nmU = String(n.name || '').toUpperCase();
        var ty = (n.type && (n.type.value || n.type.name)) || '';
        var tyU = String(ty).toUpperCase();
        // A payment-capable account is a real bank/cash/money account Wave can deposit received payments
        // into. Receivables/payables/income/expense accounts are NOT valid deposit targets.
        var isReceivableOrPayable = (stU.indexOf('RECEIVABLE') >= 0 || stU.indexOf('PAYABLE') >= 0 || nmU.indexOf('RECEIVABLE') >= 0 || nmU.indexOf('PAYABLE') >= 0);
        var subtypeCashBank = (stU.indexOf('CASH_AND_BANK') >= 0 || stU.indexOf('CASH') >= 0 || stU.indexOf('BANK') >= 0 || stU.indexOf('MONEY') >= 0);
        var nameCashBank = (nmU.indexOf('CASH') >= 0 || nmU.indexOf('BANK') >= 0 || nmU.indexOf('CHECKING') >= 0 || nmU.indexOf('CHEQUING') >= 0 || nmU.indexOf('SAVINGS') >= 0 || nmU.indexOf('PAYPAL') >= 0 || nmU.indexOf('STRIPE') >= 0);
        var payable = (subtypeCashBank || (tyU.indexOf('ASSET') >= 0 && nameCashBank)) && !isReceivableOrPayable;
        out.push({ id: n.id, name: n.name, subtype: st, type: ty, payment_capable: payable });
      }
      var pi = (acc && acc.pageInfo) || {}; guard++;
      if (guard < 50 && pi.totalPages && page < pi.totalPages) { page++; return loop(); }
      return out;
    });
  }
  return loop().then(function (r) { return r; }).catch(function () { return out; });
}

function saveDefault(db, bid, accId, accName) {
  var row = { wave_business_id: bid, default_payment_account_id: accId, default_payment_account_name: accName, updated_at: new Date().toISOString() };
  return db.from('wave_business_settings').upsert(row, { onConflict: 'wave_business_id' }).select().then(function (r) {
    if (r && r.error) { return { ok: false, error: r.error.message || String(r.error) }; }
    return { ok: true, row: (r && r.data && r.data.length) ? r.data[0] : row };
  }).catch(function (e) { return { ok: false, error: (e && e.message) || String(e) }; });
}

export async function GET() {
  return NextResponse.json({ route: API_ROUTE, api_build_marker: API_BUILD_MARKER });
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var bid = body.wave_business_id;
    var mode = body.mode || 'list';
    var token = process.env.WAVE_ACCESS_TOKEN;

    // SECURITY: service-role route — requires wave.settings.manage (super_admin = all).
    var _perm = await assertPermission(db, body.user_id, 'wave.settings.manage', req);
    if (!_perm.ok) { return NextResponse.json({ error: _perm.error, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: _perm.status }); }

    if (!bid) { return NextResponse.json({ error: 'No Wave business selected.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
    if (BAD_BIDS[bid]) { return NextResponse.json({ error: 'That is a placeholder business id, not a connected Wave business.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
    if (!token) { return NextResponse.json({ error: 'Wave token not configured.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }

    // LIST: bank/cash accounts for the dropdown
    if (mode === 'list') {
      var accts = await listAccounts(token, bid);
      return NextResponse.json({ api_build_marker: API_BUILD_MARKER, route: API_ROUTE, accounts: accts });
    }

    // SELECT: verify the chosen account belongs to this business, then save it
    if (mode === 'select') {
      var accId = body.account_id;
      if (!accId) { return NextResponse.json({ error: 'No account_id provided.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
      var accounts = await listAccounts(token, bid);
      var match = null;
      var j;
      for (j = 0; j < accounts.length; j++) { if (accounts[j].id === accId) { match = accounts[j]; break; } }
      if (!match) { return NextResponse.json({ error: 'That account does not belong to the selected Wave business. Refresh the list and try again.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
      if (!match.payment_capable) { return NextResponse.json({ error: 'That account is not a bank/cash account and cannot receive payments. Pick a Cash on Hand or bank account (not Accounts Receivable).', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
      var saved = await saveDefault(db, bid, match.id, match.name);
      if (!saved.ok) { return NextResponse.json({ db_error: saved.error, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 200 }); }
      return NextResponse.json({ saved: true, default_payment_account_id: match.id, default_payment_account_name: match.name, saved_row: saved.row, api_build_marker: API_BUILD_MARKER, route: API_ROUTE });
    }

    return NextResponse.json({ error: 'Unknown mode ' + mode, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 500 });
  }
}
