import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../lib/phone-auth';
import { checkRateLimit } from '../../../lib/rate-limit';
import { sanitizeErr } from '../../../lib/sanitize-error';

// ============================================================
// Image → Content
// Take a product photo (base64 from the browser) and produce:
//   - what the product appears to be (type, materials, colors, use)
//   - a caption per requested platform
//   - hashtags
//   - a short Reel / video script (scene-by-scene) for visual platforms
//
// Uses Claude's native vision. Pulls APPROVED brand knowledge as
// context so the analysis is grounded in the real product line
// rather than generic guesses.
// ============================================================

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

var FALLBACK_CONTEXT = 'NextTrade Industries (North American agent for El Sayad 4M Plast, Egyptian PVC) and KTC International (textiles/materials trading). '
  + 'Product lines include PVC automotive leather, PVC flooring, marine vinyl, furniture upholstery PVC, coated fabrics. Key edge: 180 cm roll width. US + Canada warehouses. B2B, reliability-focused.';

var PLATFORM_GUIDE = {
  linkedin: 'LinkedIn: professional B2B, 1-3 short paragraphs, 3-5 hashtags.',
  instagram: 'Instagram: punchy, short lines, strong first line, tasteful emoji, 8-15 hashtags.',
  facebook: 'Facebook: conversational, clear call to action, 2-4 hashtags.',
};

async function callClaude(apiKey, model, blocks, system) {
  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model, max_tokens: 2800, system: system, messages: [{ role: 'user', content: blocks }] }),
  });
  if (!resp.ok) return null;
  var data = await resp.json();
  return (data.content && data.content[0] && data.content[0].text) || '';
}

function parseJson(text) {
  var cleaned = String(text || '').replace(/```json/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (e) {}
  var f = cleaned.indexOf('{'); var l = cleaned.lastIndexOf('}');
  if (f >= 0 && l > f) { try { return JSON.parse(cleaned.substring(f, l + 1)); } catch (e2) {} }
  return null;
}

export async function POST(req) {
  try {
    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });

    var auth = await requireUser(req);
    if (!auth || !auth.user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
    var userId = auth.user.id;

    var rl = checkRateLimit(userId, 'image-content');
    if (rl && !rl.allowed) return Response.json({ error: 'Rate limit reached. Try again later.' }, { status: 429 });

    var body = await req.json();
    var imageData = String(body.imageData || '');   // base64, no data: prefix
    var mimeType = String(body.mimeType || 'image/jpeg');
    var platforms = Array.isArray(body.platforms) && body.platforms.length > 0
      ? body.platforms.filter(function (p) { return PLATFORM_GUIDE[p]; })
      : ['linkedin', 'instagram', 'facebook'];
    var tone = String(body.tone || 'professional').trim();
    var notes = String(body.notes || '').trim();
    var wantReel = body.reel === true;
    var bilingual = body.bilingual === true;

    if (!imageData) return Response.json({ error: 'No image provided' }, { status: 400 });
    if (!/^image\//i.test(mimeType)) return Response.json({ error: 'File must be an image' }, { status: 400 });

    // Pull approved brand knowledge for grounding
    var learnedContext = '';
    try {
      var bkRes = await supabase.from('brand_knowledge')
        .select('summary, products, keywords, target_customers')
        .eq('approved', true).limit(40);
      if (bkRes.data && bkRes.data.length > 0) {
        var parts = [];
        bkRes.data.forEach(function (k) {
          if (k.summary) parts.push(k.summary);
          if (Array.isArray(k.products) && k.products.length) {
            parts.push('Products: ' + k.products.map(function (p) { return p.name; }).join(', '));
          }
        });
        learnedContext = parts.join('\n');
      }
    } catch (e) {}
    var context = learnedContext
      ? ('LEARNED PRODUCT KNOWLEDGE (prefer this):\n' + learnedContext + '\n\nGENERAL: ' + FALLBACK_CONTEXT)
      : FALLBACK_CONTEXT;

    var system = 'You are a B2B product marketer for an industrial materials and trading company. '
      + 'You look at product photos and produce credible, specific marketing content. '
      + 'Never invent specs not visible or known. Avoid hollow phrases like "game-changer" or "elevate". '
      + 'BUSINESS CONTEXT: ' + context;

    var platformInstructions = platforms.map(function (p) { return '- ' + PLATFORM_GUIDE[p]; }).join('\n');
    var bilingualLine = bilingual
      ? 'For each caption, include an Arabic version after the English, separated by a line "---".'
      : 'English only.';
    var reelLine = wantReel
      ? 'Also include a "reelScript" — a 15-30 second vertical-video script as an array of 3-6 scenes, each with "scene" (what is shown) and "voiceover" (the line spoken/captioned).'
      : 'Set "reelScript" to an empty array.';

    var prompt = 'Look at this product photo and create marketing content.\n'
      + 'TONE: ' + tone + '\n'
      + (notes ? 'NOTES: ' + notes + '\n' : '')
      + bilingualLine + '\n\n'
      + 'Generate a native post for each platform:\n' + platformInstructions + '\n'
      + reelLine + '\n\n'
      + 'Return STRICT JSON only, no markdown. Shape:\n'
      + '{\n'
      + '  "productRead": { "type": "...", "materials": "...", "colors": "...", "useCases": ["..."], "marketingAngles": ["..."] },\n'
      + '  "posts": [ { "platform": "linkedin", "caption": "...", "hashtags": ["#x"] } ],\n'
      + '  "reelScript": [ { "scene": "...", "voiceover": "..." } ]\n'
      + '}\n'
      + 'One post object per requested platform.';

    var blocks = [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageData } },
      { type: 'text', text: prompt },
    ];

    var raw = await callClaude(apiKey, 'claude-sonnet-4-6', blocks, system);
    if (!raw) raw = await callClaude(apiKey, 'claude-haiku-4-5', blocks, system);
    if (!raw) return Response.json({ error: 'Generation failed — model unavailable' }, { status: 502 });

    var parsed = parseJson(raw);
    if (!parsed || !Array.isArray(parsed.posts)) {
      return Response.json({ error: 'Could not parse generated content' }, { status: 500 });
    }

    return Response.json({
      ok: true,
      productRead: parsed.productRead || {},
      posts: parsed.posts,
      reelScript: Array.isArray(parsed.reelScript) ? parsed.reelScript : [],
    });
  } catch (err) {
    return Response.json({ error: sanitizeErr(err) }, { status: 500 });
  }
}
