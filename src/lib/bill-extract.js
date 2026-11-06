// v55.83-PC — Bill import extraction (Max, Nov 5): "i should be able to import
// a bill and it will be read and entered as a bill with all of the correct
// vendors dates amounts etc".
// Pure parsing/validation so the launch test exercises the real rules:
// the model PROPOSES, this file DISCIPLINES — a field that can't be verified
// comes back null and the human fills it; nothing is ever invented.

export var BILL_EXTRACT_PROMPT = [
  'You are reading ONE supplier bill / vendor invoice for data entry.',
  'Return ONLY a JSON object — no prose, no markdown fences — with exactly these keys:',
  '{"vendor_name": string|null, "bill_number": string|null, "bill_date": "YYYY-MM-DD"|null,',
  ' "due_date": "YYYY-MM-DD"|null, "total_amount": number|null, "currency": "USD"|"EGP"|string|null,',
  ' "category": string|null, "notes": string|null}',
  'Rules:',
  '- vendor_name = who issued the bill (the supplier), never the recipient (KTC).',
  '- total_amount = the final amount DUE on the bill (grand total), as a plain number.',
  '- Dates must be real calendar dates in YYYY-MM-DD. If a date is not printed on the bill, use null — NEVER guess.',
  '- If any field is unreadable or absent, use null for it.',
  '- notes = one short line of useful context (e.g. what was purchased), or null.',
].join('\n');

function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) { return false; }
  var t = Date.parse(s);
  if (!isFinite(t)) { return false; }
  return new Date(t).toISOString().substring(0, 10) === s;
}

function cleanAmount(x) {
  if (typeof x === 'number' && isFinite(x) && x > 0) { return Math.round(x * 100) / 100; }
  if (typeof x === 'string') {
    var n = Number(x.replace(/[^0-9.\-]/g, ''));
    if (isFinite(n) && n > 0) { return Math.round(n * 100) / 100; }
  }
  return null;
}

function cleanStr(x, max) {
  if (typeof x !== 'string') { return null; }
  var s = x.trim();
  if (!s) { return null; }
  return s.substring(0, max || 200);
}

// Accepts the raw model text, returns { draft, problems } — never throws.
export function parseBillExtraction(raw) {
  var problems = [];
  var text = String(raw || '').trim()
    .replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  var start = text.indexOf('{'); var end = text.lastIndexOf('}');
  if (start < 0 || end <= start) { return { draft: null, problems: ['The reader returned no usable data — enter the bill manually.'] }; }
  var obj;
  try { obj = JSON.parse(text.substring(start, end + 1)); }
  catch (e) { return { draft: null, problems: ['The reader returned malformed data — enter the bill manually.'] }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { return { draft: null, problems: ['The reader returned malformed data — enter the bill manually.'] }; }

  var draft = {
    vendor_name: cleanStr(obj.vendor_name, 160),
    bill_number: cleanStr(obj.bill_number, 80),
    bill_date: isIsoDate(obj.bill_date) ? obj.bill_date : null,
    due_date: isIsoDate(obj.due_date) ? obj.due_date : null,
    total_amount: cleanAmount(obj.total_amount),
    currency: cleanStr(obj.currency, 8) || 'USD',
    category: cleanStr(obj.category, 80),
    notes: cleanStr(obj.notes, 500),
  };
  if (!draft.vendor_name) { problems.push('Vendor could not be read — fill it in.'); }
  if (!draft.total_amount) { problems.push('Total amount could not be read — fill it in.'); }
  if (!draft.bill_date) { problems.push('Bill date could not be read — fill it in.'); }
  if (obj.bill_date && !isIsoDate(obj.bill_date)) { problems.push('The printed bill date was not a valid date and was dropped.'); }
  if (obj.due_date && !isIsoDate(obj.due_date)) { problems.push('The printed due date was not a valid date and was dropped.'); }
  if (draft.currency && draft.currency.toUpperCase() !== 'USD') { problems.push('This bill reads as ' + draft.currency + ' — bills in the US book are USD; double-check before saving.'); }
  return { draft: draft, problems: problems };
}

export var BILL_MEDIA_TYPES = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image', 'application/pdf': 'document' };
