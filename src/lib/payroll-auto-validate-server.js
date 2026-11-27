// v55.83-AAD (Max, 27 Nov 2026: "payroll is automatically validated") — a payroll bill is validated by the system the moment it is
// created: no type / direction / checkboxes / "how verified". ONLY from a trusted source (Codex 27 Nov 13:40: the ZD payroll text match
// is a privacy rule, not proof a bill was checked): a bill the super admin enters by hand (only the super admin can make a payroll bill —
// ZD), a repeating payroll bill (set up by the super admin), or a KTC bill made from a Nextrade payroll line. A bill that arrives by
// e-mail or file import is NOT auto-validated: it waits for validation as before. A bill saved with a possible-duplicate warning waits too. The rule is ZD's one payroll rule (payrollReasons in
// ./payroll-bills), applied to THIS bill only; the reasons that matched go on the bill and in the audit trail
// (sql/v55-83-ZY-other-services-operational.sql → hub_bill_auto_validate_payroll). Server only. Fail-soft: when anything is missing
// the bill simply waits for validation as before, with a plain warning. Nothing here ever shows a payroll bill to anyone (ZD).
// SWC-safe (var + concatenation).
import { payrollReasons } from './payroll-bills';

export var AUTO_VALIDATED_PAYROLL = 'Auto-validated: payroll (rule)';
export var AAD_SQL_FILE = 'sql/v55-83-AAD-payroll-auto-validate.sql';
// where the bill came from → the words on the record
export var TRUSTED_PAYROLL_SOURCES = { super_admin_entry: 'entered by the super admin', repeating_bill: 'a repeating payroll bill', nextrade_payroll_line: 'made from a Nextrade payroll line' };


// the ZD payroll reasons for ONE bill (empty = not payroll) → { reasons } | { error }
export async function payrollReasonsForBill(db, billId) {
  var b = await db.from('vendor_bills').select('id, vendor_name, category, record_status, validation_status').eq('id', billId).maybeSingle();
  if (b.error) { return { error: 'bill: ' + b.error.message }; }
  if (!b.data) { return { error: 'bill not found' }; }
  var cats = await db.from('expense_categories').select('key, label');
  if (cats.error) { return { error: 'categories: ' + cats.error.message }; }
  var catLabels = {}; (cats.data || []).forEach(function (k) { catLabels[k.key] = k.label; });
  var ln = await db.from('vendor_bill_lines').select('bill_id, description').eq('bill_id', billId);
  if (ln.error) { return { error: 'bill lines: ' + ln.error.message }; }
  var linesBy = {}; linesBy[b.data.id] = (ln.data || []).filter(function (l) { return String(l.bill_id) === String(b.data.id); }).map(function (l) { return l.description; });
  var linked = {};
  var pc = await db.from('company_categories').select('company_id, key, is_payroll').eq('is_payroll', true);
  if (pc.error) { return { error: 'company categories: ' + pc.error.message }; }
  var pk = {}; (pc.data || []).forEach(function (c) { if (c && c.is_payroll === true) { pk[c.company_id + '|' + c.key] = true; } });
  if (Object.keys(pk).length) {
    var lk = await db.from('company_bill_links').select('bill_id, company_id, category_key, status').eq('bill_id', billId);
    if (lk.error) { return { error: 'company links: ' + lk.error.message }; }
    (lk.data || []).forEach(function (l) { if (String(l.bill_id) === String(b.data.id) && l.status === 'active' && pk[l.company_id + '|' + l.category_key]) { linked[b.data.id] = true; } });
  }
  return { bill: b.data, reasons: payrollReasons(b.data, { catLabels: catLabels, linesBy: linesBy, linked: linked }) };
}

// call right after a bill is created → { payroll: bool, validated: bool, warning? }. Never throws.
// opts.source = one of TRUSTED_PAYROLL_SOURCES (anything else: never auto-validated); opts.duplicateWarning = the save warned of a copy
export async function autoValidatePayroll(db, billId, opts) {
  var o = opts || {};
  if (!billId) { return { payroll: false, validated: false }; }
  if (!TRUSTED_PAYROLL_SOURCES[o.source]) { return { payroll: null, validated: false, untrusted: true }; }
  try {
    var pr = await payrollReasonsForBill(db, billId);
    if (pr.error) { return { payroll: null, validated: false, warning: 'Could not check whether this is a payroll bill (' + pr.error + ') — it waits for validation as usual.' }; }
    if (!pr.reasons.length) { return { payroll: false, validated: false }; }
    if ((pr.bill.record_status && pr.bill.record_status !== 'active') || pr.bill.validation_status === 'validated') { return { payroll: true, validated: pr.bill.validation_status === 'validated' }; }
    if (o.duplicateWarning) { return { payroll: true, validated: false, warning: 'Payroll bill — NOT validated automatically because it looks like a possible copy of another bill; check it and validate it by hand.' }; }
    var r = await db.rpc('hub_bill_auto_validate_payroll', { p: { bill_id: billId, reasons: pr.reasons.join('; '), source: TRUSTED_PAYROLL_SOURCES[o.source] } });
    if (r.error) {
      var m = String(r.error.message || '');
      if (/hub_bill_auto_validate_payroll|PGRST202|does not exist|schema cache/i.test(m)) { return { payroll: true, validated: false, warning: 'Payroll bill: automatic validation needs ' + AAD_SQL_FILE + ' — until it is run, it waits for validation.' }; }
      return { payroll: true, validated: false, warning: 'Payroll bill: automatic validation did not run (' + m + ') — it waits for validation.' };
    }
    var d = r.data || {};
    return { payroll: true, validated: d.ok === true, repeat: d.repeat === true };
  } catch (e) { return { payroll: null, validated: false, warning: 'Payroll check failed (' + ((e && e.message) || 'error') + ') — the bill waits for validation.' }; }
}
