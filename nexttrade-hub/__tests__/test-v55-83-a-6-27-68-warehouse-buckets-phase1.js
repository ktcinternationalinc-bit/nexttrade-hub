// v55.83-A.6.27.68 — Warehouse Buckets Phase 1 (scaffolding) test.
//
// This phase ships the data layer + feature flag system. No UI changes
// in this build. UI follows in Phase 2 (create + view) and Phase 3
// (approval + reconciliation). Feature flag defaults OFF so even when
// Phase 2/3 ship, the feature stays hidden until super-admin flips it ON.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var ff   = read('src/lib/feature-flags.js');
var wb   = read('src/lib/warehouse-buckets.js');
var wnw  = read('src/components/WhatsNewWidget.jsx');
var page = read('src/app/page.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — feature-flags.js
// ══════════════════════════════════════════════════════════════════
ok('A1: getFeatureFlag exported',
  /export async function getFeatureFlag\(key, defaultValue\)/.test(ff));
ok('A2: getFeatureFlagSync exported (for render paths)',
  /export function getFeatureFlagSync\(key, defaultValue\)/.test(ff));
ok('A3: setFeatureFlag exported (super-admin write)',
  /export async function setFeatureFlag\(key, value, userId, description\)/.test(ff));
ok('A4: listFeatureFlags exported',
  /export async function listFeatureFlags\(\)/.test(ff));
ok('A5: invalidateFeatureFlagCache exported',
  /export function invalidateFeatureFlagCache\(key\)/.test(ff));
ok('A6: KNOWN_FLAGS registry exported',
  /export var KNOWN_FLAGS = \[/.test(ff));
ok('A7: warehouse_buckets_enabled flag registered with defaultValue: false',
  /key: 'warehouse_buckets_enabled'[\s\S]{0,300}defaultValue: false/.test(ff));
ok('A8: 30-second cache TTL configured',
  /CACHE_TTL_MS = 30 \* 1000/.test(ff));
ok('A9: read failures fall back to defaultValue (fail-safe)',
  /\[feature-flags\] read failed/.test(ff) &&
  /return defaultValue/.test(ff));

// ══════════════════════════════════════════════════════════════════
// PART B — warehouse-buckets.js: slug builder
// ══════════════════════════════════════════════════════════════════
ok('B1: buildReferenceSlug exported',
  /export function buildReferenceSlug\(name, reference, isoDate\)/.test(wb));
ok('B2: slugify strips diacritics + normalizes to lowercase a-z 0-9',
  /normalize\('NFKD'\)\.replace\(\/\[\\u0300-\\u036f\]\/g, ''\)/.test(wb) &&
  /toLowerCase\(\)/.test(wb) &&
  /replace\(\/\[\^a-z0-9\]\+\/g, '_'\)/.test(wb));
ok('B3: date compact format mmddyy (no leading zero on month)',
  /var m = parseInt\(iso\.substring\(5, 7\), 10\)/.test(wb));

// ══════════════════════════════════════════════════════════════════
// PART C — warehouse-buckets.js: createBucket
// ══════════════════════════════════════════════════════════════════
ok('C1: createBucket exported',
  /export async function createBucket\(params\)/.test(wb));
ok('C2: validates recipientName required',
  /'Recipient name is required'/.test(wb));
ok('C3: validates reference required',
  /'Reference is required'/.test(wb));
ok('C4: validates issueDate YYYY-MM-DD',
  /Issue date must be YYYY-MM-DD/.test(wb));
ok('C5: validates amount is positive number',
  /Amount must be a positive number/.test(wb));
ok('C6: validates currency is EGP or USD',
  /Currency must be EGP or USD/.test(wb));
ok('C7: inserts bucket first, then treasury (separate code path from txn modal)',
  /dbInsert\('warehouse_buckets', bucketPayload/.test(wb) &&
  /dbInsert\('treasury', treasuryPayload/.test(wb));
ok('C8: treasury payload includes bucket_id + bucket_role=placeholder',
  /bucket_id: bucketRow\.id/.test(wb) &&
  /bucket_role: 'placeholder'/.test(wb));
ok('C9: ATOMIC ROLLBACK on treasury insert failure (deletes the bucket row)',
  /supabase\.from\('warehouse_buckets'\)\.delete\(\)\.eq\('id', bucketRow\.id\)/.test(wb) &&
  /rolling back bucket/.test(wb));
ok('C10: back-links treasury_id onto bucket via placeholder_treasury_id',
  /placeholder_treasury_id: treasuryRow\.id/.test(wb));
ok('C11: duplicate slug error message is user-friendly',
  /A bucket with this recipient \+ reference \+ date already exists/.test(wb));

// ══════════════════════════════════════════════════════════════════
// PART D — warehouse-buckets.js: addBucketEntry (overspend hard block)
// ══════════════════════════════════════════════════════════════════
ok('D1: addBucketEntry exported',
  /export async function addBucketEntry\(params\)/.test(wb));
ok('D2: rejects entries on closed or cancelled buckets',
  /Cannot add entries to a ' \+ bucket\.status \+ ' bucket/.test(wb));
ok('D3: rejects entries on pending_approval (must reopen)',
  /pending approval — reopen for edits/.test(wb));
ok('D4: OVERSPEND HARD BLOCK — returns overspend object instead of inserting',
  /overspend: \{/.test(wb) &&
  /byAmount: amt - Math\.max\(0, remaining\)/.test(wb));
ok('D5: auto-flips bucket to fully_spent when total reached',
  /newSpent >= Number\(bucket\.amount\) - 0\.001/.test(wb) &&
  /status: 'fully_spent'/.test(wb));

// ══════════════════════════════════════════════════════════════════
// PART E — warehouse-buckets.js: lifecycle transitions
// ══════════════════════════════════════════════════════════════════
ok('E1: submitBucketForApproval exported, requires fully_spent state',
  /export async function submitBucketForApproval\(bucketId, userId\)/.test(wb) &&
  /Bucket must be fully spent before submitting/.test(wb));
ok('E2: approveAndCloseBucket exported',
  /export async function approveAndCloseBucket\(params\)/.test(wb));
ok('E3: self-approve protection — created_by === userId blocks unless override',
  /You created this bucket — someone else must approve it/.test(wb));
ok('E4: super-admin self-approve gets warning (not hard block)',
  /selfApproveWarning: true/.test(wb));
ok('E5: one-click "Submit & Approve" auto-fills submitted_at if absent',
  /if \(!b\.submitted_at\) \{[\s\S]{0,200}updates\.submitted_at = nowIso/.test(wb));
ok('E6: reopenBucket exported, reverts to fully_spent',
  /export async function reopenBucket\(bucketId, userId, reason\)/.test(wb) &&
  /status: 'fully_spent'/.test(wb));
ok('E7: cancelBucket exported with refund credit',
  /export async function cancelBucket\(params\)/.test(wb) &&
  /Refund of cancelled bucket/.test(wb));

// ══════════════════════════════════════════════════════════════════
// PART F — warehouse-buckets.js: reads + expense report
// ══════════════════════════════════════════════════════════════════
ok('F1: listBuckets exported with filter support',
  /export async function listBuckets\(filters\)/.test(wb));
ok('F2: getBucketWithEntries exported',
  /export async function getBucketWithEntries\(bucketId\)/.test(wb));
ok('F3: listPastRecipients exported (for recipient combobox autocomplete)',
  /export async function listPastRecipients\(\)/.test(wb));
ok('F4: expandTreasuryForExpenseReport exported',
  /export async function expandTreasuryForExpenseReport\(treasuryRows\)/.test(wb));
ok('F5: expense report expansion only fires for CLOSED buckets (open buckets stay as placeholder)',
  /closedBucketIds = \(bRes\.data \|\| \[\]\)\.filter\(function \(b\) \{ return b\.status === 'closed'/.test(wb));
ok('F6: KEY INVARIANT comment — treasury row NEVER modified by reconciliation',
  /treasury row created for the bucket placeholder is NEVER modified/.test(wb));

// ══════════════════════════════════════════════════════════════════
// PART G — Phase 1 is non-disruptive (zero regressions)
// ══════════════════════════════════════════════════════════════════
ok('G1: lib/feature-flags.js exists',
  fs.existsSync(path.join(__dirname, '..', 'src/lib/feature-flags.js')));
ok('G2: lib/warehouse-buckets.js exists',
  fs.existsSync(path.join(__dirname, '..', 'src/lib/warehouse-buckets.js')));
ok('G3: page.jsx version stamp at v55.83-A.6.27.68 or later',
  /v55\.83-A\.6\.27\.(6[89]|[7-9][0-9])/.test(page));
ok('G4: WhatsNewWidget has v55.83-A.6.27.68 Phase 1 entry',
  /version: 'v55\.83-A\.6\.27\.68'/.test(wnw));
ok('G5: page.jsx now references bucket components (Phase 2 ships UI — was hidden in Phase 1)',
  /WarehouseBucketCreate|WarehouseBucketList|warehouse_buckets_enabled/.test(page));
ok('G6: bucket placeholder visual added to treasury row renderer (Phase 2)',
  /bucket_role === 'placeholder'/.test(page) &&
  /isBucketPlaceholder/.test(page));

// ══════════════════════════════════════════════════════════════════
// FINAL
// ══════════════════════════════════════════════════════════════════
console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-A.6.27.68 Phase 1 (scaffolding) tests passed');
} else {
  console.log('❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
