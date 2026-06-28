// ============================================================
// v55.83-IQ - pull Wave ESTIMATES into the Hub as PROFORMAS, per silo.
// + confirm Wave categories (chart of accounts) feed the Bank Review categorize dropdown per silo.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('OK ' + label);
  else { failures.push(label + (hint ? ' - ' + hint : '')); console.log('FAIL ' + label + (hint ? ' - ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

var route = rd('src/app/api/wave/import-estimates/route.js');
var sql = rd('sql/v55-83-IQ-proforma-wave-estimates.sql');
var ui = rd('src/components/WaveImportTab.jsx');
var inv = rd('src/components/AccountingInvoicesTab.jsx');
var br = rd('src/components/BankReviewTab.jsx');

// ---- A. estimates -> proformas import ----
ok('A1: route uses service-role + import permission', /SUPABASE_SERVICE_ROLE_KEY/.test(route) && /assertPermission\(admin, userId, 'wave\.import\.run'/.test(route));
ok('A2: queries Wave estimates (read-only)', /business\(id:\$bid\)\{ id estimates\(page:\$page/.test(route));
ok('A3: writes accounting_proformas tagged with the silo + wave_estimate_id',
  /from\('accounting_proformas'\)/.test(route) && /wave_business_id: businessId/.test(route) && /wave_estimate_id: n\.id/.test(route));
ok('A4: dedupes by wave_estimate_id (re-run updates, never duplicates)',
  /estMap = await fetchAllMap\(admin, 'accounting_proformas', 'wave_estimate_id', businessId\)/.test(route) && /estMap\[n\.id\]/.test(route));
ok('A5: imports line items into accounting_proforma_items (delete-then-insert)',
  /from\('accounting_proforma_items'\)\.delete\(\)\.eq\('proforma_id'/.test(route) && /from\('accounting_proforma_items'\)\.insert/.test(route));
ok('A6: SQL adds wave_business_id + currency + provenance to accounting_proformas',
  /ADD COLUMN IF NOT EXISTS wave_business_id/.test(sql) && /ADD COLUMN IF NOT EXISTS currency/.test(sql) && /uq_acct_proformas_wave_estimate/.test(sql));
ok('A7: Wave Import UI has an Import-estimates button + handler',
  /function runImportEstimates\(\)/.test(ui) && /\/api\/wave\/import-estimates/.test(ui) && /Import estimates into Hub/.test(ui));
ok('A8: Proformas tab scopes rows by the active silo', /scopeIfRegistered\(\(isInvoice\(\) \? invoices : proformas\), waveBiz/.test(inv));
// v55.83-IU hardening (Codex FAILs): no silent partial, total fallback, per-silo dedup, no bad column.
ok('A9: line-item insert captures EVERY error + flags PARTIAL (no silent partial import)',
  /if \(liRes && liRes\.error\) \{ lineFail\+\+/.test(route) && /imported PARTIAL/.test(route));
ok('A10: line + header totals fall back to quantity x unitPrice / line sum (mirror invoice importer)',
  /lt = \(Number\(pit\.quantity\) \|\| 1\) \* \(Number\(pit\.unitPrice\) \|\| 0\)/.test(route) &&
  /var total = r2\(num\(n\.total\)\) \|\| lineSum/.test(route) &&
  !/expiryDate/.test(route) &&
  /items\{ product\{ name \} description quantity unitPrice total\{ value \} \}/.test(route));
ok('A11: the line-item row (preparedItems) does NOT include the non-existent created_by column',
  (function () { var m = route.match(/preparedItems\.push\(\{[\s\S]*?\}\);/); return m && m[0].indexOf('created_by') === -1; })());
ok('A12: dedup index is per-silo (wave_business_id, wave_estimate_id)',
  /uq_acct_proformas_wave_estimate_silo[\s\S]{0,120}\(wave_business_id, wave_estimate_id\)/.test(fs.readFileSync(path.join(__dirname, '..', 'sql', 'v55-83-IU-proforma-estimate-fixes.sql'), 'utf8')));

// ---- B. Wave categories feed the categorize dropdown, scoped per silo ----
ok('B1: Bank Review loads wave_categories and filters to the active silo',
  /from\('wave_categories'\)\.select/.test(br) && /c\.wave_business_id !== activeBiz/.test(br));
ok('B2: categorize dropdown renders the Wave chart-of-accounts grouped by type',
  /orderedCatGroups\(sel\.direction\)/.test(br));
ok('B3: clear empty-state tells the user to pull Wave categories for the silo',
  /Pull Wave categories/.test(br));

console.log('');
if (failures.length === 0) { console.log('All v55.83-IQ estimate/proforma + category tests passed'); process.exit(0); }
console.log(failures.length + ' FAILED:');
failures.forEach(function (f) { console.log('   - ' + f); });
process.exit(1);
