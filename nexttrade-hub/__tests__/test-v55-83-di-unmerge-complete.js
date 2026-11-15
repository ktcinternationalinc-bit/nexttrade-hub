var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');var o=p('src/components/InventoryOverview.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// the three things unmerge MUST do, in executeUnmerge:
ok(/status: origStatus\[sl\.id\] \|\| 'received', merged_into_shipment_id: null, merge_group_id: null/.test(r),'1a) restores source LINES active + clears tags');
ok(/from\('inventory_shipment_headers'\)\.update\(\{ merged_into_shipment_id: null, merged_at: null, merged_by: null, merge_group_id: null \}\)\.eq\('receipt_number', rns\[h\]\)/.test(r),'1b) restores source HEADERS (clears merged_into) -> reappear on blotter');
ok(/status: 'reversed', updated_by: uid \}\)\.eq\('id', targetLines\[t\]\.id\)/.test(r),'2) target lines set reversed (stop counting)');
ok(/unmerged_at: new Date\(\)\.toISOString\(\), unmerged_by: uid/.test(r),'3) target header stamped unmerged (hidden from active)');
// blotter filter restores sources + hides target
ok(/showMerged \|\| \(!isMergedSource\(g\) && !isUnmergedTarget\(g\)\)/.test(r),'blotter: shows restored sources, hides unmerged target unless Show merged');
ok(/function isMergedSource\(g\) \{ var hdrMerged = g\.header && g\.header\.merged_into_shipment_id/.test(r),'isMergedSource keys on header.merged_into_shipment_id (cleared on unmerge)');
ok(/function isUnmergedTarget\(g\) \{ var hdrUn = g\.header && g\.header\.unmerged_at/.test(r),'isUnmergedTarget keys on header.unmerged_at');
// UNMERGED label
ok(/var isUnmerged = isUnmergedTarget\(g\)/.test(r),'isUnmerged computed for row');
ok(/isUnmerged \? '⎘ UNMERGED'/.test(r) && /isUnmerged \? 'bg-violet-700 text-white'/.test(r),'reversed target shows UNMERGED badge (not ACTIVE/cancelled)');
// overview total unchanged
ok(/r\.status === 'merged' \|\| r\.status === 'reversed'/.test(o),'Overview skips merged+reversed (total unchanged)');
function ov(rows){var t=0;rows.forEach(function(x){if(['cancelled','pending_detail','merged','reversed'].indexOf(x.status)>=0)return;t+=x.roll_count;});return t;}
ok(ov([{status:'received',roll_count:167}])===167 && ov([{status:'received',roll_count:75},{status:'received',roll_count:92},{status:'reversed',roll_count:167}])===167,'167 before == 75+92 after, reversed excluded');
ok((r.match(/>[^<]*\\u[0-9a-fA-F]{4}/g)||[]).length===0,'no escaped unicode in jsx text');
ok(/version: 'v55\.83-DI'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DI');
console.log('\nv55.83-DI unmerge complete: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
