import { createClient } from '@supabase/supabase-js';
import { authorizeBankVisibility } from '../../../../../lib/bank-visibility.js';
import { createReportsHandlers } from '../../../../../lib/clickbooks-us-reports.js';
export const dynamic='force-dynamic';export const revalidate=0;
const h=createReportsHandlers(request=>authorizeBankVisibility(request,createClient,process.env),process.env);
export const GET=h.GET;export const POST=h.POST;
