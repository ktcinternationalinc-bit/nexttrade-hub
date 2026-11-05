import { timingSafeEqual } from 'node:crypto';
export function createRulesJob(run,env) {
 return async function GET(request) {
  const send=(body,status)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(request.method!=='GET'||new URL(request.url).search)return send({ok:false},400);
  if(env.CLICKBOOKS_US_RULES_AUTO_STAGE_ENABLED!=='true')return send({ok:false,error:'Rule scheduler disabled.'},503);
  const secret=env.CRON_SECRET||'',supplied=request.headers.get('authorization')||'';
  if(secret.length<32)return send({ok:false,error:'Scheduler secret needs configuration.'},503);
  const expected=Buffer.from('Bearer '+secret),actual=Buffer.from(supplied);
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return send({ok:false},401);
  try{const result=await run();if(result.error)return send({ok:false,error:'Rule staging failed.'},503);return send({ok:true,data:result.data},200);}catch{return send({ok:false,error:'Rule staging failed.'},503);}
 };
}
