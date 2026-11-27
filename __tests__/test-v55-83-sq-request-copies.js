// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SQ (part two, first half) — Max, Nov 15 2026:
//   "RTM needs to send the copies of the wires showing what they wired as copies, and they should be able to be viewable in
//    that section where it's matched."
//   "Our team's copy shows a vendor number of bills and total. There should be a reference number that gets associated to both
//    of them somehow" · "the full bill-by-bill breakdown is saved underneath by KTCs"
//   "the next trade and RTM should work the same way"
//   "mark transfer but [flag] it that it is missing second leg"
// Also: the currency of a transfer and its bills is compared and flagged (never converted).
// The print page, the wire route and the Books home totals are RUN here; nothing is only pinned unless marked "pin".
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var PR = require(path.join(root, 'src/lib/wire-request-print.js'));
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
function id(n) { return 'c6000000-0000-0000-0000-' + String(n).padStart(12, '0'); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

console.log('SQ — A. the two printable copies');
var pkgM = { label: 'WP-0042', payee_name: 'RTM Capital', total: 49500, bills_total: 48200, fee_amount: 1300, fee_note: 'November service', planned_send_date: null, sent: { date: '2026-11-15' },
  funding: { date: '2026-11-03', amount: 50000 }, by_vendor: [{ ref: 'WP-0042/1', vendor: 'Vendor A', bills: 2, amount: 18000, partial: 0 }, { ref: 'WP-0042/2', vendor: 'Vendor B', bills: 1, amount: 20000, partial: 0 }, { ref: 'WP-0042/3', vendor: 'Vendor C', bills: 1, amount: 10200, partial: 1 }] };
var linesM = [['Vendor A', 'A-1', 9000, 9000], ['Vendor A', 'A-2', 9000, 9000], ['Vendor B', 'B-1', 20000, 20000], ['Vendor C', 'C-1', 14000, 10200]].map(function (x) { return { amount: x[3], bill: { vendor_name: x[0], bill_number: x[1], total_amount: x[2], other_reference: 'PO-' + x[1] } }; });
var auditM = { signoff1: { valid: true, name: 'Preparer', at: '2026-11-15T09:00:00Z' }, signoff2: { valid: true, name: 'Checker', at: '2026-11-15T09:20:00Z' } };
var hP = PR.requestCopyHtml(PR.requestCopyModel(pkgM, linesM, auditM, 'payee', '2026-11-15 09:30'));
var hK = PR.requestCopyHtml(PR.requestCopyModel(pkgM, linesM, auditM, 'ktc', '2026-11-15 09:30'));
check('A1: RTM’s copy shows each vendor, the number of bills and the total — with a reference per vendor', /WP-0042\/1/.test(hP) && /WP-0042\/3/.test(hP) && /Vendor A/.test(hP) && /\$18,000\.00/.test(hP) && /\$10,200\.00/.test(hP) && /COPY FOR RTM CAPITAL/.test(hP));
check('A2: RTM’s copy does NOT carry our bill-by-bill breakdown', !/Bill A-1/.test(hP) && !/PO-A-1/.test(hP) && !/part payment of/.test(hP));
check('A3: our copy carries the same references plus every bill underneath, and says which bill is paid in part', /WP-0042\/1/.test(hK) && /Bill A-1/.test(hK) && /Bill A-2/.test(hK) && /Bill C-1[^<]*part payment of \$14,000\.00/.test(hK) && /KTC COPY/.test(hK));
check('A4: both copies agree to the cent — vendors $48,200.00 + service fee $1,300.00 = $49,500.00', [hP, hK].every(function (h) { return /Total to vendors<\/td><td class="n">\$48,200\.00/.test(h) && /\$1,300\.00/.test(h) && /Request total<\/td><td class="n">\$49,500\.00/.test(h); }));
check('A5: both show the two signatures, the transfer it draws from and the date it was sent', [hP, hK].every(function (h) { return /Preparer/.test(h) && /Checker/.test(h) && /2026-11-03 · \$50,000\.00/.test(h) && /Sent 2026-11-15/.test(h); }));
var hD = PR.requestCopyHtml(PR.requestCopyModel(Object.assign({}, pkgM, { sent: null, planned_send_date: '2026-11-20' }), linesM, { signoff1: { valid: true, name: 'Preparer', at: 'x' }, signoff2: { valid: false } }, 'payee', ''));
check('A6: a request that is not approved prints as DRAFT with the missing signature shown — never as sent', /DRAFT — not approved/.test(hD) && /not signed yet/.test(hD) && !/Sent 20/.test(hD) && /PLANNED FOR/.test(hD));
var hX = PR.requestCopyHtml(PR.requestCopyModel(Object.assign({}, pkgM, { payee_name: 'RTM <script>x</script>' }), linesM, auditM, 'payee', ''));
check('A7: text is escaped on the page (a name cannot inject markup)', hX.indexOf('<script>x') < 0 && /&lt;script&gt;/.test(hX));
check('A8: readable on paper — white page, dark text, sized for A4', /background:#ffffff/.test(hP) && /color:#0f172a/.test(hP) && /size:A4/.test(hP));

// ── the route on an in-memory database
function nb(n, vendor, no, amt, extra) { return Object.assign({ id: id(n), vendor_name: vendor, bill_number: no, bill_date: '2026-10-20', due_date: '2026-11-20', total_amount: amt, currency: 'USD', record_status: 'active', validation_status: 'validated', bill_type: 'supplier', shipment_direction: 'inbound', other_reference: 'REF-' + no, paid_via: 'NextTrade Industries' }, extra || {}); }
var N1 = id(1), N2 = id(2), M1 = id(3), E1 = id(4);
var TN = 'c8000000-0000-0000-0000-000000000001';
function bt(i, date, amt, dir, name, x) { return Object.assign({ id: i, date: date, posted_date: date, amount_abs: amt, direction: dir, pending: false, wave_business_id: US, review_status: null, name: name, merchant_name: null, third_party_payer: null, transfer_group_id: null, classification: null, iso_currency: 'USD' }, x || {}); }
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }, { id: 'u9', name: 'Max', role: 'super_admin', active: true }],
  module_permissions: [].concat(['accounting.clickbooks.access', 'accounting.view_totals', 'accounting.change_dates', 'wires.prepare', 'wires.signoff', 'wires.send', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [nb(1, 'Vendor N', 'N-1', 3000), nb(2, 'Vendor N', 'N-2', 1000), nb(3, 'Vendor M', 'M-1', 1500), nb(4, 'Vendor E', 'E-1', 400, { currency: 'EGP' })],
  vendor_bill_lines: [], vendor_bill_payments: [], vendor_bill_events: [], hub_audit_log: [],
  wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], wire_bill_reviews: [], expense_rules: [],
  paid_through_parties: [{ name: 'RTM Capital', kind: 'service_provider', active: true }, { name: 'NextTrade Industries', kind: 'affiliate', active: true }],
  bank_transactions: [bt(TN, '2026-11-05', 6000, 'out', 'ONLINE TRANSFER TO NEXTTRADE 2061', { third_party_payer: 'NextTrade Industries' }),
    bt('c8000000-0000-0000-0000-000000000002', '2026-11-06', 900, 'in', 'CUSTOMER DEPOSIT'), bt('c8000000-0000-0000-0000-000000000003', '2026-11-07', 250, 'out', 'OFFICE SUPPLIES', { classification: 'office' }),
    bt('c8000000-0000-0000-0000-000000000004', '2026-11-08', 7000, 'out', 'TRANSFER TO ACCOUNT NOT IN THE HUB', { classification: 'transfer' }), bt('c8000000-0000-0000-0000-000000000005', '2026-11-08', 300, 'in', 'TRANSFER FROM UNKNOWN', { classification: 'transfer' }),
    bt('c8000000-0000-0000-0000-000000000006', '2026-11-09', 2000, 'out', 'TO SAVINGS', { transfer_group_id: 'g1', classification: 'transfer' }), bt('c8000000-0000-0000-0000-000000000007', '2026-11-09', 2000, 'in', 'FROM CHECKING', { transfer_group_id: 'g1', classification: 'transfer' })],
  expense_categories: [{ key: 'cogs_goods', label: 'Cost of goods', active: true }, { key: 'prof_fees', label: 'Professional fees', active: true }],
  bill_commission_rules: [], bill_price_rules: [], invoices: [], customer_deposits: [], hub_settings: [],
});
function usedOn(txn) { var b = 0; db.t.vendor_bill_payments.forEach(function (p) { if (p.bank_transaction_id === txn && p.voided !== true) { b += Number(p.amount) || 0; } }); var f = 0; db.t.wire_packages.forEach(function (w) { if (w.bank_transaction_id === txn && w.status === 'attached') { f += Number(w.fee_amount) || 0; } }); return r2(b + f); }
db.rpcs = { wire_request_send: function (a) { // stand-in; the real function runs on Postgres (clickbooks/tests/sp-funded-requests)
  var p = db.t.wire_packages.filter(function (x) { return x.id === a.p_pkg; })[0]; var t = db.t.bank_transactions.filter(function (x) { return x.id === p.funding_txn_id; })[0];
  var ls = db.t.wire_package_lines.filter(function (l) { return l.package_id === p.id; }); var bills = r2(ls.reduce(function (s, l) { return s + Number(l.amount); }, 0)); var tot = r2(bills + (Number(p.fee_amount) || 0)); var rem = r2(Number(t.amount_abs) - usedOn(t.id));
  if (tot > rem + 0.001) { return { ok: false, why: 'over' }; }
  ls.forEach(function (l, i) { var pid = 'pay-' + p.id.substring(0, 8) + '-' + i; db.t.vendor_bill_payments.push({ id: pid, bill_id: l.bill_id, amount: Number(l.amount), paid_date: t.posted_date, method: 'rtm', bank_transaction_id: t.id, voided: false }); l.payment_id = pid; l.is_open = false; });
  p.status = 'attached'; p.sent_by = a.p_actor; p.sent_date = a.p_sent_date; p.approved_total = tot; p.bank_transaction_id = t.id; p.bank_reference = 'request to ' + p.payee_name;
  return { ok: true, bills_paid: ls.length, bills_total: bills, fee: r2(p.fee_amount), total: tot, paid_date: t.posted_date, transfer_amount: r2(t.amount_abs), remaining_after: r2(rem - tot) }; } };
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
global.__db = db;
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var wires = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
async function call(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var pkg = function (i) { return db.t.wire_packages.filter(function (x) { return x.id === i; })[0]; };
async function approve(wid) {
  var g = await call(wires, 'u1', { action: 'get', id: wid });
  for (var i = 0; i < g.lines.length; i++) { await call(wires, 'u1', { action: 'review_bill', id: wid, bill_id: g.lines[i].bill_id }); await call(wires, 'u2', { action: 'review_bill', id: wid, bill_id: g.lines[i].bill_id }); }
  var s1 = await call(wires, 'u1', { action: 'signoff', id: wid, note: 'checked every bill against the orders' }); var s2 = await call(wires, 'u2', { action: 'signoff', id: wid, note: 'second check — matches' });
  return s1.ok && s2.ok && s2.approved;
}
var TODAY = new Date().toISOString().substring(0, 10);

(async function () {
  console.log('SQ — B. the company’s wire copies, vendor by vendor (NextTrade works like RTM)');
  var s1 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: 'NextTrade Industries', funding_txn_id: TN, fee_amount: 200, lines: [{ bill_id: N1, amount: 3000 }, { bill_id: N2, amount: 1000 }, { bill_id: M1, amount: 1500 }] });
  var W = s1.id;
  check('B1: a request to NextTrade — two vendors, three bills — no currency warning when everything is USD', s1.ok && s1.total === 5700 && Array.isArray(s1.currency_mismatch) && s1.currency_mismatch.length === 0, s1);
  var early = await call(wires, 'u1', { action: 'rtm_proof', id: W, line_ids: db.t.wire_package_lines.map(function (l) { return l.id; }), paid_date: TODAY, proof_path: 'pv/wire-' + W + '-copy.pdf', proof_name: 'copy.pdf' });
  check('B2: a wire copy cannot be attached before the request is sent', !early.ok && /after the wire is sent/.test(early.error), early);
  var ok = await approve(W); var sent = await call(wires, 'u1', { action: 'mark_sent', id: W, sent_date: TODAY });
  var g1 = await call(wires, 'u1', { action: 'get', id: W });
  check('B3: sent — and now it WAITS for NextTrade’s wire copies, exactly like an RTM request', ok && sent.ok && g1.package.status === 'awaiting_proof' && g1.package.paid_through === true && g1.package.rtm_pending === 3, { st: g1.package && g1.package.status, sent: sent });
  var vM = g1.package.by_vendor.filter(function (v) { return v.vendor === 'Vendor M'; })[0]; var vN = g1.package.by_vendor.filter(function (v) { return v.vendor === 'Vendor N'; })[0];
  check('B4: each vendor line knows its bills and that its copy is still missing', vM && vN && vM.ref === g1.package.label + '/1' && vN.ref === g1.package.label + '/2' && vN.line_ids.length === 2 && vN.waiting_line_ids.length === 2 && vN.copies_in === 0 && vN.copies.length === 0 && vM.waiting_line_ids.length === 1, g1.package.by_vendor);
  var foreign = await call(wires, 'u1', { action: 'rtm_proof', id: W, line_ids: ['c9999999-0000-0000-0000-000000000001'], paid_date: TODAY, proof_path: 'pv/wire-' + W + '-copy.pdf', proof_name: 'copy.pdf' });
  var pub = await call(wires, 'u1', { action: 'rtm_proof', id: W, line_ids: vN.waiting_line_ids, paid_date: TODAY, proof_path: 'public/copy.pdf', proof_name: 'copy.pdf' });
  check('B5: a copy for lines of another wire is refused, and so is a file outside the private bills folder', !foreign.ok && !pub.ok && db.t.wire_package_files.length === 0, { foreign: foreign, pub: pub });
  var c1 = await call(wires, 'u1', { action: 'rtm_proof', id: W, line_ids: vN.waiting_line_ids, paid_date: '2026-11-12', reference: 'NT-WIRE-551', proof_path: 'pv/wire-' + W + '-vendorN.pdf', proof_name: 'vendorN-wire.pdf' });
  var g2 = await call(wires, 'u1', { action: 'get', id: W });
  var vN2 = g2.package.by_vendor.filter(function (v) { return v.vendor === 'Vendor N'; })[0]; var vM2 = g2.package.by_vendor.filter(function (v) { return v.vendor === 'Vendor M'; })[0];
  check('B6: Vendor N’s copy is in and can be opened from its line (one file covers both its bills); Vendor M still waits', c1.ok && c1.confirmed === 2 && vN2.waiting_line_ids.length === 0 && vN2.copies_in === 2 && vN2.copies.length === 1 && vN2.copies[0].path === 'pv/wire-' + W + '-vendorN.pdf' && vN2.copies[0].paid_date === '2026-11-12' && vN2.copies[0].reference === 'NT-WIRE-551' && vM2.waiting_line_ids.length === 1 && g2.package.status === 'awaiting_proof', { vN2: vN2, st: g2.package.status });
  var c2 = await call(wires, 'u1', { action: 'rtm_proof', id: W, line_ids: vM2.waiting_line_ids, paid_date: '2026-11-13', proof_path: 'pv/wire-' + W + '-vendorM.png', proof_name: 'vendorM.png' });
  var g3 = await call(wires, 'u1', { action: 'get', id: W });
  check('B7: with every vendor’s copy in, the request is COMPLETE', c2.ok && g3.package.status === 'complete' && g3.package.rtm_pending === 0 && g3.package.by_vendor.every(function (v) { return v.waiting_line_ids.length === 0 && v.copies.length === 1; }), g3.package.status);
  check('B8: every copy is in the history with who added it', db.t.hub_audit_log.filter(function (h) { return h.action === 'wire_package_rtm_proof'; }).length === 2);
  check('B9: the copies are stored in the private folder only (signed links, never public)', db.t.wire_package_files.every(function (f) { return f.path.indexOf('pv/') === 0 && f.kind === 'rtm_proof'; }) && !/getPublicUrl/.test(R('src/components/WirePackagesPanel.jsx')));

  console.log('SQ — C. currency: flagged, never converted');
  var s2 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: 'NextTrade Industries', funding_txn_id: TN, lines: [{ bill_id: E1, amount: 300 }] });
  check('C1: a bill in EGP against a USD transfer is flagged when the request is saved — with the bill and both currencies', s2.ok && s2.currency_mismatch.length === 1 && s2.currency_mismatch[0].bill_number === 'E-1' && s2.currency_mismatch[0].currency === 'EGP' && s2.currency_mismatch[0].transfer_currency === 'USD', s2.currency_mismatch);
  var g4 = await call(wires, 'u1', { action: 'get', id: s2.id });
  check('C2: and stays flagged on the request; the amount is left exactly as typed', g4.package.funding.currency === 'USD' && g4.package.funding.currency_mismatch.length === 1 && db.t.wire_package_lines.filter(function (l) { return l.package_id === s2.id; })[0].amount === 300, g4.package.funding);

  console.log('SQ — D. Books home: a transfer with a missing second leg');
  var cf = await call(bills, 'u1', { action: 'cashflow', from: '2026-11-01', to: '2026-11-30' });
  var sm = cf.summary || {};
  var inV = sm.actual_in != null ? sm.actual_in : (sm.in != null ? sm.in : sm.came_in); var outV = sm.actual_out != null ? sm.actual_out : (sm.out != null ? sm.out : sm.went_out);
  check('D1: CAME IN counts the $900 deposit only — not the $300 marked transfer, not the linked $2,000', cf.ok && r2(inV) === 900, { keys: Object.keys(sm), inV: inV });
  check('D2: WENT OUT counts the $6,000 sent to NextTrade and the $250 supplies — not the $7,000 marked transfer, not the linked $2,000', r2(outV) === 6250, { outV: outV });
  check('D3: the two lines with a missing second leg are flagged with their total ($7,300); the linked pair is on its own card ($2,000)', cf.transfers_unlinked && cf.transfers_unlinked.count === 2 && cf.transfers_unlinked.total === 7300 && cf.transfers_between.count === 1 && cf.transfers_between.total === 2000, { u: cf.transfers_unlinked, b: cf.transfers_between });
  var BH = R('src/components/BooksHomeTab.jsx');
  check('D4 (pin): the screen says so in plain words', /The second leg is missing\./.test(BH) && /not counted in CAME IN or WENT OUT/.test(BH) && !/still counted above/.test(BH));

  console.log('SQ — E. the screen and the build');
  var ui = R('src/components/WirePackagesPanel.jsx');
  check('E1 (pin): print buttons for both copies; a blocked print window is said out loud, never silent', /Copy for ' \+ P\.payee_name/.test(ui) && /Our copy \(bill by bill\)/.test(ui) && /The browser blocked the print window/.test(ui));
  check('E2 (pin): a wire-copy column per vendor — open the copy, or attach it', /’s wire copy'/.test(ui) && /Attach copy/.test(ui) && /⏳ waiting/.test(ui) && /✓ in/.test(ui));
  check('E3 (pin): dates side by side and the currency warning on the request', /bills are recorded paid on ' \+ P\.funding\.date/.test(ui) && /Currency does not match/.test(ui) && /Amounts are not converted/.test(ui));
  check('E4 (pin): no browser pop-up questions; new fields readable in the dark skin', !/window\.(prompt|confirm|alert)\(/.test(ui) && (ui.match(/<input(?![^>]*type="file")[^>]*>/g) || []).every(function (t) { return /className=\{inp\}|nt-light|type="checkbox"/.test(t); }));
  var route = R('src/app/api/accounting/wire-packages/route.js'); var srv = R('src/lib/wire-funding-server.js');
  var newCode = route.split('\n').filter(function (l) { return /v55\.83-SQ|currencyMismatch|byVendorG|vKey|billVendor|fileBy|mineV|seenF/.test(l); }).join('\n') + srv.substring(srv.indexOf('// v55.83-SQ'));
  check('E5 (pin): new server code keeps the house rules — var only, no template strings', !/\b(let|const)\s/.test(newCode) && newCode.indexOf('`') < 0);
  var wn = R('src/components/WhatsNewWidget.jsx');
  check('E6 (pin): What’s New has v55.83-SQ in plain words with one technical line', /version: 'v55\.83-SQ'/.test(wn) && /superAdminOnly: true/.test(wn.substring(wn.indexOf("version: 'v55.83-SQ'"), wn.indexOf("version: 'v55.83-SP'"))));
  check('E7 (pin): the build badge is at v55.83-SQ or later (v55.83-SR realign)', />v55\.83-(?:S[Q-Z]|[T-Z][A-Z]|AA[A-Z])<\/span>/.test(R('src/app/page.jsx')));
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
// v55.83-UB realign: badge letters now run past T (UA, UB …) — the badge checks accept T–Z
