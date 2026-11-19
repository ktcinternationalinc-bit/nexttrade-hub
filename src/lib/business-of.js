// v55.83-OS — THE single rule for "which business does this invoice belong to"
// (Max, Oct 13, verbatim): "they should only come from the ones that are
// entered or subject to pending move to wave. that is the usa business."
//
// US  = the invoice lives in Wave or is headed there: it came FROM Wave
//       (source wave_import), is already IN Wave (wave_invoice_id), or is
//       bound to a Wave business silo (wave_business_id — hub-created US
//       invoices get this at creation, i.e. "pending move to Wave").
// EGYPT = everything else: the Egyptian ledger never goes to Wave.
//
// Manual customer override wins in BOTH directions (business_tag on
// accounting_customers, set with one click on the Customers screen), and an
// EGP-denominated invoice is Egyptian regardless.
// v55.83-PB — the verified US Wave business (KTC INTERNATIONAL ENTERPRISES
// LLC), the same binding the ClickBooks book is fixed to. Used to scope
// bank-feed queries and new vendor bills to the US business.
export var US_WAVE_BUSINESS_ID = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';

export function businessOfInvoice(inv, custTagById) {
  if (!inv) { return 'US'; }
  // v55.83-VI (Max, Nov 19 2026, on the LUX invoice: "keep it on ktc egypt.. remove it from the usa side"; Codex 18 Nov 20:04) —
  // an invoice BOUND TO ANOTHER Wave business (today: KANDIL EGYPT) is never a USA invoice, whatever the customer's tag or the
  // currency says. It used to count as US just because it had some business id. An invoice with no business id at all keeps
  // the rules below (there are none on live today).
  if (inv.wave_business_id && inv.wave_business_id !== US_WAVE_BUSINESS_ID) { return 'EG'; }
  var tag = custTagById ? custTagById[inv.accounting_customer_id] : null;
  if (tag === 'egypt') { return 'EG'; }
  if (tag === 'us') { return 'US'; }
  if ((inv.currency || 'USD') === 'EGP') { return 'EG'; }
  if (inv.source === 'wave_import') { return 'US'; }
  if (inv.wave_invoice_id) { return 'US'; }
  if (inv.wave_business_id) { return 'US'; }
  return 'EG';
}
