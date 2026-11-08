import { createClient } from '@supabase/supabase-js';
import { createShadowJob } from '../../../../../lib/clickbooks-us-shadow-job.js';
import { applyExpenseRules } from '../../../../../lib/expense-rules-server';
import { syncWindows, isDailyCatchUpTick } from '../../../../../lib/clickbooks-sync-windows';
export const dynamic = 'force-dynamic';
// v55.83-QZ2 — a tick may run the drift check + several 31-day windows.
export const maxDuration = 60;
// v55.83-PD — the scheduler now runs BOTH syncs each tick: the engine's shadow
// sync (invoices, payments, rule-matched bank items) AND the classified bridge
// (bank transactions the team already reviewed+classified in Bank Review).
// Max (Nov 6): "the things that have already been matched in the old system
// need to be pushed into the new system." The bridge function is additive in
// the DB; until sql/v55-83-PD-classified-bridge.sql is run, its call fails
// soft and the shadow result still returns.
//
// v55.83-QZ2 (review of Nov 8 — Max 12:00: "look for any logical gaps"):
//  • WINDOW: the tick used to cover yesterday→today only, so anything
//    categorized or matched later than the day after its date never reached
//    the ledger. Now: the last 31 days every tick, and the whole open period
//    (since the opening cutoff / locked date) once a day, in 31-day slices.
//    Until the QX SQL is run (no clickbooks_us_sync_cutoff), it falls back to
//    the old one-day window.
//  • DRIFT: changes made in the hub AFTER posting (category changed, matched,
//    duplicate, payment voided, invoice deleted/edited) are reversed and
//    re-posted by clickbooks_us_drift_sync_job, run first so this tick's
//    postings see the corrected state. Fails soft.
export const GET = createShadowJob(async (from, to, actor) => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let windows = [[from, to]];
  try {
    const cf = await db.rpc('clickbooks_us_sync_cutoff');
    if (!cf.error && cf.data) {
      const w = syncWindows(String(cf.data).slice(0, 10), to, isDailyCatchUpTick(new Date()));
      if (w) { windows = w; }
    }
  } catch (e0) { windows = [[from, to]]; }
  // v55.83-RB — every hub bank account (CSV-only M&T/PNC, Plaid reconnects)
  // gets its ledger bank account first, so nothing waits on a mapping. Fails soft.
  let bankMap = null;
  try {
    const bm = await db.rpc('clickbooks_us_bank_map_job', { p_actor: actor });
    bankMap = bm.error ? { error: String(bm.error.message || 'bank mapping failed') } : bm.data;
  } catch (eB) { bankMap = { error: (eB && eB.message) || 'bank mapping failed' }; }
  let drift = null;
  try {
    const dr = await db.rpc('clickbooks_us_drift_sync_job', { p_actor: actor });
    drift = dr.error ? { error: String(dr.error.message || 'drift check failed') } : dr.data;
  } catch (e1) { drift = { error: (e1 && e1.message) || 'drift check failed' }; }
  if (!windows.length) {
    // every date up to today is before the opening cutoff or locked — nothing to post
    return { data: { shadow: null, classified: null, drift: drift, bank_map: bankMap, windows: windows, catch_up: [], hub_rules: null } };
  }
  const main = windows[0];
  const shadow = await db.rpc('clickbooks_us_shadow_sync_job', { p_from: main[0], p_to: main[1], p_actor: actor });
  if (shadow.error) { return shadow; }
  let classified = null;
  try {
    const c = await db.rpc('clickbooks_us_classified_sync_job', { p_from: main[0], p_to: main[1], p_actor: actor });
    classified = c.error ? { error: String(c.error.message || 'classified sync failed') } : c.data;
  } catch (e) { classified = { error: (e && e.message) || 'classified sync failed' }; }
  // v55.83-RB — split / partly-placed money + bills NextTrade paid for us. Fails soft.
  let extras = null;
  try {
    const x = await db.rpc('clickbooks_us_ledger_extras_job', { p_from: main[0], p_to: main[1], p_actor: actor });
    extras = x.error ? { error: String(x.error.message || 'ledger extras failed') } : x.data;
  } catch (eX) { extras = { error: (eX && eX.message) || 'ledger extras failed' }; }
  // daily catch-up slices (older open dates) — never fatal for the tick
  const catchUp = [];
  for (let i = 1; i < windows.length; i++) {
    const w = windows[i]; const row = { from: w[0], to: w[1] };
    try {
      const s2 = await db.rpc('clickbooks_us_shadow_sync_job', { p_from: w[0], p_to: w[1], p_actor: actor });
      row.shadow = s2.error ? { error: String(s2.error.message || 'shadow sync failed') } : s2.data;
      const c2 = await db.rpc('clickbooks_us_classified_sync_job', { p_from: w[0], p_to: w[1], p_actor: actor });
      row.classified = c2.error ? { error: String(c2.error.message || 'classified sync failed') } : c2.data;
      const x2 = await db.rpc('clickbooks_us_ledger_extras_job', { p_from: w[0], p_to: w[1], p_actor: actor });
      row.extras = x2.error ? { error: String(x2.error.message || 'ledger extras failed') } : x2.data;
    } catch (e3) { row.error = (e3 && e3.message) || 'catch-up failed'; }
    catchUp.push(row);
  }
  // v55.83-PI — hub expense rules run on the same tick (Max: "automatically
  // remember previous selections... and use them"). Blanks only; fails soft
  // until sql/v55-83-PI-expense-categories-rules.sql is run.
  let hubRules = null;
  try { hubRules = await applyExpenseRules(db, 500); } catch (e2) { hubRules = { error: (e2 && e2.message) || 'hub rules failed' }; }
  return { data: { shadow: shadow.data, classified: classified, extras: extras, drift: drift, bank_map: bankMap, windows: windows, catch_up: catchUp, hub_rules: hubRules } };
}, process.env);
