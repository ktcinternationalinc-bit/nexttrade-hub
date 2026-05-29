/* v72 HOTFIX 14 — Three fixes from Max's screenshot review:
 *   1. Color scheme reverted. Per Max: ONLY invoice rows get blue/orange on the
 *      description + amount. Everything else (payments, offsets, headers, totals,
 *      summary blocks, bottom cards) goes back to emerald/red.
 *   2. Net Position card redesigned. Was a tall stacked mess with multiple amber
 *      warning banners. Now a single horizontal compact card.
 *   3. AnimatedPortrait has fallback when portrait file is missing (404) — shows
 *      persona initial on a colored circle so Max sees the problem.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var ledger = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-ledger.js'), 'utf8');
var oa     = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');
var exp    = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-export.js'), 'utf8');
var ap     = fs.readFileSync(path.join(__dirname, '..', 'src/components/AnimatedPortrait.jsx'), 'utf8');

console.log('\n── Color: invoices ONLY get blue/orange ──');

ok('A1: sales_invoice has BLUE descCls + amountCls (text-blue-700)',
  /sales_invoice:[\s\S]{0,500}descCls: 'text-blue-700'[\s\S]{0,100}amountCls: 'text-blue-700'/.test(ledger));

ok('A2: vendor_bill has PURPLE descCls + amountCls (HOTFIX 15: text-purple-700, was orange)',
  /vendor_bill:[\s\S]{0,800}descCls: 'text-purple-700'[\s\S]{0,100}amountCls: 'text-purple-700'/.test(ledger));

ok('A3: payment_received has NO color (descCls: null, amountCls: null)',
  /payment_received:[\s\S]{0,500}descCls: null,[\s\S]{0,30}amountCls: null/.test(ledger));

ok('A4: payment_sent has NO color (descCls: null, amountCls: null)',
  /payment_sent:[\s\S]{0,500}descCls: null,[\s\S]{0,30}amountCls: null/.test(ledger));

ok('A5: NO row-level background tint on invoices (rowCls: null for invoices and payments)',
  /sales_invoice:[\s\S]{0,900}rowCls: null/.test(ledger) &&
  /vendor_bill:[\s\S]{0,900}rowCls: null/.test(ledger));

console.log('\n── Column headers reverted to emerald/red ──');

ok('B1: they_owe_us header uses bg-emerald-50 (HOTFIX 30 i18n: renamed from AR Side)',
  /text-emerald-700[\s\S]{0,400}they_owe_us/.test(oa));

ok('B2: we_owe_them header uses bg-red-50 (HOTFIX 30 i18n: renamed from AP Side)',
  /text-red-700[\s\S]{0,400}we_owe_them/.test(oa));

ok('B3: they_owe_us title text emerald-700 (HOTFIX 33 — lightened from emerald-900 since no bg)',
  /text-emerald-700[\s\S]{0,400}they_owe_us/.test(oa));

ok('B4: we_owe_them title text red-700 (HOTFIX 33 — lightened from red-900 since no bg)',
  /text-red-700[\s\S]{0,400}we_owe_them/.test(oa));

console.log('\n── Per-row cells reverted, color from typeMeta only ──');

ok('C1: AR Side cell uses typeMeta.amountCls when invoice, default emerald-700 otherwise (HOTFIX 33)',
  /typeMeta\.amountCls \|\| 'text-emerald-700'/.test(oa));

ok('C2: AP Side cell uses typeMeta.amountCls when invoice, default red otherwise',
  /typeMeta\.amountCls \|\| 'text-red-700'/.test(oa));

ok('C3: NO unconditional bg-blue-50/40 or bg-orange-50/40 on per-row cells',
  !/bg-blue-50\/40/.test(oa) && !/bg-orange-50\/40/.test(oa));

console.log('\n── Summary block + bottom cards reverted ──');

ok('D1: Summary Total AR row uses bg-emerald-900/40 text-emerald-100',
  /bg-emerald-900\/40 text-emerald-100/.test(oa));

ok('D2: Summary Total AP row uses bg-red-900/40 text-red-100',
  /bg-red-900\/40 text-red-100/.test(oa));

ok('D3: Net Position cls reverted to emerald-300/red-300',
  /net > 0\.005 \? 'text-emerald-300' : net < -0\.005 \? 'text-red-300'/.test(oa));

ok('D4: Bottom grand-total Open AR card uses bg-emerald-700',
  /bg-emerald-700 text-white rounded[\s\S]{0,300}Total Open AR/.test(oa));

ok('D5: Bottom grand-total Open AP card uses bg-red-700',
  /bg-red-700 text-white rounded[\s\S]{0,300}Total Open AP/.test(oa));

ok('D6: Net Balance card uses emerald/red flip (not blue/orange)',
  /t\.balance >= 0 \? 'bg-emerald-800' : 'bg-red-800'/.test(oa));

console.log('\n── Print export: invoice color, not blanket ──');

ok('E1: Print export uses invoiceColor only for invoice/bill rows (default emerald/red for others)',
  /invoiceColor = null;[\s\S]{0,300}sales_invoice/.test(exp));

ok('E2: Print export AR cell uses arColor variable (HOTFIX 30 — color by transaction_type, defaults to emerald-700)',
  /var arColor = '#15803d'/.test(exp) && /invoiceColor \|\| arColor/.test(exp));

ok('E3: Print export AP cell uses apColor variable (HOTFIX 30 — vendor_bill red, payment_sent green)',
  /var apColor = '#b91c1c'/.test(exp) && /invoiceColor \|\| apColor/.test(exp) &&
  /payment_sent[\s\S]{0,80}apColor = '#15803d'/.test(exp));

ok('E4: Print export computes invoiceColor: blue for sales_invoice, PURPLE for vendor_bill (HOTFIX 15)',
  /sales_invoice'[\s\S]{0,300}'#1d4ed8'[\s\S]{0,300}vendor_bill'[\s\S]{0,300}'#7e22ce'/.test(exp));

ok('E5: Print export description gets invoice color when sales/bill',
  /descColorStyle = invoiceColor \? ' style="color:' \+ invoiceColor/.test(exp));

console.log('\n── Net Position card redesigned ──');

ok('F1: Card uses single horizontal flex row (items-center justify-between)',
  /Net Position \(USD\)[\s\S]{0,200}flex items-center justify-between/.test(oa) ||
  /bgCls \+ ' text-white rounded-lg[\s\S]{0,100}flex items-center justify-between/.test(oa));

ok('F2: Net Position card no longer wraps with amber border',
  !/Net Position[\s\S]{0,2000}border-2 border-amber-400/.test(oa));

ok('F3: NO separate amber banner under the card for missing rate',
  !/bg-amber-100 text-amber-900[\s\S]{0,300}Missing FX rate/.test(oa));

ok('F4: Missing rate shown as subtle subtitle inside the card (HOTFIX 15 generalized message)',
  /Some balances excluded — FX rate not available/.test(oa));

ok('F5: NO chip row beneath the card (just a centered math line)',
  !/Per-currency contribution chips/.test(oa));

console.log('\n── Portrait fallback when file missing ──');

ok('G1: AnimatedPortrait img has onError handler',
  /onError=\{function \(e\)/.test(ap));

ok('G2: Fallback shows persona initial on colored background',
  /textContent = \(alt \|\| '\?'\)\.charAt\(0\)\.toUpperCase\(\)/.test(ap));

ok('G3: Fallback includes diagnostic title pointing to /public/avatars/',
  /Upload to \/public\/avatars\/ to enable face animation/.test(ap));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 14 — colors restricted to invoices, Net Position card clean, portrait fallback');
console.log('══════════════════════════════════════════════');
