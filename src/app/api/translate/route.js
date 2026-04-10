import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(request) {
  try {
    const body = await request.json();
    const { texts, table, column, action } = body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });

    // ACTION: batch_translate — translate array of texts and update DB
    if (action === 'batch_translate') {
      if (!texts || !Array.isArray(texts) || texts.length === 0) {
        return Response.json({ error: 'No texts provided' }, { status: 400 });
      }

      // 1. Check cache for already-translated texts
      const uniqueTexts = [...new Set(texts.map(t => t.text).filter(Boolean))];
      const cached = {};
      
      // Fetch cached translations in batches of 50
      for (let i = 0; i < uniqueTexts.length; i += 50) {
        const batch = uniqueTexts.slice(i, i + 50);
        const { data: cacheHits } = await supabase
          .from('translation_cache')
          .select('source_text, translated_text')
          .in('source_text', batch);
        (cacheHits || []).forEach(h => { cached[h.source_text] = h.translated_text; });
      }

      // 2. Find texts that need translation
      const needTranslation = uniqueTexts.filter(t => !cached[t] && /[\u0600-\u06FF]/.test(t));
      
      // 3. Batch translate with Anthropic (chunks of 30 for reliability)
      const newTranslations = {};
      for (let i = 0; i < needTranslation.length; i += 30) {
        const chunk = needTranslation.slice(i, i + 30);
        const numbered = chunk.map((t, idx) => `${idx + 1}. ${t}`).join('\n');
        
        try {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 4000,
              system: `You are a professional Arabic-to-English translator for a business context (trading company in Egypt dealing with textiles, leather, chemicals, shipping).

RULES:
- Translate each numbered line from Arabic to English
- For person names: use common English spellings (e.g. محمد = Mohamed, أحمد = Ahmed, عبد الناصر = Abdel Nasser, مصطفى = Mostafa)
- For business terms: use standard business English
- For descriptions of expenses/transactions: keep it concise and clear
- Return ONLY the translations, one per line, numbered to match input
- If text is already English or just numbers, return it as-is
- Format: "1. English translation\\n2. English translation\\n..."`,
              messages: [{ role: 'user', content: `Translate these ${chunk.length} items:\n\n${numbered}` }],
            }),
          });

          if (response.ok) {
            const data = await response.json();
            const result = data.content?.[0]?.text || '';
            
            // Parse numbered results
            const lines = result.split('\n').filter(l => l.trim());
            lines.forEach(line => {
              const match = line.match(/^(\d+)\.\s*(.+)$/);
              if (match) {
                const idx = parseInt(match[1]) - 1;
                if (idx >= 0 && idx < chunk.length) {
                  newTranslations[chunk[idx]] = match[2].trim();
                }
              }
            });
          }
        } catch (err) {
          console.error('Translation API error:', err);
        }
      }

      // 4. Save new translations to cache
      const cacheInserts = Object.entries(newTranslations).map(([source, translated]) => ({
        source_text: source,
        translated_text: translated,
        source_lang: 'ar',
        target_lang: 'en',
      }));
      
      if (cacheInserts.length > 0) {
        // Insert in batches, ignore conflicts
        for (let i = 0; i < cacheInserts.length; i += 50) {
          await supabase.from('translation_cache').upsert(
            cacheInserts.slice(i, i + 50),
            { onConflict: 'source_text,source_lang,target_lang', ignoreDuplicates: true }
          );
        }
      }

      // 5. Merge cached + new translations
      const allTranslations = { ...cached, ...newTranslations };

      // 6. If table and column specified, update database records
      if (table && column) {
        const enColumn = column + '_en';
        let updated = 0;
        for (const item of texts) {
          const translation = allTranslations[item.text];
          if (translation && item.id) {
            try {
              await supabase.from(table).update({ [enColumn]: translation }).eq('id', item.id);
              updated++;
            } catch (e) { /* skip individual errors */ }
          }
        }
        return Response.json({
          success: true,
          total: texts.length,
          cached: Object.keys(cached).length,
          translated: Object.keys(newTranslations).length,
          updated,
          translations: allTranslations,
        });
      }

      return Response.json({
        success: true,
        total: uniqueTexts.length,
        cached: Object.keys(cached).length,
        translated: Object.keys(newTranslations).length,
        translations: allTranslations,
      });
    }

    // ACTION: get_stats — return translation progress stats
    if (action === 'get_stats') {
      const stats = {};
      const tables = [
        { table: 'treasury', arCol: 'description', enCol: 'description_en' },
        { table: 'warehouse_expenses', arCol: 'description', enCol: 'description_en' },
        { table: 'invoices', arCol: 'customer_name', enCol: 'customer_name_en' },
        { table: 'checks', arCol: 'customer_name', enCol: 'customer_name_en' },
        { table: 'debts', arCol: 'customer_name', enCol: 'customer_name_en' },
        { table: 'invoice_items', arCol: 'description', enCol: 'description_en' },
        { table: 'customers', arCol: 'name', enCol: 'name_en' },
      ];

      for (const t of tables) {
        try {
          const { count: total } = await supabase.from(t.table).select('id', { count: 'exact', head: true });
          const { count: translated } = await supabase.from(t.table).select('id', { count: 'exact', head: true }).neq(t.enCol, '').not(t.enCol, 'is', null);
          stats[t.table] = { total: total || 0, translated: translated || 0, arCol: t.arCol, enCol: t.enCol };
        } catch (e) {
          stats[t.table] = { total: 0, translated: 0, error: e.message, arCol: t.arCol, enCol: t.enCol };
        }
      }

      const { count: cacheCount } = await supabase.from('translation_cache').select('id', { count: 'exact', head: true });
      stats._cache = { total: cacheCount || 0 };

      return Response.json({ stats });
    }

    // ACTION: fetch_untranslated — get records that need translation
    if (action === 'fetch_untranslated') {
      if (!table) return Response.json({ error: 'table required' }, { status: 400 });
      
      const arCol = body.arCol || 'description';
      const enCol = body.enCol || 'description_en';
      const limit = body.limit || 100;

      const { data, error } = await supabase
        .from(table)
        .select(`id, ${arCol}`)
        .or(`${enCol}.is.null,${enCol}.eq.`)
        .not(arCol, 'is', null)
        .neq(arCol, '')
        .limit(limit);

      if (error) return Response.json({ error: error.message }, { status: 500 });

      return Response.json({
        records: (data || []).map(r => ({ id: r.id, text: r[arCol] })),
        count: (data || []).length,
      });
    }

    return Response.json({ error: 'Unknown action. Use: batch_translate, get_stats, fetch_untranslated' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
