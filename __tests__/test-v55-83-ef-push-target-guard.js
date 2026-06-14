var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var guard=p('src/lib/wave-silo-guard.js');var elig=p('src/lib/wave-sync-eligibility.js');
var pc=p('src/app/api/wave/push-customer/route.js');var pi=p('src/app/api/wave/push-invoice/route.js');
var wsc=p('src/components/WaveSyncCenter.jsx');
var APPROVED='QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(guard.indexOf("APPROVED_PUSH_BUSINESS_ID = '"+APPROVED+"'")>=0,'guard defines approved KANDIL EGYPT id');
ok(/if \(opts\.dryRun !== true && opts\.waveBusinessId !== APPROVED_PUSH_BUSINESS_ID\)/.test(guard),'guard blocks non-approved target on real push');
ok(guard.indexOf('APPROVED_PUSH_BUSINESS_ID,')>=0,'approved id exported');
ok(/dryRun: true/.test(elig),'dryRunRecord passes dryRun:true to guard');
ok(/Would push to ' \+ tgtName \+ ' \(' \+ opts\.waveBusinessId \+ '\)/.test(elig),'dry run message includes raw id');
ok(/targetBusinessId: opts\.waveBusinessId/.test(elig),'dryRunRecord returns targetBusinessId');
ok(pc.indexOf("var APPROVED = '"+APPROVED+"'")>=0 && /dryRun !== true && waveBusinessId !== APPROVED/.test(pc),'push-customer route hard guard');
ok(/canPush\(reg, cust, waveBusinessId, 'customer', unlockPhrase, dryRun\)/.test(pc),'push-customer passes dryRun');
ok(pi.indexOf("var APPROVED = '"+APPROVED+"'")>=0 && /dryRun !== true && waveBusinessId !== APPROVED/.test(pi),'push-invoice route hard guard');
ok(/canPush\(reg, inv, waveBusinessId, body\.unlock_phrase \|\| '', dryRun\)/.test(pi),'push-invoice passes dryRun');
ok(/Target: \{r\.targetBusinessName/.test(wsc),'dry-run UI shows target name + id');
ok(!/\bconst \b/.test(pc) && !/ => /.test(pc) && !/\bconst \b/.test(pi) && !/ => /.test(pi),'routes SWC-safe');
ok(/version: 'v55\.83-EF'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EF');
console.log('\nv55.83-EF push target guard: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
