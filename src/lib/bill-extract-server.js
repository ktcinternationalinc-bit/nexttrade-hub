// v55.83-PF — server-side bill reading shared by the 📷 Import button and the
// email-inbound endpoint (Max: "linked to an email where you check for any
// bills that come in and automatically open those bills and put it into the
// system... make sure it's been human validated").
// The model PROPOSES, parseBillExtraction DISCIPLINES, a HUMAN validates.
import { BILL_EXTRACT_PROMPT, parseBillExtraction, BILL_MEDIA_TYPES, importSort, BILL_TYPE_LABEL, BILL_PAGES_PROMPT, cleanPageList, forcedPagesPrompt, disciplinePages, applyAttachedRelease, pagesNeedReview } from './bill-extract';
import { saveBillLines, runPriceCheck } from './bill-lines-server';
import { defaultDirectionFor } from './bill-lines';
import { exactSameBill, exactSameWords } from './bill-dup-scan'; // v55.83-UQ

// v55.83-RP — the bill TYPE every VALIDATED bill of this vendor carries, when they all agree (else null: never guessed)
export async function vendorBillType(db, vendorName) {
  var v = String(vendorName || '').trim();
  if (!v) { return null; }
  try {
    var r = await db.from('vendor_bills').select('bill_type, validation_status').ilike('vendor_name', v).eq('validation_status', 'validated').eq('record_status', 'active').limit(50); // RY — deleted bills do not count
    if (r.error) { return null; }
    var seen = {}; ((r && r.data) || []).forEach(function (b) { if (b.bill_type && BILL_TYPE_LABEL[b.bill_type]) { seen[b.bill_type] = true; } });
    var ks = Object.keys(seen);
    return ks.length === 1 ? ks[0] : null;
  } catch (e) { return null; }
}

// v55.83-UQ — the database guard's refusal, without the code prefix
export function exactDupMessage(m) { return String(m || '').replace(/^[\s\S]*HUB_EXACT_DUPLICATE:\s*/, '') || 'This exact bill is already in the Hub. It was NOT added again.'; }
// v55.83-UQ — looks up the bills of the same date, then compares vendor and number the forgiving way (Inc / Corp, dashes)
export async function findExactSameBill(db, row) {
  var r = row || {}; var d = String(r.bill_date || '').substring(0, 10);
  if (!d || !String(r.bill_number || '').trim() || !String(r.vendor_name || '').trim()) { return null; }
  // v55.83-UQ (Codex 23:01) — EVERY bill of that date is read, in pages (no cutoff), and compared in code: vendor, number and the
  // total to the cent (the database repeats the check under a lock — sql/v55-83-UQ-exact-duplicate-bills.sql)
  for (var from = 0; from < 200000; from += 1000) {
    var q = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, record_status').eq('bill_date', d).order('id', { ascending: true }).range(from, from + 999);
    if (q.error) { throw new Error('Could not check for the same bill (' + q.error.message + ') — nothing was added.'); }
    var page = (q && q.data) || [];
    var hit = exactSameBill(r, page);
    if (hit) { return hit; }
    if (page.length < 1000) { break; }
  }
  return null;
}

// v55.83-RP — every import door (📷 Import, bulk file import, email inbound, email scanner) inserts through here:
// type + release + reference + direction ride on the new bill; if the RP SQL is not run yet the bill is still created
// without the new columns (and the RL ones), never lost.
export async function insertImportedBill(db, row, draft) {
  // v55.83-UQ — the exact same bill already on file → not inserted; every caller reports it as skipped with this reason
  var same = null;
  try { same = await findExactSameBill(db, row); } catch (eS) { return { data: null, error: { code: 'HUB_DUP_CHECK_FAILED', message: (eS && eS.message) || 'Could not check for the same bill — nothing was added.' } }; }
  if (same) { return { data: null, duplicate_of: same.id, error: { code: 'HUB_EXACT_DUPLICATE', message: exactSameWords(same) } }; }
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
    if (last.error && /HUB_EXACT_DUPLICATE/.test(String(last.error.message || ''))) { return { data: null, error: { code: 'HUB_EXACT_DUPLICATE', message: exactDupMessage(last.error.message) } }; }
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

// v55.83-VV — opts (all optional): { billPagesOnly: true, pages: [page numbers a PERSON picked], pageCount: pages counted in the browser (advisory) }.
// With billPagesOnly (the Import button: one file or several) a PDF's bill is taken from its bill / invoice pages only; the answer
// carries `pages` (which were used, which were left out by instruction, or "unclear") and `needs_review`.
// WITHOUT it — the two e-mail doors, which pass no opts — the instructions, the answer and the behaviour are exactly as before VV.
// The file itself is never cut or changed: the whole document reaches the reader and is what the callers store.
export async function readBillFromBase64(b64, mediaType, opts) {
  var kind = BILL_MEDIA_TYPES[String(mediaType || '')];
  if (!kind) { return { error: 'Unsupported file type — JPG/PNG/WebP photo or PDF.', status: 415 }; }
  var o = opts || {}; var isPdf = kind === 'document';
  var pageMode = isPdf && (o.billPagesOnly === true || o.pages != null);
  var realCount = (typeof o.pageCount === 'number' && o.pageCount >= 1 && o.pageCount <= 500 && Math.floor(o.pageCount) === o.pageCount) ? o.pageCount : null;
  var forced = null;
  if (o.pages != null) {
    if (!isPdf) { return { error: 'Pages can only be picked on a PDF.', status: 400 }; }
    forced = cleanPageList(o.pages, 500);
    if (!forced || !forced.length) { return { error: 'Pick at least one page (page numbers start at 1).', status: 400 }; }
    if (realCount && forced[forced.length - 1] > realCount) { return { error: 'This file has ' + realCount + ' page(s) — page ' + forced[forced.length - 1] + ' is not in it.', status: 400 }; }
  }
  var prompt = BILL_EXTRACT_PROMPT + (pageMode ? '\n' + BILL_PAGES_PROMPT + (forced ? '\n' + forcedPagesPrompt(forced) : '') : '');
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
          messages: [{ role: 'user', content: [block, { type: 'text', text: prompt }] }] })
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
  var pages = applyAttachedRelease(parsed.draft, disciplinePages(parsed.pages_raw, { isPdf: pageMode, realCount: realCount, forced: forced }));
  var review = pagesNeedReview(pages);
  // a doubt about the pages is put first among the reader flags; so is a release that came from an attached page
  // (the validator must see where it came from). `pages` is null outside page mode, so nothing is added there.
  var problems = pages && (review || pages.release_from_attached) && pages.words ? [pages.words].concat(parsed.problems) : parsed.problems;
  return { draft: parsed.draft, problems: problems, pages: pages, needs_review: review };
}
