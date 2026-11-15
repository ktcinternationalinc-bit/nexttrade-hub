// ============================================================
// v55.83-JZ — two Codex cautions: (1) AR History shows an invoice-COUNT BREAKDOWN so a "98 vs 53"
// mismatch (AL MOUSTAFA) is explainable on-screen (excluded drafts/dead/non-USD + window-hidden);
// (2) Accounting Visibility shows the EXACT employee cutoff date (employee preview) without switching accounts.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var ar = rd('src/components/AccountingCustomerHistory.jsx');
var panel = rd('src/components/AccountingVisibilityPanel.jsx');

// AR count breakdown
ok('1: AR History has a breakdown() that counts total vs AR-eligible-USD vs excluded vs window-hidden',
  /function breakdown\(custId\)/.test(ar) &&
  /excludedDraft|excludedDead|excludedNonUsd/.test(ar) &&
  /hiddenByWindow/.test(ar));
ok('2: breakdown classifies dead (void/cancelled/archived/deleted), draft, non-USD, and AR-eligible',
  /if \(dead\) \{ b\.excludedDead\+\+; \}/.test(ar) &&
  /else if \(!elig\) \{ b\.excludedDraft\+\+; \}/.test(ar) &&
  /else if \(!usd\) \{ b\.excludedNonUsd\+\+; \}/.test(ar) &&
  /b\.arUsd\+\+/.test(ar));
ok('3: the breakdown is rendered on the customer detail (explains total vs counted vs excluded vs hidden)',
  /Invoice count for this customer:/.test(ar) && /counted in AR all-time \(USD\)/.test(ar) && /excluded from AR/.test(ar));
// v55.83-KB (Max final call) — EMPLOYEES see ONLY the permitted window in EVERY bubble incl. Open
// balance; super-admin (arFloor null) sees all. So the window filter gates the WHOLE summary, and
// there is NO all-time open-balance bypass.
ok('4: AR summary() windows EVERYTHING (filter gates the whole bubble incl. open balance; no all-time bypass)',
  /if \(!isWithinWindow\(i\.invoice_date, arFloor\)\) \{ return; \} \/\/ employees: ONLY the permitted period/.test(ar) &&
  /s\.invoiced \+= total; s\.waveePaid \+= wave; s\.hubPaid \+= hub; s\.open \+= bal;/.test(ar) &&
  !/openAllTime/.test(ar));
ok('KB-AR1: AR Open balance card uses the windowed sum.open (not an all-time value)',
  /<Card label="Open balance" val=\{money\(sum\.open, showAmt\)\}/.test(ar));
var led = rd('src/components/CustomerLedger.jsx');
ok('KB-LED1: CustomerLedger summary windows EVERYTHING incl. the balance (no all-time bypass)',
  /if \(!isWithinWindow\(i\.invoice_date, ledgerFloor\)\) \{ return; \} \/\/ employees: only the permitted period/.test(led) &&
  /s\.balance \+= bal;/.test(led) &&
  /<Card label="Balance due" val=\{money\(summary\.balance, currency\)\}/.test(led));
ok('KB-LED2: ledger statement running balance is period-based for employees (recomputed over the window)',
  /var win = statement\.filter\(function \(e\) \{ return \(e\.date \|\| ''\) >= ledgerFloor; \}\);[\s\S]{0,120}run \+= e\.debit - e\.credit; return Object\.assign\(\{\}, e, \{ running: run \}\)/.test(led));

// Employee-preview cutoff date in the visibility panel
ok('5: visibility panel shows the EXACT employee cutoff date (preview as a non-super-admin)',
  /Employee preview:/.test(panel) &&
  /floorDateFor\(\{ window: win[\s\S]{0,220}isSuperAdmin: false \}/.test(panel) &&
  /dated <b>on or after \{f\}/.test(panel));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JZ AR-count + preview tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
