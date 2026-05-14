// v55.83-A.6.8 (Max May 13 2026) — Short-payment write-off feature.
//
// Spec:
//   - Auto-suggest only: button appears when outstanding ≤ 1000 EGP
//   - Soft cap at 1000; super_admin can override
//   - Reason locked to "Customer short-payment" (bilingual EN + AR)
//   - Lives on invoices.total_written_off; treasury never touched
//   - Outstanding = total_amount - total_collected - total_written_off
//   - Recon status aware of write-off (effectiveExpected = amount - written off)
//   - Bilingual UI on every label, button, prompt, audit note
//   - Reversible (handleReverseWriteOff)

var fs = require('fs');
var path = require('path');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var utils = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'utils.js'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. Constants + handler defined
ok('1a: WRITE_OFF_SOFT_CAP_EGP constant = 1000',
  /const WRITE_OFF_SOFT_CAP_EGP = 1000/.test(page));
ok('1b: WRITE_OFF_REASON English locked to "Customer short-payment"',
  /const WRITE_OFF_REASON = 'Customer short-payment'/.test(page));
ok('1c: WRITE_OFF_REASON_AR Arabic translation present',
  /const WRITE_OFF_REASON_AR = 'خصم لعدم سداد العميل'/.test(page));
ok('1d: handleWriteOffShortPayment function defined',
  /const handleWriteOffShortPayment = async \(invoice, amount, notesEN\)/.test(page));
ok('1e: handleReverseWriteOff function defined',
  /const handleReverseWriteOff = async \(invoice\)/.test(page));

// 2. Permission + cap enforcement
ok('2a: canEditInvoices required',
  /handleWriteOffShortPayment[\s\S]{0,300}canEditInvoices[\s\S]{0,200}return false/.test(page));
ok('2b: amount > 0 required',
  /handleWriteOffShortPayment[\s\S]{0,800}amt <= 0[\s\S]{0,200}return false/.test(page));
ok('2c: amount cannot exceed outstanding (+ 0.50 tolerance)',
  /amt > outstanding \+ 0\.50/.test(page));
ok('2d: soft cap enforced unless super_admin',
  /amt > WRITE_OFF_SOFT_CAP_EGP && !isSuperAdmin/.test(page));

// 3. Persistence
ok('3a: dbUpdate writes total_written_off',
  /dbUpdate\('invoices'[\s\S]{0,400}total_written_off: newTotal/.test(page));
ok('3b: dbUpdate writes write_off_reason and write_off_notes',
  /write_off_reason: WRITE_OFF_REASON[\s\S]{0,300}write_off_notes/.test(page));
ok('3c: prior write-offs accumulate, not overwrite',
  /var prior = Number\(invoice\.total_written_off \|\| 0\)[\s\S]{0,200}var newTotal = prior \+ amt/.test(page));

// 4. Audit log
ok('4a: audit_log insert with action="write_off"',
  /audit_log[\s\S]{0,300}action: 'write_off'/.test(page));
ok('4b: audit captures EN + AR notes',
  /note_en: auditEN[\s\S]{0,200}note_ar: auditAR/.test(page));
ok('4c: audit flags soft_cap_overridden',
  /soft_cap_overridden: amt > WRITE_OFF_SOFT_CAP_EGP/.test(page));
ok('4d: reverse-write-off has its own audit action',
  /action: 'write_off_reverse'/.test(page));

// 5. Outstanding calculation includes write-off
ok('5a: recalc loads total_written_off from DB',
  /select\('id, total_amount, order_number, total_written_off'\)/.test(page));
ok('5b: outstanding subtracts total_written_off',
  /writtenOff = Number\(inv\.total_written_off \|\| 0\)[\s\S]{0,200}totalAmt - capped - writtenOff/.test(page));

// 6. Recon status is write-off-aware
ok('6a: getReconStatus loads total_written_off from invoice',
  /writtenOff = Number\(invoice\.total_written_off \|\| 0\)/.test(utils));
ok('6b: effectiveExpected used in over/reconciled comparison',
  /effectiveExpected = Math\.max\(0, Number\(invoice\.total_amount/.test(utils) &&
  /treasuryTotal > effectiveExpected \* 1\.02/.test(utils));

// 7. UI — auto-suggest button visible when outstanding ≤ 1000
ok('7a: write-off prompt appears when outstanding ≤ WRITE_OFF_SOFT_CAP_EGP',
  /selectedInvoice\.outstanding <= WRITE_OFF_SOFT_CAP_EGP[\s\S]{0,1500}Write off/.test(page));
ok('7b: confirmation prompt is bilingual (EN + AR)',
  /confirmEN = 'Write off[\s\S]{0,400}confirmAR = 'خصم/.test(page));
ok('7c: written-off amount visible if > 0',
  /selectedInvoice\.total_written_off[\s\S]{0,500}Written off[\s\S]{0,100}مخصوم/.test(page));
ok('7d: reverse button available on already-written-off invoices',
  /Reverse the[\s\S]{0,400}handleReverseWriteOff/.test(page));

// 8. Super-admin override path for amounts > cap
ok('8a: super_admin gets manual override button for > soft cap',
  /selectedInvoice\.outstanding > WRITE_OFF_SOFT_CAP_EGP && isSuperAdmin[\s\S]{0,400}admin override/.test(page));

// 9. Bilingual everything (toasts, buttons)
ok('9a: success toast bilingual',
  /Wrote off[\s\S]{0,200}تم خصم/.test(page));
ok('9b: error toasts bilingual',
  /لا تملك صلاحية الخصم|لا تملك الصلاحية/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.8 write-off tests passed');
