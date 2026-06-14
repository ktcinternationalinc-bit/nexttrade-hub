var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/app/api/wave/sync-categories/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/business\(id:\$bid\)\{ accounts\(page:\$page/.test(r),'queries Wave business.accounts (chart of accounts)');
ok(/wave_categories'\)\.update\(rowPayload\)\.eq\('id', exRow\.id\)/.test(r) && /wave_categories'\)\.insert\(rowPayload\)/.test(r),'upserts: update existing, insert new (dedupe by account id)');
ok(/\.eq\('wave_business_id', biz\.wave_business_id\)\.eq\('wave_account_id', a\.id\)/.test(r),'dedupe key = (wave_business_id, wave_account_id)');
ok(/exRow\.last_synced_hash === fp\) \{ skipped/.test(r),'skips unchanged via last_synced_hash');
ok(/is_active: a\.isArchived === true \? false : true/.test(r),'maps isArchived -> is_active');
  ok(/wave_account_name: a\.name/.test(r) && /wave_account_type: typeName/.test(r),'writes existing column names wave_account_name/type');
ok(/raw_payload: a/.test(r),'stores raw payload');
// test-only default + read-only + secret
ok(/includeProduction \? allBiz : allBiz\.filter\(function \(x\) \{ return x\.is_production === false; \}\)/.test(r),'TEST-only by default, production opt-in');
ok(!/accountCreate|accountEdit|customerCreate|invoiceCreate|mutation/.test(r),'read-only on Wave (no mutations)');
ok(/process\.env\.CRON_SECRET/.test(r),'CRON_SECRET protected');
ok(/entity_type: 'category', action: 'pull'/.test(r) && /wave_sync_log/.test(r),'logs to wave_sync_log');
ok(!/\bconst \b/.test(r) && !/ => /.test(r),'SWC-safe');
ok(/version: 'v55\.83-DW'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DW');
console.log('\nv55.83-DW wave categories pull: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
