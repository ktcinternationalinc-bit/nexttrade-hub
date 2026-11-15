var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/BankReviewTab.jsx');
var guard=p('src/lib/wave-silo-guard.js');
var sb=p('src/components/SiloBanner.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// the leak fix
ok(/setAcctCustomers\(scopeIfRegistered\(\(res\[2\] && res\[2\]\.data\) \|\| \[\], getActiveWaveBusiness\(\), reg, true\)\)/.test(r),'acctCustomers now scoped to active business (LEAK FIX)');
ok(/setAcctInvoices\(scopeIfRegistered\(\(res\[3\]/.test(r),'acctInvoices still scoped');
ok(!/setAcctCustomers\(\(res\[2\] && res\[2\]\.data\) \|\| \[\]\)/.test(r),'old unscoped acctCustomers load removed');
// cross-business guard
ok(/assertMatchSameSilo\(\{ activeBusinessId: activeBiz, bankTxn: t, invoice: inv/.test(r) && /if \(!siloCheck\.ok\) \{ toast\.error\(siloCheck\.message\)/.test(r),'apply guard blocks cross-business via shared silo guard');
ok(/cannot be matched to records from ' \+ labelFor\(active\)/.test(guard) && /belongs to ' \+ labelFor\(other\)/.test(guard),'exact cross-business error message (in shared guard)');
// banner
ok(/<SiloBanner/.test(r) && /Current Accounting Silo/.test(sb),'silo banner present (SiloBanner component)');
ok(/isTest \? 'TEST' : 'PRODUCTION'/.test(sb) && /canWrite \? 'READ-WRITE' : 'READ-ONLY'/.test(sb),'banner shows mode (test/prod + rw/ro)');
ok(/NOT registered/.test(sb),'banner warns when business unregistered (scoping off)');
ok(/var \[registry, setRegistry\] = useState\(\[\]\)/.test(r) && /setRegistry\(reg\)/.test(r),'registry stored for banner/labels');
// txns still scoped
ok(/var t = scopeIfRegistered\(\(res\[0\] && res\[0\]\.data\) \|\| \[\], getActiveWaveBusiness\(\), reg, true\)/.test(r),'bank txn list still scoped');
ok(/version: 'v55\.83-CZ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CZ');
console.log('\nv55.83-CZ bank silo: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
