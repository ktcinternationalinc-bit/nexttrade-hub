// v55.83-A.6.27.45 — Egypt Bank: Owner Deposit + Unified Rules Engine
//
// Verifies new functionality + locks down regression guards on matchToInvoice,
// unmatch, treasury, checks, and recalcInvoiceCollected logic.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var eb   = read('src/components/EgyptBankTab.jsx');
var sql  = read('sql/v55-83-a-6-27-45-owner-deposit-and-hide-rules.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL
// ══════════════════════════════════════════════════════════════════

ok('A1: SQL adds is_owner_deposit column with DEFAULT false',
  /ALTER TABLE egypt_bank_transactions\s+ADD COLUMN IF NOT EXISTS is_owner_deposit boolean DEFAULT false/.test(sql));
ok('A2: partial index on is_owner_deposit (WHERE true)',
  /idx_egypt_bank_txn_owner_deposit\s+ON egypt_bank_transactions \(is_owner_deposit\)\s+WHERE is_owner_deposit = true/.test(sql));
ok('A3: egypt_bank_rules table declared',
  /CREATE TABLE IF NOT EXISTS egypt_bank_rules/.test(sql));
ok('A4: rules table has CHECK that at least one matcher is set',
  /CONSTRAINT chk_rule_has_matcher CHECK \(\s+match_description IS NOT NULL OR match_amount IS NOT NULL OR match_account_id IS NOT NULL\s+\)/.test(sql));
ok('A5: rules table has CHECK that at least one action is set',
  /CONSTRAINT chk_rule_has_action CHECK \(\s+set_category IS NOT NULL OR set_hidden = true\s+\)/.test(sql));
ok('A6: is_private flag on rules with NOT NULL DEFAULT false',
  /is_private boolean NOT NULL DEFAULT false/.test(sql));
ok('A7: apply_egypt_bank_rules function declared with 3 parameters',
  /CREATE OR REPLACE FUNCTION apply_egypt_bank_rules\(\s+p_only_private boolean DEFAULT NULL,\s+p_only_rule_id uuid DEFAULT NULL,\s+p_only_unprocessed boolean DEFAULT false/.test(sql));
ok('A8: engine returns jsonb with newly_hidden + newly_categorized + rules_applied',
  /jsonb_build_object\(\s+'newly_hidden', v_total_hidden,\s+'newly_categorized', v_total_categorized,\s+'rules_applied', v_rules_applied\s+\)/.test(sql));
ok('A9: engine ORDER BY is_private DESC (private rules apply first)',
  /ORDER BY is_private DESC, created_at ASC/.test(sql));
ok('A10: engine uses quote_literal for dynamic SQL (safe against injection)',
  /quote_literal\(v_rule\.set_category\)/.test(sql) &&
  /quote_literal\(v_rule\.match_description\)/.test(sql));
ok('A11: backout SQL documented in file',
  /BACKOUT SQL[\s\S]{0,2000}DROP TABLE IF EXISTS egypt_bank_rules/.test(sql) &&
  /ALTER TABLE egypt_bank_transactions DROP COLUMN IF EXISTS is_owner_deposit/.test(sql));
ok('A12: verify queries documented',
  /VERIFY[\s\S]{0,500}Expect: 1 row[\s\S]{0,1000}Expect: 2 rows/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — State + load
// ══════════════════════════════════════════════════════════════════

ok('B1: rules state declared',
  /const \[rules, setRules\] = useState\(\[\]\)/.test(eb));
ok('B2: rule modal + editor + draft + busy state declared',
  /const \[rulesModalOpen, setRulesModalOpen\] = useState\(false\)/.test(eb) &&
  /const \[ruleEditOpen, setRuleEditOpen\] = useState\(false\)/.test(eb) &&
  /const \[ruleDraft, setRuleDraft\] = useState\(null\)/.test(eb));
ok('B3: load() fetches rules from egypt_bank_rules table',
  /supabase\.from\('egypt_bank_rules'\)\.select\('\*'\)/.test(eb));
ok('B4: non-super-admins do NOT see private rules in the load',
  /if \(!isSuperAdmin\) q = q\.eq\('is_private', false\)/.test(eb));
ok('B5: load tolerates missing egypt_bank_rules table (try/catch with empty fallback)',
  /try \{[\s\S]{0,300}from\('egypt_bank_rules'\)[\s\S]{0,500}\} catch \(e\) \{[\s\S]{0,200}setRules\(\[\]\)/.test(eb));

// ══════════════════════════════════════════════════════════════════
// PART C — Owner Deposit toggle
// ══════════════════════════════════════════════════════════════════

ok('C1: canMarkOwnerDeposit = isSuperAdmin OR isAdmin',
  /const canMarkOwnerDeposit = isSuperAdmin \|\| isAdmin/.test(eb));
ok('C2: toggleOwnerDeposit declared',
  /const toggleOwnerDeposit = async \(txnId\) =>/.test(eb));
ok('C3: toggle blocks if transaction is already matched to invoice',
  /if \(txn\.matched_invoice_id\) \{[\s\S]{0,500}This transaction is matched to an invoice/.test(eb));
ok('C4: toggle writes is_owner_deposit via dbUpdate',
  /dbUpdate\('egypt_bank_transactions', txnId, \{ is_owner_deposit: newVal \}/.test(eb));
ok('C5: toggle logs to audit_log table',
  /from\('audit_log'\)\.insert\(\{[\s\S]{0,500}action: newVal \? 'mark_owner_deposit' : 'unmark_owner_deposit'/.test(eb));
ok('C6: toggle audit failure is non-fatal (try/catch swallow)',
  /audit failure is non-fatal/.test(eb));
ok('C7: success toast is bilingual',
  /💰 Marked as owner deposit \/ تم تحديدها كإيداع المالك/.test(eb));

// ══════════════════════════════════════════════════════════════════
// PART D — Rules CRUD
// ══════════════════════════════════════════════════════════════════

ok('D1: canManageNormalRules = isSuperAdmin OR isAdmin',
  /const canManageNormalRules = isSuperAdmin \|\| isAdmin/.test(eb));
ok('D2: canManagePrivateRules = isSuperAdmin only',
  /const canManagePrivateRules = isSuperAdmin/.test(eb));
ok('D3: openRuleEditor gates private draft on canManagePrivateRules',
  /if \(isPrivateDraft && !canManagePrivateRules\) \{ toast\?\.error\?\.\('Permission denied/.test(eb));
ok('D4: saveRule validates rule_name required',
  /if \(!ruleDraft\.rule_name \|\| !String\(ruleDraft\.rule_name\)\.trim\(\)\) \{[\s\S]{0,200}Rule name is required/.test(eb));
ok('D5: saveRule validates at least one matcher',
  /const hasMatcher = !!\(ruleDraft\.match_description \|\| ruleDraft\.match_amount \|\| ruleDraft\.match_account_id\)/.test(eb));
ok('D6: saveRule validates at least one action',
  /const hasAction = !!\(ruleDraft\.set_category \|\| ruleDraft\.set_hidden\)/.test(eb));
ok('D7: saveRule blocks private rule from non-super-admin',
  /if \(ruleDraft\.is_private && !canManagePrivateRules\) \{[\s\S]{0,300}Only super admin can create or edit private rules/.test(eb));
ok('D8: saveRule offers retroactive apply after save',
  /Apply this rule now to all existing transactions \(retroactive\)/.test(eb));
ok('D9: deleteRule gates private rules on canManagePrivateRules',
  /if \(rule\.is_private && !canManagePrivateRules\) \{ toast\?\.error\?\.\('Permission denied/.test(eb));

// ══════════════════════════════════════════════════════════════════
// PART E — Apply rules engine (retroactive + at-import)
// ══════════════════════════════════════════════════════════════════

ok('E1: applyRules calls supabase.rpc("apply_egypt_bank_rules")',
  /supabase\.rpc\('apply_egypt_bank_rules', params\)/.test(eb));
ok('E2: applyRules passes p_only_unprocessed=false (retroactive default)',
  /p_only_unprocessed: false,\s+\/\/ retroactive: re-process even already-touched rows/.test(eb));
ok('E3: applyRules gates onlyPrivate on canManagePrivateRules',
  /if \(opts\.onlyPrivate === true && !canManagePrivateRules\)/.test(eb));
ok('E4: applyRulesAtImport uses p_only_unprocessed=true',
  /const applyRulesAtImport = async \(\)[\s\S]{0,500}p_only_unprocessed: true/.test(eb));
ok('E5: applyRulesAtImport called after import + autoCategorize',
  /await autoCategorizeTxns\(\);[\s\S]{0,500}applyRulesAtImport\(\)/.test(eb));
ok('E6: applyRulesAtImport failure is non-fatal',
  /\[applyRulesAtImport\] non-fatal/.test(eb));
ok('E7: success toast shows counts (hidden + categorized)',
  /Rules applied — '[\s\S]{0,500}newly_hidden \|\| 0[\s\S]{0,200}newly_categorized \|\| 0/.test(eb));

// ══════════════════════════════════════════════════════════════════
// PART F — UI: row badge + button
// ══════════════════════════════════════════════════════════════════

ok('F1: 💰 OWNER DEPOSIT badge rendered when t.is_owner_deposit',
  /\{t\.is_owner_deposit && \([\s\S]{0,500}💰 OWNER DEPOSIT/.test(eb));
ok('F2: badge has bilingual subtitle (إيداع المالك)',
  /إيداع المالك/.test(eb));
ok('F3: Owner toggle button only shown for deposits (positive amount)',
  /canMarkOwnerDeposit && !t\.matched_invoice_id && isDeposit && \(\s+<button[\s\S]{0,500}toggleOwnerDeposit\(t\.id\)/.test(eb));
ok('F4: Match button hidden when t.is_owner_deposit (cannot match)',
  /!t\.matched_invoice_id && !t\.is_owner_deposit && \(\s+<button onClick=\{\(\) => \{ setMatchingTxn\(t\); setSearchInv\(''\); \}\}/.test(eb));
ok('F5: ⚙️ Rules toolbar button visible to canManageNormalRules',
  /\{canManageNormalRules && \(\s+<button\s+onClick=\{\(\) => setRulesModalOpen\(true\)\}[\s\S]{0,500}⚙️ Rules \/ القواعد/.test(eb));

// ══════════════════════════════════════════════════════════════════
// PART G — Filter + count exclude owner deposits from Unmatched
// ══════════════════════════════════════════════════════════════════

ok('G1: Unmatched filter excludes is_owner_deposit',
  /matchFilter === 'unmatched'\) arr = arr\.filter\(t => !t\.matched_invoice_id && !t\.is_owner_deposit\)/.test(eb));
ok('G2: unmatchedCount excludes is_owner_deposit',
  /unmatchedCount = filtered\.filter\(t => !t\.matched_invoice_id && !t\.is_owner_deposit\)\.length/.test(eb));

// ══════════════════════════════════════════════════════════════════
// PART H — Rules Manager modal + Rule Editor modal rendered
// ══════════════════════════════════════════════════════════════════

ok('H1: Rules Manager modal gated on rulesModalOpen && canManageNormalRules',
  /\{rulesModalOpen && canManageNormalRules && \(/.test(eb));
ok('H2: + New Rule button calls openRuleEditor(null)',
  /onClick=\{\(\) => openRuleEditor\(null\)\}[\s\S]{0,300}\+ New Rule \/ قاعدة جديدة/.test(eb));
ok('H3: "Apply All Normal Rules Now" button',
  /onClick=\{\(\) => applyRules\(\{ onlyPrivate: false \}\)\}[\s\S]{0,500}🔄 Apply All Normal Rules Now/.test(eb));
ok('H4: "Apply Private Rules" button gated on canManagePrivateRules',
  /\{canManagePrivateRules && \(\s+<button onClick=\{\(\) => applyRules\(\{ onlyPrivate: true \}\)\}/.test(eb));
ok('H5: 🔒 PRIVATE badge shown on private rule cards',
  /r\.is_private && <span className="text-\[9px\] bg-slate-700 text-white font-extrabold rounded px-1\.5 py-0\.5">🔒 PRIVATE/.test(eb));
ok('H6: Rule Editor modal opens when ruleEditOpen && ruleDraft',
  /\{ruleEditOpen && ruleDraft && \(/.test(eb));
ok('H7: Editor has Match Criteria section (3 fields: desc, amount, account)',
  /📌 Match Criteria \(AND\) \/ معايير المطابقة/.test(eb) &&
  /Description contains \/ الوصف يحتوي/.test(eb) &&
  /Amount = \(exact\) \/ المبلغ بالضبط/.test(eb) &&
  /Specific Account \(optional\) \/ حساب محدد/.test(eb));
ok('H8: Editor has Actions section (category + subcategory + hide)',
  /⚡ Actions \/ الإجراءات/.test(eb) &&
  /Set Category \/ الفئة/.test(eb) &&
  /Hide from non-admin views \(forces private\) \/ إخفاء/.test(eb));
ok('H9: Hide checkbox forces is_private = true (linked checkbox behavior)',
  /onChange=\{\(e\) => setRuleDraft\(\{\.\.\.ruleDraft, set_hidden: e\.target\.checked, is_private: e\.target\.checked \? true : ruleDraft\.is_private\}\)\}/.test(eb));
ok('H10: Privacy section gated on canManagePrivateRules',
  /\{canManagePrivateRules && \(\s+<div className="bg-slate-100 border-2 border-slate-400/.test(eb));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS — the critical part
// Confirms 45 did NOT break invoice/banking/treasury/checks logic.
// ══════════════════════════════════════════════════════════════════

ok('R1: matchToInvoice function still defined + unchanged signature',
  /const matchToInvoice = async \(txnId, invoiceId\) => \{/.test(eb));
ok('R2: matchToInvoice still updates matched_invoice_id via dbUpdate',
  /dbUpdate\('egypt_bank_transactions', txnId, \{ matched_invoice_id: invoiceId/.test(eb));
ok('R3: placeholder promotion logic intact (is_bank_placeholder = false)',
  /is_bank_placeholder: false,\s+bank_in: bankAmt,/.test(eb));
ok('R4: check linkage via source_check_id intact',
  /\.eq\('source_check_id', matchingCheck\.id\)/.test(eb));
ok('R5: unmatch function still defined',
  /const unmatch = async \(txnId\) => \{/.test(eb));
ok('R6: unmatch sets matched_invoice_id back to null',
  /matched_invoice_id: null,/.test(eb));
ok('R7: hidden flag mechanic unchanged for non-super-admins',
  /if \(!isSuperAdmin\) arr = arr\.filter\(t => !t\.hidden\)/.test(eb));
ok('R8: showHidden toggle for super-admin unchanged',
  /else if \(!showHidden\) arr = arr\.filter\(t => !t\.hidden\)/.test(eb));
ok('R9: per-row hide button (super-admin) unchanged',
  /\{isSuperAdmin && \(\s+<button onClick=\{async \(\) => \{\s+await dbUpdate\('egypt_bank_transactions', t\.id, \{ hidden: !isHidden \}/.test(eb));
ok('R10: bulk hide selected unchanged',
  /update\(\{ hidden: true \}\)\.in\('id', ids\)/.test(eb));
ok('R11: category + subcategory still writable (existing categorization flow intact)',
  /update\(\{ category: batch\.category, subcategory: batch\.subcategory \|\| null \}\)/.test(eb));
ok('R12: autoCategorizeTxns still called after import',
  /await autoCategorizeTxns\(\)/.test(eb));
ok('R13: import flow still inserts into egypt_bank_transactions table',
  /from\('egypt_bank_transactions'\)\.insert\(chunk\)/.test(eb));
ok('R14: recalcInvoiceCollected still called in matchToInvoice + unmatch',
  /await recalcInvoiceCollected\(invoiceId\)/.test(eb));
ok('R15: invoice insert in page.jsx still uses order_number + customer_name',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum, customer_name: sanitize\(resolvedCustomerName\)/.test(page));
ok('R16: page.jsx treasury linking by order_number still wired',
  /\.from\('treasury'\)\s+\.select\('id'\)\s+\.eq\('order_number', orderNum\)\s+\.is\('linked_invoice_id', null\)/.test(page));
ok('R17: page.jsx 44b/c — 📦 From Inventory tab in invoice form still present',
  /📦 From Inventory \/ من المخزون/.test(page));
ok('R18: page.jsx 44c — consume_invoice_item_inventory RPC call still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R19: 44a — InventoryTab cutoff panel untouched',
  /Inventory Cutoff Date.*\/.*تاريخ بدء ربط المخزون/.test(read('src/components/InventoryTab.jsx')));
ok('R20: 44d.1 — Variant History modal still present',
  /export default function InventoryVariantHistory/.test(read('src/components/InventoryVariantHistory.jsx')));
ok('R21: closed-tickets fetch still has NO .limit(100) (carry from .28)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R22: source=manual still default for new invoices',
  /source: 'manual'/.test(page));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.45 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.45 (owner deposit + rules) tests passed');
