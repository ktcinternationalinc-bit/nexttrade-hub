// v55.83-YJ — Change Schedule: record Max's go, a roll-back request, or taking one back (Max, 24 Nov).
// SUPER ADMIN ONLY (releases.access can read the schedule, never sign). The row is append-only
// (sql/v55-83-YJ-release-signoffs.sql refuses UPDATE / DELETE / TRUNCATE). This route moves NOTHING:
// the row is only Max's go for the exact build Codex passed; the gated deploy / rollback step reads it.
// The stored sentence is made by the server, never taken from the browser. SWC-safe (var + concat).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { SIGNOFF_TABLE, SIGNOFF_COLUMNS, superAdminOnly, findItem, latestByItem, checkSignoff, tableMissing } from '../../../../lib/release-signoff';
import bundledRegister from '../../../../../release-management/release-register.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

var API_BUILD_MARKER = 'v55.83-YJ-release-signoff';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function deny(msg, status) { return NextResponse.json({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, { status: status || 403 }); }

export async function POST(request) {
  var body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  if (!body || typeof body !== 'object') { body = {}; }

  // 1) who is calling: from the verified sign-in only
  var db = admin();
  var who = await verifiedCaller(request, {}, admin);
  if (who.error) { return deny(who.error, who.status || 401); }
  var sa = await superAdminOnly(db, who.userId);
  if (!sa.ok) { return deny(sa.error, sa.status); }

  // 2) the change must be on the schedule that shipped with this build
  var item = findItem(bundledRegister, body.item_id);
  if (!item) { return deny('That change is not on the Change Schedule.', 404); }

  // 3) its latest state, read fresh
  var sr = await db.from(SIGNOFF_TABLE).select(SIGNOFF_COLUMNS).eq('scope', 'warehouse').eq('item_id', String(item.id)).order('id', { ascending: true }).limit(2000);
  if (sr.error) {
    if (tableMissing(sr.error)) { return deny('The sign-off table is not installed yet (v55.83-YJ SQL). Nothing was recorded.', 409); }
    return deny('The sign-offs could not be read right now. Nothing was recorded.', 500);
  }
  var latest = latestByItem(sr.data || [])[String(item.id)];

  // 4) the rules
  var verdict = checkSignoff(item, String(body.action || ''), body.confirm, latest);
  if (!verdict.ok) { return deny(verdict.error, verdict.status || 400); }

  // 5) one new row; nothing else is touched
  var row = verdict.row;
  row.signed_by = who.userId;
  row.signed_by_name = sa.name || null;
  var ins = await db.from(SIGNOFF_TABLE).insert(row).select('id, created_at');
  if (ins.error || !ins.data || !ins.data[0]) { return deny('The sign-off could not be saved. Nothing was recorded.', 500); }

  return NextResponse.json({
    ok: true,
    api_build_marker: API_BUILD_MARKER,
    id: ins.data[0].id,
    action: row.action,
    item_id: row.item_id,
    sha: row.sha || '',
    backup: (row.detail && row.detail.backup) || '',
    undoes_row: row.ref_id == null ? null : row.ref_id,
    recorded: row.approval_text || '',
    moved: false,
    note: row.action === 'withdraw' ? 'Taken back. Nothing was moved.' : 'Recorded. Nothing has moved yet: the move itself is done from the KTC office PC, backups first.'
  });
}
