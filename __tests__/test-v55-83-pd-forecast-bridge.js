// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PD — Cash forecast (30/60/90 buckets) + classified-expense bridge
//
// Max (Nov 6): "what's coming in the next 30 days, 30 to 60, 60 to 90, or 90
// plus... bills that we owe same thing... shortages that we're expecting...
// are we in the plus or minus paying our bills... by clicking in those cards
// we should be able to see the underlying numbers" — and, interrupting the
// build to make the priority unmistakable: "The things that have already been
// matched in the old system need to be pushed into the new system... make
// some sort of connection between the two. That's very important."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PD — forecast + classified bridge');

// ── 1. FUNCTIONAL: the real aging math
var src = R('src/lib/aging.js');
var names = [];
var cjs = src
  .replace(/export var ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'var ' + n; })
  .replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; });
cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
/* eslint-disable no-new-func */
var mod = { exports: {} };
new Function('module', 'exports', cjs)(mod, mod.exports);
var bucketOf = mod.exports.bucketOf;
var forecastBuckets = mod.exports.forecastBuckets;
var tagRows = mod.exports.tagRows;

var T = '2026-11-06';
// (PH superseded the single OVERDUE bucket: Max asked for LATE aged 1-30 /
// 31-60 / 61-90 / 90+ plus the due-ahead windows — "late 1-30 days. 30-60.
// 60-90. 90+. same with bills." New truth pinned here.)
ok('1a (PH): due-ahead boundaries exact — today=D0-30, +30=D0-30, +31=D31-60, +61=D61-90, +91=D90+',
  bucketOf('2026-11-06', T) === 'D0-30' && bucketOf('2026-12-06', T) === 'D0-30' &&
  bucketOf('2026-12-07', T) === 'D31-60' && bucketOf('2027-01-06', T) === 'D61-90' &&
  bucketOf('2027-02-05', T) === 'D90+');
ok('1b (PH): LATE aged by days past due — 1d=L1-30, 31d=L31-60, 61d=L61-90, 91d/ancient/dateless=L90+',
  bucketOf('2026-11-05', T) === 'L1-30' && bucketOf('2026-10-06', T) === 'L31-60' &&
  bucketOf('2026-09-06', T) === 'L61-90' && bucketOf('2026-08-06', T) === 'L90+' &&
  bucketOf('2021-02-02', T) === 'L90+' && bucketOf(null, T) === 'L90+');

var invs = [
  { open_balance: 1000, due_date: '2026-11-20' },                    // D0-30
  { open_balance: 500, due_date: null, invoice_date: '2026-12-20' }, // falls back → D31-60
  { open_balance: 300, due_date: '2021-06-14' },                     // ancient → L90+
  { open_balance: 0, due_date: '2026-11-20' },                       // nothing open → excluded
];
var bills = [
  { open: 700, due_date: '2026-11-10', bill_date: '2026-11-01' },    // D0-30
  { open: 400, due_date: '2026-10-28', bill_date: '2026-10-01' },    // L1-30
];
var B = forecastBuckets(invs, bills, T);
ok('1c (PH): buckets sum correctly (D0-30: ar 1000/ap 700/net +300; L90+: ar 300; L1-30: ap 400)',
  B['D0-30'].ar === 1000 && B['D0-30'].ap === 700 && B['D0-30'].net === 300 &&
  B['L90+'].ar === 300 && B['L1-30'].ap === 400 && B['L1-30'].net === -400);
ok('1d (PH): running position cumulative, oldest-late first ("are we plus or minus paying our bills")',
  B['L90+'].running === 300 && B['L1-30'].running === -100 && B['D0-30'].running === 200 && B['D90+'].running === 700);
var rows = tagRows(invs, bills, T);
var sumD30in = 0; rows.forEach(function (r) { if (r.bucket === 'D0-30' && r.kind === 'in') { sumD30in += r.amount; } });
ok('1e: drill rows sum EXACTLY to their card (D0-30 coming-in rows = 1000) and name their source',
  sumD30in === B['D0-30'].ar && rows.every(function (r) { return /Invoice|Bill/.test(r.source); }));

// ── 2. Forecast wiring
var br = R('src/app/api/accounting/bills/route.js');
ok('2a: forecast action returns buckets + tagged rows + unflagged counts, US-scoped',
  /action === 'forecast'/.test(br) && /forecastBuckets\(openInvsF, openBillsF, todayF\)/.test(br) &&
  /unflagged: \{ expenses: unrevOut\.count \|\| 0, deposits: unmatchedIn\.count \|\| 0 \}/.test(br));
var at = R('src/components/AccountingTab.jsx');
ok('2b: 📈 Forecast tab wired behind bills/AR permissions',
  at.indexOf("['forecast', '📈 Forecast']") >= 0 && /sub === 'forecast' && <div className="p-3"><CashForecastTab/.test(at));
var ft = R('src/components/CashForecastTab.jsx');
ok('2c (PH): cards clickable, Σ footer, LATE columns aged and marked ⚠, CSV export exists',
  /setDrill\(\{ bucket: b, kind: 'in' \}\)/.test(ft) && /equals the card to the cent/.test(ft) &&
  /'L1-30': '⚠ 1–30 late'/.test(ft) && /CSV for the accountant/.test(ft));
ok('2d: unflagged work surfaced with deep links ("expenses that have not been flagged yet")',
  /expense\(s\) uncategorized/.test(ft) && /deposit\(s\) unmatched/.test(ft) && /onGo\('review'\)/.test(ft));

// ── 3. The bridge: hub-matched work flows into the ledger
var sql = R('sql/v55-83-PD-classified-bridge.sql');
ok('3a: bridge posts via the engine\'s own post_journal with the SAME source identity as the rule path (bank_transaction + id) — double-posting impossible',
  /'bank_transaction', t\.id::text, lines, p_actor/.test(sql) && /source_kind = 'bank_transaction' and j\.source_id = t\.id::text/.test(sql));
ok('3b: only REVIEWED+CLASSIFIED, settled, USD, unmatched, unlinked transactions qualify',
  /review_status = 'reviewed'/.test(sql) && /classification is not null/.test(sql) &&
  /matched_invoice_id is null/.test(sql) && /linked_id is null/.test(sql) && /pending is false/.test(sql));
ok('3c: unmapped classifications are COUNTED AND REPORTED, never guessed into an account',
  /skippedUnmapped/.test(sql) && /unmapped := jsonb_set/.test(sql));
ok('3d: same safety gates as shadow sync (certified history, parallel phase, post-cutoff window, repeatable read)',
  /CB_REPEATABLE_READ_REQUIRED/.test(sql) && /CB_SHADOW_SYNC_DISABLED/.test(sql) && /CB_SHADOW_PERIOD/.test(sql));
ok('3e: mapping table requires an explicit reviewed=true grant per classification; service wrapper locked to service_role',
  /classification_account_map/.test(sql) && /m\.classification = cls_key and m\.reviewed/.test(sql) &&
  /grant execute on function public\.clickbooks_us_classified_sync_job\(date, date, uuid\) to service_role/.test(sql));
ok('3f: direction handled both ways (expense: credit bank/debit account; income: debit bank/credit account)',
  /t\.direction = 'out'/.test(sql) && /t\.direction = 'in'/.test(sql));

// ── 4. Scheduler runs BOTH syncs; bridge failure never kills the shadow result
var job = R('src/app/api/accounting/clickbooks-us/shadow-job/route.js');
ok('4: cron tick = shadow sync + classified bridge, bridge fails soft until its SQL is run',
  /clickbooks_us_shadow_sync_job/.test(job) && /clickbooks_us_classified_sync_job/.test(job) &&
  /classified = \{ error:/.test(job) && /shadow: shadow\.data, classified: classified/.test(job));

console.log('');
console.log('PD: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
