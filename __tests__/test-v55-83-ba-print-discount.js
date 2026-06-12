var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var t=p('src/components/AccountingInvoicesTab.jsx');
ok(/var docTot = row\.total_amount != null \? roundMoney\(Number\(row\.total_amount\)\) : lineSum/.test(t),'print uses stored Wave total as authoritative');
ok(/var adjustment = roundMoney\(docTot - lineSum\)/.test(t),'adjustment = docTot - lineSum');
ok(/Discount \/ adjustment/.test(t)&&/Subtotal/.test(t),'print shows Subtotal + Discount/adjustment lines');
ok(/Total<\/td><td class="r tot">' \+ fmt\(docTot\)/.test(t),'printed Total = docTot (not line subtotal)');
ok(/roundMoney\(docTot - paid\)/.test(t),'balance fallback uses docTot');
// math proof
function rm(x){return Math.round((Number(x)||0)*100)/100;}
var lineSum=rm(11980.41), docTot=rm(11181.39), adj=rm(docTot-lineSum);
ok(adj===-799.02,'1722 adjustment = -799.02 (got '+adj+')');
ok(rm(lineSum+adj)===docTot,'subtotal + adjustment = Wave total');
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page has version stamp');
ok(/version: 'v55\.83-BA'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BA');
console.log('\nv55.83-BA print discount: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
