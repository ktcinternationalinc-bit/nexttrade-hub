// ═══════════════════════════════════════════════════════════════════════════
// FUNDS WITH RTM / NEXTTRADE — the one calculation (Max, 20 Nov 2026; Codex 12:36, the PRIORITY section, and 13:02).
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
function total(rows, f) { return Math.round((rows || []).reduce(function (s, r) { return s + r[f]; }, 0) * 100) / 100; }
function ok(x) { return x.arithmetic_ok === true && x.needs_reconciliation === false; }

// ── Max's pop-up example: 66,000 sent = 52,000 to bills + 2,000 explicit services + 12,000 unused ──
var bills = [bill('b1', 'Kronos', 'trucking', 30000, '2026-06-05', '1002-1100'), bill('b2', 'Warehouse Rent Co', 'rent', 20000, '2026-06-01'), bill('b3', 'AMB', 'trucking', 5000, '2026-06-20', '1002-1101')];
var A = { parties: parties, bills: bills, from: '2026-06-01', to: '2026-06-30',
  bankLines: [line('T1', '2026-06-03', 40000, 'NextTrade Industries'), line('T2', '2026-06-18', 26000, 'NextTrade Industries'), line('R1', '2026-06-10', 9000, 'RTM Capital'), line('X', '2026-06-11', 7777, null)],
  pays: [pay('p1', 'b1', 30000, 'T1', '2026-06-06'), pay('p2', 'b2', 10000, 'T1', '2026-06-07'), pay('p3', 'b2', 10000, 'T2', '2026-06-19'), pay('p4', 'b3', 2000, 'T2', '2026-06-21')],
  entries: [fee('f1', 'NextTrade Industries', 2000, 'T2', '2026-06-25')], requests: [] };
var a = F.partyFundsBreakdown(A); var nt = of(a, 'NextTrade Industries'); var rtm = of(a, 'RTM Capital');
check('funds sent 66,000 = applied to bills 52,000 + explicit services 2,000 + still held 12,000', nt.period.funds_sent === 66000 && nt.period.applied_to_bills === 52000 && nt.period.services_rendered === 2000 && nt.period.closing_held === 12000 && nt.as_of.held === 12000 && nt.current.unused === 12000 && ok(nt), nt.period);
check('ONLY the explicit 2,000 is deducted as a professional fee — not 66,000, not 14,000', nt.period.fee_deduction === 2000);
check('clicking the 52,000: the allocated PORTIONS add up to exactly 52,000', nt.period.applied_rows.length === 4 && total(nt.period.applied_rows, 'portion') === 52000);
check('clicking the 2,000: the fee rows add up to exactly 2,000', nt.period.fee_rows.length === 1 && total(nt.period.fee_rows, 'amount') === 2000);
var rowB2 = nt.period.applied_rows.filter(function (r) { return r.bill_id === 'b2'; });
check('one bill funded by two transfers: two portions (10,000 + 10,000), each naming its own source transfer and the full bill amount', rowB2.length === 2 && rowB2[0].transfer_id === 'T1' && rowB2[1].transfer_id === 'T2' && rowB2[0].portion === 10000 && rowB2[0].bill_total === 20000);
var rowB3 = nt.period.applied_rows.filter(function (r) { return r.bill_id === 'b3'; })[0];
check('a partially funded bill shows the PORTION (2,000), not the whole bill (5,000)', rowB3.portion === 2000 && rowB3.bill_total === 5000);
check('each row carries vendor, bill #, release # and facts about the bill — and says recognition is UNVERIFIED (the report decides where it is counted)', rowB3.vendor === 'AMB' && rowB3.bill_number === 'B-b3' && rowB3.release_number === '1002-1101' && rowB3.source_bill.category === 'trucking' && rowB3.source_bill.bill_date === '2026-06-20' && rowB3.source_bill.recognition === 'unverified' && rowB3.counted_in === undefined);
check('per transfer: T1 sent 40,000 → bills 40,000, held 0; T2 sent 26,000 → bills 12,000, fee 2,000, held 12,000', nt.transfers[0].as_of.applied_to_bills === 40000 && nt.transfers[0].as_of.held === 0 && nt.transfers[1].as_of.applied_to_bills === 12000 && nt.transfers[1].as_of.services_rendered === 2000 && nt.transfers[1].as_of.held === 12000, nt.transfers);
check('tax presentation: the full original 66,000, once', nt.period.tax_professional_fees === 66000);
check('RTM is separate: its own 9,000, nothing applied, no fee, all held — deduction 0 while funding exists', rtm.period.funds_sent === 9000 && rtm.period.fee_deduction === 0 && rtm.as_of.held === 9000 && rtm.current.unused === 9000 && rtm.transfers.length === 1 && ok(rtm));
check('a bank line not marked for a company is in nobody\'s funds', nt.transfers.concat(rtm.transfers).every(function (t) { return t.id !== 'X'; }));
check('the pop-up sentence is built from the computed amounts', F.feeExplanation(nt) === 'Only $2,000.00 is deducted here as a professional fee. The $52,000.00 allocated to underlying bills is not deducted again here; those costs are accounted for separately in their proper categories. The $12,000.00 still held at the end of this period does not reduce internal profit.', F.feeExplanation(nt));
check('today\'s position is said separately', F.currentFundsWords(nt) === 'Today: $12,000.00 unused and available.', F.currentFundsWords(nt));

// reclassify the remaining 12,000 as services → fee component 14,000 (never 66,000); tax still 66,000; reverse it → 2,000 again
var A2 = Object.assign({}, A, { entries: A.entries.concat([fee('f2', 'NextTrade Industries', 12000, 'T2', '2026-06-28')]) });
var nt2 = of(F.partyFundsBreakdown(A2), 'NextTrade Industries');
check('reclassify the held 12,000 as services rendered → deduction 14,000, held 0, tax still 66,000', nt2.period.fee_deduction === 14000 && nt2.as_of.held === 0 && nt2.current.unused === 0 && nt2.period.tax_professional_fees === 66000 && ok(nt2), nt2.period);
var A3 = Object.assign({}, A2, { entries: A2.entries.concat([fee('f3', 'NextTrade Industries', -12000, 'T2', '2026-06-29', 'fee_back_to_transfer')]) });
var nt3 = of(F.partyFundsBreakdown(A3), 'NextTrade Industries');
check('reverse that classification → deduction 2,000, held 12,000 again; transfers and bill portions untouched', nt3.period.fee_deduction === 2000 && nt3.as_of.held === 12000 && nt3.period.applied_to_bills === 52000 && nt3.period.funds_sent === 66000 && total(nt3.period.fee_rows, 'amount') === 2000);
check('a fee dated in a LATER month is deducted in that month, not this one', (function () { var x = Object.assign({}, A, { entries: [fee('f9', 'NextTrade Industries', 2000, 'T2', '2026-07-02')] }); var j = of(F.partyFundsBreakdown(x), 'NextTrade Industries'); var k = of(F.partyFundsBreakdown(Object.assign({}, x, { from: '2026-07-01', to: '2026-07-31' })), 'NextTrade Industries'); return j.period.fee_deduction === 0 && j.as_of.held === 14000 && k.period.fee_deduction === 2000 && k.period.funds_sent === 0 && k.period.opening_held === 14000 && k.period.closing_held === 12000; })());

// ── zero explicit fees ──
var Z = of(F.partyFundsBreakdown(Object.assign({}, A, { entries: [] })), 'NextTrade Industries');
check('no explicit fee → deduction 0; the 14,000 not used is held, never a fee', Z.period.fee_deduction === 0 && Z.as_of.held === 14000 && ok(Z));
var none = of(F.partyFundsBreakdown(Object.assign({}, A, { entries: [], pays: [] })), 'NextTrade Industries');
check('no linked bills at all does NOT mean professional fee: 66,000 held, deduction 0', none.period.fee_deduction === 0 && none.as_of.held === 66000 && none.period.applied_to_bills === 0);

// ── (Codex 13:02 P2-1) a transfer whose payments fall in two months: every subtotal's rows add up to THAT subtotal ──
var J = { parties: parties, bills: [bill('j1', 'V', 'trucking', 600, '2026-06-10')], bankLines: [line('J1', '2026-06-01', 1000, 'NextTrade Industries')],
  pays: [pay('j-a', 'j1', 300, 'J1', '2026-06-15'), pay('j-b', 'j1', 300, 'J1', '2026-07-15')], entries: [fee('j-f', 'NextTrade Industries', 50, 'J1', '2026-07-20')], requests: [] };
var jun = of(F.partyFundsBreakdown(Object.assign({}, J, { from: '2026-06-01', to: '2026-06-30' })), 'NextTrade Industries'); var tj = jun.transfers[0];
check('June report: the transfer shows 300 applied AS OF June, and its as-of rows add up to exactly 300 (the July payment is NOT in them)', tj.as_of.applied_to_bills === 300 && tj.as_of_rows.length === 1 && total(tj.as_of_rows, 'portion') === 300 && tj.as_of_rows[0].paid_date === '2026-06-15', tj);
check('June report: the period rows add up to the period subtotal (300)', jun.period.applied_to_bills === 300 && total(jun.period.applied_rows, 'portion') === 300);
check('June report: the lifetime list is a separate, clearly named list that adds up to the CURRENT figure (600)', tj.current.applied_to_bills === 600 && total(tj.lifetime_rows, 'portion') === 600 && tj.rows === undefined);
check('June report: July\'s fee is not in June\'s as-of fee rows (0) but is in the lifetime fee rows (50)', tj.as_of.services_rendered === 0 && tj.as_of_fee_rows.length === 0 && total(tj.lifetime_fee_rows, 'amount') === 50 && tj.current.services_rendered === 50);
check('June report: held at the end of June is 700; today 350 is unused', tj.as_of.held === 700 && jun.as_of.held === 700 && jun.period.closing_held === 700 && tj.current.unused === 350 && jun.current.unused === 350 && ok(jun));
var jul = of(F.partyFundsBreakdown(Object.assign({}, J, { from: '2026-07-01', to: '2026-07-31' })), 'NextTrade Industries');
check('July report: opening 700 + 0 − 300 − 50 = closing 350; period rows 300 and fee rows 50 add up; as-of rows now 600', jul.period.opening_held === 700 && jul.period.closing_held === 350 && total(jul.period.applied_rows, 'portion') === 300 && total(jul.period.fee_rows, 'amount') === 50 && total(jul.transfers[0].as_of_rows, 'portion') === 600 && jul.transfers[0].as_of.applied_to_bills === 600);
check('a transfer dated AFTER the period is not counted as of the period (held 0 then), but is in the current position', (function () { var x = of(F.partyFundsBreakdown(Object.assign({}, J, { from: '2026-05-01', to: '2026-05-31' })), 'NextTrade Industries'); return x.as_of.funds_sent === 0 && x.as_of.held === 0 && x.transfers[0].counted_as_of === false && x.transfers[0].as_of.held === 0 && x.current.funds_sent === 1000 && x.arithmetic_ok; })());

// ── Max's 10,000 walk-through, across months (Codex 12:36 item 3) ──
var B = { parties: parties, bills: [bill('c1', 'V1', 'trucking', 6000, '2026-09-10'), bill('c2', 'V2', 'utilities', 1200, '2026-10-12')],
  bankLines: [line('N1', '2026-09-02', 10000, 'NextTrade Industries'), line('R9', '2026-09-03', 4000, 'RTM Capital')],
  pays: [pay('q1', 'c1', 6000, 'N1', '2026-09-11'), pay('q2', 'c2', 1200, 'N1', '2026-10-15')],
  entries: [fee('g1', 'NextTrade Industries', 500, 'N1', '2026-09-20'), fee('g2', 'NextTrade Industries', 300, 'N1', '2026-11-03'), fee('g3', 'NextTrade Industries', -300, 'N1', '2026-11-04', 'fee_back_to_transfer')], requests: [] };
function run(from, to) { return of(F.partyFundsBreakdown(Object.assign({}, B, { from: from, to: to })), 'NextTrade Industries'); }
var sep = run('2026-09-01', '2026-09-30'); var oct = run('2026-10-01', '2026-10-31'); var nov3 = run('2026-11-01', '2026-11-03'); var nov = run('2026-11-01', '2026-11-30');
check('September: 10,000 sent, 6,000 to bills, 500 explicit fee, 3,500 held; tax 10,000; internal fee 500', sep.period.funds_sent === 10000 && sep.period.applied_to_bills === 6000 && sep.period.fee_deduction === 500 && sep.period.closing_held === 3500 && sep.as_of.held === 3500 && sep.period.tax_professional_fees === 10000, sep.period);
check('October roll-forward: opening 3,500 + new funding 0 − bills 1,200 − fees 0 = closing 2,300', oct.period.opening_held === 3500 && oct.period.funds_sent === 0 && oct.period.applied_to_bills === 1200 && oct.period.fee_deduction === 0 && oct.period.closing_held === 2300 && oct.as_of.held === 2300 && ok(oct), oct.period);
check('October: paying the 1,200 bill from held funds is NO new tax deduction and NO professional fee', oct.period.tax_professional_fees === 0 && oct.period.fee_deduction === 0);
check('October: the 1,200 portion links back to the ORIGINAL September transfer', oct.period.applied_rows.length === 1 && oct.period.applied_rows[0].transfer_id === 'N1' && oct.period.applied_rows[0].transfer_date === '2026-09-02');
check('after reclassifying 300: held 2,000, fees 800', nov3.as_of.held === 2000 && nov3.as_of.services_rendered === 800);
check('after reversing it: held 2,300, fees 500 — and November\'s net fee deduction is 0', nov.as_of.held === 2300 && nov.as_of.services_rendered === 500 && nov.period.fee_deduction === 0 && nov.period.closing_held === 2300);
check('RTM\'s balance is unaffected by all of it', of(F.partyFundsBreakdown(Object.assign({}, B, { from: '2026-11-01', to: '2026-11-30' })), 'RTM Capital').as_of.held === 4000);
check('all time (no dates): original transfer 10,000 = bills 7,200 + fees 500 + held 2,300', (function () { var x = run(null, null); return x.as_of.funds_sent === 10000 && x.as_of.applied_to_bills === 7200 && x.as_of.services_rendered === 500 && x.as_of.held === 2300 && x.current.unused === 2300 && ok(x); })());

// ── reservations (Codex 13:02 P2-2): current only, never called "unused", never a past period's balance ──
var C = { parties: parties, bills: [bill('d1', 'V', 'trucking', 900, '2026-12-01')], bankLines: [line('K1', '2026-12-01', 1000, 'NextTrade Industries')], pays: [], entries: [],
  requests: [{ id: 'w1', status: 'draft', funding_txn_id: 'K1', fee_amount: 100, lines: [{ bill_id: 'd1', amount: 900, is_open: true }] }] };
var c1 = of(F.partyFundsBreakdown(Object.assign({}, C, { from: '2026-12-01', to: '2026-12-31' })), 'NextTrade Industries');
check('a draft request of 900 bills + 100 fee on a 1,000 transfer reserves ALL 1,000 today: unused 0', c1.current.reserved === 1000 && c1.current.unused === 0 && c1.transfers[0].current.reserved === 1000 && c1.transfers[0].current.unused === 0 && total(c1.transfers[0].reserved_rows, 'amount') === 1000);
check('a reservation is not a payment and not an expense', c1.as_of.applied_to_bills === 0 && c1.period.fee_deduction === 0 && c1.period.closing_held === 1000);
check('the period sentence says "still held", NEVER "unused", for money that is reserved', F.feeExplanation(c1).indexOf('unused') < 0 && /The \$1,000\.00 still held at the end of this period does not reduce internal profit\./.test(F.feeExplanation(c1)), F.feeExplanation(c1));
check('today\'s sentence: $0.00 unused, $1,000.00 reserved (held — not paid, not an expense)', F.currentFundsWords(c1) === 'Today: $0.00 unused and available, and $1,000.00 reserved for requests not sent yet (held — not paid, not an expense).', F.currentFundsWords(c1));
check('the period / as-of blocks carry NO reservation figure at all (reservations have no date)', c1.as_of.reserved === undefined && c1.as_of.unused === undefined && c1.period.reserved === undefined && c1.transfers[0].as_of.reserved === undefined);
var cOld = of(F.partyFundsBreakdown(Object.assign({}, C, { bankLines: [line('K1', '2026-06-01', 1000, 'NextTrade Industries')], from: '2026-06-01', to: '2026-06-30' })), 'NextTrade Industries');
check('a reservation made TODAY does not change what June\'s report says was held at the end of June (1,000), only today\'s position', cOld.as_of.held === 1000 && cOld.period.closing_held === 1000 && cOld.current.reserved === 1000 && cOld.current.unused === 0);
var C2 = Object.assign({}, C, { pays: [pay('z1', 'd1', 900, 'K1', '2026-12-05')], requests: [{ id: 'w1', status: 'attached', funding_txn_id: 'K1', bank_transaction_id: 'K1', fee_amount: 100, sent_date: '2026-12-05', lines: [{ bill_id: 'd1', amount: 900, is_open: false }] }] });
var c2 = of(F.partyFundsBreakdown(C2), 'NextTrade Industries');
check('once sent: 900 to bills, the 100 fee is an explicit fee counted ONCE, nothing reserved, unused 0', c2.as_of.applied_to_bills === 900 && c2.as_of.services_rendered === 100 && c2.current.reserved === 0 && c2.current.unused === 0 && c2.period.fee_rows.length === 1);
check('cancelled / reversed requests reserve nothing', of(F.partyFundsBreakdown(Object.assign({}, C, { requests: [{ id: 'w1', status: 'cancelled', funding_txn_id: 'K1', fee_amount: 100, lines: [{ bill_id: 'd1', amount: 900, is_open: true }] }, { id: 'w2', status: 'reversed', funding_txn_id: 'K1', fee_amount: 5, lines: [] }] })), 'NextTrade Industries').current.unused === 1000);
check('a voided payment is not an allocation', of(F.partyFundsBreakdown(Object.assign({}, C, { requests: [], pays: [Object.assign(pay('z2', 'd1', 900, 'K1', '2026-12-05'), { voided: true })] })), 'NextTrade Industries').current.unused === 1000);

// ── records that disagree: shown, and NEVER reported as reconciled ──
var over = of(F.partyFundsBreakdown(Object.assign({}, C, { requests: [], pays: [pay('z3', 'd1', 1200, 'K1', '2026-12-05')] })), 'NextTrade Industries');
check('more used than sent: the negative is SHOWN (−200), never clamped', over.current.unused === -200 && over.as_of.held === -200 && /needs reconciliation/.test(F.feeExplanation(over)) && /needs reconciliation/.test(F.currentFundsWords(over)));
check('… the sums still agree with each other (arithmetic_ok) but the company is flagged needs_reconciliation — never a green "reconciled"', over.arithmetic_ok === true && over.needs_reconciliation === true && over.reconciles === undefined);
var loose = of(F.partyFundsBreakdown(Object.assign({}, C, { requests: [], entries: [{ id: 'u1', party: 'NextTrade Industries', bucket: 'fee', kind: 'advance_to_fee', amount: 50, entry_date: '2026-12-02' }] })), 'NextTrade Industries');
check('a fee entry that names no transfer: deducted (it is explicit), reported apart, taken from no transfer, and flagged needs_reconciliation', loose.period.fee_deduction === 50 && loose.period.fees_without_a_transfer === 50 && loose.period.loose_fee_rows.length === 1 && loose.transfers[0].current.unused === 1000 && loose.needs_reconciliation === true);
check('an advance-bucket entry is never a fee', of(F.partyFundsBreakdown(Object.assign({}, C, { requests: [], entries: [{ id: 'u2', party: 'NextTrade Industries', bucket: 'advance', kind: 'payment_split', amount: 400, bank_transaction_id: 'K1', entry_date: '2026-12-02' }] })), 'NextTrade Industries').period.fee_deduction === 0);
check('nothing given → empty, no crash', F.partyFundsBreakdown({}).length === 0 && F.partyFundsBreakdown({ parties: parties })[0].current.unused === 0);

// ── ONE identity rule, shared with the screen (Codex 13:07) ──
check('marked line → that company, basis "marked"', JSON.stringify(F.fundingIdentity({ third_party_payer: 'RTM Capital', name: 'anything', direction: 'out' })) === JSON.stringify({ payer: 'RTM Capital', basis: 'marked' }));
check('unmarked line whose bank text says "transfer to CHK ...9909" → RTM by bank text; "...2061" → NextTrade', F.fundingIdentity({ name: 'Online Transfer to CHK ...9909 transaction#: 123', direction: 'out' }).payer === 'RTM Capital' && F.fundingIdentity({ name: 'Online Transfer to CHK ...9909', direction: 'out' }).basis === 'bank_text' && F.fundingIdentity({ name: 'ONLINE TRANSFER TO SAV ...2061', direction: 'out' }).payer === 'NextTrade Industries');
check('a number that merely CONTAINS 9909 is not that account; nor is a reference, an amount or a transfer FROM it', F.fundingIdentity({ name: 'Online Transfer to CHK ...99091', direction: 'out' }) === null && F.fundingIdentity({ name: 'WIRE REF 9909 KRONOS', direction: 'out' }) === null && F.fundingIdentity({ name: 'CHECK 9909', direction: 'out' }) === null && F.fundingIdentity({ name: 'Online Transfer from CHK ...9909', direction: 'out' }) === null);
check('money IN is never funding sent; a category never identifies a company', F.fundingIdentity({ name: 'Online Transfer to CHK ...9909', direction: 'in' }) === null && F.fundingIdentity({ name: 'ACH PAYMENT', classification: 'professional_fees', direction: 'out' }) === null);
check('the mark wins over the text', F.fundingIdentity({ third_party_payer: 'NextTrade Industries', name: 'Online Transfer to CHK ...9909', direction: 'out' }).payer === 'NextTrade Industries');
var I = { parties: parties, bills: [], pays: [], entries: [], requests: [], from: '2026-06-01', to: '2026-06-30',
  bankLines: [{ id: 'm1', date: '2026-06-05', amount_abs: 20000, third_party_payer: 'RTM Capital', direction: 'out', name: 'WIRE' },
    { id: 'u1', date: '2026-06-09', amount_abs: 41000, third_party_payer: null, direction: 'out', name: 'Online Transfer to CHK ...9909 transaction#: 77' },
    { id: 'u2', date: '2026-06-12', amount_abs: 15000, third_party_payer: null, direction: 'out', name: 'Online Transfer to CHK ...2061' },
    { id: 'u3', date: '2026-06-13', amount_abs: 999, third_party_payer: null, direction: 'out', name: 'PAYMENT 9909 SOMETHING' }] };
var iR = of(F.partyFundsBreakdown(I), 'RTM Capital'); var iN = of(F.partyFundsBreakdown(I), 'NextTrade Industries');
check('an unmarked transfer to the named account is money SENT (never a fee): RTM 61,000 sent, deduction 0, all held', iR.period.funds_sent === 61000 && iR.period.fee_deduction === 0 && iR.as_of.held === 61000 && iR.transfers.length === 2);
check('… each transfer says how it was identified, and the ones known only from the bank text are listed to be confirmed', iR.transfers[0].identity === 'marked' && iR.transfers[1].identity === 'bank_text' && iR.identity_to_confirm.count === 1 && iR.identity_to_confirm.sent === 41000 && iN.identity_to_confirm.count === 1 && iN.identity_to_confirm.sent === 15000 && iN.period.funds_sent === 15000);
check('… and a line that only mentions the digits is in nobody\'s funds', iR.transfers.concat(iN.transfers).every(function (t) { return t.id !== 'u3'; }));

// ── the same transfer present as two bank lines (one account connected twice): ONE transfer ──
check('the bank\'s transaction number is read from the text', F.bankRefOf('Online Transfer to CHK ...9909 transaction#: 30116993096 07/23') === '30116993096' && F.bankRefOf('WIRE OUT') === null && F.bankRefOf('transaction#: 12') === null);
var D = { parties: parties, bills: [bill('dd1', 'V', 'trucking', 500, '2026-07-25')], entries: [], requests: [], from: '2026-07-01', to: '2026-07-31',
  bankLines: [{ id: 'copyA', date: '2026-07-23', amount_abs: 25000, third_party_payer: null, direction: 'out', account_id: 'acc-1', name: 'Online Transfer to CHK ...9909 transaction#: 30116993096 07/23' },
    { id: 'copyB', date: '2026-07-23', amount_abs: 25000, third_party_payer: 'RTM Capital', direction: 'out', account_id: 'acc-2', name: 'Online Transfer to CHK ...9909 transaction#: 30116993096 07/23' },
    { id: 'other', date: '2026-07-28', amount_abs: 25000, third_party_payer: 'RTM Capital', direction: 'out', account_id: 'acc-2', name: 'Online Transfer to CHK ...9909 transaction#: 30119999999 07/28' }],
  pays: [pay('dp', 'dd1', 500, 'copyA', '2026-07-26')] };
var dR = of(F.partyFundsBreakdown(D), 'RTM Capital');
check('two bank lines with the SAME bank transaction number and amount count ONCE: 50,000 sent, not 75,000', dR.period.funds_sent === 50000 && dR.period.tax_professional_fees === 50000 && dR.transfers.length === 2, dR.period);
check('the stamped copy is the one kept; the other is listed (not counted) with what it duplicates', dR.transfers[0].id === 'copyB' && dR.duplicate_bank_lines.length === 1 && dR.duplicate_bank_lines[0].id === 'copyA' && dR.duplicate_bank_lines[0].same_as === 'copyB' && dR.duplicate_bank_lines_total === 25000 && dR.identity_to_confirm.count === 0);
check('a bill payment recorded against the dropped copy is NOT lost: it follows to the kept transfer', dR.period.applied_to_bills === 500 && dR.transfers[0].as_of.applied_to_bills === 500 && dR.transfers[0].as_of_rows[0].transfer_id === 'copyB' && dR.as_of.held === 49500);
check('a different transaction number with the same amount is a different transfer', dR.transfers[1].id === 'other' && dR.transfers[1].sent === 25000);
check('same number but a different amount is NOT merged (never guessed)', (function () { var x = JSON.parse(JSON.stringify(D)); x.bankLines[0].amount_abs = 24000; var r = of(F.partyFundsBreakdown(x), 'RTM Capital'); return r.transfers.length === 3 && r.duplicate_bank_lines.length === 0 && r.period.funds_sent === 74000; })());

// ── bills paid THROUGH the company with no source transfer named (simple-fixes' gap): shown apart, taken from no transfer ──
var U = { parties: parties, entries: [], requests: [], from: '2026-08-01', to: '2026-08-31',
  bills: [Object.assign(bill('ub1', 'Kronos', 'trucking', 800, '2026-08-03'), { paid_via: 'RTM Capital' }), Object.assign(bill('ub2', 'AMB', 'trucking', 300, '2026-08-04'), { paid_via: 'RTM Capital' }),
    Object.assign(bill('ub3', 'Rent Co', 'rent', 500, '2026-08-05'), { paid_via: 'NextTrade Industries' }), bill('ub4', 'Direct Vendor', 'supplies', 90, '2026-08-06')],
  bankLines: [line('UT1', '2026-08-01', 5000, 'RTM Capital'), { id: 'KTC-OTHER', date: '2026-08-02', amount_abs: 300, third_party_payer: null, direction: 'out', name: 'ACH AMB' }],
  pays: [pay('up1', 'ub1', 800, null, '2026-08-10'), pay('up2', 'ub2', 300, 'KTC-OTHER', '2026-08-11'), pay('up3', 'ub3', 500, null, '2026-09-02'), pay('up4', 'ub4', 90, null, '2026-08-12'),
    Object.assign(pay('up5', 'ub1', 50, null, '2026-08-13'), { voided: true }), pay('up6', 'ub1', 100, 'UT1', '2026-08-14')] };
var uR = of(F.partyFundsBreakdown(U), 'RTM Capital'); var uN = of(F.partyFundsBreakdown(U), 'NextTrade Industries');
check('a bill paid through RTM with NO bank line named is listed apart: 800, plus 300 that sits on a line which is not an RTM transfer', uR.paid_without_a_transfer.period_total === 1100 && uR.paid_without_a_transfer.period_rows.length === 2 && total(uR.paid_without_a_transfer.period_rows, 'portion') === 1100 && uR.paid_without_a_transfer.period_rows[0].on_bank_line === null && uR.paid_without_a_transfer.period_rows[1].on_bank_line === 'KTC-OTHER', uR.paid_without_a_transfer);
check('… it is taken from NO transfer (held stays 4,900 after the one linked 100) and it is never a fee', uR.as_of.held === 4900 && uR.period.applied_to_bills === 100 && uR.period.fee_deduction === 0 && uR.transfers[0].as_of.applied_to_bills === 100);
check('… and the company is flagged needs_reconciliation (held funds are overstated until these are linked)', uR.needs_reconciliation === true && uR.arithmetic_ok === true);
check('… voided payments and bills not paid through a company are not in the list', uR.paid_without_a_transfer.lifetime_rows.every(function (r) { return r.payment_id !== 'up5' && r.payment_id !== 'up4'; }));
check('each company has its own list, and a September payment is not in August\'s period or as-of lists but is in the lifetime list', uN.paid_without_a_transfer.period_total === 0 && uN.paid_without_a_transfer.as_of_total === 0 && uN.paid_without_a_transfer.lifetime_total === 500 && uN.paid_without_a_transfer.lifetime_rows[0].vendor === 'Rent Co');
check('nothing unlinked → empty lists, no flag', nt.paid_without_a_transfer.lifetime_total === 0 && nt.paid_without_a_transfer.period_rows.length === 0 && nt.needs_reconciliation === false);

// ── (Codex 13:37 P2) the explicit fee of an ORDINARY attached wire (bank_transaction_id, no funding_txn_id) ──
var W = { parties: parties, bills: [], pays: [], entries: [], bankLines: [line('t', '2026-06-15', 1000, 'RTM Capital')], from: '2026-06-01', to: '2026-06-30' };
function wRun(reqs, from, to) { return of(F.partyFundsBreakdown(Object.assign({}, W, { requests: reqs, from: from || W.from, to: to || W.to })), 'RTM Capital'); }
var ord = { id: 'ow', status: 'attached', bank_transaction_id: 't', funding_txn_id: null, fee_amount: 100, sent_date: '2026-06-15', lines: [] };
var w1 = wRun([ord]);
check('your reproduction: transfer 1,000, ordinary attached wire with a 100 fee → fee 100, held 900 (was 0 / 1,000)', w1.period.fee_deduction === 100 && w1.period.closing_held === 900 && w1.as_of.held === 900 && w1.current.unused === 900 && w1.period.fee_rows.length === 1 && w1.period.fee_rows[0].why === 'service fee on a wire', w1.period);
var fundedBoth = { id: 'fw', status: 'attached', bank_transaction_id: 't', funding_txn_id: 't', fee_amount: 100, sent_date: '2026-06-20', lines: [] };
check('a funded request reaching the helper TWICE (from both queries) has its fee counted once', wRun([fundedBoth, fundedBoth]).period.fee_deduction === 100 && wRun([fundedBoth, JSON.parse(JSON.stringify(fundedBoth))]).as_of.held === 900);
check('an ordinary wire and a funded request on the same transfer: two fees, each once', wRun([ord, Object.assign({}, fundedBoth, { fee_amount: 40 })]).period.fee_deduction === 140);
check('a reversed or cancelled ordinary wire carries no fee', wRun([Object.assign({}, ord, { status: 'reversed' }), Object.assign({}, ord, { id: 'ow2', status: 'cancelled' })]).period.fee_deduction === 0);
check('(WF) a ledger entry that points at a sent wire is a note about that wire\'s fee: the fee counts ONCE (100, held 900), never twice', (function () { var x = of(F.partyFundsBreakdown(Object.assign({}, W, { requests: [ord], entries: [{ id: 'note', party: 'RTM Capital', bucket: 'fee', kind: 'fee_from_transfer', amount: 100, source_bank_transaction_id: 't', wire_package_id: 'ow', entry_date: '2026-06-15' }] })), 'RTM Capital'); return x.period.fee_deduction === 100 && x.as_of.held === 900 && x.period.fee_rows.length === 1; })());
var lateFee = Object.assign({}, ord, { sent_date: '2026-07-10' });
check('a fee dated in a LATER month: June deduction 0 and held 1,000; July deduction 100, opening 1,000, closing 900', wRun([lateFee]).period.fee_deduction === 0 && wRun([lateFee]).period.closing_held === 1000 && wRun([lateFee], '2026-07-01', '2026-07-31').period.fee_deduction === 100 && wRun([lateFee], '2026-07-01', '2026-07-31').period.opening_held === 1000 && wRun([lateFee], '2026-07-01', '2026-07-31').period.closing_held === 900);
check('an ordinary wire NOT sent yet (draft, no funding transfer) reserves nothing and carries no fee', (function () { var x = wRun([{ id: 'dw', status: 'draft', bank_transaction_id: null, funding_txn_id: null, fee_amount: 100, lines: [{ bill_id: 'q', amount: 500, is_open: true }] }]); return x.current.reserved === 0 && x.period.fee_deduction === 0 && x.current.unused === 1000; })());
check('a draft whose bank line is set but which is not a funded request still reserves nothing (only funding_txn_id reserves)', wRun([{ id: 'dw2', status: 'ready', bank_transaction_id: 't', funding_txn_id: null, fee_amount: 100, lines: [{ bill_id: 'q', amount: 500, is_open: true }] }]).current.reserved === 0);
check('an attached wire on a bank line that is NOT one of this company\'s transfers adds no fee here', wRun([Object.assign({}, ord, { bank_transaction_id: 'someone-else' })]).period.fee_deduction === 0);

// ── (WF B2) money BACK from the company: a refund lowers its transfer — never a fee, never a bill ──
var RF = { parties: parties, bills: [bill('rb1', 'V', 'trucking', 4000, '2026-09-05')], requests: [],
  bankLines: [line('RT', '2026-09-01', 10000, 'RTM Capital')], pays: [pay('rp1', 'rb1', 4000, 'RT', '2026-09-06')],
  entries: [{ id: 'rf1', party: 'RTM Capital', bucket: 'refund', kind: 'refund', amount: 1500, source_bank_transaction_id: 'RT', bank_transaction_id: 'IN-1', entry_date: '2026-10-03' },
    fee('rf2', 'RTM Capital', 500, 'RT', '2026-09-20')] };
var rSep = of(F.partyFundsBreakdown(Object.assign({}, RF, { from: '2026-09-01', to: '2026-09-30' })), 'RTM Capital');
var rOct = of(F.partyFundsBreakdown(Object.assign({}, RF, { from: '2026-10-01', to: '2026-10-31' })), 'RTM Capital');
check('refund: September (before the money came back) — held 5,500, no refund yet', rSep.period.closing_held === 5500 && rSep.period.refunds === 0 && rSep.as_of.held === 5500);
check('refund: October — opening 5,500 − refund 1,500 = closing 4,000; the refund row names its transfer and the incoming line', rOct.period.opening_held === 5500 && rOct.period.refunds === 1500 && rOct.period.closing_held === 4000 && rOct.period.refund_rows.length === 1 && rOct.period.refund_rows[0].transfer_id === 'RT' && rOct.period.refund_rows[0].incoming_line === 'IN-1' && rOct.arithmetic_ok, rOct.period);
check('refund: it is NOT a fee and NOT a bill (October fee 0, bills 0); tax line unchanged by it in this helper', rOct.period.fee_deduction === 0 && rOct.period.applied_to_bills === 0 && rOct.period.tax_professional_fees === 0);
check('refund: conservation per transfer — sent 10,000 = refund 1,500 + bills 4,000 + fee 500 + unused 4,000', rOct.transfers[0].current.refunds === 1500 && rOct.transfers[0].current.unused === 4000 && rOct.current.unused === 4000 && rOct.as_of.refunds === 1500 && rOct.as_of.held === 4000);
check('refund: another company does not see this refund', of(F.partyFundsBreakdown(Object.assign({}, RF, { from: '2026-10-01', to: '2026-10-31' })), 'NextTrade Industries').period.refunds === 0);
check('refund: a refund entry that names no transfer of this company is ignored, not guessed', of(F.partyFundsBreakdown(Object.assign({}, RF, { entries: [{ id: 'x', party: 'RTM Capital', bucket: 'refund', kind: 'refund', amount: 9, source_bank_transaction_id: 'nope', entry_date: '2026-10-03' }] })), 'RTM Capital').current.refunds === 0);
var src = fs.readFileSync(path.join(root, 'src/lib/party-funds.js'), 'utf8');
check('no example amount is hard-coded in the application code', !/66000|52000|12000|10000|66,000|52,000/.test(src));
check('the helper is pure: no database, no fetch, no supabase import', !/supabase|fetch\(|\.from\(|rpc\(/.test(src));
check('it never claims where a cost is recognized: no "counted_in", no "accounted for in" field', src.indexOf('counted_in') < 0 && src.indexOf("recognition: 'unverified'") > 0);

check('RTM second account (Max 21 Nov): "Online Transfer to CHK ...0225" is money sent to RTM by bank text; a transfer FROM it or a longer number is not', (F.fundingIdentity({ name: 'Online Transfer to CHK ...0225 transaction#: 1', direction: 'out' }) || {}).payer === 'RTM Capital' && F.fundingIdentity({ name: 'Online Transfer from CHK ...0225', direction: 'out' }) === null && F.fundingIdentity({ name: 'Online Transfer to CHK ...02251', direction: 'out' }) === null);
console.log('which lines of a bill a portion covers (for counting goods through bill lines)');
var L3 = [{ id: 'l1', bill_id: 'g', amount: 600 }, { id: 'l2', bill_id: 'g', amount: 300 }, { id: 'l3', bill_id: 'g', amount: 100.5 }];
var s1 = F.billLineSplit(1000.5, 1000.5, L3);
check('the whole bill: whole_bill with every line in cents (60000 + 30000 + 10050 = the portion)', s1.line_split === 'whole_bill' && s1.lines.length === 3 && s1.lines[2].amount_cents === 10050 && s1.lines.reduce(function (x, l) { return x + l.amount_cents; }, 0) === 100050, s1);
var s2 = F.billLineSplit(400, 1000.5, L3);
check('part of a bill with several lines: unresolved, no lines guessed', s2.line_split === 'unresolved' && s2.lines.length === 0 && /several lines/.test(s2.why), s2);
var s3 = F.billLineSplit(250, 900, [{ id: 'one', bill_id: 'h', amount: 900 }]);
check('part of a bill with ONE line: from_lines, that line for the portion (25000 cents)', s3.line_split === 'from_lines' && s3.lines.length === 1 && s3.lines[0].bill_line_id === 'one' && s3.lines[0].amount_cents === 25000, s3);
check('a bill with no lines: no_lines', F.billLineSplit(500, 500, []).line_split === 'no_lines');
var s5 = F.billLineSplit(1000, 1000, [{ id: 'x', bill_id: 'k', amount: 700 }, { id: 'y', bill_id: 'k', amount: 200 }]);
check('lines that do not add up to the bill: unresolved, said so', s5.line_split === 'unresolved' && /do not add up/.test(s5.why), s5);
check('lines that could not be read: unresolved, said so (never treated as no lines)', F.billLineSplit(500, 500, null).line_split === 'unresolved');
var brL = F.partyFundsBreakdown({ parties: [{ name: 'RTM Capital' }], bankLines: [{ id: 'T', date: '2026-10-01', amount_abs: 2000, third_party_payer: 'RTM Capital', direction: 'out' }],
  pays: [{ id: 'p1', bill_id: 'g', bank_transaction_id: 'T', amount: 1000.5, paid_date: '2026-10-02' }, { id: 'p2', bill_id: 'h', bank_transaction_id: 'T', amount: 250, paid_date: '2026-10-03' }],
  bills: [{ id: 'g', vendor_name: 'Foam supplier', total_amount: 1000.5 }, { id: 'h', vendor_name: 'Trucker', total_amount: 900 }], billLines: L3.concat([{ id: 'one', bill_id: 'h', amount: 900 }]) });
var rowsL = brL[0].transfers[0].lifetime_rows;
check('each allocated row of a transfer carries line_split and lines (bill g whole_bill, bill h from_lines)', rowsL.length === 2 && rowsL[0].line_split === 'whole_bill' && rowsL[0].lines.length === 3 && rowsL[1].line_split === 'from_lines' && rowsL[1].lines[0].amount_cents === 25000, rowsL);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
