// v55.83-VV (Max, Nov 19, example "Invoice 27021.pdf": "when importing bills sometimes they carry lots of documentation..we
// need it to just focus on the actual bill/invoice and thats it"; then: "be smart if the release is on another sheet then pull
// it in from the packing list. if not from the invoie.")
// RUNS the real rules (bill-extract disciplinePages / applyAttachedRelease / pagesWords), the real reader step
// (bill-extract-server readBillFromBase64, with the AI call replaced by a canned answer) and the REAL bills route
// (extract_bill + ingest_bill_file) on an in-memory database. No network, no real PDF, no real bill.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('VV — bill import takes the bill from the bill / invoice pages only');

var E = require(path.join(root, 'src/lib/bill-extract.js'));
var D = function (obj, opts) { return E.disciplinePages(obj, Object.assign({ isPdf: true }, opts || {})); };
// the example file as the reader should answer it: page 1 invoice, 2-3 packing list, 4 e-mail
var EX = { vendor_name: 'AMB Logistic', bill_number: '27021', bill_date: '2025-01-09', due_date: null, total_amount: 1300, currency: 'USD', category: null, notes: 'Drayage Bayport to San Antonio', release_number: null, other_reference: null, bill_type: 'trucking',
  lines: [{ description: 'Line Haul', qty: 1, unit: null, unit_price: 1300, amount: 1300, line_kind: 'charge' }],
  page_count: 4, bill_pages: [1], other_pages: [{ page: 2, kind: 'packing_list' }, { page: 3, kind: 'packing_list' }, { page: 4, kind: 'email' }], attached_release: '1002-936', attached_release_page: 2 };
function ans(over) { return Object.assign({}, EX, over || {}); }

// ── 1. the page rule (pure)
var p1 = D(EX, { realCount: 4 });
check('example: bill = page 1 of 4; pages 2-3 packing list and page 4 e-mail are left out', p1.status === 'picked' && p1.used.join() === '1' && p1.count === 4 && p1.ignored.map(function (g) { return g.page + g.kind; }).join() === '2packing_list,3packing_list,4email', p1);
check('example: the sentence names the pages used and the pages left out', /Bill taken from page 1 of 4 \(the bill \/ invoice\)\. Left out by instruction: pages 2-3 packing list · page 4 e-mail\.$/.test(p1.words), p1.words);
check('the browser page count agreeing with the reader is recorded as checked; without it, as NOT checked — and the sentence SAYS the count is the reader\'s own', p1.count_checked === true && D(EX).count_checked === false && D(EX).status === 'picked' && /reader’s own count — it was not checked against the file/.test(D(EX).words) && !/not checked/.test(p1.words));
check('a photo (not a PDF) has no page answer at all', E.disciplinePages(EX, { isPdf: false }) === null);
check('a VALID one-page PDF: nothing to say (also when the browser counted 1 and the reader said nothing about pages)', D({ page_count: 1, bill_pages: [1], other_pages: [] }).status === 'all' && D({ page_count: 1, bill_pages: [1], other_pages: [] }).words === '' && D({}, { realCount: 1 }).status === 'all' && D({}, { realCount: 1 }).words === '' && E.pagesNeedReview(D({}, { realCount: 1 })) === false);
// Codex 21:08 #2 — a one-page count never hides a contradiction
// Codex 21:26 — ABSENT page answer (the one-page fallback) is not the same as an answer that is PRESENT but empty / malformed
var oneEmpty = D({ page_count: 1, bill_pages: [], other_pages: [] }, { realCount: 1 });
check('browser counted 1 page and the reader explicitly named NO bill page (bill_pages: []) → unclear, warned, needs review — the page count is not evidence of a bill', oneEmpty.status === 'unclear' && /PAGES NOT CONFIRMED/.test(oneEmpty.words) && /no page clearly looks like the bill/.test(oneEmpty.words) && E.pagesNeedReview(oneEmpty) === true, oneEmpty);
var onePresentBad = { 'only bill_pages: []': D({ bill_pages: [] }, { realCount: 1 }), 'only other_pages: []': D({ other_pages: [] }, { realCount: 1 }), 'count given as a word': D({ page_count: 'one' }, { realCount: 1 }), 'count 1 but no bill pages key': D({ page_count: 1 }, { realCount: 1 }), 'bill_pages not a list': D({ page_count: 1, bill_pages: 'page 1' }, { realCount: 1 }), 'bill_pages [1,1]': D({ page_count: 1, bill_pages: [1, 1], other_pages: [] }, { realCount: 1 }) };
Object.keys(onePresentBad).forEach(function (k) { var u = onePresentBad[k]; check('one-page file, page answer present but incomplete / malformed → unclear — ' + k, u.status === 'unclear' && u.words !== '' && E.pagesNeedReview(u) === true, u); });
check('one-page file, page answer COMPLETELY absent → the deliberate fallback: page 1 is the bill, quiet; a complete valid answer is quiet too', D({}, { realCount: 1 }).status === 'all' && D({ vendor_name: 'X', page_count: null, bill_pages: null, other_pages: null }, { realCount: 1 }).status === 'all' && D({ page_count: 1, bill_pages: [1], other_pages: [] }, { realCount: 1 }).status === 'all');
check('the fallback needs the BROWSER count: no count at all and no page answer → unclear', D({}).status === 'unclear' && D({}, { realCount: 2 }).status === 'unclear');
// Codex 21:43 — a SUPPLIED other_pages that is not a list must not be thrown away (it can hide "this page is another bill")
var malformed = {
  'one page, other_pages is an object naming page 1 as another bill': D({ page_count: 1, bill_pages: [1], other_pages: { page: 1, kind: 'another_bill' } }, { realCount: 1 }),
  'one page, other_pages is a word': D({ page_count: 1, bill_pages: [1], other_pages: 'none' }, { realCount: 1 }),
  'three pages all bill, other_pages is an object': D({ page_count: 3, bill_pages: [1, 2, 3], other_pages: { page: 2, kind: 'email' } }, { realCount: 3 }),
  'four pages, other_pages is a number': D(ans({ other_pages: 3 }), { realCount: 4 }),
  'picked page, other_pages is an object': D(ans({ other_pages: { page: 2, kind: 'packing_list' } }), { realCount: 4, forced: [1] }),
  'other_pages holds things that are not page entries': D(ans({ other_pages: [2, 3, 4] }), { realCount: 4 }),
};
Object.keys(malformed).forEach(function (k) { var u = malformed[k]; check('malformed supplied page list → unclear, warned, needs review, no release — ' + k, u.status === 'unclear' && /PAGES NOT CONFIRMED/.test(u.words) && E.pagesNeedReview(u) === true && u.attached_release === null, u); });
check('the proper list with the same content is refused too (page 1 on both lists)', D({ page_count: 1, bill_pages: [1], other_pages: [{ page: 1, kind: 'another_bill' }] }, { realCount: 1 }).status === 'unclear');
var one4 = D(EX, { realCount: 1 });
check('browser counted 1 page but the reader answered for 4 → unclear, warned in words, needs review (not suppressed)', one4.status === 'unclear' && one4.count === 1 && /PAGES NOT CONFIRMED/.test(one4.words) && /counted 4 page\(s\) but the file has 1/.test(one4.words) && E.pagesNeedReview(one4) === true, one4);
check('browser counted 1 page, reader says 1 page but names page 2 / another paper → unclear, warned', D({ page_count: 1, bill_pages: [2] }, { realCount: 1 }).status === 'unclear' && E.pagesNeedReview(D({ page_count: 1, bill_pages: [1], other_pages: [{ page: 1, kind: 'email' }] }, { realCount: 1 })) === true && D({ page_count: 1, bill_pages: [] }).words !== '');
var pAll = D({ page_count: 3, bill_pages: [1, 2, 3], other_pages: [] });
check('every page is the bill (a 3-page invoice) → all used, said so', pAll.status === 'all' && /All 3 pages are the bill/.test(pAll.words), pAll);
check('invoice in the MIDDLE (BOL first, POD last) is picked', D({ page_count: 3, bill_pages: [2], other_pages: [{ page: 1, kind: 'bol' }, { page: 3, kind: 'delivery_receipt' }] }).used.join() === '2');
var unclearCases = {
  'reader counted 5 pages, the file has 4': D(ans({ page_count: 5, other_pages: EX.other_pages.concat([{ page: 5, kind: 'other' }]) }), { realCount: 4 }),
  'no page count': D(ans({ page_count: null })),
  'no bill pages named (the reader could not tell)': D(ans({ bill_pages: [] })),
  'bill pages not a list': D(ans({ bill_pages: 'first' })),
  'a page on both lists': D(ans({ bill_pages: [1, 2] })),
  'a page missing from both lists': D(ans({ other_pages: [{ page: 2, kind: 'packing_list' }, { page: 4, kind: 'email' }] })),
  'a page listed twice': D(ans({ other_pages: [{ page: 2, kind: 'packing_list' }, { page: 2, kind: 'packing_list' }, { page: 4, kind: 'email' }] })),
  'a BILL page listed twice ([1,1]) is a contradiction, not tidied up': D(ans({ bill_pages: [1, 1] }), { realCount: 4 }),
  'a page past the end': D(ans({ bill_pages: [9] })),
  'page 0 / half pages': D(ans({ bill_pages: [0] })),
  'other pages missing altogether': D(ans({ other_pages: undefined })),
};
Object.keys(unclearCases).forEach(function (k) { var u = unclearCases[k]; check('unclear, never guessed — ' + k, u.status === 'unclear' && u.used.length === 0 && /PAGES NOT CONFIRMED/.test(u.words) && /WHOLE file was used/.test(u.words) && E.pagesNeedReview(u) === true && u.attached_release === null, u); });
check('an unknown kind of paper is still left out, named "other paper"', D(ans({ other_pages: [{ page: 2, kind: 'weird' }, { page: 3, kind: 'packing_list' }, { page: 4, kind: 'email' }] })).ignored[0].kind === 'other');
var two = D({ page_count: 3, bill_pages: [1], other_pages: [{ page: 2, kind: 'another_bill' }, { page: 3, kind: 'packing_list' }] });
check('two invoices in one file: the first is read, the other is named loudly and the import needs a person', two.status === 'picked' && /Page 2 looks like ANOTHER bill/.test(two.words) && E.pagesNeedReview(two) === true, two);
check('the normal example does NOT need extra review', E.pagesNeedReview(p1) === false);

// ── 2. pages picked by a person
var f1 = D(ans({ bill_pages: [2, 3], other_pages: [{ page: 1, kind: 'other' }, { page: 4, kind: 'email' }] }), { realCount: 4, forced: [3, 2] });
check('picked pages 2-3: used exactly those, labelled as picked by you', f1.status === 'chosen' && f1.used.join() === '2,3' && /pages 2-3 of 4 — the page\(s\) picked by you/.test(f1.words) && f1.ignored.map(function (g) { return g.page; }).join() === '1,4', f1);
check('picked pages but the reader answered for other pages → unclear, not trusted', D(EX, { realCount: 4, forced: [2] }).status === 'unclear');
// Codex 21:08 #1 — picking pages never makes a contradictory answer acceptable: the SAME validation runs
var fc = D({ page_count: 6, bill_pages: [1], other_pages: [{ page: 2, kind: 'packing_list' }], attached_release: '1002-936', attached_release_page: 2 }, { realCount: 4, forced: [1] });
check('picked page 1, but the reader counted 6 pages (file has 4) and accounted only for page 2 → unclear, needs review, NO release', fc.status === 'unclear' && E.pagesNeedReview(fc) === true && fc.attached_release === null && fc.ignored.length === 0, fc);
var dFc = { release_number: null }; E.applyAttachedRelease(dFc, fc);
check('…and nothing from the attachment reaches the draft', dFc.release_number === null);
var forcedBad = {
  'missing other pages': D(ans({ other_pages: [{ page: 2, kind: 'packing_list' }] }), { realCount: 4, forced: [1] }),
  'a page on both lists': D(ans({ other_pages: [{ page: 1, kind: 'other' }, { page: 2, kind: 'packing_list' }, { page: 3, kind: 'packing_list' }, { page: 4, kind: 'email' }] }), { realCount: 4, forced: [1] }),
  'other page out of range': D(ans({ other_pages: [{ page: 2, kind: 'packing_list' }, { page: 3, kind: 'packing_list' }, { page: 9, kind: 'email' }] }), { realCount: 4, forced: [1] }),
  'other page twice': D(ans({ other_pages: [{ page: 2, kind: 'packing_list' }, { page: 2, kind: 'packing_list' }, { page: 4, kind: 'email' }] }), { realCount: 4, forced: [1] }),
  'bill page twice': D(ans({ bill_pages: [1, 1] }), { realCount: 4, forced: [1] }),
  'no page count from the reader': D(ans({ page_count: null }), { realCount: 4, forced: [1] }),
};
Object.keys(forcedBad).forEach(function (k) { var u = forcedBad[k]; check('picked pages + contradictory answer → unclear — ' + k, u.status === 'unclear' && u.attached_release === null && E.pagesNeedReview(u) === true, u); });
var fOk = D(EX, { realCount: 4, forced: [1] });
check('picked page 1 with a complete, consistent answer → chosen, release from the packing list allowed', fOk.status === 'chosen' && fOk.attached_release === '1002-936' && fOk.count_checked === true, fOk);
check('picked page past the end / not numbers → unclear', D(EX, { realCount: 4, forced: [7] }).status === 'unclear' && D(EX, { realCount: 4, forced: ['x'] }).status === 'unclear' && D(EX, { realCount: 4, forced: [] }).status === 'unclear');
check('cleanPageList: sorted, no repeats, refuses 0 / 1.5 / words', E.cleanPageList([3, '1', 3]).join() === '1,3' && E.cleanPageList([0]) === null && E.cleanPageList([1.5]) === null && E.cleanPageList(['a']) === null && E.cleanPageList('1') === null);
check('pageRanges: 1-3, 5', E.pageRanges([5, 1, 2, 3]) === '1-3, 5');

// ── 3. the release (Max: from the packing list when the invoice has none; else from the invoice)
var dA = { release_number: null, shipment_direction: null }; var pA = E.applyAttachedRelease(dA, D(EX, { realCount: 4 }));
check('invoice prints no release, packing list shows 1002-936 → put on the bill, outbound, and the sentence says where it came from', dA.release_number === '1002-936' && dA.shipment_direction === 'outbound' && pA.release_from_attached === true && /Release 1002-936 was taken from the attached packing list \(page 2\) — the bill itself prints none/.test(pA.words), [dA, pA.words]);
var dB = { release_number: '1002-900', shipment_direction: 'outbound' }; var pB = E.applyAttachedRelease(dB, D(EX, { realCount: 4 }));
check('invoice prints its own release → the invoice wins; a different one on the attachment is flagged for a person, never swapped in', dB.release_number === '1002-900' && !pB.release_from_attached && pB.release_conflict.attached === '1002-936' && /shows release 1002-936 but the bill itself prints 1002-900/.test(pB.words) && E.pagesNeedReview(pB) === true, pB);
var dC = { release_number: '1002 936' }; var pC = E.applyAttachedRelease(dC, D(EX, { realCount: 4 }));
check('same release on both (spacing aside) → kept, no flag', dC.release_number === '1002 936' && !pC.release_conflict && !pC.release_from_attached);
var dD = { release_number: null }; E.applyAttachedRelease(dD, D(ans({ bill_pages: [] })));
check('pages unclear → no release is pulled from anywhere', dD.release_number === null);
var dE = { release_number: null }; E.applyAttachedRelease(dE, D(ans({ attached_release_page: 1 })));
var dF = { release_number: null }; E.applyAttachedRelease(dF, D(ans({ attached_release_page: null })));
var dG = { release_number: null }; E.applyAttachedRelease(dG, D({ page_count: 2, bill_pages: [1], other_pages: [{ page: 2, kind: 'another_bill' }], attached_release: '1002-111', attached_release_page: 2 }));
check('a release "from an attached page" that is really the bill page, has no page, or sits on ANOTHER bill is not used', dE.release_number === null && dF.release_number === null && dG.release_number === null, [dE, dF, dG]);

// ── 4. the reader step (the AI call is replaced by a canned answer; what is SENT is inspected)
var sent = []; var nextAnswer = EX; var nextFail = null;
global.fetch = function (url, o) {
  sent.push({ url: url, body: JSON.parse(o.body) });
  if (nextFail) { return Promise.resolve({ json: function () { return Promise.resolve({ error: { message: nextFail } }); } }); }
  return Promise.resolve({ json: function () { return Promise.resolve({ content: [{ type: 'text', text: typeof nextAnswer === 'string' ? nextAnswer : JSON.stringify(nextAnswer) }] }); } });
};
function lastPrompt() { var c = sent[sent.length - 1].body.messages[0].content; return c[c.length - 1].text; }
function lastDoc() { return sent[sent.length - 1].body.messages[0].content[0]; }
var B64 = Buffer.from('%PDF-1.4 made-up test bytes ' + new Array(200).join('x')).toString('base64');

var orig = Module._resolveFilename;
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
Module._resolveFilename = function (req, parent) {
  if (req === '@supabase/supabase-js') { return mockPath; }
  if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); }
  return orig.apply(this, arguments);
};
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var db = new MemDB({
  users: [{ id: 'u1', name: 'Bills clerk', role: 'staff', active: true }],
  module_permissions: ['accounting.clickbooks.access', 'bills.manage', 'bills.view', 'accounting.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
  vendor_bills: [], vendor_bill_payments: [], vendor_bill_events: [], vendor_bill_lines: [], bill_commission_rules: [], bill_price_rules: [], hub_audit_log: [], paid_through_parties: [], bill_vendor_categories: [],
});
global.__db = db;
var stored = [];
db.storage = { from: function (bucket) { return { upload: function (p, buf, o) { stored.push({ bucket: bucket, path: p, bytes: buf.length, type: o && o.contentType }); return Promise.resolve({ data: { path: p }, error: null }); } }; } };
var X = require(path.join(root, 'src/lib/bill-extract-server.js'));
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
async function call(body) { var res = await bills.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: 'u1' }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }

(async function () {
  var r = await X.readBillFromBase64(B64, 'application/pdf', { billPagesOnly: true, pageCount: 4 });
  check('reader: the WHOLE file is what is sent (nothing cut), with the page instructions added', lastDoc().type === 'document' && lastDoc().source.data === B64 && /bill pages ONLY/.test(lastPrompt()) && /"bill_pages"/.test(lastPrompt()) && lastPrompt().indexOf(E.BILL_EXTRACT_PROMPT) === 0);
  check('reader: example → draft from the invoice (AMB #27021, $1,300, 2025-01-09), bill page 1, release pulled from the packing list', !r.error && r.draft.vendor_name === 'AMB Logistic' && r.draft.bill_number === '27021' && r.draft.total_amount === 1300 && r.draft.bill_date === '2025-01-09' && r.pages.used.join() === '1' && r.draft.release_number === '1002-936' && r.needs_review === false, r);
  check('reader: the page keys never land on the draft that becomes the bill row', !('page_count' in r.draft) && !('bill_pages' in r.draft) && !('attached_release' in r.draft));
  check('reader: a release taken from an attachment is also a reader flag (written in the bill notes)', r.problems.some(function (p) { return /was taken from the attached packing list/.test(p); }));
  await X.readBillFromBase64(B64, 'image/png', { billPagesOnly: true });
  check('reader: a photo gets today\'s instructions unchanged (no page section)', lastPrompt() === E.BILL_EXTRACT_PROMPT);
  // the two e-mail doors call the reader with NO options: they must behave exactly as before this build
  var rMail = await X.readBillFromBase64(B64, 'application/pdf');
  check('reader WITHOUT the page option (how inbound / email-scan call it): today\'s instructions byte for byte, no pages answer, no page flag, no release pulled from an attachment', lastPrompt() === E.BILL_EXTRACT_PROMPT && rMail.pages === null && rMail.needs_review === false && rMail.problems.length === 0 && rMail.draft.release_number === null && rMail.draft.total_amount === 1300, rMail);
  var mailSrc = ['src/app/api/accounting/bills/inbound/route.js', 'src/app/api/accounting/bills/email-scan/route.js'].map(function (f) { return fs.readFileSync(path.join(root, f), 'utf8'); });
  check('the e-mail doors still call the reader with two arguments only (file, type) — page mode is not switched on there', /readBillFromBase64\(file\.b64, file\.content_type\)/.test(mailSrc[0]) && /readBillFromBase64\(b64, parts\[pi\]\.type\)/.test(mailSrc[1]) && mailSrc.every(function (s) { return s.indexOf('billPagesOnly') < 0; }));
  var rImg = await X.readBillFromBase64(B64, 'image/png', { pages: [1] });
  var before = sent.length;
  var rBad = [await X.readBillFromBase64(B64, 'application/pdf', { pages: [0] }), await X.readBillFromBase64(B64, 'application/pdf', { pages: 'two' }), await X.readBillFromBase64(B64, 'application/pdf', { pages: [] }), await X.readBillFromBase64(B64, 'application/pdf', { pages: [5], pageCount: 4 })];
  check('reader: malformed picked pages (0, words, none, past the end) and pages on a photo are refused BEFORE any AI call', rImg.status === 400 && rBad.every(function (b) { return b.status === 400 && !!b.error; }) && sent.length === before, rBad);
  nextAnswer = ans({ bill_pages: [2, 3], other_pages: [{ page: 1, kind: 'other' }, { page: 4, kind: 'email' }], attached_release: null, attached_release_page: null });
  var rF = await X.readBillFromBase64(B64, 'application/pdf', { pages: [2, 3], pageCount: 4 });
  check('reader: picked pages reach the reader as an instruction and come back labelled "chosen"', /says the bill is on pages 2-3\. Read ONLY those pages/.test(lastPrompt()) && rF.pages.status === 'chosen' && rF.pages.used.join() === '2,3', rF.pages);
  nextAnswer = ans({ bill_pages: [], attached_release: '1002-936' });
  var rU = await X.readBillFromBase64(B64, 'application/pdf', { billPagesOnly: true, pageCount: 4 });
  check('reader: pages unclear → still read (today\'s behaviour), flagged first among the reader flags, needs review, no release pulled', !rU.error && rU.needs_review === true && /PAGES NOT CONFIRMED/.test(rU.problems[0]) && rU.draft.release_number === null && rU.draft.total_amount === 1300, rU);
  nextAnswer = ans({ page_count: 6, other_pages: EX.other_pages.concat([{ page: 5, kind: 'other' }, { page: 6, kind: 'other' }]) });
  var rC = await X.readBillFromBase64(B64, 'application/pdf', { billPagesOnly: true, pageCount: 4 });
  check('reader: page count disagreeing with the browser count → unclear + needs review', rC.pages.status === 'unclear' && rC.needs_review === true && /counted 6 page\(s\) but the file has 4/.test(rC.pages.words));

  // ── 5. the REAL bills route
  nextAnswer = EX;
  var x1 = await call({ action: 'extract_bill', file_base64: B64, media_type: 'application/pdf', page_count: 4 });
  check('route extract_bill: answers the draft + the pages (used 1, left out 2-4) + release 1002-936 → Outbound', x1.ok && x1.pages && x1.pages.used.join() === '1' && x1.pages.ignored.length === 3 && x1.pages_need_review === false && x1.sorted.release_number === '1002-936' && x1.sorted.shipment_direction === 'outbound', x1);
  check('route extract_bill: nothing is saved by a read', db.t.vendor_bills.length === 0);
  var x2 = await call({ action: 'extract_bill', file_base64: B64, media_type: 'application/pdf', page_count: 4, pages: [9] });
  check('route extract_bill: a picked page that is not in the file is refused (400) with plain words', x2._status === 400 && /This file has 4 page\(s\) — page 9 is not in it/.test(x2.error), x2);
  nextAnswer = ans({ bill_pages: [4], other_pages: [{ page: 1, kind: 'other' }, { page: 2, kind: 'packing_list' }, { page: 3, kind: 'packing_list' }], attached_release: null });
  var x3 = await call({ action: 'extract_bill', file_base64: B64, media_type: 'application/pdf', page_count: 4, pages: [4] });
  check('route extract_bill: "use these pages instead" → pages picked by you', x3.ok && x3.pages.status === 'chosen' && x3.pages.used.join() === '4', x3.pages);
  // Codex 21:08 #1 at the real route: browser count 4, picked [1], reader says 6 pages and accounts only for page 2
  nextAnswer = ans({ page_count: 6, bill_pages: [1], other_pages: [{ page: 2, kind: 'packing_list' }] });
  var x4 = await call({ action: 'extract_bill', file_base64: B64, media_type: 'application/pdf', page_count: 4, pages: [1] });
  check('route extract_bill: picked page + contradictory answer → unclear, pages_need_review, release NOT copied, warning among the problems', x4.ok && x4.pages.status === 'unclear' && x4.pages_need_review === true && !x4.draft.release_number && !x4.sorted.release_number && /PAGES NOT CONFIRMED/.test((x4.problems || [])[0] || ''), x4);
  // Codex 21:08 #2 at the real route: browser count 1, reader answers for 4 pages
  nextAnswer = EX;
  var x5 = await call({ action: 'extract_bill', file_base64: B64, media_type: 'application/pdf', page_count: 1 });
  check('route extract_bill: one-page file with a contradictory answer → unclear, needs review, words and problems NOT empty, no release', x5.ok && x5.pages.status === 'unclear' && x5.pages_need_review === true && /PAGES NOT CONFIRMED/.test(x5.pages.words) && /PAGES NOT CONFIRMED/.test((x5.problems || [])[0] || '') && !x5.draft.release_number, x5);
  nextAnswer = ans({ bill_number: '27030', page_count: 1, bill_pages: [], other_pages: [], attached_release: null, attached_release_page: null });
  var x6 = await call({ action: 'extract_bill', file_base64: B64, media_type: 'application/pdf', page_count: 1 });
  check('route extract_bill: browser count 1 + explicit empty bill_pages → unclear, visible warning, pages_need_review', x6.ok && x6.pages.status === 'unclear' && x6.pages_need_review === true && /PAGES NOT CONFIRMED/.test(x6.pages.words) && /PAGES NOT CONFIRMED/.test((x6.problems || [])[0] || ''), x6);
  var n6 = db.t.vendor_bills.length; stored.length = 0;
  var g6 = await call({ action: 'ingest_bill_file', filename: 'one-page-no-bill.pdf', media_type: 'application/pdf', file_base64: B64, page_count: 1 });
  check('route several-files import: the same answer → ZERO bills created, ZERO files stored, 🚩 reason', g6.skipped === true && g6.created !== true && g6.pages_need_review === true && db.t.vendor_bills.length === n6 && stored.length === 0, [g6, db.t.vendor_bills.length, stored.length]);
  nextAnswer = ans({ bill_number: '27031', page_count: 1, bill_pages: [1], other_pages: { page: 1, kind: 'another_bill' }, attached_release: null, attached_release_page: null });
  var x8 = await call({ action: 'extract_bill', file_base64: B64, media_type: 'application/pdf', page_count: 1 });
  var n8 = db.t.vendor_bills.length; stored.length = 0;
  var g8 = await call({ action: 'ingest_bill_file', filename: 'one-page-odd-list.pdf', media_type: 'application/pdf', file_base64: B64, page_count: 1 });
  check('real routes (Codex 21:43): browser count 1, bill_pages [1], other_pages an OBJECT naming page 1 another bill → extract: unclear + review + warning; several-files import: ZERO bills, ZERO files stored', x8.ok && x8.pages.status === 'unclear' && x8.pages_need_review === true && /PAGES NOT CONFIRMED/.test((x8.problems || [])[0] || '') && g8.skipped === true && g8.pages_need_review === true && db.t.vendor_bills.length === n8 && stored.length === 0, [x8.pages, g8]);
  nextAnswer = { vendor_name: 'One Page Co', bill_number: 'OP-1', bill_date: '2026-11-02', total_amount: 55, currency: 'USD', bill_type: 'supplier', lines: [] }; // says NOTHING about pages
  var g7 = await call({ action: 'ingest_bill_file', filename: 'one-page-plain.pdf', media_type: 'application/pdf', file_base64: B64, page_count: 1 });
  var x7 = await call({ action: 'extract_bill', file_base64: B64, media_type: 'application/pdf', page_count: 1 });
  check('the intended fallback, apart: one-page file, reader silent about pages → imported normally, no warning', g7.created === true && g7.pages_need_review === false && x7.pages.status === 'all' && x7.pages.words === '' && x7.pages_need_review === false, [g7, x7.pages]);
  db.t.vendor_bills = db.t.vendor_bills.filter(function (b) { return b.bill_number !== 'OP-1'; });
  nextAnswer = EX;
  var n5 = db.t.vendor_bills.length; stored.length = 0;
  var g0 = await call({ action: 'ingest_bill_file', filename: 'one-page-odd.pdf', media_type: 'application/pdf', file_base64: B64, page_count: 1 });
  check('route several-files import: the same one-page contradiction → NOT imported, 🚩 reason given, nothing stored', g0.skipped === true && g0.pages_need_review === true && /NOT imported — ⚠ PAGES NOT CONFIRMED/.test(g0.reason) && /ON ITS OWN/.test(g0.reason) && db.t.vendor_bills.length === n5 && stored.length === 0, g0);

  nextAnswer = EX; stored.length = 0;
  var g1 = await call({ action: 'ingest_bill_file', filename: 'Invoice 27021.pdf', media_type: 'application/pdf', file_base64: B64, page_count: 4 });
  var row = db.t.vendor_bills[0] || {};
  check('route bulk import: the example becomes ONE pending bill from the invoice page (AMB #27021, $1,300), release from the packing list', g1.created === true && db.t.vendor_bills.length === 1 && row.vendor_name === 'AMB Logistic' && row.bill_number === '27021' && Number(row.total_amount) === 1300 && row.validation_status === 'pending' && row.release_number === '1002-936', [g1, row]);
  check('route bulk import: the bill notes say which pages were used and where the release came from', /Bill taken from page 1 of 4/.test(row.notes || '') && /taken from the attached packing list/.test(row.notes || ''), row.notes);
  check('route bulk import: the WHOLE file is stored as the bill\'s document (same bytes as uploaded) and linked', stored.length === 1 && stored[0].bytes === Buffer.from(B64, 'base64').length && stored[0].bucket === 'bills-private' && row.attachment_path === stored[0].path, stored);
  var g2 = await call({ action: 'ingest_bill_file', filename: 'Invoice 27021 again.pdf', media_type: 'application/pdf', file_base64: B64, page_count: 4 });
  check('duplicate guard unchanged: the same bill again is skipped, not added', g2.skipped === true && db.t.vendor_bills.length === 1, g2);
  nextAnswer = ans({ bill_number: '27022', bill_pages: [] });
  var st3 = stored.length; // (the duplicate above was uploaded before the existing guard refused it — behaviour from before this build)
  var g3 = await call({ action: 'ingest_bill_file', filename: 'mixed.pdf', media_type: 'application/pdf', file_base64: B64, page_count: 4 });
  check('route several-files import: pages unclear → NO bill is made (nobody is looking at the pages there); the answer says to import the file on its own; nothing stored', g3.skipped === true && g3.created !== true && g3.pages_need_review === true && /NOT imported/.test(g3.reason) && db.t.vendor_bills.length === 1 && stored.length === st3, [db.t.vendor_bills.length, stored.length, st3, g3.created, g3.skipped]);
  nextAnswer = ans({ bill_number: '27023', bill_pages: [1], other_pages: [{ page: 2, kind: 'another_bill' }, { page: 3, kind: 'packing_list' }, { page: 4, kind: 'email' }], attached_release: null, attached_release_page: null });
  var g3b = await call({ action: 'ingest_bill_file', filename: 'two-invoices.pdf', media_type: 'application/pdf', file_base64: B64, page_count: 4 });
  nextAnswer = ans({ bill_number: '27024', release_number: '1002-900' });
  var g3c = await call({ action: 'ingest_bill_file', filename: 'release-differs.pdf', media_type: 'application/pdf', file_base64: B64, page_count: 4 });
  check('route several-files import: a second invoice in the file, or a release that disagrees with the attachment → not imported either', g3b.skipped === true && g3b.pages_need_review === true && g3c.skipped === true && g3c.pages_need_review === true && db.t.vendor_bills.length === 1, [g3b, g3c]);
  nextFail = 'overloaded'; var n0 = db.t.vendor_bills.length;
  var g4 = await call({ action: 'ingest_bill_file', filename: 'fail.pdf', media_type: 'application/pdf', file_base64: B64, page_count: 4 });
  nextFail = null; nextAnswer = 'sorry, I cannot read this';
  var g5 = await call({ action: 'ingest_bill_file', filename: 'junk.pdf', media_type: 'application/pdf', file_base64: B64, page_count: 4 });
  check('a failed read (AI error or no usable answer) never creates a bill', g4.skipped === true && g5.skipped === true && db.t.vendor_bills.length === n0, [g4, g5]);

  // ── 6. wiring that only shows in the source
  var U = require(path.join(root, 'src/lib/bill-pages-ui.js'));
  var React = require('react'); var RDS = require('react-dom/server');
  var Box = require(path.join(root, 'src/components/BillPagesBox.jsx')).default;
  function html(state, reading) { return RDS.renderToStaticMarkup(React.createElement(Box, { state: state, reading: !!reading, onPick: function () {}, onConfirm: function () {}, onReread: function () {} })); }
  var jOk = { pages: D(EX, { realCount: 4 }), pages_need_review: false, problems: [] };
  var stOk = U.importPagesState(jOk, 4);
  var hOk = html(stOk);
  check('screen box (rendered): normal example → green, sentence shown, 4 page ticks with page 1 ticked and kinds named, "Use these pages instead", NO confirm tick', /data-bill-pages-box="ok"/.test(hOk) && /Bill taken from page 1 of 4/.test(hOk) && (hOk.match(/type="checkbox"/g) || []).length === 4 && (hOk.match(/checked=""/g) || []).length === 1 && /Page 2 · packing list/.test(hOk) && /Page 4 · e-mail/.test(hOk) && /Use these pages instead/.test(hOk) && !/data-pages-confirm/.test(hOk), hOk);
  check('screen box (rendered): says the reader is only TOLD to leave pages out and that the whole file stays attached', /is TOLD which pages to leave out — it is not proof/.test(hOk) && /The WHOLE file \(<!-- -->4<!-- --> <!-- -->pages<!-- -->\) stays attached|The WHOLE file \(4 pages\) stays attached/.test(hOk), hOk);
  var jOne = { pages: D({ page_count: 1, bill_pages: [], other_pages: [] }, { realCount: 1 }), pages_need_review: true, problems: [] }; jOne.problems = [jOne.pages.words, 'Vendor could not be read — fill it in.'];
  var stOne = U.importPagesState(jOne, 1);
  var hOne = html(stOne);
  check('screen box (rendered): ONE-page file with an unconfirmed answer → the red warning box IS shown, with the confirm tick (unticked), and no page ticks', !!stOne && /data-bill-pages-box="review"/.test(hOne) && /PAGES NOT CONFIRMED/.test(hOne) && /data-pages-confirm="1"/.test(hOne) && !/data-pages-confirm="1" checked/.test(hOne) && !/Use these pages instead/.test(hOne) && /Save stays blocked until this is ticked/.test(hOne), hOne);
  check('screen: the page sentence is not repeated among the other reader notes; other notes stay', U.problemsBesidesPages(jOne, stOne).join('|') === 'Vendor could not be read — fill it in.');
  check('screen: a valid one-page file or a photo shows no box', U.importPagesState({ pages: D({}, { realCount: 1 }) }, 1) === null && U.importPagesState({ pages: null }, null) === null && html(null) === '');
  var form = { _imported: true, vendor_name: 'AMB Logistic', notes: 'Drayage' };
  var gate1 = U.importSaveGate(form, stOne);
  check('Save gate (run): pages not confirmed and the box not ticked → BLOCKED with the red message; the bill is untouched', gate1.blocked === true && /NOT SAVED — the pages of this file are not confirmed/.test(gate1.message) && gate1.notes === 'Drayage');
  var stTicked = Object.assign({}, stOne, { confirmed: true });
  var gate2 = U.importSaveGate(form, stTicked);
  check('Save gate (run): ticked → allowed, and the confirmation is written into the notes that are saved (once, also on a second press)', gate2.blocked === false && gate2.notes === 'Drayage · ' + U.PAGES_CONFIRMED_NOTE && U.importSaveGate(Object.assign({}, form, { notes: gate2.notes }), stTicked).notes === gate2.notes, gate2);
  check('Save gate (run): the ticked box is rendered ticked', /data-pages-confirm="1" checked=""|checked="" data-pages-confirm="1"/.test(html(stTicked)) || /data-pages-confirm="1"[^>]*checked/.test(html(stTicked)), html(stTicked));
  var stAgain = U.importPagesState(jOne, 1); var stNew = U.importPagesState({ pages: D(ans({ bill_pages: [] }), { realCount: 4 }), pages_need_review: true }, 4);
  check('Save gate (run): reading again, or reading another file, starts UNTICKED again → blocked again', stAgain.confirmed === false && stNew.confirmed === false && U.importSaveGate(form, stAgain).blocked === true && U.importSaveGate(form, stNew).blocked === true);
  check('Save gate (run): not gated — a confirmed-pages import, a typed bill, an existing bill being edited', U.importSaveGate(form, stOk).blocked === false && U.importSaveGate(form, stOk).notes === 'Drayage' && U.importSaveGate({ vendor_name: 'Typed' }, stOne).blocked === false && U.importSaveGate({ _imported: true, id: 'b9' }, stOne).blocked === false && U.importSaveGate(form, null).blocked === false);
  var pRel = E.applyAttachedRelease({ release_number: null }, D(EX, { realCount: 4 }));
  check('where the release came from is kept in the notes of the bill being saved', U.notesWithReleaseSource('Drayage', pRel) === 'Drayage · Release 1002-936 taken from an attached page (page 2), not printed on the bill itself.' && U.notesWithReleaseSource('Drayage', stOk.pages) === 'Drayage' && U.notesWithReleaseSource(null, null) === '');
  check('picked pages come out sorted', U.pickedPages({ pick: { 3: true, 1: true, 2: false } }).join() === '1,3');
  var tab = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
  check('screen wiring: BillsTab imports what it calls and uses the SAME gate, state and box that were run above', /import \{ pdfPageCountFromBase64 \} from '\.\.\/lib\/pdf-page-count-browser'/.test(tab) && /import \{ importPagesState, pickedPages, problemsBesidesPages, notesWithReleaseSource, importSaveGate \} from '\.\.\/lib\/bill-pages-ui'/.test(tab) && /import BillPagesBox from '\.\/BillPagesBox'/.test(tab) && /var pgGate = importSaveGate\(d, importPages\);\s*if \(pgGate\.blocked\) \{ toast\.error\(pgGate\.message\); return; \}\s*d\.notes = pgGate\.notes;/.test(tab) && /setImportPages\(importPagesState\(j, pageCount\)\)|var pgSt = importPagesState\(j, pageCount\);[^\n]*\s*setImportPages\(pgSt\);/.test(tab) && tab.indexOf('<BillPagesBox state={importPages}') > 0 && tab.indexOf('{pagesBox}') > 0 && /setReading\(true\); setImportPages\(null\);/.test(tab));
  var srv = fs.readFileSync(path.join(root, 'src/lib/bill-extract-server.js'), 'utf8');
  check('server lib is not a client module (no "use client")', !/^\s*['"]use client['"]/.test(srv) && !/^\s*['"]use client['"]/.test(fs.readFileSync(path.join(root, 'src/lib/bill-extract.js'), 'utf8')));
  console.log('\nVV bill pages: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
