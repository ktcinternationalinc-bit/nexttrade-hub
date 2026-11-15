// v55.83-A.6.27.69 — Warehouse Buckets Phase 2 (visible UI) test.
//
// This phase ships:
//   • WarehouseBucketCreate.jsx — dedicated create modal with autocomplete combobox
//   • WarehouseBucketList.jsx   — bucket grid + read-only detail view
//   • page.jsx wiring: "+ Warehouse Advance" button next to "+ New Transaction"
//     in Treasury, bucket section in Warehouse tab, modal at page level,
//     bucket placeholder visual treatment in treasury row renderer
//   • 4 new permissions in SettingsTab: Manage / Approve / Reopen Warehouse
//     Buckets + Delete Shipping Bubbles
//   • ShippingRatesTab.jsx upgraded to use canBulkDeleteBubbles prop
//
// Feature flag stays OFF — UI hidden until super-admin flips warehouse_buckets_enabled

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var modal    = read('src/components/WarehouseBucketCreate.jsx');
var list     = read('src/components/WarehouseBucketList.jsx');
var page     = read('src/app/page.jsx');
var settings = read('src/components/SettingsTab.jsx');
var srt      = read('src/components/ShippingRatesTab.jsx');
var wnw      = read('src/components/WhatsNewWidget.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — WarehouseBucketCreate modal
// ══════════════════════════════════════════════════════════════════
ok('A1: default export function WarehouseBucketCreate',
  /export default function WarehouseBucketCreate\(props\)/.test(modal));
ok('A2: imports createBucket + buildReferenceSlug + listPastRecipients',
  /import \{ createBucket, buildReferenceSlug, listPastRecipients \} from '\.\.\/lib\/warehouse-buckets'/.test(modal));
ok('A3: form has all 6 fields: recipientName, reference, issueDate, amount, currency, notes',
  /setRecipientName/.test(modal) &&
  /setReference/.test(modal) &&
  /setIssueDate/.test(modal) &&
  /setAmount/.test(modal) &&
  /setCurrency/.test(modal) &&
  /setNotes/.test(modal));
ok('A4: issue date defaults to today',
  /useState\(todayIso\(\)\)/.test(modal));
ok('A5: currency defaults to EGP',
  /useState\('EGP'\)/.test(modal));
ok('A6: form resets every time modal opens',
  /if \(open\) \{\s+setRecipientName\(''\)/.test(modal));
ok('A7: loads past recipients on open (autocomplete data source)',
  /listPastRecipients\(\)\.then\(setPastRecipients\)/.test(modal));
ok('A8: combobox suggestions combine system users + past recipients (deduped)',
  /users\.forEach\(function \(u\)/.test(modal) &&
  /pastRecipients\.forEach\(function \(n\)/.test(modal) &&
  /if \(seen\[k\]\) return/.test(modal));
ok('A9: suggestions filter to typed substring (case-insensitive)',
  /var typed = recipientName\.trim\(\)\.toLowerCase\(\)/.test(modal));
ok('A10: live slug preview computed via buildReferenceSlug',
  /var slugPreview = useMemo\(function \(\) \{/.test(modal) &&
  /return buildReferenceSlug\(recipientName, reference, issueDate\)/.test(modal));
ok('A11: handleSave validates required fields before calling createBucket (bilingual messages — A.6.27.71 HOTFIX 3)',
  /Recipient name is required\.|اسم المستلم مطلوب/.test(modal) &&
  /Reference \/ purpose is required\.|المرجع \/ الغرض مطلوب/.test(modal));
ok('A12: amount validation requires positive number',
  /Amount must be a positive number|المبلغ يجب أن يكون رقمًا موجبًا/.test(modal));
ok('A13: createBucket result.ok=false → sets error, no close',
  /if \(!res\.ok\) \{\s+setError\(res\.error \|\|/.test(modal));
ok('A14: createBucket success → toast + onCreated + onClose (bilingual)',
  /toast\.success\(\([\s\S]{0,100}'Bucket created: '/.test(modal) &&
  /onCreated\(res\.bucket\)/.test(modal) &&
  /onClose\(\)/.test(modal));
ok('A15: header has 🏭 icon + amber gradient (bilingual — distinct from treasury modal blue)',
  /🏭 \{ar \? 'سلفة مخزن جديدة' : 'New Warehouse Advance'\}|🏭.{0,40}New Warehouse Advance/.test(modal) &&
  /from-amber-700 to-orange-700/.test(modal));
ok('A16: "What happens" explainer block reaffirms NEVER-CHANGES invariant',
  /The original cash-out NEVER changes/.test(modal));
ok('A17: returns null when open=false (no DOM cost when hidden)',
  /if \(!open\) return null/.test(modal));

// ══════════════════════════════════════════════════════════════════
// PART B — WarehouseBucketList grid + detail view
// ══════════════════════════════════════════════════════════════════
ok('B1: default export function WarehouseBucketList',
  /export default function WarehouseBucketList\(props\)/.test(list));
ok('B2: imports listBuckets + getBucketWithEntries',
  /import \{ listBuckets, getBucketWithEntries \} from '\.\.\/lib\/warehouse-buckets'/.test(list));
ok('B3: two view states: list and detail',
  /useState\('list'\)/.test(list) &&
  /view === 'detail'/.test(list));
ok('B4: status badge helper covers all 5 statuses',
  /case 'open':/.test(list) &&
  /case 'fully_spent':/.test(list) &&
  /case 'pending_approval':/.test(list) &&
  /case 'closed':/.test(list) &&
  /case 'cancelled':/.test(list));
ok('B5: closed status uses green badge with high contrast (bilingual — A.6.27.71 HOTFIX 3)',
  /'bg-green-200', text: 'text-green-900', label: ar \? '🔒 مُغلق ومُسوّى' : '🔒 Closed & Reconciled'/.test(list));
ok('B6: status filter dropdown with counts for each state (bilingual)',
  /Open|مفتوح.*\(\{buckets\.filter\(function \(b\) \{ return b\.status === 'open'/.test(list) ||
  /buckets\.filter\(function \(b\) \{ return b\.status === 'open'/.test(list));
ok('B7: search filter applies to recipient_name OR reference OR reference_slug',
  /\(b\.recipient_name \|\| ''\)\.toLowerCase\(\)\.indexOf\(q\) >= 0 \|\|\s+\(b\.reference \|\| ''\)\.toLowerCase\(\)\.indexOf\(q\) >= 0 \|\|\s+\(b\.reference_slug \|\| ''\)\.toLowerCase\(\)\.indexOf\(q\) >= 0/.test(list));
ok('B8: clicking a card sets selectedBucketId + flips to detail view',
  /setSelectedBucketId\(b\.id\); setView\('detail'\)/.test(list));
ok('B9: detail view shows progress bar (spent/remaining/percent)',
  /var spent = selectedEntries\.reduce/.test(list) &&
  /var remaining = Number\(b\.amount\) - spent/.test(list) &&
  /var pct = b\.amount > 0 \? Math\.min\(100, \(spent \/ Number\(b\.amount\)\) \* 100\)/.test(list));
ok('B10: closed bucket detail card shows reconciled badge (bilingual — A.6.27.71 HOTFIX 3)',
  /b\.status === 'closed' && \(\s+<span [^>]+>\{ar \? '✓ تمت التسوية' : '✓ RECONCILED'\}/.test(list));
ok('B11: Phase 3 replaces stub with real entry form (v55.83-A.6.27.70 — WarehouseBucketEntryForm component now imported and rendered)',
  /import WarehouseBucketEntryForm from '\.\/WarehouseBucketEntryForm'/.test(list) &&
  /<WarehouseBucketEntryForm/.test(list));
ok('B12: ledger table shows entries with date/category/subcategory/description/amount (bilingual headers)',
  /selectedEntries\.map\(function \(e\)/.test(list) &&
  /Date|التاريخ/.test(list) && /Category|الفئة/.test(list) && /Subcategory|الفئة الفرعية/.test(list));
ok('B13: empty state when 0 buckets shows 🏭 + helpful message',
  /No buckets yet/.test(list) &&
  /Create your first warehouse advance/.test(list));
ok('B14: reload triggered by reloadToken prop change (so create modal can refresh)',
  /useState\(0\)/.test(page) && // reload token in page
  /reloadToken \|\| 0/.test(list));

// ══════════════════════════════════════════════════════════════════
// PART C — page.jsx wiring
// ══════════════════════════════════════════════════════════════════
ok('C1: imports both bucket components',
  /import WarehouseBucketCreate from '\.\.\/components\/WarehouseBucketCreate'/.test(page) &&
  /import WarehouseBucketList from '\.\.\/components\/WarehouseBucketList'/.test(page));
ok('C2: imports feature-flag helpers',
  /import \{ getFeatureFlag, getFeatureFlagSync \} from '\.\.\/lib\/feature-flags'/.test(page));
ok('C3: bucket modal state declared',
  /const \[showBucketModal, setShowBucketModal\] = useState\(false\)/.test(page));
ok('C4: bucket reload token state',
  /const \[bucketReloadToken, setBucketReloadToken\] = useState\(0\)/.test(page));
ok('C5: feature flag warmed via useEffect on mount',
  /getFeatureFlag\('warehouse_buckets_enabled', false\)\.then\(setBucketsFeatureEnabled\)/.test(page));
ok('C6: "+ Warehouse Advance" button after "+ New Transaction" in Treasury',
  /\+ New Transaction\s+<\/button>[\s\S]{0,2000}🏭 \+ Warehouse Advance/.test(page));
ok('C7: button gated by feature flag + permission check',
  /\{bucketsFeatureEnabled && \(isSuperAdmin \|\| \(modulePerms && \(modulePerms\['Manage Warehouse Buckets'\] \|\| modulePerms\['Treasury'\] \|\| modulePerms\['Edit Treasury'\]\)\)\) && \(/.test(page));
ok('C8: WarehouseBucketCreate rendered at page level (independent of treasury modal)',
  /<WarehouseBucketCreate\s+open=\{showBucketModal\}/.test(page));
ok('C9: onCreated callback bumps reloadToken AND reloads data',
  /setBucketReloadToken\(t => t \+ 1\)/.test(page) &&
  /loadAllData && loadAllData\(\)/.test(page));
ok('C10: Warehouse tab gets bucket section (feature-flag gated)',
  /\{bucketsFeatureEnabled && \(\s+<div className="mb-4 p-3 bg-amber-50/.test(page));
ok('C11: bucket placeholder rows in Treasury get amber highlight + l-4 border',
  /const isBucketPlaceholder = txn\.bucket_role === 'placeholder'/.test(page) &&
  /isBucketPlaceholder\s*\?\s*"bg-amber-100 hover:bg-amber-200 border-l-4 border-l-amber-600"/.test(page));
ok('C12: bucket placeholder gets icon prepended in date column (Phase 3 makes it status-conditional: 🏭/✅/✗)',
  /isBucketPlaceholder && <span className="mr-1"/.test(page) &&
  /isBucketClosed \? '✅' : isBucketCancelled \? '✗' : '🏭'/.test(page));
ok('C13: bucket placeholder gets distinctive tooltip explaining what to do',
  /Warehouse Bucket — advance pending reconciliation/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART D — Permissions added in SettingsTab
// ══════════════════════════════════════════════════════════════════
ok('D1: Manage Warehouse Buckets permission with description',
  /key: 'Manage Warehouse Buckets'[\s\S]{0,300}Create warehouse advance buckets/.test(settings));
ok('D2: Approve Warehouse Buckets permission with self-approve caveat',
  /key: 'Approve Warehouse Buckets'[\s\S]{0,400}cannot approve a bucket they themselves created/.test(settings));
ok('D3: Reopen Closed Buckets permission with audit warning',
  /key: 'Reopen Closed Buckets'[\s\S]{0,200}every reopen is audit-logged/.test(settings));
ok('D4: Delete Shipping Bubbles permission (bonus)',
  /key: 'Delete Shipping Bubbles'[\s\S]{0,300}bulk-select toolbar and per-row checkboxes are hidden/.test(settings));

// ══════════════════════════════════════════════════════════════════
// PART E — ShippingRatesTab uses canBulkDeleteBubbles permission
// ══════════════════════════════════════════════════════════════════
ok('E1: ShippingRatesTab signature accepts canBulkDeleteBubbles prop',
  /export default function ShippingRatesTab\(\{ toast, user, userProfile, isAdmin, customers, canBulkDeleteBubbles \}\)/.test(srt));
ok('E2: canBulkDelete falls back to isAdmin when prop is undefined (super-admin preserved)',
  /const canBulkDelete = canBulkDeleteBubbles !== undefined \? !!canBulkDeleteBubbles : !!isAdmin/.test(srt));
ok('E3: page.jsx passes canBulkDeleteBubbles to ShippingRatesTab from perms',
  /canBulkDeleteBubbles=\{isSuperAdmin \|\| \(modulePerms && modulePerms\['Delete Shipping Bubbles'\] === true\)\}/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART F — Feature flag still defaults OFF (Phase 2 ships UI behind flag)
// ══════════════════════════════════════════════════════════════════
ok('F1: bucketsFeatureEnabled starts false (safe default until flag warms)',
  /const \[bucketsFeatureEnabled, setBucketsFeatureEnabled\] = useState\(false\)/.test(page));
ok('F2: KNOWN_FLAGS still lists warehouse_buckets_enabled with default false',
  /key: 'warehouse_buckets_enabled'[\s\S]{0,200}defaultValue: false/.test(read('src/lib/feature-flags.js')));

// ══════════════════════════════════════════════════════════════════
// PART G — Version stamp + WhatsNewWidget
// ══════════════════════════════════════════════════════════════════
ok('G1: page.jsx stamped v55.83-A.6.27.69 or later',
  /v55\.83-A\.6\.27\.(69|[7-9][0-9])/.test(page));
ok('G2: WhatsNewWidget has v55.83-A.6.27.69 entry',
  /version: 'v55\.83-A\.6\.27\.69'/.test(wnw));
ok('G3: WhatsNewWidget .69 entry has layman public bullets (Permanent Rule 1)',
  /Warehouse Advance/.test(wnw) && /Create Bucket/.test(wnw));

// ══════════════════════════════════════════════════════════════════
// FINAL
// ══════════════════════════════════════════════════════════════════
console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-A.6.27.69 Phase 2 (Warehouse Buckets visible UI) tests passed');
} else {
  console.log('❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
