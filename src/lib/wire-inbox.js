// v55.83-XC (Max, 21 Nov: "a place to enter screenshots for wires in one place and the hub able to sort them out and put them in
// the proper wire for confirmation. If there is a discrepancy somewhere it must create a note and send to emails ...") — the pure
// part of the bank-confirmation inbox: which wire a read confirmation most likely belongs to (a PROPOSAL — a person confirms), and
// what does not match once a person has linked it. No network, no writes.
import { normRef } from './wire-audit';

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
var STOP = ['inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'the', 'and', 'limited'];
function words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2 && STOP.indexOf(w) < 0; }); }
export function payeeMatches(beneficiary, payee) { var pw = words(payee); var bw = words(beneficiary); return pw.length > 0 && pw.some(function (x) { return bw.indexOf(x) >= 0; }); }
function dayDiff(a, b) { var x = Date.parse(String(a).substring(0, 10) + 'T00:00:00Z'); var y = Date.parse(String(b).substring(0, 10) + 'T00:00:00Z'); return isFinite(x) && isFinite(y) ? Math.round(Math.abs(x - y) / 86400000) : null; }
function refKey(s) { return String(s || '').replace(/[^a-z0-9]/gi, '').toUpperCase(); }
export function sameReference(readRef, storedRef) {
  var a = refKey(readRef); var b = refKey(storedRef);
  if (a.length < 4 || b.length < 4) { return false; }
  return a === b || b.indexOf(a) >= 0 || a.indexOf(b) >= 0;
}

// wires = [{ id, label, payee_name, total, status, sent_date, planned_send_date, bank_reference, funding_txn_id }]
// → { status: 'proposed' | 'several' | 'no_wire', proposed: id|null, candidates: [{ id, label, score, reasons }] }
// A request drawn from a transfer has no bank confirmation (no wire leaves our bank), so it is never a candidate.
export function matchCandidates(read, wires) {
  var r = read || {}; var out = [];
  var usd = !r.currency || r.currency === 'USD';
  (wires || []).forEach(function (w) {
    if (!w || w.funding_txn_id || w.status === 'cancelled' || w.status === 'reversed') { return; }
    var score = 0; var why = [];
    if (r.reference && sameReference(r.reference, w.bank_reference) && !/recorded after the fact/i.test(String(w.bank_reference || ''))) { score += 6; why.push('same reference'); }
    if (usd && r.amount != null && Math.abs(r2(r.amount) - r2(w.total)) <= 0.005) { score += 3; why.push('same amount'); }
    if (r.beneficiary && payeeMatches(r.beneficiary, w.payee_name)) { score += 2; why.push('same recipient'); }
    var ref = w.sent_date || w.planned_send_date;
    var dd = r.sent_date && ref ? dayDiff(r.sent_date, ref) : null;
    if (dd != null && dd <= 3) { score += 1; why.push(w.sent_date ? 'sent date within 3 days' : 'wire date within 3 days'); }
    if (score >= 5) { out.push({ id: w.id, label: w.label, score: score, reasons: why }); }
  });
  out.sort(function (a, b) { return b.score - a.score; });
  if (!out.length) { return { status: 'no_wire', proposed: null, candidates: [] }; }
  var top = out[0];
  // exactly one strong candidate, or one clearly ahead (a reference match beats amount + recipient alone)
  if (out.length === 1 || top.score - out[1].score >= 3) { return { status: 'proposed', proposed: top.id, candidates: out.slice(0, 5) }; }
  return { status: 'several', proposed: null, candidates: out.slice(0, 5) };
}

var KIND_WORDS = { amount: 'a different amount', date: 'a different date', recipient: 'a different recipient', status: 'not shown as sent by the bank', currency: 'a currency other than US dollars', no_wire: 'no matching wire in the Hub', missing_confirmation: 'no bank confirmation', not_readable: 'could not be read' };
export function kindWords(kind) { return KIND_WORDS[kind] || kind; }

// what does not match once a person LINKED a read confirmation to a wire → [{ kind, note }] (note = for people who can see the wire)
export function discrepanciesFor(read, wire) {
  var r = read || {}; var w = wire || {}; var out = [];
  var total = r2(w.total);
  if (r.currency && r.currency !== 'USD') { out.push({ kind: 'currency', note: 'The confirmation is in ' + r.currency + ' — this wire is in US dollars.' }); }
  else if (r.amount != null && Math.abs(r2(r.amount) - total) > 0.005) { out.push({ kind: 'amount', note: 'The confirmation shows ' + r2(r.amount).toFixed(2) + ' — the wire is ' + total.toFixed(2) + '.' }); }
  if (r.beneficiary && w.payee_name && !payeeMatches(r.beneficiary, w.payee_name)) { out.push({ kind: 'recipient', note: 'The confirmation was sent to "' + r.beneficiary + '" — the wire is to ' + w.payee_name + '.' }); }
  if (r.status && !/^(sent|completed?|processed|executed|released|paid|success(ful)?)$/i.test(r.status)) { out.push({ kind: 'status', note: 'The bank shows this wire as "' + r.status + '".' }); }
  if (r.sent_date) {
    if (w.sent_date && r.sent_date !== String(w.sent_date).substring(0, 10)) { out.push({ kind: 'date', note: 'The confirmation is dated ' + r.sent_date + ' — the wire is recorded as sent ' + String(w.sent_date).substring(0, 10) + '.' }); }
    else if (!w.sent_date && w.planned_send_date) { var dd = dayDiff(r.sent_date, w.planned_send_date); if (dd != null && dd > 3) { out.push({ kind: 'date', note: 'The confirmation is dated ' + r.sent_date + ' — the wire date is ' + String(w.planned_send_date).substring(0, 10) + '.' }); } }
  }
  return out;
}

// the e-mail: says WHICH wire and WHAT kind of problem, never amounts, recipients or account numbers (each person opens the Hub,
// where their own access decides what they see)
export function noticeMail(kind, wireLabel, hubUrl) {
  var what = wireLabel ? 'Wire ' + wireLabel : 'A bank confirmation';
  var subject = 'Wire check needed: ' + what + ' — ' + kindWords(kind);
  var html = '<p>' + what + ' needs a look: <b>' + kindWords(kind) + '</b>.</p>'
    + '<p>Open the Hub → 🏦 Wires → 📥 Bank confirmations to see the note and the file.</p>'
    + (hubUrl ? '<p><a href="' + hubUrl + '">' + hubUrl + '</a></p>' : '')
    + '<p style="color:#64748b;font-size:12px">Sent to everyone with ClickBooks access. No amounts or account details are in this e-mail.</p>';
  return { subject: subject, html: html };
}

export function inboxPathOk(p) { var s = String(p || ''); return s.indexOf('pv/wire-inbox-') === 0 && s.indexOf('..') < 0 && s.length <= 240; }
export { normRef };
