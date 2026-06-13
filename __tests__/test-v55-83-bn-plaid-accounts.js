var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var sql=p('sql/v55-83-bn-plaid-accounts.sql');var ex=p('src/app/api/plaid/exchange/route.js');var tx=p('src/app/api/plaid/transactions/route.js');
ok(/CREATE TABLE IF NOT EXISTS plaid_accounts/.test(sql),'plaid_accounts table');
['connection_id','business_id','plaid_account_id','official_name','mask','subtype','iso_currency','current_balance','available_balance','is_read_only'].forEach(function(c){ ok(new RegExp(c).test(sql),'plaid_accounts has '+c); });
ok(/UNIQUE INDEX IF NOT EXISTS ux_plaid_account_id/.test(sql),'unique index for upsert dedupe');
ok(/ENABLE ROW LEVEL SECURITY/.test(sql)&&(sql.match(/CREATE POLICY/g)||[]).length>=4,'RLS + 4 policies');
ok(/last_sync_status/.test(sql)&&/last_sync_error/.test(sql),'connection sync status columns');
ok(/\/accounts\/get/.test(ex)&&/plaid_accounts'\)\.upsert/.test(ex)&&/onConflict: 'plaid_account_id'/.test(ex),'exchange stores accounts via /accounts/get');
ok(/current_balance: a\.balances \? a\.balances\.current/.test(ex),'exchange captures balances');
ok(/catch \(accErr\)/.test(ex),'account pull is non-fatal');
ok(/last_sync_status: 'ok'/.test(tx),'transactions stamps sync status ok');
ok(/version: 'v55\.83-BN'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BN');
console.log('\nv55.83-BN plaid accounts: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
