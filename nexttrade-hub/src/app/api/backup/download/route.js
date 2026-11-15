// /api/backup/download — v55.74
// Returns one backup's full data as a JSON file download.
// The frontend typically wraps this in a window.open() so the
// browser handles the file save.

import { createClient } from '@supabase/supabase-js';

export var maxDuration = 60;

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET(req) {
  try {
    var url = new URL(req.url);
    var id = url.searchParams.get('id');
    if (!id) {
      return new Response(JSON.stringify({ ok: false, error: 'missing id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    var res = await supabase.from('backups').select('*').eq('id', id).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    if (!res.data) {
      return new Response(JSON.stringify({ ok: false, error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    var fileName = 'ktc-backup-' + (res.data.kind || 'snapshot') + '-' + (res.data.created_at || 'unknown').slice(0, 10) + '-' + id.slice(0, 8) + '.json';
    var body = JSON.stringify({
      version: 'v55.74',
      backup_id: res.data.id,
      created_at: res.data.created_at,
      kind: res.data.kind,
      triggered_by: res.data.triggered_by,
      triggered_by_name: res.data.triggered_by_name,
      tables_included: res.data.tables_included,
      row_counts: res.data.row_counts,
      size_bytes: res.data.size_bytes,
      duration_ms: res.data.duration_ms,
      notes: res.data.notes,
      data: res.data.data,
    }, null, 2);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="' + fileName + '"',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e && e.message) || 'unknown' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
