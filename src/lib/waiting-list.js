// v55.83-SI — master plan build 2 (Max, Nov 12 13:00: "Start. Make sure you don't break anything while updating"):
// "Waiting for me" — one list per person of what is waiting on THEM in Bills and Wires, and what is stuck.
// Pure: it only READS what the Bills list and the Wires list already return. Nothing here writes anything.
function days(a, b) { var x = new Date(String(a || '').substring(0, 10) + 'T00:00:00Z').getTime(); var y = new Date(String(b).substring(0, 10) + 'T00:00:00Z').getTime(); return isNaN(x) || isNaN(y) ? null : Math.floor((y - x) / 86400000); }
function money(x) { return '$' + (Math.round((Number(x) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export var STUCK_BILL_DAYS = 3;   // a bill waiting this long for validation is marked stuck
export var STUCK_WIRE_DAYS = 3;   // a pre-wire / unsigned wire this old is marked stuck
export var STUCK_BANK_DAYS = 7;   // a SENT wire with no bank line after this many days is marked stuck
export var DUE_SOON_DAYS = 7;

// input: { bills: [...from Bills list], wires: [...from Wires list], perms: { bills, prepare, signoff, send }, userId, today: 'YYYY-MM-DD' }
// → { sections: [{ key, title, hint, go, items: [{ id, title, detail, amount, age, stuck }] }], total, stuck }
export function waitingFor(input) {
  var i = input || {}; var p = i.perms || {}; var today = i.today || new Date().toISOString().substring(0, 10);
  var bills = (i.bills || []).filter(function (b) { return b.record_status !== 'void' && b.record_status !== 'deleted' && (b.status === 'OPEN' || b.status === 'PARTIAL'); });
  var wires = i.wires || [];
  var out = [];
  function sec(key, title, hint, go, items) { if (items.length) { items.sort(function (a, b) { return (b.stuck ? 1 : 0) - (a.stuck ? 1 : 0) || (b.age || 0) - (a.age || 0); }); out.push({ key: key, title: title, hint: hint, go: go, items: items }); } }
  function billItem(b, since, limit, extra) {
    var age = days(since, today);
    return { id: b.id, title: b.vendor_name + ' · bill ' + (b.bill_number || '—'), detail: (extra ? extra + ' · ' : '') + (b.due_date ? 'due ' + b.due_date : 'no due date'), amount: money(b.open != null ? b.open : b.total_amount), age: age, stuck: limit != null && age != null && age >= limit };
  }
  function wireItem(w, since, limit, extra) {
    var age = days(since, today);
    return { id: w.id, title: w.label + ' → ' + (w.payee_name || '?'), detail: (extra ? extra + ' · ' : '') + (w.bills || 0) + ' bill(s)', amount: money(w.total), age: age, stuck: limit != null && age != null && age >= limit };
  }
  if (p.bills) {
    sec('bill_flags', 'Price flags to resolve', 'The Hub found a price or amount that does not match the rules. A person has to say what is right.', 'bills',
      bills.filter(function (b) { return b.validation_status !== 'validated' && b.price_check_status === 'flagged' && !b.price_resolved_at; }).map(function (b) { return billItem(b, b.created_at, STUCK_BILL_DAYS, 'flagged'); }));
    sec('bill_validate', 'Bills to validate', 'A bill cannot be wired until it is validated (type, inbound / outbound, 3 checks).', 'bills',
      bills.filter(function (b) { return b.validation_status !== 'validated' && b.status !== 'DISPUTED' && !(b.price_check_status === 'flagged' && !b.price_resolved_at); }).map(function (b) { return billItem(b, b.created_at, STUCK_BILL_DAYS, b.validation_draft ? 'started' : null); }));
  }
  if (p.prepare) {
    sec('wire_fix', 'Pre-wires to finish', 'These wires did not pass the check yet. Open the wire to see what it needs.', 'wires',
      wires.filter(function (w) { return w.status === 'needs_check' || w.status === 'flagged'; }).map(function (w) { return wireItem(w, w.created_at, STUCK_WIRE_DAYS, w.status === 'flagged' ? 'check found a problem' : 'not checked yet'); }));
  }
  if (p.signoff) {
    sec('wire_sign', 'Wires waiting for your signature', 'Open each bill, check it, then sign. Two different people must sign.', 'wires',
      wires.filter(function (w) { return w.status === 'awaiting_1st' || (w.status === 'awaiting_2nd' && (w.signer_ids || []).indexOf(i.userId) < 0); }).map(function (w) { return wireItem(w, w.created_at, STUCK_WIRE_DAYS, w.status === 'awaiting_2nd' ? 'one signature in — needs yours' : 'needs the first signature'); }));
  }
  if (p.send) {
    sec('wire_send', 'Approved — ready to send', 'Both signatures are in. Send it at the bank, then mark it sent with the confirmation.', 'wires',
      wires.filter(function (w) { return w.status === 'ready_to_send'; }).map(function (w) { return wireItem(w, w.created_at, STUCK_WIRE_DAYS, 'approved'); }));
    sec('wire_bank', 'Sent — no bank line yet', 'The Hub has not found this wire in the bank after ' + STUCK_BANK_DAYS + ' days. Check the sent date, or pick the bank line by hand.', 'wires',
      wires.filter(function (w) { return w.status === 'sent' && w.sent_date && days(w.sent_date, today) >= STUCK_BANK_DAYS; }).map(function (w) { var it = wireItem(w, w.sent_date, STUCK_BANK_DAYS, 'sent ' + w.sent_date); it.stuck = true; return it; }));
    sec('wire_proof', 'Paid — waiting for proof', 'The bank line is matched; the payer’s proof of payment to the vendors is still missing.', 'wires',
      wires.filter(function (w) { return w.status === 'awaiting_proof'; }).map(function (w) { return wireItem(w, w.sent_date || w.created_at, null, (w.rtm_pending || 0) + ' bill(s) without proof'); }));
  }
  if (p.prepare) {
    sec('bill_ready', 'Validated bills not on any wire', 'Due within ' + DUE_SOON_DAYS + ' days or already late. Build a wire for them.', 'wires',
      bills.filter(function (b) { if (b.validation_status !== 'validated' || b.wire_state || b.status === 'DISPUTED' || !b.due_date) { return false; } var d = days(today, b.due_date); return d != null && d <= DUE_SOON_DAYS; })
        .map(function (b) { var late = days(b.due_date, today); var it = billItem(b, b.due_date, null, late > 0 ? late + ' day(s) late' : 'due soon'); it.age = late > 0 ? late : 0; it.stuck = late > 0; it.chip = late > 0 ? 'late · ' + late + ' day' + (late === 1 ? '' : 's') : (late === 0 ? 'due today' : 'due in ' + (-late) + ' day' + (late === -1 ? '' : 's')); return it; }));
  }
  var total = 0; var stuck = 0;
  out.forEach(function (s) { total += s.items.length; s.items.forEach(function (x) { if (x.stuck) { stuck++; } }); });
  return { sections: out, total: total, stuck: stuck };
}
