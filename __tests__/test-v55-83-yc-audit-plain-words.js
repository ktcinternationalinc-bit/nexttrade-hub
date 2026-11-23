// v55.83-YC — Max, 23 Nov 2026: "for the auditi. needs to be in layman terms. specifically clear what was changed or updated or
// deleted or whatever". Runs the REAL describer on the real SHAPES of the audit rows live has (made-up values), the REAL subject
// resolver on an in-memory database, and the three REAL writers that now record the value before (expense-rules bulk_classify,
// bank-write classify, profitability set_part_estimate). Nothing here touches Supabase.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
var W = require(path.join(root, 'src/lib/audit-words.js'));
var CTX = { cat: { phone: 'Phone', utilities: 'Utilities', card_payment: 'Card payment', bank_charges: 'Bank charges', bank_fees: 'Bank fees', partner_fee: 'Partner fee' }, wave: { 'W-PHONE': 'Telephone (Wave)', 'W-UTIL': 'Utilities (Wave)' } };
var U1 = '11111111-1111-1111-1111-111111111111'; var U2 = '22222222-2222-2222-2222-222222222222';
function say(row) { var x = W.describeAudit(row, CTX); return x.sentence + (x.facts.length ? ' | ' + x.facts.join(' · ') : ''); }
function noJson(t) { return !/[{}"\[\]]/.test(t.replace(/"[^"]{1,80}"/g, '')) && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(t) && !/fingerprint|_id\b|undefined|NaN|\[object/.test(t); }

// ── 1. the real shapes of live rows → plain sentences (exact words checked for the ones Max saw)
var cases = [
  ['bulk_categorized (the row Max saw)', { action: 'bulk_categorized', entity: 'bank_transactions', entity_id: '1 rows', details: { reviewed: 1, wave_updated: 0, rules_learned: 1, classification: 'phone', look_alikes_updated: 0 } }, /^Set the category of 1 bank line to Phone \| A rule was learned from it · Marked reviewed$/],
  ['bulk_categorized NEW row (one line named, category before)', { action: 'bulk_categorized', entity: 'bank_transactions', entity_id: '1 rows', subject: 'bank line Nov 3, 2026 · $45.20 · VODAFONE', details: { classification: 'phone', before: 'utilities', lines: 1, ids: [U1], rules_learned: 0, look_alikes_updated: 2, reviewed: 0, wave_updated: 1 } }, /^Set the category of bank line Nov 3, 2026 · \$45\.20 · VODAFONE to Phone \| Category: Utilities → Phone · 2 other line\(s\) with the same description were set too · Wave category set on 1 line\(s\)$/],
  ['pl_part_estimate_set (the row Max saw)', { action: 'pl_part_estimate_set', entity: 'release', entity_id: '10011622', details: { note: null, part: 'trucking', amount: 741 } }, /^Set the trucking cost for release 1001-1622 to \$741\.00$/],
  ['pl_part_estimate_set NEW row with the amount before', { action: 'pl_part_estimate_set', entity: 'release', entity_id: '10011622', details: { part: 'trucking', amount: 1500, was: null, note: 'quote from Kronos' } }, /^Set the trucking cost for release 1001-1622 to \$1,500\.00 \| Trucking cost: empty → \$1,500\.00 · Note: quote from Kronos$/],
  ['pl_part_estimate_set cleared', { action: 'pl_part_estimate_set', entity: 'release', entity_id: '10011622', details: { part: 'freight', amount: null, was: 900 } }, /^Cleared the freight cost for release 1001-1622 \| Freight cost: \$900\.00 → empty$/],
  ['category_pick_undo_point (a single pick, full before / after)', { action: 'category_pick_undo_point', entity: 'bank_transaction', subject: 'bank line Nov 3, 2026 · $45.20 · VODAFONE', details: { v: 2, cls: 'phone', line: { id: U1, who: 'VODAFONE', before: { classification: null, review_status: 'unreviewed' }, after: { classification: 'phone', review_status: 'reviewed' } }, look: [], rule: { how: 'learned' } } }, /^Changed the category of bank line Nov 3, 2026 · \$45\.20 · VODAFONE: no category → Phone \| Review: unreviewed → reviewed · Rule learned$/],
  ['category_removed (XU)', { action: 'category_removed', entity: 'bank_transaction', subject: 'bank line Nov 5, 2026 · $10.00 · PSE&G', details: { before: { classification: 'utilities', review_status: 'reviewed', wave_account_id: 'W-UTIL' }, after: { classification: null, review_status: 'unreviewed' } } }, /^Removed the category Utilities from bank line Nov 5, 2026 · \$10\.00 · PSE&G \(back to Uncategorized\) \| Review: reviewed → unreviewed · Wave category removed too$/],
  ['bank_classify (old row: only a Wave account)', { action: 'bank_classify', entity: 'bank_transaction', subject: 'bank line Nov 1, 2026 · $9.99 · AT&T', details: { wave_account_id: 'W-PHONE' } }, /^Set the Wave category of bank line Nov 1, 2026 · \$9\.99 · AT&T to Telephone \(Wave\)$/],
  ['bank_classify NEW row with before', { action: 'bank_classify', entity: 'bank_transaction', subject: 'bank line Nov 1, 2026 · $9.99 · AT&T', details: { classification: 'phone', wave_account_id: 'W-PHONE', before_classification: 'utilities', before_wave_account_id: 'W-UTIL' } }, /^Set the category of bank line Nov 1, 2026 · \$9\.99 · AT&T to Phone \| Category: Utilities → Phone · Wave category: Telephone \(Wave\) · Wave category: Utilities \(Wave\) → Telephone \(Wave\)$/],
  ['company_line_categorized', { action: 'company_line_categorized', entity: 'bank_transaction', subject: 'bank line Nov 2, 2026 · $500.00 · CHASE CARD', details: { to: 'card_payment', from: null, source: 'rule', company: 'NEXTRADE_BOOKS', ktc_bill_id: null, ktc_bill_action: 'none' } }, /^Set the category of Nextrade bank line Nov 2, 2026 · \$500\.00 · CHASE CARD to Card payment \| Category: no category → Card payment · Done by a rule$/],
  ['company_line_categorized → removed', { action: 'company_line_categorized', entity: 'bank_transaction', subject: 'bank line X', details: { to: null, from: 'card_payment', company: 'RTM_BOOKS', ktc_bill_action: 'voided' } }, /^Removed the category from Rtm bank line X \| Category: Card payment → no category · KTC bill voided$/],
  ['permission_changed', { action: 'permission_changed', entity: 'user', refs: { person: 'Aya' }, details: { to: true, names: ['bills.weight_check.settings'], before: {}, switch: 'bills.weight_check.settings', target_role: 'team' } }, /^Turned ON "bills · weight check · settings" for Aya \| Their role: team$/],
  ['price_rule_changed (before / after)', { action: 'price_rule_changed', entity: 'bill_price_rule', details: { before: { id: U1, unit: 'YDS', vendor_match: 'NexPac', item_match: 'Cambridge Rewinding', expected_unit_price: 0.12, updated_at: '2026-11-14T00:00:00Z' }, after: { unit: 'YDS', vendor_match: 'NexPac', item_match: 'Cambridge Rewinding', expected_unit_price: 0.15, updated_at: '2026-11-15T00:00:00Z', updated_by: U2 } } }, /^Changed a price rule for NexPac · Cambridge Rewinding \| expected unit price: \$0\.12 → \$0\.15$/],
  ['price_rule_created', { action: 'price_rule_created', entity: 'bill_price_rule', details: { unit: 'YARD', vendor_match: 'Skeen', item_match: 'Headliner', expected_unit_price: 0.9, tolerance_pct: 0, updated_by: U1 } }, /^Created a price rule for Skeen · Headliner \| Expected price \$0\.90 per yard · Allowed difference 0%$/],
  ['pl_name_unit_set', { action: 'pl_name_unit_set', entity: 'pl_name_unit', entity_id: 'headliner by yds', details: { unit: 'yd', names: ['HEADLINER BY YDs'] } }, /^Set the unit of HEADLINER BY YDs to yd$/],
  ['pl_group_names_added', { action: 'pl_group_names_added', entity: 'pl_product_group', refs: { group: 'Headliner' }, details: { added: { bill: 0, invoice: 1 }, bill_names: [], invoice_names: ['HEADLINER BY YDs'] } }, /^Added HEADLINER BY YDs to the product group Headliner \| 1 invoice name\(s\)$/],
  ['pl_manual_cost_set', { action: 'pl_manual_cost_set', entity: 'accounting_invoice_item', subject: 'the line "Cambridge Seconds" of invoice AMERICA 1791', details: { to: { note: null, cost_per_lb: 0.65, commission_per_lb: 0 }, from: null, level: 'line' } }, /^Set the cost of the line "Cambridge Seconds" of invoice AMERICA 1791 to \$0\.65 per lb \| cost per lb: set to \$0\.65 · commission per lb: set to \$0\.00$/],
  ['nextrade_category_mapped', { action: 'nextrade_category_mapped', entity: 'company_category', details: { to: 'bank_charges', from: null, bills_filled: 2, nextrade_category: 'bank_fees' } }, /^Linked the Nextrade category Bank fees to the KTC category Bank charges \| KTC category: no category → Bank charges · 2 KTC bill\(s\) filled in$/],
  ['rtm_payment_flagged', { action: 'rtm_payment_flagged', entity: 'bank_transaction', subject: 'bank line Oct 2, 2026 · $20,000.00 · WIRE IN', details: { payer: 'RTM Capital', before: { third_party_payer: null }, reviewed: false } }, /^Marked bank line Oct 2, 2026 · \$20,000\.00 · WIRE IN as money sent through RTM Capital \| Was: not marked$/],
  ['transfer_paired (both lines named)', { action: 'transfer_paired', entity: 'bank_transaction', subject: 'Nov 4, 2026 · $1,000.00 · TRANSFER OUT', refs: { bank2: 'Nov 4, 2026 · $1,000.00 · TRANSFER IN' }, details: { reviewed: 1, transfer_group_id: U1 } }, /^Paired two bank lines as a transfer between our own accounts \| Line: Nov 4, 2026 · \$1,000\.00 · TRANSFER OUT · Other side: Nov 4, 2026 · \$1,000\.00 · TRANSFER IN · Marked reviewed$/],
  ['match_reversed', { action: 'match_reversed', entity: 'bank_transaction', subject: 'bank line Y', details: { invoices: 3, splits_removed: 0 } }, /^Undid the invoice match of bank line Y \| 3 invoice payment\(s\) removed$/],
  ['bank_duplicate_removed', { action: 'bank_duplicate_removed', entity: 'bank_transaction', details: { date: '2026-06-12', kept: U2, amount: 250, reason: 'Same bank line, brought in twice' } }, /^Removed a duplicate copy of a bank line of \$250\.00 dated Jun 12, 2026 — the other copy was kept \| Reason: Same bank line, brought in twice$/],
  ['invoice_delete', { action: 'invoice_delete', entity: 'accounting_invoices', details: { from: null, name: 'dtest', released_bank_lines: 0 } }, /^Deleted invoice dtest$/],
  ['bill_voided', { action: 'bill_voided', entity: 'vendor_bill', subject: 'NexPac Corporation bill 14481', details: { reason: 'Uploaded twice', kept_copy: U2 } }, /^Voided NexPac Corporation bill 14481 \(kept on file, no longer counted\) \| Reason: Uploaded twice · The other copy was kept$/],
  ['bill_deleted', { action: 'bill_deleted', entity: 'vendor_bill', subject: 'Kronos bill 77', details: { reason: 'Will upload the correct one', voided_payments: 1 } }, /^Deleted Kronos bill 77 from the Hub \| Reason: Will upload the correct one · 1 payment\(s\) on it were undone$/],
  ['bill_disputed (bill event)', { action: 'bill_disputed', entity: 'vendor_bill', subject: 'AMB bill 5', details: { reason: 'No CGT reference', ticket: 'BILL-20261118-609', follow_up: '2026-11-25', assigned_to: U1 } }, /^Disputed AMB bill 5 \| Reason: No CGT reference · Ticket BILL-20261118-609 · Follow up on Nov 25, 2026$/],
  ['bill_file_ingested (bill event)', { action: 'bill_file_ingested', entity: 'vendor_bill', subject: 'Skeen bill 9', details: { file: 'scan.jpeg', pages: null, sorted: { bill_type: 'supplier' } } }, /^Imported Skeen bill 9 from a file \| File: scan\.jpeg$/],
  ['shipping_markup_override (XV)', { action: 'shipping_markup_override', entity: 'accounting_invoice', subject: 'invoice AMERICA 1791', details: { rule: 'x', overridden: true, reason: 'Long-standing customer price', shipping_terms: 'CIF', shipping_cost: 1000, minimum_required: 1070, shipping_charged: 1000, short_by: 70 } }, /^Saved shipping terms on invoice AMERICA 1791 with shipping charged BELOW our cost \+ 7% \| Charged \$1,000\.00, minimum \$1,070\.00 — short by \$70\.00 · Our shipping cost \$1,000\.00 · Reason: Long-standing customer price$/],
  ['invoice_shipping_terms_set', { action: 'invoice_shipping_terms_set', entity: 'accounting_invoice', subject: 'invoice AMERICA 1791', details: { from: { shipping_terms: 'EXW', shipping_cost_estimate: null, basis: 'EXW' }, to: { shipping_terms: 'CIF', shipping_cost_estimate: 1000, basis: 'CIF' } } }, /^Set the shipping terms of invoice AMERICA 1791 \| shipping terms: EXW → CIF · shipping cost estimate: empty → \$1,000\.00 · basis: EXW → CIF$/],
  ['party_starting_balance (XO)', { action: 'party_starting_balance', entity: 'party_opening_balance', details: { party: 'NextTrade Industries', amount: 4500, as_of: '2026-06-01', reason: 'Balance on their books', visible_to_staff: true, request_id: 'r1', before: null, after: {} } }, /^Added a starting balance of \$4,500\.00 held with NextTrade Industries as of Jun 1, 2026 \| Reason: Balance on their books$/],
  ['party_starting_balance_used', { action: 'party_starting_balance_used', entity: 'party_opening_balance', details: { party: 'RTM Capital', paid_date: '2026-07-01', reference: 'REF-9', bills: [U1, U2], total: 1000, payment_ids: [U1] } }, /^Paid 2 bill\(s\) from the starting balance held with RTM Capital \| Total \$1,000\.00 · Paid on Jul 1, 2026 · Reference: REF-9$/],
  ['arrival_reminder_sent', { action: 'arrival_reminder_sent', entity: 'warehouse_order', details: { log: U1, release: '10011622', to: ['buyer@example.com'], phase: 'arrived', slot: 1, remaining: 2500, message_id: 'm1' } }, /^Sent an arrival reminder for release 1001-1622 to buyer@example\.com \| Balance due \$2,500\.00 · Stage: arrived$/],
  ['arrival_reminder_send_failed', { action: 'arrival_reminder_send_failed', entity: 'warehouse_order', details: { release: '10011622', error: 'mailbox full' } }, /^An arrival reminder for release 1001-1622 was NOT sent \| Why: mailbox full$/],
  ['wire_package_deleted', { action: 'wire_package_deleted', entity: 'wire_package', subject: 'WP-0012 to NexPac', details: { reason: 'Wrong payee', total: 5000, payee: 'NexPac' } }, /^Deleted pre-wire WP-0012 to NexPac \| Reason: Wrong payee · It was for \$5,000\.00 to NexPac$/],
  ['deposit_matched_to_invoice', { action: 'deposit_matched_to_invoice', entity: 'bank_transaction', subject: 'bank line Z', refs: { invoice: 'AMERICA 1804' }, details: { applied: 10000, deposit_remaining: 0 } }, /^Matched a deposit to invoice AMERICA 1804 \| Deposit: bank line Z · Applied \$10,000\.00$/]
];
var bad = [];
cases.forEach(function (c) { var t = say(c[1]); if (!c[2].test(t) || !noJson(t)) { bad.push([c[0], t]); } });
check('LIVE SHAPES: ' + cases.length + ' real row shapes (incl. both rows in Max\'s screenshot) read as one plain sentence + plain facts, exactly as expected — no JSON, no ids', bad.length === 0, bad);

// every action live has (counted 23 Nov) has its own sentence, not the fallback
var LIVE = ['wire_bill_reviewed', 'bill_imported_from_file', 'bill_validated', 'company_line_categorized', 'bill_created', 'bill_payment_recorded', 'bill_payment_voided', 'bulk_categorized', 'pl_name_unit_set', 'price_rule_changed', 'bank_classify', 'bill_validation_progress_saved', 'wire_package_audit_run', 'permission_changed', 'deposit_matched_to_invoice', 'pl_group_names_added', 'price_rule_created', 'pl_part_estimate_set', 'bill_lines_saved', 'pl_group_created', 'wire_check_overridden', 'wire_package_updated', 'wire_package_prepared', 'wire_package_signoff_1', 'rtm_payment_flagged', 'category_pick_undo_point', 'bank_duplicate_removed', 'company_rule_learned', 'bill_updated', 'wire_package_signoff_2', 'match_reversed', 'pl_manual_cost_set', 'company_category_created', 'transfer_paired', 'rule_applied_now', 'nextrade_category_mapped', 'bill_deleted', 'deposit_split_saved', 'company_rules_applied', 'wire_package_deleted', 'statement_rows_imported', 'bill_voided', 'bank_duplicate_dismissed', 'pl_name_kind_set', 'pl_invoice_terms_set', 'bank_duplicate_auto_removed', 'wire_package_reversed', 'customer_credit_reconciled', 'price_rule_turned_off', 'manual_account_created', 'price_rule_turned_on', 'invoice_delete', 'company_rule_created', 'rule_applied_on_categorize', 'bill_duplicate_dismissed', 'invoice_totals_recomputed', 'nextrade_bill_updated', 'wire_package_cancelled', 'pl_customer_basis_set', 'nextrade_bill_cutoff_on', 'nextrade_bill_cutoff_pressed_on', 'bill_validation_reopened', 'bill_payments_voided_by_wire_undo', 'pl_warehouse_sync',
  'category_removed', 'shipping_markup_override', 'invoice_shipping_terms_set', 'party_starting_balance', 'party_starting_balance_correction', 'party_starting_balance_used', 'arrival_reminder_sent', 'arrival_reminder_test_sent', 'arrival_reminder_send_failed', 'arrival_reminder_delivery_unconfirmed',
  'bill_file_ingested', 'bill_disputed', 'bill_dispute_resolved', 'bill_dup_dismissed'];
var fellBack = LIVE.filter(function (a) { var x = W.describeAudit({ action: a, details: {} }, CTX); return x.sentence.toLowerCase() === a.replace(/_/g, ' '); });
check('COVERAGE: each of the ' + LIVE.length + ' actions seen on live (+ today\'s new ones and the bill events) has its own sentence', fellBack.length === 0, fellBack);
var emptyBad = LIVE.filter(function (a) { var x = W.describeAudit({ action: a, details: {} }, CTX); var t = x.sentence + ' ' + x.facts.join(' '); return !noJson(t) || /\$NaN|null|undefined/.test(t); });
check('OLD ROWS with almost nothing stored still read cleanly (no "undefined", "null", NaN or JSON)', emptyBad.length === 0, emptyBad);

// deleted / voided / removed / cancelled / reversed always said in words
var gone = [['bill_deleted', /Deleted/], ['bill_voided', /Voided/], ['bill_payment_voided', /voided/], ['wire_package_deleted', /Deleted/], ['wire_package_cancelled', /Cancelled/], ['wire_package_reversed', /Undid sent wire/], ['invoice_delete', /Deleted/], ['category_removed', /Removed the category/], ['bank_duplicate_removed', /Removed a duplicate/], ['bank_duplicate_auto_removed', /The Hub removed a duplicate/], ['price_rule_turned_off', /Turned OFF/], ['match_reversed', /Undid/]];
var goneBad = gone.filter(function (g) { return !g[1].test(W.describeAudit({ action: g[0], details: {} }, CTX).sentence); });
check('WORDS: deleted / voided / removed / cancelled / undone / turned off are always said in words', goneBad.length === 0, goneBad);

// ── 2. the fallback for an action not known yet: never JSON, changes as "name: old → new", ids hidden
var fb = W.describeAudit({ action: 'some_new_thing_changed', subject: 'invoice AMERICA 1800', details: { from: { amount_due: 100, status: 'open', id: U1 }, to: { amount_due: 50, status: 'partial', id: U1 }, fingerprint: 'abc', request_id: U2 } }, CTX);
var fbt = fb.sentence + ' | ' + fb.facts.join(' · ');
check('FALLBACK: an unknown action → "Some new thing changed — invoice AMERICA 1800" + "amount due: $100.00 → $50.00 · status: open → partial"; no ids, fingerprints or JSON', fbt === 'Some new thing changed — invoice AMERICA 1800 | amount due: $100.00 → $50.00 · status: open → partial' && noJson(fbt), fbt);
var fb2 = W.describeAudit({ action: 'gadget_set', details: { colour: 'red', count: 3, owner_id: U1, when: '2026-11-02', nested: { a: 1 } } }, CTX);
check('FALLBACK without from/to: the simple facts in words (ids hidden)', fb2.sentence === 'Gadget set' && fb2.facts.indexOf('Colour: red') >= 0 && fb2.facts.indexOf('Count: 3') >= 0 && !fb2.facts.some(function (f) { return /owner/.test(f); }) && noJson(fb2.facts.join(' ')), fb2);
var fb3 = W.describeAudit({ action: 'thing_updated', details: { before: { label: 'Old', updated_at: 'x' }, after: { label: 'New', updated_at: 'y' } } }, CTX);
check('FALLBACK with before / after: "label: Old → New"; bookkeeping fields hidden', fb3.facts.length === 1 && fb3.facts[0] === 'label: Old → New', fb3);
check('BillsTab still works: describeAudit(row) without names keeps its old sentences', W.describeAudit({ action: 'bill_payment_recorded', subject: 'NexPac bill 1', details: { amount: 10, paid_date: '2026-11-01' } }).sentence === 'Recorded a payment of $10.00 on NexPac bill 1');
check('a category with no label yet is still said in words ("partner_fee" → "Partner fee"), not as a code', W.describeAudit({ action: 'bulk_categorized', entity_id: '1 rows', details: { classification: 'storage_fees' } }, {}).sentence === 'Set the category of 1 bank line to Storage fees');

// ── 3. the server names: real resolver + context on an in-memory database
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var B1 = '33333333-3333-3333-3333-333333333333', B2 = '44444444-4444-4444-4444-444444444444', G1 = '55555555-5555-5555-5555-555555555555', IT = '66666666-6666-6666-6666-666666666666', IV = '77777777-7777-7777-7777-777777777777';
function tx(id, name, o) { return Object.assign({ id: id, name: name, merchant_name: null, direction: 'out', classification: 'utilities', category_source: 'classification', category_verified: false, review_status: 'unreviewed', reviewed_by: null, reviewed_at: null, wave_business_id: US, transfer_group_id: null, matched_invoice_id: null, pending: false, account_id: 'A1', date: '2026-11-05', posted_date: '2026-11-05', amount_abs: 45.2, amount: -45.2, wave_account_id: null, wave_account_name: null, category_status: 'local_only', wave_sync_status: 'not_synced', sync_status: 'not_synced' }, o || {}); }
function fresh() {
  global.__db = new MemDB({
    users: [{ id: 'u1', role: 'super_admin', name: 'Max', email: 'max@example.com' }, { id: U2, role: 'employee', name: 'Aya', email: 'aya@example.com' }], module_permissions: [],
    expense_categories: [{ key: 'phone', label: 'Phone', wave_account_id: 'W-PHONE', wave_account_name: 'Telephone (Wave)' }, { key: 'utilities', label: 'Utilities' }],
    company_categories: [{ key: 'card_payment', label: 'Card payment' }], wave_categories: [{ wave_account_id: 'W-PHONE', wave_account_name: 'Telephone (Wave)' }, { wave_account_id: 'W-UTIL', wave_account_name: 'Utilities (Wave)' }],
    pl_product_groups: [{ id: G1, display_name: 'Headliner' }], accounting_invoices: [{ id: IV, invoice_number: 'AMERICA 1791' }], accounting_invoice_items: [{ id: IT, invoice_id: IV, description: 'Cambridge Seconds' }],
    us_expense_rules: [], hub_audit_log: [], plaid_accounts: [], accounting_invoice_payments: [], vendor_bill_payments: [], vendor_bills: [], wire_packages: [], bank_transaction_splits: [], bank_unapplied: [], customer_credits: [], unapplied_deposits: [],
    pl_release_part_estimates: [{ release_key: '10011622', part: 'trucking', amount: 741, note: null }],
    bank_transactions: [tx(B1, 'VODAFONE 0001'), tx(B2, 'TRANSFER IN', { direction: 'in', amount_abs: 1000 })]
  });
  return global.__db;
}
(async function () {
  fresh();
  var S = require(path.join(root, 'src/lib/audit-subjects-server.js'));
  var rows = [
    { action: 'permission_changed', entity: 'user', entity_id: U2, details: { to: true, switch: 'audit.view' } },
    { action: 'pl_group_names_added', entity: 'pl_product_group', entity_id: G1, details: { invoice_names: ['HEADLINER BY YDs'] } },
    { action: 'pl_manual_cost_set', entity: 'accounting_invoice_item', entity_id: IT, details: { to: { cost_per_lb: 0.65 }, from: null, level: 'line' } },
    { action: 'transfer_paired', entity: 'bank_transaction', entity_id: B1 + '+' + B2, details: { reviewed: 1 } },
    { action: 'bulk_categorized', entity: 'bank_transactions', entity_id: '1 rows', details: { classification: 'phone', ids: [B1], before: 'utilities', lines: 1 } },
    { action: 'invoice_delete', entity: 'accounting_invoices', entity_id: IV, details: { name: 'x' } },
    { action: 'bank_classify', entity: 'bank_transaction', entity_id: B1, details: { wave_account_id: 'W-PHONE', before_wave_account_id: 'W-UTIL' } }
  ];
  await S.addAuditSubjects(global.__db, rows);
  var ctx = await S.auditContext(global.__db, rows);
  var t = rows.map(function (r) { var x = W.describeAudit(r, ctx); return x.sentence + (x.facts.length ? ' | ' + x.facts.join(' · ') : ''); });
  check('NAMES: a permission change names the PERSON', /for Aya$/.test(t[0]), t[0]);
  check('NAMES: a product group by its name', /to the product group Headliner/.test(t[1]), t[1]);
  check('NAMES: an invoice line by its text and invoice number', /the line "Cambridge Seconds" of invoice AMERICA 1791/.test(t[2]), t[2]);
  check('NAMES: a transfer pair names BOTH bank lines (date · amount · payee)', /Line: Nov 5, 2026 · \$45\.20 · VODAFONE 0001 · Other side: Nov 5, 2026 · \$1,000\.00 · TRANSFER IN/.test(t[3]), t[3]);
  check('NAMES: a one-line bulk pick names the bank line and its category before (label, not key)', /^Set the category of bank line Nov 5, 2026 · \$45\.20 · VODAFONE 0001 to Phone \| Category: Utilities → Phone$/.test(t[4]), t[4]);
  check('NAMES: an invoice deleted under the plural entity name is named', /^Deleted invoice AMERICA 1791$/.test(t[5]), t[5]);
  check('NAMES: Wave accounts by name, from the context (category labels from both KTC and company books)', /Telephone \(Wave\)/.test(t[6]) && /Utilities \(Wave\) → Telephone \(Wave\)/.test(t[6]) && ctx.cat.card_payment === 'Card payment' && ctx.cat.phone === 'Phone', [t[6], ctx]);
  var failDb = { from: function () { return { select: function () { return { in: function () { return Promise.reject(new Error('down')); } }; } }; } };
  var r2 = [{ action: 'bank_classify', entity: 'bank_transaction', entity_id: B1, details: {} }]; await S.addAuditSubjects(failDb, r2); var c2 = await S.auditContext(failDb, r2);
  check('FAIL-SOFT: lookups that fail leave the row readable (no subject, empty names) — never an error', r2[0].refs && !r2[0].subject && JSON.stringify(c2) === JSON.stringify({ cat: {}, wave: {} }), [r2, c2]);

  // the route: the search finds the plain sentence; the context is returned
  var auditRoute = require(path.join(root, 'src/app/api/accounting/audit/route.js'));
  fresh(); global.__db.t.hub_audit_log.push({ id: 'a1', at: '2026-11-23T10:00:00Z', actor_id: 'u1', action: 'pl_part_estimate_set', entity: 'release', entity_id: '10011622', details: { part: 'trucking', amount: 741 } });
  global.__db.t.vendor_bill_events = [];
  var resA = await auditRoute.POST({ json: function () { return Promise.resolve({ user_id: 'u1', action: 'list', q: 'trucking cost for release 1001-1622' }); }, headers: { get: function () { return null; } } }); var jA = await resA.json();
  check('ROUTE: searching the plain words ("trucking cost for release 1001-1622") finds the row; the names (ctx) come back with the rows', jA.ok === true && jA.rows.length === 1 && jA.rows[0].action === 'pl_part_estimate_set' && jA.ctx && jA.ctx.cat.phone === 'Phone', jA);

  // ── 4. the writers record the value BEFORE (real routes)
  var er = require(path.join(root, 'src/app/api/accounting/expense-rules/route.js'));
  fresh();
  var resB = await er.POST({ json: function () { return Promise.resolve({ user_id: 'u1', action: 'bulk_classify', payload: { ids: [B1], classification: 'phone', single_pick: true } }); }, headers: { get: function () { return null; } } }); var jB = await resB.json();
  var auB = global.__db.t.hub_audit_log.filter(function (a) { return a.action === 'bulk_categorized'; })[0];
  check('WRITER bulk_classify (real route): the audit row now names the line and the category BEFORE (utilities), with the count', jB.ok === true && auB && auB.details.before === 'utilities' && auB.details.lines === 1 && JSON.stringify(auB.details.ids) === JSON.stringify([B1]) && auB.details.classification === 'phone', [jB, auB]);
  fresh(); var many = []; for (var k = 0; k < 25; k++) { var idk = '9999999' + String(k).padStart(1, '0') + '-0000-0000-0000-' + String(k).padStart(12, '0'); global.__db.t.bank_transactions.push(tx(idk, 'X' + k)); many.push(idk); }
  await er.POST({ json: function () { return Promise.resolve({ user_id: 'u1', action: 'bulk_classify', payload: { ids: many, classification: 'phone' } }); }, headers: { get: function () { return null; } } });
  var auM = global.__db.t.hub_audit_log.filter(function (a) { return a.action === 'bulk_categorized'; })[0];
  check('WRITER bulk (25 lines): the count is 25, at most 20 ids are kept, and no "before" is claimed for a many-line pick', auM && auM.details.lines === 25 && auM.details.ids.length === 20 && auM.details.before === undefined, auM && auM.details);

  // bank-write classify: its own sign-in check is replaced by a stand-in returning the super admin
  function stub(file, exportsObj) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exportsObj; require.cache[id] = m0; }
  function BVE(msg, st) { this.message = msg; this.status = st; } BVE.prototype = Object.create(Error.prototype);
  stub(path.join(root, 'src/lib/bank-visibility.js'), { authorizeBankIdentity: async function () { return { db: global.__db, profileId: 'u1', authUserId: 'u1' }; }, readBankJson: async function (req) { return req.json(); }, bankSuperAdminIds: function () { return ['u1']; }, BankVisibilityError: BVE, bankVisibilityErrorResponse: function (e) { return { status: e.status, json: async function () { return { ok: false, error: e.message }; } }; } });
  var bw = require(path.join(root, 'src/app/api/accounting/bank-write/route.js'));
  fresh();
  var resC = await bw.POST({ json: function () { return Promise.resolve({ action: 'classify', bank_transaction_id: B1, patch: { classification: 'phone' } }); }, headers: { get: function () { return null; } } }); var jC = await resC.json();
  var auC = global.__db.t.hub_audit_log.filter(function (a) { return a.action === 'bank_classify'; })[0];
  check('WRITER bank-write classify (real route): the audit row now holds the category BEFORE (utilities) and the Wave account before', jC.ok === true && auC && auC.details.classification === 'phone' && auC.details.before_classification === 'utilities' && auC.details.before_wave_account_id === null, [jC, auC && auC.details]);

  // profitability set_part_estimate
  var pr = require(path.join(root, 'src/app/api/accounting/profitability/route.js'));
  fresh();
  var resD = await pr.POST({ json: function () { return Promise.resolve({ user_id: 'u1', action: 'set_part_estimate', release: '1001-1622', part: 'trucking', amount: '1500' }); }, headers: { get: function () { return null; } } }); var jD = await resD.json();
  var auD = global.__db.t.hub_audit_log.filter(function (a) { return a.action === 'pl_part_estimate_set'; })[0];
  check('WRITER set_part_estimate (real route): the audit row now holds the amount BEFORE ($741 → $1,500), and reads "Trucking cost: $741.00 → $1,500.00"', jD.ok === true && auD && auD.details.was === 741 && auD.details.amount === 1500 && W.describeAudit(auD, CTX).facts.indexOf('Trucking cost: $741.00 → $1,500.00') >= 0, [jD, auD && auD.details]);
  fresh(); global.__db.t.pl_release_part_estimates = [];
  await pr.POST({ json: function () { return Promise.resolve({ user_id: 'u1', action: 'set_part_estimate', release: '1001-1700', part: 'freight', amount: '900' }); }, headers: { get: function () { return null; } } });
  var auE = global.__db.t.hub_audit_log.filter(function (a) { return a.action === 'pl_part_estimate_set'; })[0];
  check('WRITER set_part_estimate, first time: "was" is empty (null), so it reads "Freight cost: empty → $900.00"', auE && auE.details.was === null && W.describeAudit(auE, CTX).facts.indexOf('Freight cost: empty → $900.00') >= 0, auE && auE.details);

  // ── 5. the screen
  var at = fs.readFileSync(path.join(root, 'src/components/AuditTrailTab.jsx'), 'utf8'); var acc = fs.readFileSync(path.join(root, 'src/components/AccountingTab.jsx'), 'utf8');
  check('SCREEN: the sentence uses the names from the server (describeAudit(r, data.ctx)); the raw record ("show the full record") is for the super admin only', /describeAudit\(r, data\.ctx\)/.test(at) && /r\.details && isSuper && <button/.test(at) && /open === i && r\.details && isSuper && <pre/.test(at) && /<AuditTrailTab userProfile=\{userProfile\} isSuperAdmin=\{isSuper\} \/>/.test(acc));

  console.log('\nYC: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
