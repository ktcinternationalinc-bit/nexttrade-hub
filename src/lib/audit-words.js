// v55.83-TH — AUDIT IN PLAIN WORDS (Max, Nov 16 2026: "audit -- needs to be more user friendly and understandable. specific
// actions and changes done is clear and concise"). Turns one audit row into ONE short sentence (what was done, to what) plus a
// few short facts (amounts, dates, reasons, from → to). The raw record is still kept and can be opened. Pure; SWC-safe.

function money(v) { var n = Number(v); if (v === null || v === undefined || v === '' || isNaN(n)) { return null; } return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function niceDate(d) { var s = String(d || ''); var x = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!x) { return s || null; } return MON[Number(x[2]) - 1] + ' ' + Number(x[3]) + ', ' + x[1]; }
// "2026-11-16T21:45:10Z" → "Nov 16, 2026 · 4:45 PM" in New York time (the business timezone)
export function niceWhen(iso) {
  var t = Date.parse(iso); if (isNaN(t)) { return String(iso || ''); }
  try {
    var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    return f.format(new Date(t)).replace(/, (\d{1,2}:\d{2})/, ' · $1');
  } catch (e) { return new Date(t).toISOString().replace('T', ' ').substring(0, 16); }
}
function words(k) { return String(k || '').replace(/_/g, ' '); }
function show(v) {
  if (v === null || v === undefined || v === '') { return 'empty'; }
  if (typeof v === 'number') { return String(v); }
  if (typeof v === 'boolean') { return v ? 'yes' : 'no'; }
  if (typeof v === 'object') { return Object.keys(v).map(function (k) { return words(k) + ' ' + show(v[k]); }).join(', '); }
  return String(v);
}
// { from: {a:1,b:2}, to: {a:1,b:3} } or { field: {from, to} } → ['b: 2 → 3']
export function changeLines(d) {
  var out = [];
  if (!d || typeof d !== 'object') { return out; }
  if (d.from !== undefined && d.to !== undefined && typeof d.from === 'object' && d.from && typeof d.to === 'object' && d.to) {
    Object.keys(d.to).forEach(function (k) { if (JSON.stringify(d.from[k]) !== JSON.stringify(d.to[k])) { out.push(words(k) + ': ' + show(d.from[k]) + ' → ' + show(d.to[k])); } });
    return out;
  }
  if (d.from !== undefined && d.to !== undefined && (typeof d.from !== 'object' || d.from === null)) { out.push(show(d.from) + ' → ' + show(d.to)); return out; }
  Object.keys(d).forEach(function (k) { var v = d[k]; if (v && typeof v === 'object' && !Array.isArray(v) && v.from !== undefined && v.to !== undefined) { if (JSON.stringify(v.from) !== JSON.stringify(v.to)) { out.push(words(k) + ': ' + show(v.from) + ' → ' + show(v.to)); } } });
  return out;
}

// row = { action, subject (plain name of what it was done to), details, refs: { bank: 'Jun 3, 2026 · $20,000.00 · WIRE OUT', invoice: 'INV-1' } }
// returns { sentence, facts: [...] }
export function describeAudit(row) {
  var r = row || {}; var d = r.details || {}; var on = r.subject || null; var refs = r.refs || {};
  var facts = [];
  function fact(x) { if (x) { facts.push(x); } }
  function reason() { fact(d.reason ? 'Reason: ' + d.reason : (d.note ? 'Note: ' + d.note : null)); }
  var s;
  switch (r.action) {
    case 'bill_payment_recorded':
      s = 'Recorded a payment of ' + (money(d.amount) || 'an amount') + (on ? ' on ' + on : '');
      fact(d.paid_date ? 'Paid on ' + niceDate(d.paid_date) : null);
      fact(refs.bank ? 'Bank line: ' + refs.bank : (d.bank_transaction_id ? 'Linked to a bank line' : 'Not linked to a bank line'));
      fact(d.method === 'rtm' ? 'Paid through RTM' : null);
      fact(d.partial ? 'Partial payment — ' + money(d.open_after) + ' still open' : null);
      break;
    case 'bill_payments_from_bank':
      s = 'Paid ' + (d.bills || 0) + ' bill' + (d.bills === 1 ? '' : 's') + ' from one bank line' + (refs.bank ? ' (' + refs.bank + ')' : '');
      fact(money(d.total) ? 'Total ' + money(d.total) + (money(d.left) ? ' — ' + money(d.left) + ' of the bank line still free' : ' — the bank line is fully used') : null);
      break;
    case 'bill_payment_voided': s = 'Undid a payment' + (money(d.amount) ? ' of ' + money(d.amount) : '') + (on ? ' on ' + on : ''); fact(d.paid_date ? 'It was dated ' + niceDate(d.paid_date) : null); fact(refs.bank ? 'Bank line freed: ' + refs.bank : null); reason(); fact(money(d.open_after) ? 'Bill open again: ' + money(d.open_after) : null); break;
    case 'bill_created': s = 'Created ' + (on || 'a bill'); fact(money(d.amount) ? 'Amount ' + money(d.amount) : null); fact(d.category ? 'Category: ' + d.category : null); fact(d.paid_via ? 'Paid through ' + d.paid_via : null); break;
    case 'bill_updated': s = 'Edited ' + (on || 'a bill'); changeLines(d).forEach(fact); if (!changeLines(d).length) { fact(money(d.amount) ? 'Amount now ' + money(d.amount) : null); fact(d.category ? 'Category now ' + d.category : null); } break;
    case 'bill_validated': s = 'Validated ' + (on || 'a bill'); fact(d.notes ? 'How it was checked: ' + d.notes : null); break;
    case 'bill_validation_reopened': s = 'Reopened the validation of ' + (on || 'a bill') + ' (back to pending)'; reason(); fact(d.on_wire ? 'It is on wire ' + d.on_wire + ' — that wire must be signed again' : null); break;
    case 'bill_voided': s = 'Voided ' + (on || 'a bill'); reason(); break;
    case 'bill_deleted': s = 'Deleted ' + (on || 'a bill') + ' from the Hub'; reason(); fact(d.voided_payments ? d.voided_payments + ' payment(s) on it were undone' : null); break;
    case 'bill_duplicate_dismissed': s = 'Marked ' + (on || 'a bill') + ' as NOT a duplicate'; reason(); break;
    case 'bill_duplicate_override': s = 'Saved a bill that looked like a duplicate' + (d.vendor ? ' (' + d.vendor + (d.bill_number ? ' ' + d.bill_number : '') + ')' : ''); break;
    case 'bill_lines_saved': s = 'Saved the lines of ' + (on || 'a bill') + (d.lines ? ' (' + d.lines + ' lines)' : ''); break;
    case 'bill_file_attached': s = 'Attached the bill document to ' + (on || 'a bill'); break;
    case 'bill_imported_from_file': s = 'Imported ' + (on || 'a bill') + ' from a file'; fact(d.file ? 'File: ' + d.file : null); break;
    case 'bill_email_scanned_in': s = 'The email scanner created ' + (on || 'a bill'); fact(d.from ? 'From: ' + d.from : null); break;
    case 'bill_paid_via_set': s = 'Marked ' + (Array.isArray(d.bills) ? d.bills.length + ' bill(s)' : 'bills') + ' as paid through ' + (d.paid_via || '?'); break;
    case 'wire_package_prepared': s = 'Prepared wire ' + (on || ''); break;
    case 'wire_package_updated': s = 'Changed wire ' + (on || '') + ' (signatures must be given again)'; break;
    case 'wire_package_audit_run': s = 'Ran the check on wire ' + (on || '') + ': ' + (d.pass ? 'passed' : 'found problems'); fact(d.blocks ? d.blocks + ' blocking problem(s)' : null); fact(d.warns ? d.warns + ' warning(s)' : null); break;
    case 'wire_check_overridden': s = 'Overrode a check on wire ' + (on || d.wire || ''); fact(d.check ? 'Check: ' + d.check : null); reason(); break;
    case 'wire_package_signoff_1': s = 'Gave the 1st signature on wire ' + (on || ''); break;
    case 'wire_package_signoff_2': s = 'Gave the 2nd signature on wire ' + (on || '') + ' — approved, ready to send'; break;
    case 'wire_bill_reviewed': s = 'Checked bill ' + ((d.vendor || '') + (d.bill_number ? ' ' + d.bill_number : '')).trim() + ' while signing wire ' + (on || ''); fact(money(d.amount) ? 'Amount on the wire ' + money(d.amount) : null); break;
    case 'wire_package_sent': s = 'Marked wire ' + (on || '') + ' as sent'; fact(money(d.total) ? 'Total ' + money(d.total) : null); fact(d.sent_date ? 'Sent on ' + niceDate(d.sent_date) : null); break;
    case 'wire_package_attached': s = 'Attached wire ' + (on || '') + ' to its bank line — its bills are paid'; break;
    case 'wire_package_cancelled': s = 'Cancelled wire ' + (on || ''); reason(); break;
    case 'wire_package_deleted': s = 'Deleted pre-wire ' + (on || ''); reason(); break;
    case 'wire_package_reversed': s = 'Undid sent wire ' + (on || '') + ' — its bill payments were undone'; reason(); break;
    case 'wire_sent_date_changed': s = 'Changed the sent date of wire ' + (on || ''); fact(niceDate(d.from) + ' → ' + niceDate(d.to)); reason(); break;
    case 'wire_recorded_after_the_fact': s = 'Recorded a past wire ' + (on || '') + (d.payee ? ' to ' + d.payee : ''); fact(money(d.total) ? 'Total ' + money(d.total) : null); reason(); break;
    case 'deposit_matched_to_invoice': s = 'Matched a deposit to ' + (refs.invoice ? 'invoice ' + refs.invoice : 'an invoice'); fact(on ? 'Deposit: ' + on : null); fact(money(d.applied) ? 'Applied ' + money(d.applied) : null); break;
    case 'match_reversed': s = 'Undid the match of ' + (on || 'a bank line'); break;
    case 'bank_classify': s = 'Categorized ' + (on || 'a bank line') + (d.classification ? ' as ' + words(d.classification) : ''); break;
    default:
      s = words(r.action).replace(/^./, function (x) { return x.toUpperCase(); }) + (on ? ' — ' + on : '');
      changeLines(d).forEach(fact); reason();
  }
  return { sentence: s.replace(/\s+/g, ' ').trim(), facts: facts };
}
