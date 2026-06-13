var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/var freshRes = await supabase\.from\('inventory_stock_receipts'\)\.select\('\*'\)\.eq\('receipt_number', grouped\.receipt_number\)\.neq\('status', 'cancelled'\)/.test(r),'openEdit authoritatively re-reads lines from DB by receipt_number');
ok(/var hasFreshLines = freshRows\.length > 0;/.test(r),'hasFreshLines computed from DB read');
ok(/if \(!hasFreshLines && grouped\.header\) \{/.test(r),'header-only decision now driven by fresh DB read (not stale isHeaderOnly)');
ok(/var rows = hasFreshLines \? freshRows : \(grouped\.lines \|\| \[\]\);/.test(r),'lines source uses fresh DB rows when present');
ok(!/if \(grouped\.isHeaderOnly && grouped\.header\) \{/.test(r),'old stale-flag branch condition removed');
// regressions: dedup + draft-only autosave still intact
ok(/\.eq\('receipt_number', receiptNumber\)\.eq\('line_uid', L2\.line_uid\)\.limit\(1\)/.test(r),'line_uid DB dedup intact');
ok(/if \(optsSafe\.autosave\) \{/.test(r),'autosave branch intact');
ok(/version: 'v55\.83-DT'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DT');
console.log('\nv55.83-DT reopen-fresh: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
