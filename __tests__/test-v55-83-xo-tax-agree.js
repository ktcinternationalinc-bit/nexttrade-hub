// ═══════════════════════════════════════════════════════════════════════════
// v55.83-XO — the TWO tax figures can never disagree (Max's (b): "NEW EXPENSE WHEN USED AFTER 6/1/2026").
//   party-funds  period.tax_professional_fees = transfers of the period + bills paid from a starting balance on / after 1 June 2026
//   bills route  spending.funds_sent_tax (and the Professional fees line the tax pack / accountant pack prints) = the SAME
// RUN: the REAL bills route (action period_stats) with an in-memory database, on the same rows: a transfer, a starting-balance
// use BEFORE 1 June and one AFTER. Also: the internal (real-cost) view takes the use back out of Professional fees and shows the
// bill in its own category; total money out does not move (no bank money moved). All amounts are illustrative fixtures.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1000))); }
console.log('XO — starting-balance uses: the bills-route tax line and party-funds agree');

// who is asking: super admin (default), an ordinary admin (every switch, not the super admin) or staff (only the switches listed)
var state = { db: null, super: true, perms: null };
function allowed(perm) { return state.super || state.perms === null || !!state.perms[perm]; }
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function (db, uid, perm) { return Promise.resolve(allowed(perm) ? { ok: true, ctx: { isSuperAdmin: state.super, mp: {}, deny: {} } } : { ok: false, status: 403, ctx: { isSuperAdmin: false, mp: {}, deny: {} } }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: state.super, mp: {}, deny: {} }); },
  userHasPermission: function (ctx, perm) { return allowed(perm); }, SENSITIVE_PERMS: {},
  revenueSwitchedOff: function () { return false; }, // v55.83-XK — the stand-in needs the new export (revenueScope calls it for anyone not super admin); nobody is a researcher here
});
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var B = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var TP = require(path.join(root, 'src/lib/tax-pack.js'));
var UI = require(path.join(root, 'src/components/PeriodStatsTab.jsx'));
function call(body) { return B.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
var NT = 'NextTrade Industries', RTM = 'RTM Capital';
function ln(id, date, amt, extra) { return Object.assign({ id: id, wave_business_id: US, account_id: 'A1', direction: 'out', amount_abs: amt, date: date, posted_date: date, pending: false, review_status: 'unreviewed', third_party_payer: null, name: 'LINE ' + id, merchant_name: null, classification: null, transfer_group_id: null, matched_invoice_id: null }, extra || {}); }
function world(withOpenings) {
  var db = new FakeDb({});
  db.t.expense_categories = [{ key: 'professional_fees', label: 'Professional fees', kind: 'expense' }, { key: 'trucking', label: 'Trucking', kind: 'expense' }, { key: 'rent', label: 'Rent', kind: 'expense' }];
  db.t.paid_through_parties = [{ name: RTM, kind: 'service_provider', remainder_label: 'RTM service fee', active: true, sort: 1 }, { name: NT, kind: 'affiliate', remainder_label: 'NextTrade advance', active: true, sort: 2 }];
  db.t.bank_transactions = [ln('J1', '2026-06-03', 10000, { third_party_payer: NT, classification: 'professional_fees', name: 'WIRE TO NEXTTRADE' }), ln('RENT', '2026-06-18', 1500, { classification: 'rent', name: 'ACH LANDLORD' })];
  db.t.vendor_bills = [
    { id: 'b1', wave_business_id: US, vendor_name: 'Kronos', bill_number: 'K-1', bill_date: '2026-05-12', due_date: '2026-05-30', currency: 'USD', total_amount: 600, category: 'trucking', record_status: 'active', paid_via: NT },
    { id: 'b2', wave_business_id: US, vendor_name: 'Warehouse Rent', bill_number: 'R-1', bill_date: '2026-06-10', due_date: '2026-06-30', currency: 'USD', total_amount: 400, category: 'rent', record_status: 'active', paid_via: NT }];
  db.t.vendor_bill_payments = [
    { id: 'pB', bill_id: 'b1', amount: 600, paid_date: '2026-05-20', bank_transaction_id: null, party_opening_id: 'O1', method: 'rtm', voided: false, created_at: '2026-05-20T00:00:00Z' }, // BEFORE 1 June: never in the tax line
    { id: 'pA', bill_id: 'b2', amount: 400, paid_date: '2026-06-15', bank_transaction_id: null, party_opening_id: 'O1', method: 'rtm', voided: false, created_at: '2026-06-15T00:00:00Z' }]; // AFTER: a new expense on 15 June
  db.t.party_opening_balances = withOpenings === false ? [] : [{ id: 'O1', party: NT, amount: 5000, as_of: '2026-05-10', reason: 'NextTrade statement 10 May', visible_to_staff: true, corrects_id: null, created_at: '2026-11-20T00:00:00Z' }];
  db.t.party_money_entries = []; db.t.wire_packages = []; db.t.wire_package_lines = [];
  db.rpcs.hub_party_funds_installed = function () { return { data: true, error: null }; };
  state.db = db; return db;
}
function cat(sp, key) { return (sp.categories || []).filter(function (c) { return c.key === key; })[0] || { total: 0, count: 0 }; }
async function stats(from, to) { var j = await call({ action: 'period_stats', from: from, to: to }); return j.spending || null; }
function pfOf(sp, party) { return (sp.party_funds || []).filter(function (p) { return p.party === party; })[0] || null; }

(async function () {
  world();
  var jun = await stats('2026-06-01', '2026-06-30'); var may = await stats('2026-05-01', '2026-05-31'); var both = await stats('2026-05-01', '2026-06-30');
  check('the real route answers with the spending block and the shared calculation for each period', !!jun && !!may && !!both && !!pfOf(jun, NT) && !!pfOf(may, NT) && !!pfOf(both, NT));
  var pJ = pfOf(jun, NT);
  check('JUNE party-funds: tax = the 10,000 transfer + the 400 used from the starting balance on 15 June = 10,400', pJ.period.tax_professional_fees === 10400 && pJ.period.tax_from_starting_balance === 400 && pJ.period.funds_sent === 10000, pJ.period);
  check('JUNE bills route: funds_sent_tax total 10,400 = transfers 10,000 (1) + starting balance 400 (1); NextTrade 10,400', jun.funds_sent_tax.total === 10400 && jun.funds_sent_tax.transfers_total === 10000 && jun.funds_sent_tax.transfers_count === 1 && jun.funds_sent_tax.from_starting_balance === 400 && jun.funds_sent_tax.from_starting_balance_count === 1 && jun.funds_sent_tax.count === 2 && jun.funds_sent_tax.by_party[NT] === 10400, jun.funds_sent_tax);
  check('THE TWO TAX FIGURES AGREE (June): party-funds tax_professional_fees === funds_sent_tax for NextTrade, and the totals over every company match', pJ.period.tax_professional_fees === jun.funds_sent_tax.by_party[NT] && jun.funds_sent_tax.total === (jun.party_funds || []).reduce(function (s, p) { return Math.round((s + p.period.tax_professional_fees) * 100) / 100; }, 0));
  check('JUNE Professional fees (the line the tax pack prints) = 10,400; deductible spending includes it; total money OUT does not move (no bank money moved: 11,500)', cat(jun, 'professional_fees').total === 10400 && cat(jun, 'professional_fees').from_starting_balance === 400 && jun.deductible_spending === 11900 && jun.total_out === 11500, [cat(jun, 'professional_fees'), jun.deductible_spending, jun.total_out]);
  var pM = pfOf(may, NT);
  check('MAY: the 600 used on 20 May (before 1 June) is in NEITHER tax figure — party-funds 0, funds_sent_tax 0, no Professional fees line', pM.period.tax_professional_fees === 0 && pM.period.from_starting_balance === 600 && may.funds_sent_tax.total === 0 && may.funds_sent_tax.from_starting_balance === 0 && cat(may, 'professional_fees').total === 0, [pM.period, may.funds_sent_tax]);
  var pB = pfOf(both, NT);
  check('MAY + JUNE: both figures 10,400 (the transfer once + only the use on / after 1 June), and they agree', pB.period.tax_professional_fees === 10400 && both.funds_sent_tax.total === 10400 && both.funds_sent_tax.by_party[NT] === pB.period.tax_professional_fees);
  // the accountant pack (file 7) prints the same figure, with the starting-balance part on its own line
  var KL = { expense: 'Expense', not_pnl: 'Not P&L' }; var f7 = TP.spendingByCategoryCsv(jun, KL);
  function row(start) { return f7.filter(function (l) { return l.indexOf(start) === 0; })[0] || null; }
  check('ACCOUNTANT PACK file 7: Professional fees 10,400.00; "of which transfers" 1 / 10,000.00; "of which bills paid from a starting balance" 1 / 400.00; deductible 11,900.00', row('"Professional fees",') === '"Professional fees",Expense,2,10400.00' && row('"  of which transfers to RTM / NextTrade') === '"  of which transfers to RTM / NextTrade (inside Professional fees)",,1,10000.00' && /,,1,400\.00$/.test(row('"  of which bills paid from a starting balance') || '') && /,11900\.00$/.test(row('"DEDUCTIBLE SPENDING') || ''), f7);
  // the internal (real-cost) view: the use leaves Professional fees and the bill is in its own category; totals never move
  var internal = jun.categories; (jun.paid_through || []).forEach(function (b) { internal = UI.rtmAdjust(internal, b); });
  function ic(k) { return (internal.filter(function (c) { return c.key === k; })[0] || { total: 0 }).total; }
  var sumTax = jun.categories.reduce(function (s, c) { return s + c.total; }, 0); var sumInt = internal.reduce(function (s, c) { return s + c.total; }, 0);
  check('INTERNAL view (June): Professional fees 0 (transfer and starting-balance use both taken out), Rent 1,500 + the 400 bill = 1,900; the two views total the same', ic('professional_fees') === 0 && ic('rent') === 1900 && Math.round(sumTax * 100) === Math.round(sumInt * 100), internal.map(function (c) { return c.key + ':' + c.total; }));
  var blk = (jun.paid_through || []).filter(function (b) { return b.payer === NT; })[0];
  check('… the block takes out exactly the party-funds figure (400) and does not count the use against the transfer (remainder 10,000)', blk && blk.starting_balance_applied === pJ.period.tax_from_starting_balance && blk.service_fee === 10000, blk);
  // without any starting balance (or before XO): nothing changes
  world(false);
  var none = await stats('2026-06-01', '2026-06-30'); var nInt = none.categories; (none.paid_through || []).forEach(function (b) { nInt = UI.rtmAdjust(nInt, b); });
  check('a payment naming a starting balance the report does not know is taxed by NEITHER figure and taken out of nothing (the views still agree)', none.funds_sent_tax.total === 10000 && none.funds_sent_tax.from_starting_balance === 0 && cat(none, 'professional_fees').total === 10000 && pfOf(none, NT).period.tax_professional_fees === 10000 && (nInt.filter(function (c) { return c.key === 'professional_fees'; })[0] || { total: 0 }).total === 0, [none.funds_sent_tax, nInt.map(function (c) { return c.key + ':' + c.total; })]);
  // ── (Codex 22 Nov 14:52 P1) an "only me" balance on the ACTUAL period_stats JSON, for three callers ──
  var PE = require(path.join(root, 'src/lib/pnl-expenses.js'));
  function hiddenWorld() { var d = world(); d.t.party_opening_balances[0].visible_to_staff = false; d.t.party_opening_balances[0].reason = 'SECRET-REASON NextTrade May statement'; return d; }
  var LEAK = /SECRET-REASON|"starting_balances"|from_starting_balance|tax_from_starting|party_opening|"O1"|\b5000\b|\b4000\b|10400/;
  var STAFF = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true, 'accounting.change_dates': true, 'accounting.view_invoicing': true };
  hiddenWorld(); state.super = true; state.perms = null;
  var hs = await call({ action: 'period_stats', from: '2026-06-01', to: '2026-06-30' });
  check('SUPER ADMIN, hidden balance: the full report — Professional fees 10,400, the balance with its reason in party_funds, no restriction', hs.ok === true && !hs.spending_restricted && cat(hs.spending, 'professional_fees').total === 10400 && pfOf(hs.spending, NT).starting_balances[0].reason === 'SECRET-REASON NextTrade May statement', hs.spending_restricted || hs.error);
  check('(the leak scan below is real: on the super admin\'s response it finds the reason, the uses and the 10,400)', LEAK.test(JSON.stringify(hs)) && /SECRET-REASON/.test(JSON.stringify(hs)) && /10400/.test(JSON.stringify(hs)));
  var callers = [['ORDINARY ADMIN (every switch, not the super admin)', null], ['STAFF (accounting + bills + totals switches)', STAFF]];
  for (var ci = 0; ci < callers.length; ci++) {
    hiddenWorld(); state.super = false; state.perms = callers[ci][1];
    var hr = await call({ action: 'period_stats', from: '2026-06-01', to: '2026-06-30' }); var whole = JSON.stringify(hr);
    check(callers[ci][0] + ': period_stats answers ok with an EXPLICIT restricted state — spending withheld, the reason said, nothing recalculated without the balance', hr.ok === true && hr.spending === null && hr.spending_restricted && hr.spending_restricted.reason === 'includes a starting balance only the super admin may see' && hr.spending_restricted.hidden_starting_balances === 1, [hr.error, hr.spending_restricted, !!hr.spending]);
    check(callers[ci][0] + ': the WHOLE response carries none of it — no amount, reason, use, id, tax or held figure of the hidden balance', !LEAK.test(whole), (whole.match(LEAK) || [])[0]);
    var ea = PE.readExpenseAnswer(hr, { from: '2026-06-01', to: '2026-06-30' }, UI.rtmAdjust, UI.foldUnc);
    check(callers[ci][0] + ': the P&L reader says the expenses are withheld (locked, restricted) — never a complete-looking partial P&L', ea.status === 'locked' && ea.restricted === true && /withheld/.test(ea.why), ea);
  }
  hiddenWorld(); state.super = false; state.perms = STAFF;
  var before = await call({ action: 'period_stats', from: '2026-04-01', to: '2026-04-30' });
  check('STAFF, April (before the hidden balance is as of 10 May): nothing to withhold — the spending block is there', before.ok === true && !before.spending_restricted && !!before.spending, before.spending_restricted);
  world(); state.super = false; state.perms = STAFF;
  var vis = await call({ action: 'period_stats', from: '2026-06-01', to: '2026-06-30' });
  check('STAFF, a balance marked "staff can see it": the full figures (Professional fees 10,400; the two tax figures agree)', vis.ok === true && !vis.spending_restricted && cat(vis.spending, 'professional_fees').total === 10400 && pfOf(vis.spending, NT).period.tax_professional_fees === vis.spending.funds_sent_tax.by_party[NT]);
  var tabSrc = require('fs').readFileSync(path.join(root, 'src/components/PeriodStatsTab.jsx'), 'utf8');
  check('the accountant pack refuses (no files) when spending is restricted, and the screen says why', tabSrc.indexOf('if (data && data.spending_restricted) { toast.error(') > 0 && tabSrc.indexOf('{data.spending_restricted && <div') > 0);

  // ── (Codex 22 Nov 18:29 P1) WHOLE-JSON SCANS: the hidden balance never reaches anyone but the super admin, WHATEVER the dates ──
  // Fixture (fabricated): NextTrade has a VISIBLE balance O2 (2,000 as of 15 March, a 250 bill paid from it on 20 April) and the
  // HIDDEN balance O1 (5,000 as of 10 May, corrected by −100 → 4,900; bills of 600 on 20 May and 400 on 15 June paid from it:
  // used 1,000, held 3,900). An April transfer of 3,000 to NextTrade. April is BEFORE the hidden balance, June is AFTER it.
  var DED = { 'accounting.view': true, 'bills.view': true, 'accounting.view_totals': true, 'accounting.change_dates': true, 'accounting.view_invoicing': true };
  function mixedWorld(extraUse) {
    var d = hiddenWorld();
    d.t.party_opening_balances.push({ id: 'O1c', party: NT, amount: -100, as_of: '2026-05-10', reason: 'SECRET-CORRECTION typo', visible_to_staff: false, corrects_id: 'O1', created_at: '2026-11-21T00:00:00Z' });
    d.t.party_opening_balances.push({ id: 'O2', party: NT, amount: 2000, as_of: '2026-03-15', reason: 'VISIBLE-MARCH statement', visible_to_staff: true, corrects_id: null, created_at: '2026-11-20T00:00:00Z' });
    d.t.vendor_bills.push({ id: 'b3', wave_business_id: US, vendor_name: 'Kronos', bill_number: 'V-1', bill_date: '2026-04-18', due_date: '2026-04-30', currency: 'USD', total_amount: 250, category: 'trucking', record_status: 'active', paid_via: NT });
    d.t.vendor_bill_payments.push({ id: 'pV', bill_id: 'b3', amount: 250, paid_date: '2026-04-20', bank_transaction_id: null, party_opening_id: 'O2', method: 'rtm', voided: false, created_at: '2026-04-20T00:00:00Z' });
    d.t.bank_transactions.push(ln('J0', '2026-04-05', 3000, { third_party_payer: NT, classification: 'professional_fees', name: 'WIRE TO NEXTTRADE APRIL' }));
    if (extraUse) { d.t.vendor_bills.push({ id: 'b4', wave_business_id: US, vendor_name: 'Hidden Use Co', bill_number: 'H-9', bill_date: '2026-04-24', due_date: '2026-04-30', currency: 'USD', total_amount: 77, category: 'trucking', record_status: 'active', paid_via: NT }); d.t.vendor_bill_payments.push({ id: 'pE', bill_id: 'b4', amount: 77, paid_date: '2026-04-25', bank_transaction_id: null, party_opening_id: 'O1', method: 'rtm', voided: false, created_at: '2026-04-25T00:00:00Z' }); }
    return d;
  }
  // everything that exists ONLY because of the hidden balance: its words, ids, the payment ids that name it, its amounts — scanned
  // over the WHOLE JSON. The bills paid from it (K-1, R-1, H-9) are ordinary bills: the Bills screen and the report's own bill drills
  // list them like any bill (no word of where they were paid from); inside the funds / spending answer they must not appear.
  var SECRET = /SECRET-|"O1c?"|"p[ABE]"|party_opening|\b5000\b|\b4900\b|\b3900\b|\b1000\b|-100\b/;
  var USES = /"K-1"|"R-1"|"H-9"|Hidden Use Co|\b77\b/;
  function scan(j) { var s = JSON.stringify(j); var m = s.match(SECRET); if (m) { return m[0]; } var sp = j && j.spending !== undefined ? JSON.stringify(j.spending) : ''; var u = sp.match(USES); return u ? 'spending:' + u[0] : null; }
  function drillsPlain(j) { var d = (j && j.drills) || {}; return ['billed', 'bills_paid'].every(function (k) { return (d[k] || []).every(function (r) { return !/starting|opening/i.test(JSON.stringify(r)); }); }); }
  async function as(who, from, to) { state.super = who === 'super'; state.perms = who === 'staff' ? DED : null; return call({ action: 'period_stats', from: from, to: to }); }
  var KL7 = { expense: 'Expense', not_pnl: 'Not P&L' }; var DET = require(path.join(root, 'src/lib/pnl-expense-detail.js'));
  function exportsOf(resp, from, to) { // the consumers that turn this answer into screens and files
    var sp = resp.spending || null;
    return { pnl: PE.readExpenseAnswer(resp, { from: from, to: to }, UI.rtmAdjust, UI.foldUnc), detail: sp ? DET.expenseDetail(sp, PE.realCostCategories(sp, UI.rtmAdjust, UI.foldUnc)) : null,
      pf_rows: sp ? PE.partyFundsRows(sp.categories, sp.party_funds) : null, f7: sp ? TP.spendingByCategoryCsv(sp, KL7) : null, f8: sp ? TP.spendingDetailCsv(sp) : null, is: sp ? TP.incomeStatementCsv(sp) : null };
  }
  mixedWorld(); var supApr = await as('super', '2026-04-01', '2026-04-30'); var supJun = await as('super', '2026-06-01', '2026-06-30');
  var sNT = pfOf(supApr.spending, NT);
  check('SUPER ADMIN, April and June (mixed balances): the full answer — both balances listed, the hidden one with its reason, today\'s figures', supApr.ok === true && !supApr.spending_restricted && sNT.starting_balances.length === 2 && sNT.starting_balances.some(function (s) { return s.reason === 'SECRET-REASON NextTrade May statement' && s.amount === 4900 && s.current.held === 3900; }) && sNT.current && sNT.current.starting_balance === 6900 && supJun.ok === true && !supJun.spending_restricted, sNT && sNT.starting_balances);
  check('(the scan is real: it finds the hidden balance in the super admin\'s April AND June answers, and the bills paid from it in June\'s funds answer)', !!scan(supApr) && /SECRET-REASON/.test(JSON.stringify(supApr)) && /\b3900\b/.test(JSON.stringify(supApr)) && !!scan(supJun) && USES.test(JSON.stringify(supJun.spending.party_funds)), [scan(supApr), scan(supJun)]);
  var who = [['STAFF', 'staff'], ['ORDINARY ADMIN', 'admin']];
  for (var wi = 0; wi < who.length; wi++) {
    var W = who[wi][0];
    mixedWorld(); var apr = await as(who[wi][1], '2026-04-01', '2026-04-30'); var aNT = apr.spending && pfOf(apr.spending, NT);
    check(W + ', April (BEFORE the hidden balance): ok, the spending block is there, not restricted', apr.ok === true && apr._status === 200 && !apr.spending_restricted && !!apr.spending && !!aNT, [apr._status, apr.spending_restricted]);
    check(W + ', April: WHOLE JSON scan — no reason, correction, id, use, bill number or amount of the hidden balance anywhere', scan(apr) === null, scan(apr));
    check(W + ', April: NextTrade lists ONLY the visible balance (its reason, 2,000, the 250 April use); "1 not shown to you"', aNT.starting_balances.length === 1 && aNT.starting_balances[0].id === 'O2' && aNT.starting_balances[0].reason === 'VISIBLE-MARCH statement' && aNT.starting_balances[0].amount === 2000 && aNT.hidden_starting_balances === 1, aNT.starting_balances);
    check(W + ', April: today\'s company totals (whole history, they include the hidden balance) are WITHHELD — current null, said why; never recomputed without it', aNT.current === null && aNT.current_withheld === 'includes a starting balance only the super admin may see', [aNT.current, aNT.current_withheld]);
    check(W + ', April: the PERIOD and AS-OF figures are the super admin\'s own, unchanged (the hidden balance is not in them): sent 3,000, opening 2,000, 250 used, closing 4,750', JSON.stringify(aNT.period) === JSON.stringify(sNT.period) && JSON.stringify(aNT.as_of) === JSON.stringify(sNT.as_of) && aNT.period.funds_sent === 3000 && aNT.period.opening_held === 2000 && aNT.period.from_starting_balance === 250 && aNT.period.closing_held === 4750 && aNT.arithmetic_ok === true && apr.spending.funds_sent_tax.total === supApr.spending.funds_sent_tax.total, [aNT.period, sNT.period]);
    var ex = exportsOf(apr, '2026-04-01', '2026-04-30'); var dNT = (ex.detail.funding || []).filter(function (f) { return f.payer === NT; })[0];
    check(W + ', April EXPORT BOUNDARY: the P&L reader, the expense detail (today\'s words say "not shown"), the funds rows and the accountant-pack files carry none of it', ex.pnl.status === 'ok' && scan(ex) === null && !USES.test(JSON.stringify(ex)) && dNT && /^Today: not shown/.test(dNT.today_words) && Array.isArray(ex.f7) && ex.f7.length > 0, [ex.pnl.status, scan(ex), dNT && dNT.today_words]);
    mixedWorld(); var jun = await as(who[wi][1], '2026-06-01', '2026-06-30');
    check(W + ', June (AFTER the hidden balance): the explicit restricted state, and the WHOLE JSON scan finds nothing', jun.ok === true && jun.spending === null && !!jun.spending_restricted && jun.spending_restricted.hidden_starting_balances === 1 && scan(jun) === null && scan(exportsOf(jun, '2026-06-01', '2026-06-30')) === null && drillsPlain(jun), [jun.spending_restricted, scan(jun)]);
    mixedWorld(); var may = await as(who[wi][1], '2026-05-01', '2026-05-31');
    check(W + ', May (the hidden balance starts inside it): restricted, nothing of it in the answer', may.spending === null && !!may.spending_restricted && scan(may) === null && drillsPlain(may), scan(may));
    mixedWorld(true); var aprUse = await as(who[wi][1], '2026-04-01', '2026-04-30');
    check(W + ', April when a bill was paid from the hidden balance on 25 April (before its as-of date): restricted — the period moves by it — and nothing of it shown', aprUse.spending === null && !!aprUse.spending_restricted && scan(aprUse) === null && drillsPlain(aprUse), [aprUse.spending_restricted, scan(aprUse)]);
  }
  mixedWorld(true); var supUse = await as('super', '2026-04-01', '2026-04-30');
  check('SUPER ADMIN, that same April: the full answer with the 77 use from the hidden balance', supUse.ok === true && !supUse.spending_restricted && pfOf(supUse.spending, NT).period.from_starting_balance === 327, pfOf(supUse.spending, NT).period);
  // the shared rule, directly: a future-dated hidden balance counts for nobody but by its date — or once a bill is paid from it
  var PF = require(path.join(root, 'src/lib/party-funds.js'));
  var obs = [{ id: 'H', party: NT, amount: 5000, as_of: '2026-05-10', visible_to_staff: false }];
  check('hiddenStartingBalances: a hidden balance dated after the end does not count by its date, but DOES once a bill is paid from it on / before the end (also through a correction id)', PF.hiddenStartingBalances(obs, false, '2026-04-30').length === 0 && PF.hiddenStartingBalances(obs, false, '2026-04-30', [{ party_opening_id: 'H', paid_date: '2026-04-25' }]).length === 1 && PF.hiddenStartingBalances(obs, false, '2026-04-30', [{ party_opening_id: 'H', paid_date: '2026-04-25', voided: true }]).length === 0 && PF.hiddenStartingBalances(obs.concat([{ id: 'Hc', corrects_id: 'H', amount: -1, visible_to_staff: false }]), false, '2026-04-30', [{ party_opening_id: 'Hc', paid_date: '2026-04-01' }]).length === 1 && PF.hiddenStartingBalances(obs, true, '2026-06-30').length === 0);
  var ovr = PF.partyFundsBreakdown({ parties: [{ name: NT }], bankLines: [], pays: [{ id: 'q1', bill_id: 'bx', amount: 9000, paid_date: '2026-06-20', party_opening_id: 'H' }], bills: [{ id: 'bx', paid_via: NT, total_amount: 9000 }], openings: obs, requests: [], entries: [], from: '2026-04-01', to: '2026-04-30' });
  var ovrV = PF.partyFundsForViewer(ovr, false, '2026-04-30');
  check('partyFundsForViewer: an OVER-USED hidden balance (used 9,000 of 5,000 after the period) — the super admin sees needs_reconciliation; anyone else gets the transfers\' own flag (false), current withheld, the balance gone, not restricted', ovr[0].needs_reconciliation === true && ovrV.funds[0].needs_reconciliation === false && ovrV.funds[0].current === null && ovrV.funds[0].starting_balances.length === 0 && ovrV.restricted === 0 && !/9000|5000|"H"/.test(JSON.stringify(ovrV.funds)), ovrV.funds[0]);
  check('partyFundsForViewer: the super admin\'s answer is returned as it is; a company without a hidden balance is untouched', (function () { var f = [{ party: RTM, starting_balances: [], current: { unused: 1 } }]; return PF.partyFundsForViewer(f, true, '2026-04-30').funds === f && PF.partyFundsForViewer(f, false, '2026-04-30').funds[0] === f[0]; })());
  // ── (Codex 22 Nov 14:52 P2) the starting balances cannot be read: 10,400 → unavailable → 10,400, no business row changed ──
  state.super = true; state.perms = null;
  var dbF = world(); function rowsSnap() { return JSON.stringify([dbF.t.bank_transactions, dbF.t.vendor_bills, dbF.t.vendor_bill_payments, dbF.t.party_opening_balances, dbF.t.party_money_entries]); }
  var snap0 = rowsSnap();
  var r1 = await stats('2026-06-01', '2026-06-30');
  dbF.fail.party_opening_balances = { select: 'permission denied for table party_opening_balances' };
  var bad = await call({ action: 'period_stats', from: '2026-06-01', to: '2026-06-30' });
  check('read failure (permission denied): 503, ok false, "unavailable", NO spending, no totals, no pack — never 10,000 shown as if confirmed', bad._status === 503 && bad.ok === false && bad.unavailable === 'starting_balances' && !bad.spending && /could not be read/.test(bad.error) && !/10000|10,000|10400/.test(JSON.stringify(bad)), bad);
  var eb = PE.readExpenseAnswer(bad, { from: '2026-06-01', to: '2026-06-30' }, UI.rtmAdjust, UI.foldUnc);
  check('… the P&L reader treats it as an error (no expense columns)', eb.status === 'error' && !eb.cols, eb);
  delete dbF.fail.party_opening_balances;
  var r2 = await stats('2026-06-01', '2026-06-30');
  check('recovery: 10,400 again (before 10,400 → unavailable → 10,400), and no business row was changed by any of it', cat(r1, 'professional_fees').total === 10400 && cat(r2, 'professional_fees').total === 10400 && r2.funds_sent_tax.total === 10400 && rowsSnap() === snap0);
  dbF.fail.party_opening_balances = { select: 'relation "public.party_opening_balances" does not exist' };
  var notInst = await stats('2026-06-01', '2026-06-30');
  check('ONLY a table that is not there yet (XO not installed) keeps the old answer: ok, the transfer alone (10,000)', !!notInst && notInst.funds_sent_tax.total === 10000 && notInst.funds_sent_tax.from_starting_balance === 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
