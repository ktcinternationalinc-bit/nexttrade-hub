// ============================================================
// v55.83-LG — toward the Wave PAYMENT mirror (Max: deposits "properly linked to the invoices"). Two parts:
//  (1) Codex semantic FAIL fix: "⇐ from Wave" must mean MIRRORED-IN only (wave_csv/wave_import), NOT a
//      Hub-picked Wave chart account (Hub selection also writes category_source 'wave').
//  (2) A READ-ONLY payment read-back probe: invoice.payments + payment.account ARE Wave-readable, so we
//      can confirm on the live books that Wave-native payments + their bank account are visible BEFORE
//      building auto-linking (the gate that protects the wave_imported_paid double-count invariant).
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function exists(p) { try { fs.accessSync(path.join(__dirname, '..', p)); return true; } catch (e) { return false; } }
var route = rd('src/app/api/wave/payment-readback/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');
var br = rd('src/components/BankReviewTab.jsx');

ok('1: payment-readback route exists, is gated, and is READ-ONLY (no GraphQL mutation, no Hub data writes besides a log)',
  exists('src/app/api/wave/payment-readback/route.js') &&
  /assertPermission\(db, by, 'wave\.import\.run', req\)/.test(route) &&
  !/mutation/.test(route) &&
  !/\.update\(|\.insert\(\{[^}]*bank_transactions/.test(route));
ok('2: it reads the READABLE path — invoice.payments with the bank/cash account on each payment',
  /invoices\(page:\$page[\s\S]{0,200}payments\{ id amount\{ value currency\{ code \} \} paymentDate paymentMethod memo account\{ id name \} \}/.test(route) &&
  /payments_with_bank_account/.test(route));
ok('3: it is bounded (page cap) and reports distinct Wave bank accounts + samples so the linkage is verifiable',
  /var maxPages = Math\.min\(/.test(route) &&
  /distinct_bank_accounts/.test(route) &&
  /samples\.push\(/.test(route));
ok('4: Wave Sync Center Import tab has a "Check Wave payments" button wired to the read-back route',
  /function runPaymentReadback\(\)/.test(sync) &&
  /fetch\('\/api\/wave\/payment-readback'/.test(sync) &&
  /Check Wave payments/.test(sync));
ok('5: (Codex fix) blotter treats ONLY wave_csv/wave_import as "from Wave" — a Hub-picked Wave category is NOT mislabeled inbound',
  /var fromWave = \(t\.category_source === 'wave_csv' \|\| t\.category_source === 'wave_import'\);/.test(br) &&
  !/category_source === 'wave' \|\| t\.category_source === 'wave_csv'/.test(br));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LG payment-readback tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
