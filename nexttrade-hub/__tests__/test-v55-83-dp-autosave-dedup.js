var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// stable id
ok(/line_uid: 'L' \+ Date\.now\(\)\.toString\(36\) \+ Math\.random\(\)\.toString\(36\)\.slice\(2, 10\)/.test(r),'emptyLine seeds stable line_uid');
ok(/line_uid: L2\.line_uid \|\| null/.test(r),'line_uid persisted in payload');
ok(/L\.line_uid = r\.line_uid \|\| L\.line_uid/.test(r),'openEdit reloads line_uid');
// DB-level dedup (the critical fix)
ok(/\.eq\('receipt_number', receiptNumber\)\.eq\('line_uid', L2\.line_uid\)\.limit\(1\)/.test(r),'insert branch looks up existing row by receipt_number+line_uid at the DB');
ok(/if \(matchedId\) \{[\s\S]{0,120}dbUpdate\('inventory_stock_receipts', matchedId/.test(r),'matched row is UPDATED not inserted');
ok(/else \{[\s\S]{0,160}dbInsert\('inventory_stock_receipts', payload/.test(r),'insert only when genuinely no existing row');
// dedup independent of state timing: lookup is awaited before insert decision
ok(/var dupRes = await supabase[\s\S]*?if \(dupRes && dupRes\.data && dupRes\.data\.length > 0\) \{ matchedId = dupRes\.data\[0\]\.id; \}[\s\S]*?if \(matchedId\)/.test(r),'dup lookup awaited before the insert decision (timing-proof)');
// rehydrate prefers line_uid
ok(/var found = \(ln\.line_uid != null \? idByUid\[ln\.line_uid\] : null\)/.test(r),'rehydrate backfills existing_id by line_uid first');
ok(/found = idByProduct\[ln\.product_id\]/.test(r),'rehydrate falls back to product_id');
// still autosave + draft-only + no close on autosave (from DO, regression)
ok(/if \(optsSafe\.autosave\) \{/.test(r) && /setAutosaveStatus\('Saved ' \+ hhmm\);\s*setBusy\(false\);\s*return;/.test(r),'autosave keeps editor open, draft only (DO intact)');
ok(/saveReceipt\(\{ autosave: true \}\)/.test(r),'collapse still triggers autosave');
ok(/version: 'v55\.83-DP'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DP');
console.log('\nv55.83-DP autosave dedup: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
