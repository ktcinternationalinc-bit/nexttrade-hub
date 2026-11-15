/* v72 HOTFIX 2 — verifies bucket Reopen visibility + Super Admin Delete + lib function */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var libPath = path.join(__dirname, '..', 'src', 'lib', 'warehouse-buckets.js');
var actionsPath = path.join(__dirname, '..', 'src', 'components', 'WarehouseBucketActions.jsx');
var listPath = path.join(__dirname, '..', 'src', 'components', 'WarehouseBucketList.jsx');
var lib = fs.readFileSync(libPath, 'utf8');
var actions = fs.readFileSync(actionsPath, 'utf8');
var list = fs.readFileSync(listPath, 'utf8');

console.log('\n── LIB: deleteBucket function ──');
ok('A1: deleteBucket exported in lib',
  /export async function deleteBucket\(bucketId, userId\)/.test(lib));
ok('A2: deleteBucket validates bucketId',
  /bucketId required/.test(lib));
ok('A3: deleteBucket deletes warehouse_bucket_entries first (FK cleanup)',
  /from\('warehouse_bucket_entries'\)\.delete\(\)\.eq\('bucket_id'/.test(lib));
ok('A4: deleteBucket deletes treasury rows linked to bucket',
  /from\('treasury'\)\.delete\(\)\.eq\('bucket_id'/.test(lib));
ok('A5: deleteBucket deletes the bucket row itself',
  /from\('warehouse_buckets'\)\.delete\(\)\.eq\('id', bucketId\)/.test(lib));
ok('A6: deleteBucket returns reference_slug on success',
  /reference_slug: b\.reference_slug/.test(lib));
ok('A7: deleteBucket collects partial errors (non-blocking)',
  /partialErrors: errors\.length \? errors : null/.test(lib));

console.log('\n── ACTIONS: contrast + Super Delete button ──');
ok('B1: Reopen button uses bg-amber-600 (high contrast, was invisible bg-slate-200)',
  /key="reopen"[\s\S]{0,400}bg-amber-600 hover:bg-amber-700 text-white/.test(actions));
ok('B2: Reopen no longer uses bg-slate-200 (the contrast bug)',
  !/key="reopen"[\s\S]{0,300}bg-slate-200/.test(actions));
ok('B3: Super-admin Delete button rendered for isSuperAdmin',
  /if \(isSuperAdmin\) \{[\s\S]{0,500}key="superDelete"/.test(actions));
ok('B4: Super Delete uses bold red bg + white text + ring (high prominence)',
  /key="superDelete"[\s\S]{0,400}bg-red-700 hover:bg-red-800 text-white[\s\S]{0,200}ring-2 ring-red-300/.test(actions));
ok('B5: Delete modal exists with typed-DELETE confirmation',
  /showDeleteModal[\s\S]{0,200}اكتب DELETE|Type DELETE to confirm/.test(actions));
ok('B6: Delete button disabled until "DELETE" typed exactly',
  /disabled=\{busy \|\| deleteConfirmText !== 'DELETE'\}/.test(actions));
ok('B7: handleDeleteConfirm calls deleteBucket from lib',
  /async function handleDeleteConfirm[\s\S]{0,500}await deleteBucket\(bucket\.id, userId\)/.test(actions));
ok('B8: onDeleted callback exists for parent to go back to list',
  /onDeleted = props\.onDeleted/.test(actions) && /onDeleted\(\)/.test(actions));
ok('B9: deleteBucket imported from lib',
  /import \{[\s\S]{0,300}deleteBucket,?[\s\S]{0,300}\} from '\.\.\/lib\/warehouse-buckets'/.test(actions));

console.log('\n── LIST: panel header + onDeleted wiring ──');
ok('C1: Action panel now has visible header (was bg-slate-50 hiding contents)',
  /إجراءات الدلو|Bucket Actions/.test(list));
ok('C2: Panel uses bg-slate-100 + border-2 border-slate-300 (visible)',
  /bg-slate-100 border-2 border-slate-300/.test(list));
ok('C3: Panel header uses bg-slate-700 text-white (high contrast)',
  /bg-slate-700 text-white/.test(list));
ok('C4: Panel shows status hint in header (Open/Fully spent/etc)',
  /Bucket Actions[\s\S]{0,2500}Open — add entries|fully_spent[\s\S]{0,200}fully spent/i.test(list));
ok('C5: onDeleted handler clears selection and bubbles up',
  /onDeleted=\{function \(\) \{[\s\S]{0,400}setSelectedBucket\(null\)[\s\S]{0,200}setSelectedBucketId\(null\)/.test(list));

console.log('\n── REGRESSION: existing logic preserved ──');
ok('R1: cancelBucket still creates refund credit (HOTFIX 2 didn\'t break it)',
  /export async function cancelBucket\(params\)[\s\S]{0,2500}category: 'Warehouse Bucket Refund'/.test(lib));
ok('R2: reopenBucket still sets status fully_spent (HOTFIX 2 didn\'t break it)',
  /export async function reopenBucket\(bucketId, userId, reason\)[\s\S]{0,800}status: 'fully_spent'/.test(lib));
ok('R3: Cancel button still amber-tinted',
  /key="cancel"[\s\S]{0,300}bg-red-100 hover:bg-red-200 text-red-800/.test(actions));
ok('R4: Submit & Approve still emerald',
  /key="submitApprove"[\s\S]{0,300}bg-emerald-600 hover:bg-emerald-700 text-white/.test(actions));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) {
  console.log('FAILED');
} else {
  console.log('✅ ALL HOTFIX 2 assertions passed');
}
console.log('══════════════════════════════════════════════');
