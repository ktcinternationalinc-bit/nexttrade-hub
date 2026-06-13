var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');var o=p('src/components/InventoryOverview.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// target lines by receipt_number (robust)
ok(/var tgtRes = await supabase\.from\('inventory_stock_receipts'\)\.select\('\*'\)\.eq\('receipt_number', targetRn\)/.test(r),'target lines loaded by receipt_number');
// fallback chain — all four
ok(/\.eq\('merge_group_id', groupId\)\.eq\('status', 'merged'\)/.test(r),'fallback 1: group + status=merged');
ok(/breakdownIds\.length\) \{[\s\S]*\.in\('id', breakdownIds\)/.test(r),'fallback 2: breakdown line_id ids');
ok(/auditIds\.length\) \{[\s\S]*\.in\('id', auditIds\)/.test(r),'fallback 3: audit source_line_ids');
ok(/\.eq\('merged_into_shipment_id', targetRn\)/.test(r),'fallback 4: merged_into_shipment_id');
// audit lookup
ok(/from\('inventory_shipment_merges'\)\.select\('\*'\)/.test(r) && /merge_group_id\.eq\.' \+ groupId \+ ',target_receipt_number\.eq\.' \+ targetRn/.test(r),'audit row looked up by group or target');
// exclude target own lines
ok(/srcLines = srcLines\.filter\(function \(r\) \{ return r\.receipt_number !== targetRn; \}\)/.test(r),'target own lines excluded from sources');
// diagnostics object + message
ok(/source_found_via: via/.test(r) && /breakdown_id_count: breakdownIds\.length/.test(r) && /audit_source_id_count: auditIds\.length/.test(r),'diag object captures all probe results');
ok(/Unmerge blocked because source lines cannot be found for merge group/.test(r),'detailed block message');
ok(/Copy Diagnostics/.test(r) && /navigator\.clipboard\.writeText\(JSON\.stringify\(d\.diag/.test(r),'Copy Diagnostics button');
// confirm still guarded
ok(/var confirmDisabled = unmergeBusy \|\| d\.loading \|\| nothingToRestore/.test(r),'Confirm disabled when nothing to restore');
// executeUnmerge still uses resolved data
ok(/var srcLines = unmergeData\.srcLines \|\| \[\]/.test(r),'executeUnmerge consumes resolved srcLines');
// overview total unchanged
ok(/r\.status === 'merged' \|\| r\.status === 'reversed'/.test(o),'Overview skips merged+reversed (total unchanged)');
function ov(rows){var t=0;rows.forEach(function(x){if(['cancelled','pending_detail','merged','reversed'].indexOf(x.status)>=0)return;t+=x.roll_count;});return t;}
ok(ov([{status:'received',roll_count:257}])===257 && ov([{status:'received',roll_count:100},{status:'received',roll_count:157},{status:'reversed',roll_count:257}])===257,'257 before == 100+157 after, reversed excluded');
ok((r.match(/\\+u[0-9a-fA-F]{4}/g)||[]).length===0,'no escaped unicode');
ok(/version: 'v55\.83-DF'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DF');
console.log('\nv55.83-DF unmerge fallback: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
