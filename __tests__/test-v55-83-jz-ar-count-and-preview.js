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
// v55.83-KA (Codex FAIL) — PERIOD activity cards must reflect the window; only Open balance is all-time.
ok('4: summary() period activity is WINDOWED (out-of-window invoices do not inflate the cards/counts)',
  /s\.openAllTime \+= bal;/.test(ar) &&
  /if \(!isWithinWindow\(i\.invoice_date, arFloor\)\) \{ return; \}\s*\n\s*s\.invoiced \+= total; s\.waveePaid \+= wave; s\.hubPaid \+= hub;/.test(ar));
ok('KA-AR1: cards labeled "(in view)" for activity + "Open balance (all-time)"',
  /Total invoiced \(in view\)/.test(ar) && /Open balance \(all-time\)/.test(ar) && /val=\{money\(sum\.openAllTime, showAmt\)\}/.test(ar));
var led = rd('src/components/CustomerLedger.jsx');
ok('KA-LED1: CustomerLedger summary activity is windowed; Balance due is all-time + labeled',
  /if \(!isWithinWindow\(i\.invoice_date, ledgerFloor\)\) \{ return; \}/.test(led) &&
  /s\.balance \+= invBalance\(i\);/.test(led) &&
  /Balance due \(all-time\)/.test(led) && /Total invoiced \(in view\)/.test(led));

// Employee-preview cutoff date in the visibility panel
ok('5: visibility panel shows the EXACT employee cutoff date (preview as a non-super-admin)',
  /Employee preview:/.test(panel) &&
  /floorDateFor\(\{ window: win[\s\S]{0,220}isSuperAdmin: false \}/.test(panel) &&
  /dated <b>on or after \{f\}/.test(panel));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JZ AR-count + preview tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
