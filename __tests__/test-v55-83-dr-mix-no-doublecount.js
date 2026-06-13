var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var ov=p('src/components/InventoryOverview.jsx');var mix=p('src/components/InventoryMixComposition.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// no double count: Overview hides virtual mix
ok(/if \(p\.is_virtual_mix === true\) return false;/.test(ov),'Overview hides virtual mix from physical stock');
// same source: both read inventory_layers.qty_remaining > 0
ok(/inventory_layers'\)\.select\('product_id, qty_remaining'?[^)]*\)\.gt\('qty_remaining', 0\)/.test(ov),'Overview reads availability from inventory_layers qty_remaining>0');
ok(/inventory_layers'\)\.select\('product_id, qty_remaining'\)\.gt\('qty_remaining', 0\)/.test(mix),'Mix report reads availability from the SAME source');
// virtual mix still never consumes/holds layers (Phase 1 read-only intact)
ok(!/consume_invoice_item_inventory|\.rpc\(/.test(mix),'Mix report still performs no consume/RPC');
ok(/version: 'v55\.83-DR'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DR');
console.log('\nv55.83-DR mix no-double-count: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
