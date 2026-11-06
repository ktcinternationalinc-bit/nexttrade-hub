// v55.83-PF — server-side bill reading shared by the 📷 Import button and the
// email-inbound endpoint (Max: "linked to an email where you check for any
// bills that come in and automatically open those bills and put it into the
// system... make sure it's been human validated").
// The model PROPOSES, parseBillExtraction DISCIPLINES, a HUMAN validates.
import { BILL_EXTRACT_PROMPT, parseBillExtraction, BILL_MEDIA_TYPES } from './bill-extract';

export async function readBillFromBase64(b64, mediaType) {
  var kind = BILL_MEDIA_TYPES[String(mediaType || '')];
  if (!kind) { return { error: 'Unsupported file type — JPG/PNG/WebP photo or PDF.', status: 415 }; }
  if (!b64 || b64.length < 100) { return { error: 'The file is empty.', status: 400 }; }
  if (b64.length > 14000000) { return { error: 'File too large — keep it under ~10 MB.', status: 413 }; }
  var aiKey = process.env.ANTHROPIC_API_KEY;
  if (!aiKey) { return { error: 'The AI reader is not configured on this server (ANTHROPIC_API_KEY).', status: 503 }; }
  var block = kind === 'document'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } };
  var models = ['claude-sonnet-4-6', 'claude-haiku-4-5'];
  var rawText = null; var lastErr = null;
  for (var mi = 0; mi < models.length && rawText == null; mi++) {
    try {
      var resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': aiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: models[mi], max_tokens: 700,
          messages: [{ role: 'user', content: [block, { type: 'text', text: BILL_EXTRACT_PROMPT }] }] })
      });
      var aj = await resp.json();
      if (aj && aj.error) { throw new Error(aj.error.message || 'model error'); }
      var parts = (aj && aj.content) || [];
      var texts = [];
      for (var ci = 0; ci < parts.length; ci++) { if (parts[ci].type === 'text' && parts[ci].text) { texts.push(parts[ci].text); } }
      rawText = texts.join('\n');
    } catch (eAI) { lastErr = eAI; }
  }
  if (rawText == null) { return { error: 'The bill could not be read: ' + ((lastErr && lastErr.message) || 'AI unavailable') + '.', status: 502 }; }
  var parsed = parseBillExtraction(rawText);
  if (!parsed.draft) { return { error: parsed.problems.join(' '), status: 422 }; }
  return { draft: parsed.draft, problems: parsed.problems };
}
