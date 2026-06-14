var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/app/api/wave/sync-pull/route.js');var vj=JSON.parse(p('vercel.json'));
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// reuses existing import routes (no divergence)
ok(/\/api\/wave\/import-customers/.test(r) && /\/api\/wave\/import-invoices/.test(r),'pull re-runs existing import-customers + import-invoices');
ok(/wave_business_registry/.test(r),'iterates registered businesses');
// read-only on Wave: never calls a Wave write mutation
ok(!/customerCreate|invoiceCreate|Create Money/.test(r),'scheduled pull performs NO Wave writes (read-only into Hub)');
// secret protection
ok(/process\.env\.CRON_SECRET/.test(r) && /Bearer ' \+ secret/.test(r) && /Unauthorized/.test(r),'protected by CRON_SECRET when set');
// logs per business
ok(/entity_type: 'pull'/.test(r) && /action: 'scheduled_pull'/.test(r) && /wave_sync_log/.test(r),'writes wave_sync_log per business');
// cron handlers
ok(/export async function GET\(request\)/.test(r) && /export async function POST\(request\)/.test(r),'GET (cron) + POST (manual) handlers');
// SWC-safe
ok(!/\bconst \b/.test(r) && !/ => /.test(r),'route is SWC-safe (var + concat)');
// vercel.json cron
ok(Array.isArray(vj.crons) && vj.crons.some(function(c){return c.path==='/api/wave/sync-pull' && c.schedule==='0 */6 * * *';}),'vercel.json schedules sync-pull every 6h');
ok(vj.crons.length>=5,'vercel.json declares at least the original 5 crons');
ok(/version: 'v55\.83-DU'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DU');
console.log('\nv55.83-DU wave scheduled pull: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
