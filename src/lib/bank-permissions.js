// v55.83-Z — Phase 2 bank/accounting permission gates (app-layer, pure).
// Mirrors the app's existing module-permission convention. super_admin passes all.
function has(mp, keys) {
  if (!mp) return false;
  for (var i = 0; i < keys.length; i++) { if (mp[keys[i]] === true) return true; }
  return false;
}
export function canViewBank(isSuperAdmin, mp) { return isSuperAdmin === true || has(mp, ['Bank: View', 'bank.view']); }
export function canSeeAmounts(isSuperAdmin, mp) { return isSuperAdmin === true || has(mp, ['Bank: See Amounts', 'bank.see_amounts']); }
export function canClassify(isSuperAdmin, mp) { return isSuperAdmin === true || has(mp, ['Bank: Classify', 'bank.classify']); }
export function canMatchPayments(isSuperAdmin, mp) { return isSuperAdmin === true || has(mp, ['Payments: Match', 'payments.match']); }
export function canEditMappings(isSuperAdmin, mp) { return isSuperAdmin === true || has(mp, ['Accounting: Edit Mappings', 'accounting.edit_mappings']); }
export function maskAmount(value, canSee) { return canSee ? value : '•••••'; }
// Reopen an approved transaction: Owner/Admin or Accounting Manager only.
export function canReopen(isSuperAdmin, mp, role) {
  if (isSuperAdmin === true) return true;
  if (role === 'admin' || role === 'owner' || role === 'accounting_manager') return true;
  return has(mp, ['Accounting Manager', 'Bank: Reopen', 'accounting.reopen']);
}

export var CLASSIFICATIONS = [
  'customer_payment', 'vendor_payment', 'transfer', 'refund', 'owner_contribution',
  'loan', 'payroll', 'bank_fee', 'other_income', 'other_expense', 'needs_clarification',
];
export var REVIEW_STATUSES = ['unreviewed', 'reviewed', 'approved', 'ignored', 'duplicate', 'needs_clarification'];
