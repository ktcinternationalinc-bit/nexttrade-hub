// v55.83-ZP — the partner-fee bills still open, for the service-fee guard (wires to RTM / NextTrade, "services rendered" in the
// funds). Server only. A failed read is NEVER "no partner-fee bills": the caller refuses the fee and says why (fail closed).
// rev2 (Codex 26 Nov HOLD): EVERY matching bill counts (recurring fee bills share one amount) and a match ON this wire wins; only the
// accounting company the wire / funds belong to, and only bills in the fee's currency; the bills and their payments are read in pages
// of 1,000 (the vendor credits come from loadBillCredits: 200 bills per request, NOT paged within a request); a refusal names a bill
// only to a person who may see bills.
import { isPartnerFee, feeMatchesPartnerBills } from './partner-fee';
import { loadBillCredits } from './vendor-credits-server';

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
var PAGE = 1000; var MAX_PAGES = 40;
function cur(x) { return String(x || 'USD').toUpperCase(); }

// all rows of a query, 1000 at a time (build() makes a fresh query each time). → { rows } or { error }
async function paged(build) {
  var out = [];
  for (var pg = 0; pg < MAX_PAGES; pg++) {
    var r = await build().range(pg * PAGE, pg * PAGE + PAGE - 1);
    if (r.error) { return { error: r.error }; }
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < PAGE) { return { rows: out }; }
  }
  return { error: { message: 'more than ' + (PAGE * MAX_PAGES) + ' rows' } };
}

// opts = { businessId (required), currency } → { bills: [{ id, bill_number, vendor_name, total_amount, category, currency, paid, credited }] } or { error }
export async function openPartnerFeeBills(db, opts) {
  var o = opts || {};
  if (!o.businessId) { return { error: 'The accounting company of this fee is not known.' }; }
  var q = await paged(function () {
    return db.from('vendor_bills').select('id, bill_number, vendor_name, total_amount, category, record_status, currency, wave_business_id')
      .eq('record_status', 'active').eq('wave_business_id', o.businessId).not('category', 'is', null).order('id', { ascending: true });
  });
  if (q.error) { return { error: 'The partner-fee bills could not be read (' + (q.error.message || 'error') + ').' }; }
  var want = cur(o.currency);
  var bills = q.rows.filter(function (b) { return isPartnerFee(b) && String(b.wave_business_id) === String(o.businessId) && cur(b.currency) === want; });
  if (!bills.length) { return { bills: [] }; }
  var ids = bills.map(function (b) { return b.id; });
  var paidBy = {};
  for (var i = 0; i < ids.length; i += 200) {
    var part = ids.slice(i, i + 200);
    var p = await paged(function () { return db.from('vendor_bill_payments').select('id, bill_id, amount, voided').in('bill_id', part).order('id', { ascending: true }); });
    if (p.error) { return { error: 'The partner-fee bills\' payments could not be read (' + (p.error.message || 'error') + ').' }; }
    p.rows.forEach(function (x) { if (x.voided !== true) { paidBy[x.bill_id] = r2((paidBy[x.bill_id] || 0) + (Number(x.amount) || 0)); } });
  }
  var cr = await loadBillCredits(db, ids);
  if (cr.error) { return { error: cr.error }; }
  var credBy = cr.byBill || {};
  return { bills: bills.map(function (b) { return Object.assign({}, b, { paid: paidBy[b.id] || 0, credited: credBy[b.id] || 0 }); }) };
}

// The guard. fee = the service fee being saved; onThisWire = bill ids already on this wire (or []); override = { yes, reason };
// opts = { businessId, currency, canSeeBills }.
// → null (no partner-fee bill at that amount), { allowed: true, overridden: true, bill, reason } (a different fee, said so), or
// { status, code, error, bill } (refused). A refusal names the bill (so the screen can offer "＋ Add bill #N instead") only when the
// person may see bills; otherwise bill is null and the words say a partner-fee bill they cannot see has that amount.
// Any matching bill already ON this wire wins and can never be overridden: the fee would count it a second time.
export async function partnerFeeGuard(db, fee, onThisWire, override, opts) {
  if (!(Number(fee) > 0)) { return null; }
  var op = opts || {};
  var ob = await openPartnerFeeBills(db, { businessId: op.businessId, currency: op.currency });
  if (ob.error) { return { status: 503, error: ob.error + ' The service fee was not saved: it could not be checked against the partner-fee bills.' }; }
  var hits = feeMatchesPartnerBills(fee, ob.bills);
  if (!hits.length) { return null; }
  var onW = (onThisWire || []).map(String);
  var onHit = hits.filter(function (h) { return onW.indexOf(String(h.id)) >= 0; })[0] || null;
  var hit = onHit || hits[0];
  var see = op.canSeeBills === true;
  var billOut = { id: hit.id, bill_number: hit.bill_number || null, vendor_name: hit.vendor_name || null, open: r2(Number(hit.total_amount) - (hit.paid || 0) - (hit.credited || 0)) };
  var label = see ? '#' + (hit.bill_number || '?') + ' (' + (hit.vendor_name || 'vendor') + ')' : null;
  if (onHit) {
    return { status: 409, code: 'partner_fee_on_wire', bill: see ? billOut : null,
      error: (see ? 'Partner-fee bill ' + label + ' is' : 'A partner-fee bill of this amount is') + ' already on this wire, so a service fee of the same amount would count the partner fee twice. Leave the service fee at 0.' };
  }
  var o = override || {};
  // a person who says it is a different fee, with a reason: allowed, and the caller audits the override with the bill it looked like
  if (o.yes === true && String(o.reason || '').trim().length >= 5) {
    return { allowed: true, overridden: true, bill: billOut, matches: hits.length, reason: String(o.reason).trim().substring(0, 300) };
  }
  return { status: 409, code: 'partner_fee_as_fee', bill: see ? billOut : null, matches: hits.length,
    error: see
      ? 'That is the amount still open on partner-fee bill ' + label + (hits.length > 1 ? ' (and ' + (hits.length - 1) + ' other partner-fee bill' + (hits.length > 2 ? 's' : '') + ' of the same amount)' : '') + '. Add that bill to the wire instead — it is then counted once, as that bill. If this really is a different fee, tick “It is a different fee” and say why.'
      : 'That is the amount still open on a partner-fee bill you cannot see. Ask someone with 💸 Bills access to add that bill instead — it is then counted once, as that bill. If this really is a different fee, tick “It is a different fee” and say why.' };
}
