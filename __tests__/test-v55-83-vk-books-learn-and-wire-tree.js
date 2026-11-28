// ═══════════════════════════════════════════════════════════════════════════
// v55.83-VK — Nextrade / RTM books (Max, 19 Nov 2026):
//   1. a categorized line stays on the page; filter All / Categorized / Not categorized
//   2. what a person categorizes is LEARNED as a rule (created, or updated when they change their mind) and used
//   3. the KTC category of a Nextrade line's KTC bill is set on the line
//   4. wire to NextTrade: only NextTrade's bills, as a tree — tick all, one vendor, or single bills
// RUN, not grep: the pure helpers, then the REAL company-books route with an in-memory database.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('VK — books learn rules; categorized lines stay; wire bill tree');

var L = require(path.join(root, 'src/lib/company-rule-learn.js'));
var T = require(path.join(root, 'src/lib/wire-bill-tree.js'));
var taxLib = require(path.join(root, 'src/lib/nextrade-tax-report.js'));
var tax = taxLib.nextradeTaxReport;

var taxCategories = [{ key: 'sales', label: 'Sales', kind: 'income' }, { key: 'materials', label: 'Materials', kind: 'cogs' }, { key: 'utilities', label: 'Utilities', kind: 'expense' }];
function taxLine(category, amount, fields) {
  return Object.assign({ wave_business_id: 'NEXTRADE_BOOKS', date: '2026-01-15', iso_currency: 'USD', company_category: category, amount_abs: amount, direction: 'out' }, fields);
}
var report = tax([
  taxLine('sales', 100, { direction: 'in', date: '2025-12-31', posted_date: '2026-01-01' }),
  taxLine('materials', 20), taxLine('utilities', 15), taxLine('utilities', 2, { direction: 'in' }),
  taxLine('utilities', 300, { transfer_group_id: 'PAIR' }), taxLine(null, 50),
  taxLine('utilities', 700, { pending: true }), taxLine('utilities', 700, { review_status: 'duplicate' }),
  taxLine('utilities', 700, { payroll_restricted: true }), taxLine('utilities', 700, { wave_business_id: 'RTM_BOOKS' }),
  taxLine('utilities', 700, { posted_date: '2027-01-01' }), taxLine('utilities', 40, { iso_currency: 'CAD' }),
], taxCategories, '2026-01-01', '2026-12-31');
var usd = report.currencies.find(function (row) { return row.currency === 'USD'; });
var cad = report.currencies.find(function (row) { return row.currency === 'CAD'; });
check('Nextrade tax report uses posted dates, nets refunds, and keeps currencies separate', report.first === '2026-01-01' && usd.summary.income === 10000 && usd.summary.cost_of_goods === 2000 && usd.summary.expenses === 1300 && usd.summary.net === 6700 && cad.summary.expenses === 4000, report);
check('Transfers and uncategorized activity appear outside the tax summary', usd.rows.some(function (row) { return row.kind === 'transfer' && row.money_out === 30000; }) && usd.summary.review_count === 1, usd);

var details = tax([
  taxLine(null, 12.34, { id: 'imported', date: '2025-12-31', posted_date: '2026-01-03', account_id: 'provider-account-id',
    name: 'Wave deposit', direction: 'in', bank_source: taxLib.NEXTRADE_WAVE_TD_SOURCE,
    source: 'wave_csv', source_file: 'wave.csv', source_row: '22', plaid_transaction_id: 'provider-transaction-id' }),
  taxLine(null, 456, { id: 'masked', name: 'Restricted payee', payroll_restricted: true }),
], taxCategories, '2026-01-01', '2026-12-31', new Map([['provider-account-id', 'TD •1795']]));
var underlying = details.currencies[0].rows[0].transactions;
check('Tax drill-down ties to the posted period and preserves the Wave CSV citation', details.count === 1 &&
  underlying.length === 1 && underlying[0].date === '2026-01-03' && underlying[0].amount === 1234 &&
  underlying[0].account === 'TD •1795' && underlying[0].source_row === '22' && underlying[0].source_file === 'wave.csv' &&
  details.accounts[0].wave_count === 1, details);
check('Tax drill-down never exports restricted rows or provider IDs', !/Restricted payee|provider-account-id|provider-transaction-id/.test(JSON.stringify(details)), details);
var largeReport = tax(Array.from({ length: 4001 }, function () { return taxLine('materials', 1); }), taxCategories, '2026-01-01', '2026-12-31');
check('Long periods keep complete totals with no partial drill-down', !largeReport.details_available &&
  largeReport.count === 4001 && largeReport.currencies[0].summary.cost_of_goods === 400100 &&
  largeReport.currencies[0].rows[0].transactions === undefined, largeReport);

// ── the filter ──
var la = { company_category: 'elec' }, lb = { company_category: null };
check('filter: All shows both; Categorized only the one with a category; Not categorized only the other', L.lineShown('all', la) && L.lineShown('all', lb) && L.lineShown('cat', la) && !L.lineShown('cat', lb) && !L.lineShown('uncat', la) && L.lineShown('uncat', lb));
check('filter: one category shows only its lines', L.lineShown('elec', la) && !L.lineShown('water', la) && !L.lineShown('elec', lb));

// ── which words become the rule ──
check('the merchant name is used when the bank gives one', L.learnMatchText({ merchant_name: 'CenterPoint Energy', name: 'ACH DEBIT CENTERPOINT ENERG 8823771 WEB' }) === 'centerpoint energy');
check('numbers (dates, references) end the text; trailing filler words are dropped', L.learnMatchText({ name: 'CENTERPOINT ENERGY PAYMENT 251103 REF 99812' }) === 'centerpoint energy');
check('a leading number is skipped', L.learnMatchText({ name: '0042 WASTE MANAGEMENT HOUSTON' }) === 'waste management houston');
check('nothing is learned from a line that only says "check", "transfer", "online payment"…', L.learnMatchText({ name: 'CHECK 1042' }) === null && L.learnMatchText({ name: 'ONLINE TRANSFER TO 4432' }) === null && L.learnMatchText({ name: 'ACH PAYMENT' }) === null && L.learnMatchText({ name: '' }) === null);
check('at most six words', L.learnMatchText({ name: 'one two three four five six seven eight' }).split(' ').length === 6);

// ── what happens to the rule list ──
var line = { id: 'x', name: 'CENTERPOINT ENERGY PAYMENT 251103', direction: 'out' };
var elec = { key: 'elec', label: 'Electricity', kind: 'expense' }; var rep = { key: 'repairs', label: 'Repairs', kind: 'expense' };
check('no rule yet → create one for the same direction', (function () { var p = L.learnPlan([], line, elec); return p.op === 'create' && p.text === 'centerpoint energy' && p.direction === 'out'; })());
check('the same rule already there → nothing changes', L.learnPlan([{ id: 'r1', match_text: 'centerpoint energy', direction: 'out', category_key: 'elec', active: true }], line, elec).op === 'same');
check('the person picks ANOTHER category → the rule follows them', (function () { var p = L.learnPlan([{ id: 'r1', match_text: 'centerpoint energy', direction: 'out', category_key: 'elec', active: true }], line, rep); return p.op === 'update' && p.was === 'elec' && p.rule.id === 'r1'; })());
check('a switched-off rule for the same text is switched back on (update)', L.learnPlan([{ id: 'r1', match_text: 'centerpoint energy', direction: 'out', category_key: 'elec', active: false }], line, elec).op === 'update');
check('a wider rule that already gives the same category → no second rule', L.learnPlan([{ id: 'r0', match_text: 'centerpoint', direction: 'any', category_key: 'elec', active: true }], line, elec).op === 'covered');
check('a wider rule with ANOTHER category → a new, more exact rule (longest text wins)', L.learnPlan([{ id: 'r0', match_text: 'centerpoint', direction: 'any', category_key: 'repairs', active: true }], line, elec).op === 'create');
check('a rule for money IN is not touched by a money-OUT line', L.learnPlan([{ id: 'r1', match_text: 'centerpoint energy', direction: 'in', category_key: 'refund', active: true }], line, elec).op === 'create');
check('payroll is never learned (names stay out of the rules)', L.learnPlan([], { name: 'ZELLE TO JOHN SMITH', direction: 'out' }, { key: 'payroll', is_payroll: true }).op === 'none');
check('taking a category off teaches nothing', L.learnPlan([], line, null).op === 'none');
var rulesX = [{ id: 'r0', match_text: 'centerpoint', direction: 'any', category_key: 'repairs', active: true }, { id: 'r1', match_text: 'centerpoint energy', direction: 'out', category_key: 'elec', active: true }];
var openX = [{ id: 'a', name: 'CENTERPOINT ENERGY 1', direction: 'out' }, { id: 'b', name: 'CENTERPOINT GAS', direction: 'out' }, { id: 'c', name: 'CENTERPOINT ENERGY 2', direction: 'out', pending: true }, { id: 'd', name: 'CENTERPOINT ENERGY 3', direction: 'out', company_category: 'x' }, { id: 'e', name: 'CENTERPOINT ENERGY REFUND', direction: 'in' }];
check('lines a rule would categorize: only where it WINS, not pending, not categorized, right direction', L.linesForRule(rulesX, 'r1', openX).map(function (l) { return l.id; }).join(',') === 'a' && L.linesForRule(rulesX, 'r0', openX).map(function (l) { return l.id; }).join(',') === 'b,e');

// ── the wire bill tree ──
var bills = [
  { id: 'b1', vendor_name: 'Reliant', open: 100, validation_status: 'validated', needs_mark: false },
  { id: 'b2', vendor_name: 'Reliant', open: 50.5, validation_status: 'validated', needs_mark: false },
  { id: 'b3', vendor_name: 'AT&T', open: 80, validation_status: 'pending', needs_mark: false },
  { id: 'b4', vendor_name: 'Other Co', open: 999, validation_status: 'validated', needs_mark: true }];
check('only-their-bills hides the bills not marked paid through the company', T.wireBillsToShow(bills, {}, true).map(function (b) { return b.id; }).join(',') === 'b1,b2,b3');
check('… but a bill already ticked on this wire always stays in view', T.wireBillsToShow(bills, { b4: '999' }, true).length === 4);
check('all-open-bills shows every bill', T.wireBillsToShow(bills, {}, false).length === 4);
var mine = bills.filter(function (b) { return !b.needs_mark; });
var g = T.groupByVendor(mine, { b1: '100' });
check('grouped by vendor, A–Z, with count, total owed, ticked and the amount ticked', g.length === 2 && g[0].vendor === 'AT&T' && g[1].vendor === 'Reliant' && g[1].count === 2 && g[1].open === 150.5 && g[1].ticked === 1 && g[1].pay === 100 && g[0].tickable === 0);
var tt = T.groupTotals(mine, { b1: '100', b2: '1,050.25' });
check('the whole group: count, owed, ticked, amount (commas in a typed amount are read)', tt.count === 3 && tt.open === 230.5 && tt.ticked === 2 && tt.pay === 1150.25 && tt.tickable === 2);
var pkAll = T.tickGroup({}, mine, true);
check('tick all: every VALIDATED bill is ticked for what is still owed; a bill not validated is left alone', pkAll.b1 === '100' && pkAll.b2 === '50.5' && pkAll.b3 === undefined);
check('tick all never changes an amount already typed by hand', T.tickGroup({ b1: '40' }, mine, true).b1 === '40');
check('untick all removes only that group', (function () { var p = T.tickGroup({ b1: '100', b2: '50.5', b4: '999' }, mine, false); return p.b1 === undefined && p.b2 === undefined && p.b4 === '999'; })());
check('a bill with nothing left is not ticked', T.tickGroup({}, [{ id: 'z', open: 0, validation_status: 'validated' }], true).z === undefined);
check('tick helpers never change the list they were given', (function () { var orig = { b1: '100' }; T.tickGroup(orig, mine, true); T.tickGroup(orig, mine, false); return Object.keys(orig).length === 1 && orig.b1 === '100'; })());

// ── the REAL route ──
var state = { perms: {}, db: null, superAdmin: false };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function (db, uid, perm) { return Promise.resolve(state.perms[perm] ? { ok: true } : { ok: false, status: 403 }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: state.superAdmin, mp: state.perms }); },
  userHasPermission: function (ctx, perm) { return !!(ctx && ctx.mp && ctx.mp[perm]); },
});
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var CB = require(path.join(root, 'src/app/api/accounting/company-books/route.js'));
function call(body) { return CB.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }

function seed() {
  var db = new FakeDb({ company_bill_links: [['source_bank_transaction_id']] });
  db.t.plaid_accounts = [
    { plaid_account_id: 'RTM-1', name: 'RTM checking', mask: '1111', type: 'depository', wave_business_id: 'RTM_BOOKS', is_private: false },
    { plaid_account_id: 'RTM-PRIV', name: 'RTM private', mask: '2222', type: 'depository', wave_business_id: 'RTM_BOOKS', is_private: true },
    { plaid_account_id: 'NXT-1', name: 'Nextrade checking', mask: '3333', type: 'depository', wave_business_id: 'NEXTRADE_BOOKS', is_private: false }];
  db.t.company_categories = [
    { id: 'c1', company_id: 'RTM_BOOKS', key: 'elec', label: 'Electricity', kind: 'expense', active: true, sort: 1, direction: 'out', is_payroll: false },
    { id: 'c2', company_id: 'RTM_BOOKS', key: 'repairs', label: 'Repairs', kind: 'expense', active: true, sort: 2, direction: 'out', is_payroll: false },
    { id: 'c3', company_id: 'RTM_BOOKS', key: 'payroll', label: 'Payroll', kind: 'expense', active: true, sort: 3, direction: 'out', is_payroll: true },
    { id: 'c4', company_id: 'NEXTRADE_BOOKS', key: 'elec', label: 'Electricity', kind: 'expense', active: true, sort: 1, direction: 'out', is_payroll: false }];
  function ln(id, name, extra) { return Object.assign({ id: id, wave_business_id: 'RTM_BOOKS', account_id: 'RTM-1', direction: 'out', amount_abs: 100, date: '2026-11-05', name: name, merchant_name: null, pending: false, review_status: null, company_category: null, transfer_group_id: null }, extra || {}); }
  db.t.bank_transactions = [
    ln('L1', 'CENTERPOINT ENERGY PAYMENT 251101'), ln('L2', 'CENTERPOINT ENERGY PAYMENT 251001', { date: '2026-10-05' }), ln('L3', 'CENTERPOINT ENERGY PAYMENT 250901', { date: '2025-09-05' }),
    ln('L4', 'CENTERPOINT ENERGY PAYMENT PENDING', { pending: true }), ln('L5', 'CENTERPOINT ENERGY REFUND', { direction: 'in' }),
    ln('L6', 'ZELLE TO JOHN SMITH 7781'), ln('L7', 'CHECK 1042'),
    ln('LP', 'SECRET VENDOR LLC 5521', { account_id: 'RTM-PRIV' }), ln('LP2', 'SECRET VENDOR LLC 5522', { account_id: 'RTM-PRIV' }),
    ln('N1', 'CENTERPOINT ENERGY PAYMENT 251101', { wave_business_id: 'NEXTRADE_BOOKS', account_id: 'NXT-1' })];
  db.t.company_rules = []; db.t.company_category_map = []; db.t.company_bill_links = []; db.t.expense_categories = [{ key: 'utilities', label: 'Utilities', active: true, kind: 'expense', sort: 1 }];
  db.t.hub_audit_log = []; db.t.audit_log = [];
  db.rpcs.hub_company_books_installed = function () { return { data: true, error: null }; };
  db.rpcs.hub_company_categorize = function (args, dbx) {
    var p = args.p; var row = dbx.t.bank_transactions.filter(function (x) { return x.id === p.line_id; })[0];
    if (!row || row.wave_business_id !== p.company_id) { return { data: null, error: { message: 'HUB_GUARD: not this company' } }; }
    row.company_category = p.category_key; row.company_category_source = p.source;
    return { data: { ok: true, action: 'none' }, error: null };
  };
  db.guard = true;
  db.rpcs.hub_company_rule_guard_installed = function (args, dbx) { return { data: dbx.guard === true, error: null }; };
  db.rpcs.hub_company_categorize_if_open = function (args, dbx) {
    if (dbx.beforeGuarded) { var hook = dbx.beforeGuarded; dbx.beforeGuarded = null; hook(args.p); }
    var p = args.p; var row = dbx.t.bank_transactions.filter(function (x) { return x.id === p.line_id; })[0];
    var why = !row ? 'not_found' : row.wave_business_id !== p.company_id ? 'other_company' : row.company_category != null ? 'already_categorized' : row.pending === true ? 'pending' : row.review_status === 'duplicate' ? 'duplicate' : row.transfer_group_id ? 'paired_transfer' : null;
    if (why) { return { data: { ok: true, skipped: true, why: why, action: 'none' }, error: null }; }
    dbx.guardedCalls = (dbx.guardedCalls || 0) + 1;
    return dbx.rpcs.hub_company_categorize({ p: Object.assign({}, p, { source: 'rule' }) }, dbx);
  };
  db.rpcs.hub_company_categorize_with_mapping = function (args, dbx) {
    var rpc = args.p.source === 'rule' ? 'hub_company_categorize_if_open' : 'hub_company_categorize';
    return dbx.rpcs[rpc](args, dbx);
  };
  state.db = db; return db;
}
function cat(db, id) { return db.t.bank_transactions.filter(function (x) { return x.id === id; })[0].company_category; }
function rulesOf(db, company) { return db.t.company_rules.filter(function (r) { return r.company_id === company; }); }

(async function () {
  var db = seed(); state.perms = { 'company.rtm.manage': true, 'company.rtm.view': true }; state.superAdmin = false;

  var r1 = await call({ company: 'rtm', action: 'set_category', ids: ['L1'], category_key: 'elec' });
  var rr = rulesOf(db, 'RTM_BOOKS');
  check('categorizing one line by hand saves it AND learns one rule for this company', r1.ok && cat(db, 'L1') === 'elec' && rr.length === 1 && rr[0].match_text === 'centerpoint energy' && rr[0].category_key === 'elec' && rr[0].direction === 'out' && rr[0].active === true && rr[0].company_id === 'RTM_BOOKS', [r1, rr]);
  check('the answer says what was learned and how many OTHER lines it covers (any date; not pending, not money-in)', r1.learned.length === 1 && r1.learned[0].state === 'created' && r1.learned[0].matches === 2 && r1.learned[0].rule_id === rr[0].id, r1.learned);
  check('nothing else was categorized by the learning itself (the person is asked first)', cat(db, 'L2') === null && cat(db, 'L3') === null);
  check('the other company got no rule and its same-named line is untouched', rulesOf(db, 'NEXTRADE_BOOKS').length === 0 && cat(db, 'N1') === null);

  var r2 = await call({ company: 'rtm', action: 'apply_rules', all_dates: true, rule_ids: [rr[0].id] });
  check('"yes, the others too": every matching line of ANY date is categorized by that rule', r2.ok && r2.categorized === 2 && cat(db, 'L2') === 'elec' && cat(db, 'L3') === 'elec', r2);
  check('… but not the pending line, the money-in line, or the other company', cat(db, 'L4') === null && cat(db, 'L5') === null && cat(db, 'N1') === null);
  check('… and the rule counts its uses', rulesOf(db, 'RTM_BOOKS')[0].hit_count === 2, rulesOf(db, 'RTM_BOOKS')[0]);

  var r3 = await call({ company: 'rtm', action: 'set_category', ids: ['L2'], category_key: 'repairs' });
  rr = rulesOf(db, 'RTM_BOOKS');
  check('changing a line to another category UPDATES the same rule (no second rule)', r3.ok && rr.length === 1 && rr[0].category_key === 'repairs' && r3.learned[0].state === 'updated' && r3.learned[0].was === 'elec', [r3.learned, rr]);
  check('lines categorized earlier keep their category (only the rule changed)', cat(db, 'L1') === 'elec' && cat(db, 'L3') === 'elec' && cat(db, 'L2') === 'repairs');

  var r4 = await call({ company: 'rtm', action: 'set_category', ids: ['L2'], category_key: 'repairs' });
  check('saving the same category again changes nothing', r4.ok && rulesOf(db, 'RTM_BOOKS').length === 1 && (r4.learned.length === 0 || r4.learned[0].state === 'kept'), r4.learned);

  var r5 = await call({ company: 'rtm', action: 'set_category', ids: ['L6'], category_key: 'payroll' });
  check('a PAYROLL line teaches nothing — the person\'s name never reaches the rules', r5.ok && cat(db, 'L6') === 'payroll' && rulesOf(db, 'RTM_BOOKS').length === 1 && r5.learned.length === 0 && JSON.stringify(db.t.company_rules).toLowerCase().indexOf('john') < 0, r5.learned);

  var r6 = await call({ company: 'rtm', action: 'set_category', ids: ['L7'], category_key: 'repairs' });
  check('"CHECK 1042" is categorized but no rule is learned from it', r6.ok && cat(db, 'L7') === 'repairs' && rulesOf(db, 'RTM_BOOKS').length === 1 && r6.learned.length === 0);

  var r7 = await call({ company: 'rtm', action: 'set_category', ids: ['L5'], category_key: null });
  check('taking a category off teaches nothing and removes no rule', r7.ok && rulesOf(db, 'RTM_BOOKS').length === 1 && (r7.learned || []).length === 0);

  // private account: a person without the private permission cannot touch the line at all
  var r8 = await call({ company: 'rtm', action: 'set_category', ids: ['LP'], category_key: 'repairs' });
  check('a private-account line is refused for a person who may not see private accounts', !r8.ok && cat(db, 'LP') === null && rulesOf(db, 'RTM_BOOKS').length === 1, r8);
  // … and a person who MAY see it can categorize it, but its description never becomes a rule
  state.superAdmin = true;
  var r9 = await call({ company: 'rtm', action: 'set_category', ids: ['LP'], category_key: 'repairs' });
  check('the super admin categorizes a private-account line; NO rule is learned from it', r9.ok && cat(db, 'LP') === 'repairs' && rulesOf(db, 'RTM_BOOKS').length === 1 && JSON.stringify(db.t.company_rules).toLowerCase().indexOf('secret') < 0 && r9.learned.length === 0, [r9.learned, db.t.company_rules]);
  state.superAdmin = false;

  // bulk: several lines at once learn each distinct text once
  db = seed();
  var r10 = await call({ company: 'rtm', action: 'set_category', ids: ['L1', 'L2', 'L3', 'L7'], category_key: 'elec' });
  check('several lines at once: one rule per distinct description, none for "CHECK 1042"', r10.ok && r10.saved === 4 && rulesOf(db, 'RTM_BOOKS').length === 1 && r10.learned.length === 1 && r10.learned[0].matches === 0, [r10.learned, db.t.company_rules]);

  // the learn switch can be turned off by the caller
  db = seed();
  var r11 = await call({ company: 'rtm', action: 'set_category', ids: ['L1'], category_key: 'elec', learn: false });
  check('learn:false saves the line and learns nothing', r11.ok && cat(db, 'L1') === 'elec' && db.t.company_rules.length === 0);

  // a rule that cannot be saved never undoes the categorizing
  db = seed(); var realFrom = db.from.bind(db);
  db.from = function (t) { var q = realFrom(t); if (t === 'company_rules') { q.insert = function () { return { select: function () { return { maybeSingle: function () { return Promise.resolve({ data: null, error: { message: 'boom' } }); } }; } }; }; } return q; };
  var r12 = await call({ company: 'rtm', action: 'set_category', ids: ['L1'], category_key: 'elec' });
  check('if the rule cannot be saved the line is STILL categorized and the answer says the rule failed', r12.ok && cat(db, 'L1') === 'elec' && r12.learned.length === 1 && r12.learned[0].state === 'failed', r12);

  // view-only people learn nothing (they cannot categorize at all)
  db = seed(); state.perms = { 'company.rtm.view': true };
  var r13 = await call({ company: 'rtm', action: 'set_category', ids: ['L1'], category_key: 'elec' });
  var r14 = await call({ company: 'rtm', action: 'apply_rules', all_dates: true });
  var r14b = await call({ company: 'rtm', action: 'apply_rules', from: '2026-10-01', to: '2026-11-30', preview: true });
  check('view-only: categorizing, applying rules and even counting are refused; nothing changes', r13._status === 403 && r14._status === 403 && r14b._status === 403 && cat(db, 'L1') === null && db.t.company_rules.length === 0);

  // ── rules never write by themselves; a run is a person's press (Codex 19 Nov 20:27 P1 / P3) ──
  db = seed(); state.perms = { 'company.rtm.manage': true, 'company.rtm.view': true };
  var a0 = await call({ company: 'rtm', action: 'apply_rules', from: '2026-10-01', to: '2026-11-30' });
  check('with no rules, applying does nothing (and does not fail)', a0.ok && a0.categorized === 0 && cat(db, 'L1') === null);
  db.t.company_rules.push({ id: 'R1', company_id: 'RTM_BOOKS', match_text: 'centerpoint energy', category_key: 'elec', direction: 'out', active: true, hit_count: 0 });
  db.t.company_rules.push({ id: 'RN', company_id: 'NEXTRADE_BOOKS', match_text: 'zelle', category_key: 'elec', direction: 'out', active: true, hit_count: 0 });
  var before = JSON.stringify(db.t.bank_transactions) + JSON.stringify(db.t.company_rules);
  var pv = await call({ company: 'rtm', action: 'apply_rules', from: '2026-10-01', to: '2026-11-30', preview: true });
  check('COUNTING (what opening the page does) writes nothing at all and says 2 lines', pv.ok && pv.preview === true && pv.would === 2 && JSON.stringify(db.t.bank_transactions) + JSON.stringify(db.t.company_rules) === before, pv);
  var au = await call({ company: 'rtm', action: 'apply_rules', from: '2026-10-01', to: '2026-11-30', automatic: true });
  check('an "automatic" run is refused by the server — nothing changes', !au.ok && au._status === 400 && JSON.stringify(db.t.bank_transactions) + JSON.stringify(db.t.company_rules) === before, au);
  // Cancel → Show / reopen: the screen only ever sends the count, so a declined line stays as it is however often the page is opened
  for (var rep2 = 0; rep2 < 3; rep2++) { await call({ company: 'rtm', action: 'lines', from: '2026-10-01', to: '2026-11-30' }); await call({ company: 'rtm', action: 'apply_rules', from: '2026-10-01', to: '2026-11-30', preview: true }); }
  check('after a decline, opening the page three more times categorizes nothing', JSON.stringify(db.t.bank_transactions) + JSON.stringify(db.t.company_rules) === before);
  var a1 = await call({ company: 'rtm', action: 'apply_rules', from: '2026-10-01', to: '2026-11-30' });
  check('pressing Apply uses the rules on the dates shown: 2 lines, not the 2025 one, not pending, not money-in', a1.ok && a1.categorized === 2 && a1.skipped === 0 && cat(db, 'L1') === 'elec' && cat(db, 'L2') === 'elec' && cat(db, 'L3') === null && cat(db, 'L4') === null && cat(db, 'L5') === null, a1);
  check('… through the GUARDED database step (never the plain one)', db.guardedCalls === 2);
  check('another company\'s rule is never used here (the Zelle line stays as it is)', cat(db, 'L6') === null);
  check('private-account lines are not categorized for a person who may not see them', cat(db, 'LP') === null && cat(db, 'LP2') === null);
  var a2 = await call({ company: 'rtm', action: 'apply_rules', from: '2026-10-01', to: '2026-11-30' });
  check('pressing Apply again changes nothing', a2.ok && a2.categorized === 0);
  var a3 = await call({ company: 'rtm', action: 'apply_rules', all_dates: true, rule_ids: ['nope'] });
  check('rule_ids limits the run to those rules (an unknown id → nothing)', a3.ok && a3.categorized === 0 && cat(db, 'L3') === null);

  // Codex's interleaving: the rule run has CHOSEN L1 (from its earlier read); a person saves L1 = repairs; then the rule's write arrives
  async function interleave(company, lineId, permsObj, ruleCat, manualCat) {
    var d = seed(); state.perms = permsObj; var cidX = company === 'rtm' ? 'RTM_BOOKS' : 'NEXTRADE_BOOKS';
    d.t.company_rules.push({ id: 'RX', company_id: cidX, match_text: 'centerpoint energy', category_key: ruleCat, direction: 'out', active: true, hit_count: 0 });
    var bills = 0; var plain = d.rpcs.hub_company_categorize;
    d.rpcs.hub_company_categorize = function (args, dbx) { var out = plain(args, dbx); if (args.p.bill && args.p.source === 'rule') { bills++; out.data.action = 'created'; } return out; };
    d.beforeGuarded = function (p) { if (p.line_id === lineId) { var row = d.t.bank_transactions.filter(function (x) { return x.id === lineId; })[0]; row.company_category = manualCat; row.company_category_source = 'manual'; } }; // the person's save lands first
    var out = await call({ company: company, action: 'apply_rules', all_dates: true, rule_ids: ['RX'] });
    var row = d.t.bank_transactions.filter(function (x) { return x.id === lineId; })[0];
    return { out: out, row: row, bills: bills };
  }
  var i1 = await interleave('rtm', 'L1', { 'company.rtm.manage': true }, 'elec', 'repairs');
  check('RTM: a person\'s category saved in between SURVIVES the rule (line stays "repairs", source manual)', i1.row.company_category === 'repairs' && i1.row.company_category_source === 'manual', i1.row);
  check('RTM: … and the run reports it as LEFT ALONE, not as categorized', i1.out.ok && i1.out.skipped === 1 && i1.out.categorized === 2, i1.out);
  var i2 = await interleave('nextrade', 'N1', { 'company.nextrade.manage': true }, 'elec', 'elec');
  check('Nextrade: the same — the person\'s category stays, the rule is counted as left alone', i2.row.company_category_source === 'manual' && i2.out.ok && i2.out.skipped === 1 && i2.out.categorized === 0, [i2.out, i2.row]);
  check('Nextrade: … and NO KTC bill is made, counted or changed by the rule', i2.bills === 0 && i2.out.bills_made === 0);

  // the database step not installed, or its check unreadable: EVERY rule write is refused (Codex 20:58 / 21:03) — no unguarded path
  async function noGuard(mode) {
    var d = seed(); state.perms = { 'company.rtm.manage': true };
    if (mode === 'absent') { d.guard = false; } else { d.rpcs.hub_company_rule_guard_installed = function () { return { data: null, error: { message: 'function public.hub_company_rule_guard_installed() does not exist' } }; }; }
    d.t.company_rules.push({ id: 'R1', company_id: 'RTM_BOOKS', match_text: 'centerpoint energy', category_key: 'elec', direction: 'out', active: true, hit_count: 0 });
    var calls = 0; var plain = d.rpcs.hub_company_categorize; var open = d.rpcs.hub_company_categorize_if_open;
    d.rpcs.hub_company_categorize = function (x, y) { calls++; return plain(x, y); }; d.rpcs.hub_company_categorize_if_open = function (x, y) { calls++; return open(x, y); };
    var snap = JSON.stringify(d.t.bank_transactions) + JSON.stringify(d.t.company_rules);
    var dated = await call({ company: 'rtm', action: 'apply_rules', from: '2026-10-01', to: '2026-11-30' });
    var allD = await call({ company: 'rtm', action: 'apply_rules', all_dates: true });
    var byRule = await call({ company: 'rtm', action: 'apply_rules', all_dates: true, rule_ids: ['R1'] });
    var same = JSON.stringify(d.t.bank_transactions) + JSON.stringify(d.t.company_rules) === snap; var ruleCalls = calls;
    var pvw = await call({ company: 'rtm', action: 'apply_rules', from: '2025-01-01', to: '2026-11-30', preview: true });
    var hand = await call({ company: 'rtm', action: 'set_category', ids: ['L7'], category_key: 'repairs' });
    return { dated: dated, allD: allD, byRule: byRule, same: same, ruleCalls: ruleCalls, pvw: pvw, hand: hand, handCat: d.t.bank_transactions.filter(function (x) { return x.id === 'L7'; })[0].company_category };
  }
  for (var gm of ['absent', 'error']) {
    var ng = await noGuard(gm);
    check('guard ' + gm + ': the dated Apply, the any-date run and the chosen-rule run are ALL refused (409) with the script named', ng.dated._status === 409 && ng.allD._status === 409 && ng.byRule._status === 409 && /v55-83-VK-rule-apply-guard\.sql/.test(ng.dated.error) && ng.dated.error.indexOf('Until then') < 0, [ng.dated, ng.allD, ng.byRule]);
    check('guard ' + gm + ': not one categorize / bill call was made and nothing changed', ng.ruleCalls === 0 && ng.same);
    check('guard ' + gm + ': counting still works (read-only) and a person can still categorize by hand', ng.pvw.ok && ng.pvw.would === 3 && ng.hand.ok && ng.handCat === 'repairs', [ng.pvw, ng.hand]);
  }
  var routeSrc0 = fs.readFileSync(path.join(root, 'src/app/api/accounting/company-books/route.js'), 'utf8');
  check('the route has no unguarded rule write: the rule loop always passes guarded = true', routeSrc0.indexOf("categorize(ln, byKeyA[rule.category_key], 'rule', nctxA, true)") > 0 && routeSrc0.indexOf('guardA') < 0 && routeSrc0.indexOf("if (gq.error || gq.data !== true) { return fail(SQL_MISSING_VK, 409); }") > 0);

  // (Codex 20:27 P2) the private check fails CLOSED
  async function privLookup(err) {
    var d = seed(); state.perms = { 'company.rtm.manage': true, 'company.rtm.view': true }; state.superAdmin = true; var rf = d.from.bind(d);
    d.from = function (t) { var q = rf(t); if (t === 'plaid_accounts') { var sel = q.select.bind(q); q.select = function (cols) { var q2 = sel(cols); if (String(cols).indexOf('is_private') >= 0 && String(cols).indexOf('name') < 0) { var eq = q2.eq.bind(q2); q2.eq = function (k, v) { if (k === 'is_private') { return Promise.resolve({ data: null, error: err }); } return eq(k, v); }; } return q2; }; } return q; };
    var out = await call({ company: 'rtm', action: 'set_category', ids: ['LP'], category_key: 'repairs' });
    state.superAdmin = false; d.from = rf; state.perms = { 'company.rtm.view': true };
    var seen = await call({ company: 'rtm', action: 'rules' });
    return { out: out, rules: d.t.company_rules, seen: seen, line: d.t.bank_transactions.filter(function (x) { return x.id === 'LP'; })[0] };
  }
  var p1 = await privLookup({ code: '42501', message: 'permission denied for column is_private' });
  check('private check answers "permission denied for column is_private" → the line is saved, NO rule is written', p1.out.ok && p1.line.company_category === 'repairs' && p1.rules.length === 0 && p1.out.learned.length === 1 && p1.out.learned[0].state === 'failed' && !p1.out.learned[0].match_text, [p1.out.learned, p1.rules]);
  check('… and an ordinary View-only person reading the rules afterwards sees nothing about that vendor', p1.seen.ok && JSON.stringify(p1.seen.rules).toLowerCase().indexOf('secret') < 0);
  var p2 = await privLookup({ message: 'network failure' });
  check('private check fails for another reason (network) → no rule', p2.out.ok && p2.rules.length === 0 && p2.out.learned[0].state === 'failed');
  var p3 = await privLookup({ code: 'PGRST204', message: "Could not find the 'is_private' column of 'plaid_accounts' in the schema cache" });
  check('an error that only LOOKS like a missing column but comes without the missing-column code is not trusted', (await privLookup({ message: 'column is_private does not exist' })).rules.length === 0);
  check('only the exact "column does not exist" answer (nothing is private on such a database) lets learning go on', p3.out.ok && p3.rules.length === 1, p3.out.learned);
  state.superAdmin = false; state.perms = { 'company.rtm.manage': true, 'company.rtm.view': true }; db = seed();

  // Nextrade lines carry the KTC category setting
  state.perms = { 'company.nextrade.manage': true, 'company.nextrade.view': true };
  db.t.company_category_map.push({ company_id: 'NEXTRADE_BOOKS', category_key: 'elec', ktc_category: 'utilities' });
  var nexttradeLine = db.t.bank_transactions.find(function (line) { return line.id === 'N1'; });
  Object.assign(nexttradeLine, { bank_source: '[CSV] Bank', plaid_transaction_id: 'manual-import-id' });
  db.t.plaid_accounts.find(function (account) { return account.plaid_account_id === 'NXT-1'; }).connection_id = 'feed1';
  db.t.bank_connections = [{ id: 'feed1', plaid_item_id: 'plaid-item-id', status: 'active', last_synced: '2026-11-27T14:00:00Z', last_sync_status: 'ok' }];
  var n1 = await call({ company: 'nextrade', action: 'lines', from: '2026-10-01', to: '2026-11-30' });
  check('Nextrade lines come with the KTC category of each Nextrade category and KTC\'s category list', n1.ok && n1.ktc_map && n1.ktc_map.elec === 'utilities' && n1.ktc_categories.length === 1 && n1.ktc_categories[0].key === 'utilities', [n1.ktc_map, n1.ktc_categories]);
  check('Nextrade rows show the import source without provider identifiers', n1.lines[0].source === 'csv' && !n1.lines[0].bank_source && !n1.lines[0].plaid_transaction_id, n1.lines[0]);
  var accounts = await call({ company: 'nextrade', action: 'accounts' });
  check('Accounts show Plaid status without the Plaid item identifier', accounts.ok && accounts.accounts[0].feed_type === 'plaid' && accounts.accounts[0].last_sync_status === 'ok' && !accounts.accounts[0].plaid_item_id, accounts);
  var draft = { lineId: 'N1', match_text: 'centerpoint energy', direction: 'out', category_key: 'elec' };
  var savedRule = await call({ company: 'nextrade', action: 'save_rule', rule: draft });
  check('A transaction can seed a saved rule and stay uncategorized until Apply', savedRule.ok && rulesOf(db, 'NEXTRADE_BOOKS').length === 1 && !nexttradeLine.company_category, savedRule);
  var crossCompanyRule = await call({ company: 'nextrade', action: 'save_rule', rule: Object.assign({}, draft, { lineId: 'L1' }) });
  check('A rule draft cannot use a transaction from another company', crossCompanyRule._status === 404, crossCompanyRule);
  var taxRequest = { action: 'tax_report', company: 'nextrade', from: '2026-01-01', to: '2026-11-27' };
  var blockedTax = await call(taxRequest);
  check('The tax report requires the existing financial summary permission', blockedTax._status === 403, blockedTax);
  state.perms['accounting.view_totals'] = true;
  var taxResult = await call(taxRequest);
  check('The Nextrade tax endpoint reads its own transactions and shows restricted scope', taxResult.ok && taxResult.report.currencies[0].summary.review_count === 1 && taxResult.report.currencies[0].rows[0].count === 1 && taxResult.payroll_restricted && taxResult.accounts_restricted, taxResult);
  var invalidTax = await call(Object.assign({}, taxRequest, { to: '2026-02-30' }));
  check('An invalid calendar date is rejected by the tax report', invalidTax._status === 400, invalidTax);
  state.perms = { 'company.rtm.manage': true, 'company.rtm.view': true };
  var n2 = await call({ company: 'rtm', action: 'lines', from: '2026-10-01', to: '2026-11-30' });
  check('RTM lines carry no KTC mapping (RTM makes no KTC bills)', n2.ok && n2.ktc_map === undefined && n2.ktc_categories === undefined);

  // ── wiring of the two screens ──
  var tab = fs.readFileSync(path.join(root, 'src/components/CompanyBooksTab.jsx'), 'utf8');
  check('Transactions opens on ALL lines (a categorized line stays on the page)', /useState\('all'\); var show = /.test(tab) && tab.indexOf("useState('uncat'); var show") < 0);
  check('filter offers All, Categorized and Uncategorized and uses the shared rule', tab.indexOf('value="cat"') > 0 && tab.indexOf('value="uncat"') > 0 && tab.indexOf('value="all"') > 0 && tab.indexOf('lineShown(show, l)') > 0 && /import \{ [^}]*lineShown[^}]* \} from '\.\.\/lib\/company-rule-learn'/.test(tab));
  check('after a hand categorization the screen asks before using the new rule on other lines', tab.indexOf('window.confirm(nMore') > 0 && tab.indexOf("action: 'apply_rules', all_dates: true, rule_ids:") > 0);
  check('loading lines uses a read-only rules preview and shows an Apply button', tab.indexOf("action: 'apply_rules', from: from, to: to, preview: true") > 0 && tab.indexOf('setRuleWait({ would: a.would') > 0 && tab.indexOf('loadLines(true)') < 0);
  check('every Apply press counts first, asks, and only then writes', (function () { var f0 = tab.indexOf('function applyRulesAsk()'); var f1 = tab.indexOf('preview: true', f0); var f2 = tab.indexOf('window.confirm(', f1); var f3 = tab.indexOf("api({ action: 'apply_rules', from: from, to: to })", f2); return f0 > 0 && f1 > f0 && f2 > f1 && f3 > f2; })() && tab.split('onClick={applyRulesAsk}').length === 3);
  check('a failed or partial rule run is always shown (error, lines left alone, lines it could not do)', tab.indexOf('if (!a || !a.ok) { toast.error') > tab.indexOf('function sayRuleRun(a, lead)') && tab.indexOf('function sayRuleRun(a, lead)') > 0 &&tab.indexOf('a.skipped') > 0 && tab.indexOf('could NOT be categorized by a rule') > 0);
  check('the KTC category is set on the Nextrade line through the existing mapping action', tab.indexOf('function setKtcCategory') > 0 && tab.indexOf("action: 'save_mapping', category_key: nextradeKey") > 0);
  var wp = fs.readFileSync(path.join(root, 'src/components/WirePackagesPanel.jsx'), 'utf8');
  check('wire picker imports and uses the tree helpers', /import \{ wireBillsToShow, groupByVendor, groupTotals, tickGroup \} from '\.\.\/lib\/wire-bill-tree'/.test(wp) && wp.indexOf('tickGroup(ed.picks, mineB,') > 0 && wp.indexOf('tickGroup(ed.picks, g.bills,') > 0 && wp.indexOf('groupByVendor(mineB, ed.picks)') > 0);
  check('a wire to NextTrade starts on NextTrade\'s bills only; one press shows all', wp.indexOf("ed.onlyTheirs === undefined ? ed.kind === 'affiliate'") > 0 && wp.indexOf('onlyTheirs: true') > 0 && wp.indexOf('onlyTheirs: false') > 0);
  check('choosing another payee resets the filter and the folded groups', /setEd\(Object\.assign\(\{\}, ed, \{ kind: kind, payee: name, picks: \{\}, bills: null,[^\n]*onlyTheirs: undefined, shut: \{\}/.test(wp));
  var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/company-books/route.js'), 'utf8');
  check('the route writes rules only inside the caller\'s company and never deletes one', route.indexOf(".from('company_rules').delete") < 0 && route.indexOf(".eq('id', plan.rule.id).eq('company_id', cid)") > 0 && route.indexOf("insert({ company_id: cid, match_text: plan.text") > 0);

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
