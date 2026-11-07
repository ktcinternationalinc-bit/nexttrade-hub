// v55.83-PQ — Invoice reading (Max, Nov 7 05:13: "need to upload invoices and
// from invoices it will create the invoice based on data and show on both
// systems"). Same discipline as bill reading: the model PROPOSES, the parser
// DISCIPLINES (null, never a guess), a HUMAN confirms in the invoice editor —
// and the saved invoice then flows to Wave and ClickBooks exactly like a
// hand-entered one.
export var INVOICE_EXTRACT_PROMPT = 'Read this sales invoice document carefully. Reply with ONLY a JSON object, no other text, with these keys:\n'
  + '{"customer_name": string|null, "invoice_number": string|null, "invoice_date": "YYYY-MM-DD"|null, "due_date": "YYYY-MM-DD"|null, "currency": "USD"|"EGP"|string|null, "total_amount": number|null,\n'
  + ' "line_items": [{"description": string, "quantity": number|null, "unit_price": number|null, "line_total": number|null}], "notes": string|null}\n'
  + 'RULES: If a value is not clearly printed on the document, use null — NEVER guess or invent. '
  + 'Amounts are plain numbers without currency symbols or thousands separators. '
  + 'line_items lists every billed line in order; if quantities/prices are not itemized, return one line with the total. '
  + 'customer_name is who the invoice is billed TO.';

function numOrNull(x) {
  if (x === null || x === undefined || x === '') { return null; }
  var n = Number(String(x).replace(/[,$]/g, ''));
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function dateOrNull(x) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? x : null;
}

export function parseInvoiceExtraction(rawText) {
  var problems = [];
  var m = String(rawText || '').match(/\{[\s\S]*\}/);
  if (!m) { return { draft: null, problems: ['The reader returned no usable data — enter the invoice manually.'] }; }
  var j = null;
  try { j = JSON.parse(m[0]); } catch (e) { return { draft: null, problems: ['The reader\'s answer could not be parsed — enter the invoice manually.'] }; }
  var items = [];
  var arr = Array.isArray(j.line_items) ? j.line_items : [];
  for (var i = 0; i < arr.length && i < 60; i++) {
    var it = arr[i] || {};
    var desc = String(it.description || '').trim().substring(0, 300);
    if (!desc) { continue; }
    items.push({ description: desc, quantity: numOrNull(it.quantity), unit_price: numOrNull(it.unit_price), line_total: numOrNull(it.line_total) });
  }
  var draft = {
    customer_name: j.customer_name ? String(j.customer_name).trim().substring(0, 200) : null,
    invoice_number: j.invoice_number ? String(j.invoice_number).trim().substring(0, 80) : null,
    invoice_date: dateOrNull(j.invoice_date),
    due_date: dateOrNull(j.due_date),
    currency: j.currency ? String(j.currency).trim().toUpperCase().substring(0, 8) : null,
    total_amount: numOrNull(j.total_amount),
    line_items: items,
    notes: j.notes ? String(j.notes).trim().substring(0, 500) : null,
  };
  if (!draft.customer_name) { problems.push('Customer name was not readable — pick the customer yourself.'); }
  if (!draft.invoice_date) { problems.push('Invoice date was not readable — set it yourself.'); }
  if (draft.total_amount === null) { problems.push('Total was not readable — check the lines add up.'); }
  if (items.length === 0) { problems.push('No line items were readable — add them yourself.'); }
  // integrity: lines vs printed total (when both exist) — mismatch is FLAGGED, never auto-fixed
  if (draft.total_amount !== null && items.length > 0) {
    var sum = 0; var missing = false;
    items.forEach(function (it2) {
      var lt = it2.line_total !== null ? it2.line_total : (it2.quantity !== null && it2.unit_price !== null ? Math.round(it2.quantity * it2.unit_price * 100) / 100 : null);
      if (lt === null) { missing = true; } else { sum = Math.round((sum + lt) * 100) / 100; }
    });
    if (!missing && Math.abs(sum - draft.total_amount) > 0.01) {
      problems.push('⚠ The lines add to ' + sum.toFixed(2) + ' but the document total reads ' + draft.total_amount.toFixed(2) + ' — check before saving.');
    }
  }
  return { draft: draft, problems: problems };
}
