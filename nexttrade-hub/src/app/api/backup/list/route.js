// /api/backup/list — v55.74
// Returns metadata for all backups (NOT the data column — that would
// be huge). Use /api/backup/download?id=X to fetch one specific
// backup's full data.

import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET() {
  try {
    // Explicitly DO NOT select `data` — that's the huge JSONB column.
    // We fetch metadata only for the list view.
    var res = await supabase
      .from('backups')
      .select('id, created_at, kind, triggered_by, triggered_by_name, tables_included, row_counts, size_bytes, duration_ms, notes, pinned')
      .order('created_at', { ascending: false })
      .limit(200);
    if (res.error) throw new Error(res.error.message);
    return new Response(JSON.stringify({ ok: true, backups: res.data || [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e && e.message) || 'unknown' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
