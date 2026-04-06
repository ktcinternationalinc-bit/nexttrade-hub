// Format number with commas
export const fmt = (n) => {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
};

// Format as EGP currency
export const fE = (n) => {
  if (n == null || isNaN(n)) return '—';
  return 'EGP ' + fmt(n);
};

// Expense category translations
export const EXPENSE_CATS = {
  'عهدة المخزن': 'Warehouse',
  'مرتبات': 'Salaries',
  'مواصلات وسفر': 'Transport',
  'ايجار ومرافق': 'Rent',
  'عمالة واكراميات': 'Labor',
  'سحب المالك': 'Owner Draws',
  'تحويلات بنكية': 'Banking',
  'زكاة وصدقات': 'Charity',
  'شحن وجمارك': 'Shipping',
  'عينات': 'Samples',
  'ضرائب': 'Taxes',
  'مصروفات تشغيل': 'Operations',
};

// Chart colors
export const COLORS = [
  '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

// Reconciliation status with 2% tolerance
export const getReconStatus = (invoice, treasuryTotal) => {
  const tolerance = invoice.total_amount * 0.02;
  // If invoice notes say UNVERIFIED, always show unverified
  if ((invoice.notes || '').includes('UNVERIFIED')) return 'unverified';
  // If says paid but no treasury entries, it's unverified
  if (invoice.total_collected > 0 && treasuryTotal === 0 && invoice.total_amount > 0) return 'unverified';
  if (invoice.outstanding > tolerance) return 'open';
  if (treasuryTotal > invoice.total_amount * 1.02) return 'overpaid';
  if (treasuryTotal >= invoice.total_amount * 0.98 || invoice.total_collected >= invoice.total_amount * 0.98) return 'reconciled';
  return 'unverified';
};

// Status badge colors
export const STATUS_STYLES = {
  reconciled: { bg: '#dcfce7', color: '#16a34a', icon: '✅', label: 'RECONCILED / تم التسوية' },
  overpaid: { bg: '#ffedd5', color: '#c2410c', icon: '🟠', label: 'OVERPAID / دفع زائد' },
  unverified: { bg: '#fef3c7', color: '#d97706', icon: '⚠️', label: 'UNVERIFIED / غير مؤكد' },
  open: { bg: '#fef2f2', color: '#dc2626', icon: '🔴', label: 'OPEN / مفتوح' },
};

// Date helpers
export const today = () => new Date().toISOString().substring(0, 10);
export const monthOf = (d) => d ? d.substring(0, 7) : '';
export const yearOf = (d) => d ? parseInt(d.substring(0, 4)) : 0;

// Check if date is in range
export const inRange = (d, mode, df, dt) => {
  if (!d || d.length < 4) return mode === 'all';
  if (mode === 'all') return true;
  if (mode === '3yr') return d >= '2024';
  return d >= df && d <= dt;
};
