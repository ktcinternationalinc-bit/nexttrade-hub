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
  /Invoice count for this customer:/.test(ar) && /counted in AR \(USD\)/.test(ar) && /excluded from AR/.test(ar));
ok('4: window-hidden detail rows are shown in the breakdown but balances use ALL invoices',
  /Visibility window hides \{b\.hiddenByWindow\}/.test(ar) && /balances above use ALL \{b\.total\}/.test(ar));

// Employee-preview cutoff date in the visibility panel
ok('5: visibility panel shows the EXACT employee cutoff date (preview as a non-super-admin)',
  /Employee preview:/.test(panel) &&
  /floorDateFor\(\{ window: win[\s\S]{0,220}isSuperAdmin: false \}/.test(panel) &&
  /dated <b>on or after \{f\}/.test(panel));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JZ AR-count + preview tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
