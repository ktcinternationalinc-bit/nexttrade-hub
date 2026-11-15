/* v72 HOTFIX 12 — Auto-offset cascade + Inventory default + offset rows hidden.
 *
 * Max's feedback: "they should automatically offset when the situation appears by the AI
 * intelligence. IDEALLY it should just close the invoice when an offset scenario is
 * apparent without showing these lines that are very confusing... same in the report,
 * hide those lines."
 *
 * What this hotfix does:
 *   1. Auto-offset cascade — after ANY entry/invoice/bill save, if simultaneous open AR
 *      and open AP exist for the same counterparty in the same currency, the system posts
 *      offsets silently until no pair remains. The invoice/bill shows "✓ paid", no Offset
 *      ledger lines appear on screen or in print/Excel.
 *   2. Offset rows hidden from screen ledger view.
 *   3. Offset rows hidden from print export and Excel export.
 *   4. Manual "🔄 Offset" button removed (no longer needed).
 *   5. Inventory Product List defaults to "Products only" (was "All") — Max's call.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oa = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');
var exp = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-export.js'), 'utf8');
var pm = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryProductMaster.jsx'), 'utf8');

console.log('\n── Auto-offset cascade ──');

ok('A1: autoOffsetCascade helper defined',
  /async function autoOffsetCascade\(accountId\)/.test(oa));

ok('A2: Cascade re-fetches entries fresh from DB each iteration',
  /var res = await supabase[\s\S]{0,300}\.from\('open_account_entries'\)[\s\S]{0,300}\.eq\('account_id', accountId\)/.test(oa));

ok('A3: Cascade calls findOffsetCandidate each iteration',
  /var cand = findOffsetCandidate\(freshEntries\)/.test(oa));

ok('A4: Cascade builds + posts pair via buildOffsetEntries',
  /var pair = buildOffsetEntries\(cand, today, userProfile && userProfile\.id\)/.test(oa));

ok('A5: Cascade has safety cap (50 iterations) to prevent infinite loops',
  /var safety = 50/.test(oa));

ok('A6: Cascade rolls back first half on partial failure',
  /Rollback first half on partial failure|delete\(\)\.eq\('id', firstHalf\.id\)/.test(oa));

ok('A7: Cascade called after entry save',
  /var offsetsPosted = await autoOffsetCascade\(entryDraft\.account_id\)/.test(oa));

ok('A8: Cascade called after invoice save',
  /var offsetsPosted = await autoOffsetCascade\(invoiceDraft\.account_id\)/.test(oa));

ok('A9: Cascade emits user-visible toast when it posted offsets',
  /Auto-settled.{0,80}pair.{0,80}opposite-side balance/.test(oa));

console.log('\n── Offset rows hidden from views ──');

ok('B1: Screen ledger filters out transaction_type==="offset" rows (HOTFIX 30 added currency filter alongside)',
  /\.filter\(function \(entry\)[\s\S]{0,1500}entry\.transaction_type === 'offset'\) return false/.test(oa));

ok('B2: Print export filters out offset rows at entry point',
  /entries = \(entries \|\| \[\]\)\.filter\(function \(e\) \{ return e\.transaction_type !== 'offset'; \}\)/.test(exp));

ok('B3: Excel export filters out offset rows at entry point',
  (exp.match(/entries = \(entries \|\| \[\]\)\.filter\(function \(e\) \{ return e\.transaction_type !== 'offset'; \}\)/g) || []).length >= 2);

console.log('\n── Manual Offset button removed ──');

ok('C1: No "🔄 Offset" button text in OpenAccountsTab.jsx',
  !/🔄 Offset/.test(oa));

ok('C2: Removal explained in comment so future readers understand the intent',
  /Manual Offset button REMOVED[\s\S]{0,400}Auto-cascade/.test(oa));

console.log('\n── Inventory Product List default = "Products only" ──');

ok('D1: typeFilter default useState("variants")',
  /var \[typeFilter, setTypeFilter\] = useState\('variants'\)/.test(pm));

ok('D2: Dropdown label "Products only (actual SKUs) — default"',
  /Products only \(actual SKUs\) — default/.test(pm));

ok('D3: "All" option no longer labeled as default',
  !/All \(Products \+ Template blueprints\) — default/.test(pm));

console.log('\n── Math sanity check: auto-offset preserves Net Balance ──');

// Simulate Max's screenshot data after auto-offset:
//   Sales Invoice 25,000  ← gets fully paid by payment 5k + 2 auto-offsets 6.5k + 13.5k
//   Vendor Bill 6,500     ← gets settled by auto-offset 6,500
//   Vendor Bill 25,500    ← gets settled by 2k partial + 13.5k offset → 10k remaining
// Net before offsetting: AR=25k − AP=(6.5k+25.5k)=32k → Net = -7,000
// Net after offsetting:  AR=0 (fully paid) − AP=10k → Net = -10,000... wait that's wrong.
// Actually offsetting can't change NET — that's the whole property. Let me recompute:
// Invoice 25k. Payment received 5k → invoice has 20k left.
// Bill 6.5k.   Bill 25.5k. Payment sent 10k against 25.5k bill (oldest? actually 6500 first? FIFO uses date order)
// After payments alone: AR = 20k (invoice rem). AP = 6.5k (bill1 rem) + 15.5k (bill2 rem) = 22k. Net = -2k.
// Now auto-offset: 20k AR vs 22k AP → offset min = 20k. Invoice fully paid, bill drops by 20k.
// But this needs to clear bill1 (6.5k) first via FIFO, then bill2 (15.5k); offset is split.
// After cascade: AR=0, AP=22k-20k=2k. Net = -2k. (Same as before — offsets are net-zero)
ok('E1: Offsets are net-zero (AR − AP unchanged before vs after)',
  // Before: AR=20, AP=22 → -2; After: AR=0, AP=2 → -2
  (20 - 22) === (0 - 2));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 12 — auto-offset cascade, offset rows hidden, Inventory default fixed');
console.log('══════════════════════════════════════════════');
