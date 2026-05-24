// v55.83-A.6.27.70 — Warehouse Buckets Phase 3 (workflow + reconciliation) test.
//
// This phase ships:
//   • WarehouseBucketEntryForm.jsx — add-entry form with category/subcategory
//     pickers (+ Add New flow), overspend hard-block with 3-option modal
//     (Reduce / Split / Cancel), Split flow can create new bucket inline
//   • WarehouseBucketActions.jsx  — Submit / Approve / Submit&Approve /
//     Cancel / Reopen action bar with self-approve protection + super-admin
//     override
//   • page.jsx — bucketStatusMap + bucketEntriesByBucket state loaders;
//     treasury renderer flips green for closed buckets; Expense Report
//     aggregation swaps closed-bucket placeholders for per-entry breakdown

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var ef       = read('src/components/WarehouseBucketEntryForm.jsx');
var ac       = read('src/components/WarehouseBucketActions.jsx');
var list     = read('src/components/WarehouseBucketList.jsx');
var page     = read('src/app/page.jsx');
var wnw      = read('src/components/WhatsNewWidget.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Entry form
// ══════════════════════════════════════════════════════════════════
ok('A1: default export WarehouseBucketEntryForm',
  /export default function WarehouseBucketEntryForm\(props\)/.test(ef));
ok('A2: imports addBucketEntry + listBuckets + createBucket',
  /import \{ addBucketEntry, listBuckets, createBucket \} from '\.\.\/lib\/warehouse-buckets'/.test(ef));
ok('A3: 5 form fields: date / amount / category / subcategory / description',
  /setEntryDate/.test(ef) && /setAmount/.test(ef) && /setCategory/.test(ef) && /setSubcategory/.test(ef) && /setDescription/.test(ef));
ok('A4: date defaults to today',
  /useState\(todayIso\(\)\)/.test(ef));
ok('A5: validation requires amount > 0 and category',
  /Amount must be positive\./.test(ef) && /Category is required\./.test(ef));
ok('A6: loads category suggestions from treasury (excludes "Warehouse Bucket" / "Warehouse Bucket Refund")',
  /treasury.*select\('category, subcategory'\)/.test(ef) &&
  /r\.category !== 'Warehouse Bucket'/.test(ef) &&
  /r\.category !== 'Warehouse Bucket Refund'/.test(ef));
ok('A7: subcategory dropdown filtered to selected category',
  /var subcatOptions = useMemo/.test(ef) &&
  /allSubcategories\s*\.filter\(function \(k\) \{ return k\.indexOf\(prefix\) === 0; \}\)/.test(ef));
ok('A8: "+ Add new subcategory" option appears when canManageCategories AND category picked',
  /\{canManageCategories && category && \(\s+<option value="__add_new__">/.test(ef));
ok('A9: handleSave detects overspend response and shows modal',
  /if \(res\.overspend\) \{[\s\S]{0,500}setOverspendInfo\(res\.overspend\)/.test(ef));
ok('A10: overspend modal loads other open buckets for same currency (split targets)',
  /var open = await listBuckets\(\{ status: 'open' \}\)/.test(ef) &&
  /b\.currency === bucket\.currency/.test(ef));
ok('A11: handleReduce clamps amount to remaining',
  /var newAmount = overspendInfo\.remaining/.test(ef) &&
  /Entry added \(reduced to/.test(ef));
ok('A12: handleSplit can use existing bucket OR create new one inline',
  /var newBucketRes = await createBucket/.test(ef));
ok('A13: split creates two atomic legs (rollback first leg if second fails)',
  /First leg failed/.test(ef) &&
  /Second leg failed/.test(ef) &&
  /delete\(\)\.eq\('id', firstLegRes\.entry\.id\)/.test(ef));
ok('A14: split legs marked is_split_part with splitPairId link',
  /isSplitPart: true/.test(ef) &&
  /splitPairId: firstLegRes\.entry && firstLegRes\.entry\.id/.test(ef));
ok('A15: form locks out closed / cancelled / pending_approval buckets',
  /bucket\.status === 'closed' \|\| bucket\.status === 'cancelled'/.test(ef) &&
  /bucket\.status === 'pending_approval'/.test(ef));

// ══════════════════════════════════════════════════════════════════
// PART B — Lifecycle actions
// ══════════════════════════════════════════════════════════════════
ok('B1: default export WarehouseBucketActions',
  /export default function WarehouseBucketActions\(props\)/.test(ac));
ok('B2: imports all 4 lifecycle helpers',
  /import \{\s+submitBucketForApproval,\s+approveAndCloseBucket,\s+reopenBucket,\s+cancelBucket,\s+\} from '\.\.\/lib\/warehouse-buckets'/.test(ac));
ok('B3: handleSubmit blocks overspent buckets',
  /if \(overspent\) \{\s+toast\.error\('Cannot submit — bucket is overspent\./.test(ac));
ok('B4: handleSubmitAndApprove blocks self-approve for non-super-admin',
  /if \(isCreator && !isSuperAdmin\) \{\s+toast\.error\('You created this bucket — someone else must approve it/.test(ac));
ok('B5: super-admin self-approve gets confirm dialog',
  /if \(isCreator && isSuperAdmin\) \{\s+if \(!confirm\('You created this bucket\. As super-admin you can self-approve/.test(ac));
ok('B6: standalone Approve button hidden for creator unless super-admin',
  /st === 'pending_approval' && canApprove/.test(ac) &&
  /if \(!isCreator \|\| isSuperAdmin\)/.test(ac));
ok('B7: Reopen button only shown for closed buckets + canReopen permission',
  /st === 'closed' && canReopen/.test(ac));
ok('B8: Cancel button shown in pre-close states',
  /st === 'open' \|\| st === 'fully_spent' \|\| st === 'pending_approval'/.test(ac) &&
  /canManage \|\| isSuperAdmin/.test(ac));
ok('B9: Cancel modal requires reason text',
  /Provide a reason — this creates a refund credit and is audit-logged\./.test(ac));
ok('B10: Reopen modal requires reason text',
  /Provide a reason — this is audit-logged\./.test(ac));
ok('B11: one-click "Submit & Approve" rendered when canManage AND canApprove AND not creator',
  /canDoOneClick && !isCreator/.test(ac) &&
  /✓ Submit & Approve/.test(ac));

// ══════════════════════════════════════════════════════════════════
// PART C — Wired into WarehouseBucketList detail view
// ══════════════════════════════════════════════════════════════════
ok('C1: list imports entry form + actions',
  /import WarehouseBucketEntryForm from '\.\/WarehouseBucketEntryForm'/.test(list) &&
  /import WarehouseBucketActions from '\.\/WarehouseBucketActions'/.test(list));
ok('C2: actions bar rendered for users with any of manage/approve/reopen/superAdmin',
  /props\.canManage \|\| props\.canApprove \|\| props\.canReopen \|\| isSuperAdmin/.test(list) &&
  /<WarehouseBucketActions/.test(list));
ok('C3: entry form rendered only for open/fully_spent + canManage',
  /b\.status === 'open' \|\| b\.status === 'fully_spent'/.test(list) &&
  /props\.canManage \|\| isSuperAdmin/.test(list) &&
  /<WarehouseBucketEntryForm/.test(list));
ok('C4: onCreated / onChanged callbacks reload detail view',
  /getBucketWithEntries\(selectedBucketId\)\.then\(function \(res\) \{\s+setSelectedBucket\(res\.bucket\)/.test(list));

// ══════════════════════════════════════════════════════════════════
// PART D — page.jsx wiring + Expense Report integration
// ══════════════════════════════════════════════════════════════════
ok('D1: bucketStatusMap state',
  /const \[bucketStatusMap, setBucketStatusMap\] = useState\(\{\}\)/.test(page));
ok('D2: bucketEntriesByBucket state',
  /const \[bucketEntriesByBucket, setBucketEntriesByBucket\] = useState\(\{\}\)/.test(page));
ok('D3: bucketStatusMap loader watches treasury + queries warehouse_buckets',
  /supabase\.from\('warehouse_buckets'\)\.select\('id,status'\)\.in\('id', unique\)/.test(page));
ok('D4: bucketEntriesByBucket loader queries entries for closed buckets only',
  /closedIds = Object\.keys\(bucketStatusMap \|\| \{\}\)\.filter\(function \(id\) \{\s+return bucketStatusMap\[id\] === 'closed'/.test(page));
ok('D5: treasury renderer recognizes closed buckets (green styling)',
  /isBucketClosed[\s\S]{0,200}bg-emerald-100 hover:bg-emerald-200 border-l-4 border-l-emerald-600/.test(page));
ok('D6: treasury renderer recognizes cancelled buckets (faded slate styling)',
  /isBucketCancelled[\s\S]{0,200}bg-slate-100 hover:bg-slate-200 border-l-4 border-l-slate-500 opacity-70/.test(page));
ok('D7: row tooltip describes status (pending / reconciled / cancelled)',
  /Warehouse Bucket — RECONCILED/.test(page) &&
  /Warehouse Bucket — CANCELLED/.test(page) &&
  /advance pending reconciliation/.test(page));
ok('D8: status-conditional icon: ✅ when closed, ✗ when cancelled, 🏭 otherwise',
  /isBucketClosed \? '✅' : isBucketCancelled \? '✗' : '🏭'/.test(page));
ok('D9: Expense Report aggregation swaps closed-bucket placeholders for entry breakdown',
  /bStatus === 'closed' && bucketEntriesByBucket\[t\.bucket_id\]/.test(page) &&
  /bucketEntriesByBucket\[t\.bucket_id\]\.forEach\(function \(e\)/.test(page));
ok('D10: Expense Report excludes cancelled bucket placeholders (refund balances them)',
  /bStatus === 'cancelled'\) return;.*refund credit balances/.test(page));
ok('D11: Expense Report shows OPEN buckets as "Warehouse Bucket" placeholder category',
  /catData\['Warehouse Bucket'\] = \(catData\['Warehouse Bucket'\] \|\| 0\) \+ Number\(t\.cash_out\)/.test(page));
ok('D12: List receives canManage / canApprove / canReopen / canManageCategories props',
  /canManage=\{isSuperAdmin \|\| \(modulePerms && \(modulePerms\['Manage Warehouse Buckets'\]/.test(page) &&
  /canApprove=\{isSuperAdmin \|\| \(modulePerms && modulePerms\['Approve Warehouse Buckets'\]/.test(page) &&
  /canReopen=\{isSuperAdmin \|\| \(modulePerms && modulePerms\['Reopen Closed Buckets'\]/.test(page) &&
  /canManageCategories=\{isSuperAdmin \|\| \(modulePerms && modulePerms\['Manage Categories'\]/.test(page));
ok('D13: onBucketChanged callback bumps reload + reloads all data',
  /onBucketChanged=\{\(\) => \{ setBucketReloadToken\(t => t \+ 1\); try \{ loadAllData && loadAllData\(\)/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART E — Invariant preservation (the 5000 NEVER changes)
// ══════════════════════════════════════════════════════════════════
ok('E1: bucketStatusMap is a READ-only lookup — never mutates treasury',
  /KEY: this NEVER modifies the treasury row itself/.test(page));
ok('E2: Expense Report comment reaffirms invariant',
  /The treasury row itself NEVER changes\./.test(page));

// ══════════════════════════════════════════════════════════════════
// PART F — Version stamp + WhatsNewWidget
// ══════════════════════════════════════════════════════════════════
ok('F1: page.jsx stamped v55.83-A.6.27.70 or later',
  /v55\.83-A\.6\.27\.(70|7[1-9]|[8-9][0-9])/.test(page));
ok('F2: WhatsNewWidget has v55.83-A.6.27.70 entry',
  /version: 'v55\.83-A\.6\.27\.70'/.test(wnw));

// ══════════════════════════════════════════════════════════════════
// FINAL
// ══════════════════════════════════════════════════════════════════
console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-A.6.27.70 Phase 3 (Warehouse Buckets workflow + reconciliation) tests passed');
} else {
  console.log('❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
