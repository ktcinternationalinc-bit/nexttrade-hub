import test from 'node:test';
import assert from 'node:assert/strict';
import { createClickbooksReadHandler, projectClickbooksRead } from '../../src/lib/clickbooks-us-read.js';
const fixture = () => ({book:{code:'KTC_US',currency:'USD',postingEnabled:false,historyReady:false}, accounts:[{id:'1',name:'Sales',bankSensitive:false},{id:'2',name:'Hidden bank',bankSensitive:true}],trialBalanceAvailable:true,trialBalance:[{code:'BANK',netDebitCents:'10000'}],audit:{checked_at:'2026-11-02',source_digests:{secret:'dont-return'},counts:{usd_invoices:1366,bank_rows:360},checks:{missing_invoice_items:1,unreviewed_bank_rows:206}},access_token:'never-return'});
const req=(path='',method='GET')=>new Request('https://hub.example/api/accounting/clickbooks-us'+path,{method});
function mock(capabilities={},data=fixture(),error=null) {
  const calls=[];
  return { calls, authorize: async()=>({canViewFullDashboard:true,...capabilities,db:{rpc:async(...args)=>{calls.push(args);return {data,error};}}}) };
}
const enabled={CLICKBOOKS_US_ENABLED:'true'};
test('disabled feature does not read database', async()=>{const m=mock(); const r=await createClickbooksReadHandler(m.authorize,{})(req()); assert.equal(r.status,503); assert.equal(m.calls.length,0);});
test('posting is not an HTTP capability', async()=>{const m=mock();assert.equal((await createClickbooksReadHandler(m.authorize,enabled)(req('','POST'))).status,405);assert.equal(m.calls.length,0);});
for (const q of ['?businessId=egypt','?bank=true','?resource=treasury']) test('reject browser scope '+q,async()=>{const m=mock();assert.equal((await createClickbooksReadHandler(m.authorize,enabled)(req(q))).status,400);assert.equal(m.calls.length,0);});
test('unverified identity denied',async()=>{const r=await createClickbooksReadHandler(async()=>{throw Object.assign(new Error('token secret'),{status:401});},enabled)(req());assert.equal(r.status,401);assert.doesNotMatch(await r.text(),/token secret/);});
test('bank-only permission cannot grant full dashboard',async()=>{const m=mock({canViewFullDashboard:false,canViewBankBalances:true});assert.equal((await createClickbooksReadHandler(m.authorize,enabled)(req())).status,403);assert.equal(m.calls.length,0);});
test('dashboard without banking receives redacted snapshot',async()=>{const m=mock({canViewBankBalances:false});const r=await createClickbooksReadHandler(m.authorize,enabled)(req());const j=await r.json();assert.equal(r.status,200);assert.deepEqual(m.calls,[['clickbooks_us_read',{p_with_bank:false}]]);assert.equal(j.data.accounts.length,1);assert.equal(j.data.trialBalance,null);assert.equal(j.data.audit.counts.bank_rows,undefined);assert.equal(j.data.audit.checks.unreviewed_bank_rows,undefined);assert.doesNotMatch(JSON.stringify(j),/access_token|source_digests|Hidden bank/);});
test('verified super admin gets both permissions',async()=>{const m=mock({canViewFullDashboard:false,isVerifiedSuperAdmin:true});const j=await (await createClickbooksReadHandler(m.authorize,enabled)(req())).json();assert.equal(j.data.accounts.length,2);assert.equal(j.data.bankingIncluded,true);assert.equal(m.calls[0][1].p_with_bank,true);});
test('independent bank grant retained',async()=>{const m=mock({canViewBankBalances:true});const j=await (await createClickbooksReadHandler(m.authorize,enabled)(req())).json();assert.equal(j.data.trialBalance.length,1);});
test('unknown sensitivity fails closed',()=>{const d=fixture();d.accounts.push({name:'unknown'});assert.equal(projectClickbooksRead(d,false).accounts.length,1);});
test('wrong book cannot be returned',async()=>{const d=fixture();d.book.code='EGYPT';const m=mock({},d);assert.equal((await createClickbooksReadHandler(m.authorize,enabled)(req())).status,500);});
test('wrong currency cannot be returned',()=>{const d=fixture();d.book.currency='EGP';assert.throws(()=>projectClickbooksRead(d,true));});
test('database errors leak no details',async()=>{const m=mock({},null,{message:'service-secret'});const r=await createClickbooksReadHandler(m.authorize,enabled)(req());assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/service-secret/);});
test('all responses prohibit caching',async()=>{const m=mock();for(const env of [enabled,{}]) {const r=await createClickbooksReadHandler(m.authorize,env)(req());assert.match(r.headers.get('cache-control'),/no-store/);assert.match(r.headers.get('vary'),/Authorization/);}});
