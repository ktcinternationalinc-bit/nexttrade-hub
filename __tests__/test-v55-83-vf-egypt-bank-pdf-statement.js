// v55.83-VF (Max, Nov 19 2026): "I NEED TO BE ABLE TO IMPORT PDFS AS WELL IN EGYPT BANK".
// Runs the REAL reader (src/lib/pdf-statement.js) on statements laid out like the bank's own PDF (same column positions as the
// CIB statement Max sent; the figures and names here are made up — no real account data is kept in the repository).
// If the real sample is on this computer and a PDF library is available, it is read too (skipped otherwise, and it says so).
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var S = require(path.join(root, 'src/lib/pdf-statement.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('VF — Egypt Bank: bank statement PDF → rows, checked against the running balance');

// ── helpers that lay words out like the PDF: date at x 41, description at 150, money right-aligned at 424 / 486 / 570
function W(str, x, y) { return { str: str, x: x, y: y, w: str.length * 5 }; }
function R(str, right, y) { return { str: str, x: right - str.length * 5, y: y, w: str.length * 5 }; }
function header(y0) { return [W('Name:', 42, y0), W('KTC TEST CO', 91, y0), W('Date', 41, y0 - 90), W('31OCT26', 120, y0 - 90), W('Customer ID', 309, y0 - 90), W('1403966360', 398, y0 - 90), W('Account Number', 309, y0 - 111), W('100055915096', 398, y0 - 111), W('IBAN', 309, y0 - 134), W('EG060010012300000100055915096', 398, y0 - 134)]; }
function footer() { return [W('* Post value dated amounts must not be utilized prior to their maturity dates.', 30, 78), W('* Please advice us of any changes in your address.', 31, 34)]; }
function page1(swap) { var D = swap ? 486 : 424, C = swap ? 424 : 486; return header(696).concat([
  W('30SEP26', 41, 481), W('OPENING BALANCE', 150, 481), R('1,000,000.00', 570, 481),
  W('01OCT26', 41, 465), W('IPN Inward FT1\\BNK', 150, 465), R('50,000.00', C, 465), R('1,050,000.00', 570, 465),
  W('PayerMobNo:0020100 Payer', 150, 450), W('Name: SOMEONE Total', 150, 435),
  W('04OCT26', 41, 404), W('Outward Swift Charges', 150, 404), R('350.00', D, 404),
  W('FT2\\BNK AC-100055915096', 150, 389),
  W('04OCT26', 41, 373), W('Outward FT2\\BNK', 150, 373), R('200,000.00', D, 373),
  W('04OCT26', 41, 343), W('IPN Inward FT3\\BNK', 150, 343), R('70,000.00', C, 343), R('919,650.00', 570, 343),
  W('Bill payment for', 150, 328)]).concat(footer()); }
function page2(swap, closingText, lastBal) { var D = swap ? 486 : 424, C = swap ? 424 : 486; return header(696).concat([
  W('Payme', 150, 481),
  W('05OCT26', 41, 465), W('Commission Paid CHG1', 150, 465), R('250.00', D, 465), R('919,400.00', 570, 465),
  W('29OCT26', 41, 450), W('01NOV26', 99, 450), W('Credit Interest', 150, 450), R('1,215.85', C, 450), R(lastBal || '920,615.85', 570, 450),
  W('100055915096-20261031', 150, 435),
  W(closingText || 'CLOSING BALANCE', 150, 420), R('920,615.85', 570, 420),
  W('1,000,000.00 CR', 42, 104), W('3', 153, 104), W('200,600.00', 243, 104), W('3', 332, 104), W('121,215.85', 421, 104), W('920,615.85 CR', 497, 104)]).concat(footer()); }

var r = S.statementFromTextItems([page1(false), page2(false)]);
check('6 rows read from 2 pages; opening and closing lines are not rows', r.ok && r.transactions.length === 6 && !r.transactions.some(function (t) { return /BALANCE/.test(t.description); }), r);
check('amounts and signs: +50,000 · −350 · −200,000 · +70,000 · −250 · +1,215.85', JSON.stringify(r.transactions.map(function (t) { return t.amount; })) === JSON.stringify([50000, -350, -200000, 70000, -250, 1215.85]), r.transactions.map(function (t) { return t.amount; }));
check('dates read as real dates (01OCT26 → 2026-10-01)', r.transactions[0].date === '2026-10-01' && r.transactions[5].date === '2026-10-29');
check('the lines under a row are joined to its description', r.transactions[0].description === 'IPN Inward FT1\\BNK PayerMobNo:0020100 Payer Name: SOMEONE Total' && r.transactions[1].description === 'Outward Swift Charges FT2\\BNK AC-100055915096', r.transactions.slice(0, 2));
check('a line that continues on the NEXT page is joined too ("Bill payment for" + "Payme")', r.transactions[3].description === 'IPN Inward FT3\\BNK Bill payment for Payme', r.transactions[3]);
check('the value date beside the date is not put into the description; the totals line at the bottom is not joined to the last row', r.transactions[5].description === 'Credit Interest 100055915096-20261031', r.transactions[5]);
check('customer id / account number / IBAN in the page heading are never read as money', r.check.total_in === 121215.85 && r.check.total_out === 200600);
check('CHECK: opening 1,000,000.00, every printed balance agrees (4 of 4), closing 920,615.85 matches → ok', r.check.ok === true && r.check.opening === 1000000 && r.check.balances_agree === 4 && r.check.balances_checked === 4 && r.check.closing === 920615.85 && r.check.closing_agrees === true && r.check.direction_proved === true, r.check);
check('totals equal the bank\'s own totals line (money out 200,600.00 · money in 121,215.85)', r.check.total_out === 200600 && r.check.total_in === 121215.85);

// which column is money out is PROVED from the balances, not assumed from left / right
var sw = S.statementFromTextItems([page1(true), page2(true)]);
check('a bank that prints money IN on the left: same signs, proved by the balances', sw.check.ok === true && JSON.stringify(sw.transactions.map(function (t) { return t.amount; })) === JSON.stringify([50000, -350, -200000, 70000, -250, 1215.85]), [sw.check, sw.transactions.map(function (t) { return t.amount; })]);

// a figure that does not agree with the bank's balance is REPORTED, never hidden
var bad = S.statementFromTextItems([page1(false), page2(false, null, '920,715.85')]);
check('a printed balance that does not agree → NOT importable: zero rows handed over, the row and the bank\'s figure are named, closing reported as not matching', bad.ok === true && bad.importable === false && bad.transactions.length === 0 && bad.check.ok === false && bad.check.mismatches.length === 1 && bad.check.mismatches[0].date === '2026-10-29' && bad.check.mismatches[0].expected === 920715.85 && bad.check.closing_agrees === false, bad.check);
check('…and the words on screen say so in plain language', /NOT imported/.test(S.statementCheckText(bad.check, 'x.pdf')) && /1 printed balance does not agree/.test(S.statementCheckText(bad.check, 'x.pdf')) && /closing balance 920,615\.85 does not match/.test(S.statementCheckText(bad.check, 'x.pdf')) && /Nothing from this PDF was added/.test(S.statementCheckText(bad.check, 'x.pdf')), S.statementCheckText(bad.check, 'x.pdf'));
check('the words for a clean statement: rows, pages, period, in / out, "all 4 printed balances agree", closing matches', (function () { var t = S.statementCheckText(r.check, 'Oct.pdf'); return /^Oct\.pdf: 6 rows read from 2 pages \(2026-10-01 to 2026-10-29\)\. Money in 121,215\.85, money out 200,600\.00\. CHECKED/.test(t) && /all 4 printed balances agree, and the closing balance 920,615\.85 matches\./.test(t); })(), S.statementCheckText(r.check, 'Oct.pdf'));
var ar = S.statementFromTextItems([page1(false), page2(false, 'الرصيد الختامي')]);
check('closing balance written in Arabic is recognised', ar.check.closing === 920615.85 && ar.check.ok === true && ar.transactions.length === 6);

// a statement with ONE amount column + balance: the sign comes from what moves the balance
function one() { return [[W('30/09/2026', 41, 500), W('OPENING BALANCE', 150, 500), R('1,000.00', 570, 500),
  W('01/10/2026', 41, 480), W('Deposit', 150, 480), R('500.00', 486, 480), R('1,500.00', 570, 480),
  W('02/10/2026', 41, 460), W('Cheque 12', 150, 460), R('200.00', 486, 460),
  W('02/10/2026', 41, 440), W('Fee', 150, 440), R('10.00', 486, 440), R('1,290.00', 570, 440),
  W('03/10/2026', 41, 420), W('Transfer in', 150, 420), R('710.00', 486, 420), R('2,000.00', 570, 420)]]; }
var o = S.statementFromTextItems(one());
check('one amount column (dd/mm/yyyy dates): +500 · −200 · −10 · +710, every balance agrees', o.check.ok === true && JSON.stringify(o.transactions.map(function (t) { return [t.date, t.amount]; })) === JSON.stringify([['2026-10-01', 500], ['2026-10-02', -200], ['2026-10-02', -10], ['2026-10-03', 710]]), [o.check, o.transactions]);
var noBal = S.statementFromTextItems([[W('01OCT26', 41, 480), W('Deposit', 150, 480), R('500.00', 424, 480), W('02OCT26', 41, 460), W('Fee', 150, 460), R('10.00', 424, 460)]]);
check('a PDF with amounts but NO running balance is refused (nothing to check it against) — not imported on a guess', noBal.ok === false && noBal.transactions.length === 0 && /running balance/.test(noBal.error), noBal);
var scan = S.statementFromTextItems([[W('Some scanned letter', 40, 700), W('with no dated lines', 40, 680)], []]);
check('a scanned picture / a PDF with no dated lines: refused with a plain reason, nothing read', scan.ok === false && scan.transactions.length === 0 && /No dated lines/.test(scan.error));
check('empty input is refused, not a crash', S.statementFromTextItems([]).ok === false && S.statementFromTextItems(null).ok === false);

// the small rules
check('dates: 03FEB25, 03-Feb-2025, 03/02/2025, 2025-02-03 → 2025-02-03; 31FEB25, 100055915096, "Date", 45/13/2025 → not a date',
  ['03FEB25', '03-Feb-2025', '03/02/2025', '2025-02-03'].every(function (d) { return S.parseStatementDate(d) === '2025-02-03'; }) && ['31FEB25', '100055915096', 'Date', '45/13/2025', '', null].every(function (d) { return S.parseStatementDate(d) === ''; }));
check('money: "1,850,000.00" → 185000000 cents, "350.00 DR", "(350.00)" → ∓; an account number, an IBAN, "25", "1,23.00" → not money',
  S.parseStatementAmount('1,850,000.00') === 185000000 && S.parseStatementAmount('350.00 DR') === 35000 && S.parseStatementAmount('(350.00)') === -35000 && S.parseStatementAmount('-12.50') === -1250 &&
  ['100055915096', 'EG060010012300000100055915096', '25', '1,23.00', '', null, '12.5'].every(function (v) { return S.parseStatementAmount(v) === null; }));

// ── the screen
var tab = fs.readFileSync(path.join(root, 'src/components/EgyptBankTab.jsx'), 'utf8');
check('Egypt Bank: both file pickers accept .pdf', tab.split('accept=".xlsx,.xls,.csv,.pdf,application/pdf"').length === 3 && tab.indexOf('accept=".xlsx,.xls,.csv"') < 0);
check('Egypt Bank: imports the gate and the in-browser reader (runtime imports present); the reader loads the PDF library only when needed and never uploads the file', /import \{ pdfRowsForImport, importBlockedByPdf \} from '\.\.\/lib\/pdf-statement';/.test(tab) && /import \{ readPdfStatementInBrowser \} from '\.\.\/lib\/pdf-statement-browser';/.test(tab) && tab.indexOf('readPdfStatementInBrowser(await file.arrayBuffer())') > 0 && (function () { var b2 = fs.readFileSync(path.join(root, 'src/lib/pdf-statement-browser.js'), 'utf8'); return b2.indexOf("await import('pdfjs-dist/legacy/build/pdf')") > 0 && b2.indexOf('isEvalSupported: false') > 0 && !/fetch\(|XMLHttpRequest|supabase/.test(b2); })());
check('Egypt Bank: a PDF goes to the PDF reader BEFORE the Excel reader; rows come out ONLY through the gate; a refused PDF hands over nothing', tab.indexOf("if (/\\.pdf$/i.test(file.name || '') || file.type === 'application/pdf') {") > 0 && tab.indexOf("if (/\\.pdf$/i.test(file.name || '')") < tab.indexOf('const wb = XLSX.read(data);') && tab.indexOf('const gate = pdfRowsForImport(res, file.name);') > 0 && tab.indexOf('return gate.rows;') > 0 && /if \(gate\.refused\) \{ alert\([^;]*\); return \[\]; \}/.test(tab) && tab.indexOf('res.transactions.map') < 0);
check('Egypt Bank: the import is stopped again at the moment of importing AND right before anything is written when a PDF row has no proof mark', tab.indexOf('const pdfBlock = importBlockedByPdf(toImport);') > 0 && tab.indexOf('if (pdfBlock) { alert(pdfBlock); return; }') > 0 && tab.indexOf("if (pdfBlock2) { alert(pdfBlock2); setImportStep('preview'); return; }") > 0 && tab.indexOf('const pdfBlock2') < tab.indexOf("setImportStep('importing');"));
check('Egypt Bank: the balance check is shown in the preview; amounts only for people who may see bank balances', tab.indexOf('{seeBankBalances ? n.text : n.short}') > 0 && tab.indexOf('setPdfNotes([]);') > 0);
var pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check('the PDF reader is a pinned dependency (exact version), and the bundle is told it does not need "canvas"', pkg.dependencies['pdfjs-dist'] === '3.11.174' && /canvas: false/.test(fs.readFileSync(path.join(root, 'next.config.js'), 'utf8')));

// ── the real sample, when it is on this computer
(async function () {
  var sample = process.env.EGYPT_BANK_PDF_SAMPLE || 'D:/Downloads/Statements_31OCT26.pdf'; var pdfjs = null;
  try { pdfjs = require(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.js')); } catch (e) { pdfjs = null; }
  if (!pdfjs || !fs.existsSync(sample)) { console.log('  (real sample not read here: ' + (!pdfjs ? 'PDF library not installed' : 'file not on this computer') + ' — the checks above use the same layout)'); }
  else {
    var warn = console.warn; var log = console.log; console.warn = function () {}; console.log = function (m) { if (!/^Warning|Require stack|^- /.test(String(m))) { log.apply(console, arguments); } };
    var doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(sample)), isEvalSupported: false, disableFontFace: true }).promise; var pages = [];
    for (var n = 1; n <= doc.numPages; n++) { var tc = await (await doc.getPage(n)).getTextContent(); pages.push(tc.items.map(function (i) { return { str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }; })); }
    console.warn = warn; console.log = log;
    var real = S.statementFromTextItems(pages);
    check('REAL sample (the bank\'s own PDF, ' + doc.numPages + ' pages): 50 rows, every printed balance agrees, closing balance matches, in / out proved', real.ok && real.check.ok === true && real.transactions.length === 50 && real.check.balances_agree === real.check.balances_checked && real.check.balances_checked === 16 && real.check.closing_agrees === true, real.check);
    check('REAL sample: 25 money-in rows and 25 money-out rows, exactly the counts on the bank\'s totals line', real.transactions.filter(function (t) { return t.amount > 0; }).length === 25 && real.transactions.filter(function (t) { return t.amount < 0; }).length === 25);
  }
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})();
