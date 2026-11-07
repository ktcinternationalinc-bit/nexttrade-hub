import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../lib/phone-auth';
import { checkRateLimit } from '../../../lib/rate-limit';
import { sanitizeErr } from '../../../lib/sanitize-error';

// ============================================================
// Brand Learning Engine — extract structured product knowledge
// from an uploaded file (PDF / image) or a website URL.
//
// Uses Claude's native multimodal understanding: PDFs and images
// are sent directly to the model, which reads them and returns
// structured product facts. No separate OCR/PDF library and no
// embeddings vendor needed at this scale.
//
// The extracted knowledge is saved to brand_knowledge with
// approved=false; the user reviews and approves it, and only
// approved rows feed the content generator.
// ============================================================

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

var EXTRACTION_SYSTEM = 'You are a product catalog analyst for an industrial materials and trading company '
  + '(PVC, automotive leather, textiles, flooring). You read product documents and web pages and extract '
  + 'a precise, factual understanding of the products and brand. Never invent specs, prices, or claims that '
  + 'are not present in the source. If something is not stated, leave it out. Be concrete and specific.';

function buildExtractionPrompt() {
  return 'Read the provided material and extract what this business sells. '
    + 'Return STRICT JSON only, no markdown, no preamble, this exact shape:\n'
    + '{\n'
    + '  "summary": "2-4 sentence plain-English summary of what this source tells us about the business/products",\n'
    + '  "products": [ { "name": "...", "category": "...", "features": ["..."], "benefits": ["..."], "materials": "...", "colors": "..." } ],\n'
    + '  "brand_voice": "short note on tone/positioning if discernible",\n'
    + '  "keywords": ["marketing/SEO keywords a customer might search"],\n'
    + '  "target_customers": "who buys this"\n'
    + '}\n'
    + 'Only include facts actually present in the material. Empty arrays/strings are fine when unknown.';
}

async function callClaude(apiKey, model, contentBlocks) {
  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 2500,
      system: EXTRACTION_SYSTEM,
      messages: [{ role: 'user', content: contentBlocks }],
    }),
  });
  if (!resp.ok) return null;
  var data = await resp.json();
  return (data.content && data.content[0] && data.content[0].text) || '';
}

function parseJson(text) {
  var cleaned = String(text || '').replace(/```json/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (e) {}
  var first = cleaned.indexOf('{');
  var last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.substring(first, last + 1)); } catch (e2) {}
  }
  return null;
}

export async function POST(req) {
  try {
    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });

    var auth = await requireUser(req);
    if (!auth || !auth.user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
    var userId = auth.user.id;

    var rl = checkRateLimit(userId, 'brand-learn');
    if (rl && !rl.allowed) return Response.json({ error: 'Rate limit reached. Try again later.' }, { status: 429 });

    var body = await req.json();
    var sourceId = String(body.sourceId || '').trim();
    if (!sourceId) return Response.json({ error: 'sourceId required' }, { status: 400 });

    // Load the source row
    var srcRes = await supabase.from('brand_sources').select('*').eq('id', sourceId).single();
    if (srcRes.error || !srcRes.data) return Response.json({ error: 'Source not found' }, { status: 404 });
    var source = srcRes.data;

    await supabase.from('brand_sources').update({ status: 'processing' }).eq('id', sourceId);

    // Build the content blocks for Claude depending on source type
    var contentBlocks = [];
    var promptText = buildExtractionPrompt();

    if (source.source_type === 'url') {
      // For a URL we fetch the page text server-side and hand it to Claude.
      var pageText = '';
      try {
        var pageResp = await fetch(source.public_url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NextTradeBot/1.0)' } });
        var html = await pageResp.text();
        // Strip tags to plain text (lightweight — no parser dependency)
        pageText = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 18000);
      } catch (e) {
        await supabase.from('brand_sources').update({ status: 'failed', error_msg: 'Could not fetch URL' }).eq('id', sourceId);
        return Response.json({ error: 'Could not fetch that URL' }, { status: 502 });
      }
      contentBlocks = [{ type: 'text', text: promptText + '\n\nWEBSITE CONTENT:\n' + pageText }];
    } else if (source.source_type === 'file') {
      var mime = source.mime_type || '';
      var fileUrl = source.public_url;
      if (/pdf/i.test(mime)) {
        // Fetch the PDF bytes and send as a document block
        var pdfResp = await fetch(fileUrl);
        var pdfBuf = await pdfResp.arrayBuffer();
        var pdfB64 = Buffer.from(pdfBuf).toString('base64');
        contentBlocks = [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
          { type: 'text', text: promptText },
        ];
      } else if (/^image\//i.test(mime)) {
        var imgResp = await fetch(fileUrl);
        var imgBuf = await imgResp.arrayBuffer();
        var imgB64 = Buffer.from(imgBuf).toString('base64');
        contentBlocks = [
          { type: 'image', source: { type: 'base64', media_type: mime, data: imgB64 } },
          { type: 'text', text: promptText },
        ];
      } else {
        // Plain text / other — fetch and send as text
        var txtResp = await fetch(fileUrl);
        var txt = (await txtResp.text()).substring(0, 18000);
        contentBlocks = [{ type: 'text', text: promptText + '\n\nDOCUMENT CONTENT:\n' + txt }];
      }
    } else {
      return Response.json({ error: 'Unknown source type' }, { status: 400 });
    }

    // Call Claude (sonnet first, haiku fallback)
    var raw = await callClaude(apiKey, 'claude-sonnet-4-6', contentBlocks);
    if (!raw) raw = await callClaude(apiKey, 'claude-haiku-4-5', contentBlocks);
    if (!raw) {
      await supabase.from('brand_sources').update({ status: 'failed', error_msg: 'Model unavailable' }).eq('id', sourceId);
      return Response.json({ error: 'Extraction failed — model unavailable' }, { status: 502 });
    }

    var parsed = parseJson(raw);
    if (!parsed) {
      await supabase.from('brand_sources').update({ status: 'failed', error_msg: 'Could not parse extraction' }).eq('id', sourceId);
      return Response.json({ error: 'Could not parse extracted knowledge' }, { status: 500 });
    }

    // Save the knowledge row (unapproved — user reviews it)
    var insRes = await supabase.from('brand_knowledge').insert({
      tenant_id: source.tenant_id || 'ktc',
      source_id: sourceId,
      summary: parsed.summary || '',
      products: parsed.products || [],
      brand_voice: parsed.brand_voice || '',
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      target_customers: parsed.target_customers || '',
      approved: false,
      created_by: userId,
    }).select().single();

    if (insRes.error) {
      await supabase.from('brand_sources').update({ status: 'failed', error_msg: 'Save failed' }).eq('id', sourceId);
      return Response.json({ error: 'Could not save knowledge: ' + insRes.error.message }, { status: 500 });
    }

    await supabase.from('brand_sources').update({ status: 'learned', processed_at: new Date().toISOString() }).eq('id', sourceId);

    return Response.json({ ok: true, knowledge: insRes.data });
  } catch (err) {
    return Response.json({ error: sanitizeErr(err) }, { status: 500 });
  }
}
