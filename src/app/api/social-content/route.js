import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../lib/phone-auth';
import { checkRateLimit } from '../../../lib/rate-limit';
import { sanitizeErr } from '../../../lib/sanitize-error';

// ============================================================
// Social Content Studio — generate per-platform marketing posts
// for NextTrade / KTC from a product + goal + tone.
//
// Generates three native versions in one call (LinkedIn, Instagram,
// Facebook) so the same idea reads correctly on each platform rather
// than one copy pasted everywhere.
//
// Auth: requireUser validates the session cookie (no spoofed userId).
// Rate limit: caps cost-runaway at 40 generations per user per hour.
// ============================================================

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// House knowledge — keeps posts on-brand without the user re-typing it
// every time. This is the business context the model leans on.
var BUSINESS_CONTEXT = [
  'NextTrade Industries LLC is the North American exclusive agent for El Sayad 4M Plast, an Egyptian PVC manufacturer.',
  'Product lines: PVC automotive leather, PVC automotive flooring, furniture upholstery PVC, fashion PVC, commercial flooring, marine vinyl, PVC coated fabric, PVC roofing, PVC boat decking.',
  'Key differentiator: 180 cm roll width (wider than most competitors, fewer seams, less waste).',
  'Dual warehouse hubs in the US and Canada for fast North American delivery.',
  'KTC International is an established textiles and materials trading operation (San Antonio, TX) serving Egypt, Algeria, Ghana, Kenya, Lebanon, India, and Canada.',
  'Tone of the business: professional, reliability-focused, B2B, global trade expertise, family-run heritage with industrial scale.',
].join(' ');

var PLATFORM_GUIDE = {
  linkedin: 'LinkedIn: professional B2B voice. 1-3 short paragraphs. Lead with a hook or insight. Can mention industry trends, reliability, supply chain. 3-5 relevant hashtags at the end. No emoji spam (1-2 max, optional). Aim 600-1200 characters.',
  instagram: 'Instagram: visual-first, punchy. Short lines, line breaks for rhythm. A strong first line (caption preview). Tasteful emoji. 8-15 hashtags grouped at the end. Aim 300-700 characters before hashtags.',
  facebook: 'Facebook: conversational, slightly longer than Instagram, friendly-professional. A clear call to action (message us, visit site). 2-4 hashtags. Light emoji ok. Aim 400-800 characters.',
};

export async function POST(req) {
  try {
    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });

    // Authenticate — requireUser(req) returns { user, error }
    var auth = await requireUser(req);
    if (!auth || !auth.user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
    var userId = auth.user.id;

    // Rate limit — checkRateLimit(userId, scope) returns { allowed, remaining, ... }
    var rl = checkRateLimit(userId, 'social-content');
    if (rl && !rl.allowed) return Response.json({ error: 'Rate limit reached. Try again later.' }, { status: 429 });

    var body = await req.json();
    var topic = String(body.topic || '').trim();
    var goal = String(body.goal || 'promote').trim();
    var tone = String(body.tone || 'professional').trim();
    var platforms = Array.isArray(body.platforms) && body.platforms.length > 0
      ? body.platforms.filter(function (p) { return PLATFORM_GUIDE[p]; })
      : ['linkedin', 'instagram', 'facebook'];
    var extraNotes = String(body.notes || '').trim();
    var bilingual = body.bilingual === true;

    if (!topic) return Response.json({ error: 'Topic is required' }, { status: 400 });

    // v-next — Brand Learning Engine integration. Pull the user's APPROVED
    // brand knowledge and use it as the business context. Falls back to the
    // built-in NextTrade context when nothing has been approved yet, so the
    // generator still works on day one before any catalogs are uploaded.
    var learnedContext = '';
    try {
      var bkRes = await supabase
        .from('brand_knowledge')
        .select('summary, products, keywords, target_customers, brand_voice')
        .eq('approved', true)
        .limit(40);
      if (bkRes.data && bkRes.data.length > 0) {
        var parts = [];
        bkRes.data.forEach(function (k) {
          if (k.summary) parts.push(k.summary);
          if (Array.isArray(k.products) && k.products.length) {
            parts.push('Products: ' + k.products.map(function (p) {
              return p.name + (p.features && p.features.length ? ' (' + p.features.slice(0, 3).join(', ') + ')' : '');
            }).join('; '));
          }
          if (k.target_customers) parts.push('Target customers: ' + k.target_customers);
          if (k.brand_voice) parts.push('Brand voice: ' + k.brand_voice);
        });
        learnedContext = parts.join('\n');
      }
    } catch (e) {
      // fall through to built-in context
    }
    var effectiveContext = learnedContext
      ? ('LEARNED BUSINESS KNOWLEDGE (from the company\'s own uploaded catalogs and website — prefer this):\n' + learnedContext + '\n\nGENERAL CONTEXT: ' + BUSINESS_CONTEXT)
      : BUSINESS_CONTEXT;

    var goalLine = ({
      announce: 'Goal: announce something new (a product, capability, milestone).',
      educate: 'Goal: educate the audience and build authority (teach something useful about the product or industry).',
      promote: 'Goal: promote and drive inquiries (highlight value, include a soft call to action).',
      authority: 'Goal: build brand authority and trust (thought leadership, expertise, reliability).',
    })[goal] || 'Goal: promote and drive inquiries.';

    var platformInstructions = platforms.map(function (p) { return '- ' + PLATFORM_GUIDE[p]; }).join('\n');

    var bilingualLine = bilingual
      ? 'For EACH platform, provide the post in English AND an Arabic version (Egyptian/MSA business register) suitable for the same audience. Put English first, then a line with "---", then the Arabic version.'
      : 'Write in English only.';

    var systemPrompt = 'You are a senior B2B social media copywriter for an industrial materials and global trading company. '
      + 'You write posts that are credible, specific, and never generic or salesy-cliche. '
      + 'Avoid hollow phrases like "game-changer", "unlock", "elevate", "in today\'s fast-paced world". '
      + 'Ground every post in concrete, real attributes of the business. '
      + 'BUSINESS CONTEXT: ' + effectiveContext;

    var userPrompt = 'Create social media posts about this topic:\n\n'
      + 'TOPIC: ' + topic + '\n'
      + goalLine + '\n'
      + 'TONE: ' + tone + '\n'
      + (extraNotes ? 'ADDITIONAL NOTES: ' + extraNotes + '\n' : '')
      + '\n' + bilingualLine + '\n\n'
      + 'Generate one native post for each of these platforms:\n' + platformInstructions + '\n\n'
      + 'Also suggest a short image direction (one sentence describing the ideal photo/graphic) for each platform.\n\n'
      + 'Return STRICT JSON only, no markdown, no preamble. Shape:\n'
      + '{ "posts": [ { "platform": "linkedin", "caption": "...", "hashtags": ["#x"], "imageIdea": "..." } ] }\n'
      + 'One object per requested platform. hashtags is an array of strings each starting with #.';

    var tryModels = ['claude-sonnet-4-6', 'claude-haiku-4-5'];
    var resultText = '';
    var modelUsed = '';
    for (var i = 0; i < tryModels.length; i++) {
      try {
        var resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: tryModels[i],
            max_tokens: 2500,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });
        if (resp.ok) {
          var data = await resp.json();
          resultText = (data.content && data.content[0] && data.content[0].text) || '';
          modelUsed = tryModels[i];
          break;
        }
      } catch (err) {
        // try next model
      }
    }

    if (!resultText) return Response.json({ error: 'Generation failed — model unavailable' }, { status: 502 });

    // Parse the JSON (strip any accidental code fences)
    var cleaned = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
    var parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Last resort: find first { to last }
      var first = cleaned.indexOf('{');
      var last = cleaned.lastIndexOf('}');
      if (first >= 0 && last > first) {
        try { parsed = JSON.parse(cleaned.substring(first, last + 1)); } catch (e2) { parsed = null; }
      }
    }
    if (!parsed || !Array.isArray(parsed.posts)) {
      return Response.json({ error: 'Could not parse generated content', raw: cleaned.substring(0, 500) }, { status: 500 });
    }

    return Response.json({ ok: true, posts: parsed.posts, model: modelUsed });
  } catch (err) {
    return Response.json({ error: sanitizeErr(err) }, { status: 500 });
  }
}
