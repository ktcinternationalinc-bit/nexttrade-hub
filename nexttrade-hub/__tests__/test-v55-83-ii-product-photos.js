// ============================================================
// v55.83-II — internal-only inventory product photos.
//
// AttachmentManager gained backward-compatible private-bucket (signed-URL),
// image-only, and primary-photo modes. Product Master mounts it in the edit
// modal against a PRIVATE 'product-photos' bucket. This test asserts the
// wiring AND that legacy public attachments (invoices/tickets) are unchanged.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var am = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AttachmentManager.jsx'), 'utf8');
var pm = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'InventoryProductMaster.jsx'), 'utf8');
var sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'v55-83-II-product-photos.sql'), 'utf8');

// ---- 1. SQL migration ----
ok('1a: SQL adds is_private/is_primary/sort_order/caption columns',
  /ADD COLUMN IF NOT EXISTS is_private/.test(sql) &&
  /ADD COLUMN IF NOT EXISTS is_primary/.test(sql) &&
  /ADD COLUMN IF NOT EXISTS sort_order/.test(sql) &&
  /ADD COLUMN IF NOT EXISTS caption/.test(sql));
ok('1b: SQL sets up storage policies for the product-photos bucket',
  /bucket_id = 'product-photos'/.test(sql));
ok('1c: SQL documents the bucket must be PRIVATE (not public)',
  /Public bucket: NO/i.test(sql) && /public = false/.test(sql));

// ---- 2. AttachmentManager new modes ----
ok('2a: reads bucketName/isPrivate/imageOnly/enablePrimary props',
  /props\.bucketName \|\| BUCKET_NAME/.test(am) &&
  /var isPrivate = !!props\.isPrivate/.test(am) &&
  /var imageOnly = !!props\.imageOnly/.test(am) &&
  /var enablePrimary = !!props\.enablePrimary/.test(am));
ok('2b: private mode mints signed URLs (createSignedUrls)',
  /createSignedUrls\(/.test(am) && /function urlFor\(att\)/.test(am));
ok('2c: setPrimary clears siblings then sets the chosen one',
  /async function setPrimary\(att\)/.test(am) &&
  /\.update\(\{ is_primary: false \}\)/.test(am) &&
  /\.update\(\{ is_primary: true \}\)/.test(am));
ok('2d: imageOnly rejects non-image uploads',
  /imageOnly && !\(file\.type && file\.type\.indexOf\('image\/'\) === 0\)/.test(am));
ok('2e: private uploads store NO public_url; extra columns are mode-gated',
  /if \(!isPrivate\) \{\s*var urlRes/.test(am) &&
  /if \(isPrivate\) metaRow\.is_private = true;/.test(am) &&
  /if \(enablePrimary\)/.test(am));

// ---- 3. Backward-compat: legacy public attachments unchanged ----
ok('3a: default bucket is still "attachments"', /var BUCKET_NAME = 'attachments'/.test(am));
ok('3b: public (non-private) path still computes a public URL via getPublicUrl',
  /getPublicUrl\(storagePath\)/.test(am));
ok('3c: new columns are set via gated metaRow.is_primary assignment, not an unconditional object key',
  /metaRow\.is_primary = items\.length === 0/.test(am) && // gated assignment exists
  am.indexOf('is_primary: items.length') === -1);          // never an inline literal key

// ---- 4. Product Master mounts the gallery (edit mode, private, image-only) ----
ok('4a: imports AttachmentManager', /import AttachmentManager from '\.\/AttachmentManager'/.test(pm));
ok('4b: mounts with parentType="inventory_product"', /parentType="inventory_product"/.test(pm));
ok('4c: uses the private product-photos bucket + isPrivate + imageOnly + enablePrimary',
  /bucketName="product-photos"/.test(pm) &&
  /isPrivate=\{true\}/.test(pm) &&
  /imageOnly=\{true\}/.test(pm) &&
  /enablePrimary=\{true\}/.test(pm));
ok('4d: gallery is gated to edit mode with a saved product id',
  /modalMode === 'edit' && modalProductId && \(/.test(pm));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-II product-photo tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
