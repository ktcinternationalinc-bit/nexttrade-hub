var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
function ex(f){try{fs.accessSync(path.join(__dirname,'..',f));return true;}catch(e){return false;}}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// shared helper
ok(ex('src/lib/wave-route-auth.js'),'shared auth helper exists');
var h=p('src/lib/wave-route-auth.js');
ok(/CRON_SECRET/.test(h) && /role === 'super_admin'/.test(h) && /db\.from\('users'\)/.test(h),'helper checks CRON OR super_admin via users');
ok(!/\bconst \b/.test(h) && !/=>/.test(h),'helper SWC-safe');
// all 6 routes now gated
['push-customer','push-invoice','push-invoice-v2','import-customers','import-invoices','reconcile'].forEach(function(r){
  var s=p('src/app/api/wave/'+r+'/route.js');
  ok(/assertPermission/.test(s),r+' imports + calls permission helper');
  ok(/_gate\.ok\)/.test(s) && /_gate\.status/.test(s),r+' returns 403/error when not authorized');
});
// reconcile + import UI pass userId
ok(/reconcile'[\s\S]*?userId: userProfile && userProfile\.id/.test(p('src/components/WaveImportTab.jsx')),'reconcile UI passes userId');
// preflight schema
ok(ex('src/app/api/wave/preflight-schema/route.js'),'preflight-schema route exists');
var ps=p('src/app/api/wave/preflight-schema/route.js');
ok(/REQUIRED = \{/.test(ps) && /default_payment_account_name/.test(ps) && /wave_categories/.test(ps),'preflight checks required cols');
ok(/assertPermission/.test(ps),'preflight is permission-gated');
ok(/runSchemaCheck/.test(p('src/components/WaveSyncCenter.jsx')) && /Check database setup/.test(p('src/components/WaveSyncCenter.jsx')),'UI schema check panel present');
console.log('\nv55.83-FR route lockdown: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');

// sync-pull must forward CRON bearer to now-protected imports (else scheduled pull 403s)
(function(){
  var sp = require('fs').readFileSync(require('path').join(__dirname,'..','src/app/api/wave/sync-pull/route.js'),'utf8');
  if (/headers\['Authorization'\] = 'Bearer ' \+ process\.env\.CRON_SECRET/.test(sp)) { console.log('  ✓ extra: sync-pull forwards CRON bearer to imports'); }
  else { console.log('  ✗ extra: sync-pull does NOT forward bearer — scheduled pull will 403'); process.exit(1); }
})();
