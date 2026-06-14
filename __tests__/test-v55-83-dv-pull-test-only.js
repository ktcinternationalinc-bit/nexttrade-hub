var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/app/api/wave/sync-pull/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/var includeProduction = false;/.test(r),'production excluded by default');
ok(/searchParams\.get\('includeProduction'\) === 'true'/.test(r),'opt-in via query param');
ok(/b\.includeProduction === true/.test(r),'opt-in via body');
ok(/businesses = includeProduction \? allBusinesses : allBusinesses\.filter\(function \(x\) \{ return x\.is_production === false; \}\)/.test(r),'default filters to test businesses (is_production === false)');
ok(/scope: includeProduction \? 'all_businesses' : 'test_only'/.test(r),'response reports scope');
// still read-only on Wave + secret protected (regression)
ok(!/customerCreate|invoiceCreate/.test(r),'still no Wave writes');
ok(/process\.env\.CRON_SECRET/.test(r),'still CRON_SECRET protected');
ok(!/\bconst \b/.test(r) && !/ => /.test(r),'SWC-safe');
ok(/version: 'v55\.83-DV'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DV');
console.log('\nv55.83-DV pull test-only: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
