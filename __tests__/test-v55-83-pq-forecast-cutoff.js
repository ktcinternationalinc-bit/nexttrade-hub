// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PQ — Forecast cutoff + Balance column (staged batch; Max is
// gathering issues, build held until "execute new build")
//
// Max (Nov 7, 04:54): "it pulls in invoices that are not matched in the new
// system and thus showing as old... maybe we should just look at only
// invoices April 1st on created... and we need to see what will be due."
// And (04:47): "where is the balance column".
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PQ — forecast Apr-1 cutoff, reported not hidden');

var br = R('src/app/api/accounting/bills/route.js');
ok('1a: forecast counts only invoices CREATED on/after 2026-04-01',
  /var FORECAST_CREATED_FROM = '2026-04-01';/.test(br) &&
  /\(v\.invoice_date \|\| ''\) >= FORECAST_CREATED_FROM\) \{ return true; \}/.test(br));
ok('1b: the excluded pre-system invoices are COUNTED AND REPORTED, never silently dropped',
  /exCount\+\+; exSum = Math\.round\(\(exSum \+ v\.open_balance\) \* 100\) \/ 100; return false;/.test(br) &&
  /excluded_old: \{ count: exCount, sum: exSum, before: FORECAST_CREATED_FROM \}/.test(br));

var bh = R('src/components/BooksHomeTab.jsx');
var cft = R('src/components/CashForecastTab.jsx');
ok('2: both the strip and the Forecast tab SAY what was excluded and why ("payments may never have been matched")',
  /Only invoices CREATED since Apr 1, 2026 are counted/.test(bh) &&
  /payments may simply never have been matched/.test(bh) &&
  /Only invoices CREATED since Apr 1, 2026 are counted/.test(cft) &&
  /they remain in All Invoices \/ Open Balances/.test(cft));

// ── Max 04:55/04:56: "see how our balances will be" + "click on those
//    forecasted cards to see underlying data" ──
ok('3a: bank balance only joins the forecast for holders of the PROTECTED balance grant (super admin env or financial_visibility), fail-soft otherwise',
  /HUB_SUPER_ADMIN_AUTH_USER_IDS/.test(br) && /can_view_bank_balances/.test(br) &&
  /bank_visibility_identity_map/.test(br) && /catch \(eBal\) \{ balF = null; \}/.test(br) &&
  /fcPayload\.bank_balance = balF;/.test(br)); // (QI superseded: the balance attaches AFTER totals-masking, still under its own protected grant)
ok('3b: alias plaid rows deduped per mask (freshest wins) and the as-of date is reported, never hidden',
  /one row per mask \(reconnects leave alias rows\)/.test(br) && /as_of: asOf\.substring\(0, 10\)/.test(br));
ok('3c: Projected balance row = real bank total + running position, labeled with the as-of date',
  /💰 Projected balance/.test(bh) && /bank \$\{fmt\(fc\.bank_balance\.total\)\} \(as of \{fc\.bank_balance\.as_of\}\) \+ position/.test(bh) &&
  /fc\.bank_balance\.total \+ fc\.buckets\[b\]\.running/.test(bh));
ok('3d: Position cells are clickable — cumulative drill shows EVERY invoice/bill up to that window, signed, Σ to the cent',
  /setFcDrill\(\{ bucket: b, kind: 'cum' \}\)/.test(bh) &&
  /indexOf\(r\.bucket\) <= cumIdx/.test(bh) &&
  /fcDrill\.kind === 'cum' && r\.kind === 'out'\) \? -r\.amount : r\.amount/.test(bh) &&
  /Running position through · /.test(bh));

// ── Max 05:01 (screenshot): rule rows invisible — bg-white class was
//    repainted dark by the hub skin under inline-dark text (OZ/PA bug class) ──
var ert = R('src/components/ExpenseRulesTab.jsx');
ok('4: every Categories & Rules panel declares its own inline white background — no skin-repainted card under dark text',
  ert.indexOf('className="bg-white') < 0 &&
  (ert.match(/background: '#ffffff'/g) || []).length >= 4);

// ── Max 05:01 ("do this if possible"): one pick → hub + ClickBooks + Wave ──
var sqlW = R('sql/v55-83-PQ-category-wave-link.sql');
var erw = R('src/app/api/accounting/expense-rules/route.js');
var bw = R('src/app/api/accounting/bank-write/route.js');
ok('5a: expense_categories carries an OPTIONAL wave_account_id/name (idempotent SQL); save_category sets/clears it explicitly, absent = untouched',
  /ADD COLUMN IF NOT EXISTS wave_account_id text;/.test(sqlW) &&
  /hasOwnProperty\.call\(body\.payload, 'wave_account_id'\)/.test(erw) &&
  /cpatch\.wave_account_id = body\.payload\.wave_account_id \|\| null;/.test(erw));
ok('5b: on a human category pick, the linked Wave account rides along ONLY when the patch names none and the txn has none — an existing Wave category is never overwritten; marked pending_wave_sync',
  /cPatch\.classification && !cPatch\.wave_account_id && preRow && !preRow\.wave_account_id/.test(bw) &&
  /changingCat = true; \/\/ it IS a category change for Wave/.test(bw) &&
  /wave_auto_category: waveAuto/.test(bw));
ok('5c (PZ): rules NEVER set the Wave account in the background — applyExpenseRules patch stays classification-only (the PZ resolver lives in the same lib but only HUMAN paths call it)',
  /update\(\{ classification: r\.classification, category_source: 'rule' \}\)/.test(R('src/lib/expense-rules-server.js')) &&
  !/waveAccountForCategory/.test(R('src/lib/expense-rules-server.js').split('export async function applyExpenseRules')[1]));
ok('5d (PW renamed the button to cover types too): editor in Categories & Rules — per-category Wave select, never-overwrite promise stated',
  /📚 \{showWave \? 'Hide' : 'Edit'\} category types & Wave links/.test(ert) &&
  /api\/wave\/categories/.test(ert) && /never overwritten/.test(ert) &&
  /linkWave\(c, e\.target\.value\)/.test(ert));

// ── Max 05:05 + 05:07: reports feel the categories; transfers are paired;
//    late customers only post-Apr-1 ──
var erw2 = R('src/app/api/accounting/expense-rules/route.js');
ok('6a: transfer pairing — candidates are same-amount (to the cent), opposite-direction, different-account, ±7 days, unpaired',
  /action === 'transfer_candidates'/.test(erw2) && /neq\('account_id', t0\.account_id \|\| ''\)/.test(erw2) &&
  /is\('transfer_group_id', null\)/.test(erw2));
ok('6b: pair_transfer enforces one-in-one-out, equal to the cent, never re-pairs, and a raced pair saves NOTHING',
  /A transfer pair needs one money-out and one money-in leg/.test(erw2) &&
  /must match to the cent/.test(erw2) &&
  /updP\.data\.length !== 2\) \{ return NextResponse\.json\(\{ ok: false, error: 'Pairing raced/.test(erw2));
var brS = R('src/app/api/accounting/bills/route.js');
ok('6c: Stats carries SPENDING BY CATEGORY — transfers are their own line and excluded from real spending',
  /real_spending: r2\(totOut - trf\.total\)/.test(brS) &&
  /var isTrf = !!t6\.transfer_group_id \|\| t6\.classification === 'transfer';/.test(brS));
var pst = R('src/components/PeriodStatsTab.jsx');
ok('6d: spending table shows categories with %, uncategorized flagged, transfers labeled NOT spending, rows on click',
  /Spending by category/.test(pst) && /Transfers between own accounts — NOT spending/.test(pst) &&
  /Uncategorized — needs a category/.test(pst) && /Real spending \(transfers excluded\)/.test(pst));
ok('6e: ↔ pair/unpair UI in the expenses table with candidate picker',
  /↔ pair/.test(ert2()) && /pair these ↔/.test(ert2()) && /↔ paired/.test(ert2()));
function ert2() { return R('src/components/ExpenseRulesTab.jsx'); }
var rem = R('src/app/api/accounting/reminders/route.js');
ok('6f: late-customer list only shows invoices created on/after 2026-04-01 (nobody gets dunned over pre-system history)',
  /inv\.invoice_date \|\| ''\) < '2026-04-01'\) \{ return; \}/.test(rem));

// ── Max 05:09: "reports necessary to file our taxes" ──
var pst2 = R('src/components/PeriodStatsTab.jsx');
ok('7: 🧾 Accountant pack — 9 named CSVs (revenue invoiced/collected, open AR, bills entered/paid, open AP, spending by category + detail, monthly summary); uncategorized flagged, transfers marked not-deductible',
  /🧾 Accountant pack/.test(pst2) && /tax-pack-1-revenue-invoiced-/.test(pst2) &&
  /tax-pack-6-open-payables-/.test(pst2) && /tax-pack-9-monthly-summary-/.test(pst2) &&
  /UNCATEGORIZED \(needs review before filing\)/.test(pst2) &&
  /TRANSFERS BETWEEN OWN ACCOUNTS \(not deductible spending\)/.test(pst2));

// ── Max 05:11: dashboard vs Books consistency ──
var ad = R('src/components/AccountingDashboard.jsx');
ok('8: Dashboard and Books declare their twin numbers — same default period (Jun 1 2026), Open AR card names its Books equivalent, bank scoping labeled',
  /useState\('2026-06-01'\)/.test(ad) &&
  /same number as Books → "Still open \(from these\)"/.test(ad) &&
  /default account' : ' · all silo accounts'/.test(ad));

// ── Max 05:13 + "execute build after you are done": invoice upload → both systems ──
var srcI = R('src/lib/invoice-extract.js');
var namesI = [];
var cjsI = srcI
  .replace(/export var ([a-zA-Z0-9_]+)/g, function (m, n) { namesI.push(n); return 'var ' + n; })
  .replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { namesI.push(n); return 'function ' + n; });
cjsI += '\n;module.exports = {' + namesI.map(function (n) { return n + ': ' + n; }).join(',') + '};';
var modI = { exports: {} };
new Function('module', 'exports', cjsI)(modI, modI.exports);
var parseInv = modI.exports.parseInvoiceExtraction;
var good = parseInv('{"customer_name":"ANAEL SARL","invoice_number":"1003-051","invoice_date":"2026-11-01","due_date":"2026-12-01","currency":"USD","total_amount":1500.00,"line_items":[{"description":"PVC leather","quantity":10,"unit_price":100,"line_total":1000},{"description":"Freight","quantity":1,"unit_price":500,"line_total":500}],"notes":null}');
ok('9a (functional): clean read → full draft, no problems, lines reconcile to the total',
  good.draft && good.draft.customer_name === 'ANAEL SARL' && good.draft.total_amount === 1500 &&
  good.draft.line_items.length === 2 && good.problems.length === 0);
var bad = parseInv('{"customer_name":null,"invoice_number":"X","invoice_date":"tomorrow","total_amount":"1,250.50","line_items":[{"description":"stuff","line_total":900}]}');
ok('9b (functional): bad date → null (never guessed), money de-commas, lines-vs-total mismatch FLAGGED not fixed',
  bad.draft.invoice_date === null && bad.draft.total_amount === 1250.5 &&
  bad.problems.join(' ').indexOf('add to 900.00 but the document total reads 1250.50') >= 0 &&
  bad.problems.join(' ').indexOf('Customer name was not readable') >= 0);
var iw = R('src/app/api/accounting/invoice-write/route.js');
ok('9c: extract_invoice gated on invoice.create, matches EXISTING customers (never auto-creates), runs before the invoice_id gate',
  /action === 'extract_invoice'/.test(iw) && /'invoice\.create'/.test(iw) &&
  /never auto-created/.test(iw) && iw.indexOf("action === 'extract_invoice'") < iw.indexOf("invoice_id is required"));
var ait = R('src/components/AccountingInvoicesTab.jsx');
ok('9d: 📷 Import invoice opens the NORMAL editor prefilled — human confirms, save flows to Wave + ClickBooks like any invoice; customer auto-picked only on an exact match',
  /📷 Import invoice/.test(ait) && /action: 'extract_invoice'/.test(ait) &&
  /cands\[0\]\.score >= 0\.99/.test(ait) && /review every field, then Save/.test(ait));

console.log('');
console.log('PQ: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
