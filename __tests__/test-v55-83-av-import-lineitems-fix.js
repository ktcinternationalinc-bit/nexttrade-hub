var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/app/api/wave/import-invoices/route.js');
ok(/itemRows\[z\]\.invoice_id = invoiceId/.test(r)&&!/accounting_invoice_id/.test(r),'line items use invoice_id (not accounting_invoice_id)');
ok(/quantity: q/.test(r)&&!/qty:/.test(r),'quantity column (not qty)');
ok(/business_id: internalBusinessId,\n\s*invoice_id: null/.test(r),'business_id included on line items');
ok(/\.delete\(\)\.eq\('invoice_id', invoiceId\)/.test(r),'line-item delete keyed on invoice_id');
ok(/function fetchAllMap/.test(r)&&/\.range\(from, from \+ pageSize - 1\)/.test(r),'maps paginated past 1000 rows');
ok(/custMap = await fetchAllMap/.test(r)&&/invMap = await fetchAllMap/.test(r),'both maps use paginated fetch');
ok(/Schema check failed on accounting_invoices/.test(r)&&/Schema check failed on accounting_invoice_items/.test(r),'preflight schema check (one clear error)');
ok(!/`/.test(r)&&!/\bconst /.test(r)&&!/\blet \b/.test(r)&&!/=>/.test(r),'SWC-safe');
ok(p('src/app/page.jsx').indexOf('>v55.83-AV<')>=0,'page AV');
ok(/version: 'v55\.83-AV'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AV');
console.log('\nv55.83-AV import line-items fix: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
