var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pi=p('src/app/api/wave/push-invoice/route.js');var wsc=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/var API_BUILD_MARKER = 'v55\.83-EO-push-invoice-productid-preflight';/.test(pi),'build marker defined');
ok(/export async function GET\(\)/.test(pi) && /api_build_marker: API_BUILD_MARKER/.test(pi),'GET returns marker');
ok(/LOCAL_PRECHECK_MISSING_PRODUCT_ID/.test(pi),'local preflight reason');
ok(/if \(missingProduct\)/.test(pi),'blocks when productId missing');
ok(/finalItems: lineItems, query: mutation, variables: waveMutationVariables/.test(pi),'request_payload logs finalItems + marker');
ok(/productMode = 'reused_existing'/.test(pi) && /productMode = 'created_new'/.test(pi),'productMode tracked');
ok(/productId: productId, description:/.test(pi),'line items carry productId');
ok(!/\bconst \b/.test(pi.replace(/export async function GET[\s\S]*$/,'')) ,'route body SWC-safe (var only, GET excepted)');
ok(/idx === 0 && <span[^>]*>NEWEST/.test(wsc),'Sync Log marks newest row');
ok(/l\.attempted_at \? String\(l\.attempted_at\)/.test(wsc),'Sync Log shows timestamp');
ok(/api_build_marker\) \|\| \(l\.request_payload && l\.request_payload\.api_build_marker\)/.test(wsc),'Sync Log shows build marker');
ok(/order\('id', \{ ascending: false \}\)/.test(wsc),'Sync Log newest-first');
ok(/version: 'v55\.83-EO'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EO');
console.log('\nv55.83-EO marker+preflight: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
