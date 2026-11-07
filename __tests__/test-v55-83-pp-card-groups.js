// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PP — Cohort vs all-collections split + grouped cards
//
// Max (Nov 7, 04:35): "we should look at the specific invoices that were
// created in that period and what were paid for those invoices in that
// period. Then we should have the total invoices received money for that
// period that [not] necessarily were created in that period. we need to
// organize these datas in a way to easily read and understand and the cards
// should be grouped in a way that makes sense."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PP — cohort split + grouped cards');

var br = R('src/app/api/accounting/bills/route.js');
ok('1a: collected_on_period = payments in period ON invoices CREATED in period (cohort), kept apart from all-collections',
  /var invInPeriod = srcInv\.invoice_date && srcInv\.invoice_date >= pFrom && srcInv\.invoice_date <= pTo;/.test(br) &&
  /if \(invInPeriod\) \{ collectedCohort = r2\(collectedCohort \+ amt2\); colCohortCount\+\+; rowsCollectedCohort\.push\(rowC\); \}/.test(br));
ok('1b: every all-collections row SAYS whether its invoice is from this period or older (dated)',
  /'Payment on an invoice created in this period' : 'Payment on an OLDER invoice \(dated ' \+ \(srcInv\.invoice_date \|\| '\?'\) \+ '\)'/.test(br));
ok('1c: both figures + the cohort drill in the response',
  /collected_on_period: collectedCohort, collected_on_period_count: colCohortCount/.test(br) &&
  /collected_on_period: rowsCollectedCohort/.test(br));

var bh = R('src/components/BooksHomeTab.jsx');
ok('2a: four labeled groups, each answering one question',
  /1 · BANK REALITY — money that actually moved in this period/.test(bh) &&
  /2 · INVOICES CREATED IN THIS PERIOD — and what happened to those exact invoices/.test(bh) &&
  /3 · ALL INVOICE MONEY RECEIVED THIS PERIOD — whatever the invoice's date/.test(bh) &&
  /4 · WHAT'S AHEAD — open items falling due in this period/.test(bh));
ok('2b: cohort group = INVOICED / PAID ON THESE / STILL OPEN, with the cohort drill wired',
  /PAID ON THESE \(/.test(bh) && /received in period, on THESE invoices only/.test(bh) &&
  /keys: \[\{ key: 'collected_on_period', sign: 1 \}\]/.test(bh) &&
  /collected_on_period: \{ count: inv2\.collected_on_period_count \|\| 0, sum: inv2\.collected_on_period \|\| 0/.test(bh));
ok('2c: all-collections card explains itself (old invoices included, rows say which)',
  /COLLECTED — ALL INVOICES \(/.test(bh) && /each row says if its invoice is from this period or older/.test(bh));
ok('2d: bank cards say transfers are included, SALES is "of which"',
  /ALL settled deposits \(incl\. transfers\)/.test(bh) && /of which SALES \(/.test(bh));

console.log('');
console.log('PP: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
