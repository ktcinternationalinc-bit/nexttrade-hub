// v55.83-WV — the server side of reading a bank's wire confirmation: the file is taken from the PRIVATE bucket where the screen
// just uploaded it (so a large PDF never travels through the request body), sent to the AI, and the answer read strictly
// (wire-confirmation.js). Reads only — it writes nothing, anywhere.
import { WIRE_CONFIRMATION_PROMPT, parseWireConfirmation } from './wire-confirmation';
import { BILL_MEDIA_TYPES } from './bill-extract';

var EXT_TYPE = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
var MAX_BYTES = 20 * 1024 * 1024;

export function confirmationMediaType(path, blobType) {
  var t = String(blobType || '').toLowerCase();
  if (BILL_MEDIA_TYPES[t]) { return t; }
  var m = /\.([a-z0-9]+)$/i.exec(String(path || ''));
  return (m && EXT_TYPE[m[1].toLowerCase()]) || null;
}

async function toBase64(data) {
  if (!data) { return ''; }
  if (typeof data.arrayBuffer === 'function') { return Buffer.from(await data.arrayBuffer()).toString('base64'); }
  if (Buffer.isBuffer(data)) { return data.toString('base64'); }
  if (data instanceof ArrayBuffer) { return Buffer.from(data).toString('base64'); }
  return '';
}

// → { read } or { error, status }
export async function readWireConfirmation(db, path) {
  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) { return { error: 'The AI reader is not switched on (no AI key on the server) — type the reference and pick the date yourself.', status: 503 }; }
  var dl;
  try { dl = await db.storage.from('bills-private').download(path); } catch (eD) { dl = { error: eD }; }
  if (!dl || dl.error || !dl.data) { return { error: 'The confirmation file could not be opened (' + ((dl && dl.error && dl.error.message) || 'not found') + ') — attach it again.', status: 404 }; }
  var size = Number(dl.data.size) || 0;
  if (size > MAX_BYTES) { return { error: 'The file is too large to read (over 20 MB) — type the reference and pick the date yourself.', status: 413 }; }
  var type = confirmationMediaType(path, dl.data.type);
  if (!type) { return { error: 'Only a PDF or a photo / screenshot (JPG, PNG, WebP) can be read.', status: 415 }; }
  var b64 = await toBase64(dl.data);
  if (b64.length < 100) { return { error: 'The confirmation file is empty.', status: 400 }; }
  var block = type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: type, data: b64 } };
  var models = ['claude-opus-5-5', 'claude-sonnet-4-6']; var lastErr = null;
  for (var mi = 0; mi < models.length; mi++) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 40000) : null;
    try {
      var bodyAI = { model: models[mi], max_tokens: 4000, messages: [{ role: 'user', content: [block, { type: 'text', text: WIRE_CONFIRMATION_PROMPT }] }] };
      var headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      if (mi === 0) { bodyAI.output_config = { effort: 'low' }; bodyAI.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
      var resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl ? ctl.signal : undefined, headers: headers, body: JSON.stringify(bodyAI) });
      var aj = await resp.json();
      if (aj && aj.error) { throw new Error(aj.error.message || 'model error'); }
      if (aj && aj.stop_reason === 'refusal') { throw new Error('the AI declined to read this file'); }
      var texts = ((aj && aj.content) || []).filter(function (c) { return c && c.type === 'text' && c.text; }).map(function (c) { return c.text; });
      var parsed = parseWireConfirmation(texts.join('\n'));
      if (parsed.error) { return { error: parsed.error + ' Type the reference and pick the date yourself.', status: 422 }; }
      return { read: parsed.read };
    } catch (eAI) { lastErr = eAI; }
    finally { if (timer) { clearTimeout(timer); } }
  }
  return { error: 'The AI could not read the confirmation (' + ((lastErr && lastErr.message) || 'unavailable') + ') — type the reference and pick the date yourself.', status: 502 };
}
