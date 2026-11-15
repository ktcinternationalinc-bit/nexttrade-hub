var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var b=p('src/components/BankTab.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/const \[connectModalOpen, setConnectModalOpen\] = useState\(false\)/.test(b),'pre-Plaid modal state');
ok(/Which accounting silo does this bank belong to\?/.test(b),'modal asks which silo');
ok(/setConnectModalOpen\(true\)/.test(b) && /onClick=\{function \(\) \{ setError\(''\); setConnectBizSel/.test(b),'Connect Bank opens the modal (not Plaid directly)');
ok(/const connectBank = async \(chosenBiz\) =>/.test(b),'connectBank takes explicit chosenBiz');
ok(/if \(!chosenBiz\) \{ setError\('Choose which accounting silo/.test(b),'connectBank blocks without a chosen silo');
ok(/wave_business_id: chosenBiz \|\| null/.test(b) && !/wave_business_id: getActiveWaveBusiness\(\) \|\| null/.test(b),'exchange uses chosen silo (not silent active)');
ok(/setConnectModalOpen\(false\); connectBank\(biz\);/.test(b),'Continue to Plaid passes chosen silo then connects');
ok(/disabled=\{!connectBizSel\}/.test(b),'Continue disabled until a silo is chosen');
ok(/isTest \? 'TEST' : 'PRODUCTION'/.test(b),'modal shows TEST/PRODUCTION pills');
ok(/No Wave businesses are registered yet/.test(b),'empty-registry guidance');
// still enforced
ok(/connections\.filter\(function \(c\) \{ return !c\.wave_business_id; \}\)/.test(b),'Unassigned Bank Data panel intact');
var rt=p('src/app/api/plaid/transactions/route.js');
ok(/if \(!conn\.wave_business_id\) \{ return NextResponse\.json/.test(rt),'sync still blocked for unassigned connections');
ok((b.match(/\\+u[0-9a-fA-F]{4}/g)||[]).length===0,'no escaped unicode');
ok(/version: 'v55\.83-DE'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DE');
console.log('\nv55.83-DE plaid modal: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
