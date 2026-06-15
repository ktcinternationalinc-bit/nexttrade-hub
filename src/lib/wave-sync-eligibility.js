// wave-sync-eligibility.js
// Pure logic for the Wave Sync Center: decides what is ELIGIBLE to push, and
// performs the DRY RUN evaluation per record using the wave-silo guard. No network,
// no DB — callers pass plain records + the registry. Pairs with wave-silo-guard.js.
//
// Backward-compat rule (hard): never push a record that already exists in Wave
// (has wave_customer_id / wave_invoice_id / wave_payment_id).

import { assertCanPush } from './wave-silo-guard';

// --- Eligibility: would this record ever be a push candidate for `action`? ---
// Returns { eligible:boolean, reason:string }
function customerEligible(c) {
  if (!c) { return { eligible: false, reason: 'no record' }; }
  if (c.wave_customer_id) { return { eligible: false, reason: 'already in Wave (has wave_customer_id)' }; }
  if (c.source === 'wave_import') { return { eligible: false, reason: 'imported from Wave — not Hub-created' }; }
  if (!(c.company_name || c.name)) { return { eligible: false, reason: 'missing customer name' }; }
  return { eligible: true, reason: 'Hub-created customer, not yet in Wave' };
}

function invoiceEligible(inv) {
  if (!inv) { return { eligible: false, reason: 'no record' }; }
  if (inv.wave_invoice_id) { return { eligible: false, reason: 'already in Wave (has wave_invoice_id)' }; }
  if (inv.source === 'wave_import' || inv.is_historical === true) { return { eligible: false, reason: 'historical / imported from Wave' }; }
  if (inv.approval_status && inv.approval_status !== 'approved') { return { eligible: false, reason: 'not approved (status ' + inv.approval_status + ')' }; }
  if (!(inv.invoice_number)) { return { eligible: false, reason: 'missing invoice number' }; }
  if (inv.total_amount == null) { return { eligible: false, reason: 'missing total' }; }
  return { eligible: true, reason: 'Hub-created approved invoice, not yet in Wave' };
}

// Payment push: invoicePaymentCreateManual records a payment against an existing Wave
// invoice. Eligibility uses the invoice's wave_invoice_id (carried on the payment row by the
// sync queue) as the source of truth — never reject solely because the payment's own cached
// wave_invoice_id is null. paymentAccountId is required by the push but configured per
// business in settings, so its absence is a "needs setup" blocker, not ineligibility.
function paymentEligible(pay, invoice, customer) {
  if (!pay) { return { eligible: false, reason: 'no record' }; }
  if (pay.wave_payment_id) { return { eligible: false, reason: 'already in Wave (has wave_payment_id)' }; }
  if (pay.voided === true) { return { eligible: false, reason: 'payment is voided/reversed' }; }
  // Queueable statuses mirror the Wave Sync queue's ACTIONABLE set: a fresh payment plus any
  // retryable state (a prior push that FAILED is retryable, not permanently skipped). 'syncing'
  // is excluded (in flight); synced/voided are already excluded by the checks above.
  var QUEUEABLE_STATUS = { 'pending_wave_sync': 1, 'manual_wave_action_required': 1, 'payment_schema_pending': 1, 'sync_failed': 1, 'failed': 1 };
  if (!QUEUEABLE_STATUS[pay.sync_status]) { return { eligible: false, reason: 'not queued (sync_status ' + (pay.sync_status || 'none') + ')' }; }
  // Source of truth: invoice's wave id, falling back to the payment row's carried copy.
  var invWaveId = (invoice && invoice.wave_invoice_id) || pay.wave_invoice_id || null;
  var custWaveId = (customer && customer.wave_customer_id) || pay.wave_customer_id || null;
  if (!invWaveId) { return { eligible: false, reason: 'invoice is not in Wave yet (no wave_invoice_id)' }; }
  if (!custWaveId) { return { eligible: false, reason: 'customer is not in Wave yet (no wave_customer_id)' }; }
  if (!(Number(pay.amount) > 0)) { return { eligible: false, reason: 'amount must be positive' }; }
  if (!pay.payment_date) { return { eligible: false, reason: 'payment date required' }; }
  if (pay.source !== 'plaid_match' && pay.source !== 'manual' && pay.source !== 'manual_payment') { return { eligible: false, reason: 'source must be a Hub match or manual payment' }; }
  // Eligible by Hub rules. Actual Wave push readiness (paymentAccountId configured + field
  // schema verified) is enforced in the push route, which returns a truthful blocker.
  return { eligible: true, reason: 'Ready for payment push (invoicePaymentCreateManual)', invWaveId: invWaveId, custWaveId: custWaveId };
}

function eligibilityFor(action, record, related) {
  related = related || {};
  if (action === 'customer') { return customerEligible(record); }
  if (action === 'invoice') { return invoiceEligible(record); }
  if (action === 'payment') { return paymentEligible(record, related.invoice, related.customer); }
  return { eligible: false, reason: 'unknown action ' + action };
}

// --- Dry run: combine eligibility + the silo guard into one verdict per record. ---
// opts: { action, record, related, waveBusinessId, registry, unlockPhrase }
// Returns { verdict, code, message, wouldDo }
function dryRunRecord(opts) {
  var elig = eligibilityFor(opts.action, opts.record, opts.related);
  if (!elig.eligible) {
    return { verdict: elig.unsupported ? 'unsupported' : 'skipped', code: 'not_eligible', message: elig.reason, wouldDo: null };
  }
  var guard = assertCanPush({
    waveBusinessId: opts.waveBusinessId,
    registry: opts.registry,
    record: opts.record,
    action: opts.action,
    unlockPhrase: opts.unlockPhrase,
    dryRun: true
  });
  if (!guard.ok) {
    return { verdict: 'dry_run_failed', code: guard.code, message: guard.message, wouldDo: null };
  }
  var wouldDo;
  if (opts.action === 'customer') { wouldDo = 'Create customer: ' + (opts.record.company_name || opts.record.name); }
  else if (opts.action === 'invoice') { wouldDo = 'Create invoice ' + opts.record.invoice_number + ' (total ' + opts.record.total_amount + ')'; }
  else { wouldDo = 'Record payment ' + (opts.record.amount != null ? opts.record.amount : '') + ' on invoice ' + (opts.record._invoice_number || opts.record.wave_invoice_id || '?') + ' (invoicePaymentCreateManual)'; }
  var tgtReg = null;
  var rlist = opts.registry || [];
  var ri;
  for (ri = 0; ri < rlist.length; ri++) { if (rlist[ri] && rlist[ri].wave_business_id === opts.waveBusinessId) { tgtReg = rlist[ri]; } }
  var tgtName = tgtReg ? (tgtReg.label || opts.waveBusinessId) : opts.waveBusinessId;
  return { verdict: 'dry_run_ok', code: 'ok', message: 'Would push to ' + tgtName + ' (' + opts.waveBusinessId + ').', wouldDo: wouldDo, targetBusinessId: opts.waveBusinessId, targetBusinessName: tgtName };
}

export {
  customerEligible,
  invoiceEligible,
  paymentEligible,
  eligibilityFor,
  dryRunRecord
};
