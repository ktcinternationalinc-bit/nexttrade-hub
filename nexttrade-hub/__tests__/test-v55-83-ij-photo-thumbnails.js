// ============================================================
// v55.83-IJ — product-photo thumbnails in Product List + Picker (phase 2 of II).
//
// New lib loadPrimaryPhotoUrls() batches the primary-photo lookup + signed-URL
// minting for a list of products. Product Master rows and ProductPicker results
// show the thumbnail when a primary photo exists. Must degrade gracefully when
// the II migration/bucket isn't set up (swallow errors → empty map → no thumb).
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var lib = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'inventory-photos.js'), 'utf8');
var pp = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ProductPicker.jsx'), 'utf8');
var pm = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'InventoryProductMaster.jsx'), 'utf8');

// ---- 1. lib/inventory-photos.js ----
ok('1a: exports loadPrimaryPhotoUrls', /export async function loadPrimaryPhotoUrls\(productIds\)/.test(lib));
ok('1b: queries primary photos of inventory_product',
  /parent_type', 'inventory_product'/.test(lib) && /\.eq\('is_primary', true\)/.test(lib) && /\.in\('parent_id', ids\)/.test(lib));
ok('1c: mints signed URLs from the private product-photos bucket',
  /from\(PRODUCT_PHOTO_BUCKET\)\.createSignedUrls/.test(lib) && /var PRODUCT_PHOTO_BUCKET = 'product-photos'/.test(lib));
ok('1d: degrades gracefully (try/catch + early returns of the map)',
  /try \{/.test(lib) && /catch \(e\)/.test(lib) && /return out;/.test(lib));
ok('1e: bails to empty map on query error (no crash before migration)',
  /if \(res\.error \|\| !res\.data \|\| !res\.data\.length\) \{ return out; \}/.test(lib));

// ---- 2. ProductPicker ----
ok('2a: imports loadPrimaryPhotoUrls', /import \{ loadPrimaryPhotoUrls \} from '\.\.\/lib\/inventory-photos'/.test(pp));
ok('2b: has photoUrls state', /var \[photoUrls, setPhotoUrls\] = useState\(\{\}\)/.test(pp));
ok('2c: loads photos via useEffect on products', /loadPrimaryPhotoUrls\(products\.map\(/.test(pp));
ok('2d: renders the thumbnail when a primary photo exists', /photoUrls\[p\.id\] &&/.test(pp) && /src=\{photoUrls\[p\.id\]\}/.test(pp));

// ---- 3. Product Master ----
ok('3a: imports loadPrimaryPhotoUrls', /import \{ loadPrimaryPhotoUrls \} from '\.\.\/lib\/inventory-photos'/.test(pm));
ok('3b: has photoUrls state', /var \[photoUrls, setPhotoUrls\] = useState\(\{\}\)/.test(pm));
ok('3c: loads photos via useEffect on products', /loadPrimaryPhotoUrls\(products\.map\(/.test(pm));
ok('3d: renders the thumbnail when a primary photo exists', /photoUrls\[p\.id\] &&/.test(pm) && /src=\{photoUrls\[p\.id\]\}/.test(pm));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-IJ photo-thumbnail tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
