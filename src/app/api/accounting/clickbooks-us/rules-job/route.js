import { createNoStoreClient as createClient } from '../../../../../lib/no-store-db'; // v55.83-YY — every read fresh (no Data Cache)
import { createRulesJob } from '../../../../../lib/clickbooks-us-rules-job.js';
export const dynamic='force-dynamic';
// v55.83-YY — this GET-only route never keeps its reads in Next's Data Cache (it would otherwise keep them forever, across deployments)
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const GET=createRulesJob(async()=>{
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 return db.rpc('clickbooks_us_rules_stage_job');
},process.env);
