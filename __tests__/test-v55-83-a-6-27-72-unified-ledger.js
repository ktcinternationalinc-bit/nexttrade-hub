// v55.83-A.6.27.72 — Unified Counterparty Ledger regression suite.
// Validates: SQL migration, lib FIFO simulation, UI wiring in OpenAccountsTab,
// invoice modal transaction_type stamping, print/Excel updates, and offset flow.

var fs = require('fs');
function read(p) { return fs.readFileSync(p, 'utf8'); }
var fails = 0;
function ok(name, cond) {
  if (cond) { console.log('✓ ' + name); }
  else { console.log('✗ ' + name); fails++; }
}

var sql = read('sql/v55-83-a-6-27-72-unified-counterparty-ledger.sql');
var lib = read('src/lib/open-account-ledger.js');
var oa  = read('src/components/OpenAccountsTab.jsx');
var exp = read('src/lib/open-account-export.js');

// ════════════════════════════════════════════════════════════════════
// PART A — SQL migration
// ════════════════════════════════════════════════════════════════════
ok('A1: SQL migration file exists',
  sql.length > 0);
ok('A2: ALTER TABLE adds transaction_type column',
  /ALTER TABLE open_account_entries\s+ADD COLUMN IF NOT EXISTS transaction_type text/.test(sql));
ok('A3: CHECK constraint covers all 6 transaction types',
  /sales_invoice/.test(sql) && /vendor_bill/.test(sql) &&
  /payment_received/.test(sql) && /payment_sent/.test(sql) &&
  /credit_adjustment/.test(sql) && /'offset'/.test(sql));
ok('A4: applied_to_entry_id FK added',
  /ADD COLUMN IF NOT EXISTS applied_to_entry_id uuid REFERENCES open_account_entries\(id\)/.test(sql));
ok('A5: offset_pair_id + offset_invoice_id + offset_bill_id added',
  /ADD COLUMN IF NOT EXISTS offset_pair_id uuid/.test(sql) &&
  /ADD COLUMN IF NOT EXISTS offset_invoice_id uuid REFERENCES/.test(sql) &&
  /ADD COLUMN IF NOT EXISTS offset_bill_id uuid REFERENCES/.test(sql));
ok('A6: backfill UPDATE classifies existing rows',
  /UPDATE open_account_entries\s+SET transaction_type = CASE/.test(sql));
ok('A7: RLS verification DO block (Rule 9)',
  /DO \$\$/.test(sql) && /CREATE POLICY/.test(sql) &&
  /authenticated users read open_account_entries/.test(sql));
ok('A8: BACKOUT block in comments',
  /BACKOUT/.test(sql) && /DROP COLUMN IF EXISTS transaction_type/.test(sql));

// ════════════════════════════════════════════════════════════════════
// PART B — Lib: ledger simulation engine
// ════════════════════════════════════════════════════════════════════
ok('B1: TRANSACTION_TYPES registry has all 6 types',
  /export var TRANSACTION_TYPES = \{[\s\S]{0,3000}sales_invoice:/.test(lib) &&
  /vendor_bill:/.test(lib) && /payment_received:/.test(lib) &&
  /payment_sent:/.test(lib) && /credit_adjustment:/.test(lib) && /offset:/.test(lib));
ok('B2: each type has icon + label + labelAr + pillCls',
  /icon: '📤'/.test(lib) && /icon: '📥'/.test(lib) &&
  /icon: '💰'/.test(lib) && /icon: '💸'/.test(lib) &&
  /labelAr: 'فاتورة بيع'/.test(lib));
ok('B3: simulate() is the heart of the FIFO model',
  /export function simulate\(entries\)/.test(lib));
ok('B4: simulate handles sales_invoice (consumes theirPrepaid)',
  /if \(type === 'sales_invoice'\)[\s\S]{0,400}fromPrepaid = Math\.min\(s\.theirPrepaid, amt\)/.test(lib));
ok('B5: simulate handles vendor_bill (consumes ourPrepaid)',
  /else if \(type === 'vendor_bill'\)[\s\S]{0,400}fromOurPrepaid = Math\.min\(s\.ourPrepaid, amt\)/.test(lib));
ok('B6: simulate handles payment_received (FIFO across openInvoices, excess to theirPrepaid)',
  /else if \(type === 'payment_received'\)[\s\S]{0,800}cashLeft > 0\.001 && s\.openInvoices\.length > 0[\s\S]{0,400}s\.theirPrepaid \+= cashLeft/.test(lib));
ok('B7: simulate handles payment_sent (FIFO across openBills, excess to ourPrepaid)',
  /else if \(type === 'payment_sent'\)[\s\S]{0,800}cashLeft2 > 0\.001 && s\.openBills\.length > 0[\s\S]{0,400}s\.ourPrepaid \+= cashLeft2/.test(lib));
ok('B8: simulate handles offset (reduces matched invoice + bill)',
  /else if \(type === 'offset'\)[\s\S]{0,1500}e\.offset_invoice_id && debitAmtO > 0[\s\S]{0,1500}e\.offset_bill_id && creditAmtO > 0/.test(lib));
ok('B9: net balance computed as theirSide - ourSide',
  /netBalance: theirSide - ourSide/.test(lib));
ok('B10: chronological sort by entry_date then created_at then id',
  /function sortChronologically/.test(lib) &&
  /String\(a\.entry_date \|\| ''\)/.test(lib) &&
  /String\(a\.created_at \|\| ''\)/.test(lib));
ok('B11: computePaidRemaining exported',
  /export function computePaidRemaining/.test(lib));
ok('B12: findOffsetCandidate exported (oldest pair in same currency)',
  /export function findOffsetCandidate/.test(lib));
ok('B13: validateOffsetable exported',
  /export function validateOffsetable/.test(lib));
ok('B14: buildOffsetEntries exported (returns 2 linked entries)',
  /export function buildOffsetEntries/.test(lib) &&
  /offset_pair_id: pairId/.test(lib));
ok('B15: computeBalances legacy wrapper preserved + delegates to simulate()',
  /export function computeBalances\(entries\)[\s\S]{0,200}var sim = simulate\(entries\)/.test(lib));

// ════════════════════════════════════════════════════════════════════
// PART C — UI: OpenAccountsTab wiring
// ════════════════════════════════════════════════════════════════════
ok('C1: imports from open-account-ledger lib',
  /import \{ TRANSACTION_TYPES, simulate, computePaidRemaining, findOffsetCandidate, validateOffsetable, buildOffsetEntries \} from '\.\.\/lib\/open-account-ledger'/.test(oa));
ok('C2: openNewEntry defaults transaction_type to payment_received',
  /transaction_type: 'payment_received'/.test(oa));
ok('C3: openEditEntry derives transaction_type from existing row',
  /if \(hasCredit && hasInvoice\) derivedType = 'sales_invoice'/.test(oa));
ok('C4: saveEntry writes transaction_type to payload',
  /transaction_type: entryDraft\.transaction_type/.test(oa));
ok('C5: saveEntry derives credit/debit side from transaction_type',
  /var creditTypes = \['sales_invoice', 'payment_received'\]/.test(oa) &&
  /var isCredit = creditTypes\.indexOf\(entryDraft\.transaction_type\) !== -1/.test(oa));
ok('C6: 5-type picker in modal (Sales Invoice / Vendor Bill / Payment Received / Payment Sent / Adjustment)',
  /transaction_type === 'sales_invoice'/.test(oa) &&
  /transaction_type === 'vendor_bill'/.test(oa) &&
  /transaction_type === 'payment_received'/.test(oa) &&
  /transaction_type === 'payment_sent'/.test(oa) &&
  /transaction_type === 'credit_adjustment'/.test(oa));
ok('C7: per-account simResult computed inside map',
  /var simResult = simulate\(accEntries\)/.test(oa));
ok('C8: per-account offsetCandidate + offsetableCurs computed',
  /var offsetCandidate = findOffsetCandidate\(accEntries\)/.test(oa) &&
  /var offsetableCurs = validateOffsetable\(accEntries\)/.test(oa));
ok('C9: per-currency tile strip (They owe us / We owe them / Their prepaid / Our prepaid / Net)',
  /They owe us/.test(oa) && /We owe them/.test(oa) &&
  /Their credit \(prepaid\)/.test(oa) && /Our credit \(prepaid\)/.test(oa) &&
  /Net balance/.test(oa));
ok('C10: ledger table has Type + AR Side + AP Side + Remaining columns (HOTFIX 11 final spec)',
  />Type</.test(oa) && />AR Side</.test(oa) && />AP Side</.test(oa) && />Remaining</.test(oa));
ok('C11: Type pill rendered from TRANSACTION_TYPES registry',
  /var typeMeta = TRANSACTION_TYPES\[txnType\] \|\| TRANSACTION_TYPES\.credit_adjustment/.test(oa));
ok('C12: Paid/Remaining cells use computePaidRemaining',
  /var pr = computePaidRemaining\(entry, simResult\)/.test(oa));
ok('C13: Running Balance per-currency column header (HOTFIX 11 final spec)',
  /Running Balance \{cur\}/.test(oa));
ok('C14: 🔄 Offset button in toolbar, disabled when no candidate',
  /🔄 Offset/.test(oa) &&
  /disabled=\{!offsetCandidate\}/.test(oa));
ok('C15: handleOffset function — uses findOffsetCandidate + buildOffsetEntries, rollback on second insert failure',
  /async function handleOffset\(accountId\)/.test(oa) &&
  /var pair = buildOffsetEntries\(cand, today, userProfile && userProfile\.id\)/.test(oa) &&
  /Rollback first entry/.test(oa));
ok('C16: invoice modal stamps transaction_type sales_invoice or vendor_bill',
  /transaction_type: invoiceDraft\.direction === 'credit' \? 'sales_invoice' : 'vendor_bill'/.test(oa));
ok('C17: two Print buttons — internal + customer perspective',
  /handlePrintLedger\(a, 'internal'\)/.test(oa) &&
  /handlePrintLedger\(a, 'customer'\)/.test(oa));

// ════════════════════════════════════════════════════════════════════
// PART D — Export: print/Excel updates
// ════════════════════════════════════════════════════════════════════
ok('D1: printAccountLedger accepts opts (perspective + simulation)',
  /export function printAccountLedger\(account, entity, entries, summary, opts\)/.test(exp));
ok('D2: print supports customer perspective with mirrored labels',
  /perspective === 'customer'/.test(exp) &&
  /TYPE_LABEL/.test(exp));
ok('D3: print displays type column + AR Side/AP Side/Remaining in PDF table (HOTFIX 11 final)',
  /AR Side/.test(exp) && /AP Side/.test(exp) && />Remaining</.test(exp));
ok('D4: 4-pot tile summary at top of each currency section',
  /potTilesHtml/.test(exp) &&
  /simCur\.theirOpenInvoices/.test(exp) &&
  /simCur\.ourOpenBills/.test(exp) &&
  /simCur\.theirPrepaid/.test(exp) &&
  /simCur\.ourPrepaid/.test(exp));
ok('D5: Excel export has Type column + AR Side/AP Side/Remaining columns (HOTFIX 11 final)',
  /'Type'/.test(exp) && /'AR Side'/.test(exp) && /'AP Side'/.test(exp) && /'Remaining'/.test(exp));
ok('D6: Excel runs inline FIFO sim to compute Paid/Remaining per row',
  /var simApplied = \{\}/.test(exp) &&
  /var simState = \{\}/.test(exp));
ok('D7: handlePrintLedger passes simulation + perspective to printAccountLedger',
  /printAccountLedger\(account, ent, rows, s, \{ perspective: perspective \|\| 'internal', simulation: sim \}\)/.test(oa));

console.log('\n──────────────────────────────────────────────');
console.log(fails === 0 ? '✅ ALL ' + (39) + ' assertions passed' : '❌ ' + fails + ' assertion(s) failed');
console.log('──────────────────────────────────────────────');
process.exit(fails > 0 ? 1 : 0);
