// v55.83-A.6.27.53 — Business Entities foundation + Open Accounts entity picker
//                   + Print Ledger + Excel export.
//
// New file: src/lib/open-account-export.js — print + Excel helpers
// New file: src/components/BusinessEntitiesPanel.jsx — Settings UI for editing entities
// Updated: src/components/OpenAccountsTab.jsx — entity picker + Print + Excel buttons
// Updated: src/components/SettingsTab.jsx — new "Business Entities" section (super admin)
// New SQL: sql/v55-83-a-6-27-53-business-entities.sql — business_entities table + FK on open_accounts

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page     = read('src/app/page.jsx');
var oa       = read('src/components/OpenAccountsTab.jsx');
var bep      = read('src/components/BusinessEntitiesPanel.jsx');
var settings = read('src/components/SettingsTab.jsx');
var exp      = read('src/lib/open-account-export.js');
var sql      = read('sql/v55-83-a-6-27-53-business-entities.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL migration shape
// ══════════════════════════════════════════════════════════════════

ok('A1: CREATE TABLE business_entities IF NOT EXISTS',
  /CREATE TABLE IF NOT EXISTS business_entities/.test(sql));
ok('A2: entity_code is text PRIMARY KEY (not uuid)',
  /entity_code text PRIMARY KEY/.test(sql));
ok('A3: entity_name + entity_name_ar columns',
  /entity_name text NOT NULL/.test(sql) && /entity_name_ar text/.test(sql));
ok('A4: address + contact columns present',
  /address_line1 text/.test(sql) && /city text/.test(sql) && /phone text/.test(sql) && /email text/.test(sql));
ok('A5: default_currency column with USD default',
  /default_currency text DEFAULT 'USD'/.test(sql));
ok('A6: tax_id column for invoice headers',
  /tax_id text/.test(sql));
ok('A7: CHECK constraint that entity_code not blank',
  /CONSTRAINT chk_business_entity_code_not_blank CHECK \(length\(trim\(entity_code\)\) > 0\)/.test(sql));
ok('A8: seed ktc_intl row (USA, USD)',
  /\('ktc_intl',\s+'KTC International Inc\.', 'كي تي سي إنترناشيونال', 'USA',   'USD', 1\)/.test(sql));
ok('A9: seed ktc_egypt row (Egypt, EGP)',
  /\('ktc_egypt', 'KTC Egypt',              'كي تي سي مصر',          'Egypt', 'EGP', 2\)/.test(sql));
ok('A10: seed uses ON CONFLICT DO NOTHING (idempotent)',
  /ON CONFLICT \(entity_code\) DO NOTHING/.test(sql));
ok('A11: ALTER TABLE open_accounts ADD COLUMN IF NOT EXISTS business_entity_code',
  /ALTER TABLE open_accounts\s+ADD COLUMN IF NOT EXISTS business_entity_code text REFERENCES business_entities\(entity_code\)/.test(sql));
ok('A12: backfill open_accounts.business_entity_code = ktc_intl for NULL rows',
  /UPDATE open_accounts SET business_entity_code = 'ktc_intl' WHERE business_entity_code IS NULL/.test(sql));
ok('A13: index idx_open_accounts_entity created',
  /CREATE INDEX IF NOT EXISTS idx_open_accounts_entity ON open_accounts \(business_entity_code\)/.test(sql));
ok('A14: RLS + open policy on business_entities',
  /ALTER TABLE business_entities ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /CREATE POLICY "Allow all business_entities" ON business_entities FOR ALL USING \(true\)/.test(sql));
ok('A15: updated_at trigger function + trigger',
  /CREATE OR REPLACE FUNCTION trg_business_entities_updated_at/.test(sql) &&
  /CREATE TRIGGER business_entities_updated_at/.test(sql));
ok('A16: backout SQL block present',
  /BACKOUT SQL/.test(sql) &&
  /DROP TABLE IF EXISTS business_entities/.test(sql) &&
  /ALTER TABLE open_accounts DROP COLUMN IF EXISTS business_entity_code/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — Export library (print + Excel helpers)
// ══════════════════════════════════════════════════════════════════

ok('B1: open-account-export.js exports printAccountLedger (now accepts opts in v55.83-A.6.27.72)',
  /export function printAccountLedger\(account, entity, entries, summary, opts\)/.test(exp));
ok('B2: open-account-export.js exports exportAccountLedgerToExcel (HOTFIX 30 added opts)',
  /export function exportAccountLedgerToExcel\(account, entity, entries, summary(?:, opts)?\)/.test(exp));
ok('B3: imports xlsx (SheetJS) — already installed',
  /import \* as XLSX from 'xlsx'/.test(exp));
ok('B4: print fn auto-fires window.print() via setTimeout',
  /setTimeout\(function\(\)\{ try \{ window\.print\(\); \} catch \(e\) \{\} \}, 350\)/.test(exp));
ok('B5: print fn shows entity name + address + phone in header',
  /entity\.entity_name/.test(exp) && /entity\.address_line1/.test(exp) && /entity\.phone/.test(exp));
ok('B6: print fn running net walks via signedAmount cumulative (v72 HOTFIX 6 — FIFO net, was credit-debit walk)',
  /running \+= signed/.test(exp) &&
  /var signed = signedAmount\(e\)/.test(exp));
ok('B7: print fn shows plain-English balance label (they owe us / we owe them / settled)',
  /'They owe us'/.test(exp) &&
  /'We owe them'/.test(exp) &&
  /'Settled'/.test(exp));
ok('B8: print fn HTML-escapes values (XSS-safe)',
  /function escapeHtml\(s\)/.test(exp) && /escapeHtml\(account\.account_name\)/.test(exp));
ok('B9: print fn handles missing entity gracefully (No business entity selected)',
  /No business entity selected for this account/.test(exp));
ok('B10: print fn includes convention explanation footer',
  /Convention: <strong>Credit<\/strong> = money paid to us/.test(exp));
ok('B11: Excel fn writes positive AR Side / AP Side amounts (v72 HOTFIX 11 final)',
  /arSide > 0\.005 \? arSide : ''/.test(exp) && /apSide > 0\.005 \? apSide : ''/.test(exp));
ok('B12: Excel filename sanitized + dated',
  /OpenAccount-' \+ sanitizeFilename\(account\.account_name\) \+ '-' \+ dateStr \+ '\.xlsx'/.test(exp));
ok('B13: Excel uses XLSX.utils.aoa_to_sheet + book_new + writeFile',
  /XLSX\.utils\.aoa_to_sheet/.test(exp) && /XLSX\.utils\.book_new/.test(exp) && /XLSX\.writeFile/.test(exp));
ok('B14: column widths set via ws["!cols"]',
  /ws\['!cols'\] = \[/.test(exp));

// ══════════════════════════════════════════════════════════════════
// PART C — OpenAccountsTab integration
// ══════════════════════════════════════════════════════════════════

ok('C1: OpenAccountsTab imports print + Excel helpers',
  /import \{ printAccountLedger, exportAccountLedgerToExcel \} from '\.\.\/lib\/open-account-export'/.test(oa));
ok('C2: entities state added',
  /var \[entities, setEntities\] = useState\(\[\]\)/.test(oa));
ok('C3: business_entities loaded in initial Promise.all',
  /supabase\.from\('business_entities'\)\.select\('\*'\)\.eq\('active', true\)\.order\('display_order'\)/.test(oa));
ok('C4: business_entities also loaded in reload()',
  (oa.match(/business_entities/g) || []).length >= 3);
ok('C5: business_entities load tolerates missing-table error gracefully',
  /business_entities not loaded:/.test(oa));
ok('C6: entitiesByCode memo + entityFor(account) helper',
  /var entitiesByCode = useMemo[\s\S]{0,300}\{\}/.test(oa) &&
  /function entityFor\(account\)/.test(oa));
ok('C7: handlePrintLedger + handleExportExcel accept HOTFIX 30 bilingual parameter',
  /function handlePrintLedger\(account, perspective, bilingual\)/.test(oa) &&
  /function handleExportExcel\(account, bilingual, perspective\)/.test(oa));
ok('C8: openNewAccount defaults business_entity_code to first entity (or ktc_intl)',
  /var defaultEntity = entities\.length > 0 \? entities\[0\]\.entity_code : 'ktc_intl'/.test(oa));
ok('C9: openEditAccount preserves account.business_entity_code',
  /business_entity_code: a\.business_entity_code \|\|/.test(oa));
ok('C10: saveAccount payload includes business_entity_code',
  /business_entity_code: accountDraft\.business_entity_code \|\| null/.test(oa));
ok('C11: entity picker dropdown in account modal',
  /Our Entity for this Account \* \/ كياننا/.test(oa));
ok('C12: dropdown shows fallback message when no entities loaded',
  /— No entities found \(run SQL migration \.53\) —/.test(oa));
ok('C13: 🖨️ Print dropdowns on each account card (HOTFIX 30 — EN/Bilingual options for both internal + customer)',
  /handlePrintLedger\(a, 'internal', false\)[\s\S]{0,1500}English Only/.test(oa) &&
  /handlePrintLedger\(a, 'internal', true\)[\s\S]{0,400}Bilingual/.test(oa) &&
  /handlePrintLedger\(a, 'customer', false\)/.test(oa) &&
  /handlePrintLedger\(a, 'customer', true\)/.test(oa));
ok('C14: 📊 Excel dropdown on each account card (HOTFIX 30 — EN/Bilingual)',
  /handleExportExcel\(a, false, 'internal'\)/.test(oa) &&
  /handleExportExcel\(a, true, 'internal'\)/.test(oa));
ok('C15: account header shows entity badge (🇺🇸 KTC Intl or 🇪🇬 KTC Egypt)',
  /🇺🇸 KTC Intl/.test(oa) && /🇪🇬 KTC Egypt/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART D — BusinessEntitiesPanel component
// ══════════════════════════════════════════════════════════════════

ok('D1: BusinessEntitiesPanel default export',
  /export default function BusinessEntitiesPanel\(props\)/.test(bep));
ok('D2: super-admin only gate',
  /if \(!isSuperAdmin\) \{\s+return \(/.test(bep) &&
  /super-admin only/.test(bep));
ok('D3: loads business_entities ordered by display_order',
  /supabase\.from\('business_entities'\)\.select\('\*'\)\.order\('display_order'\)/.test(bep));
ok('D4: detects missing-table error and tells user to run SQL .53',
  /Run SQL migration v55\.83-A\.6\.27\.53/.test(bep));
ok('D5: saves via supabase.update (NOT dbUpdate which uses id column)',
  /supabase\.from\('business_entities'\)\.update\(payload\)\.eq\('entity_code', editing\.entity_code\)/.test(bep));
ok('D6: edit modal has all entity fields',
  /Entity Name \* \/ اسم الكيان/.test(bep) &&
  /Arabic Name \/ اسم بالعربية/.test(bep) &&
  /Address Line 1/.test(bep) && /Address Line 2/.test(bep) &&
  /City/.test(bep) && /State \/ Region \/ Governorate/.test(bep) &&
  /Postal Code/.test(bep) && /Country/.test(bep) &&
  /Phone/.test(bep) && /Email/.test(bep) &&
  /Tax ID \(optional\)/.test(bep) && /Default Currency/.test(bep));
ok('D7: name required validation',
  /Entity name is required/.test(bep));

// ══════════════════════════════════════════════════════════════════
// PART E — SettingsTab wiring
// ══════════════════════════════════════════════════════════════════

ok('E1: SettingsTab imports BusinessEntitiesPanel',
  /import BusinessEntitiesPanel from '\.\/BusinessEntitiesPanel'/.test(settings));
ok('E2: section tab "entities" added (super admin only)',
  /\['entities', '🏢 Business Entities'\]/.test(settings));
ok('E3: render branch for entities section',
  /\{section === 'entities' && isSuperAdmin && \(\s+<BusinessEntitiesPanel userProfile=\{userProfile\} isSuperAdmin=\{isSuperAdmin\} toast=\{toast\} \/>/.test(settings));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: 52 — open_accounts SQL still loads (table referenced in load query)',
  /supabase\.from\('open_accounts'\)\.select\('\*'\)\.order\('account_name'\)/.test(oa));
ok('R2: 52 — open_account_entries still ordered by entry_date asc then created_at asc',
  /supabase\.from\('open_account_entries'\)\.select\('\*'\)\.order\('entry_date', \{ ascending: true \}\)\.order\('created_at', \{ ascending: true \}\)/.test(oa));
ok('R3: 52 — running balance now uses FIFO simulation (v72 HOTFIX 3 supersedes .58 credit-debit walk)',
  /var sim = simulate\(arr\)/.test(oa) &&
  /entry\._running_balance = netForThisCur/.test(oa));
ok('R4: 52 — summaryFor still returns balance + entryCount (FIFO-derived balance in HOTFIX 3)',
  /balance: legacyBalance,\s+entryCount: arr\.length/.test(oa) &&
  /balance: b\.netBalance/.test(oa));
ok('R5: 52 — 5-type transaction picker (v55.83-A.6.27.72 replaces CREDIT/DEBIT radio)',
  /Sales Invoice/.test(oa) && /Vendor Bill/.test(oa) && /Payment Received/.test(oa) && /Payment Sent/.test(oa));
ok('R6: 52 — entry modal validates description + date + positive amount',
  /Description is required/.test(oa) &&
  /Date is required/.test(oa) &&
  /Amount must be a positive number/.test(oa));
ok('R7: 52 — Open Accounts tab still registered in page.jsx after Debts',
  /\{ id: 'debts', label: 'Debts \/ المديونية', icon: '⚠️' \},\s+\{ id: 'openaccounts', label: 'Open Accounts \/ حسابات', icon: '📒' \}/.test(page));
ok('R8: 52 — render branch with SafeSection still in place',
  /\{tab === 'openaccounts' && \(\s+<SafeSection label="Open Accounts">/.test(page));
ok('R9: 52 — Open Accounts + See Inventory Costs permissions still registered',
  /'Bank', 'Egypt Bank', 'Open Accounts', 'Reports'/.test(settings) &&
  /'View Costs', 'See Inventory Costs',/.test(settings));
ok('R10: 51 — InventoryOverview default export preserved',
  /export default function InventoryOverview/.test(read('src/components/InventoryOverview.jsx')));
ok('R11: 51 — Inventory tab default subtab = overview',
  /var \[subtab, setSubtab\] = useState\('overview'\)/.test(read('src/components/InventoryTab.jsx')));
ok('R12: 50 — Variant History modal top-anchored with items-start',
  /flex items-start justify-center pt-6 pb-6 px-4/.test(read('src/components/InventoryVariantHistory.jsx')));
ok('R13: 49 — Smart search includes design_sku + classText',
  /\(p\.design_sku \|\| ''\) \+ ' '/.test(read('src/components/InventoryReceiving.jsx')) &&
  /classText\(p\)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R14: 48 — Inbound Shipments / Product List labels preserved',
  /label: '🚚 Inbound Shipments'/.test(read('src/components/InventoryTab.jsx')) &&
  /label: '🏷️ Product List'/.test(read('src/components/InventoryTab.jsx')));
ok('R15: 47 — Shipping Rates keyFor uses port_of_loading + effective_date',
  /var pol = normName\(r\.port_of_loading\) \|\| normName\(r\.origin\)/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R16: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R17: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R18: invoice insert still uses order_number + customer_name',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum, customer_name: sanitize\(resolvedCustomerName\)/.test(page));
ok('R19: 45 — Egypt Bank owner deposit + apply rules RPC still wired',
  /const toggleOwnerDeposit = async \(txnId\)/.test(read('src/components/EgyptBankTab.jsx')) &&
  /supabase\.rpc\('apply_egypt_bank_rules', params\)/.test(read('src/components/EgyptBankTab.jsx')));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.53 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.53 (Business Entities + Print Ledger + Excel) tests passed');
