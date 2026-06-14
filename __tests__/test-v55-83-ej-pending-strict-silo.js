var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/if \(c\.wave_business_id !== active\) \{ return; \}/.test(r),'customers strict same-silo for push');
ok(/if \(inv\.wave_business_id !== active\) \{ return; \}/.test(r),'invoices strict same-silo for push');
ok(/'REAL_KTC_WAVE_BUSINESS_ID': 1, 'TEST_WAVE_BUSINESS_ID': 1/.test(r),'placeholder silos explicitly excluded');
ok(/\}, \[customers, invoices, active\]\);/.test(r),'queue recomputes on active silo change');
ok(/version: 'v55\.83-EJ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EJ');
console.log('\nv55.83-EJ pending strict silo: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
