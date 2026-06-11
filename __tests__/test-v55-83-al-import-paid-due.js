const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const route=p('src/app/api/wave/import-preview/route.js');
const ui=p('src/components/WaveImportTab.jsx');
// amountPaid pulled; exactly one 'status' field in the invoice GraphQL line (no dup)
ok(/amountPaid\{ value \}/.test(route),'invoice query pulls amountPaid');
ok(/amountDue\{ value \}/.test(route)&&/status invoiceDate/.test(route),'still has amountDue + status');
var invLine=(route.match(/invoices\(page:\$page[\s\S]*?customer\{ id name \} \} \}/)||[''])[0];
ok((invLine.match(/ status /g)||[]).length<=1,'no duplicate status field in invoice query');
ok(!/mutation/.test(route),'still READ ONLY');
ok(/Paid/.test(ui)&&/money\(it\.amountPaid\)/.test(ui),'UI shows Paid column');
ok(/Plaid/.test(ui),'UI notes Plaid is the cash-detail source');
ok(/>v55\.83-AL</.test(p('src/app/page.jsx')),'page stamped AL');
ok(/version: 'v55\.83-AL'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AL');
console.log('\nv55.83-AL import paid/due: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
