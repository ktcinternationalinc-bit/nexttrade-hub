var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var link=p('src/app/api/plaid/link/route.js');
ok(/link_token: data\.link_token, env: env/.test(link),'link route returns env on success');
ok(/error: data\.error_message, env: env/.test(link),'link route returns env on error');
var env=p('src/app/api/plaid/env/route.js');
ok(/process\.env\.PLAID_ENV \|\| 'sandbox'/.test(env),'env route reads PLAID_ENV');
ok(/hasKeys: hasClientId && hasSecret/.test(env),'env route reports hasKeys');
ok(/!!process[.]env[.]PLAID_SECRET/.test(env) && (env.match(/PLAID_SECRET/g)||[]).length===1,'env route never returns the secret value (only boolean-coerced once)');
var b=p('src/components/BankTab.jsx');
ok(/const \[plaidEnv, setPlaidEnv\] = useState\(''\)/.test(b)&&/plaidStatus/.test(b),'env + status state');
ok(/fetch\('\/api\/plaid\/env'\)/.test(b),'mount probes env endpoint');
ok(/onExit: \(err, metadata\) =>/.test(b),'onExit takes err + metadata');
ok(/err\.error_code/.test(b)&&/metadata\.request_id/.test(b)&&/metadata\.institution/.test(b),'captures error_code + request_id + institution');
ok(/console\.log\('\[plaid\] Link exit'/.test(b),'logs full exit details');
ok(/closed the Plaid window before finishing/.test(b),'distinguishes clean cancel');
ok(/user_good \/ pass_good/.test(b),'sandbox guidance shown');
ok(/plaidEnv === 'production'/.test(b)&&/bg-emerald-100 border-emerald-300 text-emerald-950/.test(b),'production banner high-contrast');
ok(/bg-amber-100 border-amber-300 text-amber-950/.test(b),'sandbox banner high-contrast');
ok(/plaidStatus\.hasKeys === false/.test(b),'warns when keys missing');
ok(!/Sandbox mode — use test credentials to try it out/.test(b),'hardcoded sandbox label removed');
ok(/version: 'v55\.83-BU'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BU');
console.log('\nv55.83-BU plaid diagnostics: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
