// v55.83-NB — Edit and delete lines in the other-currency Treasury ledgers.
//
// Max (Aug 11 2026): "accountant needs to be able to edit each line and fix it
// manually if necessary in the other currencies besides EGP. also the ability
// to delete a line."
//
// WHAT WAS MISSING
// The treasury edit modal covered EGP (cash_in/cash_out) and bank rows only —
// a wrong usd_in, usd_out or foreign_amount could not be corrected from the UI
// at all. And the MZ currency table had no actions on its rows.
//
// THE DESIGN DECISION THIS FILE PROTECTS
// Both new buttons open the EXISTING treasury modal, not a new one. Every
// guard that took months to harden applies automatically: the delete
// confirmation + super-admin/creator-24h rule, invoice-collected recalc,
// linked-check revert, and the auto-link-on-order#-change flow. A parallel
// "currency editor" would be a second door with none of those locks.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — The currency table rows now have actions
// ══════════════════════════════════════════════════════════════════

var curTableStart = page.indexOf('transactions ({currencyTxns.length})');
var curTable = page.slice(curTableStart, curTableStart + 9000);

ok('A1: an edit button exists on each currency-ledger row',
  /setEditTreasuryModal\(\{ \.\.\.t \}\)/.test(curTable));
ok('A2: a delete button exists on each currency-ledger row',
  /setEditTreasuryModal\(\{ \.\.\.t, confirmDelete: true \}\)/.test(curTable));
ok('A3: both reuse the EXISTING treasury modal (no parallel editor)',
  /SAME treasury[\s\S]{0,40}modal as the EGP table/.test(curTable));
ok('A4: the footer row is padded for the new actions column (table stays aligned)',
  /fCur\(currencyTotals\.net\)\}<\/td>\s*<td \/>/.test(curTable));
ok('A5: buttons carry bilingual tooltips',
  /Edit this line \/ تعديل/.test(curTable) && /Delete this line \/ حذف/.test(curTable));

// ══════════════════════════════════════════════════════════════════
// PART B — The modal can now edit the other-currency fields
// ══════════════════════════════════════════════════════════════════

ok('B1: USD In/Out inputs exist in the edit modal',
  /usd_in: Number\(e\.target\.value\) \|\| 0/.test(page) &&
  /usd_out: Number\(e\.target\.value\) \|\| 0/.test(page));
ok('B2: foreign currency code, amount and direction are all editable',
  /foreign_currency: e\.target\.value\.toUpperCase\(\)/.test(page) &&
  /foreign_amount: Number\(e\.target\.value\) \|\| 0/.test(page) &&
  /foreign_direction: e\.target\.value/.test(page));
ok('B3: the currency code input is sanitised to 3 uppercase letters',
  /replace\(\/\[\^A-Z\]\/g, ''\)\.slice\(0, 3\)/.test(page));
ok('B4: the section also appears in a non-EGP view so a MISSING amount can be added',
  /\|\| treasuryCurrency !== 'EGP'\)\) && \(/.test(page));
ok('B5: the section never appears on bank rows (their money is bank_in/bank_out)',
  /\(!isBankRow && \(Number\(txn\.usd_in \|\| 0\) > 0/.test(page));
ok('B6: on-screen text states the sealed-bucket rule (never added to EGP)',
  /never added to the EGP totals/.test(page));
ok('B7: on-screen text explains that 0 removes the line from that ledger',
  /Set an amount to 0 to remove it/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART C — The save payload carries the fields, with the ambiguity guard
// ══════════════════════════════════════════════════════════════════

ok('C1: usd_in/usd_out are persisted on save',
  /payload\.usd_in {2}= Number\(txn\.usd_in\) {2}\|\| 0;/.test(page) &&
  /payload\.usd_out = Number\(txn\.usd_out\) \|\| 0;/.test(page));
ok('C2: foreign fields are persisted as a consistent trio',
  /payload\.foreign_currency {2}= famt > 0 \? fcur : null;/.test(page) &&
  /payload\.foreign_amount {4}= famt;/.test(page) &&
  /payload\.foreign_direction = famt > 0 \? \(txn\.foreign_direction === 'out' \? 'out' : 'in'\) : null;/.test(page));
ok('C3: an amount WITHOUT a currency code refuses to save (would vanish from every ledger)',
  /if \(famt > 0 && !fcur\) \{[\s\S]{0,220}return;/.test(page));
ok('C4: clearing the amount also clears the code and direction (no orphan trio parts)',
  /famt > 0 \? fcur : null/.test(page) && /famt > 0 \? \(txn\.foreign_direction/.test(page));
ok('C5: the currency payload lives on the CASH branch only (bank rows untouched)',
  (function () {
    var i = page.indexOf('payload.cash_in  = Number(txn.cash_in)');
    var j = page.indexOf('payload.usd_in');
    var k = page.indexOf('handleSaveTreasuryEdit(txn.id, payload)');
    return i > -1 && j > i && k > j && (j - i) < 1200;
  })());

// ══════════════════════════════════════════════════════════════════
// PART D — Delete shows ALL the money, and the guards still stand
// ══════════════════════════════════════════════════════════════════

ok('D1: the delete confirmation lists USD amounts on the line',
  /USD In:<\/span> \$\{Number\(txn\.usd_in\)\.toLocaleString\(\)\}/.test(page) &&
  /USD Out:<\/span> \$\{Number\(txn\.usd_out\)\.toLocaleString\(\)\}/.test(page));
ok('D2: the delete confirmation lists foreign-currency amounts',
  /txn\.foreign_currency\} \{txn\.foreign_direction === 'out' \? 'Out' : 'In'\}/.test(page));
ok('D3: the reason is documented — a "0 EGP" row can hold thousands of dollars',
  /deleting a "0 EGP" row that holds/.test(page));
ok('D4: the delete permission rule is unchanged (super admin or creator within 24h)',
  /const canDeleteTxn = isSuperAdmin \|\| \(isCreator && within24h\);/.test(page));
ok('D5: delete still reverts a linked check instrument',
  /reverted linked instrument/.test(page));
ok('D6: delete still recalcs the linked invoice',
  /if \(invoiceToRecalc\) \{/.test(page));
ok('D7: saved edits update local state in place, so ledgers recompute without reload',
  /setTreasury\(prev => prev\.map\(t => t\.id === txnId \? \{ \.\.\.t, \.\.\.updates \} : t\)\);/.test(page));

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-NB currency line edit + delete');
}
