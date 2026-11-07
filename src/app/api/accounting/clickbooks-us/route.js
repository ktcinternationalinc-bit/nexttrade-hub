import { createClient } from '@supabase/supabase-js';
import { authorizeBankVisibility } from '../../../../lib/bank-visibility.js';
import { createClickbooksReadHandler } from '../../../../lib/clickbooks-us-read.js';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const GET = createClickbooksReadHandler(function (request) {
  return authorizeBankVisibility(request, createClient, process.env);
}, process.env);
