// v55.83-SV — every bill is compared with every other bill, every time the Bills screen loads.
// Max, Nov 15: "this is core functionality to check for duplicates" · "1 trucking for each release number
// allowed. as a rule in addition to looking for similar invoice numbers, dates of invoice or date of service
// or amounts. you need to look at all logically and assess possible duplicates to flag.. and flag with a
// different background color"
//
// WHY THIS EXISTS: the older check (bill-dup-server.js) only ran at the moment a bill arrived from a file or
// an email. A bill typed in by hand, an edited bill, or a copied bill was never checked, and two bills already
// in the system were never compared with each other. NexPac 14481 sat in the list twice with no flag.
//
// Pure functions, no database: safe to import from a server route and easy to test.
//
// Levels:  'strong'   — almost certainly the same bill, or it breaks the one-trucking-bill-per-release rule
//          'possible' — similar enough that a person must look
// Nothing here deletes, hides or blocks a bill. It only flags. A person decides.

function r2s(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// "NexPac Corporation" / "NEXPAC CORP." / "Nexpac, Inc" → NEXPAC
export function normVendor(s) {
  var t = String(s || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ');
  t = ' ' + t.replace(/\s+/g, ' ').trim() + ' ';
  var drop = ['INCORPORATED', 'CORPORATION', 'COMPANY', 'LIMITED', 'INC', 'LLC', 'LTD', 'CORP', 'CO', 'LLP', 'LP', 'THE'];
  for (var i = 0; i < drop.length; i++) { t = t.split(' ' + drop[i] + ' ').join(' '); }
  return t.replace(/\s+/g, '');
}

// "INV-14481 " / "inv 14481" → INV14481
export function normNum(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

// v55.83-UQ (Max, Nov 18: "the duplicates should be avoided from the begining by not accepting them if they are the exact same bill")
// THE EXACT SAME BILL = same vendor (ignoring Inc / Corp / punctuation), same bill number (ignoring spaces / dashes), same bill date and
// the same total to the cent, among bills still on file (a voided / deleted one does not count). Such a bill is never accepted twice —
// not by import, e-mail or typing, and no "save anyway". Anything less than exact keeps the existing duplicate warning.
export function exactSameBill(cand, bills) {
  var c = cand || {}; var v = normVendor(c.vendor_name); var n = normNum(c.bill_number); var d = String(c.bill_date || '').substring(0, 10);
  if (!v || !n || !d) { return null; }
  var a = Math.round((Number(c.total_amount) || 0) * 100);
  var list = bills || [];
  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    if (!b || !(b.record_status === 'active' || b.record_status == null) || (c.id && b.id === c.id)) { continue; }
    if (normVendor(b.vendor_name) === v && normNum(b.bill_number) === n && String(b.bill_date || '').substring(0, 10) === d && Math.round((Number(b.total_amount) || 0) * 100) === a) { return b; }
  }
  return null;
}
export function exactSameWords(b) { return 'This exact bill is already in the Hub — ' + (b.vendor_name || '?') + ' #' + (b.bill_number || '?') + ' dated ' + String(b.bill_date || '').substring(0, 10) + ' for $' + (Math.round((Number(b.total_amount) || 0) * 100) / 100).toFixed(2) + '. It was NOT added again.'; }

// just the digits, leading zeros dropped: "INV-0014481" → 14481
export function digitsOf(s) { return String(s || '').replace(/[^0-9]/g, '').replace(/^0+/, ''); }

function dayNo(d) {
  var t = Date.parse(String(d || '').substring(0, 10) + 'T00:00:00Z');
  return isNaN(t) ? null : Math.round(t / 86400000);
}
export function daysApart(a, b) {
  var x = dayNo(a); var y = dayNo(b);
  return (x === null || y === null) ? null : Math.abs(x - y);
}

// The SAME number written two ways: 14481 vs INV-14481 · 14481 vs 14481A · 0014481 vs 14481.
// Consecutive numbers (FF-100 / FF-101, INV-100 / INV-1000) are NOT the same number — a vendor's next invoice is normal.
function sameNumberWrittenTwoWays(x, y) {
  if (!x || !y || x === y) { return false; }
  var shorter = x.length <= y.length ? x : y; var longer = x.length <= y.length ? y : x;
  if (shorter.length >= 4) {
    var at = longer.indexOf(shorter);
    if (at >= 0) {
      var rest = longer.substring(0, at) + longer.substring(at + shorter.length);
      if (!/[0-9]/.test(rest)) { return true; } // only letters were added around it
    }
  }
  var dx = digitsOf(x); var dy = digitsOf(y);
  if (dx.length >= 4 && dx === dy && x.replace(/[0-9]/g, '') !== y.replace(/[0-9]/g, '')) { return true; }
  if (dx.length >= 4 && dx === dy && x.length !== y.length) { return true; } // leading zeros
  return false;
}
export function similarNumber(a, b) { return sameNumberWrittenTwoWays(normNum(a), normNum(b)); }

function money(x) { return '$' + r2s(x).toFixed(2); }
function label(b) { return String(b.vendor_name || '?') + ' ' + String(b.bill_number || '(no #)') + ' dated ' + String(b.bill_date || '?') + ' for ' + money(b.total_amount); }

// Everything the comparison needs, worked out ONCE per bill (the scan compares each bill with many others).
export function prepBill(b) {
  return { b: b, v: normVendor(b.vendor_name), n: normNum(b.bill_number), amt: r2s(b.total_amount), day: dayNo(b.bill_date),
    rel: normNum(b.release_number), ref: normNum(b.other_reference), type: String(b.bill_type || '').toLowerCase() };
}

// Compare two prepared bills. reasons describe Q as seen from P.
function verdictPrepared(P, Q) {
  var a = P.b; var b = Q.b;
  var reasons = []; var strong = false;
  var sameVendor = !!P.v && P.v === Q.v;
  var sameNum = !!P.n && P.n === Q.n;
  var sameAmt = P.amt > 0 && Math.abs(P.amt - Q.amt) <= 0.01;
  var days = (P.day === null || Q.day === null) ? null : Math.abs(P.day - Q.day);
  var sameRel = !!P.rel && P.rel === Q.rel;
  // the same code typed as a release # on one bill and as a reference on the other still counts
  var sharedCode = sameRel || (!!P.ref && P.ref === Q.ref) || (!!P.rel && P.rel === Q.ref) || (!!P.ref && P.ref === Q.rel);

  // RULE 1 (Max): one trucking bill per release number — any vendor, any amount, any date.
  if (P.type === 'trucking' && Q.type === 'trucking' && sameRel) {
    strong = true;
    reasons.push('SECOND TRUCKING BILL for release ' + String(a.release_number || '').toUpperCase() + ' — only ONE trucking bill is allowed per release. The other one: ' + label(b));
  }
  // RULE 2: same vendor + same bill number.
  if (sameVendor && sameNum) {
    strong = true;
    reasons.push('Same vendor and same bill # as ' + label(b));
  } else if (sameNum && !sameVendor && (sameAmt || P.n.length >= 5)) {
    // RULE 3: same bill number under a different vendor spelling / a different vendor.
    if (sameAmt) { strong = true; }
    reasons.push('Same bill # ' + String(a.bill_number || '') + (sameAmt ? ' and same amount' : '') + ' under another vendor name: ' + label(b));
  } else if (sameVendor && !sameNum && (sameAmt || (days !== null && days <= 31)) && sameNumberWrittenTwoWays(P.n, Q.n)) {
    // RULE 4a: the same bill number written two ways (INV-14481 / 14481).
    if (sameAmt) { strong = true; }
    reasons.push('Bill # is the same number written differently (' + String(a.bill_number || '') + ' vs ' + String(b.bill_number || '') + ')' + (sameAmt ? ' and same amount' : '') + ': ' + label(b));
  }
  // (A bill # that is one character off is NOT a rule by itself: FF-300 / FF-301 at a standard rate is the vendor's next
  //  invoice. A real typing slip shares the bill date and is caught by rule 5.)
  // RULE 5: same vendor + same amount + the SAME bill date, different number → POSSIBLE (a person looks).
  // Max, Nov 15: the same vendor billing the same amount a few days apart "can happen and likely to happen" (a trucker's
  // standard rate), so dates that are merely close are NOT flagged. Two bills that each carry their own, different
  // release # are two jobs, not a duplicate — not flagged even on the same date.
  var twoJobs = !!P.rel && !!Q.rel && P.rel !== Q.rel;
  if (sameVendor && sameAmt && days === 0 && !sameNum && !twoJobs && !reasons.length) {
    reasons.push('Same vendor, same amount, same bill date: ' + label(b));
  }
  // RULE 6: same release # / reference + same amount, any vendor.
  if (sharedCode && sameAmt && !(sameVendor && sameNum)) {
    reasons.push('Same release # / reference and same amount: ' + label(b));
  }
  // RULE 7: same vendor, same type of bill, same release # (two shipping bills for one release, two brokerage bills…).
  if (sameVendor && sameRel && P.type && P.type === Q.type && P.type !== 'trucking' && !sameNum && !sameAmt) {
    reasons.push('Same vendor and same type of bill (' + P.type + ') for release ' + String(a.release_number || '').toUpperCase() + ': ' + label(b));
  }
  if (!reasons.length) { return { level: null, reasons: [] }; }
  return { level: strong ? 'strong' : 'possible', reasons: reasons };
}

// Compare two bills. Returns { level: 'strong' | 'possible' | null, reasons: [text] } — reasons describe the second bill.
export function pairVerdict(a, b) { return verdictPrepared(prepBill(a), prepBill(b)); }

export function pairKey(idA, idB) { var x = String(idA); var y = String(idB); return x < y ? x + '|' + y : y + '|' + x; }

function isLive(b) { return !!b && (b.record_status === 'active' || b.record_status == null); }

// Compare every live bill with every other live bill that shares a vendor, a number or a code.
// dismissed = { 'idA|idB': true } pairs a person already marked "not a duplicate".
// Returns { byId: { billId: { level, reasons: [text], others: [billId] } }, pairs: n }
export function scanBills(bills, dismissed) {
  var live = (bills || []).filter(isLive).filter(function (b) { return !!b.id; }).map(prepBill);
  var skip = dismissed || {};
  var hasSkip = false; for (var sk in skip) { if (Object.prototype.hasOwnProperty.call(skip, sk)) { hasSkip = true; break; } }
  var byVendor = {}; var byOther = {}; var i;
  function put(map, key, idx) { (map[key] = map[key] || []).push(idx); }
  for (i = 0; i < live.length; i++) {
    var P = live[i];
    if (P.v) { put(byVendor, P.v, i); }
    if (P.n) { put(byOther, 'N|' + P.n, i); }
    if (P.rel) { put(byOther, 'C|' + P.rel, i); }
    if (P.ref && P.ref !== P.rel) { put(byOther, 'C|' + P.ref, i); }
  }
  var byId = {}; var pairs = 0;
  function add(me, other, v) {
    var cur = byId[me.id] || (byId[me.id] = { level: 'possible', reasons: [], others: [] });
    if (v.level === 'strong') { cur.level = 'strong'; }
    for (var q = 0; q < v.reasons.length && cur.reasons.length < 6; q++) { cur.reasons.push(v.reasons[q]); }
    if (cur.others.indexOf(other.id) < 0) { cur.others.push(other.id); }
  }
  function compare(A, B) {
    if (A.b.id === B.b.id) { return; }
    if (hasSkip && skip[pairKey(A.b.id, B.b.id)]) { return; }
    var vAB = verdictPrepared(A, B);
    if (!vAB.level) { return; }
    pairs++;
    add(A.b, B.b, vAB);
    add(B.b, A.b, verdictPrepared(B, A));
  }
  var x; var y; var idx;
  // 1. every pair inside one vendor
  Object.keys(byVendor).forEach(function (key) {
    idx = byVendor[key];
    for (x = 0; x < idx.length; x++) { for (y = x + 1; y < idx.length; y++) { compare(live[idx[x]], live[idx[y]]); } }
  });
  // 2. pairs ACROSS vendors that share a bill number or a release / reference code (same-vendor pairs were done above)
  var seen = {};
  Object.keys(byOther).forEach(function (key) {
    idx = byOther[key];
    if (idx.length < 2) { return; }
    for (x = 0; x < idx.length; x++) {
      for (y = x + 1; y < idx.length; y++) {
        var A = live[idx[x]]; var B = live[idx[y]];
        if (A.v && A.v === B.v) { continue; }
        var pk = pairKey(A.b.id, B.b.id);
        if (seen[pk]) { continue; }
        seen[pk] = true;
        compare(A, B);
      }
    }
  });
  return { byId: byId, pairs: pairs };
}

// One bill about to be saved, against everything already there. When editing, the bill is never compared with itself.
export function checkOne(cand, bills, dismissed) {
  var out = { level: null, reasons: [], others: [] };
  var skip = dismissed || {};
  var C = prepBill(cand);
  (bills || []).forEach(function (b) {
    if (!isLive(b) || !b.id || (cand.id && b.id === cand.id)) { return; }
    if (cand.id && skip[pairKey(cand.id, b.id)]) { return; }
    var v = verdictPrepared(C, prepBill(b));
    if (!v.level) { return; }
    if (v.level === 'strong') { out.level = 'strong'; } else if (!out.level) { out.level = 'possible'; }
    for (var q = 0; q < v.reasons.length && out.reasons.length < 6; q++) { out.reasons.push(v.reasons[q]); }
    out.others.push(b.id);
  });
  return out;
}
