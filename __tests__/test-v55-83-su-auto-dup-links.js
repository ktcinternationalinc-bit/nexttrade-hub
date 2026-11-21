// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SU — Max, Nov 15 2026: "2) yes - also if bank linked twice it should know and prevent duplicates" (the duplicate
// check should run by itself after every sync and upload) · links between the wire, transaction and bill screens ·
// "We can book it as a professional fee, or we can put it as remaining waiting for bills".
// Standing rules: no fuzzy matching of money; rules/automation never touch verified rows; nothing is erased (restore).
// The automatic picker, the server step and the bills / transactions routes are RUN; checks marked (pin) read the source.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var D = require(path.join(root, 'src/lib/duplicate-detect.js'));
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
var today = new Date().toISOString().substring(0, 10);
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().substring(0, 10); }
var n = 0;
function row(acct, date, amt, name, x) { n++; return Object.assign({ id: 'd0000000-0000-0000-0000-' + String(n).padStart(12, '0'), wave_business_id: US, account_id: acct, date: date, posted_date: date, direction: 'out', amount: -amt, amount_abs: amt, iso_currency: 'USD', name: name, merchant_name: null, check_number: null, pending: false, review_status: 'unreviewed', matched_invoice_id: null, linked_id: null, transfer_group_id: null, classification: null, category_verified: false, plaid_transaction_id: 'p' + n, created_at: '2026-11-0' + (1 + (n % 9)) + 'T00:00:00Z' }, x || {}); }
// one real account (Chase •6353) connected twice: account ids A1 (old link) and A2 (new link); B1 is another account
var accounts = [{ plaid_account_id: 'A1', name: 'PLAT BUS CHECKING', mask: '6353', connection_id: 'c1', institution_name: 'Chase', connection_status: 'active' }, { plaid_account_id: 'A2', name: 'Plat Bus Checking', mask: '6353', connection_id: 'c2', institution_name: 'Chase Bank', connection_status: 'active' }, { plaid_account_id: 'B1', name: 'SAVINGS', mask: '6338', connection_id: 'c1', institution_name: 'Chase', connection_status: 'active' }];
var d3 = daysAgo(3), d4 = daysAgo(4), d5 = daysAgo(5), d6 = daysAgo(6), d7 = daysAgo(7), d8 = daysAgo(8);
var twinA = row('A1', d3, 249980.46, 'WIRE OUT ACME SUPPLY', { review_status: 'reviewed', classification: 'cogs_goods' }), twinB = row('A2', d3, 249980.46, 'WIRE OUT ACME SUPPLY');
var revA = row('A1', d4, 500, 'UTILITY PAYMENT', { review_status: 'approved', classification: 'utilities' }), revB = row('A2', d4, 500, 'UTILITY PAYMENT', { review_status: 'reviewed', classification: 'utilities' }), revC = row('A1', d4, 9.99, 'x');
var q1 = row('A1', d5, 50, 'BANK FEE'), q2 = row('A1', d5, 50, 'BANK FEE'), q3 = row('A2', d5, 50, 'BANK FEE'), q4 = row('A2', d5, 50, 'BANK FEE');
var same1 = row('A1', d6, 75, 'COFFEE SHOP'), same2 = row('A1', d6, 75, 'COFFEE SHOP');
var gapA = row('A1', d8, 1200, 'RENT NOVEMBER'), gapB = row('A2', d7, 1200, 'RENT NOVEMBER');
var invA = row('A1', d6, 3000, 'CUSTOMER DEPOSIT', { direction: 'in' }), invB = row('A2', d6, 3000, 'CUSTOMER DEPOSIT', { direction: 'in', matched_invoice_id: 'inv-1' });
var otherA = row('A1', d3, 640, 'TRANSFER'), otherB = row('B1', d3, 640, 'TRANSFER');
var rows = [twinA, twinB, revA, revB, revC, q1, q2, q3, q4, same1, same2, gapA, gapB, invA, invB, otherA, otherB];
var real = D.realAccounts(accounts); var byId = {}; rows.forEach(function (t) { byId[t.id] = t; });
var prot = {}; prot[invB.id] = 'matched to an invoice';
var found = D.findDuplicates(rows, { real: real, protectedIds: prot });
var picks = D.twinAutoPicks(found.groups, byId);
var pickOf = function (a, b) { return picks.filter(function (p) { return (p.remove_id === a.id && p.keep_id === b.id) || (p.remove_id === b.id && p.keep_id === a.id); })[0]; };

console.log('SU — A. what the automatic check may clear by itself (and what it must leave)');
var pT = pickOf(twinA, twinB);
check('A1: the same line through two connections of one account, same day — the untouched copy goes, the reviewed one stays', pT && pT.remove_id === twinB.id && pT.keep_id === twinA.id && pT.amount === 249980.46, picks);
check('A2: when BOTH copies were already reviewed by a person, neither is removed (automation never touches reviewed work)', !picks.some(function (p) { return p.remove_id === revA.id || p.remove_id === revB.id; }), picks.filter(function (p) { return p.remove_id === revA.id || p.remove_id === revB.id; }));
check('A3: four identical $50 fees (two on each connection) are NOT cleared — they may be two real payments: a person decides', !picks.some(function (p) { return [q1.id, q2.id, q3.id, q4.id].indexOf(p.remove_id) >= 0; }));
check('A4: two identical lines on the SAME connection are never cleared automatically', !picks.some(function (p) { return p.remove_id === same1.id || p.remove_id === same2.id; }));
check('A5: one day apart is not "the same day" — left for a person', !picks.some(function (p) { return p.remove_id === gapA.id || p.remove_id === gapB.id; }));
var pI = pickOf(invA, invB);
check('A6: a copy matched to an invoice is never the one removed (the unmatched twin goes, the matched one stays)', pI && pI.remove_id === invA.id && pI.keep_id === invB.id, pI);
check('A7: two DIFFERENT accounts with the same amount are a transfer, not a duplicate', !picks.some(function (p) { return p.remove_id === otherA.id || p.remove_id === otherB.id; }));
check('A8: every pick removes exactly one line and keeps its twin — never both, never the same line twice', picks.every(function (p) { return p.remove_id !== p.keep_id; }) && picks.map(function (p) { return p.remove_id; }).filter(function (x, i, a) { return a.indexOf(x) !== i; }).length === 0 && !picks.some(function (p) { return picks.some(function (q) { return q.remove_id === p.keep_id; }); }));

// ── the server step, on an in-memory database
var db = new MemDB({ bank_transactions: rows.map(function (t) { return Object.assign({}, t); }), plaid_accounts: accounts.map(function (a) { return { plaid_account_id: a.plaid_account_id, name: a.name, mask: a.mask, connection_id: a.connection_id }; }),
  bank_connections: [{ id: 'c1', institution_name: 'Chase', status: 'active' }, { id: 'c2', institution_name: 'Chase Bank', status: 'active' }],
  bank_duplicate_dismissals: [], bank_transaction_duplicates: [], hub_audit_log: [], vendor_bill_payments: [], accounting_invoice_payments: [], wire_packages: [], bank_transaction_splits: [], unapplied_deposits: [], customer_credits: [],
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }], module_permissions: ['accounting.clickbooks.access', 'accounting.view_totals', 'bills.view', 'bills.manage', 'bank.classify', 'bank.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
  vendor_bills: [], vendor_bill_lines: [], vendor_bill_events: [], wire_package_lines: [], expense_categories: [], expense_rules: [], paid_through_parties: [], bill_commission_rules: [], bill_price_rules: [] });
var rpcCalls = [];
db.rpcs = { bank_duplicate_remove: function (a) { // stand-in for the real function (run on Postgres: clickbooks/tests/qz2-ledger-drift/17_so.sql)
  rpcCalls.push(a); var i = db.t.bank_transactions.findIndex(function (t) { return t.id === a.p_dup; }); if (i < 0) { return { ok: false, why: 'not in the books' }; }
  var t = db.t.bank_transactions[i]; db.t.bank_transaction_duplicates.push({ id: t.id, kept_id: a.p_keep, row_data: t, status: 'removed', removed_by: a.p_actor, reason: a.p_reason }); db.t.bank_transactions.splice(i, 1);
  return { ok: true, amount: t.amount_abs, date: t.date }; } };
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
global.__db = db;
var DS = require(path.join(root, 'src/lib/duplicates-server.js'));

(async function () {
  console.log('SU — B. the check running by itself after a sync');
  var before = db.t.bank_transactions.length;
  var r1 = await DS.autoTwinCheck(db, { actorId: null, budgetMs: 5000 });
  check('B1: it ran, removed the certain twins only, and counted the rest for a person', r1.ran && r1.removed === picks.length && r1.removed >= 2 && r1.to_review >= 3 && r1.errors === 0 && db.t.bank_transactions.length === before - r1.removed, r1);
  check('B2: the removed line is kept on file with its twin and the reason — it can be restored', db.t.bank_transaction_duplicates.length === r1.removed && db.t.bank_transaction_duplicates.some(function (x) { return x.id === twinB.id && x.kept_id === twinA.id && /second connection of the same account/.test(x.reason) && x.row_data.amount_abs === 249980.46; }));
  check('B3: each automatic removal is on the audit trail as automatic, restorable', db.t.hub_audit_log.filter(function (h) { return h.action === 'bank_duplicate_auto_removed'; }).length === r1.removed && db.t.hub_audit_log.every(function (h) { return h.action !== 'bank_duplicate_auto_removed' || (h.details && h.details.can_restore === true); }), db.t.hub_audit_log[0]);
  check('B4: the reviewed line, the fees, the same-connection pair and the transfer are all still in the books', [twinA, revA, revB, q1, q2, q3, q4, same1, same2, gapA, gapB, invB, otherA, otherB].every(function (t) { return db.t.bank_transactions.some(function (x) { return x.id === t.id; }); }));
  var r2 = await DS.autoTwinCheck(db, { actorId: null });
  check('B5: running it again removes nothing more', r2.ran && r2.removed === 0 && db.t.bank_transactions.length === before - r1.removed, r2);
  db.rpcs.bank_duplicate_remove = undefined; db.rpcs = {};
  db.t.bank_transactions.push(row('A1', d3, 77.77, 'NEW TWIN'), row('A2', d3, 77.77, 'NEW TWIN'));
  var r3 = await DS.autoTwinCheck(db, { actorId: null });
  check('B6: if the duplicates SQL is not installed nothing is removed and the sync is not broken', r3.removed === 0 && db.t.bank_transactions.filter(function (t) { return t.name === 'NEW TWIN'; }).length === 2, r3);

  console.log('SU — C. links between the screens');
  db.t.bank_transactions.push({ id: 'e0000000-0000-0000-0000-000000000001', wave_business_id: US, account_id: 'A1', date: d3, posted_date: d3, direction: 'out', amount: -50000, amount_abs: 50000, iso_currency: 'USD', name: 'ONLINE TRANSFER TO RTM 9909', pending: false, review_status: 'reviewed', classification: 'prof_fees', third_party_payer: 'RTM Capital', created_at: '2026-11-10T00:00:00Z' });
  db.t.vendor_bills.push({ id: 'f0000000-0000-0000-0000-000000000001', vendor_name: 'Vendor C', bill_number: 'C-1', bill_date: d8, due_date: today, total_amount: 14000, record_status: 'active', validation_status: 'validated', paid_via: 'RTM Capital' });
  db.t.wire_packages.push({ id: 'a0000000-0000-0000-0000-000000000001', seq: 42, status: 'attached', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 1300, funding_txn_id: 'e0000000-0000-0000-0000-000000000001', bank_transaction_id: 'e0000000-0000-0000-0000-000000000001' },
    { id: 'a0000000-0000-0000-0000-000000000002', seq: 43, status: 'attached', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 500, funding_txn_id: 'e0000000-0000-0000-0000-000000000001', bank_transaction_id: 'e0000000-0000-0000-0000-000000000001' },
    { id: 'a0000000-0000-0000-0000-000000000003', seq: 44, status: 'reversed', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 0, funding_txn_id: 'e0000000-0000-0000-0000-000000000001', bank_transaction_id: null });
  db.t.wire_package_lines.push({ id: 'l1', package_id: 'a0000000-0000-0000-0000-000000000001', bill_id: 'f0000000-0000-0000-0000-000000000001', amount: 3800, payment_id: 'pay1', is_open: false },
    { id: 'l2', package_id: 'a0000000-0000-0000-0000-000000000002', bill_id: 'f0000000-0000-0000-0000-000000000001', amount: 10200, payment_id: 'pay2', is_open: false },
    { id: 'l3', package_id: 'a0000000-0000-0000-0000-000000000003', bill_id: 'f0000000-0000-0000-0000-000000000001', amount: 999, payment_id: 'pay3', is_open: false });
  db.t.vendor_bill_payments.push({ id: 'pay1', bill_id: 'f0000000-0000-0000-0000-000000000001', amount: 3800, paid_date: d3, bank_transaction_id: 'e0000000-0000-0000-0000-000000000001', method: 'rtm', voided: false, created_at: 'x' }, { id: 'pay2', bill_id: 'f0000000-0000-0000-0000-000000000001', amount: 10200, paid_date: d3, bank_transaction_id: 'e0000000-0000-0000-0000-000000000001', method: 'rtm', voided: false, created_at: 'x' });
  var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
  var res = await bills.POST({ json: function () { return Promise.resolve({ user_id: 'u1', action: 'list' }); }, headers: new Map() }); var bl = await res.json();
  var bC = (bl.bills || []).filter(function (b) { return b.bill_number === 'C-1'; })[0] || {};
  check('C1: a bill paid in two parts by two requests links to BOTH (WP-0042 $3,800 and WP-0043 $10,200); an undone request is not listed', bl.ok && bC.paid_by_wires && bC.paid_by_wires.length === 2 && bC.paid_by_wires.map(function (w) { return w.label + ':' + w.amount; }).sort().join(',') === 'WP-0042:3800,WP-0043:10200' && bC.paid_by_wires.every(function (w) { return w.kind === 'package' && w.request === true; }), bC.paid_by_wires);
  var er = R('src/app/api/accounting/expense-rules/route.js'); var at = R('src/components/AllTransactionsTab.jsx'); var bt = R('src/components/BillsTab.jsx');
  check('C2 (pin): the transactions list keeps EVERY request on a bank line (before, a second request replaced the first) and shows a chip for each', /\(wiresBy\[w9\.bank_transaction_id\] = wiresBy\[w9\.bank_transaction_id\] \|\| \[\]\)\.push\(wOne\)/.test(er) && /wires: wiresBy\[t7\.id\] \|\| null,/.test(er) && /\(t\.wires && t\.wires\.length > 1 \? t\.wires : \(t\.wire \? \[t\.wire\] : \[\]\)\)\.map/.test(at));
  check('C3 (pin): the bills screen opens the request that paid a bill, in place', /function paidByChips\(b\)/.test(bt) && /\{wireChip\(b\)\}\{paidByChips\(b\)\}/.test(bt) && /<WireQuickView wire=\{wireQuick\}/.test(bt));

  console.log('SU — D. the rest of the build (pins)');
  var plaid = R('src/app/api/plaid/transactions/route.js'); var imp = R('src/app/api/accounting/statement-import/route.js');
  check('D1: the check runs after a bank sync AND after a statement upload, before wires are matched to the new lines, and can never fail the sync', plaid.indexOf('dupCheck = await autoTwinCheck(supabase') > 0 && plaid.indexOf('dupCheck = await autoTwinCheck(supabase') < plaid.indexOf('wireMatch = await autoMatchSentWires(supabase') && /catch \(eDC\) \{ dupCheck = null; \}/.test(plaid) && imp.indexOf('dupC = await autoTwinCheck(d') > 0 && imp.indexOf('dupC = await autoTwinCheck(d') < imp.indexOf('wireM = await autoMatchSentWires(d') && /catch \(eDu\) \{ dupC = null; \}/.test(imp));
  check('D2: the person is told what happened after a sync and after an upload', /duplicates_removed/.test(R('src/components/BankTab.jsx')) && /removed automatically/.test(R('src/components/BankTab.jsx')) && /dup_removed/.test(R('src/components/StatementImport.jsx')) && /need a person/.test(R('src/components/StatementImport.jsx')));
  var ui = R('src/components/WirePackagesPanel.jsx');
  check('D3: “book the unused rest as the service fee” — one button on a sent request, still through the fee change (reason + history + room check)', /Book the unused \$' \+ fmt\(P\.funding\.remaining\) \+ ' as the service fee/.test(ui) && /P\.funding\.remaining > 0\.005/.test(ui));
  var libsAll = R('src/lib/duplicates-server.js'); var libs = libsAll.substring(libsAll.indexOf('export async function autoTwinCheck'));
  check('D4: new server code keeps the house rules — var only, no template strings, no pop-ups', libs.length > 200 && !/\b(let|const)\s/.test(libs) && libs.indexOf('`') < 0 && !/window\.(prompt|confirm|alert)\(/.test(ui) && !/window\.(prompt|confirm|alert)\(/.test(bt.substring(bt.indexOf('function paidByChips'), bt.indexOf('function wireChip'))));
  var wn = R('src/components/WhatsNewWidget.jsx');
  check('D5: What’s New has v55.83-SU with one technical line; badge at SU', /version: 'v55\.83-SU'/.test(wn) && /superAdminOnly: true/.test(wn.substring(wn.indexOf("version: 'v55.83-SU'"), wn.indexOf("version: 'v55.83-ST'"))) && />v55\.83-(?:S[U-Z]|[T-Z][A-Z])<\/span>/.test(R('src/app/page.jsx'))); // v55.83-SV realign: SU or later
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
// v55.83-UB realign: badge letters now run past T (UA, UB …) — the badge checks accept T–Z
