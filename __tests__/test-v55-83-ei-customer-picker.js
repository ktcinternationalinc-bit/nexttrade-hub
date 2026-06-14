var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/AccountingInvoicesTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/var shown = matched\.slice\(0, 50\);/.test(r),'typeahead cap raised to 50');
ok(/var moreCount = matched\.length - shown\.length;/.test(r),'computes how many more match');
ok(/\+\{moreCount\} more/.test(r),'shows more-matches hint');
ok(/var scopedCustomers = scopeIfRegistered\(customers, waveBiz, waveReg, true\);/.test(r),'customer list scoped to active silo');
ok(/items=\{scopedCustomers\}/.test(r),'picker uses scoped customers');
ok(!/items=\{customers\} value=\{hdr\.accounting_customer_id\}/.test(r),'picker no longer uses unscoped list');
ok(/version: 'v55\.83-EI'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EI');
console.log('\nv55.83-EI customer picker: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
