import { createClient } from '@supabase/supabase-js';
import { createRulesJob } from '../../../../../lib/clickbooks-us-rules-job.js';
export const dynamic='force-dynamic';
export const GET=createRulesJob(async()=>{
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 return db.rpc('clickbooks_us_rules_stage_job');
},process.env);
