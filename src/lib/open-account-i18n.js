// v55.83-A.6.27.72 HOTFIX 30/31 — Bilingual translation dictionary.
//
// Shared by:
//   - The ledger UI (EN/AR/Both toggle on OpenAccountsTab)
//   - printAccountLedger() and exportAccountLedgerToExcel() in open-account-export.js
//
// Add new keys by adding both an en and an ar field. Get a localized
// label via:  T('date', 'en')  or  T('date', 'ar')
// Or fetch the whole pair:  P('date') → { en, ar }
//
// PERSPECTIVE: many type labels have a `customer_en` variant that's flipped
// to the customer's point of view (a vendor_bill on our books is an INVOICE
// they issued to us — so on the customer copy we show "Invoice"). The
// reference number itself is NEVER flipped (we keep BILL-XXX as-is on both
// copies so the document matches across reconciliations). See HOTFIX 31.

var DICT = {
  // ─── Column headers ───
  date:               { en: 'Date',              ar: 'التاريخ' },
  type:               { en: 'Type',              ar: 'النوع' },
  description:        { en: 'Description',       ar: 'الوصف' },
  reference:          { en: 'Reference',         ar: 'المرجع' },
  // Customer-friendly versions (HOTFIX 30 — "AR Side" / "AP Side" were
  // internal accounting terms that confused customers)
  they_owe_us:        { en: 'They Owe Us',       ar: 'لنا عليهم', customer_en: 'You Owe Us' },
  we_owe_them:        { en: 'We Owe Them',       ar: 'لهم علينا', customer_en: 'Owed to You' },
  open_balance:       { en: 'Open Balance',      ar: 'الرصيد المفتوح' },
  running_bal:        { en: 'Running Bal.',      ar: 'الرصيد الجاري' },

  // ─── Document header ───
  customer_statement: { en: 'Customer Statement',  ar: 'كشف حساب العميل' },
  internal_statement: { en: 'Internal Statement',  ar: 'كشف حساب داخلي' },
  account:            { en: 'Account',             ar: 'الحساب' },
  statement_date:     { en: 'Statement Date',      ar: 'تاريخ الكشف' },
  period:             { en: 'Period',              ar: 'الفترة' },
  amounts_in:         { en: 'All amounts in',     ar: 'جميع المبالغ بـ' },

  // ─── Transaction types (internal perspective is default; customer flips) ───
  sales_invoice:      { en: 'Sales Invoice',       ar: 'فاتورة بيع',
                        customer_en: 'Bill',       customer_ar: 'فاتورة شراء' },
  vendor_bill:        { en: 'Vendor Bill',         ar: 'فاتورة مورد',
                        customer_en: 'Invoice',    customer_ar: 'فاتورة بيع' },
  payment_received:   { en: 'Payment Received',    ar: 'دفعة مستلمة',
                        customer_en: 'Payment Sent', customer_ar: 'دفعة مرسلة' },
  payment_sent:       { en: 'Payment Sent',        ar: 'دفعة مرسلة',
                        customer_en: 'Payment Received', customer_ar: 'دفعة مستلمة' },
  credit_adjustment:  { en: 'Credit Adj',          ar: 'تسوية دائنة' },
  // v55.83-A.6.27.72 HOTFIX 31 — internal type stays 'offset' in DB; UI label
  // is "Credit Applied" everywhere users/customers see it.
  offset:             { en: 'Credit Applied',      ar: 'تطبيق رصيد' },

  // ─── Status badges ───
  paid:               { en: '✓ paid',              ar: '✓ مدفوع' },
  open:               { en: 'Open',                ar: 'مفتوح' },
  paid_by_credit:           { en: 'Settled by offset against', ar: 'مُسوى مقابل' },
  partially_applied:        { en: 'Partially settled by offset against', ar: 'مُسوى جزئياً مقابل' },
  // v55.83-A.6.27.72 HOTFIX 33 — Type-aware suffixes per Max v2 feedback. Avoids
  // the misleading "credit applied" phrasing — these are offsets between sales
  // invoices and vendor bills, not credit notes.
  type_sales_invoice_short: { en: 'sales invoice', ar: 'فاتورة بيع' },
  type_vendor_bill_short:   { en: 'vendor bill',   ar: 'فاتورة مورد' },

  // ─── Summary / net direction (customer-flipped) ───
  total_they_owe:     { en: 'Total They Owe Us',   ar: 'إجمالي لنا عليهم',
                        customer_en: 'Total You Owe Us' },
  total_we_owe:       { en: 'Total We Owe Them',   ar: 'إجمالي لهم علينا',
                        customer_en: 'Total Owed to You' },
  their_prepaid:      { en: 'Their Prepaid',       ar: 'دفعات مقدمة منهم',
                        customer_en: 'Your Prepaid' },
  our_prepaid:        { en: 'Our Prepaid',         ar: 'دفعات مقدمة منا',
                        customer_en: 'Our Prepaid with You' },
  net_balance:        { en: 'Net Balance',         ar: 'صافي الرصيد' },
  they_owe_us_dir:    { en: 'They owe us',         ar: 'لنا عليهم',
                        customer_en: 'You owe us' },
  we_owe_them_dir:    { en: 'We owe them',         ar: 'لهم علينا',
                        customer_en: 'We owe you' },
  settled:            { en: 'Settled',             ar: 'مُسوى' },

  // ─── Action button labels ───
  generate_report:    { en: 'Generate Report',     ar: 'إنشاء تقرير' },
  english_only:       { en: 'English Only',        ar: 'الإنجليزية فقط' },
  bilingual:          { en: 'Bilingual (EN + AR)', ar: 'ثنائي اللغة' },
  print_statement:    { en: 'Print Statement',     ar: 'طباعة كشف' },
  export_excel:       { en: 'Export Excel',        ar: 'تصدير إكسل' },

  // ─── Footer ───
  generated_by:       { en: 'Generated by NextTrade Hub', ar: 'تم إنشاؤه بواسطة NextTrade Hub' },
};

// Resolve a key for a given language, optionally with perspective fallback.
// T('vendor_bill', 'en')                 → 'Vendor Bill'
// T('vendor_bill', 'en', 'customer')     → 'Invoice'  (falls back to en if no customer_en)
// T('vendor_bill', 'ar', 'customer')     → 'فاتورة بيع' (customer_ar)
export function T(key, lang, perspective) {
  var entry = DICT[key];
  if (!entry) return key;
  var persp = perspective === 'customer' ? 'customer' : null;
  if (persp) {
    var custKey = 'customer_' + lang;
    if (entry[custKey]) return entry[custKey];
    // Fall back to internal-perspective if no customer override
  }
  return entry[lang] || entry.en || key;
}

// Get both languages as a pair (useful for stacked headers)
export function P(key, perspective) {
  return {
    en: T(key, 'en', perspective),
    ar: T(key, 'ar', perspective),
  };
}

// Stacked HTML for a header cell: English on top, Arabic below
export function stackedH(key, perspective) {
  var p = P(key, perspective);
  return p.en + '<br><span class="ar-label" dir="rtl">' + p.ar + '</span>';
}

export { DICT };
