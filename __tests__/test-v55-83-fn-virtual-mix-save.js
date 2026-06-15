var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var s=p('src/components/InventoryProductMaster.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// the fix: virtual mix exempt from levels/UOM/slug
ok(/var isVirtual = form\.is_virtual_mix === true/.test(s),'detects virtual mix in save');
ok(/if \(!isVirtual\) \{[\s\S]*?LEVEL_FIELD_MAP\[lvl\][\s\S]*?default_uom/.test(s),'levels + UOM only required for non-virtual');
ok(/var slug = isVirtual \? null : computeSlug/.test(s),'slug skipped for virtual mix');
ok(/var dupSlug = isVirtual \? null : products\.find/.test(s),'slug-conflict skipped for virtual mix');
// payload still carries name + design_sku + is_virtual_mix
ok(/name_en: nameEn/.test(s) && /design_sku: \(form\.design_sku/.test(s) && /is_virtual_mix: form\.is_virtual_mix === true/.test(s),'payload keeps name + design code + virtual flag');
// name fields editable for virtual
ok(/form\.is_virtual_mix !== true && !form\._name_manually_edited/.test(s),'name fields editable when virtual mix');
// name dup check still applies (no duplicate names even for virtual)
ok(/DUPLICATE ENGLISH NAME/.test(s),'name duplicate check retained');
console.log('\nv55.83-FN virtual mix save: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
