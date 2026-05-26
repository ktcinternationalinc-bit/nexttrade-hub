// v55.83-A.6.27.58 — Multi-currency Open Accounts ledger.
//
// What changed:
//   - SQL: added `currency text NOT NULL DEFAULT 'USD'` column on
//     open_account_entries with smart backfill from entity default
//     currency via JOIN through business_entities.
//   - entriesByAccount running balance walk: per-currency. Each entry
//     gets _currency and _running_by_currency (snapshot of all running
//     balances after this entry).
//   - summaryFor: returns {byCurrency, currencies (sorted USD-first then
//     alphabetical), totalEntryCount, + back-compat legacy fields}.
//   - grandTotals: per-currency aggregation across all visible accounts.
//   - Entry modal: currency dropdown (USD/EGP/EUR/GBP/AED/SAR/CNY),
//     default from entity, free edit. Save includes currency in payload.
//   - Account card header: per-currency stacked pills.
//   - Grand totals tiles: per-currency rows (one row per currency for
//     Credit/Debit/Balance, plus Accounts tile on top with currency usage).
//   - Ledger table: Currency column + ONE Running Balance column per
//     currency present in this account. Entry's own currency cell
//     highlighted. Per-currency totals rows at bottom.
//   - Print export: split into sections per currency (page-break-inside:
//     avoid for clean PDF).
//   - Excel export: one sheet, chronological, with Currency column +
//     one Running col per currency + per-currency totals rows.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page    = read('src/app/page.jsx');
var oa      = read('src/components/OpenAccountsTab.jsx');
var exp     = read('src/lib/open-account-export.js');
var sql     = read('sql/v55-83-a-6-27-58-open-accounts-multi-currency.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL migration
// ══════════════════════════════════════════════════════════════════

ok('A1: SQL adds currency column with IF NOT EXISTS',
  /ALTER TABLE open_account_entries\s+ADD COLUMN IF NOT EXISTS currency text/.test(sql));
ok('A2: SQL smart-backfills currency from business_entities.default_currency via account JOIN',
  /UPDATE open_account_entries e\s+SET currency = COALESCE\(be\.default_currency, 'USD'\)\s+FROM open_accounts a\s+LEFT JOIN business_entities be/.test(sql));
ok('A3: SQL catches orphan entries with no account → defaults USD',
  /UPDATE open_account_entries\s+SET currency = 'USD'\s+WHERE currency IS NULL/.test(sql));
ok('A4: SQL locks column NOT NULL with default USD',
  /ALTER TABLE open_account_entries\s+ALTER COLUMN currency SET NOT NULL,\s+ALTER COLUMN currency SET DEFAULT 'USD'/.test(sql));
ok('A5: SQL adds CHECK constraint (length >= 2)',
  /chk_entry_currency_not_blank CHECK \(length\(trim\(currency\)\) >= 2\)/.test(sql));
ok('A6: SQL creates index for per-currency aggregation',
  /CREATE INDEX IF NOT EXISTS idx_open_entries_currency ON open_account_entries \(account_id, currency\)/.test(sql));
ok('A7: SQL is idempotent (constraint wrapped in DO $$ ... duplicate_object NULL)',
  /EXCEPTION WHEN duplicate_object THEN NULL/.test(sql));
ok('A8: SQL includes backout block (commented)',
  /BACKOUT SQL[\s\S]{0,400}DROP COLUMN IF EXISTS currency/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — Per-currency running balance walk
// ══════════════════════════════════════════════════════════════════

ok('B1: entriesByAccount uses FIFO simulation as source of truth (v72 HOTFIX 3)',
  /entriesByAccount[\s\S]{0,300}HOTFIX 3 — Per-entry running balance now comes from the\s+\/\/ FIFO simulation trail/.test(oa));
ok('B2: each entry gets normalized _currency (uppercase, default USD)',
  /var cur = String\(entry\.currency \|\| 'USD'\)\.toUpperCase\(\)\.trim\(\) \|\| 'USD';\s+entry\._currency = cur/.test(oa));
ok('B3: per-account simulation runs once via simulate(arr)',
  /var sim = simulate\(arr\)/.test(oa));
ok('B4: snapshot from FIFO trail, not credit-debit running sum',
  /var snap = t\.snapshotAfter[\s\S]{0,400}netForThisCur = \(snap\.theirOpenInvoices - snap\.theirPrepaid\) - \(snap\.ourOpenBills - snap\.ourPrepaid\)/.test(oa));
ok('B5: each entry gets _running_by_currency snapshot keyed by currency',
  /entry\._running_by_currency = nets/.test(oa));
ok('B6: back-compat _running_balance kept for legacy consumers',
  /entry\._running_balance = netForThisCur/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART C — summaryFor returns per-currency shape
// ══════════════════════════════════════════════════════════════════

ok('C1: summaryFor seeds byCur from FIFO simulate result',
  /sim\.currencies\.forEach\(function \(cur\) \{[\s\S]{0,500}balance: b\.netBalance/.test(oa));
ok('C2: summaryFor sorts currencies USD-first then alphabetical',
  /if \(a === 'USD' && b !== 'USD'\) return -1;\s+if \(b === 'USD' && a !== 'USD'\) return 1;\s+return a\.localeCompare\(b\)/.test(oa));
ok('C3: summaryFor returns byCurrency + currencies + totalEntryCount',
  /return \{\s+byCurrency: byCur,\s+currencies: currencies,\s+totalEntryCount: arr\.length/.test(oa));
ok('C4: summaryFor preserves legacy totalCredit/totalDebit for back-compat',
  /\/\/ Legacy fields — back-compat only\s+totalCredit: legacyCredit,\s+totalDebit: legacyDebit/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART D — grandTotals per-currency
// ══════════════════════════════════════════════════════════════════

ok('D1: grandTotals accumulates byCur keyed by currency across filteredAccounts',
  /var grandTotals = useMemo\(function \(\) \{\s+var byCur = \{\};\s+filteredAccounts\.forEach/.test(oa));
ok('D2: grandTotals tracks accountsWithCurrency count per currency',
  /accountsWithCurrency: 0[\s\S]{0,400}byCur\[cur\]\.accountsWithCurrency \+= 1/.test(oa));
ok('D3: grandTotals sorts currencies USD-first',
  /if \(a === 'USD' && b !== 'USD'\) return -1[\s\S]{0,200}return \{\s+byCurrency: byCur,\s+currencies: currencies,\s+accountCount: filteredAccounts\.length/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART E — Entry modal: currency dropdown + default from entity
// ══════════════════════════════════════════════════════════════════

ok('E1: openNewEntry computes defaultCur from entity default_currency',
  /var defaultCur = \(ent && ent\.default_currency\) \|\| 'USD'/.test(oa));
ok('E2: openNewEntry stores currency in entryDraft',
  /currency: defaultCur,/.test(oa));
ok('E3: openEditEntry preserves entry.currency (uppercased)',
  /currency: String\(entry\.currency \|\| 'USD'\)\.toUpperCase\(\)/.test(oa));
ok('E4: saveEntry validates currency length >= 2',
  /if \(cur\.length < 2\) \{ alert\('Currency code is required/.test(oa));
ok('E5: saveEntry includes currency in payload',
  /payload = \{[\s\S]{0,500}currency: cur,/.test(oa));
ok('E6: entry modal renders 3-column grid (amount col-span-2 + currency dropdown)',
  /<div className="grid grid-cols-3 gap-3">[\s\S]{0,500}<label className="block col-span-2">[\s\S]{0,800}<label className="block">[\s\S]{0,400}Currency \* \/ العملة/.test(oa));
ok('E7: currency dropdown has all 7 options (USD/EGP/EUR/GBP/AED/SAR/CNY)',
  /<option value="USD">USD<\/option>\s+<option value="EGP">EGP<\/option>\s+<option value="EUR">EUR<\/option>\s+<option value="GBP">GBP<\/option>\s+<option value="AED">AED<\/option>\s+<option value="SAR">SAR<\/option>\s+<option value="CNY">CNY<\/option>/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART F — Account card per-currency stacked pills
// ══════════════════════════════════════════════════════════════════

ok('F1: account card header maps s.currencies to per-currency pill rows',
  /s\.currencies\.length === 0 \? \([\s\S]{0,200}No entries yet[\s\S]{0,400}s\.currencies\.map\(function \(cur\)/.test(oa));
ok('F2: each currency row shows code badge + Bal pill (Cr/Dr removed in v72 HOTFIX 6 — caused reconciliation confusion)',
  /<span className="px-1\.5 py-0\.5 bg-slate-200 text-slate-900 text-\[10px\] font-mono font-extrabold rounded">\{cur\}<\/span>[\s\S]{0,800}Bal: \{fmtSigned\(cs\.balance\)\} \{cur\}/.test(oa));
ok('F3: balance pill colored green if positive, red if negative, slate if zero',
  /\(cs\.balance > 0 \? 'bg-emerald-700 text-white' : cs\.balance < 0 \? 'bg-red-700 text-white' : 'bg-slate-500 text-white'\)/.test(oa));
ok('F4: total entry count displayed at bottom (s.totalEntryCount)',
  /\(\{s\.totalEntryCount\} \{s\.totalEntryCount === 1 \? 'entry' : 'entries'\}\)/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART G — Grand totals tiles per currency
// ══════════════════════════════════════════════════════════════════

ok('G1: comment explains grand totals are now per-currency (was mixed)',
  /Grand totals broken out PER CURRENCY[\s\S]{0,300}was meaningless/.test(oa));
ok('G2: Accounts tile shows currencies-in-use inline',
  /Currencies in use: \{grandTotals\.currencies\.map\(function \(cur\)/.test(oa));
ok('G3: empty state shown when grandTotals.currencies.length === 0',
  /grandTotals\.currencies\.length === 0 && \([\s\S]{0,300}No entries yet — add ledger entries to see currency totals/.test(oa));
ok('G4: per-currency rows: one grid-cols-3 row per currency for Credit/Debit/Balance',
  /grandTotals\.currencies\.map\(function \(cur\) \{[\s\S]{0,500}<div key=\{cur\} className="grid grid-cols-3 gap-2">/.test(oa));
ok('G5: per-currency Credit tile uses bg-emerald-700 with currency suffix',
  /\{cur\} Total Credit \(money in\)[\s\S]{0,300}\{fmtNum\(t\.credit\)\} \{cur\}/.test(oa));
ok('G6: per-currency Balance tile shows "they owe us"/"we owe them"/"settled" based on sign',
  /t\.balance > 0 \? 'they owe us' : t\.balance < 0 \? 'we owe them' : 'settled'/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART H — Ledger table: Currency column + per-currency running columns
// ══════════════════════════════════════════════════════════════════

ok('H1: ledger table header has Currency column (v72 HOTFIX 11 — was "Cur")',
  />Currency</.test(oa));
ok('H2: ledger table has Running Balance CUR columns per currency (v72 HOTFIX 11 final spec)',
  /Running Balance \{cur\}/.test(oa));
ok('H3: each entry row shows its own _currency in the Cur column',
  /<td className="px-3 py-1\.5 text-center font-mono font-bold text-slate-800 text-\[11px\]">\{entryCur\}<\/td>/.test(oa));
ok('H4: each entry row renders per-currency running cells from _running_by_currency',
  /var rbForCur = \(entry\._running_by_currency && entry\._running_by_currency\[cur\]\) \|\| 0/.test(oa));
ok('H5: entry\'s own currency cell highlighted (bg-slate-100), others dimmed (text-slate-400)',
  /var isThisEntryCur = \(cur === entryCur\)[\s\S]{0,400}\(isThisEntryCur \? 'bg-slate-100 ' : 'text-slate-400 '\)/.test(oa));
ok('H6: per-currency Summary block split per currency (one block per cur, v72 HOTFIX 11 multi-row)',
  /s\.currencies\.map\(function \(cur\) \{[\s\S]{0,4000}Net \{cur\} Position/.test(oa));
ok('H7: totals row places per-currency balance in correct running column',
  /s\.currencies\.map\(function \(col, colI\) \{\s+if \(col !== cur\) return <td/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART I — Print export (per-currency sections)
// ══════════════════════════════════════════════════════════════════

ok('I1: print export reads currencies from summary.currencies',
  /var currencies = \(summary && summary\.currencies\) \|\| \[\]/.test(exp));
ok('I2: sectionHtml function renders one currency section per currency',
  /function sectionHtml\(cur\) \{[\s\S]{0,300}var cs = byCurrency\[cur\]/.test(exp));
ok('I3: section walks entries filtered by currency with own running balance',
  /entries\.forEach\(function \(e\) \{\s+var entryCur = e\._currency \|\| String\(e\.currency \|\| 'USD'\)\.toUpperCase\(\);\s+if \(entryCur !== cur\) return/.test(exp));
ok('I4: section CSS uses page-break-inside:avoid for clean PDF',
  /\.currency-section \{ page-break-inside: avoid/.test(exp));
ok('I5: multi-currency note shown when currencies.length > 1',
  /currencies\.length > 1\s+\? '<div class="multi-currency-note"><strong>Multi-currency account/.test(exp));
ok('I6: balance box shows abs(balance) + currency code',
  /fmtMoney\(Math\.abs\(cs\.balance\)\) \+ ' ' \+ escapeHtml\(cur\)/.test(exp));
ok('I7: each section has its own Summary block in tfoot (v72 HOTFIX 11 final)',
  /<tfoot>[\s\S]{0,4000}Net.*Position/.test(exp));

// ══════════════════════════════════════════════════════════════════
// PART J — Excel export (per-currency totals + running cols)
// ══════════════════════════════════════════════════════════════════

ok('J1: Excel headers Type/AR Side/AP Side/Remaining + one Running Balance CUR per currency (v72 HOTFIX 11 final)',
  /'Date', 'Type', 'Description', 'Reference', 'Currency', 'AR Side', 'AP Side', 'Remaining'/.test(exp) && /'Running Balance ' \+ cur/.test(exp));
ok('J2: Excel walks entries with per-currency rolling running map (v72 HOTFIX 6 — now uses signedAmount)',
  /var running = \{\};[\s\S]{0,5000}running\[entryCur\] \+= signed/.test(exp));
ok('J3: Excel row pushes Type + Amount + Paid + Remaining + per-currency running values (v55.83-A.6.27.72)',
  /var row = \[\s+fmtDate\(e\.entry_date\)[\s\S]{0,1000}TYPE_LABEL\[e\.transaction_type\]/.test(exp));
ok('J4: Excel adds per-currency Summary block (Total AR + Total AP + Net Position rows) (v72 HOTFIX 11 final)',
  /cur \+ ' Summary:'/.test(exp) && /Total AR \(They Owe Us\)/.test(exp) && /Total AP \(We Owe Them\)/.test(exp));
ok('J5: Excel adds plain-English balance lines per currency',
  /var label = cs\.balance > 0 \? 'They owe us' : cs\.balance < 0 \? 'We owe them' : 'Settled'/.test(exp));
ok('J6: Excel col widths include base 6 + one per currency',
  /currencies\.forEach\(function \(\) \{ ws\['!cols'\]\.push\(\{ wch: 18 \}\); \}\);  \/\/ one per currency running/.test(exp));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: 57 — Shipping rate save instrumentation preserved (console.log on save attempt)',
  /console\.log\('\[shipping-rates\] save attempt:'/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R2: 57 — Trucking-with-Ocean confirm dialog preserved',
  /this is a TRUCKING rate but Transport Mode is set to/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R3: 56 — Inbound Shipments 3-region modal preserved (headerCollapsed)',
  /var \[headerCollapsed, setHeaderCollapsed\] = useState\(false\)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R4: 55 — openaccounts in FINANCE sidebar preserved',
  /\{ group: 'FINANCE', items: \['sales', 'treasury', 'checks', 'debts', 'openaccounts'/.test(page));
ok('R5: 55 — Template Products rename preserved',
  /TEMPLATE</.test(read('src/components/InventoryProductMaster.jsx')) &&
  !/>FAMILY</.test(read('src/components/InventoryProductMaster.jsx')));
ok('R6: 55 — TEXTJOIN slug formula in Excel template preserved',
  /f: 'TEXTJOIN\("-",TRUE,E' \+ rowNum \+ ':M' \+ rowNum \+ '\)'/.test(read('src/components/InventoryImportProducts.jsx')));
ok('R7: 54 — amber header version pill preserved',
  /background: '#fef3c7'/.test(page));
ok('R8: 53 — Business Entities + entity picker on accounts preserved',
  /Our Entity for this Account \* \/ كياننا/.test(oa));
ok('R9: 53 — Print + Excel buttons on account card preserved',
  /🖨️ Print/.test(oa) && /📊 Excel/.test(oa));
ok('R10: 52 — Open Accounts tab registered',
  /\{ id: 'openaccounts', label: 'Open Accounts \/ حسابات', icon: '📒' \}/.test(page));
ok('R11: 52 — 5-type transaction picker (v55.83-A.6.27.72 supersedes 2-way credit/debit toggle)',
  /transaction_type === 'sales_invoice'/.test(oa) && /transaction_type === 'vendor_bill'/.test(oa) &&
  /transaction_type === 'payment_received'/.test(oa) && /transaction_type === 'payment_sent'/.test(oa));
ok('R12: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R13: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R14: account card actions row preserved (+ Entry / Print / Excel / Files / Edit / Delete — Files added in .66 Issue 2)',
  /openNewEntry\(a\.id\)[\s\S]{0,2000}\+ Entry[\s\S]{0,2000}handlePrintLedger[\s\S]{0,2000}handleExportExcel[\s\S]{0,2000}setAttachAccountId[\s\S]{0,2000}openEditAccount[\s\S]{0,2000}deleteAccount/.test(oa));
ok('R15: saveEntry still inserts/updates open_account_entries table',
  /await dbInsert\('open_account_entries', payload, userProfile && userProfile\.id\)/.test(oa) &&
  /await dbUpdate\('open_account_entries', entryDraft\.id, payload, userProfile && userProfile\.id\)/.test(oa));
ok('R16: entriesByAccount still sorted by entry_date asc then created_at asc (DB query controls order)',
  /entries\.forEach\(function \(e\) \{\s+if \(!byAcc\[e\.account_id\]\) byAcc\[e\.account_id\] = \[\];\s+byAcc\[e\.account_id\]\.push\(e\)/.test(oa));
ok('R17: openAccountTab still bilingual (Arabic strings present)',
  /حسابات/.test(oa) && /المبلغ/.test(oa) && /العملة/.test(oa));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.58 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.58 (multi-currency Open Accounts) tests passed');
