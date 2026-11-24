// v55.83-YD / YF (Codex 24 Nov) — ONE BANK LINE, ONE USE, Hub side: the REAL bank-write route (Bank Review's park / split / match), the REAL
// shared allocation maths and the shared picker helper, with an in-memory database. A line taken whole as a vendor credit refund (YD) or as
// cash taken to the bank (YF) shows nothing left and cannot be allocated; undoing that use frees it. The database side runs for real in the
// two SQL suites. Fabricated fixtures only. (The same test ships with YD and YF.)
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 800))); }
console.log('YD / YF — one bank line, one use (Bank Review route, allocation maths, pickers)');
var state = { db: null };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
function BVE(msg, status) { var e = new Error(msg); e.status = status; return e; }
stub('src/lib/bank-visibility.js', {
  BankVisibilityError: BVE, bankSuperAdminIds: function () { return ['auth1']; },
  authorizeBankIdentity: function () { return Promise.resolve({ db: state.db, profileId: 'u1', authUserId: 'auth1' }); },
  bankVisibilityErrorResponse: function (e) { return new Response(JSON.stringify({ ok: false, error: String(e && e.message) }), { status: (e && e.status) || 500 }); },
  readBankJson: function (req) { return req.json(); } });
stub('src/lib/server-permissions.js', { assertPermission: function () { return Promise.resolve({ ok: true, ctx: { isSuperAdmin: true } }); }, loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: true }); }, userHasPermission: function () { return true; }, SENSITIVE_PERMS: {} });
stub('src/lib/audit-server.js', { audit: function () { return Promise.resolve(); } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var BW = require(path.join(root, 'src/app/api/accounting/bank-write/route.js'));
var BA = require(path.join(root, 'src/lib/bank-allocation-server.js'));
var EX = require(path.join(root, 'src/lib/bank-line-exclusive.js'));
function call(body) { return BW.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
function world(use) {
  var db = new FakeDb({});
  db.t.bank_transactions = [{ id: 'L1', wave_business_id: 'US', direction: 'in', pending: false, review_status: 'unreviewed', amount: -200, amount_abs: 200, date: '2026-10-20', name: 'DEPOSIT' },
    { id: 'L2', wave_business_id: 'US', direction: 'in', pending: false, review_status: 'unreviewed', amount: -300, amount_abs: 300, date: '2026-10-21', name: 'OTHER' }];
  db.t.accounting_invoice_payments = []; db.t.payment_matches = []; db.t.bank_transaction_splits = []; db.t.unapplied_deposits = []; db.t.customer_credits = []; db.t.party_money_entries = [];
  db.t.vendor_credit_applications = use === 'vendor' ? [{ id: 'va1', kind: 'refund', bank_transaction_id: 'L1', amount: 200, voided: false }] : use === 'vendor_undone' ? [{ id: 'va1', kind: 'refund', bank_transaction_id: 'L1', amount: 200, voided: true }] : [];
  db.t.cash_entries = use === 'cash' ? [{ id: 'ce1', kind: 'deposit', deposit_bank_transaction_id: 'L1', amount: 200, voided: false }] : [];
  db.t.accounting_invoices = [{ id: 'i1', total_amount: 500, wave_imported_paid: 0, wave_business_id: 'US' }];
  state.db = db; return db;
}
(async function () {
  var kinds = [['vendor', 'vendor credit refund', /Vendor credit refund — undo the refund first/], ['cash', 'cash deposit', /Cash taken to the bank — undo that cash deposit first/]];
  for (var k = 0; k < kinds.length; k++) {
    var K = kinds[k];
    world(K[0]);
    var a = await BA.bankAllocationFor(state.db, 'L1');
    check(K[1] + ': the shared allocation maths say nothing is left on that line (200 of 200 used), with the reason', a.allocated === 200 && a.remaining === 0 && a.complete === true && a.exclusive && K[2].test(a.exclusive_label), a);
    var p = await call({ action: 'create_unapplied', txn: { id: 'L1' }, amount: 200 });
    check(K[1] + ': (2) Bank Review "park as unapplied" on that line is refused (409, available 0), nothing parked', p._status === 409 && p.available === 0 && K[2].test(p.error) && state.db.t.unapplied_deposits.length === 0, p);
    var sp = await call({ action: 'save_splits', txn: { id: 'L1' }, rows: [{ amount: 200, category: 'sales' }] });
    check(K[1] + ': (3) a split is refused too, nothing written', sp._status === 409 && state.db.t.bank_transaction_splits.length === 0, sp);
    var m = await call({ action: 'match_invoice', txn: { id: 'L1', amount_abs: 200 }, invoice: { id: 'i1', total_amount: 500 }, amount: 100 });
    check(K[1] + ': matching it to an invoice is refused, no payment or match row', m._status === 409 && state.db.t.accounting_invoice_payments.length === 0 && state.db.t.payment_matches.length === 0, m);
    var occ = await EX.occupiedLines(state.db, ['L1', 'L2']);
    check(K[1] + ': the pickers see L1 as in use and L2 as free', occ.taken.L1 && !occ.taken.L2, occ);
  }
  world('vendor_undone');
  var a2 = await BA.bankAllocationFor(state.db, 'L1');
  var p2 = await call({ action: 'create_unapplied', txn: { id: 'L1' }, amount: 200 });
  check('(4) once the refund is UNDONE (voided, kept) the line is free again: allocation 0, and parking it works', !a2.exclusive && a2.allocated === 0 && p2.ok === true && state.db.t.unapplied_deposits.length === 1, [a2, p2]);
  var occ2 = await EX.occupiedLines(state.db, ['L1']);
  check('… and from then on it is "parked" to the pickers (a refund or cash deposit can no longer take it)', occ2.taken.L1 === 'parked as an unapplied deposit', occ2);
  world('none');
  state.db.t.bank_transaction_splits = [{ bank_transaction_id: 'L2', split_amount: 100 }]; state.db.t.customer_credits = [{ source_transaction_id: 'L1', status: 'open', amount: 20 }];
  var occ3 = await EX.occupiedLines(state.db, ['L1', 'L2']);
  check('pickers: a split line and a line holding an open customer credit are both in use', occ3.taken.L1 === 'an open customer credit' && occ3.taken.L2 === 'split into lines', occ3);
  world('none');
  var ex0 = await EX.exclusiveUseOf(state.db, 'L2');
  check('an ordinary line: no exclusive use; its allocation maths are unchanged', ex0.use === null && (await BA.bankAllocationFor(state.db, 'L2')).allocated === 0);
  var errDb = world('none'); errDb.fail.vendor_credit_applications = { select: 'permission denied for table vendor_credit_applications' };
  var p3 = await call({ action: 'create_unapplied', txn: { id: 'L2' }, amount: 10 });
  check('if the check itself cannot be read, parking stops (503) — never treated as free', p3._status === 503 && /Could not check vendor credit refunds/.test(p3.error) && errDb.t.unapplied_deposits.length === 0, p3);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
