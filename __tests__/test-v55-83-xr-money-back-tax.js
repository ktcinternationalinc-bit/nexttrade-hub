// ═══════════════════════════════════════════════════════════════════════════
// v55.83-XR — MONEY BACK FROM RTM / NEXTTRADE in the tax view (Max, 22 Nov 2026: "AS PER YOUR RECOMMENDATION" = Option 1:
// "the returned money reduces that expense in the month it comes back"). A money-in line recorded as a refund of a company
// transfer is taken off Professional fees on its own bank date; it is never income, whatever category the line carries.
// RUN: the REAL bills route (action period_stats) with an in-memory database, plus the real Accountant-pack builders and the
// real screen re-bucketing (rtmAdjust). All amounts are illustrative fixtures.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1000))); }
console.log('XR — money back from RTM / NextTrade lowers Professional fees in the month it comes back');

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

function world(o) {
  o = o || {};
  var db = new FakeDb({});
  db.t.expense_categories = [{ key: 'professional_fees', label: 'Professional fees', kind: 'expense' }, { key: 'trucking', label: 'Trucking', kind: 'expense' }, { key: 'sales', label: 'Sales', kind: 'income' }, { key: 'other_income', label: 'Other income', kind: 'other_income' }, { key: 'customer_payment', label: 'Customer payment', kind: 'income' }];
  db.t.paid_through_parties = [{ name: RTM, kind: 'service_provider', remainder_label: 'RTM service fee', active: true, sort: 1 }, { name: NT, kind: 'affiliate', remainder_label: 'NextTrade advance', active: true, sort: 2 }];
  db.t.bank_transactions = [
    ln('T1', '2026-03-05', 1000, { third_party_payer: NT, classification: 'professional_fees', name: 'Online Transfer to CHK ...2061 transaction#: 7000001' }),
    ln('T2', '2026-04-02', 400, { third_party_payer: RTM, classification: null, name: 'WIRE TO RTM' }),
    ln('B1', '2026-04-08', 200, { direction: 'in', classification: o.backCat === undefined ? 'sales' : o.backCat, name: 'DEPOSIT FROM NEXTTRADE' }), // NextTrade sends back 200 of T1 (March)
    ln('B2', '2026-04-20', 50, { direction: 'in', classification: null, name: 'RTM RETURN' }),                                                      // RTM sends back 50 of T2 (same month)
    ln('IN1', '2026-04-22', 5000, { direction: 'in', classification: 'customer_payment', name: 'CUSTOMER WIRE' }),
    ln('DUP', '2026-04-23', 75, { direction: 'in', classification: 'sales', review_status: 'duplicate', name: 'DUPLICATE COPY' })
  ];
  db.t.vendor_bills = []; db.t.vendor_bill_payments = []; db.t.wire_packages = []; db.t.wire_package_lines = [];
  db.t.party_money_entries = o.noEntries ? [] : [
    { id: 'r1', party: NT, bucket: 'refund', kind: 'refund', amount: 200, source_bank_transaction_id: 'T1', bank_transaction_id: 'B1', entry_date: '2026-04-15', created_at: '2026-04-15T00:00:00Z' }, // typed later than the bank date
    { id: 'r2', party: RTM, bucket: 'refund', kind: 'refund', amount: 50, source_bank_transaction_id: 'T2', bank_transaction_id: 'B2', entry_date: '2026-04-20', created_at: '2026-04-20T00:00:00Z' },
    { id: 'r3', party: NT, bucket: 'refund', kind: 'refund', amount: 75, source_bank_transaction_id: 'T1', bank_transaction_id: 'DUP', entry_date: '2026-04-23', created_at: '2026-04-23T00:00:00Z' }];
  db.rpcs.hub_party_funds_installed = function () { return { data: false, error: null }; };
  if (o.readError) { db.fail.party_money_entries = { select: 'permission denied for table party_money_entries' }; }
  state.db = db; return db;
}
function cat(cats, key) { return (cats || []).filter(function (c) { return c.key === key; })[0] || { total: 0, count: 0 }; }
async function stats(from, to) { var j = await call({ action: 'period_stats', from: from, to: to }); return { j: j, sp: j.spending || j.spend || (j.stats && j.stats.spending) || null }; }
function incomeCat(sp, key) { return cat(sp.in_categories, key); }

(async function () {
  // ── March: the 1,000 transfer to NextTrade, in full ──
  world();
  var m = (await stats('2026-03-01', '2026-03-31')).sp;
  check('MARCH: Professional fees = the 1,000 transfer in full; no money back in March', !!m && cat(m.categories, 'professional_fees').total === 1000 && m.funds_sent_tax.money_back.count === 0 && m.funds_sent_tax.net === 1000, m && m.funds_sent_tax);
  // ── April: RTM transfer 400; NextTrade sends back 200 (of March's transfer), RTM sends back 50 (of April's) ──
  var a = await stats('2026-04-01', '2026-04-30'); var sp = a.sp;
  check('the real route answers with the spending block', a.j.ok !== false && !!sp && Array.isArray(sp.categories), a.j.error || Object.keys(a.j));
  if (!sp) { console.log('\n' + pass + ' passed, ' + (failN + 1) + ' failed'); process.exit(1); }
  var pf = cat(sp.categories, 'professional_fees');
  check('APRIL: Professional fees = 400 (RTM transfer) − 200 − 50 money back = 150: the money back lowers the expense in the month it came back', pf.total === 150 && pf.money_back === 250 && pf.funds_sent === 400, pf);
  check('the transfers line says it: 1 transfer of 400, money back 2 lines 250 (NextTrade 200 · RTM 50), net 150', sp.funds_sent_tax.total === 400 && sp.funds_sent_tax.money_back.count === 2 && sp.funds_sent_tax.money_back.total === 250 && sp.funds_sent_tax.money_back.by_party[NT] === 200 && sp.funds_sent_tax.money_back.by_party[RTM] === 50 && sp.funds_sent_tax.net === 150, sp.funds_sent_tax);
  check('the money back is NOT income: Sales stays 0 although the NextTrade deposit carries the Sales category, and it is not an uncategorized deposit', incomeCat(sp, 'sales').total === 0 && sp.in_uncategorized.total === 0 && incomeCat(sp, 'customer_payment').total === 5000, [sp.in_categories, sp.in_uncategorized]);
  var mbRow = incomeCat(sp, '__party_money_back');
  check('… it has its own NOT-P&L row on the money-in side (250, 2 lines), so taxable income = 5,000 only', mbRow.total === 250 && mbRow.count === 2 && mbRow.kind === 'not_pnl' && sp.taxable_income === 5000 && /not income/.test(mbRow.label || ''), [mbRow, sp.taxable_income]);
  check('money in is still complete: total in = 5,250 (the duplicate copy is ignored, also as money back)', sp.total_in === 5250, sp.total_in);
  var rB1 = (sp.rows || []).filter(function (r) { return r.id === 'B1'; })[0];
  check('the spending list shows the money back as a MINUS row under Professional fees, with the company and what the bank line said', !!rB1 && rB1.amount === -200 && rB1.category === 'professional_fees' && rB1.money_in === true && rB1.money_back_from === NT && rB1.bank_category === 'sales', rB1);
  var early = (await stats('2026-04-01', '2026-04-10')).sp;
  check('the month is the BANK date of the money-in line (8 April), not the later date typed on the refund (15 April): 1–10 April = 400 − 200 = 200', cat(early.categories, 'professional_fees').total === 200 && early.funds_sent_tax.money_back.total === 200, early.funds_sent_tax);
  var may = (await stats('2026-05-01', '2026-05-31')).sp;
  check('MAY (outside both): no Professional fees and no money back', cat(may.categories, 'professional_fees').total === 0 && may.funds_sent_tax.money_back.count === 0);
  // whatever the category on the money-in line
  var cats0 = [null, 'other_income', 'trucking', 'professional_fees'];
  var allSame = true;
  for (var ci = 0; ci < cats0.length; ci++) {
    world({ backCat: cats0[ci] }); var s1 = (await stats('2026-04-01', '2026-04-30')).sp;
    if (cat(s1.categories, 'professional_fees').total !== 150 || s1.taxable_income !== 5000 || cat(s1.categories, 'trucking').total !== 0 || incomeCat(s1, 'other_income').total !== 0) { allSame = false; console.log('    category', cats0[ci], JSON.stringify(s1.categories).substring(0, 300)); }
  }
  check('the same result whatever category the money-in line carries (none, Other income, Trucking, Professional fees)', allSame);
  // ── Accountant pack (files 7, 8, 12) ──
  world(); sp = (await stats('2026-04-01', '2026-04-30')).sp;
  var TP = require(path.join(root, 'src/lib/tax-pack.js'));
  var f7 = TP.spendingByCategoryCsv(sp, {}).join('\n'); var f8 = TP.spendingDetailCsv(sp).join('\n'); var f12 = TP.incomeStatementCsv(sp).join('\n');
  check('file 7: Professional fees 150, and a "less money back" line of −250 under the transfers line', /"Professional fees",[^,\n]*,\d+,150\.00/.test(f7) && /less money back from RTM \/ NextTrade[^\n]*,,2,-250\.00/.test(f7), f7);
  check('file 8: the money back is a minus row (−200.00 under professional_fees)', /DEPOSIT FROM NEXTTRADE",-200\.00,professional_fees/.test(f8), f8);
  check('file 12: revenue 5,000 (money back is neither revenue nor other income), operating expenses 150', /"Revenue \(cash received\)",5000\.00/.test(f12) && /"Operating expenses",-150\.00/.test(f12) && /"Other income",0\.00/.test(f12), f12);
  // ── internal / real-cost view: no second take-off ──
  var UI = require(path.join(root, 'src/components/PeriodStatsTab.jsx'));
  var intl = sp.categories; (sp.paid_through || []).forEach(function (b) { intl = UI.rtmAdjust(intl, b); });
  var sumTax = sp.categories.reduce(function (s, c) { return s + c.total; }, 0); var sumInt = intl.reduce(function (s, c) { return s + c.total; }, 0);
  check('internal view: the companies leave Professional fees completely (transfers AND money back), and the internal total equals the tax total', Math.round(cat(intl, 'professional_fees').total * 100) === 0 && Math.round(sumTax * 100) === Math.round(sumInt * 100), [intl, sumTax, sumInt]);
  var bR = (sp.paid_through || []).filter(function (b) { return b.payer === RTM; })[0]; var bN = (sp.paid_through || []).filter(function (b) { return b.payer === NT; })[0];
  check('the RTM block nets the money back: paid 400 − 50 = 350, money back 50', !!bR && bR.payments_total === 350 && bR.money_back === 50, bR);
  check('the NextTrade block (no April transfer) carries the −200 money back of March\'s transfer', !!bN && bN.payments_total === -200 && bN.money_back === 200, bN);
  // ── no refunds / read failure ──
  world({ noEntries: true }); var n0 = (await stats('2026-04-01', '2026-04-30')).sp;
  check('no refunds recorded: everything exactly as before XR (Professional fees 400; the deposits keep their own categories)', cat(n0.categories, 'professional_fees').total === 400 && incomeCat(n0, 'sales').total === 200 && n0.funds_sent_tax.money_back.count === 0 && !n0.money_back_note, n0.in_categories);
  world({ readError: true }); var e0 = (await stats('2026-04-01', '2026-04-30')).sp;
  check('a read error is SAID on the report (money_back_note), never hidden', !!e0 && /could not be read/.test(e0.money_back_note || ''), e0 && e0.money_back_note);
  // ── wiring ──
  var src = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
  var xAt = src.indexOf('v55.83-XR (Max, 22 Nov 2026'); var xBlk = xAt > 0 ? src.substring(xAt, src.indexOf('spTx.forEach(function (t6) {', xAt)) : '';
  check('API route style kept in the new XR block: no arrow functions / template strings / const / let', xBlk.length > 200 && !/=>/.test(xBlk) && !/`/.test(xBlk) && !/\b(const|let)\s/.test(xBlk));
  var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8').split('\r\n').join('\n');
  var xfAt = wn.indexOf("version: 'v55.83-XR'"); var xfEnd = wn.indexOf('\n  },\n', xfAt); var xfText = xfAt > 0 && xfEnd > xfAt ? wn.substring(xfAt, xfEnd) : '';
  check('the XR release note is the newest entry and carries NO money amount', xfAt > 0 && xfAt < wn.indexOf("version: 'v55.83-WD'") && xfText.length > 200 && !/\$\s?[0-9]/.test(xfText) && !/[0-9][0-9,]{3,}\.[0-9]{2}/.test(xfText));
  var pg = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
  check('badge = v55.83-XR', pg.indexOf('v55.83-XR') > 0 && pg.indexOf('v55.83-WD') < 0);

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
