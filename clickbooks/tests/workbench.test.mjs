import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
async function load(path){return import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL(path,import.meta.url),'utf8')).toString('base64'));}
const {createWorkbenchHandlers,validateWorkbenchCommand}=await load('../../src/lib/clickbooks-us-workbench.js');
const {createRulesJob}=await load('../../src/lib/clickbooks-us-rules-job.js');
const ID='11111111-1111-4111-8111-111111111111',RID='22222222-2222-4222-8222-222222222222';
const env={CLICKBOOKS_US_ENABLED:'true',CLICKBOOKS_US_WORKBENCH_ENABLED:'true',CLICKBOOKS_US_STAGE_WRITES_ENABLED:'true'};
function request(area='rules',{method='GET',origin='https://hub.test',query='',body,contentType='application/json',headers={}}={}){return new Request('https://hub.test/api/accounting/clickbooks-us/'+area+query,{method,headers:{...(origin?{Origin:origin}:{}),...(method==='POST'?{'Content-Type':contentType}:{}),...headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});}
function fixture({area='rules',superAdmin=true,grants={rules:false,migration:false},dashboard=false,bank=false,flags={},fail,identity=ID,response}={}){const calls=[];const auth=async()=>({authUserId:identity,isVerifiedSuperAdmin:superAdmin,canViewFullDashboard:dashboard,canViewBankBalances:bank,db:{rpc:async(name,args)=>{calls.push({name,args});if(name==='clickbooks_us_operator_capabilities')return {data:grants,error:fail==='grants'?{message:'secret'}:null};return {data:response||{scope:'KTC_US',area,result:true},error:fail&&fail!=='grants'?{message:fail}:null};}}});return {...createWorkbenchHandlers(area,auth,{...env,...flags}),calls};}
const commands={snapshot:{action:'snapshot',payload:{requestId:RID,cutoff:'2026-11-02',strategy:'opening_balance'}},preview:{action:'preview_rule',payload:{definition:{name:'test'}}},stage:{action:'stage_rules',payload:{}}};
test('super admin reads rules with server scope',async()=>{const f=fixture();const r=await f.GET(request());assert.equal(r.status,200);assert.equal(f.calls[0].name,'clickbooks_us_workbench_read');assert.deepEqual(f.calls[0].args,{p_area:'rules',p_run:null});assert.match(r.headers.get('cache-control'),/no-store/);});
test('verified super admin reads migration',async()=>{const f=fixture({area:'migration'});assert.equal((await f.GET(request('migration',{query:'?run='+RID}))).status,200);assert.equal(f.calls[0].args.p_run,RID);});
for(const flags of [{CLICKBOOKS_US_ENABLED:'false'},{CLICKBOOKS_US_WORKBENCH_ENABLED:'false'}])test('disabled gate denies before database '+Object.keys(flags)[0],async()=>{const f=fixture({flags});assert.equal((await f.GET(request())).status,503);assert.equal(f.calls.length,0);});
test('invalid verified identity rejected',async()=>{const f=fixture({identity:'client-supplied-admin'});assert.equal((await f.GET(request())).status,401);assert.equal(f.calls.length,0);});
test('ordinary rule operator needs no bank balance permission',async()=>{const f=fixture({superAdmin:false,grants:{rules:true,migration:false}});assert.equal((await f.GET(request())).status,200);assert.equal(f.calls[0].args.p_actor,ID);});
test('dashboard and bank permissions alone do not grant rules',async()=>{const f=fixture({superAdmin:false,dashboard:true,bank:true});assert.equal((await f.GET(request())).status,403);assert.equal(f.calls.length,1);});
for(const [name,dashboard,bank,grant] of [['no-dashboard',false,true,true],['no-bank',true,false,true],['no-grant',true,true,false]])test('migration rejects '+name,async()=>{const f=fixture({area:'migration',superAdmin:false,dashboard,bank,grants:{migration:grant}});assert.equal((await f.GET(request('migration'))).status,403);assert.equal(f.calls.length,1);});
test('migration explicit grant plus both visibility grants succeeds',async()=>{const f=fixture({area:'migration',superAdmin:false,dashboard:true,bank:true,grants:{migration:true}});assert.equal((await f.GET(request('migration'))).status,200);});
test('permission lookup failure fails closed',async()=>{const f=fixture({superAdmin:false,fail:'grants'});assert.equal((await f.GET(request())).status,503);assert.equal(f.calls.length,1);});
for(const query of ['?business_id=EGYPT','?banking=true','?run='+RID])test('rules rejects query '+query,async()=>{const f=fixture();assert.equal((await f.GET(request('rules',{query}))).status,400);assert.equal(f.calls.length,0);});
test('migration rejects duplicate run selector',async()=>{const f=fixture({area:'migration'});assert.equal((await f.GET(request('migration',{query:'?run='+RID+'&run='+RID}))).status,400);});
test('cross origin rejected before auth',async()=>{const f=fixture();assert.equal((await f.GET(request('rules',{origin:'https://evil.test'}))).status,403);assert.equal(f.calls.length,0);});
test('POST requires Origin',async()=>{const f=fixture();assert.equal((await f.POST(request('rules',{method:'POST',origin:null,body:commands.stage}))).status,403);});
test('cross-site fetch denied',async()=>{const f=fixture();assert.equal((await f.GET(request('rules',{headers:{'sec-fetch-site':'cross-site'}}))).status,403);});
test('POST requires application/json',async()=>{const f=fixture();assert.equal((await f.POST(request('rules',{method:'POST',contentType:'text/plain',body:commands.stage}))).status,415);});
test('preview permitted while staging writes disabled',async()=>{const f=fixture({flags:{CLICKBOOKS_US_STAGE_WRITES_ENABLED:'false'}});assert.equal((await f.POST(request('rules',{method:'POST',body:commands.preview}))).status,200);});
test('staging writes default locked',async()=>{const f=fixture({flags:{CLICKBOOKS_US_STAGE_WRITES_ENABLED:undefined}});assert.equal((await f.POST(request('rules',{method:'POST',body:commands.stage}))).status,503);assert.equal(f.calls.length,0);});
test('server supplies verified actor, not browser role',async()=>{const f=fixture();assert.equal((await f.POST(request('rules',{method:'POST',body:commands.stage}))).status,200);assert.equal(f.calls[0].args.p_actor,ID);assert.equal(f.calls[0].args.p_action,'stage_rules');});
for(const action of ['commit_migration','approve_migration','grant_access','post_journal','cutover'])test('unsafe action rejected '+action,()=>{assert.throws(()=>validateWorkbenchCommand('migration',{action,payload:{}}));});
test('cross-workspace action rejected',()=>{assert.throws(()=>validateWorkbenchCommand('rules',commands.snapshot));});
test('client supplied actor rejected',()=>{assert.throws(()=>validateWorkbenchCommand('rules',{action:'stage_rules',payload:{actor:ID}}));});
test('client supplied company rejected',()=>{assert.throws(()=>validateWorkbenchCommand('migration',{...commands.snapshot,payload:{...commands.snapshot.payload,business_id:'egypt'}}));});
test('invalid calendar date rejected',()=>{assert.throws(()=>validateWorkbenchCommand('migration',{...commands.snapshot,payload:{...commands.snapshot.payload,cutoff:'2026-02-30'}}));});
test('negative revision rejected',()=>{assert.throws(()=>validateWorkbenchCommand('rules',{action:'save_rule',payload:{id:null,revision:-1,definition:{}}}));});
test('decision requires actual boolean and reason',()=>{assert.throws(()=>validateWorkbenchCommand('rules',{action:'decide_proposal',payload:{id:RID,accept:'true',reason:'approved'}}));});
test('complete manifest shape required',()=>{assert.throws(()=>validateWorkbenchCommand('migration',{action:'save_plan',payload:{runId:RID,revision:1,plans:[],expectedBalances:[],openingSubledger:[],evidence:'test'}}));});
test('invalid JSON blocked',async()=>{const f=fixture();assert.equal((await f.POST(request('rules',{method:'POST',body:'{'}))).status,400);assert.equal(f.calls.length,0);});
test('actual streamed body is capped without content-length',async()=>{const f=fixture();assert.equal((await f.POST(request('rules',{method:'POST',body:'x'.repeat(1048577)}))).status,413);assert.equal(f.calls.length,0);});
test('declared oversized body rejected',async()=>{const f=fixture();assert.equal((await f.POST(request('rules',{method:'POST',headers:{'content-length':'1048577'},body:commands.stage}))).status,413);});
test('raw SQL exception text not returned',async()=>{const f=fixture({fail:'service secret and SQL user email'});const r=await f.GET(request());assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/secret|email/);});
test('known business error returns only code',async()=>{const f=fixture({fail:'CB_SOURCE_CHANGED_RESTAGE sensitive source'});const r=await f.GET(request());assert.equal(r.status,409);const x=await r.json();assert.equal(x.code,'CB_SOURCE_CHANGED_RESTAGE');assert.doesNotMatch(JSON.stringify(x),/sensitive/);});
test('wrong-scope RPC data withheld',async()=>{const f=fixture({response:{scope:'EGYPT',area:'rules'}});assert.equal((await f.GET(request())).status,503);});
test('other methods rejected',async()=>{const f=fixture();const r=await f.GET(new Request('https://hub.test/api',{method:'DELETE'}));assert.equal(r.status,405);assert.equal(f.calls.length,0);});
const cronSecret='correct-test-secret-at-least-32-bytes';
function job({enabled='true',secret=cronSecret,result={data:{created:0}}}={}){let calls=0;return {handler:createRulesJob(async()=>{calls++;return result;},{CLICKBOOKS_US_RULES_AUTO_STAGE_ENABLED:enabled,CRON_SECRET:secret}),calls:()=>calls};}
function cron(token=cronSecret){return new Request('https://hub.test/api/accounting/clickbooks-us/rules-job',{headers:{Authorization:'Bearer '+token}});}
test('scheduler disabled by default',async()=>{const j=job({enabled:'false'});assert.equal((await j.handler(cron())).status,503);assert.equal(j.calls(),0);});
test('scheduler rejects weak secret',async()=>{const j=job({secret:'short'});assert.equal((await j.handler(cron('short'))).status,503);assert.equal(j.calls(),0);});
test('scheduler rejects wrong token',async()=>{const j=job();assert.equal((await j.handler(cron('x'.repeat(cronSecret.length)))).status,401);assert.equal(j.calls(),0);});
test('scheduler authorized request invokes staging, not posting',async()=>{const j=job();assert.equal((await j.handler(cron())).status,200);assert.equal(j.calls(),1);});
test('scheduler error sanitized',async()=>{const j=job({result:{error:{message:'secret'}}});const r=await j.handler(cron());assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/secret/);});
