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
      '',
      'CRITICAL OUTPUT RULES:',
      '- Return ONLY a JSON object — no preamble, no explanation, no markdown code fences, no surrounding text.',
      '- The very first character of your response MUST be {',
      '- The very last character of your response MUST be }',
      '- All string values must be plain text (no markdown, no newlines escaped as literal \\n inside strings — use actual line breaks if needed).',
      '',
      'Required JSON shape:',
      '{',
      '  "en": { "summary": "...", "topActions": ["action 1", "action 2", "action 3"], "verdict": "one-line overall verdict" },',
      '  "ar": { "summary": "...", "topActions": ["إجراء 1", "إجراء 2", "إجراء 3"], "verdict": "حكم عام من سطر واحد" }',
      '}'
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

    // v55.83-A.6.27.21 (Max May 17 2026) — robust JSON extraction.
    // Previously: if Claude returned ANY prose before/after the JSON
    // (a stray sentence, an explanation), JSON.parse threw and the
    // fallback put the entire raw response into the `summary` field —
    // which the UI then rendered as the summary text. Max saw the raw
    // JSON object printed as if it were the summary string.
    //
    // Fix: try JSON.parse first; if it fails, try to extract the first
    // balanced { ... } object substring and parse that.
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e1) {
      // Try to extract the first complete JSON object by finding matching braces
      var extracted = null;
      var firstBrace = raw.indexOf('{');
      if (firstBrace >= 0) {
        var depth = 0;
        var inString = false;
        var escape = false;
        for (var p = firstBrace; p < raw.length; p++) {
          var ch = raw[p];
          if (escape) { escape = false; continue; }
          if (ch === '\\') { escape = true; continue; }
          if (ch === '"' && !escape) { inString = !inString; continue; }
          if (inString) continue;
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              extracted = raw.substring(firstBrace, p + 1);
              break;
            }
          }
        }
      }
      if (extracted) {
        try {
          parsed = JSON.parse(extracted);
        } catch (e2) {
          // Both attempts failed — last-resort fallback. Log so we can debug.
          console.error('[accountant] JSON parse failed twice. Raw length:', raw.length, 'Extracted length:', extracted ? extracted.length : 0);
          parsed = {
            en: { summary: 'AI response could not be parsed. Raw output below for diagnosis:\n\n' + raw.substring(0, 1000), topActions: [], verdict: '' },
            ar: { summary: '', topActions: [], verdict: '' }
          };
        }
      } else {
        console.error('[accountant] No JSON object found in response. Raw length:', raw.length);
        parsed = {
          en: { summary: 'AI did not return structured output. Raw text:\n\n' + raw.substring(0, 1000), topActions: [], verdict: '' },
          ar: { summary: '', topActions: [], verdict: '' }
        };
      }
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
