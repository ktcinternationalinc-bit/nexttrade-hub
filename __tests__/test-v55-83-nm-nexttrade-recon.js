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
  + "var STATUSES = ['Post Loading Documentation', 'End Stage', 'Shipped', 'Pending', 'Cancelled', 'Closed', 'Delivered', 'Completed'];\n"
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
ok('B3: import and report are Owner/Admin only, verified against the USERS table (profiles lookup rejected everyone incl. super admin — NS fix)',
  /requireAdmin\(db, userId\)/.test(route) && /Owner\/Admin only/.test(route) &&
  /from\('users'\)\.select\('id, role'\)/.test(route) &&
  !/from\('profiles'\)/.test(route));
ok('B4: duplicate lines within one paste: first wins, reported back',
  /duplicates_in_paste/.test(route));

// ══════════════════════════════════════════════════════════════════
// PART C — Reconciliation rules
// ══════════════════════════════════════════════════════════════════
ok('C1: matcher tries BOTH invoice systems and attributes the field (sales has NO invoice_number — NW)',
  /put\(v\.order_number, 'sales', 'order_number'/.test(route) &&
  !/'sales', 'invoice_number'/.test(route) &&
  /sales invoices have NO invoice_number column/.test(route) &&
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
ok('D1: screen lives under ACCOUNTING (NV move — it is accounting work), not Admin',
  (function () {
    var acct2 = fs.readFileSync(path.join(__dirname, '..', 'src/components/AccountingTab.jsx'), 'utf8');
    return /\['recon', '🔎 Order Reconciliation'\]/.test(acct2) &&
      /sub === 'recon' && <NexttradeReconciliation/.test(acct2) &&
      !/nexttrade_recon/.test(adm);
  })());
ok('D1b: the component fetches the team itself when props lack users (flag picker survives the move)',
  /supabase\.from\('users'\)\.select\('id, name, email, is_ai'\)/.test(comp));
ok('D2: the screen explains the copy steps from the admin site',
  /clear Row Limits \(blank = all\)/.test(comp));
ok('D3: preview before import, with recognized/ignored counts',
  /orders recognized/.test(comp) && /lines not understood/.test(comp));
ok('D4: every table has its own CSV export (5: possible-verify, no-invoice, open-balance, no-order, matched)',
  (comp.match(/⬇ CSV/g) || []).length === 5);
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
  okO('NO8: the AI reconcile tool and invoice listing carry the columns (sales: no invoice_number; accounting: + po_so — OA)',
    /select\('order_number, release_number'\)/.test(ai2) &&
    /select\('invoice_number, release_number, po_so_number'\)/.test(ai2) &&
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

// ══════════════════════════════════════════════════════════════════
// v55.83-NT ADDENDUM — Release # editable INLINE on the invoice list
// (Max: "yes need to enter the release number right from invoice as well").
// ══════════════════════════════════════════════════════════════════
(function () {
  var fst = require('fs'); var pt = require('path');
  var at = fst.readFileSync(pt.join(__dirname, '..', 'src/components/AccountingInvoicesTab.jsx'), 'utf8');
  var f = [];
  function okT(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }

  okT('NT1: the list has a Release # column (grid widened, header added)',
    /'92px 96px minmax\(140px,1fr\)/.test(at) && />Release #<\/div>/.test(at));
  okT('NT2: inline input saves on Enter/blur via the format-checked server action',
    /action: 'set_release'/.test(at) && /system: 'accounting', id: row\.id/.test(at) &&
    /e\.key === 'Enter'/.test(at));
  okT('NT3: unchanged values do not fire saves; failed saves restore the old value',
    /if \(v === \(row\.release_number \|\| ''\)\) \{ return; \}/.test(at) &&
    /e\.target\.value = row\.release_number \|\| '';/.test(at));
  okT('NT4: proformas show a dash (release numbers are an invoice thing)',
    /<span className="text-\[10px\] text-slate-500">—<\/span>/.test(at));

  if (f.length) { console.log('NT FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL NT ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-NU ADDENDUM — dates that don't fight you + old-order statuses
// (Max: "not able to enter a date for the year... should be able to go
//  back however far I want").
// ══════════════════════════════════════════════════════════════════
(function () {
  var fsu = require('fs'); var pu = require('path');
  var cu = fsu.readFileSync(pu.join(__dirname, '..', 'src/components/NexttradeReconciliation.jsx'), 'utf8');
  var f = [];
  function okU(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }
  okU('NU1: blank dates mean ALL history and the label says so',
    /from \(blank = all\)/.test(cu) && /blank = ALL history \(default\)/.test(cu));
  okU('NU2: one-tap presets exist incl. whole past years (no year-typing needed)',
    /\['All history', '', ''\]/.test(cu) && /\['2024', '2024-01-01', '2024-12-31'\]/.test(cu) &&
    /\['2025', '2025-01-01', '2025-12-31'\]/.test(cu) && /Last 90d/.test(cu));
  okU('NU3: parser accepts old-order statuses (Closed/Delivered/Completed)',
    /'Closed', 'Delivered', 'Completed'\]/.test(cu));
  okU('NU4: functional — a Closed 2025 row parses with clean status and country',
    (function () {
      var r = parseOrdersPaste('500 1002-1067 Elite Paper USA MRKU6401391 10-29-2025 01-06-2026 03-05-2026\t\tClosed\t\tIndia 0 0 52541');
      return r.rows.length === 1 && r.rows[0].status === 'Closed' && r.rows[0].country === 'India' && r.rows[0].qty_paper === 52541 && r.rows[0].order_date === '10-29-2025';
    })());
  if (f.length) { console.log('NU FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL NU ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-NW ADDENDUM — 42703 fix + standing unpaid-invoice flags
// (Max's screenshot: "column invoices.invoice_number does not exist";
//  and: "if no payment or balance for an invoice to continue to be flagged").
// ══════════════════════════════════════════════════════════════════
(function () {
  var fsw = require('fs'); var pw = require('path');
  var rw = fsw.readFileSync(pw.join(__dirname, '..', 'src/app/api/reconcile/nexttrade/route.js'), 'utf8');
  var cw = fsw.readFileSync(pw.join(__dirname, '..', 'src/components/NexttradeReconciliation.jsx'), 'utf8');
  var aw = fsw.readFileSync(pw.join(__dirname, '..', 'src/app/api/ai/reports/route.js'), 'utf8');
  var f = [];
  function okW(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }
  okW('NW1: no code path selects invoice_number from the sales invoices table anymore',
    !/from\('invoices'\)\.select\('[^']*invoice_number/.test(rw) &&
    !/from\('invoices'\)\.select\('[^']*invoice_number/.test(aw));
  okW('NW2: open-balance invoices are a STANDING list, recomputed live every run (NY: balance-only filter, period-scoped)',
    /invoices_with_open_balance/.test(rw) && /STANDING/.test(rw) &&
    /if \(bal <= 0\.009\) \{ return; \}/.test(rw) && !/v\.status/.test(rw.split('STANDING')[1].split('unpaid.sort')[0]));
  okW('NW3: overdue is called out with the day count (due_date past today)',
    /v\.due_date && v\.due_date < todayISO/.test(rw) && /overdue_open_balance/.test(rw));
  okW('NW4: the screen shows the open-balance section with its own CSV and says it stays until paid',
    /stay flagged until paid/.test(cw) && /invoices-open-balance/.test(cw));
  if (f.length) { console.log('NW FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL NW ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-NY ADDENDUM — "the release # IS the invoice number" (Max):
// suffix matching, period-scoped balances, honest overdue counts.
// ══════════════════════════════════════════════════════════════════
(function () {
  var fsy = require('fs'); var py = require('path');
  var ry = fsy.readFileSync(py.join(__dirname, '..', 'src/app/api/reconcile/nexttrade/route.js'), 'utf8');
  var cy = fsy.readFileSync(py.join(__dirname, '..', 'src/components/NexttradeReconciliation.jsx'), 'utf8');
  var ay = fsy.readFileSync(py.join(__dirname, '..', 'src/app/api/ai/reports/route.js'), 'utf8');
  var f = [];
  function okY(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }
  okY('NY1: suffix matching in report, cron AND AI tool (release serial with digit boundaries, len>=3, zeros stripped)',
    ry.split("'(^|[^0-9])' + sfx").length - 1 >= 1 &&
    ry.split("'(^|[^0-9])' + sfx2").length - 1 >= 1 &&
    /release serial/.test(ry) &&
    ay.indexOf("'(^|[^0-9])' + sfx") > -1 && /sfx\.length >= 3/.test(ry));
  okY('NY2: open-balance list is SCOPED to the reconciliation period (both bounds)',
    /if \(df && v\.invoice_date && v\.invoice_date < df\) \{ return; \}/.test(ry) &&
    /if \(dt && v\.invoice_date && v\.invoice_date > dt\) \{ return; \}/.test(ry));
  okY('NY3: invoices-without-order scoped to the period too',
    /inWin/.test(ry) && /inWin2/.test(ry));
  okY('NY4: unpaid rows carry customer, total, paid, balance, days overdue — with serial-join fallback (NZ)',
    /var custShow = custMapR\[v\.accounting_customer_id\]/.test(ry) && /days_overdue: od/.test(ry) &&
    /paid: v\.amount_paid/.test(ry) && /\(from order\)/.test(ry));
  okY('NY5: the screen header counts overdue from the FULL summary, not the display slice (289-vs-543 bug)',
    /\{sm\.overdue_open_balance \|\| 0\} overdue/.test(cy) &&
    !/invoices_with_open_balance \|\| \[\]\)\.filter/.test(cy));
  if (f.length) { console.log('NY FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL NY ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-NZ ADDENDUM — Max caught 1001-1640 silently "matched" to an
// unrelated invoice, and the customer column came back empty. Serial
// matches now require customer corroboration (else amber "verify"),
// lookups are never silent, and unpaid rows borrow customer/release
// from the serial-joined order.
// ══════════════════════════════════════════════════════════════════
(function () {
  var fz = require('fs'); var pz = require('path');
  var rz = fz.readFileSync(pz.join(__dirname, '..', 'src/app/api/reconcile/nexttrade/route.js'), 'utf8');
  var cz = fz.readFileSync(pz.join(__dirname, '..', 'src/components/NexttradeReconciliation.jsx'), 'utf8');
  var f = [];
  function okZ(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }
  okZ('NZ1: a bare serial collision is NOT a match — corroboration required, else amber',
    /custClose\(o\.customer_name, h\.customer\)/.test(rz) && /possibleForOrder\.push/.test(rz) &&
    /release serial ' \+ sfx \+ ' \+ customer/.test(rz));
  okZ('NZ2: possible matches are their own bucket — never matched, never silently dropped',
    /possible_matches_verify/.test(rz) && /else if \(possibleForOrder\.length\)/.test(rz) &&
    /confirm same deal/.test(rz));
  okZ('NZ3: customer lookup is never silent — the report source line says loaded/empty/failed',
    /custLookupNote/.test(rz) && /came back EMPTY/.test(rz) && /customer names FAILED/.test(rz) &&
    /custLookupNote,/.test(rz));
  okZ('NZ4: unpaid rows borrow customer AND release from the serial-joined order, marked honestly',
    /bySerial\[d\]/.test(rz) && /os\.length === 1/.test(rz) && /' \(from order\)'/.test(rz));
  okZ('NZ5: the screen shows the amber verify section with card and CSV',
    /Possible matches — an invoice carries this release/.test(cz) && /possible-matches-verify/.test(cz) &&
    /Possible — verify/.test(cz));
  // Functional: corroboration keeps Nexpac↔Nexpac, ambers Nexpac↔Sterling.
  function normF(x) { return String(x == null ? '' : x).toUpperCase().replace(/\s+/g, ''); }
  function custCloseF(a, b) { var x = normF(a); var y = normF(b); if (!x || !y) { return false; } return x.indexOf(y) > -1 || y.indexOf(x) > -1 || x.substring(0, 6) === y.substring(0, 6); }
  okZ('NZ6: functional — Nexpac corroborates Nexpac; Nexpac vs Sterling Paper does NOT; empty never corroborates',
    custCloseF('Nexpac', 'NEXPAC') === true &&
    custCloseF('Nexpac', 'Sterling Paper & Pulp Inc') === false &&
    custCloseF('Nexpac', '') === false);
  if (f.length) { console.log('NZ FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL NZ ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-OA ADDENDUM — Wave P.O./S.O. pull (Max: "the P.O./S.O. number...
// was never pulled") + the placeholder that read as repeating values.
// ══════════════════════════════════════════════════════════════════
(function () {
  var fo = require('fs'); var po = require('path');
  var wv = fo.readFileSync(po.join(__dirname, '..', 'src/app/api/wave/import-invoices/route.js'), 'utf8');
  var ro = fo.readFileSync(po.join(__dirname, '..', 'src/app/api/reconcile/nexttrade/route.js'), 'utf8');
  var ao = fo.readFileSync(po.join(__dirname, '..', 'src/app/api/ai/reports/route.js'), 'utf8');
  var ac = fo.readFileSync(po.join(__dirname, '..', 'src/components/AccountingInvoicesTab.jsx'), 'utf8');
  var sq = fo.readFileSync(po.join(__dirname, '..', 'sql/v55-83-OA-po-so.sql'), 'utf8');
  var f = [];
  function okA(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }
  okA('OA1: the Wave GraphQL query fetches poNumber and stores it as po_so_number',
    / id invoiceNumber poNumber status /.test(wv) && /po_so_number: n\.poNumber \|\| null/.test(wv));
  okA('OA2: poNumber is in the change fingerprint — a P.O./S.O. edit in Wave re-syncs the row',
    /node\.poNumber \|\| ''/.test(wv));
  okA('OA3: SQL adds the column, indexed, idempotent',
    /ADD COLUMN IF NOT EXISTS po_so_number text;/.test(sq) && /CREATE INDEX IF NOT EXISTS idx_acct_inv_po_so/.test(sq));
  okA('OA4: the report matcher indexes po_so as a first-class accounting key',
    /put\(v\.po_so_number, 'accounting', 'po_so'/.test(ro));
  okA('OA5: the 6-hour cron and the AI use the P.O./S.O. keys too',
    (ro.match(/v\.po_so_number\) \{ keys\[nrm2/g) || []).length === 1 &&
    (ao.match(/v\.po_so_number\) \{ keys\[nrm/g) || []).length === 1);
  okA('OA6: unpaid rows and the reverse check use P.O./S.O. as a release source',
    /var relShow = v\.release_number \|\| v\.po_so_number \|\| ''/.test(ro) &&
    /looksRelease\(v\.po_so_number\)/.test(ro));
  okA('OA7: the misleading sample placeholder is gone from the invoice-list Release column',
    !/defaultValue=\{row\.release_number \|\| ''\} placeholder/.test(ac));
  if (f.length) { console.log('OA FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL OA ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-OB ADDENDUM — two-way release flow within Wave's API limits:
// new invoices push the release UP as P.O./S.O.; sync adopts Wave's
// P.O./S.O. DOWN into empty release fields; manual entry always wins.
// ══════════════════════════════════════════════════════════════════
(function () {
  var fb = require('fs'); var pb = require('path');
  var pv = fb.readFileSync(pb.join(__dirname, '..', 'src/app/api/wave/push-invoice-v2/route.js'), 'utf8');
  var wv2 = fb.readFileSync(pb.join(__dirname, '..', 'src/app/api/wave/import-invoices/route.js'), 'utf8');
  var f = [];
  function okB(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }
  okB('OB1: pushing a NEW invoice sends the Hub release to Wave as poNumber',
    /poNumber: \(inv\.release_number \|\| inv\.po_so_number \|\| null\)/.test(pv));
  okB('OB2: sync ADOPTS a release-shaped Wave P.O./S.O. into EMPTY release fields only',
    /is\('release_number', null\)/.test(wv2) && /\^\\d\{3,4\}-\\d\{2,5\}\$/.test(wv2) &&
    /ADOPTION PASS/.test(wv2));
  okB('OB3: the adoption update re-checks null at write time — manual entry can never be overwritten',
    /update\(\{ release_number: poVal \}\)\.eq\('id', aRows\[ar\]\.id\)\.is\('release_number', null\)/.test(wv2));
  okB('OB4: the sync report counts adoptions and surfaces adoption failures',
    /report\.release_adopted = adopted/.test(wv2) && /Release adoption pass:/.test(wv2));
  if (f.length) { console.log('OB FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL OB ADDENDUM CHECKS PASSED'); }
})();
