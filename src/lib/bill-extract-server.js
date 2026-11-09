// v55.83-PF — server-side bill reading shared by the 📷 Import button and the
// email-inbound endpoint (Max: "linked to an email where you check for any
// bills that come in and automatically open those bills and put it into the
// system... make sure it's been human validated").
// The model PROPOSES, parseBillExtraction DISCIPLINES, a HUMAN validates.
import { BILL_EXTRACT_PROMPT, parseBillExtraction, BILL_MEDIA_TYPES, importSort, BILL_TYPE_LABEL } from './bill-extract';
import { saveBillLines, runPriceCheck } from './bill-lines-server';
import { defaultDirectionFor } from './bill-lines';

// v55.83-RP — the bill TYPE every VALIDATED bill of this vendor carries, when they all agree (else null: never guessed)
export async function vendorBillType(db, vendorName) {
  var v = String(vendorName || '').trim();
  if (!v) { return null; }
  try {
    var r = await db.from('vendor_bills').select('bill_type, validation_status').ilike('vendor_name', v).eq('validation_status', 'validated').limit(50);
    if (r.error) { return null; }
    var seen = {}; ((r && r.data) || []).forEach(function (b) { if (b.bill_type && BILL_TYPE_LABEL[b.bill_type]) { seen[b.bill_type] = true; } });
    var ks = Object.keys(seen);
    return ks.length === 1 ? ks[0] : null;
  } catch (e) { return null; }
}

// v55.83-RP — every import door (📷 Import, bulk file import, email inbound, email scanner) inserts through here:
// type + release + reference + direction ride on the new bill; if the RP SQL is not run yet the bill is still created
// without the new columns (and the RL ones), never lost.
export async function insertImportedBill(db, row, draft) {
  var hist = (draft && !draft.bill_type) ? await vendorBillType(db, draft.vendor_name) : null;
  var defDir = null;
  try { var crR = await db.from('bill_commission_rules').select('*'); defDir = defaultDirectionFor(((crR && crR.data) || []).filter(function (x) { return x.active !== false; }), draft && draft.vendor_name); } catch (eDD) { defDir = null; }
  var srt = importSort(draft, hist, defDir);
  var full = Object.assign({}, row, srt);
  var tries = [full,
    Object.assign({}, row, { release_number: srt.release_number, other_reference: srt.other_reference, shipment_direction: srt.shipment_direction }),
    Object.assign({}, row, { release_number: srt.release_number }), row];
  var last = null;
  for (var i = 0; i < tries.length; i++) {
    last = await db.from('vendor_bills').insert(tries[i]).select('id').maybeSingle();
    if (!last.error) {
      last.sorted = i === 0 ? srt : null; last.sql_missing = i > 0;
      // v55.83-RQ — the bill's lines (NexPac: cost + its share of the 12.5% commission) and the first price check; fail-soft
      if (last.data && last.data.id) {
        try {
          if (draft && Array.isArray(draft.lines) && draft.lines.length) {
            var billRow = Object.assign({ id: last.data.id, validation_status: 'pending' }, tries[i]);
            var sl = await saveBillLines(db, billRow, draft.lines, 'read_from_bill', row.created_by || null);
            last.lines_saved = sl && sl.ok ? sl.lines.length : 0;
          } else { last.lines_saved = 0; }
          // v55.83-RU (Max 21:49: "the price check should always check based on the rules when importing") — EVERY import,
          // lines read or not (a whole-bill rule still applies); what is off travels back word for word
          var pc = await runPriceCheck(db, last.data.id);
          last.price_check = pc && pc.check ? pc.check.status : null;
          last.price_flags = pc && pc.check ? pc.check.flags.map(function (f) { return f.text; }) : [];
        } catch (eL) { last.lines_saved = last.lines_saved || 0; }
      }
      return last;
    }
    if (!/bill_type|direction_source|other_reference|shipment_direction|release_number|column/i.test(last.error.message || '')) { return last; }
  }
  return last;
}

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
        body: JSON.stringify({ model: models[mi], max_tokens: 3000, // v55.83-RQ — the lines need room
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
