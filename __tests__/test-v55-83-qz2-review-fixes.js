// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QZ2 — Review of the whole day's changes (Max, Nov 8 12:00: "please
// look thru the changes we made today and look for any logical gaps or issues
// we need to address"). Every pin below is a gap that review found:
//  • the 1090 transfer-clearing account was seeded "needs review" → the first
//    transfer would have stopped the WHOLE ledger run;
//  • min() on an id column does not exist in Postgres → the first unmapped
//    category stopped the whole run (found by running the SQL on a test DB);
//  • a reviewed row dated in a LOCKED period stopped the whole run;
//  • the 15-minute job only looked at the last day → late bookkeeping never
//    reached the ledger;
//  • nothing flowed to the ledger AFTER posting (recategorize, unmatch,
//    duplicate, invoice deleted/edited) — Max: "any change i make on one side
//    should automatically apply to the other side";
//  • a ClickBooks category pick or transfer pair never became "reviewed", so
//    it never reached the ledger (Bank Review picks did);
//  • a leg of a paired transfer could be given an expense category (hub says
//    expense, ledger says transfer);
//  • deleting an invoice re-opened only the deposit that pointed at it, not
//    every deposit split across it;
//  • the email scanner without its memory table re-imported the same emails.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QZ2 — review fixes (ledger consistency + gaps)');
var sql = R('sql/v55-83-QX-transfer-ledger.sql');
var qf = R('sql/v55-83-QF-advance-flag.sql');
var drift = sql.split('create or replace function clickbooks_us.drift_sync_run')[1] || '';
var cls = sql.split('create or replace function clickbooks_us.classified_sync_run')[1].split('$$;')[0];

ok('1: 1090 approved by an explicit, narrow statement (seeded row only) and the run uses it ONLY when approved — never aborts the whole run',
  /update clickbooks_us\.accounts set needs_review = false\n where code = '1090' and name = 'Inter-account transfer clearing' and account_type = 'asset'\n   and is_active and needs_review/.test(sql) &&
  /a\.code = '1090' and a\.is_active and not a\.needs_review;/.test(cls) &&
  /1090 transfer clearing approved: /.test(sql));
ok('2: no min() on an id column anywhere (Postgres has none) — exact-name single-hit pick uses array_agg; QF file fixed too',
  !/min\(a\.id\)/.test(sql) && !/min\(a\.id\)/.test(qf) &&
  /select count\(\*\), \(array_agg\(a\.id order by a\.id::text\)\)\[1\] into hit_n, hit_id/.test(sql));
ok('3: locked periods — classified run SKIPS and counts (skippedLocked) instead of aborting; drift never auto-reverses a closed month (lockedPeriodChanges for the accountant)',
  /if b\.locked_through is not null and coalesce\(t\.posted_date, t\.date\) <= b\.locked_through then\n\s+skipped_locked := skipped_locked \+ 1; continue;/.test(cls) &&
  /'skippedLocked', skipped_locked/.test(cls) &&
  drift.split('if why is not null and b.locked_through is not null and j.entry_date <= b.locked_through then').length === 4 &&
  /'lockedPeriodChanges', locked_changed/.test(drift));
ok('4: re-post after reversal — "already posted" means a LIVE (unreversed) entry; corrected entry posts as <txn>:r<n> on both the classified and transfer paths',
  /and \(j\.source_id = t\.id::text or j\.source_id like t\.id::text \|\| ':r%'\)\n\s+and not exists\(select 1 from clickbooks_us\.journals r where r\.reverses_id = j\.id\)\) then\n\s+already := already \+ 1; continue;/.test(cls) &&
  /src_id := case when prior_n = 0 then t\.id::text else t\.id::text \|\| ':r' \|\| prior_n::text end;/.test(cls) &&
  cls.split("'bank_transaction', src_id, lines, p_actor);").length === 3);
ok('5: DRIFT — bank entries reversed when gone / duplicate / matched / category-transfer-amount changed (exact line comparison) / category removed; unreviewed rows wait',
  /why := 'bank transaction no longer in the hub';/.test(drift) && /why := 'marked as a duplicate copy';/.test(drift) &&
  /why := 'now matched to an invoice \(the payment entry carries it\)';/.test(drift) &&
  /if have is distinct from want then why := 'category, transfer status or amount changed after posting'; end if;/.test(drift) &&
  /why := 'category removed after posting';/.test(drift) &&
  /continue; -- unreviewed with a category: the bridge waits for review/.test(drift));
ok('6: DRIFT — payments (gone / voided / amount) and invoices (deleted / not active-approved / total) reversed; revived payments + re-approved/edited invoices re-posted with the ENGINE\'s own checks',
  /why := 'payment voided \(unmatched, or its invoice was deleted\)';/.test(drift) && /why := 'payment amount changed';/.test(drift) &&
  /why := 'invoice deleted';/.test(drift) && /why := 'invoice voided or no longer approved';/.test(drift) && /why := 'invoice total changed';/.test(drift) &&
  /coalesce\(x\.total_amount, 0\) <> \(select coalesce\(sum\(li\.line_total\), 0\)/.test(drift) &&
  /is distinct from bank\.amount_abs then/.test(drift) &&
  /'accounting_invoice', x\.id::text \|\| ':r' \|\| prior_n::text/.test(drift) &&
  /'accounting_invoice_payment', pp\.id::text \|\| ':r' \|\| prior_n::text/.test(drift));
ok('7: DRIFT is append-only — only reverse_journal/post_journal; never UPDATE/DELETE of journals or lines; one bad entry never stops the run (errors collected)',
  !/update clickbooks_us\.journal/.test(sql) && !/delete from clickbooks_us\.journal/.test(sql) &&
  drift.split('perform clickbooks_us.reverse_journal(').length === 4 &&
  drift.split('exception when others then').length >= 6 && /'errors', errors\);/.test(drift));
ok('8: DRIFT + cutoff helper are service-role only (wrappers revoked from public/anon/authenticated); cutoff = greatest(opening cutoff, locked-through)',
  /revoke all on function public\.clickbooks_us_drift_sync_job\(uuid\) from public, anon, authenticated;\ngrant execute on function public\.clickbooks_us_drift_sync_job\(uuid\) to service_role;/.test(sql) &&
  /revoke all on function public\.clickbooks_us_sync_cutoff\(\) from public, anon, authenticated;/.test(sql) &&
  /select greatest\(opening_cutoff, coalesce\(locked_through, opening_cutoff\)\) from clickbooks_us\.books where code = 'KTC_US'/.test(sql));

// ── FUNCTIONAL: the job windows (real lib code)
var src = R('src/lib/clickbooks-sync-windows.js');
var names = [];
var cjs = src.replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; });
cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
var mod = { exports: {} };
/* eslint-disable no-new-func */
new Function('module', 'exports', cjs)(mod, mod.exports);
var W = mod.exports.syncWindows; var daily = mod.exports.isDailyCatchUpTick;
var w1 = W('2026-10-31', '2026-11-08', false);
ok('9a: today Nov 8, cutoff Oct 31 → ONE window Nov 1 → Nov 8 (never into the cutoff)',
  JSON.stringify(w1) === JSON.stringify([['2026-11-01', '2026-11-08']]));
var w2 = W('2026-10-31', '2027-03-15', false);
ok('9b: later on — every tick covers the last 31 days (Feb 13 → Mar 15)',
  JSON.stringify(w2) === JSON.stringify([['2027-02-13', '2027-03-15']]));
var w3 = W('2026-10-31', '2027-03-15', true);
var contiguous = true; var allShort = true;
for (var i = 1; i < w3.length; i++) {
  var span = (Date.parse(w3[i][1]) - Date.parse(w3[i][0])) / 864e5; if (span > 31 || span < 0) { allShort = false; }
  if (i + 1 < w3.length && (Date.parse(w3[i + 1][0]) - Date.parse(w3[i][1])) / 864e5 !== 1) { contiguous = false; }
}
ok('9c: daily catch-up — slices from Nov 1 up to the day before the recent window, contiguous, none longer than the database allows',
  w3[0][0] === '2027-02-13' && w3[1][0] === '2026-11-01' && w3[w3.length - 1][1] === '2027-02-12' && contiguous && allShort);
ok('9d: everything locked through today → no window (nothing posted); bad input → null (job keeps the old one-day window)',
  JSON.stringify(W('2026-11-08', '2026-11-08', true)) === '[]' && W('', '2026-11-08', false) === null);
ok('9e: catch-up tick = the 04:00–04:14 UTC tick only',
  daily(new Date('2026-11-09T04:00:00Z')) === true && daily(new Date('2026-11-09T04:15:00Z')) === false && daily(new Date('2026-11-09T16:00:00Z')) === false);

var job = R('src/app/api/accounting/clickbooks-us/shadow-job/route.js');
ok('10: the 15-minute job — drift FIRST, then the recent window, then catch-up slices (never fatal); falls back to the one-day window before the SQL is run; 60s budget',
  job.indexOf("db.rpc('clickbooks_us_drift_sync_job'") < job.indexOf("const shadow = await db.rpc('clickbooks_us_shadow_sync_job'") &&
  /let windows = \[\[from, to\]\];/.test(job) && /db\.rpc\('clickbooks_us_sync_cutoff'\)/.test(job) &&
  /for \(let i = 1; i < windows\.length; i\+\+\)/.test(job) && /export const maxDuration = 60;/.test(job) &&
  /drift = dr\.error \? \{ error:/.test(job));

var er = R('src/app/api/accounting/expense-rules/route.js');
var lib = R('src/lib/bank-allocation-server.js');
var at = R('src/components/AllTransactionsTab.jsx');
ok('11: ONE row picked by a person in ClickBooks is finished like Bank Review (reviewed only when every dollar is accounted for) → it reaches the ledger; bulk picks never touch review status',
  /if \(idsB\.length === 1 && body\.payload && body\.payload\.single_pick === true\) \{ reviewedB = await autoReviewIfComplete\(db, idsB, by\); \}/.test(er) &&
  /api\('bulk_classify', \{ ids: \[t\.id\], classification: key, single_pick: true \}\)/.test(at) &&
  !/single_pick/.test(at.split("api('bulk_classify', { ids: selIds")[1].split('\n')[0]));
ok('12: a transfer pair a person confirmed → both legs finished (reviewed when fully accounted for) → ledger posts them through 1090',
  /var reviewedP = await autoReviewIfComplete\(db, \[idA, idB\], by\);/.test(er));
ok('13: the auto-review helper only advances UNREVIEWED rows (never approved/duplicate), only when complete and not over-allocated, stamps who/when, fail-soft',
  /if \(!a \|\| a\.missing \|\| !a\.complete \|\| a\.overAllocated\) \{ continue; \}/.test(lib) &&
  /\.eq\('id', ids\[i\]\)\.eq\('review_status', 'unreviewed'\)/.test(lib) &&
  /review_status: 'reviewed', reviewed_by: by \|\| null, reviewed_at:/.test(lib) &&
  /import \{ summarizeBankAllocation \} from '\.\/payment-matching';/.test(lib));
ok('14: a leg of a PAIRED transfer cannot quietly get an expense/income category — refused with "unpair first" (hub and ledger would disagree)',
  /if \(clsB !== 'transfer'\) \{\n\s+var prB = await db\.from\('bank_transactions'\)\.select\('id'\)\.in\('id', idsB\)\.not\('transfer_group_id', 'is', null\);/.test(er) &&
  /Unpair it first/.test(er));

var ai = R('src/components/AccountingInvoicesTab.jsx');
ok('15: deleting an invoice re-opens EVERY deposit that lost a payment (split deposits point their match at only one invoice)',
  /return supabase\.from\('bank_transactions'\)\.update\(\{ review_status: 'unreviewed' \}\)\n\s+\.in\('id', txIds\)\.in\('review_status', \['reviewed', 'approved'\]\);/.test(ai));
var es = R('src/app/api/accounting/bills/email-scan/route.js');
ok('16: the email scanner refuses to run without its memory table (would re-import the same emails every pass) — checked BEFORE connecting to the mailbox',
  /var memProbe = await db\.from\('hub_audit_log'\)\.select\('id'\)\.limit\(1\);/.test(es) &&
  es.indexOf('var memProbe') < es.indexOf('await client.connect();'));

var bills = R('src/app/api/accounting/bills/route.js');
var cb = bills.split('async function carryBillCategory')[1] || '';
ok('17: a bank payment matched to bills gets the bills\' category when it has NONE and every bill shares ONE category (never overwrites a pick); reviewed only when the bills cover the whole payment',
  /if \(!t0 \|\| t0\.classification \|\| t0\.third_party_payer \|\| t0\.transfer_group_id \|\| t0\.review_status === 'duplicate'\) \{ return null; \}/.test(cb) &&
  /if \(missing \|\| keys\.length !== 1\) \{ return null; \}/.test(cb) &&
  /\.eq\('id', bankId\)\.is\('classification', null\)\.select\('id'\);/.test(cb) &&
  /if \(Math\.abs\(r2\(paid\) - r2\(t0\.amount_abs\)\) <= 0\.01\) \{ reviewed = \(await autoReviewIfComplete\(db, \[bankId\], userId\)\)\.length > 0; \}/.test(cb));
ok('18: RTM / paid-through payments are NEVER re-categorized from their covered bills (tax view keeps ONE line) — method rtm skipped at the call and inside the helper',
  /if \(bankId && String\(body\.method \|\| ''\)\.trim\(\) !== 'rtm'\) \{/.test(bills) &&
  /live\.some\(function \(p\) \{ return p\.method === 'rtm'; \}\)/.test(cb));

console.log('');
console.log('QZ2: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
