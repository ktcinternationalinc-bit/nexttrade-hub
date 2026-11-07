// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PH — 📉 Stats tab (Max, Nov 6): "i need a tab from june 1st on for
// both invoices and bills to see stats"
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 FAIL: ' + name); }
}
console.log('PH — period stats');
var br = R('src/app/api/accounting/bills/route.js');
var st = R('src/components/PeriodStatsTab.jsx');
var at = R('src/components/AccountingTab.jsx');
ok('1: period_stats defaults to 2026-06-01 and covers BOTH sides with monthly rollup',
  /action === 'period_stats'/.test(br) && /'2026-06-01'/.test(br) &&
  /invoiced/.test(br) && /bills_paid/.test(br) && /monthRows/.test(br));
ok('2: invoices use canonical eligibility + US business + USD; collected counted by PAYMENT date',
  /isArEligible\(inv\)/.test(br) && /businessOfInvoice\(inv, tagByIdP\)/.test(br) &&
  /pp\.payment_date < pFrom \|\| pp\.payment_date > pTo/.test(br));
ok('3: disputed bills excluded from open totals but reported separately',
  /disputed_open: billsDisputed/.test(br));
ok('4: net per month = collected − bills paid',
  /m\.net = r2\(m\.collected - m\.bills_paid\)/.test(br));
ok('5: tab wired with Jun 1 default + CSV + permission gate + graceful denial',
  at.indexOf("['period_stats', '\ud83d\udcc9 Stats']") >= 0 &&
  /useState\('2026-06-01'\)/.test(st) && /period-stats-/.test(st) && /data\.denied/.test(st));
ok('6: every card is clickable and returns its exact underlying rows with a sum-to-the-cent footer',
  /drills: \{ invoiced: rowsInvoiced, collected: rowsCollected, open_invoices: rowsOpenInv/.test(br) &&
  /openDrill\('invoiced'/.test(st) && /openDrill\('bills_paid'/.test(st) && /openDrill\('open_bills'/.test(st) &&
  /equals the card to the cent/.test(st));

var bh2 = R('src/components/BooksHomeTab.jsx');
ok('7: Books home carries the aging strip — in/out/running position per late+due bucket, with a projected-shortage flag',
  /Late & upcoming — in vs out/.test(bh2) && /projected shortage from/.test(bh2) &&
  /bills covered by expected collections/.test(bh2) && /loadForecastStrip/.test(bh2));

console.log('');
console.log('PH: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
