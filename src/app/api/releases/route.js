// v55.83-XH — Change Schedule / Release register (release-governance session, 22 Nov 2026).
// READ-ONLY and AUTHENTICATED. Serves the hand-editable release register that the Change
// Schedule tab shows: what is live on production, what is queued on fix staging, and what each
// change still needs (Codex pass / Max's go / data-change flag).
//
// This route verifies the caller's team sign-in and reads the current execution state.
// It takes no caller input, reads a
// FIXED file path (no traversal), performs no writes, and returns only the schedule fields —
// no credentials. The register is release-management/release-register.json (hand-editable, or
// appended to by the deploy/rollback tooling). The static import guarantees the file ships with
// the Hub build (Vercel), which is a deployment SNAPSHOT; the fs read is a local-dev freshness
// path only. The screen labels it a maintained plan as-of a time, not a live deployment status.
import { NextResponse } from 'next/server';
import { releaseDb } from '../../../lib/release-db'; // v55.83-YW — no-store reads
import fs from 'fs';
import path from 'path';
import { verifiedCaller } from '../../../lib/verified-caller';
import { loadUserPermissions, userHasPermission } from '../../../lib/server-permissions';
import bundledRegister from '../../../../release-management/release-register.json';
import selection from '../../../../release-management/lib/selection';
import checkpoint from '../../../../release-management/lib/warehouse-checkpoint';
// v55.83-YJ — the latest sign-off / roll-back request per change (read only here; writes are /api/releases/signoff)
import { SIGNOFF_TABLE, SIGNOFF_COLUMNS, latestByItem, itemSignState, tableMissing, historyList } from '../../../lib/release-signoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// v55.83-YW — GET database reads in this route are never kept in Next's Data Cache (it froze Change Schedule at 24 Nov 12:08 UTC)
export const revalidate = 0;
export const fetchCache = 'force-no-store';

var API_BUILD_MARKER = 'warehouse-release-controls-v1';
var REGISTER_PATH = 'release-management/release-register.json';
var LIVE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Authorization' };
function admin() { return releaseDb(); }
function deny(msg, status) { return NextResponse.json({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, { status: status || 403, headers: LIVE_HEADERS }); }

export async function GET(request) {
  // 1) Verify the sign-in. No body on a GET.
  var db = admin();
  var who = await verifiedCaller(request, {}, admin);
  if (who.error) { return deny(who.error, who.status || 401); }
  // 2) Verify the team profile and its permissions.
  var ctx = await loadUserPermissions(db, who.userId);
  if (!ctx || !ctx.role || ctx.readError) { return deny('Your team access could not be verified.', 403); }

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

  // A missing execution table disables release actions until setup is complete.
  var canSign = userHasPermission(ctx, 'releases.manage');
  var worker = null; var executions = []; var executionReady = false;
  try {
    var wr = await db.from('release_worker_status').select('enabled, last_seen').eq('id', 1).maybeSingle();
    var er = await db.from('release_execution').select('request_id, phase, started_at, finished_at').in('phase', ['running', 'attention']);
    executionReady = !wr.error && !er.error;
    worker = wr.data || null; executions = er.data || [];
  } catch (eW) { executionReady = false; }
  var workerOnline = !!(worker && worker.enabled && Date.now() - Date.parse(worker.last_seen) < 120000);
  var signoffsInstalled = true; var signoffsError = ''; var signRows = [];
  try {
    var sr = await db.from(SIGNOFF_TABLE).select(SIGNOFF_COLUMNS).eq('scope', 'warehouse').order('id', { ascending: true }).limit(5000);
    if (sr.error) { if (tableMissing(sr.error)) { signoffsInstalled = false; } else { signoffsError = 'The sign-offs could not be read right now.'; } }
    else { signRows = sr.data || []; if (signRows.length === 5000) { signoffsError = 'History limit reached; release actions are blocked until the full history is loaded.'; } }
  } catch (eS) { signoffsError = 'The sign-offs could not be read right now.'; }
  var latest = latestByItem(signRows);
  var signoffs = {};
  var readable = signoffsInstalled && !signoffsError;
  items.forEach(function (it) {
    if (!it || !it.id) { return; }
    var stt = itemSignState(it, latest[String(it.id)]);
    stt.manifestDigest = it.manifest ? selection.digest(it.manifest) : '';
    stt.head = signRows.filter(function (r) { return r.item_id === it.id; }).reduce(function (n, r) { return Math.max(n, Number(r.id)); }, 0);
    stt.requestId = (stt.kind === 'go' || stt.kind === 'rollback') ? latest[String(it.id)]?.id || null : null;
    stt.execution = executions.find(function (e) { return signRows.some(function (r) { return r.id === e.request_id && r.item_id === it.id; }); }) || null;
    stt.executing = !!stt.execution;
    stt.canCheck = canSign && readable && executionReady && !stt.executing && stt.where === 'deployed' && stt.kind === 'none';
    if (stt.executing) { stt.canGo = false; stt.canRollback = false; stt.canWithdraw = false; stt.why = 'Execution is running or needs recovery. No new request can replace it.'; }
    if (canSign && stt.canGo && it.dataChange && !ctx.isSuperAdmin) {
      stt.canGo = false;
      stt.why = 'Ask a super admin to approve this database change.';
    }
    if (!executionReady) { stt.canGo = false; stt.canRollback = false; stt.canWithdraw = false; }
    if (!canSign || !readable) { stt.canGo = false; stt.canRollback = false; stt.canWithdraw = false; }
    if (!readable) { stt.kind = 'unknown'; }
    signoffs[String(it.id)] = stt;
  });

  var version = readable ? checkpoint.warehouseCheckpoint(signRows, items) : null;
  if (version) {
    var releaseBusy = Object.values(signoffs).some(function (state) { return state.executing || state.kind === 'go' || state.kind === 'rollback'; });
    version.versions = version.versions.map(function (entry) {
      if (!entry.restore || (executionReady && !releaseBusy && signoffs[entry.restore.itemId]?.canRollback)) return entry;
      var why = canSign ? (releaseBusy ? 'Finish or withdraw outstanding release requests first.' : 'The next code restore is unavailable.') : '';
      return { ...entry, restore: null, reason: why };
    });
  }

  return NextResponse.json({
    ok: true,
    canSign: canSign,
    worker: worker,
    workerOnline: workerOnline,
    executionReady: executionReady,
    executions: executions,
    signoffsInstalled: signoffsInstalled,
    signoffsError: signoffsError,
    signoffs: signoffs,
    // v55.83-YJ — the full change history, newest first: every approval, request, move, check and roll back
    // (from the table, current at all times) plus the Codex / staging-test evidence from the register.
    history: readable ? historyList(signRows, register) : [],
    historyComplete: readable && signRows.length < 5000,
    warehouseVersion: version,
    api_build_marker: API_BUILD_MARKER,
    source: source,
    snapshot: true,
    asOf: register.updated || '',
    statusNote: 'Candidate details are a reviewed release plan. Execution status and history are read from the live release queue. A queued request is not a completed deployment.',
    updated: register.updated || '',
    updatedBy: register.updatedBy || '',
    intro: register.intro || '',
    legend: register.legend || [],
    items: items,
    queuedCount: queued.length,
    liveCount: live.length,
    protocol: register.protocol || [],
    protocolNote: register.protocolNote || '',
    deployAutomation: { status: workerOnline ? 'online' : 'offline' }
  }, { headers: LIVE_HEADERS });
}
