import { createClient } from '@supabase/supabase-js';
import { createShadowJob } from '../../../../../lib/clickbooks-us-shadow-job.js';
import { applyExpenseRules } from '../../../../../lib/expense-rules-server';
export const dynamic = 'force-dynamic';
// v55.83-PD — the scheduler now runs BOTH syncs each tick: the engine's shadow
// sync (invoices, payments, rule-matched bank items) AND the classified bridge
// (bank transactions the team already reviewed+classified in Bank Review).
// Max (Nov 6): "the things that have already been matched in the old system
// need to be pushed into the new system." The bridge function is additive in
// the DB; until sql/v55-83-PD-classified-bridge.sql is run, its call fails
// soft and the shadow result still returns.
export const GET = createShadowJob(async (from, to, actor) => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const shadow = await db.rpc('clickbooks_us_shadow_sync_job', { p_from: from, p_to: to, p_actor: actor });
  if (shadow.error) { return shadow; }
  let classified = null;
  try {
    const c = await db.rpc('clickbooks_us_classified_sync_job', { p_from: from, p_to: to, p_actor: actor });
    classified = c.error ? { error: String(c.error.message || 'classified sync failed') } : c.data;
  } catch (e) { classified = { error: (e && e.message) || 'classified sync failed' }; }
  // v55.83-PI — hub expense rules run on the same tick (Max: "automatically
  // remember previous selections... and use them"). Blanks only; fails soft
  // until sql/v55-83-PI-expense-categories-rules.sql is run.
  let hubRules = null;
  try { hubRules = await applyExpenseRules(db, 500); } catch (e2) { hubRules = { error: (e2 && e2.message) || 'hub rules failed' }; }
  return { data: { shadow: shadow.data, classified: classified, hub_rules: hubRules } };
}, process.env);
