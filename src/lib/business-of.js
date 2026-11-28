// v55.83-OS — THE single rule for "which business does this invoice belong to"
// (Max, Oct 13, verbatim): "they should only come from the ones that are
// entered or subject to pending move to wave. that is the usa business."
//
// v55.83-VJ (Max, Nov 19 2026) — HOW IT IS DECIDED NOW, in this order:
//   1. the invoice is bound to ANOTHER Wave business (today: KANDIL EGYPT)      → EGYPT
//   2. the invoice is bound to the KTC US business: in Egyptian pounds → EGYPT, otherwise → US
//      (the customer's tag does not move it: one customer can be both a USA and an Egypt customer)
//   3. the invoice has NO business at all → the older rules below (customer tag, currency, Wave linkage)
// The answer is still only US or EG. When other books (RTM, NextTrade) carry invoices, step 1 must become a real business
// list — another business must not silently mean Egypt.
//
// Older rules, now only for step 3:
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
  // v55.83-VJ (Max, Nov 19 2026: a customer can be "both a usa and egyptian customer. but depends on the currency"; and "never by
  // the customer alone") — an invoice IN THE KTC USA business is decided by ITS OWN currency: Egyptian pounds → Egypt, anything
  // else → USA. The customer's egypt / us tag no longer moves such an invoice; the tag only decides invoices that carry no
  // business at all (below).
  if (inv.wave_business_id === US_WAVE_BUSINESS_ID) { return (inv.currency || 'USD') === 'EGP' ? 'EG' : 'US'; }
  var tag = custTagById ? custTagById[inv.accounting_customer_id] : null;
  if (tag === 'egypt') { return 'EG'; }
  if (tag === 'us') { return 'US'; }
  if ((inv.currency || 'USD') === 'EGP') { return 'EG'; }
  if (inv.source === 'wave_import') { return 'US'; }
  if (inv.wave_invoice_id) { return 'US'; }
  if (inv.wave_business_id) { return 'US'; }
  return 'EG';
}

export const US_INVOICE_EDIT_PERMISSION = 'invoices.us.edit';

export function isScopedUsInvoice(invoice) {
  return !!invoice && invoice.wave_business_id === US_WAVE_BUSINESS_ID &&
    businessOfInvoice(invoice) === 'US' &&
    (!invoice.record_status || invoice.record_status === 'active');
}
