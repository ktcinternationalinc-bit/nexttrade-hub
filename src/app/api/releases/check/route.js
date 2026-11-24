import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { requireReleaseManager, latestByItem, SIGNOFF_COLUMNS } from '../../../../lib/release-signoff';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function deny(error, status) { return NextResponse.json({ ok: false, error }, { status }); }
export async function POST(request) {
  const who = await verifiedCaller(request, {}, admin);
  if (who.error) return deny(who.error, who.status || 401);
  const db = admin(); const permission = await requireReleaseManager(db, who.userId);
  if (!permission.ok) return deny(permission.error, permission.status);
  let body; try { body = await request.json(); } catch { return deny('Invalid request.', 400); }
  if (typeof body?.item_id !== 'string' || typeof body.note !== 'string' || body.note.trim().length < 10 || body.note.length > 2000) return deny('Record what you tested on production (10-2000 characters).', 400);
  const history = await db.from('release_signoffs').select(SIGNOFF_COLUMNS).eq('scope', 'warehouse').eq('item_id', body.item_id).order('id', { ascending: true }).limit(5000);
  if (history.error || history.data.length >= 5000) return deny('Could not read complete history.', 409);
  const state = latestByItem(history.data)[body.item_id];
  if (!state || state.where !== 'deployed' || state.kind !== 'none' || state.block || !state.dep) return deny('Only a completed deployment awaiting verification can be checked.', 409);
  const result = await db.rpc('release_check', { p_move: state.dep.id, p_head: body.head, p_note: body.note.trim(), p_actor: who.userId, p_name: permission.name || null });
  if (result.error) return deny('The check was not saved. Refresh the release history and review again.', 409);
  return NextResponse.json({ ok: true, note: 'Production verification recorded with your name and test notes.' });
}
