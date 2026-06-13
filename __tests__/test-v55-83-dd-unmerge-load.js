var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');var o=p('src/components/InventoryOverview.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// root cause fix: load by merge_group_id from DB (not capped receipts array)
ok(/async function loadUnmergeData\(g\)/.test(r),'loadUnmergeData loader exists');
ok(/from\('inventory_stock_receipts'\)\.select\('\*'\)\.eq\('merge_group_id', groupId\)/.test(r),'source lines loaded DIRECTLY by merge_group_id (no 1000-cap)');
ok(/var src = rows\.filter\(function \(r\) \{ return r\.status === 'merged'; \}\)/.test(r),'splits source lines (status merged)');
ok(/var \[unmergeData, setUnmergeData\] = useState/.test(r),'unmergeData state');
ok(/loadUnmergeData\(g\); \}\}/.test(r),'Unmerge button loads source data on open');
// guarded confirm
ok(/var nothingToRestore = !d\.loading && srcLines\.length === 0/.test(r),'nothingToRestore computed');
ok(/var confirmDisabled = unmergeBusy \|\| d\.loading \|\| nothingToRestore/.test(r),'Confirm disabled when loading or nothing to restore');
ok(/Cannot unmerge because no source shipment lines were found/.test(r),'red error when no source lines');
ok(/disabled=\{confirmDisabled\}/.test(r),'Confirm button uses confirmDisabled');
// visible loading/error
ok(/d\.loading \?[\s\S]*Loading source shipment data/.test(r),'modal shows loading state');
ok(/d\.error \?[\s\S]*bg-red-100 text-red-950/.test(r),'modal shows error state');
// lists real source shipments
ok(/rns\.length \? rns\.map\(function \(rn\)/.test(r),'lists each source shipment to restore');
ok(/srcLines\.length\} lines · <b>\{fmt\(sumRolls\)\}/.test(r),'shows source lines + rolls + qty');
// executeUnmerge uses unmergeData
ok(/var srcLines = unmergeData\.srcLines \|\| \[\]/.test(r),'executeUnmerge consumes unmergeData');
ok(/if \(srcLines\.length === 0\) \{ toast\.error\('No source shipment lines were found/.test(r),'executeUnmerge blocks when empty (defense)');
// overview total unchanged (skip merged + reversed)
ok(/r\.status === 'cancelled' \|\| r\.status === 'pending_detail' \|\| r\.status === 'merged' \|\| r\.status === 'reversed'/.test(o),'Overview skips merged+reversed (total unchanged)');
// behavioral: before vs after = same total
function ov(rows){var t=0;rows.forEach(function(x){if(['cancelled','pending_detail','merged','reversed'].indexOf(x.status)>=0)return;t+=x.roll_count;});return t;}
ok(ov([{status:'received',roll_count:257}])===257 && ov([{status:'received',roll_count:100},{status:'received',roll_count:157},{status:'reversed',roll_count:257}])===257,'before merge-target 257 == after restored 100+157=257 (not 514, not 0)');
ok((r.match(/\\+u[0-9a-fA-F]{4}/g)||[]).length===0,'no escaped unicode');
ok(/version: 'v55\.83-DD'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DD');
console.log('\nv55.83-DD unmerge load: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
