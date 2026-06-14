var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var v2=p('src/app/api/wave/push-invoice-v2/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var pcVarsLine = (v2.match(/var pcVars = .*/)||[''])[0];
ok(!/isSold|isBought/.test(pcVarsLine),'isSold/isBought removed from product create input');
ok(/unitPrice: '0'/.test(v2),'unitPrice sent as string');
ok(/description: 'Reusable Hub invoice line item'/.test(v2),'product create has description');
ok(/__type\(name:"ProductCreateInput"\)/.test(v2),'introspects ProductCreateInput on failure');
ok(/productCreateInput_real_fields: realFields/.test(v2),'logs real fields for exact next fix');
ok(/incomeAccountId: incomeAccountId/.test(v2),'income account retained');
ok(/productId: productId, description:/.test(v2),'line items carry productId');
ok(!/\bconst \b/.test(v2.replace(/export async function GET[\s\S]*$/,'')),'SWC-safe');
ok(/version: 'v55\.83-ET'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew ET');
console.log('\nv55.83-ET product fields: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
