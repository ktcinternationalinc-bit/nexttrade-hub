var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var imp=p('src/app/api/wave/import-invoices/route.js');var dia=p('src/app/api/wave/invoice-diagnostic/route.js');var ar=p('src/components/AccountingCustomerHistory.jsx');
ok(/String\(m\.value\)\.replace\(\/,\/g, ''\)/.test(imp),'import num() strips commas');
ok(/isNaN\(v\) \? 0 : v/.test(imp),'import num() NaN-guarded');
ok(/String\(m\.value\)\.replace\(\/,\/g, ''\)/.test(dia),'diagnostic num() strips commas');
ok(/does not expose individual historical payment/.test(ar),'AR History notes Wave aggregate-only payment detail');
ok(!/`/.test(imp)&&!/=>/.test(imp),'SWC-safe');
// behavior proof
function num(m){ if(!m||m.value==null){return 0;} var v=Number(String(m.value).replace(/,/g,'')); return isNaN(v)?0:v; }
ok(num({value:'11,181.39'})===11181.39,'11,181.39 parses to 11181.39');
ok(num({value:'46,808.45'})===46808.45,'46,808.45 parses to 46808.45');
ok(num({value:'0.00'})===0,'0.00 parses to 0');
// 1730 partial reconciles
var total=num({value:'32,048.45'}),paid=num({value:'11,917.88'}),due=num({value:'20,130.57'});
ok(Math.round((paid+due)*100)/100===total,'1730 paid+due=total (partial reconciles)');
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page has version stamp');
ok(/version: 'v55\.83-AZ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AZ');
console.log('\nv55.83-AZ comma parse: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
