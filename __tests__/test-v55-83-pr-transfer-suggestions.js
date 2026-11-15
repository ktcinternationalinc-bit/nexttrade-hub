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

// ── PT (Max 05:48): overdue ladder as cards ──
ok('5 (PT): OVERDUE invoices laddered 1–30 / 31–60 / 61–90 / 91+ as clickable cards + TOTAL OVERDUE, same L-buckets as the strip',
  /\['L1-30', 'L31-60', 'L61-90', 'L90\+'\]\.map/.test(bhA2()) &&
  /LATE 1–30 DAYS/.test(bhA2()) && /LATE 91\+ DAYS/.test(bhA2()) &&
  /TOTAL OVERDUE/.test(bhA2()) && /setFcDrill\(\{ bucket: lk, kind: 'in' \}\)/.test(bhA2()));
function bhA2() { return R('src/components/BooksHomeTab.jsx'); }

// ── PU (Max 06:01: 2 years exist, only last month shows) ──
ok('6 (PU): Plaid link tokens request the MAXIMUM history (days_requested 730) — the silent 90-day default was why "All (2 years)" had nothing older to pull',
  /transactions: \{ days_requested: 730 \}/.test(R('src/app/api/plaid/link/route.js')) &&
  /must be RECONNECTED once/.test(R('src/app/api/plaid/link/route.js')));

// ── PV (Max 10:34: "tax reports need data for all of 2026 to start") ──
var brV = R('src/app/api/accounting/bills/route.js');
var psV = R('src/components/PeriodStatsTab.jsx');
ok('7a (PV): the money record now covers BOTH directions — income side mirrors spending (invoice-matched deposits count as sales, transfers excluded, uncategorized flagged)',
  /in\('direction', \['in', 'out'\]\)/.test(brV) &&
  /t6\.matched_invoice_id \? 'customer_payment' : \(t6\.classification \|\| null\)/.test(brV) &&
  /real_income: r2\(totIn - trfIn\.total\)/.test(brV));
ok('7b (PV): Stats shows 💰 Money in by category with % of income, row drills, and the not-income transfers line',
  /Money in by category/.test(psV) && /% of income/.test(psV) &&
  /Transfers between own accounts — NOT income/.test(psV) &&
  /Real money in \(transfers excluded\)/.test(psV));
ok('7c (PV, PY grew it to 12): the accountant pack carries income CSVs (10 by-category, 11 detail) + the PY income statement — 12 files total',
  /tax-pack-10-income-by-category-/.test(psV) && /tax-pack-11-income-detail-/.test(psV) &&
  /12 CSVs for/.test(psV));

// ── PW (Max 10:42: "categories should be whether they are income or expense
//    as quickbooks does") ──
var sqlK = R('sql/v55-83-PW-category-kinds.sql');
var erK = R('src/app/api/accounting/expense-rules/route.js');
var brK = R('src/app/api/accounting/bills/route.js');
var psK = R('src/components/PeriodStatsTab.jsx');
var ertK = R('src/components/ExpenseRulesTab.jsx');
ok('8a (PW): kind column, DB CHECK whitelist, built-ins typed (loan + owner → not_pnl: never income, never deductible)',
  /CHECK \(kind IN \('income','cogs','expense','other_income','other_expense','transfer','not_pnl'\)\)/.test(sqlK) &&
  /SET kind = 'not_pnl'\s+WHERE key = 'loan'/.test(sqlK) &&
  /SET kind = 'not_pnl'\s+WHERE key = 'owner_contribution'/.test(sqlK));
ok('8b: route whitelists kind on create AND edit — never free text into the books',
  /KINDS\.indexOf\(body\.payload\.kind\) < 0\) \{ return NextResponse\.json\(\{ ok: false, error: 'Unknown category type/.test(erK) &&
  /var insKind = 'expense';/.test(erK));
ok('8c: reports split by kind — taxable income and deductible spending EXCLUDE not_pnl money on both sides',
  /if \(c7\.kind === 'not_pnl'\)/.test(brK) && /if \(c8\.kind === 'not_pnl'\)/.test(brK) &&
  /taxable_income: taxable, not_pnl_in: notPnlIn/.test(brK));
ok('8d: Stats shows the type on every row + TAXABLE INCOME / DEDUCTIBLE SPENDING lines; both pack CSVs carry the type column + subtotals',
  /TAXABLE INCOME \(P&L categories only\)/.test(psK) && /DEDUCTIBLE SPENDING \(P&L categories only\)/.test(psK) &&
  /category,type,transactions,total_usd/.test(psK) && /category,type,deposits,total_usd/.test(psK) &&
  /NOT P&L - loan proceeds \/ owner \(NOT income\)/.test(psK));
ok('8e: 🏷 tab — type picker on add (default Expense) + per-category type select; types editable even when Wave is unreachable',
  /sK = useState\('expense'\)/.test(ertK) && /changeKind\(c, e\.target\.value\)/.test(ertK) &&
  /category types are still editable/.test(ertK));

// ── PW part 2 (Max 10:46): ✏ Edit from the invoice popup ──
var pkE = R('src/components/InvoicePeek.jsx');
var aitE = R('src/components/AccountingInvoicesTab.jsx');
ok('9a: the peek offers ✏ Edit invoice (only when a parent wires onEdit), which opens the REAL editor',
  /props\.onEdit && <button onClick=\{function \(\) \{ props\.onEdit\(invoiceId\); \}\}/.test(pkE) &&
  /✏ Edit invoice/.test(pkE));
ok('9b: the Invoices tab accepts the handoff (flag + event), fetches the FULL row, respects edit permission, and reuses startEdit',
  /window\.__ntOpenInvoiceEdit/.test(aitE) && /nt-open-invoice-edit/.test(aitE) &&
  /if \(!mayEdit\) \{ toast\.error\('You need invoice edit permission/.test(aitE) &&
  /\{ startEdit\(r\.data\); \}/.test(aitE));
ok('9c: all three peek hosts navigate to the Invoices tab on edit (onGo(\'invoices\')), PeriodStats now receives onGo',
  (R('src/components/BooksHomeTab.jsx').match(/onGo\('invoices'\)/g) || []).length >= 1 &&
  /onGo\('invoices'\)/.test(R('src/components/CashForecastTab.jsx')) &&
  /onGo\('invoices'\)/.test(R('src/components/PeriodStatsTab.jsx')) &&
  /<PeriodStatsTab \{\.\.\.props\} onGo=\{setSub\} \/>/.test(R('src/components/AccountingTab.jsx')));

// ── PW part 3 (Max 10:49: customer merge/unmerge, names together) ──
var achM = R('src/components/AccountingCustomerHistory.jsx');
ok('10a: merge is NON-DESTRUCTIVE — a merged_into pointer only; invoices/payments untouched; unmerge clears it; flattening repoints nested members',
  /ADD COLUMN IF NOT EXISTS merged_into uuid;/.test(R('sql/v55-83-PW-category-kinds.sql')) &&
  /update\(\{ merged_into: primaryId \}\)\.in\('id', toMove\)/.test(achM) &&
  /update\(\{ merged_into: null \}\)\.eq\('id', memberId\)/.test(achM) &&
  /if \(c\.merged_into === memberId\) \{ toMove\.push\(c\.id\); \}/.test(achM));
ok('10b: the whole group aggregates — invoices, proformas AND payments match any member id or member Wave id; merged names fold out of the list',
  /function groupMembers\(custId\)/.test(achM) &&
  /ids\.indexOf\(i\.accounting_customer_id\) >= 0 \|\| \(i\.wave_customer_id && ws\.indexOf\(i\.wave_customer_id\) >= 0\)/.test(achM) &&
  /gids\.indexOf\(p\.accounting_customer_id\) >= 0/.test(achM) &&
  /if \(c\.merged_into\) \{ return false; \}/.test(achM));
ok('10c: names shown TOGETHER (joined with +) in the list and header, ⛓ merged chip, super-admin merge select + per-name ✕ unmerge',
  /groupNames\(c\.id\)\.join\(' \+ '\)/.test(achM) && /groupNames\(selCust\.id\)\.join\(' \+ '\)/.test(achM) &&
  /merge another customer into this one…/.test(achM) && /✕ unmerge/.test(achM) &&
  /Nothing is rewritten — invoices keep their original customer/.test(achM));

// ── PW part 4 (Max 10:51: all transactions, all accounts, sort/filter/bulk) ──
var erT = R('src/app/api/accounting/expense-rules/route.js');
var attT = R('src/components/AllTransactionsTab.jsx');
var atW = R('src/components/AccountingTab.jsx');
// RC (Max Nov 8 13:59 — the old .limit(5000) silently returned 1,000) now pages to 30,000 and reports that cap — realigned
ok('11a: all_transactions = every account in the window with account names, flags (matched/transfer/verified/pending), row cap REPORTED',
  /action === 'all_transactions'/.test(erT) && /acMap\[t7\.account_id\] \|\| '\(account\)'/.test(erT) &&
  /capped: txA\.capped === true/.test(erT));
ok('11b: bulk_classify — explicit ids only (max 500), whitelisted category, NEVER touches review/verified/matches, learns per distinct merchant (cap 50)',
  /action === 'bulk_classify'/.test(erT) && /Max 500 transactions per bulk update/.test(erT) &&
  !/review_status/.test(erT.substring(erT.indexOf("action === 'bulk_classify'"), erT.indexOf("action === 'all_transactions'"))) &&
  /learnedB2 < 50/.test(erT));
ok('11c: 📑 tab — column-click sorting, account/direction/state/text/date filters, select-all-filtered, Σ of selection, CSV, match → Bank Review handoff',
  /function th\(key, label, right\)/.test(attT) && /toggleAll/.test(attT) &&
  /Apply to \{selIds\.length \|\| '…'\} selected/.test(attT) && /🔗 match/.test(attT) && // (matching moved INLINE same build)
  /onGo\('review'\)/.test(attT) && /all-transactions-/.test(attT));
ok('11d: wired under Accounting behind bank.classify',
  atW.indexOf("['all_txns', '📑 All Transactions']") >= 0 &&
  // superseded pin (v55.83-SA, Max Nov 12): owner / admin count too — the box says "always (admin)" and the server agrees
  /t\[0\] !== 'all_txns' \|\| bossA \|\| mp\['bank\.classify'\] === true/.test(atW));

// ── PW part 5 (Max 10:56 + 10:59 "build the permissioning"): three levels ──
var stP = R('src/components/SettingsTab.jsx');
var atP = R('src/components/AccountingTab.jsx');
var brP = R('src/app/api/accounting/bills/route.js');
// RE (Max, Nov 8 15:12 — Unified Accounting Permissions) superseded PW's levels: P1 Accounting
// Access is now REQUIRED first (no more "any permission opens it"), P2 = Bank & Financial
// Summary (incl. Bank Balance), P3 = Invoicing & Collections. Realigned:
// RF (Max, Nov 8 15:25: "2 switches with same permissioning for both") — realigned:
ok('12a (PW→RE→RF): the switches exist in Settings — P1a ClickBooks + P1b Wave Hub access, P2 · Bank & Financial Summary, P3 · Invoicing & Collections',
  /P1a · ClickBooks \(KTC Hub\) Access/.test(stP) && /P1b · Wave Hub Access/.test(stP) && /P2 · Bank & Financial Summary/.test(stP) && /P3 · Invoicing & Collections/.test(stP));
ok('12b (PW→RE): P1 opens the area (strict), none → a plain locked message; computed AFTER mp/isSuper exist',
  /var hasAnyAccounting = acctV\.access;/.test(atP) &&
  /Accounting is locked for your account\./.test(atP) &&
  atP.indexOf('var mp = props.modulePerms') < atP.indexOf('var hasAnyAccounting'));
ok('12c (PW→RE): server READ gate = P1; WRITES need P1 + Bills: Manage; Forecast/Stats open with P1 and mask per group',
  /var gate = await assertPermission\(db, userId, 'accounting\.view', req\);/.test(brP) &&
  /var gate2 = await assertPermission\(db, userId, 'bills\.manage', req\);/.test(brP) &&
  /var canView = acctAccess\(isSuperAdmin, modulePerms, userProfile && userProfile\.role, 'ktc'\)\.access;/.test(R('src/components/CashForecastTab.jsx')) &&
  /var canView = VS\.access;/.test(R('src/components/PeriodStatsTab.jsx')));
ok('12d: workers keep working — bank.classify/payments.match routes unchanged (expense-rules gate untouched by the totals level)',
  /assertPermission\(db, userId, 'bank\.classify', req\)/.test(R('src/app/api/accounting/expense-rules/route.js')));

// ── PW part 6: inline matching in All Transactions (Max 10:54) ──
var attM = R('src/components/AllTransactionsTab.jsx');
ok('13a: deposit_match_candidates ranks ALL open invoices (no Apr cutoff — old invoices matchable), exact-amount flagged, write stays in guarded bank-write',
  /action === 'deposit_match_candidates'/.test(brP) && /exact: Math\.abs\(x\.v\.open_balance - amtDm\) <= 0\.01/.test(brP) &&
  /the WRITE goes through bank-write/.test(brP));
ok('13b: 📑 inline matcher — 💯 exact candidates, editable apply amount (full or partial), match_invoice via bankSessionHeaders, Bank Review handoff for splits',
  /💯/.test(attM) && /action: 'match_invoice', txn: mPanel\.txn, invoice: cand\.invoice, amount: amt/.test(attM) &&
  /splits \/ unapplied → Bank Review/.test(attM));

// ── PW part 7 (Max 11:02: "must be able to match bills to payments") ──
ok('14: money-out matches to OPEN BILLS inline — ranked candidates (exact flagged), write via record_payment with its overpay/settled-out guards, deposits refused',
  /action === 'bill_match_candidates'/.test(R('src/app/api/accounting/bills/route.js')) &&
  /Bills are paid by money OUT — this is a deposit\./.test(R('src/app/api/accounting/bills/route.js')) &&
  /action: 'record_payment', bill_id: cand\.bill_id, amount: amt, paid_date: mPanel\.txn\.posted_date \|\| mPanel\.txn\.date, bank_transaction_id: mPanel\.txn\.id/.test(R('src/components/AllTransactionsTab.jsx')) &&
  /🔗 \{t\.direction === 'in' \? 'match' : 'bill'\}/.test(R('src/components/AllTransactionsTab.jsx')));

// ── PZ (Max 11:16, screenshot): "clicking on match nothing happens" (panel
//    rendered below the scroll table, off-screen) + "need to see full
//    description if needed" ──
var attZ = R('src/components/AllTransactionsTab.jsx');
ok('15a (PZ): the match panel is a CENTERED MODAL (fixed overlay, backdrop click closes) — it can never load off-screen again',
  /\{mPanel && <div onClick=\{function \(\) \{ setMPanel\(null\); \}\} style=\{\{ position: 'fixed', inset: 0/.test(attZ) &&
  /maxHeight: '80vh', overflowY: 'auto'/.test(attZ));
ok('15b (PZ): click any description to expand the FULL text (merchant · bank line, wrapped), click again to collapse; server sends who_full',
  /who_full: wfull\.join\(' · '\) \|\| '\(no description\)'/.test(R('src/app/api/accounting/expense-rules/route.js')) &&
  /expanded\[t\.id\] \? \(t\.who_full \|\| t\.who\)/.test(attZ) &&
  /whiteSpace: 'normal', wordBreak: 'break-word'/.test(attZ));

// ── PZ part 2 (Max 11:17/11:19/11:20): Accounting tabs organized ──
var atZ = R('src/components/AccountingTab.jsx');
ok('16: tabs grouped by activity — DAILY WORK / SELLING (Order Reconciliation here, per Max) / BUYING / three REPORTS rows split by subject / SYSTEM; same tabs, same permission filter',
  /📥 DAILY WORK — handle the money/.test(atZ) &&
  /'🧾 SELLING — customers & what they owe', \['invoices', 'all_invoices', 'proformas', 'recon'/.test(atZ) &&
  // superseded pin (v55.83-RG, Max 15:32 "a separate portal for wires sent"): 🏦 Wires sits between Bills and Purchase Orders in BUYING
  /* superseded pin (v55.83-SI): 🔔 Waiting for me added in front */ /'🛒 BUYING — vendors & what we owe', \['waiting', 'bills', 'wires', 'purchaseorders'\]/.test(atZ) &&
  /REPORTS · SALES & CUSTOMERS/.test(atZ) && /REPORTS · MONEY & CASH/.test(atZ) && /REPORTS · LEDGER \(ClickBooks\)/.test(atZ) &&
  /⚙️ SYSTEM — rarely touched/.test(atZ) && /TAB_GROUPS\.map\(function \(g\)/.test(atZ));

// ── PZ part 3 (Max 11:22: All-Transactions work auto-updates the WAVE side;
//    not compatible → stay empty; closest COMPATIBLE → save) ──
var ersZ = R('src/lib/expense-rules-server.js');
var erZ = R('src/app/api/accounting/expense-rules/route.js');
ok('17a: one resolver — explicit 🌊 link first, else EXACT normalized name match against Wave\'s own chart, saved onto the category; ambiguous/none → null (Wave stays empty, never fuzzy-guessed)',
  /export async function waveAccountForCategory\(db, clsKey\)/.test(ersZ) &&
  /if \(hits\.length !== 1\) \{ return null; \}/.test(ersZ) &&
  /how: 'name_match_saved'/.test(ersZ));
ok('17b: BULK categorize rides the Wave account onto every selected txn that has NO Wave category and was never synced — existing Wave data never overwritten; outcome told in the toast',
  /\.in\('id', idsB\)\.is\('wave_account_id', null\)\.is\('wave_transaction_id', null\)/.test(erZ) &&
  /category_status: 'pending_wave_sync'/.test(erZ) &&
  /no compatible Wave account — Wave left empty/.test(R('src/components/AllTransactionsTab.jsx')));
ok('17c: single classify uses the SAME resolver (matching already flows to Wave via match_invoice — unchanged)',
  /waveAccountForCategory\(db, cPatch\.classification\)/.test(R('src/app/api/accounting/bank-write/route.js')));

// ── PZ part 4 (Max 11:24: "when matching or categorization we can select
//    transfer and that clickbooks will give options to other transfers that
//    match from other accounts and will not count as income etc in tax
//    reporting or pnl") ──
var attZ4 = R('src/components/AllTransactionsTab.jsx');
ok('18a: every unpaired row in 📑 All Transactions has ↔ — opens the SAME transfer_candidates/pair_transfer engine as the 🏷 tab, in a centered modal',
  /openTransfer\(t\); \}\} title="This is a transfer between our own accounts/.test(attZ4) &&
  /api\('transfer_candidates', \{ bank_transaction_id: t\.id, manual: manual === true, q: q \|\| '' \}\)/.test(attZ4) && // (QX added the manual pick mode to the same call)
  /api\('pair_transfer', \{ a: a2, b: b2 \}\)/.test(attZ4) &&
  /\{tPanel && <div onClick=\{function \(\) \{ setTPanel\(null\); \}\} style=\{\{ position: 'fixed', inset: 0/.test(attZ4));
ok('18b: candidates are OTHER accounts only, opposite direction, cent-equal, ±7 days (server enforces; never already-paired rows)',
  /neq\('account_id', t0\.account_id \|\| ''\)/.test(R('src/app/api/accounting/expense-rules/route.js')) &&
  /is\('transfer_group_id', null\)/.test(R('src/app/api/accounting/expense-rules/route.js')));
ok('18c: transfer NEVER counts as income/spending — period_stats keys any transfer (paired OR just classified) out of both sides, and the UI says so',
  /var isTrf = !!t6\.transfer_group_id \|\| t6\.classification === 'transfer';/.test(R('src/app/api/accounting/bills/route.js')) &&
  /never count as income or deductible spending — they are excluded from tax reports, the P&L/.test(attZ4) &&
  /never count as income or spending in any report/.test(attZ4));
ok('18d: the Wave ride-along SKIPS transfers — a transfer is never pushed into Wave\'s income/expense chart',
  /clsKey === 'transfer'\) \{ return null; \} \/\/ a transfer is never a Wave income\/expense category/.test(R('src/lib/expense-rules-server.js')));

console.log('');
console.log('PR: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
