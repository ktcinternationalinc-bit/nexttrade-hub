// v55.83-TH — Max, Nov 16: bills paid only from a real bank line (one line can pay several bills, the last one partly), undo a
// payment from the bills screen, and an audit that reads in plain words. Run: node __tests__/test-v55-83-th-bills-bank-pay-audit.js
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/bill-bank-pay.js'));
var A = require(path.join(root, 'src/lib/audit-words.js'));
var pass = 0; var failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }

console.log('one bank line, several bills');
var rem = P.bankLineRemaining(20000, [{ amount: 2831, voided: false }, { amount: 500, voided: true }]);
check('$20,000 line with $2,831 already used (a voided $500 does not count) → $17,169 free', rem.remaining === 17169 && rem.used === 2831, rem);
var al = P.allocateBankLine(20000, [{ bill_id: 'a', open: 14256.84 }, { bill_id: 'b', open: 3984.53 }, { bill_id: 'c', open: 2830.04 }, { bill_id: 'd', open: 100 }]);
check('first bills paid in full until the line runs out', al.lines[0].amount === 14256.84 && al.lines[1].amount === 3984.53, al.lines);
check('the bill where it runs out is paid PARTLY (1,758.63 of 2,830.04)', al.lines[2].amount === 1758.63 && al.lines[2].partial === true, al.lines[2]);
check('bills after that get nothing', al.lines[3].amount === 0 && al.lines[3].nothing_left === true);
check('exactly $20,000 used, nothing left', al.allocated === 20000 && al.left === 0, al);
var al2 = P.allocateBankLine(20000, [{ bill_id: 'a', open: 5000 }]);
check('less than the line → $15,000 stays free for more bills', al2.left === 15000 && al2.lines[0].partial === false);

console.log('what the server refuses');
var bank = { amount_abs: 20000, direction: 'out', pending: false };
check('no bank line → refused', !P.checkBankPayment(null, 0, [{ bill_id: 'a', amount: 1, open: 5 }]).ok);
check('money IN → refused', !P.checkBankPayment({ amount_abs: 100, direction: 'in' }, 0, [{ bill_id: 'a', amount: 1, open: 5, active: true }]).ok);
check('pending bank line → refused', !P.checkBankPayment({ amount_abs: 100, direction: 'out', pending: true }, 0, [{ bill_id: 'a', amount: 1, open: 5, active: true }]).ok);
var over = P.checkBankPayment(bank, 17000, [{ bill_id: 'a', amount: 3000.01, open: 5000, active: true }]);
check('more than is free on the line → refused with the free amount named', !over.ok && /3000\.00 of this bank transaction is still free/.test(over.errors.join(' ')), over);
check('more than a bill’s open balance → refused', !P.checkBankPayment(bank, 0, [{ bill_id: 'a', amount: 600, open: 500, active: true }]).ok);
check('a bill on a wire → refused (the wire pays it)', !P.checkBankPayment(bank, 0, [{ bill_id: 'a', amount: 100, open: 500, active: true, on_wire: 'WP-0006' }]).ok);
check('the same bill twice → refused', !P.checkBankPayment(bank, 0, [{ bill_id: 'a', amount: 100, open: 500, active: true }, { bill_id: 'a', amount: 100, open: 500, active: true }]).ok);
var ok = P.checkBankPayment(bank, 0, [{ bill_id: 'a', amount: 14256.84, open: 14256.84, active: true }, { bill_id: 'b', amount: 5743.16, open: 6000, active: true }]);
check('two bills = exactly $20,000 (last one partly) → accepted, nothing left', ok.ok && ok.total === 20000 && ok.left_after === 0, ok);

console.log('the server code');
var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
var recPay = route.slice(route.indexOf("if (action === 'record_payment')"), route.indexOf("if (action === 'void_payment')"));
check('record_payment refuses a payment without a bank line', /if \(!bankId\) \{ return NextResponse\.json\(\{ error: 'Pick the bank transaction that paid this bill/.test(recPay));
var voidPay = route.slice(route.indexOf("if (action === 'void_payment')"), route.indexOf("if (action === 'bank_lines_for_bills')"));
check('undo needs a reason', /vReason\.length < 5/.test(voidPay));
check('undo keeps the payment (voided = true), never deletes it', /update\(\{ voided: true \}\)/.test(voidPay) && !/\.delete\(/.test(voidPay));
check('a wire’s payment is undone in Wires (whole wire), not here', /This payment was recorded by an approved wire/.test(voidPay));
var payBank = route.slice(route.indexOf("if (action === 'pay_bills_from_bank')"), route.indexOf("if (action === 'bill_history')"));
check('several bills from one line are written in ONE insert (all or nothing)', (payBank.match(/\.insert\(/g) || []).length === 1 && /checkBankPayment\(/.test(payBank));
check('the new actions need Bills: Manage', /pay_bills_from_bank: 1, bank_lines_for_bills: 1/.test(route));
var tab = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
check('the bills screen no longer offers "No bank link (cash/other)"', tab.indexOf('No bank link (cash/other)') < 0);
check('the bills screen has ↩ Undo payment and 🕘 History on each row', tab.indexOf('↩ Undo payment') > 0 && tab.indexOf('🕘 History') > 0);

console.log('audit in plain words');
var d1 = A.describeAudit({ action: 'bill_payment_recorded', subject: 'NexPac Corporation bill 14481', details: { amount: 2831, paid_date: '2026-06-02', bank_transaction_id: 'x', partial: false }, refs: { bank: 'Jun 3, 2026 · $20,000.00 · WIRE OUT' } });
check('payment → "Recorded a payment of $2,831.00 on NexPac Corporation bill 14481"', d1.sentence === 'Recorded a payment of $2,831.00 on NexPac Corporation bill 14481', d1);
check('…with the date and the bank line as short facts', d1.facts.indexOf('Paid on Jun 2, 2026') >= 0 && d1.facts.indexOf('Bank line: Jun 3, 2026 · $20,000.00 · WIRE OUT') >= 0, d1.facts);
var d2 = A.describeAudit({ action: 'bill_payment_voided', subject: 'NexPac Corporation bill 14352', details: { amount: 14256.84, paid_date: '2026-06-03', reason: 'linked to the wrong bank line', open_after: 14256.84 } });
check('undo → names the amount, the bill and the reason', /^Undid a payment of \$14,256\.84 on NexPac Corporation bill 14352$/.test(d2.sentence) && d2.facts.indexOf('Reason: linked to the wrong bank line') >= 0, d2);
var d3 = A.describeAudit({ action: 'pl_customer_basis_set', subject: 'customer X', details: { from: 'EXW', to: 'CNF' } });
check('an unknown action still reads as words, with from → to', d3.sentence === 'Pl customer basis set — customer X' && d3.facts[0] === 'EXW → CNF', d3);
var d4 = A.describeAudit({ action: 'pl_invoice_terms_set', details: { from: { basis: 'EXW', embedded_transport: null }, to: { basis: 'CNF', embedded_transport: 500 } } });
check('object changes list only what changed', d4.facts.length === 2 && d4.facts[0] === 'basis: EXW → CNF' && d4.facts[1] === 'embedded transport: empty → 500', d4.facts);
check('time is shown in New York time, readable', A.niceWhen('2026-11-16T21:45:10Z') === 'Nov 16, 2026 · 4:45 PM', A.niceWhen('2026-11-16T21:45:10Z'));
var d5 = A.describeAudit({ action: 'wire_package_signoff_2', subject: 'WP-0006 to RTM Capital' });
check('2nd signature → "approved, ready to send"', /WP-0006 to RTM Capital — approved, ready to send/.test(d5.sentence), d5);

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
