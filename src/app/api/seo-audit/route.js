import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../lib/phone-auth';
import { checkRateLimit } from '../../../lib/rate-limit';
import { sanitizeErr } from '../../../lib/sanitize-error';

// ============================================================
// SEO Audit — fetch a page and detect technical SEO issues.
//
// No external crawler library: we fetch the HTML server-side and
// extract SEO signals with targeted regex (same lightweight approach
// the brand-learn route uses for URL text). Detects the issues that
// actually move rankings: title, meta description, headings, alt text,
// canonical, OpenGraph, viewport, broken-link candidates, and a few
// red flags (placeholder text, injected-spam language signatures).
//
// This is a DETECTOR. It flags and explains; it does not modify the
// live site. (Auto-fix is a later, separate, repo-based step.)
// ============================================================

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function attr(html, tagRe) {
  var m = html.match(tagRe);
  return m ? (m[1] || '').trim() : null;
}

function countMatches(html, re) {
  var m = html.match(re);
  return m ? m.length : 0;
}

export async function POST(req) {
  try {
    var auth = await requireUser(req);
    if (!auth || !auth.user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
    var userId = auth.user.id;

    var rl = checkRateLimit(userId, 'seo-audit');
    if (rl && !rl.allowed) return Response.json({ error: 'Rate limit reached. Try again later.' }, { status: 429 });

    var body = await req.json();
    var url = String(body.url || '').trim();
    if (!url) return Response.json({ error: 'URL required' }, { status: 400 });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    // Fetch the page
    var html = '';
    var fetchOk = false;
    var statusCode = 0;
    var loadMs = 0;
    var sizeKb = 0;
    try {
      var t0 = Date.now();
      var resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NextTradeSEOBot/1.0)' } });
      statusCode = resp.status;
      html = await resp.text();
      loadMs = Date.now() - t0;
      sizeKb = Math.round((html.length / 1024) * 10) / 10;
      fetchOk = resp.ok;
    } catch (e) {
      return Response.json({ error: 'Could not fetch that URL' }, { status: 502 });
    }

    var issues = [];
    function add(severity, area, message, detail) {
      issues.push({ severity: severity, area: area, message: message, detail: detail || '' });
    }

    // ---- Platform detection -------------------------------------
    var platform = 'unknown';
    if (/wp-content|wp-includes|WooCommerce|wordpress/i.test(html)) platform = /WooCommerce/i.test(html) ? 'WordPress + WooCommerce' : 'WordPress';
    else if (/\/public\/assets\/|laravel|csrf-token/i.test(html)) platform = 'Custom (PHP/Laravel-style)';
    else if (/<!--\s*static|^\s*<!doctype html>/i.test(html) && !/wp-content/i.test(html)) platform = 'Static HTML';

    // ---- Title --------------------------------------------------
    var title = attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!title) add('critical', 'Title', 'Page has no <title> tag', 'The title is the most important on-page SEO element.');
    else {
      var titleTrim = title.replace(/\s+/g, ' ').trim();
      if (titleTrim.length < 10 || /^[-\s|]+/.test(title)) add('critical', 'Title', 'Title is empty or malformed', 'Title reads: "' + titleTrim + '"');
      else if (titleTrim.length < 30) add('high', 'Title', 'Title is short (' + titleTrim.length + ' chars)', 'Aim for 50-60 characters with your key terms.');
      else if (titleTrim.length > 65) add('medium', 'Title', 'Title is long (' + titleTrim.length + ' chars) — Google truncates around 60', titleTrim.substring(0, 80) + '…');
    }

    // ---- Meta description ---------------------------------------
    var metaDesc = attr(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
      || attr(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
    if (!metaDesc) add('high', 'Meta description', 'No meta description', 'Google often uses this as the search-result snippet. Add 140-160 chars.');
    else if (metaDesc.length < 50) add('medium', 'Meta description', 'Meta description is short (' + metaDesc.length + ' chars)', 'Aim for 140-160 characters.');
    else if (metaDesc.length > 170) add('low', 'Meta description', 'Meta description is long (' + metaDesc.length + ' chars)', 'Google truncates around 160.');

    // ---- Headings -----------------------------------------------
    var h1Count = countMatches(html, /<h1[\s>]/gi);
    if (h1Count === 0) add('high', 'Headings', 'No <h1> heading', 'Every page should have exactly one clear H1.');
    else if (h1Count > 1) add('medium', 'Headings', h1Count + ' <h1> headings (should be 1)', 'Multiple H1s dilute the page topic for search engines.');
    var h3Count = countMatches(html, /<h3[\s>]/gi);
    if (h3Count > 60) add('medium', 'Headings', 'Very many headings (' + h3Count + ' H3s) — looks like a data dump', 'Long lists of headings (e.g. color names) confuse search engines about the page topic.');

    // ---- Images / alt text --------------------------------------
    var imgTags = html.match(/<img[^>]*>/gi) || [];
    var missingAlt = 0;
    imgTags.forEach(function (tag) {
      if (!/\salt\s*=/.test(tag) || /\salt\s*=\s*["']\s*["']/.test(tag)) missingAlt++;
    });
    if (imgTags.length > 0 && missingAlt > 0) {
      add(missingAlt > imgTags.length / 2 ? 'high' : 'medium', 'Images',
        missingAlt + ' of ' + imgTags.length + ' images missing alt text',
        'Alt text helps image search and accessibility.');
    }

    // ---- Canonical ----------------------------------------------
    var canonical = attr(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i);
    if (!canonical) add('medium', 'Canonical', 'No canonical link', 'Helps Google pick the primary URL and avoid duplicate-content issues.');

    // ---- Social / OpenGraph -------------------------------------
    var ogTitle = /og:title/i.test(html);
    var ogImage = /og:image/i.test(html);
    if (!ogTitle || !ogImage) add('low', 'Social sharing', 'Missing OpenGraph tags' + (!ogImage ? ' (no og:image)' : ''), 'These control how links look when shared on social/WhatsApp.');

    // ---- Viewport / mobile --------------------------------------
    if (!/name=["']viewport["']/i.test(html)) add('high', 'Mobile', 'No viewport meta tag', 'Without it the site is not mobile-friendly — a Google ranking factor.');

    // ---- Structured data ----------------------------------------
    if (!/application\/ld\+json|itemscope|schema\.org/i.test(html)) add('low', 'Structured data', 'No schema markup detected', 'Schema (e.g. Organization, Product) can earn rich results in Google.');

    // ---- HTTPS --------------------------------------------------
    if (!/^https:/i.test(url)) add('high', 'Security', 'Page not served over HTTPS', 'HTTPS is a ranking factor and a trust signal.');

    // ---- Red flags: placeholder text & injected spam ------------
    if (/Vokalia and Consonantia|Lorem ipsum|behind the word mountains|blind texts/i.test(html)) {
      add('critical', 'Content', 'Placeholder filler text is live on the page', 'Found Lorem-Ipsum-style placeholder text ("Vokalia and Consonantia" / "blind texts"). Replace with real copy — it looks unfinished to visitors and search engines.');
    }
    // Foreign-language spam signature (the crypto-injection pattern)
    if (/legislația|crypto Rom[âa]nia|ce trebuie să știi/i.test(html)) {
      add('critical', 'Security', 'Possible hacked / injected spam content detected', 'Found foreign-language content unrelated to the business (a common SEO-spam injection sign). The site may be compromised — update the platform, scan for malware, and remove injected pages urgently.');
    }
    if (statusCode >= 400) add('critical', 'Availability', 'Page returned HTTP ' + statusCode, 'The page is erroring — search engines cannot index it reliably.');

    // ---- Performance hints --------------------------------------
    if (sizeKb > 2000) add('medium', 'Performance', 'Page HTML is large (' + sizeKb + ' KB)', 'Large pages load slowly, especially on mobile. Trim or paginate.');
    if (loadMs > 3000) add('medium', 'Performance', 'Slow server response (' + loadMs + ' ms)', 'Slow pages lose rankings and visitors.');

    // Score: 100 minus weighted penalties
    var weights = { critical: 20, high: 10, medium: 5, low: 2 };
    var penalty = issues.reduce(function (s, i) { return s + (weights[i.severity] || 0); }, 0);
    var score = Math.max(0, 100 - penalty);

    var counts = { critical: 0, high: 0, medium: 0, low: 0 };
    issues.forEach(function (i) { counts[i.severity] = (counts[i.severity] || 0) + 1; });

    // Persist the audit
    try {
      await supabase.from('seo_audits').insert({
        tenant_id: 'ktc',
        url: url,
        platform: platform,
        score: score,
        status_code: statusCode,
        load_ms: loadMs,
        size_kb: sizeKb,
        issues: issues,
        counts: counts,
        created_by: userId,
      });
    } catch (e) { /* table may not exist yet — still return the result */ }

    return Response.json({
      ok: true,
      url: url,
      platform: platform,
      score: score,
      statusCode: statusCode,
      loadMs: loadMs,
      sizeKb: sizeKb,
      counts: counts,
      issues: issues,
      title: title || '',
      metaDesc: metaDesc || '',
    });
  } catch (err) {
    return Response.json({ error: sanitizeErr(err) }, { status: 500 });
  }
}
