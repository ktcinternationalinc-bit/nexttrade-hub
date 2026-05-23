// v55.83-A.6.27.65 — Sales-Rep KPI dashboard + invoice advanced filters.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var srd  = read('src/components/SalesRepDashboard.jsx');
var wn   = read('src/components/WhatsNewWidget.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SalesRepDashboard component
// ══════════════════════════════════════════════════════════════════
ok('A1: has "use client" + React imports',
  /'use client'/.test(srd) &&
  /import \{ useMemo, useState \} from 'react'/.test(srd));
ok('A2: default export SalesRepDashboard',
  /export default function SalesRepDashboard\(props\)/.test(srd));
ok('A3: fmtMoney + fmtPct + fmtInt helpers',
  /function fmtMoney\(n\)/.test(srd) &&
  /function fmtPct\(n\)/.test(srd) &&
  /function fmtInt\(n\)/.test(srd));
ok('A4: takes invoices prop',
  /var invoices = props\.invoices \|\| \[\]/.test(srd));
ok('A5: takes optional label prop',
  /var label = props\.label \|\| 'in selected range'/.test(srd));
ok('A6: perRep useMemo buckets by sales_rep (with "(Unassigned)" fallback)',
  /perRep = useMemo\(function/.test(srd) &&
  /var rep = \(inv\.sales_rep \|\| ''\)\.trim\(\) \|\| '\(Unassigned\)'/.test(srd));
ok('A7: bucket has count + invoiced + collected + outstanding + customers',
  /count: 0,\s+invoiced: 0,\s+collected: 0,\s+outstanding: 0,\s+customers: \{\}/.test(srd));
ok('A8: accumulates invoiced (total_amount OR amount)',
  /b\.invoiced \+= Number\(inv\.total_amount \|\| inv\.amount \|\| 0\)/.test(srd));
ok('A9: accumulates collected from total_collected',
  /b\.collected \+= Number\(inv\.total_collected \|\| 0\)/.test(srd));
ok('A10: accumulates outstanding',
  /b\.outstanding \+= Number\(inv\.outstanding \|\| 0\)/.test(srd));
ok('A11: tracks per-customer revenue for best-customer pick',
  /b\.customers\[cust\] = \(b\.customers\[cust\] \|\| 0\) \+ Number\(inv\.total_amount \|\| inv\.amount \|\| 0\)/.test(srd));
ok('A12: avg = invoiced / count',
  /b\.avg = b\.count > 0 \? b\.invoiced \/ b\.count : 0/.test(srd));
ok('A13: collection_rate = collected/invoiced * 100',
  /b\.collection_rate = b\.invoiced > 0 \? \(b\.collected \/ b\.invoiced\) \* 100 : 0/.test(srd));
ok('A14: best_customer = highest revenue customer',
  /Object\.keys\(b\.customers\)\.forEach\(function \(cust\) \{\s+if \(b\.customers\[cust\] > bestRev\)/.test(srd));
ok('A15: rows sorted by invoiced desc',
  /rows\.sort\(function \(a, b\) \{ return b\.invoiced - a\.invoiced; \}\)/.test(srd));
ok('A16: grand totals useMemo aggregates across all reps',
  /grand = useMemo\(function/.test(srd) &&
  /t\.invoiced \+= r\.invoiced/.test(srd));
ok('A17: empty state when no invoices',
  /perRep\.length === 0/.test(srd) &&
  /No invoices/.test(srd));
ok('A18: gradient header (blue → indigo → purple)',
  /bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-700/.test(srd));
ok('A19: 5 grand-total tiles (Reps Active / Invoices / Invoiced / Collected / Outstanding)',
  />Reps Active</.test(srd) &&
  />Invoices</.test(srd) &&
  />Invoiced</.test(srd) &&
  />Collected</.test(srd) &&
  />Outstanding</.test(srd));
ok('A20: top-3 medals (🥇🥈🥉)',
  /'🥇'/.test(srd) &&
  /'🥈'/.test(srd) &&
  /'🥉'/.test(srd));
ok('A21: collection % color-coded (emerald/amber/red thresholds at 90/70)',
  /r\.collection_rate >= 90 \? 'text-emerald-800' : r\.collection_rate >= 70 \? 'text-amber-700' : 'text-red-700'/.test(srd));
ok('A22: best customer column with truncate + title',
  /truncate max-w-\[180px\]" title=\{r\.best_customer\}/.test(srd));
ok('A23: tfoot total row',
  /<tfoot>[\s\S]{0,500}TOTAL \(\{perRep\.length\} reps\)/.test(srd));

// ══════════════════════════════════════════════════════════════════
// PART B — page.jsx state additions
// ══════════════════════════════════════════════════════════════════
ok('B1: imports SalesRepDashboard',
  /import SalesRepDashboard from '\.\.\/components\/SalesRepDashboard'/.test(page));
ok('B2: salesRepFilter state',
  /const \[salesRepFilter, setSalesRepFilter\] = useState\(''\)/.test(page));
ok('B3: amountMin + amountMax state',
  /const \[amountMin, setAmountMin\] = useState\(''\)/.test(page) &&
  /const \[amountMax, setAmountMax\] = useState\(''\)/.test(page));
ok('B4: hasOutstandingFilter state defaults to "all"',
  /const \[hasOutstandingFilter, setHasOutstandingFilter\] = useState\('all'\)/.test(page));
ok('B5: showAdvFilters + showRepDashboard toggle state',
  /const \[showAdvFilters, setShowAdvFilters\] = useState\(false\)/.test(page) &&
  /const \[showRepDashboard, setShowRepDashboard\] = useState\(false\)/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART C — filteredInvoices extended with new filters
// ══════════════════════════════════════════════════════════════════
ok('C1: filteredInvoices honors salesRepFilter (case-insensitive equality)',
  /if \(salesRepFilter\) \{\s+const repLow = salesRepFilter\.toLowerCase\(\);\s+arr = arr\.filter\(s => \(s\.sales_rep \|\| ''\)\.toLowerCase\(\) === repLow\)/.test(page));
ok('C2: filteredInvoices honors amountMin (>=)',
  /if \(amountMin !== '' && amountMin != null\) \{[\s\S]{0,400}arr\.filter\(s => Number\(s\.total_amount \|\| s\.amount \|\| 0\) >= minN\)/.test(page));
ok('C3: filteredInvoices honors amountMax (<=)',
  /if \(amountMax !== '' && amountMax != null\) \{[\s\S]{0,400}arr\.filter\(s => Number\(s\.total_amount \|\| s\.amount \|\| 0\) <= maxN\)/.test(page));
ok('C4: filteredInvoices honors hasOutstandingFilter yes (>0)',
  /hasOutstandingFilter === 'yes'[\s\S]{0,200}Number\(s\.outstanding \|\| 0\) > 0/.test(page));
ok('C5: filteredInvoices honors hasOutstandingFilter no (<=0)',
  /hasOutstandingFilter === 'no'[\s\S]{0,200}Number\(s\.outstanding \|\| 0\) <= 0/.test(page));
ok('C6: useMemo deps include the 4 new filter vars',
  /\[invoices, mode, df, dt, query, customerFilter, invoiceSort, salesRepFilter, amountMin, amountMax, hasOutstandingFilter\]/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART D — Sales tab UI: buttons + panels
// ══════════════════════════════════════════════════════════════════
ok('D1: Rep KPIs button toggles showRepDashboard',
  /setShowRepDashboard\(v => !v\)/.test(page) &&
  /📊 Rep KPIs/.test(page));
ok('D2: More filters button toggles showAdvFilters',
  /setShowAdvFilters\(v => !v\)/.test(page) &&
  /▸ More filters/.test(page));
ok('D3: advanced filter panel only shown when showAdvFilters',
  /\{showAdvFilters && \(\s+<div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3">/.test(page));
ok('D4: panel has sales rep select populated from invoices',
  /\[\.\.\.new Set\(invoices\.map\(i => i\.sales_rep\)\.filter\(Boolean\)\)\]\.sort\(\)\.map\(r => \(/.test(page));
ok('D5: amount from + to inputs',
  /placeholder="0\.00"/.test(page) &&
  /placeholder="∞"/.test(page));
ok('D6: outstanding select has 3 options',
  />All invoices</.test(page) &&
  />Has outstanding/.test(page) &&
  />Fully collected</.test(page));
ok('D7: clear-filters button conditional + count display',
  /\(salesRepFilter \|\| amountMin \|\| amountMax \|\| hasOutstandingFilter !== 'all'\)/.test(page) &&
  /\{filteredInvoices\.length\} matching invoice/.test(page) &&
  /Clear filters/.test(page));
ok('D8: SalesRepDashboard rendered when showRepDashboard',
  /\{showRepDashboard && \(/.test(page) &&
  /<SalesRepDashboard invoices=\{filteredInvoices\} label=/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════
ok('R1: 64 — auto FX snapshots SQL preserved',
  fs.existsSync(path.join(__dirname, '..', 'sql/v55-83-a-6-27-64-auto-fx-snapshots.sql')));
ok('R2: 64 — warehouseAdvances state + expense dropdown preserved',
  /const \[warehouseAdvances, setWarehouseAdvances\] = useState\(\[\]\)/.test(page) &&
  /💵 Link to Advance \(optional\) \/ ربط بسلفة/.test(page));
ok('R3: 63 — FxRatesPanel preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/FxRatesPanel.jsx')));
ok('R4: 63 — FxPnLReport preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/FxPnLReport.jsx')));
ok('R5: 62 — WarehouseAdvancesTab preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/WarehouseAdvancesTab.jsx')));
ok('R6: 62 — InventoryPnLReports preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/InventoryPnLReports.jsx')));
ok('R7: 61 — AttachmentManager preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/AttachmentManager.jsx')));
ok('R8: 60 — Deactivate-blocks-login fix preserved',
  /profile && profile\.active === false/.test(read('src/app/login/page.jsx')));
ok('R9: 60 — Product Overview history modal preserved',
  /function openHistory\(product\)/.test(read('src/components/InventoryOverview.jsx')));
ok('R10: 59 — mini-invoice + Invoice button preserved',
  /\+ Invoice/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R11: 55 — openaccounts in FINANCE sidebar preserved',
  /\{ group: 'FINANCE', items: \['sales', 'treasury', 'checks', 'debts', 'openaccounts'/.test(page));
ok('R12: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R13: WhatsNew widget has .65 entry',
  /version: 'v55\.83-A\.6\.27\.65'/.test(wn));
ok('R14: WhatsNew widget still has .64 + .63 + .62 + .61 entries',
  /version: 'v55\.83-A\.6\.27\.64'/.test(wn) &&
  /version: 'v55\.83-A\.6\.27\.63'/.test(wn) &&
  /version: 'v55\.83-A\.6\.27\.62'/.test(wn) &&
  /version: 'v55\.83-A\.6\.27\.61'/.test(wn));
ok('R15: existing Sales tab status + customer + query filters preserved',
  /statusFilter/.test(page) &&
  /setCustomerFilter/.test(page) &&
  /placeholder="بحث \/ Search"/.test(page));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.65',
  /BUILD v55\.83-A\.6\.27\.65/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.65 tests passed');
