// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QM — Max's 13:27→15:33 batch:
//  13:27 categories on the fly from the dropdown
//  13:30 unmatch after matching; split incl. uncategorized remainder
//  13:33/15:03 "there are duplicates.. help" — relink copies
//  15:03 search looks at ANY data on the line
//  15:08 "it wont apply" — the reason now shows IN the popup; unmatch to redo
//  15:17 deleted invoice stayed matched on All Transactions
//  15:24 discounts on invoices
//  15:33 All Invoices: matching there too + clickable cards
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QM — unmatch · duplicates · invoice-side matching · visibility of errors');

var at = R('src/components/AllTransactionsTab.jsx');
var er = R('src/app/api/accounting/expense-rules/route.js');
var bills = R('src/app/api/accounting/bills/route.js');

ok('1: ⊘ UNMATCH on every matched/partial row AND "↩ unmatch all & start over" in the popup — bank-write unmatch (voided + logged, never deleted); Wave-pushed asks once then force path names what to delete in Wave',
  /doUnmatch\(t\); \}\} title="Unmatch — reverse ALL matches/.test(at) &&
  /action: force \? 'force_unmatch_wave' : 'unmatch'/.test(at) &&
  /↩ unmatch all & start over/.test(at));
ok('2: the failure REASON shows INSIDE the match popup (red banner), and network failures are caught — "apply did nothing" is impossible now',
  /\{mErr && <div className="mb-1 rounded p-1\.5/.test(at) &&
  /Could not reach the matching service/.test(at) &&
  /setMErr\(\(j && j\.error\) \|\| 'Match failed — no reason given by the server\.'\)/.test(at));
ok('3: ➕ new category… lives in the row dropdown — created on the spot (expense kind, retype later in 🏷), then applied to that transaction',
  /<option value="__new__">➕ new category…<\/option>/.test(at) &&
  /key === '__new__'/.test(at) && /api\('save_category', \{ label: nm\.trim\(\), kind: 'expense' \}\)/.test(at));
ok('4a: 🧹 Find duplicates — groups identical lines (account|date|amount|direction|text), KEEPS the copy carrying work, extras go to bank-write mark_review_duplicates (server re-verifies + refuses protected rows)',
  /function scanDuplicates\(\)/.test(at) &&
  /if \(\(t1\.matched \|\| t1\.verified \|\| t1\.classification\) && !\(keep\.matched \|\| keep\.verified \|\| keep\.classification\)\) \{ keep = t1; \}/.test(at) &&
  /action: 'mark_review_duplicates', duplicate_transaction_ids: ids/.test(at));
ok('4b: marked duplicates vanish from EVERY list and EVERY total — all_transactions (all 3 schema tiers), verification, period_stats spending, cashflow',
  er.split("neq('review_status', 'duplicate')").length >= 5 &&
  /\.neq\('review_status', 'duplicate'\) \/\/ v55\.83-QM — duplicates never count in spending\/income/.test(bills) &&
  /\.neq\('review_status', 'duplicate'\) \/\/ v55\.83-QM — duplicates never count\n/.test(bills));
ok('5: search looks at ANY data on the line — description, full text, date, account, amount, category label, status words (matched/transfer/advance/rtm/verified)',
  /var hayQ = \(String\(t\.who\) \+ ' ' \+ String\(t\.who_full \|\| ''\) \+ ' ' \+ String\(t\.date \|\| ''\) \+ ' ' \+ String\(t\.account \|\| ''\)/.test(at) &&
  /\(t\.third_party \? 'rtm ' : ''\)/.test(at));

var ai = R('src/components/AccountingInvoicesTab.jsx');
ok('6: deleting an invoice RELEASES its bank matches on BOTH delete paths — payments voided (never hard-deleted), deposits reopen unmatched, said in the confirm and the toast',
  /function releaseBankMatches\(invoiceId\)/.test(ai) &&
  /\.update\(\{ matched_invoice_id: null, review_status: 'unreviewed' \}\)/.test(ai) &&
  ai.split('releaseBankMatches(row.id)').length === 3 &&
  /bank match\(es\) released back to unmatched/.test(ai));
ok('7: discounts = a NEGATIVE line (− add discount line) — totals, balances, reports and the Wave push stay exact with zero special cases',
  /− add discount line/.test(ai) && /unit_price: '-0\.00'/.test(ai));

var bb = R('src/components/BusinessBooksTab.jsx');
ok('8a: All Invoices cards are CLICKABLE — each filters the table below (the underlying data), with an outline on the active one',
  bb.split('cursor-pointer').length >= 6 && /outline: statusFilter === 'open' \? '2px solid #0369a1' : 'none'/.test(bb));
ok('8b: 🔗 match on every open USD invoice — invoice_match_candidates lists deposits with UNAPPLIED money (duplicates excluded, transfers excluded), the write stays bank-write match_invoice, errors shown in the modal',
  /action: 'invoice_match_candidates', invoice_id: r\.id/.test(bb) &&
  /action: 'match_invoice', txn: c0\.txn, invoice: mInv\.invoice/.test(bb) &&
  /\{mErr2 && <div/.test(bb) &&
  /\.neq\('pending', true\)\.neq\('review_status', 'duplicate'\)/.test(bills) &&
  /is\('transfer_group_id', null\)/.test(bills.split("action === 'invoice_match_candidates'")[1].split("action === 'deposit_match_candidates'")[0]));

console.log('');
console.log('QM: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
