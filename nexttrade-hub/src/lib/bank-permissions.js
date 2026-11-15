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

// ---- Invoice / payment OPERATIONAL flags (staff may hold these) ----
// v55.83-HR (Codex P0) — these are DOCUMENT permissions and must NOT require bank.view. They are
// role-aware + carry legacy fallbacks so current staff are not locked out, but bank.view is
// intentionally never a fallback (viewing bank transactions must not imply document access).
export function canCreateInvoice(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['Invoice: Create', 'invoice.create', 'Edit Invoices']); }
export function canViewInvoices(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['Invoice: View', 'invoice.view', 'invoice.create', 'Edit Invoices', 'Invoices', 'Sales']); }
// ---- Accounting DOCUMENT view/edit (Codex ACCT-001..007) — explicit, NOT gated by bank.view ----
export function canViewAccountingCustomers(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['accounting.customers.view', 'accounting.customers.edit', 'Customers', 'customer.view_ar', 'Sales']); }
export function canEditAccountingCustomers(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['accounting.customers.edit', 'Merge Customers']); }
export function canViewCompanyProfile(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['accounting.company_profile.view', 'accounting.company_profile.edit']); }
export function canEditCompanyProfile(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['accounting.company_profile.edit']); }
export function canViewPurchaseOrders(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['purchase_orders.view', 'purchase_orders.edit', 'Invoice: View', 'invoice.view', 'Invoices']); }
export function canEditPurchaseOrders(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['purchase_orders.edit', 'Invoice: Create', 'invoice.create']); }
export function canViewInvoiceBalance(isSuperAdmin, mp) { return isSuperAdmin === true || has(mp, ['Invoice: View Balance', 'invoice.view_balance']); }
export function canViewPayments(isSuperAdmin, mp) { return isSuperAdmin === true || has(mp, ['Payments: View', 'payments.view']); }
export function canViewCustomerAr(isSuperAdmin, mp) { return isSuperAdmin === true || has(mp, ['Customer: View AR', 'customer.view_ar']); }
export function canViewTransactions(isSuperAdmin, mp) { return isSuperAdmin === true || has(mp, ['Bank: View Transactions', 'bank.view_transactions', 'Bank: View', 'bank.view']); }
export function canViewTransactionAmounts(isSuperAdmin, mp) { return isSuperAdmin === true || has(mp, ['Bank: View Transaction Amounts', 'bank.view_transaction_amounts', 'Bank: See Amounts', 'bank.see_amounts']); }

// ---- ADMIN / OWNER-only financial visibility (never granted to operational staff by default) ----
function isAdminRole(role) { return role === 'admin' || role === 'owner'; }
export function isFinanceAdmin(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['Finance: Admin', 'finance.admin']); }
export function canViewBankBalances(isSuperAdmin, mp, role) { return isFinanceAdmin(isSuperAdmin, mp, role) || has(mp, ['Bank: View Account Balances', 'bank.view_account_balances']); }
export function canViewCompanyTotals(isSuperAdmin, mp, role) { return isFinanceAdmin(isSuperAdmin, mp, role) || has(mp, ['Finance: View Company Totals', 'finance.view_company_totals']); }
export function canViewAllCustomerBalances(isSuperAdmin, mp, role) { return isFinanceAdmin(isSuperAdmin, mp, role) || has(mp, ['Finance: View All Customer Balances', 'finance.view_all_customer_balances']); }
export function canViewYearlySales(isSuperAdmin, mp, role) { return isFinanceAdmin(isSuperAdmin, mp, role) || has(mp, ['Finance: View Yearly Sales', 'finance.view_yearly_sales']); }
export function maskAmount(value, canSee) { return canSee ? value : '•••••'; }
// Reopen an approved transaction: Owner/Admin or Accounting Manager only.
export function canReopen(isSuperAdmin, mp, role) {
  if (isSuperAdmin === true) return true;
  if (role === 'admin' || role === 'owner' || role === 'accounting_manager') return true;
  return has(mp, ['Accounting Manager', 'Bank: Reopen', 'accounting.reopen']);
}

// ---- AR (Accounts Receivable) — FIRST-CLASS permissions, NOT bundled into invoice view ----
// Invoice-level balance (needed for payment matching) is separate from company-wide AR.
export function canViewArSummary(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['AR: View Summary', 'ar.view_summary', 'AR: Full', 'ar.full', 'Finance: View Company Totals', 'finance.view_company_totals']); }
export function canViewArCustomerBalances(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['AR: View Customer Balances', 'ar.view_customer_balances', 'AR: Full', 'ar.full', 'Finance: View All Customer Balances', 'finance.view_all_customer_balances']); }
export function canViewArInvoiceBalances(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['AR: View Invoice Balances', 'ar.view_invoice_balances', 'AR: Full', 'ar.full', 'Invoice: View Balance', 'invoice.view_balance', 'Payments: Match', 'payments.match']); }
// STRICT separation (v55.83-GH): overdue and upcoming-due are their OWN permissions. The general
// AR summary no longer grants them — only the specific key, AR: Full, or an admin/super role.
export function canViewArOverdue(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['AR: View Overdue', 'ar.view_overdue', 'AR: Full', 'ar.full']); }
export function canViewArUpcomingDue(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['AR: View Upcoming Due', 'ar.view_upcoming_due', 'AR: Full', 'ar.full']); }
// Manage (write) the overdue dashboard — Ignore / Un-ignore. Admin/super or explicit grant.
export function canManageOverdueDashboard(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['AR: Manage Overdue', 'ar.manage_overdue_dashboard']); }
export function canExportAr(isSuperAdmin, mp, role) { return isSuperAdmin === true || isAdminRole(role) || has(mp, ['AR: Export', 'ar.export', 'AR: Full', 'ar.full']); }

export var CLASSIFICATIONS = [
  'customer_payment', 'vendor_payment', 'transfer', 'refund', 'owner_contribution',
  'loan', 'payroll', 'bank_fee', 'other_income', 'other_expense', 'needs_clarification',
];
export var REVIEW_STATUSES = ['unreviewed', 'reviewed', 'approved', 'ignored', 'duplicate', 'needs_clarification'];
