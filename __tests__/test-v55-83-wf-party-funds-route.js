// ═══════════════════════════════════════════════════════════════════════════
// v55.83-WF step B — /api/accounting/party-funds, the REAL handler with an in-memory database (Max, 20 Nov 2026).
// Codex 17:30: "Step B must prove both pre-WF and post-WF behavior before anyone installs WF."
// PRE-WF = the WF database step is NOT installed: the list still shows, nothing is spendable, no write happens.
// POST-WF = installed: the database's own per-transfer state is shown and the three write actions go ONLY through the database.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('WF step B — party-funds route (real handler)');

var state = { perms: {}, db: null, superAdmin: false };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function (db, uid, perm) { return Promise.resolve(state.superAdmin || state.perms[perm] ? { ok: true, ctx: { isSuperAdmin: state.superAdmin } } : { ok: false, status: 403, ctx: { isSuperAdmin: false } }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: state.superAdmin, mp: state.perms }); },
  userHasPermission: function (ctx, perm) { return !!(ctx && ctx.mp && ctx.mp[perm]); },
});
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var R = require(path.join(root, 'src/app/api/accounting/party-funds/route.js'));
function call(body) { return R.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
var NT = 'NextTrade Industries', RTM = 'RTM Capital';

function seed(installed) {
  var db = new FakeDb({});
  db.t.paid_through_parties = [{ name: NT, kind: 'affiliate' }, { name: RTM, kind: 'service_provider' }];
  db.t.plaid_accounts = [{ plaid_account_id: 'A1', wave_business_id: US, is_private: false }, { plaid_account_id: 'AP', wave_business_id: US, is_private: true }];
  function ln(id, date, amt, who, name, acct, extra) { return Object.assign({ id: id, wave_business_id: US, account_id: acct || 'A1', direction: 'out', amount_abs: amt, date: date, posted_date: date, pending: false, review_status: 'unreviewed', third_party_payer: who, name: name || 'WIRE ' + id, merchant_name: null, transfer_group_id: null }, extra || {}); }
  db.t.bank_transactions = [
    ln('T1', '2026-09-02', 10000, NT), ln('T2', '2026-09-03', 4000, RTM),
    ln('TX', '2026-06-09', 41000, null, 'Online Transfer to CHK ...9909 transaction#: 77000001'),   // recognised from the bank text only
    ln('TP', '2026-09-04', 500, RTM, 'WIRE PRIVATE', 'AP'),                                         // from a private account
    ln('EG', '2026-09-02', 10000, NT, 'WIRE EG', 'A1', { wave_business_id: 'OTHER_BUSINESS' }),     // another company's books
    ln('OTHER', '2026-09-05', 77, null, 'ACH SOMETHING')];
  db.t.vendor_bills = [{ id: 'b1', wave_business_id: US, vendor_name: 'Kronos', bill_number: 'K-1', bill_date: '2026-09-10', category: 'trucking', total_amount: 6000, paid_via: NT, record_status: 'active', release_number: '1002-1' },
    { id: 'b2', wave_business_id: US, vendor_name: 'Rent Co', bill_number: 'R-9', bill_date: '2026-09-12', category: 'rent', total_amount: 900, paid_via: NT, record_status: 'active', release_number: null }];
  db.t.vendor_bill_payments = [{ id: 'p1', bill_id: 'b1', amount: 6000, paid_date: '2026-09-11', bank_transaction_id: 'T1', voided: false, method: 'rtm' },
    { id: 'p2', bill_id: 'b2', amount: 900, paid_date: '2026-09-20', bank_transaction_id: null, voided: false, method: 'rtm' }]; // paid through NextTrade, no transfer named
  db.t.party_money_entries = [{ id: 'f1', party: NT, bucket: 'fee', kind: 'fee_from_transfer', amount: 500, source_bank_transaction_id: 'T1', entry_date: '2026-09-20', reason: 'handling' }];
  db.t.wire_packages = [{ id: 'w1', status: 'draft', funding_txn_id: 'T1', bank_transaction_id: null, fee_amount: 0, payee_name: NT }];
  db.t.wire_package_lines = [{ id: 'l1', package_id: 'w1', bill_id: 'b2', amount: 300, is_open: true }];
  db.calls = []; db.confirmed = { T1: true };
  db.rpcs.hub_party_funds_installed = function () { return { data: installed === true, error: null }; };
  db.rpcs.hub_party_transfer_state = function (a, dbx) {
    dbx.calls.push(['state', a.p_txn]);
    if (a.p_txn === 'T1') { return { data: { found: true, party: NT, status: dbx.confirmed.T1 ? 'confirmed' : 'needs_reconciliation', amount: 10000, bills: 6000, fees: 500, held: 3500, reserved: 300, available: dbx.confirmed.T1 ? 3200 : 0 }, error: null }; }
    if (a.p_txn === 'T2') { return { data: { found: true, party: RTM, status: 'needs_reconciliation', amount: 4000, bills: 0, fees: 0, held: 4000, reserved: 0, available: 0 }, error: null }; }
    return { data: { found: false }, error: null };
  };
  db.rpcs.hub_party_transfer_set_state = function (a, dbx) { dbx.calls.push(['set_state', a.p]); if (a.p.bank_transaction_id === 'T2' && a.p.party !== RTM) { return { data: null, error: { message: 'HUB_GUARD: that transfer is not marked as sent to ' + a.p.party + '.' } }; } dbx.confirmed[a.p.bank_transaction_id] = a.p.state === 'confirmed'; return { data: { ok: true, from: 'needs_reconciliation', to: a.p.state, state: { found: true, party: a.p.party, status: a.p.state, amount: 10000, refunds: 0, bills: 6000, fees: 500, wire_fees: 0, entry_fees: 500, used: 6500, held: 3500, reserved: 300, available: 3200, remaining: 3200, requests: 1 } }, error: null }; };
  db.rpcs.hub_party_fee = function (a, dbx) { dbx.calls.push(['fee', a.p]); if (a.p.amount > 3200) { return { data: null, error: { message: 'HUB_GUARD: only $3,200.00 of this transfer is free (to bills $6,000.00, fees $500.00, reserved $300.00). Release a reservation or reverse an allocation first.' } }; } return { data: { ok: true, action: a.p.action, entry_id: 'new-fee', amount: a.p.amount, entry_date: '2026-10-05', state: { found: true, amount: 10000, bills: 6000, fees: 500 + a.p.amount, held: 3500 - a.p.amount, reserved: 300, available: 3200 - a.p.amount } }, error: null }; };
  state.db = db; return db;
}
function party(j, name) { return (j.parties || []).filter(function (p) { return p.party === name; })[0]; }
function snap(db) { return JSON.stringify([db.t.bank_transactions, db.t.vendor_bill_payments, db.t.party_money_entries, db.t.wire_packages, db.t.wire_package_lines]); }

(async function () {
  // ── permissions ──
  var db = seed(false); state.perms = {}; state.superAdmin = false;
  check('no Accounting Access → refused', (await call({ action: 'funds' }))._status === 403);
  state.perms = { 'accounting.view': true };
  check('Accounting Access alone (no Bills: View, no Advances) → refused', (await call({ action: 'funds' }))._status === 403);

  // ── PRE-WF: the database step is not installed ──
  state.perms = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true, 'bank.view_private': true };
  var before = snap(db); var j0 = await call({ action: 'funds' }); var nt0 = party(j0, NT); var rt0 = party(j0, RTM);
  check('PRE-WF: the list loads, says this part is not switched on yet (NO instruction to run any SQL), and no per-transfer database call is made', j0.ok && j0.installed === false && /not switched on yet/.test(j0.sql_missing) && !/sql|supabase|run /i.test(j0.sql_missing) && db.calls.length === 0, j0);
  check('PRE-WF: NextTrade — the 10,000 transfer with 6,000 to bills, 500 services rendered, 300 reserved, 3,500 held', nt0.transfers.length === 1 && nt0.transfers[0].sent === 10000 && nt0.transfers[0].to_bills === 6000 && nt0.transfers[0].services_rendered === 500 && nt0.transfers[0].reserved === 300 && nt0.transfers[0].held === 3500, nt0.transfers[0]);
  check('PRE-WF: NOTHING is spendable — every transfer is "needs reconciliation", available 0', nt0.transfers[0].status === 'needs_reconciliation' && nt0.transfers[0].available === 0 && nt0.totals.available === 0 && rt0.totals.available === 0);
  check('PRE-WF: the drill-down lists the bill portion and the fee that make up the figures', nt0.transfers[0].bills.length === 1 && nt0.transfers[0].bills[0].vendor === 'Kronos' && nt0.transfers[0].bills[0].portion === 6000 && nt0.transfers[0].fees.length === 1 && nt0.transfers[0].fees[0].amount === 500 && nt0.transfers[0].reserved_for[0].request_id === 'w1');
  check('a transfer known only from the bank text is listed for its company as "to confirm identity", never spendable', rt0.transfers.some(function (t) { return t.id === 'TX' && t.status === 'to_confirm_identity' && t.identity === 'bank_text' && t.available === 0; }) && rt0.identity_to_confirm_count === 1, rt0.transfers);
  check('another business\'s line and an unrelated line are in nobody\'s funds', j0.parties.every(function (p) { return p.transfers.every(function (t) { return t.id !== 'EG' && t.id !== 'OTHER'; }); }));
  check('a bill paid through NextTrade with no transfer named is counted and flagged (needs reconciliation)', nt0.paid_without_a_transfer_count === 1 && nt0.totals.paid_without_a_transfer === 900 && nt0.needs_reconciliation === true);
  check('reading changes nothing', snap(db) === before);
  state.perms['advances.manage'] = true;
  var w0 = [await call({ action: 'confirm', party: NT, bank_transaction_id: 'T1' }), await call({ action: 'unconfirm', party: NT, bank_transaction_id: 'T1' }),
    await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 100, reason: 'services', request_id: 'click-0001' }), await call({ action: 'fee_reverse', party: NT, bank_transaction_id: 'T1', amount: 100, reason: 'undo it', fee_id: 'f1', request_id: 'click-0002' })];
  check('PRE-WF: confirm, unconfirm, mark and reverse all answer 409 "not switched on yet" (no install instruction) — no database function is called, nothing changes', w0.every(function (x) { return x._status === 409 && /not switched on yet/.test(x.error) && !/\.sql|supabase/i.test(x.error); }) && db.calls.length === 0 && snap(db) === before, w0);

  // ── POST-WF: installed ──
  db = seed(true); state.perms = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true, 'bank.view_private': true };
  var j1 = await call({ action: 'funds', from: '2026-09-01', to: '2026-09-30' }); var nt1 = party(j1, NT); var rt1 = party(j1, RTM);
  check('POST-WF: the confirmed transfer shows the DATABASE\'s available (3,200 = 3,500 held − 300 reserved) and the two sides agree', j1.installed === true && nt1.transfers[0].status === 'confirmed' && nt1.transfers[0].available === 3200 && nt1.transfers[0].database_agrees === true && nt1.totals.available === 3200, nt1.transfers[0]);
  check('POST-WF: an unconfirmed transfer is not spendable and is totalled apart (RTM 4,000 not confirmed, 0 available)', rt1.transfers.filter(function (t) { return t.id === 'T2'; })[0].status === 'needs_reconciliation' && rt1.transfers.filter(function (t) { return t.id === 'T2'; })[0].available === 0 && rt1.totals.available === 0 && rt1.totals.not_confirmed >= 4000);
  check('POST-WF: the database is asked only about STAMPED transfers (never the bank-text one)', db.calls.every(function (c) { return c[0] === 'state' && c[1] !== 'TX'; }) && db.calls.length >= 2);
  check('the period block: opening 0 + sent 10,000 − bills 6,000 − services 500 = held 3,500; internal fee 500; tax line 10,000; with the plain sentence', nt1.period.funds_sent === 10000 && nt1.period.applied_to_bills === 6000 && nt1.period.fee_deduction === 500 && nt1.period.closing_held === 3500 && nt1.period.tax_professional_fees === 10000 && /Only \$500\.00 is deducted here/.test(nt1.period.words) && /^Today: /.test(nt1.words), nt1.period);

  // amounts need the sensitive permission; a private account hides
  state.perms = { 'accounting.view': true, 'bills.view': true };
  var j2 = await call({ action: 'funds' }); var nt2 = party(j2, NT);
  check('without "Bank & Financial Summary": the transfers are listed but NO amount is returned anywhere', j2.ok && nt2.totals === null && /Bank & Financial Summary/.test(nt2.totals_hidden) && nt2.transfers[0].sent === undefined && nt2.transfers[0].available === undefined && nt2.transfers[0].bills[0].portion === null && nt2.transfers[0].fees[0].amount === null && JSON.stringify(nt2).indexOf('10000') < 0 && JSON.stringify(nt2).indexOf('6000') < 0, nt2);
  // private account
  var realScope = require(path.join(root, 'src/lib/private-accounts-server.js'));
  state.perms = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true };
  var j3 = await call({ action: 'funds' }); var rt3 = party(j3, RTM);
  check('a transfer from a PRIVATE account is hidden from a person who may not see private accounts, and the company total is withheld', typeof realScope.privateScope === 'function' && rt3.transfers.every(function (t) { return t.id !== 'TP'; }) && rt3.hidden_private_transfers === 1 && rt3.totals === null && /private account/.test(rt3.totals_hidden), rt3);
  state.perms['bank.view_private'] = true;
  var j4 = await call({ action: 'funds' }); var rt4 = party(j4, RTM);
  check('… and shown to a person with the private-accounts permission', rt4.transfers.some(function (t) { return t.id === 'TP'; }) && rt4.hidden_private_transfers === 0 && rt4.totals !== null);

  // ── the write actions ──
  db = seed(true); state.perms = { 'accounting.view': true, 'bills.view': true, 'bills.manage': true, 'accounting.view_totals': true };
  var x1 = [await call({ action: 'confirm', party: NT, bank_transaction_id: 'T1' }), await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 100, reason: 'services', request_id: 'click-0003' })];
  check('without the 🔒 Advances: Manage switch the write actions are refused (403) and no database function is called — Bills: Manage is not enough', x1.every(function (x) { return x._status === 403; }) && db.calls.length === 0, x1);
  state.perms['advances.manage'] = true;
  var c1 = await call({ action: 'confirm', party: RTM, bank_transaction_id: 'T2', note: 'checked with the bank' });
  check('confirm goes through the database function with the verified person, the company and the note', c1.ok && db.calls.length === 1 && db.calls[0][0] === 'set_state' && db.calls[0][1].state === 'confirmed' && db.calls[0][1].actor === 'u1' && db.calls[0][1].party === RTM && db.calls[0][1].note === 'checked with the bank', [c1, db.calls]);
  var c2 = await call({ action: 'unconfirm', party: RTM, bank_transaction_id: 'T2' });
  check('unconfirm puts it back to needs reconciliation', c2.ok && db.calls[1][1].state === 'needs_reconciliation');
  var c3 = await call({ action: 'confirm', party: NT, bank_transaction_id: 'T2' });
  check('a refusal from the database is passed on in plain words with "Nothing was changed"', c3._status === 409 && /not marked as sent to/.test(c3.error) && /Nothing was changed/.test(c3.error), c3);
  check('a transfer in another business\'s books, a private one (for this person) and a missing one cannot be acted on', (await call({ action: 'confirm', party: NT, bank_transaction_id: 'EG' }))._status === 409 && (await call({ action: 'confirm', party: RTM, bank_transaction_id: 'TP' }))._status === 404 && (await call({ action: 'confirm', party: NT, bank_transaction_id: 'nope' }))._status === 404);
  // ── (Codex 17:51 P1) a manager who may ACT but may NOT see balances gets no figure back from any write ──
  var NUMS = /10000|10,000|6000|6,000|3500|3,500|3200|3,200|\b500\b|\b300\b/;
  state.perms = { 'accounting.view': true, 'bills.view': true, 'advances.manage': true }; // no accounting.view_totals
  var rc = await call({ action: 'confirm', party: RTM, bank_transaction_id: 'T2' });
  check('restricted manager: Confirm works and answers ONLY an acknowledgment — no amount, no state, although the database returned the full state', rc.ok === true && rc.action === 'confirm' && rc.status === 'confirmed' && rc.result === undefined && rc.state === undefined && !NUMS.test(JSON.stringify(rc)), rc);
  var ru = await call({ action: 'unconfirm', party: RTM, bank_transaction_id: 'T2' });
  check('restricted manager: Undo confirm — the same bare acknowledgment', ru.ok === true && ru.status === 'needs_reconciliation' && !NUMS.test(JSON.stringify(ru)), ru);
  var rm = await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 42, reason: 'services in October', request_id: 'click-r001' });
  check('restricted manager: Mark services rendered — acknowledgment with the entry id only (not the amount held, not what is left)', rm.ok === true && rm.action === 'fee_mark' && rm.entry_id === 'new-fee' && rm.result === undefined && !NUMS.test(JSON.stringify(rm)) && JSON.stringify(rm).indexOf('3158') < 0 && JSON.stringify(rm).indexOf('available') < 0, rm);
  var rr2 = await call({ action: 'fee_reverse', party: NT, bank_transaction_id: 'T1', amount: 42, reason: 'entered by mistake', fee_id: 'f1', request_id: 'click-r002' });
  check('restricted manager: Put back — the same', rr2.ok === true && rr2.action === 'fee_reverse' && !NUMS.test(JSON.stringify(rr2)), rr2);
  var rx = await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 5000, reason: 'far too much', request_id: 'click-r003' });
  check('restricted manager: a REFUSAL names no balance either — every amount in the database\'s message is blanked', rx._status === 409 && /Nothing was changed/.test(rx.error) && !/\$\s?\d/.test(rx.error) && !NUMS.test(rx.error) && /is free|an amount/.test(rx.error), rx);
  state.perms['accounting.view_totals'] = true;
  var fx = await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 5000, reason: 'far too much', request_id: 'click-r004' });
  check('a person WITH the summary permission still gets the full explanation in a refusal ($3,200.00 free …)', fx._status === 409 && /\$3,200\.00/.test(fx.error) && /to bills \$6,000\.00/.test(fx.error), fx);
  var fa = await call({ action: 'confirm', party: RTM, bank_transaction_id: 'T2' });
  check('… and even for that person a write answers only the acknowledgment (the screen reloads the list for figures)', fa.ok === true && fa.result === undefined && fa.state === undefined && !NUMS.test(JSON.stringify(fa)), fa);
  var again = await call({ action: 'funds' });
  check('after the writes, the permission-filtered list is what carries the figures (authorised reader sees them)', again.ok && party(again, NT).transfers[0].sent === 10000);
  state.perms = { 'accounting.view': true, 'bills.view': true, 'bills.manage': true, 'accounting.view_totals': true, 'advances.manage': true };
  var n0 = db.calls.length;
  var m1 = await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 250.129, reason: 'October handling', entry_date: '2026-10-05', request_id: 'click-0004' });
  var fc = db.calls[db.calls.length - 1];
  check('mark services rendered: one database call — action mark, amount rounded to cents, date, reason, click id, the verified person', m1.ok && db.calls.length === n0 + 1 && fc[0] === 'fee' && fc[1].action === 'mark' && fc[1].amount === 250.13 && fc[1].entry_date === '2026-10-05' && fc[1].reason === 'October handling' && fc[1].request_id === 'click-0004' && fc[1].actor === 'u1' && fc[1].party === NT && fc[1].bank_transaction_id === 'T1', fc);
  check('… and "allow a closed month" is NEVER passed for a person who is not the super admin, even if the browser asks', (await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 10, reason: 'closed month try', allow_closed: true, request_id: 'click-0005' })).ok && db.calls[db.calls.length - 1][1].allow_closed === false);
  state.superAdmin = true;
  check('… the super admin may: it is passed only when asked', (await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 10, reason: 'closed month fix', allow_closed: true, request_id: 'click-0006' })).ok && db.calls[db.calls.length - 1][1].allow_closed === true && (await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 10, reason: 'ordinary one', request_id: 'click-0007' })).ok && db.calls[db.calls.length - 1][1].allow_closed === false);
  state.superAdmin = false;
  var m2 = await call({ action: 'fee_reverse', party: NT, bank_transaction_id: 'T1', amount: 100, reason: 'entered twice', fee_id: 'entry:f1', request_id: 'click-0008' });
  check('reverse: names the fee it reverses (the "entry:" prefix of the screen id is removed)', m2.ok && db.calls[db.calls.length - 1][1].action === 'reverse' && db.calls[db.calls.length - 1][1].fee_id === 'f1');
  var n1 = db.calls.length;
  var bad = [await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 0, reason: 'x y z', request_id: 'click-0009' }), await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 10, reason: '', request_id: 'click-0010' }),
    await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 10, reason: 'ok reason' }), await call({ action: 'fee_reverse', party: NT, bank_transaction_id: 'T1', amount: 10, reason: 'ok reason', request_id: 'click-0011' }),
    await call({ action: 'fee_mark', party: 'Somebody Else', bank_transaction_id: 'T1', amount: 10, reason: 'ok reason', request_id: 'click-0012' }), await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 10, reason: 'ok reason', entry_date: '10/05/2026', request_id: 'click-0013' })];
  check('no amount, no reason, no click id, no fee to reverse, an unknown company, a badly written date → refused before the database is asked', bad.every(function (x) { return x._status === 400; }) && db.calls.length === n1, bad);
  var over = await call({ action: 'fee_mark', party: NT, bank_transaction_id: 'T1', amount: 5000, reason: 'too much', request_id: 'click-0014' });
  check('more than is free: the database refuses and the answer says so', over._status === 409 && /is free/.test(over.error), over);
  check('an unknown action is refused', (await call({ action: 'delete_everything' }))._status === 400);

  // ── the screen ──
  var P = require(path.join(root, 'src/components/FundsHeldPanel.jsx'));
  var tConf = { status: 'confirmed', available: 3200 }, tNeed = { status: 'needs_reconciliation', available: 0 }, tText = { status: 'to_confirm_identity', available: 0 }, tZero = { status: 'confirmed', available: 0 };
  var on = { canManage: true, installed: true };
  check('buttons: an unconfirmed transfer offers Confirm only; a confirmed one with money offers Mark services rendered and Undo confirm', P.transferActions(tNeed, on).confirm && !P.transferActions(tNeed, on).markFee && !P.transferActions(tNeed, on).unconfirm && P.transferActions(tConf, on).markFee && P.transferActions(tConf, on).unconfirm && !P.transferActions(tConf, on).confirm);
  check('buttons: a confirmed transfer with nothing available cannot have a fee marked; a bank-text transfer offers nothing and says to mark it first', !P.transferActions(tZero, on).markFee && !P.transferActions(tText, on).confirm && !P.transferActions(tText, on).markFee && !P.transferActions(tText, on).reverseFee && /mark this bank line/.test(P.transferActions(tText, on).why));
  check('buttons: WITHOUT the database step nothing is offered and the reason is said; same without the permission', (function () { var a1 = P.transferActions(tNeed, { canManage: true, installed: false }); var a2 = P.transferActions(tConf, { canManage: false, installed: true }); return !a1.confirm && !a1.markFee && /not switched on yet/.test(a1.why) && !a2.markFee && !a2.unconfirm && /Advances: Manage/.test(a2.why); })());
  check('status words exist for the three states and never call unconfirmed money usable', /can be used/.test(P.STATUS_WORDS.confirmed.text) && /not spendable/.test(P.STATUS_WORDS.needs_reconciliation.text) && /mark it for the company first/.test(P.STATUS_WORDS.to_confirm_identity.text));
  var ui = fs.readFileSync(path.join(root, 'src/components/FundsHeldPanel.jsx'), 'utf8');
  check('the screen saves nothing by itself: every write is one of the four server actions, each asked or typed by the person', ui.indexOf('supabase') < 0 && ui.indexOf("action: confirm ? 'confirm' : 'unconfirm'") > 0 && ui.indexOf("action: 'fee_mark'") > 0 && ui.indexOf("action: 'fee_reverse'") > 0 && ui.indexOf('window.confirm(q)') > 0 && ui.indexOf('request_id: form.click') > 0);
  check('it reads only when opened, and says the allocation date is not proof of vendor payment', ui.indexOf('if (shown && !data) { load(); }') > 0 && ui.indexOf('not proof the vendor was paid') > 0);
  var bt = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
  check('mounted on the Bills page next to the advances panel, with its import', bt.indexOf("import FundsHeldPanel from './FundsHeldPanel'") > 0 && bt.indexOf('<FundsHeldPanel userProfile={userProfile} toast={toast} onChanged={load} />') > 0 && bt.indexOf('<AdvancesPanel userProfile={userProfile} toast={toast} onChanged={load} />') > 0);
  var src = fs.readFileSync(path.join(root, 'src/app/api/accounting/party-funds/route.js'), 'utf8');
  check('the route never writes a table itself (no insert / update / delete / upsert) — only the three database functions', !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(src) && src.indexOf("rpc('hub_party_transfer_set_state'") > 0 && src.indexOf("rpc('hub_party_fee'") > 0);
  check('API route style: no arrow functions, no template strings, no const / let', !/=>/.test(src) && !/`/.test(src) && !/\b(const|let)\s/.test(src));
  check('it reads KTC USA\'s books only', (src.match(/US_WAVE_BUSINESS_ID/g) || []).length >= 4);

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
