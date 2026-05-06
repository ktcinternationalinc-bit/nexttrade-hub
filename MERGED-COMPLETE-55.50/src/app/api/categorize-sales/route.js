// ============================================================
// /api/categorize-sales
//
// Three jobs:
//   1. POST { action: 'learn' } — scan all categorized invoices and
//      populate/refresh category_memory with customer + keyword signals.
//   2. POST { action: 'predict', invoice_id }  — suggest a (category,
//      subcategory) for one invoice based on category_memory.
//   3. POST { action: 'backfill' } — walk all invoices with NULL/empty
//      category and apply predictions above a confidence threshold.
//      This is how "update all the same past and present" works.
//
// GET — quick stats (how many memories, how many uncategorized rows).
// ============================================================

import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
// Split description into lowercased keyword tokens of 3+ chars.
// Arabic + English + numeric. Skips stopwords + very short noise.
var STOP = {
  'the':1,'and':1,'for':1,'from':1,'with':1,'this':1,'that':1,'are':1,'was':1,
  'has':1,'will':1,'have':1,'into':1,'per':1,'via':1,'inc':1,'llc':1,'ltd':1,
  'egp':1,'usd':1,'eur':1,'aed':1,
};
function tokensOf(text) {
  if (!text) return [];
  // Keep Arabic letters (U+0600..U+06FF) + ASCII alphanumerics
  var normalized = String(text).toLowerCase()
    .replace(/[^\u0600-\u06ffa-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  var parts = normalized.split(' ');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var w = parts[i];
    if (w.length < 3) continue;
    if (STOP[w]) continue;
    if (out.indexOf(w) !== -1) continue;
    out.push(w);
    if (out.length >= 6) break; // cap tokens per row — avoids fat tail of noise
  }
  return out;
}

// Upsert a single memory row — hit_count increments on conflict
async function bumpMemory(signalType, signalValue, category, subcategory, source) {
  try {
    var existing = await supabase
      .from('category_memory')
      .select('id, hit_count')
      .eq('signal_type', signalType)
      .eq('signal_value', signalValue)
      .eq('category', category)
      .eq('subcategory', subcategory || '')
      .maybeSingle();
    if (existing && existing.data && existing.data.id) {
      await supabase.from('category_memory')
        .update({ hit_count: (existing.data.hit_count || 0) + 1, last_seen_at: new Date().toISOString() })
        .eq('id', existing.data.id);
    } else {
      await supabase.from('category_memory').insert({
        signal_type: signalType,
        signal_value: signalValue,
        category: category,
        subcategory: subcategory || null,
        hit_count: 1,
        confidence: 0.5,
        source: source || 'observed',
      });
    }
  } catch (e) { /* swallow — one missed row is fine */ }
}

// ------------------------------------------------------------
// 1) Learn — scan categorized invoices, populate memory
// ------------------------------------------------------------
async function runLearn() {
  var summary = { invoices_scanned: 0, signals_written: 0, errors: [] };
  var lastId = null;
  var BATCH = 500;

  while (true) {
    var q = supabase.from('invoices')
      .select('id, customer_id, description, category, subcategory, total_amount')
      .not('category', 'is', null)
      .neq('category', '')
      .order('id', { ascending: true })
      .limit(BATCH);
    if (lastId) q = q.gt('id', lastId);
    var res = await q;
    if (res.error) { summary.errors.push(res.error.message); break; }
    var rows = res.data || [];
    if (rows.length === 0) break;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      summary.invoices_scanned++;
      if (!r.category) continue;

      // Signal 1: customer → category
      if (r.customer_id) {
        await bumpMemory('customer', r.customer_id, r.category, r.subcategory, 'observed');
        summary.signals_written++;
      }
      // Signal 2: keywords from description → category
      var toks = tokensOf(r.description);
      for (var j = 0; j < toks.length; j++) {
        await bumpMemory('keyword', toks[j], r.category, r.subcategory, 'observed');
        summary.signals_written++;
      }
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  return summary;
}

// ------------------------------------------------------------
// 2) Predict — for one invoice, recommend (category, subcategory)
// ------------------------------------------------------------
function scorePrediction(scores, category, subcategory, weight) {
  var key = category + '||' + (subcategory || '');
  scores[key] = (scores[key] || { category: category, subcategory: subcategory, score: 0 });
  scores[key].score += weight;
}

async function runPredict(invoiceId, providedRow) {
  var inv = providedRow;
  if (!inv) {
    var invRes = await supabase.from('invoices')
      .select('id, customer_id, description, total_amount, category, subcategory')
      .eq('id', invoiceId).maybeSingle();
    if (invRes.error || !invRes.data) return { ok: false, reason: 'invoice_not_found' };
    inv = invRes.data;
  }

  var scores = {};

  // Customer signal — weighted 3x (strongest predictor)
  if (inv.customer_id) {
    var cm = await supabase.from('category_memory')
      .select('category, subcategory, hit_count')
      .eq('signal_type', 'customer').eq('signal_value', inv.customer_id);
    if (cm && cm.data) {
      cm.data.forEach(function(m) {
        scorePrediction(scores, m.category, m.subcategory, (m.hit_count || 1) * 3);
      });
    }
  }

  // Keyword signals — weighted 1x each
  var toks = tokensOf(inv.description);
  if (toks.length > 0) {
    var km = await supabase.from('category_memory')
      .select('signal_value, category, subcategory, hit_count')
      .eq('signal_type', 'keyword').in('signal_value', toks);
    if (km && km.data) {
      km.data.forEach(function(m) {
        scorePrediction(scores, m.category, m.subcategory, (m.hit_count || 1) * 1);
      });
    }
  }

  // Best
  var best = null;
  Object.keys(scores).forEach(function(k) {
    if (!best || scores[k].score > best.score) best = scores[k];
  });
  if (!best) return { ok: true, prediction: null, reason: 'no_signals' };

  // Confidence: best.score / sum(all scores)
  var total = 0;
  Object.keys(scores).forEach(function(k) { total += scores[k].score; });
  var confidence = total > 0 ? best.score / total : 0;

  return {
    ok: true,
    prediction: {
      category: best.category,
      subcategory: best.subcategory || null,
      confidence: confidence,
      competing_count: Object.keys(scores).length,
    },
    invoice_id: inv.id,
  };
}

// ------------------------------------------------------------
// 3) Backfill — apply predictions to uncategorized invoices
// ------------------------------------------------------------
async function runBackfill(minConfidence, dryRun) {
  var conf = (typeof minConfidence === 'number' && minConfidence >= 0 && minConfidence <= 1) ? minConfidence : 0.6;
  var dry = !!dryRun;
  var summary = { scanned: 0, updated: 0, skipped_low_confidence: 0, no_prediction: 0, dry_run: dry };

  var lastId = null;
  var BATCH = 200;
  while (true) {
    var q = supabase.from('invoices')
      .select('id, customer_id, description, total_amount, category, subcategory')
      .or('category.is.null,category.eq.')
      .order('id', { ascending: true })
      .limit(BATCH);
    if (lastId) q = q.gt('id', lastId);
    var res = await q;
    if (res.error) { summary.error = res.error.message; break; }
    var rows = res.data || [];
    if (rows.length === 0) break;

    for (var i = 0; i < rows.length; i++) {
      var inv = rows[i];
      summary.scanned++;
      var p = await runPredict(null, inv);
      if (!p.ok || !p.prediction) { summary.no_prediction++; continue; }
      if (p.prediction.confidence < conf) { summary.skipped_low_confidence++; continue; }
      if (!dry) {
        var up = await supabase.from('invoices').update({
          category: p.prediction.category,
          subcategory: p.prediction.subcategory,
        }).eq('id', inv.id);
        if (!up.error) summary.updated++;
      } else {
        summary.updated++;
      }
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  return summary;
}

// ------------------------------------------------------------
// Handlers
// ------------------------------------------------------------
export async function GET(req) {
  try {
    var cm = await supabase.from('category_memory').select('id', { count: 'exact', head: true });
    var unc = await supabase.from('invoices').select('id', { count: 'exact', head: true }).or('category.is.null,category.eq.');
    return new Response(JSON.stringify({
      ok: true,
      memory_count: cm.count || 0,
      uncategorized_invoice_count: unc.count || 0,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
  }
}

export async function POST(req) {
  try {
    var body = await req.json().catch(function() { return {}; });
    var action = body && body.action;
    if (action === 'learn') {
      var s = await runLearn();
      return new Response(JSON.stringify({ ok: true, action: 'learn', summary: s }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (action === 'predict') {
      if (!body.invoice_id) return new Response(JSON.stringify({ ok: false, error: 'missing invoice_id' }), { status: 400 });
      var p = await runPredict(body.invoice_id, null);
      return new Response(JSON.stringify(p), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (action === 'backfill') {
      var bf = await runBackfill(body.min_confidence, body.dry_run);
      return new Response(JSON.stringify({ ok: true, action: 'backfill', summary: bf }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: false, error: 'unknown action (use learn | predict | backfill)' }), { status: 400 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
  }
}
