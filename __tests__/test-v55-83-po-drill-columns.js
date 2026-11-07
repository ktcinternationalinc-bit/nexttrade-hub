// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PO — Dates + balances visible in EVERY drill
//
// Max (Nov 7, 04:27, screenshot of the Still-open drill): "dates need to be
// seen here for due dates. and also due date needs to be seen. also the
// balance and current balance and original amounts should be seen in all
// data."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PO — dates + original/paid/open in every drill');

// ── 1. Server rows carry due / total / paid / open ──
var br = R('src/app/api/accounting/bills/route.js');
ok('1a: period_stats invoice select now includes due_date',
  /invoice_number, invoice_date, due_date, currency, total_amount/.test(br));
ok('1b: invoiced + still-open rows carry due, original (total), paid, open',
  /rowsInvoiced\.push\(\{ ref: inv\.invoice_number[^\n]*due: inv\.due_date \|\| null, total: amt, paid: r2\(amt - open\), open: open/.test(br) &&
  /rowsOpenInv\.push\(\{ ref: inv\.invoice_number[^\n]*due: inv\.due_date \|\| null, total: amt, paid: r2\(amt - open\), open: open/.test(br));
ok('1c: collected / billed / open-bills / bills-paid rows carry the dates+balances too',
  /rowsCollected\.push\(\{[^\n]*due: srcInv\.due_date \|\| null, total: r2\(srcInv\.total_amount\)/.test(br) &&
  /rowsOpenBills\.push\(\{[^\n]*date: b\.bill_date, due: b\.due_date \|\| null, total: r2\(b\.total_amount\), paid: r2\(b\.paid\), open: r2\(b\.open\)/.test(br) &&
  /rowsBillsPaid\.push\(\{[^\n]*due: pb\.due_date \|\| null, total: r2\(pb\.total_amount\)/.test(br));
ok('1d: open-invoice loader exposes original + paid (total − open) so EVERY screen built on it has balances',
  /total: totA, paid: r2\(totA - open\),/.test(br));
var ag = R('src/lib/aging.js');
ok('1e: forecast rows (strip + Forecast tab) carry date, due, total, paid, open — for invoices AND bills',
  /date: v\.invoice_date \|\| '', due: v\.due_date \|\| null,\n      total: v\.total === undefined \? null : r2\(v\.total\), paid: v\.paid === undefined \? null : r2\(v\.paid\), open: r2\(open\)/.test(ag) &&
  /date: b2\.bill_date \|\| '', due: b2\.due_date \|\| null,\n      total: b2\.total_amount === undefined \? null : r2\(b2\.total_amount\), paid: b2\.paid === undefined \? null : r2\(b2\.paid\), open: r2\(open\)/.test(ag));

// ── 2. All four drill tables show Date | Due | Original | Paid columns ──
var bh = R('src/components/BooksHomeTab.jsx');
var cft = R('src/components/CashForecastTab.jsx');
var ps = R('src/components/PeriodStatsTab.jsx');
function hasCols(t) {
  return />Due</.test(t) && />Original</.test(t) && />Paid</.test(t) && /nd\(r/.test(t);
}
ok('2a: Books-home card drill + strip drill show Date/Due/Original/Paid (missing values as —, never 0)',
  hasCols(bh) && /nd\(r6\.total\)/.test(bh) && /nd\(r\.total\)/.test(bh) &&
  /\(x === null \|\| x === undefined\) \? '—'/.test(bh));
ok('2b: Forecast tab drill shows them and its Σ footer still lines up (colSpan 6)',
  hasCols(cft) && /colSpan=\{6\}>Σ total/.test(cft));
ok('2c: Stats tab drill shows Date/Due/Original/Paid/Open and its Σ footer lines up (colSpan 7)',
  hasCols(ps) && /nd\(r\.open\)/.test(ps) && /colSpan=\{7\}>Σ total/.test(ps));

// ── 3. The strip says WHAT it is (Max 04:30: "should be really based on
//       invoices that are late or on time... not sure what these other
//       numbers are representing") ──
ok('3: strip rows named (open invoices / open bills), grouped headers LATE vs ON TIME, counts on every cell',
  /In — open invoices/.test(bh) && /Out — open bills/.test(bh) &&
  /⚠ ALREADY LATE — past the due date, aged by days late/.test(bh) &&
  /ON TIME — not due yet, by when it comes due/.test(bh) &&
  /\{fc\.buckets\[b\]\.ar_count\} invoice\(s\)/.test(bh) && /\{fc\.buckets\[b\]\.ap_count\} bill\(s\)/.test(bh) &&
  /Every number here is real invoices\/bills by DUE DATE — nothing else\./.test(bh));

ok('4: Books home opens on June 1, 2026 by default (Max 04:31)',
  bh.indexOf("useState('2026-06-01'); var from") >= 0 && bh.indexOf("useState('Jun 1 \u2192'); var preset") >= 0);

console.log('');
console.log('PO: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
