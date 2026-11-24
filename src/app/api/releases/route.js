// v55.83-XH — Change Schedule / Release register (release-governance session, 22 Nov 2026).
// READ-ONLY and AUTHENTICATED. Serves the hand-editable release register that the Change
// Schedule tab shows: what is live on production, what is queued on fix staging, and what each
// change still needs (Codex pass / Max's go / data-change flag).
//
// Codex pre-build point 3: protect the API itself, not just the tab. This route verifies the
// caller's sign-in (verifiedCaller) and requires super-admin OR the 'releases.access' switch
// (assertPermission) — it FAILS CLOSED. It takes NO caller input (no path, no query), reads a
// FIXED file path (no traversal), performs no writes, and returns only the schedule fields —
// no credentials. The register is release-management/release-register.json (hand-editable, or
// appended to by the deploy/rollback tooling). The static import guarantees the file ships with
// the Hub build (Vercel), which is a deployment SNAPSHOT; the fs read is a local-dev freshness
// path only. The screen labels it a maintained plan as-of a time, not a live deployment status.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { verifiedCaller } from '../../../lib/verified-caller';
import { assertPermission } from '../../../lib/server-permissions';
import bundledRegister from '../../../../release-management/release-register.json';
// v55.83-YJ — the latest sign-off / roll-back request per change (read only here; writes are /api/releases/signoff)
import { SIGNOFF_TABLE, SIGNOFF_COLUMNS, latestByItem, itemSignState, tableMissing, historyList } from '../../../lib/release-signoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

var API_BUILD_MARKER = 'v55.83-XH-releases';
var REGISTER_PATH = 'release-management/release-register.json';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function deny(msg, status) { return NextResponse.json({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, { status: status || 403 }); }

export async function GET(request) {
  // 1) Verify the sign-in. No body on a GET.
  var db = admin();
  var who = await verifiedCaller(request, {}, admin);
  if (who.error) { return deny(who.error, who.status || 401); }
  // 2) Require super-admin OR releases.access. Fails closed.
  var perm = await assertPermission(db, who.userId, 'releases.access', request);
  if (!perm.ok) { return deny(perm.error || 'You do not have access to the Change Schedule.', perm.status || 403); }

  // 3) Read the fixed register path (no caller input).
  var register = bundledRegister;
  var source = 'bundled';
  try {
    var abs = path.join(process.cwd(), REGISTER_PATH);
    if (fs.existsSync(abs)) {
      var raw = fs.readFileSync(abs, 'utf8');
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') { register = parsed; source = 'file'; }
    }
  } catch (e) {
    register = bundledRegister;
    source = 'bundled-fallback';
  }

  var items = (register && Array.isArray(register.items)) ? register.items : [];
  var queued = items.filter(function (it) { return it && it.status !== 'live'; });
  var live = items.filter(function (it) { return it && it.status === 'live'; });

  // v55.83-YJ — sign-off state per item. Only the super admin gets buttons; a missing table = no buttons, said plainly.
  var canSign = !!(perm.ctx && perm.ctx.isSuperAdmin === true);
  var signoffsInstalled = true; var signoffsError = ''; var signRows = [];
  try {
    var sr = await db.from(SIGNOFF_TABLE).select(SIGNOFF_COLUMNS).eq('scope', 'warehouse').order('id', { ascending: true }).limit(5000);
    if (sr.error) { if (tableMissing(sr.error)) { signoffsInstalled = false; } else { signoffsError = 'The sign-offs could not be read right now.'; } }
    else { signRows = sr.data || []; }
  } catch (eS) { signoffsError = 'The sign-offs could not be read right now.'; }
  var latest = latestByItem(signRows);
  var signoffs = {};
  var readable = signoffsInstalled && !signoffsError;
  items.forEach(function (it) {
    if (!it || !it.id) { return; }
    var stt = itemSignState(it, latest[String(it.id)]);
    if (!canSign || !readable) { stt.canGo = false; stt.canRollback = false; stt.canWithdraw = false; }
    if (!readable) { stt.kind = 'unknown'; }
    signoffs[String(it.id)] = stt;
  });

  return NextResponse.json({
    ok: true,
    canSign: canSign,
    signoffsInstalled: signoffsInstalled,
    signoffsError: signoffsError,
    signoffs: signoffs,
    // v55.83-YJ — the full change history, newest first: every approval, request, move, check and roll back
    // (from the table, current at all times) plus the Codex / staging-test evidence from the register.
    history: readable ? historyList(signRows, register) : [],
    historyComplete: readable && signRows.length < 5000,
    api_build_marker: API_BUILD_MARKER,
    source: source,
    snapshot: true,
    asOf: register.updated || '',
    statusNote: 'This is the maintained release PLAN as of the date shown — not a live deployment feed. A change is only "on production" once it was deployed and verified by hand.',
    updated: register.updated || '',
    updatedBy: register.updatedBy || '',
    intro: register.intro || '',
    legend: register.legend || [],
    items: items,
    queuedCount: queued.length,
    liveCount: live.length,
    protocol: register.protocol || [],
    protocolNote: register.protocolNote || '',
    deployAutomation: register.deployAutomation || null
  });
}
