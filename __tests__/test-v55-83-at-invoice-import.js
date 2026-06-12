var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var route=p('src/app/api/wave/import-invoices/route.js');
var ui=p('src/components/WaveImportTab.jsx');
var sql=p('sql/v55-83-at-invoice-import.sql');

ok(/SUPABASE_SERVICE_ROLE_KEY/.test(route)&&/createClient/.test(route),'server-side service-role import');
ok(/while \(page <= totalPages/.test(route),'paginates all invoice pages');
ok(/items\{ product\{ name \} description quantity price total/.test(route),'pulls line items');
ok(/invMap\[n\.id\]/.test(route),'dedupe by wave_invoice_id (update vs insert)');
ok(/custMap\[n\.customer\.id\]/.test(route),'links customer via wave_customer_id');
ok(/needs_review: true/.test(route)&&/placeholders\.push/.test(route),'placeholder customer created + flagged');
ok(/wave_imported_paid: paid/.test(route),'Wave paid kept in wave_imported_paid');
ok(!/accounting_invoice_payments/.test(route),'NO phantom payment rows created');
ok(/from\('accounting_invoice_items'\)\.delete\(\)\.eq\('accounting_invoice_id'/.test(route),'line items delete-then-insert (dedupe-safe)');
ok(/source: 'wave_import'/.test(route)&&/is_historical: true/.test(route)&&/wave_sync_status: 'synced'/.test(route),'provenance stamps');
ok(/last_synced_at: startedAt/.test(route)&&/last_synced_hash: fingerprint/.test(route),'sync-readiness fields for future conflict detection');
ok(/wave_sync_log/.test(route)&&/entity_type: 'invoice'/.test(route)&&/records_pulled/.test(route),'sync log written');
ok(!/`/.test(route)&&!/\bconst /.test(route)&&!/\blet \b/.test(route)&&!/=>/.test(route),'SWC-safe');

ok(/\/api\/wave\/import-invoices/.test(ui)&&/Import invoices into Hub/.test(ui),'UI invoice import button');
ok(/Invoice import report/.test(ui)&&/line items/.test(ui)&&/placeholder customer/.test(ui),'report shows line items + placeholders');

ok(/last_synced_hash/.test(sql)&&/needs_review/.test(sql)&&/due_date/.test(sql),'sync-ready schema');
ok(p('src/app/page.jsx').indexOf('>v55.83-AT<')>=0,'page AT');
ok(/version: 'v55\.83-AT'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AT');
console.log('\nv55.83-AT invoice import: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
