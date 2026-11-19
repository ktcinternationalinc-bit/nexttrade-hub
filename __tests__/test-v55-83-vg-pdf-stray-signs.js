// v55.83-VG — Codex QA 19 Nov 16:38 (P1): a DR / CR, minus or bracket printed in the money area that is NOT attached to a figure
// must never become harmless description text while the figure is accepted as proved. Either the correct signed movement comes
// through the gate, or zero rows do — never the reversed amount. Real reader + the gate. Codex's own fixture shape: every word 50
// wide, the standalone mark 10 wide.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var S = require(path.join(root, 'src/lib/pdf-statement.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('VG — PDF statements: sign markers that cannot be attached are refused');
function w(str, x, y, ww) { return { str: str, x: x, y: y, w: ww === undefined ? 50 : ww }; }
function gate(res) { var g = S.pdfRowsForImport(res, 'x.pdf'); return g.refused ? 'REFUSED' : g.rows.map(function (r) { return r.amount + '|' + r.description; }).join(';'); }
// opening 100.00 DR, CASH DEPOSIT 50.00, balance 50.00 DR, with the DR as its own word `gap` units after the figure (right edge 400)
function sepDR(gap) { return S.statementFromTextItems([[w('01/11/2026', 10, 700), w('OPENING BALANCE', 100, 700), w('100.00', 350, 700), w('DR', 400 + gap, 700, 10),
  w('02/11/2026', 10, 680), w('CASH DEPOSIT', 100, 680), w('50.00', 250, 680), w('50.00', 350, 680), w('DR', 400 + gap, 680, 10)]]); }
[0, 5, 30].forEach(function (g) { var r = sepDR(g);
  check('DR ' + g + ' units after the balance (inside the supported distance): attached → opening −100, movement +50, description clean', r.check.opening === -100 && gate(r) === '50|CASH DEPOSIT' && r.check.unsupported_marks === false, [r.check.opening, gate(r)]); });
[31, 35].forEach(function (g) { var r = sepDR(g);
  check('DR ' + g + ' units after the balance (outside it — Codex\'s reproduction at 35): NOT attached → refused, zero rows, never −50', r.importable === false && r.check.unsupported_marks === true && r.transactions.length === 0 && gate(r) === 'REFUSED', [r.check, gate(r)]); });
var col = S.statementFromTextItems([[w('01/11/2026', 10, 700), w('OPENING BALANCE', 100, 700), w('100.00', 350, 700), w('DR', 470, 700, 10),
  w('02/11/2026', 10, 680), w('CASH DEPOSIT', 100, 680), w('50.00', 250, 680), w('50.00', 350, 680), w('DR', 470, 680, 10),
  w('03/11/2026', 10, 660), w('CHEQUE', 100, 660), w('20.00', 250, 660), w('70.00', 350, 660), w('DR', 470, 660, 10)]]);
check('a separate DR / CR column far to the right of the balance: not a layout this reader attaches → refused, zero rows', col.importable === false && gate(col) === 'REFUSED' && col.check.unsupported_marks === true);
var between = S.statementFromTextItems([[w('01/11/2026', 10, 700), w('OPENING BALANCE', 100, 700), w('100.00', 350, 700),
  w('02/11/2026', 10, 680), w('CASH DEPOSIT', 100, 680), w('50.00', 250, 680), w('DR', 320, 680, 10), w('150.00', 350, 680)]]);
check('a DR between the amount and the balance, attached to the amount it follows: the amount is marked money OUT, which the balance contradicts → refused (not guessed)', between.importable === false && gate(between) === 'REFUSED', between.check);
var minus = S.statementFromTextItems([[w('01/11/2026', 10, 700), w('OPENING BALANCE', 100, 700), w('-', 335, 700, 6), w('100.00', 350, 700),
  w('02/11/2026', 10, 680), w('CASH DEPOSIT', 100, 680), w('50.00', 250, 680), w('-', 335, 680, 6), w('50.00', 350, 680)]]);
check('a minus printed as its own word before the balance: refused, zero rows (it is not dropped and the balance is not taken as positive)', minus.importable === false && minus.check.unsupported_marks === true && gate(minus) === 'REFUSED');
var bracket = S.statementFromTextItems([[w('01/11/2026', 10, 700), w('OPENING BALANCE', 100, 700), w('(', 340, 700, 5), w('100.00', 350, 700), w(')', 402, 700, 5),
  w('02/11/2026', 10, 680), w('CASH DEPOSIT', 100, 680), w('50.00', 250, 680), w('(', 340, 680, 5), w('50.00', 350, 680), w(')', 402, 680, 5)]]);
check('brackets printed as separate words around the balance: refused, zero rows', bracket.importable === false && gate(bracket) === 'REFUSED');
var mixed = S.statementFromTextItems([[w('01/11/2026', 10, 700), w('OPENING BALANCE', 100, 700), w('-100.00 CR', 350, 700), w('02/11/2026', 10, 680), w('CASH DEPOSIT', 100, 680), w('50.00', 250, 680), w('-50.00 CR', 350, 680)]]);
check('a balance carrying TWO signs at once ("-100.00 CR", Codex\'s second case): no established meaning → refused, zero rows', mixed.importable === false && mixed.check.unsupported_marks === true && gate(mixed) === 'REFUSED', mixed.check);
var mixedAmt = S.statementFromTextItems([[w('01/11/2026', 10, 700), w('OPENING BALANCE', 100, 700), w('100.00', 350, 700), w('02/11/2026', 10, 680), w('CASH DEPOSIT', 100, 680), w('(50.00) CR', 250, 680), w('150.00', 350, 680)]]);
check('an AMOUNT carrying two signs at once ("(50.00) CR") → refused', mixedAmt.importable === false && gate(mixedAmt) === 'REFUSED');
var elsewhere = S.statementFromTextItems([[w('01/11/2026', 10, 700), w('OPENING BALANCE', 100, 700), w('100.00', 350, 700),
  w('02/11/2026', 10, 680), w('CASH DEPOSIT', 100, 680), w('50.00', 250, 680), w('150.00', 350, 680), w('Balances are', 40, 640, 60), w('DR', 380, 640, 10)]]);
check('a DR in the money area on a line that is NOT a row (a note line): still refused — an unexplained sign anywhere near the money is not ignored', elsewhere.importable === false && elsewhere.check.unsupported_marks === true);
// what must still work
var words = S.statementFromTextItems([[w('01/11/2026', 10, 700), w('OPENING BALANCE', 100, 700), w('100.00', 350, 700),
  w('02/11/2026', 10, 680), w('TRANSFER DR AHMED CR NOTE', 100, 680, 130), w('50.00', 250, 680), w('150.00', 350, 680),
  w('03/11/2026', 10, 660), w('DR', 100, 660, 10), w('SAMIR FEE', 115, 660, 50), w('20.00', 250, 660), w('170.00', 350, 660)]]);
check('"DR" / "CR" as ordinary words INSIDE the description area do not refuse anything and stay in the description', words.importable === true && gate(words) === '50|TRANSFER DR AHMED CR NOTE;20|DR SAMIR FEE', [words.check, gate(words)]);
var attached = S.statementFromTextItems([[w('01/11/2026', 10, 700), w('OPENING BALANCE', 100, 700), w('100.00 DR', 350, 700), w('02/11/2026', 10, 680), w('CASH DEPOSIT', 100, 680), w('50.00', 250, 680), w('50.00 DR', 350, 680)]]);
check('the mark written in the SAME word as the figure ("100.00 DR") still works: +50', gate(attached) === '50|CASH DEPOSIT' && attached.check.opening === -100);
var plain = S.statementFromTextItems([[w('01/11/2026', 10, 700), w('OPENING BALANCE', 100, 700), w('100.00', 350, 700), w('02/11/2026', 10, 680), w('CASH DEPOSIT', 100, 680), w('50.00', 250, 680), w('150.00', 350, 680)]]);
check('a plain positive statement is unchanged: +50, importable', gate(plain) === '50|CASH DEPOSIT' && plain.check.unsupported_marks === false);
check('the refusal says why in plain words', /cannot attach to a figure with certainty/.test(S.statementRefusalText(sepDR(35).check)) && /Nothing from this PDF was added/.test(S.statementRefusalText(sepDR(35).check)));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
