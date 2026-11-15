var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var br=p('src/components/BankReviewTab.jsx');var bt=p('src/components/BankTab.jsx');var ex=p('src/app/api/plaid/exchange/route.js');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// real mask/name stored at connect (pre-existing)
ok(/mask: a\.mask \|\| null/.test(ex) && /from\('plaid_accounts'\)\.upsert/.test(ex),'exchange stores real account name+mask in plaid_accounts');
// Bank Review joins to plaid_accounts
ok(/supabase\.from\('plaid_accounts'\)\.select\('\*'\)/.test(br),'Bank Review loads plaid_accounts');
ok(/var \[plaidAccts, setPlaidAccts\] = useState\(\{\}\)/.test(br),'plaidAccts map state');
ok(/var a = plaidAccts\[t\.account_id\]/.test(br),'acctLabel joins txn.account_id -> plaid_accounts');
ok(/a\.name \|\| a\.official_name/.test(br) && /a\.mask \? \(' \\u00b7\\u00b7' \+ a\.mask\)/.test(br),'label uses real name + mask');
ok(/mask pending re-sync/.test(br),'fallback flags accounts missing plaid_accounts data');
ok(/\}, \[txns, plaidAccts\]\)/.test(br),'accounts list recomputes when plaidAccts loads');
ok(/list = list\.filter\(function \(t\) \{ return t\.account_id === fAccount; \}\)/.test(br),'filter still keys on account_id (unique id, not name)');
// Bank page one row per account
ok(/const \[plaidAccts, setPlaidAccts\] = useState\(\[\]\)/.test(bt),'BankTab loads plaid_accounts');
ok(/plaidAccts\.filter\(function \(a\) \{ return a\.connection_id === c\.id; \}\)/.test(bt),'BankTab groups accounts under their connection');
ok(/transactions\.filter\(function \(t\) \{ return t\.account_id === a\.plaid_account_id; \}\)\.length/.test(bt),'per-account transaction count');
ok(/Assigned to: <span/.test(bt) && /Sync connection/.test(bt),'shows assigned silo + connection-level sync label');
ok(/Account details pending/.test(bt),'hint when a connection has no account rows yet');
ok(/version: 'v55\.83-DJ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DJ');
console.log('\nv55.83-DJ account identity: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
