// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QB — RTM Capital third-party payer + bank-connections permission +
// honest deep-re-pull banner.
//
// Max (Nov 7 11:32): "we have a 3rd party (RTM Capital) that pays... when we
// make a professional fee payment to RTM it will be one line item under
// professional fees but underlying sub heading will be breakdown of these
// bills in the pnl report if i select a radio button... otherwise it would
// be as one fee for tax reporting."
// Max (11:38): "when we select RTM... it asks for what bills it's paid.
// Then we can select those bills and match those bills to that payment."
// Max (11:45): "bank connections are also a permissioning thing with super
// admin with all rights."
// Max (11:40): "where is the rest of the history... something is not right."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QB — RTM third-party payer + connections permission');

var sql = R('sql/v55-83-QB-rtm-third-party.sql');
ok('1a: two columns, idempotent — vendor_bills.paid_via + bank_transactions.third_party_payer, partial indexes',
  /ALTER TABLE vendor_bills\s+ADD COLUMN IF NOT EXISTS paid_via text;/.test(sql) &&
  /ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS third_party_payer text;/.test(sql) &&
  /WHERE paid_via IS NOT NULL/.test(sql) && /WHERE third_party_payer IS NOT NULL/.test(sql));

var bills = R('src/app/api/accounting/bills/route.js');
ok('2a: via-RTM bills NEVER count in what-we-owe / forecasts / shortages — isPayable excludes paid_via (one shared gate, money math in one place)',
  /function isPayable\(b\) \{ return b\.record_status === 'active' && b\.disputed !== true && !b\.paid_via && b\.open > 0\.005; \}/.test(bills));
ok('2b: covering a bill from the RTM payment is a NORMAL record_payment with method "rtm" — overpay + over-allocation guards reused, no duplicated money math',
  /if \(action === 'rtm_flag'\)/.test(bills) && /if \(action === 'rtm_open_bills'\)/.test(bills) &&
  !/from\('vendor_bill_payments'\)\.insert[\s\S]{0,200}method: 'rtm'/.test(bills) &&
  /WRITE_ACTIONS = \{[^\n]*rtm_flag: 1/.test(bills)); // (pin made append-proof — QF/QG kept adding WRITE actions to the same line)
ok('2c (QY generalized RTM to every paid-through company): the flag stamps MONEY-OUT only and names the QB SQL when the column is missing',
  /A payment to a paid-through company is MONEY OUT/.test(bills) &&
  /run sql\/v55-83-QB-rtm-third-party\.sql first\./.test(bills));
ok('2d: save_bill stores the via-RTM flag and SAYS when it could not (pre-SQL), on create and edit',
  /fields\.paid_via = String\(bl\.paid_via \|\| ''\)\.trim\(\)\.substring\(0, 60\) \|\| null;/.test(bills) &&
  bills.split('Saved WITHOUT the via-RTM flag').length === 3);
ok('2e: period_stats rtm block — payments from stamped out-txns, covered bills from method-rtm payments joined to the bill category, service_fee = payments − allocations',
  /\.not\('third_party_payer', 'is', null\)\.neq\('pending', true\)/.test(bills) &&
  /if \(p9\.method !== 'rtm' \|\| p9\.voided === true\) \{ return; \}/.test(bills) &&
  /service_fee: r2\(rtmPayTotal - rtmAllocTotal\)/.test(bills) &&
  /spend = \{ rtm: rtmBlk, paid_through: ptBlocks, categories: catRows/.test(bills)); // (QY: the RTM block is now one of the per-company blocks; rtm kept for back-compat)

var at = R('src/components/AllTransactionsTab.jsx');
ok('3a (QF realigned — Max 12:13: "not crazy that you put everything... with rtm symbol"): RTM entry lives in the 🔗 match popup as a RADIO; only flagged rows keep the 🏢 RTM ✓ chip',
  /RTM professional fee — pick the via-RTM bills it covers/.test(at) &&
  /t\.third_party && !t\.pending &&/.test(at) &&
  /🏢 RTM ✓/.test(at) && at.indexOf("'🏢 RTM ✓' : '🏢 RTM'") < 0);
ok('3b (QF wording): the picker enforces Σ selected ≤ the payment, shows the remainder as RTM\'s PROFESSIONAL/MANAGEMENT FEE, and per-bill writes go through record_payment method rtm',
  /exceed this payment/.test(at) && /RTM professional\/management fee \(the rest\): \$/.test(at) &&
  /action: 'record_payment', bill_id: p\.bill\.id, amount: p\.amount, paid_date: t\.date, bank_transaction_id: t\.id, method: 'rtm'/.test(at));
ok('3c: a mid-save failure is SAID with exactly how many bills stayed covered — never silent',
  /ARE covered and stay covered/.test(at));

var ps = R('src/components/PeriodStatsTab.jssx'.replace('jssx','jsx'));
ok('4a (QY: one switch PER company): default TAX view (one line); real-cost view re-buckets covered bills into their ACTUAL categories',
  /var sRt = useState\(\{\}\); var ptOn = sRt\[0\]/.test(ps) &&
  /Tax view — payments to \{pb\.payer\} stay ONE line/.test(ps) &&
  /Real-cost view — covered costs in their ACTUAL categories/.test(ps));
ok('4b: rtmAdjust conserves every total by construction: −payments + covered bills + service fee = 0',
  /map\[p\.key\]\.total = r2a\(map\[p\.key\]\.total - p\.total\); map\[p\.key\]\.rtm_out = p\.total;/.test(ps) &&
  /map\[a\.key\]\.total = r2a\(map\[a\.key\]\.total \+ a\.total\);/.test(ps) &&
  /RTM service fee \(payments − covered bills\)/.test(ps));
// RB (Max Nov 8 12:23, gap review) superseded "pack always tax view" for RELATED companies only:
// NextTrade's unspent advance is not deductible, so the pack runs taxCats() (affiliates real-cost,
// RTM still one line). Realigned, not dropped.
ok('4c (QY→RB): the switches apply to the spending table AND the income statement; the accountant TAX PACK keeps RTM one line and takes NextTrade advances out',
  ps.split('ptAdjust(data.spending.categories)').length === 3 && // (QY)
  /' — BREAKDOWN ON: ' \+ ptOnNames\.join/.test(ps) &&
  /\(taxCats\(data\.spending\.categories\) \|\| \[\]\)\.forEach\(function \(c\) \{ if \(c\.kind === 'cogs'\) \{ cogsP \+= c\.total; \}/.test(ps) &&
  /if \(b0\.kind === 'affiliate'\) \{ out = rtmAdjust\(out, b0\); \}/.test(ps));

var bt = R('src/components/BillsTab.jsx');
ok('5 (QY: checkbox became a company dropdown): Bills — 🏢 Paid via in the editor + via-company badge on the row',
  /paid_via: e\.target\.value \|\| null/.test(bt) &&
  /🏢 via \{b\.paid_via\}/.test(bt));

// ── connections permission (Max 11:45) ──
ok('6a: new catalog key bank.connections — connect/reconnect, deep re-pull, archive, move-to-silo; super admins always pass',
  /key: 'bank\.connections',\s+label: 'Bank: Manage Connections'/.test(R('src/components/SettingsTab.jsx')));
ok('6b: Plaid link + exchange gate on bank.connections (legacy categories.apply grant keeps working — nobody locked out)',
  /authorizePlaidOperation\(req, 'bank\.connections', false\); \}\n    catch \(eQB\) \{ access = await authorizePlaidOperation\(req, 'categories\.apply', false\); \}/.test(R('src/app/api/plaid/link/route.js')) &&
  /authorizePlaidOperation\(req, 'bank\.connections', false\); \}\n    catch \(eQB\) \{ access = await authorizePlaidOperation\(req, 'categories\.apply', false\); \}/.test(R('src/app/api/plaid/exchange/route.js')));
var ptr = R('src/app/api/plaid/transactions/route.js');
ok('6c: DEEP re-pull (explicit start_date) requires bank.connections; cron + verified super admin + normal incremental sync unchanged; gate sits AFTER body is read',
  /if \(body && body\.start_date && access && access\.via !== 'cron' && access\.isVerifiedSuperAdmin !== true\)/.test(ptr) &&
  ptr.indexOf('var start_date = body.start_date;') < ptr.indexOf("access.via !== 'cron'") &&
  /Deep re-pull history needs the "Bank: Manage Connections" permission/.test(ptr));

// ── honest zero-window banner (Max 11:40, M&T) ──
ok('7: a deep re-pull with Plaid total 0 says PLAID IS STILL BUILDING the 2-year history (+ archive-duplicate hint) — never "no recent activity"',
  /procN === 0 && totalN === 0 && win\.start && win\.incremental === false/.test(R('src/components/BankTab.jsx')) &&
  /Plaid builds the 2-year history in the background/.test(R('src/components/BankTab.jsx')));

console.log('');
console.log('QB: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
