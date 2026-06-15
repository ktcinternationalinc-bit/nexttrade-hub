var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
function ex(f){try{fs.accessSync(path.join(__dirname,'..',f));return true;}catch(e){return false;}}
var sc=p('src/app/api/wave/schema-check/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(ex('src/app/api/wave/schema-check/route.js'),'schema-check route exists');
ok(/InvoicePaymentCreateManualInput/.test(sc),'introspects invoicePaymentCreateManual input');
ok(/payment_related_mutations/.test(sc),'lists payment mutation names');
ok(/invoice_has_payments_field/.test(sc),'checks Invoice.payments field');
ok(!/mutation\s*\(/.test(sc) && !/Create\(input/.test(sc),'no write mutations (read-only)');
ok(/export async function POST/.test(sc) && /body && body\.user_id/.test(sc),'POST takes user_id from body (not URL)');
ok(!/searchParams\.get\('user_id'\)/.test(sc),'user_id never read from URL (avoids logging)');
ok(/isSuperAdmin\(userId\)/.test(sc) && /CRON_SECRET/.test(sc),'protected: super_admin or CRON_SECRET');
ok(/Unauthorized/.test(sc) && /401/.test(sc),'returns 401 when unauthorized');
ok(/no-store/.test(sc),'sets no-store cache header');
ok(/paymentMethod_enum_values/.test(sc),'returns paymentMethod enum');
ok(/candidate_payment_accounts/.test(sc),'returns candidate bank/cash payment accounts');
ok(!/url\.searchParams\.get\('query'\)/.test(sc) && !/body\.query/.test(sc),'no arbitrary GraphQL from request');
ok(!/\bconst \b/.test(sc.replace(/export async function GET[\s\S]*$/,'')),'SWC-safe');
ok(/version: 'v55\.83-EX'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew EX');
console.log('\nv55.83-EX schema check: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
