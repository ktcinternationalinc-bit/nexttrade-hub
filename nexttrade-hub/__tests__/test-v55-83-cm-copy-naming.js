var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var pm=p('src/components/InventoryProductMaster.jsx');
ok(!/\+ ' \(copy\)'/.test(pm),'copy no longer appends " (copy)" to English name');
ok(!/\+ ' \(نسخة\)'/.test(pm),'copy no longer appends Arabic "(نسخة)"');
ok(!/endsWith\('\(copy\)'\)/.test(pm),'obsolete (copy)-suffix save gate removed');
// uniqueness still enforced (block + name) on save
ok(/DUPLICATE DESIGN CODE/.test(pm),'design code uniqueness still blocks');
ok(/DUPLICATE CLASSIFICATION/.test(pm),'classification uniqueness still blocks');
ok(/DUPLICATE ENGLISH NAME/.test(pm),'English name uniqueness still blocks');
ok(/A product with this name already exists\. Please change the product name, SKU, color, spec/.test(pm),'friendly duplicate message present');
ok(/openDuplicate/.test(pm) && /name_en: p\.name_en \|\| ''/.test(pm),'copy prefills clean name');
ok(/version: 'v55\.83-CM'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CM');
console.log('\nv55.83-CM copy naming: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
