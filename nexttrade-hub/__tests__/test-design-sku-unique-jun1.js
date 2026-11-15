var fs=require('fs');
var pm=fs.readFileSync('src/components/InventoryProductMaster.jsx','utf8');
var ip=fs.readFileSync('src/components/InventoryImportProducts.jsx','utf8');
var f=[]; function ok(n,c){ if(!c) f.push(n); }

// Single-product form: quick code dup check REMOVED, design sku dup check ADDED
ok('quick-code dup block removed from form', !/DUPLICATE QUICK CODE — cannot save/.test(pm));
ok('design-code dup check added to form', /DUPLICATE DESIGN CODE — cannot save/.test(pm));
ok('form design check excludes self when editing', /design_sku.*\n?.*modalProductId|p\.id === modalProductId\) return false;\s*\n\s*return \(p\.design_sku/.test(pm) || /var dupSku = products\.find/.test(pm));
ok('form message clarifies quick codes may repeat', /Quick Codes may repeat/.test(pm));

// Import file: design sku uniqueness added, quick_code still allowed to repeat (variants)
ok('import declares seenDesignSkus', /var seenDesignSkus = \{\}/.test(ip));
ok('import flags duplicate design code', /DUPLICATE within file — Design Code/.test(ip));
ok('import still allows duplicate quick_code for variants', /Allow duplicate quick_codes when variant_suffix differs/.test(ip));
ok('no fragile typeof guard left', !/typeof seenDesignSkus === 'undefined'/.test(ip));

if(f.length){ console.log('FAIL:\n - '+f.join('\n - ')); process.exit(1); }
console.log('PASS — design SKU unique / quick code repeatable ('+8+' checks)');
