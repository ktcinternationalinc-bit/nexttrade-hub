// ═══════════════════════════════════════════════════════════════════════════
// v55.83-XO — the STARTING BALANCE with NextTrade / RTM (Max 21-22 Nov 2026: "a previous balance to nextrade that we will pay
// bills from" · "b- NEW EXPENSE WHEN USED AFTER 6/1/2026").
//   1. the ONE calculation (src/lib/party-funds.js): a starting balance is a source next to the transfers — held = amount (with
//      corrections) − bills paid from it; its payments are NOT "paid without a transfer"; it is never funds_sent; the tax line adds
//      only its uses dated on / after 2026-06-01.
//   2. the REAL route handler with an in-memory database: super admin only, staff never see a hidden balance, a missing XO SQL
//      says which script to run and changes nothing, refusals before the database is asked.
//   3. the screen helper, the badge and What's New.
// The database side is proven on real Postgres in test-v55-83-xo-starting-balance-sql.mjs (needs EMBEDDED_PG_DIR).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('XO — starting balance with NextTrade / RTM');
var NT = 'NextTrade Industries', RTM = 'RTM Capital';

// ── 1. the calculation ──
var PF = require(path.join(root, 'src/lib/party-funds.js'));
var bankLines = [{ id: 'T1', date: '2026-09-02', amount_abs: 10000, third_party_payer: NT, direction: 'out', name: 'WIRE T1' }];
var bills = [{ id: 'b1', vendor_name: 'Kronos', bill_number: 'K-1', bill_date: '2026-06-02', category: 'trucking', total_amount: 1000, paid_via: NT },
  { id: 'b2', vendor_name: 'Rent Co', bill_number: 'R-1', bill_date: '2026-05-10', category: 'rent', total_amount: 400, paid_via: NT },
  { id: 'b3', vendor_name: 'Ocean', bill_number: 'O-1', bill_date: '2026-09-10', category: 'freight', total_amount: 6000, paid_via: NT },
  { id: 'b4', vendor_name: 'Loose Co', bill_number: 'L-1', bill_date: '2026-06-10', category: 'freight', total_amount: 70, paid_via: NT }];
var openings = [{ id: 'O1', party: NT, amount: 5000, as_of: '2026-05-15', reason: 'NextTrade statement 15 May', visible_to_staff: false, corrects_id: null },
  { id: 'C1', party: NT, amount: -500, as_of: '2026-05-15', reason: 'statement re-checked', visible_to_staff: false, corrects_id: 'O1' },
  { id: 'OR', party: RTM, amount: 2000, as_of: '2026-07-01', reason: 'RTM balance July', visible_to_staff: true, corrects_id: null }];
var pays = [{ id: 'p1', bill_id: 'b1', amount: 600, paid_date: '2026-06-15', bank_transaction_id: null, party_opening_id: 'O1', voided: false, method: 'rtm' },
  { id: 'p2', bill_id: 'b2', amount: 400, paid_date: '2026-05-20', bank_transaction_id: null, party_opening_id: 'O1', voided: false, method: 'rtm' }, // before 1 June (older record): held, never in the tax line
  { id: 'p3', bill_id: 'b1', amount: 100, paid_date: '2026-07-03', bank_transaction_id: null, party_opening_id: 'O1', voided: true, method: 'rtm' },   // undone
  { id: 'p4', bill_id: 'b3', amount: 6000, paid_date: '2026-09-11', bank_transaction_id: 'T1', voided: false, method: 'rtm' },
  { id: 'p5', bill_id: 'b4', amount: 70, paid_date: '2026-06-12', bank_transaction_id: null, voided: false, method: 'rtm' }];                          // paid through NT, no source named
function run(from, to, ops) { return PF.partyFundsBreakdown({ parties: [{ name: NT }, { name: RTM }], bankLines: bankLines, pays: pays, bills: bills, requests: [], entries: [], openings: ops === undefined ? openings : ops, from: from, to: to }); }
var all = run(null, null); var nt = all[0]; var rt = all[1];
var sb = nt.starting_balances[0];
check('a starting balance is a source of its own (kind starting_balance): 5,000 − correction 500 = 4,500; used 1,000 (the undone payment does not count); held 3,500', nt.starting_balances.length === 1 && sb.kind === 'starting_balance' && sb.original === 5000 && sb.corrections === -500 && sb.amount === 4500 && sb.current.used === 1000 && sb.current.held === 3500 && sb.lifetime_rows.length === 2, sb);
check('its rows name the starting balance, never a transfer', sb.lifetime_rows.every(function (r) { return r.source === 'starting_balance' && r.starting_balance_id === 'O1' && !r.transfer_id; }));
check('its payments are NOT "paid without a transfer"; a payment that names no source still is (the 70)', nt.paid_without_a_transfer.lifetime_rows.length === 1 && nt.paid_without_a_transfer.lifetime_rows[0].payment_id === 'p5', nt.paid_without_a_transfer);
check('never money sent: funds_sent is the 10,000 transfer only (period, as_of, current)', nt.period.funds_sent === 10000 && nt.as_of.funds_sent === 10000 && nt.current.funds_sent === 10000);
check('today: unused includes what the starting balance still holds (10,000 − 6,000 + 3,500 = 7,500); starting_balance_held 3,500', nt.current.unused === 7500 && nt.current.starting_balance === 4500 && nt.current.from_starting_balance === 1000 && nt.current.starting_balance_held === 3500, nt.current);
check('companies never mix: RTM\'s 2,000 balance is RTM\'s only', rt.starting_balances.length === 1 && rt.starting_balances[0].amount === 2000 && rt.current.starting_balance_held === 2000 && nt.starting_balances.every(function (s) { return s.id !== 'OR'; }));
var jun = run('2026-06-01', '2026-06-30')[0];
check('June: opening held = the starting balance 4,500 − the 400 used in May = 4,100; − 600 used in June = closing 3,500; the sums agree', jun.period.opening_held === 4100 && jun.period.from_starting_balance === 600 && jun.period.closing_held === 3500 && jun.as_of.held === 3500 && jun.arithmetic_ok, jun.period);
check('June TAX: funds sent 0 + the 600 paid from the starting balance on 15 June = 600 (Max\'s (b): a new expense when used)', jun.period.funds_sent === 0 && jun.period.tax_from_starting_balance === 600 && jun.period.tax_professional_fees === 600, jun.period);
var may = run('2026-05-01', '2026-05-31')[0];
check('May: the balance is recorded in May (added 4,500, not money sent), 400 used — but NO tax line (used before 1 June 2026)', may.period.starting_balance_added === 4500 && may.period.from_starting_balance === 400 && may.period.tax_from_starting_balance === 0 && may.period.tax_professional_fees === 0 && may.period.funds_sent === 0 && may.period.closing_held === 4100 && may.arithmetic_ok, may.period);
var sep = run('2026-09-01', '2026-09-30')[0];
check('September: tax = the 10,000 transfer only, unchanged; applied_to_bills is the transfer\'s 6,000 only', sep.period.tax_professional_fees === 10000 && sep.period.applied_to_bills === 6000 && sep.period.from_starting_balance === 0 && sep.arithmetic_ok, sep.period);
var none = run('2026-09-01', '2026-09-30', [])[0];
check('without any starting balance every existing figure is what it was (the XO keys are 0, the payments fall back to "no source named")', none.period.tax_professional_fees === 10000 && none.period.starting_balance_added === 0 && none.current.starting_balance_held === 0 && none.starting_balances.length === 0 && none.paid_without_a_transfer.lifetime_rows.length === 3, none.paid_without_a_transfer);
var over = run(null, null, [{ id: 'O1', party: NT, amount: 500, as_of: '2026-05-15', reason: 'too small balance', visible_to_staff: true, corrects_id: null }])[0];
check('a balance used beyond its amount (records disagree) is flagged needs reconciliation, never hidden', over.needs_reconciliation === true);
check('the tax rule date is 1 June 2026', PF.STARTING_BALANCE_TAX_FROM === '2026-06-01');

// ── 2. the route ──
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
function seed(xo) {
  var db = new FakeDb({});
  db.t.paid_through_parties = [{ name: NT, kind: 'affiliate' }, { name: RTM, kind: 'service_provider' }];
  db.t.plaid_accounts = [{ plaid_account_id: 'A1', wave_business_id: US, is_private: false }];
  db.t.bank_transactions = [{ id: 'T1', wave_business_id: US, account_id: 'A1', direction: 'out', amount_abs: 10000, date: '2026-09-02', posted_date: '2026-09-02', pending: false, review_status: 'unreviewed', third_party_payer: NT, name: 'WIRE T1', merchant_name: null, transfer_group_id: null }];
  db.t.vendor_bills = bills.map(function (b) { return Object.assign({ wave_business_id: US, record_status: 'active', release_number: null, currency: 'USD' }, b); })
    .concat([{ id: 'b8', wave_business_id: US, vendor_name: 'Free Co', bill_number: 'F-1', bill_date: '2026-07-01', category: 'freight', total_amount: 900, paid_via: null, record_status: 'active', currency: 'USD' },
      { id: 'b9', wave_business_id: US, vendor_name: 'Maple', bill_number: 'C-1', bill_date: '2026-07-01', category: 'freight', total_amount: 900, paid_via: null, record_status: 'active', currency: 'CAD' },
      { id: 'b7', wave_business_id: US, vendor_name: 'RTM Vendor', bill_number: 'X-1', bill_date: '2026-07-01', category: 'freight', total_amount: 900, paid_via: RTM, record_status: 'active', currency: 'USD' }]);
  db.t.vendor_bill_payments = pays.filter(function (p) { return p.voided !== true; }).map(function (p) { return Object.assign({}, p); });
  db.t.party_money_entries = []; db.t.wire_packages = []; db.t.wire_package_lines = [];
  db.t.party_opening_balances = xo ? openings.map(function (o) { return Object.assign({ created_at: '2026-11-20T10:00:00Z' }, o); }) : [];
  if (!xo) { db.fail.party_opening_balances = { select: 'relation "public.party_opening_balances" does not exist' }; }
  db.calls = [];
  db.rpcs.hub_party_funds_installed = function () { return { data: true, error: null }; };
  db.rpcs.hub_party_opening_installed = function () { return { data: xo === true, error: null }; };
  db.rpcs.hub_party_transfer_state = function (a) { return { data: { found: true, party: NT, status: 'confirmed', amount: 10000, bills: 6000, fees: 0, held: 4000, reserved: 0, available: 4000 }, error: null }; };
  db.rpcs.hub_party_opening_add = function (a, dbx) { dbx.calls.push(['add', a.p]); return { data: { ok: true, action: a.p.amount > 0 ? 'opening_add' : 'opening_correct', id: 'new-ob', state: { amount: 4500, used: 1000, held: 3500 } }, error: null }; };
  db.rpcs.hub_party_opening_pay = function (a, dbx) { dbx.calls.push(['pay', a.p]); if (a.p.bills[0].amount > 3500) { return { data: null, error: { message: 'HUB_GUARD: these bills come to $4,000.00 but only $3,500.00 is left of the starting balance ($4,500.00 less $1,000.00 already used). Nothing was recorded.' } }; } return { data: { ok: true, action: 'opening_pay', payments: ['np1'], total: a.p.bills[0].amount, state: { held: 1 } }, error: null }; };
  state.db = db; return db;
}
function party(j, name) { return (j.parties || []).filter(function (p) { return p.party === name; })[0]; }
var STAFF = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true, 'advances.manage': true, 'bank.view_private': true };
var goodAdd = { action: 'opening_add', party: NT, amount: 5000, as_of: '2026-05-15', reason: 'NextTrade statement of 15 May', visible_to_staff: false, request_id: 'click-ob01' };
var goodPay = { action: 'opening_pay', party: NT, opening_id: 'O1', bills: [{ bill_id: 'b8', amount: 300.004 }], paid_date: '2026-06-20', reference: 'NT list 3', reason: 'paid from the old balance', request_id: 'click-op01' };

(async function () {
  // super admin only
  var db = seed(true); state.perms = STAFF; state.superAdmin = false;
  var s1 = [await call(goodAdd), await call(goodPay), await call({ action: 'opening_pay_candidates', party: NT })];
  check('staff — even with Advances: Manage and every other switch — cannot add, pay from, or list bills for a starting balance (403), nothing called', s1.every(function (x) { return x._status === 403 && /super admin/.test(x.error); }) && db.calls.length === 0, s1);
  // staff never see a hidden balance
  var j1 = await call({ action: 'funds', from: '2026-06-01', to: '2026-06-30' }); var n1 = party(j1, NT); var r1 = party(j1, RTM);
  check('staff: NextTrade\'s balance marked "only me" is not listed, the count says one is not shown, and the company totals are withheld (they would include it)', j1.ok && n1.starting_balances.length === 0 && n1.hidden_starting_balances === 1 && n1.totals === null && /starting balance only the super admin/.test(n1.totals_hidden) && JSON.stringify(n1).indexOf('4500') < 0 && JSON.stringify(n1).indexOf('3500') < 0, n1);
  check('staff: RTM\'s balance marked "staff can see it" is listed with its figures (amount 2,000, used 0, left 2,000)', r1.starting_balances.length === 1 && r1.starting_balances[0].amount === 2000 && r1.starting_balances[0].left === 2000 && r1.totals && r1.totals.starting_balance_left === 2000, r1);
  check('staff: no install instruction and no add button switch', j1.can_starting_balance === false && j1.starting_balance_sql_missing === null);
  state.perms = { 'accounting.view': true, 'bills.view': true };
  var j2 = await call({ action: 'funds' }); var r2 = party(j2, RTM);
  check('without "Bank & Financial Summary" a visible balance is listed with NO amount anywhere', r2.starting_balances.length === 1 && r2.starting_balances[0].amount === undefined && r2.starting_balances[0].left === undefined && r2.totals === null && JSON.stringify(r2).indexOf('2000') < 0, r2);
  // the super admin
  state.superAdmin = true; state.perms = {};
  var j3 = await call({ action: 'funds', from: '2026-06-01', to: '2026-06-30' }); var n3 = party(j3, NT);
  check('super admin: sees the hidden balance at the top — amount 4,500 (corrected once), used 1,000, left 3,500, with its bills', n3.starting_balances.length === 1 && n3.starting_balances[0].amount === 4500 && n3.starting_balances[0].used === 1000 && n3.starting_balances[0].left === 3500 && n3.starting_balances[0].corrections_count === 1 && n3.starting_balances[0].visible_to_staff === false && n3.starting_balances[0].bills.length === 2 && n3.hidden_starting_balances === 0, n3.starting_balances);
  check('super admin: totals keep their meaning (sent 10,000, held 4,000 on the transfer) and add the starting balance apart; its payments are not "without a transfer"', n3.totals.funds_sent === 10000 && n3.totals.held === 4000 && n3.totals.starting_balance === 4500 && n3.totals.starting_balance_left === 3500 && n3.paid_without_a_transfer_count === 1, n3.totals);
  check('super admin, June: tax line 600 (the June use), funds sent 0, from the starting balance 600', n3.period.tax_professional_fees === 600 && n3.period.funds_sent === 0 && n3.period.from_starting_balance === 600 && n3.period.tax_from_starting_balance === 600, n3.period);
  check('super admin: the screen is told it may add one, that the database step is there, and the 1 June rule', j3.can_starting_balance === true && j3.starting_balances_installed === true && j3.starting_balance_sql_missing === null && j3.starting_balance_pay_from === '2026-06-01');
  var a1 = await call(goodAdd); var ac = db.calls.filter(function (c) { return c[0] === 'add'; })[0];
  check('super admin: add goes through hub_party_opening_add once — company, amount, as-of, reason, visibility, click id, the verified person; the answer is an acknowledgment', a1.ok && a1.id === 'new-ob' && a1.state === undefined && ac && ac[1].party === NT && ac[1].amount === 5000 && ac[1].as_of === '2026-05-15' && ac[1].visible_to_staff === false && ac[1].request_id === 'click-ob01' && ac[1].actor === 'u1' && ac[1].corrects_id === undefined, [a1, ac]);
  var a2 = await call({ action: 'opening_add', party: NT, amount: -500, corrects_id: 'O1', reason: 'statement re-checked: lower', request_id: 'click-ob02' }); var ac2 = db.calls.filter(function (c) { return c[0] === 'add'; })[1];
  check('a correction: minus amount naming the balance, no as-of / visibility sent', a2.ok && ac2[1].amount === -500 && ac2[1].corrects_id === 'O1' && ac2[1].as_of === undefined, ac2);
  var nAdd = db.calls.length;
  var badAdds = [Object.assign({}, goodAdd, { reason: 'too short' }), Object.assign({}, goodAdd, { as_of: '05/15/2026' }), Object.assign({}, goodAdd, { visible_to_staff: 'no' }), Object.assign({}, goodAdd, { amount: 0 }),
    Object.assign({}, goodAdd, { amount: -10, as_of: null }), Object.assign({}, goodAdd, { corrects_id: 'O1' }), Object.assign({}, goodAdd, { request_id: 'x' }), Object.assign({}, goodAdd, { party: 'Somebody' })];
  var ba = []; for (var i = 0; i < badAdds.length; i++) { ba.push(await call(badAdds[i])); }
  check('add refused before the database is asked: short reason, bad date, no visibility answer, zero, a minus amount naming nothing, a plus amount naming a balance, no click id, unknown company', ba.every(function (x) { return x._status === 400; }) && db.calls.length === nAdd, ba.map(function (x) { return x.error; }));
  var p1 = await call(goodPay); var pc = db.calls.filter(function (c) { return c[0] === 'pay'; })[0];
  check('pay goes through hub_party_opening_pay once — company, balance, bills in cents, paid date, reference, reason, click id, the verified person', p1.ok && p1.bills === 1 && pc && pc[1].opening_id === 'O1' && pc[1].bills[0].amount === 300 && pc[1].paid_date === '2026-06-20' && pc[1].reference === 'NT list 3' && pc[1].actor === 'u1' && pc[1].request_id === 'click-op01' && pc[1].allow_closed === false, [p1, pc]);
  var nPay = db.calls.length;
  var early = await call(Object.assign({}, goodPay, { paid_date: '2026-05-31', request_id: 'click-op02' }));
  check('pay dated 31 May 2026 is refused at the door (1 June 2026 or later), nothing called', early._status === 409 && /1 June 2026/.test(early.error) && db.calls.length === nPay, early);
  var badPays = [Object.assign({}, goodPay, { bills: [] }), Object.assign({}, goodPay, { bills: [{ bill_id: 'b8', amount: 0 }] }), Object.assign({}, goodPay, { reference: 'x' }), Object.assign({}, goodPay, { reason: '' }), Object.assign({}, goodPay, { opening_id: '' }), Object.assign({}, goodPay, { paid_date: 'June 20' })];
  var bp = []; for (var k = 0; k < badPays.length; k++) { bp.push(await call(badPays[k])); }
  check('pay refused before the database is asked: no bills, a zero amount, no reference, no reason, no balance, a bad date', bp.every(function (x) { return x._status === 400; }) && db.calls.length === nPay, bp.map(function (x) { return x.error; }));
  var big = await call(Object.assign({}, goodPay, { bills: [{ bill_id: 'b8', amount: 4000 }], request_id: 'click-op03' }));
  check('the database\'s refusal (over the balance) is passed on in plain words', big._status === 409 && /only \$3,500\.00 is left/.test(big.error) && /Nothing was changed/.test(big.error), big);
  var cl = await call(Object.assign({}, goodPay, { allow_closed: true, request_id: 'click-op04' }));
  check('the super admin may date it in a closed month when asked (passed on to the database)', cl.ok && db.calls[db.calls.length - 1][1].allow_closed === true);
  var cand = await call({ action: 'opening_pay_candidates', party: NT });
  var ids = (cand.bills || []).map(function (b) { return b.id; }).sort();
  check('bills that may be paid from NextTrade\'s balance: active, US dollars, open, paid through NextTrade or nobody (the CAD bill, RTM\'s bill and fully paid bills left out)', cand.ok && ids.indexOf('b8') >= 0 && ids.indexOf('b9') < 0 && ids.indexOf('b7') < 0 && ids.indexOf('b3') < 0 && ids.indexOf('b2') < 0 && ids.indexOf('b4') < 0 && (cand.bills.filter(function (b) { return b.id === 'b1'; })[0] || {}).open === 400, cand);
  // XO not installed
  db = seed(false);
  var m1 = await call({ action: 'funds' }); var mn = party(m1, NT);
  check('WITHOUT the XO database step: the list still loads (no starting balance, the old figures), and the super admin is told which script to run', m1.ok && m1.starting_balances_installed === false && /sql\/v55-83-XO-starting-balance\.sql/.test(m1.starting_balance_sql_missing) && mn.starting_balances.length === 0 && mn.totals.funds_sent === 10000, m1);
  var m2 = [await call(goodAdd), await call(goodPay), await call({ action: 'opening_pay_candidates', party: NT })];
  check('WITHOUT the XO database step: add / pay / candidates answer 409 "run sql/v55-83-XO-starting-balance.sql", nothing called', m2.every(function (x) { return x._status === 409 && /run sql\/v55-83-XO-starting-balance\.sql/.test(x.error) && /Nothing was changed/.test(x.error); }) && db.calls.length === 0, m2);
  state.superAdmin = false; state.perms = STAFF;
  check('… and staff are never shown that instruction', (await call({ action: 'funds' })).starting_balance_sql_missing === null);
  var src = fs.readFileSync(path.join(root, 'src/app/api/accounting/party-funds/route.js'), 'utf8');
  check('API route style: no arrow functions, no template strings, no const / let; no table written directly; only the XO functions for starting balances', !/=>/.test(src) && !/`/.test(src) && !/\b(const|let)\s/.test(src) && !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(src) && src.indexOf("rpc('hub_party_opening_add'") > 0 && src.indexOf("rpc('hub_party_opening_pay'") > 0);
  var srv = fs.readFileSync(path.join(root, 'src/lib/party-funds-server.js'), 'utf8');
  check('the shared reader loads starting balances for EVERY caller (P&L too) and treats a missing table as "none"', srv.indexOf("from('party_opening_balances')") > 0 && srv.indexOf('openings: openings') > 0 && /if \(!oq\.error\)/.test(srv));

  // ── 3. the screen, badge, What's New ──
  var P = require(path.join(root, 'src/components/FundsHeldPanel.jsx'));
  var on = { canStart: true, installed: true };
  check('screen: the super admin may pay from a balance with money left and lower it; nothing when used up; nothing for staff; says which script when not installed', P.startingBalanceActions({ amount: 4500, left: 3500 }, on).pay && P.startingBalanceActions({ amount: 4500, left: 3500 }, on).correct && !P.startingBalanceActions({ amount: 1000, left: 0 }, on).pay && !P.startingBalanceActions({ amount: 4500, left: 3500 }, { canStart: false, installed: true }).pay && !P.startingBalanceActions({}, { canStart: false, installed: true }).add && /v55-83-XO/.test(P.startingBalanceActions({}, { canStart: true, installed: false }).why) && P.STARTING_BALANCE_PAY_FROM === '2026-06-01');
  var ui = fs.readFileSync(path.join(root, 'src/components/FundsHeldPanel.jsx'), 'utf8');
  check('screen: "+ Starting balance", "Starting balance held with …, as of …", "Pay bills from it"; every write is a server action with a click id', ui.indexOf('+ Starting balance') > 0 && ui.indexOf("'Starting balance held with ' + p.party + ', as of ' + sb.as_of") > 0 && ui.indexOf('Pay bills from it') > 0 && ui.indexOf("action: 'opening_add'") > 0 && ui.indexOf("action: 'opening_pay'") > 0 && ui.indexOf('supabase') < 0);
  var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
  var WN = require(path.join(root, 'src/components/WhatsNewWidget.jsx'));
  var top = WN.BUILD_HISTORY[0];
  check('badge v55.83-XO and the top What\'s New entry: plain items + one super-admin-only Technical item naming the SQL', page.indexOf('>v55.83-XO</span>') > 0 && top.version === 'v55.83-XO' && top.items.filter(function (x) { return x.superAdminOnly; }).length === 1 && top.items.filter(function (x) { return x.superAdminOnly; })[0].text.indexOf('sql/v55-83-XO-starting-balance.sql') >= 0 && top.items.every(function (x) { return typeof x.text === 'string' && x.text.length > 20; }));
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
