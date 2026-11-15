// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SO — Max, Nov 15 2026 04:41 ("Priority 1 — Fix and verify accounting before starting the mobile assistant"):
//   1 "Transfers: Check that transfers post correctly … Internal transfers must not incorrectly inflate income,
//      expenses, or totals. Verify both sides … Flag unclear rules instead of guessing."
//   2 "Close button: Add an obvious Close/Back control to transaction details and other pages opened during quick
//      actions. Return me to the previous screen while preserving my filters and position."
//   3 "Duplicate search: Add a clearly labeled 'Check for duplicates' button … Distinguish likely duplicates from
//      legitimate recurring payments and the two sides of a transfer."
//   4 "Duplicate handling: Let me review matches side by side and choose the transaction to retain. Confirmed
//      duplicates must disappear … Preserve the original record and an audit trail, with an option to restore it.
//      Simply hiding a row is insufficient."
// His screenshot: the transfer scan listed every pair twice and paired "out of •6353 → into •6353".
// The detector and both routes are RUN here on an in-memory database. The database functions themselves
// (remove / restore / tombstone, and the ledger following) are run on real Postgres in
// clickbooks/tests/qz2-ledger-drift/17_so.sql.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var D = require(path.join(root, 'src/lib/duplicate-detect.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
function id(n) { return 'b0000000-0000-0000-0000-' + ('000000000000' + n).slice(-12); }
function T(n, acc, date, amt, dir, name, x) {
  return Object.assign({ id: id(n), account_id: acc, date: date, posted_date: date, amount_abs: amt, direction: dir, name: name, merchant_name: null, plaid_transaction_id: 'plaid-' + n,
    wave_business_id: US, pending: false, review_status: 'unreviewed', iso_currency: 'USD', classification: null, transfer_group_id: null, matched_invoice_id: null, linked_id: null, created_at: '2026-10-01T00:00:' + ('0' + (n % 60)).slice(-2) + 'Z' }, x || {});
}
// The screenshot's situation: Chase •6353 connected twice (old link + reconnect), plus a savings account.
var ACCOUNTS = [
  { plaid_account_id: 'A1', name: 'PLAT BUS CHECKING', mask: '6353', connection_id: 'c1' },
  { plaid_account_id: 'A2', name: 'PLAT BUS CHECKING', mask: '6353', connection_id: 'c2' },
  { plaid_account_id: 'S1', name: 'BUS SAVINGS', mask: '6338', connection_id: 'c1' },
  { plaid_account_id: 'P1', name: 'CHECKING', mask: '6353', connection_id: 'c3' }, // another BANK with the same last four
];
var CONNS = [{ id: 'c1', institution_name: 'Chase', status: 'active' }, { id: 'c2', institution_name: 'Chase Bank', status: 'active' }, { id: 'c3', institution_name: 'PNC Bank', status: 'active' }];
var real = D.realAccounts(ACCOUNTS.map(function (a) { var c = CONNS.filter(function (x) { return x.id === a.connection_id; })[0]; return Object.assign({ institution_name: c.institution_name, connection_status: c.status }, a); }));

console.log('SO — A. finding duplicates (nothing is removed by looking)');
check('A1: the same Chase •6353 on two connections is ONE real account; PNC •6353 is a different one',
  D.realKeyOf('A1', real) === D.realKeyOf('A2', real) && D.realKeyOf('P1', real) !== D.realKeyOf('A1', real) && D.realKeyOf('S1', real) !== D.realKeyOf('A1', real));
var rowsA = [
  T(1, 'A1', '2026-10-16', 249980.46, 'out', 'WIRE OUT ACME'), T(2, 'A2', '2026-10-16', 249980.46, 'out', 'WIRE OUT ACME'),
  T(3, 'A1', '2026-10-13', 249980.46, 'in', 'DEPOSIT'), T(4, 'A2', '2026-10-13', 249980.46, 'in', 'DEPOSIT'),
  T(5, 'A1', '2026-09-01', 1500, 'out', 'RENT'), T(6, 'A1', '2026-10-01', 1500, 'out', 'RENT'),
  T(7, 'A1', '2026-08-19', 80000, 'out', 'TRANSFER TO SAV'), T(8, 'S1', '2026-08-19', 80000, 'in', 'TRANSFER FROM CHK'),
  T(9, 'A1', '2026-10-02', 42, 'out', 'COFFEE'), T(10, 'A1', '2026-10-02', 42, 'out', 'COFFEE'),
  T(11, 'A1', '2026-10-05', 300, 'out', 'VENDOR X', { plaid_transaction_id: null }), T(12, 'A1', '2026-10-05', 300, 'out', 'VENDOR X', { plaid_transaction_id: null }),
  T(13, 'A1', '2026-10-07', 900, 'out', 'CHECK', { check_number: '1041' }), T(14, 'A1', '2026-10-07', 900, 'out', 'CHECK', { check_number: '1042' }),
  T(15, 'A1', '2026-10-09', 77, 'out', 'PAYEE Q'), T(16, 'P1', '2026-10-09', 77, 'out', 'PAYEE Q'),
  T(17, 'A1', '2026-10-10', 55, 'out', 'PENDING ONE', { pending: true }), T(18, 'A2', '2026-10-10', 55, 'out', 'PENDING ONE'),
  T(19, 'A1', '2026-10-11', 610, 'out', 'ACH DEBIT GAS CO'), T(20, 'A2', '2026-10-12', 610, 'out', 'GAS COMPANY PMT'),
];
var a = D.findDuplicates(rowsA, { real: real });
function grp(n1) { return a.groups.filter(function (g) { return g.rows.some(function (r) { return r.id === id(n1); }); })[0]; }
check('A2: the screenshot pattern — the same line on both connections is "same bank line, brought in twice" (out AND in)',
  grp(1) && grp(1).kind === 'same_line' && grp(1).rows.length === 2 && grp(3) && grp(3).kind === 'same_line', a.groups.map(function (g) { return g.kind; }));
check('A3: a deposit and a payment of the same size in ONE account are NOT a duplicate of each other (opposite direction)', !grp(1).rows.some(function (r) { return r.id === id(3); }));
check('A4: a monthly payment (same payee, same amount, a month apart) is LEFT ALONE and counted as recurring', !grp(5) && !grp(6) && a.stats.recurring >= 1, a.stats);
check('A5: the two sides of a transfer (out of checking, into savings) are LEFT ALONE and counted', !grp(7) && !grp(8) && a.stats.transfer_sides === 1, a.stats);
check('A6: two identical lines the BANK FEED itself lists on one connection → only "possible", with a warning to check the statement',
  grp(9) && grp(9).kind === 'possible' && /two separate lines/.test(grp(9).why[0]));
check('A7: the same line typed in or uploaded twice on one account → "likely duplicate"', grp(11) && grp(11).kind === 'likely');
check('A8: two different cheque numbers are two payments — never offered', !grp(13) && !grp(14));
check('A9: the same last four at a DIFFERENT bank is a different account — never offered', !grp(15));
check('A10: a pending line is never compared (the bank replaces it when it settles)', !grp(17) && !grp(18));
check('A11: same account and amount a day apart on two connections but different wording → "possible", says the descriptions differ', grp(19) && grp(19).kind === 'possible' && /descriptions differ/.test(grp(19).why[0]));
check('A12: the strongest groups come first, largest amount first', a.groups[0].kind === 'same_line' && a.groups[0].amount === 249980.46);
var keepWork = D.findDuplicates([T(1, 'A1', '2026-10-16', 500, 'out', 'X'), T(2, 'A2', '2026-10-16', 500, 'out', 'X', { review_status: 'reviewed', classification: 'freight' })], { real: real });
check('A13: the copy that already has work on it (reviewed, categorized) is the one suggested to keep', keepWork.groups[0].suggest_keep_id === id(2));
var keepOld = D.findDuplicates([T(2, 'A2', '2026-10-16', 500, 'out', 'X'), T(1, 'A1', '2026-10-16', 500, 'out', 'X')], { real: real });
check('A14: with nothing to choose between them, the one the Hub has had longest is suggested', keepOld.groups[0].suggest_keep_id === id(1));
var dis = {}; dis[D.pairKey(id(1), id(2))] = true;
check('A15: a pair a person marked "not duplicates" is never offered again', !D.findDuplicates(rowsA, { real: real, dismissed: dis }).groups.some(function (g) { return g.rows.some(function (r) { return r.id === id(1); }); }));
var three = D.findDuplicates([T(1, 'A1', '2026-10-16', 500, 'out', 'X'), T(2, 'A2', '2026-10-16', 500, 'out', 'X'), T(3, 'A1', '2026-10-17', 500, 'out', 'X', { plaid_transaction_id: null })], { real: real });
check('A16: three copies form ONE group of three (not three overlapping pairs)', three.groups.length === 1 && three.groups[0].rows.length === 3);
check('A17: different currency, or one cent different → not the same line', D.findDuplicates([T(1, 'A1', '2026-10-16', 500, 'out', 'X'), T(2, 'A2', '2026-10-16', 500, 'out', 'X', { iso_currency: 'EGP' }), T(3, 'A2', '2026-10-16', 500.01, 'out', 'X')], { real: real }).groups.length === 0);
var only = {}; only[id(18)] = true;
check('A18: "new imports only" shows just the groups that contain a newly imported line', D.findDuplicates(rowsA, { real: real, onlyIds: only }).groups.length === 0 && (function () { var o = {}; o[id(2)] = true; var r = D.findDuplicates(rowsA, { real: real, onlyIds: o }); return r.groups.length === 1 && r.groups[0].rows.some(function (x) { return x.id === id(2); }); })());
check('A19: a line already marked duplicate earlier is not compared again', D.findDuplicates([T(1, 'A1', '2026-10-16', 500, 'out', 'X'), T(2, 'A2', '2026-10-16', 500, 'out', 'X', { review_status: 'duplicate' })], { real: real }).groups.length === 0);
check('A20: bad input never throws', D.findDuplicates(null).groups.length === 0 && D.findDuplicates([null, {}, { id: 'x' }], {}).groups.length === 0);

// ── routes on an in-memory database ──
function fresh() {
  var db = new MemDB({
    users: [{ id: 'u1', name: 'Staff', role: 'staff', active: true }, { id: 'u2', name: 'Viewer', role: 'staff', active: true }],
    module_permissions: ['accounting.clickbooks.access', 'bank.classify'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; })
      .concat([{ user_id: 'u2', module_name: 'accounting.clickbooks.access', has_access: true }]),
    plaid_accounts: JSON.parse(JSON.stringify(ACCOUNTS)), bank_connections: JSON.parse(JSON.stringify(CONNS)),
    bank_transactions: JSON.parse(JSON.stringify(rowsA)),
    bank_transaction_duplicates: [], bank_duplicate_dismissals: [], hub_audit_log: [], audit_log: [],
    payment_matches: [], accounting_invoice_payments: [], bank_transaction_splits: [], unapplied_deposits: [], customer_credits: [], vendor_bill_payments: [], wire_packages: [],
    expense_categories: [], us_expense_rules: [],
  });
  // JS stand-ins for the two database functions (the real ones are proven on Postgres in 17_so.sql)
  db.rpcs = {
    bank_duplicate_remove: function (a, d) {
      var t = d.t.bank_transactions.filter(function (x) { return x.id === a.p_dup; })[0];
      if (!t) { return { ok: false, why: 'That transaction is not in the books (it may already have been removed).' }; }
      if (a.p_keep) {
        var k = d.t.bank_transactions.filter(function (x) { return x.id === a.p_keep; })[0];
        if (!k) { return { ok: false, why: 'The transaction to keep was not found.' }; }
        if (Math.round(k.amount_abs * 100) !== Math.round(t.amount_abs * 100)) { return { ok: false, why: 'The two amounts differ, so they are not the same bank line.' }; }
        if (k.direction !== t.direction) { return { ok: false, why: 'One is money in and the other is money out — those are the two sides of a transfer, not a duplicate.' }; }
      }
      if (t.matched_invoice_id) { return { ok: false, why: 'This transaction is matched to an invoice. Keep this one instead, or unmatch it first.', blocked_by: 'invoice match' }; }
      if (t.transfer_group_id) { return { ok: false, why: 'This transaction is linked as one side of a transfer.', blocked_by: 'transfer' }; }
      d.t.bank_transaction_duplicates.push({ seq: d.t.bank_transaction_duplicates.length + 1, id: t.id, kept_id: a.p_keep, account_id: t.account_id, tx_date: t.date, direction: t.direction, amount_abs: t.amount_abs, row_data: JSON.parse(JSON.stringify(t)), reason: a.p_reason, status: 'removed', removed_by: a.p_actor, removed_at: new Date().toISOString() });
      d.t.bank_transactions = d.t.bank_transactions.filter(function (x) { return x.id !== t.id; });
      return { ok: true, removed: t.id, kept: a.p_keep, date: t.date, amount: t.amount_abs };
    },
    bank_duplicate_restore: function (a, d) {
      var r = d.t.bank_transaction_duplicates.filter(function (x) { return x.id === a.p_id && x.status === 'removed'; })[0];
      if (!r) { return { ok: false, why: 'That transaction is not in the removed list (it may already have been restored).' }; }
      r.status = 'restored'; r.restored_by = a.p_actor; r.restored_at = new Date().toISOString();
      d.t.bank_transactions.push(JSON.parse(JSON.stringify(r.row_data)));
      return { ok: true, restored: r.id, date: r.tx_date, amount: r.amount_abs };
    },
  };
  return db;
}
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = fresh();
var dupRoute = require(path.join(root, 'src/app/api/accounting/duplicates/route.js'));
var expRoute = require(path.join(root, 'src/app/api/accounting/expense-rules/route.js'));
function mk(route, defUser) { return async function (body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: defUser || 'u1' }, body)); }, headers: new Map() }); return res.json(); }; }
var dup = mk(dupRoute); var exp = mk(expRoute);
function sum(dir) { var s = 0; global.__db.t.bank_transactions.forEach(function (t) { if (t.direction === dir && t.pending !== true) { s += Math.round(t.amount_abs * 100); } }); return s / 100; }

(async function () {
  console.log('SO — B. Check for duplicates → review → remove → restore (route run on an in-memory database)');
  var noPerm = await mk(dupRoute, 'u2')({ action: 'scan' });
  check('B1: checking for duplicates needs the bank categorizing permission (Accounting Access alone is refused)', noPerm.ok === false && noPerm.denied === true, noPerm);
  var before = { out: sum('out'), in_: sum('in'), n: global.__db.t.bank_transactions.length };
  var s1 = await dup({ action: 'scan' });
  check('B2: the scan reports groups, what it left alone, and changes nothing', s1.ok && s1.group_count === 5 && s1.stats.transfer_sides === 1 && s1.stats.recurring >= 1 && global.__db.t.bank_transactions.length === before.n && s1.installed === true, { c: s1.group_count, st: s1.stats, e: s1.error });
  var g1 = s1.groups.filter(function (g) { return g.rows.some(function (r) { return r.id === id(1); }); })[0];
  check('B3: each copy is shown side by side with its account, bank, where it came from and its status', g1 && g1.rows[0].account === 'PLAT BUS CHECKING •6353' && /Chase/.test(g1.rows[0].bank) && g1.rows[0].source === 'Bank feed' && g1.rows[0].source_id && g1.rows[0].review_status === 'unreviewed', g1 && g1.rows[0]);
  var bad = await dup({ action: 'remove', dup_id: id(3), keep_id: id(1) });
  check('B4: asking to remove money-in as a "duplicate" of money-out is refused with the reason (two sides of a transfer)', bad.ok === false && /two sides of a transfer/.test(bad.error) && global.__db.t.bank_transactions.length === before.n, bad);
  var bad2 = await dup({ action: 'remove', dup_id: id(5), keep_id: id(1) });
  check('B5: different amounts are refused — money is never matched loosely', bad2.ok === false && /amounts differ/.test(bad2.error), bad2);
  var rm = await dup({ action: 'remove', dup_id: id(2), keep_id: id(1), reason: 'same line twice' });
  check('B6: a confirmed duplicate LEAVES the live transactions (not just hidden) and its whole original is kept on file',
    rm.ok && !global.__db.t.bank_transactions.some(function (t) { return t.id === id(2); }) && global.__db.t.bank_transaction_duplicates.length === 1 && global.__db.t.bank_transaction_duplicates[0].row_data.name === 'WIRE OUT ACME' && global.__db.t.bank_transaction_duplicates[0].kept_id === id(1), rm);
  check('B7: money out across live transactions drops by exactly the duplicate ($249,980.46); money in is untouched', Math.round((before.out - sum('out')) * 100) === 24998046 && sum('in') === before.in_, { was: before.out, now: sum('out') });
  check('B8: the removal is on the audit trail with who, what was kept, the amount and the reason',
    global.__db.t.hub_audit_log.some(function (l) { return l.action === 'bank_duplicate_removed' && String(l.entity_id) === id(2) && JSON.stringify(l).indexOf(id(1)) > 0; }), global.__db.t.hub_audit_log.slice(-1));
  var s2 = await dup({ action: 'scan' });
  check('B9: after removal that group is gone from the next check, and the removed count shows 1', s2.group_count === 4 && s2.removed_count === 1 && !s2.groups.some(function (g) { return g.rows.some(function (r) { return r.id === id(1); }); }));
  global.__db.t.bank_transactions.filter(function (t) { return t.id === id(4); })[0].matched_invoice_id = 'inv-1';
  var s3 = await dup({ action: 'scan' });
  var g3 = s3.groups.filter(function (g) { return g.rows.some(function (r) { return r.id === id(3); }); })[0];
  check('B10: the copy that is matched to an invoice is marked "can only be kept" and is the suggested keeper', g3 && g3.suggest_keep_id === id(4) && g3.rows.filter(function (r) { return r.id === id(4); })[0].protected === true && /invoice/.test(g3.rows.filter(function (r) { return r.id === id(4); })[0].protected_why), g3);
  var prot = await dup({ action: 'remove', dup_id: id(4), keep_id: id(3) });
  check('B11: trying to remove the matched copy is refused — keep that one, or unmatch first', prot.ok === false && prot.blocked_by === 'invoice match' && global.__db.t.bank_transactions.some(function (t) { return t.id === id(4); }), prot);
  var dz = await dup({ action: 'dismiss', ids: [id(9), id(10)] });
  var s4 = await dup({ action: 'scan' });
  check('B12: "Not duplicates — leave both" is remembered: the pair is not offered again', dz.ok && !s4.groups.some(function (g) { return g.rows.some(function (r) { return r.id === id(9); }); }) && global.__db.t.bank_transactions.some(function (t) { return t.id === id(9); }), dz);
  var lst = await dup({ action: 'removed_list' });
  check('B13: the removed list shows what was taken out, when, by whom and why', lst.ok && lst.removed.length === 1 && lst.removed[0].amount === 249980.46 && lst.removed[0].removed_by === 'Staff' && lst.removed[0].reason === 'same line twice' && lst.removed[0].account === 'PLAT BUS CHECKING •6353', lst);
  var rs = await dup({ action: 'restore', id: id(2) });
  check('B14: Restore puts the transaction back exactly as it was, and the totals return to where they started',
    rs.ok && global.__db.t.bank_transactions.some(function (t) { return t.id === id(2) && t.name === 'WIRE OUT ACME' && t.amount_abs === 249980.46; }) && sum('out') === before.out, rs);
  check('B15: the restore is on the audit trail and the record stays as history', global.__db.t.hub_audit_log.some(function (l) { return l.action === 'bank_duplicate_restored'; }) && global.__db.t.bank_transaction_duplicates[0].status === 'restored');
  var rs2 = await dup({ action: 'restore', id: id(2) });
  check('B16: restoring twice is refused, not repeated', rs2.ok === false && /already have been restored/.test(rs2.error), rs2);
  var many = await dup({ action: 'remove_many', pairs: [{ dup_id: id(2), keep_id: id(1) }, { dup_id: id(4), keep_id: id(3) }] });
  check('B17: a confirmed batch removes what it can and reports the rest with the reason (the matched one stays)', many.removed === 1 && many.failed.length === 1 && /matched to an invoice/.test(many.failed[0].why) && many.ok === false, many);
  var again = await dup({ action: 'remove', dup_id: id(2), keep_id: id(1) });
  check('B18: pressing remove twice (a retry) does nothing the second time', again.ok === false && /already have been removed/.test(again.error) && global.__db.t.bank_transaction_duplicates.filter(function (x) { return x.status === 'removed'; }).length === 1, again);
  delete global.__db.rpcs.bank_duplicate_remove;
  var nosql = await dup({ action: 'remove', dup_id: id(12), keep_id: id(11) });
  check('B19: before the database step is run, removal says so plainly and nothing changes', nosql.ok === false && nosql.needs_sql === true && /run the v55\.83-SO SQL/.test(nosql.error) && global.__db.t.bank_transactions.some(function (t) { return t.id === id(12); }), nosql);
  var badId = await dup({ action: 'remove', dup_id: 'not-an-id', keep_id: id(11) });
  check('B20: a malformed request is refused', badId.ok === false);

  console.log('SO — C. Transfers (the screenshot bug)');
  global.__db = fresh();
  var sg = await exp({ action: 'transfer_suggestions' });
  var same = (sg.suggestions || []).filter(function (p) { return p.out.account === p.inn.account && D.realKeyOf(global.__db.t.bank_transactions.filter(function (t) { return t.id === p.out.id; })[0].account_id, real) === D.realKeyOf(global.__db.t.bank_transactions.filter(function (t) { return t.id === p.inn.id; })[0].account_id, real); });
  check('C1: the scan NEVER pairs an account with itself — "out of •6353 → into •6353" is gone', sg.ok && same.length === 0, { e: sg.error, same: same });
  var amts = (sg.suggestions || []).map(function (p) { return p.amount; });
  check('C2: each transfer is offered ONCE, not once per connection (no repeated pairs)', amts.filter(function (x) { return x === 80000; }).length === 1 && amts.filter(function (x) { return x === 249980.46; }).length === 0, amts);
  check('C3: the real transfer (out of checking •6353, into savings •6338) is still found', (sg.suggestions || []).some(function (p) { return p.amount === 80000 && /6353/.test(p.out.account) && /6338/.test(p.inn.account); }), sg.suggestions);
  check('C4: the scan says how many lines are recorded twice, so they can be cleaned up', sg.recorded_twice >= 2, sg.recorded_twice);
  var pairSame = await exp({ action: 'pair_transfer', payload: { a: id(1), b: id(4) } });
  check('C5: linking two lines of the SAME real account as a transfer is refused on the server, with the reason and where to go', pairSame.ok === false && /same bank account/.test(pairSame.error) && /Check for duplicates/.test(pairSame.error) && !global.__db.t.bank_transactions.some(function (t) { return t.transfer_group_id; }), pairSame);
  var pairOk = await exp({ action: 'pair_transfer', payload: { a: id(7), b: id(8) } });
  check('C6: linking the real pair works: both sides carry one link and are marked transfer', pairOk.ok && global.__db.t.bank_transactions.filter(function (t) { return t.transfer_group_id === pairOk.transfer_group_id && t.classification === 'transfer'; }).length === 2, pairOk);
  var cand = await exp({ action: 'transfer_candidates', payload: { bank_transaction_id: id(1) } });
  check('C7: picking the other side by hand never offers this account\'s own second connection', cand.ok && !cand.candidates.some(function (c) { return c.account_id === 'A2' || c.account_id === 'A1'; }), cand.candidates);
  var rep = await exp({ action: 'transfers_report', payload: { from: '2026-01-01', to: '2026-12-31' } });
  check('C8: the transfer register checks both sides: 1 sound transfer of $80,000, no issues', rep.ok && rep.count === 1 && rep.total === 80000 && rep.issues === 0 && rep.transfers[0].issue === null && /6353/.test(rep.transfers[0].from_account) && /6338/.test(rep.transfers[0].to_account), rep);
  // a bad old link: both sides in the same real account, and a one-sided link
  global.__db.t.bank_transactions.forEach(function (t) { if (t.id === id(1) || t.id === id(4)) { t.transfer_group_id = 'g-bad'; t.classification = 'transfer'; } if (t.id === id(19)) { t.transfer_group_id = 'g-one'; t.classification = 'transfer'; } });
  var rep2 = await exp({ action: 'transfers_report', payload: { from: '2026-01-01', to: '2026-12-31' } });
  var bad1 = rep2.transfers.filter(function (g) { return g.gid === 'g-bad'; })[0]; var one = rep2.transfers.filter(function (g) { return g.gid === 'g-one'; })[0];
  check('C9: an old link with both sides in the same account, and a link with only one side, are FLAGGED and left out of the total — not guessed at',
    rep2.issues === 2 && /same bank account/.test(bad1.issue) && /Only one side/.test(one.issue) && rep2.total === 80000, rep2);

  console.log('SO — D. Totals, reports, Back / Close (source checks)');
  var BR = R('src/app/api/accounting/bills/route.js'), BH = R('src/components/BooksHomeTab.jsx');
  check('D1: CAME IN / WENT OUT no longer count money moved between the company\'s own accounts once the two sides are linked',
    /* v55.83-SQ realign — the filter now also leaves out a line only marked "transfer" (Max: "mark transfer but flag it that it is missing second leg") */ BR.indexOf("bank = bank.filter(function (tB2) { return !tB2.transfer_group_id && tB2.classification !== 'transfer'; });") > 0 && BR.indexOf('transfers_between: trfBetween') > 0 && BH.indexOf('transfers between your own accounts are not counted') > 0 && BH.indexOf('incl. transfers') < 0);
  check('D2: that money is still shown, on its own "BETWEEN OWN ACCOUNTS" card, counted once (the out side)', BH.indexOf('BETWEEN OWN ACCOUNTS') > 0 && BR.indexOf("if (tB.transfer_group_id) { if (tB.direction === 'out') {") > 0);
  check('D3: a line only MARKED transfer with no linked other side is flagged for a person (v55.83-SQ realign: and no longer counted in or out)', BR.indexOf("else if (tB.classification === 'transfer') { trfUnlinked.count++;") > 0 && BH.indexOf('but not linked to') > 0);
  check('D4: the new money figures stay behind the "See Money Totals" permission', BR.indexOf('if (!canTotals) { cfPayload.transfers_between = { count: trfBetween.count, total: null }') > 0);
  var SQL = R('sql/v55-83-SO-duplicates.sql');
  check('D5: database — removal moves the whole row out in one step; restore inserts it back; a removed line cannot creep back on the next sync',
    SQL.indexOf('delete from public.bank_transactions where id = p_dup;') > 0 && SQL.indexOf('jsonb_populate_record(null::public.bank_transactions, a.row_data)') > 0 && SQL.indexOf('bank_duplicate_tombstone_t before insert on public.bank_transactions') > 0);
  check('D6: database — the record of a removal cannot be erased or rewritten, browsers can only read it, and only the server may remove or restore',
    SQL.indexOf("raise exception 'A removed-duplicate record cannot be erased.'") > 0 && SQL.indexOf('for select to authenticated') > 0 && SQL.indexOf('for insert') < 0 && SQL.indexOf('grant execute on function public.bank_duplicate_remove(uuid, uuid, uuid, text) to service_role') > 0);
  check('D7: database — a closed month, an invoice match, a transfer link, a split, a bill payment or a wire each block removal',
    ['closed month', 'invoice match', "'transfer'", "'split'", 'bill payment', "'wire'"].every(function (k) { return SQL.indexOf(k) > 0; }));
  var AT = R('src/components/AccountingTab.jsx'), BRT = R('src/components/BankReviewTab.jsx'), PG = R('src/app/page.jsx');
  check('D8: Back — a jump from inside a screen remembers the screen and the scroll position, and shows an obvious "← Back to …" button',
    AT.indexOf('setBack({ sub: sub, y: y0 });') > 0 && AT.indexOf('← Back to {labelOfSub(tabs, back.sub)}') > 0 && AT.indexOf('window.scrollTo(0, b0.y || 0)') > 0);
  check('D9: Back — the screen you left stays alive (hidden), so its filters and open rows are exactly as you left them',
    AT.indexOf("function alive(k) { return sub === k || (back && back.sub === k); }") > 0 && (AT.match(/alive\('/g) || []).length === 8 && (AT.match(/onGo=\{goFrom\}/g) || []).length === 7 && AT.indexOf('onGo={setSub}') < 0);
  check('D10: Back — picking a tab from the strip is a fresh start (no stale Back button)', AT.indexOf('function pickTab(k) { setBack(null); setSub(k); }') > 0 && AT.indexOf('onClick={function () { pickTab(k); }}') > 0);
  check('D11: transaction details have an obvious ✕ Close button and a Back button (white, dark text — readable in the dark skin)',
    BRT.indexOf('>✕ Close</button>') > 0 && BRT.indexOf("← Back{props.backLabel ? ' to ' + props.backLabel : ''}") > 0 && BRT.indexOf('text-xs">✕ close') < 0);
  check('D12: a transaction opened from Banking returns to Banking — which stays alive, so the account, filters and position are kept',
    PG.indexOf("setAcctReturn({ tab: tab, y: y0, label: tab === 'bank' ? 'Banking' : 'where you were' });") > 0 && PG.indexOf("(tab === 'bank' || (acctReturn && acctReturn.tab === 'bank'))") > 0 && PG.indexOf('onReturn={acctReturn ? returnFromAccounting : null}') > 0);
  var A = require(path.join(root, 'src/components/AccountingTab.jsx'));
  check('D13: the Back button names the screen in plain words', A.labelOfSub([['waiting', '🔔 Waiting for me'], ['all_txns', '📑 All Transactions']], 'waiting') === 'Waiting for me' && A.labelOfSub([], 'zzz') === 'the previous screen');
  var DP = R('src/components/DuplicateCheckPanel.jsx');
  check('D14: the button is labeled "Check for duplicates" and is on All Transactions, the transfers screen and Banking',
    DP.indexOf('🔍 Check for duplicates') > 0 && ['AllTransactionsTab', 'ExpenseRulesTab', 'BankTab'].every(function (f) { return R('src/components/' + f + '.jsx').indexOf('<DuplicateCheckPanel') > 0; }));
  check('D15: readable and honest — white panels with dark text, no browser pop-ups, no silently disabled buttons, every removal button says what it removes',
    DP.indexOf("background: '#ffffff', color: '#0f172a'") > 0 && !/window\.(alert|confirm|prompt)\(/.test(DP) && DP.indexOf('disabled=') < 0 && DP.indexOf('and keep the one marked KEEP') > 0 && DP.indexOf('Not duplicates — leave') > 0 && DP.indexOf('↩ Restore') > 0);
  var P = require(path.join(root, 'src/components/DuplicateCheckPanel.jsx'));
  var bp = P.batchPairs([{ kind: 'same_line', suggest_keep_id: 'k1', amount: 10, rows: [{ id: 'k1' }, { id: 'd1' }] }, { kind: 'same_line', suggest_keep_id: 'k2', amount: 5, rows: [{ id: 'k2' }, { id: 'd2', protected: true }] },
    { kind: 'possible', suggest_keep_id: 'k3', rows: [{ id: 'k3' }, { id: 'd3' }] }, { kind: 'same_line', suggest_keep_id: 'k4', rows: [{ id: 'k4' }, { id: 'd4' }, { id: 'd5' }] }]);
  check('D16: the one-press batch only covers clear two-copy "same bank line" pairs whose extra copy carries no work; everything else stays a person\'s choice', bp.length === 1 && bp[0].dup_id === 'd1' && bp[0].keep_id === 'k1', bp);
  var RT = R('src/app/api/accounting/duplicates/route.js');
  check('D17: API route style — var + string concatenation only', !/\b(let|const)\s/.test(RT) && RT.indexOf('`') < 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e.stack); process.exit(1); });
