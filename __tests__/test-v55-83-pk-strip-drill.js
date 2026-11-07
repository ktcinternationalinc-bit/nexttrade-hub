// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PK — Strip drill-down + visibility fix + period presets
//
// Max (Nov 7, 02:22, screenshot): "what the hell are these numbers coming
// from?. i also asked that the dates has something from june 1st (as
// selection next to month year etc)" — the strip's In/Out rows were also
// nearly invisible (dark inline text inside a card the hub's dark skin had
// repainted), the exact contrast bug class fixed before in OZ/PA.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PK — strip drill + contrast + presets');

var bh = R('src/components/BooksHomeTab.jsx');

// 1. Contrast: the strip card declares its own WHITE background inline, so the
//    inline dark table text can never sit on a skin-darkened card again.
var stripIdx = bh.indexOf('Late & upcoming — in vs out');
var cardSlice = bh.substring(stripIdx - 400, stripIdx);
ok('1: strip card background is explicit inline #ffffff (dark-skin override), header color inline too',
  /background: '#ffffff', border: '1px solid #e2e8f0'/.test(cardSlice) &&
  cardSlice.indexOf('className="bg-white rounded-xl border border-slate-200 p-3">\n      <div className="flex gap-2 items-center mb-2">\n        <div className="text-xs font-extrabold text-slate-900">📈') < 0);

// 2. Every In/Out number is a BUTTON that opens the rows behind it
ok('2a: In cells click through to the invoices behind the number',
  /setFcDrill\(\{ bucket: b, kind: 'in' \}\)/.test(bh) && /Show the invoices behind this number/.test(bh));
ok('2b: Out cells click through to the bills behind the number',
  /setFcDrill\(\{ bucket: b, kind: 'out' \}\)/.test(bh) && /Show the bills behind this number/.test(bh));
ok('2c: the drill panel sums its rows and says it equals the number to the cent; rows come from fc.rows (same payload as the card — one source of truth)',
  /equals the number above to the cent/.test(bh) &&
  /\(fc\.rows \|\| \[\]\)\.filter\(function \(r\) \{ return r\.bucket === fcDrill\.bucket && r\.kind === fcDrill\.kind; \}\)/.test(bh));
ok('2d: big buckets are capped at 80 rows with an honest pointer to the full Forecast list',
  /all\.slice\(0, 80\)/.test(bh) && /Showing the biggest \{shown\.length\} of \{all\.length\}/.test(bh));

// 3. Period presets
ok('3a: Books home presets include "Jun 1 →" and "This year"',
  bh.indexOf("['Jun 1 →', '2026-06-01', '']") >= 0 && bh.indexOf("['This year', TODAY.substring(0, 4) + '-01-01', '']") >= 0);
var ps = R('src/components/PeriodStatsTab.jsx');
ok('3b: Stats tab has Jun 1 / This month / Last month / This year preset chips next to the date pickers',
  /\['Jun 1 →', '2026-06-01', TODAY\]/.test(ps) && /\['This month', m0, TODAY\]/.test(ps) &&
  /\['Last month', lmFrom, lmEnd\]/.test(ps) && /\['This year', y \+ '-01-01', TODAY\]/.test(ps));

console.log('');
console.log('PK: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
