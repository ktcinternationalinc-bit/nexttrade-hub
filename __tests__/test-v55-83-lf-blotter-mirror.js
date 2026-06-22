// ============================================================
// v55.83-LF — Max (urgent): the blotter must MIRROR Wave — previously-categorized transactions show with
// where the category came from, and deposits show the invoice they're linked to + sync direction. This is
// the keystone VIEW (uses data that already exists: wave_account_name, category_source, matched_invoice_id,
// accounting_invoices status, accounting_invoice_payments.wave_payment_id). Step 0 adds the missing
// wave_transaction_id column so the categorized-txn badge can read it reliably.
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
var br = rd('src/components/BankReviewTab.jsx');

ok('1: migration adds bank_transactions.wave_transaction_id (+ index) so the mirror can read the Wave txn id',
  exists('sql/v55-83-LF-bank-txn-wave-id.sql') &&
  /ADD COLUMN IF NOT EXISTS wave_transaction_id text/.test(rd('sql/v55-83-LF-bank-txn-wave-id.sql')) &&
  /CREATE INDEX IF NOT EXISTS ix_bt_wave_txn_id/.test(rd('sql/v55-83-LF-bank-txn-wave-id.sql')));
ok('2: Classification cell shows the WAVE category + origin chip; "⇐ Wave" ONLY for inbound (wave_csv/wave_import), NOT Hub-picked Wave categories (Codex LG)',
  /t\.wave_account_name/.test(br) &&
  /\(t\.category_source === 'wave_csv' \|\| t\.category_source === 'wave_import'\)/.test(br) &&
  !/\(t\.category_source === 'wave' \|\| t\.category_source === 'wave_csv'\)/.test(br) &&
  /⇐ Wave/.test(br) &&
  />Hub</.test(br));
ok('3: the Wave badge is SPLIT-AWARE — a matched deposit shows it syncs as a PAYMENT with the linked INV# + status (invoice resolved from match OR matched_invoice_id)',
  /var isPayment = ms\.length > 0 \|\| !!t\.matched_invoice_id;/.test(br) &&
  /var invId = ms\.length \? ms\[0\]\.invoice_id : t\.matched_invoice_id;/.test(br) &&
  /var inv = invId \? acctInvoices\.find\(function \(iv\) \{ return iv\.id === invId; \}\) : null;/.test(br) &&
  /'INV ' \+ \(inv\.invoice_number \|\| inv\.id\)/.test(br) &&
  /\? '✓ Wave payment · ' : '⧖ Pending → Wave · '/.test(br));
ok('4: "⇐ from Wave" means MIRRORED IN (wave_csv/wave_import) only — a Hub-picked Wave category is NOT labeled inbound (Codex LG)',
  /var fromWave = \(t\.category_source === 'wave_csv' \|\| t\.category_source === 'wave_import'\);/.test(br) &&
  /\(fromWave && cs === 'synced'\) \? '⇐ from Wave'/.test(br));
ok('5: payment sync state reads the real payment rows (wave_payment_id / synced / manual_done), not just review status',
  /var ps = \(paysByTxn\[t\.id\] \|\| \[\]\)\.filter\(function \(p\) \{ return !isPaymentVoid\(p\); \}\);/.test(br) &&
  /var pushed = ps\.some\(function \(p\) \{ return p\.wave_payment_id \|\| p\.sync_status === 'synced' \|\| p\.sync_status === 'manual_done'; \}\);/.test(br));
ok('6: preflight-schema now checks bank_transactions.wave_transaction_id (Codex) so a missing migration is caught',
  /wave_transaction_id/.test(rd('src/app/api/wave/preflight-schema/route.js')) &&
  /'category_status', 'wave_transaction_id'\]/.test(rd('src/app/api/wave/preflight-schema/route.js')));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LF blotter-mirror tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
