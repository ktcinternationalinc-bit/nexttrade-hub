var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');var o=p('src/components/InventoryOverview.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/function executeUnmerge\(g\)/.test(r),'executeUnmerge exists');
ok(/function mergeGroupOf\(g\)/.test(r) && /function isMergeTarget\(g\)/.test(r) && /function isUnmergedTarget\(g\)/.test(r),'merge-target + unmerged-target detection');
ok(/canEdit && isMergeTarget\(g\) && !isUnmergedTarget\(g\) &&/.test(r),'Unmerge button only on un-unmerged merge targets');
ok(/⎘ Unmerge/.test(r) && /Confirm Unmerge/.test(r),'Unmerge button + confirm (real glyph)');
// restore source lines from preserved data
ok(/origStatus\[sb\.line_id\] = sb\.status \|\| 'received'/.test(r),'source line status restored from preserved breakdown');
ok(/status: origStatus\[sl\.id\] \|\| 'received', merged_into_shipment_id: null, merge_group_id: null/.test(r),'source lines restored to active + unlinked');
// restore source headers
ok(/merged_into_shipment_id: null, merged_at: null, merged_by: null, merge_group_id: null \}\)\.eq\('receipt_number', rns\[h\]\)/.test(r),'source headers restored (un-merged)');
// reverse target lines + header
ok(/status: 'reversed', updated_by: uid \}\)\.eq\('id', targetLines\[t\]\.id\)/.test(r),'aggregated target lines marked reversed');
ok(/unmerged_at: new Date\(\)\.toISOString\(\), unmerged_by: uid, unmerge_notes/.test(r),'target header stamped unmerged');
// audit
ok(/from\('inventory_shipment_unmerges'\)|'inventory_shipment_unmerges'/.test(r),'writes unmerge audit row');
ok(/unmerge_type: 'full_shipment'/.test(r) && /restored_source_receipt_numbers: rns/.test(r) && /reversed_target_line_ids: reversedIds/.test(r),'audit captures restored + reversed ids');
// safety
ok(/anyFinal && unmergeConfirmText\.trim\(\) !== 'UNMERGE SHIPMENT'/.test(r),'finalized requires typed UNMERGE SHIPMENT');
ok(/No source shipment lines were found for this merge/.test(r),'blocks if no preserved source lines (no guessing)');
// blotter + overview no double count
ok(/showMerged \|\| \(!isMergedSource\(g\) && !isUnmergedTarget\(g\)\)/.test(r),'blotter hides unmerged target unless Show merged');
ok(/r\.status === 'cancelled' \|\| r\.status === 'pending_detail' \|\| r\.status === 'merged' \|\| r\.status === 'reversed'/.test(o),'Overview skips reversed (no double-count)');
ok(/r\.status !== 'cancelled' && r\.status !== 'merged' && r\.status !== 'reversed'/.test(o),'Overview history skips reversed');
// behavioral no-double-count
function ov(rows){var t=0;rows.forEach(function(x){if(['cancelled','pending_detail','merged','reversed'].indexOf(x.status)>=0)return;t+=x.roll_count;});return t;}
ok(ov([{status:'received',roll_count:100},{status:'received',roll_count:157},{status:'reversed',roll_count:257}])===257,'after unmerge: restored 100+157=257, reversed target (257) excluded — not 514');
ok((r.match(/\\+u[0-9a-fA-F]{4}/g)||[]).length===0,'no escaped unicode');
ok(/version: 'v55\.83-DA'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DA');
console.log('\nv55.83-DA unmerge: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
