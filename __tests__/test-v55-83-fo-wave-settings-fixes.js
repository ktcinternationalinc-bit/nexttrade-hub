var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pa=p('src/app/api/wave/payment-account-setup/route.js');var sc=p('src/app/api/wave/sync-categories/route.js');var wsc=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// payment account filtering
ok(/isReceivableOrPayable = \(stU\.indexOf\('RECEIVABLE'\) >= 0 \|\| stU\.indexOf\('PAYABLE'\) >= 0\)/.test(pa),'excludes receivable/payable');
ok(/payable = looksCashBank && !isReceivableOrPayable/.test(pa),'capable requires cash/bank AND not receivable');
ok(/not a bank\/cash account and cannot receive payments/.test(pa),'select rejects non-capable server-side');
// UI only shows Use this on capable
ok(/payList\.filter\(function \(ac\) \{ return ac\.payment_capable; \}\)\.length === 0/.test(wsc),'empty-state when no capable accounts');
ok(/capable\s*\?\s*<button onClick=\{function \(\) \{ runPaymentAccountSetup\('select'/.test(wsc),'Use this only on capable accounts');
ok(/can't use/.test(wsc),'non-capable shows cant use');
ok(/Payment Deposit Account \(Wave\)/.test(wsc),'relabeled deposit account');
ok(/not<\/b> Accounts Receivable/.test(wsc),'copy clarifies not AR');
// 401 fix
ok(/assertPermission/.test(sc) && /wave\.categories\.pull/.test(sc),'categories permission-gated (wave.categories.pull)');
ok(!/db\.from\('profiles'\)\.select\('id, role'\)/.test(sc),'no longer queries profiles table');
ok(/version: 'v55\.83-FO'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FO');
console.log('\nv55.83-FO wave settings fixes: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
