var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var v2=p('src/app/api/wave/push-invoice-v2/route.js');var wsc=p('src/components/WaveSyncCenter.jsx');var wn=p('src/components/WhatsNewWidget.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// Fix 1: log ordering
ok(/order\('attempted_at', \{ ascending: false \}\)\.order\('id', \{ ascending: false \}\)/.test(wsc),'Sync Log sorts by attempted_at then id');
ok(/idx === 0 && <span[^>]*>NEWEST/.test(wsc),'NEWEST badge on sorted row 0 (true latest)');
// Fix 2: productCreate isSold
var ps = fs.readFileSync(path.join(__dirname,'..','src/app/api/wave/product-setup/route.js'),'utf8');
var pcv = (ps.match(/var pcVars = .*/)||[''])[0];
// v55.83-IN: Wave's ProductCreateInput REQUIRES the sold/bought indicator — the earlier assertion
// that isSold/isBought were "invalid flags" was wrong and caused the live "buying or selling" reject.
ok(/isSold: true/.test(pcv) && /isBought: false/.test(pcv) && /incomeAccountId: incomeAccountId/.test(pcv),'productCreate sends isSold/isBought + incomeAccountId (Wave-required)');
// safety/diagnostics retained
ok(/var API_BUILD_MARKER = 'v55\.83-EP-push-invoice-v2-productid';/.test(v2),'v2 marker retained');
ok(/var API_ROUTE = '\/api\/wave\/push-invoice-v2';/.test(v2),'v2 route retained');
ok(/LOCAL_PRECHECK_MISSING_PRODUCT_ID/.test(v2),'local preflight retained');
// v55.83-IY: per-line product — each line uses its own wave_product_id, default only as fallback.
ok(/var lineProd = items\[k\]\.wave_product_id \|\| productId/.test(v2) && /lineItems\.push\(\{ productId: lineProd/.test(v2),'line items carry a per-line productId (default fallback)');
ok(!/isSold !== false/.test(v2),'no any-sold fallback');
ok(/q\.action === 'invoice' \? '\/api\/wave\/push-invoice-v2'/.test(wsc),'UI calls v2');
ok(!/\bconst \b/.test(v2.replace(/export async function GET[\s\S]*$/,'')),'v2 SWC-safe');
// single combined build
ok(/version: 'v55\.83-ES'/.test(wn),'WhatsNew ES present');
ok(wn.indexOf("version: 'v55.83-ER'")<0,'ER collapsed into ES (no stray ER entry)');
console.log('\nv55.83-ES combined: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
