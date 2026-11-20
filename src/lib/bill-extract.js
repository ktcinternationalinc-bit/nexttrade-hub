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
export function importSort(draft, vendorHistoryType, vendorDefaultDirection) {
  var d = draft || {};
  var out = { release_number: d.release_number || null, other_reference: d.other_reference || null, bill_type: null, bill_type_source: null, shipment_direction: null, direction_source: null };
  if (d.bill_type && BILL_TYPE_LABEL[d.bill_type]) { out.bill_type = d.bill_type; out.bill_type_source = 'read_from_bill'; }
  else if (vendorHistoryType && BILL_TYPE_LABEL[vendorHistoryType]) { out.bill_type = vendorHistoryType; out.bill_type_source = 'vendor_history'; }
  var dir = autoDirection(out.release_number);
  if (dir) { out.shipment_direction = dir; out.direction_source = 'release_number'; }
  else if (vendorDefaultDirection === 'inbound' || vendorDefaultDirection === 'outbound') { out.shipment_direction = vendorDefaultDirection; out.direction_source = 'vendor_default'; } // RW — e.g. NexPac → inbound
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
  // v55.83-VV — what the reader said about the pages travels apart (never on the draft that becomes the bill row)
  return { draft: draft, problems: problems, pages_raw: { page_count: obj.page_count, bill_pages: obj.bill_pages, other_pages: obj.other_pages, attached_release: obj.attached_release, attached_release_page: obj.attached_release_page } };
}

// v55.83-VV (Max, Nov 19: "when importing bills sometimes they carry lots of documentation..we need it to just focus on the
// actual bill/invoice and thats it") — a PDF often holds the bill PLUS attached papers (packing list, BOL, e-mails, customs).
// The reader is told to take the bill from the bill pages only and to SAY which pages those are; disciplinePages checks that
// answer (every page accounted for exactly once) — anything else is "unclear": said loudly, whole file used as before.
// Honest limit: the whole PDF still reaches the reader; the other pages are left out BY INSTRUCTION, not cut out of the file.
export var PAGE_KINDS = { packing_list: 'packing list', bol: 'bill of lading', delivery_receipt: 'delivery receipt', rate_confirmation: 'rate confirmation', email: 'e-mail', customs: 'customs paper', another_bill: 'ANOTHER bill / invoice', blank: 'blank page', other: 'other paper' };
export var BILL_PAGES_PROMPT = [
  'PAGES — this file is a PDF and may hold MORE than the bill: suppliers often attach supporting papers before or after it (packing list, bill of lading, delivery receipt / POD, rate confirmation, e-mails, customs papers).',
  '- First decide, page by page (page 1 = the first page of the file), which pages ARE the bill / invoice itself: the page(s) issued by the vendor that carry the invoice number and the amount due, plus its own continuation pages (more line rows, "Page 2 of 2", its own terms page).',
  '- Take EVERY value above (vendor, number, dates, total, currency, lines, release_number, other_reference, bill_type, notes) from the bill pages ONLY. Ignore the other pages completely: an amount, date, number or release printed only on an attached paper must NOT be used for those keys.',
  '- If the file holds more than one different bill / invoice, read the FIRST one only and report the pages of the others as "another_bill".',
  '- If you cannot tell which pages are the bill, use "bill_pages": [] and read the whole file as one bill — NEVER guess the pages.',
  'ALSO add these keys to the same JSON object:',
  ' "page_count": number (how many pages the file has), "bill_pages": [the page numbers that are the bill, first page = 1],',
  ' "other_pages": [{"page": number, "kind": "packing_list"|"bol"|"delivery_receipt"|"rate_confirmation"|"email"|"customs"|"another_bill"|"blank"|"other"}] (EVERY page that is not in bill_pages, one entry each),',
  ' "attached_release": string|null (a RELEASE number — labelled "Release", "Release #", "Rel #" — printed on a page that is NOT the bill, e.g. on the attached packing list, exactly as printed; null if there is none or if the attached pages show more than one different release),',
  ' "attached_release_page": number|null (the page that release is printed on).',
].join('\n');

// whole page numbers, 1 or more, no repeats, sorted — or null when anything in the list is not a page number
export function cleanPageList(x, max) {
  if (!Array.isArray(x)) { return null; }
  var seen = {}; var out = [];
  for (var i = 0; i < x.length; i++) {
    var n = typeof x[i] === 'number' ? x[i] : (typeof x[i] === 'string' && /^\d{1,4}$/.test(x[i].trim()) ? Number(x[i].trim()) : NaN);
    if (!isFinite(n) || n < 1 || Math.floor(n) !== n || n > (max || 500)) { return null; }
    if (!seen[n]) { seen[n] = true; out.push(n); }
  }
  out.sort(function (a, b) { return a - b; });
  return out;
}
function pageNo(x) {
  var n = typeof x === 'number' ? x : (typeof x === 'string' && /^\d{1,4}$/.test(x.trim()) ? Number(x.trim()) : NaN);
  return isFinite(n) && n >= 1 && n <= 500 && Math.floor(n) === n ? n : null;
}
// [1,2,3,5] → "1-3, 5"
export function pageRanges(arr) {
  var a = (arr || []).slice().sort(function (x, y) { return x - y; }); var parts = []; var i = 0;
  while (i < a.length) {
    var j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) { j++; }
    parts.push(j > i ? a[i] + '-' + a[j] : String(a[i]));
    i = j + 1;
  }
  return parts.join(', ');
}
function pagesWord(arr) { return (arr.length === 1 ? 'page ' : 'pages ') + pageRanges(arr); }
// the sentence added to the reader's instructions when a person picked the pages
export function forcedPagesPrompt(pages) {
  return 'The user has looked at this file and says the bill is on ' + pagesWord(pages) + '. Read ONLY ' + (pages.length === 1 ? 'that page' : 'those pages') + ' as the bill, whatever the other pages look like; report "bill_pages" as exactly ' + JSON.stringify(pages) + ' and every other page under "other_pages".';
}
// A page list written by the READER is checked strictly: a repeated page is a contradiction, not something to tidy up
// (cleanPageList, which drops repeats, is only for the pages a PERSON ticked).
function strictPages(x) {
  var c = cleanPageList(x, 500);
  return (c && Array.isArray(x) && c.length === x.length) ? c : null;
}
// obj = what the reader answered; opts = { isPdf, realCount (counted in the browser — advisory, may be absent), forced (pages a person picked) }
// → null for a photo, else { status: 'picked' | 'all' | 'chosen' | 'unclear', count, count_checked, used, ignored: [{ page, kind }],
//     reason, attached_release, attached_release_page, words }
// ONE validation for both the automatic answer and pages picked by a person (Codex 21:08): the count must agree, no page twice,
// no page on both lists, every page accounted for exactly once. A person's pick says WHICH pages to use — it never makes a
// contradictory answer acceptable. Anything else is 'unclear': no pages trusted, no release taken from an attachment.
export function disciplinePages(obj, opts) {
  var o = opts || {}; var src = (obj && typeof obj === 'object') ? obj : {};
  if (!o.isPdf) { return null; }
  var real = pageNo(o.realCount); var said = pageNo(src.page_count);
  var count = real || said;
  var rel = cleanStr(src.attached_release, 40); rel = rel ? rel.toUpperCase() : null;
  var relPage = pageNo(src.attached_release_page);
  function done(status, used, ignored, reason) {
    var out = { status: status, count: count || null, count_checked: !!(real && said && real === said), used: used, ignored: ignored, reason: reason || null, attached_release: null, attached_release_page: null };
    // a release seen on an attached page counts only on a VALIDATED answer, and only when that page really is one of the pages left out (and is not another bill)
    if (rel && (status === 'picked' || status === 'chosen')) {
      var onPage = null; ignored.forEach(function (g) { if (g.page === relPage) { onPage = g; } });
      if (onPage && onPage.kind !== 'another_bill') { out.attached_release = rel; out.attached_release_page = relPage; }
    }
    out.words = pagesWords(out);
    return out;
  }
  function unclear(reason) { return done('unclear', [], [], reason); }
  var forced = null;
  if (o.forced != null) {
    forced = cleanPageList(o.forced, 500);
    if (!forced || !forced.length) { return unclear('the picked pages were not page numbers'); }
  }
  var rawOthers = Array.isArray(src.other_pages) ? src.other_pages : null;
  // A file the browser counted as ONE page, about which the reader said NOTHING AT ALL on pages (no count, no bill pages, no
  // other pages), has nothing to tell apart: page 1 is the bill. This is only for an ABSENT answer. Anything the reader DID
  // say — an empty bill-page list ("I found no bill page"), a malformed count or list — is validated below like any other
  // answer (Codex 21:26): the browser's page count is never evidence that the page is a bill.
  var saidNothing = src.page_count == null && src.bill_pages == null && src.other_pages == null;
  if (real === 1 && !forced && saidNothing) { return done('all', [1], [], null); }
  // a list the reader SUPPLIED but that is not a list is a malformed answer, never treated as "nothing said" (Codex 21:43)
  if (src.other_pages != null && !Array.isArray(src.other_pages)) { return unclear('the reader’s list of the other pages was not a list'); }
  if (src.bill_pages != null && !Array.isArray(src.bill_pages)) { return unclear('the reader’s list of the bill pages was not a list'); }
  if (!said) { return unclear('the reader did not say how many pages the file has'); }
  if (real && real !== said) { return unclear('the reader counted ' + said + ' page(s) but the file has ' + real); }
  if (forced && forced[forced.length - 1] > count) { return unclear('a picked page is past the end of the file'); }
  if (!Array.isArray(src.bill_pages)) { return unclear('the reader did not name the bill pages'); }
  if (!src.bill_pages.length) { return unclear('no page clearly looks like the bill'); }
  var bill = strictPages(src.bill_pages);
  if (!bill) { return unclear('the reader listed a bill page twice or not as a page number'); }
  if (bill[bill.length - 1] > count) { return unclear('the reader named a page that is not in the file'); }
  if (rawOthers === null && bill.length !== count) { return unclear('the reader did not account for every page'); }
  var others = strictPages((rawOthers || []).map(function (p) { return p && typeof p === 'object' ? p.page : null; }));
  if (!others) { return unclear('the reader listed a page twice or not as a page number'); }
  for (var k = 0; k < others.length; k++) {
    if (bill.indexOf(others[k]) >= 0) { return unclear('the reader put page ' + others[k] + ' on both lists'); }
    if (others[k] > count) { return unclear('the reader named a page that is not in the file'); }
  }
  if (bill.length + others.length !== count) { return unclear('the reader did not account for every page'); }
  var kinds = {};
  (rawOthers || []).forEach(function (p) { kinds[pageNo(p.page)] = PAGE_KINDS[String(p.kind || '')] ? String(p.kind) : 'other'; });
  var ignored = others.map(function (n) { return { page: n, kind: kinds[n] || 'other' }; });
  if (forced) {
    if (bill.join(',') !== forced.join(',')) { return unclear('the reader did not keep to the pages you picked'); }
    return done('chosen', bill, ignored, null);
  }
  if (bill.length === count) { return done('all', bill, [], null); }
  return done('picked', bill, ignored, null);
}
// true when a person must look before this import is trusted: the page answer is unclear (ANY unclear answer — a one-page file
// too), the file holds another bill, or the attachment shows a different release than the bill
export function pagesNeedReview(p) {
  if (!p) { return false; }
  if (p.status === 'unclear') { return true; }
  return (p.ignored || []).some(function (g) { return g.kind === 'another_bill'; }) || !!p.release_conflict;
}
// Max, Nov 19: "be smart if the release is on another sheet then pull it in from the packing list. if not from the invoie."
// The invoice's own release always wins; only when the invoice prints none is the attached page's release put on the draft —
// and the pages answer says where it came from. A different release on the attachment is flagged, never swapped in.
// (pages.attached_release exists only on a validated 'picked' / 'chosen' answer — see disciplinePages.)
export function applyAttachedRelease(draft, pages) {
  if (!draft || !pages || !pages.attached_release) { return pages || null; }
  var norm = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  if (!draft.release_number) {
    draft.release_number = pages.attached_release;
    draft.shipment_direction = autoDirection(draft.release_number);
    pages.release_from_attached = true;
  } else if (norm(draft.release_number) !== norm(pages.attached_release)) {
    pages.release_conflict = { bill: draft.release_number, attached: pages.attached_release };
  }
  pages.words = pagesWords(pages);
  return pages;
}
// one plain sentence for the screen and the bill's notes ('' only for a VALID answer with nothing to say: every page is the bill of a one-page file)
export function pagesWords(p) {
  if (!p) { return ''; }
  if (p.status === 'unclear') {
    return '⚠ PAGES NOT CONFIRMED — could not tell which page(s) of this file are the bill (' + (p.reason || 'no clear answer') + '). The WHOLE file was used, as before: attached papers may have leaked into the fields. Check every field against the bill itself, or pick the pages yourself.';
  }
  var unchecked = (p.count > 1 && !p.count_checked) ? ' (The number of pages is the reader’s own count — it was not checked against the file.)' : '';
  if (p.status === 'all') { return p.count > 1 ? 'All ' + p.count + ' pages are the bill — all were used.' + unchecked : ''; }
  var groups = []; // neighbours of the same kind are named together: "pages 2-3 packing list"
  (p.ignored || []).forEach(function (g) { var last = groups[groups.length - 1]; if (last && last.kind === g.kind && last.pages[last.pages.length - 1] === g.page - 1) { last.pages.push(g.page); } else { groups.push({ kind: g.kind, pages: [g.page] }); } });
  var chosen = p.status === 'chosen';
  var s = '📄 Bill taken from ' + pagesWord(p.used) + (p.count ? ' of ' + p.count : '') + (chosen ? ' — the page(s) picked by you.' : ' (the bill / invoice).');
  if (groups.length) { s += ' Left out by instruction: ' + groups.map(function (g) { return pagesWord(g.pages) + (chosen && g.kind === 'other' ? '' : ' ' + PAGE_KINDS[g.kind]); }).join(' · ') + '.'; }
  var more = (p.ignored || []).filter(function (g) { return g.kind === 'another_bill'; }).map(function (g) { return g.page; });
  if (more.length) { s += ' ⚠ ' + (more.length === 1 ? 'Page ' : 'Pages ') + pageRanges(more) + (more.length === 1 ? ' looks' : ' look') + ' like ANOTHER bill — not entered here; import it on its own.'; }
  var relKind = null; (p.ignored || []).forEach(function (g) { if (g.page === p.attached_release_page) { relKind = PAGE_KINDS[g.kind]; } });
  if (p.release_from_attached) { s += ' Release ' + p.attached_release + ' was taken from the attached ' + (relKind || 'page') + ' (page ' + p.attached_release_page + ') — the bill itself prints none. Check it.'; }
  else if (p.release_conflict) { s += ' ⚠ The attached ' + (relKind || 'page') + ' shows release ' + p.release_conflict.attached + ' but the bill itself prints ' + p.release_conflict.bill + ' — the bill’s own was kept. Check which is right.'; }
  return s + unchecked;
}

export var BILL_MEDIA_TYPES = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image', 'application/pdf': 'document' };
