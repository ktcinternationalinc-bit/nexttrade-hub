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
export function businessOfInvoice(inv, custTagById) {
  if (!inv) { return 'US'; }
  var tag = custTagById ? custTagById[inv.accounting_customer_id] : null;
  if (tag === 'egypt') { return 'EG'; }
  if (tag === 'us') { return 'US'; }
  if ((inv.currency || 'USD') === 'EGP') { return 'EG'; }
  if (inv.source === 'wave_import') { return 'US'; }
  if (inv.wave_invoice_id) { return 'US'; }
  if (inv.wave_business_id) { return 'US'; }
  return 'EG';
}
