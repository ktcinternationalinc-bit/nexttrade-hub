// ============================================================
// v55.83-IY — per-line Wave PRODUCT selection on invoices (Codex/Max P0).
// Each invoice line picks its own Wave product from the active silo; push sends per-line productIds
// (Settings default only as a fallback). Read-only product catalog pulled per silo.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var sql = rd('sql/v55-83-IY-wave-products.sql');
var pull = rd('src/app/api/wave/sync-products/route.js');
var push = rd('src/app/api/wave/push-invoice-v2/route.js');
var ui = rd('src/components/AccountingInvoicesTab.jsx');

// 1. catalog + columns
ok('1a: SQL creates wave_products (per-silo) + unique(biz,product)', /CREATE TABLE IF NOT EXISTS wave_products/.test(sql) && /uq_wave_products_biz_product/.test(sql));
ok('1b: SQL adds per-line wave_product columns to invoice + proforma items',
  /accounting_invoice_items  ADD COLUMN IF NOT EXISTS wave_product_id/.test(sql) && /accounting_proforma_items ADD COLUMN IF NOT EXISTS wave_product_id/.test(sql));

// 2. read-only product pull, per silo, production for explicit business
ok('2a: sync-products is service-role + read-only Wave products query', /SUPABASE_SERVICE_ROLE_KEY/.test(pull) && /products\(page:\$page/.test(pull));
ok('2b: explicit single-business pull includes production (like categories)', /if \(onlyBiz\) \{ businesses = allBiz\.filter/.test(pull));
ok('2c: upserts wave_products by (biz, product)', /from\('wave_products'\)\.upsert\(rows, \{ onConflict: 'wave_business_id,wave_product_id' \}\)/.test(pull));

// 3. push uses PER-LINE product, default only as fallback
ok('3a: push-invoice-v2 uses each line wave_product_id, falls back to default',
  /var lineProd = items\[k\]\.wave_product_id \|\| productId/.test(push) && /lineItems\.push\(\{ productId: lineProd/.test(push));

// 4. invoice editor: per-line selector + persistence
ok('4a: line model carries wave_product_id/name', /wave_product_id: '', wave_product_name: ''/.test(ui));
ok('4b: per-line Wave product selector wired to the change handler (onLineProductChange -> setLineWaveProduct + locked persist)', /function setLineWaveProduct\(i, productId\)/.test(ui) && /onChange=\{function \(e\) \{ onLineProductChange\(i, e\.target\.value\); \}\}/.test(ui));
ok('4c: save persists wave_product_id/name on the item', /payload\.wave_product_id = it\.wave_product_id; payload\.wave_product_name = it\.wave_product_name/.test(ui));
ok('4d: editor loads the silo Wave product catalog', /from\('wave_products'\)\.select/.test(ui) && /setWaveProducts/.test(ui));
ok('4e: product list is scoped to the active silo + excludes archived', /p\.wave_business_id === waveBiz\) && p\.is_archived !== true/.test(ui));

// 5. v55.83-JS — Wave DESCRIPTION selection/use (Codex FAIL): editor loads description, surfaces it in
// the selector, and selecting a product applies the Wave description to the line (which pushes to Wave).
ok('5a: editor loads wave_products.description with the catalog',
  /from\('wave_products'\)\.select\('wave_business_id, wave_product_id, name, description, is_archived'\)/.test(ui));
ok('5b: the line selector shows the Wave description next to the name',
  /var d = \(p\.description && p\.description\.trim\(\)\) \? \(' — ' \+ p\.description\.substring\(0, 40\)\) : ''/.test(ui));
ok('5c: v55.83-MS (Codex delta 5) — selecting a Wave product is metadata-only and does NOT overwrite the line description (no clobber)',
  !/c\[i\]\.description = waveDesc/.test(ui) &&
  /function setLineWaveProduct\(i, productId\)/.test(ui) &&
  /c\[i\]\.wave_product_id = productId \|\| ''/.test(ui));
ok('5d: push-invoice-v2 sends the (Wave-derived) line description to Wave',
  /description: items\[k\]\.description \|\| 'Hub invoice line'/.test(push));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-IY per-line Wave product tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
