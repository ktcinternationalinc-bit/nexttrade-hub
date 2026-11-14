// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SM — Open Accounts statement (print + Excel). Max, Nov 14 2026, on the El Sayad statement:
//   "Should we add 2 columns to have the running EGP and usd balance after RAC transaction as well"
//   "if EGP only then Show only EGP transactions and balances. Same for usd"
//   "Color coded so the invoice is geeen and the billed is red"
//   "Mirrored colors for customer copy. But everything else you recommended"
// The statement model is run for real on the El Sayad-shaped ledger (closing balances EGP they owe 34,795.41,
// USD we owe 10,961.03). The older print/Excel layouts stay in open-account-export.js only as a fallback behind
// opts.legacy === true — earlier tests that pin those strings are pinning the fallback, not what people now see.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var S = require(path.join(root, 'src/lib/statement-view.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
var E = [
  { id: '1', entry_date: '2025-03-14', transaction_type: 'sales_invoice', credit_amount: 120000, currency: 'EGP', reference_number: 'INV-1041', description: 'Flooring order', notes: 'internal: chase Ahmed' },
  { id: '2', entry_date: '2025-04-02', transaction_type: 'vendor_bill', debit_amount: 18500, currency: 'USD', reference_number: 'BILL-220', description: 'PVC leather rolls' },
  { id: '3', entry_date: '2025-05-20', transaction_type: 'payment_received', credit_amount: 60000, currency: 'EGP', reference_number: 'RCPT-9', description: 'Bank transfer' },
  { id: '4', entry_date: '2025-07-11', transaction_type: 'payment_sent', debit_amount: 7538.97, currency: 'USD', reference_number: 'WIRE-3', description: 'Wire' },
  { id: '5', entry_date: '2025-09-03', transaction_type: 'sales_invoice', credit_amount: 44795.41, currency: 'EGP', reference_number: 'INV-1188', description: 'Second order <b>x</b>' },
  { id: '6', entry_date: '2026-01-15', transaction_type: 'payment_received', credit_amount: 70000, currency: 'EGP', reference_number: 'RCPT-14', description: 'Bank transfer' },
];
var acc = { account_name: 'El Sayad', account_name_ar: 'الصياد', notes: 'Internal note: slow payer' };
var ent = { entity_name: 'KTC Egypt for Import & Export' };
var O = { today: '2026-10-13', generatedAt: '2026-10-13 09:00' };
function B(o) { return S.buildStatement(acc, ent, E, Object.assign({}, O, o || {})); }
var GREEN = '#15803d', RED = '#b91c1c';
console.log('SM — statement with running balances');
var m = B({ layout: 'combined' });
check('1: both currencies end on the statement figures: EGP they owe us 34,795.41, USD we owe them 10,961.03',
  m.summary.EGP.closing.words === 'they owe us' && m.summary.EGP.closing.amount === '34,795.41' && m.summary.USD.closing.words === 'we owe them' && m.summary.USD.closing.amount === '10,961.03', m.summary);
check('2: every row carries a balance for EVERY currency; only the row\'s own currency is active, the other holds its last value',
  m.rows.every(function (r) { return r.balances.EGP && r.balances.USD && r.balances[r.currency].active === true; })
  && m.rows[1].balances.EGP.active === false && m.rows[1].balances.EGP.amount === '120,000.00' && m.rows[2].balances.USD.amount === '18,500.00');
check('3: the last row\'s running balances equal the closing balances (the statement ties out)',
  Math.abs(m.rows[5].balances.EGP.value - 34795.41) < 0.005 && Math.abs(m.rows[5].balances.USD.value + 10961.03) < 0.005);
check('4: internal colours — our invoice green, their bill red, payments neutral grey',
  m.rows[0].color === GREEN && m.rows[1].color === RED && m.rows[2].color === '#475569' && m.rows[2].they.side === 'none');
check('5: a payment is a reduction in its own column with plain words — never a new amount owed',
  m.rows[2].they.minus === true && m.rows[2].they.note === 'they owe us less' && m.rows[3].we.minus === true && m.rows[3].we.note === 'we owe them less' && m.rows[3].they === null);
check('6: still open — only unpaid items, oldest facts shown with their age in days',
  m.stillOpen.length === 2 && m.stillOpen[0].ref === 'BILL-220' && m.stillOpen[0].days === 559 && Math.abs(m.stillOpen[0].amount - 10961.03) < 0.005
  && m.stillOpen[1].ref === 'INV-1188' && m.stillOpen[1].days === 405 && Math.abs(m.stillOpen[1].amount - 34795.41) < 0.005, m.stillOpen);
check('7: each summary box shows how the balance is built, and the lines add up to the big number',
  ['EGP', 'USD'].every(function (c) { var s = m.summary[c]; var t = s.lines.reduce(function (a, l) { return a + l.value; }, 0); return Math.abs(t - Math.abs(s.closing.value)) < 0.005; }), m.summary);
var c = B({ layout: 'combined', perspective: 'customer' });
check('8: customer copy — SAME numbers, wording from their side ("you owe KTC" / "KTC owes you")',
  c.summary.EGP.closing.amount === '34,795.41' && c.summary.EGP.closing.words === 'you owe KTC' && c.summary.USD.closing.words === 'KTC owes you'
  && c.rows[0].typeLabel === 'Invoice from KTC' && c.rows[1].typeLabel === 'Your bill to KTC' && c.rows[2].typeLabel === 'Your payment' && c.rows[3].typeLabel === 'Payment from KTC');
check('9: customer copy — colours MIRRORED: what they owe is red, what KTC owes them is green',
  c.rows[0].color === RED && c.rows[1].color === GREEN && c.summary.EGP.closing.color === RED && c.summary.USD.closing.color === GREEN && c.rows[2].color === '#475569');
check('10: customer copy drops internal notes (account note and entry notes); the internal copy keeps them',
  c.accountNotes === '' && c.rows[0].note === '' && m.accountNotes !== '' && m.rows[0].note === 'internal: chase Ahmed');
var e = B({ currency: 'EGP', layout: 'combined' });
check('11: EGP only → only EGP rows, only the EGP balance, only the EGP summary and open items',
  JSON.stringify(e.currencies) === '["EGP"]' && e.rows.length === 4 && e.rows.every(function (r) { return r.currency === 'EGP' && !r.balances.USD; })
  && !e.summary.USD && e.stillOpen.length === 1 && e.stillOpen[0].currency === 'EGP' && e.filtered === true);
var u = B({ currency: 'USD' });
check('12: USD only → the same the other way round', JSON.stringify(u.currencies) === '["USD"]' && u.rows.length === 2 && !u.summary.EGP && u.summary.USD.closing.amount === '10,961.03');
var hi = S.statementHtml(m), hc = S.statementHtml(c), he = S.statementHtml(e);
check('13: printed page has one balance column per currency, and the column widths add up to exactly 100% (the old page gave the balance columns zero width)',
  hi.indexOf('EGP balance') > 0 && hi.indexOf('USD balance') > 0 && (function () {
    var cg = hi.match(/<colgroup>(.*?)<\/colgroup>/)[1]; var t = 0; cg.replace(/width:(\d+)%/g, function (_, n) { t += Number(n); }); return t === 100; })());
check('14: combined two-currency page prints landscape; a single-currency page prints portrait', hi.indexOf('A4 landscape') > 0 && he.indexOf('A4 portrait') > 0);
check('15: clear banner on each copy; EGP-only page says so and has no USD column or box',
  hi.indexOf('Internal — not for sending') > 0 && hc.indexOf('Customer copy') > 0 && he.indexOf('EGP only') > 0 && he.indexOf('USD balance') < 0 && he.indexOf('we owe them</div>') < 0);
check('16: the old Credit/Debit footer is gone; the legend matches the headings; currencies are never added together',
  hi.indexOf('Credit</strong>') < 0 && hi.indexOf('How to read this') > 0 && hi.indexOf('never added together') > 0 && hc.indexOf('&quot;you owe KTC&quot;') < 0 && hc.indexOf('"you owe KTC"') > 0);
check('17: text from the ledger is escaped on the page', hi.indexOf('<b>x</b>') < 0 && hi.indexOf('&lt;b&gt;x&lt;/b&gt;') > 0);
check('18: readable — explicit dark text on white; no opacity tricks on text', hi.indexOf('color:#0f172a') > 0 && hi.indexOf('opacity') < 0);
var bi = S.statementHtml(B({ layout: 'combined', perspective: 'customer', bilingual: true }));
check('19: bilingual copy carries the Arabic headings', bi.indexOf('مستحق عليكم') > 0 && bi.indexOf('نسخة العميل') > 0 && bi.indexOf('الرصيد') > 0);
var sh = S.statementSheet(m), hr = sh.rows[sh.headerRow];
check('20: Excel matches — a balance column per currency, payments negative in their own column, money stays numeric',
  hr.length === 10 && /^EGP balance/.test(hr[8]) && /^USD balance/.test(hr[9]) && sh.rows[sh.headerRow + 3][5] === -60000 && sh.rows[sh.headerRow + 4][6] === -7538.97
  && sh.rows[sh.headerRow + 6][8] === 34795.41 && sh.rows[sh.headerRow + 6][9] === -10961.03, hr);
var she = S.statementSheet(e);
check('21: Excel follows the currency tab too (EGP only → one balance column, no USD rows)',
  she.rows[she.headerRow].length === 9 && she.rows.every(function (r) { return r[4] !== 'USD'; }));
// offset between an invoice and a bill: hidden as a row, explained in full on both documents
var EO = [
  { id: 'i1', entry_date: '2026-01-01', transaction_type: 'sales_invoice', credit_amount: 1000, currency: 'EGP', reference_number: 'INV-1' },
  { id: 'b1', entry_date: '2026-01-02', transaction_type: 'vendor_bill', debit_amount: 400, currency: 'EGP', reference_number: 'BILL-1' },
  { id: 'o1', entry_date: '2026-01-03', transaction_type: 'offset', debit_amount: 400, currency: 'EGP', offset_invoice_id: 'i1', offset_bill_id: 'b1' },
  { id: 'o2', entry_date: '2026-01-03', transaction_type: 'offset', credit_amount: 400, currency: 'EGP', offset_invoice_id: 'i1', offset_bill_id: 'b1' },
];
var mo = S.buildStatement(acc, ent, EO, Object.assign({}, O, { applications: { i1: 400, b1: 400 } }));
check('22: offsets are not rows; the bill reads "Settled by offset against our invoice INV-1" in full (it used to be cut off), and the balance is 600',
  mo.rows.length === 2 && mo.rows[1].link.text === 'Settled by offset against our invoice INV-1' && mo.rows[0].link.text === 'Partly settled by offset against their bill BILL-1'
  && mo.rows[1].open.state === 'paid' && Math.abs(mo.rows[0].open.amount - 600) < 0.005 && mo.summary.EGP.closing.amount === '600.00', mo.rows.map(function (r) { return r.link; }));
check('23: bad input never throws', S.buildStatement(null, null, null).rows.length === 0 && typeof S.statementHtml(S.buildStatement({}, null, [{}])) === 'string');
var X = R('src/lib/open-account-export.js'), TAB = R('src/components/OpenAccountsTab.jsx');
check('24: print and Excel both use the one statement model; no browser pop-up message on this path',
  X.indexOf('statementHtml(smModel)') > 0 && X.indexOf('statementSheet(smModel)') > 0 && X.indexOf("reason: 'popup_blocked'") > 0);
check('25: the screen passes the currency tab to print and Excel, and the tab also filters the tiles and the summary',
  (TAB.match(/currency: ledgerCurFilter\[account\.id\] \|\| 'ALL'/g) || []).length === 2 && (TAB.match(/var f = ledgerCurFilter\[a\.id\] \|\| 'ALL'; return f === 'ALL' \|\| f === cur;/g) || []).length === 2);
check('26: on screen — invoice green / bill red, mirrored in the customer view; payments grey with a minus',
  TAB.indexOf("txnType === 'sales_invoice' ? (smCust ? 'text-red-700' : 'text-emerald-700')") > 0 && TAB.indexOf("<span className=\"text-slate-600\">− {fmtNum(s.ap)}</span>") > 0);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
