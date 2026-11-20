// v55.83-VZ — server only. Does this proforma have records that must be kept for ever (a signed copy, or a link to an invoice —
// also an unlinked one: it is history)? Used by /api/accounting/invoice-lifecycle to refuse a hard DELETE of such a proforma;
// the database refuses it too (foreign keys, sql/v55-83-VZ-proforma-links-signed.sql). A database that has not had that update
// yet has no such records: count 0, not an error. SWC-safe: var + string concatenation.
export var PROFORMA_KEEP_REFUSAL = 'This proforma has a signed copy or a link to an invoice on file, and those are kept for ever. It cannot be deleted — archive or void it instead (the signed copy and the links stay with it).';

function missing(err) { return /does not exist|Could not find|schema cache/i.test(String((err && err.message) || '')); }

export async function proformaHasKeptRecords(db, proformaId) {
  var out = { signed: 0, links: 0 };
  var f = await db.from('accounting_proforma_signed_files').select('id').eq('proforma_id', proformaId).limit(1);
  if (f.error) { if (!missing(f.error)) { return { error: f.error.message }; } } else { out.signed = (f.data || []).length; }
  var l = await db.from('accounting_proforma_invoice_links').select('id').eq('proforma_id', proformaId).limit(1);
  if (l.error) { if (!missing(l.error)) { return { error: l.error.message }; } } else { out.links = (l.data || []).length; }
  return out;
}
