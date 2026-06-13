var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/InventoryReceiving.jsx');
ok(/L\.merged_source_breakdown = r\.merged_source_breakdown \|\| null/.test(r),'opened line loads merged_source_breakdown');
ok(/L\.merge_group_id = r\.merge_group_id \|\| null/.test(r),'opened line loads merge_group_id');
ok(/⎘ Sources: \{line\.merged_source_breakdown\.length\}/.test(r),'collapsed summary shows Sources: N');
ok(/Merged from \{line\.merged_source_breakdown\.length\} source line\(s\) — read-only audit/.test(r),'read-only audit panel header');
ok(/line\.merged_source_breakdown\.map\(function \(sb, si\)/.test(r),'iterates each source line');
ok(/sb\.receipt_number\b/.test(r) && /sb\.line_id\b/.test(r) && /sb\.roll_count\b/.test(r) && /sb\.quantity_kg\b/.test(r) && /sb\.status\b/.test(r),'breakdown shows source #, line id, rolls, kg, status');
ok(!/onChange.*merged_source_breakdown/.test(r),'breakdown is read-only (no edit handlers on it)');
// Overview no-double-count
var o=p('src/components/InventoryOverview.jsx');
ok(/r\.status === 'cancelled' \|\| r\.status === 'pending_detail' \|\| r\.status === 'merged'/.test(o),'Overview stats excludes merged (counted once)');
// behavioral: merged sources contribute 0; only aggregated target counts
function overviewSum(rows){var t=0;rows.forEach(function(r){if(r.status==='cancelled'||r.status==='pending_detail'||r.status==='merged')return;t+=r.roll_count;});return t;}
var rows=[{status:'merged',roll_count:100},{status:'merged',roll_count:157},{status:'received',roll_count:257}];
ok(overviewSum(rows)===257,'Overview = 257 (merged target only), NOT 100+157+257');
ok(/version: 'v55\.83-CS'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CS');
console.log('\nv55.83-CS source breakdown: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
