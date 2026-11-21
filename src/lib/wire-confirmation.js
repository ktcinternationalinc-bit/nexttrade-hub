// v55.83-WV (Max, 21 Nov: "it should be able to read the pdf or screenshot to update the reference and the screenshot and the
// sent on dates") — what the AI is asked about a bank's wire confirmation, and the strict reading of its answer.
// Pure functions (no network): the server part is wire-confirmation-server.js. Nothing here writes anything — the person
// still checks the filled boxes and presses "Mark as sent", and the route checks everything again.
// Shaped on Max's example (21 Nov, online banking wire detail): "Wire to", "Status: Sent", "Status date", "Transaction number",
// "Reference number", "Wire date", "Wire amount", "Scheduled on", "Recipient".

export var WIRE_CONFIRMATION_PROMPT = 'This file is a bank\'s confirmation of an outgoing wire transfer (a PDF or a screenshot of online banking). '
  + 'Read it and answer with ONE JSON object and nothing else, with exactly these keys:\n'
  + '{"is_wire_confirmation": true or false, "reference": "the number labelled Reference number / wire reference / confirmation number / IMAD / Fed reference, or null", '
  + '"transaction_number": "the number labelled Transaction number / transaction ID, if it is a different number from the reference, or null", '
  + '"status": "the wire status as printed (for example Sent, Completed, Pending, Scheduled, Cancelled, Rejected), or null", '
  + '"sent_date": "the date the wire was sent, as YYYY-MM-DD, or null", "amount": the wire amount as a plain number (no currency sign, no commas) or null, '
  + '"currency": "USD or the 3-letter code, or null", "beneficiary": "the recipient / beneficiary name (the company or person the money went to), or null"}\n'
  + 'Rules: copy numbers exactly as printed, keeping leading zeros. For sent_date use the date labelled "Wire date" when there is one; otherwise '
  + 'the date the wire was sent / executed / processed. Never use a printed-on, requested, or last-modified date. For amount use the wire amount, '
  + 'not a fee. Never guess: use null for anything you cannot read clearly. If the file is not a wire confirmation, set is_wire_confirmation to false.';

function realDate(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) { return false; }
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
export { realDate as isRealDate };

function cleanNum(v) {
  if (v == null) { return null; }
  var s = String(v).trim().substring(0, 60);
  return s.length >= 3 && !/^(null|none|n\/a|not available)$/i.test(s) ? s : null;
}

// the model's text → { read: {...} } or { error }. Only the outermost {...} block is read; every field is checked on its own.
export function parseWireConfirmation(text) {
  var t = String(text || '');
  var a = t.indexOf('{'); var b = t.lastIndexOf('}');
  var bad = { error: 'The file could not be read as a wire confirmation.' };
  if (a < 0 || b <= a) { return bad; }
  var j;
  try { j = JSON.parse(t.substring(a, b + 1)); } catch (e) { return bad; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) { return bad; }
  var ref = cleanNum(j.reference); var txn = cleanNum(j.transaction_number);
  if (txn && ref && txn === ref) { txn = null; }
  if (!ref && txn) { ref = txn; txn = null; }
  var dt = j.sent_date == null ? null : String(j.sent_date).trim();
  if (dt && !realDate(dt)) { dt = null; }
  var amt = null;
  if (j.amount != null && j.amount !== '') {
    var s = String(j.amount).replace(/[$,\s]/g, '');
    if (/^\d+(\.\d+)?$/.test(s)) { amt = Math.round(Number(s) * 100) / 100; }
  }
  var cur = j.currency == null ? null : (String(j.currency).trim().toUpperCase().substring(0, 3) || null);
  var ben = j.beneficiary == null ? null : (String(j.beneficiary).trim().substring(0, 120) || null);
  var st = j.status == null ? null : (String(j.status).trim().substring(0, 40) || null);
  return { read: { is_wire_confirmation: j.is_wire_confirmation !== false, reference: ref, transaction_number: txn, status: st, sent_date: dt, amount: amt, currency: cur, beneficiary: ben } };
}

// the text for the "bank's wire reference" box: the reference, plus the transaction number when the bank shows both (≤ 80)
export function referenceText(read) {
  var r = read || {};
  if (!r.reference) { return null; }
  return (r.reference + (r.transaction_number ? ' / txn ' + r.transaction_number : '')).substring(0, 80);
}

var STOP = ['inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'the', 'and', 'limited'];
function words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2 && STOP.indexOf(w) < 0; }); }

// what was read, compared with the wire it is attached to. today = 'YYYY-MM-DD' (the server's). Returns the boxes the screen may
// fill (fill.reference / fill.sent_date) and plain-language warnings; a date in the future or unreadable is never filled.
export function compareWireConfirmation(read, wire, today) {
  var r = read || {}; var w = wire || {}; var warnings = []; var fill = {};
  if (r.is_wire_confirmation === false) { warnings.push('This does not look like a bank wire confirmation — check that the right file is attached.'); }
  var rt = referenceText(r);
  if (rt) { fill.reference = rt; } else { warnings.push('No wire reference could be read — type it from the confirmation.'); }
  if (r.status && !/^(sent|completed?|processed|executed|released|paid|success(ful)?)$/i.test(r.status)) { warnings.push('The bank shows this wire as "' + r.status + '", not sent — mark it sent only once the bank has sent it.'); }
  if (!r.sent_date) { warnings.push('No sent date could be read — pick it yourself.'); }
  else if (today && r.sent_date > today) { warnings.push('The date read (' + r.sent_date + ') is in the future — it was not filled in. Pick the date the wire was sent.'); }
  else { fill.sent_date = r.sent_date; }
  var total = Math.round((Number(w.total) || 0) * 100) / 100;
  if (r.currency && r.currency !== 'USD') { warnings.push('The confirmation is in ' + r.currency + ', not USD — its amount cannot be compared with this wire. Check it by hand.'); }
  else if (!r.currency && r.amount != null) { warnings.push('No currency could be read — the amount (' + r.amount.toFixed(2) + ') is unverified: it matches this $' + total.toFixed(2) + ' wire only if it is in US dollars. Check it.' + (Math.abs(r.amount - total) > 0.005 ? ' It is also a different number from this wire.' : '')); } // v55.83-WV (Codex 09:09)
  else if (r.amount == null) { warnings.push('No amount could be read — check the confirmation shows $' + total.toFixed(2) + '.'); }
  else if (Math.abs(r.amount - total) > 0.005) { warnings.push('The confirmation shows $' + r.amount.toFixed(2) + ' but this wire is $' + total.toFixed(2) + ' — check it is the right wire before marking it sent.'); }
  if (r.beneficiary && w.payee_name) {
    var pw = words(w.payee_name); var bw = words(r.beneficiary);
    var hit = pw.some(function (x) { return bw.indexOf(x) >= 0; });
    if (pw.length && !hit) { warnings.push('The confirmation was sent to "' + r.beneficiary + '" — this wire is to ' + w.payee_name + '. Check it is the right wire.'); }
  }
  return { fill: fill, warnings: warnings };
}

// v55.83-WV (Codex 21 Nov) — how the screen's "send" boxes take an answer from the reader. state = { file, pkgId, path, date, ref,
// read, reading, typed: { date, ref }, filledFrom }; file / pkgId = what the answer was asked for. A stale answer (another file
// picked since, or another wire opened) changes NOTHING; a box the person typed in themselves is never overwritten. filledFrom = the
// file whose reading filled a box (so a box filled from an EARLIER file can never be sent with a later one).
export function applyConfirmationAnswer(state, file, pkgId, answer) {
  var s = state || {};
  if (s.file !== file || String(s.pkgId || '') !== String(pkgId || '')) { return s; }
  var a = answer || {};
  if (!a.ok) { return Object.assign({}, s, { reading: false, read: { error: a.error || 'The confirmation could not be read — type the reference and pick the date yourself.' } }); }
  var nx = Object.assign({}, s, { reading: false, read: a });
  var typed = s.typed || {};
  if (a.fill && a.fill.reference && !typed.ref) { nx.ref = a.fill.reference; nx.filledFrom = file; }
  if (a.fill && a.fill.sent_date && !typed.date) { nx.date = a.fill.sent_date; nx.filledFrom = file; }
  return nx;
}

// v55.83-WV (Codex 09:09 P2) — a NEW file is picked: whatever the PREVIOUS file filled in is wiped (the reference emptied, the date
// back to the wire's own default), so a replacement that cannot be read never leaves the old file's values ready to send. Values the
// person typed themselves stay. Reading starts for the new file.
export function startConfirmationFile(state, file, pkgId, defaultDate) {
  var s = state || {}; var typed = s.typed || {};
  return Object.assign({}, s, { file: file, pkgId: pkgId, path: null, read: null, reading: true, filledFrom: null,
    ref: typed.ref ? s.ref : '', date: typed.date ? s.date : (defaultDate || '') });
}

// v55.83-WV (Codex 09:09 P2) — what stops "Mark as sent" (null = it may go). today = the Eastern business day.
export function confirmationSendProblem(state, pkgId, today) {
  var s = state || {};
  if (!s.file) { return "Attach the bank's wire confirmation (PDF or screenshot)."; }
  if (String(s.pkgId || '') !== String(pkgId || '')) { return 'This confirmation was attached to another wire — attach it again here.'; }
  if (s.reading) { return 'Still reading the confirmation — wait a moment.'; }
  if (s.filledFrom && s.filledFrom !== s.file) { return 'The reference / date came from an earlier file — check them against this file.'; }
  if (!s.ref || String(s.ref).trim().length < 3) { return "Type the bank's wire reference / confirmation #."; }
  if (!s.date) { return 'Pick the date the wire was sent.'; }
  if (today && s.date > today) { return 'That date is in the future — mark it sent on or after the day it goes.'; }
  return null;
}
