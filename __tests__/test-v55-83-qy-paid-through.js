// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QY — Paid-through companies (Max, Nov 8 11:45–11:50): RTM Capital
// (outside service paying vendors for us) and NextTrade Industries (related
// company running the Texas warehouse — payroll, insurance, utilities,
// internet, bonding fees, rent). "KTC sends NextTrade money as needed" ·
// "NextTrade gets a service fee at some point" · "100% KTC".
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QY — paid-through companies');
var sql = R('sql/v55-83-QY-paid-through-parties.sql');
var bills = R('src/app/api/accounting/bills/route.js');
var at = R('src/components/AllTransactionsTab.jsx');
var ps = R('src/components/PeriodStatsTab.jsx');
var bt = R('src/components/BillsTab.jsx');
ok('1: registry with both companies; kind decides the unlinked remainder — RTM (service_provider) = its FEE, NextTrade (affiliate) = an ADVANCE awaiting its costs',
  /CHECK \(kind IN \('service_provider','affiliate'\)\)/.test(sql) &&
  /\('RTM Capital', 'service_provider', 'RTM service fee/.test(sql) &&
  /\('NextTrade Industries', 'affiliate', 'Advance with NextTrade — awaiting its costs \(not an expense yet\)'/.test(sql));
ok('2: works before the SQL is run (built-in defaults); bills and payments only accept a REGISTERED company',
  /var PARTY_DEFAULTS = \[/.test(bills) && /Unknown "paid via" company/.test(bills) && /Unknown paid-through company/.test(bills));
ok('3: reports are PER company — payments attributed by the company on the bank line, covered bills by the bill\'s "paid via"; no more lumping every payer under RTM',
  /* v55.83-SR realign — the per-company blocks moved, sum for sum, into src/lib/paid-through-blocks.js (run for real in test-v55-83-sr-*) */ /buildPaidThroughBlocks\(\{ parties: partiesP,/.test(bills) && /\(o\.parties \|\| \[\]\)\.forEach\(function \(party\) \{/.test(R('src/lib/paid-through-blocks.js')) &&
  /if \(partyKeyOf\(t\.payer\) !== pk \|\|/.test(R('src/lib/paid-through-blocks.js')) &&
  /if \(!b \|\| partyKeyOf\(b\.paid_via \|\| 'RTM Capital'\) !== pk \|\|/.test(R('src/lib/paid-through-blocks.js')) &&
  /spend = \{ rtm: rtmBlk, paid_through: ptBlocks,/.test(bills));
ok('4: Stats — one tax/real-cost switch PER company (default tax view for all); totals identical; the remainder line uses the company\'s own label',
  /var sRt = useState\(\{\}\); var ptOn = sRt\[0\]/.test(ps) && /function ptAdjust\(cats0\)/.test(ps) &&
  ps.split('ptAdjust(data.spending.categories)').length === 3 &&
  /* v55.83-SR realign — the per-company blocks moved, sum for sum, into src/lib/paid-through-blocks.js (run for real in test-v55-83-sr-*) */ /label: b\.remainder_label \|\| 'RTM service fee/.test(R('src/lib/paid-through-blocks.js')) && /remainderRows\(rtm\)\.forEach/.test(ps));
ok('5: match popup — RTM radio AND a 🏭 NextTrade radio; the panel switches company, picks only THAT company\'s bills, and labels the rest as fee (RTM) or advance (NextTrade)',
  /openRtm\(t2, 'NextTrade Industries'\)/.test(at) && /billsApi\(\{ action: 'rtm_open_bills', payer: p0 \}\)/.test(at) &&
  /'advance with NextTrade, awaiting its costs \(the rest\): \$'/.test(at) &&
  /action: 'rtm_flag', bank_transaction_id: t\.id, payer: rtmPanel\.payer/.test(at));
ok('6: Bills — "🏢 Paid via" is a dropdown of the registered companies (or "we pay it directly")',
  /<option value="">— we pay it directly —<\/option>/.test(bt) && /action: 'paid_through_parties'/.test(bt));
console.log('');
console.log('QY: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
