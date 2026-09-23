// v55.83-NM — NextTrade orders ↔ Hub invoices reconciliation.
//
// Max (Sep 23 2026): "compare it to the invoices and release numbers that we
// have to make sure that we have invoices for each order that was created.
// and if not to have a report to show issues that don't match... And Ai to
// flag if there is a mismatch."
//
// This file FUNCTIONALLY tests the paste parser against the real shapes of
// Max's data (he pasted the live Orders table into chat — including the same
// block twice), then structurally protects the reconciliation rules.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var comp  = read('src/components/NexttradeReconciliation.jsx');
var route = read('src/app/api/reconcile/nexttrade/route.js');
var ai    = read('src/app/api/ai/reports/route.js');
var adm   = read('src/components/AdminTab.jsx');
var sql   = read('sql/v55-83-NM-nexttrade-orders.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — FUNCTIONAL: the parser against Max's real paste shapes
// ══════════════════════════════════════════════════════════════════
var fnStart = comp.indexOf('export function parseOrdersPaste');
var fnEnd = comp.indexOf('export default function');
var parseSrc = "var WAREHOUSES = ['Non-Bonded USA', 'CANADA', 'USA', 'Other'];\n"
  + "var STATUSES = ['Post Loading Documentation', 'End Stage', 'Shipped', 'Pending', 'Cancelled'];\n"
  + comp.slice(fnStart, fnEnd).replace('export function', 'function')
  + "\nmodule.exports = { parseOrdersPaste: parseOrdersPaste };\n";
var tmpFile = path.join(__dirname, '.nm-parser-under-test.js');
fs.writeFileSync(tmpFile, parseSrc);
var parseOrdersPaste = require(tmpFile).parseOrdersPaste;

var collapsed = [
  'Show  entries',
  'Search:',
  '#\tRELEASE #\tCUSTOMER\tWAREHOUSE',
  '1 1001-1640 Nexpac CANADA 0 09-22-2026 09-22-2026 -\t\tShipped\t\tUnknown 7256 0 0',
  '12 1002-1192 MAA KIRPA Non-Bonded USA MRSU2210620 09-04-2026 09-17-2026 11-04-2026\t\tShipped\t\tIndia 0 0 0',
  '29 1003-056 Elsayad trading company for plastic sheets Other TGHU6386726 08-06-2026 08-11-2026 10-28-2026\t\tShipped\t\tEgypt 0 0 0',
  '34 1001-1617 Bal Trading CANADA 0 08-04-2026 08-07-2026 -\t\tPost Loading Documentation\t\tCanada 0 0 0',
  'Showing 1 to 50 of 50 entries',
  '1 1001-1640 Nexpac CANADA 0 09-22-2026 09-22-2026 -\t\tShipped\t\tUnknown 7256 0 0'
].join('\n');
var P = parseOrdersPaste(collapsed);

ok('A1: header/footer junk ignored, duplicate paste blocks deduped by release #',
  P.rows.length === 4 && P.rows.filter(function (r) { return r.release_number === '1001-1640'; }).length === 1);
ok('A2: "Non-Bonded USA" is not mistaken for "USA"',
  P.rows[1].warehouse === 'Non-Bonded USA' && P.rows[1].container === 'MRSU2210620');
ok('A3: multi-word customer names survive (Elsayad trading company for plastic sheets)',
  P.rows[2].customer_name === 'Elsayad trading company for plastic sheets' && P.rows[2].warehouse === 'Other');
ok('A4: multi-word statuses parse (Post Loading Documentation)',
  P.rows[3].status === 'Post Loading Documentation');
ok('A5: quantities land in the right grade columns',
  P.rows[0].qty_seconds === 7256 && P.rows[0].qty_thirds === 0 && P.rows[0].qty_paper === 0);
ok('A6: local runs keep container "0"; dates keep the site format for the server to convert',
  P.rows[0].container === '0' && P.rows[0].order_date === '09-22-2026' && P.rows[0].arrival_date === '-');

var tabbed = '6\t1002-1196\tMAA KIRPA\tUSA\tTGBU6648188\t09-15-2026\t09-15-2026\t11-15-2026\t\tShipped\t\tIndia\t0\t46490\t0\t  ';
var P2 = parseOrdersPaste(tabbed);
ok('A7: browser tab-copy format parses identically',
  P2.rows.length === 1 && P2.rows[0].warehouse === 'USA' && P2.rows[0].qty_thirds === 46490 && P2.rows[0].country === 'India');

try { fs.unlinkSync(tmpFile); } catch (e) {}

// ══════════════════════════════════════════════════════════════════
// PART B — Import honesty
// ══════════════════════════════════════════════════════════════════
ok('B1: import upserts on release_number — re-pasting updates, never duplicates',
  /upsert\(clean, \{ onConflict: 'release_number' \}\)/.test(route) &&
  /release_number text NOT NULL UNIQUE/.test(sql));
ok('B2: server re-validates release format and converts MM-DD-YYYY dates',
  /\^\\d\{3,4\}-\\d\{2,5\}\$/.test(route) && /m\[3\] \+ '-' \+ m\[1\] \+ '-' \+ m\[2\]/.test(route));
ok('B3: import and report are Owner/Admin only, server-verified',
  /requireAdmin\(db, userId\)/.test(route) && /Owner\/Admin only/.test(route));
ok('B4: duplicate lines within one paste: first wins, reported back',
  /duplicates_in_paste/.test(route));

// ══════════════════════════════════════════════════════════════════
// PART C — Reconciliation rules
// ══════════════════════════════════════════════════════════════════
ok('C1: matcher tries BOTH invoice systems and attributes the field',
  /put\(v\.order_number, 'sales', 'order_number'/.test(route) &&
  /put\(v\.invoice_number, 'sales', 'invoice_number'/.test(route) &&
  /'accounting', 'invoice_number'/.test(route) && /matched_by_field/.test(route));
ok('C2: contains fallback exists and is labelled as such',
  /field \+ ' \(contains\)'/.test(route));
ok('C3: unmatched orders are ISSUES, never dropped',
  /orders_without_invoice: noInvoice/.test(route));
ok('C4: reverse direction — release-looking invoices with no order are reported',
  /invoices_without_order/.test(route) && /looksRelease/.test(route));
// v55.83-NN (Max's correction): Seconds/Thirds/Paper track only three product
// categories — zero across them does NOT mean nothing shipped. Zero-qty is
// deliberately NOT an issue anywhere.
ok('C5: zero-quantity is NOT flagged as an issue (removed on Max\'s correction, reason documented)',
  !/shipped_with_zero_qty/.test(route) &&
  /zero across them does NOT[\s\S]{0,30}mean nothing shipped/.test(route));
ok('C6: the report reads COMPLETE sets (paginated, no truncation)',
  /function fetchAll/.test(route) && /MAX_ROWS = 20000/.test(route));
ok('C7: the report route computes matches server-side and says so',
  /matched server-side/.test(route));

// ══════════════════════════════════════════════════════════════════
// PART D — Screen + AI flagging
// ══════════════════════════════════════════════════════════════════
ok('D1: screen mounted in Admin, gated (super admin or Sales module)',
  /nexttrade_recon/.test(adm) && /modulePerms\['Sales'\] === true/.test(adm));
ok('D2: the screen explains the copy steps from the admin site',
  /clear Row Limits \(blank = all\)/.test(comp));
ok('D3: preview before import, with recognized/ignored counts',
  /orders recognized/.test(comp) && /lines not understood/.test(comp));
ok('D4: every remaining table has its own CSV export (3 after zero-qty removal)',
  (comp.match(/⬇ CSV/g) || []).length === 3);
ok('D5: orders-without-invoice is the loudest section',
  /every one of these left a warehouse with no invoice found in the Hub/.test(comp));
// v55.83-NN — "flag it to someone": the missing-invoice list must reach a person.
ok('D5b: FLAG action creates ONE High ticket per run, assigned to the chosen person, due in 3 days',
  /action === 'flag'/.test(route) && /assignee_id required/.test(route) &&
  /priority: 'high'/.test(route) && /assigned_to: assignee/.test(route) &&
  /due\.setDate\(due\.getDate\(\) \+ 3\)/.test(route));
ok('D5c: the ticket lists the missing orders and where the full list lives',
  /NO matching invoice in the Hub/.test(route) && /needs an invoice created, or an explanation/.test(route));
ok('D5d: nothing-to-flag is honest (no empty tickets)',
  /Nothing to flag — every order in scope has an invoice/.test(route));
ok('D5e: the screen has the flag-to-person picker wired to the action',
  /🚩 Flag these to:/.test(comp) && /action: 'flag'/.test(comp) && /assignee_id: flagTo/.test(comp));
ok('D5f: zero-qty section and card removed from the screen',
  !/Shipped, zero qty scanned/.test(comp) && !/shipped_with_zero_qty/.test(comp));
ok('D5g: AI tool no longer reports zero-qty as an issue',
  !/shipped_zero_qty/.test(ai));
ok('D6: AI can flag mismatches — reconcile_orders tool exists in the reports engine',
  /name: 'reconcile_orders'/.test(ai) && /reconcile_orders: 'invoices\.view'/.test(ai) &&
  /orders_without_invoice: miss\.length/.test(ai));
ok('D7: AI tool explains itself when no orders are imported yet',
  /No NextTrade orders imported yet/.test(ai));
ok('D8: SQL is idempotent with the 4-policy RLS pattern',
  /IF NOT EXISTS nexttrade_orders/.test(sql) && (sql.match(/CREATE POLICY/g) || []).length === 4);

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-NM/NN nexttrade reconciliation');
}

// ══════════════════════════════════════════════════════════════════
// v55.83-NO ADDENDUM — the Release # column (Max Sep 23: "every order has a
// reference number and a release number. we need another column in our hub").
// ══════════════════════════════════════════════════════════════════
(function () {
  var fs4 = require('fs');
  var path4 = require('path');
  function rd(rel) { return fs4.readFileSync(path4.join(__dirname, '..', rel), 'utf8'); }
  var acct = rd('src/components/AccountingInvoicesTab.jsx');
  var rt = rd('src/app/api/reconcile/nexttrade/route.js');
  var ai2 = rd('src/app/api/ai/reports/route.js');
  var sq = rd('sql/v55-83-NO-release-number.sql');
  var f = [];
  function okO(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }

  okO('NO1: SQL adds release_number to BOTH invoice tables, indexed, idempotent',
    /ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS release_number text;/.test(sq) &&
    /ALTER TABLE invoices\s+ADD COLUMN IF NOT EXISTS release_number text;/.test(sq) &&
    (sq.match(/CREATE INDEX IF NOT EXISTS/g) || []).length === 2);
  okO('NO2: the accounting invoice form has a Release # field with a real example',
    /Release #/.test(acct) && /e\.g\. 1002-1193/.test(acct));
  okO('NO3: release_number saves on create AND edit (single payload builder), trimmed, empty -> null',
    /release_number: \(hdr\.release_number \|\| ''\)\.trim\(\) \|\| null/.test(acct));
  okO('NO4: editing an existing invoice loads it (full-row setHdr)',
    /setHdr\(Object\.assign\(\{\}, row\)\)/.test(acct));
  okO('NO5: invoice search finds by release number',
    /r\.release_number \|\| ''\)/.test(acct));
  okO('NO6: the reconciliation matcher treats release_number as the FIRST-CLASS key on both systems',
    /put\(v\.release_number, 'sales', 'release_number'/.test(rt) &&
    /put\(v\.release_number, 'accounting', 'release_number'/.test(rt) &&
    /DEDICATED join key/.test(rt));
  okO('NO7: reverse check prefers the explicit release_number over pattern guessing',
    /var cand = v\.release_number \|\|/.test(rt) && /var cand2 = v\.release_number \|\|/.test(rt));
  okO('NO8: the AI reconcile tool and invoice listing carry the column',
    /select\('order_number, invoice_number, release_number'\)/.test(ai2) &&
    /select\('invoice_number, release_number'\)/.test(ai2) &&
    /release_number, customer_name, customer_name_en/.test(ai2));

  if (f.length) { console.log('NO FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL NO ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-NP ADDENDUM — fast backfill of release numbers on OLD invoices
// (Max: "we have a lot of things we have to go back and enter... an open
//  field that we can input and save right from that screen").
// ══════════════════════════════════════════════════════════════════
(function () {
  var fs5 = require('fs');
  var path5 = require('path');
  function rd2(rel) { return fs5.readFileSync(path5.join(__dirname, '..', rel), 'utf8'); }
  var rt2 = rd2('src/app/api/reconcile/nexttrade/route.js');
  var cp2 = rd2('src/components/NexttradeReconciliation.jsx');
  var f = [];
  function okP(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }

  okP('NP1: list_missing returns invoices with NO release number from BOTH systems, newest first, searchable',
    /action === 'list_missing'/.test(rt2) && /\.is\('release_number', null\)/.test(rt2) &&
    /system: 'accounting'/.test(rt2) && /system: 'sales'/.test(rt2) && /total_missing/.test(rt2));
  okP('NP2: set_release saves inline per invoice, format-checked, empty clears, wrong id honest 404',
    /action === 'set_release'/.test(rt2) && /Release format looks wrong/.test(rt2) &&
    /release_number: rn \|\| null/.test(rt2) && /Invoice not found\./.test(rt2));
  okP('NP3: the screen has the open-field entry table with per-row Save',
    /Enter release numbers on old invoices/.test(cp2) && /Release # \(type \+ Save\)/.test(cp2) &&
    /action: 'set_release'/.test(cp2));
  okP('NP4: saved rows leave the list and the counter drops (burn-down feel)',
    /prev\.missing\.filter\(function \(x\) \{ return \(x\.system \+ ':' \+ x\.id\) !== k; \}\)/.test(cp2) &&
    /total_missing: prev\.total_missing - 1/.test(cp2));
  okP('NP5: Enter key saves (keyboard-first entry)',
    /e\.key === 'Enter'/.test(cp2));
  okP('NP6: empty list is celebrated honestly',
    /Every invoice has a release number/.test(cp2));

  if (f.length) { console.log('NP FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL NP ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-NQ ADDENDUM — automated 6-hour reconciliation (Max: "I would like
// this to be automated. checked like every 6 hours").
// ══════════════════════════════════════════════════════════════════
(function () {
  var fsq = require('fs'); var pq = require('path');
  function rq(rel) { return fsq.readFileSync(pq.join(__dirname, '..', rel), 'utf8'); }
  var rt3 = rq('src/app/api/reconcile/nexttrade/route.js');
  var vj = JSON.parse(rq('vercel.json'));
  var sq2 = rq('sql/v55-83-NQ-recon-cron.sql');
  var f = [];
  function okQ(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }

  okQ('NQ1: vercel cron runs the check every 6 hours',
    vj.crons.some(function (c) { return c.path === '/api/reconcile/nexttrade' && c.schedule === '0 */6 * * *'; }));
  okQ('NQ2: GET is CRON_SECRET-guarded (401 otherwise)',
    /authHeader !== 'Bearer ' \+ process\.env\.CRON_SECRET/.test(rt3));
  okQ('NQ3: each gap is flagged ONCE ever — only flagged_at-null orders make a new ticket',
    /if \(!od\.flagged_at\) \{ newMiss\.push\(od\); \}/.test(rt3) &&
    /ALTER TABLE nexttrade_orders ADD COLUMN IF NOT EXISTS flagged_at timestamptz;/.test(sq2));
  okQ('NQ4: both auto and manual flag stamp flagged_at',
    (rt3.match(/update\(\{ flagged_at: new Date\(\)\.toISOString\(\) \}\)/g) || []).length === 2);
  okQ('NQ5: assignee = RECON_ASSIGNEE_EMAIL profile, else first super_admin; unresolvable is an honest error',
    /RECON_ASSIGNEE_EMAIL/.test(rt3) && /eq\('role', 'super_admin'\)\.limit\(1\)/.test(rt3) &&
    /no assignee resolvable/.test(rt3));
  okQ('NQ6: the auto ticket says it is automated and reports new vs total missing',
    /AUTOMATED RECONCILIATION \(6-hour check/.test(rt3) && /still_missing_total/.test(rt3));

  if (f.length) { console.log('NQ FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL NQ ADDENDUM CHECKS PASSED'); }
})();
