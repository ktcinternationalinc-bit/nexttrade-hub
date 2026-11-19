// v55.83-VI — Max, 19 Nov 2026: "make sure i can upload several pdfs at a time" and, on the duplicate-review screen,
// "skip all flagged or individually is not working".
// Real functions on SYNTHETIC statements only (no real account data): the PDF reader + its gate per file, the step that puts
// several files together, the duplicate classification against what is already saved, the review counts and the write plan.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var S = require(path.join(root, 'src/lib/pdf-statement.js'));
var D = require(path.join(root, 'src/lib/egypt-bank-duplicates.js'));
var M = require(path.join(root, 'src/lib/egypt-bank-multi-file.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1200))); }
console.log('VI — Egypt Bank: several statement files at once + a duplicate-review screen that shows what it does');
function W(str, x, y) { return { str: str, x: x, y: y, w: str.length * 5 }; }
function R(str, right, y) { return { str: str, x: right - str.length * 5, y: y, w: str.length * 5 }; }
// money OUT is printed in the column ending at 424, money IN in the one ending at 486, the running balance ends at 570
function stmt(openDate, opening, lines) {
  var y = 500; var items = [W(openDate, 41, y), W('OPENING BALANCE', 150, y), R(opening, 570, y)];
  lines.forEach(function (l) { y -= 20; items.push(W(l[0], 41, y), W(l[1], 150, y), R(l[2], l[3] === 'out' ? 424 : 486, y)); if (l[4]) { items.push(R(l[4], 570, y)); } });
  return S.statementFromTextItems([items]);
}
// what the screen does with ONE selected file (readOneFile): the gate decides; a refused file hands over no rows
function fileFromPdf(res, name) {
  var gate = S.pdfRowsForImport(res, name);
  if (gate.refused || gate.rows.length === 0) { return { name: name, kind: 'pdf', refused: true, reason: gate.reason, short: gate.note ? gate.note.short : '', note: gate.note, rows: [] }; }
  return { name: name, kind: 'pdf', refused: false, reason: '', short: '', note: gate.note, rows: gate.rows };
}
function sheet(name, rows) { return { name: name, kind: 'sheet', refused: rows.length === 0, reason: rows.length ? '' : name + ': no transactions were found in this file', rows: rows.map(function (r, i) { return { date: r[0], description: r[1], amount: r[2], _include: true, _row: i + 1 }; }) }; }

// ── three PDFs chosen together: one good, one the bank's balances do not prove, one overlapping the first
var oct = stmt('30SEP26', '1,000.00', [['01OCT26', 'CARD FEE', '100.00', 'out', '900.00'], ['02OCT26', 'DEPOSIT ALPHA', '100.00', 'in', '1,000.00'], ['03OCT26', 'RENT', '250.00', 'out', '750.00']]);
var bad = stmt('30SEP26', '1,000.00', [['01OCT26', 'TRANSFER X', '100.00', 'out', '900.00'], ['02OCT26', 'TRANSFER Y', '100.00', 'in', '1,050.00']]);
var overlap = stmt('01OCT26', '900.00', [['02OCT26', 'DEPOSIT ALPHA', '100.00', 'in', '1,000.00'], ['03OCT26', 'RENT', '250.00', 'out', '750.00'], ['04OCT26', 'SALARY', '50.00', 'out', '700.00']]);
check('the three synthetic statements read as intended: two proved, one refused by its own balances', oct.importable === true && overlap.importable === true && bad.importable === false, [oct.check, bad.check, overlap.check]);
var picked = [fileFromPdf(oct, 'oct.pdf'), fileFromPdf(bad, 'bad.pdf'), fileFromPdf(overlap, 'overlap.pdf')];
var c3 = M.combineFiles(picked);
check('the refused file adds NOTHING and does not stop the other two: 6 rows, from files 1 and 3 only', c3.rows.length === 6 && c3.rows.every(function (r) { return r._file !== 'bad.pdf' && (r._fileIx === 0 || r._fileIx === 2); }) && c3.results.length === 3 && c3.results[1].refused === true && c3.results[0].refused === false && c3.results[2].refused === false, c3.rows.map(function (r) { return r._file + '|' + r.date + '|' + r.amount; }));
check('every row says which file it came from, keeps its PDF proof mark, and the rows are numbered 1..6', c3.rows.every(function (r, i) { return r._row === i + 1 && r._src === 'pdf' && r._pdfOk === true && (r._file === 'oct.pdf' || r._file === 'overlap.pdf'); }));
var ov = c3.rows.filter(function (r) { return r._fileIx === 2; });
check('the two lines that are in BOTH statements are unticked in the later file and say which file has them; the new line stays ticked', ov.length === 3 && ov[0]._include === false && ov[0]._crossDup === 'exact' && ov[0]._crossDupFile === 'oct.pdf' && ov[1]._include === false && ov[1]._crossDup === 'exact' && ov[2]._include === true && !ov[2]._crossDup, ov);
check('the first file keeps all its rows ticked', c3.rows.filter(function (r) { return r._fileIx === 0; }).every(function (r) { return r._include === true && !r._crossDup; }));
var lines = M.fileResultLines(c3.results, c3.rows, true);
check('the preview has ONE line per selected file, in the order chosen: read / refused with the bank\'s reason / read with its copies named', lines.length === 3 && lines[0].ok === true && /^✅ /.test(lines[0].text) && /oct\.pdf/.test(lines[0].text) && lines[1].ok === false && /^⛔ /.test(lines[1].text) && /bad\.pdf/.test(lines[1].text) && /Nothing from this PDF was added/.test(lines[1].text) && lines[2].ok === true && /2 rows are the same line as in another selected file and are unticked/.test(lines[2].text), lines);
var linesNoAmounts = M.fileResultLines(c3.results, c3.rows, false);
check('someone who may not see bank balances gets the same three lines WITHOUT the balance figures', linesNoAmounts.length === 3 && !/1,000\.00|1,050\.00|900\.00|750\.00/.test(linesNoAmounts.map(function (l) { return l.text; }).join(' ')) && /bad\.pdf/.test(linesNoAmounts[1].text) && linesNoAmounts[1].ok === false, linesNoAmounts);

// ── nothing is saved before Import; then one batch per file, with only the bank table's columns
var toImport = c3.rows.filter(function (r) { return r._include; });
check('ticked by default: 4 rows (3 from the first file + the 1 new line of the overlapping one); the PDF lock lets proved rows through', toImport.length === 4 && S.importBlockedByPdf(toImport) === '');
var classified = D.classifyAgainstExisting(toImport, []);
var plan = M.importPlan(classified, 'acc-1', 'user-1');
check('with nothing saved yet all 4 are clean and are written as TWO batches — oct.pdf (3 rows, −250.00) and overlap.pdf (1 row, −50.00)', plan.groups.length === 2 && plan.groups[0].file === 'oct.pdf' && plan.groups[0].rows.length === 3 && Math.abs(plan.groups[0].total + 250) < 0.001 && plan.groups[1].file === 'overlap.pdf' && plan.groups[1].rows.length === 1 && Math.abs(plan.groups[1].total + 50) < 0.001 && plan.rowCount === 4 && plan.skipped === 0, plan);
check('each written row carries exactly account, date, description, amount, imported_by — no helper fields reach the database', plan.groups.every(function (g) { return g.rows.every(function (r) { return Object.keys(r).sort().join(',') === 'account_id,amount,date,description,imported_by' && r.account_id === 'acc-1' && r.imported_by === 'user-1'; }); }));
check('the signs are the proved ones: fee −100, deposit +100, rent −250, salary −50', JSON.stringify(plan.groups[0].rows.map(function (r) { return r.amount; })) === '[-100,100,-250]' && plan.groups[1].rows[0].amount === -50);

// ── every file refused: the preview still opens, with the reasons and nothing to import
var allBad = M.combineFiles([fileFromPdf(bad, 'a.pdf'), fileFromPdf(bad, 'b.pdf'), sheet('empty.xlsx', [])]);
check('three files, all refused → zero rows, three refusal lines (not a bare "no transactions found")', allBad.rows.length === 0 && M.fileResultLines(allBad.results, allBad.rows, true).filter(function (l) { return l.refused && /^⛔ /.test(l.text); }).length === 3 && M.importPlan(D.classifyAgainstExisting([], []), 'a', 'u').groups.length === 0);
var smuggle = M.combineFiles([{ name: 'x.pdf', kind: 'pdf', refused: true, reason: 'x.pdf: refused', rows: [{ date: '2026-10-01', description: 'should never appear', amount: -1, _include: true }] }, sheet('ok.xlsx', [['2026-10-05', 'CASH IN', 20]])]);
check('a file marked refused contributes no rows even if rows are attached to it', smuggle.rows.length === 1 && smuggle.rows[0].description === 'CASH IN' && smuggle.rows[0]._file === 'ok.xlsx' && smuggle.rows[0]._fileIx === 1);

// ── copies across the selected files: exact, same date + amount only, and counted (two cover two, not three)
var two = M.combineFiles([sheet('first.xlsx', [['2026-10-06', 'BANK FEE', -5], ['2026-10-06', 'BANK FEE', -5], ['2026-10-07', 'RENT OCTOBER', -250]]), sheet('second.xlsx', [['2026-10-06', 'BANK FEE', -5], ['2026-10-06', 'BANK FEE', -5], ['2026-10-06', 'BANK FEE', -5], ['2026-10-07', 'RENT PAID TO LANDLORD', -250], ['2026-10-08', 'NEW LINE', -9]])]);
var s2 = two.rows.filter(function (r) { return r._fileIx === 1; });
check('two identical fees in the first file cover TWO of the three in the second; the third stays ticked', s2[0]._crossDup === 'exact' && s2[1]._crossDup === 'exact' && !s2[2]._crossDup && s2[2]._include === true, s2);
check('same date and amount but a different description → unticked as "same date and amount", can be ticked back; a new line is untouched', s2[3]._crossDup === 'possible' && s2[3]._include === false && s2[3]._crossDupFile === 'first.xlsx' && !s2[4]._crossDup && s2[4]._include === true);
check('two identical lines INSIDE one file are never treated as copies of each other', two.rows.filter(function (r) { return r._fileIx === 0; }).every(function (r) { return r._include === true && !r._crossDup; }));
var twoLines = M.fileResultLines(two.results, two.rows, true);
check('the second file\'s line says 2 are the same line and 1 has the same date and amount', /2 rows are the same line as in another selected file/.test(twoLines[1].text) && /1 row has the same date and amount as a line in another selected file and is unticked — tick it only if it is a different payment/.test(twoLines[1].text), twoLines[1]);
var sameName = M.combineFiles([sheet('statement.xlsx', [['2026-10-01', 'A', 1]]), sheet('statement.xlsx', [['2026-10-02', 'B', 2]])]);
check('two different files with the SAME name stay two files (two batches)', M.importPlan(D.classifyAgainstExisting(sameName.rows, []), 'a', 'u').groups.length === 2);
var excelAndPdf = M.combineFiles([sheet('oct.xlsx', [['2026-10-01', 'CARD FEE', -100], ['2026-10-02', 'DEPOSIT ALPHA', 100], ['2026-10-03', 'RENT', -250]]), fileFromPdf(oct, 'oct.pdf')]);
check('the same statement chosen as Excel AND as PDF: the PDF\'s 3 rows are all unticked, so it is imported once', excelAndPdf.rows.filter(function (r) { return r._fileIx === 1; }).every(function (r) { return r._include === false && r._crossDup === 'exact'; }) && excelAndPdf.rows.filter(function (r) { return r._include; }).length === 3);

// ── against what is ALREADY saved: the review screen's numbers and what Confirm writes
var existing = [{ id: 'e1', date: '2026-10-01', description: 'CARD FEE', amount: -100, account_id: 'acc-1' }, { id: 'e2', date: '2026-10-03', description: 'RENT FOR THE OFFICE', amount: -250, account_id: 'acc-9' }];
var cl = D.classifyAgainstExisting(toImport, existing);
var rc = M.reviewCounts(cl);
check('1 exact (the fee), 1 possible (the rent, other wording), 2 clean → the screen says: will import 2, will skip 2, all flagged already skipped', rc.exact === 1 && rc.possible === 1 && rc.clean === 2 && rc.flagged === 2 && rc.importing === 2 && rc.skipping === 2 && rc.flaggedImporting === 0 && rc.allFlaggedSkipped === true, [rc, cl.map(function (c) { return c.status + '/' + c.decision; })]);
var p0 = M.importPlan(cl, 'acc-1', 'u');
check('Confirm with nothing changed writes exactly the 2 clean rows and COUNTS both flagged rows as skipped (the undecided "possible" one included)', p0.rowCount === 2 && p0.skipped === 2 && p0.exactSkipped === 1 && p0.possibleSkipped === 1 && p0.overridden === 0 && p0.rowCount === rc.importing && p0.skipped === rc.skipping, p0);
var possibleIx = cl.findIndex(function (c) { return c.status === 'possible'; });
var one = cl.map(function (c, i) { return i === possibleIx ? Object.assign({}, c, { decision: 'import' }) : c; });
var rc1 = M.reviewCounts(one); var p1 = M.importPlan(one, 'acc-1', 'u');
check('"Import anyway" on ONE flagged row: will import 3, will skip 1, the button no longer says "already skipped"; Confirm writes 3 and records 1 override', rc1.importing === 3 && rc1.skipping === 1 && rc1.flaggedImporting === 1 && rc1.allFlaggedSkipped === false && p1.rowCount === 3 && p1.overridden === 1 && p1.skipped === 1);
var back = one.map(function (c, i) { return i === possibleIx ? Object.assign({}, c, { decision: 'skip' }) : c; });
check('"Skip" on that row again: back to import 2 / skip 2', M.reviewCounts(back).importing === 2 && M.reviewCounts(back).skipping === 2 && M.importPlan(back, 'a', 'u').rowCount === 2);
var everything = cl.map(function (c) { return Object.assign({}, c, { decision: 'import' }); });
var skipAll = everything.map(function (c) { return c.status === 'clean' ? c : Object.assign({}, c, { decision: 'skip' }); });
check('after choosing to import everything, "Skip all flagged" brings it back: import 2 clean, skip 2 flagged, nothing flagged is written', M.reviewCounts(everything).importing === 4 && M.reviewCounts(everything).allFlaggedSkipped === false && M.reviewCounts(skipAll).importing === 2 && M.reviewCounts(skipAll).allFlaggedSkipped === true && M.importPlan(skipAll, 'a', 'u').groups.reduce(function (n, g) { return n + g.rows.length; }, 0) === 2);
check('the numbers on the screen and the rows written always agree, in every state tried', [cl, one, back, everything, skipAll].every(function (state) { var r = M.reviewCounts(state); var p = M.importPlan(state, 'a', 'u'); return r.importing === p.rowCount && r.skipping === p.skipped && r.importing + r.skipping === state.length; }));
check('empty and missing input is harmless everywhere', M.combineFiles(null).rows.length === 0 && M.combineFiles([]).results.length === 0 && M.reviewCounts(null).importing === 0 && M.importPlan(null, 'a', 'u').groups.length === 0 && M.fileResultLines(null, null, true).length === 0);

// ── the screen is wired to these functions (runtime import present) and no longer interrupts with pop-ups per file
var tab = fs.readFileSync(path.join(root, 'src/components/EgyptBankTab.jsx'), 'utf8');
check('the screen imports the helpers it calls', /import \{ combineFiles, importPlan, writeImportPlan, reconcileBatchRecord, updateConfirmed, reviewCounts, toggleRowInclude \} from '\.\.\/lib\/egypt-bank-multi-file';/.test(tab) && ['combineFiles(results)', 'importPlan(classified, accId, myId)', 'reviewCounts(reviewClassified)'].every(function (s) { return tab.indexOf(s) > 0; }) && fs.readFileSync(path.join(root, 'src/components/EgyptBankImportPreview.jsx'), 'utf8').indexOf('fileResultLines(fileResults, importData, seeBankBalances)') > 0);
check('both file pickers still take several files, PDF included', tab.split('accept=".xlsx,.xls,.csv,.pdf,application/pdf" multiple').length === 3);
check('every selected file is read on its own, in a try/catch, and a failure becomes that file\'s reason — never an exception or a pop-up', tab.indexOf('for (const file of files) { results.push(await readOneFile(file)); }') > 0 && tab.indexOf('try { rows = (await parseOneFile(file, out)) || []; }') > 0 && (function () { var a = tab.indexOf('const parseOneFile = async (file, out) => {'); var b = tab.indexOf('// v55.83-A.6.14 (Max May 14 2026) — TWO-STAGE IMPORT'); var body = tab.substring(a, b); return a > 0 && b > a && body.indexOf('alert(') < 0; })());
check('a refused PDF hands over nothing and its reason goes to the per-file line', tab.indexOf("if (gate.refused) { out.reason = gate.reason; out.short = gate.note ? gate.note.short : ''; return []; }") > 0);
check('choosing files only fills the preview; the import still starts from the Import button and passes both PDF locks', (function () { var a = tab.indexOf('const handleFile = async (e) => {'); var b = tab.indexOf('const readOneFile = async (file) => {'); var body = tab.substring(a, b); return a > 0 && b > a && body.indexOf('.insert(') < 0 && body.indexOf('executeImport') < 0 && body.indexOf("setImportStep('preview')") > 0; })() && tab.indexOf('const pdfBlock = importBlockedByPdf(toImport);') > 0 && tab.indexOf('const pdfBlock2') < tab.indexOf("setImportStep('importing');"));
check('one import batch per file, with the file name; an older table without that column still gets its batch', tab.indexOf('var written = await writeImportPlan(plan, {') > 0 && tab.indexOf("createBatch: async function (row) { var r = await supabase.from('bank_import_batches').insert(row).select().maybeSingle(); return (r && r.data && r.data.id) || null; },") > 0 && tab.indexOf("insertRows: async function (chunk) { var r = await supabase.from('egypt_bank_transactions').insert(chunk); return !(r && r.error); },") > 0 && (function () { var lib = fs.readFileSync(path.join(root, 'src/lib/egypt-bank-multi-file.js'), 'utf8'); return lib.indexOf('db.createBatch(g.file ? Object.assign({ filename: g.file }, batchRow) : batchRow)') > 0 && lib.indexOf('if (!batchId && g.file) { try { batchId = (await db.createBatch(batchRow)) || null; }') > 0; })());
check('the review screen shows the state of every flagged row and says what Confirm will do', tab.indexOf("'✓ WILL IMPORT ANYWAY' : '✕ SKIPPED — will not be imported'") > 0 && tab.indexOf('Flagged rows are SKIPPED unless you choose “Import anyway”.') > 0 && tab.indexOf('disabled={counts.allFlaggedSkipped}') > 0 && tab.indexOf('Confirm and import {importing} row') > 0 && tab.indexOf('April 12') < 0);
check('"Skip all flagged" confirms what it did', /toast\?\.success\?\.\(\(exactCount \+ possibleCount\) \+ ' flagged row'/.test(tab));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
