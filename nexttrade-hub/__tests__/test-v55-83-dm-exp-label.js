var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/Expected: ' \+ expNet\.toLocaleString\(undefined, \{ maximumFractionDigits: 0 \}\) \+ ' kg net'/.test(r),'Total Qty column shows "Expected: N kg net"');
ok(/Expected: ' \+ expRolls \+ ' rolls'/.test(r),'falls back to "Expected: N rolls"');
ok(/ · Expected: \{expNet != null \? \(expNet\.toLocaleString\(undefined, \{ maximumFractionDigits: 0 \}\) \+ ' kg net'\)/.test(r),'line summary shows "· Expected: N kg net"');
ok(!/>exp \{expNet/.test(r) && !/ · exp \{expNet/.test(r),'old unclear "exp {n}" labels removed');
ok(/version: 'v55\.83-DM'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DM');
console.log('\nv55.83-DM exp label: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
