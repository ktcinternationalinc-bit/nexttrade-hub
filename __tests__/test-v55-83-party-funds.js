// ═══════════════════════════════════════════════════════════════════════════
// FUNDS WITH RTM / NEXTTRADE — the one calculation (Max, 20 Nov 2026; Codex 12:36 and the PRIORITY section).
// RUN, not grep. Every amount below is an ILLUSTRATIVE fixture (Max's 66,000 / 52,000 / 2,000 / 12,000 and 10,000 examples) —
// none is a real record and none is hard-coded in the application.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var F = require(path.join(root, 'src/lib/party-funds.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('Funds with RTM / NextTrade — one calculation');

var parties = [{ name: 'NextTrade Industries' }, { name: 'RTM Capital' }];
function line(id, date, amount, who) { return { id: id, date: date, amount_abs: amount, third_party_payer: who, direction: 'out', name: 'WIRE ' + id }; }
function bill(id, vendor, cat, total, date, rel) { return { id: id, vendor_name: vendor, bill_number: 'B-' + id, bill_date: date, category: cat, total_amount: total, release_number: rel || null }; }
function pay(id, billId, amount, txn, date) { return { id: id, bill_id: billId, amount: amount, bank_transaction_id: txn, paid_date: date, voided: false }; }
function fee(id, party, amount, txn, date, kind) { return { id: id, party: party, bucket: 'fee', kind: kind || 'fee_from_transfer', amount: amount, source_bank_transaction_id: txn, entry_date: date }; }
function of(res, name) { return res.filter(function (x) { return x.party === name; })[0]; }

// ── Max's pop-up example: 66,000 sent = 52,000 to bills + 2,000 explicit services + 12,000 unused ──
var bills = [bill('b1', 'Kronos', 'trucking', 30000, '2026-06-05', '1002-1100'), bill('b2', 'Warehouse Rent Co', 'rent', 20000, '2026-06-01'), bill('b3', 'AMB', 'trucking', 5000, '2026-06-20', '1002-1101')];
var A = { parties: parties, bills: bills, from: '2026-06-01', to: '2026-06-30',
  bankLines: [line('T1', '2026-06-03', 40000, 'NextTrade Industries'), line('T2', '2026-06-18', 26000, 'NextTrade Industries'), line('R1', '2026-06-10', 9000, 'RTM Capital'), line('X', '2026-06-11', 7777, null)],
  pays: [pay('p1', 'b1', 30000, 'T1', '2026-06-06'), pay('p2', 'b2', 10000, 'T1', '2026-06-07'), pay('p3', 'b2', 10000, 'T2', '2026-06-19'), pay('p4', 'b3', 2000, 'T2', '2026-06-21')],
  entries: [fee('f1', 'NextTrade Industries', 2000, 'T2', '2026-06-25')], requests: [] };
var a = F.partyFundsBreakdown(A); var nt = of(a, 'NextTrade Industries'); var rtm = of(a, 'RTM Capital');
check('funds sent 66,000 = applied to bills 52,000 + explicit services 2,000 + unused 12,000', nt.period.funds_sent === 66000 && nt.period.applied_to_bills === 52000 && nt.period.services_rendered === 2000 && nt.as_of.unused === 12000 && nt.reconciles, nt.period);
check('ONLY the explicit 2,000 is deducted as a professional fee — not 66,000, not 14,000', nt.period.fee_deduction === 2000);
check('clicking the 52,000: the allocated PORTIONS add up to exactly 52,000', nt.period.applied_rows.length === 4 && Math.round(nt.period.applied_rows.reduce(function (s, r) { return s + r.portion; }, 0) * 100) === 5200000);
var rowB2 = nt.period.applied_rows.filter(function (r) { return r.bill_id === 'b2'; });
check('one bill funded by two transfers: two portions (10,000 + 10,000), each naming its own source transfer and the full bill amount', rowB2.length === 2 && rowB2[0].transfer_id === 'T1' && rowB2[1].transfer_id === 'T2' && rowB2[0].portion === 10000 && rowB2[0].bill_total === 20000);
var rowB3 = nt.period.applied_rows.filter(function (r) { return r.bill_id === 'b3'; })[0];
check('a partially funded bill shows the PORTION (2,000), not the whole bill (5,000)', rowB3.portion === 2000 && rowB3.bill_total === 5000);
check('each row says where the cost is counted internally (its own category and month) and carries vendor, bill #, date, release #', rowB3.counted_in.category === 'trucking' && rowB3.counted_in.month === '2026-06' && rowB3.vendor === 'AMB' && rowB3.bill_number === 'B-b3' && rowB3.release_number === '1002-1101');
check('per transfer: T1 sent 40,000 → bills 40,000, unused 0; T2 sent 26,000 → bills 12,000, fee 2,000, unused 12,000', nt.transfers[0].applied_to_bills === 40000 && nt.transfers[0].unused === 0 && nt.transfers[1].applied_to_bills === 12000 && nt.transfers[1].services_rendered === 2000 && nt.transfers[1].unused === 12000, nt.transfers);
check('tax presentation: the full original 66,000, once', nt.period.tax_professional_fees === 66000);
check('RTM is separate: its own 9,000, nothing applied, no fee, all unused — and deduction 0 while funding exists', rtm.period.funds_sent === 9000 && rtm.period.fee_deduction === 0 && rtm.as_of.unused === 9000 && rtm.transfers.length === 1 && rtm.reconciles);
check('a bank line not marked for a company is in nobody\'s funds', nt.transfers.concat(rtm.transfers).every(function (t) { return t.id !== 'X'; }));
check('the pop-up sentence is built from the computed amounts', F.feeExplanation(nt.period) === 'Only $2,000.00 is deducted here as a professional fee. The $52,000.00 allocated to underlying bills is not deducted again here; those costs are accounted for separately in their proper categories. The unused $12,000.00 does not reduce internal profit.', F.feeExplanation(nt.period));

// reclassify the remaining 12,000 as services → fee component 14,000 (never 66,000); tax still 66,000; reverse it → 2,000 again
var A2 = Object.assign({}, A, { entries: A.entries.concat([fee('f2', 'NextTrade Industries', 12000, 'T2', '2026-06-28')]) });
var nt2 = of(F.partyFundsBreakdown(A2), 'NextTrade Industries');
check('reclassify the unused 12,000 as services rendered → deduction 14,000, unused 0, tax still 66,000', nt2.period.fee_deduction === 14000 && nt2.as_of.unused === 0 && nt2.period.tax_professional_fees === 66000 && nt2.reconciles, nt2.period);
var A3 = Object.assign({}, A2, { entries: A2.entries.concat([fee('f3', 'NextTrade Industries', -12000, 'T2', '2026-06-29', 'fee_back_to_transfer')]) });
var nt3 = of(F.partyFundsBreakdown(A3), 'NextTrade Industries');
check('reverse that classification → deduction 2,000, unused 12,000 again; transfers and bill portions untouched', nt3.period.fee_deduction === 2000 && nt3.as_of.unused === 12000 && nt3.period.applied_to_bills === 52000 && nt3.period.funds_sent === 66000);
check('a fee dated in a LATER month is deducted in that month, not this one', (function () { var x = Object.assign({}, A, { entries: [fee('f9', 'NextTrade Industries', 2000, 'T2', '2026-07-02')] }); var j = of(F.partyFundsBreakdown(x), 'NextTrade Industries'); var k = of(F.partyFundsBreakdown(Object.assign({}, x, { from: '2026-07-01', to: '2026-07-31' })), 'NextTrade Industries'); return j.period.fee_deduction === 0 && j.as_of.unused === 14000 && k.period.fee_deduction === 2000 && k.period.funds_sent === 0; })());

// ── zero explicit fees ──
var Z = of(F.partyFundsBreakdown(Object.assign({}, A, { entries: [] })), 'NextTrade Industries');
check('no explicit fee → deduction 0; the 14,000 not used is unused, never a fee', Z.period.fee_deduction === 0 && Z.as_of.unused === 14000 && Z.reconciles);
var none = of(F.partyFundsBreakdown(Object.assign({}, A, { entries: [], pays: [] })), 'NextTrade Industries');
check('no linked bills at all does NOT mean professional fee: 66,000 unused, deduction 0', none.period.fee_deduction === 0 && none.as_of.unused === 66000 && none.period.applied_to_bills === 0);

// ── Max's 10,000 walk-through, across months (Codex 12:36 item 3) ──
var B = { parties: parties, bills: [bill('c1', 'V1', 'trucking', 6000, '2026-09-10'), bill('c2', 'V2', 'utilities', 1200, '2026-10-12')],
  bankLines: [line('N1', '2026-09-02', 10000, 'NextTrade Industries'), line('R9', '2026-09-03', 4000, 'RTM Capital')],
  pays: [pay('q1', 'c1', 6000, 'N1', '2026-09-11'), pay('q2', 'c2', 1200, 'N1', '2026-10-15')],
  entries: [fee('g1', 'NextTrade Industries', 500, 'N1', '2026-09-20'), fee('g2', 'NextTrade Industries', 300, 'N1', '2026-11-03'), fee('g3', 'NextTrade Industries', -300, 'N1', '2026-11-04', 'fee_back_to_transfer')], requests: [] };
function run(from, to) { return of(F.partyFundsBreakdown(Object.assign({}, B, { from: from, to: to })), 'NextTrade Industries'); }
var sep = run('2026-09-01', '2026-09-30'); var oct = run('2026-10-01', '2026-10-31'); var nov3 = run('2026-11-01', '2026-11-03'); var nov = run('2026-11-01', '2026-11-30');
check('September: 10,000 sent, 6,000 to bills, 500 explicit fee, 3,500 held; tax 10,000; internal fee 500', sep.period.funds_sent === 10000 && sep.period.applied_to_bills === 6000 && sep.period.fee_deduction === 500 && sep.period.closing_held === 3500 && sep.as_of.unused === 3500 && sep.period.tax_professional_fees === 10000, sep.period);
check('October roll-forward: opening 3,500 + new funding 0 − bills 1,200 − fees 0 = closing 2,300', oct.period.opening_held === 3500 && oct.period.funds_sent === 0 && oct.period.applied_to_bills === 1200 && oct.period.fee_deduction === 0 && oct.period.closing_held === 2300 && oct.as_of.unused === 2300 && oct.reconciles, oct.period);
check('October: paying the 1,200 bill from held funds is NO new tax deduction and NO professional fee', oct.period.tax_professional_fees === 0 && oct.period.fee_deduction === 0);
check('October: the 1,200 portion links back to the ORIGINAL September transfer', oct.period.applied_rows.length === 1 && oct.period.applied_rows[0].transfer_id === 'N1' && oct.period.applied_rows[0].transfer_date === '2026-09-02');
check('after reclassifying 300: available 2,000, fees 800 (all time)', nov3.as_of.unused === 2000 && nov3.as_of.services_rendered === 800);
check('after reversing it: available 2,300, fees 500 — and November\'s net fee deduction is 0', nov.as_of.unused === 2300 && nov.as_of.services_rendered === 500 && nov.period.fee_deduction === 0 && nov.period.closing_held === 2300);
check('RTM\'s balance is unaffected by all of it', of(F.partyFundsBreakdown(Object.assign({}, B, { from: '2026-11-01', to: '2026-11-30' })), 'RTM Capital').as_of.unused === 4000);
check('all time (no dates): original transfer 10,000 = bills 7,200 + fees 500 + unused 2,300', (function () { var x = run(null, null); return x.as_of.funds_sent === 10000 && x.as_of.applied_to_bills === 7200 && x.as_of.services_rendered === 500 && x.as_of.unused === 2300 && x.reconciles; })());

// ── reservations: the whole commitment (bills + fee) of a request not sent yet; a sent request's fee is an explicit fee, once ──
var C = { parties: parties, bills: [bill('d1', 'V', 'trucking', 900, '2026-12-01')], bankLines: [line('K1', '2026-12-01', 1000, 'NextTrade Industries')], pays: [], entries: [],
  requests: [{ id: 'w1', status: 'draft', funding_txn_id: 'K1', fee_amount: 100, lines: [{ bill_id: 'd1', amount: 900, is_open: true }] }] };
var c1 = of(F.partyFundsBreakdown(C), 'NextTrade Industries');
check('a draft request of 900 bills + 100 fee on a 1,000 transfer reserves ALL 1,000: unused 0', c1.as_of.reserved === 1000 && c1.as_of.unused === 0 && c1.transfers[0].reserved === 1000);
check('a reservation is not a payment and not an expense', c1.as_of.applied_to_bills === 0 && c1.period.fee_deduction === 0 && c1.as_of.held === 1000);
var C2 = Object.assign({}, C, { pays: [pay('z1', 'd1', 900, 'K1', '2026-12-05')], requests: [{ id: 'w1', status: 'attached', funding_txn_id: 'K1', bank_transaction_id: 'K1', fee_amount: 100, sent_date: '2026-12-05', lines: [{ bill_id: 'd1', amount: 900, is_open: false }] }] });
var c2 = of(F.partyFundsBreakdown(C2), 'NextTrade Industries');
check('once sent: 900 to bills, the 100 fee is an explicit fee counted ONCE, nothing reserved, unused 0', c2.as_of.applied_to_bills === 900 && c2.as_of.services_rendered === 100 && c2.as_of.reserved === 0 && c2.as_of.unused === 0 && c2.fee_rows.length === 1);
check('cancelled / reversed requests reserve nothing', of(F.partyFundsBreakdown(Object.assign({}, C, { requests: [{ id: 'w1', status: 'cancelled', funding_txn_id: 'K1', fee_amount: 100, lines: [{ bill_id: 'd1', amount: 900, is_open: true }] }, { id: 'w2', status: 'reversed', funding_txn_id: 'K1', fee_amount: 5, lines: [] }] })), 'NextTrade Industries').as_of.unused === 1000);
check('a voided payment is not an allocation', of(F.partyFundsBreakdown(Object.assign({}, C, { requests: [], pays: [Object.assign(pay('z2', 'd1', 900, 'K1', '2026-12-05'), { voided: true })] })), 'NextTrade Industries').as_of.unused === 1000);
var over = of(F.partyFundsBreakdown(Object.assign({}, C, { requests: [], pays: [pay('z3', 'd1', 1200, 'K1', '2026-12-05')] })), 'NextTrade Industries');
check('records that disagree (more used than sent) are SHOWN as a negative, never hidden or clamped', over.as_of.unused === -200 && /needs reconciliation/.test(F.feeExplanation(over.period)));
check('a fee entry with no source transfer is reported apart (fees_without_a_transfer)', of(F.partyFundsBreakdown(Object.assign({}, C, { requests: [], entries: [{ id: 'u1', party: 'NextTrade Industries', bucket: 'fee', kind: 'advance_to_fee', amount: 50, entry_date: '2026-12-02' }] })), 'NextTrade Industries').fees_without_a_transfer === 50);
check('an advance-bucket entry is never a fee', of(F.partyFundsBreakdown(Object.assign({}, C, { requests: [], entries: [{ id: 'u2', party: 'NextTrade Industries', bucket: 'advance', kind: 'payment_split', amount: 400, bank_transaction_id: 'K1', entry_date: '2026-12-02' }] })), 'NextTrade Industries').period.fee_deduction === 0);
check('nothing given → empty, no crash', F.partyFundsBreakdown({}).length === 0 && F.partyFundsBreakdown({ parties: parties })[0].as_of.unused === 0);

var src = fs.readFileSync(path.join(root, 'src/lib/party-funds.js'), 'utf8');
check('no example amount is hard-coded in the application code', !/66000|52000|12000|10000|66,000|52,000/.test(src));
check('the helper is pure: no database, no fetch, no supabase import', !/supabase|fetch\(|\.from\(|rpc\(/.test(src));

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
