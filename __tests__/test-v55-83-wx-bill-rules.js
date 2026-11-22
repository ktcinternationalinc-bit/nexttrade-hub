// v55.83-WX — bill category rules (Max, 21 Nov 2026: "i need to be able to create rules for bills as well to place categories. even
// using a certain amount ... to always be partner fees ... and this will be used in the pnl breakdowns"). Executed, not source pins:
// the pure matcher; the REAL Bill rules route (save / preview / apply / switch off) and the REAL Bills route (new bills, edits) on an
// in-memory database; the P&L column a rule-set category lands in. Codex plan review 21 Nov: company + currency scope, all conditions,
// cents, specificity then priority, ties left for a person (no fall-through to the vendor memory), human / unknown categories never
// overwritten, no double count of a bill already in goods / transport profit. All names and amounts are made up.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var R = require(path.join(root, 'src/lib/bill-rules.js'));
var P = require(path.join(root, 'src/lib/pnl-expenses.js'));
var nameKey = require(path.join(root, 'src/lib/profitability.js')).nameKey;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('WX — bill category rules');

var CATS = { partner_fee: { key: 'partner_fee', label: 'Partner fee', kind: 'expense' }, office: { key: 'office', label: 'Office', kind: 'expense' }, freight: { key: 'freight', label: 'Freight', kind: 'expense' }, rent: { key: 'rent', label: 'Rent', kind: 'expense' } };
function bill(o) { return Object.assign({ id: 'b', vendor_name: 'Example Partner Corp.', total_amount: 1234.56, currency: 'USD', wave_business_id: US, record_status: 'active', bill_number: 'EP-1', bill_date: '2026-09-01', notes: '', category: null, category_source: null }, o || {}); }
function rule(o) { return Object.assign({ id: 'r', name: 'r', vendor_match: 'Example Partner', amount_exact: null, amount_min: null, amount_max: null, words: null, currency: 'USD', wave_business_id: US, category: 'partner_fee', priority: 0, active: true, version: 1 }, o || {}); }

// ── 1. the matcher (pure)
var rx = rule({ id: 'rx', amount_exact: '1234.56' });
check('1a: vendor written differently (case, "Corp.") + exact bill total to the cent → fits', R.ruleFits(rx, bill({ vendor_name: 'EXAMPLE PARTNER CORPORATION' })).ok);
check('1b: one cent off → does not fit', R.ruleFits(rx, bill({ total_amount: 1234.55 })).why === 'another amount');
check('1c: another company\'s books → does not fit', R.ruleFits(rx, bill({ wave_business_id: 'OTHER' })).why === 'another company');
check('1d: another currency (CAD) → does not fit', R.ruleFits(rx, bill({ currency: 'CAD' })).why === 'another currency');
check('1e: another vendor → does not fit', R.ruleFits(rx, bill({ vendor_name: 'Some Trucker LLC' })).why === 'another vendor');
var rr = rule({ id: 'rr', amount_min: 1000, amount_max: 1234.56 });
check('1f: a range includes both ends; above it does not fit', R.ruleFits(rr, bill()).ok && R.ruleFits(rr, bill({ total_amount: 1000 })).ok && !R.ruleFits(rr, bill({ total_amount: 1234.57 })).ok);
var rw = rule({ id: 'rw', words: 'monthly fee' });
check('1g: words must be ON the bill (here in a line read from it); missing words → no fit', R.ruleFits(rw, bill(), [{ description: 'Monthly fee November' }]).ok && R.ruleFits(rw, bill(), []).why === 'the words are not on the bill');
check('1h: ALL conditions must match (exact amount + words: the amount fits but the words do not → no fit)', !R.ruleFits(rule({ amount_exact: 1234.56, words: 'monthly fee' }), bill(), []).ok);
check('1i: a switched-off rule never fits', !R.ruleFits(rule({ active: false }), bill()).ok);
var rv = rule({ id: 'rv', category: 'office' });
check('2a: exact amount beats a vendor-only rule', R.billRuleFor(bill(), [rv, rx]).rule.id === 'rx');
check('2b: a range beats vendor-only; exact beats a range', R.billRuleFor(bill(), [rv, rr]).rule.id === 'rr' && R.billRuleFor(bill(), [rr, rx, rv]).rule.id === 'rx');
check('2c: equally exact rules: the higher weight wins', R.billRuleFor(bill(), [rule({ id: 'p0', category: 'office' }), rule({ id: 'p5', category: 'rent', priority: 5 })]).rule.id === 'p5');
var tie = R.billRuleFor(bill(), [rule({ id: 't1', category: 'office' }), rule({ id: 't2', category: 'rent' })]);
check('2d: equal weight, different categories → NO rule, both listed as the conflict (a person decides)', tie.rule === null && tie.conflict && tie.conflict.length === 2);
check('2e: equal weight, SAME category → no conflict', R.billRuleFor(bill(), [rule({ id: 's1' }), rule({ id: 's2' })]).rule !== null);
// counted in profit
check('3a: a trucking bill with a release # is counted in transport profit', !!R.countedInProfit({ bill_type: 'trucking', release_number: '1002-77' }, []));
check('3b: a bonded / brokerage bill is counted in shipment costs', !!R.countedInProfit({ bill_type: 'bonded_brokerage' }, []));
check('3c: a supplier bill whose line is a product linked in the P&L set-up is in goods profit; an unlinked line is not', !!R.countedInProfit({ bill_type: 'supplier' }, [{ line_kind: 'item', description: 'Roll Goods A' }], { 'roll goods a': true }, nameKey) && !R.countedInProfit({ bill_type: 'supplier' }, [{ line_kind: 'item', description: 'Monthly fee' }], { 'roll goods a': true }, nameKey));
var blk = R.categoryForNew(bill({ bill_type: 'trucking', release_number: '1002-77' }), [rx], CATS, []);
check('3d: a rule that would put such a bill into a DEDUCTED column (Partner fee) gives NO category and says why', blk.category === null && blk.source === 'rule_conflict' && /transport profit/.test(blk.blocked || ''), blk);
check('3e: the same bill with a rule to a non-deducted category (Freight) is fine', R.categoryForNew(bill({ bill_type: 'trucking', release_number: '1002-77' }), [rule({ amount_exact: 1234.56, category: 'freight' })], CATS, []).category === 'freight');
// the P&L column
check('4a: Partner fee lands in column C (deducted); Freight stays inside transport profit (never deducted again)', P.letterOf(CATS.partner_fee) === 'C' && P.letterOf(CATS.freight) === 'in_profit' && R.isDeducted(CATS.partner_fee) && !R.isDeducted(CATS.freight));
// cleanRule
var c1 = R.cleanRule({ vendor_match: 'Example Partner', amount_exact: '$1,234.56', category: 'partner_fee' }, Object.keys(CATS));
check('5a: a typed amount "$1,234.56" is stored as 1234.56; a name is made when none is typed', c1.ok && c1.rule.amount_exact === 1234.56 && /Example Partner/.test(c1.rule.name), c1);
var c2 = R.cleanRule({ vendor_match: '', amount_exact: 5, amount_min: 1, category: 'nope', currency: 'us' }, Object.keys(CATS));
check('5b: refused with every reason: no vendor, exact AND range, unknown category, bad currency', !c2.ok && c2.errors.length >= 4, c2.errors);

// ── 6. the REAL Bill rules route + the REAL Bills route on an in-memory database
var A = 'a6000000-0000-0000-0000-00000000000';
var db = new MemDB({
  users: [{ id: 'u1', name: 'Clerk', role: 'staff', active: true }, { id: 'u2', name: 'Viewer', role: 'staff', active: true }],
  module_permissions: [].concat(['accounting.view', 'accounting.clickbooks.access', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.view', 'accounting.clickbooks.access', 'bills.view'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  expense_categories: Object.keys(CATS).map(function (k) { return Object.assign({ active: true }, CATS[k]); }),
  bill_category_rules: [],
  us_expense_rules: [{ id: 'mem1', match_text: 'example partner', classification: 'rent', active: true, source: 'learned' }],
  vendor_bills: [
    bill({ id: A + '1', bill_number: 'EP-11' }),                                                       // blank → will be set
    bill({ id: A + '2', bill_number: 'EP-12', category: 'office', category_source: 'manual' }),        // a person's pick → kept
    bill({ id: A + '3', bill_number: 'EP-13', category: 'office', category_source: null }),            // set before rules existed → kept
    bill({ id: A + '4', bill_number: 'EP-14', currency: 'CAD' }),                                      // other currency → not listed
    bill({ id: A + '5', bill_number: 'EP-15', wave_business_id: 'OTHER' }),                            // other company → not listed
    bill({ id: A + '6', bill_number: 'EP-16', bill_type: 'trucking', release_number: '1002-77' }),     // in transport profit → kept
    bill({ id: A + '7', bill_number: 'EP-17', paid_via: 'RTM Capital' }),                              // paid → will be set, P&L warning
    bill({ id: A + '8', bill_number: 'EP-18', total_amount: 99 })                                      // other amount → not listed
  ],
  vendor_bill_payments: [{ id: 'p1', bill_id: A + '7', amount: 500, voided: false }],
  vendor_bill_lines: [], pl_group_names: [], hub_audit_log: [], vendor_bill_events: [], wire_packages: [], wire_package_lines: [], bill_commission_rules: [], paid_through_parties: []
});
global.__db = db;
var rulesRoute = require(path.join(root, 'src/app/api/accounting/bill-rules/route.js'));
var billsRoute = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
async function call(route, user, body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }
function row(id) { return db.t.vendor_bills.filter(function (b) { return b.id === id; })[0]; }
function audits(a) { return db.t.hub_audit_log.filter(function (h) { return h.action === a; }); }
(async function () {
  var v0 = await call(rulesRoute, 'u2', { action: 'save', rule: { vendor_match: 'Example Partner', amount_exact: 1234.56, category: 'partner_fee' } });
  check('6a: "Bills: view" alone cannot make a rule (403)', v0._status === 403 && db.t.bill_category_rules.length === 0, v0);
  var s1 = await call(rulesRoute, 'u1', { action: 'save', rule: { name: 'Monthly partner fee', vendor_match: 'Example Partner', amount_exact: '1,234.56', category: 'partner_fee' } });
  var R1 = s1.rule;
  check('6b: a rule is saved for KTC USA in USD, version 1, on the audit trail', s1.ok && R1.wave_business_id === US && R1.currency === 'USD' && R1.version === 1 && Number(R1.amount_exact) === 1234.56 && audits('bill_rule_created').length === 1, s1);
  var lst = await call(rulesRoute, 'u2', { action: 'list' });
  check('6c: a viewer sees the rules and the categories (no manage)', lst.ok && lst.rules.length === 1 && lst.can_manage === false && lst.categories.length === 4, lst);
  var pv = await call(rulesRoute, 'u1', { action: 'preview', id: R1.id });
  var st = {}; (pv.rows || []).forEach(function (x) { st[x.id] = x.status; });
  check('6d: PREVIEW lists only this company\'s USD bills of that vendor and amount, each with what would happen',
    pv.ok && st[A + '1'] === 'will_set' && st[A + '2'] === 'protected_manual' && st[A + '3'] === 'protected_unknown' && st[A + '6'] === 'counted_in_profit' && st[A + '7'] === 'will_set' && !st[A + '4'] && !st[A + '5'] && !st[A + '8'], st);
  check('6e: the paid bill shows what was paid (so the screen can warn the P&L can move)', (pv.rows || []).filter(function (x) { return x.id === A + '7'; })[0].paid === 500);
  check('6f: preview changed nothing', row(A + '1').category === null && audits('bill_category_rule_applied').length === 0);
  var ap = await call(rulesRoute, 'u1', { action: 'apply', id: R1.id, bill_ids: [A + '1', A + '2', A + '3', A + '6', A + '7'] });
  check('6g: APPLY changes only the bills the server itself finds will change (2); the person\'s, the unknown and the transport bill are refused with the reason',
    ap.ok && ap.applied === 2 && ap.skipped.length === 3 && row(A + '1').category === 'partner_fee' && row(A + '2').category === 'office' && row(A + '3').category === 'office' && row(A + '6').category === null, ap);
  check('6h: an applied bill records rule, version and "rule" as its source', row(A + '1').category_source === 'rule' && row(A + '1').category_rule_id === R1.id && row(A + '1').category_rule_version === 1);
  var au = audits('bill_category_rule_applied');
  check('6i: one audit entry per changed bill with before / after and the rule', au.length === 2 && au.every(function (h) { return h.details && h.details.before && h.details.after && h.details.after.category === 'partner_fee' && h.details.rule.id === R1.id; }), au);
  check('6j: the paid bill is called out: the P&L of the period it was paid in can change', ap.paid_changed === 1 && /P&L/.test(ap.note || ''), ap);
  var pv2 = await call(rulesRoute, 'u1', { action: 'preview', id: R1.id });
  check('6k: preview again → those bills are "already set by this rule"', (pv2.rows || []).filter(function (x) { return x.status === 'already'; }).length === 2, pv2.counts);
  // a person changes one of them on the bill → it becomes theirs; the rule never takes it back
  var ed = await call(billsRoute, 'u1', { action: 'save_bill', bill: Object.assign({}, row(A + '1'), { category: 'office' }) });
  check('6l: a person changing the category on the bill makes it MANUAL (rule link cleared)', ed.ok && row(A + '1').category === 'office' && row(A + '1').category_source === 'manual' && row(A + '1').category_rule_id === null, ed);
  var pv3 = await call(rulesRoute, 'u1', { action: 'preview', id: R1.id });
  check('6m: …and the rule now leaves it alone', (pv3.rows || []).filter(function (x) { return x.id === A + '1'; })[0].status === 'protected_manual');
  // a stale apply: the preview said "will set", but the bill changed before Apply → refused for that bill
  db.t.vendor_bills.push(bill({ id: A + '9', bill_number: 'EP-19' }));
  var pv4 = await call(rulesRoute, 'u1', { action: 'preview', id: R1.id });
  check('6n: a new matching bill shows as "will change"', (pv4.rows || []).filter(function (x) { return x.id === A + '9'; })[0].status === 'will_set');
  row(A + '9').category = 'rent'; row(A + '9').category_source = 'manual';
  var ap2 = await call(rulesRoute, 'u1', { action: 'apply', id: R1.id, bill_ids: [A + '9'] });
  check('6o: …a person picked a category meanwhile → Apply re-checks and does NOT change it', ap2.ok && ap2.applied === 0 && row(A + '9').category === 'rent', ap2);
  // editing the rule's amount → new version; switching off
  var s2 = await call(rulesRoute, 'u1', { action: 'save', rule: Object.assign({}, R1, { amount_exact: 1234.57 }) });
  check('6p: changing what a rule matches raises its version (bills keep the version they got)', s2.ok && s2.rule.version === 2 && row(A + '7').category_rule_version === 1 && audits('bill_rule_updated').length === 1, s2);
  var off = await call(rulesRoute, 'u1', { action: 'set_active', id: R1.id, active: false });
  check('6q: switching a rule off keeps it (never deleted) and keeps what it already set', off.ok && db.t.bill_category_rules.length === 1 && db.t.bill_category_rules[0].active === false && row(A + '7').category === 'partner_fee', off);
  check('6r: there is no delete action', (await call(rulesRoute, 'u1', { action: 'delete', id: R1.id }))._status === 400 && db.t.bill_category_rules.length === 1);
  var pOff = await call(rulesRoute, 'u1', { action: 'preview', id: R1.id });
  check('6s: a switched-off rule cannot be previewed or applied', pOff._status === 409);
  await call(rulesRoute, 'u1', { action: 'set_active', id: R1.id, active: true });
  await call(rulesRoute, 'u1', { action: 'save', rule: Object.assign({}, db.t.bill_category_rules[0], { amount_exact: 1234.56 }) });

  // ── 7. NEW bills (real Bills route save_bill)
  var learnedBefore = db.t.us_expense_rules.length;
  var n1 = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Example Partner Corporation', bill_number: 'EP-21', bill_date: '2026-10-01', total_amount: 1234.56 } });
  var b21 = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'EP-21'; })[0];
  check('7a: a new bill that fits the rule gets its category, marked "set by rule" with the rule and version', n1.ok && b21.category === 'partner_fee' && b21.category_source === 'rule' && b21.category_rule_id === R1.id && n1.auto_category === 'partner_fee', { n1: n1, b: b21 });
  check('7b: a rule-set category does NOT teach the bank rules', db.t.us_expense_rules.length === learnedBefore && db.t.us_expense_rules[0].classification === 'rent');
  var n2 = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Example Partner Corporation', bill_number: 'EP-22', bill_date: '2026-10-01', total_amount: 77 } });
  var b22 = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'EP-22'; })[0];
  // (the person's edit in 6l taught the vendor memory "office" — the bank-rule memory works as before)
  check('7c: no rule fits (other amount) → the vendor memory as before (the person\'s last pick), marked as such', n2.ok && b22.category === 'office' && b22.category_source === 'vendor_memory', b22);
  var n3 = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Example Partner Corporation', bill_number: 'EP-23', bill_date: '2026-10-01', total_amount: 1234.56, category: 'office' } });
  var b23 = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'EP-23'; })[0];
  check('7d: a category typed by the person wins over the rule and is "manual"', n3.ok && b23.category === 'office' && b23.category_source === 'manual', b23);
  var n4 = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Example Partner Corporation', bill_number: 'EP-24', bill_date: '2026-10-01', total_amount: 1234.56, category: 'partner_fee', category_rule_id: R1.id } });
  var b24 = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'EP-24'; })[0];
  check('7e: the import screen pre-filled the rule\'s category and the person kept it → still "set by rule"', n4.ok && b24.category_source === 'rule' && b24.category_rule_id === R1.id, b24);
  var n5 = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Example Partner Corporation', bill_number: 'EP-25', bill_date: '2026-10-01', total_amount: 1234.56, category: 'office', category_rule_id: null } }); // superseded (Codex 09:18): the form drops the rule link when the person changes the category
  var b25 = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'EP-25'; })[0];
  check('7f: …the person changed the pre-filled category → "manual"', n5.ok && b25.category === 'office' && b25.category_source === 'manual' && !b25.category_rule_id, b25);
  var n6 = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Example Partner Corporation', bill_number: 'EP-26', bill_date: '2026-10-01', total_amount: 1234.56, bill_type: 'trucking', release_number: '1002-78', shipment_direction: 'outbound' } });
  var b26 = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'EP-26'; })[0];
  check('7g: a new trucking bill with a release # is NOT put into Partner fee (it is in transport profit): no category, and NOT the vendor memory', n6.ok && b26.category === null && b26.category_source === 'rule_conflict' && /transport profit/.test(n6.category_conflict || ''), { n6: n6, b: b26 });
  // ── 7k–7o (Codex 22 Nov 08:53 P2): save_bill must check the rule against the lines it is about to save
  db.t.pl_group_names.push({ id: 'g1', group_id: 'grp', source: 'bill', name_key: nameKey('Roll Goods A'), raw_name: 'Roll Goods A', active: true });
  await call(rulesRoute, 'u1', { action: 'save', rule: { name: 'Mill fee', vendor_match: 'Sample Mill', amount_exact: 2222.22, category: 'partner_fee' } });
  var lk = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Sample Mill Inc', bill_number: 'SM-1', bill_date: '2026-10-03', total_amount: 2222.22, bill_type: 'supplier', lines: [{ description: 'Roll Goods A', qty: 10, unit_price: 222.222, amount: 2222.22 }] } });
  var bLk = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'SM-1'; })[0];
  var lnLk = db.t.vendor_bill_lines.filter(function (l) { return bLk && l.bill_id === bLk.id; });
  check('7k: REAL save_bill: a supplier bill whose line is a product cost is NOT put into Partner fee by a rule (no category, flagged), and its line is saved',
    lk.ok && bLk.category === null && bLk.category_source === 'rule_conflict' && /goods profit/.test(lk.category_conflict || '') && lnLk.length === 1 && lnLk[0].description === 'Roll Goods A', { lk: lk, b: bLk, lines: lnLk });
  await call(rulesRoute, 'u1', { action: 'save', rule: { name: 'Mill goods', vendor_match: 'Sample Mill', amount_exact: 3333.33, category: 'freight' } });
  var lk2 = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Sample Mill Inc', bill_number: 'SM-2', bill_date: '2026-10-03', total_amount: 3333.33, bill_type: 'supplier', lines: [{ description: 'Roll Goods A', amount: 3333.33 }] } });
  var bLk2 = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'SM-2'; })[0];
  check('7l: …the same line with a rule to a category that is NOT deducted (Freight) → the rule applies', lk2.ok && bLk2.category === 'freight' && bLk2.category_source === 'rule', bLk2);
  await call(rulesRoute, 'u1', { action: 'save', rule: { name: 'Mill monthly', vendor_match: 'Sample Mill', words: 'monthly service', category: 'office' } });
  var lw = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Sample Mill Inc', bill_number: 'SM-3', bill_date: '2026-10-04', total_amount: 450, bill_type: 'supplier', lines: [{ description: 'Monthly service November', amount: 450 }] } });
  var bLw = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'SM-3'; })[0];
  check('7m: a rule whose words appear ONLY on a line of the typed bill → applies', lw.ok && bLw.category === 'office' && bLw.category_source === 'rule', bLw);
  var mill = db.t.bill_category_rules.filter(function (r) { return r.name === 'Mill fee'; })[0];
  // (Codex 09:18) the import screen pre-filled Partner fee from the rule (a line said "Mill fee"); the person corrected the LINE to the
  // product "Roll Goods A" and did NOT touch the category (category_rule_id still travels) → the pre-fill no longer holds
  var learnedBeforePf = db.t.us_expense_rules.length; var learnedSnap = JSON.stringify(db.t.us_expense_rules);
  var pf1 = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Sample Mill Inc', bill_number: 'SM-4', bill_date: '2026-10-05', total_amount: 2222.22, bill_type: 'supplier', category: 'partner_fee', category_rule_id: mill.id, _imported: true, lines: [{ description: 'Roll Goods A', amount: 2222.22 }] } });
  var bPf1 = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'SM-4'; })[0];
  check('7n: an UNTOUCHED import pre-fill that no longer holds (line corrected to a product cost) is NOT saved: no Partner fee, flagged, not "manual", the screen is told',
    pf1.ok && bPf1.category === null && bPf1.category_source === 'rule_conflict' && /not kept/.test(pf1.category_prefill_removed || ''), { b: { category: bPf1.category, source: bPf1.category_source, rule: bPf1.category_rule_id }, msg: pf1.category_prefill_removed }); // the blocked rule stays noted with the "rules disagree" source
  check('7n2: …and it teaches the vendor memory nothing (no learned rule written or changed)', !pf1.rule_learned && db.t.us_expense_rules.length === learnedBeforePf && JSON.stringify(db.t.us_expense_rules) === learnedSnap, pf1.rule_learned);
  var pfLines = db.t.vendor_bill_lines.filter(function (l) { return l.bill_id === bPf1.id; });
  check('7n3: …the bill and its corrected line are saved', pfLines.length === 1 && pfLines[0].description === 'Roll Goods A');
  var pfM = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Sample Mill Inc', bill_number: 'SM-6', bill_date: '2026-10-06', total_amount: 2222.22, bill_type: 'supplier', category: 'partner_fee', category_rule_id: null, lines: [{ description: 'Roll Goods A', amount: 2222.22 }] } });
  var bPfM = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'SM-6'; })[0];
  check('7n4: CONTROL: the person PICKED the category on the bill (the screen drops the rule link on any category change) → kept, "manual"', pfM.ok && bPfM.category === 'partner_fee' && bPfM.category_source === 'manual' && !pfM.category_prefill_removed, bPfM);
  var bt = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
  check('7n5: the bill form drops the rule link whenever the person changes the category (picker, typed box, a newly added category)', (bt.match(/category: e\.target\.value, category_rule_id: null/g) || []).length >= 2 && /category: j\.category\.key, category_rule_id: null/.test(bt));
  var pf2 = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Sample Mill Inc', bill_number: 'SM-5', bill_date: '2026-10-05', total_amount: 2222.22, bill_type: 'supplier', category: 'partner_fee', category_rule_id: mill.id, lines: [{ description: 'Mill fee for November', amount: 2222.22 }] } });
  var bPf2 = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'SM-5'; })[0];
  check('7o: …with a line that is not a product cost, the kept pre-fill stays "set by rule"', pf2.ok && bPf2.category === 'partner_fee' && bPf2.category_source === 'rule' && bPf2.category_rule_id === mill.id, bPf2);

  // two equally good rules with different categories
  await call(rulesRoute, 'u1', { action: 'save', rule: { name: 'Other view', vendor_match: 'Example Partner', amount_exact: 1234.56, category: 'office' } });
  var n7 = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Example Partner Corporation', bill_number: 'EP-27', bill_date: '2026-10-01', total_amount: 1234.56 } });
  var b27 = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'EP-27'; })[0];
  check('7h: two equally exact rules disagree → NO category (not the vendor memory either), flagged, and the screen is told which rules', n7.ok && b27.category === null && b27.category_source === 'rule_conflict' && /disagree/.test(n7.category_conflict || ''), { n7: n7, b: b27 });

  // ── 7i. the mailbox paths (e-mailed bills, the mailbox scanner): bill rules apply, the vendor memory does NOT (they never used it)
  var S = require(path.join(root, 'src/lib/bill-rules-server.js'));
  var m1 = await S.categoryForNewBill(db, { vendor_name: 'Example Partner Corp', total_amount: 55, currency: 'USD', wave_business_id: US }, [], { noMemory: true });
  var m2 = await S.categoryForNewBill(db, { vendor_name: 'Example Partner Corp', total_amount: 55, currency: 'USD', wave_business_id: US }, []);
  check('7i: mailbox path: no rule fits → NO category (no vendor memory); the typed / file path does use the memory', m1.category === null && m1.source === null && m2.source === 'vendor_memory', { m1: m1, m2: m2 });
  ['inbound', 'email-scan'].forEach(function (f) { var t = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/' + f + '/route.js'), 'utf8');
    check('7j: ' + f + ' route asks the bill rules (rules only) when the bill names no category', /categoryForNewBill\(db, \{[^\n]*\{ noMemory: true \}\)/.test(t) && /category: d\.category \|\| \(wxM && wxM\.category\) \|\| null/.test(t)); });

  // ── 8. before the database step: nothing new is written, today's behaviour stays
  var db2 = new MemDB({ users: db.t.users, module_permissions: db.t.module_permissions, expense_categories: db.t.expense_categories, us_expense_rules: [{ id: 'm', match_text: 'example partner', classification: 'rent', active: true }], vendor_bills: [], hub_audit_log: [], vendor_bill_payments: [], vendor_bill_lines: [], vendor_bill_events: [], wire_packages: [], wire_package_lines: [], bill_commission_rules: [], paid_through_parties: [] });
  var realFrom = db2.from.bind(db2);
  db2.from = function (name) { if (name === 'bill_category_rules') { var q = realFrom(name); q.then = function (res) { return Promise.resolve({ data: null, error: { message: 'relation "public.bill_category_rules" does not exist' } }).then(res); }; return q; } return realFrom(name); };
  global.__db = db2;
  var nl = await call(rulesRoute, 'u1', { action: 'list' });
  check('8a: before the SQL the screen says a database step is needed', nl.ok && nl.ready === false && /WX-bill-category-rules/.test(nl.sql_file || ''), nl);
  var ns = await call(rulesRoute, 'u1', { action: 'save', rule: { vendor_match: 'Example Partner', category: 'office' } });
  check('8b: …and refuses to save a rule (needs_sql), nothing written', ns._status === 409 && ns.needs_sql === true, ns);
  var nb = await call(billsRoute, 'u1', { action: 'save_bill', bill: { vendor_name: 'Example Partner Corporation', bill_number: 'EP-31', bill_date: '2026-10-01', total_amount: 1234.56 } });
  var b31 = db2.t.vendor_bills[0];
  check('8c: …a new bill still gets the vendor memory, and the new columns are NOT written', nb.ok && b31 && b31.category === 'rent' && !('category_source' in b31), b31);
  global.__db = db;

  console.log('\nWX: ' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (e) { console.log('  ✗ FAIL: crashed ' + (e && e.stack)); process.exit(1); });
