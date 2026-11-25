// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SR — Max, Nov 15 2026:
//   "RTM funding line, this is one professional fee line. It should work the same way as the next trade funding line."
//   "the whole transfer is one professional fee with the bills listed underneath … the breakdown of that underneath in the PL
//    will go under uncategorized … this will be a specific service fee"
//   "anything unused will be kept as for bills that we haven't yet paid, but they're bills, so they remain as professional fees."
//   NextTrade follows RTM from now on; older entries stay as booked.
//   "Do not introduce new accounting treatment or change when bills are considered paid or expenses appear in reports" —
//   so the totals are compared BEFORE and AFTER here, not assumed.
// The breakdown helper and the P&L / Books home reports are RUN. The ledger side is run on Postgres 16:
// clickbooks/tests/sr-provider-from/01_scen.sql (R0–R9). Checks marked (pin) only read the source.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var PT = require(path.join(root, 'src/lib/paid-through-blocks.js'));
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 800))); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function sum(a, f) { return r2((a || []).reduce(function (s, x) { return s + (Number(f(x)) || 0); }, 0)); }

// the calculation exactly as it was written inside the report before this build (v55.83-SQ), kept here to compare against
function oldBlocks(parties, lines, pays, billById, from, to) {
  var out = [];
  parties.forEach(function (party) {
    var pk = String(party.name).trim().toLowerCase(); var payT = 0, payN = 0, allocT = 0;
    lines.forEach(function (t) { if (String(t.payer || '').trim().toLowerCase() !== pk) { return; } if (!(t.date >= from && t.date <= to)) { return; } payT = r2(payT + r2(t.amount)); payN++; });
    pays.forEach(function (p) { if (p.method !== 'rtm' || p.voided === true) { return; } if (!(p.paid_date >= from && p.paid_date <= to)) { return; } var b = billById[p.bill_id]; if (!b || String(b.paid_via || 'RTM Capital').trim().toLowerCase() !== pk) { return; } allocT = r2(allocT + r2(p.amount)); });
    if (payN > 0 || allocT > 0) { out.push({ payer: party.name, kind: party.kind, payments_total: payT, payments_count: payN, allocations_total: allocT, service_fee: r2(payT - allocT) }); }
  });
  return out;
}
var RTM = { name: 'RTM Capital', kind: 'service_provider', remainder_label: 'RTM service fee (payments − covered bills)' };
var NT = { name: 'NextTrade Industries', kind: 'affiliate', remainder_label: 'Advance with NextTrade — awaiting its costs (not an expense yet)' };
var lines = [
  { id: 'r1', date: '2026-10-20', amount: 30000, classification: 'prof_fees', payer: 'RTM Capital' }, { id: 'r2', date: '2026-11-16', amount: 50000, classification: 'prof_fees', payer: 'RTM Capital' },
  { id: 'n1', date: '2026-11-05', amount: 10000, classification: null, payer: 'NextTrade Industries' }, { id: 'n2', date: '2026-11-16', amount: 6000, classification: 'prof_fees', payer: 'NextTrade Industries' }];
var billById = { b1: { vendor_name: 'A', bill_number: '1', category: 'cogs_goods', paid_via: 'RTM Capital' }, b2: { vendor_name: 'B', bill_number: '2', category: 'freight', paid_via: 'RTM Capital' },
  b3: { vendor_name: 'C', bill_number: '3', category: 'cogs_goods', paid_via: 'NextTrade Industries' }, b4: { vendor_name: 'D', bill_number: '4', category: 'freight', paid_via: 'NextTrade Industries' } };
var pays = [{ bill_id: 'b1', amount: 26000, paid_date: '2026-10-20', bank_transaction_id: 'r1', method: 'rtm' }, { bill_id: 'b2', amount: 38000, paid_date: '2026-11-16', bank_transaction_id: 'r2', method: 'rtm' },
  { bill_id: 'b3', amount: 7000, paid_date: '2026-11-05', bank_transaction_id: 'n1', method: 'rtm' }, { bill_id: 'b4', amount: 4000, paid_date: '2026-11-16', bank_transaction_id: 'n2', method: 'rtm' },
  { bill_id: 'b4', amount: 999, paid_date: '2026-11-16', bank_transaction_id: 'n2', method: 'rtm', voided: true }];
var reqs = [{ bank_transaction_id: 'r2', fee_amount: 1300, status: 'attached', funding_txn_id: 'r2' }, { bank_transaction_id: 'n2', fee_amount: 250, status: 'attached', funding_txn_id: 'n2' },
  { bank_transaction_id: 'r2', fee_amount: 777, status: 'reversed', funding_txn_id: 'r2' }, { bank_transaction_id: 'r1', fee_amount: 55, status: 'attached', funding_txn_id: null }];
var args = function (parties) { return { parties: parties, lines: lines, pays: pays, billById: billById, requests: reqs, from: '2026-10-01', to: '2026-11-30' }; };

console.log('SR — A. before the SQL is run (no date on the companies): the report is what it was');
var oldB = oldBlocks([RTM, NT], lines, pays, billById, '2026-10-01', '2026-11-30');
var nowB = PT.buildPaidThroughBlocks(args([RTM, NT]));
check('A1: same companies, same payments, same covered bills, same remainder — to the cent', nowB.length === oldB.length && nowB.every(function (b, i) { var o = oldB[i]; return b.payer === o.payer && b.kind === o.kind && b.payments_total === o.payments_total && b.payments_count === o.payments_count && b.allocations_total === o.allocations_total && b.service_fee === o.service_fee; }), { nowB: nowB.map(function (b) { return [b.payer, b.kind, b.payments_total, b.allocations_total, b.service_fee]; }), oldB: oldB });
var rowsA = nowB.map(function (b) { return PT.remainderRows(b); });
check('A2: and the remainder is still ONE row per company with its own label and kind (RTM: fee, an expense; NextTrade: advance, not P&L)', rowsA[0].length === 1 && rowsA[0][0].key === '__pt_rtm_capital' && rowsA[0][0].kind === 'expense' && rowsA[0][0].total === 16000 && /RTM service fee/.test(rowsA[0][0].label) && rowsA[1].length === 1 && rowsA[1][0].key === '__pt_nexttrade_industries' && rowsA[1][0].kind === 'not_pnl' && rowsA[1][0].total === 5000 && /Advance with NextTrade/.test(rowsA[1][0].label), rowsA);

console.log('SR — B. with the date set (Nov 15): older entries as booked, newer ones broken down');
var RTM2 = Object.assign({}, RTM, { provider_from: '2026-11-15' }), NT2 = Object.assign({}, NT, { provider_from: '2026-11-15' });
var B = PT.buildPaidThroughBlocks(args([RTM2, NT2]));
var by = {}; B.forEach(function (b) { by[b.key] = b; });
check('B1: RTM stays ONE block (it was always a provider); NextTrade has a "before" block and a "from Nov 15" block', B.length === 3 && by['RTM Capital'] && by['NextTrade Industries|before'] && by['NextTrade Industries'] && by['NextTrade Industries|before'].era_note === 'before 2026-11-15' && by['NextTrade Industries'].era_note === 'from 2026-11-15', Object.keys(by));
check('B2: NextTrade before Nov 15 — still an ADVANCE: $10,000 sent, $7,000 of bills, $3,000 not yet linked (not P&L)', by['NextTrade Industries|before'].kind === 'affiliate' && by['NextTrade Industries|before'].payments_total === 10000 && by['NextTrade Industries|before'].allocations_total === 7000 && PT.remainderRows(by['NextTrade Industries|before']).length === 1 && PT.remainderRows(by['NextTrade Industries|before'])[0].kind === 'not_pnl' && PT.remainderRows(by['NextTrade Industries|before'])[0].total === 3000, by['NextTrade Industries|before']);
var nNew = by['NextTrade Industries']; var nRows = PT.remainderRows(nNew);
check('B3: NextTrade from Nov 15 — like RTM: $6,000 = bills $4,000 + service fee $250 + waiting for bills $1,750 (all expense; a voided payment is ignored)', nNew.kind === 'service_provider' && nNew.payments_total === 6000 && nNew.allocations_total === 4000 && nNew.fees_booked === 250 && nNew.waiting === 1750 && nNew.remainder_other === 0 && nRows.length === 2 && nRows.every(function (r) { return r.kind === 'expense'; }) && sum(nRows, function (r) { return r.total; }) === 2000, { nNew: nNew, nRows: nRows });
var rB = by['RTM Capital']; var rRows = PT.remainderRows(rB);
check('B4: RTM — the Oct line keeps its old "service fee (payments − covered bills)" $4,000; the Nov 16 line is bills $38,000 + service fee $1,300 + waiting $10,700', rB.payments_total === 80000 && rB.allocations_total === 64000 && rB.service_fee === 16000 && rB.fees_booked === 1300 && rB.waiting === 10700 && rB.remainder_other === 4000 && rRows.length === 3 && rRows[0].total === 4000 && /payments − covered bills/.test(rRows[0].label) && rRows[1].total === 1300 && /service fee \(on requests\)/.test(rRows[1].label) && rRows[2].total === 10700 && /waiting for bills/.test(rRows[2].label), { rB: rB, rRows: rRows });
check('B5: a fee on a reversed request, or on an ordinary (not request) wire, is never counted', rB.fees_booked === 1300);
check('B6: every block adds up: payments = covered bills + the remainder rows', B.every(function (b) { return r2(b.allocations_total + sum(PT.remainderRows(b), function (r) { return r.total; })) === b.payments_total; }));
check('B7: the money did not move between companies or periods: totals per company equal the old calculation', ['RTM Capital', 'NextTrade Industries'].every(function (n) { var o = oldB.filter(function (x) { return x.payer === n; })[0]; var mine = B.filter(function (x) { return x.payer === n; }); return sum(mine, function (x) { return x.payments_total; }) === o.payments_total && sum(mine, function (x) { return x.allocations_total; }) === o.allocations_total && sum(mine, function (x) { return x.service_fee; }) === o.service_fee; }));
check('B8: the first day counts — a line dated Nov 15 is "from"; Nov 14 is "before"', PT.eraOf(NT2, '2026-11-15') === 'provider' && PT.eraOf(NT2, '2026-11-14') === 'advance' && PT.eraOf(NT, '2027-01-01') === 'advance' && PT.eraOf(RTM, '2020-01-01') === 'provider' && PT.isSplitLine(RTM2, '2026-11-14') === false && PT.isSplitLine(RTM2, '2026-11-15') === true);

// ── the reports, run on an in-memory database: totals BEFORE and AFTER a request is sent
function id(n) { return 'c7700000-0000-0000-0000-' + String(n).padStart(12, '0'); }
var TN = 'c7800000-0000-0000-0000-000000000001';
function bt(i, date, amt, dir, name, x) { return Object.assign({ id: i, date: date, posted_date: date, amount_abs: amt, direction: dir, pending: false, wave_business_id: US, review_status: 'reviewed', name: name, merchant_name: null, third_party_payer: null, transfer_group_id: null, classification: null, iso_currency: 'USD' }, x || {}); }
function nb(n, vendor, no, amt, cat) { return { id: id(n), vendor_name: vendor, bill_number: no, bill_date: '2026-11-10', due_date: '2026-11-20', total_amount: amt, currency: 'USD', category: cat, record_status: 'active', validation_status: 'validated', bill_type: 'supplier', shipment_direction: 'inbound', other_reference: 'REF-' + no, paid_via: 'NextTrade Industries' }; }
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }],
  module_permissions: [].concat(['accounting.clickbooks.access', 'accounting.view_totals', 'accounting.change_dates', 'pnl.view' /* v55.83-ZD: spending figures need P&L access */, 'wires.prepare', 'wires.signoff', 'wires.send', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [nb(1, 'Vendor N', 'N-1', 3000, 'cogs_goods'), nb(2, 'Vendor M', 'M-1', 1000, 'freight')],
  vendor_bill_lines: [], vendor_bill_payments: [], vendor_bill_events: [], hub_audit_log: [],
  wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], wire_bill_reviews: [], expense_rules: [],
  paid_through_parties: [Object.assign({ active: true, sort: 10 }, RTM2), Object.assign({ active: true, sort: 20 }, NT2)],
  bank_transactions: [bt(TN, '2026-11-16', 6000, 'out', 'ONLINE TRANSFER TO NEXTTRADE 2061', { third_party_payer: 'NextTrade Industries', classification: 'prof_fees' }),
    bt('c7800000-0000-0000-0000-000000000002', '2026-11-16', 250, 'out', 'OFFICE SUPPLIES', { classification: 'office' }), bt('c7800000-0000-0000-0000-000000000003', '2026-11-16', 900, 'in', 'CUSTOMER DEPOSIT')],
  expense_categories: [{ key: 'cogs_goods', label: 'Cost of goods', active: true, kind: 'cogs' }, { key: 'freight', label: 'Freight', active: true, kind: 'expense' }, { key: 'prof_fees', label: 'Professional fees', active: true, kind: 'expense' }, { key: 'office', label: 'Office', active: true, kind: 'expense' }],
  bill_commission_rules: [], bill_price_rules: [], invoices: [], customer_deposits: [], hub_settings: [],
});
db.rpcs = { wire_request_send: function (a) { // stand-in; the real function runs on Postgres (clickbooks/tests/sp-funded-requests)
  var p = db.t.wire_packages.filter(function (x) { return x.id === a.p_pkg; })[0]; var t = db.t.bank_transactions.filter(function (x) { return x.id === p.funding_txn_id; })[0];
  var ls = db.t.wire_package_lines.filter(function (l) { return l.package_id === p.id; }); var bills = r2(ls.reduce(function (s, l) { return s + Number(l.amount); }, 0)); var tot = r2(bills + (Number(p.fee_amount) || 0));
  ls.forEach(function (l, i) { var pid = 'pay-' + i; db.t.vendor_bill_payments.push({ id: pid, bill_id: l.bill_id, amount: Number(l.amount), paid_date: t.posted_date, method: 'rtm', bank_transaction_id: t.id, voided: false, created_at: '2026-11-16T10:00:00Z' }); l.payment_id = pid; l.is_open = false; });
  p.status = 'attached'; p.sent_by = a.p_actor; p.sent_date = a.p_sent_date; p.approved_total = tot; p.bank_transaction_id = t.id; p.bank_reference = 'request to ' + p.payee_name;
  return { ok: true, bills_paid: ls.length, bills_total: bills, fee: r2(p.fee_amount), total: tot, paid_date: t.posted_date, transfer_amount: r2(t.amount_abs), remaining_after: r2(Number(t.amount_abs) - tot) }; } };
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
global.__db = db;
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var wires = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
async function call(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
async function approve(wid) {
  var g = await call(wires, 'u1', { action: 'get', id: wid });
  for (var i = 0; i < g.lines.length; i++) { await call(wires, 'u1', { action: 'review_bill', id: wid, bill_id: g.lines[i].bill_id }); await call(wires, 'u2', { action: 'review_bill', id: wid, bill_id: g.lines[i].bill_id }); }
  var s1 = await call(wires, 'u1', { action: 'signoff', id: wid, note: 'checked every bill against the orders' }); var s2 = await call(wires, 'u2', { action: 'signoff', id: wid, note: 'second check — matches' });
  return s1.ok && s2.ok && s2.approved;
}
function snap(ps, cf) { var sp = ps.spending || {}; var cats = {}; (sp.categories || []).forEach(function (c) { cats[c.key] = c.total; });
  return { total_out: sp.total_out, real_spending: sp.real_spending, deductible: sp.deductible_spending, cats: cats, uncategorized: sp.uncategorized && sp.uncategorized.total, transfers: sp.transfers && sp.transfers.total, went_out: cf.summary.actual_out, came_in: cf.summary.actual_in, bills_paid: ps.bills.paid }; }
var TODAY = new Date().toISOString().substring(0, 10);

(async function () {
  console.log('SR — C. the reports before and after a request to NextTrade is sent (the same money, only listed underneath)');
  var ps0 = await call(bills, 'u1', { action: 'period_stats', from: '2026-11-01', to: '2026-11-30' }); var cf0 = await call(bills, 'u1', { action: 'cashflow', from: '2026-11-01', to: '2026-11-30' });
  var S0 = snap(ps0, cf0);
  var blk0 = (ps0.spending.paid_through || []).filter(function (b) { return b.payer === 'NextTrade Industries'; })[0];
  check('C1: before — the $6,000 transfer is ONE professional-fees line, an expense; all of it is waiting for bills', S0.cats.prof_fees === 6000 && S0.total_out === 6250 && blk0 && blk0.kind === 'service_provider' && blk0.waiting === 6000 && blk0.allocations_total === 0, { S0: S0, blk0: blk0 });
  var s1 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: 'NextTrade Industries', funding_txn_id: TN, fee_amount: 250, lines: [{ bill_id: id(1), amount: 3000 }, { bill_id: id(2), amount: 1000 }] });
  var ok = await approve(s1.id); var sent = await call(wires, 'u1', { action: 'mark_sent', id: s1.id, sent_date: TODAY });
  var ps1 = await call(bills, 'u1', { action: 'period_stats', from: '2026-11-01', to: '2026-11-30' }); var cf1 = await call(bills, 'u1', { action: 'cashflow', from: '2026-11-01', to: '2026-11-30' });
  var S1 = snap(ps1, cf1);
  check('C2: the request went through (two signatures, sent)', s1.ok && ok && sent.ok && sent.bills_paid === 2, sent);
  check('C3: AFTER — money out, spending, deductible spending, every category total, transfers and money in are IDENTICAL', S1.total_out === S0.total_out && S1.real_spending === S0.real_spending && S1.deductible === S0.deductible && JSON.stringify(S1.cats) === JSON.stringify(S0.cats) && S1.uncategorized === S0.uncategorized && S1.transfers === S0.transfers && S1.went_out === S0.went_out && S1.came_in === S0.came_in, { S0: S0, S1: S1 });
  check('C4: the only thing that moved is "bills paid": $0 → $4,000 (the two bills are now recorded paid)', S0.bills_paid === 0 && S1.bills_paid === 4000, { b0: S0.bills_paid, b1: S1.bills_paid });
  var blk1 = (ps1.spending.paid_through || []).filter(function (b) { return b.payer === 'NextTrade Industries'; })[0];
  var rows1 = PT.remainderRows(blk1);
  check('C5: underneath the one line: bills $4,000 (cost of goods $3,000, freight $1,000) + service fee $250 + waiting for bills $1,750 = $6,000', blk1.payments_total === 6000 && blk1.allocations_total === 4000 && blk1.fees_booked === 250 && blk1.waiting === 1750 && blk1.allocations_by_cat.length === 2 && r2(blk1.allocations_total + sum(rows1, function (r) { return r.total; })) === 6000 && rows1.every(function (r) { return r.kind === 'expense'; }), { blk1: blk1, rows1: rows1 });

  console.log('SR — D. the database script, the screen and the build');
  var sql = R('sql/v55-83-SR-provider-from.sql');
  check('D1 (pin): the script adds the date, sets it only where empty, and never edits a posted entry', /ADD COLUMN IF NOT EXISTS provider_from date/.test(sql) && /WHERE provider_from IS NULL/.test(sql) && !/\b(update|delete)\s+(from\s+)?clickbooks_us\.journal/i.test(sql) && /DATE '2026-11-15'/.test(sql));
  check('D2 (pin): the ledger functions are changed in place only if they look exactly as expected — otherwise it stops with nothing changed', /pg_get_functiondef/.test(sql) && /nothing was changed/.test(sql) && /have_old = want AND have_new = 0/.test(sql) && /have_old = 0 AND have_new = want/.test(sql) && /RAISE EXCEPTION/.test(sql));
  check('D3 (pin): bank lines are judged by their own date, bill payments by the payment date, bills on the books by the bill date', /coalesce\(t\.posted_date, t\.date\)\)/.test(sql) && /'RTM Capital''\), v\.paid_date\)/.test(sql) && /bl\.paid_via, bl\.bill_date\)/.test(sql));
  check('D4 (pin): the Postgres run is kept with the build', fs.existsSync(path.join(root, 'clickbooks/tests/sr-provider-from/01_scen.sql')) && fs.existsSync(path.join(root, 'clickbooks/tests/sr-provider-from/README.md')));
  var route = R('src/app/api/accounting/bills/route.js');
  check('D5 (pin): if the script is not run yet the report falls back to exactly the old company list', /SR SQL not run yet → exactly as before/.test(route) && /buildPaidThroughBlocks\(\{ parties: partiesP,/.test(route));
  var libSrc = R('src/lib/paid-through-blocks.js');
  var newCode = route.split('\n').filter(function (l) { return /v55\.83-SR|ptLines|ptReqs|ptIds|buildPaidThroughBlocks/.test(l); }).join('\n');
  check('D6 (pin): new server code keeps the house rules — var only, no template strings', !/\b(let|const)\s/.test(newCode) && newCode.indexOf('`') < 0 && !/\b(let|const)\s/.test(libSrc) && libSrc.indexOf('`') < 0);
  var ps = R('src/components/PeriodStatsTab.jsx');
  check('D7 (pin): the P&L switch is per block and shows bills · service fee · waiting for bills', /var bk = b\.key \|\| b\.payer;/.test(ps) && /remainderRows\(rtm\)\.forEach/.test(ps) && /waiting for bills \$/.test(ps) && /one professional-fees line/.test(ps));
  var wn = R('src/components/WhatsNewWidget.jsx');
  check('D8 (pin): What’s New has v55.83-SR in plain words with one technical line', /version: 'v55\.83-SR'/.test(wn) && /superAdminOnly: true/.test(wn.substring(wn.indexOf("version: 'v55.83-SR'"), wn.indexOf("version: 'v55.83-SQ'"))));
  check('D9 (pin): the build badge is at v55.83-SR or later (v55.83-SS realign)', />v55\.83-(?:S[R-Z]|[T-Z][A-Z])<\/span>/.test(R('src/app/page.jsx')));
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
// v55.83-UB realign: badge letters now run past T (UA, UB …) — the badge checks accept T–Z
