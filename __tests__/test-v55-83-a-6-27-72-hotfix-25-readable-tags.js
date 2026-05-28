/* v72 HOTFIX 25 — Max May 27 2026 screenshot, with EARNED frustration:
 *
 *   "For the hundredth fucking time. Look at the fucking fonts with the
 *   background. Tags are... I cannot read them, motherfuckers. I mean,
 *   you make the same fucking mistakes every goddamn time. Don't make
 *   the font white on a light background or a light font on a light
 *   background like these buttons here."
 *
 * Root cause: type tags on the OpenAccountsTab ledger used the pattern
 * `bg-X-100 text-X-900` — pale background + dark text. That pattern WORKS
 * on a light-themed page. The portal's main layout is dark, which made
 * the tags wash out completely.
 *
 * Fix: all status pills now use solid saturated bg (-600/-700) + white text
 * + ring-1 for depth. Readable on ANY surface, light or dark.
 *
 * RULE GOING FORWARD (pinned by this test so I can't backslide):
 *   - Status badges/pills NEVER use bg-X-100 or bg-X-200 with text-X-700/800/900
 *   - Status badges/pills ALWAYS use bg-X-600 or darker with text-white
 *   - This applies to type tags (Sales Invoice / Vendor Bill / Payment Sent
 *     / Payment Received / Credit/Adjustment / Offset) AND the paid chip
 *     AND the prepaid credit cards
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var ledger = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-ledger.js'), 'utf8');
var oa = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');

console.log('\n── Type tag pills: solid saturated bg + white text ──');

ok('A1: sales_invoice pillCls uses bg-blue-600 + text-white (not pale -100/-900)',
  /sales_invoice:[\s\S]{0,800}pillCls: 'bg-blue-600 text-white/.test(ledger));

ok('A2: vendor_bill pillCls uses bg-purple-600 + text-white',
  /vendor_bill:[\s\S]{0,800}pillCls: 'bg-purple-600 text-white/.test(ledger));

ok('A3: payment_received pillCls uses bg-emerald-600 + text-white',
  /payment_received:[\s\S]{0,500}pillCls: 'bg-emerald-600 text-white/.test(ledger));

ok('A4: payment_sent pillCls uses bg-rose-600 + text-white (was bg-red-100)',
  /payment_sent:[\s\S]{0,500}pillCls: 'bg-rose-600 text-white/.test(ledger));

ok('A5: credit_adjustment pillCls uses bg-slate-700 + text-white',
  /credit_adjustment:[\s\S]{0,500}pillCls: 'bg-slate-700 text-white/.test(ledger));

ok('A6: offset pillCls uses bg-violet-600 + text-white',
  /offset:[\s\S]{0,500}pillCls: 'bg-violet-600 text-white/.test(ledger));

console.log('\n── All pills include ring-1 + shadow-sm for depth ──');

ok('B1: All pillCls strings include "ring-1" (subtle border for depth)',
  (function () {
    var matches = ledger.match(/pillCls: '[^']+'/g) || [];
    return matches.length >= 6 && matches.every(function (m) { return /ring-1/.test(m); });
  })());

ok('B2: All pillCls strings include "shadow-sm" (lift off background)',
  (function () {
    var matches = ledger.match(/pillCls: '[^']+'/g) || [];
    return matches.length >= 6 && matches.every(function (m) { return /shadow-sm/.test(m); });
  })());

console.log('\n── NO pillCls uses the banned pale-on-pale pattern ──');

ok('C1: NO pillCls uses bg-X-100 (the old pale-bg-dark-text trap)',
  (function () {
    var matches = ledger.match(/pillCls: '[^']+'/g) || [];
    return matches.every(function (m) { return !/bg-\w+-100/.test(m) && !/bg-\w+-200/.test(m); });
  })());

ok('C2: NO pillCls uses text-X-900 / text-X-800 / text-X-700 (no dark-on-pale)',
  (function () {
    var matches = ledger.match(/pillCls: '[^']+'/g) || [];
    return matches.every(function (m) {
      return !/text-\w+-900/.test(m) && !/text-\w+-800/.test(m) && !/text-\w+-700/.test(m);
    });
  })());

console.log('\n── "✓ paid" chip in the Open Balance column ──');

ok('D1: paid chip is now a solid emerald-600 pill with white text + ring',
  /bg-emerald-600 text-white ring-1 ring-emerald-700\/50 shadow-sm[\s\S]{0,200}✓ paid/.test(oa));

ok('D2: paid chip is no longer a bare text-emerald-600 span on amber-50 (the washed-out version)',
  !/<span className="text-emerald-600 text-\[10px\]" title="Fully settled">✓ paid<\/span>/.test(oa));

console.log('\n── Prepaid credit cards (per-account summary) ──');

ok('E1: "Their credit (prepaid)" card uses bg-emerald-700 + text-white (was bg-emerald-50 + text-emerald-900)',
  /bg-emerald-700 border border-emerald-800[\s\S]{0,400}Their credit \(prepaid\)/.test(oa) &&
  /Their credit \(prepaid\)[\s\S]{0,300}text-white/.test(oa));

ok('E2: "Our credit (prepaid)" card uses bg-red-700 + text-white',
  /bg-red-700 border border-red-800[\s\S]{0,400}Our credit \(prepaid\)/.test(oa) &&
  /Our credit \(prepaid\)[\s\S]{0,300}text-white/.test(oa));

ok('E3: Prepaid card amounts no longer use text-emerald-900 / text-red-900 (washed out)',
  !/text-sm font-mono font-extrabold text-emerald-900">\{fmtNum\(b\.theirPrepaid\)\}/.test(oa) &&
  !/text-sm font-mono font-extrabold text-red-900">\{fmtNum\(b\.ourPrepaid\)\}/.test(oa));

console.log('\n── HOTFIX 25 comment trail ──');

ok('F1: ledger has HOTFIX 25 comment explaining the bg-X-100/text-X-900 problem',
  /HOTFIX 25/.test(ledger) && /pale|wash|contrast/i.test(ledger.match(/HOTFIX 25[\s\S]{0,800}/)[0]));

ok('F2: HOTFIX 25 comment states the RULE for future code',
  /HOTFIX 25/.test(ledger) &&
  (/badge pills NEVER use bg-X-100/i.test(ledger) || /always use[\s\S]{0,200}bg-X-600/i.test(ledger)));

ok('F3: OpenAccountsTab references HOTFIX 25 for the paid chip fix',
  /HOTFIX 25[\s\S]{0,300}paid chip/.test(oa));

ok('F4: OpenAccountsTab references HOTFIX 25 for the prepaid card fix',
  /HOTFIX 25[\s\S]{0,300}prepaid card/i.test(oa));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 25 — all status pills + paid chip + prepaid cards readable on ANY background');
console.log('══════════════════════════════════════════════');
