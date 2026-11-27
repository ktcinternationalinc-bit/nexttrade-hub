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

// v55.83-XX (Max, 23 Nov 2026: "Nextrade bills ... no need to validate these bills / will be available for only Nextrade payments wires")
// A Nextrade bill (an ACTIVE company_bill_links row for NextTrade, looked up on the SERVER only by src/lib/nextrade-bill-links-server.js,
// which sets bill.nextrade_bill = true) needs no validation step on a wire to NextTrade Industries (payee kind 'affiliate'). Everywhere
// else, and for every other bill, validation is unchanged. A failed lookup marks nothing, so the bill is NOT exempt (fail closed).
export var NEXTRADE_BILL_NOTE = 'Nextrade bill - no validation needed';
export function validationExempt(b) { return !!b && b.nextrade_bill === true; }
// may this bill go on a wire now? validated, or a Nextrade bill (the server marks it only on a wire to NextTrade)
export function wireReady(b) { return !!b && (b.validation_status === 'validated' || validationExempt(b)); }

// One fingerprint of exactly what was checked and signed: every payment, its
// bill, amount, release and reference. Any change → a different fingerprint →
// earlier checks and sign-offs no longer count.
// v55.83-TH — every bill column wireFingerprint reads. Any query whose rows feed a fingerprint must select at least these.
export var WIRE_FINGERPRINT_BILL_FIELDS = 'id, vendor_name, bill_number, release_number, total_amount, record_status, other_reference, shipment_direction, validation_status';
export function wireFingerprint(wire, lines, opts) {
  var parts = [String((wire && wire.id) || ''), r2(wire && wire.amount).toFixed(2)];
  // v55.83-RH — prepared wires have no payment yet: order by line / bill (RG wires keep ordering by payment, unchanged)
  function sk(l) { return String(l.payment_id || l.bill_id || ''); }
  (lines || []).slice().sort(function (a, b) { return sk(a).localeCompare(sk(b)); }).forEach(function (l) {
    var b = l.bill || {};
    parts.push([l.payment_id, l.bill_id, r2(l.amount).toFixed(2), normRef(b.release_number), normRef(b.bill_number), normRef(b.vendor_name), r2(b.total_amount).toFixed(2), b.record_status || ''].join('|') + (b.other_reference ? '|' + normRef(b.other_reference) : '') + (b.shipment_direction ? '|' + String(b.shipment_direction) : '')
      + ((opts && opts.validation && b.validation_status !== 'validated') ? (opts.companyBills === true && validationExempt(b) ? '|COMPANY-BILL' : '|NOT-VALIDATED') : '')); // XX: a Nextrade bill on a NextTrade wire signs as |COMPANY-BILL, so losing its link changes the fingerprint; RL; RO: a validation reopened after signing voids the signatures (prepared wires only): + other reference (only when set — older fingerprints unchanged)
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
// v55.83-WZ — the one identity of a payable bill: company + vendor written any way + number with dashes / spaces ignored. A copy of
// billIdentity() in src/lib/bill-duplicates.js (this file stays import-free); __tests__/test-v55-83-wz-no-duplicate-bills.js checks they agree.
var WZ_DROP = ['INCORPORATED', 'CORPORATION', 'COMPANY', 'LIMITED', 'INC', 'LLC', 'LTD', 'CORP', 'CO', 'LLP', 'LP', 'THE'];
export function billIdentity(b) {
  if (!b || (b.record_status && b.record_status !== 'active') || /^credit/i.test(String(b.bill_type || ''))) { return null; }
  var n = String(b.bill_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var v = String(b.vendor_name || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ');
  v = ' ' + v.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '') + ' ';
  WZ_DROP.forEach(function (w) { v = v.split(' ' + w + ' ').join(' '); });
  v = v.replace(/\s+/g, '');
  if (!v || !n) { return null; }
  return String(b.wave_business_id || '') + '#' + v + '|' + n;
}
// v55.83-WZ (Codex 10:37 P2) — two documents can only be the SAME bill when both are payable bills (not a credit memo / credit note)
// of the SAME company. Applied to every number / reference duplicate check, old and new, so a legitimate credit memo or another
// company's document is never called a duplicate (nobody is told to void it). Unknown company on an old candidate = not proven different.
export function sameDocKind(x, y) {
  var cx = /^credit/i.test(String((x && x.bill_type) || '')); var cy = /^credit/i.test(String((y && y.bill_type) || ''));
  if (cx || cy) { return false; }
  var bx = x && x.wave_business_id; var by = y && y.wave_business_id;
  return !(bx && by && String(bx) !== String(by));
}
export function auditWire(input) {
  var wire = (input && input.wire) || {};
  var lines = (input && input.lines) || [];
  var sameRel = (input && input.sameRelease) || {};
  var sameNum = (input && input.sameNumber) || {};
  var sameId = (input && input.sameIdentity) || {}; var idSeen = {}; // v55.83-WZ — { identity: [{ bill_id, vendor_name, bill_number, bill_date, total_amount, paid_total }] }
  var sameOther = (input && input.sameOther) || {}; var oSeen = {};
  var known = {}; ((input && input.knownReleases) || []).forEach(function (k) { known[normRef(k)] = true; });
  var checks = [];
  var curBill = null; // v55.83-RL — every check knows its bill (so an override is for THAT check on THAT bill)
  function add(level, code, text, extra) { checks.push(Object.assign({ level: level, code: code, text: text, bill_id: curBill }, extra || {})); }
  // v55.83-UP (Max, Nov 18: "why is this error message repeating several times") — each extra copy is reported ONCE per bill (not once by
  // bill number and again by reference), and the line says WHICH copy: when it was entered, its amount, whether it was paid
  var dupSeen = {};
  function copyWords(o) { return (o.bill_number ? '#' + o.bill_number + ' ' : '') + 'dated ' + day(o.bill_date) + (o.created_at ? ', entered in the Hub ' + day(o.created_at) : '') + (o.total_amount != null ? ', ' + money(o.total_amount) : '') + (o.paid_total > 0.005 ? ', ALREADY PAID ' + money(o.paid_total) : ', not paid'); }

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
    if (input && input.directionRules === true && input.companyBills === true && validationExempt(b) && b.validation_status !== 'validated') {
      add('info', 'NEXTRADE_BILL', who + ': ' + NEXTRADE_BILL_NOTE + ' (a Nextrade bill, paid only through NextTrade).'); // v55.83-XX
    } else if (b.validation_status !== 'validated' && (b.validation_status || (input && input.directionRules === true))) {
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
        else { add('block', 'DIRECTION_MISSING', who + ': tick INBOUND, OUTBOUND or OPERATIONAL (outbound needs the release #, inbound needs the reference, operational needs neither).'); }
      } else if (dir === 'inbound' && !normRef(b.other_reference)) {
        add('block', 'REFERENCE_MISSING', who + ' is INBOUND and has no reference (BOL / PO / container…) — an inbound bill needs it.');
      }
    }
    if (!rel) {
      if (input && input.releaseOptional === true) { add('warn', 'RELEASE_MISSING', who + ' has no release number (fine for warehouse / overhead bills — the signers confirm).'); }
      else if (dirRules && dir === 'inbound') { /* inbound: the release # is not needed */ }
      else if (dir === 'operational') { /* v55.83-ZY — Operational: not for a shipment, no release # and no reference needed */ }
      else if (dirRules && !dir) { /* asked above: inbound or outbound first */ }
      else { add('block', 'RELEASE_MISSING', who + ' has NO release number' + (dir === 'outbound' ? ' — an OUTBOUND bill needs its release #.' : ' — every bill on a wire must belong to a release.')); }
    }
    else {
      if (dir === 'operational') { add('warn', 'OPERATIONAL_HAS_RELEASE', who + ' is marked OPERATIONAL (not for a shipment) but carries release ' + rel + ' — check which it is.'); } // v55.83-ZY
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
          // v55.83-UP (Codex 22:51) — the same copy matching by release AND by number + date is ONE line (the DUP_REF one below, which names the release)
          var numB = normRef(b.bill_number);
          var alsoNum = sd1 === true && !!numB && (sameNum[numB] || []).some(function (x) { return x.bill_id === o.bill_id && normRef(x.vendor_name) === normRef(b.vendor_name) && sameDay(x.bill_date, b.bill_date) === true; });
          if (alsoNum) { return; }
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
      if (seenN && !sameDocKind(seenN.bill, b)) {
        add('info', 'SAME_REF_OTHER_KIND', 'Reference ' + num + ' is on ' + seenN.who + ' and ' + who + ' on this wire, but one is a credit or belongs to another company — not a duplicate.');
      } else if (seenN) {
        var sd2 = sameDay(seenN.date, b.bill_date);
        if (sd2 !== false) { add(seenN.vendor === normRef(b.vendor_name) ? 'block' : 'warn', 'DUP_REF_IN_WIRE', 'Reference ' + num + (sd2 === true ? ' and date ' + day(b.bill_date) : '') + ' appear on TWO bills of this wire (' + seenN.who + ' and ' + who + ')' + (sd2 === null ? ' — one has no date' : '') + '.'); }
        else { add('info', 'SAME_REF_OTHER_DATE', 'Reference ' + num + ' is on two bills of this wire with different dates (' + day(seenN.date) + ', ' + day(b.bill_date) + ').'); }
      }
      numSeen[num] = { who: who, date: b.bill_date, vendor: normRef(b.vendor_name), bill: b };
      (sameNum[num] || []).forEach(function (o) {
        if (o.bill_id === l.bill_id || lines.some(function (x) { return x.bill_id === o.bill_id; })) { return; }
        if (!sameDocKind(o, b)) { return; } // a credit memo or another company's document is not a copy of this bill
        var sameV = normRef(o.vendor_name) === normRef(b.vendor_name);
        var sd3 = sameDay(o.bill_date, b.bill_date);
        var paidTxt2 = o.paid_total > 0.005 ? ' — it was ALREADY PAID ($' + r2(o.paid_total).toFixed(2) + ')' : '';
        if (sd3 === true || (sd3 === null && o.bill_date === undefined)) {
          if (sameV) { dupSeen[String(l.bill_id) + '|' + String(o.bill_id)] = true; }
          var relB = normRef(b.release_number); var relToo = sameV && !!relB && (sameRel[relB] || []).some(function (x) { return x.bill_id === o.bill_id; });
          add(sameV ? 'block' : 'warn', 'DUP_REF', sameV ? (who + ': another copy of this bill is in the Hub — ' + (o.vendor_name || '?') + ' ' + copyWords(o) + '. Same vendor, number ' + num + (relToo ? ', release ' + relB : '') + ' and date: a duplicate bill. Void the extra copy in 💸 Bills (it is flagged there).') : (who + ': reference ' + num + ' and date ' + day(b.bill_date) + ' are ALSO on ' + (o.vendor_name || '?') + "'s bill" + paidTxt2 + ' (a different vendor — check it is not the same document).'), { other_bill_id: o.bill_id });
        } else if (sd3 === null) {
          add('warn', 'DUP_REF', who + ': reference ' + num + ' is also on ' + (o.vendor_name || '?') + "'s bill and one of them has no date" + paidTxt2 + ' — check.');
        } else if (sameV) {
          add('info', 'SAME_REF_OTHER_DATE', who + ': reference ' + num + ' was also used by ' + (o.vendor_name || '?') + ' on ' + day(o.bill_date) + paidTxt2 + ' — a different date.');
        }
      });
    }
    // ── v55.83-WZ (Max 21 Nov: "i don't want any duplicate bills"; Codex 10:22 P1) — the SAME bill by the one WZ identity (company +
    // vendor written any way + number with dashes / spaces ignored), WHATEVER its date or amount: on this wire twice, or another
    // active copy in the Hub. Always a block, never overridable (wire-audit OVERRIDABLE). A credit document and another vendor or
    // company are not the same bill. Nothing already reported for the same pair above is said twice.
    var idk = billIdentity(b);
    if (idk) {
      var idPrev = idSeen[idk];
      if (idPrev && !checks.some(function (c) { return c.code === 'DUP_REF_IN_WIRE' && c.level === 'block' && c.bill_id === l.bill_id; })) {
        add('block', 'DUP_REF_IN_WIRE', who + ' and ' + idPrev.who + ' are the SAME bill (same vendor and bill number' + (sameDay(idPrev.date, b.bill_date) === false ? ', even with different dates' : '') + ') — it is on this wire twice. Remove one.');
      }
      if (!idPrev) { idSeen[idk] = { who: who, date: b.bill_date }; }
      (sameId[idk] || []).forEach(function (o) {
        if (o.bill_id === l.bill_id || lines.some(function (x) { return x.bill_id === o.bill_id; })) { return; }
        if (dupSeen[String(l.bill_id) + '|' + String(o.bill_id)]) { return; }
        dupSeen[String(l.bill_id) + '|' + String(o.bill_id)] = true;
        var paidId = o.paid_total > 0.005 ? ' — it was ALREADY PAID ($' + r2(o.paid_total).toFixed(2) + ')' : '';
        add('block', 'DUP_REF', who + ': another copy of this bill is in the Hub — ' + (o.vendor_name || '?') + ' ' + copyWords(o) + paidId + '. Same vendor and bill number' + (sameDay(o.bill_date, b.bill_date) === false ? ' (a different date)' : '') + ': a duplicate. Void the extra copy in 💸 Bills → Duplicates to resolve.', { other_bill_id: o.bill_id });
      });
    }
    // ── v55.83-RL (Max 12:18 "a reference column ... besides the bill # and release #") — the other reference
    // (BOL, PO, container…) follows the same rule: same vendor + same other reference + SAME date = a duplicate
    var oref = normRef(b.other_reference);
    if (oref) {
      var okey = normRef(b.vendor_name) + '|' + oref;
      var seenO = oSeen[okey];
      if (seenO && sameDocKind(seenO.bill, b)) {
        var sdO = sameDay(seenO.date, b.bill_date);
        if (sdO === true) { add('block', 'DUP_OTHER_REF_IN_WIRE', who + ' and ' + seenO.who + ' have the same vendor, same reference ' + oref + ' and same date ' + day(b.bill_date) + ' on this wire — a duplicate.'); }
        else if (sdO === null) { add('warn', 'DUP_OTHER_REF_IN_WIRE', who + ' and ' + seenO.who + ' share reference ' + oref + ' and one has no date — check.'); }
      }
      oSeen[okey] = { who: who, date: b.bill_date, bill: b };
      (sameOther[oref] || []).forEach(function (o) {
        if (o.bill_id === l.bill_id || lines.some(function (x) { return x.bill_id === o.bill_id; })) { return; }
        if (!sameDocKind(o, b)) { return; }
        if (normRef(o.vendor_name) !== normRef(b.vendor_name)) { return; }
        var sdP = sameDay(o.bill_date, b.bill_date);
        var pt = o.paid_total > 0.005 ? ' — it was ALREADY PAID ($' + r2(o.paid_total).toFixed(2) + ')' : '';
        if (sdP === true) {
          if (dupSeen[String(l.bill_id) + '|' + String(o.bill_id)]) { return; } // UP — this copy is already reported above (same number and date)
          dupSeen[String(l.bill_id) + '|' + String(o.bill_id)] = true;
          add('block', 'DUP_OTHER_REF', who + ': another bill has the same reference ' + oref + ' and date — ' + (o.vendor_name || '?') + ' ' + copyWords(o) + '. A duplicate charge: void the extra copy in 💸 Bills (it is flagged there).', { other_bill_id: o.bill_id });
        }
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
  // v55.83-SP (Max, Nov 15: a service-fee change "doesn't need double signatures") — a request drawn from a transfer is
  // signed for its BILLS and the transfer it draws from; its service fee is not part of what the two people sign.
  // An ordinary wire is unchanged: its fingerprint covers the whole total, fee included.
  var tot = packageTotals(p, lines);
  if (p.funding_txn_id) {
    return wireFingerprint({ id: String(p.id || '') + '|' + (p.payee_kind || '') + '|' + normRef(p.payee_name) + '|from:' + String(p.funding_txn_id), amount: tot.bills }, lines, { validation: true, companyBills: p.payee_kind === 'affiliate' });
  }
  return wireFingerprint({ id: String(p.id || '') + '|' + (p.payee_kind || '') + '|' + normRef(p.payee_name), amount: tot.total }, lines, { validation: true, companyBills: p.payee_kind === 'affiliate' });
}
// input = auditWire's input + { pkg: {id, seq, payee_kind, payee_name, fee_amount}, otherOpen: { bill_id: 'WP-0003' } }
export function auditPackage(input) {
  var pkg = (input && input.pkg) || {};
  var lines = (input && input.lines) || [];
  var tot = packageTotals(pkg, lines);
  var base = auditWire(Object.assign({}, input, { wire: { id: pkg.id, amount: tot.bills, direction: 'out' }, releaseOptional: pkg.payee_kind === 'affiliate', directionRules: true, companyBills: pkg.payee_kind === 'affiliate' })); // XX: Nextrade bills only on a NextTrade wire
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
    // v55.83-XX — a Nextrade bill is paid only through NextTrade: on any other wire it blocks (never overridable)
    if (kind !== 'affiliate' && validationExempt(b)) { add('block', 'NEXTRADE_BILL_ONLY', who + ' is a Nextrade bill — it is paid only through NextTrade (a wire to NextTrade Industries, or the NextTrade starting balance). Remove it from this wire.'); }
    // v55.83-US — partial wires: the same bill on another open wire is fine while paid + every open wire ≤ the bill total
    var ob = other[l.bill_id];
    if (typeof ob === 'string') { add('block', 'IN_OTHER_PACKAGE', who + ' is already on wire ' + ob + ' — one bill, one wire.'); }
    else if (ob && ob.amount > 0) {
      var paidB = 0; (l.other_payments || []).forEach(function (o) { paidB = r2(paidB + (Number(o.amount) || 0)); });
      var totB = r2(b.total_amount); var sumB = r2(paidB + ob.amount + (Number(l.amount) || 0));
      if (sumB > totB + 0.005) { add('block', 'IN_OTHER_PACKAGE', who + ': ' + money(ob.amount) + ' of it is already on wire ' + ob.label + (paidB > 0.005 ? ' and ' + money(paidB) + ' was paid' : '') + ' — with this wire (' + money(l.amount) + ') that is ' + money(sumB) + ', more than the ' + money(totB) + ' bill. Lower this amount to ' + money(Math.max(0, totB - paidB - ob.amount)) + ' or less.'); }
      else { add('info', 'ALSO_ON_OTHER_PACKAGE', who + ': ' + money(ob.amount) + ' of it is on wire ' + ob.label + '; this wire pays ' + money(l.amount) + ' — together ' + money(sumB) + ' of the ' + money(totB) + ' bill.'); }
    }
  });
  curBill = null;
  // v55.83-XX — the server could not read which bills are Nextrade bills: on a wire that is not to NextTrade nobody can tell that none is
  // one, so it blocks until the check works (fails closed). On a NextTrade wire a failed read only means nothing is exempt.
  if (input && input.nextradeCheckFailed === true && kind !== 'affiliate' && lines.length) { add('block', 'NEXTRADE_CHECK_FAILED', 'Could not check which bills are Nextrade bills (they are paid only through NextTrade) — run the check again in a moment.'); }
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
export var OVERRIDABLE = { BILL_NUMBER_MISSING: 1, BILL_DATE_MISSING: 1, DIRECTION_MISSING: 1, REFERENCE_MISSING: 1, RELEASE_MISSING: 1, RELEASE_UNKNOWN: 1, DUP_RELEASE: 1, DUP_RELEASE_IN_WIRE: 1 };
// v55.83-WZ (Max, 21 Nov: "i don't want any duplicate bills. it needs to be blocked from the get go") — a disputed bill and a bill that
// has another active copy from the SAME vendor are no longer overridable; an override saved before this change does not count for them
// (applyOverrides only ever applies to codes in OVERRIDABLE). Different vendors with an equal number stay a warning, as before.
export var NOT_OVERRIDABLE_WHY = {
  BILL_VOID: 'a void bill cannot be paid', BILL_NOT_VALIDATED: 'a bill must be validated before it can be wired', OVERPAID: 'the books would be paid more than the bill', PAID_BEFORE: 'the bill is already paid in full',
  IN_OTHER_PACKAGE: 'the bill is on another wire', PAYEE_MISMATCH: 'the bill belongs to another company / vendor', FEE_NOT_ALLOWED: 'only RTM wires carry a fee',
  BILL_DISPUTED: 'a disputed bill is resolved first, then paid', DUP_REF: 'another copy of this bill from the same vendor is in the Hub — void the extra copy first', DUP_REF_IN_WIRE: 'the same bill is on this wire twice', DUP_OTHER_REF: 'another bill from the same vendor has the same reference and date — void the extra copy first', DUP_OTHER_REF_IN_WIRE: 'the same bill is on this wire twice',
  NO_BILLS: 'a wire needs bills', NO_PAYEE: 'pick who the wire goes to', NOT_OUT: 'not money out',
  NEXTRADE_BILL_ONLY: 'a Nextrade bill is paid only through NextTrade', NEXTRADE_CHECK_FAILED: 'the Nextrade-bill check has to work first', // v55.83-XX
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
