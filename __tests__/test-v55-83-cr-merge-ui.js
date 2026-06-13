var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/InventoryReceiving.jsx');
ok(/import \{ mergePlan \} from '..\/lib\/shipment-merge'/.test(r),'uses CQ engine');
ok(/function executeMerge\(\)/.test(r),'executeMerge exists');
ok(/Merge Shipments\{selectedNumbers\(\)\.length/.test(r),'Merge button (count) present');
ok(/disabled=\{selectedNumbers\(\)\.length < 2\}/.test(r),'button disabled until 2 selected');
ok(/Show merged/.test(r) && /setShowMerged/.test(r),'Show merged toggle');
ok(/function isMergedSource\(g\)/.test(r),'merged-source detection');
ok(/grouped\.filter\(function \(g\) \{ return showMerged \|\| !isMergedSource\(g\)/.test(r),'list hides merged sources unless Show merged');
ok(/merged_source_breakdown: g\.sources/.test(r),'aggregated line stores source breakdown jsonb');
ok(/status: 'merged', merged_into_shipment_id: targetRn/.test(r),'source lines marked merged + linked (not deleted)');
ok(/from\('inventory_shipment_merges'\)|'inventory_shipment_merges'/.test(r),'writes audit row');
ok(/MERGE FINALIZED SHIPMENTS/.test(r),'finalized typed confirmation');
ok(/disabled=\{mergeBusy \|\| !plan\.balanced\}/.test(r),'confirm blocked unless totals conserved');
ok(/toggleMergeSel\(g\.receipt_number\)/.test(r),'row checkbox toggles selection');
var o=p('src/components/InventoryOverview.jsx');
ok(/r\.status === 'cancelled' \|\| r\.status === 'pending_detail' \|\| r\.status === 'merged'/.test(o),'Overview excludes merged (no double count)');
ok(/status !== 'cancelled' && r\.status !== 'merged'/.test(o),'Overview history excludes merged');
ok(/version: 'v55\.83-CR'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CR');
console.log('\nv55.83-CR merge UI: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
