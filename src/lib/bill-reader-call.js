// v55.83-WT — the reader model call, in its own small file so the bill import (bill-extract-server.js, readBillFromBase64:
// unchanged — same models, same headers, same 3000 tokens) and the vendor statement check (api/accounting/vendor-statement)
// use the SAME call. content = the message blocks (file / text + prompt). Returns { text } (the model's text, possibly empty)
// or { text: null, error } after both models failed; stop_reason says when the answer was cut off (max_tokens). Server-only. No database, no storage — it reads and stores nothing.
// SWC-safe (var + concat).
export async function askBillReader(content, maxTokens) {
  var aiKey = process.env.ANTHROPIC_API_KEY;
  if (!aiKey) { return { text: null, error: new Error('The AI reader is not configured on this server (ANTHROPIC_API_KEY)') }; }
  var models = ['claude-sonnet-4-6', 'claude-haiku-4-5'];
  var rawText = null; var lastErr = null; var stop = null;
  for (var mi = 0; mi < models.length && rawText == null; mi++) {
    try {
      var resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': aiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: models[mi], max_tokens: maxTokens,
          messages: [{ role: 'user', content: content }] })
      });
      var aj = await resp.json();
      if (aj && aj.error) { throw new Error(aj.error.message || 'model error'); }
      var parts = (aj && aj.content) || [];
      var texts = [];
      for (var ci = 0; ci < parts.length; ci++) { if (parts[ci].type === 'text' && parts[ci].text) { texts.push(parts[ci].text); } }
      rawText = texts.join('\n'); stop = (aj && aj.stop_reason) || null;
    } catch (eAI) { lastErr = eAI; }
  }
  return rawText == null ? { text: null, error: lastErr, stop_reason: null } : { text: rawText, error: null, stop_reason: stop };
}
