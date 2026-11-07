// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PY — The 2026 reports takeover: cash-basis income statement
//
// Max (Nov 7, 11:10): "i need the reports to take over from now for 2026.
// so make it happen.. find a way." The way: the bank record is the ONE
// dated, complete money source for all of 2026 (Wave payments carry no
// dates), so the hub assembles a cash-basis income statement from it —
// the standard filing basis for most LLCs.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PY — cash-basis income statement');

var ps = R('src/components/PeriodStatsTab.jsx');
ok('1: proper statement shape — Revenue − COGS = GROSS, − expenses = OPERATING, ± other = NET; driven by the QuickBooks-style kinds',
  /INCOME STATEMENT \(cash basis, from the bank record\)/.test(ps) &&
  /GROSS PROFIT/.test(ps) && /OPERATING PROFIT/.test(ps) && /NET PROFIT \(cash basis\)/.test(ps) &&
  /c\.kind === 'cogs'/.test(ps));
ok('2: transfers and Not-P&L money (loans, owner) stay OUT by construction; uncategorized money is flagged as OUTSIDE the statement, never hidden',
  /c\.kind !== 'not_pnl'/.test(ps) &&
  /Not filing-ready yet/.test(ps) && /still UNCATEGORIZED and sit outside this statement/.test(ps) &&
  /Every transaction in the period is categorized/.test(ps));
ok('3: the Accountant pack carries it as CSV #12 with the same warnings (12 CSVs total)',
  /tax-pack-12-income-statement-cash-basis-/.test(ps) &&
  /WARNING: uncategorized deposits OUTSIDE this statement/.test(ps) &&
  /12 CSVs for/.test(ps));
ok('4: the statement says what cash basis means and defers the basis choice to the accountant — no legal overreach',
  /income when received, expenses when paid/.test(ps) && /your accountant confirms which basis you file on/.test(ps));

console.log('');
console.log('PY: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
