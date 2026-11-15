// v55.83-AP — Record lifecycle rules (pure, testable). Decides which of
// delete / void / cancel / archive / restore are allowed for a record, given
// its usage and the user's role. WAVE-COMPAT INVARIANT: a record that carries
// a wave_customer_id / wave_invoice_id is NEVER hard-deletable — it can only be
// voided/archived, and callers must PRESERVE those ids (never null them) so
// re-import dedupe and future Hub->Wave sync keep working.

export var DELETE_ROLES = ['super_admin', 'owner', 'admin', 'accounting_manager'];

export function canManageLifecycle(role) {
  return DELETE_ROLES.indexOf(role) !== -1;
}

// usage: { invoiceCount, proformaCount, paymentCount, bankMatchCount }
export function customerLifecycle(customer, usage, role) {
  var c = customer || {};
  var u = usage || {};
  var hasHistory = (u.invoiceCount > 0) || (u.proformaCount > 0) || (u.paymentCount > 0) || (u.bankMatchCount > 0);
  var hasWaveLink = !!c.wave_customer_id;
  var archived = c.record_status === 'archived';
  var roleOk = canManageLifecycle(role);
  var blockReason = '';
  if (!roleOk) blockReason = 'You do not have permission to delete or archive.';
  else if (hasHistory) blockReason = 'This customer has invoices, proformas, payments, or bank matches — archive instead.';
  else if (hasWaveLink) blockReason = 'This customer is linked to Wave — archive instead so the Wave link is preserved.';
  return {
    canHardDelete: roleOk && !hasHistory && !hasWaveLink && !archived,
    canArchive: roleOk && !archived,
    canRestore: roleOk && archived,
    blockReason: blockReason
  };
}

// usage: { paymentMatchCount }
export function invoiceLifecycle(invoice, usage, role) {
  var inv = invoice || {};
  var u = usage || {};
  var syncedToWave = inv.wave_sync_status === 'synced' || !!inv.wave_invoice_id;
  var historical = inv.is_historical === true || inv.source === 'wave_import';
  var hasPayments = (u.paymentMatchCount > 0);
  var archived = inv.record_status === 'archived';
  var voided = inv.record_status === 'void' || inv.record_status === 'cancelled';
  var roleOk = canManageLifecycle(role);
  var blockReason = '';
  if (!roleOk) blockReason = 'You do not have permission.';
  else if (syncedToWave) blockReason = 'This invoice is linked/synced to Wave — void or archive instead (keeps the Wave link).';
  else if (historical) blockReason = 'This invoice was imported from Wave (historical) — void or archive instead.';
  else if (hasPayments) blockReason = 'This invoice has payment activity — void or archive instead.';
  return {
    canHardDelete: roleOk && !syncedToWave && !historical && !hasPayments && !archived && !voided,
    canVoid: roleOk && !archived && !voided,
    canCancel: roleOk && !archived && !voided,
    canArchive: roleOk && !archived,
    canRestore: roleOk && (archived || voided),
    blockReason: blockReason
  };
}

export function proformaLifecycle(proforma, role) {
  var pf = proforma || {};
  var converted = pf.status === 'converted' || !!pf.converted_invoice_id;
  var archived = pf.record_status === 'archived';
  var voided = pf.record_status === 'void' || pf.record_status === 'cancelled';
  var roleOk = canManageLifecycle(role);
  var blockReason = '';
  if (!roleOk) blockReason = 'You do not have permission.';
  else if (converted) blockReason = 'This proforma was converted to an invoice — void or archive instead.';
  return {
    canHardDelete: roleOk && !converted && !archived && !voided,
    canVoid: roleOk && !archived && !voided,
    canCancel: roleOk && !archived && !voided,
    canArchive: roleOk && !archived,
    canRestore: roleOk && (archived || voided),
    blockReason: blockReason
  };
}

// Fields a void/archive update may set. Intentionally does NOT include
// wave_customer_id / wave_invoice_id / wave_sync_status — those are preserved.
export function archivePatch(userId) {
  return { record_status: 'archived', archived_at: new Date().toISOString(), archived_by: userId || null };
}
export function voidPatch(userId, status, reason) {
  return { record_status: (status === 'cancelled' ? 'cancelled' : 'void'), void_reason: reason || null, archived_by: userId || null };
}
export function restorePatch() {
  return { record_status: 'active', archived_at: null };
}
