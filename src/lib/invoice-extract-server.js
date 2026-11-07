// v55.83-PQ — server-side invoice reading (shared engine pattern with
// bill-extract-server): photo/PDF in, disciplined draft out, human confirms.
import { INVOICE_EXTRACT_PROMPT, parseInvoiceExtraction } from './invoice-extract';
import { BILL_MEDIA_TYPES } from './bill-extract';

export async function readInvoiceFromBase64(b64, mediaType) {
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
        body: JSON.stringify({ model: models[mi], max_tokens: 1500,
          messages: [{ role: 'user', content: [block, { type: 'text', text: INVOICE_EXTRACT_PROMPT }] }] })
      });
      var aj = await resp.json();
      if (aj && aj.error) { throw new Error(aj.error.message || 'model error'); }
      var parts = (aj && aj.content) || [];
      var texts = [];
      for (var ci = 0; ci < parts.length; ci++) { if (parts[ci].type === 'text' && parts[ci].text) { texts.push(parts[ci].text); } }
      rawText = texts.join('\n');
    } catch (eAI) { lastErr = eAI; }
  }
  if (rawText == null) { return { error: 'The invoice could not be read: ' + ((lastErr && lastErr.message) || 'AI unavailable') + '.', status: 502 }; }
  var parsed = parseInvoiceExtraction(rawText);
  if (!parsed.draft) { return { error: parsed.problems.join(' '), status: 422 }; }
  return { draft: parsed.draft, problems: parsed.problems };
}
