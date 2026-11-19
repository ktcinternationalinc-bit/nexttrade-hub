// v55.83-VG — Codex QA 19 Nov 15:48 / 16:03 (P1, twice) on the PDF bank statement import:
//   "an amber warning is not an import safety gate" · "DIRECTION IS PROVED is false for this case" · "zero writes when unresolved".
// Real functions: the reader, THE GATE (pdfRowsForImport), the second lock (importBlockedByPdf) and the duplicate classification
// (moved word for word out of the screen so it can be tested: the same statement imported from Excel, then from PDF).
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var S = require(path.join(root, 'src/lib/pdf-statement.js'));
var D = require(path.join(root, 'src/lib/egypt-bank-duplicates.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('VG — PDF import gate: nothing is saved unless every row is proved');
function W(str, x, y) { return { str: str, x: x, y: y, w: str.length * 5 }; }
function R(str, right, y) { return { str: str, x: right - str.length * 5, y: y, w: str.length * 5 }; }
var OPEN = [W('30SEP26', 41, 500), W('OPENING BALANCE', 150, 500), R('1,000.00', 570, 500)];
// the import as the screen does it: gate → (preview) → second lock → write. `written` counts what reaches the database.
function importLikeTheScreen(res, name, tamper) {
  var gate = S.pdfRowsForImport(res, name); var rows = gate.rows.slice();
  if (tamper) { rows = tamper(rows, res); }
  var toImport = rows.filter(function (r) { return r._include; });
  var block = S.importBlockedByPdf(toImport);
  var written = block ? [] : toImport;
  return { gate: gate, block: block, written: written };
}

// ── Codex 15:48: ONE amount column, opening 1,000, A 100 (no balance), B 100 ending 1,000 → +100/−100 and −100/+100 both fit
var one = S.statementFromTextItems([OPEN.concat([W('01OCT26', 41, 480), W('A', 150, 480), R('100.00', 486, 480), W('02OCT26', 41, 460), W('B', 150, 460), R('100.00', 486, 460), R('1,000.00', 570, 460)])]);
check('one column, two readings fit → direction NOT proved, check NOT ok, not importable (it used to say proved)', one.ok === true && one.importable === false && one.check.direction_proved === false && one.check.two_readings_fit === true && one.check.ok === false, one.check);
check('…no signed amounts are handed over, and the two rows are REPORTED as unresolved (not silently dropped)', one.transactions.length === 0 && one.unresolved.length === 2 && one.unresolved[0].description === 'A' && one.unresolved[0].figure === 100 && one.check.rows_without_a_proved_sign === 2, one.unresolved);
var i1 = importLikeTheScreen(one, 'one.pdf');
check('…through the screen\'s steps: refused with the reason, ZERO rows written', i1.gate.refused === true && i1.written.length === 0 && /fit BOTH ways round/.test(i1.gate.reason) && /Nothing from this PDF was added/.test(i1.gate.reason), i1.gate.reason);
// ── Codex 16:03: THREE money columns, A 100 in column 1 (no balance), B 100 in column 2 ending 1,000 → both orientations reconcile
var three = S.statementFromTextItems([OPEN.concat([W('01OCT26', 41, 480), W('A', 150, 480), R('100.00', 424, 480), W('02OCT26', 41, 460), W('B', 150, 460), R('100.00', 486, 460), R('1,000.00', 570, 460),
  W('03OCT26', 41, 440), W('C', 150, 440), R('5.00', 424, 440), W('04OCT26', 41, 420), W('D', 150, 420), R('5.00', 486, 420), R('1,000.00', 570, 420)])]);
check('three columns, both orientations reconcile → NOT proved, NOT importable, zero signed amounts, 4 rows reported unresolved', three.importable === false && three.check.direction_proved === false && three.check.two_readings_fit === true && three.transactions.length === 0 && three.unresolved.length === 4, three.check);
var i3 = importLikeTheScreen(three, 'three.pdf');
check('…through the screen\'s steps: preselected 0, rows sent to the database 0 (Codex saw 2 and 2)', i3.gate.rows.length === 0 && i3.written.length === 0 && i3.gate.refused === true);
// the same statement with ONE more printed balance settles it
var settled = S.statementFromTextItems([OPEN.concat([W('01OCT26', 41, 480), W('A', 150, 480), R('100.00', 424, 480), R('900.00', 570, 480), W('02OCT26', 41, 460), W('B', 150, 460), R('100.00', 486, 460), R('1,000.00', 570, 460)])]);
check('with a balance after A the direction IS proved (A −100, B +100) and the rows are importable', settled.importable === true && settled.check.direction_proved === true && JSON.stringify(settled.transactions.map(function (t) { return t.amount; })) === '[-100,100]', settled.check);

// ── a balance that disagrees, a cut file, rows after the last balance: all refused, zero writes
var mism = S.statementFromTextItems([OPEN.concat([W('01OCT26', 41, 480), W('A', 150, 480), R('100.00', 424, 480), R('900.00', 570, 480), W('02OCT26', 41, 460), W('B', 150, 460), R('100.00', 486, 460), R('1,050.00', 570, 460)])]);
check('a printed balance that disagrees → refused, zero rows written, the bank\'s figure named', importLikeTheScreen(mism, 'm.pdf').written.length === 0 && mism.importable === false && /1 printed balance does not agree/.test(S.statementRefusalText(mism.check)) && /1,050\.00/.test(S.statementRefusalText(mism.check)));
var page1 = OPEN.concat([W('01OCT26', 41, 480), W('A', 150, 480), R('100.00', 424, 480), R('900.00', 570, 480)]);
var page3 = [W('05OCT26', 41, 480), W('E', 150, 480), R('50.00', 486, 480), R('1,200.00', 570, 480), W('CLOSING BALANCE', 150, 460), R('1,200.00', 570, 460)];
var missing = S.statementFromTextItems([page1, page3]); // page 2 (a +250 row) was not in the file
check('a file with a page missing in the middle → the next printed balance does not agree → refused, zero rows written', missing.importable === false && importLikeTheScreen(missing, 'cut.pdf').written.length === 0 && missing.check.mismatches.length >= 1, missing.check);
var tail = S.statementFromTextItems([OPEN.concat([W('01OCT26', 41, 480), W('A', 150, 480), R('100.00', 424, 480), R('900.00', 570, 480), W('02OCT26', 41, 460), W('B', 150, 460), R('100.00', 486, 460), R('1,000.00', 570, 460), W('03OCT26', 41, 440), W('C', 150, 440), R('30.00', 424, 440)])]);
check('rows after the LAST printed balance with no closing line (a file cut short at the end) → refused, with that reason', tail.importable === false && tail.check.rows_after_the_last_balance === 1 && /not covered by any printed balance/.test(S.statementRefusalText(tail.check)) && importLikeTheScreen(tail, 't.pdf').written.length === 0, tail.check);
var tailOk = S.statementFromTextItems([OPEN.concat([W('01OCT26', 41, 480), W('A', 150, 480), R('100.00', 424, 480), R('900.00', 570, 480), W('02OCT26', 41, 460), W('B', 150, 460), R('100.00', 486, 460), R('1,000.00', 570, 460), W('03OCT26', 41, 440), W('C', 150, 440), R('30.00', 424, 440), W('CLOSING BALANCE', 150, 420), R('970.00', 570, 420)])]);
check('…the same rows followed by a closing balance that matches → importable (3 rows)', tailOk.importable === true && tailOk.transactions.length === 3 && tailOk.check.closing_agrees === true);

// ── the second lock: a PDF row without its proof mark blocks the WHOLE import, whatever the screen state
var good = importLikeTheScreen(settled, 'ok.pdf');
check('a proved statement goes through: 2 rows, each marked as a proved PDF row with its file name', good.written.length === 2 && good.written.every(function (r) { return r._src === 'pdf' && r._pdfOk === true && r._pdfFile === 'ok.pdf' && r._include === true; }) && good.block === '');
var forged = importLikeTheScreen(settled, 'ok.pdf', function (rows) { return rows.concat([{ date: '2026-10-09', description: 'slipped in', amount: -999, _include: true, _src: 'pdf' }]); });
check('one PDF row without the proof mark among proved ones → the whole import is stopped, zero rows written', forged.written.length === 0 && /1 row from a PDF statement is not proved/.test(forged.block) && /Nothing was saved/.test(forged.block));
check('rows from Excel (no PDF mark at all) are not affected by this lock', S.importBlockedByPdf([{ date: '2026-10-01', description: 'x', amount: 5, _include: true }]) === '' && S.importBlockedByPdf([]) === '' && S.importBlockedByPdf(null) === '');
check('an unreadable PDF and a missing result are refused by the gate with no rows', S.pdfRowsForImport({ ok: false, error: 'No dated lines were found in this PDF.' }, 's.pdf').rows.length === 0 && S.pdfRowsForImport(null, 's.pdf').refused === true && /s\.pdf: No dated lines/.test(S.pdfRowsForImport({ ok: false, error: 'No dated lines were found in this PDF.' }, 's.pdf').reason));
check('the refusal shown to a person who may NOT see bank balances carries no amounts', (function () { var g = S.pdfRowsForImport(mism, 'm.pdf'); return g.note && g.note.ok === false && !/\d[\d,]*\.\d{2}/.test(g.note.short) && /•••/.test(g.note.short) && /1,050\.00/.test(g.note.text); })());

// ── the same statement: imported from EXCEL earlier, now from PDF
var excelRows = [{ id: 'e1', date: '2026-10-04', description: 'Outward Swift Charges FT26277RSPSR\\BNK AC-100055915096', amount: -350, account_id: 'acc' },
  { id: 'e2', date: '2026-10-04', description: 'Outward FT26277RSPSR\\BNK', amount: -2000000, account_id: 'acc' },
  { id: 'e3', date: '2026-10-29', description: 'Credit Interest', amount: 1215437.85, account_id: 'acc' }];
var pdfRows = [{ date: '2026-10-04', description: 'Outward Swift Charges FT26277RSPSR\\BNK AC-100055915096', amount: -350, _include: true, _src: 'pdf', _pdfOk: true },   // identical text
  { date: '2026-10-04', description: 'Outward FT26277RSPSR\\BNK FT26100029985727', amount: -2000000, _include: true, _src: 'pdf', _pdfOk: true },                       // PDF joins a second line
  { date: '2026-10-29', description: 'Credit Interest 100055915096-20261031', amount: 1215437.85, _include: true, _src: 'pdf', _pdfOk: true },                          // longer text
  { date: '2026-10-30', description: 'Something new', amount: -12.5, _include: true, _src: 'pdf', _pdfOk: true }];
var cl = D.classifyAgainstExisting(pdfRows, excelRows);
check('PDF after Excel: identical line → EXACT duplicate, skipped', cl[0].status === 'exact' && cl[0].decision === 'skip' && cl[0].matches[0].id === 'e1', cl[0]);
check('PDF after Excel: same date and amount but a longer / different description → POSSIBLE duplicate, held for a person (never imported by itself)', cl[1].status === 'possible' && cl[1].decision === 'review' && cl[2].status === 'possible' && cl[2].decision === 'review' && cl[2].matches[0].id === 'e3', [cl[1].status, cl[2].status]);
check('PDF after Excel: a line that really is new → clean', cl[3].status === 'clean' && cl[3].decision === 'import');
check('so re-importing a statement already in the bank table from PDF auto-imports NOTHING that shares a date and amount with an existing line', cl.filter(function (c) { return c.decision === 'import'; }).length === 1);
check('nothing in the bank table yet → all clean; the classification leaves the rows themselves untouched (proof marks kept)', D.classifyAgainstExisting(pdfRows, []).every(function (c) { return c.status === 'clean' && c.row._pdfOk === true; }));
var tab = fs.readFileSync(path.join(root, 'src/components/EgyptBankTab.jsx'), 'utf8'); var lib = fs.readFileSync(path.join(root, 'src/lib/egypt-bank-duplicates.js'), 'utf8');
check('the screen uses the moved classification (runtime import present) and no longer carries its own copy', /import \{ classifyAgainstExisting \} from '\.\.\/lib\/egypt-bank-duplicates';/.test(tab) && tab.indexOf('return classifyAgainstExisting(toImport, allExisting);') > 0 && tab.indexOf('var exactIndex = {};') < 0 && lib.indexOf('var exactIndex = {};') > 0 && lib.indexOf("return { row: row, status: 'exact', matches: exactMatches, decision: 'skip' };") > 0);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
