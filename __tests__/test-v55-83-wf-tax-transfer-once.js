// ═══════════════════════════════════════════════════════════════════════════
// v55.83-WF step C — THE TAX PRESENTATION (Max, 20 Nov 2026: "it still does not guarantee the full RTM next trade transfer").
// Every transfer KTC sent RTM Capital / NextTrade Industries counts ONCE, IN FULL, under Professional fees, on its bank date —
// whatever category the bank line carries. Later use of the held money, a services-rendered entry or its reversal add NOTHING.
// RUN: the REAL bills route (action period_stats) with an in-memory database. All amounts are illustrative fixtures.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1000))); }
console.log('WF step C — tax view: a transfer to RTM / NextTrade counts once, in full');

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
function call(body) { return B.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
var NT = 'NextTrade Industries', RTM = 'RTM Capital';

function ln(id, date, amt, extra) { return Object.assign({ id: id, wave_business_id: US, account_id: 'A1', direction: 'out', amount_abs: amt, date: date, posted_date: date, pending: false, review_status: 'unreviewed', third_party_payer: null, name: 'LINE ' + id, merchant_name: null, classification: null, transfer_group_id: null, matched_invoice_id: null }, extra || {}); }
function world(extraLines, pays, entries, requests) {
  var db = new FakeDb({});
  db.t.expense_categories = [{ key: 'professional_fees', label: 'Professional fees', kind: 'expense' }, { key: 'trucking', label: 'Trucking', kind: 'expense' }, { key: 'rent', label: 'Rent', kind: 'expense' }, { key: 'customer_payment', label: 'Customer payments', kind: 'income' }];
  db.t.paid_through_parties = [{ name: RTM, kind: 'service_provider', remainder_label: 'RTM service fee', active: true, sort: 1 }, { name: NT, kind: 'affiliate', remainder_label: 'NextTrade advance', active: true, sort: 2 }];
  db.t.bank_transactions = [
    ln('J1', '2026-06-03', 10000, { third_party_payer: NT, classification: 'professional_fees', name: 'Online Transfer to CHK ...2061 transaction#: 5000001' }),   // stamped, already professional fees
    ln('J2', '2026-06-10', 4000, { third_party_payer: RTM, classification: null, name: 'WIRE TO RTM' }),                                                         // stamped, NO category
    ln('J3', '2026-06-12', 3000, { classification: 'transfer', name: 'Online Transfer to CHK ...2061 transaction#: 5000002' }),                                  // not stamped, bank text, categorized "transfer"
    ln('J4', '2026-06-15', 2500, { classification: 'trucking', name: 'Online Transfer to CHK ...9909 transaction#: 5000003' }),                                  // not stamped, bank text, categorized something else
    ln('OWN', '2026-06-16', 9000, { classification: 'transfer', transfer_group_id: 'g1', name: 'Online Transfer to CHK ...9909 transaction#: 5000004' }),         // paired between KTC's own accounts
    ln('RENT', '2026-06-18', 1500, { classification: 'rent', name: 'ACH LANDLORD' }),
    ln('FEE', '2026-06-20', 700, { classification: 'professional_fees', name: 'ACH LAW FIRM' }),                                                               // a real professional fee, unrelated
    ln('NUM', '2026-06-21', 99, { classification: null, name: 'CHECK 9909' }),
    ln('IN1', '2026-06-22', 5000, { direction: 'in', classification: 'customer_payment', name: 'Online Transfer from CHK ...9909' })
  ].concat(extraLines || []);
  db.t.vendor_bills = [{ id: 'b1', wave_business_id: US, vendor_name: 'Kronos', bill_number: 'K-1', bill_date: '2026-07-05', due_date: '2026-07-20', currency: 'USD', total_amount: 6000, category: 'trucking', record_status: 'active', paid_via: NT }];
  db.t.vendor_bill_payments = pays || []; db.t.party_money_entries = entries || []; db.t.wire_packages = requests || []; db.t.wire_package_lines = [];
  db.rpcs.hub_party_funds_installed = function () { return { data: false, error: null }; };
  state.db = db; return db;
}
function cat(sp, key) { return (sp.categories || []).filter(function (c) { return c.key === key; })[0] || { total: 0, count: 0 }; }
async function stats(from, to) { var j = await call({ action: 'period_stats', from: from, to: to }); return { j: j, sp: j.spending || j.spend || (j.stats && j.stats.spending) || null }; }

(async function () {
  // ── June: four transfers to the companies, carrying four different bank categories ──
  world();
  var a = await stats('2026-06-01', '2026-06-30'); var sp = a.sp;
  check('the real route answers with the spending block', a.j.ok !== false && !!sp && Array.isArray(sp.categories), a.j.error || Object.keys(a.j));
  if (!sp) { console.log('\n' + pass + ' passed, ' + (failN + 1) + ' failed'); process.exit(1); }
  var pf = cat(sp, 'professional_fees');
  check('JUNE Professional fees = the four transfers IN FULL (10,000 + 4,000 + 3,000 + 2,500) + the unrelated 700 law-firm fee = 20,200', pf.total === 20200 && pf.count === 5 && pf.funds_sent === 19500, pf);
  check('the transfers line says so: 4 transfers, 19,500, by company (NextTrade 13,000 · RTM 6,500)', sp.funds_sent_tax && sp.funds_sent_tax.key === 'professional_fees' && sp.funds_sent_tax.count === 4 && sp.funds_sent_tax.total === 19500 && sp.funds_sent_tax.by_party[NT] === 13000 && sp.funds_sent_tax.by_party[RTM] === 6500, sp.funds_sent_tax);
  check('three of them carried another bank category (none / "transfer" / trucking) and were brought under Professional fees: 9,500', sp.funds_sent_tax.recategorized === 3 && sp.funds_sent_tax.recategorized_total === 9500);
  check('… so they are NOT also in "uncategorized", "transfers" or Trucking — each is counted exactly once', sp.uncategorized.total === 99 && sp.uncategorized.count === 1 && sp.transfers.total === 9000 && sp.transfers.count === 1 && cat(sp, 'trucking').total === 0, [sp.uncategorized, sp.transfers, cat(sp, 'trucking')]);
  check('a transfer PAIRED between KTC\'s own accounts stays a transfer even though its text names the 9909 account', sp.transfers.total === 9000);
  check('rent, the digits-only "CHECK 9909" line and money IN are untouched', cat(sp, 'rent').total === 1500 && sp.total_in === 5000 && (sp.in_categories || []).some(function (c) { return c.key === 'customer_payment' && c.total === 5000; }));
  var sumCats = (sp.categories || []).reduce(function (s, c) { return s + c.total; }, 0);
  check('nothing is lost or doubled: categories + uncategorized + transfers = total money out (30,799)', Math.round((sumCats + sp.uncategorized.total + sp.transfers.total) * 100) === Math.round(sp.total_out * 100) && sp.total_out === 30799, [sumCats, sp.uncategorized.total, sp.transfers.total, sp.total_out]);
  check('no "advance held" row and no "from advances" amount exists in the tax view any more', !(sp.categories || []).some(function (c) { return c.key === '__party_advance' || c.from_advances; }));
  var blkNT = (sp.paid_through || []).filter(function (b) { return b.payer === NT; }); var blkR = (sp.paid_through || []).filter(function (b) { return b.payer === RTM; });
  var payKeys = blkNT.concat(blkR).reduce(function (acc, b) { return acc.concat((b.payments_by_cat || []).map(function (p) { return p.key + ':' + p.total; })); }, []);
  check('the internal view\'s blocks name the SAME key the transfers were counted in (so it takes each payment out of exactly that line): 13,000 and 6,500 under professional_fees', payKeys.every(function (k) { return k.indexOf('professional_fees:') === 0; }) && blkNT.reduce(function (s, b) { return s + b.payments_total; }, 0) === 13000 && blkR.reduce(function (s, b) { return s + b.payments_total; }, 0) === 6500, payKeys);
  var juneRow = (sp.rows || []).filter(function (r) { return r.id === 'J3'; })[0];
  check('each such row on the list shows which company it went to and what the bank line itself said', juneRow && juneRow.funds_sent_to === NT && juneRow.category === 'professional_fees' && juneRow.bank_category === 'transfer', juneRow);

  // ── July: held money is USED — a bill paid from the June transfer, a services-rendered entry, its reversal, a wire fee ──
  var pays = [{ id: 'p1', bill_id: 'b1', amount: 6000, paid_date: '2026-07-10', bank_transaction_id: 'J1', voided: false, method: 'rtm' }];
  var entries = [{ id: 'e1', party: NT, bucket: 'fee', kind: 'fee_from_transfer', amount: 500, source_bank_transaction_id: 'J1', entry_date: '2026-07-12', created_at: '2026-07-12T00:00:00Z' },
    { id: 'e2', party: NT, bucket: 'fee', kind: 'fee_from_transfer', amount: 300, source_bank_transaction_id: 'J1', entry_date: '2026-07-15', created_at: '2026-07-15T00:00:00Z' },
    { id: 'e3', party: NT, bucket: 'fee', kind: 'fee_back_to_transfer', amount: -300, source_bank_transaction_id: 'J1', corrects_id: 'e2', entry_date: '2026-07-16', created_at: '2026-07-16T00:00:00Z' },
    { id: 'e4', party: NT, bucket: 'advance', kind: 'payment_split', amount: 2000, bank_transaction_id: 'J1', entry_date: '2026-06-03', created_at: '2026-06-03T00:00:00Z' },   // an OLD-style advance split: must not reduce the transfer
    { id: 'e5', party: NT, bucket: 'fee', kind: 'advance_to_fee', amount: 400, entry_date: '2026-07-18', created_at: '2026-07-18T00:00:00Z' }];                              // an OLD-style pool fee move: must add nothing to tax
  world([ln('JUL', '2026-07-08', 800, { classification: 'rent', name: 'ACH LANDLORD' })], pays, entries);
  var jn = await stats('2026-06-01', '2026-06-30'); var jl = await stats('2026-07-01', '2026-07-31');
  check('JUNE is unchanged by everything that happened in July — Professional fees still 20,200 (the old-style 2,000 "advance" split takes nothing out)', cat(jn.sp, 'professional_fees').total === 20200 && jn.sp.funds_sent_tax.total === 19500 && !(jn.sp.categories || []).some(function (c) { return c.key === '__party_advance'; }), cat(jn.sp, 'professional_fees'));
  check('JULY adds NOTHING to Professional fees: the 6,000 bill paid from the June transfer, the 500 services rendered, the 300 marked and reversed, and the old pool move are not new payments', cat(jl.sp, 'professional_fees').total === 0 && jl.sp.funds_sent_tax.count === 0 && jl.sp.funds_sent_tax.total === 0, [cat(jl.sp, 'professional_fees'), jl.sp.funds_sent_tax]);
  check('July\'s own bank spending is just its own lines (rent 800)', jl.sp.total_out === 800 && cat(jl.sp, 'rent').total === 800);
  var pfJ = (jl.sp.party_funds || []).filter(function (p) { return p.party === NT; })[0];
  check('the INTERNAL figures are separate and still there: July internal fee 500 (net of the reversal) + 400 old pool fee reported apart; June transfer still the source', !!pfJ && pfJ.period.fee_deduction === 900 && pfJ.period.fees_without_a_transfer === 400 && pfJ.period.applied_to_bills === 6000 && pfJ.period.tax_professional_fees === 0, pfJ && pfJ.period);
  var pfN = (jn.sp.party_funds || []).filter(function (p) { return p.party === NT; })[0];
  check('the shared calculation\'s tax figure agrees with the report line for June (NextTrade 13,000)', !!pfN && pfN.period.tax_professional_fees === 13000 && jn.sp.funds_sent_tax.by_party[NT] === 13000);
  var viewJune = await call({ action: 'period_stats', paid_comparison: true, from: '2026-06-01', to: '2026-06-30' });
  var viewJuly = await call({ action: 'period_stats', paid_comparison: true, from: '2026-07-01', to: '2026-07-31' });
  var jpc = viewJune.paid_comparison; var lpc = viewJuly.paid_comparison;
  check('the comparison route keeps June’s 19,500 funding separate from 2,200 of actual payments and 5,000 of customer receipts', jpc && jpc.paid?.cents === 220000 && jpc.funding.cents === 1950000 && jpc.receipts.cents === 500000 && viewJune.spending.funds_sent_tax.total === 19500, jpc);
  check('the comparison route shows the July bill plus recorded net fees and rent, with the actual bill behind the 6,000 payment', lpc && lpc.paid?.cents === 770000 && lpc.funding.cents === 0 && lpc.funded_paid.cents === 690000 && lpc.paid.rows.some(function (r) { return r.bill_id === 'b1' && r.cents === 600000; }), lpc);
  var both = await stats('2026-06-01', '2026-07-31');
  check('June + July together: Professional fees 20,200 — the transfer is there once, not once per month it was used', cat(both.sp, 'professional_fees').total === 20200);

  // ── no "Professional fees" category exists in the list: the transfers still get their own line ──
  var d3 = world(); d3.t.expense_categories = [{ key: 'trucking', label: 'Trucking', kind: 'expense' }, { key: 'rent', label: 'Rent', kind: 'expense' }];
  d3.t.bank_transactions.forEach(function (t) { if (t.classification === 'professional_fees') { t.classification = null; } });
  var n3 = await stats('2026-06-01', '2026-06-30'); var own = cat(n3.sp, '__professional_fees_pt');
  check('without a "Professional fees" category the transfers still appear as one deductible line of their own (19,500), never lost in uncategorized', own.total === 19500 && own.kind === 'expense' && own.label === 'Professional fees' && n3.sp.funds_sent_tax.key === '__professional_fees_pt' && n3.sp.uncategorized.total === 799, [own, n3.sp.uncategorized]);

  // ── (Codex 18:00 P1) THE ACCOUNTANT PACK — the actual CSV text of files 7, 8 and 12, from the real route's answer ──
  var TP = require(path.join(root, 'src/lib/tax-pack.js'));
  var UI = require(path.join(root, 'src/components/PeriodStatsTab.jsx'));
  var KL = { expense: 'Expense', cogs: 'Cost of goods', other_expense: 'Other expense', not_pnl: 'Not P&L' };
  function csvRow(lines, startsWith) { return lines.filter(function (l) { return l.indexOf(startsWith) === 0; })[0] || null; }
  function lastNum(line) { return line ? Number(line.split(',').pop()) : null; }
  world([ln('JUL', '2026-07-08', 800, { classification: 'rent', name: 'ACH LANDLORD' })], pays, entries); // the same world as above: June transfers, July use / fee / reversal; NextTrade is an AFFILIATE with no provider date (its whole history is the "advance" era)
  var pkJ = await stats('2026-06-01', '2026-06-30'); var pkL = await stats('2026-07-01', '2026-07-31');
  check('the fixture really has NextTrade as an affiliate block in its pre-provider era (the case the old pack re-bucketed)', (pkJ.sp.paid_through || []).some(function (b) { return b.payer === NT && b.kind === 'affiliate'; }), (pkJ.sp.paid_through || []).map(function (b) { return [b.payer, b.kind, b.era]; }));
  var f7 = TP.spendingByCategoryCsv(pkJ.sp, KL); var f8 = TP.spendingDetailCsv(pkJ.sp); var f12 = TP.incomeStatementCsv(pkJ.sp);
  check('FILE 7 (spending by category), June: Professional fees 20,200.00 — the four transfers in full plus the unrelated fee', lastNum(csvRow(f7, '"Professional fees",')) === 20200 && csvRow(f7, '"Professional fees",') === '"Professional fees",Expense,5,20200.00', f7);
  check('FILE 7: NO "advance" line, no NextTrade / RTM line of its own, no "not yet linked" row — the transfers are not turned into anything else', !f7.some(function (l) { return /advance|NextTrade|RTM Capital|not yet linked|__pt_/i.test(l) && l.indexOf('of which transfers to RTM / NextTrade') < 0 && l.indexOf('DEDUCTIBLE SPENDING') < 0; }), f7);
  check('FILE 7: deductible spending = Professional fees 20,200 + rent 1,500 = 21,700.00, and it says the transfers are inside in full', lastNum(csvRow(f7, '"DEDUCTIBLE SPENDING')) === 21700 && /every transfer to RTM \/ NextTrade is in Professional fees, once, in full/.test(csvRow(f7, '"DEDUCTIBLE SPENDING')) && !/advances to related companies excluded/.test(f7.join('\n')), csvRow(f7, '"DEDUCTIBLE SPENDING'));
  check('FILE 7: the "of which transfers" line shows 4 transfers, 19,500.00', csvRow(f7, '"  of which transfers to RTM / NextTrade') === '"  of which transfers to RTM / NextTrade (inside Professional fees)",,4,19500.00', csvRow(f7, '"  of which'));
  check('FILE 7: uncategorized 99.00, own-account transfers 9,000.00, real spending 21,799.00', lastNum(csvRow(f7, '"UNCATEGORIZED')) === 99 && lastNum(csvRow(f7, '"TRANSFERS BETWEEN OWN ACCOUNTS')) === 9000 && lastNum(csvRow(f7, '"REAL SPENDING')) === 21799, f7);
  var byCat8 = {}; f8.slice(1).forEach(function (l) { var p = l.split(','); var cat8 = p[p.length - 2]; byCat8[cat8] = Math.round(((byCat8[cat8] || 0) + Number(p[p.length - 3])) * 100) / 100; });
  check('FILE 8 (detail) agrees with FILE 7 line by line: professional_fees 20,200 · rent 1,500 · transfer 9,000 · UNCATEGORIZED 99', byCat8.professional_fees === 20200 && byCat8.rent === 1500 && byCat8.transfer === 9000 && byCat8.UNCATEGORIZED === 99 && Object.keys(byCat8).length === 4, byCat8);
  check('FILE 12 (income statement, cash basis), June: operating expenses −21,700.00; revenue 5,000.00; net −16,700.00; warning for the 99.00 uncategorized', csvRow(f12, '"Operating expenses"') === '"Operating expenses",-21700.00' && csvRow(f12, '"Revenue (cash received)"') === '"Revenue (cash received)",5000.00' && csvRow(f12, '"NET PROFIT (cash basis)"') === '"NET PROFIT (cash basis)",-16700.00' && csvRow(f12, '"WARNING: uncategorized spending') === '"WARNING: uncategorized spending OUTSIDE this statement",99.00', f12);
  var g7 = TP.spendingByCategoryCsv(pkL.sp, KL); var g12 = TP.incomeStatementCsv(pkL.sp); var g8 = TP.spendingDetailCsv(pkL.sp);
  check('JULY pack: using the held money (bill 6,000, services 500, +300 / −300, the old pool move) creates NO tax expense — no Professional fees line, operating expenses just July\'s own 800.00', csvRow(g7, '"Professional fees",') === null && csvRow(g12, '"Operating expenses"') === '"Operating expenses",-800.00' && g8.length === 2 && !g7.some(function (l) { return /of which transfers/.test(l); }), [g7, g12]);
  // the on-screen component's own function, and the INTERNAL view kept separate
  var tabSrc = fs.readFileSync(path.join(root, 'src/components/PeriodStatsTab.jsx'), 'utf8').split('\r\n').join('\n');
  var taxLine = tabSrc.split('\n').filter(function (l) { return l.indexOf('  function taxCats(cats0)') === 0; })[0];
  var packCats = (new Function('foldUnc', taxLine + '\nreturn taxCats;'))(UI.foldUnc)(pkJ.sp.categories);
  check('the screen\'s own taxCats (what the pack and the tax totals call) leaves the server\'s categories as they are: Professional fees 20,200, no not-P&L company row', (packCats.filter(function (c) { return c.key === 'professional_fees'; })[0] || {}).total === 20200 && !packCats.some(function (c) { return /^__pt_/.test(c.key); }) && taxLine.indexOf('rtmAdjust') < 0, [taxLine, packCats]);
  check('the three pack files are built by the tested library, not by a second copy in the screen', tabSrc.indexOf("spendingByCategoryCsv(data.spending, KIND_LABELS)") > 0 && tabSrc.indexOf('spendingDetailCsv(data.spending)') > 0 && tabSrc.indexOf('incomeStatementCsv(data.spending)') > 0 && tabSrc.indexOf('advances to related companies excluded') < 0 && tabSrc.indexOf('the accountant pack and the ClickBooks books use this view') < 0);
  var internalJune = pkJ.sp.categories; (pkJ.sp.paid_through || []).forEach(function (b) { internalJune = UI.rtmAdjust(internalJune, b); });
  var intProf = (internalJune.filter(function (c) { return c.key === 'professional_fees'; })[0] || { total: 0 }).total;
  check('the INTERNAL real-cost view is still separate and unchanged in kind: there the transfers leave Professional fees (only the unrelated 700 stays) and are shown as held / fee rows', intProf === 700 && internalJune.some(function (c) { return /^__pt_/.test(c.key); }), [intProf, internalJune.map(function (c) { return c.key + ':' + c.total; })]);
  var pfInt = (pkL.sp.party_funds || []).filter(function (p) { return p.party === NT; })[0];
  check('… and the internal funds figures still exclude unused money and count only explicit fees + the underlying bill (July: bill 6,000 applied, explicit fees 500 on the transfer)', !!pfInt && pfInt.period.applied_to_bills === 6000 && pfInt.period.services_rendered === 500 && pfInt.as_of.held === 13000 - 6000 - 500, pfInt && [pfInt.period, pfInt.as_of]);

  // (Codex 18:13 P1) What's New is open to every employee and ships in the browser bundle: the release note of this build carries NO real figure
  var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8').split('\r\n').join('\n');
  var wiAt = wn.indexOf("version: 'v55.83-WI'"); var wiEnd = wn.indexOf("\n  },\n", wiAt); var wiText = wiAt > 0 && wiEnd > wiAt ? wn.substring(wiAt, wiEnd) : '';
  check('the WI release note exists and contains NO money amount, NO count of transfers and NO dated total — not even in the super-admin line', wiText.length > 200 && !/\$\s?[0-9]/.test(wiText) && !/[0-9][0-9,]{3,}(\.[0-9]{2})?/.test(wiText.replace(/v55\.83-[A-Z]+/g, '').replace(/2026-11-20/g, '').replace(/test-v55-83[\w-]*/g, '')) && !/\b[0-9]+ transfers?\b/i.test(wiText) && !/March|November|September|October/.test(wiText), wiText.substring(0, 300));
  var src = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
  check('the route no longer calls the old tax adjustment at all', src.indexOf('periodAdjustments(') < 0 && src.indexOf("import { periodAdjustments }") < 0 && src.indexOf('__professional_fees_adv') < 0);
  check('which line is a company transfer is decided ONLY by the shared rule, and a paired own-account transfer is excluded', src.indexOf('var isFundingLine = function (tF) { if (tF.direction !== \'out\' || tF.transfer_group_id) { return null; } return fundingIdentity(') > 0);

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
