import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST /api/categorize — Apply all category rules to uncategorized treasury entries
// Can be called manually or via cron
export async function POST() {
  try {
    // Fetch all rules
    const { data: rules } = await supabase.from('expense_rules').select('*');
    if (!rules || rules.length === 0) return Response.json({ applied: 0, message: 'No rules found' });

    // Fetch uncategorized treasury entries
    const { data: uncategorized } = await supabase.from('treasury').select('id, description, cash_in, cash_out, category')
      .or('category.is.null,category.eq.');
    
    if (!uncategorized || uncategorized.length === 0) return Response.json({ applied: 0, message: 'No uncategorized entries' });

    let applied = 0;
    for (const txn of uncategorized) {
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
    }

    return Response.json({ applied, total_uncategorized: uncategorized.length, total_rules: rules.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
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
