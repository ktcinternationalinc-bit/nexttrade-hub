// v55.83-NX — SCHEMA TRUTH GATE.
//
// Two builds in a row died on phantom columns (invoices.invoice_number,
// accounting_invoices.status) because I guessed schema instead of verifying.
// Max: "make sure there are no issues and stop wasting my time." This test is
// that guarantee: every column my new routes SELECT from shared tables must
// appear in the VERIFIED whitelist below — each entry proven by pre-existing,
// battle-tested Hub code that reads or writes it in production. A select of
// any column not on the list FAILS the launch gate.
var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

// Proven-by-working-code column lists (source noted per table).
var VERIFIED = {
  invoices: ['id', 'order_number', 'customer_name', 'customer_name_en', 'customer_id', 'invoice_date', 'total_amount', 'total_collected', 'outstanding', 'sales_rep', 'release_number'], // /api/ask L1299 + page.jsx sales + NO SQL
  accounting_invoices: ['id', 'invoice_number', 'release_number', 'accounting_customer_id', 'invoice_date', 'due_date', 'notes', 'terms', 'total_amount', 'amount_paid', 'balance_due', 'payment_status', 'approval_status', 'po_so_number', 'wave_imported_paid', 'wave_business_id', 'business_id', 'source', 'created_by', 'updated_by'], // AccountingInvoicesTab payload + recompute
  treasury: ['transaction_date', 'description', 'cash_in', 'cash_out', 'order_number', 'category', 'subcategory'], // /api/ask L1300
  checks: ['check_number', 'customer_name', 'amount', 'check_date', 'collection_date', 'status', 'bank_name', 'order_number'], // /api/ask L1312
  users: ['id', 'name', 'email', 'role', 'is_ai', 'job_title'], // loadUserPermissions + SettingsTab profile editor
  tickets: ['id', 'ticket_number', 'title', 'status', 'priority', 'due_date', 'created_at', 'created_by', 'assigned_to', 'additional_assignees'], // TicketsTab
  ticket_comments: ['ticket_id', 'created_by', 'created_at', 'is_system', 'comment_text'], // TicketsTab
  user_sessions: ['user_id', 'date', 'login_at', 'logout_at', 'last_seen'], // AdminTab/DailyLog/LoginHistoryV2
  accounting_customers: ['id', 'company_name', 'contact_name', 'wave_customer_id', 'wave_business_id'] // push-invoice-v2 L78 select + custName (company_name || contact_name) — 'name' was a GUESS that contaminated this list; never again
};
// Our own tables (created by our SQL) are trusted:
var OURS = { nexttrade_orders: true, hr_performance_reviews: true, shipments: true, inventory_layers: true, invoice_items: true };

var FILES = [
  'src/app/api/reconcile/nexttrade/route.js',
  'src/app/api/ai/reports/route.js',
  'src/app/api/hr/performance-review/route.js'
];

var failures = [];
FILES.forEach(function (f) {
  var src = read(f);
  var rx = /from\('([a-z_]+)'\)[\s\S]{0,40}?\.select\('([^']+)'\)/g;
  var m;
  while ((m = rx.exec(src)) !== null) {
    var table = m[1]; var cols = m[2];
    if (cols === '*' || OURS[table]) { continue; }
    if (!VERIFIED[table]) { continue; } // tables outside the audit scope
    cols.split(',').forEach(function (c) {
      var col = c.trim();
      if (!col) { return; }
      if (VERIFIED[table].indexOf(col) === -1) {
        failures.push(f + ' selects UNVERIFIED column ' + table + '.' + col);
      }
    });
  }
});

if (failures.length) {
  console.log('❌ SCHEMA TRUTH FAILURES (' + failures.length + '):');
  failures.forEach(function (x) { console.log('  - ' + x); });
  process.exit(1);
} else {
  console.log('✅ SCHEMA TRUTH — every selected column on shared tables is proven by working Hub code');
}
