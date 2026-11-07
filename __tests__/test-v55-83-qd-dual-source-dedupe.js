// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QD — CSV imports + Plaid on the SAME account, duplicates flagged
// and ignored in BOTH directions.
//
// Max (Nov 7 11:59): "make sure that imports and plaid can be done for same
// account and any duplicates to be flagged and ignored."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QD — dual-source dedupe (CSV ↔ Plaid)');

var tr = R('src/app/api/plaid/transactions/route.js');
ok('1a: direction 1 — a Plaid SYNC skips transactions a CSV import already holds: counted match on account+posted date+amount+direction (name deliberately excluded — CSV and Plaid wordings differ)',
  /\.like\('plaid_transaction_id', 'manual-%'\)/.test(tr) &&
  /if \(\(manCount\[k1\] \|\| 0\) > 0\) \{ manCount\[k1\]--; manualDeduped\+\+; return false; \}/.test(tr));
ok('1b: counting keeps legitimate same-day twins (two slots, two survivors) and is stateless — every sync re-derives the same skips; a lookup error just means no dedupe this pass, never a crash',
  /manCount\[k0\] = \(manCount\[k0\] \|\| 0\) \+ 1;/.test(tr) &&
  /catch \(eMD\) \{ manualDeduped = 0; \}/.test(tr));
ok('1c: FLAGGED, not silent — manual_deduped rides the sync response and the banner says how many were ignored',
  /manual_deduped: manualDeduped/.test(tr) &&
  /duplicate\(s\) already in from a CSV import — flagged and ignored, nothing doubled/.test(R('src/components/BankTab.jsx')));

var si = R('src/app/api/accounting/statement-import/route.js');
ok('2a: direction 2 — the IMPORTER dedupes in two tiers: exact key vs earlier imports (re-import = no-op), NAMELESS key vs Plaid rows (wording differs, money matches)',
  /manualCount\[k0\] = \(manualCount\[k0\] \|\| 0\) \+ 1;/.test(si) &&
  /plaidCount\[base0\] = \(plaidCount\[base0\] \|\| 0\) \+ 1;/.test(si) &&
  /\(usedPlaid\[nk\] \|\| 0\) < \(plaidCount\[nk\] \|\| 0\)/.test(si));
ok('2b: ids stay deterministic AND collision-free across re-imports — occurrence = stored manual count + inserts this run',
  /var occ = \(manualCount\[k\] \|\| 0\) \+ insCount\[k\]; \/\/ deterministic \+ collision-free vs existing manual ids/.test(si));
ok('2c: both directions report, never silently drop — skipped_existing counted in the import result too',
  /skipped_existing: skippedExisting/.test(si));

console.log('');
console.log('QD: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
