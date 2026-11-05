import { createClient } from '@supabase/supabase-js';
import { createLedgerlyDataHandler } from '../../../../lib/ledgerly-data-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
var readData = createLedgerlyDataHandler(createClient, process.env);
export async function GET(request) { return readData(request); }
