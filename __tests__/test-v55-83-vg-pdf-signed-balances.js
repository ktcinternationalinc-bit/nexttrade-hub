// v55.83-VG — Codex QA 19 Nov 16:13 / 16:28 (P1): "DR overdraft balances are silently made positive and can reverse transaction
// signs." A balance printed "100.00 DR" (or in brackets, or with a minus) is an OVERDRAWN balance. Real reader + the gate.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var S = require(path.join(root, 'src/lib/pdf-statement.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('VG — PDF statements with overdrawn (DR) balances');
// Codex's fixture positions: dates x 10, descriptions x 100, amount right edge 300, balance right edge 400
function W(str, x, y) { return { str: str, x: x, y: y, w: str.length * 5 }; }
function R(str, right, y) { return { str: str, x: right - str.length * 5, y: y, w: str.length * 5 }; }
function one(open, rows) { var items = [W('30SEP26', 10, 700), W('OPENING BALANCE', 100, 700), R(open, 400, 700)]; var y = 680;
  rows.forEach(function (r) { items.push(W(r[0], 10, y), W(r[1], 100, y), R(r[2], 300, y)); if (r[3]) { items.push(R(r[3], 400, y)); } y -= 20; }); return S.statementFromTextItems([items]); }
function amounts(res) { return res.transactions.map(function (t) { return t.amount; }); }
function through(res) { var g = S.pdfRowsForImport(res, 'x.pdf'); return g.refused ? 'REFUSED' : g.rows.map(function (r) { return r.amount; }).join(','); }

var a = one('100.00 DR', [['01OCT26', 'CASH DEPOSIT', '50.00', '50.00 DR']]);
check('Codex\'s case: opening 100.00 DR, CASH DEPOSIT 50.00, balance 50.00 DR → opening −100, movement +50 (it was −50), through the gate +50', a.check.opening === -100 && JSON.stringify(amounts(a)) === '[50]' && a.importable === true && through(a) === '50', [a.check, amounts(a)]);
var b = one('100.00 DR', [['01OCT26', 'CHEQUE 55', '30.00', '130.00 DR']]);
check('overdrawn and going FURTHER overdrawn: withdrawal 30.00, 100.00 DR → 130.00 DR → −30', JSON.stringify(amounts(b)) === '[-30]' && b.importable === true && through(b) === '-30', amounts(b));
var c = one('100.00 DR', [['01OCT26', 'TRANSFER IN', '250.00', '150.00 CR']]);
check('crossing from overdrawn to positive: 100.00 DR + 250.00 → 150.00 CR → +250', JSON.stringify(amounts(c)) === '[250]' && c.importable === true && c.check.closing === null, amounts(c));
var d = one('100.00 CR', [['01OCT26', 'WIRE OUT', '250.00', '150.00 DR'], ['02OCT26', 'DEPOSIT', '400.00', '250.00 CR']]);
check('crossing from positive to overdrawn and back: 100.00 CR − 250.00 → 150.00 DR, + 400.00 → 250.00 CR → −250, +400', JSON.stringify(amounts(d)) === '[-250,400]' && d.importable === true && through(d) === '-250,400', amounts(d));
var e = one('(100.00)', [['01OCT26', 'DEPOSIT', '50.00', '(50.00)'], ['02OCT26', 'CHEQUE', '20.00', '-70.00']]);
check('overdrawn balances in BRACKETS and with a MINUS: (100.00) + 50 → (50.00), − 20 → -70.00 → +50, −20', e.check.opening === -100 && JSON.stringify(amounts(e)) === '[50,-20]' && e.importable === true, [e.check.opening, amounts(e)]);
// the DR / CR printed as its OWN word after the figure
var sep = S.statementFromTextItems([[W('30SEP26', 10, 700), W('OPENING BALANCE', 100, 700), R('100.00', 385, 700), W('DR', 388, 700),
  W('01OCT26', 10, 680), W('CASH DEPOSIT', 100, 680), R('50.00', 300, 680), R('50.00', 385, 680), W('DR', 388, 680)]]);
check('"DR" as a separate word right after the balance is read as part of the balance (−100 → −50, movement +50) and is not put in the description', sep.check.opening === -100 && JSON.stringify(amounts(sep)) === '[50]' && sep.transactions[0].description === 'CASH DEPOSIT' && sep.importable === true, [sep.check.opening, sep.transactions]);
// marks on the AMOUNT are evidence of direction, never a second minus
var m1 = one('1,000.00 CR', [['01OCT26', 'A', '100.00 DR'], ['02OCT26', 'B', '100.00 CR', '1,000.00 CR']]);
check('one amount column with DR / CR on the amounts: A 100.00 DR, B 100.00 CR, balance back to 1,000 → −100, +100 (the marks settle what the balance alone could not)', JSON.stringify(amounts(m1)) === '[-100,100]' && m1.importable === true && m1.check.two_readings_fit === false, [amounts(m1), m1.check]);
var m2 = one('1,000.00 CR', [['01OCT26', 'A', '100.00 DR', '1,100.00 CR']]);
check('a marked amount that the balance contradicts (100.00 DR but the balance goes UP) → not importable, zero rows, refused', m2.importable === false && m2.transactions.length === 0 && through(m2) === 'REFUSED', m2.check);
var m3 = one('1,000.00 CR', [['01OCT26', 'A', '(100.00)', '900.00 CR']]);
check('an amount in brackets / with a minus in the amount column is not a supported convention → refused with that reason, zero rows', m3.importable === false && m3.check.unsupported_marks === true && through(m3) === 'REFUSED' && /DR \/ CR, a minus or brackets/.test(S.statementRefusalText(m3.check)), m3.check);
// three columns: a mark that contradicts the proved direction
function three(rows) { var items = [W('30SEP26', 10, 700), W('OPENING BALANCE', 100, 700), R('1,000.00', 400, 700)]; var y = 680;
  rows.forEach(function (r) { items.push(W(r[0], 10, y), W(r[1], 100, y)); if (r[2]) { items.push(R(r[2], 250, y)); } if (r[3]) { items.push(R(r[3], 320, y)); } if (r[4]) { items.push(R(r[4], 400, y)); } y -= 20; }); return S.statementFromTextItems([items]); }
var t1 = three([['01OCT26', 'A', '100.00', null, '900.00'], ['02OCT26', 'B', null, '40.00', '940.00']]);
check('three columns, plain figures: unchanged (−100, +40)', JSON.stringify(amounts(t1)) === '[-100,40]' && t1.importable === true);
var t2 = three([['01OCT26', 'A', '100.00 CR', null, '900.00'], ['02OCT26', 'B', null, '40.00', '940.00']]);
check('three columns where the money-OUT column carries a CR mark → the convention is not understood → refused, zero rows', t2.importable === false && t2.check.unsupported_marks === true && through(t2) === 'REFUSED', t2.check);
var t3 = three([['01OCT26', 'A', '100.00', null, '100.00 DR'], ['02OCT26', 'B', null, '300.00', '200.00 CR']]);
check('three columns where the printed balances cannot be reached from the opening balance either way (1,000 then 100.00 DR then 200.00 CR) → refused, never forced', t3.importable === false && through(t3) === 'REFUSED', t3.check);
var t4 = (function () { var items = [W('30SEP26', 10, 700), W('OPENING BALANCE', 100, 700), R('50.00 DR', 400, 700), W('01OCT26', 10, 680), W('A', 100, 680), R('100.00', 250, 680), R('150.00 DR', 400, 680), W('02OCT26', 10, 660), W('B', 100, 660), R('400.00', 320, 660), R('250.00 CR', 400, 660)]; return S.statementFromTextItems([items]); })();
check('three columns from an overdrawn opening: 50.00 DR − 100 → 150.00 DR, + 400 → 250.00 CR → −100, +400, importable', t4.check.opening === -50 && JSON.stringify(amounts(t4)) === '[-100,400]' && t4.importable === true, [t4.check, amounts(t4)]);
// the small rule
check('figure rule: "100.00 DR" → 10000 DR · "100.00 CR" → CR · "(100.00)" and "-100.00" → NEG · "1,850,000.00" → no mark · an account number → not money',
  JSON.stringify(S.parseStatementFigure('100.00 DR')) === '{"mag":10000,"mark":"DR"}' && S.parseStatementFigure('100.00 cr.').mark === 'CR' && S.parseStatementFigure('(100.00)').mark === 'NEG' && S.parseStatementFigure('(100.00)').mag === 10000 &&
  S.parseStatementFigure('-100.00').mark === 'NEG' && S.parseStatementFigure('1,850,000.00').mark === null && S.parseStatementFigure('1,850,000.00').mag === 185000000 && S.parseStatementFigure('100055915096') === null && S.parseStatementFigure('') === null);
check('positive statements are unchanged: opening 1,000.00 + 50 → 1,050.00 → +50', JSON.stringify(amounts(one('1,000.00', [['01OCT26', 'DEPOSIT', '50.00', '1,050.00']]))) === '[50]');
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
