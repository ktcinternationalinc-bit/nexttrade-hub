// v55.83-A.6.27.42 — Create Variant modal — RETIRED.
//
// This test originally verified the Create Variant modal in
// InventoryProductMaster.jsx introduced in v55.83-A.6.27.42. However, in that
// same release the actual workflow shifted to Clone-Template
// (openCloneTemplate), and the variant modal became unreachable dead code —
// its `variantModalOpen` state was never set to true from anywhere. The
// orphaned state + helpers + JSX lingered for several builds before being
// safely removed in v55.83-A.6.27.71 (Phase 4 cleanup).
//
// This test is now a REMOVAL MARKER. It asserts the dead code is gone,
// preserving an audit breadcrumb so future readers can trace why the
// variant modal disappeared.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var ipm = read('src/components/InventoryProductMaster.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

ok('R1: variantModalOpen state REMOVED in Phase 4 cleanup',
  !/var \[variantModalOpen, setVariantModalOpen\]/.test(ipm));
ok('R2: variantTemplate state REMOVED',
  !/var \[variantTemplate, setVariantTemplate\]/.test(ipm));
ok('R3: variantForm state REMOVED',
  !/var \[variantForm, setVariantForm\]/.test(ipm));
ok('R4: variantBusy state REMOVED',
  !/var \[variantBusy, setVariantBusy\]/.test(ipm));
ok('R5: openCreateVariant helper REMOVED',
  !/function openCreateVariant\(template\)/.test(ipm));
ok('R6: closeVariantModal helper REMOVED',
  !/function closeVariantModal/.test(ipm));
ok('R7: saveVariant helper REMOVED',
  !/async function saveVariant/.test(ipm));
ok('R8: variant modal JSX block REMOVED',
  !/variantModalOpen && variantTemplate/.test(ipm));
ok('R9: openCloneTemplate is the replacement flow and is still present',
  /openCloneTemplate/.test(ipm));
ok('R10: Phase 4 cleanup comment preserved for audit',
  /v55\.83-A\.6\.27\.71.*Removed dead variant modal/.test(ipm));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-A.6.27.42 (Create Variant — RETIRED) removal-marker assertions passed');
} else {
  console.log('❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
