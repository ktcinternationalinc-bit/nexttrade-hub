const assert = require('node:assert/strict');
const path = require('node:path');
require('sucrase/register');
const { FakeDb } = require('./fake-supabase');
const root = path.resolve(__dirname, '..');
let db, superAdmin = true, calls = [], authCalls = [];
function stub(file, exports) { const id = require.resolve(path.join(root,file)); require.cache[id] = { id,filename:id,loaded:true,exports }; }
stub('src/app/api/plaid/_auth.js', {
  authorizePlaidOperation: async (req,permission,cron) => { authCalls.push({permission,cron}); return { db,isVerifiedSuperAdmin:superAdmin,profileId:'verified-user' }; },
  plaidJson: (b,o)=>Response.json(b,o),plaidError:e=>Response.json({error:e.message},{status:503})
});
stub('src/lib/bank-visibility.js',{readBankJson:r=>r.json()});
const route = require('../src/app/api/plaid/pending-repair/route');
const { settlePendingLines } = require('../src/lib/pending-settle-server');
const U = n => '00000000-0000-0000-0000-'+String(n).padStart(12,'0');
function fresh() {
  db = new FakeDb(); calls=[]; authCalls=[];superAdmin=true;
  const p={id:U(1),plaid_transaction_id:'hold',account_id:'A',connection_id:'C',wave_business_id:'KTC',pending:true,date:'2026-10-01',amount_abs:8000,direction:'in',name:'Customer check',linked_id:'payment-1'};
  const q={...p,id:U(2),plaid_transaction_id:'posted',pending_transaction_id:'hold',pending:false,date:'2026-10-02',posted_date:'2026-10-02',linked_id:null};
  db.t.bank_transactions=[p,q];
  db.rpc=async(name,args)=>{calls.push({name,args});return {data:{ok:true,links_preserved:true},error:null};};
  return {p,q};
}
const call=async body=>{const r=await route.POST(new Request('http://fixture/api',{method:'POST',body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};};
let passed=0;
function check(label,fn){fn();passed++;console.log('PASS '+label);}
(async()=>{
  fresh();let r=await call({action:'preview'});
  check('preview is read-only and identifies exact stored replacement',()=>{assert.equal(calls.length,0);assert.equal(r.body.records[0].status,'replacement_found');assert.equal(r.body.records[0].posted_id,U(2));});
  check('preview omits raw provider payload and credentials',()=>{assert(!('raw' in r.body.records[0]));assert(!('access_token' in r.body.records[0]));});
  check('repair endpoint does not permit cron auth',()=>assert.deepEqual(authCalls[0],{permission:'bank.connections',cron:false}));
  superAdmin=false;r=await call({action:'preview'});
  check('admin without verified super-admin identity denied',()=>assert.equal(r.status,403));
  fresh();r=await call({action:'repair',pending_ids:[U(1)]});
  check('explicit confirmation required',()=>{assert.equal(r.status,400);assert.equal(calls.length,0);});
  r=await call({action:'repair',pending_ids:[U(1)],confirm:true});
  check('confirmed repair invokes atomic SQL with server-resolved identity',()=>{assert.equal(r.body.repaired,1);assert.equal(calls[0].name,'hub_reconcile_pending');assert.equal(calls[0].args.p_posted,U(2));assert(calls[0].args.p_reason.includes('verified-user'));});
  fresh();db.t.bank_transactions[1].pending_transaction_id=null;r=await call({action:'repair',pending_ids:[U(1)],confirm:true});
  check('equal amount/name cannot substitute for bank reference',()=>{assert.equal(r.body.repaired,0);assert.equal(calls.length,0);});
  fresh();db.t.bank_transactions[1].account_id='other';r=await call({action:'preview'});
  check('cross-account candidate excluded',()=>assert.equal(r.body.records[0].status,'no_replacement'));
  fresh();db.t.bank_transactions[1].amount_abs=9000;r=await call({action:'repair',pending_ids:[U(1)],confirm:true});
  check('changed final amount cannot silently change a payment',()=>{assert.equal(r.body.repaired,0);assert.equal(calls.length,0);});
  fresh();db.t.bank_transactions.push({...db.t.bank_transactions[1],id:U(3),plaid_transaction_id:'another'});r=await call({action:'preview'});
  check('multiple stored replacements require review',()=>assert.equal(r.body.records[0].status,'ambiguous'));
  fresh();db.rpc=async()=>({error:{code:'PGRST202',message:'missing function'}});r=await call({action:'repair',pending_ids:[U(1)],confirm:true});
  check('missing SQL reported as not repaired',()=>{assert.equal(r.body.ok,false);assert.match(r.body.results[0].reason,/not installed/);});
  fresh();db.rpc=async()=>({data:{ok:false,why:'closed month'}});r=await call({action:'repair',pending_ids:[U(1)],confirm:true});
  check('database refusal surfaced without success claim',()=>{assert.equal(r.body.repaired,0);assert.equal(r.body.results[0].reason,'closed month');});
  fresh();r=await settlePendingLines(db,{rawTxns:[],accountIds:['A'],windowStart:'2026-11-01',windowEnd:'2026-11-20',reportedAccounts:{A:true}});
  check('normal sync repairs historic stored bank-linked replacement outside current window',()=>{assert.equal(r.posted_replaced,1);assert.equal(calls[0].name,'hub_reconcile_pending');});
  fresh();r=await settlePendingLines(db,{rawTxns:[{transaction_id:'hold',pending:true}],accountIds:['A'],windowStart:'2026-11-01',reportedAccounts:{A:true}});
  check('bank still reporting pending is not forced posted by normal sync',()=>assert.equal(calls.length,0));
  fresh();db.rpc=async(name,args)=>{calls.push({name,args});return name==='hub_reconcile_pending'?{error:{code:'PGRST202',message:'Could not find hub_reconcile_pending in schema cache'}}:{data:{ok:true}};};
  r=await settlePendingLines(db,{rawTxns:[],accountIds:['A']});
  check('missing WC function preserves installed TU settlement and reports installation needed',()=>{assert.equal(r.posted_replaced,1);assert.equal(r.needs_sql,true);assert.deepEqual(calls.map(c=>c.name),['hub_reconcile_pending','hub_settle_pending']);});
  fresh();db.rpc=async(name,args)=>{calls.push({name,args});return {data:{ok:false,why:'closed month'}};};
  r=await settlePendingLines(db,{rawTxns:[],accountIds:['A']});
  check('WC refusal never falls back around accounting protections',()=>{assert.equal(r.posted_replaced,0);assert.equal(calls.length,1);});
  console.log(passed+' pending repair checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
