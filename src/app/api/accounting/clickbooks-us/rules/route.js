import { createClient } from '@supabase/supabase-js';
import { authorizeBankVisibility } from '../../../../../lib/bank-visibility.js';
import { createWorkbenchHandlers } from '../../../../../lib/clickbooks-us-workbench.js';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const handlers = createWorkbenchHandlers('rules', request => authorizeBankVisibility(request, createClient, process.env), process.env);
export const GET = handlers.GET;
export const POST = handlers.POST;
