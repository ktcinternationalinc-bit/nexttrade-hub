// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PN — Sales with ACTUAL invoices inside the money in & out section
//
// Max (Nov 7, 04:16): "also need to see sales (with actual invoices) as part
// of in and out section. add a new set of rows with this data.."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PN — invoice-backed sales rows on Books home');

var bh = R('src/components/BooksHomeTab.jsx');
ok('1: new row of cards — INVOICED / COLLECTED / STILL OPEN — fed by the SAME period_stats engine as the Stats tab (one source of truth)',
  /action: 'period_stats', from: f, to: t \|\| TODAY/.test(bh) &&
  /SALES — ACTUAL INVOICES IN THIS PERIOD/.test(bh) &&
  /invoices issued in the period/.test(bh) && /payments recorded on invoices in the period/.test(bh) &&
  /invoiced in period, not yet paid/.test(bh));
ok('2: all three cards clickable with ps-sourced drills (invoiced / collected / open_invoices)',
  /src: 'ps', title: 'Invoiced — actual invoices issued in this period'/.test(bh) &&
  /keys: \[\{ key: 'collected', sign: 1 \}\]/.test(bh) &&
  /keys: \[\{ key: 'open_invoices', sign: 1 \}\]/.test(bh));
ok('3: drill Σ comes from the card figures themselves (sum: inv2.invoiced), so the panel always equals the card',
  /invoiced: \{ count: inv2\.count \|\| 0, sum: inv2\.invoiced \|\| 0, rows: \(ps\.drills && ps\.drills\.invoiced\) \|\| \[\] \}/.test(bh) &&
  /open_invoices: \{ count: \(\(ps\.drills && ps\.drills\.open_invoices\) \|\| \[\]\)\.length, sum: inv2\.still_open_from_period \|\| 0/.test(bh));
ok('4: period reload refreshes the invoice rows too, and a denied load hides the row instead of hanging',
  /loadCashflow\(f, t\); loadPeriodStats\(f, t\);/.test(bh) &&
  /\{ setPs\(j\); \} else \{ setPs\(null\); \}/.test(bh) &&
  /check your Bills\/AR permission/.test(bh));

console.log('');
console.log('PN: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
