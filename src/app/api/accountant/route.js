// ============================================================
// AI ACCOUNTANT API — sends deterministic audit findings
// to Anthropic for natural-language executive analysis.
// POST /api/accountant
// Body: { audit: <result of runAccountingAudit> }
// Returns: { en: "...", ar: "...", prioritized: [...] }
// ============================================================

import { sanitizeErr } from '../../../lib/sanitize-error';

export async function POST(req) {
  try {
    var body = await req.json();
    var audit = body.audit || {};

    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Build a compact audit summary for the prompt
    var summary = {
      generatedAt: audit.generatedAt,
      metrics: audit.metrics,
      bySeverity: audit.bySeverity,
      totalFindings: audit.totalFindings,
      findings: (audit.findings || []).map(function (f) {
        return {
          severity: f.severity,
          code: f.code,
          title: f.titleEn,
          description: f.descEn,
          totalImpact: f.totalImpact,
          count: f.count,
          sampleItems: (f.items || []).slice(0, 3)
        };
      })
    };

    var systemPrompt = [
      'You are a senior AI accountant for KTC International, an Egyptian import/export business (leather, pool supplies, roofing, fabrics, PVC, chemicals).',
      'The business operates in Egyptian Pounds (EGP) with some USD transactions.',
      'You will be given the output of a deterministic accounting audit. The numbers and categorizations are already correct — your job is NOT to recompute anything.',
      'Your job is to:',
      '1. Write a clear executive summary of the financial health based on the audit.',
      '2. Prioritize which findings need attention FIRST (by money at risk AND by how fixable they are).',
      '3. Give practical, business-specific advice.',
      '4. Be direct. Do NOT hedge excessively. Do NOT recommend "consult a professional" — the user IS the professional.',
      '5. Return BOTH English and Arabic versions.',
      'Format your response as strict JSON with this shape:',
      '{',
      '  "en": { "summary": "...", "topActions": ["action 1", "action 2", "action 3"], "verdict": "one-line overall verdict" },',
      '  "ar": { "summary": "...", "topActions": ["إجراء 1", "إجراء 2", "إجراء 3"], "verdict": "حكم عام من سطر واحد" }',
      '}',
      'Do not include any text outside the JSON.'
    ].join('\n');

    var userMessage = 'Here is the audit output:\n\n' + JSON.stringify(summary, null, 2);

    var anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!anthropicRes.ok) {
      var errText = await anthropicRes.text();
      return new Response(JSON.stringify({ error: 'Anthropic API error', detail: errText }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    var data = await anthropicRes.json();
    var raw = '';
    if (data && data.content && data.content.length > 0) {
      for (var i = 0; i < data.content.length; i++) {
        if (data.content[i].type === 'text') raw += data.content[i].text;
      }
    }

    // Strip code fences if the model added them
    raw = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // Fallback: return raw text so UI can still show something
      parsed = {
        en: { summary: raw, topActions: [], verdict: '' },
        ar: { summary: '', topActions: [], verdict: '' }
      };
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: sanitizeErr(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
