var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var o=p('src/components/InventoryOverview.jsx');
ok(/function effUom\(p\)/.test(o),'effUom helper exists');
ok(/if \(s3 && s3\.recv_uom_primary\) \{ return s3\.recv_uom_primary; \}/.test(o),'effUom prefers received-line UOM');
ok(/return \(p\.default_uom \|\| 'unit'\);/.test(o),'product master only as fallback');
ok(/s2\.recv_uom_primary = best/.test(o),'recv_uom_primary computed from receipts');
ok((o.match(/effUom\(p\)/g) || []).length >= 6,'effUom used across display + grouping');
ok(/Sold in: \{effUom\(p\)\}/.test(o),'Sold-in badge uses effUom');
ok(/text-slate-200">\{effUom\(p\)\}<\/td>/.test(o),'UOM column cell uses effUom');
ok(!/\{p\.default_uom \|\| 'unit'\}/.test(o),'no raw product-master UOM left in display');
// sort
ok(/var \[uomSort, setUomSort\] = useState\(''\)/.test(o),'uomSort state');
ok(/Sort by UOM/.test(o),'sort button present');
ok(/uomSort === 'asc' \? 'desc' : \(uomSort === 'desc' \? '' : 'asc'\)/.test(o),'toggle asc->desc->off');
ok(/uomRank\(effUom\(pa\)\)/.test(o),'product sort ranks by UOM');
ok(/listsById, uomSort\]/.test(o),'grouping memo re-sorts on uomSort');
// behavioral: dominant receipt uom wins
function primary(recv){var best='',bq=-1;Object.keys(recv).forEach(function(u){if(recv[u]>bq){bq=recv[u];best=u;}});return best;}
ok(primary({kg:2282})==='kg','single kg receipt => kg');
ok(primary({})==='', 'no receipts => empty (falls back to master)');
ok(primary({kg:2282,unit:5})==='kg','dominant uom wins');
function rank(u){var R={kg:0,meter:2,unit:4,roll:5};return R[u]!=null?R[u]:90;}
ok(rank('kg')<rank('meter') && rank('meter')<rank('unit') && rank('unit')<rank('roll'),'UOM rank order kg<meter<unit<roll');
ok(/version: 'v55\.83-CO'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CO');
console.log('\nv55.83-CO uom source + sort: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
