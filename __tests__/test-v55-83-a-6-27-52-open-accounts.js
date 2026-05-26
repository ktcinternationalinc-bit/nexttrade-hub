// v55.83-A.6.27.52 — Open Accounts ledger
//
// New top-level tab: customer-by-customer running ledger with credit/debit
// entries. Independent of invoices/treasury. Cash-flow convention:
//   CREDIT = money IN to us (they paid us)
//   DEBIT  = money OUT from us (we paid them)
//
// Permission: super_admin OR "Open Accounts" module permission.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page     = read('src/app/page.jsx');
var oa       = read('src/components/OpenAccountsTab.jsx');
var settings = read('src/components/SettingsTab.jsx');
var sql      = read('sql/v55-83-a-6-27-52-open-accounts.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL migration shape (2 tables, RLS, triggers, CHECK constraints, idempotent)
// ══════════════════════════════════════════════════════════════════

ok('A1: CREATE TABLE open_accounts IF NOT EXISTS',
  /CREATE TABLE IF NOT EXISTS open_accounts/.test(sql));
ok('A2: open_accounts has account_name NOT NULL',
  /account_name text NOT NULL/.test(sql));
ok('A3: open_accounts has account_name_ar (bilingual)',
  /account_name_ar text/.test(sql));
ok('A4: open_accounts has active boolean DEFAULT true',
  /active boolean NOT NULL DEFAULT true/.test(sql));
ok('A5: open_accounts has audit columns (created_by, created_at, updated_at)',
  /created_by uuid/.test(sql) && /created_at timestamptz NOT NULL DEFAULT now\(\)/.test(sql) && /updated_at timestamptz NOT NULL DEFAULT now\(\)/.test(sql));
ok('A6: account_name length > 0 CHECK constraint',
  /CONSTRAINT chk_open_account_name_not_blank CHECK \(length\(trim\(account_name\)\) > 0\)/.test(sql));

ok('A7: CREATE TABLE open_account_entries IF NOT EXISTS',
  /CREATE TABLE IF NOT EXISTS open_account_entries/.test(sql));
ok('A8: open_account_entries has account_id FK with ON DELETE CASCADE',
  /account_id uuid NOT NULL REFERENCES open_accounts\(id\) ON DELETE CASCADE/.test(sql));
ok('A9: open_account_entries has entry_date NOT NULL',
  /entry_date date NOT NULL/.test(sql));
ok('A10: open_account_entries has description NOT NULL',
  /description text NOT NULL/.test(sql));
ok('A11: open_account_entries has credit_amount + debit_amount numeric(14,2)',
  /credit_amount numeric\(14,2\)/.test(sql) && /debit_amount numeric\(14,2\)/.test(sql));
ok('A12: CHECK enforces exactly ONE of credit OR debit, both positive when set',
  /CONSTRAINT chk_entry_one_amount CHECK \(\s+\(credit_amount IS NOT NULL AND debit_amount IS NULL AND credit_amount > 0\) OR\s+\(debit_amount  IS NOT NULL AND credit_amount IS NULL AND debit_amount  > 0\)\s+\)/.test(sql));
ok('A13: indexes on account_id + (account_id, entry_date)',
  /CREATE INDEX IF NOT EXISTS idx_open_entries_account ON open_account_entries \(account_id\)/.test(sql) &&
  /CREATE INDEX IF NOT EXISTS idx_open_entries_date ON open_account_entries \(account_id, entry_date\)/.test(sql));
ok('A14: RLS enabled on both tables',
  /ALTER TABLE open_accounts ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /ALTER TABLE open_account_entries ENABLE ROW LEVEL SECURITY/.test(sql));
ok('A15: updated_at trigger function + triggers on both tables',
  /CREATE OR REPLACE FUNCTION trg_open_accounts_updated_at/.test(sql) &&
  /CREATE TRIGGER open_accounts_updated_at/.test(sql) &&
  /CREATE TRIGGER open_account_entries_updated_at/.test(sql));
ok('A16: backout SQL block present (commented out)',
  /BACKOUT SQL/.test(sql) &&
  /DROP TABLE IF EXISTS open_account_entries/.test(sql) &&
  /DROP TABLE IF EXISTS open_accounts/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — Component shape + permission gating
// ══════════════════════════════════════════════════════════════════

ok('B1: OpenAccountsTab default export',
  /export default function OpenAccountsTab\(props\)/.test(oa));
ok('B2: canView = isSuperAdmin OR "Open Accounts" tab permission (v55.83-A.6.27.66 Issue 4 — split: tab key default ON)',
  /var canView = isSuperAdmin\s+\|\| \(newTab === undefined \? true : newTab === true\)/.test(oa));
ok('B3: canEdit = isSuperAdmin OR "Edit Open Accounts" action permission (v55.83-A.6.27.66 Issue 4 — split: edit key default OFF, with back-compat)',
  /var canEdit = isSuperAdmin\s+\|\| newEdit === true\s+\|\| \(newEdit === undefined && legacyOpenAccts === true\)/.test(oa));
ok('B4: shows permission-denied banner when !canView',
  /if \(!canView\) \{\s+return \(\s+<div className="bg-amber-50/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART C — Data loading + running balance computation
// ══════════════════════════════════════════════════════════════════

ok('C1: Promise.all loads open_accounts + open_account_entries',
  /Promise\.all\(\[\s+supabase\.from\('open_accounts'\)\.select\('\*'\)\.order\('account_name'\),\s+supabase\.from\('open_account_entries'\)\.select\('\*'\)\.order\('entry_date'/.test(oa));
ok('C2: detects "table does not exist" error and tells user to run the migration',
  /relation.*open_accounts.*does not exist[\s\S]{0,300}Run SQL migration v55\.83-A\.6\.27\.52/.test(oa));
ok('C3: entriesByAccount memo groups by account_id',
  /var entriesByAccount = useMemo[\s\S]{0,500}byAcc\[e\.account_id\]/.test(oa));
ok('C4: running balance walks per-currency via FIFO simulate (v72 HOTFIX 3 replaces credit-debit running)',
  /var sim = simulate\(arr\)/.test(oa) &&
  /entry\._running_by_currency = nets/.test(oa));
ok('C5: summaryFor returns per-currency shape with FIFO balance + back-compat legacy fields',
  /function summaryFor\(accountId\) \{[\s\S]{0,2500}byCurrency: byCur,\s+currencies: currencies/.test(oa) &&
  /balance: b\.netBalance/.test(oa) &&
  /totalCredit: legacyCredit,\s+totalDebit: legacyDebit/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART D — Save / delete logic
// ══════════════════════════════════════════════════════════════════

ok('D1: saveAccount validates account_name not blank',
  /var name = \(accountDraft\.account_name \|\| ''\)\.trim\(\);\s+if \(!name\) \{ alert\('Account name is required/.test(oa));
ok('D2: saveAccount routes to dbInsert for new, dbUpdate for edit',
  /if \(accountDraft\.id\) \{\s+await dbUpdate\('open_accounts'[\s\S]{0,300}\} else \{[\s\S]{0,300}await dbInsert\('open_accounts'/.test(oa));
ok('D3: deleteAccount warns about cascading entries when entryCount > 0',
  /s\.entryCount > 0/.test(oa) &&
  /AND all ' \+ s\.entryCount \+ ' entries\? This cannot be undone/.test(oa));
ok('D4: saveEntry validates description, date, and positive amount',
  /if \(!desc\) \{ alert\('Description is required/.test(oa) &&
  /if \(!entryDraft\.entry_date\) \{ alert\('Date is required/.test(oa) &&
  /if \(isNaN\(amt\) \|\| amt <= 0\) \{ alert\('Amount must be a positive number/.test(oa));
ok('D5: saveEntry derives credit_amount or debit_amount from transaction_type (v55.83-A.6.27.72 — supersedes side-based)',
  /var creditTypes = \['sales_invoice', 'payment_received'\]/.test(oa) &&
  /credit_amount: isCredit \? amt : null,\s+debit_amount: isCredit \? null : amt/.test(oa));
ok('D6: deleteEntry confirms before deleting',
  /Delete this entry\? This cannot be undone/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART E — UI: accordion + running balance column + 5-type picker (v55.83-A.6.27.72)
// ══════════════════════════════════════════════════════════════════

ok('E1: account cards collapsible (toggleAccount + collapsedAccounts state)',
  /var \[collapsedAccounts, setCollapsedAccounts\] = useState\(\{\}\)/.test(oa) &&
  /function toggleAccount\(id\)/.test(oa));
ok('E2: ▶/▼ chevron indicates collapsed state',
  /\{collapsed \? '▶' : '▼'\}/.test(oa));
ok('E3: Expand All + Collapse All buttons',
  /onClick=\{expandAll\}[\s\S]{0,200}Expand All/.test(oa) &&
  /onClick=\{collapseAll\}[\s\S]{0,200}Collapse All/.test(oa));
ok('E4: per-account summary pill shows Bal per currency (Cr/Dr removed in v72 HOTFIX 6 — caused reconciliation confusion)',
  /Bal: \{fmtSigned\(cs\.balance\)\} \{cur\}/.test(oa) &&
  // Cr/Dr labels should NO LONGER appear in the header label area (they made the math look broken)
  !/Cr: <span className="text-emerald-800">\{fmtNum\(cs\.credit\)\}/.test(oa) &&
  !/Dr: <span className="text-red-700">\{fmtNum\(cs\.debit\)\}/.test(oa));
ok('E5: balance pill color-coded (green=they owe us, red=we owe them, gray=settled) — now per currency',
  /cs\.balance > 0 \? 'bg-emerald-700 text-white' : cs\.balance < 0 \? 'bg-red-700 text-white' : 'bg-slate-500/.test(oa));
ok('E6: ledger columns Date/Type/Description/Reference/Currency/AR Side/AP Side/Open Balance/Running Balance per cur (v72 HOTFIX 11 polish)',
  />Type</.test(oa) && />Description</.test(oa) && />Reference</.test(oa) && />Currency</.test(oa) && />AR Side</.test(oa) && />AP Side</.test(oa) && />Open Balance</.test(oa) && /Running Balance \{cur\}/.test(oa));
ok('E7: AR Side emerald bg, AP Side red bg, Open Balance amber bg (v72 HOTFIX 11 polish)',
  /bg-emerald-50[\s\S]{0,300}AR Side/.test(oa) && /bg-red-50[\s\S]{0,300}AP Side/.test(oa) && /bg-amber-50[\s\S]{0,300}Open Balance/.test(oa));
ok('E8: running balance color-coded (now per-currency in .58: rbForCur instead of rb)',
  /rbForCur > 0 \? 'text-emerald-800' : rbForCur < 0 \? 'text-red-700' : 'text-slate-500'/.test(oa));
ok('E9: per-currency Summary block (header + Total AR + Total AP + Net Position rows) per spec',
  /<CUR> Summary|cur \+ '-sumhead|cur \+ ' Summary|Total AR \(They Owe Us\)|Total AP \(We Owe Them\)/.test(oa));
ok('E10: entry modal has 5-type picker (v55.83-A.6.27.72 — supersedes 2-way credit/debit toggle)',
  /transaction_type === 'sales_invoice'/.test(oa) &&
  /transaction_type === 'vendor_bill'/.test(oa) &&
  /transaction_type === 'payment_received'/.test(oa) &&
  /transaction_type === 'payment_sent'/.test(oa) &&
  /transaction_type === 'credit_adjustment'/.test(oa));
ok('E11: header banner explains transaction-type model (v55.83-A.6.27.72)',
  /Pick the transaction type first|transaction type/i.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART F — page.jsx wiring (import + tab + render branch)
// ══════════════════════════════════════════════════════════════════

ok('F1: page.jsx imports OpenAccountsTab',
  /import OpenAccountsTab from '\.\.\/components\/OpenAccountsTab'/.test(page));
ok('F2: "openaccounts" tab registered after "debts"',
  /\{ id: 'debts', label: 'Debts \/ المديونية', icon: '⚠️' \},\s+\{ id: 'openaccounts', label: 'Open Accounts \/ حسابات', icon: '📒' \}/.test(page));
ok('F3: render branch wraps in SafeSection',
  /\{tab === 'openaccounts' && \(\s+<SafeSection label="Open Accounts">\s+<OpenAccountsTab/.test(page));
ok('F4: OpenAccountsTab passed userProfile, modulePerms, isSuperAdmin, toast',
  /<OpenAccountsTab userProfile=\{userProfile\} modulePerms=\{modulePerms\} isSuperAdmin=\{isSuperAdmin\} toast=\{toast\}/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART G — Permission registration in SettingsTab
// ══════════════════════════════════════════════════════════════════

ok('G1: "Open Accounts" added to main module permission list',
  /'Bank', 'Egypt Bank', 'Open Accounts', 'Reports'/.test(settings));
ok('G2: "See Inventory Costs" added to granular permissions',
  /'View Costs', 'See Inventory Costs',/.test(settings));
ok('G3: "Open Accounts" registered in permissions (v55.83-A.6.27.66 Issue 4 — now in TAB_PERMS constant with description, plus the new "Edit Open Accounts" in ACTION_PERMS)',
  /key: 'Open Accounts'/.test(settings) && /key: 'Edit Open Accounts'/.test(settings));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: 51 — InventoryOverview default export preserved',
  /export default function InventoryOverview/.test(read('src/components/InventoryOverview.jsx')));
ok('R2: 51 — InventoryTab default subtab = overview',
  /var \[subtab, setSubtab\] = useState\('overview'\)/.test(read('src/components/InventoryTab.jsx')));
ok('R3: 51 — InventoryOverview has 9-level cascading filters',
  /family_list_id: '',\s+category_list_id: '',\s+grade_list_id: '',\s+construction_list_id: '',\s+backing_list_id: '',\s+color_list_id: '',\s+pattern_list_id: '',\s+spec_class_list_id: '',\s+origin_list_id: ''/.test(read('src/components/InventoryOverview.jsx')));
ok('R4: 50 — Variant History modal anchored to top',
  /flex items-start justify-center pt-6 pb-6 px-4/.test(read('src/components/InventoryVariantHistory.jsx')));
ok('R5: 50 — Variant History tab contrast black-on-white',
  /'bg-white text-slate-900 border-2 border-b-0 border-indigo-600 shadow-md'/.test(read('src/components/InventoryVariantHistory.jsx')));
ok('R6: 49 — Smart search in InventoryReceiving includes design_sku + classText',
  /\(p\.design_sku \|\| ''\) \+ ' '/.test(read('src/components/InventoryReceiving.jsx')) &&
  /classText\(p\)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R7: 48 — Inbound Shipments modal width 97vw / 1900',
  /(style=\{\{ width: '97vw', maxWidth: 1900|99vw)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R8: 48 — InventoryTab subtabs renamed (Receive Stock gone, Product List in place)',
  /label: '🚚 Inbound Shipments'/.test(read('src/components/InventoryTab.jsx')) &&
  /label: '🏷️ Product List'/.test(read('src/components/InventoryTab.jsx')));
ok('R9: 47 — Shipping Rates keyFor uses port_of_loading + effective_date',
  /var pol = normName\(r\.port_of_loading\) \|\| normName\(r\.origin\)/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R10: 46 — Product List schema diagnostic banner still in place',
  /Database migrations needed/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R11: 45 — Egypt Bank owner deposit + apply rules RPC still wired',
  /const toggleOwnerDeposit = async \(txnId\)/.test(read('src/components/EgyptBankTab.jsx')) &&
  /supabase\.rpc\('apply_egypt_bank_rules', params\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R12: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R13: 44a — Inventory Cutoff panel still in InventoryTab',
  /Inventory Cutoff Date.*\/.*تاريخ بدء ربط المخزون/.test(read('src/components/InventoryTab.jsx')));
ok('R14: invoice insert still uses order_number + customer_name',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum, customer_name: sanitize\(resolvedCustomerName\)/.test(page));
ok('R15: treasury linking by order_number still wired',
  /\.from\('treasury'\)\s+\.select\('id'\)\s+\.eq\('order_number', orderNum\)\s+\.is\('linked_invoice_id', null\)/.test(page));
ok('R16: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R17: existing top-level tabs unchanged (treasury, egyptbank, bank, checks, debts all present)',
  /id: 'treasury'/.test(page) && /id: 'egyptbank'/.test(page) && /id: 'bank'/.test(page) &&
  /id: 'checks'/.test(page) && /id: 'debts'/.test(page));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.52 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.52 (Open Accounts) tests passed');
