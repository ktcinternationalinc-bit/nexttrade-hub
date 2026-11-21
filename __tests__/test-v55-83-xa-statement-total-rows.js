// v55.83-XA — vendor statement check: a total row is a total, never an invoice (Max, 21 Nov 2026, NexPac screenshot: "You should be
// smart enough to know that the total line is not a missing invoice or an invoice. It's just an aggregation of all the invoices.")
// His layout: Date / Type (Invoice or Credit Memo) / Number / Amount / Status (overdue / unapplied), ending in a total row with an
// amount and no date, type or number. All numbers here are SYNTHETIC (not his).
// RUN: the REAL lib/vendor-statement.js (sheet path, discipline, check, export), the REAL route with the reader stubbed, and the REAL
// panel driven through its handlers.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1400))); }
console.log('XA — statement total rows are totals');
var V = require(path.join(root, 'src/lib/vendor-statement.js'));

// ── 1. Max's layout through the sheet path (spreadsheet / tab paste)
var rows = [['Date', 'Type', 'Number', 'Amount', 'Status'],
  ['09/02/2026', 'Invoice', '14401', '$ 3,000.00', 'Overdue'],
  ['09/15/2026', 'Invoice', '14420', '$ 2,500.00', 'Overdue'],
  ['09/20/2026', 'Credit Memo', 'CM-311', '$ 150.00', 'Unapplied'],
  ['10/03/2026', 'Invoice', '14455', '$ 4,000.00', 'Overdue'],
  ['', '', '', '$ 9,350.00', '']];
var G = V.guessColumns(rows);
check('the columns of his layout are found: Date, Type, Number, Amount (Status ignored)', G.header === 0 && G.map.date === 0 && G.map.kind === 1 && G.map.ref === 2 && G.map.amount === 3 && G.map.open === undefined, G);
var LR = V.linesFromRows(rows, G.header, G.map, 'mdy', '');
var info = {}; var probs = []; var L = V.cleanStatementLines(LR.lines, probs, info);
check('the Credit Memo row is a CREDIT (−150), never an invoice', L.filter(function (l) { return l.ref === 'CM-311'; })[0].kind === 'credit' && L.filter(function (l) { return l.ref === 'CM-311'; })[0].amount === -150, L);
check('the last row (amount, no date / type / number) is a TOTAL ROW: not a line', L.length === 4 && L.every(function (l) { return l.kind !== 'total' && l.ref; }) && info.rows.length === 5 && info.rows[4].kind === 'total', info.rows);
check('… and it is CHECKED: $9,350.00 = 3,000 + 2,500 − 150 + 4,000 = the 4 lines above it ✓ (no warning)', info.totals.length === 1 && info.totals[0].equals === true && info.totals[0].value === 9350 && info.total_mismatch === false && info.grand_total === 9350 && probs.length === 0 && /= the 4 lines above it ✓ — taken as their total, not as an invoice/.test(V.totalRowWords(info.totals[0])), [info.totals, probs]);
var bills = [
  { id: 'b1', vendor_name: 'NexPac Corporation', bill_number: '14401', bill_date: '2026-09-02', total_amount: 3000, currency: 'USD', record_status: 'active', validation_status: 'validated' },
  { id: 'b2', vendor_name: 'NexPac Corporation', bill_number: '14420', bill_date: '2026-09-15', total_amount: 2500, currency: 'USD', record_status: 'active', validation_status: 'validated' },
  { id: 'b3', vendor_name: 'NexPac Corporation', bill_number: '14455', bill_date: '2026-10-03', total_amount: 4000, currency: 'USD', record_status: 'active', validation_status: 'validated' }];
var R = V.checkStatement({ lines: L, vendorNames: ['NexPac Corporation'], bills: bills, payments: [] });
check('the check: 3 invoices OPEN — MATCHES, the credit memo a credit line, NOTHING missing (the total row is not a missing invoice)', R.rows.length === 4 && R.rows.filter(function (r) { return r.status === 'open_match'; }).length === 3 && R.rows.filter(function (r) { return r.status === 'not_bill'; }).length === 1 && R.totals.by_status.missing.count === 0, R.rows.map(function (r) { return r.line.ref + ':' + r.status; }));
check('they say we owe = 9,350.00 (the lines, the total row NOT added a second time); adds up to the total row', R.totals.they_say_we_owe === 9350 && V.statementAddsUp(L, info.grand_total).agrees === true);
// ── 2. Codex 09:51: an amount-only row that does NOT add up is NOT assumed to be a total — it stays visible as a row to check
var short = rows.slice(0, 4).concat([rows[5]]); // the 14455 line was not read
var i2 = {}; var p2 = []; var L2 = V.cleanStatementLines(V.linesFromRows(short, 0, G.map, 'mdy', '').lines, p2, i2);
check('unlabelled amount-only 9,350 vs lines 5,350: NOT a total and NOT an invoice — kept as a row TO CHECK (said), the read is not clean, no statement total promoted', L2.length === 4 && L2[3].kind === 'unknown' && i2.totals.length === 0 && i2.unknown_rows === 1 && i2.total_mismatch === true && i2.grand_total === null && p2.some(function (p) { return /has no number, date or type and does NOT equal the lines above it/.test(p); }), [i2, p2]);
var RU = V.checkStatement({ lines: L2, vendorNames: ['NexPac Corporation'], bills: bills, payments: [] });
check('… in the check it is ROW TO CHECK — NO NUMBER (never MISSING FROM THE HUB) and is not added to what they say we owe', RU.rows[3].status === 'to_check' && RU.totals.by_status.missing.count === 0 && RU.totals.they_say_we_owe === 5350 && /Check it on the statement|check it on the statement/.test(RU.rows[3].notes.join(' ')), RU.rows[3]);
var labelled = V.cleanStatementLines([{ ref: 'A', date: '2026-10-01', amount: 100 }, { ref: 'Total', amount: 900 }], (p2 = []), (i2 = {}));
check('a LABELLED total ("Total") that does not equal the lines stays a total row, said in red (a line may be missing)', labelled.length === 1 && i2.totals.length === 1 && i2.totals[0].equals === false && i2.total_mismatch === true && /NOT correct: the total \$900\.00 does not equal the lines above it \(\$100\.00\)/.test(V.totalRowWords(i2.totals[0])) && p2.some(function (p) { return /is NOT correct: the total \$900\.00/.test(p); }));
var expl = V.cleanStatementLines([{ ref: 'A', date: '2026-10-01', amount: 100 }, { ref: null, amount: 30, kind: 'credit' }, { ref: null, amount: 20, kind: 'payment' }], [], (i2 = {}));
check('an amount-only row the reader marked credit or payment keeps that kind (never turned into a total); credits are negative', expl.length === 3 && expl[1].kind === 'credit' && expl[1].amount === -30 && expl[2].kind === 'payment' && i2.totals.length === 0);
var openSt = V.cleanStatementLines([{ ref: 'A', date: '2026-10-01', amount: 1000, open: 400 }, { ref: 'P1', date: '2026-10-05', amount: -600, kind: 'payment' }, { ref: 'B', date: '2026-10-06', amount: 500, open: 500 }, { ref: null, amount: null, open: 900 }], [], (i2 = {}));
check('open-column statement: the total 900 = 400 + 500 (the same rule as "they say we owe": the payment already inside the open amounts is not subtracted again)', openSt.length === 3 && i2.totals.length === 1 && i2.totals[0].equals === true && i2.grand_total === 900);
var lastSub = V.cleanStatementLines([{ ref: 'A', date: '2026-10-01', amount: 100 }, { ref: 'Subtotal', amount: 100 }, { ref: 'B', date: '2026-10-02', amount: 40 }, { ref: 'Subtotal', amount: 40 }], [], (i2 = {}));
check('page subtotals with no grand total: both checked ✓, but neither becomes the statement total (printed total stays unknown)', lastSub.length === 2 && i2.totals.length === 2 && i2.totals.every(function (t) { return t.equals && t.subtotal; }) && i2.grand_total === null && /^Subtotal row \$40\.00/.test(V.totalRowWords(i2.totals[1])));
// ── 3. page subtotals + a grand total; "Total" words; a real invoice with a number but no date stays an invoice
var mixed = V.cleanStatementLines([{ ref: 'A', date: '2026-10-01', amount: 100 }, { ref: 'B', date: '2026-10-02', amount: 200 }, { ref: null, amount: 300 },
  { ref: 'C', amount: 50 }, { ref: 'Subtotal', amount: 50 }, { ref: 'Grand Total', amount: 350 }, { ref: 'NO-DATE-9', amount: 25 }], [], (i2 = {}));
check('page subtotal 300 = A+B, subtotal 50 = C, grand total 350 = all: three total rows, all ✓; C (number, no date) and NO-DATE-9 stay invoices', mixed.map(function (l) { return l.ref; }).join(',') === 'A,B,C,NO-DATE-9' && i2.totals.length === 3 && i2.totals.every(function (t) { return t.equals; }) && i2.totals[0].of === 'since' && i2.totals[2].of === 'all' && i2.grand_total === 350, i2.totals);
var withT = V.cleanStatementLines([{ ref: 'X1', date: '2026-10-01', amount: 10, t: 'Invoice' }, { ref: 'CM-1', date: '2026-10-02', amount: 4, k: 'invoice', t: 'Credit Memo' }, { ref: null, t: 'Total', date: null, amount: 6 }], [], (i2 = {}));
check('reader path: a row the reader called "invoice" but whose printed type is Credit Memo is a credit; a row typed Total is a total (10 − 4 = 6 ✓)', withT.length === 2 && withT[1].kind === 'credit' && withT[1].amount === -4 && i2.totals.length === 1 && i2.totals[0].equals === true);
check('re-cleaning the kept rows (what the screen does on every correction) gives the same lines and the same total check', (function () { var i3 = {}; var again = V.cleanStatementLines(i2.rows, [], i3); return again.length === 2 && i3.totals.length === 1 && i3.totals[0].equals === true; })());
check('prompt: a total row is not a line (grand total → printed_total); Credit Memo = credit; the printed type t is asked for', /A total row \(an amount with no date, no type and no number/.test(V.STATEMENT_PROMPT) && /"Credit Memo" \/ "Credit" \/ "CM"/.test(V.STATEMENT_PROMPT) && /"t": string\|null/.test(V.STATEMENT_PROMPT));
// ── 4. the reader's answer: total row as a line, no printed_total → the row becomes the printed total
var P = V.parseStatementReading(JSON.stringify({ vendor_name: 'NexPac Corporation', printed_total: null, lines: [{ r: '14401', d: '2026-09-02', amt: 3000, t: 'Invoice' }, { r: 'CM-311', d: '2026-09-20', amt: 150, t: 'Credit Memo' }, { r: null, d: null, amt: 2850 }] }));
check('reader answer: the total row is a total (not a line), its 2,850 becomes the printed total ("from their total row"), lines 2', P.lines.length === 2 && P.rows.length === 3 && P.totals[0].equals === true && P.statement.printed_total === 2850 && P.statement.printed_total_from_row === true, P);
var P2 = V.parseStatementReading(JSON.stringify({ vendor_name: 'V', printed_total: 3000, lines: [{ r: 'A', d: '2026-09-02', amt: 2850 }, { r: null, d: null, amt: 2850 }] }));
check('reader answer: a printed total that differs from the last total row is said', P2.problems.some(function (p) { return /is not the same as its last total row/.test(p); }), P2.problems);
var csv = V.statementCsv(R, { total_rows: info.totals });
check('export: the total row is listed as "Their total row (not an invoice)" with its source row, its column and its check, and is not a line of the export', csv.indexOf('Their total row (not an invoice),,row 6,,original 9350,correct') > 0 && csv.split('\r\n').filter(function (x) { return /^\d+,/.test(x); }).length === 4, csv.substring(0, 700));
// ── Codex 10:04 — an Original + Open (outstanding) statement: EACH column of the total row against its own column
function twoCol(tAmt, tOpen) { var i = {}; var p = []; var ls = V.cleanStatementLines([{ ref: 'A', date: '2026-10-01', amount: 1000, open: 600, page: 2 }, { ref: 'Total', amount: tAmt, open: tOpen, page: 2 }], p, i); return { ls: ls, i: i, p: p }; }
var bad = twoCol(1000, 500);
check('Original 1000 / Open 600, Total row original 1000 / OPEN 500 → NOT correct: the open total 500 does not equal the open amounts 600 (the matching original total does NOT clear it); incomplete; their printed open 500 stays the statement total and visibly disagrees', bad.i.totals[0].equals === false && bad.i.total_mismatch === true && bad.i.grand_total === 500 && V.statementAddsUp(bad.ls, bad.i.grand_total).agrees === false && /the open total \$500\.00 does not equal the open amounts above it \(\$600\.00\)/.test(V.totalRowWords(bad.i.totals[0])) && bad.p.some(function (x) { return /is NOT correct: the open total \$500\.00 does not equal the open amounts above it/.test(x); }), [bad.i.totals, bad.p]);
var good = twoCol(1000, 600);
check('control: Total row original 1000 / open 600 → correct ✓, the payable statement total is the OPEN 600', good.i.totals[0].equals === true && good.i.totals[0].value === 600 && good.i.grand_total === 600 && good.p.length === 0);
var origOnly = twoCol(1000, null);
check('control: an original-amount-only total 1000 on the same statement → correct as the ORIGINAL column ("$1,000.00 (original-amount column) = the original amounts of the 1 line"), never shown as the open balance, not promoted', origOnly.i.totals[0].equals === true && origOnly.i.totals[0].column_only === true && origOnly.i.grand_total === null && /^Total row \$1,000\.00 \(original-amount column\) \(“Total”\) = the original amounts of the 1 line above it ✓/.test(V.totalRowWords(origOnly.i.totals[0])), V.totalRowWords(origOnly.i.totals[0]));
var badOrig = twoCol(900, 600);
check('the reverse: open 600 correct but ORIGINAL 900 wrong (lines 1000) → NOT correct, the original-amount total is named', badOrig.i.totals[0].equals === false && /the original-amount total \$900\.00 does not equal the original amounts above it \(\$1,000\.00\)/.test(V.totalFailWords(badOrig.i.totals[0])));
var badCsv = V.statementCsv({ rows: [], ours_not_on_statement: [], totals: {}, mode: { words: '' } }, { total_rows: bad.i.totals });
check('export of the wrong open total: label, page, both columns and the column-by-column failure', badCsv.indexOf('Their total row (not an invoice),Total,page 2,open 500,original 1000,NOT correct: the open total $500.00 does not equal the open amounts above it ($600.00)') > 0, badCsv);

// ── 5. the real route: the reader returns his total row as a line
var st = { reply: null };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', { assertPermission: function () { return Promise.resolve({ ok: true }); } });
var calls = [];
var recDb = { from: function (t) { calls.push(t); throw new Error('no table'); }, rpc: function (n) { calls.push(n); throw new Error('no rpc'); } };
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return recDb; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test'; process.env.ANTHROPIC_API_KEY = 'k';
global.fetch = function () { return Promise.resolve({ json: function () { return Promise.resolve({ content: [{ type: 'text', text: st.reply }], stop_reason: 'end_turn' }); } }); };
var Route = require(path.join(root, 'src/app/api/accounting/vendor-statement/route.js'));
function call(body) { return Route.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json(); }); }

(async function () {
  st.reply = JSON.stringify({ vendor_name: 'NexPac Corporation', statement_date: '2026-10-31', printed_total: null, currency: 'USD', lines: [
    { r: '14401', d: '2026-09-02', amt: 3000, k: 'invoice', t: 'Invoice' }, { r: '14420', d: '2026-09-15', amt: 2500, k: 'invoice', t: 'Invoice' },
    { r: 'CM-311', d: '2026-09-20', amt: 150, k: 'credit', t: 'Credit Memo' }, { r: '14455', d: '2026-10-03', amt: 4000, k: 'invoice', t: 'Invoice' }, { r: null, d: null, amt: 9350, k: 'invoice' }] });
  var j = await call({ action: 'read', text: 'NexPac statement pasted' });
  check('ROUTE: lines come back in order with the total row marked kind "total"; total_rows says it equals; printed total 9,350 from it; adds up; nothing incomplete', j.ok === true && j.lines.length === 5 && j.lines[4].kind === 'total' && j.total_rows.length === 1 && j.total_rows[0].equals === true && j.statement.printed_total === 9350 && j.adds_up.agrees === true && j.incomplete.length === 0, j);
  st.reply = JSON.stringify({ vendor_name: 'NexPac Corporation', lines: [{ r: '14401', d: '2026-09-02', amt: 3000 }, { r: null, d: null, amt: 9350 }] });
  var j2 = await call({ action: 'read', text: 'NexPac statement pasted' });
  check('ROUTE: an amount-only row that does not equal the lines read → kept as a row to check (kind unknown), the read is INCOMPLETE, no statement total invented', j2.ok === true && j2.lines[1].kind === 'unknown' && j2.incomplete.some(function (x) { return /1 row\(s\) with only an amount/.test(x); }) && j2.statement.printed_total === null, j2);
  st.reply = JSON.stringify({ vendor_name: 'NexPac Corporation', lines: [{ r: '14401', d: '2026-09-02', amt: 3000 }, { r: 'Total', amt: 9350 }] });
  var j3 = await call({ action: 'read', text: 'NexPac statement pasted' });
  check('ROUTE: a LABELLED total that does not equal the lines → INCOMPLETE ("their total row $9,350.00 (Total): the total $9,350.00 does not equal the lines above it ($3,000.00)")', j3.ok === true && j3.lines[1].kind === 'total' && j3.incomplete.some(function (x) { return /their total row \$9,350\.00 \(Total\): the total \$9,350\.00 does not equal the lines above it \(\$3,000\.00\)/.test(x); }), j3.incomplete);
  st.reply = JSON.stringify({ vendor_name: 'V', lines: [{ r: 'A', d: '2026-10-01', amt: 1000, open: 600 }, { r: 'Total', amt: 1000, open: 500 }] });
  var j4 = await call({ action: 'read', text: 'two-column statement' });
  check('ROUTE (Codex 10:04): Original 1000 / Open 600 with a Total row of original 1000 / open 500 → INCOMPLETE naming the open total', j4.ok === true && j4.incomplete.some(function (x) { return /the open total \$500\.00 does not equal the open amounts above it \(\$600\.00\)/.test(x); }) && j4.adds_up.agrees === false, j4);
  check('ROUTE: still no table / rpc touched', calls.length === 0, calls);

  // ── 6. the panel, driven: paste his rows (tab-separated) → columns → the total row shown as a checked total → check: nothing missing
  var hs = { vals: [], i: 0 };
  var reactPath = require.resolve('react', { paths: [root] }); var realReact = require(reactPath);
  var shim = Object.assign({}, realReact, { useState: function (init) { var i = hs.i++; if (!(i in hs.vals)) { hs.vals[i] = typeof init === 'function' ? init() : init; } return [hs.vals[i], function (v) { hs.vals[i] = typeof v === 'function' ? v(hs.vals[i]) : v; }]; }, useMemo: function (fn) { hs.i++; return fn(); }, useRef: function (v) { var i = hs.i++; if (!(i in hs.vals)) { hs.vals[i] = { current: v }; } return hs.vals[i]; }, useEffect: function () { hs.i++; } });
  shim.default = shim;
  var panelPath = require.resolve(path.join(root, 'src/components/VendorStatementPanel.jsx'));
  var saved = require.cache[reactPath]; delete require.cache[panelPath]; require.cache[reactPath] = { id: reactPath, filename: reactPath, loaded: true, exports: shim };
  var Panel = require(panelPath).default; require.cache[reactPath] = saved;
  var RS = require('react-dom/server');
  var props = { bills: bills, payments: [], enrichWarnings: [], userProfile: { id: 'u1' }, onClose: function () {} };
  function render() { hs.i = 0; return Panel(props); }
  function kids(el) { var c = el && el.props && el.props.children; return c === undefined || c === null ? [] : (Array.isArray(c) ? c : [c]); }
  function walk(el, fn) { if (el === null || el === undefined || typeof el === 'boolean') { return; } if (Array.isArray(el)) { el.forEach(function (x) { walk(x, fn); }); return; } if (typeof el !== 'object') { return; } fn(el); kids(el).forEach(function (k) { walk(k, fn); }); }
  function txt(el) { var out = ''; (function t(e) { if (e === null || e === undefined || typeof e === 'boolean') { return; } if (typeof e === 'string' || typeof e === 'number') { out += e; return; } if (Array.isArray(e)) { e.forEach(t); return; } kids(e).forEach(t); })(el); return out; }
  function find(tree, pred) { var hit = null; walk(tree, function (el) { if (!hit && pred(el)) { hit = el; } }); return hit; }
  function btn(tree, label) { return find(tree, function (el) { return el.type === 'button' && txt(el).indexOf(label) >= 0; }); }
  find(render(), function (el) { return el.type === 'textarea'; }).props.onChange({ target: { value: rows.map(function (r) { return r.join('\t'); }).join('\n') } });
  btn(render(), 'Read the pasted text').props.onClick();
  btn(render(), 'Use these columns').props.onClick();
  var h1 = RS.renderToStaticMarkup(render());
  check('PANEL: "4 lines taken + 1 total row (checked, not invoices)", "Read from pasted rows: 4 lines", and "✓ Total row $9,350.00 = the 4 lines above it"', h1.indexOf('4 lines taken + 1 total row (checked, not invoices)') > 0 && h1.indexOf('Read from pasted rows: 4 lines') > 0 && h1.indexOf('✓ Total row $9,350.00 = the 4 lines above it ✓') > 0 && h1.indexOf('INCOMPLETE READ') < 0, [h1.indexOf('INCOMPLETE READ'), (h1.match(/rows after the headings[^<]*/) || [])[0], (h1.match(/Read from[^<]*/) || [])[0], (h1.match(/Total row[^<]*/) || [])[0]]);
  check('PANEL: the printed total is filled from their total row and agrees', h1.indexOf('Their lines add up to the total printed on the statement ($9,350.00)') > 0);
  var vbox = find(render(), function (el) { return el.type === 'label' && txt(el).indexOf('NexPac Corporation · ') === 0; });
  find(vbox, function (el) { return el.type === 'input'; }).props.onChange();
  btn(render(), '3. Check every line').props.onClick();
  var h2 = RS.renderToStaticMarkup(render());
  check('PANEL: after the check, NO "MISSING FROM THE HUB" (the total row is not an invoice), they say we owe $9,350.00, the credit memo is a credit line', h2.indexOf('MISSING FROM THE HUB ·') < 0 && h2.indexOf('They say we owe: $9,350.00 USD') > 0 && h2.indexOf('CREDIT / PAYMENT / BALANCE LINE') > 0 && h2.indexOf('OPEN — MATCHES · 3') > 0, h2.substring(0, 900));
  var amountInput = find(render(), function (el) { return el.type === 'input' && el.props['aria-label'] === 'Amount, line 4'; });
  amountInput.props.onChange({ target: { value: '400' } });
  var h3 = RS.renderToStaticMarkup(render());
  check('PANEL: correcting a line re-checks the total row live — 14455 typed as 400 → the total no longer equals → INCOMPLETE READ', h3.indexOf('⛔ Total row $9,350.00 — NOT correct: the total $9,350.00 does not equal the lines above it ($5,750.00)') > 0 && h3.indexOf('INCOMPLETE READ') > 0, h3.substring(0, 900));

  // the two-column statement (Codex 10:04) through the panel: the wrong OPEN total shows INCOMPLETE and stays inspectable
  hs = { vals: [], i: 0 };
  find(render(), function (el) { return el.type === 'textarea'; }).props.onChange({ target: { value: 'Invoice #\tDate\tOriginal Amount\tOpen\nA-1\t10/01/2026\t1,000.00\t600.00\nTotal\t\t1,000.00\t500.00' } });
  btn(render(), 'Read the pasted text').props.onClick();
  btn(render(), 'Use these columns').props.onClick();
  var h4 = RS.renderToStaticMarkup(render());
  check('PANEL (Codex 10:04): Original 1,000 / Open 600 with Total 1,000 / 500 → "the open total $500.00 does not equal the open amounts above it ($600.00)" and INCOMPLETE READ; the line itself stays listed', h4.indexOf('the open total $500.00 does not equal the open amounts above it ($600.00)') > 0 && h4.indexOf('INCOMPLETE READ') > 0 && h4.indexOf('Read from pasted rows: 1 line') > 0, (h4.match(/INCOMPLETE[^<]*|Total row[^<]*|Read from[^<]*/g) || []));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
