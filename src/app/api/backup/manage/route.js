// /api/backup/manage — v55.74
// DELETE ?id=X            — delete a backup (super_admin only — enforced at frontend)
// POST   { id, pinned }   — toggle pin (pinned backups are excluded from retention)

import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function DELETE(req) {
  try {
    var url = new URL(req.url);
    var id = url.searchParams.get('id');
    if (!id) {
      return new Response(JSON.stringify({ ok: false, error: 'missing id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    var res = await supabase.from('backups').delete().eq('id', id);
    if (res.error) throw new Error(res.error.message);
    return new Response(JSON.stringify({ ok: true, id: id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e && e.message) || 'unknown' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function POST(req) {
  try {
    var body = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    if (!body.id) {
      return new Response(JSON.stringify({ ok: false, error: 'missing id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    var update = {};
    if (typeof body.pinned === 'boolean') update.pinned = body.pinned;
    if (typeof body.notes === 'string') update.notes = body.notes;
    if (Object.keys(update).length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'nothing to update' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    var res = await supabase.from('backups').update(update).eq('id', body.id).select('id, pinned, notes').maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return new Response(JSON.stringify({ ok: true, backup: res.data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e && e.message) || 'unknown' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
