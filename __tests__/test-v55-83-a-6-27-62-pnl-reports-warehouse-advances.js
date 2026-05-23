// v55.83-A.6.27.62 — Inventory P&L Reports + Warehouse Advances workflow.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var it   = read('src/components/InventoryTab.jsx');
var pnl  = read('src/components/InventoryPnLReports.jsx');
var adv  = read('src/components/WarehouseAdvancesTab.jsx');
var sql  = read('sql/v55-83-a-6-27-62-warehouse-advances.sql');
var wn   = read('src/components/WhatsNewWidget.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL migration
// ══════════════════════════════════════════════════════════════════
ok('A1: SQL creates warehouse_advances table',
  /CREATE TABLE IF NOT EXISTS warehouse_advances/.test(sql));
ok('A2: SQL has issue_date, amount, currency, recipient_name',
  /issue_date\s+DATE NOT NULL/.test(sql) &&
  /amount\s+NUMERIC\(14,2\) NOT NULL/.test(sql) &&
  /currency\s+TEXT NOT NULL DEFAULT 'EGP'/.test(sql) &&
  /recipient_name\s+TEXT NOT NULL/.test(sql));
ok('A3: SQL has recipient_role + description + reference_number',
  /recipient_role\s+TEXT/.test(sql) &&
  /description\s+TEXT/.test(sql) &&
  /reference_number\s+TEXT/.test(sql));
ok('A4: SQL has linked_treasury_id',
  /linked_treasury_id UUID/.test(sql));
ok('A5: SQL has status with CHECK open|closed default open',
  /status\s+TEXT NOT NULL DEFAULT 'open' CHECK \(status IN \('open', 'closed'\)\)/.test(sql));
ok('A6: SQL has closure tracking (closed_at, closed_by, close_reason)',
  /closed_at\s+TIMESTAMPTZ/.test(sql) &&
  /closed_by\s+UUID/.test(sql) &&
  /close_reason\s+TEXT/.test(sql));
ok('A7: SQL enforces positive amount',
  /CHECK \(amount > 0\)/.test(sql));
ok('A8: SQL adds advance_id column to warehouse_expenses',
  /ALTER TABLE warehouse_expenses\s+ADD COLUMN IF NOT EXISTS advance_id UUID/.test(sql));
ok('A9: SQL FK uses ON DELETE SET NULL (preserves expense data when advance deleted)',
  /fk_expense_advance[\s\S]{0,300}FOREIGN KEY \(advance_id\) REFERENCES warehouse_advances\(id\) ON DELETE SET NULL/.test(sql));
ok('A10: SQL creates summary view',
  /CREATE OR REPLACE VIEW warehouse_advances_summary AS/.test(sql) &&
  /SUM\(e\.amount\)/.test(sql) &&
  /spent_amount/.test(sql) &&
  /remaining_amount/.test(sql));
ok('A11: SQL has 3 indexes on advances (issue_date desc, status partial, recipient)',
  /idx_warehouse_advances_issue_date ON warehouse_advances \(issue_date DESC\)/.test(sql) &&
  /idx_warehouse_advances_status\s+ON warehouse_advances \(status\) WHERE status = 'open'/.test(sql) &&
  /idx_warehouse_advances_recipient/.test(sql));
ok('A12: SQL has partial index on expenses.advance_id',
  /idx_warehouse_expenses_advance[\s\S]{0,200}WHERE advance_id IS NOT NULL/.test(sql));
ok('A13: SQL enables RLS + permissive policy',
  /ALTER TABLE warehouse_advances ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /CREATE POLICY "Allow all on warehouse_advances"/.test(sql));
ok('A14: SQL has updated_at trigger',
  /trg_warehouse_advance_set_updated_at/.test(sql) &&
  /CREATE TRIGGER trg_warehouse_advance_updated_at/.test(sql));
ok('A15: SQL idempotent (4 exception blocks: 3 duplicate_object + 1 others)',
  (sql.match(/EXCEPTION WHEN (duplicate_object|others) THEN NULL/g) || []).length >= 4);
ok('A16: SQL has backout block (commented)',
  /BACKOUT[\s\S]{0,500}DROP TABLE IF EXISTS warehouse_advances/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — WarehouseAdvancesTab component
// ══════════════════════════════════════════════════════════════════
ok('B1: has "use client" + imports useState/useEffect/useMemo + supabase',
  /'use client'/.test(adv) &&
  /useState, useEffect, useMemo/.test(adv) &&
  /from '\.\.\/lib\/supabase'/.test(adv));
ok('B2: fmtMoney + fmtDate helpers',
  /function fmtMoney\(n, cur\)/.test(adv) &&
  /function fmtDate\(s\)/.test(adv));
ok('B3: default export WarehouseAdvancesTab',
  /export default function WarehouseAdvancesTab\(props\)/.test(adv));
ok('B4: state for advances + expenses + issueModal + detailAdvance + closeModal',
  /var \[advances, setAdvances\] = useState\(\[\]\)/.test(adv) &&
  /var \[expenses, setExpenses\] = useState\(\[\]\)/.test(adv) &&
  /var \[issueModalOpen, setIssueModalOpen\] = useState\(false\)/.test(adv) &&
  /var \[detailAdvance, setDetailAdvance\] = useState\(null\)/.test(adv) &&
  /var \[closeModal, setCloseModal\] = useState\(null\)/.test(adv));
ok('B5: load fetches warehouse_advances + warehouse_expenses (advance_id NOT NULL)',
  /\.from\('warehouse_advances'\)\.select\('\*'\)\.order\('issue_date'/.test(adv) &&
  /\.from\('warehouse_expenses'\)[\s\S]{0,300}\.not\('advance_id', 'is', null\)/.test(adv));
ok('B6: load graceful degrade when table missing',
  /relation\.\*warehouse_advances\.\*does not exist/.test(adv) &&
  /Run SQL migration v55\.83-A\.6\.27\.62/.test(adv));
ok('B7: summary useMemo computes spent + remaining + percent_spent per advance',
  /spentMap\[e\.advance_id\] = \(spentMap\[e\.advance_id\] \|\| 0\) \+ Number\(e\.amount \|\| 0\)/.test(adv) &&
  /spent_amount: spent/.test(adv) &&
  /remaining_amount: remaining/.test(adv) &&
  /percent_spent: issued > 0 \? Math\.min\(100, \(spent \/ issued\) \* 100\) : 0/.test(adv));
ok('B8: grandTotals per-currency aggregation',
  /grandTotals = useMemo\(function/.test(adv) &&
  /byCurrency\[cur\] = \{ issued: 0, spent: 0, remaining: 0, count: 0 \}/.test(adv));
ok('B9: openIssueModal defaults today + EGP + empty fields',
  /function openIssueModal\(\)/.test(adv) &&
  /currency: 'EGP'/.test(adv) &&
  /recipient_name: ''/.test(adv));
ok('B10: saveIssue validates amount + recipient + date + currency',
  /amt \|\| amt <= 0/.test(adv) &&
  /Amount must be a positive number/.test(adv) &&
  /Recipient name required/.test(adv) &&
  /Issue date required/.test(adv) &&
  /Currency required/.test(adv));
ok('B11: saveIssue inserts treasury row FIRST with cash_out or usd_out based on currency',
  /supabase\.from\('treasury'\)\.insert\(treasuryPayload\)/.test(adv) &&
  /cash_out: cur === 'EGP' \? amt : null/.test(adv) &&
  /usd_out: cur === 'USD' \? amt : null/.test(adv));
ok('B12: saveIssue treasury description includes "Advance to" + recipient',
  /description: 'Advance to ' \+ issueDraft\.recipient_name\.trim\(\)/.test(adv));
ok('B13: saveIssue treasury category = "Warehouse Advance"',
  /category: 'Warehouse Advance'/.test(adv));
ok('B14: saveIssue inserts advance with linked_treasury_id',
  /linked_treasury_id: treasuryId \|\| null/.test(adv) &&
  /supabase\.from\('warehouse_advances'\)\.insert\(advPayload\)/.test(adv));
ok('B15: closeAdvance sets status closed + closed_at + closed_by + close_reason',
  /async function closeAdvance\(\)/.test(adv) &&
  /status: 'closed'/.test(adv) &&
  /closed_at: new Date\(\)\.toISOString\(\)/.test(adv) &&
  /closed_by: nowUserId/.test(adv));
ok('B16: reopenAdvance flips back to open',
  /async function reopenAdvance\(adv\)/.test(adv) &&
  /status: 'open'/.test(adv) &&
  /closed_at: null/.test(adv));
ok('B17: deleteAdvance super_admin only with FK SET NULL warning',
  /async function deleteAdvance\(adv\)/.test(adv) &&
  /Only super admin can delete advances/.test(adv) &&
  /UNLINKED \(advance_id set to NULL\)/.test(adv));
ok('B18: UI grand-total tiles per currency (issued/spent/remaining)',
  /Object\.keys\(grandTotals\)\.length > 0/.test(adv) &&
  /Issued</.test(adv) &&
  /Spent</.test(adv) &&
  /Remaining</.test(adv));
ok('B19: filter pills (open/closed/all)',
  /\['open', 'closed', 'all'\]\.map/.test(adv));
ok('B20: list cards have progress bar with red>=100/amber>75/emerald colors',
  /a\.percent_spent >= 100 \? 'bg-red-600' : a\.percent_spent > 75 \? 'bg-amber-500' : 'bg-emerald-500'/.test(adv));
ok('B21: list card has View Expenses + Close + Reopen + Delete buttons',
  />View Expenses</.test(adv) &&
  />Close</.test(adv) &&
  />Reopen</.test(adv) &&
  /🗑 Delete/.test(adv));
ok('B22: issue modal: 2-col date+currency, full-width amount, name+role, description, reference',
  /Issue Date \* \/ تاريخ الإصدار/.test(adv) &&
  /Amount \* \/ المبلغ/.test(adv) &&
  /Recipient Name \* \/ المستلم/.test(adv) &&
  /Role \/ الدور \(optional\)/.test(adv));
ok('B23: issue modal hint about treasury auto-debit',
  /When you save, this also creates a DEBIT in treasury/.test(adv));
ok('B24: detail drawer shows expenses table with date/desc/category/amount + total + remaining footer',
  /detailAdvance && \(/.test(adv) &&
  />Date</.test(adv) &&
  />Description</.test(adv) &&
  />Category</.test(adv) &&
  />Amount</.test(adv) &&
  /Total spent:/.test(adv) &&
  /Remaining:/.test(adv));

// ══════════════════════════════════════════════════════════════════
// PART C — InventoryPnLReports component
// ══════════════════════════════════════════════════════════════════
ok('C1: has "use client" + imports + canSeeInventoryPnL helper',
  /'use client'/.test(pnl) &&
  /useState, useEffect, useMemo/.test(pnl) &&
  /import \{ canSeeInventoryPnL \} from '\.\.\/lib\/inventory-permissions'/.test(pnl));
ok('C2: fmtNum + fmtPct helpers',
  /function fmtNum\(n, dp\)/.test(pnl) &&
  /function fmtPct\(n\)/.test(pnl));
ok('C3: date helpers (firstOfMonth, firstOfLastMonth, lastOfLastMonth, firstOfYear)',
  /function firstOfMonth\(\)/.test(pnl) &&
  /function firstOfLastMonth\(\)/.test(pnl) &&
  /function lastOfLastMonth\(\)/.test(pnl) &&
  /function firstOfYear\(\)/.test(pnl));
ok('C4: default export InventoryPnLReports',
  /export default function InventoryPnLReports\(props\)/.test(pnl));
ok('C5: permission gate via canSeeInventoryPnL or super_admin',
  /var canSeePnL = isSuperAdmin \|\| canSeeInventoryPnL\(modulePerms\)/.test(pnl) &&
  /You don&apos;t have permission to view inventory P&amp;L reports/.test(pnl));
ok('C6: load fetches products + warehouses + lists + layers + movements in parallel',
  /Promise\.all\(\[\s+supabase\.from\('inventory_products'\)[\s\S]{0,200}supabase\.from\('inventory_warehouses'\)[\s\S]{0,200}supabase\.from\('inventory_classification_lists'\)[\s\S]{0,200}supabase\.from\('inventory_layers'\)[\s\S]{0,200}supabase\.from\('inventory_movements'\)/.test(pnl));
ok('C7: filters templates OUT of products (is_family_template !== true)',
  /\.filter\(function \(p\) \{ return p\.is_family_template !== true; \}\)/.test(pnl));
ok('C8: groupBy state with 3 options (product|category|warehouse)',
  /var \[groupBy, setGroupBy\] = useState\('product'\)/.test(pnl));
ok('C9: dateFrom + dateTo state',
  /var \[dateFrom, setDateFrom\] = useState\(firstOfMonth\(\)\)/.test(pnl) &&
  /var \[dateTo, setDateTo\] = useState\(TODAY\(\)\)/.test(pnl));
ok('C10: productStats useMemo iterates movements with date filter',
  /productStats = useMemo\(function/.test(pnl) &&
  /if \(dateFrom && d < dateFrom\) return/.test(pnl) &&
  /if \(dateTo && d > dateTo\) return/.test(pnl));
ok('C11: productStats accumulates sold_qty + revenue + cogs',
  /s\.sold_qty \+= Math\.abs\(qty\)/.test(pnl) &&
  /s\.revenue \+= rev/.test(pnl) &&
  /s\.cogs \+= cogs/.test(pnl));
ok('C12: productStats computes gross_profit + margin_pct',
  /s\.gross_profit = s\.revenue - s\.cogs/.test(pnl) &&
  /s\.margin_pct = s\.revenue > 0 \? \(s\.gross_profit \/ s\.revenue\) \* 100 : 0/.test(pnl));
ok('C13: rows useMemo switches on groupBy with 3 branches',
  /if \(groupBy === 'product'\)/.test(pnl) &&
  /if \(groupBy === 'category'\)/.test(pnl) &&
  /if \(groupBy === 'warehouse'\)/.test(pnl));
ok('C14: category rows group by category_list_id',
  /listsById\[s\.product\.category_list_id\]/.test(pnl));
ok('C15: warehouse rows group by warehouse_id',
  /whById\[m\.warehouse_id\]/.test(pnl));
ok('C16: grandTotal useMemo aggregates across rows',
  /grandTotal = useMemo\(function/.test(pnl) &&
  /t\.gross_profit \+= r\.gross_profit/.test(pnl));
ok('C17: topMovers — best, worst, topRev (only when groupBy=product)',
  /topMovers = useMemo\(function/.test(pnl) &&
  /if \(groupBy !== 'product'\) return null/.test(pnl) &&
  /var best = withSales\.slice\(0, 10\)/.test(pnl) &&
  /var worst = withSales\.slice\(\)\.sort/.test(pnl) &&
  /var topRev = withSales\.slice\(\)\.sort/.test(pnl));
ok('C18: exportExcel dynamic import xlsx + creates 2-sheet workbook',
  /async function exportExcel\(\)/.test(pnl) &&
  /var XLSX = await import\('xlsx'\)/.test(pnl) &&
  /KTC-PnL-Report-/.test(pnl));
ok('C19: printReport calls window.print',
  /function printReport\(\)/.test(pnl) &&
  /window\.print\(\)/.test(pnl));
ok('C20: UI has groupBy dropdown + dateFrom + dateTo + presets (MTD/Last Mo/YTD/All)',
  />MTD</.test(pnl) &&
  />Last Mo</.test(pnl) &&
  />YTD</.test(pnl) &&
  />All</.test(pnl));
ok('C21: UI has 5 grand-total tiles (Sold Qty / Revenue / COGS / Gross Profit / Margin)',
  />Sold Qty</.test(pnl) &&
  />Revenue</.test(pnl) &&
  />COGS</.test(pnl) &&
  />Gross Profit</.test(pnl) &&
  />Margin</.test(pnl));
ok('C22: main rows table with tfoot total row',
  /<tfoot>[\s\S]{0,1500}TOTAL \(\{rows\.length\} rows\)/.test(pnl));
ok('C23: Top Movers 3-column grid (best/worst/topRev) only when groupBy=product',
  /\{topMovers && rows\.length > 0 && \(/.test(pnl) &&
  /Top 10 by Gross Profit/.test(pnl) &&
  /Bottom 10 by Gross Profit/.test(pnl) &&
  /Top 10 by Revenue/.test(pnl));
ok('C24: empty state when no sales in range',
  /No sales activity in the selected date range/.test(pnl));

// ══════════════════════════════════════════════════════════════════
// PART D — InventoryTab wiring
// ══════════════════════════════════════════════════════════════════
ok('D1: imports InventoryPnLReports + WarehouseAdvancesTab',
  /import InventoryPnLReports from '\.\/InventoryPnLReports'/.test(it) &&
  /import WarehouseAdvancesTab from '\.\/WarehouseAdvancesTab'/.test(it));
ok('D2: SUBTABS includes pnlreports entry',
  /\{ id: 'pnlreports',\s+label: '💹 P&L Reports', stage: 'Reports'/.test(it));
ok('D3: SUBTABS includes advances entry',
  /\{ id: 'advances',\s+label: '💵 Advances', stage: 'Reports'/.test(it));
ok('D4: subtab===pnlreports renders InventoryPnLReports with full props',
  /\{subtab === 'pnlreports' && \(/.test(it) &&
  /<InventoryPnLReports userProfile=\{userProfile\} modulePerms=\{modulePerms\} isSuperAdmin=\{isSuperAdmin\} toast=\{toast\}/.test(it));
ok('D5: subtab===advances renders WarehouseAdvancesTab with userProfile+toast+canEdit',
  /\{subtab === 'advances' && \(/.test(it) &&
  /<WarehouseAdvancesTab userProfile=\{userProfile\} toast=\{toast\} canEdit=/.test(it));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════
ok('R1: 61 — AttachmentManager component still exists',
  fs.existsSync(path.join(__dirname, '..', 'src/components/AttachmentManager.jsx')));
ok('R2: 61 — attachments SQL still exists',
  fs.existsSync(path.join(__dirname, '..', 'sql/v55-83-a-6-27-61-attachments.sql')));
ok('R3: 61 — Import Shipment template has Shipment Info sheet',
  /XLSX\.utils\.book_append_sheet\(wb, shipmentSheet, 'Shipment Info'\)/.test(read('src/components/InventoryStockImport.jsx')));
ok('R4: 60 — light-blue template highlight preserved',
  /bg-sky-50/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R5: 60 — Deactivate-blocks-login fix preserved',
  /profile && profile\.active === false/.test(read('src/app/login/page.jsx')));
ok('R6: 60 — duplicate user guard preserved',
  /v55\.83-A\.6\.27\.60 — Duplicate-user guard/.test(read('src/components/SettingsTab.jsx')));
ok('R7: 60 — Product Overview history modal preserved',
  /function openHistory\(product\)/.test(read('src/components/InventoryOverview.jsx')));
ok('R8: 59 — mini-invoice + Invoice button preserved',
  /\+ Invoice/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R9: 58 — multi-currency walk preserved',
  /running\[cur\] \+= credit - debit/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R10: 55 — openaccounts in FINANCE sidebar preserved',
  /\{ group: 'FINANCE', items: \['sales', 'treasury', 'checks', 'debts', 'openaccounts'/.test(page));
ok('R11: 54 — amber header version pill preserved',
  /background: '#fef3c7'/.test(page));
ok('R12: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R13: WhatsNew widget has .62 entry',
  /version: 'v55\.83-A\.6\.27\.62'/.test(wn));
ok('R14: WhatsNew widget still has .61 entry',
  /version: 'v55\.83-A\.6\.27\.61'/.test(wn));
ok('R15: WhatsNew widget still has .60 entry',
  /version: 'v55\.83-A\.6\.27\.60'/.test(wn));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.62 or later',
  /BUILD v55\.83-A\.6\.27\.(62|6[3-9]|[7-9]\d)/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.62 tests passed');
