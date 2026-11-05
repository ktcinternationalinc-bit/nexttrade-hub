import { createClient } from '@supabase/supabase-js';
import { createShadowJob } from '../../../../../lib/clickbooks-us-shadow-job.js';
export const dynamic='force-dynamic';
export const GET=createShadowJob(async(from,to,actor)=>{const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});return db.rpc('clickbooks_us_shadow_sync_job',{p_from:from,p_to:to,p_actor:actor});},process.env);
