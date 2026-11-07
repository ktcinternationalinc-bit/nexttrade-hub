import { createClient } from '@supabase/supabase-js';
import { sanitizeErr } from '../../../lib/sanitize-error';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST /api/categorize — Apply all category rules to uncategorized treasury entries
// Can be called manually or via cron.
//
// v55.80 BD-AUDIT FIX:
//   Bound the work per run. If there are 50,000 uncategorized entries
//   (e.g. after a big import), one cron run shouldn't try to process them
//   all in memory — that times out and OOMs. Cap at 1000/run and let the
//   nightly cron chip away.
const MAX_PER_RUN = 1000;

export async function POST() {
  try {
    // Fetch all rules
    const { data: rules } = await supabase.from('expense_rules').select('*');
    if (!rules || rules.length === 0) return Response.json({ applied: 0, message: 'No rules found' });

    // Fetch uncategorized treasury entries (capped to MAX_PER_RUN)
    const { data: uncategorized } = await supabase.from('treasury').select('id, description, cash_in, cash_out, category')
      .or('category.is.null,category.eq.')
      .limit(MAX_PER_RUN);

    if (!uncategorized || uncategorized.length === 0) return Response.json({ applied: 0, message: 'No uncategorized entries' });

    let applied = 0;
    let errored = 0;
    for (const txn of uncategorized) {
      try {
        const desc = txn.description || '';
        const isIncome = Number(txn.cash_in || 0) > 0;
        const ruleType = isIncome ? 'income' : 'expense';

        // Find matching rule
        const rule = rules.find(r =>
          desc.includes(r.description_match) &&
          (r.rule_type === ruleType || (!r.rule_type && ruleType === 'expense'))
        );

        if (rule) {
          await supabase.from('treasury').update({
            category: rule.category,
            subcategory: rule.subcategory || '',
          }).eq('id', txn.id);
          applied++;
        }
      } catch (rowErr) {
        // Per-row isolation — one bad row doesn't fail the whole batch
        console.warn('[categorize] row failed:', txn.id, rowErr && rowErr.message);
        errored++;
      }
    }

    return Response.json({
      applied,
      errored,
      total_in_batch: uncategorized.length,
      total_rules: rules.length,
      capped_at: MAX_PER_RUN,
      hint: uncategorized.length === MAX_PER_RUN ? 'More uncategorized entries exist — re-run.' : undefined,
    });
  } catch (err) {
    console.error('[categorize] error:', err);
    return Response.json({ error: sanitizeErr(err) }, { status: 500 });
  }
}

// GET /api/categorize — Check status
export async function GET() {
  try {
    const { count: ruleCount } = await supabase.from('expense_rules').select('*', { count: 'exact', head: true });
    const { count: uncatCount } = await supabase.from('treasury').select('*', { count: 'exact', head: true }).or('category.is.null,category.eq.');
    const { count: totalCount } = await supabase.from('treasury').select('*', { count: 'exact', head: true });
    return Response.json({ rules: ruleCount || 0, uncategorized: uncatCount || 0, total: totalCount || 0 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
