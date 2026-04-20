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

// Expense category translations (fallback map — supplemented by `categories` table)
export const EXPENSE_CATS = {
  'مبيعات': 'Sales',
  'عهدة المخزن': 'Warehouse',
  'مرتبات': 'Salaries',
  'مواصلات وسفر': 'Transport',
  'ايجار ومرافق': 'Rent',
  'عمالة واكراميات': 'Labor',
  'سحب المالك': 'Owner Draws',
  'تحويلات بنكية': 'Banking',
  'زكاة وصدقات': 'Charity',
  'شحن وجمارك': 'Shipping',
  'جمارك': 'Customs',
  'عينات': 'Samples',
  'ضرائب': 'Taxes',
  'مصروفات تشغيل': 'Operations',
};

// Reverse map — English name → Arabic. Used when a row's category
// is stored in English but we need the Arabic equivalent.
export const EXPENSE_CATS_REVERSE = Object.fromEntries(
  Object.entries(EXPENSE_CATS).map(([ar, en]) => [en, ar])
);

// Resolve a category key to the display name in the given language.
// Accepts either the Arabic or English form (whichever was saved).
// Consults the runtime categories list (from the DB) first, falls back to
// the static EXPENSE_CATS map, and as a last resort returns the raw key.
//
// @param raw   — the category string saved on the row (could be AR or EN)
// @param lang  — 'en' | 'ar'
// @param list  — optional array of categories rows from the `categories` table
//                shape: [{ name_ar, name_en, ... }, ...]
export const resolveCatName = (raw, lang, list) => {
  if (!raw) return '';
  const s = String(raw).trim();
  // Try the runtime list first — covers user-added categories
  if (Array.isArray(list) && list.length > 0) {
    const hit = list.find(c =>
      (c.name_ar && c.name_ar === s) || (c.name_en && c.name_en === s)
    );
    if (hit) {
      if (lang === 'ar') return hit.name_ar || hit.name_en || s;
      return hit.name_en || hit.name_ar || s;
    }
  }
  // Fallback to static map
  if (lang === 'ar') {
    // Input could be EN → look up AR
    if (EXPENSE_CATS_REVERSE[s]) return EXPENSE_CATS_REVERSE[s];
    return s; // already Arabic or unknown
  }
  // Lang = en — input could be AR → look up EN
  if (EXPENSE_CATS[s]) return EXPENSE_CATS[s];
  return s; // already English or unknown
};

// Detect whether a string is Arabic
export const isArabic = (s) => /[\u0600-\u06FF]/.test(String(s || ''));

// Build dropdown options for category selectors. Returns [{value,label,type}].
// `value` is always the stable internal key (Arabic name_ar). `label` is bilingual
// by default — "EN / AR" — so both audiences can find the item. If the live DB
// list is empty the hardcoded EXPENSE_CATS map is used as a fallback so the app
// keeps working before the migration is run.
// @param list  — array of {name_ar, name_en, type, active} rows from `categories`
// @param opts  — { type?: 'expense'|'income'|'both', lang?: 'bi'|'en'|'ar' }
export const buildCatOptions = (list, opts) => {
  const o = opts || {};
  const wantType = o.type || 'both';
  const lang = o.lang || 'bi';
  const seen = new Set();
  const out = [];

  const pushRow = (ar, en, rowType) => {
    const key = ar || en;
    if (!key || seen.has(key)) return;
    seen.add(key);
    let label;
    if (lang === 'en') label = en || ar;
    else if (lang === 'ar') label = ar || en;
    else if (ar && en && ar !== en) label = en + ' / ' + ar;
    else label = ar || en;
    out.push({ value: key, label: label, type: rowType || 'expense' });
  };

  if (Array.isArray(list) && list.length > 0) {
    list.forEach(c => {
      if (c && c.active === false) return;
      if (wantType !== 'both' && c && c.type && c.type !== wantType) return;
      pushRow(c && c.name_ar, c && c.name_en, c && c.type);
    });
  } else {
    // Fallback — use hardcoded EXPENSE_CATS
    Object.entries(EXPENSE_CATS).forEach(([ar, en]) => {
      pushRow(ar, en, ar === 'مبيعات' ? 'income' : 'expense');
    });
  }

  return out;
};

// Returns true when `raw` matches any known category by AR or EN name — either in
// the live DB list or in the static EXPENSE_CATS fallback map.
export const isKnownCat = (raw, list) => {
  if (!raw) return false;
  const s = String(raw).trim();
  if (!s) return false;
  if (Array.isArray(list) && list.length > 0) {
    for (const c of list) {
      if (!c) continue;
      if (c.name_ar === s || c.name_en === s) return true;
    }
  }
  if (EXPENSE_CATS[s]) return true;
  if (EXPENSE_CATS_REVERSE[s]) return true;
  return false;
};

// Chart colors
export const COLORS = [
  '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

// Warehouse expense categories (keyword-based)
export const WAREHOUSE_CATS = {
  'Transport': ['مواصلات', 'تاكس', 'تاكسى', 'سائق', 'السائق', 'نقل'],
  'Container': ['الكونتنر', 'كونتنر', 'تنزيل', 'تحميل', 'ميزان'],
  'Labor': ['عمال', 'افراد', 'اكراميه', 'يوميه'],
  'Phone': ['تليفون', 'كارت', 'كرت', 'رسائل', 'شحن كارت'],
  'Medical': ['علاج', 'دواء', 'طبيب'],
  'Supplies': ['ادوات', 'كتابيه', 'تصوير', 'مستندات', 'حبر', 'ورق'],
  'Food': ['اكل', 'سكر', 'شاى', 'مياه', 'غذاء'],
  'Rent': ['ايجار', 'كهرباء'],
  'Security': ['الغفره', 'غفير', 'حراسه', 'امن'],
  'Leather': ['الجلد', 'جلد'],
};

export const getWarehouseCat = (desc) => {
  for (const [cat, keywords] of Object.entries(WAREHOUSE_CATS)) {
    if (keywords.some(k => (desc || '').includes(k))) return cat;
  }
  return 'Other';
};

// Reconciliation status with 2% tolerance
export const getReconStatus = (invoice, treasuryTotal) => {
  const tolerance = invoice.total_amount * 0.02;
  // If invoice notes say UNVERIFIED, always show unverified
  if ((invoice.notes || '').includes('UNVERIFIED')) return 'unverified';
  // If says paid but no treasury entries, it's unverified
  if (invoice.total_collected > 0 && treasuryTotal === 0 && invoice.total_amount > 0) return 'unverified';
  // If treasury exists but doesn't match collected amount (>2% gap)
  if (treasuryTotal > 0 && invoice.total_collected > 0 && Math.abs(treasuryTotal - invoice.total_collected) > invoice.total_collected * 0.02) return 'mismatch';
  if (invoice.outstanding > tolerance) return 'open';
  if (treasuryTotal > invoice.total_amount * 1.02) return 'overpaid';
  if (treasuryTotal >= invoice.total_amount * 0.98 || invoice.total_collected >= invoice.total_amount * 0.98) return 'reconciled';
  return 'unverified';
};

// Status badge colors
export const STATUS_STYLES = {
  reconciled: { bg: '#dcfce7', color: '#16a34a', icon: '✅', label: 'RECONCILED / تم التسوية' },
  overpaid: { bg: '#ffedd5', color: '#c2410c', icon: '🟠', label: 'OVERPAID / دفع زائد' },
  mismatch: { bg: '#fef3c7', color: '#b45309', icon: '⚡', label: 'MISMATCH / عدم تطابق' },
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
  if (mode === 'ytd') {
    const year = new Date().getFullYear();
    return d >= year + '-01-01';
  }
  if (mode === '1mo') {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    return d >= oneMonthAgo.toISOString().substring(0, 10);
  }
  if (mode === '3mo') {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    return d >= threeMonthsAgo.toISOString().substring(0, 10);
  }
  if (mode === '1yr') {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    return d >= oneYearAgo.toISOString().substring(0, 10);
  }
  if (mode === '3yr') {
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    return d >= threeYearsAgo.toISOString().substring(0, 10);
  }
  return d >= df && d <= dt;
};

// Sanitize text input — strip HTML tags and script injections
export const sanitize = (str) => {
  if (!str || typeof str !== 'string') return str || '';
  return str.replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').replace(/on\w+\s*=/gi, '').trim();
};
