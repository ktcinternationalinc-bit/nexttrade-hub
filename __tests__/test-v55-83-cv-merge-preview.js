var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/function productClassSummary\(p\)/.test(r),'classification summary helper');
ok(/parts\.push\('F: ' \+ listLabel\(p\.family_list_id\)\)/.test(r) && /parts\.push\('Sp: ' \+ listLabel\(p\.spec_class_list_id\)\)/.test(r),'class summary covers family..spec');
ok(/function shipmentRef\(rn\)/.test(r) && /h\.shipment_reference \|\| h\.release_number/.test(r),'source reference resolver');
ok(/function togglePreviewRow\(i\)/.test(r),'per-row expand toggle');
ok(!/grid-cols-5 gap-1 px-3 py-1\.5 border-t border-slate-100 text-xs/.test(r),'old truncating 5-col grid removed');
ok(!/font-semibold truncate">\{p \? \(p\.name_en/.test(r),'no more truncate on product name');
ok(/p\.quick_code \|\| ''\) \+ \(p\.design_sku/.test(r),'shows quick code + design SKU');
ok(/p\.name_ar \? <span className="block text-\[11px\] text-slate-600" dir="rtl">/.test(r),'shows Arabic name (RTL)');
ok(/g\.sources\.length \+ ' combined'/.test(r),'multi-source shows N combined');
ok(/shipmentRef\(single\.receipt_number\)/.test(r),'single source shows receipt + reference');
ok(/g\.sources\.map\(function \(sb, si\)/.test(r) && /sb\.receipt_number/.test(r) && /shipmentRef\(sb\.receipt_number\)/.test(r),'expanded per-source table w/ receipt + reference');
ok(/productClassSummary\(p\)/.test(r) && /Classification:<\/b>/.test(r),'expanded shows full classification');
// aggregation + no double count engine untouched
ok(/import \{ mergePlan \} from '..\/lib\/shipment-merge'/.test(r),'still uses tested mergePlan engine');
ok(/disabled=\{mergeBusy \|\| !plan\.balanced\}/.test(r),'confirm still gated by balanced (no double-count)');
var o=p('src/components/InventoryOverview.jsx');
ok(/r\.status === 'cancelled' \|\| r\.status === 'pending_detail' \|\| r\.status === 'merged'/.test(o),'Overview no-double-count intact');
ok(/version: 'v55\.83-CV'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CV');
console.log('\nv55.83-CV merge preview: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
