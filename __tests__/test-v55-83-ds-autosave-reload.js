var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// the fix: autosave branch awaits reload() so reopen shows saved lines without page refresh
ok(/v55\.83-DS[\s\S]{0,400}try \{ await reload\(\); \} catch \(eReload\)/.test(r),'autosave branch silently awaits reload()');
// it must still keep editor open (return inside autosave branch, no closeModal in branch)
var branch=(r.match(/if \(optsSafe\.autosave\) \{[\s\S]*?\n      \}/)||[''])[0];
ok(branch.indexOf('closeModal')<0,'autosave branch does NOT close the modal');
ok(/setAutosaveStatus\('Saved ' \+ hhmm\);\s*setBusy\(false\);\s*return;/.test(branch),'autosave still keeps editor open + returns (draft only)');
ok(branch.indexOf('await reload()')>=0,'reload is inside the autosave branch (before the normal reload+close path)');
// dedup intact
ok(/\.eq\('receipt_number', receiptNumber\)\.eq\('line_uid', L2\.line_uid\)\.limit\(1\)/.test(r),'line_uid DB dedup still present (no duplicate inserts)');
ok(/version: 'v55\.83-DS'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DS');
console.log('\nv55.83-DS autosave reload: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
