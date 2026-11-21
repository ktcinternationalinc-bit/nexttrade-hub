// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SP (part one) — Max, Nov 15 2026 — requests drawn from a transfer already sent to RTM / NextTrade:
//   "A bank line needs to serve two wires if necessary, especially in the past"
//   "the bills that are submitted per request should fit the total amount of the request … they should not go beyond the
//    amount you transfer to Nextrade or RTM, and take into account their professional fees … Even if you have to split or
//    partially pay a bill."
//   "it should be waiting for me … every transfer should be used totally"
//   "Each request would just be one round of two signatures" · "Past requests also need to have confirmations with two signatures."
//   service fee change: "Doesn't need double signatures" · "if it goes directly from my account, the current flow stays as is"
//   "Approve. Go forward."
// The request maths and the wire route are RUN here on an in-memory database. The two database functions
// (wire_request_send / wire_request_fee_change) are stood in for here by small JS mirrors; the REAL functions are run on
// Postgres 16 in clickbooks/tests/sp-funded-requests/01_scen.sql (F0–F19).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var F = require(path.join(root, 'src/lib/wire-funding.js'));
var WA = require(path.join(root, 'src/lib/wire-audit.js'));
var WL = require(path.join(root, 'src/lib/waiting-list.js'));
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
function id(n) { return 'c5000000-0000-0000-0000-' + String(n).padStart(12, '0'); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

console.log('SP — A. the request maths (pure)');
var left = F.fundingLeft(50000, 38000, 1300);
check('A1: $50,000 sent, $38,000 of bills and $1,300 of fees used → $10,700 left', left.used === 39300 && left.remaining === 10700 && !left.fully_used && !left.over, left);
var over = F.requestFit(10700, 14000, 500);
check('A2: $14,000 of bills + $500 fee does NOT fit $10,700 — $3,800 too much; room for bills is $10,200', !over.fits && over.over_by === 3800 && over.room_for_bills === 10200, over);
var exact = F.requestFit(10700, 10200, 500);
check('A3: the bill split to $10,200 + $500 fee fits exactly — nothing left', exact.fits && exact.exact && exact.left_after === 0, exact);
check('A4: cents are exact (0.1 + 0.2 is not "over" 0.3)', F.requestFit(0.3, 0.1, 0.2).fits && F.requestFit(0.3, 0.1, 0.2).exact);
var bv = F.requestByVendor('WP-0042', [
  { amount: 9000, bill: { vendor_name: 'Vendor A', bill_number: 'A-1', total_amount: 9000 } }, { amount: 9000, bill: { vendor_name: 'VENDOR  A', bill_number: 'A-2', total_amount: 9000 } },
  { amount: 20000, bill: { vendor_name: 'Vendor B', bill_number: 'B-1', total_amount: 20000 } }, { amount: 10200, bill: { vendor_name: 'Vendor C', bill_number: 'C-1', total_amount: 14000 } }]);
check('A5: vendor by vendor with a reference each — WP-0042/1 Vendor A (2 bills, $18,000), /2 Vendor B, /3 Vendor C $10,200 (1 paid in part)',
  bv.length === 3 && bv[0].ref === 'WP-0042/1' && bv[0].bills === 2 && bv[0].amount === 18000 && bv[1].ref === 'WP-0042/2' && bv[2].ref === 'WP-0042/3' && bv[2].amount === 10200 && bv[2].partial === 1 && bv[0].partial === 0, bv);
var fpA = WA.packageFingerprint({ id: 'x', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 500, funding_txn_id: 't1' }, [{ bill_id: 'b', amount: 100, bill: {} }]);
var fpB = WA.packageFingerprint({ id: 'x', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 900, funding_txn_id: 't1' }, [{ bill_id: 'b', amount: 100, bill: {} }]);
var fpC = WA.packageFingerprint({ id: 'x', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 500, funding_txn_id: 't2' }, [{ bill_id: 'b', amount: 100, bill: {} }]);
var fpD = WA.packageFingerprint({ id: 'x', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 500, funding_txn_id: 't1' }, [{ bill_id: 'b', amount: 101, bill: {} }]);
var fpO1 = WA.packageFingerprint({ id: 'x', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 500 }, [{ bill_id: 'b', amount: 100, bill: {} }]);
var fpO2 = WA.packageFingerprint({ id: 'x', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 900 }, [{ bill_id: 'b', amount: 100, bill: {} }]);
check('A6: on a request the two signatures cover the bills and the transfer — a fee change keeps them; a bill change or another transfer voids them', fpA === fpB && fpA !== fpC && fpA !== fpD);
check('A7: an ordinary wire is unchanged — its signatures still cover the fee', fpO1 !== fpO2 && fpO1 !== fpA);

// ── the route, on an in-memory database
function nb(n, vendor, no, amt, extra) { return Object.assign({ id: id(n), vendor_name: vendor, bill_number: no, bill_date: '2026-10-20', due_date: '2026-11-20', total_amount: amt, record_status: 'active', validation_status: 'validated', bill_type: 'supplier', shipment_direction: 'inbound', other_reference: 'REF-' + no, paid_via: 'RTM Capital' }, extra || {}); }
var A1 = id(1), A2 = id(2), B1 = id(3), C1 = id(4), N1 = id(5), V1 = id(6), X1 = id(7);
var TR = 'c7000000-0000-0000-0000-000000000001', TN = 'c7000000-0000-0000-0000-000000000002', TI = 'c7000000-0000-0000-0000-000000000003', TV = 'c7000000-0000-0000-0000-000000000004';
function bt(i, date, amt, name, x) { return Object.assign({ id: i, date: date, posted_date: date, amount_abs: amt, direction: 'out', pending: false, wave_business_id: US, review_status: null, name: name, merchant_name: null, third_party_payer: null, transfer_group_id: null, classification: null }, x || {}); }
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }, { id: 'u9', name: 'Max', role: 'super_admin', active: true }],
  module_permissions: [].concat(['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [nb(1, 'Vendor A', 'A-1', 9000), nb(2, 'Vendor A', 'A-2', 9000), nb(3, 'Vendor B', 'B-1', 20000), nb(4, 'Vendor C', 'C-1', 14000),
    nb(5, 'Vendor N', 'N-1', 4000, { paid_via: 'NextTrade Industries' }), nb(6, 'Direct Vendor', 'D-1', 700, { paid_via: null }), nb(7, 'Vendor X', 'X-1', 2500)],
  vendor_bill_lines: [], vendor_bill_payments: [], vendor_bill_events: [], hub_audit_log: [],
  wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], wire_bill_reviews: [], expense_rules: [],
  paid_through_parties: [{ name: 'RTM Capital', kind: 'service_provider', active: true }, { name: 'NextTrade Industries', kind: 'affiliate', active: true }],
  bank_transactions: [bt(TR, '2026-11-03', 50000, 'ONLINE TRANSFER TO RTM CAPITAL 9909', { third_party_payer: 'RTM Capital' }), bt(TN, '2026-11-05', 6000, 'ONLINE TRANSFER TO NEXTTRADE 2061', { third_party_payer: 'NextTrade Industries' }),
    bt(TI, '2026-11-06', 8000, 'TRANSFER TO SAVINGS', { third_party_payer: 'RTM Capital', transfer_group_id: 'g1' }), bt(TV, '2026-11-10', 700, 'WIRE OUT DIRECT VENDOR')],
  expense_categories: [{ key: 'cogs_goods', label: 'Cost of goods', active: true }, { key: 'prof_fees', label: 'Professional fees', active: true }],
  bill_commission_rules: [], bill_price_rules: [],
});
// ── stand-ins for the two database functions (the real ones run on Postgres — see the header)
function usedOn(txn) {
  var b = 0; db.t.vendor_bill_payments.forEach(function (p) { if (p.bank_transaction_id === txn && p.voided !== true) { b += Number(p.amount) || 0; } });
  var f = 0; db.t.wire_packages.forEach(function (w) { if (w.bank_transaction_id === txn && w.status === 'attached') { f += Number(w.fee_amount) || 0; } });
  return r2(b + f);
}
var sendCalls = 0;
db.rpcs = {
  wire_request_send: function (a) {
    sendCalls++;
    var p = db.t.wire_packages.filter(function (x) { return x.id === a.p_pkg; })[0];
    if (!p || p.status !== 'draft' || !p.funding_txn_id) { return { ok: false, why: 'not a request that can be sent' }; }
    var t = db.t.bank_transactions.filter(function (x) { return x.id === p.funding_txn_id; })[0];
    var ls = db.t.wire_package_lines.filter(function (l) { return l.package_id === p.id; });
    var bills = r2(ls.reduce(function (s, l) { return s + Number(l.amount); }, 0)); var tot = r2(bills + (Number(p.fee_amount) || 0));
    var rem = r2(Number(t.amount_abs) - usedOn(t.id));
    if (tot > rem + 0.001) { return { ok: false, why: 'This request is $' + tot.toFixed(2) + ' but only $' + rem.toFixed(2) + ' is left on the transfer.' }; }
    ls.forEach(function (l, i) { var pid = 'pay-' + p.id.substring(0, 8) + '-' + i; db.t.vendor_bill_payments.push({ id: pid, bill_id: l.bill_id, amount: Number(l.amount), paid_date: t.posted_date || t.date, method: 'rtm', bank_transaction_id: t.id, voided: false }); l.payment_id = pid; l.is_open = false; });
    p.status = 'attached'; p.sent_by = a.p_actor; p.sent_date = a.p_sent_date; p.approved_total = tot; p.bank_transaction_id = t.id; p.bank_reference = 'request to ' + p.payee_name;
    return { ok: true, bills_paid: ls.length, bills_total: bills, fee: r2(p.fee_amount), total: tot, paid_date: t.posted_date || t.date, transfer_amount: r2(t.amount_abs), remaining_after: r2(rem - tot) };
  },
  wire_request_fee_change: function (a) {
    var p = db.t.wire_packages.filter(function (x) { return x.id === a.p_pkg; })[0];
    if (!p || p.status !== 'attached' || !p.funding_txn_id) { return { ok: false, why: 'Only a sent request can change its fee.' }; }
    var t = db.t.bank_transactions.filter(function (x) { return x.id === p.funding_txn_id; })[0];
    var room = r2(Number(t.amount_abs) - usedOn(t.id) + (Number(p.fee_amount) || 0));
    if (Number(a.p_fee) > room + 0.001) { return { ok: false, why: 'The transfer has room for a fee of at most $' + room.toFixed(2) + '.', max_fee: room }; }
    var from = r2(p.fee_amount); p.fee_amount = r2(a.p_fee); p.approved_total = r2(p.approved_total - from + p.fee_amount);
    return { ok: true, from: from, to: p.fee_amount, total: p.approved_total, remaining_after: r2(Number(t.amount_abs) - usedOn(t.id)) };
  },
};
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
global.__db = db;
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var wires = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
async function call(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var pkg = function (i) { return db.t.wire_packages.filter(function (x) { return x.id === i; })[0]; };
var paysOf = function (billId) { return db.t.vendor_bill_payments.filter(function (p) { return p.bill_id === billId && p.voided !== true; }); };
var hist = function (a) { return db.t.hub_audit_log.filter(function (h) { return h.action === a; }); };
var line = function (i) { return db.t.bank_transactions.filter(function (x) { return x.id === i; })[0]; };
async function billRow(billId) { var l = await call(bills, 'u1', { action: 'list' }); return (l.bills || []).filter(function (x) { return x.id === billId; })[0] || {}; }
async function approve(wid) {
  var g = await call(wires, 'u1', { action: 'get', id: wid });
  for (var i = 0; i < g.lines.length; i++) { await call(wires, 'u1', { action: 'review_bill', id: wid, bill_id: g.lines[i].bill_id }); await call(wires, 'u2', { action: 'review_bill', id: wid, bill_id: g.lines[i].bill_id }); }
  var s1 = await call(wires, 'u1', { action: 'signoff', id: wid, note: 'checked every bill against the orders' });
  var s2 = await call(wires, 'u2', { action: 'signoff', id: wid, note: 'second check — matches' });
  return s1.ok && s2.ok && s2.approved;
}
var TODAY = new Date().toISOString().substring(0, 10);

(async function () {
  console.log('SP — B. a request drawn from the $50,000 transfer to RTM');
  var fl0 = await call(wires, 'u1', { action: 'funding_lines', payee_name: 'RTM Capital' });
  check('B1: the transfer marked "sent to RTM" is offered with $50,000 left; the NextTrade one and the internal transfer are not', fl0.ok && fl0.lines.length === 1 && fl0.lines[0].id === TR && fl0.lines[0].remaining === 50000 && fl0.lines[0].used === 0, fl0);
  var bad1 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: '', funding_txn_id: TR, lines: [{ bill_id: V1, amount: 700 }] });
  check('B2: a wire straight to a vendor cannot draw from a transfer (the direct flow stays as it is)', !bad1.ok && /does not draw from a transfer/.test(bad1.error), bad1);
  var bad2 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', funding_txn_id: TN, lines: [{ bill_id: A1, amount: 9000 }] });
  check('B3: a transfer that went to NextTrade cannot fund an RTM request', !bad2.ok && /went to NextTrade Industries, not RTM Capital/.test(bad2.error), bad2);
  var bad3 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', funding_txn_id: TI, lines: [{ bill_id: A1, amount: 9000 }] });
  check('B4: a line that is a transfer between our own accounts is not offered', !bad3.ok && /was not found among the money sent/.test(bad3.error), bad3);
  var bad4 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', funding_txn_id: TR, fee_amount: 1300, lines: [{ bill_id: A1, amount: 9000 }, { bill_id: A2, amount: 9000 }, { bill_id: B1, amount: 20000 }, { bill_id: C1, amount: 14000 }] });
  check('B5: bills + fee over the transfer are refused BEFORE anything is saved, with the exact amounts', !bad4.ok && /\$53300\.00/.test(bad4.error) && /only \$50000\.00 is left/.test(bad4.error) && /\$3300\.00 too much/.test(bad4.error) && db.t.wire_packages.length === 0, bad4);
  var s1 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', funding_txn_id: TR, planned_send_date: '2099-01-05', fee_amount: 1300, fee_note: 'November service', lines: [{ bill_id: A1, amount: 9000 }, { bill_id: A2, amount: 9000 }, { bill_id: B1, amount: 20000 }] });
  var W1 = s1.id;
  check('B6: request 1 saved — two vendors, three bills, $38,000 + $1,300 fee = $39,300; $10,700 would be left', s1.ok && s1.total === 39300 && s1.funding && s1.funding.left_after === 10700 && pkg(W1).funding_txn_id === TR && pkg(W1).planned_send_date === '2099-01-05', s1);
  var g1 = await call(wires, 'u1', { action: 'get', id: W1 });
  check('B7: the request shows its transfer and the vendors with a reference each', g1.ok && g1.package.funding && g1.package.funding.amount === 50000 && g1.package.funding.fit.fits && g1.package.by_vendor.length === 2 && g1.package.by_vendor[0].ref === g1.package.label + '/1' && g1.package.by_vendor[0].vendor === 'Vendor A' && g1.package.by_vendor[0].bills === 2 && g1.package.by_vendor[0].amount === 18000, g1.package && g1.package.by_vendor);
  var early = await call(wires, 'u1', { action: 'mark_sent', id: W1, sent_date: TODAY });
  check('B8: not sent before BOTH signatures — and no bill is recorded paid', !early.ok && /BOTH sign-offs/.test(early.error) && sendCalls === 0 && db.t.vendor_bill_payments.length === 0, early);
  var ok1 = await approve(W1);
  var fut = await call(wires, 'u1', { action: 'mark_sent', id: W1, sent_date: '2099-01-05' });
  check('B9: the planned date completes nothing — a future "sent" date is refused, the bills stay open', ok1 && !fut.ok && /in the future/.test(fut.error) && pkg(W1).status === 'draft' && (await billRow(A1)).status === 'OPEN', fut);
  var sent1 = await call(wires, 'u1', { action: 'mark_sent', id: W1, sent_date: TODAY });
  check('B10: sent with a date only — no bank confirmation needed (nothing leaves our bank)', sent1.ok && sent1.request === true && sent1.bills_paid === 3 && sent1.total === 39300 && sent1.left_on_transfer === 10700, sent1);
  var pA1 = paysOf(A1)[0] || {};
  check('B11: each bill’s payment is recorded against the transfer, dated the day the money left (Nov 3) — not the day the request was sent', pA1.bank_transaction_id === TR && pA1.paid_date === '2026-11-03' && pA1.amount === 9000 && paysOf(B1)[0].bank_transaction_id === TR, pA1);
  check('B12: the bills are PAID; the request is attached to the transfer', (await billRow(A1)).status === 'PAID' && (await billRow(B1)).status === 'PAID' && pkg(W1).status === 'attached' && pkg(W1).bank_transaction_id === TR);
  check('B13: the transfer is ONE professional-fees line (it had no category and there is exactly one such category)', line(TR).classification === 'prof_fees', line(TR).classification);
  check('B14: history: who sent the request, the bills, the fee, what is left', hist('wire_request_sent').length === 1 && hist('wire_request_sent')[0].details.left_on_transfer === 10700 && hist('wire_request_sent')[0].details.service_fee === 1300 && hist('bill_payments_from_wire').length === 1);

  console.log('SP — C. a second request on the SAME transfer, with a bill paid in part');
  var o2 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', funding_txn_id: TR, fee_amount: 500, lines: [{ bill_id: C1, amount: 14000 }] });
  check('C1: $14,000 + $500 fee does not fit the $10,700 left — refused, with how much too much', !o2.ok && /only \$10700\.00 is left/.test(o2.error) && /\$3800\.00 too much/.test(o2.error), o2);
  var s2 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', funding_txn_id: TR, fee_amount: 500, lines: [{ bill_id: C1, amount: 10200 }] });
  var W2 = s2.id;
  check('C2: the bill split to $10,200 + $500 fits exactly — $0 left after', s2.ok && s2.total === 10700 && s2.funding.left_after === 0, s2);
  var flm = await call(wires, 'u1', { action: 'funding_lines', payee_name: 'RTM Capital' });
  check('C3: while request 2 waits for signatures the transfer shows $10,700 left and $10,700 on requests not sent yet', flm.ok && flm.lines[0].remaining === 10700 && flm.lines[0].planned === 10700 && flm.lines[0].requests.length === 1, flm.lines && flm.lines[0]);
  var ok2 = await approve(W2); var sent2 = await call(wires, 'u1', { action: 'mark_sent', id: W2, sent_date: TODAY });
  var rC = await billRow(C1);
  check('C4: two requests share one bank line; Vendor C’s bill is PARTIAL ($10,200 of $14,000, $3,800 still open)', ok2 && sent2.ok && sent2.left_on_transfer === 0 && pkg(W1).bank_transaction_id === TR && pkg(W2).bank_transaction_id === TR && rC.status === 'PARTIAL' && rC.open === 3800, { sent2: sent2, st: rC.status, open: rC.open });
  var tot = 0; db.t.vendor_bill_payments.forEach(function (p) { if (p.bank_transaction_id === TR && !p.voided) { tot += p.amount; } });
  check('C5: everything on the transfer adds up exactly — bills $48,200 + fees $1,800 = $50,000; no bill paid twice', r2(tot) === 48200 && r2(tot + 1300 + 500) === 50000 && db.t.vendor_bill_payments.length === 4 && paysOf(A1).length === 1);
  var fl2 = await call(wires, 'u1', { action: 'funding_lines', payee_name: 'RTM Capital' });
  var fl2b = await call(wires, 'u1', { action: 'funding_lines', payee_name: 'RTM Capital', include_used: true });
  check('C6: a fully used transfer is no longer offered (but can still be listed)', fl2.ok && fl2.lines.length === 0 && fl2b.lines.length === 1 && fl2b.lines[0].fully_used === true && fl2b.lines[0].requests.length === 2, fl2b.lines);
  var o3 = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', funding_txn_id: TR, lines: [{ bill_id: X1, amount: 2500 }] });
  check('C7: a third request on the used-up transfer is refused', !o3.ok && /only \$0\.00 is left/.test(o3.error), o3);

  console.log('SP — D. changing the service fee after sending (no new signatures; a reason; never over the transfer)');
  var f0 = await call(wires, 'u2', { action: 'change_fee', id: W2, fee_amount: '400', reason: 'agreed lower fee' });
  check('D1: needs "Wires: Send"', !f0.ok && /Wires: Send/.test(f0.error), f0);
  var f1 = await call(wires, 'u1', { action: 'change_fee', id: W2, fee_amount: '400', reason: '' });
  check('D2: needs a reason', !f1.ok && /Say why/.test(f1.error) && pkg(W2).fee_amount === 500, f1);
  var f2 = await call(wires, 'u1', { action: 'change_fee', id: W2, fee_amount: '4o0', reason: 'agreed lower fee' });
  check('D3: a fee that is not a number is refused (never guessed)', !f2.ok && /not a valid number/.test(f2.error), f2);
  var f3 = await call(wires, 'u1', { action: 'change_fee', id: W2, fee_amount: '900', reason: 'RTM raised the fee' });
  check('D4: a higher fee the transfer has no room for is refused', !f3.ok && /at most \$500\.00/.test(f3.error) && pkg(W2).fee_amount === 500, f3);
  var sigBefore = [pkg(W2).signoff1_by, pkg(W2).signoff2_by].join('+');
  var f4 = await call(wires, 'u1', { action: 'change_fee', id: W2, fee_amount: '400.00', reason: 'RTM agreed a lower fee for November' });
  check('D5: lowered to $400 — $100 is back on the transfer, the two signatures stand, the change is in the history with the reason', f4.ok && f4.from === 500 && f4.to === 400 && f4.left_on_transfer === 100 && [pkg(W2).signoff1_by, pkg(W2).signoff2_by].join('+') === sigBefore && hist('wire_request_fee_changed').length === 1 && /lower fee/.test(hist('wire_request_fee_changed')[0].details.reason), f4);
  var listW = await call(wires, 'u1', { action: 'list' });
  check('D6: the $100 now unused comes back with the wire list (for “Waiting for me”)', listW.ok && listW.funding_open.length === 2 && listW.funding_open.some(function (x) { return x.id === TR && x.remaining === 100; }), listW.funding_open);
  var f5 = await call(wires, 'u1', { action: 'change_fee', id: W2, fee_amount: '500', reason: 'book the rest as their service fee' });
  check('D7: “book the rest as their service fee” — fee back to $500, the transfer is fully used again', f5.ok && f5.left_on_transfer === 0, f5);

  console.log('SP — E. what must not change');
  var past = await call(wires, 'u9', { action: 'record_past_wire', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: X1, amount: 2500 }], sent_date: '2026-06-14', reason: 'June payment through RTM for Vendor X' });
  check('E1: a past payment through RTM cannot skip the two signatures any more — it is a request from its transfer', !past.ok && /two signatures/.test(past.error) && !db.t.wire_packages.some(function (p) { return p.after_the_fact; }), past);
  var sv = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: '', lines: [{ bill_id: V1, amount: 700 }] });
  var WV = sv.id; var okV = await approve(WV);
  var vFut = await call(wires, 'u1', { action: 'mark_sent', id: WV, sent_date: '2099-01-01', bank_reference: 'FED-1', proof_path: 'pv/wire-x-conf.pdf', proof_name: 'conf.pdf' });
  check('E2: a direct wire cannot be marked sent on a future date either', sv.ok && okV && !vFut.ok && /in the future/.test(vFut.error) && pkg(WV).status === 'draft', vFut);
  var vNo = await call(wires, 'u1', { action: 'mark_sent', id: WV, sent_date: TODAY, bank_reference: '', proof_path: '', proof_name: '' });
  check('E3: a direct wire still needs the bank reference and the bank confirmation (unchanged)', !vNo.ok && pkg(WV).status === 'draft' && !pkg(WV).funding_txn_id, vNo);
  var vOk = await call(wires, 'u1', { action: 'mark_sent', id: WV, sent_date: TODAY, bank_reference: 'FED-9911', proof_path: 'pv/wire-' + WV + '-conf.pdf', proof_name: 'conf.pdf' });
  check('E4: and goes SENT the old way — it never touches the request path', vOk.ok && pkg(WV).status === 'sent' && sendCalls === 2, { vOk: vOk, sendCalls: sendCalls });
  var cfV = await call(wires, 'u1', { action: 'change_fee', id: WV, fee_amount: '10', reason: 'not a request' });
  check('E5: only a request has a fee that can change after sending', !cfV.ok && /Only a request drawn from a transfer/.test(cfV.error), cfV);
  var und = await call(wires, 'u9', { action: 'delete_wire', id: W2, reason: 'request 2 was withdrawn by RTM' });
  check('E6: undoing request 2 voids only ITS payment, and the transfer stays marked "sent to RTM" for request 1', und.ok && pkg(W2).status === 'reversed' && paysOf(C1).length === 0 && paysOf(A1).length === 1 && line(TR).third_party_payer === 'RTM Capital' && und.undone.bank_line_restored === false, und);
  var fl3 = await call(wires, 'u1', { action: 'funding_lines', payee_name: 'RTM Capital' });
  check('E7: its $10,700 is back on the transfer, waiting for bills', fl3.ok && fl3.lines.length === 1 && fl3.lines[0].remaining === 10700, fl3.lines);
  var sN = await call(wires, 'u1', { action: 'save_draft', payee_kind: 'affiliate', payee_name: 'NextTrade Industries', funding_txn_id: TN, fee_amount: 250, lines: [{ bill_id: N1, amount: 4000 }] });
  var okN = await approve(sN.id); var sentN = await call(wires, 'u1', { action: 'mark_sent', id: sN.id, sent_date: TODAY });
  check('E8: NextTrade works the same way — request from its transfer, two signatures, paid on the transfer date, $1,750 left', sN.ok && okN && sentN.ok && sentN.left_on_transfer === 1750 && paysOf(N1)[0].paid_date === '2026-11-05' && paysOf(N1)[0].bank_transaction_id === TN, sentN);

  console.log('SP — F. “Waiting for me”');
  var w = WL.waitingFor({ bills: [], wires: [], funding: [{ id: TR, date: '2026-11-03', payee: 'RTM Capital', amount: 50000, used: 39300, remaining: 10700, planned: 0 }, { id: TN, date: '2026-11-14', payee: 'NextTrade Industries', amount: 6000, used: 6000, remaining: 0, planned: 0 }], perms: { prepare: true }, userId: 'u1', today: '2026-11-15' });
  var secU = w.sections.filter(function (s) { return s.key === 'transfer_unused'; })[0];
  check('F1: a transfer with unused money waits for the person who prepares wires; a fully used one does not', secU && secU.items.length === 1 && secU.items[0].amount === '$10,700.00' && /RTM Capital · transfer of 2026-11-03/.test(secU.items[0].title) && secU.items[0].stuck === true, secU);
  var wNo = WL.waitingFor({ bills: [], wires: [], funding: [{ id: TR, date: '2026-11-03', payee: 'RTM Capital', amount: 50000, used: 39300, remaining: 10700 }], perms: { bills: true }, userId: 'u2', today: '2026-11-15' });
  check('F2: not shown to someone who cannot prepare wires', !wNo.sections.some(function (s) { return s.key === 'transfer_unused'; }));

  console.log('SP — G. the database script, the screen and the build');
  var sql = R('sql/v55-83-SP-funded-requests.sql');
  check('G1: SQL — one bank line may carry several REQUESTS, an ordinary wire still owns its line alone', /uq_wpkg_bank_line_exclusive/.test(sql) && /WHERE funding_txn_id IS NULL AND bank_transaction_id IS NOT NULL/i.test(sql) && /wpkg_funded_not_vendor/.test(sql) && /wpkg_funded_same_line/.test(sql));
  check('G2: SQL — the send and fee functions exist, lock the rows, respect the closed month and are for the server only', /FUNCTION public\.wire_request_send/i.test(sql) && /FUNCTION public\.wire_request_fee_change/i.test(sql) && /FUNCTION public\.wire_funding_summary/i.test(sql) && /FOR UPDATE/i.test(sql) && /locked_through/.test(sql) && /REVOKE ALL[\s\S]*FROM PUBLIC/i.test(sql) && /service_role/.test(sql) && !/GRANT[^;]*\b(anon|authenticated)\b/i.test(sql));
  check('G3: SQL — safe to run twice', /ADD COLUMN IF NOT EXISTS funding_txn_id/i.test(sql) && /ADD COLUMN IF NOT EXISTS planned_send_date/i.test(sql) && /CREATE OR REPLACE FUNCTION/i.test(sql));
  check('G4: the Postgres run of the real functions is kept with the build', fs.existsSync(path.join(root, 'clickbooks/tests/sp-funded-requests/01_scen.sql')) && fs.existsSync(path.join(root, 'clickbooks/tests/sp-funded-requests/README.md')));
  var route = R('src/app/api/accounting/wire-packages/route.js');
  var newCode = route.split('\n').filter(function (l) { return /v55\.83-SP|fundingLines|wire_request_|requestFit|fundInfo|fundS|planS|rsD|cfD|fundG/.test(l); }).join('\n');
  check('G5: the new server code keeps the house rules — var only, no template strings, no secret in a public variable', !/\b(let|const)\s/.test(newCode) && newCode.indexOf('`') < 0 && !/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE|PASSWORD|TOKEN)/.test(route));
  var ui = R('src/components/WirePackagesPanel.jsx');
  check('G6: the screen — pick the transfer, see what is left, fill to it, a planned date that is only a label', /Where does the money come from\?/.test(ui) && /Fill to the \$/.test(ui) && /fully used ✓/.test(ui) && /A label only — nothing is sent or recorded paid on that date by itself/.test(ui) && /A new wire from our bank \(not sent yet\) — works as before/.test(ui));
  check('G7: the screen — send the request with a date only, vendor table with references, change the fee with a reason', /Send request /.test(ui) && /no wire leaves our bank/.test(ui) && /Request total/.test(ui) && /Change the service fee/.test(ui) && /No new signatures — a reason is kept in the history/.test(ui));
  check('G8: no browser pop-ups, and every new field is readable in the dark skin', !/window\.(prompt|confirm|alert)\(/.test(ui) && /var inp = '[^']*nt-light'/.test(ui) && (ui.match(/<input(?![^>]*type="file")[^>]*>/g) || []).every(function (t) { return /className=\{inp\}|nt-light|type="checkbox"/.test(t); }), (ui.match(/<input(?![^>]*type="file")[^>]*>/g) || []).filter(function (t) { return !/className=\{inp\}|nt-light|type="checkbox"/.test(t); }).slice(0, 2));
  check('G9: recording a past wire no longer offers RTM / NextTrade — it points to the request', /onParty=\{startPaidFor\}/.test(ui) && /function startPaidFor\(kind, name\)/.test(ui) && !/function startPaidFor[\s\S]{0,600}record_past_wire/.test(ui) && /Two people sign/.test(ui)); // v55.83-SV realign: the companies are choices again, and they open the two-signature request steps (never record_past_wire)
  var wn = R('src/components/WhatsNewWidget.jsx');
  check('G10: What’s New has v55.83-SP in plain words with one technical line for the super admin', /version: 'v55\.83-SP'/.test(wn) && /superAdminOnly: true/.test(wn.substring(wn.indexOf("version: 'v55.83-SP'"), wn.indexOf("version: 'v55.83-SO'"))));
  check('G11: the build badge is at v55.83-SP or later (v55.83-SQ realign)', />v55\.83-(?:S[P-Z]|[T-Z][A-Z])<\/span>/.test(R('src/app/page.jsx')));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
// v55.83-UB realign: badge letters now run past T (UA, UB …) — the badge checks accept T–Z
