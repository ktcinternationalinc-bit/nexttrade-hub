// v55.83-A.6.27.71 — Warehouse Buckets Phase 4 (History + Analytics + Cleanup) test.
//
// This phase ships:
//   • WarehouseBucketsHistory.jsx — read-only multi-year reporting view with
//     summary cards (per currency), per-recipient table, per-subcategory table
//     (closed buckets only), filters (year/recipient/currency), 4-sheet Excel export
//   • page.jsx wiring: WarehouseBucketsHistory rendered below WarehouseBucketList
//   • Dead code cleanup: ~115 lines of unused variant modal removed from
//     InventoryProductMaster.jsx (state + helpers + JSX)
//
// Bucket workflow is now COMPLETE. Feature flag still defaults OFF.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var hist = read('src/components/WarehouseBucketsHistory.jsx');
var page = read('src/app/page.jsx');
var ipm  = read('src/components/InventoryProductMaster.jsx');
var wnw  = read('src/components/WhatsNewWidget.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — WarehouseBucketsHistory component
// ══════════════════════════════════════════════════════════════════
ok('A1: default export function WarehouseBucketsHistory',
  /export default function WarehouseBucketsHistory\(props\)/.test(hist));
ok('A2: imports supabase directly (does NOT use treasury query)',
  /import \{ supabase \} from '\.\.\/lib\/supabase'/.test(hist));
ok('A3: NEVER queries treasury table (separate lens — read warehouse_buckets + entries only)',
  /supabase\.from\('warehouse_buckets'\)/.test(hist) &&
  /supabase\.from\('warehouse_bucket_entries'\)/.test(hist) &&
  !/supabase\.from\(['"]treasury['"]\)/.test(hist));
ok('A4: 5000-entry safety cap on entries load',
  /\.limit\(5000\)/.test(hist));
ok('A5: 3 filters: year, recipient, currency',
  /useState\('all'\)/.test(hist) &&
  /setYearFilter/.test(hist) &&
  /setRecipientFilter/.test(hist) &&
  /setCurrencyFilter/.test(hist));
ok('A6: summary aggregated per currency (never mixes USD + EGP)',
  /var byCurrency = \{\}/.test(hist) &&
  /var cur = b\.currency \|\| 'EGP'/.test(hist) &&
  /if \(!byCurrency\[cur\]\)/.test(hist));
ok('A7: summary tracks all 5 statuses with separate counts AND amounts',
  /open: 0, fullySpent: 0, pendingApproval: 0, closed: 0, cancelled: 0/.test(hist) &&
  /openAmount: 0, pendingAmount: 0, cancelledAmount: 0/.test(hist));
ok('A8: per-recipient computes avg days-to-close from closeDurations array',
  /closeDurations: \[\]/.test(hist) &&
  /r\.avgDaysToClose = r\.closeDurations\.length > 0/.test(hist));
ok('A9: per-recipient grouping uses recipient + currency as key (no cross-currency aggregation)',
  /var key = name \+ '\|\|' \+ cur/.test(hist));
ok('A10: per-subcategory filters to CLOSED buckets only (the only reconciled ones)',
  /var closedBucketIds = \{\}/.test(hist) &&
  /if \(b\.status === 'closed'\) closedBucketIds\[b\.id\]/.test(hist));
ok('A11: per-subcategory grouping uses currency + category + subcategory key',
  /var key = cur \+ '\|\|' \+ cat \+ '\|\|' \+ sub/.test(hist));
ok('A12: Excel export uses dynamic import of xlsx',
  /var XLSX = await import\('xlsx'\)/.test(hist));
ok('A13: Excel export produces 4 sheets',
  /book_append_sheet\(wb, ws1, 'Buckets'\)/.test(hist) &&
  /book_append_sheet\(wb, ws2, 'Entries'\)/.test(hist) &&
  /book_append_sheet\(wb, ws3, 'By Recipient'\)/.test(hist) &&
  /book_append_sheet\(wb, ws4, 'By Subcategory \(Closed\)'\)/.test(hist));
ok('A14: returns null when 0 buckets (no duplicate empty state with bucket list)',
  /if \(buckets\.length === 0\) \{\s+return null;/.test(hist));
ok('A15: reloads when reloadToken prop changes',
  /\}, \[reloadToken\]\)/.test(hist));

// ══════════════════════════════════════════════════════════════════
// PART B — page.jsx wiring
// ══════════════════════════════════════════════════════════════════
ok('B1: imports WarehouseBucketsHistory',
  /import WarehouseBucketsHistory from '\.\.\/components\/WarehouseBucketsHistory'/.test(page));
ok('B2: rendered below WarehouseBucketList in warehouse tab',
  /<WarehouseBucketList[\s\S]{0,1500}<WarehouseBucketsHistory/.test(page));
ok('B3: passes reloadToken so history refreshes when buckets change',
  /<WarehouseBucketsHistory[\s\S]{0,400}reloadToken=\{bucketReloadToken\}/.test(page));
ok('B4: passes userId / isSuperAdmin / toast props',
  /<WarehouseBucketsHistory[\s\S]{0,400}userId=\{userProfile\?\.id\}/.test(page) &&
  /<WarehouseBucketsHistory[\s\S]{0,400}isSuperAdmin=\{isSuperAdmin\}/.test(page) &&
  /<WarehouseBucketsHistory[\s\S]{0,400}toast=\{toast\}/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART C — Dead code cleanup in InventoryProductMaster
// ══════════════════════════════════════════════════════════════════
ok('C1: variantModalOpen state removed',
  !/var \[variantModalOpen, setVariantModalOpen\]/.test(ipm));
ok('C2: variantTemplate state removed',
  !/var \[variantTemplate, setVariantTemplate\]/.test(ipm));
ok('C3: variantForm state removed',
  !/var \[variantForm, setVariantForm\]/.test(ipm));
ok('C4: variantBusy state removed',
  !/var \[variantBusy, setVariantBusy\]/.test(ipm));
ok('C5: closeVariantModal helper removed',
  !/function closeVariantModal/.test(ipm));
ok('C6: saveVariant helper removed',
  !/async function saveVariant/.test(ipm));
ok('C7: openCreateVariant helper removed',
  !/function openCreateVariant\(template\)/.test(ipm));
ok('C8: variant modal JSX removed (no variantModalOpen && variantTemplate && pattern)',
  !/variantModalOpen && variantTemplate/.test(ipm));
ok('C9: cleanup note left for audit traceability',
  /Removed dead variant modal state/.test(ipm) &&
  /Removed openCreateVariant \+ closeVariantModal/.test(ipm));
ok('C10: file shrunk by approximately 115 lines',
  ipm.split('\n').length < 1400);  // was 1507 before, target < 1400

// ══════════════════════════════════════════════════════════════════
// PART D — Bucket workflow now COMPLETE
// ══════════════════════════════════════════════════════════════════
ok('D1: Phase 1 lib files intact',
  fs.existsSync(path.join(__dirname, '..', 'src/lib/feature-flags.js')) &&
  fs.existsSync(path.join(__dirname, '..', 'src/lib/warehouse-buckets.js')));
ok('D2: Phase 2 create + list components intact',
  fs.existsSync(path.join(__dirname, '..', 'src/components/WarehouseBucketCreate.jsx')) &&
  fs.existsSync(path.join(__dirname, '..', 'src/components/WarehouseBucketList.jsx')));
ok('D3: Phase 3 entry form + actions components intact',
  fs.existsSync(path.join(__dirname, '..', 'src/components/WarehouseBucketEntryForm.jsx')) &&
  fs.existsSync(path.join(__dirname, '..', 'src/components/WarehouseBucketActions.jsx')));
ok('D4: Phase 4 history component exists',
  fs.existsSync(path.join(__dirname, '..', 'src/components/WarehouseBucketsHistory.jsx')));

// ══════════════════════════════════════════════════════════════════
// PART E — Version stamp + WhatsNewWidget
// ══════════════════════════════════════════════════════════════════
ok('E1: page.jsx stamped v55.83-A.6.27.71',
  /v55\.83-A\.6\.27\.71/.test(page));
ok('E2: WhatsNewWidget has v55.83-A.6.27.71 entry',
  /version: 'v55\.83-A\.6\.27\.71'/.test(wnw));
ok('E3: WhatsNewWidget .71 entry has layman public bullets (Permanent Rule 1)',
  /History & Analytics/.test(wnw) && /Excel/.test(wnw));

// ══════════════════════════════════════════════════════════════════
// PART F — Hotfix 1 regression guards (post-deploy crash fix)
// ══════════════════════════════════════════════════════════════════
ok('F1: page.jsx passes `teamUsers` (not undefined `users`) to WarehouseBucketCreate',
  /<WarehouseBucketCreate[\s\S]{0,800}users=\{teamUsers\}/.test(page) &&
  !/<WarehouseBucketCreate[\s\S]{0,800}users=\{users\}/.test(page));
ok('F2: no other dangling `users={users}` references in page.jsx (only `teamUsers` allowed)',
  !/users=\{users\}/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART G — HOTFIX 3: Arabic bilingual UI (Max May 24 2026)
// ══════════════════════════════════════════════════════════════════
var create = read('src/components/WarehouseBucketCreate.jsx');
var listC  = read('src/components/WarehouseBucketList.jsx');
var ef     = read('src/components/WarehouseBucketEntryForm.jsx');
var ac     = read('src/components/WarehouseBucketActions.jsx');
var histC  = read('src/components/WarehouseBucketsHistory.jsx');

ok('G1: WarehouseBucketCreate accepts lang prop + has ar/dir variables',
  /var lang = props\.lang === 'en' \? 'en' : 'ar'/.test(create) &&
  /var ar = lang === 'ar'/.test(create) &&
  /var dir = ar \? 'rtl' : 'ltr'/.test(create));
ok('G2: WarehouseBucketList accepts lang prop + has ar/dir variables',
  /var lang = props\.lang === 'en' \? 'en' : 'ar'/.test(listC) &&
  /var ar = lang === 'ar'/.test(listC));
ok('G3: WarehouseBucketEntryForm accepts lang prop',
  /var lang = props\.lang === 'en' \? 'en' : 'ar'/.test(ef));
ok('G4: WarehouseBucketActions accepts lang prop',
  /var lang = props\.lang === 'en' \? 'en' : 'ar'/.test(ac));
ok('G5: WarehouseBucketsHistory accepts lang prop',
  /var lang = props\.lang === 'en' \? 'en' : 'ar'/.test(histC));
ok('G6: page.jsx passes lang={lang} to WarehouseBucketCreate',
  /<WarehouseBucketCreate[\s\S]{0,800}lang=\{lang\}/.test(page));
ok('G7: page.jsx passes lang={lang} to WarehouseBucketList',
  /<WarehouseBucketList[\s\S]{0,1200}lang=\{lang\}/.test(page));
ok('G8: page.jsx passes lang={lang} to WarehouseBucketsHistory',
  /<WarehouseBucketsHistory[\s\S]{0,600}lang=\{lang\}/.test(page));
ok('G9: WarehouseBucketList passes lang prop down to child Actions + EntryForm',
  /<WarehouseBucketActions[\s\S]{0,600}lang=\{lang\}/.test(listC) &&
  /<WarehouseBucketEntryForm[\s\S]{0,600}lang=\{lang\}/.test(listC));
ok('G10: status badge helper accepts (status, ar) args (bilingual labels)',
  /function statusBadge\(status, ar\)/.test(listC));
ok('G11: critical Arabic strings present in entry form (overspend modal)',
  /تم اكتشاف إنفاق زائد/.test(ef) &&
  /تخفيض هذا الإدخال/.test(ef) &&
  /تقسيم الإدخال/.test(ef));
ok('G12: critical Arabic strings present in actions (Submit/Approve/Cancel/Reopen)',
  /تقديم وموافقة|موافقة وإغلاق/.test(ac) &&
  /إلغاء الدلو/.test(ac) &&
  /إعادة فتح الدلو/.test(ac));

// ══════════════════════════════════════════════════════════════════
// FINAL
// ══════════════════════════════════════════════════════════════════
console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-A.6.27.71 Phase 4 (History + Analytics + Cleanup) tests passed');
} else {
  console.log('❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
