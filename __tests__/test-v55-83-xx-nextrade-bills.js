// v55.83-XX — NEXTRADE BILLS (Max, 23 Nov 2026: "Nextrade bills need to be grouped by each type like the other ktc bills / no need to
// validate these bills / will be available for only Nextrade payments wires / also will be able to use available balance for nextrade that
// we enter in the beginning and can use for any wires going forward or payment until all done. we can use actual ktc transfers or use the
// existing nextrade balance.")
// A "Nextrade bill" = a vendor_bills row with an ACTIVE company_bill_links row for NEXTRADE_BOOKS, looked up on the server only.
// Part 1 runs the REAL pure helpers (wire-audit, wire-bill-tree, wire-fill, nextrade-bill-groups).
// Part 2 runs the REAL wire-packages + bills routes on an in-memory database (same harness as the RJ / US tests): the whole NextTrade
//   wire (open_bills → save_draft → check → two signatures → sent → attached = bill PAID) with an UNVALIDATED Nextrade bill, an ordinary
//   unvalidated bill still refused, a failed link lookup = not exempt, a removed link voids the signatures, the paid-via lock, record_payment
//   / pay_bills_from_bank refused, RTM / vendor wires refuse a Nextrade bill.
// Part 3 runs the REAL party-funds route (fake permissions, in-memory database): the NextTrade starting balance pays a Nextrade bill;
//   RTM's starting balance / transfer never does (fails closed on a lookup error).
// Part 4 are source checks of the screen wiring (they do not prove behaviour in a browser).
// The database's own guards (real Postgres 16) are in test-v55-83-xx-nextrade-bills-sql.mjs.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }

var WA = require(path.join(root, 'src/lib/wire-audit.js'));
var WT = require(path.join(root, 'src/lib/wire-bill-tree.js'));
var WF = require(path.join(root, 'src/lib/wire-fill.js'));
var NG = require(path.join(root, 'src/lib/nextrade-bill-groups.js'));
var NL = require(path.join(root, 'src/lib/nextrade-bill-links-server.js'));

console.log('XX — Nextrade bills: grouped, no validation step, NextTrade only, Pay from a transfer or the starting balance');
console.log(' Part 1 — the pure helpers');
(function () {
  var nb = { id: 'n1', vendor_name: 'ACME POWER', bill_number: 'NXT-1', total_amount: 500, record_status: 'active', paid_via: 'NextTrade Industries', validation_status: 'pending', bill_date: '2026-10-01', nextrade_bill: true };
  var plain = Object.assign({}, nb, { nextrade_bill: undefined });
  var ord = { id: 'o1', vendor_name: 'Port Fees', bill_number: 'P-1', total_amount: 200, record_status: 'active', paid_via: 'NextTrade Industries', validation_status: 'pending', bill_date: '2026-10-02' };
  var NTP = { id: 'pk1', payee_kind: 'affiliate', payee_name: 'NextTrade Industries', fee_amount: 0 };
  var RTMP = { id: 'pk2', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 0 };
  function lines(b) { return [{ line_id: 'l1', bill_id: b.id, amount: 100, bill: b, other_payments: [] }]; }
  function codes(r) { return r.checks.map(function (c) { return c.level + ':' + c.code; }); }
  var a1 = WA.auditPackage({ pkg: NTP, lines: lines(nb) });
  check('1: NextTrade wire + unvalidated Nextrade bill → no BILL_NOT_VALIDATED, an info line "Nextrade bill - no validation needed", the check passes', codes(a1).indexOf('block:BILL_NOT_VALIDATED') < 0 && codes(a1).indexOf('info:NEXTRADE_BILL') >= 0 && a1.pass === true && /Nextrade bill - no validation needed/.test(JSON.stringify(a1.checks)), codes(a1));
  var a2 = WA.auditPackage({ pkg: NTP, lines: lines(plain) });
  check('2: the same bill WITHOUT the server mark (lookup failed / no link) → BILL_NOT_VALIDATED blocks (fail closed)', codes(a2).indexOf('block:BILL_NOT_VALIDATED') >= 0 && a2.pass === false, codes(a2));
  var a3 = WA.auditPackage({ pkg: NTP, lines: lines(ord) });
  check('3: an ordinary unvalidated bill on a NextTrade wire still blocks', codes(a3).indexOf('block:BILL_NOT_VALIDATED') >= 0 && a3.pass === false, codes(a3));
  var a4 = WA.auditPackage({ pkg: RTMP, lines: lines(Object.assign({}, nb, { paid_via: 'RTM Capital', validation_status: 'validated' })) });
  check('4: a Nextrade bill on an RTM wire blocks (NEXTRADE_BILL_ONLY), even validated; never overridable', codes(a4).indexOf('block:NEXTRADE_BILL_ONLY') >= 0 && !WA.OVERRIDABLE.NEXTRADE_BILL_ONLY && !!WA.NOT_OVERRIDABLE_WHY.NEXTRADE_BILL_ONLY, codes(a4));
  var a5 = WA.auditPackage({ pkg: RTMP, lines: lines(Object.assign({}, ord, { paid_via: 'RTM Capital', validation_status: 'validated' })), nextradeCheckFailed: true });
  var a6 = WA.auditPackage({ pkg: NTP, lines: lines(Object.assign({}, ord, { validation_status: 'validated' })), nextradeCheckFailed: true });
  check('5: lookup failed → an RTM wire blocks until it works (NEXTRADE_CHECK_FAILED); a NextTrade wire of validated bills is not blocked by it', codes(a5).indexOf('block:NEXTRADE_CHECK_FAILED') >= 0 && codes(a6).indexOf('block:NEXTRADE_CHECK_FAILED') < 0 && a6.pass === true, [codes(a5), codes(a6)]);
  var f1 = WA.packageFingerprint(NTP, lines(nb)); var f2 = WA.packageFingerprint(NTP, lines(plain));
  check('6: fingerprint — the Nextrade mark signs as |COMPANY-BILL, so losing the link changes what was signed', f1 !== f2, [f1, f2]);
  var v1 = Object.assign({}, nb, { validation_status: 'validated' }); var v2 = Object.assign({}, v1, { nextrade_bill: undefined });
  check('7: fingerprint of a VALIDATED bill is unchanged by the mark (wires signed before XX stay signed)', WA.packageFingerprint(NTP, lines(v1)) === WA.packageFingerprint(NTP, lines(v2)));
  check('8: on an RTM wire the mark never changes the fingerprint', WA.packageFingerprint(RTMP, lines(nb)) === WA.packageFingerprint(RTMP, lines(plain)));
  // the token, by hand (same hash as wireFingerprint)
  var s = WA.wireFingerprint({ id: 'x', amount: 1 }, lines(nb), { validation: true, companyBills: true }); var s2 = WA.wireFingerprint({ id: 'x', amount: 1 }, lines(nb), { validation: true });
  check('9: the token is only used for a wire to NextTrade (companyBills); otherwise |NOT-VALIDATED as before', s !== s2 && s2 === WA.wireFingerprint({ id: 'x', amount: 1 }, lines(plain), { validation: true }));
  // the screen helpers
  check('10: canTick — a Nextrade bill the server offered can be ticked; an ordinary unvalidated one cannot; a validated one can', WT.canTick(nb, {}) === true && WT.canTick(ord, {}) === false && WT.canTick(v2, {}) === true);
  var tg = WT.tickGroup({}, [Object.assign({}, nb, { open: 500 }), Object.assign({}, ord, { open: 200 })], true);
  check('11: tickGroup ticks the Nextrade bill (for what is owed) and skips the unvalidated ordinary bill', tg.n1 === '500' && tg.o1 === undefined, tg);
  var fv = WF.fillVendors([Object.assign({}, nb, { open: 500 }), Object.assign({}, ord, { open: 200 })]);
  var ff = WF.fillToAmount([Object.assign({}, nb, { open: 500 }), Object.assign({}, ord, { open: 200 })], 300, {});
  check('12: build-a-wire-for-an-amount uses Nextrade bills like validated ones, never the unvalidated ordinary bill', fv.length === 1 && fv[0].vendor === 'ACME POWER' && ff.ok && ff.picks.n1 === '300.00' && !ff.picks.o1, [fv, ff]);
  var pp1 = WT.presetPick({}, [Object.assign({}, nb, { open: 450 })], 'n1'); var pp2 = WT.presetPick({}, [Object.assign({}, ord, { open: 200 })], 'o1'); var pp3 = WT.presetPick({}, [], 'zz');
  check('13: presetPick (Pay ▸ → New wire) ticks that one bill for what is still owed; an untickable or missing bill is NOT ticked and says why', pp1.ticked && pp1.picks.n1 === '450' && !pp2.ticked && !pp2.picks.o1 && /validat/.test(pp2.why) && !pp3.ticked && /not in the list/.test(pp3.why), [pp1, pp2, pp3]);
  // grouping
  var rows = [
    { link: { id: 'L1', status: 'active' }, bill: { id: 'B1', category: 'utilities', total_amount: 100, record_status: 'active' }, paid: 0 },
    { link: { id: 'L2', status: 'active' }, bill: { id: 'B2', category: 'utilities', total_amount: 250.10, record_status: 'active' }, paid: 50.05 },
    { link: { id: 'L3', status: 'active' }, bill: { id: 'B3', category: 'rent', total_amount: 900, record_status: 'active' }, paid: 900 },
    { link: { id: 'L4', status: 'active' }, bill: { id: 'B4', category: 'warehouse_salaries', total_amount: null, record_status: 'active', payroll_restricted: true }, paid: null, state: 'owed', payroll_restricted: true },
    { link: { id: 'L5', status: 'active' }, bill: { id: 'B5', category: 'warehouse_salaries', total_amount: 400, record_status: 'active' }, paid: 0 },
    { link: { id: 'L6', status: 'voided' }, bill: { id: 'B6', category: 'utilities', total_amount: 999, record_status: 'active' }, paid: 0 },
    { link: { id: 'L7', status: 'active' }, bill: { id: 'B7', category: null, total_amount: 70, record_status: 'active' }, paid: 0 }];
  var G = NG.groupNextradeBills(rows, { utilities: 'Utilities', rent: 'Rent', warehouse_salaries: 'Warehouse salaries' });
  var gu = G.filter(function (g) { return g.key === 'utilities'; })[0]; var gp = G.filter(function (g) { return g.key === 'warehouse_salaries'; })[0]; var gr = G.filter(function (g) { return g.key === 'rent'; })[0];
  check('14: groups by KTC category with the Bills screen labels, A → Z, no category last', G.map(function (g) { return g.label; }).join('|') === 'Rent|Utilities|Warehouse salaries|' + NG.NO_CATEGORY_LABEL, G.map(function (g) { return g.label; }));
  check('15: each group: count and still owed in cents (a voided link counts as listed, never as owed)', gu.count === 3 && gu.owed_count === 2 && gu.owed_cents === 30005 && gr.count === 1 && gr.owed_count === 0 && gr.owed_cents === 0, [gu, gr]);
  check('16: a payroll bill shown without its amount is NOT in its group total (counted as hidden), the visible one is', gp.count === 2 && gp.owed_cents === 40000 && gp.hidden === 1 && gp.owed_count === 2, gp);
  check('17: unknown category key falls back to the key in words', NG.groupNextradeBills([{ link: { id: 'x', status: 'active' }, bill: { category: 'office_supplies', total_amount: 1, record_status: 'active' }, paid: 0 }], {})[0].label === 'office supplies');
  // starting balance helpers
  var sbs = [{ id: 's3', as_of: '2026-05-31', left: 0 }, { id: 's2', as_of: '2026-05-15', left: 120 }, { id: 's1', as_of: '2026-05-15', left: 50 }, { id: 's4', as_of: '2026-04-30', left: 0.004 }];
  check('18: the OLDEST starting balance that still has money left (as-of, then id; a fraction of a cent is nothing left)', NG.oldestStartingBalance(sbs).id === 's1' && NG.oldestStartingBalance([{ id: 'a', left: 0 }]) === null);
  var funds = { can_starting_balance: true, starting_balances_installed: true, parties: [{ party: 'RTM Capital', starting_balances: [{ id: 'r1', as_of: '2026-01-01', left: 999 }] }, { party: 'NextTrade Industries', starting_balances: sbs }] };
  var pk = NG.startingBalanceToPay(funds, 'NextTrade Industries');
  check('19: startingBalanceToPay picks NextTrade’s oldest balance with money, never RTM’s', pk.ok && pk.sb.id === 's1' && pk.party.party === 'NextTrade Industries', pk);
  var none = NG.startingBalanceToPay({ can_starting_balance: true, starting_balances_installed: true, parties: [{ party: 'NextTrade Industries', starting_balances: [{ id: 'z', as_of: '2026-05-01', left: 0 }] }] });
  var staff = NG.startingBalanceToPay(Object.assign({}, funds, { can_starting_balance: false }));
  var noSql = NG.startingBalanceToPay(Object.assign({}, funds, { starting_balances_installed: false }));
  check('20: no balance with money left → said plainly and points to a KTC transfer; staff and a missing XO step are refused in words', !none.ok && /no NextTrade starting balance with money left/.test(none.why) && /KTC transfer to NextTrade/.test(none.why) && !staff.ok && /super admin/.test(staff.why) && !noSql.ok && /XO/.test(noSql.why), [none, staff, noSql]);
  check('21: the amount ticked on the starting-balance form = what is owed, never more than is left', NG.openingPickAmount({ open: 500 }, 120) === '120.00' && NG.openingPickAmount({ open: 80.5 }, 120) === '80.50' && NG.openingPickAmount({ open: 0 }, 120) === null);
  check('22: only the super admin can select a starting balance or NextTrade-managed sales', NG.nextradePayChoices(false).map(function (c) { return c.key; }).join() === 'transfer' && NG.nextradePayChoices(true).map(function (c) { return c.key; }).join() === 'transfer,managed_sales,opening');
  var managed = { id: 'sales-1', as_of: '2026-06-30', left: 250, source: 'managed_sales' };
  var mix = { ...funds, parties: funds.parties.map(function (party) { return party.party === 'NextTrade Industries'
    ? { ...party, starting_balances: [...party.starting_balances, managed] } : party; }) };
  check('managed sales is an independent payment source and can only select NextTrade sales balances',
    NG.startingBalanceToPay(mix, 'NextTrade Industries', 'managed_sales').sb === managed &&
    NG.startingBalanceToPay(mix, 'NextTrade Industries', 'opening').sb.id === 's1');
})();

// ── Part 2: the real wire + bills routes ──
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var NT = 'NextTrade Industries', RTM = 'RTM Capital';
var NT1 = 'b1000000-0000-4000-8000-000000000001', NT2 = 'b1000000-0000-4000-8000-000000000002', NT3 = 'b1000000-0000-4000-8000-000000000003';
var NT4 = 'b1000000-0000-4000-8000-000000000004', ORD = 'b1000000-0000-4000-8000-000000000005', RV = 'b1000000-0000-4000-8000-000000000006';
var LINE_OUT = 'c1000000-0000-4000-8000-000000000001', WIRE_LINE = 'c1000000-0000-4000-8000-000000000002', PAY_LINE = 'c1000000-0000-4000-8000-000000000003';
function vb(id, vendor, num, total, via, vs, extra) { return Object.assign({ id: id, wave_business_id: US, vendor_name: vendor, bill_number: num, total_amount: total, record_status: 'active', paid_via: via, validation_status: vs, bill_date: '2026-10-01', due_date: '2026-10-31', category: 'utilities', currency: 'USD' }, extra || {}); }
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }],
  module_permissions: [].concat(
    ['accounting.clickbooks.access', 'accounting.view', 'wires.prepare', 'wires.signoff', 'wires.send', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [
    vb(NT1, 'ACME POWER', 'NXT-20261001-AAAA', 500, NT, 'pending'),
    vb(NT2, 'CITY WATER', 'NXT-20261002-BBBB', 300, NT, null, { bill_date: '2026-10-02' }),
    vb(NT3, 'OLD GAS CO', 'NXT-20261003-CCCC', 90, NT, 'pending', { bill_date: '2026-10-03' }),           // its link was voided → an ordinary bill again
    vb(NT4, 'RENT LLC', 'R-77', 1200, null, 'validated', { bill_date: '2026-10-04', category: 'rent', shipment_direction: 'inbound', other_reference: 'LEASE-1' }), // attached, no paid-via yet
    vb(ORD, 'Port Fees', 'P-1', 200, NT, 'pending', { bill_date: '2026-10-05' }),                          // ordinary, not validated
    vb(RV, 'Dray Co', 'D-1', 400, null, 'validated', { bill_date: '2026-10-06', release_number: '1002-7', shipment_direction: 'outbound' })],
  company_bill_links: [
    { id: 'k1', company_id: 'NEXTRADE_BOOKS', bill_id: NT1, source_bank_transaction_id: 'nx1', mode: 'created', status: 'active' },
    { id: 'k2', company_id: 'NEXTRADE_BOOKS', bill_id: NT2, source_bank_transaction_id: 'nx2', mode: 'created', status: 'active' },
    { id: 'k3', company_id: 'NEXTRADE_BOOKS', bill_id: NT3, source_bank_transaction_id: 'nx3', mode: 'created', status: 'voided' },
    { id: 'k4', company_id: 'NEXTRADE_BOOKS', bill_id: NT4, source_bank_transaction_id: 'nx4', mode: 'attached', status: 'active' },
    { id: 'k5', company_id: 'RTM_BOOKS', bill_id: ORD, source_bank_transaction_id: 'rx1', mode: 'created', status: 'active' }], // another company's link never counts
  vendor_bill_payments: [], vendor_bill_events: [], wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], hub_audit_log: [],
  paid_through_parties: [{ name: RTM, kind: 'service_provider' }, { name: NT, kind: 'affiliate' }],
  bank_transactions: [
    { id: LINE_OUT, wave_business_id: US, account_id: 'A1', date: '2026-11-10', posted_date: '2026-11-10', amount_abs: 1000, direction: 'out', pending: false, name: 'ACH ACME POWER', merchant_name: null, third_party_payer: null, transfer_group_id: null, iso_currency: 'USD' },
    { id: WIRE_LINE, wave_business_id: US, account_id: 'A1', date: '2026-11-12', posted_date: '2026-11-12', amount_abs: 500, direction: 'out', pending: false, name: 'WIRE TO NEXTTRADE INDUSTRIES', merchant_name: null, third_party_payer: null, transfer_group_id: null, iso_currency: 'USD', review_status: 'needs_review' }],
  plaid_accounts: [{ plaid_account_id: 'A1', wave_business_id: US, is_private: false }],
});
db.hooks = { wire_package_lines: { update: function (row, p) { var pk = db.t.wire_packages.filter(function (x) { return x.id === row.package_id; })[0]; if (pk && pk.status !== 'draft' && (p.amount !== undefined || p.bill_id !== undefined)) { return 'WIRE_PACKAGE_LOCKED'; } } } };
db.rpcs = { hub_payment_guards_installed: function () { return true; } };
// a failed read of the links table, on demand
db.failLinks = false;
db.from = function (name) {
  if (name === 'company_bill_links' && db.failLinks) {
    var fq = { then: function (res, rej) { return Promise.resolve({ data: null, error: { message: 'connection reset by peer' } }).then(res, rej); } };
    ['select', 'eq', 'neq', 'in', 'is', 'gte', 'lte', 'order', 'limit', 'range', 'maybeSingle', 'single', 'not', 'or'].forEach(function (k) { fq[k] = function () { return fq; }; });
    return fq;
  }
  return MemDB.prototype.from.call(db, name);
};
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var permsMode = { fake: false, superAdmin: false, perms: {} };
var realPerms = require(path.join(root, 'src/lib/server-permissions.js'));
var permPath = require.resolve(path.join(root, 'src/lib/server-permissions.js'));
require.cache[permPath] = { id: permPath, filename: permPath, loaded: true, exports: {
  assertPermission: function (dbx, uid, perm, req) { if (!permsMode.fake) { return realPerms.assertPermission(dbx, uid, perm, req); } return Promise.resolve(permsMode.superAdmin || permsMode.perms[perm] ? { ok: true, ctx: { isSuperAdmin: permsMode.superAdmin } } : { ok: false, status: 403, ctx: { isSuperAdmin: false } }); },
  loadUserPermissions: function () { if (!permsMode.fake) { return realPerms.loadUserPermissions.apply(null, arguments); } return Promise.resolve({ isSuperAdmin: permsMode.superAdmin, mp: permsMode.perms }); },
  userHasPermission: function () { if (!permsMode.fake) { return realPerms.userHasPermission.apply(null, arguments); } var ctx = arguments[0]; var perm = arguments[1]; return !!(ctx && ctx.mp && ctx.mp[perm]); },
} };
Object.keys(realPerms).forEach(function (k) { if (!require.cache[permPath].exports[k]) { require.cache[permPath].exports[k] = realPerms[k]; } });
var origResolve = Module._resolveFilename;
Module._resolveFilename = function (req) {
  if (req === '@supabase/supabase-js') { return mockPath; }
  if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); }
  return origResolve.apply(this, arguments);
};
global.__db = db;
var route = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var funds = require(path.join(root, 'src/app/api/accounting/party-funds/route.js'));
async function callRaw(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }
async function call(r, user, body) {
  if (body && body.action === 'signoff' && r === route) { var gq = await callRaw(r, user, { action: 'get', id: body.id }); if (gq && gq.ok) { for (var qi = 0; qi < gq.lines.length; qi++) { await callRaw(r, user, { action: 'review_bill', id: body.id, bill_id: gq.lines[qi].bill_id }); } } }
  return callRaw(r, user, body);
}
function ids(list) { return (list || []).map(function (b) { return b.id; }).sort(); }
function codesOf(g) { return ((g.checks && g.checks.checks) || []).map(function (c) { return c.level + ':' + c.code; }); }
function payRows(billId) { return db.t.vendor_bill_payments.filter(function (p) { return p.bill_id === billId && p.voided !== true; }); }

(async function () {
  console.log(' Part 2 — the real Wires + Bills routes (in-memory database)');
  var helper = await NL.nextradeBillIds(db, [NT1, NT2, NT3, NT4, ORD, RV]);
  check('23: the server lookup = ACTIVE NextTrade links only (a voided link and another company’s link do not count)', helper.ok && Object.keys(helper.ids).sort().join() === [NT1, NT2, NT4].sort().join(), helper);
  db.failLinks = true; var hf = await NL.nextradeBillIds(db, [NT1]); db.failLinks = false;
  var hm = await NL.nextradeBillIds({ from: function () { var q = { then: function (res) { return Promise.resolve({ data: null, error: { message: 'relation "public.company_bill_links" does not exist' } }).then(res); } }; ['select', 'eq', 'in'].forEach(function (k) { q[k] = function () { return q; }; }); return q; } }, [NT1]);
  check('24: a failed read = { ok: false } (callers fail closed); the table not installed yet = no Nextrade bills', hf.ok === false && !hf.ids[NT1] && hm.ok === true && hm.missing === true && !hm.ids[NT1], [hf, hm]);

  // open_bills on a NextTrade wire
  var ob = await call(route, 'u1', { action: 'open_bills', payee_kind: 'affiliate', payee_name: NT });
  var obNT1 = (ob.bills || []).filter(function (b) { return b.id === NT1; })[0];
  check('25: open_bills (NextTrade): the unvalidated Nextrade bills are offered, marked nextrade_bill; validated bills too', ob.ok && ids(ob.bills).join() === [NT1, NT2, NT4, RV].sort().join() && obNT1 && obNT1.nextrade_bill === true, [ids(ob.bills), ob.not_validated && ids(ob.not_validated)]);
  check('26: … the ordinary unvalidated bill and the bill whose link was voided wait for validation as before', ids(ob.not_validated).join() === [NT3, ORD].sort().join() && !(ob.not_validated || []).some(function (b) { return b.nextrade_bill; }), ids(ob.not_validated));
  check('27: … and the screen helper can tick the offered Nextrade bill', WT.canTick(obNT1, {}) === true && WT.canTick((ob.not_validated || [])[0], {}) === false);
  db.failLinks = true; var obF = await call(route, 'u1', { action: 'open_bills', payee_kind: 'affiliate', payee_name: NT }); db.failLinks = false;
  check('28: lookup failed → no bill is exempt: the Nextrade bills wait for validation, and the screen is told why', obF.ok && ids(obF.bills).join() === [NT4, RV].sort().join() && ids(obF.not_validated).indexOf(NT1) >= 0 && /Could not check which bills are Nextrade bills/.test(obF.nextrade_check_error || ''), obF);
  var obR = await call(route, 'u1', { action: 'open_bills', payee_kind: 'service_provider', payee_name: RTM });
  var obV = await call(route, 'u1', { action: 'open_bills', payee_kind: 'vendor', payee_name: '' });
  check('29: RTM and vendor wires never offer a Nextrade bill (not even the attached one with no paid-via)', obR.ok && ids(obR.bills).indexOf(NT4) < 0 && ids(obR.bills).indexOf(RV) >= 0 && obV.ok && ids(obV.bills).indexOf(NT4) < 0 && ids(obV.bills).indexOf(RV) >= 0, [ids(obR.bills), ids(obV.bills)]);

  // save_draft
  var sOrd = await call(route, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: NT, lines: [{ bill_id: ORD, amount: 200 }] });
  var sOld = await call(route, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: NT, lines: [{ bill_id: NT3, amount: 90 }] });
  check('30: save_draft — an ordinary unvalidated bill is still refused ("not validated yet"); so is a bill whose link was voided', !sOrd.ok && /is not validated yet/.test(sOrd.error) && !sOld.ok && /is not validated yet/.test(sOld.error) && db.t.wire_packages.length === 0, [sOrd, sOld]);
  db.failLinks = true; var sFail = await call(route, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: NT, lines: [{ bill_id: NT1, amount: 500 }] }); db.failLinks = false;
  check('31: lookup failed → the unvalidated Nextrade bill is refused like any unvalidated bill (fail closed), and says the check failed', !sFail.ok && /is not validated yet/.test(sFail.error) && /Could not check whether it is a Nextrade bill/.test(sFail.error) && db.t.wire_packages.length === 0, sFail);
  var sRtm = await call(route, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: RTM, lines: [{ bill_id: NT4, amount: 1200 }] });
  var sVen = await call(route, 'u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: '', lines: [{ bill_id: NT4, amount: 1200 }] });
  db.failLinks = true; var sRtmF = await call(route, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: RTM, lines: [{ bill_id: RV, amount: 400 }] }); db.failLinks = false;
  check('32: a Nextrade bill on an RTM or vendor wire is refused (paid only through NextTrade); a failed lookup refuses an RTM wire too', !sRtm.ok && sRtm._status === 409 && /Nextrade bill/.test(sRtm.error) && !sVen.ok && /Nextrade bill/.test(sVen.error) && !sRtmF.ok && sRtmF._status === 503 && db.t.wire_packages.length === 0, [sRtm, sVen, sRtmF]);
  var pw = await call(route, 'u1', { action: 'record_past_wire', payee_kind: 'vendor', sent_date: '2026-10-20', reason: 'old wire before the Hub had wires', lines: [{ bill_id: NT4, amount: 1200 }] });
  check('33: a past wire straight to a vendor cannot carry a Nextrade bill either (super admin only path refuses earlier for staff)', !pw.ok, pw);

  var sv = await call(route, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: NT, lines: [{ bill_id: NT1, amount: 500 }] });
  check('34: save_draft — the UNVALIDATED Nextrade bill goes on a NextTrade wire, and the automatic check passes', sv.ok && !!sv.id && sv.audit && sv.audit.pass === true, sv);
  var g1 = await call(route, 'u1', { action: 'get', id: sv.id });
  check('35: the wire: no "not validated" block, an info line "Nextrade bill - no validation needed", status awaiting the 1st signature', g1.ok && codesOf(g1).indexOf('block:BILL_NOT_VALIDATED') < 0 && codesOf(g1).indexOf('info:NEXTRADE_BILL') >= 0 && g1.package.status === 'awaiting_1st' && g1.lines[0].bill.nextrade_bill === true, [codesOf(g1), g1.package && g1.package.status]);
  // the exemption is ONLY the validation gate: overpaying, a second wire for more than is left, duplicates still block
  var over = await call(route, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: NT, lines: [{ bill_id: NT2, amount: 300.01 }] });
  var again = await call(route, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: NT, lines: [{ bill_id: NT1, amount: 1 }] });
  check('36: the exemption is only the validation step — paying more than is owed, or the same bill on a second wire, is still refused', !over.ok && /more than what is still owed/.test(over.error) && !again.ok, [over, again]);
  var s1 = await call(route, 'u2', { action: 'signoff', id: sv.id, note: 'checked the Nextrade statement line' });
  var s2 = await call(route, 'u1', { action: 'signoff', id: sv.id, note: 'amount matches the ACME bill' });
  check('37: two different people sign it (the two signatures are NOT skipped)', s1.ok && s1.slot === 1 && s2.ok && s2.approved === true, [s1, s2]);
  var lst = await call(route, 'u1', { action: 'list' }); var mine = (lst.packages || []).filter(function (p) { return p.id === sv.id; })[0];
  check('38: the Wires list shows it READY to send (the list’s fingerprint carries the same Nextrade mark as the signed one)', mine && mine.status === 'ready_to_send', mine);
  var bl = await call(bills, 'u1', { action: 'list' }); var bRow = (bl.bills || []).filter(function (b) { return b.id === NT1; })[0] || {};
  check('39: the Bills list says READY for that bill too (same fingerprint)', bRow.wire_state && bRow.wire_state.state === 'ready', bRow.wire_state || bl.error);
  check('40: opening / preparing a wire never pays anything by itself', payRows(NT1).length === 0);
  var sent = await call(route, 'u1', { action: 'mark_sent', id: sv.id, sent_date: '2026-11-11', bank_reference: 'FED-NT-1', proof_path: 'pv/wire-nt-1-conf.pdf', proof_name: 'conf.pdf' });
  check('41: marked SENT with the bank confirmation', sent.ok, sent);
  var at = await call(route, 'u1', { action: 'attach', id: sv.id, bank_transaction_id: WIRE_LINE });
  check('42: attached to its bank line → the unvalidated Nextrade bill is PAID by the NextTrade wire (complete path)', at.ok && payRows(NT1).length === 1 && Number(payRows(NT1)[0].amount) === 500, [at, payRows(NT1)]);

  // a removed link voids the signatures
  var sv2 = await call(route, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: NT, lines: [{ bill_id: NT2, amount: 300 }] });
  var sg1 = await call(route, 'u2', { action: 'signoff', id: sv2.id, note: 'checked the CITY WATER statement line' }); var sg2 = await call(route, 'u1', { action: 'signoff', id: sv2.id, note: 'amount matches the water bill' });
  var before = await call(route, 'u1', { action: 'get', id: sv2.id });
  db.t.company_bill_links.filter(function (l) { return l.id === 'k2'; })[0].status = 'voided'; // the Nextrade line was re-categorized: no longer a Nextrade bill
  var after = await call(route, 'u1', { action: 'get', id: sv2.id });
  var lst2 = await call(route, 'u1', { action: 'list' }); var mine2 = (lst2.packages || []).filter(function (p) { return p.id === sv2.id; })[0];
  var send2 = await call(route, 'u1', { action: 'mark_sent', id: sv2.id, sent_date: '2026-11-11', bank_reference: 'FED-NT-2', proof_path: 'pv/wire-nt-2-conf.pdf', proof_name: 'conf.pdf' });
  check('43: a removed Nextrade link changes what was signed: READY → the signatures no longer count, the check blocks "not validated", it cannot be sent', sg1.ok && sg2.ok && sg2.approved === true && before.package.status === 'ready_to_send' && after.package.status !== 'ready_to_send' && codesOf(after).indexOf('block:BILL_NOT_VALIDATED') >= 0 && mine2 && mine2.status !== 'ready_to_send' && !send2.ok && payRows(NT2).length === 0, [before.package.status, after.package.status, mine2 && mine2.status, send2]);
  db.t.company_bill_links.filter(function (l) { return l.id === 'k2'; })[0].status = 'active';
  db.failLinks = true; var gFail = await call(route, 'u1', { action: 'get', id: sv2.id }); db.failLinks = false;
  check('44: the lookup failing while the wire is open → not exempt (blocks), and the wire says the check failed', codesOf(gFail).indexOf('block:BILL_NOT_VALIDATED') >= 0 && gFail.package.status !== 'ready_to_send' && /connection reset/.test(gFail.package.nextrade_check_error || ''), [codesOf(gFail), gFail.package && gFail.package.nextrade_check_error]);
  var back = await call(route, 'u1', { action: 'get', id: sv2.id });
  check('45: the link back → the same fingerprint as signed: ready to send again (nothing was lost)', back.package.status === 'ready_to_send', back.package.status);

  // ── bills route: paid-via lock + refusals ──
  function edit(id, via) { var b = db.t.vendor_bills.filter(function (x) { return x.id === id; })[0]; return { action: 'save_bill', bill: { id: id, vendor_name: b.vendor_name, bill_number: b.bill_number, bill_date: b.bill_date, total_amount: b.total_amount, category: b.category, paid_via: via } }; }
  await call(route, 'u1', { action: 'cancel', id: sv2.id, note: 'test: free NT2 again' });
  var e1 = await call(bills, 'u1', edit(NT2, RTM)); var e2 = await call(bills, 'u1', edit(NT2, ''));
  check('46: save_bill refuses changing a Nextrade bill’s paid-via to RTM, and refuses clearing it (409, nothing saved)', e1._status === 409 && /Nextrade bill/.test(e1.error) && e2._status === 409 && /cannot be cleared/.test(e2.error) && db.t.vendor_bills.filter(function (x) { return x.id === NT2; })[0].paid_via === NT, [e1, e2]);
  var e3 = await call(bills, 'u1', edit(NT2, NT)); var e4 = await call(bills, 'u1', edit(NT4, NT)); var e4b = await call(bills, 'u1', edit(NT4, null));
  check('47: saving with the same paid-via is not blocked; a Nextrade bill with none yet may be set to NextTrade (only)', !e3.error && e3.ok && !e4.error && db.t.vendor_bills.filter(function (x) { return x.id === NT4; })[0].paid_via === NT && e4b._status === 409, [e3, e4, e4b]);
  var e5 = await call(bills, 'u1', edit(ORD, RTM));
  check('48: an ordinary bill’s paid-via still changes freely', e5.ok && db.t.vendor_bills.filter(function (x) { return x.id === ORD; })[0].paid_via === RTM, e5);
  db.failLinks = true; var e6 = await call(bills, 'u1', edit(ORD, NT)); db.failLinks = false;
  check('49: lookup failed → a paid-via change is refused (503, fails closed), nothing saved', e6._status === 503 && db.t.vendor_bills.filter(function (x) { return x.id === ORD; })[0].paid_via === RTM, e6);
  var rp = await call(bills, 'u1', { action: 'record_payment', bill_id: NT2, amount: 100, paid_date: '2026-11-10', bank_transaction_id: LINE_OUT, method: 'bank' });
  check('50: record_payment refuses a Nextrade bill and points to the NextTrade wire / starting balance; nothing recorded', rp._status === 409 && /Nextrade bill/.test(rp.error) && /wire to NextTrade Industries/.test(rp.error) && /starting balance/.test(rp.error) && payRows(NT2).length === 0, rp);
  var rpO = await call(bills, 'u1', { action: 'record_payment', bill_id: RV, amount: 100, paid_date: '2026-11-10', bank_transaction_id: LINE_OUT, method: 'bank' });
  check('51: record_payment of an ordinary bill from a bank line still works', rpO.ok === true && payRows(RV).length === 1, rpO);
  db.failLinks = true; var rpF = await call(bills, 'u1', { action: 'record_payment', bill_id: RV, amount: 50, paid_date: '2026-11-10', bank_transaction_id: LINE_OUT, method: 'bank' }); db.failLinks = false;
  check('52: lookup failed → record_payment refuses (503), nothing recorded', rpF._status === 503 && payRows(RV).length === 1, rpF);
  var pb = await call(bills, 'u1', { action: 'pay_bills_from_bank', bank_transaction_id: LINE_OUT, bills: [{ bill_id: RV, amount: 100 }, { bill_id: NT2, amount: 300 }], request_id: 'click-xx-pb-1' });
  check('53: pay_bills_from_bank refuses when any ticked bill is a Nextrade bill (names it, nothing recorded at all)', pb._status === 409 && /CITY WATER/.test(pb.error) && /Nextrade bill/.test(pb.error) && payRows(RV).length === 1 && payRows(NT2).length === 0, pb);
  var pbO = await call(bills, 'u1', { action: 'pay_bills_from_bank', bank_transaction_id: LINE_OUT, bills: [{ bill_id: RV, amount: 100 }], request_id: 'click-xx-pb-2' });
  check('54: pay_bills_from_bank of ordinary bills still works', pbO.ok === true && payRows(RV).length === 2, pbO);

  // ── Part 3: the party-funds route (starting balance / transfer of RTM never pays a Nextrade bill) ──
  console.log(' Part 3 — the real party-funds route (fake permissions)');
  permsMode.fake = true; permsMode.superAdmin = true;
  var fdb = new FakeDb({});
  fdb.t.paid_through_parties = [{ name: NT, kind: 'affiliate' }, { name: RTM, kind: 'service_provider' }];
  fdb.t.plaid_accounts = [{ plaid_account_id: 'A1', wave_business_id: US, is_private: false }];
  fdb.t.bank_transactions = [{ id: 'T9', wave_business_id: US, account_id: 'A1', direction: 'out', amount_abs: 5000, date: '2026-09-02', posted_date: '2026-09-02', pending: false, third_party_payer: RTM, name: 'WIRE RTM', merchant_name: null, transfer_group_id: null, iso_currency: 'USD' }];
  fdb.t.vendor_bills = [vb('F1', 'CITY WATER', 'NXT-1', 300, NT, null), vb('F2', 'RENT LLC', 'R-1', 900, null, 'validated'), vb('F3', 'Free Co', 'F-1', 100, null, 'validated')];
  fdb.t.company_bill_links = [{ id: 'q1', company_id: 'NEXTRADE_BOOKS', bill_id: 'F1', status: 'active' }, { id: 'q2', company_id: 'NEXTRADE_BOOKS', bill_id: 'F2', status: 'active' }];
  fdb.t.vendor_bill_payments = []; fdb.t.wire_package_lines = []; fdb.t.wire_packages = []; fdb.t.party_money_entries = []; fdb.t.party_opening_balances = [];
  fdb.calls = [];
  fdb.rpcs.hub_party_funds_installed = function () { return { data: true, error: null }; };
  fdb.rpcs.hub_party_opening_installed = function () { return { data: true, error: null }; };
  fdb.rpcs.hub_party_opening_pay = function (a, dbx) { dbx.calls.push(['opening_pay', a.p]); return { data: { ok: true, action: 'opening_pay', payments: ['np1'] }, error: null }; };
  fdb.rpcs.hub_party_record_paid = function (a, dbx) { dbx.calls.push(['record_paid', a.p]); return { data: { ok: true, action: 'record_paid', payments: ['np2'] }, error: null }; };
  global.__db = fdb;
  var payNT = { action: 'opening_pay', party: NT, opening_id: 'O1', bills: [{ bill_id: 'F1', amount: 300 }], paid_date: '2026-06-20', reference: 'NT list 3', reason: 'paid from the old balance', request_id: 'click-xx-op1' };
  var opNT = await callRaw(funds, 'u1', payNT);
  check('55: the NextTrade starting balance pays an unvalidated Nextrade bill (goes to the XO database step unchanged)', opNT.ok === true && fdb.calls.length === 1 && fdb.calls[0][0] === 'opening_pay' && fdb.calls[0][1].party === NT && fdb.calls[0][1].bills[0].bill_id === 'F1', [opNT, fdb.calls]);
  var opR = await callRaw(funds, 'u1', Object.assign({}, payNT, { party: RTM, bills: [{ bill_id: 'F2', amount: 900 }], request_id: 'click-xx-op2' }));
  check('56: RTM’s starting balance cannot pay a Nextrade bill (even one with no paid-via yet) — refused before the database, nothing called', opR._status === 409 && /Nextrade bill/.test(opR.error) && fdb.calls.length === 1, opR);
  var opR2 = await callRaw(funds, 'u1', Object.assign({}, payNT, { party: RTM, bills: [{ bill_id: 'F3', amount: 100 }], request_id: 'click-xx-op3' }));
  check('57: RTM’s starting balance still pays an ordinary bill', opR2.ok === true && fdb.calls.length === 2, opR2);
  fdb.fail.company_bill_links = { select: 'connection reset by peer' };
  var opRF = await callRaw(funds, 'u1', Object.assign({}, payNT, { party: RTM, bills: [{ bill_id: 'F3', amount: 100 }], request_id: 'click-xx-op4' }));
  var opNF = await callRaw(funds, 'u1', Object.assign({}, payNT, { request_id: 'click-xx-op5' }));
  delete fdb.fail.company_bill_links;
  check('58: lookup failed → RTM’s balance refuses (503, fails closed); NextTrade’s own balance is not blocked by it', opRF._status === 503 && opNF.ok === true && fdb.calls.length === 3, [opRF, opNF]);
  var rpR = await callRaw(funds, 'u1', { action: 'record_paid', party: RTM, bank_transaction_id: 'T9', bills: [{ bill_id: 'F2', amount: 900 }], paid_date: '2026-09-10', reference: 'RTM statement 4', already_paid: true, reason: 'reconciling', request_id: 'click-xx-rp1' });
  check('59: "bills RTM already paid out of a transfer" refuses a Nextrade bill, nothing called', rpR._status === 409 && /Nextrade bill/.test(rpR.error) && fdb.calls.length === 3, rpR);
  var cand = await callRaw(funds, 'u1', { action: 'opening_pay_candidates', party: RTM }); var candN = await callRaw(funds, 'u1', { action: 'opening_pay_candidates', party: NT });
  check('60: RTM’s pick list does not list the Nextrade bill with no paid-via; NextTrade’s does', cand.ok && (cand.bills || []).map(function (b) { return b.id; }).indexOf('F2') < 0 && (cand.bills || []).map(function (b) { return b.id; }).indexOf('F3') >= 0 && candN.ok && (candN.bills || []).map(function (b) { return b.id; }).indexOf('F2') >= 0, [cand.bills, candN.bills]);
  permsMode.fake = false; global.__db = db;

  // ── Part 4: the screen wiring (source checks) ──
  console.log(' Part 4 — the screen wiring (source checks, not a browser)');
  var NP = read('src/components/NextradeBillsPanel.jsx'); var AT = read('src/components/AccountingTab.jsx'); var WTX = read('src/components/WiresTab.jsx'); var WP = read('src/components/WirePackagesPanel.jsx');
  var FH = read('src/components/FundsHeldPanel.jsx'); var BT = read('src/components/BillsTab.jsx');
  check('61: the dead-end "hub-pay-party" Pay is gone; Pay ▸ opens the chooser built from nextradePayChoices (payroll rows still have no Pay)', NP.indexOf('hub-pay-party') < 0 && NP.indexOf('var choices = nextradePayChoices(isSuper);') > 0 && /!r\.payroll_restricted && <button/.test(NP) && /r\.payroll_restricted \?/.test(NP));
  check('62: "From a KTC transfer" fires hub-open-nextrade-wire with the bill; the starting balance fires hub-pay-nextrade-opening', NP.indexOf('new CustomEvent(NEXTRADE_OPEN_WIRE_EVENT, { detail: { payee: b.paid_via || \'NextTrade Industries\', bill_id: b.id, bill_number: b.bill_number } })') > 0 && NP.indexOf('new CustomEvent(NEXTRADE_PAY_OPENING_EVENT, { detail: { party:') > 0 && NG.NEXTRADE_OPEN_WIRE_EVENT === 'hub-open-nextrade-wire' && NG.NEXTRADE_PAY_OPENING_EVENT === 'hub-pay-nextrade-opening');
  check('63: the panel is grouped with the Bills screen’s category labels (BillsTab passes cats + the super-admin flag)', NP.indexOf('var groups = groupNextradeBills(list, catLabelOf);') > 0 && BT.indexOf('<NextradeBillsPanel userProfile={userProfile} isSuperAdmin={isSuperAdmin} cats={cats}') > 0 && NP.indexOf('canGroupTotals ? \'$\' + fmt(g.owed_cents / 100)') > 0);
  check('64: Accounting listens for hub-open-nextrade-wire, keeps a Back button (goFrom), and passes the preset to Wires; leaving Wires forgets it', AT.indexOf("window.addEventListener('hub-open-nextrade-wire', onOpenWire)") > 0 && AT.indexOf("goFrom('wires');") > 0 && AT.indexOf('<WiresTab {...props} wirePreset={wirePreset} openWire={!back && props.onReturn ? wireOpen : null} />') > 0 /* v55.83-AAA adds openWire */ && AT.indexOf("if (sub !== 'wires' && wirePreset) { setWirePreset(null); }") > 0);
  check('65: Wires opens the builder tab and hands the preset to the wire builder', WTX.indexOf("useEffect(function () { if (wirePreset) { setMode('prepared'); } }") > 0 && WTX.indexOf('perms={perms} preset={wirePreset} openWire={openWire} />') > 0 /* v55.83-AAA adds openWire */);
  check('66: the builder opens a NEW wire to NextTrade (the affiliate) with that bill, ticks it with presetPick once its bills arrive, and never picks the transfer', WP.indexOf("setEd({ id: null, kind: 'affiliate', payee: hit.name,") > 0 && WP.indexOf('fundId: null') > 0 && WP.indexOf('var pp = presetPick(nx.picks, nx.bills, e.presetBill);') > 0 && WP.indexOf('presetBill: pr.bill_id') > 0);
  check('67: the builder shows "Nextrade bill - no validation needed" instead of the validate box, on the list and on the wire', WP.split("NEXTRADE_BILL_NOTE").length >= 4 && WP.indexOf('var notValid = !wireReady(b);') > 0 && WP.indexOf("P.payee_kind === 'affiliate' && validationExempt(b) ?") > 0);
  check('68: Funds with RTM / NextTrade uses the selected source and ticks the bill', FH.indexOf('window.addEventListener(NEXTRADE_PAY_OPENING_EVENT, onPayOpening)') > 0 && FH.indexOf('startingBalanceToPay(j, base.party, d.source)') > 0 && FH.indexOf('openOpeningPay(pick.party, pick.sb, base.bill_id);') > 0 && FH.indexOf('openingPickAmount(hitB, sb.left)') > 0 && FH.indexOf('offerWire: true') > 0 && FH.indexOf('id="nt-funds-held"') > 0);
  check('69: opening the chooser / prefilling writes nothing (no api write in the preset paths)', (function () { var i = FH.indexOf('function onPayOpening(e)'); var j = FH.indexOf('function payFromTransferInstead'); var seg = FH.slice(i, j); return i > 0 && j > i && seg.indexOf("action: 'opening_pay'") < 0 && seg.indexOf("api({ action: 'funds' })") > 0; })());
  var XO = read('sql/v55-83-XO-starting-balance.sql');
  check('70: no SQL in this build: the XO money guards are untouched (paid-via, ≤ open incl. open wires, USD, ≥ 1 June)', /IF b\.via IS NOT NULL AND lower\(b\.via\) <> lower\(v_party\)/.test(XO) && XO.indexOf('v_left := round(coalesce(b.total_amount, 0), 2) - v_paid - v_wire;') > 0 && !fs.existsSync(path.join(root, 'sql/v55-83-XX-nextrade-bills.sql')));
  var WN = read('src/components/WhatsNewWidget.jsx'); var PG = read('src/app/page.jsx');
  check('71: What’s New has the XX entry (plain items + one super-admin technical item) and the badge names the newest entry', /version: 'v55\.83-XX'/.test(WN) && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(WN); return !!top && PG.indexOf('>' + top[1] + '</span>') > 0; })() && /version: 'v55\.83-XL'/.test(WN));

  console.log('\nXX Nextrade bills: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error('CRASH', e && e.stack); process.exit(1); });
