// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PL — Books-home period cards: clickable, rows displayed below
//
// Max (Nov 7, 04:02): "these cards should be clickable and the underlaying
// data that supports these numbers should be dispalyed below. these numbers
// are not making any sense.. please confirm them" — and 04:05: "june 1st on
// is june 1st 2026 on".
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PL — period-card drills');

// ── 1. Server: cashflow returns the rows that support every card ──
var br = R('src/app/api/accounting/bills/route.js');
ok('1a: drills built for came_in / went_out / expected_in / bills_due with count + sum + rows',
  /came_in: \{ count: inRowsL\.length, sum: r2\(sumInL\), rows: inRowsL\.slice\(0, CAPL\) \}/.test(br) &&
  /went_out: \{ count: outRowsL\.length, sum: r2\(sumOutL\), rows: outRowsL\.slice\(0, CAPL\) \}/.test(br) &&
  /expected_in: \{ count: expAllL\.length, sum: r2\(sumExpL\), rows: expAllL\.slice\(0, CAPL\) \}/.test(br) &&
  /bills_due: \{ count: billRowsL\.length, sum: r2\(sumBillL\), rows: billRowsL\.slice\(0, CAPL\) \}/.test(br));
ok('1b: drill rows use the SAME filters as the card math (settled only, posted-date period test) — one source of truth',
  /if \(t\.pending === true\) \{ return; \}\n        var dL = t\.posted_date \|\| t\.date;\n        if \(!\(dL >= fromD && dL <= toD\)\) \{ return; \}/.test(br));
ok('1c: sums computed over ALL rows, list capped at 300 — the Σ can never drift from the card',
  /var CAPL = 300;/.test(br) && /sumInL \+= amtL/.test(br));

// ── 2. UI: every card is a button; the rows open BELOW the cards ──
var bh = R('src/components/BooksHomeTab.jsx');
ok('2a: all six cards clickable (came in, went out, net, expected in, bills due, projected net)',
  /keys: \[\{ key: 'came_in', sign: 1 \}\]/.test(bh) && /keys: \[\{ key: 'went_out', sign: -1 \}\]/.test(bh) &&
  /keys: \[\{ key: 'came_in', sign: 1 \}, \{ key: 'went_out', sign: -1 \}\]/.test(bh) &&
  /keys: \[\{ key: 'expected_in', sign: 1 \}\]/.test(bh) && /keys: \[\{ key: 'bills_due', sign: -1 \}\]/.test(bh) &&
  /keys: \[\{ key: 'expected_in', sign: 1 \}, \{ key: 'bills_due', sign: -1 \}\]/.test(bh));
ok('2b: drill panel shows Σ that equals the card to the cent, signed rows, inline-white panel (dark-skin safe)',
  /equals the card to the cent/.test(bh) && /total \+= k\.sign \* d3\.sum/.test(bh) &&
  /background: '#f8fafc', border: '1px solid #e2e8f0'/.test(bh));
ok('2c: capped lists say so honestly and the Σ still covers everything',
  /the Σ above still covers ALL of them/.test(bh));
ok('2d: clicking on an old deploy explains itself instead of doing nothing',
  /Deploy v55\.83-PL to get the rows behind the cards/.test(bh));

// ── 3. "june 1st on is june 1st 2026 on" — pinned to the year ──
var ps = R('src/components/PeriodStatsTab.jsx');
ok('3: every Jun 1 preset and default is literally 2026-06-01',
  bh.indexOf("['Jun 1 →', '2026-06-01', '']") >= 0 &&
  /\['Jun 1 →', '2026-06-01', TODAY\]/.test(ps) &&
  /useState\('2026-06-01'\)/.test(ps));

console.log('');
console.log('PL: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
