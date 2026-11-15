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

  // ─── v55.83-SM — statement wording (plain words; customer copy speaks as "you" / "KTC") ───
  st_col_they:        { en: 'They owe us',         ar: 'لنا عليهم',
                        customer_en: 'You owe KTC', customer_ar: 'مستحق عليكم' },
  st_col_we:          { en: 'We owe them',         ar: 'لهم علينا',
                        customer_en: 'KTC owes you', customer_ar: 'مستحق لكم' },
  st_bal_they:        { en: 'they owe us',         ar: 'لنا عليهم',
                        customer_en: 'you owe KTC', customer_ar: 'مستحق عليكم' },
  st_bal_we:          { en: 'we owe them',         ar: 'لهم علينا',
                        customer_en: 'KTC owes you', customer_ar: 'مستحق لكم' },
  st_less_they:       { en: 'they owe us less',    ar: 'يقل ما لنا عليهم',
                        customer_en: 'you owe KTC less', customer_ar: 'يقل المستحق عليكم' },
  st_less_we:         { en: 'we owe them less',    ar: 'يقل ما لهم علينا',
                        customer_en: 'KTC owes you less', customer_ar: 'يقل المستحق لكم' },
  st_sales_invoice:   { en: 'Our invoice',         ar: 'فاتورتنا',
                        customer_en: 'Invoice from KTC', customer_ar: 'فاتورة من KTC' },
  st_vendor_bill:     { en: 'Their bill',          ar: 'فاتورتهم',
                        customer_en: 'Your bill to KTC', customer_ar: 'فاتورتكم إلى KTC' },
  st_payment_received:{ en: 'Payment received',    ar: 'دفعة مستلمة',
                        customer_en: 'Your payment', customer_ar: 'دفعتكم' },
  st_payment_sent:    { en: 'Payment we sent',     ar: 'دفعة مرسلة',
                        customer_en: 'Payment from KTC', customer_ar: 'دفعة من KTC' },
  st_credit_adjustment: { en: 'Adjustment',        ar: 'تسوية' },
  st_other:           { en: 'Entry',               ar: 'قيد' },
  st_balance:         { en: 'balance',             ar: 'الرصيد' },
  st_open:            { en: 'Open',                ar: 'مفتوح' },
  st_paid:            { en: 'Paid',                ar: 'مدفوع' },
  st_still_open:      { en: 'Still open',          ar: 'ما زال مفتوحاً' },
  st_days:            { en: 'days',                ar: 'يوم' },
  st_totals:          { en: 'totals',              ar: 'الإجمالي' },
  st_closing:         { en: 'Closing balance',     ar: 'الرصيد الختامي' },
  st_settled:         { en: 'settled',             ar: 'مُسوى' },
  st_invoiced:        { en: 'We invoiced',         ar: 'فواتيرنا',
                        customer_en: 'KTC invoiced you', customer_ar: 'فواتير KTC لكم' },
  st_received:        { en: 'They paid us',        ar: 'دفعوا لنا',
                        customer_en: 'You paid KTC', customer_ar: 'دفعتم لـ KTC' },
  st_billed:          { en: 'They billed us',      ar: 'فواتيرهم',
                        customer_en: 'You billed KTC', customer_ar: 'فواتيركم لـ KTC' },
  st_sent:            { en: 'We paid them',        ar: 'دفعنا لهم',
                        customer_en: 'KTC paid you', customer_ar: 'دفعت KTC لكم' },
  st_adjust:          { en: 'Adjustments',         ar: 'تسويات' },
  st_offset_vs:       { en: 'Settled by offset against', ar: 'مُسوى مقابل' },
  st_offset_part:     { en: 'Partly settled by offset against', ar: 'مُسوى جزئياً مقابل' },
  st_banner:          { en: 'Internal — not for sending', ar: 'داخلي — ليس للإرسال',
                        customer_en: 'Customer copy', customer_ar: 'نسخة العميل' },

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
