// Format number with commas
export const fmt = (n) => {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
};

// v55.82-E — Robust amount parser for user-typed money fields.
//
// ROOT CAUSE FIXED HERE: Number(formData.amount) returned NaN for several
// real inputs Max types regularly:
//   • "5,000" — comma thousands separator → NaN
//   • "5 000" — space thousands separator → NaN
//   • "٥٠٠٠"  — Arabic-Indic digits → NaN  (frequent on iOS Arabic keyboard)
//   • "5000,50" — EU/Arabic decimal comma → NaN
// Postgres then either rejected the insert (silent fail because the toast
// got swallowed) or coerced NaN to 0 — either way the saved cash_in was
// not the amount the user typed.
//
// parseAmount() handles all of these. Returns 0 (not NaN) on unparseable
// input so callers can use the result directly in arithmetic without
// blowing up on isNaN. Use isValidAmount() if you need to validate
// presence vs zero.
//
// Implementation note: kept self-contained in utils.js (does NOT depend
// on shipping-import-helpers.js) because page.jsx already imports utils
// and the import chain matters for SWC compilation in API routes.
export const parseAmount = (raw) => {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
  let s = String(raw).trim();
  if (!s) return 0;
  // Arabic-Indic (٠-٩) → ASCII
  s = s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  // Persian/Urdu (۰-۹) → ASCII
  s = s.replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  // Strip every kind of whitespace, including NBSP that some keyboards inject
  s = s.replace(/[\s\u00A0]/g, '');
  if (!s) return 0;
  let clean = s.replace(/[^0-9.,\-]/g, '');
  if (!clean) return 0;
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1 && lastComma > lastDot) {
    // EU style: 1.234,56 — dot=thousands, comma=decimal
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastComma > -1 && lastDot === -1) {
    // Comma-only: ambiguous between thousands and decimal.
    // Heuristic: 2+ commas OR exactly 3 digits after the last comma → thousands.
    const commaCount = (clean.match(/,/g) || []).length;
    const afterComma = clean.length - lastComma - 1;
    if (commaCount > 1 || afterComma >= 3) clean = clean.replace(/,/g, '');
    else clean = clean.replace(',', '.');
  } else {
    // Dot-only or pure digits: comma stripping is safe.
    clean = clean.replace(/,/g, '');
  }
  const n = Number(clean);
  return isNaN(n) ? 0 : n;
};

// Companion check: did the user actually type a non-zero amount?
// Use this for validation ("Amount required") so 0 is treated as missing.
// parseAmount("") returns 0 too — this disambiguates.
export const isValidAmount = (raw) => {
  const n = parseAmount(raw);
  return n > 0;
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
  // v55.83-A.6.8 (Max May 13 2026) — write-off awareness. If a customer
  // short-paid by 50 EGP and we wrote it off, the "effective expected"
  // is invoice.total_amount - total_written_off. So comparisons of
  // treasuryTotal against expected amount must subtract written-off.
  // Without this, every written-off invoice would show MISMATCH because
  // treasury < total_amount.
  const writtenOff = Number(invoice.total_written_off || 0);
  const effectiveExpected = Math.max(0, Number(invoice.total_amount || 0) - writtenOff);
  // If invoice notes say UNVERIFIED, always show unverified
  if ((invoice.notes || '').includes('UNVERIFIED')) return 'unverified';
  // If says paid but no treasury entries, it's unverified
  if (invoice.total_collected > 0 && treasuryTotal === 0 && invoice.total_amount > 0) return 'unverified';
  // If treasury exists but doesn't match collected amount (>2% gap)
  if (treasuryTotal > 0 && invoice.total_collected > 0 && Math.abs(treasuryTotal - invoice.total_collected) > invoice.total_collected * 0.02) return 'mismatch';
  if (invoice.outstanding > tolerance) return 'open';
  // Compare against effective expected (post-write-off) so an invoice
  // closed via small write-off shows RECONCILED, not OVERPAID.
  if (treasuryTotal > effectiveExpected * 1.02) return 'overpaid';
  if (treasuryTotal >= effectiveExpected * 0.98 || invoice.total_collected >= effectiveExpected * 0.98) return 'reconciled';
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

// ============================================================
// Strip auto-appended bank-reconciliation metadata from a treasury
// description so the underlying text (typically a customer name or
// payment note) can be used for things like pre-filling a "Create
// Invoice" form. WITHOUT this, the customer name field on the new
// invoice ended up reading e.g. "ايداع اشرف سلطان ✅ matched bank
// 2026-03-29" — bank-match metadata that doesn't belong on an invoice.
//
// Three suffixes are added by the reconciliation system:
//   1.  [awaiting bank confirmation]                   — placeholder insert
//   2.  ✅ matched bank YYYY-MM-DD                      — placeholder match
//   3.  [auto-matched from bank YYYY-MM-DD]            — check auto-match
//
// All three live AT THE END of the description with a leading space,
// so we strip from the first occurrence of any of them onward.
// ============================================================
export const stripBankMatchMetadata = (desc) => {
  if (!desc || typeof desc !== 'string') return desc || '';
  return desc
    .replace(/\s*✅\s*matched\s+bank\s+\d{4}-\d{2}-\d{2}.*$/u, '')
    .replace(/\s*\[awaiting bank confirmation\]/g, '')
    .replace(/\s*\[auto-matched from bank \d{4}-\d{2}-\d{2}\]/g, '')
    .trim();
};

// ============================================================
// Rich-text sanitizer for ticket comments (R8)
// Allow-lists exactly the tags produced by the toolbar editor:
//   b, strong, i, em, u, br, ul, ol, li, p, div, span
// Everything else — script, iframe, img, a with javascript:, on*
// handlers, style attrs, any tag not in the allow-list — is stripped.
// The output is safe for dangerouslySetInnerHTML.
// ============================================================
const RT_ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'ul', 'ol', 'li', 'p', 'div', 'span']);

export const sanitizeRichText = (html) => {
  if (!html || typeof html !== 'string') return '';
  var s = String(html);
  // 1. Remove script / style / iframe / object blocks entirely (incl. content)
  s = s.replace(/<(script|style|iframe|object|embed|link|meta|base)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(script|style|iframe|object|embed|link|meta|base)\b[^>]*\/?>/gi, '');
  // 2. Collapse whitespace (incl. newlines/tabs) and HTML-entity whitespace inside
  //    tag opening sequences. This defeats bypasses like `<b on\nerror=...>` or
  //    `<b on&#10;click=...>` where an event-handler name is split by whitespace.
  //    We normalize any <tag ...> run so attribute regexes can reliably match.
  s = s.replace(/<([a-zA-Z][^>]*)>/g, function(_, inner) {
    // Decode common HTML-entity whitespace (&#9;&#10;&#13;&nbsp;) inside attributes
    var cleaned = inner
      .replace(/&#0*(9|10|13|32);?/g, ' ')
      .replace(/&#x0*(9|a|d|20);?/gi, ' ')
      .replace(/&nbsp;/gi, ' ')
      // Collapse any [\s]+ (including newlines, tabs) to a single space
      .replace(/[\s\u00A0]+/g, ' ');
    return '<' + cleaned + '>';
  });
  // 3. Strip event handlers on any remaining tag (on* =...) — now reliable after step 2
  s = s.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '');
  s = s.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  // 4. Strip javascript: urls (href/src)
  s = s.replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '');
  s = s.replace(/(href|src)\s*=\s*javascript:[^\s>]+/gi, '');
  // 5. Strip style and class attributes (prevent CSS injection / layout break)
  s = s.replace(/\sstyle\s*=\s*(['"]).*?\1/gi, '');
  s = s.replace(/\sclass\s*=\s*(['"]).*?\1/gi, '');
  // 6. Walk all tags, drop any not in the allow-list. Preserve inner text via the replace.
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, function(match, tag) {
    return RT_ALLOWED_TAGS.has(String(tag).toLowerCase()) ? match : '';
  });
  return s;
};

// Returns true if a string appears to contain HTML (for render decision)
export const isHtmlComment = (text) => {
  if (!text || typeof text !== 'string') return false;
  return /<(b|strong|i|em|u|br|ul|ol|li|p|div|span)\b[^>]*>/i.test(text);
};

// Strip ALL HTML from a rich-text comment to produce a plain-text preview
// (used in notifications where HTML would render as raw tags).
export const richTextToPlain = (html) => {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// ============================================================
// H3: Payment Source Breakdown
// Aggregates an invoice's linked treasury rows into amount-per-source buckets.
// Buckets: cash | bank | check | vodafone | instapay | other
// Per row contribution = cash_in + bank_in (same sum used elsewhere for
// total_collected). Only positive contributions counted.
// Falls back gracefully when `payment_source` is null (pre-backfill rows).
// Pure function — no React, no DB — safe to unit-test directly.
// ============================================================
export const PAYMENT_SOURCE_META = [
  { key: 'cash',     label: '💵 Cash',     labelAr: 'نقدي',    color: '#059669' },
  { key: 'bank',     label: '🏦 Bank',     labelAr: 'بنك',     color: '#6366f1' },
  { key: 'check',    label: '📝 Check',    labelAr: 'شيك',     color: '#d97706' },
  { key: 'vodafone', label: '📱 Vodafone', labelAr: 'فودافون', color: '#dc2626' },
  { key: 'instapay', label: '⚡ InstaPay', labelAr: 'إنستاباي', color: '#7c3aed' },
  { key: 'other',    label: '❓ Other',    labelAr: 'أخرى',    color: '#64748b' },
];

export const aggregatePaymentSources = (txns) => {
  const buckets = { cash: 0, bank: 0, check: 0, vodafone: 0, instapay: 0, other: 0 };
  if (!Array.isArray(txns)) return { buckets: buckets, total: 0 };

  // NaN-safe numeric coercion. Number("abc") = NaN, Number(undefined) = NaN — both
  // would poison buckets if not guarded. `+t || 0` converts NaN → 0.
  const n = (v) => { var x = Number(v); return isFinite(x) ? x : 0; };

  for (let i = 0; i < txns.length; i++) {
    const t = txns[i];
    if (!t || typeof t !== 'object') continue;
    let amt = n(t.cash_in) + n(t.bank_in);
    // v55.83-A.6.6 — virtual check rows shimmed from collected post-dated
    // checks have payment_source='check' and amount set, but no cash_in/
    // bank_in (the check is a separate object, not a treasury row). Recognize
    // those so the breakdown can include them. Real treasury rows from a
    // collected check unstamp path keep their cash_in semantics.
    if (amt <= 0 && String(t.payment_source || '').trim().toLowerCase() === 'check') {
      amt = n(t.amount) || n(t.check_amount);
    }
    if (amt <= 0) continue;

    let src = String(t.payment_source || '').trim().toLowerCase();
    // Fallback inference when payment_source is missing (pre-backfill rows)
    if (!src) {
      if (n(t.bank_in) > 0) {
        src = 'bank';
      } else if (t.cash_method === 'vodafone' || t.cash_method === 'instapay') {
        src = t.cash_method;
      } else {
        src = 'cash';
      }
    }

    if (Object.prototype.hasOwnProperty.call(buckets, src)) {
      buckets[src] += amt;
    } else {
      buckets.other += amt;
    }
  }

  const total = buckets.cash + buckets.bank + buckets.check + buckets.vodafone + buckets.instapay + buckets.other;
  return { buckets: buckets, total: total };
};
