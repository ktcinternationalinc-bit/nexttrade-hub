var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// Release optional
ok(!/Release # is required\./.test(r),'Release # required validation removed');
ok(/Release # is OPTIONAL \(Max\)/.test(r),'Release # marked optional in code');
ok(!/Release # \*/.test(r),'asterisk removed from Release # label');
// autosave wiring
ok(/var \[autosaveStatus, setAutosaveStatus\] = useState/.test(r),'autosaveStatus state exists');
ok(/if \(optsSafe\.autosave\) \{/.test(r),'saveReceipt has autosave branch');
ok(/setEditingReceiptNumber\(receiptNumber\); \}/.test(r),'autosave pins receipt number to prevent duplicate receipts');
ok(/copy\.existing_id = found/.test(r) && /idByUid\[ln\.line_uid\]/.test(r),'autosave backfills existing_id (line_uid-first as of DP) to prevent duplicate inserts');
ok(/setAutosaveStatus\('Saved ' \+ hhmm\)/.test(r),'autosave sets Saved HH:MM status');
ok(/var collapsingNow = !n\[i\];/.test(r) && /if \(collapsingNow\) \{/.test(r),'collapse triggers autosave only when collapsing');
ok(/var canDraft = L && L\.product_id && header\.warehouse_id && header\.shipment_reference/.test(r),'autosave gated so no validation alert fires');
ok(/saveReceipt\(\{ autosave: true \}\)/.test(r),'collapse calls saveReceipt autosave');
// autosave must NOT finalize: branch returns before any submit status path; ensure it returns
ok(/setAutosaveStatus\('Saved ' \+ hhmm\);\s*setBusy\(false\);\s*return;/.test(r),'autosave returns without reload/close (editor stays open, draft only)');
// status cleared on open
ok((r.match(/setAutosaveStatus\(''\)/g)||[]).length>=3,'autosave status cleared on open paths');
ok(/version: 'v55\.83-DO'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DO');
console.log('\nv55.83-DO autosave+release: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
