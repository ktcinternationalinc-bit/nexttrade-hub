var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var cust=p('src/components/AccountingCustomersTab.jsx');var inv=p('src/components/AccountingInvoicesTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/if \(waveBiz\) \{ payload\.wave_business_id = waveBiz; \}/.test(cust),'customer create stamps active silo');
ok(/if \(!payload\.source\) \{ payload\.source = 'hub'; \}/.test(cust),'customer create sets source=hub');
ok(/if \(waveBiz\) \{ hpayload\.wave_business_id = waveBiz; \}/.test(inv),'invoice main save stamps active silo');
ok(/if \(!hpayload\.source\) \{ hpayload\.source = 'hub'; \}/.test(inv),'invoice main save sets source=hub');
ok(/wave_business_id: \(row\.wave_business_id \|\| waveBiz \|\| null\)/.test(inv),'proforma->invoice conversion stamps silo');
ok(/var waveBiz = getActiveWaveBusiness\(\)/.test(cust) && /var waveBiz = getActiveWaveBusiness\(\)/.test(inv),'both read active silo');
ok(/version: 'v55\.83-DY'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DY');
console.log('\nv55.83-DY accounting silo stamp: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
