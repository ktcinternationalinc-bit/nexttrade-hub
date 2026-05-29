/* v72 HOTFIX 30 + 31 — Combined regression test.
 *
 * HOTFIX 30 (Ledger UI + bilingual reports):
 *   1. Currency filter toggle (All/USD/EGP) above the ledger table
 *   2. Staircase dimming: inactive-currency running balance dimmed
 *   3. Subtle row tint by currency (cyan USD, amber EGP)
 *   4. Sticky table header
 *   5. Currency column: colored dot + brand-color text
 *   6. EN/Bilingual dropdown on Print Statement and Excel buttons
 *   7. Bilingual report: stacked EN/AR column headers + type labels +
 *      open/paid badges, offset linkage explainer line under badges
 *   8. Customer-friendly headers: "AR Side" → "They Owe Us / لنا عليهم"
 *      and "AP Side" → "We Owe Them / لهم علينا"
 *   9. Color by transaction_type not column: payment_sent is GREEN not red
 *
 * HOTFIX 31 (Reference rename + Credit Applied terminology):
 *   1. Invoice number generator splits SALE-/BILL- by direction
 *   2. Direction toggle in invoice modal regenerates the prefix
 *   3. "Offset" → "Credit Applied" in user-facing labels (DB internal
 *      value still 'offset', only the display label changes)
 *   4. Customer perspective uses clean labels ("Invoice"/"Bill") instead
 *      of long parentheticals ("Sales Invoice (you billed us)")
 *   5. Reference numbers are NEVER flipped on customer copy — they stay
 *      identical so reconciliation across both books matches
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

console.log('\n── HOTFIX 30: i18n translation module ──');

ok('i18n.1: module exports T, P, stackedH, DICT',
  /export function T\(/.test(i18n) && /export function P\(/.test(i18n) &&
  /export function stackedH\(/.test(i18n) && /export \{ DICT \}/.test(i18n));

ok('i18n.2: DICT has bilingual entries for column headers',
  /they_owe_us:[\s\S]{0,200}They Owe Us[\s\S]{0,200}لنا عليهم/.test(i18n) &&
  /we_owe_them:[\s\S]{0,200}We Owe Them[\s\S]{0,200}لهم علينا/.test(i18n));

ok('i18n.3: customer perspective flip on column headers',
  /they_owe_us:[\s\S]{0,400}customer_en: 'You Owe Us'/.test(i18n) &&
  /we_owe_them:[\s\S]{0,400}customer_en: 'Owed to You'/.test(i18n));

ok('i18n.4: transaction types have customer-perspective flips (HOTFIX 31 clean labels)',
  /vendor_bill:[\s\S]{0,400}customer_en: 'Invoice'/.test(i18n) &&
  /sales_invoice:[\s\S]{0,400}customer_en: 'Bill'/.test(i18n));

ok('i18n.5: "offset" type label is "Credit Applied" (HOTFIX 31)',
  /offset:[\s\S]{0,400}'Credit Applied'/.test(i18n));

ok('i18n.6: offset linkage phrase keys exist (paid_by_credit, partially_applied)',
  /paid_by_credit:[\s\S]{0,200}'Paid by credit applied from'/.test(i18n) &&
  /partially_applied:[\s\S]{0,200}'Credit partially applied from'/.test(i18n));

console.log('\n── HOTFIX 30: ledger UI polish ──');

ok('UI.1: ledgerCurFilter state for per-account currency filter',
  /var \[ledgerCurFilter, setLedgerCurFilter\] = useState\(\{\}\)/.test(oa));

ok('UI.2: currency filter toggle bar renders above table when multi-currency',
  /s\.currencies\.length > 1[\s\S]{0,2000}\['ALL'\]\.concat\(s\.currencies\)\.map/.test(oa));

ok('UI.3: filter buttons use brand colors (sky USD, amber EGP, indigo ALL)',
  /filt === 'USD' \? 'bg-sky-600 text-white'[\s\S]{0,200}filt === 'EGP' \? 'bg-amber-600 text-white'/.test(oa));

ok('UI.4: filter actually applies to row visibility',
  /var curFilter = ledgerCurFilter\[a\.id\] \|\| 'ALL'[\s\S]{0,200}entry\._currency !== curFilter/.test(oa));

ok('UI.5: row tint by currency (cyan USD, amber EGP) + brand hover via --hov var',
  /entryCur === 'USD'[\s\S]{0,100}'bg-sky-50\/40'/.test(oa) &&
  /entryCur === 'EGP'[\s\S]{0,100}'bg-amber-50\/30'/.test(oa) &&
  /hover:bg-\[var\(--hov\)\]/.test(oa));

ok('UI.6: currency column has colored dot + brand-color text',
  /inline-block w-2 h-2 rounded-full[\s\S]{0,400}bg-sky-500[\s\S]{0,400}bg-amber-500/.test(oa) &&
  /entryCur === 'USD' \? 'text-sky-700' : entryCur === 'EGP' \? 'text-amber-700'/.test(oa));

ok('UI.7: staircase dimming (active full strength, inactive text-slate-300 + opacity-60)',
  /isThisEntryCur[\s\S]{0,500}text-slate-300 font-medium opacity-60/.test(oa));

ok('UI.8: sticky header (sticky top-0 + z-10)',
  /<thead className="bg-slate-50 sticky top-0 z-10">/.test(oa));

console.log('\n── HOTFIX 30: Print/Excel dropdowns ──');

ok('DROP.1: handlePrintLedger accepts bilingual param',
  /function handlePrintLedger\(account, perspective, bilingual\)/.test(oa));

ok('DROP.2: handleExportExcel accepts bilingual + perspective params',
  /function handleExportExcel\(account, bilingual, perspective\)/.test(oa));

ok('DROP.3: Print (Internal) dropdown has EN and Bilingual options',
  /handlePrintLedger\(a, 'internal', false\)[\s\S]{0,1500}English Only[\s\S]{0,2000}handlePrintLedger\(a, 'internal', true\)[\s\S]{0,400}Bilingual/.test(oa));

ok('DROP.4: Customer Statement dropdown has EN and Bilingual options',
  /handlePrintLedger\(a, 'customer', false\)[\s\S]{0,2000}handlePrintLedger\(a, 'customer', true\)/.test(oa));

ok('DROP.5: Excel dropdown has EN and Bilingual options',
  /handleExportExcel\(a, false, 'internal'\)[\s\S]{0,2000}handleExportExcel\(a, true, 'internal'\)/.test(oa));

ok('DROP.6: handlePrintLedger passes bilingual through to printAccountLedger',
  /bilingual: bilingual === true/.test(oa));

console.log('\n── HOTFIX 30: bilingual export ──');

ok('EXP.1: open-account-export imports i18n module',
  /import \{ T as t18n, stackedH \} from '\.\/open-account-i18n\.js'/.test(exp));

ok('EXP.2: printAccountLedger reads opts.bilingual',
  /var bilingual = opts\.bilingual === true/.test(exp));

ok('EXP.3: exportAccountLedgerToExcel reads opts.bilingual + perspective',
  /export function exportAccountLedgerToExcel\(account, entity, entries, summary, opts\)/.test(exp) &&
  /var bilingual = opts\.bilingual === true/.test(exp));

ok('EXP.4: TYPE_LABEL map replaced with i18n tLabel function',
  /function tLabel\(typeKey\)/.test(exp) && /t18n\(typeKey, 'en', perspective\)/.test(exp));

ok('EXP.5: column headers use t18n + stackedH for bilingual mode',
  /bilingual \? stackedH\('they_owe_us', perspective\) : t18n\('they_owe_us', 'en', perspective\)/.test(exp));

ok('EXP.6: offset linkage lookup built before filtering (HOTFIX 30)',
  /var offsetsByTarget = \{\}/.test(exp) && /allEntries\.filter\(function \(e\) \{ return e\.transaction_type === 'offset'/.test(exp));

ok('EXP.7: offset linkage explainer line renders under paid/open badges',
  /var linkLine = ''/.test(exp) && /linkLine = '<div style="font-size:9px;color:#64748b/.test(exp) &&
  /<\/span>' \+ linkLine/.test(exp));

ok('EXP.8: color by transaction_type (HOTFIX 30 fix #2): payment_sent is GREEN not red',
  /var apColor = '#b91c1c'/.test(exp) && /payment_sent[\s\S]{0,100}apColor = '#15803d'/.test(exp));

ok('EXP.9: balance label uses i18n with perspective + bilingual stacking',
  /balanceLabelKey = cs\.balance > 0 \? 'they_owe_us_dir'[\s\S]{0,400}t18n\(balanceLabelKey, 'en', perspective\) \+ ' \/ ' \+ t18n\(balanceLabelKey, 'ar', perspective\)/.test(exp));

ok('EXP.10: Excel column headers via xlH() helper (bilingual aware)',
  /function xlH\(key\)[\s\S]{0,400}xlH\('they_owe_us'\)[\s\S]{0,200}xlH\('we_owe_them'\)[\s\S]{0,200}xlH\('open_balance'\)/.test(exp));

ok('EXP.11: Excel type labels via xlType() helper',
  /function xlType\(typeKey\)/.test(exp) && /xlType\(e\.transaction_type\)/.test(exp));

console.log('\n── HOTFIX 31: Reference number generator ──');

ok('GEN.1: computeNextInvoiceNumber takes direction parameter',
  /function computeNextInvoiceNumber\(account, direction\)/.test(oa));

ok('GEN.2: prefix is SALE- for credit (sales), BILL- for debit (vendor bill)',
  /var prefix = dir === 'credit' \? 'SALE-' : 'BILL-'/.test(oa));

ok('GEN.3: still scans legacy INV-* numbers so we don\'t collide during transition',
  /var legacyPrefix = 'INV-' \+ slug \+ '-' \+ year \+ '-'/.test(oa) &&
  /num\.indexOf\(legacyPrefix\) === 0/.test(oa));

ok('GEN.4: counts independently per direction (so SALE-001 and BILL-001 can coexist)',
  /if \(\(inv\.direction === 'debit' \? 'debit' : 'credit'\) !== dir\) return/.test(oa));

ok('GEN.5: openNewInvoice passes default direction to generator',
  /var defaultDirection = 'credit'[\s\S]{0,400}invoice_number: computeNextInvoiceNumber\(acc, defaultDirection\)/.test(oa));

ok('GEN.6: direction toggle regenerates invoice_number if it still matches auto-generated pattern',
  /lookedAuto = \/\^\(SALE\|BILL\|INV\)-\[A-Z0-9-\]\+-\\d\{4\}-\\d\{3,\}\$\/[\s\S]{0,1000}computeNextInvoiceNumber\(acc, 'credit'\)[\s\S]{0,1500}computeNextInvoiceNumber\(acc, 'debit'\)/.test(oa));

console.log('\n══════════════════════════════════════════════');

console.log('\n── HOTFIX 30: Max May 28 feedback polish ──');

ok('FB.1: Net Balance card uses 28px / fontWeight 900',
  /fontSize: '28px'[\s\S]{0,300}fontWeight: 900/.test(oa));

ok('FB.2: Net Balance card has soft text-shadow glow',
  /textShadow: '0 0 10px rgba\(255,255,255,0\.35\)'/.test(oa));

ok('FB.3: Open Balance column prefixes partial amounts with "Open" word',
  /<span className="text-\[9px\] font-extrabold uppercase tracking-wider opacity-70 mr-1">Open<\/span>\{fmtNum\(pr\.remaining\)\}/.test(oa));

ok('FB.4: payment_sent label gets "/ Deposit" suffix when no bill was offset',
  /txnType === 'payment_sent' \|\| txnType === 'payment_received'[\s\S]{0,400}lbl \+ ' \/ Deposit'/.test(oa));

ok('FB.5: Active running balance has subtle text-shadow glow',
  /textShadow: '0 0 6px rgba\(255,255,255,0\.15\)'/.test(oa));

ok('FB.6: Hover tints use rgba 0.12 for USD and EGP, applied via --hov CSS variable',
  /rgba\(56, 189, 248, 0\.12\)/.test(oa) && /rgba\(245, 158, 11, 0\.12\)/.test(oa) &&
  /hover:bg-\[var\(--hov\)\]/.test(oa));

ok('FB.7: Density preserved — row td still uses px-3 py-1.5 (not py-2 or py-3)',
  /<td className="px-3 py-1\.5 font-mono text-slate-900">\{fmtDate\(entry\.entry_date\)\}<\/td>/.test(oa));

if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 30/31 — Ledger UI polish + bilingual reports + SALE-/BILL- prefix + Credit Applied + Max feedback');
console.log('══════════════════════════════════════════════');
