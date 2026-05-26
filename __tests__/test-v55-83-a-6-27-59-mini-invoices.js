// v55.83-A.6.27.59 — Mini-invoices for Open Accounts.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var oa   = read('src/components/OpenAccountsTab.jsx');
var inv  = read('src/lib/open-account-invoice-print.js');
var sql  = read('sql/v55-83-a-6-27-59-open-account-invoices.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL migration
// ══════════════════════════════════════════════════════════════════
ok('A1: SQL creates open_account_invoices with invoice_number + direction CHECK',
  /CREATE TABLE IF NOT EXISTS open_account_invoices/.test(sql) &&
  /invoice_number\s+TEXT NOT NULL/.test(sql) &&
  /direction\s+TEXT NOT NULL CHECK \(direction IN \('credit', 'debit'\)\)/.test(sql));
ok('A2: SQL adds counterparty fields',
  /counterparty_name\s+TEXT NOT NULL/.test(sql) &&
  /counterparty_name_ar\s+TEXT/.test(sql) &&
  /counterparty_address\s+TEXT/.test(sql) &&
  /counterparty_email\s+TEXT/.test(sql) &&
  /counterparty_phone\s+TEXT/.test(sql));
ok('A3: SQL adds money columns',
  /subtotal\s+NUMERIC/.test(sql) &&
  /shipping_amount\s+NUMERIC/.test(sql) &&
  /tax_rate_pct\s+NUMERIC/.test(sql) &&
  /tax_amount\s+NUMERIC/.test(sql) &&
  /total_amount\s+NUMERIC/.test(sql));
ok('A4: SQL tax_rate_pct is NULLABLE (Q1=B: tax is optional)',
  /tax_rate_pct\s+NUMERIC\(6,3\),  -- e\.g\. 14\.000 for VAT\. NULL when tax not used/.test(sql));
ok('A5: SQL creates open_account_invoice_items table',
  /CREATE TABLE IF NOT EXISTS open_account_invoice_items/.test(sql) &&
  /description\s+TEXT NOT NULL/.test(sql) &&
  /quantity\s+NUMERIC/.test(sql) &&
  /unit_price\s+NUMERIC/.test(sql) &&
  /line_total\s+NUMERIC/.test(sql));
ok('A6: SQL items cascade on invoice delete',
  /invoice_id\s+UUID NOT NULL REFERENCES open_account_invoices\(id\) ON DELETE CASCADE/.test(sql));
ok('A7: SQL adds linked_open_invoice_id column on open_account_entries',
  /ALTER TABLE open_account_entries\s+ADD COLUMN IF NOT EXISTS linked_open_invoice_id UUID/.test(sql));
ok('A8: SQL adds FK with ON DELETE CASCADE (Q4=A)',
  /fk_entry_linked_invoice/.test(sql) &&
  /FOREIGN KEY \(linked_open_invoice_id\)\s+REFERENCES open_account_invoices\(id\)\s+ON DELETE CASCADE/.test(sql));
ok('A9: SQL creates 4 performance indexes',
  /idx_oai_account\s+ON open_account_invoices/.test(sql) &&
  /idx_oai_invoice_num\s+ON open_account_invoices/.test(sql) &&
  /idx_oaii_invoice\s+ON open_account_invoice_items/.test(sql) &&
  /idx_entry_linked_inv\s+ON open_account_entries/.test(sql));
ok('A10: SQL enables RLS + permissive policy',
  /ALTER TABLE open_account_invoices ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /CREATE POLICY "Allow all on open_account_invoices"/.test(sql));
ok('A11: SQL creates updated_at trigger',
  /trg_oai_set_updated_at/.test(sql) &&
  /CREATE TRIGGER trg_oai_updated_at/.test(sql));
ok('A12: SQL is idempotent (≥4 DO blocks with duplicate_object NULL)',
  (sql.match(/EXCEPTION WHEN duplicate_object THEN NULL/g) || []).length >= 4);
ok('A13: SQL includes backout block (commented)',
  /BACKOUT/.test(sql) &&
  /DROP TABLE IF EXISTS open_account_invoice_items/.test(sql) &&
  /DROP TABLE IF EXISTS open_account_invoices/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — State + load wiring
// ══════════════════════════════════════════════════════════════════
ok('B1: invoices state declared',
  /var \[invoices, setInvoices\] = useState\(\[\]\)/.test(oa));
ok('B2: invoiceItems state declared',
  /var \[invoiceItems, setInvoiceItems\] = useState\(\[\]\)/.test(oa));
ok('B3: invoiceModalOpen state declared',
  /var \[invoiceModalOpen, setInvoiceModalOpen\] = useState\(false\)/.test(oa));
ok('B4: invoiceDraft state declared',
  /var \[invoiceDraft, setInvoiceDraft\] = useState\(null\)/.test(oa));
ok('B5: load fetches open_account_invoices',
  /supabase\.from\('open_account_invoices'\)\.select\('\*'\)\.order\('invoice_date'/.test(oa));
ok('B6: load fetches open_account_invoice_items',
  /supabase\.from\('open_account_invoice_items'\)\.select\('\*'\)\.order\('sort_order'/.test(oa));
ok('B7: load gracefully degrades if .59 SQL not run',
  /open_account_invoices not loaded — run sql\/v55-83-a-6-27-59/.test(oa));
ok('B8: reload also pulls invoices + items',
  /async function reload\(\)/.test(oa) &&
  /supabase\.from\('open_account_invoices'\)/.test(oa) &&
  /supabase\.from\('open_account_invoice_items'\)/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART C — Helpers
// ══════════════════════════════════════════════════════════════════
ok('C1: itemsForInvoice filters by invoice_id',
  /function itemsForInvoice\(invoiceId\)/.test(oa) &&
  /invoiceItems\.filter\(function \(it\) \{ return it\.invoice_id === invoiceId/.test(oa));
ok('C2: computeInvoiceTotals iterates draft.items, accumulates subtotal',
  /function computeInvoiceTotals\(draft\)/.test(oa) &&
  /subtotal \+= line/.test(oa));
ok('C3: computeInvoiceTotals adds shipping to taxable base',
  /var taxableBase = subtotal \+ shipping/.test(oa));
ok('C4: computeInvoiceTotals only applies tax when tax_enabled',
  /if \(draft\.tax_enabled && draft\.tax_rate_pct != null && draft\.tax_rate_pct !== ''\)/.test(oa));
ok('C5: computeInvoiceTotals rounds to 2 decimals',
  /Math\.round\(subtotal \* 100\) \/ 100/.test(oa) &&
  /Math\.round\(taxAmount \* 100\) \/ 100/.test(oa) &&
  /Math\.round\(total \* 100\) \/ 100/.test(oa));
ok('C6: openNewInvoice defaults currency from entity',
  /function openNewInvoice\(accountId\)/.test(oa) &&
  /var defaultCur = \(ent && ent\.default_currency\) \|\| 'USD'/.test(oa));
ok('C7: openNewInvoice defaults direction = credit',
  /direction: 'credit',  \/\/ default: we billed them/.test(oa));
ok('C8: openNewInvoice defaults counterparty_name from account',
  /counterparty_name: \(acc && acc\.account_name\) \|\| ''/.test(oa));
ok('C9: openNewInvoice defaults tax_enabled false',
  /tax_enabled: false,        \/\/ Q1 — optional, default off/.test(oa));
ok('C10: openNewInvoice starts with one blank item row',
  /items: \[\{ description: '', quantity: '1', unit_price: '' \}\]/.test(oa));
ok('C11: openEditInvoice preserves direction + currency',
  /direction: invoice\.direction \|\| 'credit'/.test(oa) &&
  /currency: String\(invoice\.currency \|\| 'USD'\)\.toUpperCase\(\)/.test(oa));
ok('C12: openEditInvoice computes tax_enabled from existing data',
  /tax_enabled: invoice\.tax_rate_pct != null \|\| Number\(invoice\.tax_amount \|\| 0\) > 0/.test(oa));
ok('C13: openEditInvoice loads items from itemsForInvoice',
  /var rows = itemsForInvoice\(invoice\.id\)/.test(oa) &&
  /items: rows\.length > 0/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART D — Line-item CRUD
// ══════════════════════════════════════════════════════════════════
ok('D1: setInvoiceItemField updates one field',
  /function setInvoiceItemField\(idx, field, value\)/.test(oa) &&
  /next\.items\[idx\]\[field\] = value/.test(oa));
ok('D2: addInvoiceItem appends blank row',
  /function addInvoiceItem\(\)/.test(oa) &&
  /next\.items\.push\(\{ description: '', quantity: '1', unit_price: '' \}\)/.test(oa));
ok('D3: removeInvoiceItem splices + keeps at least one row',
  /function removeInvoiceItem\(idx\)/.test(oa) &&
  /nextItems\.splice\(idx, 1\)/.test(oa) &&
  /if \(nextItems\.length === 0\) nextItems\.push/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART E — saveInvoice + ledger sync
// ══════════════════════════════════════════════════════════════════
ok('E1: validates invoice_number',
  /if \(!invNum\) \{ alert\('Invoice number is required/.test(oa));
ok('E2: validates counterparty_name',
  /Counterparty name is required/.test(oa));
ok('E3: validates direction',
  /Direction is required/.test(oa));
ok('E4: validates currency length',
  /if \(cur\.length < 2\) \{ alert\('Currency code is required/.test(oa));
ok('E5: filters blank items + requires at least one',
  /var validItems = \(invoiceDraft\.items \|\| \[\]\)\.filter/.test(oa) &&
  /if \(validItems\.length === 0\)/.test(oa) &&
  /Add at least one line item/.test(oa));
ok('E6: computes totals before save',
  /var totals = computeInvoiceTotals\(Object\.assign\(\{\}, invoiceDraft, \{ items: validItems \}\)\)/.test(oa));
ok('E7: UPDATE path: updates + deletes old items + inserts new',
  /supabase\.from\('open_account_invoices'\)\.update\(invPayload\)\.eq\('id', invoiceId\)/.test(oa) &&
  /supabase\.from\('open_account_invoice_items'\)\.delete\(\)\.eq\('invoice_id', invoiceId\)/.test(oa));
ok('E8: INSERT path: captures returned id',
  /supabase\.from\('open_account_invoices'\)\.insert\(invPayload\)\.select\(\)\.single\(\)/.test(oa) &&
  /invoiceId = insRes\.data\.id/.test(oa));
ok('E9: items have sort_order + line_total',
  /sort_order: idx/.test(oa) &&
  /line_total: Math\.round\(qty \* unit \* 100\) \/ 100/.test(oa));
ok('E10: linked entry direction → credit_amount or debit_amount',
  /credit_amount: invoiceDraft\.direction === 'credit' \? totals\.total : null/.test(oa) &&
  /debit_amount: invoiceDraft\.direction === 'debit' \? totals\.total : null/.test(oa));
ok('E11: linked entry includes linked_open_invoice_id',
  /linked_open_invoice_id: invoiceId/.test(oa));
ok('E12: linked entry notes mention auto-sync',
  /Auto-synced from invoice/.test(oa));
ok('E13: edit path finds existing linked entry and updates',
  /var existingLinked = entries\.find\(function \(e\) \{ return e\.linked_open_invoice_id === invoiceId/.test(oa) &&
  /supabase\.from\('open_account_entries'\)\.update\(linkedEntryPayload\)\.eq\('id', existingLinked\.id\)/.test(oa));
ok('E14: actionable error hint when table missing',
  /relation\.\*open_account_invoices\.\*does not exist/.test(oa) &&
  /Run SQL migration v55\.83-A\.6\.27\.59/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART F — deleteInvoice + openInvoiceFromEntry
// ══════════════════════════════════════════════════════════════════
ok('F1: deleteInvoice confirm mentions cascade',
  /Delete invoice/.test(oa) &&
  /also delete the linked ledger entry/i.test(oa));
ok('F2: deleteInvoice fires DB delete (cascade handles entry + items)',
  /supabase\.from\('open_account_invoices'\)\.delete\(\)\.eq\('id', invoice\.id\)/.test(oa));
ok('F3: openInvoiceFromEntry finds by linked id and opens edit',
  /function openInvoiceFromEntry\(entry\)/.test(oa) &&
  /var inv = invoices\.find\(function \(i\) \{ return i\.id === entry\.linked_open_invoice_id/.test(oa) &&
  /openEditInvoice\(inv\)/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART G — UI buttons + linked-entry indicators
// ══════════════════════════════════════════════════════════════════
ok('G1: "+ Invoice" button on each account card',
  /onClick=\{function \(\) \{ openNewInvoice\(a\.id\); \}\}/.test(oa) &&
  /\+ Invoice/.test(oa));
ok('G2: + Invoice button title mentions auto-linked entry',
  /Create a mini-invoice\. Will auto-create a linked ledger entry/.test(oa));
ok('G3: ledger row description renders click-to-open when linked',
  /entry\.linked_open_invoice_id \? \(/.test(oa) &&
  /onClick=\{function \(\) \{ openInvoiceFromEntry\(entry\); \}\}/.test(oa));
ok('G4: 📄 INV badge for linked entries',
  /📄 INV/.test(oa));
ok('G5: linked entries get "Open Inv" button instead of Edit/Del',
  />Open Inv</.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART H — Invoice modal
// ══════════════════════════════════════════════════════════════════
ok('H1: invoice modal renders when invoiceModalOpen && invoiceDraft',
  /\{invoiceModalOpen && invoiceDraft && \(\(\) => \{/.test(oa));
ok('H2: modal title swaps for edit vs new',
  /\{invoiceDraft\.id \? 'Edit Invoice' : 'New Mini-Invoice'\}/.test(oa));
ok('H3: subtitle explains auto-sync',
  /linked ledger entry will auto-sync/.test(oa) &&
  /Will auto-create a linked ledger entry/.test(oa));
ok('H4: "We\'re billing them" → credit radio',
  /type="radio" name="direction" value="credit"/.test(oa) &&
  /We&apos;re billing them/.test(oa) &&
  /Creates a CREDIT ledger entry/.test(oa));
ok('H5: "They\'re billing us" → debit radio',
  /type="radio" name="direction" value="debit"/.test(oa) &&
  /They&apos;re billing us/.test(oa) &&
  /Creates a DEBIT ledger entry/.test(oa));
ok('H6: invoice meta has number/date/due/currency',
  /Invoice # \* \/ رقم الفاتورة/.test(oa) &&
  /Date \* \/ التاريخ/.test(oa) &&
  /Due Date \/ تاريخ الاستحقاق/.test(oa) &&
  /Currency \* \/ العملة/.test(oa));
ok('H7: currency dropdown 7 options',
  /<option value="USD">USD<\/option>\s+<option value="EGP">EGP<\/option>\s+<option value="EUR">EUR<\/option>\s+<option value="GBP">GBP<\/option>\s+<option value="AED">AED<\/option>\s+<option value="SAR">SAR<\/option>\s+<option value="CNY">CNY<\/option>/.test(oa));
ok('H8: BILL TO label swaps with direction',
  /invoiceDraft\.direction === 'credit' \? 'BILL TO \(counterparty\)' : 'BILL FROM \(counterparty\)'/.test(oa));
ok('H9: line item table with 4 columns + remove ✕',
  />Description</.test(oa) &&
  />Qty</.test(oa) &&
  /Unit Price \(\{cur\}\)/.test(oa) &&
  />Line Total</.test(oa));
ok('H10: + Add Line Item button bilingual',
  /\+ Add Line Item \/ إضافة بند/.test(oa));
ok('H11: tax opt-in checkbox + off-by-default note',
  /<input type="checkbox" checked=\{!!invoiceDraft\.tax_enabled\}/.test(oa) &&
  /Apply tax \/ تطبيق الضريبة/.test(oa) &&
  /\(optional, off by default\)/.test(oa));
ok('H12: tax rate input only shows when enabled',
  /\{invoiceDraft\.tax_enabled && \(/.test(oa) &&
  /Tax Rate \(%\)/.test(oa));
ok('H13: shipping field dedicated (Q6=A)',
  /Shipping \/ الشحن \(optional\)/.test(oa) &&
  /value=\{invoiceDraft\.shipping_amount\}/.test(oa));
ok('H14: totals box shows subtotal + (shipping) + (tax) + TOTAL',
  /Subtotal/.test(oa) &&
  /Number\(invoiceDraft\.shipping_amount \|\| 0\) > 0 && \(/.test(oa) &&
  /invoiceDraft\.tax_enabled && totals\.taxAmount > 0 && \(/.test(oa) &&
  />TOTAL</.test(oa));
ok('H15: totals box explains ledger entry direction',
  /Ledger entry will be a \{invoiceDraft\.direction === 'credit' \? 'CREDIT \(they owe us\)' : 'DEBIT \(we owe them\)'\} of/.test(oa));
ok('H16: Print + Delete shown only on existing invoices',
  /\{invoiceDraft\.id && \(/.test(oa) &&
  /🖨️ Print/.test(oa) &&
  /🗑️ Delete Invoice/.test(oa));
ok('H17: Save Invoice button blue',
  /onClick=\{saveInvoice\}/.test(oa) &&
  /bg-blue-600 hover:bg-blue-700/.test(oa) &&
  /💾 Save Invoice/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART I — Print helper
// ══════════════════════════════════════════════════════════════════
ok('I1: printOpenAccountInvoice exported',
  /export function printOpenAccountInvoice\(invoice, items, entity\)/.test(inv));
ok('I2: print determines weBilledThem from direction',
  /var weBilledThem = invoice\.direction === 'credit'/.test(inv));
ok('I3: print swaps issuer/recipient blocks',
  /var issuerHtml = weBilledThem \? entityBlockHtml\(\) : counterpartyBlockHtml\(\)/.test(inv) &&
  /var recipientHtml = weBilledThem \? counterpartyBlockHtml\(\) : entityBlockHtml\(\)/.test(inv));
ok('I4: print renders line items',
  /\(items \|\| \[\]\)\.forEach\(function \(it\)/.test(inv) &&
  /var lineTotal = Number\(it\.line_total \|\| \(qty \* unitPrice\)\)/.test(inv));
ok('I5: print totals: Subtotal + (Shipping) + (Tax) + TOTAL',
  /Subtotal/.test(inv) &&
  /shipping > 0/.test(inv) &&
  /showTax/.test(inv) &&
  /TOTAL/.test(inv));
ok('I6: print direction banner',
  /weBilledThem \? 'We billed them' : 'They billed us'/.test(inv));
ok('I7: print auto-fires window.print()',
  /setTimeout\(function\(\)\{ try \{ window\.print\(\); \} catch \(e\) \{\} \}, 350\)/.test(inv));

// ══════════════════════════════════════════════════════════════════
// PART J — Imports + handlePrintInvoice
// ══════════════════════════════════════════════════════════════════
ok('J1: OpenAccountsTab imports printOpenAccountInvoice',
  /import \{ printOpenAccountInvoice \} from '\.\.\/lib\/open-account-invoice-print'/.test(oa));
ok('J2: handlePrintInvoice helper present',
  /function handlePrintInvoice\(invoice\)/.test(oa) &&
  /printOpenAccountInvoice\(invoice, rows, ent\)/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════
ok('R1: 58 — multi-currency walk preserved',
  /var sim = simulate\(arr\)/.test(oa));
ok('R2: 58 — summaryFor returns byCurrency + currencies + totalEntryCount',
  /byCurrency: byCur,\s+currencies: currencies,\s+totalEntryCount: arr\.length/.test(oa));
ok('R3: 58 — entry modal currency dropdown preserved',
  /<option value="USD">USD<\/option>\s+<option value="EGP">EGP<\/option>\s+<option value="EUR">EUR<\/option>/.test(oa));
ok('R4: 58 — Cur column + per-currency Net CUR columns preserved (v55.83-A.6.27.72 renamed Running→Net)',
  />Cur</.test(oa) && /Net \{cur\}/.test(oa));
ok('R5: 58 — per-currency grand-total tiles preserved',
  /\{cur\} Total Credit \(money in\)/.test(oa));
ok('R6: 57 — Shipping rate save instrumentation preserved',
  /console\.log\('\[shipping-rates\] save attempt:'/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R7: 56 — Inbound Shipments 3-region modal preserved',
  /var \[headerCollapsed, setHeaderCollapsed\] = useState\(false\)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R8: 55 — openaccounts in FINANCE sidebar preserved',
  /\{ group: 'FINANCE', items: \['sales', 'treasury', 'checks', 'debts', 'openaccounts'/.test(page));
ok('R9: 54 — amber header version pill preserved',
  /background: '#fef3c7'/.test(page));
ok('R10: 53 — Business Entities picker preserved',
  /Our Entity for this Account \* \/ كياننا/.test(oa));
ok('R11: 52 — Open Accounts tab registered',
  /\{ id: 'openaccounts', label: 'Open Accounts \/ حسابات', icon: '📒' \}/.test(page));
ok('R12: 52 — 5-type transaction picker on Entry modal (v55.83-A.6.27.72 replaces CREDIT/DEBIT radio)',
  /transaction_type === 'sales_invoice'/.test(oa) && /transaction_type === 'vendor_bill'/.test(oa) &&
  /transaction_type === 'payment_received'/.test(oa) && /transaction_type === 'payment_sent'/.test(oa));
ok('R13: 52 — manual ledger entries STILL work (Q5) (v55.83-A.6.27.72: side now derived from transaction_type)',
  /async function saveEntry\(\)/.test(oa) &&
  /credit_amount: isCredit \? amt : null,\s+debit_amount: isCredit \? null : amt/.test(oa));
ok('R14: closed-tickets fetch has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R15: account card row has both + Entry AND + Invoice',
  /\+ Entry/.test(oa) && /\+ Invoice/.test(oa));
ok('R16: Print + Excel buttons on account card preserved',
  /🖨️ Print/.test(oa) && /📊 Excel/.test(oa));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.59 or later',
  /BUILD v55\.83-A\.6\.27\.(59|6\d|[7-9]\d)/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.59 (mini-invoices) tests passed');
