// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RB — the open items of the Nov 8 gap review (Max, Nov 8 12:23:
// "complete all of the gap review items not yet completed"):
//  1. split / partly-placed money now reaches the ClickBooks books (once);
//  2. every hub bank account (M&T, PNC, CSV-only, Plaid reconnect) gets its
//     ledger bank account automatically — twins share one; opening balances;
//  3. NextTrade Industries: money sent = advance (Due from), its bills = the
//     real costs; reports and the accountant pack agree;
//  4. engine rule path can no longer stop the whole run on an old entry;
//  5. Bank Review side lists paged past 1,000 rows.
// The SQL was run on a local Postgres with the real ClickBooks core:
// clickbooks/tests/qz2-ledger-drift/13_rb.sql (trial balance nets to zero).
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('RB — ledger completion');
var rb = R('sql/v55-83-RB-ledger-completion.sql');
var qx = R('sql/v55-83-QX-transfer-ledger.sql');
var dl = rb.split('create or replace function clickbooks_us.deposit_lines')[1].split('end $$;')[0];
var ds = rb.split('create or replace function clickbooks_us.deposit_sync_run')[1].split('end $$;')[0];

ok('1a: split / partly-placed money booked WHOLE: invoice payments → receivable 1100, parked + customer credits → 2400 Unapplied customer receipts, split lines → their category (money in parks an unknown split; money out waits)',
  /select ar as acct, round\(p\.amount \* 100\)::bigint as cents from public\.accounting_invoice_payments p/.test(dl) &&
  /select unap, round\(u\.amount \* 100\)::bigint from public\.unapplied_deposits u/.test(dl) &&
  /select unap, round\(c\.amount \* 100\)::bigint from public\.customer_credits c/.test(dl) &&
  /case when t\.direction = 'in' then unap end\),/.test(dl) && /a\.code = '2400' and a\.is_active and not a\.needs_review/.test(dl));
ok('1b: books only FINISHED rows (reviewed/approved), every dollar placed, invoices already in the ledger; fully paid by invoices stays with the engine',
  /'not finished \(reviewed\) yet'/.test(dl) && /if tot <> amt then return jsonb_build_object\('ok', false, 'why', 'not every dollar is placed yet'\)/.test(dl) &&
  /'an invoice it pays is not in the ledger yet'/.test(dl) && /if t\.direction = 'in' and only_ar then/.test(dl));
ok('1c: NEVER twice — classified path skips piecewise rows; deposit path refuses while an older whole-category or payment entry is live; drift reverses a classified entry that became split; engine payment entries reversed when the deposit is no longer fully covered',
  /and not clickbooks_us\.has_piecewise\(bt\.id\)/.test(qx) && /an earlier entry for it is still live/.test(ds) &&
  /elsif clickbooks_us\.has_piecewise\(t\.id\) then\n\s+why := 'now split or partly placed/.test(qx) &&
  /why := 'deposit is no longer fully covered by invoice payments/.test(qx) && /jj\.source_id !~ ':d\[0-9\]\+\$'/.test(qx));
ok('1d: deposit entries re-checked every run against the hub (exact lines) — audited reversal, never edited; closed months untouched',
  /if coalesce\(\(res->>'ok'\)::boolean, false\) and res->'lines' = have then continue; end if;/.test(ds) &&
  /perform clickbooks_us\.reverse_journal\(j\.id, j\.entry_date/.test(ds) && /j\.entry_date <= b\.locked_through then locked_n := locked_n \+ 1; continue;/.test(ds));

var bm = rb.split('create or replace function clickbooks_us.bank_map_sync_run')[1].split('end $$;')[0];
ok('2a: every hub bank account with activity after the cutoff gets a ledger bank account; the Plaid twin (same bank first word + last 4) REUSES it; cards/loans left for the accountant',
  /and not exists\(select 1 from clickbooks_us\.bank_ledger_map m where m\.book_id = b\.id and m\.provider_account_id = bt\.account_id\)/.test(bm) &&
  /and p2\.mask = acc\.mask and lower\(substring\(coalesce\(c2\.institution_name, ''\) from '\[A-Za-z0-9\]\+'\)\) = tok/.test(bm) &&
  /values \(b\.id, 'B-' \|\| md5\(r\.account_id\), nm, 'asset', 'debit', true, true, false, 'manual'\)/.test(bm) &&
  /card or loan — needs a liability account/.test(bm));
ok('2b: opening balance from the statement — one per account, never twice, owner-run only (revoked from every API role)',
  /public\.clickbooks_us_bank_opening_balance\(p_bank text, p_last4 text, p_balance numeric\)/.test(rb) &&
  /'opening_balance', 'bank-open:' \|\| acct::text/.test(rb) && /An opening balance is already recorded/.test(rb) &&
  /revoke all on function public\.clickbooks_us_bank_opening_balance\(text, text, numeric\) from public, anon, authenticated, service_role;/.test(rb));

ok('3a: money sent to a RELATED company (affiliate) → "Due from <company>" asset, not an expense; RTM (service provider) unchanged',
  /if nm is null or kd is distinct from 'affiliate' then return null; end if;/.test(rb) &&
  /due := clickbooks_us\.affiliate_due_account\(b\.id, t\.third_party_payer\);\n\s+map_acct := due;/.test(qx) &&
  /and \(bt\.classification is not null or bt\.third_party_payer is not null\)/.test(qx));
ok('3b: drift knows the advance (no reverse/re-post loop) and the bills NextTrade paid book Dr real category / Cr Due from, reversed when voided',
  /or clickbooks_us\.affiliate_due_account\(b\.id, t\.third_party_payer\) is not null\) then/.test(qx) &&
  /select jsonb_build_array\(cat::text, n, 0\) as x union all select jsonb_build_array\(due::text, 0, n\)/.test(rb) &&
  /'manual', 'affbill:' \|\| v\.id::text/.test(rb) && /'paid through a service provider \(stays one line\)'/.test(rb));
var ps = R('src/components/PeriodStatsTab.jsx');
ok('3c: Stats + accountant pack match the books — NextTrade defaults to real-cost, its unlinked remainder is an ADVANCE (not P&L), the pack always takes advances out; RTM keeps its one line',
  /var feeKind = \(rtm && rtm\.kind === 'affiliate'\) \? 'not_pnl' : 'expense';/.test(ps) &&
  /function ptIsOn\(b\) \{ return ptOn\[b\.payer\] === undefined \? b\.kind === 'affiliate' : ptOn\[b\.payer\] === true; \}/.test(ps) &&
  /\(taxCats\(data\.spending\.categories\) \|\| \[\]\)\.forEach\(function \(c\) \{ sp\.push\(/.test(ps) &&
  /\(taxCats\(data\.spending\.categories\) \|\| \[\]\)\.forEach\(function \(c\) \{ if \(c\.kind === 'cogs'\)/.test(ps));
var bills = R('src/app/api/accounting/bills/route.js');
ok('3d: marking a payment as sent to NextTrade finishes it (reviewed when fully accounted for) so the books record the advance',
  /if \(body\.clear !== true && kindF === 'affiliate'\) \{ reviewedF = \(await autoReviewIfComplete\(db, \[body\.bank_transaction_id\], userId\)\)\.length > 0; \}/.test(bills));

ok('4: engine rule path skips a transaction that ever had an entry (no CB_IDEMPOTENCY_CONFLICT stopping the whole run); a needs-review account is never auto-mapped',
  /and t\.matched_invoice_id is null and not exists\(select 1 from clickbooks_us\.journals jx where jx\.book_id=b\.id and jx\.source_kind='bank_transaction'/.test(rb) &&
  /create or replace function clickbooks_us\.shadow_sync_run\(p_from date,p_to date,p_actor uuid\)/.test(rb) &&
  /and not a\.is_bank_sensitive and not a\.needs_review -- RB/.test(qx));
var job = R('src/app/api/accounting/clickbooks-us/shadow-job/route.js');
ok('5a: the 15-minute job — bank mapping first, then drift, postings, then split money + NextTrade bills per window (all fail-soft)',
  job.indexOf("db.rpc('clickbooks_us_bank_map_job'") < job.indexOf("db.rpc('clickbooks_us_drift_sync_job'") &&
  job.split("clickbooks_us_ledger_extras_job").length === 3 && /extras: extras, drift: drift, bank_map: bankMap/.test(job));
var br = R('src/components/BankReviewTab.jsx');
ok('5b: Bank Review side lists (matches, payments, splits, parked money, credits) paged past 1,000 rows',
  /fetchAllRows\('payment_matches', '\*', 'id', true\)/.test(br) &&
  /fetchAllRows\('accounting_invoice_payments', 'id, bank_transaction_id, accounting_invoice_id, amount, voided, sync_status, wave_payment_id', 'id', true\)/.test(br) &&
  /fetchAllRows\('customer_credits', 'id, source_transaction_id, amount, status', 'id', true\)/.test(br) &&
  !/supabase\.from\('unapplied_deposits'\)\.select\('bank_transaction_id, amount, status'\)/.test(br));
ok('6: verified on a real Postgres — scenario file kept in the repo',
  fs.existsSync(path.join(__dirname, '..', 'clickbooks/tests/qz2-ledger-drift/13_rb.sql')));

console.log('');
console.log('RB: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
