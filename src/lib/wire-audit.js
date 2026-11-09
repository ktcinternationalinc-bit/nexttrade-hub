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
function money(n) { return '$' + r2(n).toFixed(2); }

// One fingerprint of exactly what was checked and signed: every payment, its
// bill, amount, release and reference. Any change → a different fingerprint →
// earlier checks and sign-offs no longer count.
export function wireFingerprint(wire, lines) {
  var parts = [String((wire && wire.id) || ''), r2(wire && wire.amount).toFixed(2)];
  // v55.83-RH — prepared wires have no payment yet: order by line / bill (RG wires keep ordering by payment, unchanged)
  function sk(l) { return String(l.payment_id || l.bill_id || ''); }
  (lines || []).slice().sort(function (a, b) { return sk(a).localeCompare(sk(b)); }).forEach(function (l) {
    var b = l.bill || {};
    parts.push([l.payment_id, l.bill_id, r2(l.amount).toFixed(2), normRef(b.release_number), normRef(b.bill_number), normRef(b.vendor_name), r2(b.total_amount).toFixed(2), b.record_status || ''].join('|'));
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
  var known = {}; ((input && input.knownReleases) || []).forEach(function (k) { known[normRef(k)] = true; });
  var checks = [];
  function add(level, code, text) { checks.push({ level: level, code: code, text: text }); }

  if (wire.direction && wire.direction !== 'out') { add('block', 'NOT_OUT', 'This bank line is money IN — a wire to a vendor is money out.'); }
  if (!lines.length) { add('block', 'NO_BILLS', 'No bills are linked to this wire yet — link the bills it paid first.'); }

  var placed = 0; var relSeen = {}; var numSeen = {};
  lines.forEach(function (l) {
    var b = l.bill || {}; var who = (b.vendor_name || '?') + (b.bill_number ? ' #' + b.bill_number : '');
    placed = r2(placed + (Number(l.amount) || 0));
    // ── state of the bill
    if (b.record_status && b.record_status !== 'active') { add('block', 'BILL_VOID', who + ' is VOID — a void bill cannot be paid.'); }
    if (b.disputed === true) { add('block', 'BILL_DISPUTED', who + ' is DISPUTED — resolve the dispute before paying it.'); }
    if (b.validation_status && b.validation_status !== 'validated') { add('warn', 'BILL_NOT_VALIDATED', who + ' has not been validated by a person yet (' + b.validation_status + ').'); }
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
    if (!rel) { add('block', 'RELEASE_MISSING', who + ' has NO release number — every bill on a wire must belong to a release.'); }
    else {
      if (input && input.knownReleases && !known[rel]) { add('warn', 'RELEASE_UNKNOWN', who + ': release ' + rel + ' is not found in the orders or invoices.'); }
      // duplicated release: the same vendor billing the same release twice
      var vkey = normRef(b.vendor_name) + '|' + rel;
      if (relSeen[vkey]) { add('block', 'DUP_RELEASE_IN_WIRE', who + ' and ' + relSeen[vkey] + ' are the SAME vendor billing the SAME release ' + rel + ' on this wire.'); }
      relSeen[vkey] = who;
      (sameRel[rel] || []).forEach(function (o) {
        if (o.bill_id === l.bill_id) { return; }
        if (normRef(o.vendor_name) === normRef(b.vendor_name) && !lines.some(function (x) { return x.bill_id === o.bill_id; })) {
          add('block', 'DUP_RELEASE', who + ': release ' + rel + ' is ALSO billed by ' + (o.vendor_name || '?') + (o.bill_number ? ' #' + o.bill_number : '') + ' (another bill) — possible double charge.');
        }
      });
    }
    // ── duplicated reference (bill) number
    var num = normRef(b.bill_number);
    if (!num) { add('warn', 'REF_MISSING', (b.vendor_name || '?') + ' bill has no reference / bill number.'); }
    else {
      if (numSeen[num]) { add('block', 'DUP_REF_IN_WIRE', 'Reference ' + num + ' appears on TWO bills of this wire (' + numSeen[num] + ' and ' + who + ').'); }
      numSeen[num] = who;
      (sameNum[num] || []).forEach(function (o) {
        if (o.bill_id === l.bill_id || lines.some(function (x) { return x.bill_id === o.bill_id; })) { return; }
        add(normRef(o.vendor_name) === normRef(b.vendor_name) ? 'block' : 'warn', 'DUP_REF',
          who + ': reference ' + num + ' is ALSO on ' + (o.vendor_name || '?') + "'s bill" + (normRef(o.vendor_name) === normRef(b.vendor_name) ? ' — the same vendor, same reference: a duplicate bill.' : ' (a different vendor — check it is not the same document).'));
      });
    }
  });
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
  return wireFingerprint({ id: String(p.id || '') + '|' + (p.payee_kind || '') + '|' + normRef(p.payee_name), amount: packageTotals(p, lines).total }, lines);
}
// input = auditWire's input + { pkg: {id, seq, payee_kind, payee_name, fee_amount}, otherOpen: { bill_id: 'WP-0003' } }
export function auditPackage(input) {
  var pkg = (input && input.pkg) || {};
  var lines = (input && input.lines) || [];
  var tot = packageTotals(pkg, lines);
  var base = auditWire(Object.assign({}, input, { wire: { id: pkg.id, amount: tot.bills, direction: 'out' } }));
  var checks = base.checks.filter(function (c) { return c.code !== 'ALL_CLEAR'; });
  function add(level, code, text) { checks.push({ level: level, code: code, text: text }); }
  var payee = normRef(pkg.payee_name); var kind = pkg.payee_kind;
  if (!payee) { add('block', 'NO_PAYEE', 'Who is this wire going to? Pick RTM Capital, NextTrade Industries or the vendor.'); }
  var other = (input && input.otherOpen) || {};
  lines.forEach(function (l) {
    var b = l.bill || {}; var who = (b.vendor_name || '?') + (b.bill_number ? ' #' + b.bill_number : '');
    if (kind === 'vendor') {
      if (b.paid_via) { add('block', 'PAYEE_MISMATCH', who + ' is paid THROUGH ' + b.paid_via + ' — it belongs on a wire to ' + b.paid_via + ', not straight to the vendor.'); }
      else if (normRef(b.vendor_name) !== payee) { add('block', 'PAYEE_MISMATCH', who + ' is a bill of ' + (b.vendor_name || '?') + ' — this wire goes to ' + pkg.payee_name + '.'); }
    } else if (kind === 'service_provider' || kind === 'affiliate') {
      if (normRef(b.paid_via) !== payee) { add('block', 'PAYEE_MISMATCH', who + (b.paid_via ? ' is paid through ' + b.paid_via : ' is not marked "paid through ' + pkg.payee_name + '"') + ' — set that on the bill, or pay it on the right wire.'); }
    }
    if (other[l.bill_id]) { add('block', 'IN_OTHER_PACKAGE', who + ' is already on wire ' + other[l.bill_id] + ' — one bill, one wire.'); }
  });
  if (tot.fee > 0.005) {
    if (kind !== 'service_provider') { add('block', 'FEE_NOT_ALLOWED', (kind === 'affiliate' ? 'NextTrade wires are bills only' : 'A wire straight to a vendor is bills only') + ' — remove the fee.'); }
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
  if (p.status === 'attached') { return rtmPending > 0 ? 'awaiting_proof' : 'complete'; }
  if (p.status === 'sent') { return 'sent'; }
  var s = wireStatus(p, liveHash);
  return s === 'approved' ? 'ready_to_send' : s;
}
export var PKG_STATUS_LABEL = {
  needs_check: '🤖 needs audit', flagged: '⛔ flagged — fix first', awaiting_1st: '✍ awaiting 1st sign-off', awaiting_2nd: '✍ awaiting 2nd sign-off',
  ready_to_send: '✅ approved — ready to send', sent: '📤 sent — waiting for the bank line', awaiting_proof: '📎 in the bank — waiting for RTM proof',
  complete: '🏁 complete', cancelled: '✕ cancelled',
};
