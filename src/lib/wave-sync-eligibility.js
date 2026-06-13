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

// Payment push (§4/§8). Wave's public API does NOT reliably support creating money
// transactions, so payments are flagged UNSUPPORTED here rather than faked.
function paymentEligible(pay, invoice, customer) {
  if (!pay) { return { eligible: false, reason: 'no record' }; }
  if (pay.wave_payment_id) { return { eligible: false, reason: 'already in Wave (has wave_payment_id)' }; }
  if (pay.sync_status !== 'pending_wave_sync') { return { eligible: false, reason: 'not queued (sync_status ' + (pay.sync_status || 'none') + ')' }; }
  if (!invoice || !invoice.wave_invoice_id) { return { eligible: false, reason: 'invoice is not in Wave yet (no wave_invoice_id)' }; }
  if (!customer || !customer.wave_customer_id) { return { eligible: false, reason: 'customer is not in Wave yet (no wave_customer_id)' }; }
  if (!(Number(pay.amount) > 0)) { return { eligible: false, reason: 'amount must be positive' }; }
  if (!pay.payment_date) { return { eligible: false, reason: 'payment date required' }; }
  if (pay.source !== 'plaid_match' && pay.source !== 'manual' && pay.source !== 'manual_payment') { return { eligible: false, reason: 'source must be a Hub match or manual payment' }; }
  // Eligible by Hub rules, but Wave can't accept it:
  return { eligible: false, reason: 'Wave public API does not support creating payments — unsupported', unsupported: true };
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
    unlockPhrase: opts.unlockPhrase
  });
  if (!guard.ok) {
    return { verdict: 'dry_run_failed', code: guard.code, message: guard.message, wouldDo: null };
  }
  var wouldDo;
  if (opts.action === 'customer') { wouldDo = 'Create customer: ' + (opts.record.company_name || opts.record.name); }
  else if (opts.action === 'invoice') { wouldDo = 'Create invoice ' + opts.record.invoice_number + ' (total ' + opts.record.total_amount + ')'; }
  else { wouldDo = 'Apply payment'; }
  return { verdict: 'dry_run_ok', code: 'ok', message: 'Would push to the selected Wave business.', wouldDo: wouldDo };
}

export {
  customerEligible,
  invoiceEligible,
  paymentEligible,
  eligibilityFor,
  dryRunRecord
};
