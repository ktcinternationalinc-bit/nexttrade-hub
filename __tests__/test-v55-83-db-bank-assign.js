var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var rt=p('src/app/api/plaid/transactions/route.js');var bt=p('src/components/BankTab.jsx');var ing=p('src/lib/bank-ingest.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// Part 2 — stamping (CB) still present
ok(/wave_business_id: conn \? \(conn\.wave_business_id \|\| null\) : null/.test(ing),'transactions inherit conn.wave_business_id');
// sync block
ok(/if \(!conn\.wave_business_id\) \{ return NextResponse\.json\(\{ error: 'This bank connection is not assigned/.test(rt),'sync BLOCKED (409) when connection unassigned');
// connect guard
ok(/const activeBiz = getActiveWaveBusiness\(\);\s*\n\s*if \(!activeBiz\) \{ setError/.test(bt),'connect refuses without an active silo');
// unassigned panel + assign
ok(/Unassigned Bank Data \(/.test(bt),'Unassigned Bank Data panel');
ok(/connections\.filter\(function \(c\) \{ return !c\.wave_business_id; \}\)/.test(bt),'panel lists connections with no silo');
ok(/const assignConnection = async \(conn\) =>/.test(bt),'assignConnection handler');
ok(/from\('bank_connections'\)\.update\(\{ wave_business_id: bizId, assigned_by:/.test(bt),'assign updates connection + assigned_by/at');
ok(/from\('bank_transactions'\)\.update\(\{ wave_business_id: bizId \}\)\.eq\('connection_id', conn\.id\)/.test(bt),'assign stamps all the connection transactions');
ok(/from\('bank_data_assignment_audit'\)\.insert/.test(bt),'writes assignment audit row');
ok(/old_wave_business_id: conn\.wave_business_id \|\| null, new_wave_business_id: bizId/.test(bt),'audit captures old->new business');
ok(/b\.is_production === false \? ' \(Test\)' : ' \(Production\)'/.test(bt),'silo dropdown labels test/production');
// scoping intact
ok(/scopeIfRegistered\(txns \|\| \[\], getActiveWaveBusiness\(\), bizRegistry, true\)/.test(bt),'bank txn list scoped to active silo');
ok((bt.match(/\\+u[0-9a-fA-F]{4}/g)||[]).length===0,'no escaped unicode');
ok(/version: 'v55\.83-DB'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DB');
console.log('\nv55.83-DB bank assign: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
