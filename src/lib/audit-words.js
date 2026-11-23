// v55.83-TH — AUDIT IN PLAIN WORDS (Max, Nov 16 2026: "audit -- needs to be more user friendly and understandable. specific
// actions and changes done is clear and concise"). Turns one audit row into ONE short sentence (what was done, to what) plus a
// few short facts (amounts, dates, reasons, from → to). The raw record is still kept and can be opened. Pure; SWC-safe.
// v55.83-YC (Max, 23 Nov: "for the auditi. needs to be in layman terms. specifically clear what was changed or updated or deleted
// or whatever") — every action seen on live has its own sentence; anything else falls back to plain "name: old → new" lines, never
// JSON. Names come from ctx (category labels, Wave accounts, product groups, people) that the server adds. Removed / voided /
// deleted / cancelled / reversed are always said in words. Where an old row did not record the value before, it says "set to X".

function isNum(v) { return v !== null && v !== undefined && v !== '' && !isNaN(Number(v)); }
export function money(v) { if (!isNum(v)) { return null; } var n = Number(v); return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
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
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.substring(1); }
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// keys that are bookkeeping, not something a person changed
var HIDE = /^(id|.*_id|.*_ids|ids|fingerprint|request_id|row_id|updated_at|updated_by|created_at|created_by|v|by|api_build_marker|message_id|smtp_response|log|job)$/;
function show(v, key) {
  if (v === null || v === undefined || v === '') { return 'empty'; }
  if (typeof v === 'boolean') { return v ? 'yes' : 'no'; }
  if (typeof v === 'number') { return /amount|total|cost|price|balance|paid|charged|need|short|fee|left|remaining|per_lb|minimum/.test(String(key || '')) ? money(v) : String(v); }
  if (Array.isArray(v)) { return v.length <= 3 && v.every(function (x) { return typeof x !== 'object'; }) ? v.join(', ') : v.length + ' item' + (v.length === 1 ? '' : 's'); }
  if (typeof v === 'object') { var ks = Object.keys(v).filter(function (k) { return !HIDE.test(k); }); return ks.map(function (k) { return words(k) + ' ' + show(v[k], k); }).join(', ') || 'empty'; }
  var s = String(v);
  if (UUID.test(s)) { return 'a record'; }
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(s) && /date|as_of|_at$|^at$|from|to/.test(String(key || '')) ) { return niceDate(s); }
  return s;
}
function same(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
// { from: {a:1,b:2}, to: {a:1,b:3} } / { before, after } / { field: {from, to} } → ['b: 2 → 3']
export function changeLines(d) {
  var out = [];
  if (!d || typeof d !== 'object') { return out; }
  function pair(a, b) {
    if (a && typeof a === 'object' && !Array.isArray(a) && b && typeof b === 'object' && !Array.isArray(b)) {
      Object.keys(b).forEach(function (k) { if (HIDE.test(k)) { return; } if (!same(a[k], b[k])) { out.push(words(k) + ': ' + show(a[k], k) + ' → ' + show(b[k], k)); } });
      return true;
    }
    if (a === null && b && typeof b === 'object' && !Array.isArray(b)) { Object.keys(b).forEach(function (k) { if (!HIDE.test(k) && b[k] !== null && b[k] !== undefined && b[k] !== '') { out.push(words(k) + ': set to ' + show(b[k], k)); } }); return true; }
    return false;
  }
  if (d.from !== undefined && d.to !== undefined) { if (!pair(d.from, d.to)) { out.push(show(d.from) + ' → ' + show(d.to)); } return out; }
  if (d.before !== undefined && d.after !== undefined && pair(d.before, d.after)) { return out; }
  Object.keys(d).forEach(function (k) { var v = d[k]; if (v && typeof v === 'object' && !Array.isArray(v) && v.from !== undefined && v.to !== undefined) { if (!same(v.from, v.to)) { out.push(words(k) + ': ' + show(v.from, k) + ' → ' + show(v.to, k)); } } });
  return out;
}
// the simple facts of an unknown row: scalar keys a person would care about, never ids / bookkeeping
function plainFacts(d) {
  var out = [];
  Object.keys(d || {}).forEach(function (k) {
    if (HIDE.test(k) || k === 'from' || k === 'to' || k === 'before' || k === 'after' || k === 'reason' || k === 'note') { return; }
    var v = d[k];
    if (v === null || v === undefined || v === '') { return; }
    if (typeof v === 'object' && !Array.isArray(v)) { if (v.from !== undefined && v.to !== undefined) { return; } }
    var s = show(v, k); if (s === 'a record' || s === 'empty') { return; }
    out.push(cap(words(k)) + ': ' + s);
  });
  return out.slice(0, 8);
}
export function releaseName(k) { var s = String(k || '').replace(/[^0-9A-Za-z]/g, ''); return /^\d{8}$/.test(s) ? s.substring(0, 4) + '-' + s.substring(4) : String(k || ''); }
var PARTS = { trucking: 'trucking cost', freight: 'freight cost', bond: 'bond cost', other: 'other cost' };

// row = { action, subject, details, refs: { bank, invoice, bank2, person, group }, entity, entity_id }
// ctx = { cat: { key: label }, wave: { id: name } } (optional)
// returns { sentence, facts: [...] }
export function describeAudit(row, ctxIn) {
  var r = row || {}; var d = (r.details && typeof r.details === 'object') ? r.details : {}; var on = r.subject || null; var refs = r.refs || {}; var ctx = ctxIn || {};
  var facts = [];
  function fact(x) { if (x) { facts.push(x); } }
  function reason() { fact(d.reason ? 'Reason: ' + d.reason : null); fact(d.note && typeof d.note === 'string' ? 'Note: ' + d.note : null); }
  function cat(k) { if (k === null || k === undefined || k === '') { return 'no category'; } return (ctx.cat && ctx.cat[k]) || cap(words(k)); }
  function waveName(id) { return id ? ((ctx.wave && ctx.wave[id]) || 'a Wave account') : 'none'; }
  function line() { return on || (refs.bank ? 'bank line ' + refs.bank : 'a bank line'); }
  function changed(what, a, b, fmt) { var f = fmt || function (x) { return x; }; return (a === undefined) ? what + ' set to ' + f(b) : what + ': ' + f(a) + ' → ' + f(b); }
  var s;
  switch (r.action) {
    // ── bills ──
    case 'bill_payment_recorded':
      s = 'Recorded a payment of ' + (money(d.amount) || 'an amount') + (on ? ' on ' + on : '');
      fact(d.paid_date ? 'Paid on ' + niceDate(d.paid_date) : null);
      fact(refs.bank ? 'Bank line: ' + refs.bank : (d.bank_transaction_id ? 'Linked to a bank line' : 'Not linked to a bank line'));
      fact(d.method === 'rtm' ? 'Paid through RTM' : null);
      fact(d.partial ? 'Partial payment — ' + money(d.open_after) + ' still open' : null);
      fact(d.category_carried ? 'The bill’s category was put on the bank line' : null);
      break;
    case 'bill_payments_from_bank':
      s = 'Paid ' + (d.bills || 0) + ' bill' + (d.bills === 1 ? '' : 's') + ' from one bank line' + (refs.bank ? ' (' + refs.bank + ')' : '');
      fact(money(d.total) ? 'Total ' + money(d.total) + (money(d.left) ? ' — ' + money(d.left) + ' of the bank line still free' : ' — the bank line is fully used') : null);
      break;
    case 'bill_payment_voided': s = 'Undid (voided) a payment' + (money(d.amount) ? ' of ' + money(d.amount) : '') + (on ? ' on ' + on : ''); fact(d.paid_date ? 'It was dated ' + niceDate(d.paid_date) : null); fact(refs.bank ? 'Bank line freed: ' + refs.bank : null); reason(); fact(money(d.open_after) ? 'Bill open again: ' + money(d.open_after) : null); break;
    case 'bill_created': s = 'Created ' + (on || 'a bill'); fact(money(d.amount) ? 'Amount ' + money(d.amount) : null); fact(d.category ? 'Category: ' + cat(d.category) : null); fact(d.paid_via || d.paid_via_set ? 'Paid through ' + (d.paid_via || d.paid_via_set) : null); fact(d.from_nextrade_line ? 'Made from a Nextrade bank line' : null); break;
    case 'nextrade_bill_updated': s = 'Updated ' + (on || 'a KTC bill') + ' from its Nextrade bank line'; fact(d.category ? 'Category: ' + cat(d.category) : null); break;
    case 'bill_updated': s = 'Edited ' + (on || 'a bill'); changeLines(d).forEach(fact); if (!changeLines(d).length) { fact(money(d.amount) ? 'Amount now ' + money(d.amount) : null); fact(d.category ? 'Category now ' + cat(d.category) : null); fact(d.vendor ? 'Vendor now ' + d.vendor : null); fact(d.paid_via ? 'Paid through ' + d.paid_via : null); } break;
    case 'bill_validated': s = 'Validated ' + (on || 'a bill'); fact(d.notes ? 'How it was checked: ' + d.notes : null); fact(d.bill_type && d.bill_type_was !== undefined && d.bill_type_was !== d.bill_type ? 'Bill type: ' + words(d.bill_type_was || 'none') + ' → ' + words(d.bill_type) : null); fact(d.shipment_direction && d.direction_was !== undefined && d.direction_was !== d.shipment_direction ? 'Direction: ' + (d.direction_was || 'none') + ' → ' + d.shipment_direction : null); fact(d.price_check ? 'Price check: ' + words(typeof d.price_check === 'object' ? (d.price_check.status || 'done') : d.price_check) : null); break;
    case 'bill_validation_progress_saved': s = 'Saved part of the validation of ' + (on || 'a bill'); changeLines(d).forEach(fact); break;
    case 'bill_validation_reopened': s = 'Reopened the validation of ' + (on || 'a bill') + ' (back to pending)'; reason(); fact(d.on_wire ? 'It is on wire ' + d.on_wire + ' — that wire must be signed again' : null); break;
    case 'bill_voided': s = 'Voided ' + (on || 'a bill') + ' (kept on file, no longer counted)'; reason(); fact(d.kept_copy ? 'The other copy was kept' : null); break;
    case 'bill_deleted': s = 'Deleted ' + (on || (d.bill ? 'bill ' + show(d.bill) : 'a bill')) + ' from the Hub'; reason(); fact(d.voided_payments ? d.voided_payments + ' payment(s) on it were undone' : null); fact(d.lines ? d.lines + ' line(s) went with it' : null); break;
    case 'bill_duplicate_dismissed': case 'bill_dup_dismissed': s = 'Marked ' + (on || 'a bill') + ' as NOT a duplicate'; reason(); break;
    case 'bill_duplicate_override': s = 'Saved a bill that looked like a duplicate' + (d.vendor ? ' (' + d.vendor + (d.bill_number ? ' ' + d.bill_number : '') + ')' : ''); break;
    case 'bill_lines_saved': s = 'Saved the lines of ' + (on || 'a bill') + (d.lines ? ' (' + d.lines + ' lines)' : ''); fact(d.commission_vendor ? 'Commission vendor: ' + d.commission_vendor : null); break;
    case 'bill_file_attached': s = 'Attached the bill document to ' + (on || 'a bill'); break;
    case 'bill_imported_from_file': case 'bill_file_ingested': s = 'Imported ' + (on || 'a bill') + ' from a file'; fact(d.file ? 'File: ' + d.file : null); fact(d.duplicate_warning ? 'Warning: it looked like a duplicate' : null); break;
    case 'bill_email_scanned_in': s = 'The email scanner created ' + (on || 'a bill'); fact(d.from ? 'From: ' + d.from : null); break;
    case 'bill_paid_via_set': s = 'Marked ' + (Array.isArray(d.bills) ? d.bills.length + ' bill(s)' : 'bills') + ' as paid through ' + (d.paid_via || '?'); break;
    case 'bill_disputed': s = 'Disputed ' + (on || 'a bill'); reason(); fact(d.ticket ? 'Ticket ' + d.ticket : null); fact(d.follow_up ? 'Follow up on ' + niceDate(d.follow_up) : null); break;
    case 'bill_dispute_resolved': s = 'Resolved the dispute on ' + (on || 'a bill'); fact(d.resolution ? 'Resolution: ' + d.resolution : null); break;
    case 'bill_release_set': s = 'Set the release # of ' + (on || 'a bill'); changeLines(d).forEach(fact); break;
    case 'bill_reference_set': s = 'Set the reference of ' + (on || 'a bill'); changeLines(d).forEach(fact); break;
    case 'bill_direction_set': s = 'Set inbound / outbound on ' + (on || 'a bill'); changeLines(d).forEach(fact); break;
    // ── wires ──
    case 'wire_package_prepared': s = 'Prepared wire ' + (on || '') + (d.payee ? ' to ' + d.payee : ''); fact(money(d.total) ? 'Total ' + money(d.total) : null); fact(Array.isArray(d.bills) ? d.bills.length + ' bill(s)' : null); break;
    case 'wire_package_updated': s = 'Changed wire ' + (on || '') + ' (signatures must be given again)'; fact(money(d.total) ? 'Total now ' + money(d.total) : null); fact(Array.isArray(d.bills) ? d.bills.length + ' bill(s) on it' : null); fact(typeof d.changes === 'string' ? d.changes : null); break;
    case 'wire_package_audit_run': s = 'Ran the check on wire ' + (on || '') + ': ' + (d.pass ? 'passed' : 'found problems'); fact(d.blocks ? d.blocks + ' blocking problem(s)' : null); fact(d.warns ? d.warns + ' warning(s)' : null); break;
    case 'wire_check_overridden': s = 'Overrode a check on wire ' + (on || d.wire || ''); fact(d.check ? 'Check: ' + d.check : null); reason(); break;
    case 'wire_package_signoff_1': s = 'Gave the 1st signature on wire ' + (on || ''); fact(money(d.total) ? 'Total ' + money(d.total) : null); break;
    case 'wire_package_signoff_2': s = 'Gave the 2nd signature on wire ' + (on || '') + ' — approved, ready to send'; fact(money(d.total) ? 'Total ' + money(d.total) : null); break;
    case 'wire_bill_reviewed': s = 'Checked bill ' + ((d.vendor || '') + (d.bill_number ? ' ' + d.bill_number : '')).trim() + ' while signing wire ' + (on || ''); fact(money(d.amount) ? 'Amount on the wire ' + money(d.amount) : null); break;
    case 'wire_package_sent': s = 'Marked wire ' + (on || '') + ' as sent'; fact(money(d.total) ? 'Total ' + money(d.total) : null); fact(d.sent_date ? 'Sent on ' + niceDate(d.sent_date) : null); break;
    case 'wire_package_attached': s = 'Attached wire ' + (on || '') + ' to its bank line — its bills are paid'; break;
    case 'wire_package_cancelled': s = 'Cancelled wire ' + (on || ''); reason(); break;
    case 'wire_package_deleted': s = 'Deleted pre-wire ' + (on || d.wire || ''); reason(); fact(money(d.total) ? 'It was for ' + money(d.total) + (d.payee ? ' to ' + d.payee : '') : null); break;
    case 'wire_package_reversed': s = 'Undid sent wire ' + (on || d.wire || '') + ' — its bill payments were undone'; reason(); break;
    case 'bill_payments_voided_by_wire_undo': s = 'Undid the bill payments of wire ' + (d.wire || '') + (refs.bank ? ' on ' + refs.bank : ''); fact(isNum(d.payments) ? d.payments + ' payment(s) voided' : null); reason(); break;
    case 'wire_confirmation_read': s = 'Read the bank confirmation of ' + (on || 'a wire'); fact(d.read && d.read.sent_date ? 'Wire date ' + niceDate(d.read.sent_date) : null); break;
    case 'wire_date_changed': s = 'Changed the wire date of ' + (on || 'a wire'); fact((d.from ? niceDate(d.from) : 'none') + ' → ' + (d.to ? niceDate(d.to) : 'none')); reason(); break;
    case 'wire_sent_date_changed': s = 'Changed the sent date of wire ' + (on || ''); fact(niceDate(d.from) + ' → ' + niceDate(d.to)); reason(); break;
    case 'wire_recorded_after_the_fact': s = 'Recorded a past wire ' + (on || '') + (d.payee ? ' to ' + d.payee : ''); fact(money(d.total) ? 'Total ' + money(d.total) : null); reason(); break;
    // ── bank lines ──
    case 'bulk_categorized': {
      var n = Number(d.lines || (Array.isArray(d.ids) ? d.ids.length : null) || (String(r.entity_id || '').match(/^(\d+)/) || [])[1] || 0);
      s = 'Set the category of ' + (n === 1 && on ? on : (n || 'some') + ' bank line' + (n === 1 ? '' : 's')) + ' to ' + cat(d.classification);
      if (d.before !== undefined) { fact('Category: ' + cat(d.before) + ' → ' + cat(d.classification)); }
      fact(d.rules_learned ? 'A rule was learned from it' + (d.rules_learned > 1 ? ' (' + d.rules_learned + ')' : '') : null);
      fact(d.look_alikes_updated ? d.look_alikes_updated + ' other line(s) with the same description were set too' : null);
      fact(d.reviewed ? 'Marked reviewed' : null);
      fact(d.wave_updated ? 'Wave category set on ' + d.wave_updated + ' line(s)' : null);
      break;
    }
    case 'category_pick_undo_point': {
      var lb = (d.line && d.line.before) || {}; var la = (d.line && d.line.after) || {};
      s = 'Changed the category of ' + (on || (d.line && d.line.who ? 'bank line ' + d.line.who : 'a bank line')) + ': ' + cat(lb.classification) + ' → ' + cat(la.classification || d.cls);
      fact(lb.review_status !== la.review_status && la.review_status ? 'Review: ' + words(lb.review_status || 'none') + ' → ' + words(la.review_status) : null);
      fact((d.look || []).length ? d.look.length + ' other line(s) with the same description were set too' : null);
      fact(d.rule && d.rule.how ? 'Rule ' + words(d.rule.how) : null);
      break;
    }
    case 'category_pick_undone': s = 'Undid a category pick' + (d.to !== undefined ? ' — the line is back to ' + cat(d.to) : ''); fact(d.look && d.look.restored ? d.look.restored + ' other line(s) put back too' : null); fact(d.rule === 'switched_off' ? 'The rule it made was switched off' : null); break;
    case 'category_removed': {
      var cb = d.before || {}; var ca = d.after || {};
      s = 'Removed the category ' + cat(cb.classification) + ' from ' + line() + ' (back to Uncategorized)';
      fact(cb.review_status && ca.review_status && cb.review_status !== ca.review_status ? 'Review: ' + words(cb.review_status) + ' → ' + words(ca.review_status) : null);
      fact(cb.wave_account_id ? 'Wave category removed too' : null);
      break;
    }
    case 'bank_classify':
      if (d.classification !== undefined && d.classification !== null) { s = 'Set the category of ' + line() + ' to ' + cat(d.classification); if (d.before_classification !== undefined) { fact('Category: ' + cat(d.before_classification) + ' → ' + cat(d.classification)); } }
      else { s = 'Set the Wave category of ' + line() + ' to ' + waveName(d.wave_account_id); }
      if (d.wave_account_id && d.classification) { fact('Wave category: ' + waveName(d.wave_account_id)); }
      if (d.before_wave_account_id !== undefined && d.before_wave_account_id !== d.wave_account_id) { fact('Wave category: ' + waveName(d.before_wave_account_id) + ' → ' + waveName(d.wave_account_id)); }
      break;
    case 'company_line_categorized':
      s = (d.to ? 'Set the category of ' : 'Removed the category from ') + (d.company ? cap(words(String(d.company).replace(/_BOOKS$/, '').toLowerCase())) + ' ' : '') + line() + (d.to ? ' to ' + cat(d.to) : '');
      fact('Category: ' + cat(d.from) + ' → ' + cat(d.to));
      fact(d.source === 'rule' ? 'Done by a rule' : null);
      fact(d.ktc_bill_action && d.ktc_bill_action !== 'none' ? 'KTC bill ' + words(d.ktc_bill_action) : null);
      break;
    case 'deposit_matched_to_invoice': s = 'Matched a deposit to ' + (refs.invoice ? 'invoice ' + refs.invoice : 'an invoice'); fact(on ? 'Deposit: ' + on : null); fact(money(d.applied) ? 'Applied ' + money(d.applied) : null); fact(Number(d.deposit_remaining) > 0 ? money(d.deposit_remaining) + ' of the deposit still free' : null); fact(money(d.held_credit_used) ? 'Used ' + money(d.held_credit_used) + ' of held customer credit' : null); break;
    case 'match_reversed': s = 'Undid the invoice match of ' + line(); fact(isNum(d.invoices) ? d.invoices + ' invoice payment(s) removed' : null); fact(d.splits_removed ? d.splits_removed + ' split line(s) removed' : null); break;
    case 'deposit_split_saved': s = 'Split ' + line() + (d.lines ? ' into ' + d.lines + ' parts' : ''); break;
    case 'transfer_paired': s = 'Paired two bank lines as a transfer between our own accounts'; fact(on ? 'Line: ' + on : null); fact(refs.bank2 ? 'Other side: ' + refs.bank2 : null); fact(d.reviewed ? 'Marked reviewed' : null); break;
    case 'transfer_unpaired': s = 'Unpaired a transfer'; fact(on ? 'Line: ' + on : null); fact(refs.bank2 ? 'Other side: ' + refs.bank2 : null); break;
    case 'rtm_payment_flagged': s = 'Marked ' + line() + ' as money sent through ' + (d.payer || 'RTM / NextTrade'); fact(d.before && d.before.third_party_payer !== undefined ? 'Was: ' + (d.before.third_party_payer || 'not marked') : null); break;
    case 'rtm_flag_cleared': s = 'Took the RTM / NextTrade mark off ' + line(); break;
    case 'bank_duplicate_removed': case 'bank_duplicate_auto_removed': s = (r.action === 'bank_duplicate_auto_removed' ? 'The Hub removed' : 'Removed') + ' a duplicate copy of a bank line' + (money(d.amount) ? ' of ' + money(d.amount) : '') + (d.date ? ' dated ' + niceDate(d.date) : '') + ' — the other copy was kept'; reason(); fact(d.can_restore ? 'It can be brought back' : null); break;
    case 'bank_duplicate_dismissed': s = 'Marked bank lines as NOT duplicates'; fact(Array.isArray(d.pairs) ? d.pairs.length + ' pair(s)' : null); break;
    case 'statement_rows_imported': s = 'Imported bank-statement lines' + (on ? ' into ' + on : ''); fact(isNum(d.imported) ? d.imported + ' new line(s)' : null); fact(d.skipped_existing ? d.skipped_existing + ' already there' : null); fact(d.skipped_bad ? d.skipped_bad + ' could not be read' : null); break;
    case 'manual_account_created': s = 'Added a bank account by hand: ' + (d.name || '') + (d.mask ? ' …' + d.mask : ''); fact(d.institution ? 'Bank: ' + d.institution : null); fact(d.credit_card ? 'Credit card' : null); break;
    // ── rules and categories ──
    case 'rule_applied_now': s = 'Ran a category rule' + (d.match_text ? ' ("' + d.match_text + '")' : '') + (d.classification ? ' → ' + cat(d.classification) : ''); fact(isNum(d.applied) ? d.applied + ' line(s) set' : null); fact(d.overwrote_people ? d.overwrote_people + ' line(s) a person had set were changed too' : null); break;
    case 'rule_applied_on_categorize': s = 'A category pick filled look-alike lines' + (d.match_text ? ' ("' + d.match_text + '")' : '') + (d.classification ? ' with ' + cat(d.classification) : ''); fact(isNum(d.updated) ? d.updated + ' line(s) set' : null); fact(d.left_people ? d.left_people + ' line(s) a person had set were left' : null); break;
    case 'company_rule_learned': case 'company_rule_created': s = (r.action === 'company_rule_created' ? 'Created' : 'Learned') + ' a ' + (d.company ? cap(words(String(d.company).replace(/_BOOKS$/, '').toLowerCase())) + ' ' : '') + 'rule' + (d.match_text ? ': "' + d.match_text + '"' : '') + ' → ' + cat(d.to || d.category); fact(d.direction ? 'Money ' + (d.direction === 'in' ? 'in' : d.direction === 'out' ? 'out' : 'in or out') : null); fact(d.how ? cap(d.how) : null); break;
    case 'company_rules_applied': s = 'Ran the ' + (d.company ? cap(words(String(d.company).replace(/_BOOKS$/, '').toLowerCase())) + ' ' : '') + 'rules'; fact(isNum(d.categorized) ? d.categorized + ' line(s) categorized' : null); fact(d.ktc_bills ? d.ktc_bills + ' KTC bill(s) made' : null); fact(d.skipped ? d.skipped + ' skipped' : null); fact(d.problems ? d.problems + ' problem(s)' : null); break;
    case 'company_category_created': s = 'Created the category ' + (d.label || d.key ? '"' + (d.label || d.key) + '"' : '') + (d.company ? ' for ' + cap(words(String(d.company).replace(/_BOOKS$/, '').toLowerCase())) : ''); fact(d.kind ? 'Type: ' + words(d.kind) : null); fact(d.is_payroll ? 'Payroll' : null); break;
    case 'nextrade_category_mapped': s = 'Linked the Nextrade category ' + cat(d.nextrade_category) + ' to the KTC category ' + cat(d.to); fact(d.from !== undefined ? 'KTC category: ' + cat(d.from) + ' → ' + cat(d.to) : null); fact(d.bills_filled ? d.bills_filled + ' KTC bill(s) filled in' : null); break;
    case 'nextrade_bill_cutoff_on': case 'nextrade_bill_cutoff_pressed_on': s = 'Turned ON the Nextrade cut-off — no KTC bills for Nextrade lines before ' + (d.cutoff_date ? niceDate(d.cutoff_date) : 'the cut-off date'); fact(isNum(d.count) ? d.count + ' KTC bill(s) voided' : null); fact(d.kept ? d.kept + ' kept' : null); break;
    case 'nextrade_bill_cutoff_off': s = 'Turned OFF the Nextrade cut-off'; break;
    case 'price_rule_created': s = 'Created a price rule' + (d.vendor_match ? ' for ' + d.vendor_match : '') + (d.item_match ? ' · ' + d.item_match : ''); fact(money(d.expected_unit_price) ? 'Expected price ' + money(d.expected_unit_price) + (d.unit ? ' per ' + String(d.unit).toLowerCase() : '') : null); fact(money(d.expected_amount) ? 'Expected amount ' + money(d.expected_amount) : null); fact(isNum(d.tolerance_pct) ? 'Allowed difference ' + d.tolerance_pct + '%' : null); break;
    case 'price_rule_changed': s = 'Changed a price rule' + (d.after && d.after.vendor_match ? ' for ' + d.after.vendor_match : '') + (d.after && d.after.item_match ? ' · ' + d.after.item_match : ''); changeLines({ before: d.before, after: d.after }).forEach(fact); break;
    case 'price_rule_turned_off': s = 'Turned OFF a price rule'; break;
    case 'price_rule_turned_on': s = 'Turned ON a price rule'; break;
    // ── profitability / P&L ──
    case 'pl_part_estimate_set': {
      var rel = releaseName(r.entity_id); var pn = PARTS[d.part] || (words(d.part || 'cost') + ' cost');
      s = (d.amount === null || d.amount === undefined ? 'Cleared the ' + pn + ' for release ' + rel : 'Set the ' + pn + ' for release ' + rel + ' to ' + money(d.amount));
      if (d.was !== undefined) { fact(cap(pn) + ': ' + (d.was === null ? 'empty' : money(d.was)) + ' → ' + (d.amount === null || d.amount === undefined ? 'empty' : money(d.amount))); }
      reason();
      break;
    }
    case 'pl_name_unit_set': s = 'Set the unit of ' + (Array.isArray(d.names) ? d.names.join(', ') : (r.entity_id || 'a product name')) + ' to ' + (d.unit || 'none'); break;
    case 'pl_name_kind_set': s = 'Set ' + (Array.isArray(d.names) ? d.names.join(', ') : (r.entity_id || 'a product name')) + ' as ' + words(d.kind || 'none'); break;
    case 'pl_group_created': s = 'Created the product group ' + (d.display_name || on || ''); break;
    case 'pl_group_names_added': {
      var nm = [].concat(d.invoice_names || [], d.bill_names || []);
      s = 'Added ' + (nm.length ? nm.join(', ') : 'names') + ' to the product group ' + (refs.group || on || '');
      fact(d.added && d.added.invoice ? d.added.invoice + ' invoice name(s)' : null); fact(d.added && d.added.bill ? d.added.bill + ' bill name(s)' : null);
      break;
    }
    case 'pl_manual_cost_set': {
      var ct = d.to || {}; var cf = d.from || {};
      s = 'Set the cost of ' + (on || (d.level === 'line' ? 'an invoice line' : 'a product group')) + (money(ct.cost_per_lb) ? ' to ' + money(ct.cost_per_lb) + ' per lb' : '');
      changeLines({ from: d.from === null ? null : cf, to: ct }).forEach(fact);
      break;
    }
    case 'pl_invoice_terms_set': s = 'Set the shipping terms used in the profit report for ' + (on || 'an invoice'); changeLines({ from: d.from, to: d.to }).forEach(fact); fact(typeof d.changes === 'string' ? cap(d.changes) : null); break;
    case 'pl_customer_basis_set': s = 'Set the shipping basis of customer ' + (d.customer || on || ''); fact(cap(show(d.from)) + ' → ' + show(d.to)); break;
    case 'pl_line_release_pounds_set': s = 'Set the pounds per release on ' + (on || 'an invoice line'); break;
    case 'pl_warehouse_sync': s = 'Synced the warehouse numbers into the profit report: ' + (d.ok ? 'done' : 'failed'); fact(d.error ? 'Error: ' + d.error : null); break;
    case 'shipping_markup_override':
      s = 'Saved shipping terms on ' + (on || 'an invoice') + ' with shipping charged BELOW our cost + 7%';
      fact(money(d.shipping_charged) ? 'Charged ' + money(d.shipping_charged) + ', minimum ' + money(d.minimum_required) + ' — short by ' + money(d.short_by) : null);
      fact(money(d.shipping_cost) ? 'Our shipping cost ' + money(d.shipping_cost) : null);
      reason();
      break;
    case 'invoice_shipping_terms_set': s = 'Set the shipping terms of ' + (on || 'an invoice'); changeLines({ from: d.from, to: d.to }).forEach(fact); break;
    // ── invoices, customers, company money ──
    case 'invoice_delete': s = 'Deleted ' + (on || ('invoice ' + (d.name || ''))).trim(); fact(d.released_bank_lines ? d.released_bank_lines + ' bank line(s) freed' : null); break;
    case 'invoice_totals_recomputed': s = 'Recalculated the totals of ' + (d.invoice ? 'invoice ' + d.invoice : (on || 'an invoice')); changeLines({ before: d.before, after: d.after }).forEach(fact); fact(d.why ? 'Why: ' + d.why : null); break;
    case 'customer_credit_reconciled': s = 'Reconciled a customer credit' + (money(d.credit_amount) ? ' of ' + money(d.credit_amount) : ''); fact(d.from_status ? 'Status: ' + words(d.from_status) + ' → ' + words(d.to_status) : null); fact(money(d.remaining_credit) ? money(d.remaining_credit) + ' credit left' : null); break;
    case 'party_starting_balance': s = 'Added a starting balance of ' + (money(d.amount) || 'an amount') + ' held with ' + (d.party || 'a company') + (d.as_of ? ' as of ' + niceDate(d.as_of) : ''); reason(); fact(d.visible_to_staff === false ? 'Hidden from staff' : null); break;
    case 'party_starting_balance_correction': s = 'Lowered the starting balance held with ' + (d.party || 'a company') + ' by ' + (money(Math.abs(Number(d.amount))) || 'an amount'); reason(); break;
    case 'party_starting_balance_used': s = 'Paid ' + (Array.isArray(d.bills) ? d.bills.length + ' bill(s)' : 'bills') + ' from the starting balance held with ' + (d.party || 'a company'); fact(money(d.total) ? 'Total ' + money(d.total) : null); fact(d.paid_date ? 'Paid on ' + niceDate(d.paid_date) : null); fact(d.reference ? 'Reference: ' + d.reference : null); reason(); break;
    // ── reminders ──
    case 'arrival_reminder_sent': case 'arrival_reminder_test_sent': s = (r.action === 'arrival_reminder_test_sent' ? 'Sent a TEST arrival reminder' : 'Sent an arrival reminder') + ' for release ' + releaseName(d.release) + (d.to ? ' to ' + (Array.isArray(d.to) ? d.to.join(', ') : d.to) : ''); fact(money(d.remaining) ? 'Balance due ' + money(d.remaining) : null); fact(d.phase ? 'Stage: ' + words(d.phase) : null); fact(d.sent_again_after_a_confirmed_send ? 'Sent again after an earlier confirmed send' : null); break;
    case 'arrival_reminder_send_failed': s = 'An arrival reminder for release ' + releaseName(d.release) + ' was NOT sent'; fact(d.error ? 'Why: ' + d.error : null); break;
    case 'arrival_reminder_delivery_unconfirmed': s = 'An arrival reminder for release ' + releaseName(d.release) + ' may or may not have been delivered (no answer from the mail server)'; fact(d.error ? 'Detail: ' + d.error : null); break;
    // ── people and permissions ──
    case 'permission_changed': {
      var sw = d.switch || (Array.isArray(d.names) ? d.names.join(', ') : 'a permission');
      s = 'Turned ' + (d.to ? 'ON' : 'OFF') + ' "' + words(String(sw).replace(/\./g, ' · ')) + '" for ' + (refs.person || on || 'a person');
      fact(d.target_role ? 'Their role: ' + words(d.target_role) : null);
      break;
    }
    default: {
      s = cap(words(r.action)) + (on ? ' — ' + on : '');
      var cl = changeLines(d); cl.forEach(fact); reason();
      if (!cl.length) { plainFacts(d).forEach(fact); }
    }
  }
  return { sentence: s.replace(/\s+/g, ' ').trim(), facts: facts };
}
