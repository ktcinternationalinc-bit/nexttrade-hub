// /api/wave/payment-readback — v55.83-LG. READ-ONLY diagnostic: pull a business's invoices WITH their
// payments from Wave (these ARE readable, unlike money transactions) and report what we can see — payment
// amount/date/method, the bank/cash ACCOUNT each payment hit, and the transaction-link fields
// (transactionId / accountingTransactionId). This is the safe gate before building auto-linking of
// Wave-native payments to Hub deposits: it proves, on the live books, whether those link fields are
// populated and whether they match the Hub's wave_transaction_id — WITHOUT writing anything.
//
// Writes NOTHING to Wave and NOTHING to Hub data (only an optional read-only sync_log row). SWC-safe.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business-shared';

var API_BUILD_MARKER = 'v55.83-LT-payment-readback';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
// v55.83-LT — InvoicePayment.amount is a STRING scalar in Wave's API (NOT a Money{value} object like
// Invoice.total). Parse tolerantly: accept a string ("123.45"), a {value} object, or a number.
function num(m) {
  if (m == null) { return 0; }
  if (typeof m === 'object') { if (m.value == null) { return 0; } var ov = Number(String(m.value).replace(/,/g, '')); return isNaN(ov) ? 0 : ov; }
  var v = Number(String(m).replace(/[,$\s]/g, '')); return isNaN(v) ? 0 : v;
}

async function gql(token, query, variables) {
  var resp = await fetch(WAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ query: query, variables: variables }) });
  var data = null; try { data = await resp.json(); } catch (e) { data = null; }
  return { okHttp: resp.ok, status: resp.status, data: data };
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { return NextResponse.json({ ok: false, error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).', api_build_marker: API_BUILD_MARKER }, { status: 500 }); }
  var db = admin();
  try {
    var body = await req.json();
    var by = body.user_id || null;
    var waveBusinessId = body.wave_business_id || null;
    var maxPages = Math.min(Number(body.max_pages) || 4, 20); // bounded probe, not a full sweep
    var token = process.env.WAVE_ACCESS_TOKEN;

    var gate = await assertPermission(db, by, 'wave.import.run', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error, api_build_marker: API_BUILD_MARKER }, { status: gate.status }); }
    if (!token) { return NextResponse.json({ ok: false, error: 'No Wave token configured (WAVE_ACCESS_TOKEN).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (!waveBusinessId) { return NextResponse.json({ ok: false, error: 'wave_business_id is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (isPlaceholderWaveBusiness(waveBusinessId)) { return NextResponse.json({ ok: false, error: 'This silo is not connected to a real Wave business yet (placeholder id).', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    // invoice.payments is the readable path (there is NO business-level invoicePayments connection).
    // We probe with the txn-link fields (transactionId / accountingTransactionId) — these are the EXACT
    // keys LH would use to tie a Wave payment back to bank_transactions.wave_transaction_id. If Wave's
    // schema rejects them, we fall back to the safe field set and record the rejection EXPLICITLY, so LH
    // is never built on an unproven key (Codex gate requirement).
    function buildQuery(withLinkFields) {
      var payFields = 'id amount paymentDate paymentMethod memo account{ id name }' + (withLinkFields ? ' transactionId accountingTransactionId' : '');
      return 'query($bid: ID!, $page: Int!){ business(id:$bid){ invoices(page:$page, pageSize:25){ pageInfo{ currentPage totalPages totalCount } edges{ node{ id invoiceNumber status payments{ ' + payFields + ' } } } } } }';
    }

    var page = 1; var totalPages = 1; var safety = 0;
    var invoicesScanned = 0; var paymentsFound = 0; var withAccount = 0; var samples = []; var accounts = {};
    var firstError = null;
    var linkFieldsSupported = true; var linkFieldError = null; // proven by the live probe below
    var withTxnId = 0; var withAcctTxnId = 0;
    while (page <= totalPages && safety < (maxPages + 1)) {
      safety++;
      var resp = await gql(token, buildQuery(linkFieldsSupported), { bid: waveBusinessId, page: page });
      var data = resp.data;
      if (!resp.okHttp || (data && data.errors && data.errors.length)) {
        var em = (data && data.errors && data.errors[0] && data.errors[0].message) ? data.errors[0].message : ('HTTP ' + resp.status);
        // If Wave rejected the txn-link fields specifically, record it and RETRY the same page with the
        // safe field set — that's the definitive "schema does not expose them" answer LH needs.
        if (linkFieldsSupported && /transactionId|accountingTransactionId|Cannot query field/i.test(em)) {
          linkFieldsSupported = false; linkFieldError = em; safety--; continue;
        }
        firstError = em; break;
      }
      var conn = data && data.data && data.data.business && data.data.business.invoices;
      if (!conn) { firstError = 'No invoices field returned (token may not access this business).'; break; }
      if (conn.pageInfo && conn.pageInfo.totalPages) { totalPages = conn.pageInfo.totalPages; }
      var edges = conn.edges || [];
      var i; var p;
      for (i = 0; i < edges.length; i++) {
        var inv = edges[i].node; invoicesScanned++;
        var pays = (inv && inv.payments) || [];
        for (p = 0; p < pays.length; p++) {
          var pay = pays[p]; paymentsFound++;
          var acctId = pay.account && pay.account.id ? pay.account.id : null;
          if (acctId) { withAccount++; accounts[acctId] = (pay.account.name || acctId); }
          if (linkFieldsSupported && pay.transactionId) { withTxnId++; }
          if (linkFieldsSupported && pay.accountingTransactionId) { withAcctTxnId++; }
          if (samples.length < 12) {
            samples.push({ invoice: inv.invoiceNumber || inv.id, wave_payment_id: pay.id, amount: num(pay.amount), date: pay.paymentDate || null, method: pay.paymentMethod || null, memo: pay.memo || null, account_id: acctId, account_name: pay.account && pay.account.name ? pay.account.name : null, transaction_id: linkFieldsSupported ? (pay.transactionId || null) : null, accounting_transaction_id: linkFieldsSupported ? (pay.accountingTransactionId || null) : null });
          }
        }
      }
      page++;
    }

    // LH-gate verdict: which key can LH safely match Wave-native payments on?
    var linkKey = 'account+amount+date'; // always available (account is readable)
    if (linkFieldsSupported && (withTxnId > 0 || withAcctTxnId > 0)) { linkKey = (withAcctTxnId >= withTxnId ? 'accountingTransactionId' : 'transactionId') + ' (exact) + account+amount+date fallback'; }
    var result = {
      ok: !firstError || paymentsFound > 0,
      wave_business_id: waveBusinessId,
      invoices_scanned: invoicesScanned,
      pages_read: safety,
      payments_found: paymentsFound,
      payments_with_bank_account: withAccount,
      // The exact LH-gate answer Codex required: are the txn-link fields exposed, and are they populated?
      link_fields_supported: linkFieldsSupported,
      link_field_error: linkFieldError,
      payments_with_transaction_id: withTxnId,
      payments_with_accounting_transaction_id: withAcctTxnId,
      recommended_link_key: linkKey,
      distinct_bank_accounts: Object.keys(accounts).map(function (k) { return { id: k, name: accounts[k] }; }),
      samples: samples,
      note: 'READ-ONLY probe. invoice.payments + payment.account ARE readable, so Wave-native payments CAN be auto-linked to Hub deposits by ' + linkKey + '. ' + (linkFieldsSupported ? ('Wave accepts transactionId/accountingTransactionId; populated on ' + withTxnId + '/' + withAcctTxnId + ' of ' + paymentsFound + ' payments.') : ('Wave REJECTS the txn-link fields (' + (linkFieldError || 'schema mismatch') + ') → LH must match on account+amount+date, NOT an id.')) + ' Money transactions remain unreadable (CSV-only). Bounded to ' + maxPages + ' pages.',
      error: firstError || null,
      api_build_marker: API_BUILD_MARKER
    };
    try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'invoice_payment', action: 'readback_probe', dry_run: true, success: !firstError, error_message: firstError, response_payload: { invoices_scanned: invoicesScanned, payments_found: paymentsFound, payments_with_bank_account: withAccount, link_fields_supported: linkFieldsSupported, link_field_error: linkFieldError, payments_with_transaction_id: withTxnId, payments_with_accounting_transaction_id: withAcctTxnId }, attempted_by: by }); } catch (eL) {}
    return NextResponse.json(result, { status: firstError && paymentsFound === 0 ? 400 : 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/payment-readback', marker: API_BUILD_MARKER }); }
