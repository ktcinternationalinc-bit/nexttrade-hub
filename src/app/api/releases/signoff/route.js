// v55.83-YJ — Change Schedule: record Max's go, a roll-back request, or taking one back (Max, 24 Nov).
// Only release managers can approve changes. The row is append-only
// (sql/v55-83-YJ-release-signoffs.sql refuses UPDATE / DELETE / TRUNCATE). This route moves NOTHING:
// the row is only Max's go for the exact build Codex passed; the gated deploy / rollback step reads it.
// The stored sentence is made by the server, never taken from the browser. SWC-safe (var + concat).
import { NextResponse } from 'next/server';
import { releaseDb } from '../../../../lib/release-db'; // v55.83-YW — no-store reads
import { verifiedCaller } from '../../../../lib/verified-caller';
import { SIGNOFF_TABLE, SIGNOFF_COLUMNS, requireReleaseManager, findItem, checkSignoff, tableMissing } from '../../../../lib/release-signoff';
import { matchesReview, reviewState } from '../../../../lib/release-review';
import bundledRegister from '../../../../../release-management/release-register.json';
import selection from '../../../../../release-management/lib/selection';
import checkpoint from '../../../../../release-management/lib/warehouse-checkpoint';
import { readReleasePause, pauseSentence } from '../../../../lib/release-pause'; // v55.83-YQ — the stop switch

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// v55.83-YW — GET database reads in this route are never kept in Next's Data Cache (it froze Change Schedule at 24 Nov 12:08 UTC)
export const revalidate = 0;
export const fetchCache = 'force-no-store';

var API_BUILD_MARKER = 'warehouse-release-controls-v1';
function admin() { return releaseDb(); }
function deny(msg, status) { return NextResponse.json({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, { status: status || 403 }); }

export async function POST(request) {
  var body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  if (!body || typeof body !== 'object') { body = {}; }

  // 1) who is calling: from the verified sign-in only
  var db = admin();
  var who = await verifiedCaller(request, {}, admin);
  if (who.error) { return deny(who.error, who.status || 401); }
  var sa = await requireReleaseManager(db, who.userId);
  if (!sa.ok) { return deny(sa.error, sa.status); }

  var ids = Array.isArray(body.item_ids) ? body.item_ids : [body.item_id];
  if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length || ids.some(function (id) { return typeof id !== 'string' || !findItem(bundledRegister, id); })) { return deny('Select valid, different warehouse changes.', 400); }
  var action = String(body.action || '');
  if (action !== 'go' && action !== 'rollback' && action !== 'withdraw') { return deny('Unknown release action.', 400); }
  // v55.83-YQ (Max, 24 Nov) — the stop switch: no new move or roll back is recorded while it is on. Taking a request back is still allowed.
  if (action !== 'withdraw') { var pz = await readReleasePause(db); if (pz.paused) { return deny(pauseSentence(pz) + ' Nothing was recorded.', 409); } }
  if (Array.isArray(body.item_ids) && body.confirm !== (action === 'go' ? 'DEPLOY' : action === 'rollback' ? 'ROLLBACK' : 'WITHDRAW')) { return deny('Confirm the selected action first.', 400); }
  var sr = await db.from(SIGNOFF_TABLE).select(SIGNOFF_COLUMNS).eq('scope', 'warehouse').order('id', { ascending: true }).limit(5000);
  if (sr.error) {
    if (tableMissing(sr.error)) { return deny('The sign-off table is not installed yet (v55.83-YJ SQL). Nothing was recorded.', 409); }
    return deny('The sign-offs could not be read right now. Nothing was recorded.', 500);
  }
  if ((sr.data || []).length === 5000) { return deny('Full history is required before another release.', 409); }
  var { latest, states, heads } = reviewState(bundledRegister, sr.data || []);
  var versionRestore = null;
  if (body.version_checkpoint != null) {
    versionRestore = checkpoint.warehouseCheckpoint(sr.data || [], bundledRegister.items).versions.find(function (version) { return version.id === body.version_checkpoint; })?.restore;
    if (action !== 'rollback' || ids.length !== 1 || !versionRestore || ids[0] !== versionRestore.itemId ||
        body.version_move !== versionRestore.moveId ||
        Object.values(states).some(function (state) { return state.kind === 'go' || state.kind === 'rollback'; })) {
      return deny('The verified version or production state changed. Refresh and review the restore again.', 409);
    }
  }
  // The screen must name the state it reviewed. Replayed/stale confirmations cannot approve a newer candidate.
  if (!body.heads || ids.some(function (id) { return Number(body.heads[id]) !== heads[id] || body.heads[id] === undefined; })) { return deny('This change has moved since your screen loaded. Refresh and review again.', 409); }
  if (action === 'go' && !matchesReview(body.review_receipt, who.userId, ids, bundledRegister, heads)) {
    return deny('Run the deployment review again before approving this selection.', 409);
  }
  var ordered = ids.map(function (id) { return findItem(bundledRegister, id); });
  if (action !== 'withdraw') {
    var plan = selection.selectionPlan(bundledRegister.items, states, ids, action);
    if (!plan.ok) { return deny(plan.problems.join(' '), 409); }
    ordered = plan.items;
  }
  if (action === 'go' && ordered.some(function (it) { return it.dataChange; }) && !sa.isSuperAdmin) {
    return deny('Only a super admin can approve a Warehouse database change.', 403);
  }
  if (action === 'go' && ordered.some(selection.isSchemaRelease)) {
    var schemaWorker = await db.from('release_worker_status').select('enabled,last_seen,version').eq('id', 1).maybeSingle();
    if (schemaWorker.error || !schemaWorker.data?.enabled || schemaWorker.data.version !== selection.SCHEMA_WORKER_VERSION ||
        !(Date.now() - Date.parse(schemaWorker.data.last_seen) < 120000)) {
      return deny('Wait for the Warehouse migration worker to come online before approving this change.', 409);
    }
  }
  var rows = [];
  for (var i = 0; i < ordered.length; i++) {
    var item = ordered[i];
    if (action === 'go' && (!body.builds || body.builds[item.id] !== item.manifest.sha)) { return deny('The candidate build changed. Refresh and review again.', 409); }
    if (action === 'go' && (!body.digests || body.digests[item.id] !== selection.digest(item.manifest))) { return deny('The reviewed file list or production baseline changed. Refresh and review again.', 409); }
    var verdict = checkSignoff(item, action, Array.isArray(body.item_ids) ? item.title : body.confirm, latest[item.id]);
    if (!verdict.ok) { return deny(verdict.error, verdict.status || 400); }
    var row = verdict.row;
    row.signed_by = who.userId; row.signed_by_name = sa.name || null;
    row.detail.execution = 'warehouse-worker-v1';
    row.detail.source = 'Hub change management';
    row.detail.candidate = action === 'go' ? item : null;
    if (versionRestore) row.detail.versionCheckpoint = body.version_checkpoint;
    rows.push(row);
  }
  var ins = await db.rpc('release_enqueue', { p_rows: rows, p_heads: heads });
  if (ins.error || !ins.data || ins.data.length !== rows.length) { return deny((ins.error && ins.error.code === 'P0001') ? ins.error.message : 'The release request could not be saved. Refresh before retrying.', 409); }
  return NextResponse.json({ ok: true, api_build_marker: API_BUILD_MARKER, requests: ins.data.map(function (r) { return { id: r.id, item_id: r.item_id, action: r.action }; }), moved: false,
    note: action === 'withdraw' ? 'Pending request withdrawn.' : 'Queued for the warehouse worker. The history will show when execution starts and finishes.' });
}
