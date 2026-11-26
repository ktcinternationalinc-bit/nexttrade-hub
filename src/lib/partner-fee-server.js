// v55.83-ZP — the partner-fee bills still open, for the service-fee guard (wires to RTM / NextTrade, "services rendered" in the
// funds). Server only. A failed read is NEVER "no partner-fee bills": the caller refuses the fee and says why (fail closed).
import { isPartnerFee, feeLooksLikePartnerBill } from './partner-fee';
import { loadBillCredits } from './vendor-credits-server';

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// → { bills: [{ id, bill_number, vendor_name, total_amount, category, paid, credited }] } or { error }
export async function openPartnerFeeBills(db) {
  var q = await db.from('vendor_bills').select('id, bill_number, vendor_name, total_amount, category, record_status').eq('record_status', 'active').not('category', 'is', null).limit(5000);
  if (q.error) { return { error: 'The partner-fee bills could not be read (' + (q.error.message || 'error') + ').' }; }
  var bills = (q.data || []).filter(isPartnerFee);
  if (!bills.length) { return { bills: [] }; }
  var ids = bills.map(function (b) { return b.id; });
  var paidBy = {};
  for (var i = 0; i < ids.length; i += 200) {
    var p = await db.from('vendor_bill_payments').select('bill_id, amount, voided').in('bill_id', ids.slice(i, i + 200));
    if (p.error) { return { error: 'The partner-fee bills\' payments could not be read (' + (p.error.message || 'error') + ').' }; }
    (p.data || []).forEach(function (x) { if (x.voided !== true) { paidBy[x.bill_id] = r2((paidBy[x.bill_id] || 0) + (Number(x.amount) || 0)); } });
  }
  var cr = await loadBillCredits(db, ids);
  if (cr.error) { return { error: cr.error }; }
  var credBy = cr.byBill || {};
  return { bills: bills.map(function (b) { return Object.assign({}, b, { paid: paidBy[b.id] || 0, credited: credBy[b.id] || 0 }); }) };
}

// The guard. fee = the service fee being saved; onThisWire = bill ids already on this wire (or []); override = { yes, reason }.
// → null (no partner-fee bill at that amount), { allowed: true, overridden: true, bill, reason } (a different fee, said so), or
// { status, error, bill } (refused). A refusal carries the bill so the screen can offer
// "＋ Add bill #N instead". The bill already being on THIS wire can never be overridden: the fee would count it a second time.
export async function partnerFeeGuard(db, fee, onThisWire, override) {
  if (!(Number(fee) > 0)) { return null; }
  var ob = await openPartnerFeeBills(db);
  if (ob.error) { return { status: 503, error: ob.error + ' The service fee was not saved: it could not be checked against the partner-fee bills.' }; }
  var hit = feeLooksLikePartnerBill(fee, ob.bills);
  if (!hit) { return null; }
  var label = '#' + (hit.bill_number || '?') + ' (' + (hit.vendor_name || 'vendor') + ')';
  var billOut = { id: hit.id, bill_number: hit.bill_number || null, vendor_name: hit.vendor_name || null, open: r2(Number(hit.total_amount) - (hit.paid || 0) - (hit.credited || 0)) };
  if ((onThisWire || []).map(String).indexOf(String(hit.id)) >= 0) {
    return { status: 409, code: 'partner_fee_on_wire', bill: billOut, error: 'Partner-fee bill ' + label + ' is already on this wire, so a service fee of the same amount would count the partner fee twice. Leave the service fee at 0.' };
  }
  var o = override || {};
  // a person who says it is a different fee, with a reason: allowed, and the caller audits the override with the bill it looked like
  if (o.yes === true && String(o.reason || '').trim().length >= 5) { return { allowed: true, overridden: true, bill: billOut, reason: String(o.reason).trim().substring(0, 300) }; }
  return { status: 409, code: 'partner_fee_as_fee', bill: billOut,
    error: 'That is the amount still open on partner-fee bill ' + label + '. Add that bill to the wire instead — it is then counted once, as that bill. If this really is a different fee, tick “It is a different fee” and say why.' };
}
