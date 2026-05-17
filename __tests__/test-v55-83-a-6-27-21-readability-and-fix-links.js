// v55.83-A.6.27.21 — Treasury readability + AI Review fixes
//
// Nine issues addressed this build. See WhatsNewWidget entry for full
// summary. Tests below lock the user-visible behavior:
//   #1 Header readability (inline color styles)
//   #2 Close X button + Esc key
//   #3 Robust JSON parsing in API + UI defensive unwrap
//   #4 AI result cards use white bg + dark text
//   #5 AI error is big + bold + red panel
//   #6 Finding titles bigger + bolder
//   #7 Metric cards light bg + dark text
//   #8 Recommended action + affected records on white
//   #9 Fix Links button reliability

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var modal = read('src/components/AccountingAuditorModal.jsx');
var apiRoute = read('src/app/api/accountant/route.js');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ── Fix #1: Header readability ─────────────────────────────────────
ok('1a: header background switched to solid dark indigo (#3730a3)',
  /background: '#3730a3'/.test(modal));
ok('1b: header title uses inline white color',
  /<span className="text-lg font-extrabold" style=\{\{ color: '#ffffff' \}\}>AI Accountant Review/.test(modal));
ok('1c: old light bg-gradient header is GONE',
  !/bg-gradient-to-br from-indigo-100 to-blue-100/.test(modal));

// ── Fix #2: Close button + Esc key ─────────────────────────────────
ok('2a: close X button is 40x40 with white bg and dark text',
  /aria-label="Close"[\s\S]{0,500}width: 40, height: 40/.test(modal));
ok('2b: close X has shadow for visibility',
  /aria-label="Close"[\s\S]{0,500}boxShadow:/.test(modal));
ok('2c: Esc key handler installed',
  /window\.addEventListener\('keydown', onKey\)/.test(modal));
ok('2d: Esc handler calls onClose',
  /if \(e\.key === 'Escape'[\s\S]{0,200}onClose\(\)/.test(modal));
ok('2e: Esc handler cleans up on unmount',
  /return function \(\) \{ window\.removeEventListener\('keydown', onKey\); \}/.test(modal));
ok('2f: useEffect imported',
  /import .{0,200}useEffect.{0,200}from 'react'/.test(modal));

// ── Fix #3: Robust JSON parsing ────────────────────────────────────
ok('3a: API route has fallback brace-extraction parser',
  /first complete JSON object by finding matching braces/.test(apiRoute));
ok('3b: API route logs parse failures to console.error',
  /console\.error\('\[accountant\] JSON parse failed/.test(apiRoute));
ok('3c: API route handles no-JSON-found case explicitly',
  /No JSON object found in response/.test(apiRoute));
ok('3d: API system prompt enforces strict JSON-only output',
  /The very first character of your response MUST be \{/.test(apiRoute));
ok('3e: API system prompt prohibits markdown fences',
  /no markdown code fences/.test(apiRoute));
ok('3f: UI defensive unwrap if summary field looks like JSON',
  /if \(json\.en && typeof json\.en\.summary === 'string' && json\.en\.summary\.trim\(\)\.startsWith\('\{'\)\)/.test(modal));

// ── Fix #4: AI result cards use white bg + dark text ───────────────
ok('4a: VERDICT card uses bg-white with text-slate-900',
  /bg-white rounded-lg p-4 border-2 border-indigo-500[\s\S]{0,300}VERDICT[\s\S]{0,300}text-base font-extrabold text-slate-900 leading-relaxed/.test(modal));
ok('4b: SUMMARY card uses bg-white with dark text',
  /bg-white rounded-lg p-4 border-2 border-indigo-500[\s\S]{0,1500}SUMMARY[\s\S]{0,500}text-slate-900 font-medium/.test(modal));
ok('4c: TOP ACTIONS card uses bg-white with dark text',
  /bg-white rounded-lg p-4 border-2 border-indigo-500[\s\S]{0,3000}TOP ACTIONS[\s\S]{0,500}text-slate-900 font-semibold/.test(modal));
ok('4d: NO bg-slate-900 wrappers for AI result text anymore',
  !/aiResult\.en\.verdict[\s\S]{0,300}bg-slate-900/.test(modal) &&
  !/aiResult\.en\.summary[\s\S]{0,300}bg-slate-900/.test(modal) &&
  !/aiResult\.en\.topActions[\s\S]{0,300}bg-slate-900/.test(modal));

// ── Fix #5: AI error is big + bold + red panel ─────────────────────
ok('5a: AI error message is text-base font-extrabold',
  /aiError && \(\s*<div className="mt-2 text-base text-red-700 font-extrabold/.test(modal));
ok('5b: AI error has red background + border for visibility',
  /aiError[\s\S]{0,300}bg-red-50 border-2 border-red-300 rounded-lg/.test(modal));

// ── Fix #6: Finding titles bigger + bolder ─────────────────────────
ok('6a: finding title English: text-base font-extrabold',
  /span className=\{'text-base font-extrabold ' \+ c\.text\}>\{f\.titleEn\}/.test(modal));
ok('6b: finding title Arabic: text-base font-extrabold',
  /text-base font-extrabold mt-1 ' \+ c\.text/.test(modal));
ok('6c: impact line is text-sm font-extrabold with 💰 emoji',
  /text-sm text-slate-900 mt-1\.5 font-extrabold[^"]*">💰 Impact:/.test(modal));
ok('6d: finding description: text-base font-semibold (not text-sm font-medium)',
  /text-base text-slate-900 font-semibold leading-relaxed[^"]*">\{f\.descEn\}/.test(modal));

// ── Fix #7: Metric cards use light bg + dark text ──────────────────
ok('7a: Treasury Net card switched from bg-slate-800 to bg-slate-50',
  /Treasury Net[\s\S]{0,400}bg-slate-50/.test(modal) &&
  !/Treasury Net[\s\S]{0,400}bg-slate-800/.test(modal));
ok('7b: metric labels use text-slate-700 (dark on light)',
  /text-\[11px\] text-slate-700 font-extrabold/.test(modal));
ok('7c: metric values use dark color variants (-700 not -300)',
  /text-emerald-700/.test(modal) && /text-amber-700/.test(modal) &&
  /text-blue-700/.test(modal) && /text-indigo-700/.test(modal));

// ── Fix #8: Recommended action + affected records ──────────────────
ok('8a: Recommended Action uses bg-white + dark text',
  /bg-white rounded-lg p-3 border-2 border-emerald-400[\s\S]{0,300}text-emerald-700[\s\S]{0,200}RECOMMENDED ACTION/.test(modal));
ok('8b: Affected Records uses bg-white + dark text',
  /bg-white rounded-lg p-3 border-2 border-amber-400[\s\S]{0,300}text-amber-700[\s\S]{0,200}AFFECTED RECORDS/.test(modal));

// ── Fix #9: Fix Links button reliability ──────────────────────────
ok('9a: Fix Links button has fixLinksBusy state',
  /const \[fixLinksBusy, setFixLinksBusy\] = useState\(false\)/.test(page));
ok('9b: button is disabled while busy',
  /disabled=\{fixLinksBusy\}[\s\S]{0,8000}🔗 Fix Links/.test(page));
ok('9c: button label changes to "Working..." while busy',
  /\{fixLinksBusy \? '⏳ Working\.\.\.' : '🔗 Fix Links'\}/.test(page));
ok('9d: console.log fires on button press',
  /\[fix-links\] button pressed/.test(page));
ok('9e: info toast fires BEFORE the scan starts',
  /toast\.info\('🔍 Scanning treasury for missing invoice links/.test(page));
ok('9f: "no missing links" path uses loud success toast',
  /toast\.success\('✓ No missing links found/.test(page));
ok('9g: cancel from confirm dialog produces explicit toast',
  /toast\.info\('Cancelled — no changes made\.'\)/.test(page));
ok('9h: errors are caught + toasted + logged explicitly',
  /catch \(err\) \{\s*console\.error\('\[fix-links\] failed:'/.test(page));
ok('9i: setFixLinksBusy(false) fires in finally block',
  /finally \{\s*setFixLinksBusy\(false\);\s*\}/.test(page));

// ── Regression guards on previous work ───────────────────────────
ok('R1: A.6.27.20 draftInstruments still in code',
  /formData\.draftInstruments \|\| \[\]/.test(page));
ok('R2: A.6.27.19 findMatchingInstruments helper still intact',
  /const findMatchingInstruments = \(invoice, amt\) =>/.test(page));
ok('R3: A.6.27.19 handleDeleteTreasury still reverts linked instrument',
  /linkedCheckId[\s\S]{0,1500}status: 'pending'/.test(page));
ok('R4: A.6.27.17 popup state still intact',
  /const \[pendingInstrumentMatch, setPendingInstrumentMatch\] = useState\(null\)/.test(page));
ok('R5: recalcInvoiceCollected still exists',
  /const recalcInvoiceCollected = async \(invoiceId\)/.test(page));
ok('R6: Fix Links button still calls dbUpdate and recalcInvoiceCollected',
  /linked_invoice_id: inv\.id[\s\S]{0,400}await recalcInvoiceCollected\(invId\)/.test(page));

// ── Version stamp ────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.21',
  /BUILD v55\.83-A\.6\.27\.21/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.21 tests passed');
