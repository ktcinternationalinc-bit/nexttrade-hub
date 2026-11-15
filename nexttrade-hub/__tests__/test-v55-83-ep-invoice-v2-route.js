var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
function ex(f){try{fs.accessSync(path.join(__dirname,'..',f));return true;}catch(e){return false;}}
var v2=p('src/app/api/wave/push-invoice-v2/route.js');var wsc=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(ex('src/app/api/wave/push-invoice-v2/route.js'),'new v2 route file exists');
ok(/var API_BUILD_MARKER = 'v55\.83-EP-push-invoice-v2-productid';/.test(v2),'v2 marker');
ok(/var API_ROUTE = '\/api\/wave\/push-invoice-v2';/.test(v2),'v2 route const');
ok(/export async function GET\(\)/.test(v2) && /route: API_ROUTE, api_build_marker: API_BUILD_MARKER/.test(v2),'GET returns route+marker');
ok(/route: API_ROUTE/.test(v2.match(/var reqPayload =[^;]*/)[0]),'request_payload carries route');
ok(/LOCAL_PRECHECK_MISSING_PRODUCT_ID/.test(v2) && /if \(missingProduct\)/.test(v2),'local preflight present');
ok(/name === 'NextTrade Hub Item'/.test(v2) && !/isSold !== false/.test(v2),'exact-name only, no any-sold fallback');
ok(/productId: productId, description:/.test(v2),'finalItems carry productId');
ok(/q\.action === 'invoice' \? '\/api\/wave\/push-invoice-v2'/.test(wsc),'UI invoice push calls v2');
ok(/var rt = \(l\.request_payload && l\.request_payload\.route\)/.test(wsc),'Sync Log reads route');
ok(/text-violet-300 font-mono">\{rt\}/.test(wsc),'Sync Log shows route badge');
ok(!/\bconst \b/.test(v2.replace(/export async function GET[\s\S]*$/,'')),'v2 route body SWC-safe');
ok(/version: 'v55\.83-EP'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EP');
console.log('\nv55.83-EP invoice v2 route: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
