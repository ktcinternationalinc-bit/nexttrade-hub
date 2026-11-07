// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QF — One batch, five Max orders (Nov 7 12:08–12:15):
//  12:08 "have a search... select the amount you want to match... select
//         multiple for the same amount... leave a part left... signified as
//         partial matched or split full or split partial or unmatched"
//  12:10 category pick "remains empty or invisible" (dark-skin !important)
//  12:13 RTM entry moves INTO the match popup as a radio
//  12:14 "add an advance for future payment... add the actual bills later"
//  12:15 hub → ClickBooks fully automated (exact match, auto-create account)
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QF — match search/multi/partial + visibility + advance + auto-ledger');

var bills = R('src/app/api/accounting/bills/route.js');
var at = R('src/components/AllTransactionsTab.jsx');
var er = R('src/app/api/accounting/expense-rules/route.js');

ok('1a: SEARCH goes server-side over ALL open invoices AND bills (ref/release/customer/vendor + amount digits) — not just the top-20 guesses',
  /var qDm = String\(body\.q \|\| ''\)/.test(bills) && /var qBm = String\(body\.q \|\| ''\)/.test(bills) &&
  /release_number \|\| ''/.test(bills) && /qDigits\.length >= 3/.test(bills));
ok('1b: both candidate calls return applied + remaining for the transaction; amount inputs prefill the REMAINING, not the full amount',
  /remaining: Math\.max\(0, r2\(amtDm - apDm\)\)/.test(bills) && /remaining: Math\.max\(0, r2\(amtBm - apBm\)\)/.test(bills) &&
  /d2\[c2\.id \|\| c2\.bill_id\] = String\(Math\.min\(c2\.open, remQ\)\)/.test(at));
ok('1c: MULTIPLE matches per transaction — the popup STAYS OPEN and refreshes after each apply; ✓ done closes; leaving a rest is stated as ◐ PARTIAL',
  /openMatch\(mPanel\.src, mQ, true\); load\(\);/.test(at) &&
  /✓ done/.test(at) && /leave the rest and it shows as ◐ PARTIAL/.test(at));
ok('1d: status chips — ◐ partial / ◐ split partial / 🔗 split full (N) / 🔗 matched / unmatched, derived from APPLIED MONEY not just a flag',
  /◐ \{legs > 1 \? 'split partial' : 'partial'\}/.test(at) &&
  /🔗 \{legs > 1 \? 'split full \(' \+ legs \+ '\)' : 'matched'\}/.test(at) &&
  /applied: appliedBy\[t7\.id\] \|\| 0, applied_legs: legsBy\[t7\.id\] \|\| 0/.test(er));
ok('1e: the 🔗 button SURVIVES a partial match (first apply used to hide it — second invoice was impossible); applied sums come from BOTH payment ledgers, fail-soft',
  /\(Number\(t\.applied\) \|\| 0\) > 0\.005 && \(Number\(t\.applied\) \|\| 0\) < t\.amount - 0\.005\)\) &&/.test(at) &&
  /catch \(eApW\) \{ appliedBy = \{\}; legsBy = \{\}; \}/.test(er));

var css = R('src/app/globals.css');
ok('2: the INVISIBLE CATEGORY fix — .nt-light beats the dark-skin !important on white panels (dark text, white options, light color-scheme), applied across the work surfaces',
  /select\.nt-light[\s\S]{0,200}color: #0f172a !important;/.test(css) &&
  /select\.nt-light option \{ background: #ffffff !important; color: #0f172a !important; \}/.test(css) &&
  /nt-light/.test(at) && /nt-light/.test(R('src/components/BillsTab.jsx')) && /nt-light/.test(R('src/components/ExpenseRulesTab.jsx')));

ok('3: RTM is a RADIO inside the bill match popup (normal bills ↔ RTM professional fee ↔ advance); no 🏢 button spam on every row — only flagged rows keep the chip',
  /Pay open bills \(normal\)/.test(at) && /RTM professional fee — pick the via-RTM bills it covers/.test(at) &&
  at.indexOf("'🏢 RTM ✓' : '🏢 RTM'") < 0);

var sqlQ = R('sql/v55-83-QF-advance-flag.sql');
ok('4a: ⏳ ADVANCE — one flag column; popup radio flags it, the ⏳ Advances filter finds it later, attaching bills is the normal guarded 🔗 flow, clear-flag button when done',
  /ADD COLUMN IF NOT EXISTS advance_flag boolean NOT NULL DEFAULT false;/.test(sqlQ) &&
  /if \(action === 'advance_flag'\)/.test(bills) && /advance_flag: 1/.test(bills) &&
  /⏳ Advance for FUTURE bills — flag now, attach the actual bills here later/.test(at) &&
  /'⏳ Advances'/.test(at) && /bills attached → clear ⏳ flag/.test(at));
ok('4b: advance is MONEY OUT only; pre-SQL error NAMES the QF file; all_transactions carries the flag with layered schema fallback',
  /An advance is MONEY OUT/.test(bills) && /run sql\/v55-83-QF-advance-flag\.sql first/.test(bills) &&
  /advance: t7\.advance_flag === true/.test(er) && /\/advance_flag\/\.test\(txA\.error\.message/.test(er));

ok('5a: hub → ClickBooks AUTOMATED — unmapped classification first tries EXACT normalized-name match (single hit only) and SAVES the mapping with auto evidence',
  /lower\(regexp_replace\(a\.name, '\[\^a-z0-9\]\+', ' ', 'gi'\)\) = lower\(regexp_replace\(cat_label/.test(sqlQ) &&
  /if hit_n = 1 then/.test(sqlQ) && /auto: exact name match to existing ledger account \(QF\)/.test(sqlQ));
ok('5b: still nothing → the ACCOUNT IS CREATED from the hub category (income kinds → income, expense/cogs → expense); loan/owner (not_pnl) and needs_clarification NEVER auto-created',
  /cat_kind in \('income','other_income','expense','cogs','other_expense'\)/.test(sqlQ) &&
  /insert into clickbooks_us\.accounts\(book_id, name, account_type, is_active, needs_review, is_bank_sensitive\)/.test(sqlQ) &&
  /auto: account created from hub category/.test(sqlQ));
ok('5c: transfers NEVER post as income/expense (classification transfer or paired group skipped+counted); create failures caught per category and REPORTED — the run never breaks',
  /if cls_key = 'transfer' or t\.transfer_group_id is not null then/.test(sqlQ) &&
  /exception when others then\s*\n\s*create_errors := jsonb_set/.test(sqlQ) &&
  /'autoMapped', auto_mapped, 'autoCreated', auto_created, 'autoCreateErrors', create_errors/.test(sqlQ));
ok('5d: same function name + signature — the 15-minute job keeps calling it with ZERO code changes; posting math and once-ever source identity untouched',
  /create or replace function clickbooks_us\.classified_sync_run\(p_from date, p_to date, p_actor uuid\)/.test(sqlQ) &&
  /perform clickbooks_us\.post_journal\(b\.id, coalesce\(t\.posted_date, t\.date\)/.test(sqlQ));

console.log('');
console.log('QF: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
