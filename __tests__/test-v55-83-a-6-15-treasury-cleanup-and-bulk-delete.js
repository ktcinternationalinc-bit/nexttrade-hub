// v55.83-A.6.15 (Max May 14 2026) — Four features:
//   1. Treasury Cleanup Review tool (TreasuryCleanupTab.jsx)
//   2. Reports → Audit tab (audit_log viewer)
//   3. Bulk delete UI for Egypt Bank entries (preview impact, confirm, audit)
//   4. Last 10 Imports rollback log (ImportHistoryView in EgyptBankTab.jsx)
//
// Each ships with super-admin gating, bilingual EN+AR, and audit_log entries
// for every destructive action.

var fs = require('fs');
var path = require('path');
var cleanup = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TreasuryCleanupTab.jsx'), 'utf8');
var reports = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ReportsTab.jsx'), 'utf8');
var bank = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'EgyptBankTab.jsx'), 'utf8');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// === 1. Treasury Cleanup Review ===
ok('1a: TreasuryCleanupTab default export exists',
  /export default function TreasuryCleanupTab/.test(cleanup));
ok('1b: super-admin gating in cleanup',
  /isSuperAdmin/.test(cleanup) && /super-admin only/.test(cleanup));
ok('1c: row classification function',
  /function classifyRow/.test(cleanup));
ok('1d: actions include delete + unlink + sibling + orphan-clear',
  /async function doDelete\(/.test(cleanup) && /async function doUnlink\(/.test(cleanup) && /async function doMarkSibling\(/.test(cleanup) && /async function doClearOrphanMatch\(/.test(cleanup));
ok('1e: every action writes to audit_log via writeAudit',
  /async function writeAudit/.test(cleanup) && /entity_type: 'treasury'/.test(cleanup) && /action: 'cleanup_'/.test(cleanup));
ok('1f: bilingual labels in cleanup',
  /مراجعة الخزنة/.test(cleanup) && /Likely safe-to-bank pair/.test(cleanup) && /تحويل خزنة → بنك/.test(cleanup));

// === 2. Audit log viewer in Reports ===
ok('2a: ReportsTab has audit view tab',
  /\['audit', '🔍 Audit \/ مراجعة'\]/.test(reports));
ok('2b: AuditView function defined',
  /function AuditView\(/.test(reports));
ok('2c: AuditView loads audit_log',
  /from\('audit_log'\)[\s\S]{0,300}\.in\('entity_type'/.test(reports));
ok('2d: AuditView filter buttons bilingual',
  /Bank imports[\s\S]{0,40}استيرادات بنكية/.test(reports));

// === 3. Cleanup section in Reports (lazy-loads TreasuryCleanupTab) ===
ok('3a: ReportsTab has cleanup view tab',
  /\['cleanup', '🧹 Cleanup \/ تنظيف'\]/.test(reports));
ok('3b: CleanupSection lazy imports TreasuryCleanupTab',
  /function CleanupSection/.test(reports) && /import\('\.\/TreasuryCleanupTab'\)/.test(reports));

// === 4. ReportsTab signature accepts new props ===
ok('4a: ReportsTab accepts supabase + isSuperAdmin + userProfile + checks',
  /export default function ReportsTab\([\s\S]{0,300}supabase[\s\S]{0,200}isSuperAdmin/.test(reports));
ok('4b: page.jsx passes new props to ReportsTab',
  /<ReportsTab[\s\S]{0,400}supabase=\{supabase\}[\s\S]{0,200}isSuperAdmin=\{isSuperAdmin\}[\s\S]{0,200}recalcInvoiceCollected=\{recalcInvoiceCollected\}/.test(page));

// === 5. Bulk delete UI on EgyptBankTab ===
ok('5a: bulk delete state defined',
  /bulkDeleteOpen[\s\S]{0,200}setBulkDeleteOpen/.test(bank));
ok('5b: preview impact function',
  /const computeBulkDeleteImpact = async/.test(bank));
ok('5c: execute bulk delete with confirmation',
  /const executeBulkDelete = async/.test(bank) && /You are about to DELETE/.test(bank));
ok('5d: bulk delete writes audit_log',
  /action: 'bulk_delete'/.test(bank) && /reason: bulkDeleteReason/.test(bank));
ok('5e: bulk delete requires reason (5+ chars)',
  /bulkDeleteReason\.length < 5/.test(bank));
ok('5f: bulk delete super-admin gated',
  /isSuperAdmin && \(\s*<button onClick=\{function \(\) \{ setBulkDeleteOpen/.test(bank));
ok('5g: bulk delete modal renders bilingual',
  /Bulk Delete Bank Transactions/.test(bank) && /حذف معاملات بنكية بالجملة/.test(bank));

// === 6. Import History + rollback ===
ok('6a: ImportHistoryView function defined',
  /function ImportHistoryView/.test(bank));
ok('6b: history view button on toolbar',
  /Import History \/ السجل/.test(bank));
ok('6c: rollbackBatch function with confirmation',
  /async function rollbackBatch/.test(bank) && /Roll back this import/.test(bank));
ok('6d: rollback writes batch_rollback audit_log',
  /action: 'batch_rollback'/.test(bank));
ok('6e: handles missing bank_import_batches table gracefully',
  /Batch tracking not set up yet/.test(bank));

// === 7. Import tags rows with batch_id (so rollback works) ===
ok('7a: executeImport creates batch record',
  /from\('bank_import_batches'\)\.insert\(\{[\s\S]{0,300}status: 'active'/.test(bank));
ok('7b: imported rows tagged with import_batch_id',
  /import_batch_id: batchId/.test(bank));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.15 tests passed');
