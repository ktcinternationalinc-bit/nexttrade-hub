// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RT — Max, Nov 9 21:42 (screenshot of 💸 Bills): "the font on the bottom 2 are the same color as the
// background and thus cannot see them. WHY. fix it now"
// WHY: the Bills page sat on a `bg-white` card, which the dark skin repaints dark; the bills that are NOT overdue had
// no background of their own and dark text → dark on dark. Overdue rows were readable only because they paint orange.
// Fix: the page is an .nt-paper panel (white, the dark skin cannot repaint it) and every row paints its own background.
// Checked in a real browser (Playwright) with the built stylesheet + dark skin: rows, bill lines, price rules, reports.
// Also: a rate is now compared EXACTLY ($0.105 vs $0.10 was let through), and rates print as $0.10, not $0.1.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs'); var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var L = require(path.join(root, 'src/lib/bill-lines.js'));
var pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name + '  ' + JSON.stringify(extra || '')); } }
console.log('RT — Bills readable in the dark skin; exact rate check');
var B = R('src/components/BillsTab.jsx');
ok('1a: the Bills page is a white .nt-paper panel (no bg-white card the dark skin repaints)', B.indexOf('<div className="nt-paper rounded-xl border border-slate-200 p-3" style={{ background: \'#ffffff\', color: \'#0f172a\' }}>') > 0 && !/className="bg-white rounded/.test(B));
ok('1b: every bill row paints its own background — white (not overdue) or orange (overdue) — with dark text', B.indexOf("{ background: '#ffedd5', color: '#431407', borderBottom: '1px solid #e2e8f0' } : { background: '#ffffff', color: '#0f172a', borderBottom: '1px solid #e2e8f0' }") > 0);
ok('1c: the new panels are white panels too (lines on a light row, price rules, reports)', R('src/components/PriceRulesPanel.jsx').indexOf('nt-paper') > 0 && R('src/components/BillReportsPanel.jsx').indexOf('nt-paper') > 0 && B.indexOf("background: '#f8fafc', color: '#334155'") > 0);
var CSS = R('src/app/globals.css');
ok('1d: .nt-paper wins over the dark skin (white background, dark text, !important)', CSS.indexOf('.nt-paper, .nt-paper.bg-white {') > 0 && CSS.indexOf('background: #ffffff !important;') > 0);
function chk(price, exp, tol) { return L.priceCheck({ vendor_name: 'V', total_amount: Math.round(1000 * price * 100) / 100 }, [L.shapeLine({ description: 'Item A', qty: 1000, unit_price: price, amount: Math.round(1000 * price * 100) / 100 }, 0)], [{ id: 'r', item_match: 'Item A', expected_unit_price: exp, tolerance_pct: tol }], null); }
ok('2a: a rate is compared exactly at 0%: $0.105 vs $0.10 is FLAGGED; $0.10 vs $0.10 is OK', chk(0.105, 0.10, 0).status === 'flagged' && chk(0.10, 0.10, 0).status === 'ok');
ok('2b: the allowed % still works: $0.105 vs $0.10 with 5% allowed is OK, with 4% it is flagged', chk(0.105, 0.10, 5).status === 'ok' && chk(0.105, 0.10, 4).status === 'flagged');
ok('2c: rates print as $0.10 / $0.105 (not $0.1)', /\$0\.10\b/.test(chk(0.10, 0.09, 0).flags[0].text) && /\$0\.105/.test(chk(0.105, 0.10, 0).flags[0].text), chk(0.10, 0.09, 0).flags[0].text);
ok('2d: a price flag a person already resolved shows as resolved (amber), not as still needing a person', R('src/components/BillLinesPanel.jsx').indexOf("'Price check — flagged, resolved by a person'") > 0); // superseded wording (v55.83-RV: the organized price-check table)
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
