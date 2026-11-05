const REPORTS=new Set(['readiness','profit_loss','balance_sheet','trial_balance','general_ledger','tax_summary','cash_flow','bank_reconciliation','settings']);
const BANK_REQUIRED=new Set(['trial_balance','general_ledger','cash_flow','bank_reconciliation']);
const HEADERS={'Cache-Control':'private, no-store, max-age=0',Pragma:'no-cache',Vary:'Authorization, Origin','X-Content-Type-Options':'nosniff'};
function json(body,status=200){return Response.json(body,{status,headers:HEADERS});}
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
function date(x){return typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;}
async function body(request){if(Number(request.headers.get('content-length')||0)>32768)fail('Request too large.',413);let x;try{x=await request.json();}catch{fail('Valid JSON is required.');}if(!x||typeof x!=='object'||Array.isArray(x))fail('Valid JSON is required.');return x;}
export function createReportsHandlers(authorize,env){
 async function GET(request){
  try{
   if(env.CLICKBOOKS_US_ENABLED!=='true'||env.CLICKBOOKS_US_REPORTS_ENABLED!=='true')return json({ok:false,error:'ClickBooks reports are disabled.'},503);
   const url=new URL(request.url),report=url.searchParams.get('report')||'readiness',from=url.searchParams.get('from')||new Date(Date.now()-30*864e5).toISOString().slice(0,10),to=url.searchParams.get('to')||new Date().toISOString().slice(0,10);
   if([...url.searchParams.keys()].some(k=>!['report','from','to'].includes(k))||!REPORTS.has(report)||!date(from)||!date(to)||from>to)fail('Invalid report request.');
   const access=await authorize(request);if(!access?.authUserId)fail('Sign in again.',401);
   const superAdmin=access.isVerifiedSuperAdmin===true,dashboard=superAdmin||access.canViewFullDashboard===true,bank=superAdmin||access.canViewBankBalances===true;
   if(!dashboard)fail('Full dashboard permission is required.',403);
   if(BANK_REQUIRED.has(report)&&!bank)fail('Banking information access is required for this report.',403);
   let result;
   if(report==='settings'){
    if(!superAdmin)fail('Only a verified super admin can edit reporting classifications.',403);
    result=await access.db.rpc('clickbooks_us_reporting_settings_read');
   }else result=await access.db.rpc('clickbooks_us_report_read',{p_report:report,p_from:from,p_to:to,p_with_bank:bank});
   if(result.error)fail(/\bCB_[A-Z0-9_]+\b/.exec(result.error.message||'')?.[0]||'Report database request failed.',503);
   return json({ok:true,data:result.data,capabilities:{canViewBankBalances:bank,isVerifiedSuperAdmin:superAdmin}});
  }catch(e){return json({ok:false,error:e.status?e.message:'The report request failed safely.'},e.status||500);}
 }
 async function POST(request){
  try{
   if(env.CLICKBOOKS_US_ENABLED!=='true'||env.CLICKBOOKS_US_REPORTS_ENABLED!=='true'||env.CLICKBOOKS_US_REPORT_SETTINGS_WRITES_ENABLED!=='true')return json({ok:false,error:'Report setting writes are disabled.'},503);
   const u=new URL(request.url);if(u.search||request.headers.get('origin')!==u.origin||request.headers.get('sec-fetch-site')==='cross-site')fail('Cross-site or query writes are not allowed.',403);
   const access=await authorize(request);if(!access?.authUserId)fail('Sign in again.',401);if(access.isVerifiedSuperAdmin!==true)fail('Only a verified super admin can change tax/report mappings.',403);
   const x=await body(request);if(x.action!=='save_setting'||!x.payload||typeof x.payload!=='object'||Array.isArray(x.payload))fail('Invalid report setting request.');
   const p=x.payload,allowed=['accountId','cashFlowClass','taxCategory','taxFormLine','deductibility','notes'];if(Object.keys(p).some(k=>!allowed.includes(k))||allowed.some(k=>!Object.hasOwn(p,k)))fail('Missing or unexpected report setting fields.');
   if(!/^[0-9a-f-]{36}$/i.test(p.accountId||'')||!['operating','investing','financing','noncash','unclassified'].includes(p.cashFlowClass)||!['review','deductible','nondeductible','mixed'].includes(p.deductibility)||![p.taxCategory,p.taxFormLine,p.notes].every(v=>typeof v==='string'&&v.length<=2000))fail('Invalid report setting values.');
   const r=await access.db.rpc('clickbooks_us_reporting_setting_set',{p_account:p.accountId,p_cash_flow_class:p.cashFlowClass,p_tax_category:p.taxCategory,p_tax_form_line:p.taxFormLine,p_deductibility:p.deductibility,p_notes:p.notes,p_actor:access.authUserId});
   if(r.error)fail(/\bCB_[A-Z0-9_]+\b/.exec(r.error.message||'')?.[0]||'Report setting could not be saved.',409);return json({ok:true,data:r.data});
  }catch(e){return json({ok:false,error:e.status?e.message:'The report setting request failed safely.'},e.status||500);}
 }
 return{GET,POST};
}
