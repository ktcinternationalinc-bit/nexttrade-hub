import { createNoStoreClient as createClient } from '../../../../lib/no-store-db'; // v55.83-YY — every read fresh (no Data Cache)
import { readLedgerlyConfig, verifyCronRequest, runLedgerlySync, safeSyncError, LedgerlySyncError } from '../../../../lib/ledgerly-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0; // v55.83-YY — already fresh; force-no-store + the no-store client added so every GET-only route follows one rule
export const fetchCache = 'force-no-store';
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
