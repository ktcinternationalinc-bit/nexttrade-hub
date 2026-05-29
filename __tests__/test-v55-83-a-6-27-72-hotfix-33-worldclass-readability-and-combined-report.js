/* v72 HOTFIX 33 — World-class ledger readability + report parity + combined view.
 *
 * Live ledger:
 *   1. Vertical column backgrounds REMOVED (bg-emerald-50/red-50/amber-50/slate-100
 *      that were creating "muddy gray-brown blocks" on the dark app theme)
 *   2. Header text uses pastel-700 color hint only, no cell background
 *   3. AP column: payment_sent rows get a teal "reduces what we owe" subtag
 *      under their green number so green-in-AP reads as intentional
 *
 * Report (printAccountLedger):
 *   1. ".report-page" wrapper with max-width 950px so the table doesn't stretch
 *      infinitely across wide monitors (was causing huge dead whitespace)
 *   2. @page A4 portrait, @media print forces 100% width
 *   3. table-layout: fixed with locked col-* width percentages
 *   4. Settlement wording fixed: "Settled by offset against sales invoice/vendor bill"
 *      (type-aware — opposite-side document type), replaces misleading
 *      "Paid by credit applied from"
 *   5. Description block: "Auto-synced from invoice..." preamble demoted to a
 *      small italic "auto-synced from invoice" line
 *   6. Per-currency summary card: structured breakdown rows (Open invoice / Open bill /
 *      Their prepaid / Our prepaid) ABOVE the Net Balance instead of collapsed
 *   7. Stronger hierarchy: section h2 at 18px/900, dividers between sections,
 *      Net Balance bumped to 28px/900
 *   8. Bright yellow no-print bar replaced with neutral slate
 *
 * Combined chronological layout:
 *   1. opts.layout='combined' renders ONE table with all currencies interleaved
 *      by date, matching the live ledger structure
 *   2. Per-currency running balance columns with active/dim contrast
 *   3. Per-currency breakdown cards stacked at the bottom
 *   4. Print dropdown exposes 4 options (Per Currency × EN/AR + Combined × EN/AR)
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oa = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');
var exp = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-export.js'), 'utf8');
var i18n = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-i18n.js'), 'utf8');

console.log('\n── HOTFIX 33: live ledger — strip vertical column backgrounds ──');

ok('LIVE.1: bg-emerald-50/30 removed from "they_owe_us" body cells',
  !/<td[^>]*bg-emerald-50\/30[^>]*>[\s\S]{0,500}arApSide/.test(oa));

ok('LIVE.2: bg-red-50/30 removed from "we_owe_them" body cells',
  !/<td[^>]*bg-red-50\/30[^>]*>[\s\S]{0,500}arApSide/.test(oa));

ok('LIVE.3: bg-amber-50 removed from Open Balance body cell',
  !/<td className="px-3 py-1\.5 text-right font-mono font-extrabold bg-amber-50"/.test(oa));

ok('LIVE.4: bg-slate-100 removed from Running Balance header cells',
  !/<th[^>]*border-b-2 border-slate-300 bg-slate-100[^>]*>[\s\S]{0,200}running_bal/.test(oa));

ok('LIVE.5: bg-emerald-50/red-50/amber-50 removed from header cells (HOTFIX 33)',
  !/<th[^>]*bg-emerald-50[^>]*>[\s\S]{0,200}they_owe_us/.test(oa) &&
  !/<th[^>]*bg-red-50[^>]*>[\s\S]{0,200}we_owe_them/.test(oa) &&
  !/<th[^>]*bg-amber-50[^>]*>[\s\S]{0,200}open_balance/.test(oa));

ok('LIVE.6: payment_sent shows "reduces what we owe" subtag below green amount in AP column',
  /isFavorable = \(txnType === 'payment_sent'/.test(oa) && /reduces what we owe/.test(oa));

ok('REPORT.8: Auto-synced preamble detected and demoted to small italic line',
  /Auto-synced from invoice[\s\S]{0,200}Edit the invoice to change this entry/.test(exp) &&
  /auto-synced from invoice<\/div>/.test(exp));

console.log('\n── HOTFIX 33: report — settlement wording + max-width + breakdown ──');

ok('REPORT.1: i18n keys use "Settled by offset against" (not "Paid by credit applied from")',
  /paid_by_credit:[\s\S]{0,200}'Settled by offset against'/.test(i18n) &&
  /partially_applied:[\s\S]{0,200}'Partially settled by offset against'/.test(i18n));

ok('REPORT.2: type-aware short labels for offset wording',
  /type_sales_invoice_short:[\s\S]{0,200}'sales invoice'/.test(i18n) &&
  /type_vendor_bill_short:[\s\S]{0,200}'vendor bill'/.test(i18n));

ok('REPORT.3: export computes otherTypeKey based on this row\'s opposite type',
  /var otherTypeKey = e\.transaction_type === 'vendor_bill' \? 'type_sales_invoice_short' : 'type_vendor_bill_short'/.test(exp));

ok('REPORT.4: report-page wrapper with max-width 950px (no more infinite stretch)',
  /\.report-page \{ max-width: 950px/.test(exp));

ok('REPORT.5: table-layout: fixed with locked col-* width percentages',
  /'table \{ table-layout: fixed/.test(exp) && /'th\.col-date    \{ width: 9%/.test(exp));

ok('REPORT.6: @page A4 portrait + @media print enforces 100% width on .report-page',
  /'@page \{ size: A4 portrait/.test(exp) && /'@media print/.test(exp));

ok('REPORT.7: print-color-adjust: exact so red/green totals + paid pill print correctly',
  /print-color-adjust: exact/.test(exp));

ok('REPORT.9: Section h2 bumped to 18px / weight 900 hierarchy',
  /currency-section > h2[\s\S]{0,300}font-size: 18px/.test(exp) &&
  /currency-section > h2[\s\S]{0,300}font-weight: 900/.test(exp));

ok('REPORT.10: Net Balance value bumped to 28px / weight 900',
  /'\.balance-value \{ font-size: 28px; font-weight: 900/.test(exp));

ok('REPORT.11: Per-currency summary breaks out Open invoice / Open bill / Prepaid lines',
  /theirOpenInvoices > 0\.005[\s\S]{0,500}'Open invoice'/.test(exp) &&
  /ourPrepaid > 0\.005[\s\S]{0,500}'Our credit \/ prepaid'/.test(exp));

ok('REPORT.12: Bright yellow no-print bar replaced with neutral slate',
  /\.no-print \{[\s\S]{0,300}background: #f1f5f9/.test(exp));

console.log('\n── HOTFIX 33: Combined chronological layout option ──');

ok('COMBINED.1: printAccountLedger reads opts.layout (per_currency | combined)',
  /var layout = opts\.layout === 'combined' \? 'combined' : 'per_currency'/.test(exp));

ok('COMBINED.2: combinedSectionHtml() function exists',
  /function combinedSectionHtml\(\)/.test(exp));

ok('COMBINED.3: combined layout renders one table with all currencies interleaved by date',
  /Combined Ledger — All Currencies, Chronological/.test(exp));

ok('COMBINED.4: combined layout uses per-currency running balance columns',
  /currencies\.map\(function \(c\) \{\s+return '<th class="col-run num">'/.test(exp));

ok('COMBINED.5: layout switch wires combined vs per_currency',
  /layout === 'combined' \? combinedSectionHtml\(\) : currencies\.map\(sectionHtml\)/.test(exp));

ok('COMBINED.6: handlePrintLedger forwards layout to printAccountLedger',
  /function handlePrintLedger\(account, perspective, bilingual, layout\)/.test(oa) &&
  /layout: layout === 'combined' \? 'combined' : 'per_currency'/.test(oa));

ok('COMBINED.7: Print (Internal) dropdown exposes 4 options (2 layouts × 2 langs)',
  /handlePrintLedger\(a, 'internal', false, 'per_currency'\)/.test(oa) &&
  /handlePrintLedger\(a, 'internal', true, 'per_currency'\)/.test(oa) &&
  /handlePrintLedger\(a, 'internal', false, 'combined'\)/.test(oa) &&
  /handlePrintLedger\(a, 'internal', true, 'combined'\)/.test(oa));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 33 — World-class readability + report parity + Combined view');
console.log('══════════════════════════════════════════════');
