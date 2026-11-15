var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/app/api/plaid/sync/route.js');var vj=JSON.parse(p('vercel.json'));
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/\/api\/plaid\/transactions/.test(r),'re-runs existing transactions route (no duplication)');
ok(/bank_connections'\)\.select/.test(r),'loops bank_connections');
ok(/includeProduction \|\| allBiz\[i\]\.is_production === false/.test(r),'TEST-only scope by default, production opt-in');
ok(/if \(!c\.wave_business_id\) \{ skippedUnassigned/.test(r),'skips unassigned connections');
ok(/if \(!inScope\[c\.wave_business_id\]\) \{ skippedOutOfScope/.test(r),'skips out-of-scope (e.g. production) connections');
ok(!/transactions\/sync|customerCreate|\/accounts\/balance.*post|removed/.test(r) && !/method: 'POST'[^}]*plaid\.com/.test(r),'no direct Plaid write calls (read-only via existing route)');
ok(r.indexOf("entity_type: 'plaid_transactions'")>=0 && r.indexOf("action: 'scheduled_sync'")>=0 && r.indexOf("wave_sync_log")>=0,'logs per connection to wave_sync_log');
ok(/process\.env\.CRON_SECRET/.test(r),'CRON_SECRET protected');
ok(/export async function GET\(request\)/.test(r) && /export async function POST\(request\)/.test(r),'GET cron + POST manual');
ok(!/\bconst \b/.test(r) && !/ => /.test(r),'SWC-safe');
ok(vj.crons.some(function(c){return c.path==='/api/plaid/sync' && c.schedule==='0 */3 * * *';}),'vercel.json schedules plaid/sync every 3h');
ok(vj.crons.length===6,'vercel.json has 6 crons');
ok(/version: 'v55\.83-EE'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EE');
console.log('\nv55.83-EE plaid autosync: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
