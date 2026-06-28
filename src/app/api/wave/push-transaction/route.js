// /api/wave/push-transaction — v55.83-MA. Push a CATEGORIZED bank transaction to Wave as a money
// transaction via Wave's public `moneyTransactionCreate` mutation (on the public endpoint; verified by live
// schema introspection 2026-06-21/22/23). Gated EXACTLY like push-payment (approved test business OR a
// super-admin-unlocked production business). dry_run previews without sending. SWC-safe: var + concat only.
//
// CURRENT MODEL (v55.83-LZ + MA — supersedes the old KZ comments):
//  - Bank side (ANCHOR) is resolved PER TRANSACTION (see resolver block below): match THIS txn's bank
//    account to its Wave Cash&Bank account by mask; else single-Wave-bank-account; else silo default. A silo
//    can have MANY bank accounts, so there is NO single global anchor.
//  - lineItems is a COMPLETE BALANCED double-entry (Wave rejects a single line — live error
//    "Transaction must have at least one debit and credit line item"). buildMoneyTxnLineItems():
//    DEPOSIT (money in)  => [{bank, DEBIT}, {category, CREDIT}]; WITHDRAWAL (money out) => [{category, DEBIT}, {bank, CREDIT}].
//  - externalId = 'hub-bt-' + bank_transactions.id => Wave itself rejects a duplicate (idempotency).
//  - NOT for bank-to-bank transfers (Wave API doesn't support those) — those stay in the Hub.
// OPEN (Codex): factor the anchor resolver into a shared src/lib/wave-bank-account-resolver.js; add a
// category-type safety classifier (block bank/cash, A/R, A/P, system categories) before live rollout.
// SCOPE NOTE: this CREATES a Wave money transaction. If a silo's bank also feeds Wave directly, the raw txn
// may already exist in Wave — see WAVE_API_TRANSACTION_EVIDENCE.md for the read/categorize-existing question.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business-shared';
import { resolveWaveBankAnchor, waveBankCashCandidates, categoryPushSafety } from '../../../../lib/wave-bank-account-resolver';

var API_BUILD_MARKER = 'v55.83-MN-push-transaction-no-feed-owner-block';
var WAVE_URL = 'https://gql.waveapps.com/graphql/public';
var APPROVED_PUSH_BUSINESS_ID = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4'; // KANDIL EGYPT test

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function roundMoney(n) { return Math.round((Number(n) || 0) * 100) / 100; }
// v55.83-MA (Codex P0: live error "Transaction must have at least one debit and credit line item.
// [input,lineItems]"). LIVE-SCHEMA introspection (2026-06-23) confirms MoneyTransactionCreateLineItemInput
// .balance is a BalanceType! enum (CREDIT, DEBIT, DECREASE, INCREASE) and lineItems is a required NON-EMPTY
// list. The error path [input,lineItems] proves Wave validates the LINE ITEMS as a complete double-entry —
// the anchor only NAMES the bank account; the line items must carry BOTH sides. So a single INCREASE line
// (the old KZ shape) is invalid. buildMoneyTxnLineItems returns the explicit debit + credit pair:
//   DEPOSIT (money in):  bank asset DEBIT, category (income/source) CREDIT.
//   WITHDRAWAL (money out): category (expense/use) DEBIT, bank asset CREDIT.
// Debits == Credits == amount, so the journal balances. (Bank-side resolution is separate; see below.)
function buildMoneyTxnLineItems(direction, bankAcctId, categoryAcctId, amtStr) {
  if (direction === 'DEPOSIT') {
    return [{ accountId: bankAcctId, amount: amtStr, balance: 'DEBIT' }, { accountId: categoryAcctId, amount: amtStr, balance: 'CREDIT' }];
  }
  return [{ accountId: categoryAcctId, amount: amtStr, balance: 'DEBIT' }, { accountId: bankAcctId, amount: amtStr, balance: 'CREDIT' }];
}
function bankTxnLogContext(bt) {
  if (!bt) { return null; }
  var amt = roundMoney(bt.amount_abs != null ? bt.amount_abs : Math.abs(Number(bt.amount) || 0));
  return {
    bank_transaction: {
      id: bt.id || null,
      description: String(bt.name || bt.merchant_name || 'Bank transaction').slice(0, 180),
      amount: amt,
      date: String(bt.posted_date || bt.date || '').slice(0, 10) || null,
      direction: bt.direction || null,
      category_name: bt.wave_account_name || null,
      category_id: bt.wave_account_id || null
    },
    api_build_marker: API_BUILD_MARKER
  };
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
    var waveBusinessId = body.wave_business_id;
    var hubId = body.hub_record_id; // bank_transactions.id
    var by = body.user_id || null;
    var isDry = body.dry_run === true;
    var token = process.env.WAVE_ACCESS_TOKEN;
    var txCtx = null;

    // v55.83-LB (Max: "nothing happened and no sync logs") — EVERY blocked/failed push now writes a
    // wave_sync_log row + returns the specific reason, so the Sync Log shows exactly what happened
    // (previously the validation 400s returned before any logging).
    async function blocked(reason, status) {
      try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId || null, entity_type: 'bank_transaction', hub_record_id: hubId || null, action: 'push', dry_run: !!isDry, success: false, error_message: reason, request_payload: txCtx, response_payload: txCtx ? Object.assign({ error: reason }, txCtx) : { error: reason, api_build_marker: API_BUILD_MARKER }, attempted_by: by }); } catch (eLB) {}
      return NextResponse.json({ ok: false, error: reason, bank_transaction: txCtx && txCtx.bank_transaction ? txCtx.bank_transaction : null, api_build_marker: API_BUILD_MARKER }, { status: status || 400 });
    }

    var gate = await assertPermission(db, by, 'wave.payments.push', req);
    if (!gate.ok) { return NextResponse.json({ ok: false, error: gate.error, api_build_marker: API_BUILD_MARKER }, { status: gate.status }); }
    if (!token) { return blocked('Wave token not configured.', 400); }
    if (!waveBusinessId || !hubId) { return NextResponse.json({ ok: false, error: 'wave_business_id and hub_record_id are required.', api_build_marker: API_BUILD_MARKER }, { status: 400 }); }
    if (isPlaceholderWaveBusiness(waveBusinessId)) { return blocked('This silo is not connected to a real Wave business yet (placeholder id). Bind it under Accounting -> Wave Connection first.', 400); }

    // Same lock gate as push-payment: approved test business, or a super-admin-unlocked production business.
    var _regRes = await db.from('wave_business_registry').select('is_production, writes_enabled, allow_payment_push, production_push_unlocked, label').eq('wave_business_id', waveBusinessId);
    var _preg = (_regRes && _regRes.data && _regRes.data.length) ? _regRes.data[0] : null;
    var _isApprovedTest = (waveBusinessId === APPROVED_PUSH_BUSINESS_ID);
    // v55.83-LB — transactions need the MASTER switches (writes_enabled + production unlock); they are
    // NOT gated on allow_payment_push (that's the payment-specific sub-toggle) so turning that off doesn't
    // wrongly block a categorized-transaction push.
    var _prodUnlocked = !!(_preg && _preg.is_production !== false && _preg.production_push_unlocked === true && _preg.writes_enabled === true);
    if (!_isApprovedTest && !_prodUnlocked) { return blocked('Production transaction push is locked. A super admin must enable real production push (Writes enabled + production unlock) for this business in Settings.', 403); }

    // Load the bank transaction.
    var btRes = await db.from('bank_transactions').select('*').eq('id', hubId);
    var bt = (btRes && btRes.data && btRes.data.length) ? btRes.data[0] : null;
    if (!bt) { return blocked('Bank transaction not found.', 404); }
    txCtx = bankTxnLogContext(bt);
    if (bt.wave_business_id && bt.wave_business_id !== waveBusinessId) { return blocked('This transaction belongs to a different silo.', 409); }
    if (bt.matched_invoice_id) { return blocked('This deposit is matched to an invoice — it reaches Wave as an invoice PAYMENT (Bank Review), not as a categorized transaction.', 400); }
    if (bt.category_status === 'synced' || bt.wave_transaction_id) { return blocked('Already pushed to Wave.', 400); }

    var categoryAcct = bt.wave_account_id || null;
    if (!categoryAcct) { return blocked('No Wave category assigned — pick a Wave Category (Chart of Accounts) for this transaction first.', 400); }

    // v55.83-MC — shared resolver + category safety + the per-account single-writer FIREWALL.
    var setRes = await db.from('wave_business_settings').select('default_payment_account_id, default_payment_account_name').eq('wave_business_id', waveBusinessId);
    var globalAcct = (setRes && setRes.data && setRes.data.length) ? setRes.data[0].default_payment_account_id : null;
    var globalName = (setRes && setRes.data && setRes.data.length) ? setRes.data[0].default_payment_account_name : null;

    // Load the silo's Wave chart-of-accounts once. select('*') is RESILIENT — if the wave_feed_owner
    // migration (sql/v55-83-MC-wave-feed-owner.sql) is not applied yet, '*' still returns the rows (the
    // column is just absent → treated as UNSET → firewall blocks with the "assign owner" message) instead
    // of erroring the whole select and breaking the push.
    var wcRes = await db.from('wave_categories').select('*').eq('wave_business_id', waveBusinessId);
    var allCats = (wcRes && wcRes.data) || [];

    // CATEGORY SAFETY — block categories that would misstate the books (bank/cash = the anchor, not a
    // category; A/R + A/P belong to the invoice/bill lanes; Wave system accounts are Wave-managed).
    var chosenCat = null; var ci; for (ci = 0; ci < allCats.length; ci++) { if (allCats[ci].wave_account_id === categoryAcct) { chosenCat = allCats[ci]; break; } }
    var catSafety = categoryPushSafety(chosenCat || { wave_account_name: bt.wave_account_name });
    if (catSafety.block) { return blocked('The Wave category "' + (bt.wave_account_name || categoryAcct) + '" cannot be used for a money transaction — it is ' + catSafety.reason, 400); }

    // BANK-SIDE ANCHOR — match THIS txn's bank account to its Wave bank account (shared resolver; suffix-
    // tolerant mask, single-bank, then silo default). A silo can have many accounts; nobody picks one per txn.
    var txnMask = null;
    if (bt.account_id) {
      var paOne = await db.from('plaid_accounts').select('mask').eq('plaid_account_id', bt.account_id).limit(1);
      txnMask = (paOne && paOne.data && paOne.data.length && paOne.data[0].mask) ? String(paOne.data[0].mask) : null;
    }
    var bankCandidates = waveBankCashCandidates(allCats);
    var resolved = resolveWaveBankAnchor({ waveBankAccts: bankCandidates, txnMask: txnMask, globalAcct: globalAcct, globalName: globalName });
    var anchorAcct = resolved.acct; var anchorName = resolved.name; var anchorVia = resolved.via;
    if (!anchorAcct) {
      var why = resolved.reason;
      if (setRes && setRes.error) { why = 'the settings table could not be read (' + (setRes.error.message || 'db error') + '); the default_payment_account_id column may be missing — run the migration sql/v55-83-LW-payment-account-columns.sql.'; }
      return blocked('Could not resolve the Wave bank account for this transaction: ' + why, 400);
    }

    // v55.83-MN — Max directive: do not block category pushes on the per-account "feed owner"
    // setting. The Hub's Wave public API path creates a categorized money transaction; Wave does
    // not expose a public mutation to edit an existing bank-feed transaction's category. If Wave's
    // bank feed also imports the same raw transaction, duplicate cleanup is an operator concern,
    // not a server-side blocker for getting the Hub category into Wave.

    var amount = roundMoney(bt.amount_abs != null ? bt.amount_abs : Math.abs(Number(bt.amount) || 0));
    if (!(amount > 0)) { return blocked('Transaction amount must be positive.', 400); }
    var dir = (bt.direction === 'in' || (bt.direction !== 'out' && Number(bt.amount) < 0)) ? 'DEPOSIT' : 'WITHDRAWAL';
    var date = String(bt.posted_date || bt.date || '').slice(0, 10);
    if (!date) { return blocked('Transaction date is required.', 400); }
    var desc = String(bt.name || bt.merchant_name || 'Bank transaction').slice(0, 140);
    var externalId = 'hub-bt-' + String(hubId);

    var amtStr = String(amount);
    var lineItems = buildMoneyTxnLineItems(dir, anchorAcct, categoryAcct, amtStr);
    var input = {
      businessId: waveBusinessId, externalId: externalId, date: date, description: desc,
      anchor: { accountId: anchorAcct, amount: amtStr, direction: dir },
      lineItems: lineItems
    };

    if (isDry) {
      var debitLine = lineItems[0].balance === 'DEBIT' ? lineItems[0] : lineItems[1];
      var creditLine = lineItems[0].balance === 'CREDIT' ? lineItems[0] : lineItems[1];
      return NextResponse.json({ ok: true, dry_run: true, anchor_account: anchorName || anchorAcct, anchor_via: anchorVia, direction: dir, amount: amount, category_account_id: categoryAcct, category_name: bt.wave_account_name || null, debit: debitLine, credit: creditLine, would_send: input, api_build_marker: API_BUILD_MARKER });
    }

    // Idempotency claim: mark 'syncing' only if not already synced.
    var claim = await db.from('bank_transactions').update({ category_status: 'syncing' }).eq('id', hubId).neq('category_status', 'synced').select();
    if (!(claim && claim.data && claim.data.length)) { return NextResponse.json({ ok: false, error: 'This transaction is already syncing or pushed. Refresh and check.', api_build_marker: API_BUILD_MARKER }, { status: 409 }); }

    var mutation = 'mutation($input: MoneyTransactionCreateInput!){ moneyTransactionCreate(input:$input){ didSucceed inputErrors{ message code path } transaction{ id } } }';
    var resp = await gql(token, mutation, { input: input });
    var data = resp.data;

    async function logFail(msg, extra) {
      // v55.83-LC (Codex) — AWAIT both writes so a Wave rejection reliably lands as sync_failed + a log row.
      try { await db.from('bank_transactions').update({ category_status: 'sync_failed' }).eq('id', hubId); } catch (e1) {}
      try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'bank_transaction', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: msg, request_payload: Object.assign({}, input, txCtx || {}), response_payload: Object.assign({ error: msg }, txCtx || {}, extra || {}), attempted_by: by }); } catch (e2) {}
    }

    if (data && data.errors && data.errors.length) {
      var msgs = []; var ei; for (ei = 0; ei < data.errors.length; ei++) { msgs.push(data.errors[ei].message); }
      var joined = msgs.join(' | ');
      await logFail(joined, { wave_errors: data.errors });
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
      await logFail(ieJoined, { input_errors: inputErrors });
      return NextResponse.json({ ok: false, error: 'Wave rejected the transaction: ' + ieJoined, input_errors: inputErrors, api_build_marker: API_BUILD_MARKER }, { status: 200 });
    }

    var waveTxnId = (result.transaction && result.transaction.id) ? result.transaction.id : null;
    // Mark synced. Try to also store the Wave id (schema-safe — the column may not exist yet; externalId
    // is the real dup-guard either way).
    var patch = { category_status: 'synced', last_synced_at: new Date().toISOString() };
    var wb = await db.from('bank_transactions').update(Object.assign({}, patch, { wave_transaction_id: waveTxnId })).eq('id', hubId);
    if (wb && wb.error) { try { await db.from('bank_transactions').update(patch).eq('id', hubId); } catch (eWb) {} }
    try { await db.from('wave_sync_log').insert({ wave_business_id: waveBusinessId, entity_type: 'bank_transaction', hub_record_id: hubId, action: 'push', dry_run: false, success: true, wave_record_id: waveTxnId, request_payload: Object.assign({}, input, txCtx || {}), response_payload: Object.assign({ transaction_id: waveTxnId }, txCtx || {}), attempted_by: by }); } catch (eL) {}

    return NextResponse.json({ ok: true, wave_transaction_id: waveTxnId, message: 'Pushed to Wave (' + dir.toLowerCase() + ' ' + amount + ' -> categorized).', api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    // v55.83-LE (workflow 1c) — if we crashed AFTER claiming 'syncing' but before a terminal write, the
    // row would vanish from Pending (which lists pending_wave_sync) with no retry path but the 409. Reset
    // it back to pending_wave_sync (best-effort, only if still 'syncing') so a failed push stays retryable.
    try { if (typeof hubId !== 'undefined' && hubId) { await db.from('bank_transactions').update({ category_status: 'pending_wave_sync' }).eq('id', hubId).eq('category_status', 'syncing'); } } catch (eRst) {}
    try { if (typeof hubId !== 'undefined' && hubId) { await db.from('wave_sync_log').insert({ wave_business_id: (typeof waveBusinessId !== 'undefined' ? waveBusinessId : null), entity_type: 'bank_transaction', hub_record_id: hubId, action: 'push', dry_run: false, success: false, error_message: (e && e.message) || String(e), attempted_by: (typeof by !== 'undefined' ? by : null) }); } } catch (eRl) {}
    return NextResponse.json({ ok: false, error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}

export async function GET() { return NextResponse.json({ ok: true, route: '/api/wave/push-transaction', marker: API_BUILD_MARKER }); }
