// ============================================================
// v55.83-LP — Max option 1: consolidate the 3 prefill steps into ONE guided "Prefill from Wave" flow in
// the Wave Sync Center Import tab, so the backfill is one ordered path instead of hunting across two tabs.
// Step 1 (import invoices+customers) reuses the existing import routes; Steps 2 (categories CSV) and 3
// (prefill invoice links, Preview-first) are the existing blocks, now numbered. UI-only orchestration of
// already-tested actions; nothing writes to Wave.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: Step 1 handler imports CUSTOMERS then INVOICES for the active silo (customers first; reuses the import routes)',
  /function runImportInvoicesCustomers\(\)/.test(sync) &&
  /fetch\('\/api\/wave\/import-customers'[\s\S]{0,200}businessId: active/.test(sync) &&
  /fetch\('\/api\/wave\/import-invoices'[\s\S]{0,200}businessId: active/.test(sync) &&
  sync.indexOf("import-customers") < sync.indexOf("import-invoices'"));
ok('2: a single guided "Prefill from Wave — run these in order" panel exists',
  /Prefill from Wave — run these in order/.test(sync) &&
  /Step 1 — Import invoices/.test(sync));
ok('3: Step 1 button is wired to the handler and shows import results (counts) or errors',
  /onClick=\{runImportInvoicesCustomers\}/.test(sync) &&
  /impResult\.inv && impResult\.inv\.report/.test(sync));
ok('4: Step 2 (categories CSV) and Step 3 (prefill links) are numbered as the next steps',
  /Step 2 — Import existing categorizations from Wave \(CSV\)/.test(sync) &&
  /Step 3 — Prefill invoice links/.test(sync));
ok('5: Step 3 keeps Preview-first (dry-run) emphasis so option 2 (the live dry-run) is a one-click step',
  /<b>Preview first<\/b> \(dry run, writes nothing\)/.test(sync) &&
  /Preview links \(dry run\)/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LP guided-prefill tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
