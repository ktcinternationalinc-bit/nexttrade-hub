import { createClient } from '@supabase/supabase-js';
import { authorizeBankVisibility } from '../../../../../lib/bank-visibility.js';
import { createCutoverHandlers } from '../../../../../lib/clickbooks-us-cutover.js';
export const dynamic='force-dynamic';export const revalidate=0;
const h=createCutoverHandlers(request=>authorizeBankVisibility(request,createClient,process.env),process.env);export const GET=h.GET;export const POST=h.POST;
