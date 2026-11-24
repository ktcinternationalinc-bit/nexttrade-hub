import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { SIGNOFF_COLUMNS, SIGNOFF_TABLE, findItem, requireReleaseManager } from '../../../../lib/release-signoff';
import { issueReview, reviewState } from '../../../../lib/release-review';
import register from '../../../../../release-management/release-register.json';
import selection from '../../../../../release-management/lib/selection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
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
  const results = ids.map(id => {
    const item = findItem(register, id);
    return { id, title: item.title, sha: item.manifest?.sha || item.proposedBuild || '', passed: states[id].canGo,
      files: item.manifest?.files?.map(file => file.path) || [], note: states[id].why,
      evidence: item.manifest ? item.behavioralQa?.summary || '' : '', steps: item.releaseSteps || [] };
  });
  const plan = selection.selectionPlan(register.items, states, ids, 'go');
  if (!plan.ok) return reply({ ok: true, passed: false, results, problems: [...new Set(plan.problems)] });
  const receipt = issueReview(who.userId, ids, register, heads);
  if (!receipt) return reply({ error: 'The review could not be signed.' }, 503);
  return reply({ ok: true, passed: true, results, receipt,
    heads: Object.fromEntries(ids.map(id => [id, heads[id]])),
    builds: Object.fromEntries(plan.items.map(item => [item.id, item.manifest.sha])),
    digests: Object.fromEntries(plan.items.map(item => [item.id, selection.digest(item.manifest)])) });
}
