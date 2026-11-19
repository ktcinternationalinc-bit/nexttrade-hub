// v55.83-VI — Codex QA 19 Nov 17:18 / 18:48 (two P2 on the several-files import):
//   1. one earlier line was allowed to cover TWO lines of a later file (once as "same date and amount", once as "same line");
//   2. a copy unticked beyond row 200 could not be seen, so it could not be ticked back.
// Part 1 runs the real matching on Codex's own reproduction, both row orders, 2-vs-3, three files, same file name.
// Part 2 drives the REAL preview component (src/components/EgyptBankImportPreview.jsx): it is rendered, its own buttons and
// tick boxes are found in what it rendered and pressed, and the rows that would be written are taken from the same functions the
// screen uses. Synthetic rows only; nothing is read from or written to any database.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var React = require('react'); var RS = require('react-dom/server');
global.React = React; // the test loader compiles JSX to React.createElement (the app's own build does not need this)
var S = require(path.join(root, 'src/lib/pdf-statement.js'));
var D = require(path.join(root, 'src/lib/egypt-bank-duplicates.js'));
var M = require(path.join(root, 'src/lib/egypt-bank-multi-file.js'));
var Preview = require(path.join(root, 'src/components/EgyptBankImportPreview.jsx')).default;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1200))); }
console.log('VI — several files: one earlier line covers one later line; every row can be reached and ticked');
function file(name, rows) { return { name: name, kind: 'sheet', refused: false, rows: rows.map(function (r, i) { return { date: r[0], description: r[1], amount: r[2], _include: true, _row: i + 1 }; }) }; }
function marks(combined, ix) { return combined.rows.filter(function (r) { return r._fileIx === ix; }).map(function (r) { return r.description + ':' + (r._crossDup || 'none') + ':' + (r._include ? 'ticked' : 'unticked'); }).join(' | '); }

// ── 1. one occurrence, one use
var d = '2026-11-01';
var codex = M.combineFiles([file('first.csv', [[d, 'FEE A', -10]]), file('second.csv', [[d, 'FEE B', -10], [d, 'FEE A', -10]])]);
check('Codex\'s reproduction — first: one FEE A; second: FEE B then FEE A → FEE A is the copy (exact), FEE B STAYS TICKED (it used to be unticked too)', marks(codex, 1) === 'FEE B:none:ticked | FEE A:exact:unticked', marks(codex, 1));
var codexRev = M.combineFiles([file('first.csv', [[d, 'FEE A', -10]]), file('second.csv', [[d, 'FEE A', -10], [d, 'FEE B', -10]])]);
check('…the same two lines in the other order give the same answer', marks(codexRev, 1) === 'FEE A:exact:unticked | FEE B:none:ticked', marks(codexRev, 1));
var looseOnly = M.combineFiles([file('first.csv', [[d, 'FEE A', -10]]), file('second.csv', [[d, 'FEE B', -10], [d, 'FEE C', -10]])]);
check('one earlier line, two later lines with the same date and amount but other words → ONE is held as "same date and amount", the other stays ticked', marks(looseOnly, 1) === 'FEE B:possible:unticked | FEE C:none:ticked', marks(looseOnly, 1));
var twoThree = M.combineFiles([file('first.csv', [[d, 'FEE', -5], [d, 'FEE', -5]]), file('second.csv', [[d, 'FEE', -5], [d, 'FEE', -5], [d, 'FEE', -5]])]);
check('two identical earlier fees against three later ones → two copies, the third stays ticked', marks(twoThree, 1) === 'FEE:exact:unticked | FEE:exact:unticked | FEE:none:ticked', marks(twoThree, 1));
var mixed = M.combineFiles([file('first.csv', [[d, 'FEE A', -10], [d, 'FEE X', -10]]), file('second.csv', [[d, 'FEE B', -10], [d, 'FEE C', -10], [d, 'FEE A', -10]])]);
check('two earlier lines, three later (one exact + two others): exact is reserved first, ONE other is held, ONE stays ticked — never three unticked for two earlier lines', marks(mixed, 1) === 'FEE B:possible:unticked | FEE C:none:ticked | FEE A:exact:unticked', marks(mixed, 1));
var three = M.combineFiles([file('a.csv', [[d, 'RENT', -250], [d, 'FEE A', -10]]), file('b.csv', [[d, 'RENT', -250], ['2026-11-02', 'SALARY', -50]]), file('c.csv', [[d, 'RENT', -250], ['2026-11-02', 'SALARY', -50], ['2026-11-03', 'NEW', -1], [d, 'FEE A', -10], [d, 'FEE Z', -10]])]);
check('three overlapping files: the 2nd file\'s RENT is a copy of the 1st; its SALARY is new', marks(three, 1) === 'RENT:exact:unticked | SALARY:none:ticked', marks(three, 1));
check('…the 3rd file\'s RENT, SALARY and FEE A are copies (of the 1st and 2nd files\' originals), NEW and FEE Z stay ticked — each line is imported exactly once', marks(three, 2) === 'RENT:exact:unticked | SALARY:exact:unticked | NEW:none:ticked | FEE A:exact:unticked | FEE Z:none:ticked' && three.rows.filter(function (r) { return r._include; }).map(function (r) { return r.description; }).sort().join(',') === 'FEE A,FEE Z,NEW,RENT,SALARY', [marks(three, 2), three.rows.filter(function (r) { return r._include; }).map(function (r) { return r.description; })]);
check('…and each copy names the file that holds the original', three.rows.filter(function (r) { return r._fileIx === 2 && r._crossDup; }).map(function (r) { return r.description + '<' + r._crossDupFile; }).join(',') === 'RENT<a.csv,SALARY<b.csv,FEE A<a.csv');
var sameName = M.combineFiles([file('statement.csv', [[d, 'FEE A', -10]]), file('statement.csv', [[d, 'FEE A', -10], [d, 'OTHER', -3]])]);
check('two files with the same NAME are still two files: the second one\'s copy is unticked, its own line is kept, and it gets its own batch', marks(sameName, 1) === 'FEE A:exact:unticked | OTHER:none:ticked' && M.importPlan(D.classifyAgainstExisting(sameName.rows.filter(function (r) { return r._include; }), []), 'acc', 'u').groups.map(function (g) { return g.fileIx + ':' + g.rows.length; }).join(',') === '0:1,1:1');
check('lines repeated INSIDE one file are left alone, in any file position', marks(twoThree, 0) === 'FEE:none:ticked | FEE:none:ticked');

// ── 2. the real preview component: page to row 201 and beyond, tick it, import
function walk(el, out) { if (el === null || el === undefined || typeof el === 'boolean') { return out; } if (Array.isArray(el)) { el.forEach(function (c) { walk(c, out); }); return out; } if (typeof el !== 'object') { return out; } out.push(el); if (el.props && el.props.children !== undefined) { walk(el.props.children, out); } return out; }
function textOf(el) { if (el === null || el === undefined || typeof el === 'boolean') { return ''; } if (Array.isArray(el)) { return el.map(textOf).join(''); } if (typeof el !== 'object') { return String(el); } return textOf(el.props && el.props.children); }
// the screen's own state and handlers (EgyptBankTab passes exactly these): rows, page, the "only copies" switch
function screen(combined, seeBalances) {
  var st = { rows: combined.rows, page: 0, only: false, imported: null, back: 0 };
  st.render = function () {
    return Preview({ importData: st.rows, fileResults: combined.results, seeBankBalances: seeBalances !== false, importAccount: 'acc-1', previewPageNo: st.page, previewOnlyMarked: st.only,
      onPage: function (p) { st.page = p; }, onOnlyMarked: function (v) { st.only = v; st.page = 0; }, onToggle: function (i) { st.rows = M.toggleRowInclude(st.rows, i); },
      onBack: function () { st.back += 1; },
      onImport: function () { // what doImport → executeImport do, with the database replaced by a list
        var toImport = st.rows.filter(function (r) { return r._include; });
        var block = S.importBlockedByPdf(toImport); if (block) { st.imported = { blocked: block, groups: [] }; return; }
        st.imported = M.importPlan(D.classifyAgainstExisting(toImport, []), 'acc-1', 'user-1');
      } });
  };
  st.all = function () { return walk(st.render(), []); };
  st.rowsShown = function () { return st.all().filter(function (e) { return e.type === 'tr' && e.key !== null && e.key !== undefined; }); };
  st.button = function (re) { return st.all().filter(function (e) { return e.type === 'button' && re.test(textOf(e)); })[0]; };
  st.press = function (re) { var b = st.button(re); if (!b) { throw new Error('no button ' + re); } if (b.props.disabled) { throw new Error('button disabled ' + re); } b.props.onClick(); };
  st.tick = function (index) { var tr = st.rowsShown().filter(function (e) { return e.key === String(index); })[0]; if (!tr) { return false; } var box = walk(tr, []).filter(function (e) { return e.type === 'input' && e.props.type === 'checkbox'; })[0]; box.props.onChange(); return true; };
  st.html = function () { return RS.renderToStaticMarkup(React.createElement(Preview, { importData: st.rows, fileResults: combined.results, seeBankBalances: seeBalances !== false, importAccount: 'acc-1', previewPageNo: st.page, previewOnlyMarked: st.only, onPage: function () {}, onOnlyMarked: function () {}, onToggle: function () {}, onBack: function () {}, onImport: function () {} })); };
  return st;
}
function day(n) { var dt = new Date(Date.UTC(2026, 0, 1 + n)); return dt.toISOString().substring(0, 10); }
// Codex's fixture: first file 200 transactions; second file ONE different payment with the date and amount of the first's row 1
var first200 = []; for (var i = 0; i < 200; i++) { first200.push([day(i), 'PAYMENT ' + (i + 1), -(100 + i)]); }
var c201 = M.combineFiles([file('first.csv', first200), file('second.csv', [[day(0), 'A DIFFERENT PAYMENT, SAME DAY AND AMOUNT', -100]])]);
check('Codex\'s fixture: row 201 is unticked as "same date and amount"', c201.rows.length === 201 && c201.rows[200]._include === false && c201.rows[200]._crossDup === 'possible' && c201.rows[200]._fileIx === 1);
var sc = screen(c201);
check('page 1 shows rows 1–200 and says there are 2 pages; row 201 is not on it — and the screen offers Next and "show only the 1 row marked as a copy"', sc.rowsShown().length === 200 && sc.rowsShown().every(function (e) { return e.key !== '200'; }) && /Rows 1–200 of 201/.test(sc.html()) && /page 1 of 2/.test(sc.html()) && !!sc.button(/Next →/) && !sc.button(/Next →/).props.disabled && !!sc.button(/Show only the 1 row marked as a copy/), sc.html().substring(0, 600));
check('ticking a row that is not on the current page is not possible by accident', sc.tick(200) === false);
sc.press(/Next →/);
check('Next → page 2 shows row 201, from second.csv, with why it is unticked', sc.page === 1 && sc.rowsShown().length === 1 && sc.rowsShown()[0].key === '200' && /Rows 201–201 of 201/.test(sc.html()) && /A DIFFERENT PAYMENT, SAME DAY AND AMOUNT/.test(sc.html()) && /Same date and amount as a line in first\.csv — unticked; tick it only if it is a different payment/.test(sc.html()) && /second\.csv/.test(sc.html()), sc.html().substring(0, 900));
check('its tick box is there and is off', walk(sc.rowsShown()[0], []).filter(function (e) { return e.type === 'input'; })[0].props.checked === false);
sc.tick(200);
check('ticking it on page 2 ticks exactly that row; the other 200 are untouched; the line under it now says it WILL be imported', sc.rows[200]._include === true && sc.rows.filter(function (r) { return r._include; }).length === 201 && sc.rows.slice(0, 200).every(function (r, k) { return r === c201.rows[k]; }) && /you ticked it, so it WILL be imported/.test(sc.html()) && /Preview — 201 of 201 rows/.test(sc.html()));
sc.press(/← Previous/);
check('going back to page 1 and forward again keeps the tick', sc.page === 0 && sc.rowsShown().length === 200 && (sc.press(/Next →/), sc.page === 1) && walk(sc.rowsShown()[0], []).filter(function (e) { return e.type === 'input'; })[0].props.checked === true);
sc.press(/Import 201 rows/);
check('Import: the re-ticked row is written in the SECOND file\'s batch (1 row, −100), the first file\'s batch has its 200', sc.imported && sc.imported.groups.length === 2 && sc.imported.groups[0].file === 'first.csv' && sc.imported.groups[0].rows.length === 200 && sc.imported.groups[1].file === 'second.csv' && sc.imported.groups[1].fileIx === 1 && sc.imported.groups[1].rows.length === 1 && sc.imported.groups[1].rows[0].description === 'A DIFFERENT PAYMENT, SAME DAY AND AMOUNT' && sc.imported.groups[1].rows[0].amount === -100, sc.imported && sc.imported.groups.map(function (g) { return g.file + ':' + g.rows.length; }));
var sc0 = screen(c201); sc0.press(/Import 200 rows/);
check('without ticking it, Import writes 200 rows in one batch and nothing from the second file', sc0.imported.groups.length === 1 && sc0.imported.groups[0].rows.length === 200 && sc0.imported.rowCount === 200);

// well beyond row 200: 450 + 450 rows, copies at rows 451, 700 and 900, reached through "show only the copies" and through paging
var big1 = []; var big2 = [];
for (var j = 0; j < 450; j++) { big1.push([day(j), 'FIRST FILE ' + (j + 1), -(1000 + j)]); big2.push([day(j + 500), 'SECOND FILE ' + (j + 1), -(5000 + j)]); }
big2[0] = [day(0), 'FIRST FILE 1', -1000];                 // exact copy of the first file's row 1   → row 451
big2[249] = [day(10), 'OTHER WORDS, SAME DAY AND AMOUNT', -1010]; // same date + amount as its row 11 → row 700
big2[449] = [day(20), 'OTHER WORDS AGAIN', -1020];          // → row 900
var cBig = M.combineFiles([file('jan.csv', big1), file('feb.csv', big2)]);
var sb = screen(cBig);
check('900 rows: 5 pages; rows 451, 700 and 900 are the three unticked copies', cBig.rows.length === 900 && /page 1 of 5/.test(sb.html()) && cBig.rows.map(function (r, k) { return r._crossDup ? (k + 1) + r._crossDup : ''; }).filter(Boolean).join(',') === '451exact,700possible,900possible' && /Preview — 897 of 900 rows/.test(sb.html()));
sb.press(/Show only the 3 rows marked as copies/);
check('"Show only the 3 rows marked as copies" lists exactly those three, wherever they are in the list', sb.only === true && sb.rowsShown().map(function (e) { return e.key; }).join(',') === '450,699,899' && /Rows 1–3 of 3 unticked copies/.test(sb.html()));
sb.tick(699);
check('ticking row 700 there ticks row 700 of the whole list (not row 2 of the short list)', sb.rows[699]._include === true && sb.rows[1]._include === true && sb.rows.filter(function (r) { return !r._include; }).length === 2 && sb.rows[450]._include === false && sb.rows[899]._include === false);
sb.press(/Show all rows/);
sb.press(/Next →/); sb.press(/Next →/); sb.press(/Next →/); sb.press(/Next →/);
check('paging to the last page (rows 801–900) shows row 900 with its tick box; Next is then disabled', sb.page === 4 && sb.rowsShown().length === 100 && sb.rowsShown()[99].key === '899' && sb.button(/Next →/).props.disabled === true && /Rows 801–900 of 900/.test(sb.html()));
sb.tick(899);
sb.press(/Import 899 rows/);
check('Import after ticking rows 700 and 900: jan.csv 450 rows, feb.csv 449 rows (its exact copy at row 451 stays out), both re-ticked rows in feb.csv\'s batch', sb.imported.groups.length === 2 && sb.imported.groups[0].rows.length === 450 && sb.imported.groups[1].file === 'feb.csv' && sb.imported.groups[1].rows.length === 449 && sb.imported.groups[1].rows.filter(function (r) { return r.description === 'OTHER WORDS, SAME DAY AND AMOUNT' || r.description === 'OTHER WORDS AGAIN'; }).length === 2 && sb.imported.groups[1].rows.every(function (r) { return r.description !== 'FIRST FILE 1'; }), sb.imported.groups.map(function (g) { return g.file + ':' + g.rows.length; }));
var lineAfter = M.fileResultLines(cBig.results, sb.rows, true)[1].text;
check('the file\'s line follows the ticks: 1 still unticked as the same line, 2 ticked back, 449 of 450 to import', /1 row is the same line as in another selected file and is unticked\./.test(lineAfter) && /2 rows marked as a copy were ticked back by you and will be imported\./.test(lineAfter) && /Ticked to import from this file: 449 of 450\./.test(lineAfter) && !/same date and amount/.test(lineAfter), lineAfter);
sb.tick(899);
check('unticking again takes it back out', sb.rows[899]._include === false && sb.rows.filter(function (r) { return r._include; }).length === 898);

// ── the preview keeps the PDF proof gate and the balance privacy
function W(str, x, y) { return { str: str, x: x, y: y, w: str.length * 5 }; }
function R(str, right, y) { return { str: str, x: right - str.length * 5, y: y, w: str.length * 5 }; }
function pdfFile(res, name) { var g = S.pdfRowsForImport(res, name); return g.refused ? { name: name, kind: 'pdf', refused: true, reason: g.reason, short: g.note ? g.note.short : '', note: g.note, rows: [] } : { name: name, kind: 'pdf', refused: false, note: g.note, rows: g.rows }; }
var good = S.statementFromTextItems([[W('30SEP26', 41, 500), W('OPENING BALANCE', 150, 500), R('1,000.00', 570, 500), W('01OCT26', 41, 480), W('CARD FEE', 150, 480), R('100.00', 424, 480), R('900.00', 570, 480), W('02OCT26', 41, 460), W('DEPOSIT', 150, 460), R('100.00', 486, 460), R('1,000.00', 570, 460)]]);
var wrong = S.statementFromTextItems([[W('30SEP26', 41, 500), W('OPENING BALANCE', 150, 500), R('1,000.00', 570, 500), W('01OCT26', 41, 480), W('X', 150, 480), R('100.00', 424, 480), R('900.00', 570, 480), W('02OCT26', 41, 460), W('Y', 150, 460), R('100.00', 486, 460), R('1,050.00', 570, 460)]]);
var cPdf = M.combineFiles([pdfFile(good, 'good.pdf'), pdfFile(wrong, 'wrong.pdf')]);
var sp = screen(cPdf, true); var spHtml = sp.html();
check('a proved PDF and a refused PDF together: the proved one\'s 2 rows are in the preview, the refused one adds none, and both have their own line', cPdf.rows.length === 2 && /2 files selected — 1 read, 1 not imported\. Nothing is saved until you press Import\./.test(spHtml) && /good\.pdf/.test(spHtml) && /wrong\.pdf/.test(spHtml) && /Nothing from this PDF was added/.test(spHtml) && sp.rowsShown().length === 2);
sp.press(/Import 2 rows/);
check('…Import writes only the proved file\'s rows, with the proved signs (−100, +100)', sp.imported.groups.length === 1 && sp.imported.groups[0].file === 'good.pdf' && JSON.stringify(sp.imported.groups[0].rows.map(function (r) { return r.amount; })) === '[-100,100]');
var forged = screen({ rows: cPdf.rows.concat([{ date: '2026-10-09', description: 'slipped in', amount: -999, _include: true, _src: 'pdf', _file: 'wrong.pdf', _fileIx: 1 }]), results: cPdf.results }); forged.press(/Import 3 rows/);
check('…a PDF row without its proof mark still stops the whole import (zero rows)', forged.imported.groups.length === 0 && /not proved/.test(forged.imported.blocked));
var hidden = screen(cPdf, false).html();
check('someone who may not see bank balances gets the same lines with NO balance figure and no totals boxes', !/1,000\.00|1,050\.00|900\.00/.test(hidden) && !/Withdrawals/.test(hidden) && /good\.pdf/.test(hidden) && /wrong\.pdf/.test(hidden) && /Withdrawals/.test(spHtml));
var none = screen(M.combineFiles([pdfFile(wrong, 'a.pdf'), pdfFile(wrong, 'b.pdf')]));
check('every file refused: the reasons are listed, "Nothing to import", and the Import button is disabled', /Nothing to import from this selection/.test(none.html()) && none.button(/Import 0 rows/).props.disabled === true && none.rowsShown().length === 0);
check('with no account chosen the Import button is disabled', walk(Preview({ importData: cPdf.rows, fileResults: cPdf.results, seeBankBalances: true, importAccount: '', previewPageNo: 0, previewOnlyMarked: false }), []).filter(function (e) { return e.type === 'button' && /Import 2 rows/.test(textOf(e)); })[0].props.disabled === true);

// ── the big screen uses this component and these handlers (runtime imports present)
var tab = fs.readFileSync(path.join(root, 'src/components/EgyptBankTab.jsx'), 'utf8'); var prev = fs.readFileSync(path.join(root, 'src/components/EgyptBankImportPreview.jsx'), 'utf8');
check('EgyptBankTab renders the preview component with its own state and the tested tick function', /import EgyptBankImportPreview from '\.\/EgyptBankImportPreview';/.test(tab) && /import \{ combineFiles, importPlan, writeImportPlan, reviewCounts, toggleRowInclude \} from '\.\.\/lib\/egypt-bank-multi-file';/.test(tab) && tab.indexOf('<EgyptBankImportPreview importData={importData} fileResults={fileResults} seeBankBalances={seeBankBalances} importAccount={importAccount}') > 0 && tab.indexOf('onToggle={(i) => setImportData(toggleRowInclude(importData, i))}') > 0 && tab.indexOf('onPage={setPreviewPageNo}') > 0 && tab.indexOf('onImport={doImport}') > 0 && tab.indexOf('importData.slice(0, 200)') < 0);
check('the preview component imports what it calls, keeps no state and touches no data', /import \{ fileResultLines, previewPage \} from '\.\.\/lib\/egypt-bank-multi-file';/.test(prev) && prev.indexOf('previewPage(importData, previewPageNo, 200, previewOnlyMarked)') > 0 && !/useState|useEffect|supabase|fetch\(/.test(prev) && prev.indexOf('.slice(0, 200)') < 0);
check('a new selection starts on page 1 with all rows shown', tab.indexOf('setFileResults([]); setPreviewPageNo(0); setPreviewOnlyMarked(false);') > 0);

// ── 3. saving, against a fake database: one batch per file, and a batch record never claims rows that were not saved
function fakeDb(opts) { opts = opts || {}; var db = { batches: [], rows: [], updates: [], n: 0, insertCalls: 0 };
  db.createBatch = async function (row) { if (opts.noFilenameColumn && row.filename !== undefined) { return null; } if (opts.noBatchTable) { throw new Error('relation does not exist'); } db.n += 1; var id = 'batch-' + db.n; db.batches.push(Object.assign({ id: id }, row)); return id; };
  db.insertRows = async function (chunk) { db.insertCalls += 1; if (opts.failInsert && opts.failInsert(chunk, db.insertCalls)) { if (opts.throwOnFail) { throw new Error('network'); } return false; } db.rows = db.rows.concat(chunk); return true; };
  db.updateBatch = async function (id, patch) { db.updates.push({ id: id, patch: patch }); db.batches = db.batches.map(function (b) { return b.id === id ? Object.assign({}, b, patch) : b; }); };
  return db; }
(async function () {
  var planBig = sb.imported; // jan.csv 450 rows + feb.csv 449 rows, from the screen run above
  var db1 = fakeDb(); var w1 = await M.writeImportPlan(planBig, db1, 'acc-1', 'user-1');
  check('all saved: 2 batch records (jan.csv 450, feb.csv 449) with file name, account, user and total; 899 rows, each tagged with ITS file\'s batch; nothing corrected', w1.imported === 899 && w1.failed === 0 && db1.batches.length === 2 && db1.batches[0].filename === 'jan.csv' && db1.batches[0].row_count === 450 && db1.batches[1].filename === 'feb.csv' && db1.batches[1].row_count === 449 && db1.batches.every(function (b) { return b.account_id === 'acc-1' && b.imported_by === 'user-1' && b.status === 'active'; }) && db1.rows.length === 899 && db1.rows.filter(function (r) { return r.import_batch_id === 'batch-1'; }).every(function (r) { return /^FIRST FILE/.test(r.description); }) && db1.rows.filter(function (r) { return r.import_batch_id === 'batch-2'; }).length === 449 && db1.updates.length === 0 && Math.abs(db1.batches[1].total_amount - db1.rows.filter(function (r) { return r.import_batch_id === 'batch-2'; }).reduce(function (a, r) { return a + r.amount; }, 0)) < 0.001, [w1, db1.batches]);
  check('rows are sent in groups of at most 100 and carry only the bank table\'s columns plus the batch id', db1.insertCalls === 10 && db1.rows.every(function (r) { return Object.keys(r).sort().join(',') === 'account_id,amount,date,description,import_batch_id,imported_by'; }));
  check('the finish screen gets one line per file', JSON.stringify(w1.perFile.map(function (f) { return f.file + ':' + f.imported + '/' + f.selected + ':' + f.batchId; })) === '["jan.csv:450/450:batch-1","feb.csv:449/449:batch-2"]' && w1.batchByFile['0'] === 'batch-1' && w1.batchByFile['1'] === 'batch-2');
  // the second file's rows cannot be saved at all
  var db2 = fakeDb({ failInsert: function (chunk) { return /^SECOND FILE|^OTHER WORDS/.test(chunk[0].description); } }); var w2 = await M.writeImportPlan(planBig, db2, 'acc-1', 'user-1');
  check('one file fails completely: the other file is saved in full (450), the failed file saves 0 and its batch record is corrected to 0 rows / 0.00 with a note — it does not claim 449', w2.imported === 450 && w2.failed === 449 && db2.rows.length === 450 && db2.batches[0].row_count === 450 && db2.batches[1].row_count === 0 && db2.batches[1].total_amount === 0 && /0 of 449 rows were saved; 449 could not be saved \(feb\.csv\)/.test(db2.batches[1].notes) && db2.updates.length === 1 && w2.perFile[1].imported === 0 && w2.perFile[1].selected === 449, [w2, db2.batches]);
  // one group of 100 in the middle of the first file fails (and the database call throws)
  var db3 = fakeDb({ throwOnFail: true, failInsert: function (chunk, call) { return call === 3; } }); var w3 = await M.writeImportPlan(planBig, db3, 'acc-1', 'user-1');
  var savedJan = db3.rows.filter(function (r) { return r.import_batch_id === 'batch-1'; });
  check('part of one file fails with an exception: nothing is thrown, 350 of its 450 are saved and its batch record says exactly that (count and total of what IS saved); the second file is complete', w3.imported === 799 && w3.failed === 100 && savedJan.length === 350 && db3.batches[0].row_count === 350 && Math.abs(db3.batches[0].total_amount - savedJan.reduce(function (a, r) { return a + r.amount; }, 0)) < 0.001 && /350 of 450 rows were saved; 100 could not be saved \(jan\.csv\)/.test(db3.batches[0].notes) && db3.batches[1].row_count === 449 && !db3.batches[1].notes, [w3, db3.batches]);
  var db4 = fakeDb({ noFilenameColumn: true }); var w4 = await M.writeImportPlan(planBig, db4, 'acc-1', 'user-1');
  check('a batch table without the file-name column: each file still gets its own batch record (without the name) and all rows are tagged', db4.batches.length === 2 && db4.batches.every(function (b) { return b.filename === undefined; }) && w4.imported === 899 && db4.rows.every(function (r) { return !!r.import_batch_id; }));
  var db5 = fakeDb({ noBatchTable: true }); var w5 = await M.writeImportPlan(planBig, db5, 'acc-1', 'user-1');
  check('no batch table at all: the rows are still imported, without a batch id, as before', w5.imported === 899 && db5.batches.length === 0 && db5.rows.every(function (r) { return r.import_batch_id === undefined; }) && w5.perFile.every(function (f) { return f.batchId === null; }));
  var w6 = await M.writeImportPlan({ groups: [] }, fakeDb(), 'a', 'u'); var w7 = await M.writeImportPlan(null, fakeDb(), 'a', 'u');
  check('nothing to write → nothing is created', w6.imported === 0 && w6.perFile.length === 0 && w7.imported === 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})();
