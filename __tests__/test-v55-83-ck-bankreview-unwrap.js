var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var b=p('src/components/BankReviewTab.jsx');
ok(/setAcctCustomers\(\(res\[2\] && res\[2\]\.data\) \|\| \[\]\)/.test(b),'customers unwrap .data (the crash fix)');
ok(!/setAcctCustomers\(res\[2\] \|\| \[\]\)/.test(b),'no raw res[2] customers left');
ok(/var m = \(res\[1\] && res\[1\]\.data\) \|\| \[\]/.test(b),'matches unwrap .data');
ok(/\(res\[0\] && res\[0\]\.data\) \|\| \[\]/.test(b),'txns unwrap .data');
ok(/\(res\[3\] && res\[3\]\.data\) \|\| \[\]/.test(b),'invoices unwrap .data');
ok(/\(res\[4\] && res\[4\]\.data\) \|\| \[\]/.test(b),'registry unwrap .data');
ok(/version: 'v55\.83-CK'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CK');
console.log('\nv55.83-CK bankreview unwrap: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
