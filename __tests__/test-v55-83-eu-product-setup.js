var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
function ex(f){try{fs.accessSync(path.join(__dirname,'..',f));return true;}catch(e){return false;}}
var v2=p('src/app/api/wave/push-invoice-v2/route.js');var ps=p('src/app/api/wave/product-setup/route.js');var wsc=p('src/components/WaveSyncCenter.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(ex('src/app/api/wave/product-setup/route.js'),'product-setup route exists');
ok(!/productCreate/.test(v2),'invoice push no longer calls productCreate');
ok(/wave_business_settings'\)\.select\('default_invoice_product_id/.test(v2),'push reads configured default product');
ok(/NO_DEFAULT_PRODUCT_CONFIGURED/.test(v2),'push blocks locally if no product configured');
ok(/productMode = 'configured_default'/.test(v2) && /productMode = 'found_by_name'/.test(v2),'push resolves configured or by-name');
ok(/var API_BUILD_MARKER = 'v55\.83-EU-product-setup';/.test(ps),'setup route marker');
ok(/mode === 'find'/.test(ps) && /mode === 'create'/.test(ps) && /mode === 'list'/.test(ps),'setup modes find/create/list');
ok(/upsert\(row, \{ onConflict: 'wave_business_id' \}\)/.test(ps),'saves default per business');
ok(/bid !== APPROVED_PUSH_BUSINESS_ID/.test(ps),'setup KANDIL-only guard');
ok(/function runProductSetup\(/.test(wsc),'UI handler present');
ok(/Default Invoice Product \(Wave\)/.test(wsc),'Settings panel present');
ok(!/\bconst \b/.test(v2.replace(/export async function GET[\s\S]*?\}\n/,'')),'v2 SWC-safe');
ok(!/\bconst \b/.test(ps.replace(/export async function GET[\s\S]*?\}\n/,'')),'setup route SWC-safe');
ok(/version: 'v55\.83-EU'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EU');
console.log('\nv55.83-EU product setup: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
