// ============================================================
// v55.83-MV — Max (Jul 21): Open Accounts ledger showed the USD running column's
// unchanged constant next to EGP rows because the per-currency running columns
// clipped off-screen on narrow windows ("23,879.90 on every row"). Fix: ONE
// running column showing the ROW'S OWN currency net, currency code stamped in
// the cell. Cross-currency nets stay in the per-currency Summary blocks.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var oa = rd('src/components/OpenAccountsTab.jsx');

ok('1: MV marker present (single own-currency running column documented)',
  /v55\.83-MV/.test(oa) && /ROW'S OWN currency/i.test(oa));

ok('2: per-currency running <th> map is GONE from the ledger header',
  !/ledgerLabel\('running_bal', lang\)\} \{cur\}/.test(oa),
  'found the old "Running <CUR>" per-currency header — columns would clip EGP off-screen again');

ok('3: single running header <th> titled for the row\'s own currency',
  /title="Cumulative running balance after this row, in this row's own currency"/.test(oa));

ok('4: body running cell reads the ROW\'S currency net (entry._running_by_currency[entryCur])',
  /_running_by_currency\[entryCur\]/.test(oa) || /_running_by_currency && entry\._running_by_currency\[entryCur\]/.test(oa));

ok('5: running cell stamps the currency code so mixed-currency rows are unambiguous',
  /mr-1">\{entryCur\}<\/span>\{fmtSigned\(rbForCur\)\}/.test(oa));

ok('6: running-cell IIFE is INVOKED — })()} not })} (a bare function child renders nothing)',
  (function () {
    var i = oa.indexOf("_running_by_currency[entryCur]");
    if (i < 0) return false;
    var after = oa.slice(i, i + 900);
    return after.indexOf('})()}') >= 0;
  })());

ok('7: summary Net row is a single cell with currency stamp (no col!==cur filler tds)',
  !/col !== cur\) return <td/.test(oa) &&
  /mr-1">\{cur\}<\/span>\{fmtSigned\(cs\.balance\)\}/.test(oa));

ok('8: colSpan math no longer depends on s.currencies.length (fixed 1 running col)',
  !/colSpan=\{[^}]*s\.currencies\.length/.test(oa) &&
  /4 \+ 3 \+ 1 \+ \(canEdit \? 1 : 0\)/.test(oa));

ok('9: FIFO trail remains the running-balance source of truth (HOTFIX 3 untouched)',
  /_running_by_currency = nets/.test(oa) && /simulate\(arr\)/.test(oa));

ok('10: per-currency Summary blocks retained (cross-currency nets still visible)',
  /Per-currency Summary block/.test(oa) && /\{cur\} Summary/.test(oa));

console.log('');
if (failures.length) { console.log('FAILED: ' + failures.length); process.exit(1); }
console.log('ALL PASS (10 checks)');
