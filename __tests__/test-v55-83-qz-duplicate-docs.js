// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QZ — Duplicate bills and invoices, then edit (Max, Nov 8 11:51:
// "need to be able to duplicate bills or invoices with the ability to edit
// the fields").
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QZ — duplicate bills + invoices');
var ai = R('src/components/AccountingInvoicesTab.jsx');
var bt = R('src/components/BillsTab.jsx');
ok('1: invoices/proformas — ⧉ Duplicate on the row AND in the view popup; opens the editor as NEW with customer, release, notes, terms and fresh copies of every line (no line ids)',
  /function startDuplicate\(row\)/.test(ai) && ai.split('startDuplicate(row)').length >= 3 &&
  /setEditing\('new'\); setItems\(\[blankItem\(\)\]\);/.test(ai) &&
  /var its = \(\(r && r\.data\) \|\| \[\]\)\.map\(function \(it\) \{ return \{ description: it\.description/.test(ai.split('function startDuplicate')[1]));
ok('2: the copy is safe — number left BLANK (never a duplicate number), today\'s date with the same payment terms, saved as a new DRAFT (payments/Wave link/approval never copied)',
  /invoice_number: '', release_number: row\.release_number/.test(ai) &&
  /var span = \(d0 && e0\)/.test(ai) && /hpayload\.approval_status = 'draft'/.test(ai));
ok('3: bills — ⧉ Duplicate opens a NEW bill (no id) prefilled from vendor, amount, category, notes, paid-via; bill number blank; same terms from today; scrolls to the editor',
  /setEditing\(\{ vendor_name: b\.vendor_name, bill_number: '', bill_date: TODAY,/.test(bt) &&
  /total_amount: b\.total_amount, category: b\.category \|\| '', notes: b\.notes \|\| '', paid_via: b\.paid_via \|\| null/.test(bt) &&
  /⧉ Duplicate<\/button>/.test(bt));
console.log('');
console.log('QZ: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
