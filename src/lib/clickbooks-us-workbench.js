// Fixed-US workflow boundary. No journal posting, approval, permission grant or cutover operation.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Authorization, Origin', 'X-Content-Type-Options': 'nosniff' };
const SPECS = {
 snapshot: ['requestId','cutoff','strategy'], save_plan: ['runId','revision','plans','expectedBalances','openingSubledger','evidence'], validate_plan: ['runId'],
 save_rule: ['id','revision','definition'], preview_rule: ['definition'], stage_rules: [], decide_proposal: ['id','accept','reason'],
};
const MIGRATION = new Set(['snapshot','save_plan','validate_plan']);
function json(data,status=200) { return Response.json(data,{status,headers:HEADERS}); }
function deny(code,status=400) { const e=new Error(code); e.status=status; throw e; }
function object(x) { return x && typeof x==='object' && !Array.isArray(x); }
function validDate(x) { return typeof x==='string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10)===x; }
export function validateWorkbenchCommand(area,body) {
 if (!object(body) || Object.keys(body).some(k=>!['action','payload'].includes(k)) || typeof body.action!=='string' || !Object.hasOwn(SPECS,body.action) || !object(body.payload)) deny('Invalid workflow request.');
 const {action,payload:p}=body;
 if ((area==='migration')!==MIGRATION.has(action)) deny('Action is not available in this workspace.');
 const keys=SPECS[action];
 if (Object.keys(p).some(k=>!keys.includes(k)) || keys.some(k=>!Object.hasOwn(p,k))) deny('Unexpected or missing workflow fields.');
 for (const k of ['runId','requestId']) if (k in p && !UUID.test(p[k]||'')) deny('Use a valid workflow identifier.');
 if ('id' in p && !(action==='save_rule' && p.id===null) && !UUID.test(p.id||'')) deny('Use a valid workflow identifier.');
 if ('revision' in p && (!Number.isInteger(p.revision)||p.revision<0||p.revision>2147483646)) deny('Invalid revision.');
 if (action==='snapshot' && (!validDate(p.cutoff)||!['transaction_batch','opening_balance'].includes(p.strategy))) deny('Choose a valid cutoff and strategy.');
 if (['save_rule','preview_rule'].includes(action) && !object(p.definition)) deny('A rule definition is required.');
 if (action==='decide_proposal' && (typeof p.accept!=='boolean'||typeof p.reason!=='string'||p.reason.trim().length<3||p.reason.length>1000)) deny('A review decision and reason are required.');
 if (action==='save_plan' && (!Array.isArray(p.plans)||!p.plans.length||p.plans.length>200||!Array.isArray(p.expectedBalances)||!p.expectedBalances.length||p.expectedBalances.length>500||!Array.isArray(p.openingSubledger)||p.openingSubledger.length>10000||typeof p.evidence!=='string'||p.evidence.trim().length<10||p.evidence.length>2000)) deny('Provide the complete review manifest and external evidence reference.');
 return body;
}
async function readLimitedJson(request) {
 const max=1048576;
 if (Number(request.headers.get('content-length')||0)>max) deny('Request exceeds 1 MB.',413);
 const reader=request.body?.getReader(); if (!reader) deny('JSON body is required.');
 const chunks=[]; let size=0;
 try { for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>max){await reader.cancel();deny('Request exceeds 1 MB.',413);} chunks.push(value); } }
 finally { reader.releaseLock(); }
 const data=new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
 try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)); } catch { deny('Valid JSON is required.'); }
}
export function createWorkbenchHandlers(area,authorize,env) {
 if (!['rules','migration'].includes(area)) throw new Error('Unknown workspace');
 async function handler(request) {
  try {
   if (!['GET','POST'].includes(request.method)) return json({ok:false,error:'Method not allowed.'},405);
   if(env.CLICKBOOKS_US_ENABLED!=='true'||env.CLICKBOOKS_US_WORKBENCH_ENABLED!=='true') return json({ok:false,error:'ClickBooks workflow preview is disabled.'},503);
   const write=request.method==='POST',url=new URL(request.url),origin=request.headers.get('origin');
   if((origin&&origin!==url.origin)||(write&&!origin)||request.headers.get('sec-fetch-site')==='cross-site') deny('Cross-site requests are not allowed.',403);
   if(write&&!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||'')) deny('Use JSON.',415);
   if([...url.searchParams.keys()].some(k=>k!=='run'||area!=='migration'||write)||url.searchParams.getAll('run').length>1||(url.searchParams.has('run')&&!UUID.test(url.searchParams.get('run')))) deny('Invalid workflow query.');
   const access=await authorize(request);
   if(!access||!UUID.test(access.authUserId||'')) deny('Sign in again.',401);
   const isSuper=access.isVerifiedSuperAdmin===true;
   let grants={rules:false,migration:false};
   if(!isSuper){const g=await access.db.rpc('clickbooks_us_operator_capabilities',{p_actor:access.authUserId});if(g.error||!object(g.data))deny('Workflow permissions could not be verified.',503);grants=g.data;}
   if(area==='migration'&&!(isSuper||(grants.migration===true&&access.canViewFullDashboard===true&&access.canViewBankBalances===true)))deny('Migration access requires its explicit grant, dashboard access and banking access.',403);
   if(area==='rules'&&!(isSuper||grants.rules===true))deny('Accounting-rule management permission is required.',403);
   let result;
   if(!write) result=await access.db.rpc('clickbooks_us_workbench_read',{p_area:area,p_run:url.searchParams.get('run')||null});
   else {
    const command=validateWorkbenchCommand(area,await readLimitedJson(request));
    const isPreview=['preview_rule','validate_plan'].includes(command.action);
    if(!isPreview&&env.CLICKBOOKS_US_STAGE_WRITES_ENABLED!=='true')deny('Saving staging work is disabled on this deployment.',503);
    result=await access.db.rpc('clickbooks_us_workbench_action',{p_action:command.action,p_payload:command.payload,p_actor:access.authUserId});
   }
   if(result.error){const match=/\bCB_[A-Z0-9_]+\b/.exec(result.error.message||'');return json({ok:false,error:match?match[0]:'Workflow database request failed. Verify installed migrations.',code:match?.[0]||'WORKFLOW_UNAVAILABLE'},match?409:503);}
   if(!object(result.data)||(!write&&(result.data.scope!=='KTC_US'||result.data.area!==area)))deny('Unexpected workflow response.',503);
   return json({ok:true,data:result.data});
  }catch(e){return json({ok:false,error:[400,401,403,413,415,503].includes(e.status)?e.message:'The workflow request failed safely; no result is assumed.'},[400,401,403,413,415,503].includes(e.status)?e.status:500);}
 }
 return {GET:handler,POST:handler};
}
