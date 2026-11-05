import { createClient } from '@supabase/supabase-js';
import { authorizeBankVisibility } from '../../../../../lib/bank-visibility.js';
import { createOperatorGrantHandlers } from '../../../../../lib/clickbooks-us-operator-grants.js';
export const runtime='nodejs';export const dynamic='force-dynamic';export const revalidate=0;
const h=createOperatorGrantHandlers(request=>authorizeBankVisibility(request,createClient,process.env),process.env);
export const GET=h.GET;export const PUT=h.PUT;
