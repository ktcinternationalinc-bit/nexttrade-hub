// v55.83-ZY (Max, 27 Nov 2026: "payroll is automatically validated") — a payroll bill is validated by the system the moment it is
// created or imported: no type / direction / checkboxes / "how verified". The rule is ZD's one payroll rule (payrollReasons in
// ./payroll-bills), applied to THIS bill only; the reasons that matched go on the bill and in the audit trail
// (sql/v55-83-ZY-other-services-operational.sql → hub_bill_auto_validate_payroll). Server only. Fail-soft: when anything is missing
// the bill simply waits for validation as before, with a plain warning. Nothing here ever shows a payroll bill to anyone (ZD).
// SWC-safe (var + concatenation).
import { payrollReasons } from './payroll-bills';

export var AUTO_VALIDATED_PAYROLL = 'Auto-validated: payroll (rule)';
export var ZY_SQL_FILE = 'sql/v55-83-ZY-other-services-operational.sql';


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

// call right after a bill is created / imported → { payroll: bool, validated: bool, warning? }. Never throws.
export async function autoValidatePayroll(db, billId) {
  if (!billId) { return { payroll: false, validated: false }; }
  try {
    var pr = await payrollReasonsForBill(db, billId);
    if (pr.error) { return { payroll: null, validated: false, warning: 'Could not check whether this is a payroll bill (' + pr.error + ') — it waits for validation as usual.' }; }
    if (!pr.reasons.length) { return { payroll: false, validated: false }; }
    if ((pr.bill.record_status && pr.bill.record_status !== 'active') || pr.bill.validation_status === 'validated') { return { payroll: true, validated: pr.bill.validation_status === 'validated' }; }
    var r = await db.rpc('hub_bill_auto_validate_payroll', { p: { bill_id: billId, reasons: pr.reasons.join('; ') } });
    if (r.error) {
      var m = String(r.error.message || '');
      if (/hub_bill_auto_validate_payroll|PGRST202|does not exist|schema cache/i.test(m)) { return { payroll: true, validated: false, warning: 'Payroll bill: automatic validation needs ' + ZY_SQL_FILE + ' — until it is run, it waits for validation.' }; }
      return { payroll: true, validated: false, warning: 'Payroll bill: automatic validation did not run (' + m + ') — it waits for validation.' };
    }
    var d = r.data || {};
    return { payroll: true, validated: d.ok === true, repeat: d.repeat === true };
  } catch (e) { return { payroll: null, validated: false, warning: 'Payroll check failed (' + ((e && e.message) || 'error') + ') — the bill waits for validation.' }; }
}
