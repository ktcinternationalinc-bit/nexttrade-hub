// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PR — Intra-company transfers: scan, suggest, link, register
//
// Max (Nov 7, 05:25): "must be able to read thru account and give suggestions
// to transfers if transfer for that amount is selected and link them in the
// proper accounting terminology and sorting filtering and report building
// necessary to account for a company intra transfer between accounts."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PR — intra-company transfer suggestions + register');

var rt = R('src/app/api/accounting/expense-rules/route.js');
ok('1a: the scanner reads ALL silo accounts — cent-equal amounts, opposite directions, DIFFERENT accounts, ≤7 days, never paired/invoice-matched legs',
  /action === 'transfer_suggestions'/.test(rt) &&
  /is\('transfer_group_id', null\)\.is\('matched_invoice_id', null\)/.test(rt) &&
  /a transfer LEAVES one account and ARRIVES in another/.test(rt) &&
  /gap > 7\) \{ continue; \}/.test(rt));
ok('1b: each candidate leg is used ONCE (greedy best-score, usedIn), transfer-looking text boosts the score, suggestions are proposals — only a human links',
  /usedIn\[I\.id\]\) \{ continue; \}/.test(rt) && /hintRx\.test/.test(rt) &&
  /Suggestions only — a human links/.test(rt));
ok('1c: transfers_report = the register — per-pair date, from-account → to-account, amount, period-filtered, one-leg groups visible',
  /action === 'transfers_report'/.test(rt) && /not\('transfer_group_id', 'is', null\)/.test(rt) &&
  /from_account/.test(rt) && /to_account/.test(rt) && /g9\.legs\+\+/.test(rt));

var ui = R('src/components/ExpenseRulesTab.jsx');
ok('2a: ↔ Intra-company transfers panel — scan button, link-as-transfer per suggestion, date-filtered register with CSV',
  /🔎 Scan accounts for transfer pairs/.test(ui) && /link as transfer ↔/.test(ui) &&
  /intra-company-transfers-/.test(ui) && /Transfer register \{trReport\.from\}/.test(ui));
ok('2b: proper accounting terminology stated — clearing account, nets to zero, balances move but the P&L does not',
  /intra-company transfer/.test(ui) && /Inter-account transfer clearing/.test(ui) &&
  /nets to zero/.test(ui) && /balances move, the P&L doesn't/.test(ui));
ok('2c: picking "transfer" as a category immediately offers the other leg; a one-leg register row is flagged',
  /cls === 'transfer' && !t\.transfer_group_id\) \{ openPair\(t\); \}/.test(ui) &&
  /one leg only/.test(ui));

// ── PS (Max 05:33: "expected in... for what period?") ──
var brA = R('src/app/api/accounting/bills/route.js');
var bhA = R('src/components/BooksHomeTab.jsx');
ok("3a: WHAT'S AHEAD is computed from TODAY forward 30 days (not the picked period), Apr-1 creation cutoff applied, bills same window",
  /aheadToF = new Date\(Date\.now\(\) \+ 30 \* 86400000\)/.test(brA) &&
  /d2 >= today2 && d2 <= aheadToF/.test(brA) &&
  /d5 >= today2 && d5 <= aheadToF/.test(brA) &&
  /ahead: aheadL/.test(brA));
ok('3b: the group-4 cards SAY the window (today → +30d) and that late money lives in the aged strip',
  /falling due in the NEXT 30 DAYS \(\{cf\.ahead\.from\} → \{cf\.ahead\.to\}\)/.test(bhA) &&
  /Already-late money is in the strip below, aged\./.test(bhA) &&
  /open invoices due in the next 30 days/.test(bhA));

ok('3c (Max 05:34): EXPECTED money laddered ≤30 / 31–60 / 61–90 / 90+ from the SAME buckets as the strip, each clicking into its rows',
  /\['D0-30', 'D31-60', 'D61-90', 'D90\+'\]\.map/.test(bhA) &&
  /EXPECTED ≤30 DAYS/.test(bhA) && /EXPECTED 90\+ DAYS/.test(bhA) &&
  /setFcDrill\(\{ bucket: bk, kind: 'in' \}\)/.test(bhA));

// ── PS part 2 (Max 05:35 + 05:37): click a reference → the invoice pops up,
//    with invoice AND release numbers shown wherever invoices are listed ──
var pk = R('src/components/InvoicePeek.jsx');
ok('4a: InvoicePeek shows invoice + RELEASE number, dates, Original/Paid/Balance, line items, dated payments, and the Wave-era paid note — read-only',
  /Release \{d\.inv\.release_number\}/.test(pk) && /Original \$\{fmt\(d\.inv\.total_amount\)\}/.test(pk) &&
  /paid in Wave before the hub tracked dated payments/.test(pk) &&
  /Payments \{d\.pays\.length === 0/.test(pk));
ok('4b: drill rows carry invoice_id + release number from BOTH engines (aging + bills route), collected rows included',
  /invoice_id: v\.id \|\| null, ref: v\.invoice_number \|\| v\.id, rel: v\.release_number \|\| null/.test(R('src/lib/aging.js')) &&
  /rowsInvoiced\.push\(\{ invoice_id: inv\.id, ref: inv\.invoice_number, rel: inv\.release_number \|\| null/.test(brA) &&
  /var rowC = \{ invoice_id: srcInv\.id, ref: srcInv\.invoice_number, rel: srcInv\.release_number \|\| null/.test(brA));
var cfA = R('src/components/CashForecastTab.jsx');
var psA = R('src/components/PeriodStatsTab.jsx');
function wired(t) { return /setPeekId\(r/.test(t) && /<InvoicePeek invoiceId=\{peekId\}/.test(t) && /\{r\.rel \? ' · ' \+ r\.rel : ''\}|\{r6\.rel \? ' · ' \+ r6\.rel : ''\}/.test(t); }
ok('4c: every drill surface (Books cards + strip, Forecast tab, Stats tab) opens the peek from the reference, showing "INV · RELEASE"',
  wired(bhA) && wired(cfA) && wired(psA) && /setPeekId\(r6\.invoice_id\)/.test(bhA));

console.log('');
console.log('PR: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
