var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var s=p('src/app/api/plaid/sync/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/r\.text\(\)\.then/.test(s),'reads response as text first');
ok(/ct\.indexOf\('application\/json'\) < 0/.test(s),'checks content-type is json');
ok(/!r\.ok \|\| ct\.indexOf/.test(s),'checks response.ok');
ok(/Expected JSON but got HTTP/.test(s),'surfaces status + body preview on HTML');
ok(/\.slice\(0, 500\)/.test(s),'includes first 500 chars of body');
ok(/NEXT_PUBLIC_APP_URL/.test(s) && /VERCEL_URL/.test(s),'uses env absolute URL with fallback');
ok(/forwardBearer/.test(s) && /Bearer/.test(s),'forwards CRON_SECRET bearer');
ok(/for \(k = 0; k < conns\.length/.test(s) && /continue;/.test(s),'continues per-connection on skip/failure');
ok(/connection_id: c\.id/.test(s) && /entity_type: 'plaid_transactions'/.test(s),'logs which connection failed');
ok(/String\(logPayload\.error\)\.length > 800/.test(s),'caps logged payload size');
ok(!/access_token|PLAID_SECRET/.test(s.replace(/PLAID_SECRET \|\| PLAID_CLIENT/,'')) || !/response_payload:.*access_token/.test(s),'no secrets in log payload');
ok(/version: 'v55\.83-FG'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FG');
console.log('\nv55.83-FG plaid sync defensive: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
