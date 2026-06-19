var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var rt=p('src/app/api/wave/sync-categories/route.js');var wsc=p('src/components/WaveSyncCenter.jsx');var br=p('src/components/BankReviewTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// route auth — v55.83-IS: auth (super_admin + CRON bearer) now delegated to assertPermission.
ok(/bodyJson\.user_id/.test(rt) && /assertPermission\(db, \(bodyJson && bodyJson\.user_id\) \|\| null, 'wave\.categories\.pull'/.test(rt),'route gates on wave.categories.pull (super_admin via assertPermission)');
ok(/assertPermission/.test(rt) && /'wave\.categories\.pull', request\)/.test(rt),'route auth (incl. CRON bearer) handled by assertPermission(request)');
ok(/onlyBiz/.test(rt) && /wave_business_id === onlyBiz/.test(rt),'route scopes to active business');
// v55.83-IX (Codex P0): an explicit single-business pull (onlyBiz) must include PRODUCTION too,
// else Real KTC can never pull its Wave Chart of Accounts and the categorize dropdown stays empty.
ok(/if \(onlyBiz\) \{\s*businesses = allBiz\.filter\(function \(x\) \{ return x\.wave_business_id === onlyBiz; \}\);/.test(rt),'explicit single-business category pull includes production (read-only)');
ok(!/\bconst \b/.test(rt) && !/=>/.test(rt),'route SWC-safe');
// UI pull
ok(/runCategoryPull/.test(wsc) && /sync-categories/.test(wsc),'pull handler present');
ok(/Wave Categories \(Chart of Accounts\)/.test(wsc),'category card present');
ok(/loadCatCount/.test(wsc) && /count: 'exact'/.test(wsc),'shows loaded count');
ok(/user_id: \(userProfile && userProfile\.id\)/.test(wsc),'sends user_id for auth');
ok(/Push permissions for:/.test(wsc),'push permissions intact');
// bank review dropdown
ok(/setWaveCategories/.test(br) && /from\('wave_categories'\)/.test(br),'bank review loads wave categories');
ok(/c\.wave_business_id !== activeBiz/.test(br),'categories scoped to active silo');
ok(/optgroup label="Wave categories"/.test(br),'wave categories optgroup in dropdown');
ok(/optgroup label="General"/.test(br),'general fallback preserved');
ok(/value=\{'wave:' \+ c\.wave_account_id\}/.test(br),'stores wave account id reference');
ok(/version: 'v55\.83-FM'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew FM');
console.log('\nv55.83-FM wave categories: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
