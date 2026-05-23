// v55.83-A.6.27.63 — FX P&L tracking (real margin vs FX gain/loss).

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var it   = read('src/components/InventoryTab.jsx');
var fxr  = read('src/components/FxRatesPanel.jsx');
var fxp  = read('src/components/FxPnLReport.jsx');
var sql  = read('sql/v55-83-a-6-27-63-fx-rates-and-snapshots.sql');
var wn   = read('src/components/WhatsNewWidget.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL migration
// ══════════════════════════════════════════════════════════════════
ok('A1: SQL creates fx_rates table',
  /CREATE TABLE IF NOT EXISTS fx_rates/.test(sql));
ok('A2: SQL has rate_date + from_currency + to_currency + rate + source',
  /rate_date\s+DATE NOT NULL/.test(sql) &&
  /from_currency TEXT NOT NULL/.test(sql) &&
  /to_currency\s+TEXT NOT NULL/.test(sql) &&
  /rate\s+NUMERIC\(14,6\) NOT NULL/.test(sql) &&
  /source\s+TEXT/.test(sql));
ok('A3: SQL enforces positive rate via CHECK',
  /CHECK \(rate > 0\)/.test(sql));
ok('A4: SQL enforces from <> to via CHECK',
  /CHECK \(from_currency <> to_currency\)/.test(sql));
ok('A5: SQL has UNIQUE on (rate_date, from_currency, to_currency)',
  /UNIQUE \(rate_date, from_currency, to_currency\)/.test(sql));
ok('A6: SQL adds cost_egp_at_receipt + fx_rate_at_receipt to inventory_layers',
  /ALTER TABLE inventory_layers\s+ADD COLUMN IF NOT EXISTS cost_egp_at_receipt NUMERIC\(14,2\)/.test(sql) &&
  /ALTER TABLE inventory_layers\s+ADD COLUMN IF NOT EXISTS fx_rate_at_receipt\s+NUMERIC\(14,6\)/.test(sql));
ok('A7: SQL adds cost_egp_at_sale + fx_rate_at_sale to inventory_movements',
  /ALTER TABLE inventory_movements\s+ADD COLUMN IF NOT EXISTS cost_egp_at_sale NUMERIC\(14,2\)/.test(sql) &&
  /ALTER TABLE inventory_movements\s+ADD COLUMN IF NOT EXISTS fx_rate_at_sale\s+NUMERIC\(14,6\)/.test(sql));
ok('A8: SQL creates fx_rate_for_date helper function',
  /CREATE OR REPLACE FUNCTION fx_rate_for_date/.test(sql) &&
  /p_from TEXT,\s+p_to\s+TEXT,\s+p_date DATE/.test(sql));
ok('A9: helper function uses most-recent-rate-<=-date semantics',
  /WHERE from_currency = p_from\s+AND to_currency\s+= p_to\s+AND rate_date\s+<= p_date\s+ORDER BY rate_date DESC\s+LIMIT 1/.test(sql));
ok('A10: SQL is STABLE-marked (deterministic for query optimizer)',
  /LANGUAGE sql STABLE/.test(sql));
ok('A11: SQL enables RLS + permissive policy',
  /ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /CREATE POLICY "Allow all on fx_rates"/.test(sql));
ok('A12: SQL has index on (rate_date DESC, from_currency, to_currency)',
  /idx_fx_rates_date_pair ON fx_rates \(rate_date DESC, from_currency, to_currency\)/.test(sql));
ok('A13: SQL idempotent (≥3 exception blocks)',
  (sql.match(/EXCEPTION WHEN (duplicate_object|others) THEN NULL/g) || []).length >= 3);
ok('A14: SQL has backout block (commented)',
  /BACKOUT[\s\S]{0,800}DROP TABLE IF EXISTS fx_rates/.test(sql));
ok('A15: SQL backout removes the 4 new columns and the function',
  /DROP COLUMN IF EXISTS cost_egp_at_receipt/.test(sql) &&
  /DROP COLUMN IF EXISTS fx_rate_at_receipt/.test(sql) &&
  /DROP COLUMN IF EXISTS cost_egp_at_sale/.test(sql) &&
  /DROP COLUMN IF EXISTS fx_rate_at_sale/.test(sql) &&
  /DROP FUNCTION IF EXISTS fx_rate_for_date/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — FxRatesPanel component
// ══════════════════════════════════════════════════════════════════
ok('B1: has "use client" + supabase import',
  /'use client'/.test(fxr) &&
  /from '\.\.\/lib\/supabase'/.test(fxr));
ok('B2: COMMON_PAIRS defines USD>EGP + EUR>EGP + EGP>USD',
  /var COMMON_PAIRS = \[[\s\S]{0,200}'USD', 'EGP'[\s\S]{0,100}'EUR', 'EGP'[\s\S]{0,100}'EGP', 'USD'/.test(fxr));
ok('B3: default export FxRatesPanel',
  /export default function FxRatesPanel\(props\)/.test(fxr));
ok('B4: state for rates + loading + error + draft + editingId + filterPair',
  /var \[rates, setRates\] = useState\(\[\]\)/.test(fxr) &&
  /var \[draft, setDraft\] = useState\(null\)/.test(fxr) &&
  /var \[editingId, setEditingId\] = useState\(null\)/.test(fxr) &&
  /var \[filterPair, setFilterPair\] = useState\('USD>EGP'\)/.test(fxr));
ok('B5: load fetches fx_rates ordered desc',
  /\.from\('fx_rates'\)[\s\S]{0,200}\.order\('rate_date', \{ ascending: false \}\)/.test(fxr));
ok('B6: load graceful degrade when fx_rates table missing',
  /relation\.\*fx_rates\.\*does not exist/.test(fxr) &&
  /Run SQL migration v55\.83-A\.6\.27\.63/.test(fxr));
ok('B7: latestByPair useMemo for "latest rate" cards',
  /latestByPair = useMemo\(function/.test(fxr) &&
  /if \(!byPair\[key\] \|\| r\.rate_date > byPair\[key\]\.rate_date\) byPair\[key\] = r/.test(fxr));
ok('B8: filteredRates useMemo by pair',
  /filteredRates = useMemo\(function/.test(fxr));
ok('B9: openNew defaults today + parsed pair',
  /function openNew\(pairKey\)/.test(fxr) &&
  /rate_date: todayISO\(\)/.test(fxr) &&
  /source: 'manual'/.test(fxr));
ok('B10: openEdit pre-fills from existing row',
  /function openEdit\(r\)/.test(fxr) &&
  /setEditingId\(r\.id\)/.test(fxr));
ok('B11: saveDraft validates rate>0 + date + currencies + from<>to',
  /Rate must be a positive number/.test(fxr) &&
  /Date is required/.test(fxr) &&
  /From \+ To currencies required/.test(fxr) &&
  /From and To must be different/.test(fxr));
ok('B12: saveDraft uses upsert with onConflict for insert path',
  /\.upsert\(payload, \{\s+onConflict: 'rate_date,from_currency,to_currency'/.test(fxr));
ok('B13: saveDraft uses update for editing path (v55.83-A.6.27.66 H1 — now includes collision pre-check, widened from 400→2000)',
  /if \(editingId\) \{[\s\S]{0,2000}\.update\(payload\)\.eq\('id', editingId\)/.test(fxr));
ok('B14: deleteRate super_admin only with confirmation',
  /async function deleteRate\(r\)/.test(fxr) &&
  /Only super admin can delete FX rates/.test(fxr));
ok('B15: header has quick-add buttons for COMMON_PAIRS',
  /COMMON_PAIRS\.map\(function \(pair\)/.test(fxr) &&
  /\+ \{pair\[0\]\}→\{pair\[1\]\}/.test(fxr));
ok('B16: latest rate cards render per pair',
  /Latest · \{r\.from_currency\} → \{r\.to_currency\}/.test(fxr) &&
  /1 \{r\.from_currency\} = \{fmtRate\(r\.rate\)\} \{r\.to_currency\}/.test(fxr));
ok('B17: filter pills (All + per pair)',
  /filterPair === 'all' \? 'bg-blue-700/.test(fxr));
ok('B18: rates table with Date / Pair / Rate / Source / Notes / Actions columns',
  />Date</.test(fxr) &&
  />Pair</.test(fxr) &&
  />Rate</.test(fxr) &&
  />Source</.test(fxr) &&
  />Notes</.test(fxr) &&
  />Actions</.test(fxr));
ok('B19: modal supports add + edit with date+from+to+rate+source+notes',
  /\{draft && \(/.test(fxr) &&
  /editingId \? '✏️ Edit FX Rate' : '\+ Log FX Rate'/.test(fxr));
ok('B20: modal explains upsert behavior (last entry wins)',
  /If a rate already exists for this date \+ pair, it will be REPLACED/.test(fxr));

// ══════════════════════════════════════════════════════════════════
// PART C — FxPnLReport component
// ══════════════════════════════════════════════════════════════════
ok('C1: has "use client" + canSeeInventoryPnL import',
  /'use client'/.test(fxp) &&
  /import \{ canSeeInventoryPnL \} from '\.\.\/lib\/inventory-permissions'/.test(fxp));
ok('C2: default export FxPnLReport',
  /export default function FxPnLReport\(props\)/.test(fxp));
ok('C3: permission gate via canSeeInventoryPnL or super_admin',
  /var canSeePnL = isSuperAdmin \|\| canSeeInventoryPnL\(modulePerms\)/.test(fxp));
ok('C4: load fetches inventory_layers + inventory_movements + fx_rates + inventory_products in parallel',
  /Promise\.all\(\[\s+supabase\.from\('inventory_layers'\)[\s\S]{0,200}supabase\.from\('inventory_movements'\)[\s\S]{0,200}supabase\.from\('fx_rates'\)[\s\S]{0,200}supabase\.from\('inventory_products'\)/.test(fxp));
ok('C5: load graceful degrade when fx_rates missing',
  /relation\.\*fx_rates\.\*does not exist/.test(fxp) &&
  /Run SQL migration v55\.83-A\.6\.27\.63/.test(fxp));
ok('C6: rateForDate helper finds most recent rate <= date',
  /function rateForDate\(fromCur, toCur, dateStr\)/.test(fxp) &&
  /r\.rate_date <= dateStr/.test(fxp));
ok('C7: latestUsdEgp useMemo finds most recent USD→EGP',
  /latestUsdEgp = useMemo\(function/.test(fxp) &&
  /r\.from_currency === 'USD' && r\.to_currency === 'EGP'/.test(fxp));
ok('C8: realized useMemo iterates movements with date range filter',
  /realized = useMemo\(function/.test(fxp) &&
  /if \(dateFrom && d < dateFrom\) return/.test(fxp) &&
  /if \(dateTo && d > dateTo\) return/.test(fxp));
ok('C9: realized computes real_margin = revenue - cost_at_receipt',
  /realMargin = revenue - costAtReceipt/.test(fxp));
ok('C10: realized computes realized_fx = cost_at_sale - cost_at_receipt',
  /realizedFx = costAtSale - costAtReceipt/.test(fxp));
ok('C11: realized computes total_gp = revenue - cost_at_sale',
  /totalGp = revenue - costAtSale/.test(fxp));
ok('C12: realized falls back to cogs when snapshots missing (backfill flag)',
  /backfill = true/.test(fxp) &&
  /costAtReceipt = cogs/.test(fxp));
ok('C13: realized tracks backfill_count in totals',
  /backfill_count: 0/.test(fxp) &&
  /if \(backfill\) totals\.backfill_count\+\+/.test(fxp));
ok('C14: unrealized useMemo iterates layers with qty_remaining > 0',
  /unrealized = useMemo\(function/.test(fxp) &&
  /if \(remaining <= 0\) return/.test(fxp));
ok('C15: unrealized computes today_value using latestUsdEgp for USD layers',
  /todayValue = unitCost \* latestUsdEgp \* remaining/.test(fxp));
ok('C16: unrealized computes unrealizedFx = today_value - cost_at_receipt',
  /unrealizedFx = todayValue - costAtReceipt/.test(fxp));
ok('C17: EGP layers have no FX exposure (todayValue = costAtReceipt)',
  /costCur === 'EGP'[\s\S]{0,300}todayValue = costAtReceipt/.test(fxp));
ok('C18: exportExcel creates 3-sheet workbook (Realized, Unrealized, Filters)',
  /async function exportExcel\(\)/.test(fxp) &&
  /'Realized P&L'/.test(fxp) &&
  /'Unrealized FX'/.test(fxp) &&
  /'Filters'/.test(fxp));
ok('C19: exportExcel filename includes FX-PnL-Report and date stamp',
  /KTC-FX-PnL-Report-/.test(fxp));
ok('C20: header shows latest USD→EGP rate when available',
  /Latest USD→EGP:/.test(fxp));
ok('C21: backfill banner shown when backfill_count > 0',
  /realized\.totals\.backfill_count > 0 \|\| unrealized\.totals\.backfill_count > 0/.test(fxp) &&
  /Backfill estimate in use/.test(fxp));
ok('C22: realized table tiles: Sold Qty / Revenue / Real Margin / Realized FX / Total Gross Profit',
  />Sold Qty</.test(fxp) &&
  />Revenue \(EGP\)</.test(fxp) &&
  />Real Margin</.test(fxp) &&
  />Realized FX</.test(fxp) &&
  />Total Gross Profit</.test(fxp));
ok('C23: unrealized table tiles: Qty On Hand / Cost @ Receipt / Today Value / Unrealized FX',
  />Qty On Hand</.test(fxp) &&
  />Cost @ Receipt \(EGP\)</.test(fxp) &&
  />Today Value \(EGP\)</.test(fxp) &&
  />Unrealized FX</.test(fxp));
ok('C24: EST badge rendered on backfill rows',
  /r\.backfill && <span[^>]*>EST<\/span>/.test(fxp));
ok('C25: rows display capped at 200 with hint to use Export',
  /\.slice\(0, 200\)/.test(fxp) &&
  /Showing first 200 of/.test(fxp));

// ══════════════════════════════════════════════════════════════════
// PART D — InventoryTab wiring
// ══════════════════════════════════════════════════════════════════
ok('D1: imports FxRatesPanel + FxPnLReport',
  /import FxRatesPanel from '\.\/FxRatesPanel'/.test(it) &&
  /import FxPnLReport from '\.\/FxPnLReport'/.test(it));
ok('D2: SUBTABS includes fxrates entry',
  /\{ id: 'fxrates',\s+label: '💱 FX Rates', stage: 'Reports'/.test(it));
ok('D3: SUBTABS includes fxpnl entry',
  /\{ id: 'fxpnl',\s+label: '💱 FX P&L', stage: 'Reports'/.test(it));
ok('D4: subtab===fxrates renders FxRatesPanel with canEdit (Edit Treasury or super_admin)',
  /\{subtab === 'fxrates' && \(/.test(it) &&
  /<FxRatesPanel userProfile=\{userProfile\} toast=\{toast\} canEdit=\{isSuperAdmin \|\| \(modulePerms && modulePerms\['Edit Treasury'\] === true\)\}/.test(it));
ok('D5: subtab===fxpnl renders FxPnLReport with full props',
  /\{subtab === 'fxpnl' && \(/.test(it) &&
  /<FxPnLReport userProfile=\{userProfile\} modulePerms=\{modulePerms\} isSuperAdmin=\{isSuperAdmin\} toast=\{toast\}/.test(it));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════
ok('R1: 62 — warehouse_advances SQL preserved',
  fs.existsSync(path.join(__dirname, '..', 'sql/v55-83-a-6-27-62-warehouse-advances.sql')));
ok('R2: 62 — InventoryPnLReports preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/InventoryPnLReports.jsx')));
ok('R3: 62 — WarehouseAdvancesTab preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/WarehouseAdvancesTab.jsx')));
ok('R4: 62 — pnlreports + advances subtabs preserved',
  /\{ id: 'pnlreports'/.test(it) &&
  /\{ id: 'advances'/.test(it));
ok('R5: 61 — AttachmentManager component preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/AttachmentManager.jsx')));
ok('R6: 61 — attachments SQL preserved',
  fs.existsSync(path.join(__dirname, '..', 'sql/v55-83-a-6-27-61-attachments.sql')));
ok('R7: 60 — light-blue template highlight preserved',
  /bg-sky-50/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R8: 60 — Deactivate-blocks-login fix preserved',
  /profile && !isActiveUser\(profile\)/.test(read('src/app/login/page.jsx')));
ok('R9: 60 — Product Overview history modal preserved',
  /function openHistory\(product\)/.test(read('src/components/InventoryOverview.jsx')));
ok('R10: 59 — mini-invoice + Invoice button preserved',
  /\+ Invoice/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R11: 58 — multi-currency walk preserved',
  /running\[cur\] \+= credit - debit/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R12: 55 — openaccounts in FINANCE sidebar preserved',
  /\{ group: 'FINANCE', items: \['sales', 'treasury', 'checks', 'debts', 'openaccounts'/.test(page));
ok('R13: 54 — amber header version pill preserved',
  /background: '#fef3c7'/.test(page));
ok('R14: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R15: WhatsNew widget has .63 entry',
  /version: 'v55\.83-A\.6\.27\.63'/.test(wn));
ok('R16: WhatsNew widget still has .62 + .61 entries',
  /version: 'v55\.83-A\.6\.27\.62'/.test(wn) &&
  /version: 'v55\.83-A\.6\.27\.61'/.test(wn));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.63 or later',
  /BUILD v55\.83-A\.6\.27\.(63|6[4-9]|[7-9]\d)/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.63 tests passed');
