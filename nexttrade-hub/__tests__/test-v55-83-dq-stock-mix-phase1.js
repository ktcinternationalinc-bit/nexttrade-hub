var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
function load(f){return p(f).replace(/export \{[\s\S]*?\};\s*$/,'').replace(/^import[^\n]*\n/gm,'');}
var m={exports:{}};(new Function('module','exports',load('src/lib/mix-composition.js')+'\nmodule.exports={buildComposition,previewProportionalSplit};'))(m,m.exports);
var E=m.exports;
var ui=p('src/components/InventoryMixComposition.jsx');var it=p('src/components/InventoryTab.jsx');var pm=p('src/components/InventoryProductMaster.jsx');
var pass=0,fail=0;function ok(c,msg){if(c)pass++;else{fail++;console.log('  ✗ '+msg);}}
// pure calc (spec examples)
var comps=[{component_product_id:'b',component_color:'Black',is_active:true},{component_product_id:'r',component_color:'Red',is_active:true},{component_product_id:'o',component_color:'Orange',is_active:true},{component_product_id:'y',component_color:'Yellow',is_active:true}];
var c=E.buildComposition(comps,{b:200,r:100,o:50,y:50});
ok(c.total===400,'total available 400');
ok(c.rows[0].component_color==='Black'&&c.rows[0].pct===50,'Black dominant 50%');
var sp=E.previewProportionalSplit(c.rows,200,2);
ok(Math.abs(sp.lines.reduce(function(a,l){return a+l.planned;},0)-200)<1e-9,'preview split sums exactly to sale qty');
ok(E.previewProportionalSplit([{component_product_id:'y',available:20}],50,2).lines[0].shortfall===30,'shortfall detected');
// READ-ONLY guarantees: component must NOT consume/finalize/touch FIFO
ok(!/consume_invoice_item_inventory|consumeFifo|inventory_movements|qty_remaining\s*-|\.rpc\(/.test(ui),'Phase 1 component performs NO consume/FIFO/RPC');
ok(/buildComposition/.test(ui) && /inventory_layers'\)\.select\('product_id, qty_remaining'\)/.test(ui),'reads availability from inventory_layers (truth source)');
ok(/view only|view-only|Read-only|does not deduct/.test(ui),'view-only banner present');
ok(/inventory_mix_components/.test(ui),'maps components in inventory_mix_components');
// wired into nav
ok(/import InventoryMixComposition/.test(it) && /subtab === 'mixcomposition'/.test(it) && /id: 'mixcomposition'/.test(it),'Stock Mix tab wired into InventoryTab');
// product flag
ok(/is_virtual_mix: false/.test(pm) && /is_virtual_mix: p\.is_virtual_mix === true/.test(pm) && /is_virtual_mix: form\.is_virtual_mix === true/.test(pm),'is_virtual_mix threaded through form init/load/payload');
ok(/This is a Stock Mix Lot \(virtual\)/.test(pm),'product modal has Stock Mix checkbox');
ok(/version: 'v55\.83-DQ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DQ');
console.log('\nv55.83-DQ stock mix phase 1: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
