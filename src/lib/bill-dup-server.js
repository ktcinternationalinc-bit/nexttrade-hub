// v55.83-QH — ONE duplicate radar for every way a bill enters the system
// (multi-file import and the bills email address). Max (Nov 7 12:26):
// "duplicates can be anything similar that need to be flagged such as same
// date or reference or release number or container number etc."
//
// Verdicts:
//   skip — same vendor + same bill number, active: a hard duplicate, never
//          entered twice (reported, with the existing bill named).
//   warn — anything SIMILAR: a shared reference / release / container token
//          (any ≥5-char code with a digit found on the document), or same
//          vendor + same amount + SAME date (one combined check, Max 12:39).
//          The bill IS created, carrying a loud ⚠ naming each suspect and
//          whether that suspect is already PAID — a human validates, always.
// Fail-soft: any lookup error just means fewer flags, never a blocked import.

function r2d(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// reference-looking tokens: ≥5 chars, at least one digit (release numbers,
// container numbers, invoice refs) — plain words never match.
export function refTokens(text) {
  var out = []; var seen = {};
  var m = String(text || '').toUpperCase().match(/[A-Z0-9][A-Z0-9-]{4,}/g) || [];
  for (var i = 0; i < m.length && out.length < 6; i++) {
    var t = m[i].replace(/^-+|-+$/g, '');
    if (t.length < 5 || !/\d/.test(t) || seen[t]) { continue; }
    seen[t] = true; out.push(t);
  }
  return out;
}

async function paidNote(db, billRow) {
  try {
    var pays = await db.from('vendor_bill_payments').select('amount, voided').eq('bill_id', billRow.id);
    var paid = 0; ((pays && pays.data) || []).forEach(function (p) { if (p.voided !== true) { paid += Number(p.amount) || 0; } });
    return paid >= (Number(billRow.total_amount) || 0) - 0.005 ? ' — and that one is already PAID' : '';
  } catch (e) { return ''; }
}

export async function billDupVerdict(db, d) {
  var out = { skip: null, warn: null };
  try {
    // 1. HARD duplicate: same vendor + same bill number, active → skip.
    if (d.vendor_name && d.bill_number) {
      var dup = await db.from('vendor_bills').select('id')
        .ilike('vendor_name', d.vendor_name).ilike('bill_number', d.bill_number)
        .eq('record_status', 'active').limit(1);
      if (!dup.error && dup.data && dup.data.length > 0) {
        out.skip = 'Duplicate of an existing active bill (' + d.vendor_name + ' ' + d.bill_number + ').';
        return out;
      }
    }
    var reasons = []; var seenIds = {};
    // 2. Shared reference / release / container token anywhere on an active bill.
    var toks = refTokens(String(d.bill_number || '') + ' ' + String(d.notes || ''));
    for (var ti = 0; ti < toks.length && reasons.length < 3; ti++) {
      var tok = toks[ti];
      var hit = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount')
        .eq('record_status', 'active')
        .or('bill_number.ilike.%' + tok + '%,notes.ilike.%' + tok + '%').limit(1);
      if (!hit.error && hit.data && hit.data.length > 0 && !seenIds[hit.data[0].id]) {
        seenIds[hit.data[0].id] = true;
        reasons.push('shares reference "' + tok + '" with ' + (hit.data[0].vendor_name || '?') + ' ' + (hit.data[0].bill_number || '') + ' dated ' + (hit.data[0].bill_date || '?') + (await paidNote(db, hit.data[0])));
      }
    }
    // 3. Same vendor + same amount (±1¢) + SAME date — one combined check
    //    (Max, 12:39: "same vendor and amount and same date should be
    //    flagged... not separate"). Less noise, precise flags.
    if (d.vendor_name && r2d(d.total_amount) > 0 && d.bill_date && reasons.length < 3) {
      var sus = await db.from('vendor_bills').select('id, bill_number, bill_date, total_amount')
        .ilike('vendor_name', d.vendor_name).eq('record_status', 'active')
        .gte('total_amount', r2d(d.total_amount) - 0.01).lte('total_amount', r2d(d.total_amount) + 0.01)
        .eq('bill_date', d.bill_date).limit(1);
      if (!sus.error && sus.data && sus.data.length > 0 && !seenIds[sus.data[0].id]) {
        seenIds[sus.data[0].id] = true;
        reasons.push('same vendor, same amount, same date as ' + (sus.data[0].bill_number || 'a bill') + ' dated ' + sus.data[0].bill_date + (await paidNote(db, sus.data[0])));
      }
    }
    if (reasons.length) { out.warn = ('⚠ POSSIBLE DUPLICATE — ' + reasons.join(' · ') + '. Validate carefully.').substring(0, 400); }
  } catch (e) { /* fail-soft: fewer flags, never a blocked import */ }
  return out;
}
