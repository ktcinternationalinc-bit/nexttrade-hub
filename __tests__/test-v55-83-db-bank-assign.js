var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var rt=p('src/app/api/plaid/transactions/route.js');var bt=p('src/components/BankTab.jsx');var ing=p('src/lib/bank-ingest.js');var bw=p('src/app/api/accounting/bank-write/route.js');var sql=p('sql/v55-83-IV-account-level-silo.sql');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}

// v55.83-IV — ACCOUNT-LEVEL silo mapping (supersedes the old connection-level-only contract).
// Behavioral mapper test: account assignment WINS over the connection default; falls back when absent.
var m={exports:{}};(new Function('module','exports', p('src/lib/bank-ingest.js').replace(/export\s+/g,'')+'\nmodule.exports={mapPlaidTransaction};'))(m,m.exports);
var mapFn=m.exports.mapPlaidTransaction;
var conn={id:'c1',wave_business_id:'CONN_DEFAULT'};
var t6338={transaction_id:'x1',account_id:'acct6338',amount:-100,date:'2026-06-17'};
var t6353={transaction_id:'x2',account_id:'acct6353',amount:-50,date:'2026-06-17'};
var tUnmapped={transaction_id:'x3',account_id:'acctZZ',amount:-25,date:'2026-06-17'};
var acctSiloMap={acct6338:'KTC_PROD',acct6353:'KANDIL'};
ok(mapFn(t6338,conn,{},acctSiloMap).wave_business_id==='KTC_PROD','6338 stamps Real KTC by account (not connection)');
ok(mapFn(t6353,conn,{},acctSiloMap).wave_business_id==='KANDIL','6353 stamps Kandil by account (mixed connection)');
ok(mapFn(tUnmapped,conn,{},acctSiloMap).wave_business_id==='CONN_DEFAULT','unmapped account falls back to the connection default');
ok(mapFn(t6338,conn,{},null).wave_business_id==='CONN_DEFAULT','no account map -> connection default (back-compat)');

// source wiring — mapper + route
ok(/wave_business_id: acctBiz \|\| connBiz/.test(ing),'mapper stamps account assignment over connection default');
ok(/acctSiloMap = \{\}/.test(rt) && /from\('plaid_accounts'\)\.select\('plaid_account_id, wave_business_id'\)/.test(rt),'route builds account→silo map from plaid_accounts');
ok(/from\('plaid_accounts'\)\.upsert\(paRows/.test(rt),'route upserts plaid_accounts (names/masks), preserving assignment');
ok(/mapPlaidTransaction\(t, conn, accountsById, acctSiloMap\)/.test(rt),'ingestion passes the account→silo map to the mapper');

// assign + repair endpoint (service-role)
ok(/action === 'assign_account_silo'/.test(bw),'assign_account_silo action exists');
ok(/from\('plaid_accounts'\)\.update\(\{ wave_business_id: newBiz, assigned_by: by/.test(bw),'sets per-account assignment + audit fields');
ok(/from\('bank_transactions'\)\.update\(\{ wave_business_id: newBiz, updated_by: by \}\)\.eq\('account_id', pacct\)/.test(bw),'REPAIRS existing rows by account_id');
ok(/from\('bank_data_assignment_audit'\)\.insert/.test(bw),'writes assignment audit');

// still-valid guards
ok(/if \(!conn\.wave_business_id\) \{ return NextResponse\.json\(\{ error: 'This bank connection is not assigned/.test(rt),'sync blocked when connection unassigned');
ok(/const connectBank = async \(chosenBiz\) =>/.test(bt) && /if \(!chosenBiz\) \{ setError/.test(bt),'connect refuses without a chosen silo');
ok(/Unassigned Bank Data \(/.test(bt),'Unassigned Bank Data panel');
ok(/from\('bank_data_assignment_audit'\)\.insert/.test(bt),'connection-level assign still writes audit');

// SQL
ok(/ALTER TABLE plaid_accounts ADD COLUMN IF NOT EXISTS wave_business_id/.test(sql),'SQL adds plaid_accounts.wave_business_id');
ok(/version: 'v55\.83-DB'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DB entry preserved');
console.log('\nv55.83-DB/IV bank assign (account-level): '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
