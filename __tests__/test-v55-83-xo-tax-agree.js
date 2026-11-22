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

var state = { db: null };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function () { return Promise.resolve({ ok: true, ctx: { isSuperAdmin: true, mp: {}, deny: {} } }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: true, mp: {}, deny: {} }); },
  userHasPermission: function () { return true; }, SENSITIVE_PERMS: {},
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
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
