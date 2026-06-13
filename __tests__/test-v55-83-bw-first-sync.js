var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var rt=p('src/app/api/plaid/transactions/route.js');
ok(/error_code === 'PRODUCT_NOT_READY'/.test(rt),'route detects PRODUCT_NOT_READY');
ok(/pending: true/.test(rt),'route returns soft pending response');
ok(/last_sync_status: 'preparing'/.test(rt),'connection marked preparing');
ok(/if \(data\.error_code\) return NextResponse\.json\(\{ error/.test(rt),'other errors still returned');
// route stays SWC-safe in CODE (ignore comments): no template literals, no const/let/arrow outside comments
var code=rt.split('\n').filter(function(l){return l.trim().indexOf('//')!==0;}).join('\n');
ok(!/`/.test(code)&&!/\bconst /.test(code)&&!/\blet /.test(code),'route code SWC-safe (no template/const/let)');
var b=p('src/components/BankTab.jsx');
ok(/const \[notice, setNotice\] = useState\(''\)/.test(b),'notice state');
ok(/syncTransactions = async \(connId, attempt\)/.test(b),'sync takes attempt');
ok(/if \(data\.pending\)/.test(b),'handles pending');
ok(/setTimeout\(\(\) => \{ syncTransactions\(connId, attempt \+ 1\); \}, 15000\)/.test(b),'auto-retry every 15s');
ok(/attempt < 3/.test(b),'caps retries at 3');
ok(/bg-amber-100 border border-amber-300 text-amber-950/.test(b),'amber notice banner high-contrast');
ok(/version: 'v55\.83-BW'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BW');
console.log('\nv55.83-BW first sync: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
