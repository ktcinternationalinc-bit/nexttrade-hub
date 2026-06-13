var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var sb=p('src/components/SiloBanner.jsx');var br=p('src/components/BankReviewTab.jsx');var bt=p('src/components/BankTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// banner: inline white-on-dark, not purgeable amber classes
ok(/color: '#ffffff'/.test(sb),'banner uses white text (inline)');
ok(/#134e4a/.test(sb) && /#1e293b/.test(sb) && /#7f1d1d/.test(sb),'banner dark bgs for test/production/unregistered');
ok(!/bg-amber-100/.test(sb),'banner does NOT use purgeable amber-100');
ok(/import SiloBanner from '\.\/SiloBanner'/.test(br) && /<SiloBanner/.test(br),'Bank Review uses SiloBanner');
ok(/import SiloBanner from '\.\/SiloBanner'/.test(bt) && /<SiloBanner/.test(bt),'Bank page uses SiloBanner');
ok(!/bg-amber-100 text-amber-950 border-amber-500/.test(br),'old BankReview amber banner removed');
// unique account labels
ok(/function acctLabel\(t\)/.test(br),'acctLabel helper');
ok(/var idTail = t\.account_id \? \(' \\u00b7\\u00b7' \+ String\(t\.account_id\)\.slice\(-4\)\)/.test(br),'label adds last-4 of account_id to distinguish accounts');
ok(/s\[t\.account_id\] = acctLabel\(t\)/.test(br),'accounts dropdown built from unique acctLabel');
ok(/value=\{a\.id\}/.test(br),'account filter value is account_id (not name)');
ok(/list = list\.filter\(function \(t\) \{ return t\.account_id === fAccount; \}\)/.test(br),'filter keys on account_id');
// diagnostic count panel
ok(/Silo transactions: <b/.test(br) && /Showing: <b/.test(br) && /Hidden by filters:/.test(br),'count panel: silo total / showing / hidden');
ok(/Account: <b className="text-white">\{acctName\}/.test(br),'count panel shows selected account label');
ok(/other accounts — pick All accounts to see them/.test(br),'explains hidden-by-account when one account selected');
ok(/Some bank transactions are unassigned/.test(br),'warns on unassigned transactions');
ok(/version: 'v55\.83-DH'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DH');
console.log('\nv55.83-DH bank UI: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
