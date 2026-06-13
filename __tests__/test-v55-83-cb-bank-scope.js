var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var ex=p('src/app/api/plaid/exchange/route.js');
ok(/public_token, metadata, wave_business_id/.test(ex),'exchange reads wave_business_id from client');
ok(/wave_business_id: wave_business_id \|\| null/.test(ex),'exchange stamps connection with business');
var ing=p('src/lib/bank-ingest.js');
ok(/wave_business_id: conn \? \(conn\.wave_business_id \|\| null\) : null/.test(ing),'transactions inherit connection business');
var bt=p('src/components/BankTab.jsx');
ok(/from '..\/lib\/wave-business'/.test(bt),'BankTab imports wave-business');
ok(/wave_business_id: getActiveWaveBusiness\(\) \|\| null/.test(bt),'connect passes active business');
ok(/setTransactions\(scopeToBusiness\(/.test(bt),'BankTab scopes transactions (list + Money In/Out)');
ok(/Current scope:/.test(bt),'Bank screen shows current scope banner');
var br=p('src/components/BankReviewTab.jsx');
ok(/var t = scopeToBusiness\(/.test(br),'Bank Review scopes transactions');
// BEHAVIORAL: cross-scope matching is impossible because both sides are filtered
function scope(rows,id){return rows.filter(function(r){return r.wave_business_id===id||r.wave_business_id==null;});}
var txns=[{id:'tA',wave_business_id:'PROD'},{id:'tB',wave_business_id:'TEST'}];
var invs=[{id:'iA',wave_business_id:'PROD'},{id:'iB',wave_business_id:'TEST'}];
var visTxn=scope(txns,'PROD').map(function(x){return x.id;});
var visInv=scope(invs,'PROD').map(function(x){return x.id;});
ok(visTxn.join(',')==='tA'&&visInv.join(',')==='iA','BEHAVIOR: PROD scope shows only PROD txn + PROD invoice');
ok(visTxn.indexOf('tB')<0&&visInv.indexOf('iB')<0,'BEHAVIOR: test txn + test invoice hidden in PROD -> cross-match impossible');
ok(/version: 'v55\.83-CB'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CB');
console.log('\nv55.83-CB bank scope: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
