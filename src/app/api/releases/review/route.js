import { NextResponse } from 'next/server';
import { releaseDb } from '../../../../lib/release-db'; // v55.83-YW — no-store reads
import { verifiedCaller } from '../../../../lib/verified-caller';
import { SIGNOFF_COLUMNS, SIGNOFF_TABLE, findItem, requireReleaseManager } from '../../../../lib/release-signoff';
import { issueReview, reviewState } from '../../../../lib/release-review';
import register from '../../../../../release-management/release-register.json';
import selection from '../../../../../release-management/lib/selection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// v55.83-YW — GET database reads in this route are never kept in Next's Data Cache (it froze Change Schedule at 24 Nov 12:08 UTC)
export const revalidate = 0;
export const fetchCache = 'force-no-store';

function admin() { return releaseDb(); }
function reply(body, status = 200) { return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } }); }

export async function POST(request) {
  const who = await verifiedCaller(request, {}, admin);
  if (who.error) return reply({ error: who.error }, who.status || 401);
  const db = admin();
  const access = await requireReleaseManager(db, who.userId);
  if (!access.ok) return reply({ error: access.error }, access.status);
  let body;
  try { body = await request.json(); } catch { return reply({ error: 'Invalid review request.' }, 400); }
  const ids = body?.item_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length ||
      ids.some(id => typeof id !== 'string' || !findItem(register, id))) {
    return reply({ error: 'Select between 1 and 20 different Warehouse changes.' }, 400);
  }
  const { data, error } = await db.from(SIGNOFF_TABLE).select(SIGNOFF_COLUMNS).eq('scope', 'warehouse')
    .order('id', { ascending: true }).limit(5000);
  if (error || !data || data.length >= 5000) return reply({ error: 'Complete release history is required. Try the review again.' }, 503);
  const { heads, states } = reviewState(register, data);
  const items = ids.map(id => findItem(register, id));
  if (!access.isSuperAdmin && items.some(item => item.dataChange)) {
    return reply({ error: 'A super admin must review and approve Warehouse database changes.' }, 403);
  }
  let waitsForWorker = false;
  const dataItems = items.filter(selection.supportedDataPlan);
  if (dataItems.length) {
    const worker = await db.from('release_worker_status').select('enabled,last_seen,version').eq('id', 1).maybeSingle();
    waitsForWorker = !!worker.error || !worker.data?.enabled || dataItems.some(item => !selection.workerSupports(item, worker.data.version)) ||
      !(Date.now() - Date.parse(worker.data.last_seen) < 120000);
  }
  const results = items.map(item => {
    const id = item.id;
    return { id, title: item.title, sha: item.manifest?.sha || item.proposedBuild || '', passed: states[id].canGo,
      files: item.manifest?.files?.map(file => file.path) || [], note: states[id].why,
      evidence: item.manifest ? item.behavioralQa?.summary || '' : '', steps: item.releaseSteps || [],
      dataChange: item.dataChange === true, writeFreeze: selection.isSchemaRelease(item),
      migrations: item.manifest?.dataPlan?.migrations?.map(file => file.name) || [] };
  });
  const plan = selection.selectionPlan(register.items, states, ids, 'go');
  if (!plan.ok) return reply({ ok: true, passed: false, results, problems: [...new Set(plan.problems)] });
  if (waitsForWorker && dataItems.some(selection.isSchemaRelease)) {
    return reply({ ok: true, passed: false, results, problems: ['Wait for the Warehouse migration worker to come online before approving this change.'] });
  }
  const receipt = issueReview(who.userId, ids, register, heads);
  if (!receipt) return reply({ error: 'The review could not be signed.' }, 503);
  return reply({ ok: true, passed: true, results, receipt, waitsForWorker,
    heads: Object.fromEntries(ids.map(id => [id, heads[id]])),
    builds: Object.fromEntries(plan.items.map(item => [item.id, item.manifest.sha])),
    digests: Object.fromEntries(plan.items.map(item => [item.id, selection.digest(item.manifest)])) });
}
