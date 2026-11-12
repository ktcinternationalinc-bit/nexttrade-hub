// v55.83-RG — Wire audit rules (Max, Nov 8 15:32): "a quick audit that they
// were not paid previously and that they all belong to a release number -
// make sure there are no duplicated release numbers or reference numbers. and
// then a manual signoff by 2 people who have verified the wire."
//
// Pure functions (the launch test runs them for real). The server gathers the
// data; this decides. BLOCK = must be fixed before anyone can sign; WARN = the
// signers see it and decide.

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
export function normRef(x) { return String(x == null ? '' : x).toUpperCase().replace(/\s+/g, ' ').trim(); }
// v55.83-RJ (review gap 15) — "RTM" on an older bill = "RTM Capital": the same company when one name is the
// other's leading word(s). Only ever used between a bill's "paid through" and the registered companies.
export function samePayee(a, b) {
  var x = normRef(a); var y = normRef(b);
  if (!x || !y) { return false; }
  if (x === y) { return true; }
  return y.indexOf(x + ' ') === 0 || x.indexOf(y + ' ') === 0;
}
function money(n) { return '$' + r2(n).toFixed(2); }
function day(d) { return d ? String(d).substring(0, 10) : 'no date'; }
// true = same day, false = different days, null = a date is missing (cannot judge)
function sameDay(a, b) { if (!a || !b) { return null; } return String(a).substring(0, 10) === String(b).substring(0, 10); }

// One fingerprint of exactly what was checked and signed: every payment, its
// bill, amount, release and reference. Any change → a different fingerprint →
// earlier checks and sign-offs no longer count.
export function wireFingerprint(wire, lines, opts) {
  var parts = [String((wire && wire.id) || ''), r2(wire && wire.amount).toFixed(2)];
  // v55.83-RH — prepared wires have no payment yet: order by line / bill (RG wires keep ordering by payment, unchanged)
  function sk(l) { return String(l.payment_id || l.bill_id || ''); }
  (lines || []).slice().sort(function (a, b) { return sk(a).localeCompare(sk(b)); }).forEach(function (l) {
    var b = l.bill || {};
    parts.push([l.payment_id, l.bill_id, r2(l.amount).toFixed(2), normRef(b.release_number), normRef(b.bill_number), normRef(b.vendor_name), r2(b.total_amount).toFixed(2), b.record_status || ''].join('|') + (b.other_reference ? '|' + normRef(b.other_reference) : '') + (b.shipment_direction ? '|' + String(b.shipment_direction) : '')
      + ((opts && opts.validation && b.validation_status !== 'validated') ? '|NOT-VALIDATED' : '')); // RL; RO: a validation reopened after signing voids the signatures (prepared wires only): + other reference (only when set — older fingerprints unchanged)
  });
  var s = parts.join('#'); var h = 5381;
  for (var i = 0; i < s.length; i++) { h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; }
  return 'w' + h.toString(16) + '-' + s.length;
}

// input = { wire: {id, amount, date, direction, name},
//           lines: [{ payment_id, bill_id, amount, bill: {...}, other_payments: [{amount, paid_date, bank_transaction_id, label}] }],
//           sameRelease: { RELEASE: [{bill_id, vendor_name, bill_number}] }   (ALL active bills carrying that release)
//           sameNumber:  { BILLNUMBER: [{bill_id, vendor_name}] }             (ALL active bills carrying that number)
//           knownReleases: ['1003-021', ...]                                   (releases found in orders / invoices) }
export function auditWire(input) {
  var wire = (input && input.wire) || {};
  var lines = (input && input.lines) || [];
  var sameRel = (input && input.sameRelease) || {};
  var sameNum = (input && input.sameNumber) || {};
  var sameOther = (input && input.sameOther) || {}; var oSeen = {};
  var known = {}; ((input && input.knownReleases) || []).forEach(function (k) { known[normRef(k)] = true; });
  var checks = [];
  var curBill = null; // v55.83-RL — every check knows its bill (so an override is for THAT check on THAT bill)
  function add(level, code, text) { checks.push({ level: level, code: code, text: text, bill_id: curBill }); }

  if (wire.direction && wire.direction !== 'out') { add('block', 'NOT_OUT', 'This bank line is money IN — a wire to a vendor is money out.'); }
  if (!lines.length) { add('block', 'NO_BILLS', 'No bills are linked to this wire yet — link the bills it paid first.'); }

  var placed = 0; var relSeen = {}; var numSeen = {};
  lines.forEach(function (l) {
    curBill = l.bill_id || null;
    var b = l.bill || {}; var who = (b.vendor_name || '?') + (b.bill_number ? ' #' + b.bill_number : '');
    placed = r2(placed + (Number(l.amount) || 0));
    // ── state of the bill
    if (b.record_status && b.record_status !== 'active') { add('block', 'BILL_VOID', who + ' is VOID — a void bill cannot be paid.'); }
    if (b.disputed === true) { add('block', 'BILL_DISPUTED', who + ' is DISPUTED — resolve the dispute before paying it.'); }
    // v55.83-RO (Max, Nov 9 20:49: "validation needs to take place first before wiring ... you cannot pay a wire unless it has
    // been validated") — on a prepared wire an unvalidated bill BLOCKS and cannot be overridden; the after-the-fact bank view warns
    if (b.validation_status !== 'validated' && (b.validation_status || (input && input.directionRules === true))) {
      if (input && input.directionRules === true) { add('block', 'BILL_NOT_VALIDATED', who + ' is NOT VALIDATED — validate it first (3 checks + how you verified it); a wire cannot pay an unvalidated bill.'); }
      else { add('warn', 'BILL_NOT_VALIDATED', who + ' has not been validated by a person yet (' + b.validation_status + ').'); }
    }
    // ── not paid previously
    var other = (l.other_payments || []); var otherSum = 0;
    other.forEach(function (o) { otherSum = r2(otherSum + (Number(o.amount) || 0)); });
    var total = r2(b.total_amount);
    if (other.length) {
      var desc = other.map(function (o) { return money(o.amount) + ' on ' + (o.paid_date || '?') + (o.label ? ' (' + o.label + ')' : ''); }).join(', ');
      if (r2(otherSum) >= total - 0.005) { add('block', 'PAID_BEFORE', who + ' was ALREADY PAID IN FULL before: ' + desc + '.'); }
      else { add('warn', 'PART_PAID_BEFORE', who + ' was partly paid before: ' + desc + ' — this wire pays ' + money(l.amount) + ' of ' + money(total) + '.'); }
    }
    if (r2(otherSum + (Number(l.amount) || 0)) > total + 0.005) { add('block', 'OVERPAID', who + ' would be OVERPAID: ' + money(otherSum + (Number(l.amount) || 0)) + ' paid against a ' + money(total) + ' bill.'); }
    // ── belongs to a release number
    var rel = normRef(b.release_number);
    // v55.83-RJ (review gap 5) — NextTrade bills (payroll, rent, utilities) have no release: a WARNING there, a block everywhere else
    // v55.83-RL (Max, Nov 9 12:20: "check box if outbound or inbound -- if inbound release number not necessary but a
    // reference number is necessary. if outbound then release number is necessary and reference number is not. Billing
    // is always necessary and date is always necessary")
    var dirRules = !!(input && input.directionRules === true);
    var dir = String(b.shipment_direction || '').toLowerCase();
    if (dirRules) {
      if (!normRef(b.bill_number)) { add('block', 'BILL_NUMBER_MISSING', (b.vendor_name || '?') + ' bill has NO bill # — the bill # is always required.'); }
      if (!b.bill_date) { add('block', 'BILL_DATE_MISSING', who + ' has NO bill date — the date is always required.'); }
      if (!dir) {
        if (input.releaseOptional === true) { /* NextTrade overhead (payroll, rent, utilities) is neither */ }
        else { add('block', 'DIRECTION_MISSING', who + ': tick INBOUND or OUTBOUND (outbound needs the release #, inbound needs the reference).'); }
      } else if (dir === 'inbound' && !normRef(b.other_reference)) {
        add('block', 'REFERENCE_MISSING', who + ' is INBOUND and has no reference (BOL / PO / container…) — an inbound bill needs it.');
      }
    }
    if (!rel) {
      if (input && input.releaseOptional === true) { add('warn', 'RELEASE_MISSING', who + ' has no release number (fine for warehouse / overhead bills — the signers confirm).'); }
      else if (dirRules && dir === 'inbound') { /* inbound: the release # is not needed */ }
      else if (dirRules && !dir) { /* asked above: inbound or outbound first */ }
      else { add('block', 'RELEASE_MISSING', who + ' has NO release number' + (dir === 'outbound' ? ' — an OUTBOUND bill needs its release #.' : ' — every bill on a wire must belong to a release.')); }
    }
    else {
      if (input && input.knownReleases && !known[rel]) { add('warn', 'RELEASE_UNKNOWN', who + ': release ' + rel + ' is not found in the orders or invoices.'); }
      // v55.83-RK (Max, Nov 9 11:38: "actually is for a unique release number and date and or a unique reference and
      // date") — a DUPLICATE is the same vendor + the same release + the SAME bill date. The same release on another
      // date is a separate charge (shown for information). A missing date cannot be judged → the signers check it.
      var vkey = normRef(b.vendor_name) + '|' + rel;
      var seen0 = relSeen[vkey];
      if (seen0) {
        var sd0 = sameDay(seen0.date, b.bill_date);
        if (sd0 === true) { add('block', 'DUP_RELEASE_IN_WIRE', who + ' and ' + seen0.who + ' are the SAME vendor, SAME release ' + rel + ' and SAME date ' + day(b.bill_date) + ' on this wire — a duplicate.'); }
        else if (sd0 === null) { add('warn', 'DUP_RELEASE_IN_WIRE', who + ' and ' + seen0.who + ' are the same vendor on release ' + rel + ' and one has no bill date — check they are not the same charge.'); }
        else { add('info', 'SAME_RELEASE_OTHER_DATE', who + ' and ' + seen0.who + ' are the same vendor on release ' + rel + ' on different dates (' + day(seen0.date) + ', ' + day(b.bill_date) + ') — separate charges.'); }
      }
      relSeen[vkey] = { who: who, date: b.bill_date };
      (sameRel[rel] || []).forEach(function (o) {
        if (o.bill_id === l.bill_id) { return; }
        if (normRef(o.vendor_name) === normRef(b.vendor_name) && !lines.some(function (x) { return x.bill_id === o.bill_id; })) {
          var oWho = (o.vendor_name || '?') + (o.bill_number ? ' #' + o.bill_number : '');
          var paidTxt = o.paid_total > 0.005 ? ' — it was ALREADY PAID ($' + r2(o.paid_total).toFixed(2) + ')' : '';
          var sd1 = sameDay(o.bill_date, b.bill_date);
          if (sd1 === true || (sd1 === null && o.bill_date === undefined)) { add('block', 'DUP_RELEASE', who + ': ' + oWho + ' is the same vendor, same release ' + rel + ' and same date ' + day(b.bill_date) + paidTxt + ' — a duplicate charge.'); }
          else if (sd1 === null) { add('warn', 'DUP_RELEASE', who + ': ' + oWho + ' is the same vendor on release ' + rel + ' but one bill has no date' + paidTxt + ' — check it is not the same charge.'); }
          else { add('info', 'SAME_RELEASE_OTHER_DATE', who + ': ' + oWho + ' is the same vendor on release ' + rel + ' dated ' + day(o.bill_date) + paidTxt + ' — a different date, treated as a separate charge.'); }
        }
      });
    }
    // ── duplicated reference: the same reference + the SAME date (v55.83-RK)
    var num = normRef(b.bill_number);
    if (!num) { if (!dirRules) { add('warn', 'REF_MISSING', (b.vendor_name || '?') + ' bill has no reference / bill number.'); } }
    else {
      var seenN = numSeen[num];
      if (seenN) {
        var sd2 = sameDay(seenN.date, b.bill_date);
        if (sd2 !== false) { add(seenN.vendor === normRef(b.vendor_name) ? 'block' : 'warn', 'DUP_REF_IN_WIRE', 'Reference ' + num + (sd2 === true ? ' and date ' + day(b.bill_date) : '') + ' appear on TWO bills of this wire (' + seenN.who + ' and ' + who + ')' + (sd2 === null ? ' — one has no date' : '') + '.'); }
        else { add('info', 'SAME_REF_OTHER_DATE', 'Reference ' + num + ' is on two bills of this wire with different dates (' + day(seenN.date) + ', ' + day(b.bill_date) + ').'); }
      }
      numSeen[num] = { who: who, date: b.bill_date, vendor: normRef(b.vendor_name) };
      (sameNum[num] || []).forEach(function (o) {
        if (o.bill_id === l.bill_id || lines.some(function (x) { return x.bill_id === o.bill_id; })) { return; }
        var sameV = normRef(o.vendor_name) === normRef(b.vendor_name);
        var sd3 = sameDay(o.bill_date, b.bill_date);
        var paidTxt2 = o.paid_total > 0.005 ? ' — it was ALREADY PAID ($' + r2(o.paid_total).toFixed(2) + ')' : '';
        if (sd3 === true || (sd3 === null && o.bill_date === undefined)) {
          add(sameV ? 'block' : 'warn', 'DUP_REF', who + ': reference ' + num + ' and date ' + day(b.bill_date) + ' are ALSO on ' + (o.vendor_name || '?') + "'s bill" + paidTxt2 + (sameV ? ' — the same vendor: a duplicate bill.' : ' (a different vendor — check it is not the same document).'));
        } else if (sd3 === null) {
          add('warn', 'DUP_REF', who + ': reference ' + num + ' is also on ' + (o.vendor_name || '?') + "'s bill and one of them has no date" + paidTxt2 + ' — check.');
        } else if (sameV) {
          add('info', 'SAME_REF_OTHER_DATE', who + ': reference ' + num + ' was also used by ' + (o.vendor_name || '?') + ' on ' + day(o.bill_date) + paidTxt2 + ' — a different date.');
        }
      });
    }
    // ── v55.83-RL (Max 12:18 "a reference column ... besides the bill # and release #") — the other reference
    // (BOL, PO, container…) follows the same rule: same vendor + same other reference + SAME date = a duplicate
    var oref = normRef(b.other_reference);
    if (oref) {
      var okey = normRef(b.vendor_name) + '|' + oref;
      var seenO = oSeen[okey];
      if (seenO) {
        var sdO = sameDay(seenO.date, b.bill_date);
        if (sdO === true) { add('block', 'DUP_OTHER_REF_IN_WIRE', who + ' and ' + seenO.who + ' have the same vendor, same reference ' + oref + ' and same date ' + day(b.bill_date) + ' on this wire — a duplicate.'); }
        else if (sdO === null) { add('warn', 'DUP_OTHER_REF_IN_WIRE', who + ' and ' + seenO.who + ' share reference ' + oref + ' and one has no date — check.'); }
      }
      oSeen[okey] = { who: who, date: b.bill_date };
      (sameOther[oref] || []).forEach(function (o) {
        if (o.bill_id === l.bill_id || lines.some(function (x) { return x.bill_id === o.bill_id; })) { return; }
        if (normRef(o.vendor_name) !== normRef(b.vendor_name)) { return; }
        var sdP = sameDay(o.bill_date, b.bill_date);
        var pt = o.paid_total > 0.005 ? ' — it was ALREADY PAID ($' + r2(o.paid_total).toFixed(2) + ')' : '';
        if (sdP === true) { add('block', 'DUP_OTHER_REF', who + ': ' + (o.vendor_name || '?') + (o.bill_number ? ' #' + o.bill_number : '') + ' has the same reference ' + oref + ' and the same date' + pt + ' — a duplicate charge.'); }
        else if (sdP === null) { add('warn', 'DUP_OTHER_REF', who + ': another bill of ' + (o.vendor_name || '?') + ' has reference ' + oref + ' and one has no date' + pt + ' — check.'); }
      });
    }
  });
  curBill = null;
  // ── the wire is fully explained by its bills
  var amt = r2(wire.amount);
  if (lines.length && Math.abs(placed - amt) > 0.009) {
    add('warn', 'NOT_FULLY_PLACED', 'Bills explain ' + money(placed) + ' of this ' + money(amt) + ' wire — ' + money(Math.abs(amt - placed)) + (placed < amt ? ' is not linked to any bill.' : ' MORE than the wire (check the links).'));
  }
  var blocks = checks.filter(function (c) { return c.level === 'block'; }).length;
  var warns = checks.filter(function (c) { return c.level === 'warn'; }).length;
  if (!blocks && !warns) { checks.push({ level: 'ok', code: 'ALL_CLEAR', text: 'Every bill belongs to a release, none was paid before, no duplicated release or reference numbers, and the bills explain the whole wire.' }); }
  return { checks: checks, pass: blocks === 0, blocks: blocks, warns: warns, placed: placed };
}

// Where a wire stands, from its saved audit row and the CURRENT fingerprint.
export function wireStatus(row, liveHash) {
  if (!row || !row.checked_at || row.check_hash !== liveHash) { return 'needs_check'; }
  if (row.check_pass !== true) { return 'flagged'; }
  var s1 = !!(row.signoff1_by && row.signoff1_hash === liveHash);
  var s2 = !!(row.signoff2_by && row.signoff2_hash === liveHash && s1);
  if (s1 && s2) { return 'approved'; }
  if (s1) { return 'awaiting_2nd'; }
  return 'awaiting_1st';
}
export var WIRE_STATUS_LABEL = {
  needs_check: '🤖 needs audit', flagged: '⛔ flagged — fix first', awaiting_1st: '✍ awaiting 1st sign-off',
  awaiting_2nd: '✍ awaiting 2nd sign-off', approved: '✅ verified by 2 people',
};

// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RH — the wire is APPROVED BEFORE it is sent (Max, Nov 8 16:04–16:14):
// "the wire should be set up before a wire is actually sent ...then later when
// the wire is sent than we attach that whole audit to that wire with the
// attached bills" · "most of the wires would be going out of RTM..but
// preparation should be before we send the payment to RTM" · "rtm fee is
// optional" · "nextrade -- can be only with bills".
// A PACKAGE = pay to RTM Capital (service provider) / NextTrade Industries
// (affiliate, bills only) / a vendor directly; bills of any number of vendors.
// ═══════════════════════════════════════════════════════════════════════════
export function packageLabel(pkg) { return 'WP-' + String((pkg && pkg.seq) || 0).padStart(4, '0'); }
export function packageTotals(pkg, lines) {
  var bills = 0; (lines || []).forEach(function (l) { bills = r2(bills + (Number(l.amount) || 0)); });
  var fee = r2(pkg && pkg.fee_amount);
  return { bills: bills, fee: fee, total: r2(bills + fee) };
}
export function packageFingerprint(pkg, lines) {
  var p = pkg || {};
  return wireFingerprint({ id: String(p.id || '') + '|' + (p.payee_kind || '') + '|' + normRef(p.payee_name), amount: packageTotals(p, lines).total }, lines, { validation: true });
}
// input = auditWire's input + { pkg: {id, seq, payee_kind, payee_name, fee_amount}, otherOpen: { bill_id: 'WP-0003' } }
export function auditPackage(input) {
  var pkg = (input && input.pkg) || {};
  var lines = (input && input.lines) || [];
  var tot = packageTotals(pkg, lines);
  var base = auditWire(Object.assign({}, input, { wire: { id: pkg.id, amount: tot.bills, direction: 'out' }, releaseOptional: pkg.payee_kind === 'affiliate', directionRules: true }));
  var checks = base.checks.filter(function (c) { return c.code !== 'ALL_CLEAR'; });
  var curBill = null;
  function add(level, code, text) { checks.push({ level: level, code: code, text: text, bill_id: curBill }); }
  var payee = normRef(pkg.payee_name); var kind = pkg.payee_kind;
  if (!payee) { add('block', 'NO_PAYEE', 'Who is this wire going to? Pick RTM Capital, NextTrade Industries or the vendor.'); }
  var other = (input && input.otherOpen) || {};
  lines.forEach(function (l) {
    curBill = l.bill_id || null;
    var b = l.bill || {}; var who = (b.vendor_name || '?') + (b.bill_number ? ' #' + b.bill_number : '');
    if (kind === 'vendor') {
      if (b.paid_via) { add('block', 'PAYEE_MISMATCH', who + ' is paid THROUGH ' + b.paid_via + ' — it belongs on a wire to ' + b.paid_via + ', not straight to the vendor.'); }
      else if (normRef(b.vendor_name) !== payee) { add('block', 'PAYEE_MISMATCH', who + ' is a bill of ' + (b.vendor_name || '?') + ' — this wire goes to ' + pkg.payee_name + '.'); }
    } else if (kind === 'service_provider' || kind === 'affiliate') {
      // a bill ticked for this wire with no "paid through" yet is marked when the wire is SENT (review gap 8)
      if (!samePayee(b.paid_via, pkg.payee_name) && !(l.will_mark === true && !b.paid_via)) { add('block', 'PAYEE_MISMATCH', who + (b.paid_via ? ' is paid through ' + b.paid_via : ' is not marked "paid through ' + pkg.payee_name + '"') + ' — set that on the bill, or pay it on the right wire.'); }
    }
    if (other[l.bill_id]) { add('block', 'IN_OTHER_PACKAGE', who + ' is already on wire ' + other[l.bill_id] + ' — one bill, one wire.'); }
  });
  curBill = null;
  if (tot.fee > 0.005) {
    if (kind === 'vendor') { add('block', 'FEE_NOT_ALLOWED', 'A wire straight to a vendor is bills only — remove the fee.'); } // v55.83-SC — RTM and NextTrade may both carry a service fee
    else { add('info', 'FEE', pkg.payee_name + ' fee ' + money(tot.fee) + ' on top of the bills (' + money(tot.bills) + ') — not backed by a bill.'); }
  }
  var blocks = checks.filter(function (c) { return c.level === 'block'; }).length;
  var warns = checks.filter(function (c) { return c.level === 'warn'; }).length;
  if (!blocks && !warns) { checks.push({ level: 'ok', code: 'ALL_CLEAR', text: 'Every bill belongs to a release, none was paid before, no duplicated release or reference numbers, every bill belongs on this wire' + (tot.fee > 0.005 ? ' (plus the fee shown)' : '') + '.' }); }
  return { checks: checks, pass: blocks === 0, blocks: blocks, warns: warns, bills: tot.bills, fee: tot.fee, total: tot.total };
}
// draft → needs audit / flagged / awaiting 1st / awaiting 2nd / READY TO SEND → sent → attached (→ complete once proofs are in)
export function packageStatus(pkg, liveHash, rtmPending) {
  var p = pkg || {};
  if (p.status === 'cancelled') { return 'cancelled'; }
  if (p.status === 'reversed') { return 'reversed'; }
  if (p.status === 'attached') { return rtmPending > 0 ? 'awaiting_proof' : 'complete'; }
  if (p.status === 'sent') { return 'sent'; }
  var s = wireStatus(p, liveHash);
  return s === 'approved' ? 'ready_to_send' : s;
}
export var PKG_STATUS_LABEL = {
  needs_check: '🤖 needs audit', flagged: '⛔ flagged — fix first', awaiting_1st: '✍ awaiting 1st sign-off', awaiting_2nd: '✍ awaiting 2nd sign-off',
  ready_to_send: '✅ approved — ready to send', sent: '📤 sent — waiting for the bank line', awaiting_proof: '📎 in the bank — waiting for RTM proof',
  complete: '🏁 complete', cancelled: '✕ cancelled', reversed: '↩ reversed (undone)',
};

// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RL — OVERRIDES (Max, Nov 9 12:17: "should be override button. with
// reason and audit of who approved it."). Only checks a person can judge are
// overridable; the ones the books themselves would refuse are not (a void bill,
// paying more than is owed, a bill already paid in full, a bill on another
// wire, a bill that belongs to another company, a fee on a NextTrade wire).
// An override is for ONE check on ONE bill of THIS exact wire (fingerprint):
// change the wire and it no longer counts.
// ═══════════════════════════════════════════════════════════════════════════
export var OVERRIDABLE = { BILL_NUMBER_MISSING: 1, BILL_DATE_MISSING: 1, DIRECTION_MISSING: 1, REFERENCE_MISSING: 1, RELEASE_MISSING: 1, RELEASE_UNKNOWN: 1, DUP_RELEASE: 1, DUP_RELEASE_IN_WIRE: 1, DUP_REF: 1, DUP_REF_IN_WIRE: 1, DUP_OTHER_REF: 1, DUP_OTHER_REF_IN_WIRE: 1, BILL_DISPUTED: 1 };
export var NOT_OVERRIDABLE_WHY = {
  BILL_VOID: 'a void bill cannot be paid', BILL_NOT_VALIDATED: 'a bill must be validated before it can be wired', OVERPAID: 'the books would be paid more than the bill', PAID_BEFORE: 'the bill is already paid in full',
  IN_OTHER_PACKAGE: 'the bill is on another wire', PAYEE_MISMATCH: 'the bill belongs to another company / vendor', FEE_NOT_ALLOWED: 'only RTM wires carry a fee',
  NO_BILLS: 'a wire needs bills', NO_PAYEE: 'pick who the wire goes to', NOT_OUT: 'not money out',
};
export function checkKey(c) { return String(c.code) + '|' + String(c.bill_id || '') + '|' + String(c.text || ''); }
// result = auditWire / auditPackage output; overrides = rows {check_key, fingerprint, reason, overridden_by, overridden_at}
export function applyOverrides(result, overrides, liveHash, nameOf) {
  var byKey = {};
  (overrides || []).forEach(function (o) { if (o.fingerprint === liveHash) { byKey[o.check_key] = o; } });
  var used = 0;
  var checks = (result.checks || []).map(function (c) {
    if (c.level !== 'block' || !OVERRIDABLE[c.code]) { return c; }
    var o = byKey[checkKey(c)];
    if (!o) { return c; }
    used += 1;
    return Object.assign({}, c, { level: 'overridden', override: { reason: o.reason, by: o.overridden_by, by_name: nameOf ? nameOf(o.overridden_by) : null, at: o.overridden_at } });
  });
  var blocks = checks.filter(function (c) { return c.level === 'block'; }).length;
  var warns = checks.filter(function (c) { return c.level === 'warn'; }).length;
  return Object.assign({}, result, { checks: checks, pass: blocks === 0, blocks: blocks, warns: warns, overridden: used });
}
