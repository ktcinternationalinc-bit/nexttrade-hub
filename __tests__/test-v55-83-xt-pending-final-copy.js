// v55.83-XT — Max 22 Nov: "WE NEED TO IGNORE PENDING TRANSACTIONS UNLESS WE HAVE A WAY TO REMOVE IT WHEN THE FINAL
// TRANSACTION HITS THE ACCOUNT." Runs the REAL settlePendingLines on an in-memory database for the case that left live
// pending lines next to their final line: the bank-linked final line Q was archived as a copy of the same final line K
// from a second connection. Made-up amounts and references only.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var S = require(path.join(root, 'src/lib/pending-settle-server.js'));
var C = require(path.join(root, 'src/lib/pending-final-copy.js'));
var FakeDb = require('./fake-supabase').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }

var CO = 'biz-us';
function base(over) {
  var db = new FakeDb();
  db.t.bank_connections = [{ id: 'connA', institution_name: 'Chase', status: 'active' }, { id: 'connB', institution_name: 'Chase', status: 'active' }];
  db.t.plaid_accounts = [
    { plaid_account_id: 'accA', name: 'Checking', mask: '9001', connection_id: 'connA' },
    { plaid_account_id: 'accB', name: 'Checking', mask: '9001', connection_id: 'connB' },
    { plaid_account_id: 'accC', name: 'Checking', mask: '9002', connection_id: 'connB' }];
  var P = { id: 'P1', plaid_transaction_id: 'pend-1', pending: true, account_id: 'accA', connection_id: 'connA', wave_business_id: CO,
    date: '2026-11-16', amount_abs: 4321, amount: 4321, direction: 'out', iso_currency: 'USD', name: 'FIXTURE VENDOR 0001', review_status: 'unreviewed' };
  var Q = { id: 'Q1', plaid_transaction_id: 'post-1', pending_transaction_id: 'pend-1', pending: false, account_id: 'accA', connection_id: 'connA', wave_business_id: CO,
    date: '2026-11-17', posted_date: '2026-11-17', amount_abs: 4321, amount: 4321, direction: 'out', iso_currency: 'USD', name: 'FIXTURE VENDOR 0001', review_status: 'duplicate' };
  var K = { id: 'K1', plaid_transaction_id: 'other-1', pending: false, account_id: 'accB', connection_id: 'connB', wave_business_id: CO,
    date: '2026-11-17', posted_date: '2026-11-17', amount_abs: 4321, amount: 4321, direction: 'out', iso_currency: 'USD', name: 'FIXTURE VENDOR 0001', review_status: 'reviewed', classification: 'cat-1' };
  if (over) { over(P, Q, K, db); }
  db.t.bank_transactions = [P, Q, K].concat(db.extra || []);
  db.settled = [];
  db.rpcs.hub_settle_pending = function (a) {
    var p = db.t.bank_transactions.find(function (r) { return r.id === a.p_pending; });
    if (!p || p.pending !== true) { return { data: { ok: false, why: 'not pending' }, error: null }; }
    // like the real bank_duplicate_remove: the row moves OUT of bank_transactions into the restorable archive
    db.t.bank_transactions = db.t.bank_transactions.filter(function (r) { return r.id !== a.p_pending; });
    (db.archive = db.archive || []).push(p); db.settled.push({ pending: a.p_pending, posted: a.p_posted, reason: a.p_reason });
    return { data: { ok: true, carried: [] }, error: null };
  };
  db.rpcs.hub_reconcile_pending = function () { return { data: { ok: false, why: 'should not be called for an archived final line' }, error: null }; };
  db.rpcs.bank_duplicate_remove = function (a) { db.removed = (db.removed || []).concat([a]); return { data: { ok: true }, error: null }; };
  return db;
}
function row(db, id) { return db.t.bank_transactions.find(function (r) { return r.id === id; }); }
var rawQ = [{ transaction_id: 'post-1', pending: false, pending_transaction_id: 'pend-1' }];
function run(db, raw) { return S.settlePendingLines(db, { rawTxns: raw === undefined ? rawQ : raw, accountIds: ['accA'], windowStart: '2026-11-10', windowEnd: '2026-11-22', reportedAccounts: { accA: true } }); }

(async function () {
  console.log('XT — pending line retired when its final line came in through a second connection');

  var db = base(); var r = await run(db);
  check('1 pending settled into the live final line on the other connection', db.settled.length === 1 && db.settled[0].posted === 'K1', db.settled);
  check('1 pending line is no longer live (moved to the restorable archive)', !row(db, 'P1') && db.archive.length === 1 && db.archive[0].id === 'P1');
  check('1 live final line K untouched (status, category)', row(db, 'K1').review_status === 'reviewed' && row(db, 'K1').classification === 'cat-1');
  check('1 archived final line Q untouched', row(db, 'Q1').review_status === 'duplicate' && row(db, 'Q1').pending === false);
  check('1 counted as replaced via another connection', r.posted_replaced === 1 && r.via_other_connection === 1 && r.needs_person === 0, r);
  check('1 reason says restorable', /restorable/.test(db.settled[0].reason));
  check('1 no plain file-away used', !db.removed);

  db = base(function (P) { P.amount_abs = 4000; P.amount = 4000; }); r = await run(db);
  check('2 final amount differs from the hold: still retired (the final line is the truth)', db.settled.length === 1 && db.settled[0].posted === 'K1');
  check('2 reason says nothing carried over', /nothing carried over/.test(db.settled[0].reason));

  db = base(function (P, Q, K, d) { d.extra = [Object.assign({}, K, { id: 'K2', plaid_transaction_id: 'other-2' })]; }); r = await run(db);
  check('3 two live candidates: nothing retired, a person reviews', db.settled.length === 0 && row(db, 'P1') && row(db, 'P1').review_status === 'unreviewed' && r.needs_person === 1, r);

  db = base(function (P, Q, K) { K.review_status = 'duplicate'; }); r = await run(db);
  check('4 no live final line: nothing retired', db.settled.length === 0 && r.needs_person === 1);

  db = base(function (P) { P.notes = 'call the vendor'; }); r = await run(db);
  check('5 pending line with notes: left for a person', db.settled.length === 0 && r.needs_person === 1);
  db = base(function (P) { P.matched_invoice_id = 'inv-1'; }); r = await run(db);
  check('5b pending line linked to an invoice: left for a person', db.settled.length === 0);

  db = base(); r = await run(db, []);
  check('6 final line not in this sync (older): found through the archived link, retired', db.settled.length === 1 && db.settled[0].posted === 'K1', r);

  db = base(function (P, Q, K) { K.account_id = 'accC'; }); r = await run(db);
  check('7 a different last four is not the same account: nothing retired', db.settled.length === 0);
  db = base(function (P, Q, K) { K.connection_id = 'connA'; K.account_id = 'accA'; }); r = await run(db);
  check('8 same connection is not a second connection: nothing retired', db.settled.length === 0);
  db = base(function (P, Q, K) { K.wave_business_id = 'biz-other'; }); r = await run(db);
  check('9 another company: nothing retired', db.settled.length === 0);
  db = base(function (P, Q, K) { K.posted_date = '2026-11-18'; K.date = '2026-11-18'; }); r = await run(db);
  check('10 another posted day: nothing retired', db.settled.length === 0);
  db = base(function (P, Q, K) { K.name = 'FIXTURE VENDOR 0002'; }); r = await run(db);
  check('11 another description: nothing retired', db.settled.length === 0);

  db = base(); db.t.bank_transactions.push({ id: 'P9', plaid_transaction_id: 'pend-9', pending: true, account_id: 'accA', connection_id: 'connA', wave_business_id: CO, date: '2026-11-21', amount_abs: 10, direction: 'out', name: 'STILL PENDING' });
  r = await run(db, rawQ.concat([{ transaction_id: 'pend-9', pending: true }]));
  check('12 a line the bank still lists as pending is left alone', row(db, 'P9').review_status === undefined && db.settled.length === 1);

  db = base(); delete db.rpcs.hub_settle_pending; r = await run(db);
  check('13 database step missing: nothing touched (fail closed)', row(db, 'P1').review_status === 'unreviewed' && r.needs_sql === true, r);

  // Codex 18:24 P2 — the archived-final lookup fails: nothing at all is archived or settled; a healthy retry settles once
  db = base(); db.t.accounting_invoice_payments = [{ id: 'pay1', bank_transaction_id: 'K1', amount: 4321 }];
  var origFrom = db.from.bind(db); var failNext = true;
  db.from = function (table) {
    var q = origFrom(table);
    if (table !== 'bank_transactions' || !failNext) { return q; }
    var origEq = q.eq.bind(q);
    q.eq = function (k, v) { if (k === 'review_status' && v === 'duplicate') { var bad = { error: { message: 'read timeout' }, data: null }; return { limit: function () { return Promise.resolve(bad); }, then: function (a, b) { return Promise.resolve(bad).then(a, b); } }; } return origEq(k, v); };
    return q;
  };
  var snap = JSON.stringify(db.t.bank_transactions) + JSON.stringify(db.t.accounting_invoice_payments);
  r = await run(db, []);
  check('16 failed archived-final read: no archive and no settle call', db.settled.length === 0 && !db.removed, { settled: db.settled, removed: db.removed });
  check('16 P, Q, K and the payment unchanged', JSON.stringify(db.t.bank_transactions) + JSON.stringify(db.t.accounting_invoice_payments) === snap);
  check('16 sync flagged partial (error + incomplete), nothing counted as dropped', r.errors === 1 && r.incomplete === true && r.archived_lookup_failed === true && r.dropped === 0 && r.posted_replaced === 0, r);
  failNext = false;
  r = await run(db, []);
  check('17 healthy retry settles exactly once into K', db.settled.length === 1 && db.settled[0].posted === 'K1' && r.posted_replaced === 1 && !db.removed, r);
  r = await run(db, []);
  check('17 a repeat sync creates no second settlement', db.settled.length === 1 && r.posted_replaced === 0, r);
  check('17 the payment on K is unchanged', db.t.accounting_invoice_payments.length === 1 && db.t.accounting_invoice_payments[0].bank_transaction_id === 'K1');

  check('14 cheque number wins over description', C.descKey({ check_number: ' 10-55 ', name: 'x' }) === 'check1055');
  check('15 pending work block: clean line has none', C.pendingWorkBlock({ id: 'x' }) === null);

  console.log('\n' + pass + ' XT checks passed' + (failN ? ', ' + failN + ' FAILED' : ''));
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
