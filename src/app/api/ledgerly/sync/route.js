import { createClient } from '@supabase/supabase-js';
import { readLedgerlyConfig, verifyCronRequest, runLedgerlySync, safeSyncError, LedgerlySyncError } from '../../../../lib/ledgerly-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;
var headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };

// Vercel calls this endpoint while the hub is closed. Browser pages never invoke
// it and never receive the scheduler or Ledgerly credentials.
export async function GET(request) {
  try {
    verifyCronRequest(request, process.env);
    var config = readLedgerlyConfig(process.env);
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new LedgerlySyncError('storage', 503);
    var db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    var result = await runLedgerlySync(db, config);
    return Response.json(result, { status: result.skipped ? 202 : 200, headers: headers });
  } catch (error) {
    var safe = safeSyncError(error);
    return Response.json({ ok: false, code: safe.code, error: safe.message }, { status: safe.status, headers: headers });
  }
}
