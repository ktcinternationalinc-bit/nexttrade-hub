// ═══════════════════════════════════════════════════════════════════════════
// v55.83-TX — NextTrade / RTM payments split into bills · extra fee · ADVANCE (Max, Nov 17 2026).
// RUN: balances, the P&L period adjustments, the paid-through block (totals conserved in both views). The money moves
// themselves are done ONLY by the database function hub_party_money — checked here by reading the SQL (it needs Postgres).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var M = require(path.join(root, 'src/lib/party-money.js'));
var B = require(path.join(root, 'src/lib/paid-through-blocks.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
console.log('TX — advances & extra fees');

var NT = 'NextTrade Industries';
var E = [
  { party: NT, bucket: 'advance', amount: 3000, kind: 'payment_split', bank_transaction_id: 'W1', entry_date: '2026-11-20' },
  { party: NT, bucket: 'fee', amount: 500, kind: 'payment_split', bank_transaction_id: 'W1', entry_date: '2026-11-20' },
  { party: NT, bucket: 'advance', amount: -1200, kind: 'apply_to_bill', bill_id: 'B9', entry_date: '2026-12-03' },
  { party: NT, bucket: 'advance', amount: -300, kind: 'advance_to_fee', entry_date: '2026-12-10' },
  { party: NT, bucket: 'fee', amount: 300, kind: 'advance_to_fee', entry_date: '2026-12-10' },
  { party: NT, bucket: 'fee', amount: -100, kind: 'fee_to_advance', entry_date: '2026-12-12' },
  { party: NT, bucket: 'advance', amount: 100, kind: 'fee_to_advance', entry_date: '2026-12-12' }];
var bal = M.partyBalances(E)[NT.toLowerCase()];
check('advance balance = 3000 − 1200 − 300 + 100 = 1600', bal.advance === 1600, bal);
check('fees on record = 500 + 300 − 100 = 700', bal.fee === 700, bal);

var nov = M.periodAdjustments(E, '2026-11-01', '2026-11-30', { W1: 'professional_fees' }, { W1: '2026-11-20' });
check('November: the 3,000 advance leaves professional fees (not spending)', nov.advance_out_of_category.professional_fees === 3000 && nov.advance_held === 3000);
check('November: no professional-fee change from older money', nov.professional_fee_change === 0);
var dec = M.periodAdjustments(E, '2026-12-01', '2026-12-31', { W1: 'professional_fees' }, { W1: '2026-11-20' });
check('December: advance used on bills (1,200) + advance→fee (300) − fee→advance (100) = +1,400 professional fees', dec.professional_fee_change === 1400 && dec.applied_to_bills === 1200, dec);
check('December: the November split is not counted again', dec.advance_held === 0);
check('split dated by its bank line, not the click', M.periodAdjustments([{ party: NT, bucket: 'advance', amount: 50, kind: 'payment_split', bank_transaction_id: 'W2', entry_date: '2026-12-02' }], '2026-11-01', '2026-11-30', { W2: 'x' }, { W2: '2026-11-29' }).advance_held === 50);

// ── the paid-through block (real-cost view) stays balanced ──
var parties = [{ name: NT, kind: 'affiliate', provider_from: '2026-11-15' }];
var lines = [{ id: 'W1', date: '2026-11-20', amount: 10000, classification: 'professional_fees', payer: NT }];
var bills = { B1: { vendor_name: 'Power Co', bill_number: 'P1', category: 'utilities', paid_via: NT }, B9: { vendor_name: 'Rent Co', bill_number: 'R1', category: 'rent', paid_via: NT } };
var pays = [{ bill_id: 'B1', amount: 4000, paid_date: '2026-11-20', bank_transaction_id: 'W1', method: 'rtm' }, { bill_id: 'B9', amount: 1200, paid_date: '2026-11-25', bank_transaction_id: null, method: 'advance' }];
var blocks = B.buildPaidThroughBlocks({ parties: parties, lines: lines, pays: pays, billById: bills, requests: [], catLabels: { professional_fees: 'Professional fees' }, from: '2026-11-01', to: '2026-11-30', splits: { W1: { fee: 500, advance: 3000 } }, profKey: 'professional_fees' });
var blk = blocks.filter(function (x) { return x.era === 'provider'; })[0] || {};
check('block counts the payment without the advance (10,000 − 3,000 = 7,000)', blk.payments_total === 7000, blk);
check('block: advance held 3,000; extra fee 500 booked; waiting = 10,000 − 4,000 bills − 500 − 3,000 = 2,500', blk.advance_held === 3000 && blk.fees_booked === 500 && blk.waiting === 2500, blk);
check('block: bill paid from the advance (1,200 rent) goes to its real category in the real-cost view', blk.allocations_by_cat.some(function (a) { return a.key === 'rent' && a.total === 1200; }) && blk.payments_by_cat.some(function (p) { return p.key === 'professional_fees' && p.from_advance && p.total === 1200; }));
var rows = B.remainderRows(blk); var remSum = 0; rows.forEach(function (r) { remSum = r2(remSum + r.total); });
check('remainder rows add up to the block remainder (nothing lost or doubled)', remSum === blk.service_fee, { remSum: remSum, fee: blk.service_fee });
// tax-view rows (server) = professional fees 10,000 − 3,000 advance + 1,200 applied = 8,200 ; advance row 3,000 (not P&L)
// real-cost view = tax rows − payments_by_cat + allocations + remainder rows → total must equal the tax total
var taxRows = { professional_fees: 8200, __party_advance: 3000 };
var view = Object.assign({}, taxRows);
blk.payments_by_cat.forEach(function (p) { view[p.key] = r2((view[p.key] || 0) - p.total); });
blk.allocations_by_cat.forEach(function (a) { view[a.key] = r2((view[a.key] || 0) + a.total); });
rows.forEach(function (r) { view[r.key] = r2((view[r.key] || 0) + r.total); });
function sum(o) { var t = 0; Object.keys(o).forEach(function (k) { t = r2(t + o[k]); }); return t; }
check('both views total the same (11,200 = 10,000 sent + 1,200 of advance used on a bill)', sum(view) === sum(taxRows), { view: view });
check('real-cost view: professional fees line gone, bills in their own categories', view.professional_fees === 0 && view.utilities === 4000 && view.rent === 1200, view);
var noSplit = B.buildPaidThroughBlocks({ parties: parties, lines: lines, pays: [pays[0]], billById: bills, requests: [], from: '2026-11-01', to: '2026-11-30' });
check('without any split the block is exactly as before (advance 0, waiting 6,000)', noSplit[0].payments_total === 10000 && noSplit[0].waiting === 6000 && noSplit[0].advance_held === 0);

// ── SQL: the one function, guards, append-only ──
var sql = fs.readFileSync(path.join(root, 'sql/v55-83-TX-advances-fees.sql'), 'utf8');
check('SQL: locks per company and the bank line (same lock as the TO guards)', /hashtextextended\('hub-party:'/.test(sql) && /hashtextextended\('hub-bank-line:'/.test(sql));
check('SQL: applying more than the advance is refused', /IF v_amt > v_adv \+ 0\.005 THEN RAISE EXCEPTION 'HUB_GUARD: the % advance is only/.test(sql));
check('SQL: never below zero, checked again at the end under the lock', /IF v_adv < -0\.005 OR v_fee < -0\.005/.test(sql));
check('SQL: split cannot exceed the payment (bills + earlier splits + wire fees)', /v_line_used \+ v_split \+ v_amt \+ v_fee_amt > v_line\.amount_abs/.test(sql) && /wire_packages/.test(sql));
check('SQL: only their own bills can be paid from their advance', /only their bills can be paid from their advance/.test(sql));
check('SQL: paying a bill from the advance goes through vendor_bill_payments (the TO over-payment guard applies)', /INSERT INTO public\.vendor_bill_payments[\s\S]{0,200}'advance'/.test(sql));
check('SQL: append-only — entries can never be changed or deleted', /BEFORE UPDATE OR DELETE ON public\.party_money_entries/.test(sql));
check('SQL: one click = one move (request id)', /party_money_entries_request/.test(sql) && /'repeat', true/.test(sql));
check('SQL: conversions need a reason', (sql.match(/say why/g) || []).length >= 2);
check('SQL: browsers cannot call it', /REVOKE ALL ON FUNCTION public\.hub_party_money/.test(sql));
check('SQL: additive only', !/drop table|delete from/i.test(sql));

var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/advances/route.js'), 'utf8');
check('route: verified signed-in person + "advances.manage" for every move', /verifiedCaller\(req, body, createClient\)/.test(route) && /'advances\.manage'/.test(route) && /MONEY\[action\] && !canMove/.test(route));
check('route: refuses until the SQL is installed; money moved only by the database function', /hub_party_money_installed/.test(route) && /(db\.rpc\(|rpcOnceMore\(db, )'hub_party_money'/.test(route) && !/from\('party_money_entries'\)\.insert/.test(route) && !/from\('vendor_bill_payments'\)\.insert/.test(route));
check('route: private bank accounts (live TP) hidden from the payments list; the private-money rule (incl. splitting a private line) is enforced by the database inside the move', route.indexOf('dropPrivate(ln.data, scope)') >= 0 && route.indexOf('p_hidden_accounts: hiddenArr') >= 0 && fs.readFileSync(path.join(root, 'sql/v55-83-TX-advances-fees.sql'), 'utf8').indexOf('that bank line is in a private account') >= 0);
check('route: a click id is required', /missing click id/.test(route));
check('route: SWC-safe', route.indexOf('`') < 0 && !/=>/.test(route));
var bills2 = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
check('P&L: advances move out of the payment category to a not-P&L row; applied / converted change professional fees', /__party_advance/.test(bills2) && /periodAdjustments\(/.test(bills2) && /professional_fee_change/.test(bills2) && /splits: ptSplits/.test(bills2));
check('P&L: says so when advances cannot be read (never silently)', /advance_note: advNote/.test(bills2));
var tab = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
check('Bills screen: advance balances always visible', /<AdvancesPanel/.test(tab));

// v55.83-UD (Codex 11:40) — a starting balance (money sent before the Hub, already booked then) is used FIRST and is never a new fee
(function () {
  var E = [
    { id: 'o1', party: 'NextTrade Industries', bucket: 'advance', amount: 1000, kind: 'opening_balance', entry_date: '2026-10-01', created_at: '2026-11-18T10:00:00Z' },
    { id: 's1', party: 'NextTrade Industries', bucket: 'advance', amount: 500, kind: 'payment_split', bank_transaction_id: 'L1', entry_date: '2026-11-05', created_at: '2026-11-05T10:00:00Z' },
    { id: 'a1', party: 'NextTrade Industries', bucket: 'advance', amount: -800, kind: 'apply_to_bill', entry_date: '2026-11-10', created_at: '2026-11-10T10:00:00Z' },
    { id: 'a2', party: 'NextTrade Industries', bucket: 'advance', amount: -400, kind: 'apply_to_bill', entry_date: '2026-11-12', created_at: '2026-11-12T10:00:00Z' },
    { id: 'f1', party: 'NextTrade Industries', bucket: 'advance', amount: -100, kind: 'advance_to_fee', action_id: 'X', entry_date: '2026-11-13', created_at: '2026-11-13T10:00:00Z' },
    { id: 'f2', party: 'NextTrade Industries', bucket: 'fee', amount: 100, kind: 'advance_to_fee', action_id: 'X', entry_date: '2026-11-13', created_at: '2026-11-13T10:00:00Z' }
  ];
  var adj = M.periodAdjustments(E, '2026-11-01', '2026-11-30', { L1: 'professional_fees' }, { L1: '2026-11-05' });
  check('UD: starting balance $1,000 used first: $800 bill = none counted; $400 bill = $200 from it + $200 counted; the $100 fee counts in full', adj.used_from_opening === 1000 && adj.applied_to_bills === 200 && adj.fee_from_advance === 100 && adj.professional_fee_change === 300, adj);
  var adjOct = M.periodAdjustments(E, '2026-10-01', '2026-10-31', {}, {});
  check('UD: entering the starting balance itself changes nothing in the cash / tax view', adjOct.professional_fee_change === 0 && adjOct.advance_held === 0, adjOct);
})();
// v55.83-UD (Codex 12:20) — opening-funded money keeps that character through BOTH directions
(function () {
  var NT = 'NextTrade Industries';
  function e(id, bucket, amount, kind, date, extra) { return Object.assign({ id: id, party: NT, bucket: bucket, amount: amount, kind: kind, entry_date: date, created_at: date + 'T10:00:00Z' }, extra || {}); }
  function pair(id, kind, amt, date) { return kind === 'advance_to_fee' ? [e(id + 'a', 'advance', -amt, kind, date, { action_id: id }), e(id + 'f', 'fee', amt, kind, date, { action_id: id })] : [e(id + 'f', 'fee', -amt, kind, date, { action_id: id }), e(id + 'a', 'advance', amt, kind, date, { action_id: id })]; }
  var rt = [e('o', 'advance', 1000, 'opening_balance', '2026-10-01')].concat(pair('x1', 'advance_to_fee', 100, '2026-11-02'), pair('x2', 'fee_to_advance', 100, '2026-11-03'), [e('ap', 'advance', -1000, 'apply_to_bill', '2026-11-04')]);
  var a1 = M.periodAdjustments(rt, '2026-11-01', '2026-11-30', {}, {});
  check('UD round trip (Codex case): $1,000 starting balance → $100 fee → back → $1,000 bill paid: the professional fee does not move at all', a1.professional_fee_change === 0 && a1.applied_to_bills === 0 && a1.fee_from_advance === 0 && a1.fee_back_to_advance === 0, a1);
  var cp = [e('o', 'advance', 1000, 'opening_balance', '2026-10-01')].concat(pair('y1', 'advance_to_fee', 100, '2026-11-20'), pair('y2', 'fee_to_advance', 100, '2026-12-05'));
  var nov = M.periodAdjustments(cp, '2026-11-01', '2026-11-30', {}, {}); var dec = M.periodAdjustments(cp, '2026-12-01', '2026-12-31', {}, {});
  check('UD round trip across months: November 0 and December 0', nov.professional_fee_change === 0 && dec.professional_fee_change === 0, [nov, dec]);
  var nf = [e('s', 'fee', 100, 'payment_split', '2026-11-01', { bank_transaction_id: 'L9' })].concat(pair('z1', 'fee_to_advance', 100, '2026-11-10'));
  var a3 = M.periodAdjustments(nf, '2026-11-01', '2026-11-30', {}, { L9: '2026-11-01' });
  check('UD a NEW fee (from a payment) turned back into advance still reverses the fee (−100)', a3.fee_back_to_advance === 100 && a3.professional_fee_change === -100, a3);
  var mx = [e('o', 'advance', 1000, 'opening_balance', '2026-10-01'), e('s', 'advance', 500, 'payment_split', '2026-11-01', { bank_transaction_id: 'L8' })].concat(pair('m1', 'advance_to_fee', 1200, '2026-11-05'), pair('m2', 'fee_to_advance', 300, '2026-11-06'));
  var a4 = M.periodAdjustments(mx, '2026-11-01', '2026-11-30', {}, { L8: '2026-11-01' });
  check('UD mixed + partial: 1,200 to fee = 1,000 from the starting balance + 200 new (counted 200); 300 back = the 200 new first (−200) + 100 of the old (0) → net 0', a4.fee_from_advance === 200 && a4.fee_back_to_advance === 200 && a4.professional_fee_change === 0, a4);
  var co = [e('o', 'advance', 1000, 'opening_balance', '2026-10-01'), e('c', 'advance', -400, 'opening_balance', '2026-10-02'), e('s', 'advance', 500, 'payment_split', '2026-11-01', { bank_transaction_id: 'L7' }), e('ap', 'advance', -800, 'apply_to_bill', '2026-11-04')];
  var a5 = M.periodAdjustments(co, '2026-11-01', '2026-11-30', {}, { L7: '2026-11-01' });
  check('UD correction: starting balance 1,000 − 400 = 600; an $800 bill = 600 old + 200 counted', a5.applied_to_bills === 200 && a5.professional_fee_change === 200, a5);
})();
console.log('\nTX advances: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
