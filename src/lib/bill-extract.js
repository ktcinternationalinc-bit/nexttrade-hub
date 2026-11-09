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
  ' "category": string|null, "notes": string|null,',
  ' "release_number": string|null, "other_reference": string|null,',
  ' "bill_type": "trucking"|"shipping"|"bonded_brokerage"|"supplier"|null,',
  ' "lines": [{"description": string, "qty": number|null, "unit": string|null, "unit_price": number|null, "amount": number|null, "line_kind": "item"|"charge"|"commission"}]}',
  'Rules:',
  '- vendor_name = who issued the bill (the supplier), never the recipient (KTC).',
  '- total_amount = the final amount DUE on the bill (grand total), as a plain number.',
  '- Dates must be real calendar dates in YYYY-MM-DD. If a date is not printed on the bill, use null — NEVER guess.',
  '- If any field is unreadable or absent, use null for it.',
  '- notes = one short line of useful context (e.g. what was purchased), or null.',
  '- release_number = a RELEASE number printed on the bill (labelled "Release", "Release #", "Rel #", "Release No"), exactly as printed; null if none is printed. Never use the bill/invoice number, a PO, a BOL or a container number as the release.',
  '- other_reference = the main other reference printed (BOL, booking, container, PO, entry #), or null.',
  '- bill_type = what kind of bill this is, ONLY when the bill itself makes it clear:',
  '    "trucking" = road freight / drayage / trucking / delivery by truck;',
  '    "shipping" = ocean or air freight, shipping line, freight forwarder, port / terminal / demurrage charges;',
  '    "bonded_brokerage" = customs brokerage, bonded warehouse, customs entry / duty / clearance fees;',
  '    "supplier" = goods or materials bought from a supplier / manufacturer.',
  '  If it is not clear, use null — NEVER guess.',
  '- lines = EVERY priced row of the bill, top to bottom, exactly as printed (description, quantity, unit, rate/price per unit, line amount).',
  '    line_kind "item" = goods/products; "charge" = a service or fee (line haul, fuel, rail swing, demurrage, customs entry…); "commission" = a commission row.',
  '    Numbers are plain numbers without $ or thousands commas (12,153.50 → 12153.5). Do not add subtotal / total rows as lines; a TAX / GST / HST amount that is added to the total IS a line (line_kind "charge"). Empty list if there are no priced rows.',
  'Layouts we receive (learned from real bills):',
  '- NexPac Corporation (Cambridge ON, supplier): rows "Cambridge Seconds (LBS)  Exempt  12,153.50  0.26  3,159.91" = description, tax, QTY in LBS, RATE, AMOUNT → line_kind "item", unit "LBS".',
  '    Its last row "Commission 12.5% … 1  483.83125  483.83" → line_kind "commission", amount 483.83. The "DO/ORDER/QUOTE NO." (also printed "CGT Reference#") → other_reference. bill_type "supplier". There is no release number.',
  '- Trinity Logistics (trucking): "Shipment Rates" rows such as "LINEHAUL  $2375.0000  1.0000 Flat Rate  $2,375.00" → line_kind "charge", qty 1, unit "Flat Rate". "PU# : ID 2690" → other_reference. bill_type "trucking". The amount due is "PLEASE PAY THIS AMOUNT".',
  '- AMB Logistic (drayage / trucking): the vendor name is only in the logo and the bank details ("Name: AMB Logistic"). "RATES AND CHARGES" rows "Line Haul $1,850.00", "Rail swing Fee $200.00" → line_kind "charge". CONTAINER NO. → other_reference. bill_type "trucking". Total = "Total Rate".',
  '- The BILL TO / customer (KTC International, NexTrade Industries) is NEVER the vendor. Never copy bank account or routing numbers anywhere.',
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

// v55.83-RP (Max, Nov 9 21:04: "Hub should be able to assess if bill is for Trucking or Shipping or Bonded Brokerage
// fees or supplier bill ... If hub cannot assess the type of bill ... leave blank and ... it will be part of the
// validation process manually done. Prior to validation there MUST be a selection of the TYPE of bill and the direction")
export var BILL_TYPES = ['trucking', 'shipping', 'bonded_brokerage', 'supplier'];
export var BILL_TYPE_LABEL = { trucking: '🚚 Trucking', shipping: '🚢 Shipping', bonded_brokerage: '🛃 Bonded / Brokerage', supplier: '📦 Supplier' };
// a release number on the bill = an OUTBOUND bill; no release = left blank for the validator (never guessed inbound)
export function autoDirection(releaseNumber) {
  var r = String(releaseNumber || '').trim();
  return r.length >= 2 ? 'outbound' : null;
}
// what an import puts on the new bill row (+ where each value came from, shown to the validator)
export function importSort(draft, vendorHistoryType) {
  var d = draft || {};
  var out = { release_number: d.release_number || null, other_reference: d.other_reference || null, bill_type: null, bill_type_source: null, shipment_direction: null, direction_source: null };
  if (d.bill_type && BILL_TYPE_LABEL[d.bill_type]) { out.bill_type = d.bill_type; out.bill_type_source = 'read_from_bill'; }
  else if (vendorHistoryType && BILL_TYPE_LABEL[vendorHistoryType]) { out.bill_type = vendorHistoryType; out.bill_type_source = 'vendor_history'; }
  var dir = autoDirection(out.release_number);
  if (dir) { out.shipment_direction = dir; out.direction_source = 'release_number'; }
  return out;
}

// v55.83-RQ — the bill's priced rows, disciplined: numbers or null, at most 60 rows, no empty rows
function lnum(x) {
  if (x === '' || x == null) { return null; }
  var n = typeof x === 'number' ? x : Number(String(x).replace(/[$,\s]/g, ''));
  return isFinite(n) ? n : null;
}
export function cleanLines(arr) {
  if (!Array.isArray(arr)) { return []; }
  var out = [];
  arr.slice(0, 60).forEach(function (l) {
    if (!l || typeof l !== 'object') { return; }
    var desc = cleanStr(l.description, 300);
    var amount = lnum(l.amount); var qty = lnum(l.qty); var price = lnum(l.unit_price);
    if (!desc && amount == null) { return; }
    if (/^(sub\s*total|total|total due|balance due|amount due|grand total)\b/i.test(desc || '')) { return; } // review #12 — a TAX row is kept (it is part of the total)
    if (/^(tax|gst|hst|pst|vat|sales tax)\b/i.test(desc || '')) { l = Object.assign({}, l, { line_kind: 'charge' }); }
    var kind = ['item', 'charge', 'commission'].indexOf(l.line_kind) >= 0 ? l.line_kind : (/commission/i.test(desc || '') ? 'commission' : 'item');
    out.push({ description: desc || '(no description)', qty: qty, unit: cleanStr(l.unit, 20), unit_price: price, amount: amount != null ? Math.round(amount * 100) / 100 : null, line_kind: kind });
  });
  return out;
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
    // v55.83-RP (Max, Nov 9 21:04) — what kind of bill + which way the goods go
    release_number: cleanStr(obj.release_number, 40),
    other_reference: cleanStr(obj.other_reference, 60),
    bill_type: BILL_TYPE_LABEL[String(obj.bill_type || '').toLowerCase()] ? String(obj.bill_type).toLowerCase() : null,
    lines: cleanLines(obj.lines),
  };
  if (draft.release_number) { draft.release_number = draft.release_number.toUpperCase(); }
  if (draft.other_reference) { draft.other_reference = draft.other_reference.toUpperCase(); }
  // "Outbound will always have a release number so ... automatically check it as outbound. Otherwise leave blank"
  draft.shipment_direction = autoDirection(draft.release_number);
  if (!draft.vendor_name) { problems.push('Vendor could not be read — fill it in.'); }
  if (!draft.total_amount) { problems.push('Total amount could not be read — fill it in.'); }
  if (!draft.bill_date) { problems.push('Bill date could not be read — fill it in.'); }
  if (obj.bill_date && !isIsoDate(obj.bill_date)) { problems.push('The printed bill date was not a valid date and was dropped.'); }
  if (obj.due_date && !isIsoDate(obj.due_date)) { problems.push('The printed due date was not a valid date and was dropped.'); }
  if (draft.currency && draft.currency.toUpperCase() !== 'USD') { problems.push('This bill reads as ' + draft.currency + ' — bills in the US book are USD; double-check before saving.'); }
  return { draft: draft, problems: problems };
}

export var BILL_MEDIA_TYPES = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image', 'application/pdf': 'document' };
