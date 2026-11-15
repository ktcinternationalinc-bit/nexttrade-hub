var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pc=p('src/app/api/wave/push-customer/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/var verified = rb && rb\.id === cc\.customer\.id;/.test(pc),'verified no longer requires strict name match');
ok(/await db\.from\('accounting_customers'\)\.update\(\{[\s\S]{0,120}wave_customer_id: cc\.customer\.id/.test(pc),'wave_customer_id always saved after Wave create');
ok(/wave_sync_status: verified \? 'synced' : 'pushed_unverified'/.test(pc),'verification sets status, does not withhold id');
ok(/\.eq\('id', hubId\)/.test(pc),'link saved to the exact hub customer row');
ok(!/if \(verified\) \{\s*await db\.from\('accounting_customers'\)\.update/.test(pc),'old verified-gated save removed');
ok(!/\bconst \b/.test(pc) && !/ => /.test(pc),'SWC-safe');
ok(/version: 'v55\.83-EH'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EH');
console.log('\nv55.83-EH customer linkback: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
