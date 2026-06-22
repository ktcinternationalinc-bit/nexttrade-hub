// /api/wave/push-transaction — v55.83-KZ. Push a CATEGORIZED bank transaction to Wave as a money
// transaction via Wave's public `moneyTransactionCreate` mutation. This overturns the project's prior
// belief that "Wave's API can't accept raw transaction/category pushes" — that mutation IS on the public
// endpoint (verified by live schema introspection 2026-06-21). Gated EXACTLY like push-payment (approved
// test business OR a super-admin-unlocked production business). dry_run previews without sending.
// SWC-safe: var + string concat only.
//
// Double-entry: the bank account (Wave Cash & Bank, the silo's default payment account) is the ANCHOR;
// the assigned Wave category account is the LINE ITEM. Money-out => WITHDRAWAL anchor; money-in => DEPOSIT.
// The category line is balance:INCREASE (expense up for an out-flow, income up for an in-flow). externalId
// = a stable Hub key so Wave itself rejects a duplicate push (idempotency even if Hub state is lost).
// NOT for bank-to-bank transfers (Wave API doesn't support those) — those stay in the Hub.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business';

var API_BUILD_MARKER = 'v55.83-KZ-push-transaction';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';
var APPROVED_PUSH_BUSINESS_ID = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4'; // KANDIL EGYPT test

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function roundMoney(n) { return Math.round((Number(n) || 0) * 100) / 100; }
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
    var waveBusinessId = body.wave_business_id;
    var hubId = body.hub_record_id; // bank_transactions.id
    var by = body.user_id || null;
    var isDry = body.dry_run === true;
    var token = process.env.WAVE_ACCESS_TOKEN;

    var gate = await assertPermission(db, by, 'wave.payments.push', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error, api_build_marker: API_BUILD_MARKER }, { status: gate.status }); }
    if (!token) { return NextResponse.json({ ok: false, error: 'Wave token not configured.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (!waveBusinessId || !hubId) { return NextResponse.json({ ok: false, error: 'wave_business_id and hub_record_id are required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (isPlaceholderWaveBusiness(waveBusinessId)) { return NextResponse.json({ ok: false, placeholder: true, error: 'This silo is not connected to a real Wave business yet (placeholder id). Bind it under Accounting -> Wave Connection first.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    // Same lock gate as push-payment: approved test business, or a super-admin-unlocked production business.
    var _regRes = await db.from('wave_business_registry').select('is_production, writes_enabled, allow_payment_push, production_push_unlocked, label').eq('wave_business_id', waveBusinessId);
    var _preg = (_regRes && _regRes.data && _regRes.data.length) ? _regRes.data[0] : null;
    var _isApprovedTest = (waveBusinessId === APPROVED_PUSH_BUSINESS_ID);
    var _prodUnlocked = !!(_preg && _preg.is_production !== false && _preg.production_push_unlocked === true && _preg.writes_enabled === true && _preg.allow_payment_push === true);
    if (!_isApprovedTest && !_prodUnlocked) { return NextResponse.json({ ok: false, error: 'Production transaction push is locked. A super admin must enable real production push (writes_enabled + allow_payment_push + production unlock) for this business.', api_build_marker: API_BUILD_MARKER }, { status: 403 }); }

    // Load the bank transaction.
    var btRes = await db.from('bank_transactions').select('*').eq('id', hubId);
    var bt = (btRes && btRes.data && btRes.data.length) ? btRes.data[0] : null;
    if (!bt) { return NextResponse.json({ ok: false, error: 'Bank transaction not found.', api_build_marker: API_BUILD_MARKER }, { status: 404 }); }
    if (bt.wave_business_id && bt.wave_business_id !== waveBusinessId) { return NextResponse.json({ ok: false, error: 'This transaction belongs to a different silo.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }
    if (bt.matched_invoice_id) { return NextResponse.json({ ok: false, error: 'This deposit is matched to an invoice — it reaches Wave as an invoice PAYMENT (Bank Review), not as a categorized transaction.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (bt.category_status === 'synced' || bt.wave_transaction_id) { return NextResponse.json({ ok: false, error: 'Already pushed to Wave.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }

    var categoryAcct = bt.wave_account_id || null;
    if (!categoryAcct) { return NextResponse.json({ ok: false, error: 'No Wave category assigned — pick a Wave Category (Chart of Accounts) for this transaction first.', api_build_marker: API_BUILD_MARKER, needs_category: true }, { status: 400 }); }

    // The bank side (anchor) = the silo's configured Wave bank/deposit account.
    var setRes = await db.from('wave_business_settings').select('default_payment_account_id').eq('wave_business_id', waveBusinessId);
    var anchorAcct = (setRes && setRes.data && setRes.data.length) ? setRes.data[0].default_payment_account_id : null;
    if (!anchorAcct) { return NextResponse.json({ ok: false, error: 'No Wave bank account configured for this silo. Set it in Wave Sync Center -> Settings -> Payment deposit account (it is the bank side of the transaction).', api_build_marker: API_BUILD_MARKER, needs_payment_account: true }, { status: 400 }); }

    var amount = roundMoney(bt.amount_abs != null ? bt.amount_abs : Math.abs(Number(bt.amount) || 0));
    if (!(amount > 0)) { return NextResponse.json({ ok: false, error: 'Transaction amount must be positive.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    var dir = (bt.direction === 'in' || (bt.direction !== 'out' && Number(bt.amount) < 0)) ? 'DEPOSIT' : 'WITHDRAWAL';
    var date = String(bt.posted_date || bt.date || '').slice(0, 10);
    if (!date) { return NextResponse.json({ ok: false, error: 'Transaction date is required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    var desc = String(bt.name || bt.merchant_name || 'Bank transaction').slice(0, 140);
    var externalId = 'hub-bt-' + String(hubId);

    var input = {
      businessId: waveBusinessId, externalId: externalId, date: date, description: desc,
      anchor: { accountId: anchorAcct, amount: String(amount), direction: dir },
      lineItems: [{ accountId: categoryAcct, amount: String(amount), balance: 'INCREASE' }]
    };

    if (isDry) { return NextResponse.json({ ok: true, dry_run: true, would_send: input, api_build_marker: API_BUILD_MARKER }); }

    // Idempotency claim: mark 'syncing' only if not already synced.
    var claim = await db.from('bank_transactions').update({ category_status: 'syncing' }).eq('id', hubId).neq('category_status', 'synced').select();
    if (!(claim && claim.data && claim.data.length)) { return NextResponse.json({ ok: false, error: 'This transaction is already syncing or pushed. Refresh and check.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }

    var mutation = 'mutation($input: MoneyTransactionCreateInput!){ moneyTransactionCreate(input:$input){ didSucceed inputErrors{ message code path } transaction{ id } } }';
    var resp = await gql(token, mutation, { input: input });
    var data = resp.data;

    function logFail(msg, extra) {
      try { db.from('bank_transactions').update({ category_status: 'sync_failed' }).eq('id', hubId); } catch (e1) {}
      try { db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'bank_transaction', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: msg, request_payload: input, response_payload: Object.assign({ error: msg }, extra || {}), attempted_by: by }); } catch (e2) {}
    }

    if (data && data.errors && data.errors.length) {
      var msgs = []; var ei; for (ei = 0; ei < data.errors.length; ei++) { msgs.push(data.errors[ei].message); }
      var joined = msgs.join(' | ');
      logFail(joined, { wave_errors: data.errors });
      return NextResponse.json({ ok: false, error: 'Wave rejected the transaction: ' + joined, wave_errors: data.errors, api_build_marker: API_BUILD_MARKER }, { status: 200 });
    }
    var result = data && data.data && data.data.moneyTransactionCreate;
    var didSucceed = result && result.didSucceed === true;
    var inputErrors = (result && result.inputErrors) || [];

    if (!didSucceed || (inputErrors && inputErrors.length)) {
      var ieMsgs = []; var ii; for (ii = 0; ii < inputErrors.length; ii++) { ieMsgs.push(inputErrors[ii].message + (inputErrors[ii].path ? (' [' + inputErrors[ii].path + ']') : '')); }
      var ieJoined = ieMsgs.length ? ieMsgs.join(' | ') : (resp.okHttp ? 'Wave did not confirm the transaction (didSucceed false).' : ('HTTP ' + resp.status));
      // A duplicate externalId means it's ALREADY in Wave from a prior push — treat as success, mark synced.
      if (/external.?id/i.test(ieJoined) && /(exist|duplicate|already)/i.test(ieJoined)) {
        try { await db.from('bank_transactions').update({ category_status: 'synced', last_synced_at: new Date().toISOString() }).eq('id', hubId); } catch (eDup) {}
        return NextResponse.json({ ok: true, already_in_wave: true, message: 'This transaction was already in Wave (matched by reference). Marked synced.', api_build_marker: API_BUILD_MARKER });
      }
      logFail(ieJoined, { input_errors: inputErrors });
      return NextResponse.json({ ok: false, error: 'Wave rejected the transaction: ' + ieJoined, input_errors: inputErrors, api_build_marker: API_BUILD_MARKER }, { status: 200 });
    }

    var waveTxnId = (result.transaction && result.transaction.id) ? result.transaction.id : null;
    // Mark synced. Try to also store the Wave id (schema-safe — the column may not exist yet; externalId
    // is the real dup-guard either way).
    var patch = { category_status: 'synced', last_synced_at: new Date().toISOString() };
    var wb = await db.from('bank_transactions').update(Object.assign({}, patch, { wave_transaction_id: waveTxnId })).eq('id', hubId);
    if (wb && wb.error) { try { await db.from('bank_transactions').update(patch).eq('id', hubId); } catch (eWb) {} }
    try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'bank_transaction', hub_record_id: hubId, action: 'push', dry_run: false, success: true, wave_record_id: waveTxnId, request_payload: input, response_payload: { transaction_id: waveTxnId }, attempted_by: by }); } catch (eL) {}

    return NextResponse.json({ ok: true, wave_transaction_id: waveTxnId, message: 'Pushed to Wave (' + dir.toLowerCase() + ' ' + amount + ' -> categorized).', api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/push-transaction', marker: API_BUILD_MARKER }); }
