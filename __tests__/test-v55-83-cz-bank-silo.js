var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/BankReviewTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// the leak fix
ok(/setAcctCustomers\(scopeIfRegistered\(\(res\[2\] && res\[2\]\.data\) \|\| \[\], getActiveWaveBusiness\(\), reg, true\)\)/.test(r),'acctCustomers now scoped to active business (LEAK FIX)');
ok(/setAcctInvoices\(scopeIfRegistered\(\(res\[3\]/.test(r),'acctInvoices still scoped');
ok(!/setAcctCustomers\(\(res\[2\] && res\[2\]\.data\) \|\| \[\]\)/.test(r),'old unscoped acctCustomers load removed');
// cross-business guard
ok(/var activeBiz = getActiveWaveBusiness\(\);\s*\n\s*if \(activeBiz && inv\.wave_business_id && inv\.wave_business_id !== activeBiz\)/.test(r),'apply guard blocks cross-business by wave_business_id');
ok(/This transaction belongs to ' \+ bizLabel\(activeBiz\) \+ ' and cannot be matched to an invoice from ' \+ bizLabel\(inv\.wave_business_id\)/.test(r),'exact cross-business error message');
// banner
ok(/Current Accounting Silo/.test(r),'silo banner present');
ok(/isTest \? 'TEST' : 'PRODUCTION'/.test(r) && /canWrite \? 'READ-WRITE' : 'READ-ONLY'/.test(r),'banner shows mode (test/prod + rw/ro)');
ok(/NOT registered/.test(r),'banner warns when business unregistered (scoping off)');
ok(/var \[registry, setRegistry\] = useState\(\[\]\)/.test(r) && /setRegistry\(reg\)/.test(r),'registry stored for banner/labels');
// txns still scoped
ok(/var t = scopeIfRegistered\(\(res\[0\] && res\[0\]\.data\) \|\| \[\], getActiveWaveBusiness\(\), reg, true\)/.test(r),'bank txn list still scoped');
ok(/version: 'v55\.83-CZ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CZ');
console.log('\nv55.83-CZ bank silo: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
