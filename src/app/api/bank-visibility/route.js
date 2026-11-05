import { createClient } from '@supabase/supabase-js';
import { createBankVisibilityHandlers } from '../../../lib/bank-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
var handlers = createBankVisibilityHandlers(createClient, process.env);
export async function GET(request) { return handlers.GET(request); }
export async function PUT(request) { return handlers.PUT(request); }
