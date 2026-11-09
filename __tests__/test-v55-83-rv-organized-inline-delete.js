// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RV — Max, Nov 9 22:47 (screenshots: a flagged NexPac bill, a wire he could not delete):
//  "please make the error message more organized and looking professionally organized"
//  "i cannot delete..it doesn't work. i asked you to make sure that you did a bug review and gap review"
//  "the validation section should go BELOW the actual bill and above the view of the bill... so we are not scrolling all
//   the way up when we get to those further down"
//  22:48 "forget about comment about commission i misunderstood. but all other issues are to be resolved"
// Delete: the database was fine (tested on PG16 — draft + lines deleted); the 🗑 Delete it button was greyed out until a
// reason was typed and said nothing. Clicked through on the real wire route in-session (no reason → red message; reason →
// deleted, bill free, history kept). Screens checked in a real browser with the dark skin.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs'); var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var L = require(path.join(root, 'src/lib/bill-lines.js'));
var pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name + '  ' + JSON.stringify(extra || '').substring(0, 400)); } }
console.log('RV — organized price check, panels under the bill, delete always answers');
// 1. organized flags
var ls = [['item', 'Cambridge PVC (LBS)', 901, 0.05, 45.05], ['item', 'Cambridge Thirds (LBS)', 3461, 0.10, 346.10], ['commission', 'Commission 12.5%', 1, 50, 50]].map(function (r, i) { return L.shapeLine({ line_kind: r[0], description: r[1], qty: r[2], unit_price: r[3], amount: r[4] }, i); });
var pc = L.priceCheck({ vendor_name: 'NexPac Corporation', total_amount: 441.15 }, ls, [{ id: 'r', vendor_match: 'NexPac', item_match: 'Cambridge Thirds', unit: 'LBS', expected_unit_price: 0.09, tolerance_pct: 0, note: 'agreed Jun 2026' }], { vendor_match: 'NexPac', rate: 0.125 });
var byCode = {}; pc.flags.forEach(function (f) { byCode[f.code] = f; });
ok('1a: every flag has organized columns: issue · where · billed · expected · difference · effect · checked against', pc.flags.length >= 2 && pc.flags.every(function (f) { return f.cols && ['issue', 'where', 'billed', 'expected', 'diff', 'effect', 'rule'].every(function (k) { return typeof f.cols[k] === 'string' && f.cols[k].length > 0; }); }), pc.flags);
var ph = byCode.PRICE_HIGH.cols;
ok('1b: a price flag reads: Price too high · Line 2 · Cambridge Thirds (LBS) · $0.10/LBS · $0.09/LBS · +$0.01/LBS (+11.1%) · $34.61 overcharged on 3,461 LBS · NexPac, “Cambridge Thirds” — agreed Jun 2026, ±0% allowed',
  ph.issue === 'Price too high' && ph.where === 'Line 2 · Cambridge Thirds (LBS)' && ph.billed === '$0.10/LBS' && ph.expected === '$0.09/LBS' && ph.diff === '+$0.01/LBS (+11.1%)' && ph.effect === '$34.61 overcharged on 3,461 LBS' && ph.rule === 'NexPac, “Cambridge Thirds” — agreed Jun 2026, ±0% allowed', ph);
var cr = byCode.COMMISSION_RATE.cols;
ok('1c: a commission flag reads with thousands separators: Commission too high · $50.00 (12.65%) · $48.89 (12.5% of $391.15)', cr.issue === 'Commission too high' && /^\$50\.00 \(12\.7?8?%?/.test(cr.billed) && cr.expected === '$48.89 (12.5% of $391.15)', cr);
ok('1d: the long sentence is still kept (toasts, import results, the audit trail)', /TOO HIGH/.test(byCode.PRICE_HIGH.text));
var BL = R('src/components/BillLinesPanel.jsx');
ok('1e: the price check box is a table with a clear header ("Price check — N issues need a person"), the lines without a rule listed in one row, and the resolution line',
  BL.indexOf("<th className={th}>Issue</th><th className={th}>Where</th>") > 0 && BL.indexOf("'Price check — ' + flags.length + ' issue'") > 0 && BL.indexOf('<b>No price rule yet:</b>') > 0 && BL.indexOf('Checked against') > 0);
// 2. panels under the bill
var BT = R('src/components/BillsTab.jsx');
ok('2a: validate / pay / dispute / edit / void open in a row right under the bill they are for (not at the top of the page)',
  BT.indexOf('{validating && validating.bill.id === b.id && <tr><td colSpan={11}') > 0 && BT.indexOf('{paying && paying.bill.id === b.id && <tr>') > 0 && BT.indexOf('{disputing && disputing.bill.id === b.id && <tr>') > 0 &&
  BT.indexOf('{editing && editing.id === b.id && <tr>') > 0 && BT.indexOf('{rowAsk && rowAsk.bill.id === b.id && <tr>') > 0 && BT.indexOf('{editing && !editing.id && ') > 0);
ok('2b: the validation panel sits between the bill row and its details (View)', BT.indexOf('{validating && validating.bill.id === b.id && <tr>') < BT.indexOf('{expanded === b.id && <tr>'));
ok('2c: one panel at a time — opening one closes the others (unsaved validation entries are saved first)', BT.indexOf('function closePanels() { if (vRef.current && vTimer.current) { flushV(); }') > 0 && (BT.match(/closePanels\(\);/g) || []).length >= 6);
// 3. no browser pop-ups; delete always answers
var WP = R('src/components/WirePackagesPanel.jsx');
ok('3a: no browser pop-ups left in Bills or Wires (void bill / void payment / resolve dispute / delete wire are asked on the screen)', !/window\.(confirm|prompt|alert)/.test(BT) && !/window\.(confirm|prompt|alert)/.test(WP));
ok('3b: 🗑 Delete it is never silently greyed out: no reason → it says what to type; a refusal from the server is shown in the box',
  WP.indexOf("<Btn big color=\"#b91c1c\" disabled={busy} onClick={function () {") > 0 && WP.indexOf("'Type why first (at least ' + need + ' characters)") > 0 && WP.indexOf("err: (j && j.error) || 'The wire was not deleted — the server did not say why.'") > 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
