// v55.83-ZP — partner-fee bills on wires and in the RTM / NextTrade funds (Max, 26 Nov 2026: "with partner fee if we find a charge
// for 45250 that is a bill for partner fee. should be placed in the correct column but sould not count twice as a bill paid in the
// wire"). Pure — used by the wire-packages route, the party-funds route and the screens, so there is ONE definition of a partner fee.
//
// A partner-fee bill is a bill whose category the P&L puts in column C (C · Partner fee): the same test as pnl-expenses letterOf,
// so a bill shown here as a partner fee is exactly the bill the P&L counts as one. On a wire it is still ONE bill line: its share is
// shown in the Partner fee column instead of the Bills column — never added a second time, and never also typed as a service fee.
import { letterOf } from './pnl-expenses';
import { vendorKey } from './bill-rules';

function cents(x) { var n = Number(x); return isFinite(n) ? Math.round(n * 100) : 0; }

export function isPartnerFeeCategory(category) {
  var k = String(category || '').trim(); if (!k) { return false; }
  return letterOf({ key: k, label: k, kind: 'expense' }) === 'C';
}
export function isPartnerFee(bill) { return !!bill && isPartnerFeeCategory(bill.category); }

// lines = [{ amount, bill: { category } }] → { bills_cents, partner_fee_cents, total_cents, partner_fee_bills }
// Each line counts in exactly ONE of the two columns; the two always add up to the lines' total.
export function splitWireLines(lines) {
  var out = { bills_cents: 0, partner_fee_cents: 0, total_cents: 0, partner_fee_bills: 0 };
  (lines || []).forEach(function (l) {
    var c = cents(l && l.amount); out.total_cents += c;
    if (isPartnerFee(l && l.bill)) { out.partner_fee_cents += c; out.partner_fee_bills++; } else { out.bills_cents += c; }
  });
  return out;
}

// What is still open on a bill (total − paid − credited), in cents, never below 0.
export function openCents(bill) {
  var b = bill || {}; var v = cents(b.total_amount) - cents(b.paid) - cents(b.credited);
  return v > 0 ? v : 0;
}

// A service fee (RTM / NextTrade wire, or "services rendered" in the funds) that is exactly the open amount of an unpaid partner-fee
// bill is most likely that bill typed as a fee: it would then be counted twice (as the fee AND, later, as the bill).
// partnerBills = [{ id, bill_number, vendor_name, total_amount, paid, credited, category }] → the matching bill, or null.
export function feeLooksLikePartnerBill(fee, partnerBills) {
  var f = cents(fee); if (f <= 0) { return null; }
  var hit = null;
  (partnerBills || []).forEach(function (b) { if (!hit && isPartnerFee(b) && openCents(b) === f) { hit = b; } });
  return hit;
}

// v55.83-ZP rev2 (Codex 26 Nov HOLD) — EVERY open partner-fee bill whose open amount equals the fee (recurring bills share one amount)
export function feeMatchesPartnerBills(fee, partnerBills) {
  var f = cents(fee); if (f <= 0) { return []; }
  return (partnerBills || []).filter(function (b) { return isPartnerFee(b) && openCents(b) === f; });
}

// A bill with NO category whose vendor and exact total match a partner-fee bill already on file (e.g. NexPac's monthly $45,250):
// flagged so a person can file it in the right column. Never applied by itself. bills = the other bills of the company.
// → { like: <the matching partner-fee bill> } or null
export function looksLikePartnerFee(bill, bills) {
  var b = bill || {};
  if (String(b.category || '').trim()) { return null; }
  var v = vendorKey(b.vendor_name); var t = cents(b.total_amount);
  if (!v || t <= 0) { return null; }
  var like = null;
  (bills || []).forEach(function (o) {
    if (like || !o || o.id === b.id) { return; }
    if (String(o.record_status || 'active') !== 'active') { return; }
    if (isPartnerFee(o) && vendorKey(o.vendor_name) === v && cents(o.total_amount) === t) { like = o; }
  });
  return like ? { like: like } : null;
}

// ── RTM / NextTrade funds with NO bills linked (Max, 26 Nov: "isnt the 76000 linked to bills so it was sent and spent toward ktc
//    bills"). Money sent and nothing linked shows as "held"; the screens then say so in plain words and offer the place to link.
export var OPEN_PARTY_FUNDS_EVENT = 'hub-open-party-funds'; // detail: { party, transfer_id? } → Bills → 🏦 Funds, at that transfer

// The partner-fee part of a list of payments ({ cents, category }) — shown as "of which partner fee", never deducted again.
export function partnerFeeOfRows(rows) {
  var c = 0; (rows || []).forEach(function (r) { if (r && isPartnerFeeCategory(r.category)) { c += Math.round(Number(r.cents) || 0); } });
  return c;
}

// One company in the funds box (its totals): money was sent and NOTHING of it is linked to a bill.
export function noBillsLinked(totals) {
  var T = totals || {};
  return Number(T.funds_sent) > 0.005 && !(Number(T.to_bills) > 0.005);
}
// The P&L period box: something is held (sent in these dates or before) and nothing was applied to a bill in these dates.
export function periodNoBillsLinked(period) {
  var p = period || {};
  return (Number(p.funds_sent_cents) > 0 || Number(p.opening_held_cents) > 0) && !(Number(p.applied_cents) > 0);
}
// Which transfer to open for linking: the given one, else the oldest with money sent and nothing linked to bills.
// recordable(t) says whether "📎 Record bills already paid" is open for it right now.
// → { transfer, how: 'record' | 'confirmed' | 'look' } or null
export function linkTarget(transfers, transferId, recordable) {
  var list = (transfers || []).filter(function (t) { return t && Number(t.sent) > 0.005; });
  var t = null;
  if (transferId) { list.forEach(function (x) { if (!t && String(x.id) === String(transferId)) { t = x; } }); }
  if (!t) { list.slice().sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); }).forEach(function (x) { if (!t && !(Number(x.to_bills) > 0.005)) { t = x; } }); }
  if (!t) { return null; }
  var how = recordable && recordable(t) ? 'record' : (t.status === 'confirmed' ? 'confirmed' : 'look');
  return { transfer: t, how: how };
}

// The same test for a whole list in one pass (the Bills screen): bill id → the partner-fee bill it looks like. Only ACTIVE bills
// with no category are flagged; only ACTIVE partner-fee bills count as the pattern.
export function partnerFeeLookalikes(bills) {
  var byKey = {}; var out = {};
  (bills || []).forEach(function (o) {
    if (!o || String(o.record_status || 'active') !== 'active' || !isPartnerFee(o)) { return; }
    var k = vendorKey(o.vendor_name) + '|' + cents(o.total_amount); if (!byKey[k]) { byKey[k] = o; }
  });
  (bills || []).forEach(function (b) {
    if (!b || String(b.record_status || 'active') !== 'active' || String(b.category || '').trim()) { return; }
    var v = vendorKey(b.vendor_name); var t = cents(b.total_amount); if (!v || t <= 0) { return; }
    var like = byKey[v + '|' + t]; if (like && like.id !== b.id) { out[b.id] = like; }
  });
  return out;
}
