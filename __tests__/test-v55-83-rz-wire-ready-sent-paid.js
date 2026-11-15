// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RZ — Max, Nov 10 00:17–00:22 (confirmed "1 yes 2yes"):
//  "make sure that when it is ready to make payment by bank.. that in the status of each bill- that it goes from OPEN to
//   READY... and then when the wire is actually sent and you see a transaction for that amount in clickbooks...you
//   automatically match those underlying bills to that transaction and the status of the bills become PAID."
//  "we should be able to delete or cancel a wire after final approvals by the super admin."  (1: super admin only)
//  "for those bills paid prior to this function- retroactively..we should be able to update the date of the wire..and you
//   will look for the actual wire that was sent for that set of bills ... and match them underlying. also need to be able
//   to partially pay a bill..."
//  (2: a bank line up to $50 over the wire total matches by itself; the difference is booked as a bank fee)
// REAL bills + wire routes on an in-memory DB. The SQL (after-the-fact wires, sent-date correction, bank fee frozen once
// attached, the bank fee booked to "Bank fee" in ClickBooks) ran twice on PG16.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
function id(n) { return 'bd000000-0000-0000-0000-' + String(n).padStart(12, '0'); }
var A1 = id(1), A2 = id(2), V1 = id(3), V2 = id(4), V3 = id(5), V4 = id(6), P1 = id(7), P2 = id(8);
function nb(i, vendor, no, amt, extra) { return Object.assign({ id: i, vendor_name: vendor, bill_number: no, bill_date: '2026-06-08', total_amount: amt, record_status: 'active', validation_status: 'validated', bill_type: 'supplier', shipment_direction: 'inbound', other_reference: 'REF-' + no, paid_via: null }, extra || {}); }
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }, { id: 'u9', name: 'Max', role: 'super_admin', active: true }],
  module_permissions: [].concat(['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [nb(A1, 'NexPac Corporation', '14353', 3471.76, { paid_via: 'RTM Capital' }), nb(A2, 'NexPac Corporation', '14354', 2830.04, { paid_via: 'RTM Capital' }),
    nb(V1, 'Trinity Logistics', '9867052-1', 1000), nb(V2, 'AMB Logistic', '36100', 500), nb(V3, 'Old Truck Co', 'OT-1', 700), nb(V4, 'Late Date Co', 'LD-1', 900),
    nb(P1, 'NexPac Corporation', '13001', 1200, { validation_status: null, paid_via: 'RTM Capital' }), nb(P2, 'NexPac Corporation', '13002', 800, { validation_status: null, paid_via: 'RTM Capital' })],
  vendor_bill_lines: [], vendor_bill_payments: [], vendor_bill_events: [], hub_audit_log: [],
  wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], wire_bill_reviews: [], expense_rules: [],
  paid_through_parties: [{ name: 'RTM Capital', kind: 'service_provider', active: true }], bank_transactions: [],
  expense_categories: [{ key: 'cogs_goods', label: 'Cost of goods', active: true }, { key: 'prof_fees', label: 'Professional fees', active: true }],
  bill_commission_rules: [], bill_price_rules: [],
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var wires = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var WS = require(path.join(root, 'src/lib/bill-wire-state.js'));
async function call(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
var pkg = function (i) { return db.t.wire_packages.filter(function (x) { return x.id === i; })[0]; };
var paysOf = function (billId) { return db.t.vendor_bill_payments.filter(function (p) { return p.bill_id === billId && p.voided !== true; }); };
var hist = function (a) { return db.t.hub_audit_log.filter(function (h) { return h.action === a; }); };
var btSeq = 0;
function bankLine(date, amt, name) { btSeq++; var t = { id: 'b7000000-0000-0000-0000-' + String(btSeq).padStart(12, '0'), date: date, posted_date: date, amount_abs: amt, direction: 'out', pending: false, wave_business_id: US, review_status: null, name: name || 'WIRE OUT', merchant_name: null, third_party_payer: null }; db.t.bank_transactions.push(t); return t; }
async function billRow(billId) { var l = await call(bills, 'u1', { action: 'list' }); return (l.bills || []).filter(function (x) { return x.id === billId; })[0] || {}; }
async function approve(wid) { // both signers open and check every bill, then sign (the RY rule)
  var g = await call(wires, 'u1', { action: 'get', id: wid });
  for (var i = 0; i < g.lines.length; i++) { await call(wires, 'u1', { action: 'review_bill', id: wid, bill_id: g.lines[i].bill_id }); await call(wires, 'u2', { action: 'review_bill', id: wid, bill_id: g.lines[i].bill_id }); }
  var s1 = await call(wires, 'u1', { action: 'signoff', id: wid, note: 'checked every bill against the orders' });
  var s2 = await call(wires, 'u2', { action: 'signoff', id: wid, note: 'second check — matches' });
  return s1.ok && s2.ok && s2.approved;
}
async function wireFor(kind, payee, lines) { var s = await call(wires, 'u1', { action: 'save_draft', payee_kind: kind, payee_name: payee, lines: lines }); if (!s.ok) { console.log('save_draft:', JSON.stringify(s).substring(0, 400)); } return s.id; }
async function send(wid, date) { return call(wires, 'u1', { action: 'mark_sent', id: wid, sent_date: date, bank_reference: 'FED-' + wid.substring(0, 4), proof_path: 'pv/wire-' + wid + '-conf.pdf', proof_name: 'conf.pdf' }); }
console.log('RZ — bills go OPEN → READY → SENT → PAID; the Hub finds the bank line itself; past wires; part payments; extra charge (with the bill / professional fees)');
(async function () {
  // ── 1. OPEN → READY → SENT → PAID, with a PART payment of 14354
  var W1 = await wireFor('service_provider', 'RTM Capital', [{ bill_id: A1, amount: 3471.76 }, { bill_id: A2, amount: 2000 }]);
  var r0 = await billRow(A1);
  check('1a: on a wire still being signed, the bill says OPEN · on WP-…', r0.status === 'OPEN' && r0.wire_state && r0.wire_state.state === 'on_wire' && /^OPEN · on WP-/.test(r0.wire_state_words) /* SD: the words now end "(pre-wire — can still change)" */, r0.wire_state_words);
  var ok1 = await approve(W1);
  var r1 = await billRow(A1); var r2b = await billRow(A2);
  check('1b: both signatures in → READY · WP-… → RTM Capital', ok1 && r1.wire_state.state === 'ready' && /^READY · WP-\d+ → RTM Capital$/.test(r1.wire_state_words), r1.wire_state_words);
  check('1c: the part payment shows on the bill: READY … ($2,000.00 of $2,830.04) — and READY bills still count as owed', r2b.wire_state.state === 'ready' && /\(\$2000\.00 of \$2830\.04\)/.test(r2b.wire_state_words) && r2b.open === 2830.04, r2b.wire_state_words);
  // ── 2. after both signatures, only the super admin deletes / cancels (Max: "1 yes")
  var dx = await call(wires, 'u1', { action: 'delete_wire', id: W1, reason: 'changed my mind' });
  check('2a: after both signatures a preparer cannot delete the wire — only the super admin', !dx.ok && /only the super admin can delete it now/.test(dx.error) && pkg(W1).status === 'draft', dx);
  var cx = await call(wires, 'u1', { action: 'cancel', id: W1, note: 'changed my mind' });
  check('2b: …nor cancel it', !cx.ok && /only the super admin/.test(cx.error || ''), cx);
  var sn = await send(W1, '2026-11-09');
  var r3 = await billRow(A1);
  check('2c: marked sent → SENT · WP-… on 2026-11-09 — waiting for the bank line', sn.ok && r3.wire_state.state === 'sent' && /SENT · WP-\d+ on 2026-11-09 — waiting for the bank line/.test(r3.wire_state_words), { sn: sn, w: r3.wire_state_words });
  // ── 3. the bank line arrives → matched by itself → PAID / PARTIAL
  bankLine('2026-11-08', 5471.76, 'unrelated, before the wire window'); // 1 day of slack: this one IS in the window but … a different amount below
  db.t.bank_transactions[0].amount_abs = 5300; // (not the wire's amount → never matched)
  var bt1 = bankLine('2026-11-10', 5471.76, 'WIRE OUT RTM CAPITAL');
  var ls = await call(wires, 'u1', { action: 'list' });
  check('3a: opening Wires runs the matcher — exactly one bank line fits → attached automatically', ls.ok && (ls.auto_matched || []).length === 1 && pkg(W1).status === 'attached' && pkg(W1).bank_transaction_id === bt1.id && pkg(W1).matched_auto === true, { am: ls.auto_matched, st: pkg(W1).status });
  var r4 = await billRow(A1); var r5 = await billRow(A2);
  check('3b: 14353 is PAID; 14354 is PARTIAL ($2,000 paid, $830.04 still open) and no longer shows a wire step', r4.status === 'PAID' && !r4.wire_state && r5.status === 'PARTIAL' && r5.open === 830.04 && !r5.wire_state, { a1: r4.status, a2: r5.status, open: r5.open });
  check('3c: the payments carry the bank line and the bank date; the history says "automatically by the Hub"', paysOf(A1)[0].bank_transaction_id === bt1.id && paysOf(A1)[0].paid_date === '2026-11-10' && paysOf(A1)[0].method === 'rtm' &&
    hist('wire_package_attached').some(function (h) { return h.details.matched === 'automatically by the Hub'; }));
  var g1 = await call(wires, 'u1', { action: 'get', id: W1 });
  check('3d: the wire record says the Hub matched it (no person on it)', g1.package.attached && g1.package.attached.auto === true && g1.package.attached.by === 'the Hub (automatically)', g1.package.attached);
  check('3e: Max 16:37 "for Rtm or nextrade it would be professional fees" — the RTM bank line is filed under Professional fees (audited)',
    db.t.bank_transactions.filter(function (t) { return t.id === bt1.id; })[0].classification === 'prof_fees' && hist('bank_line_filed_professional_fees').length === 1);
  // ── 4. a wire straight to a vendor + a $25 extra charge (Max: "2 yes"; 16:37: it goes toward the bill, not a bank fee)
  var W2 = await wireFor('vendor', 'Trinity Logistics', [{ bill_id: V1, amount: 1000 }]);
  await approve(W2); await send(W2, '2026-11-09');
  bankLine('2026-11-11', 1025, 'WIRE OUT TRINITY + FEE');
  var m2 = await call(wires, 'u1', { action: 'match_now', id: W2 });
  check('4a: the bank line is $25 more (extra charge) → still matched by itself; the extra is kept on the wire', m2.ok && m2.matched && pkg(W2).status === 'attached' && pkg(W2).bank_fee === 25 && (await billRow(V1)).status === 'PAID', { m2: m2, fee: pkg(W2).bank_fee });
  check('4b: the payment is the bill amount ($1,000), not the bank amount; a vendor wire’s bank line is NOT filed as professional fees', paysOf(V1).length === 1 && paysOf(V1)[0].amount === 1000 && paysOf(V1)[0].method === 'wire' && hist('bank_line_filed_professional_fees').length === 1);
  // ── 5. two bank lines fit → the Hub never guesses
  var W3 = await wireFor('vendor', 'AMB Logistic', [{ bill_id: V2, amount: 500 }]);
  await approve(W3); await send(W3, '2026-11-09');
  bankLine('2026-11-10', 500, 'WIRE OUT A'); bankLine('2026-11-12', 500, 'WIRE OUT B');
  var m3 = await call(wires, 'u1', { action: 'match_now', id: W3 });
  var c3 = await call(wires, 'u1', { action: 'bank_candidates', id: W3 });
  check('5a: two $500 lines → nothing attached; both listed for a person to pick', m3.ok && !m3.matched && m3.result.ambiguous.length === 1 && pkg(W3).status === 'sent' && c3.candidates.length === 2, { m3: m3, c: c3.candidates });
  var at3 = await call(wires, 'u1', { action: 'attach', id: W3, bank_transaction_id: c3.candidates[1].id });
  check('5b: the person picks one → attached; PAID', at3.ok && pkg(W3).status === 'attached' && (await billRow(V2)).status === 'PAID', at3);
  // ── 6. more than the accepted extra → only the super admin with a reason
  // realigned v55.83-SB (Max Nov 12 09:31: "within like $50 or within $100, then do it") — the limit is $100 now, so this case uses $180 over
  var W4 = await wireFor('vendor', 'Old Truck Co', [{ bill_id: V3, amount: 700 }]);
  await approve(W4); await send(W4, '2026-11-09');
  var bt4 = bankLine('2026-11-10', 880, 'WIRE OUT OLD TRUCK');
  var m4 = await call(wires, 'u1', { action: 'match_now', id: W4 });
  check('6a: $180 over is not matched by itself', m4.ok && !m4.matched && pkg(W4).status === 'sent', m4);
  var a4 = await call(wires, 'u1', { action: 'attach', id: W4, bank_transaction_id: bt4.id });
  check('6b: a preparer attaching it is refused — more than a $100 extra charge', !a4.ok && /More than a \$100 extra charge/.test(a4.error), a4);
  var a5 = await call(wires, 'u9', { action: 'attach', id: W4, bank_transaction_id: bt4.id, override_note: 'bank charged $180 intermediary fee — confirmed with Chase' });
  check('6c: the super admin can, with the reason', a5.ok && pkg(W4).status === 'attached' && (await billRow(V3)).status === 'PAID', a5);
  // ── 7. wrong sent date → correct it → found
  var W5 = await wireFor('vendor', 'Late Date Co', [{ bill_id: V4, amount: 900 }]);
  await approve(W5); await send(W5, '2026-10-01');
  bankLine('2026-10-20', 900, 'WIRE OUT LATE DATE');
  var m5 = await call(wires, 'u1', { action: 'match_now', id: W5 });
  check('7a: sent date 2026-10-01 but the bank line is 2026-10-20 → not found (a week after, at most)', m5.ok && !m5.matched && pkg(W5).status === 'sent', m5);
  var d0 = await call(wires, 'u1', { action: 'set_sent_date', id: W5, sent_date: '2026-10-19', reason: '' });
  check('7b: changing the date needs a reason', !d0.ok && /Say why the date changes/.test(d0.error), d0);
  var d1 = await call(wires, 'u1', { action: 'set_sent_date', id: W5, sent_date: '2026-10-19', reason: 'bank sent it on the 19th' });
  check('7c: date corrected → the Hub looks again → found → PAID; the change is in the history', d1.ok && d1.matched && pkg(W5).status === 'attached' && (await billRow(V4)).status === 'PAID' && hist('wire_sent_date_changed').length === 1 && hist('wire_sent_date_changed')[0].details.from === '2026-10-01', d1);
  // ── 8. a wire sent BEFORE the Hub had wires (retroactive) — super admin only
  var btP = bankLine('2026-06-15', 1750, 'WIRE OUT RTM JUNE');
  var p0 = await call(wires, 'u1', { action: 'record_past_wire', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: P1, amount: 1200 }], sent_date: '2026-06-14', reason: 'June wire to RTM for NexPac 13001' });
  check('8a: only the super admin records a past wire (it has no signatures)', !p0.ok && /super admin/.test(p0.error), p0);
  var p1 = await call(wires, 'u9', { action: 'record_past_wire', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: P1, amount: 1200 }], sent_date: '2026-06-14', reason: 'June' });
  check('8b: a reason of at least 10 characters is required', !p1.ok && /at least 10 characters/.test(p1.error), p1);
  var p2 = await call(wires, 'u9', { action: 'record_past_wire', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: P1, amount: 1300 }], sent_date: '2026-06-14', reason: 'June wire to RTM for NexPac 13001 + 13002' });
  check('8c: more than a bill’s open amount is refused', !p2.ok && /only \$1200\.00 is still open/.test(p2.error) && db.t.wire_packages.length === 5, p2);
  var p3 = await call(wires, 'u9', { action: 'record_past_wire', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: P1, amount: 1200 }, { bill_id: P2, amount: 550 }], sent_date: '2026-06-14', reason: 'June wire to RTM for NexPac 13001 + 13002 (part)' });
  var pp = pkg(p3.id) || {};
  check('8d: recorded (bills that were never validated are allowed — they were paid before validation existed) → found in the bank → attached', p3.ok && p3.matched && pp.after_the_fact === true && /June wire/.test(pp.after_the_fact_note) && pp.status === 'attached' && pp.bank_transaction_id === btP.id, { p3: p3, st: pp.status });
  var rP1 = await billRow(P1); var rP2 = await billRow(P2);
  check('8e: 13001 PAID; 13002 PARTIAL ($550 of $800); both paid on the bank date', rP1.status === 'PAID' && rP2.status === 'PARTIAL' && rP2.open === 250 && paysOf(P2)[0].paid_date === '2026-06-15', { p1: rP1.status, p2: rP2.status, open: rP2.open });
  check('8f: the history keeps who recorded it, the reason and the bills', hist('wire_recorded_after_the_fact').length === 1 && hist('wire_recorded_after_the_fact')[0].actor_id === 'u9' && hist('wire_recorded_after_the_fact')[0].details.bills.length === 2);
  var ob = await call(wires, 'u1', { action: 'open_bills', payee_kind: 'service_provider', payee_name: 'RTM Capital', past: true });
  check('8g: the "past" bill list is the super admin’s only (others get the validated list as before)', ob.ok && !(ob.bills || []).some(function (b) { return b.validation_status !== 'validated'; }), (ob.bills || []).map(function (b) { return b.bill_number + ':' + b.validation_status; }));
  // ── 9. the pure state helper
  var st = WS.billWireStates([{ id: 'p', seq: 7, status: 'sent', payee_name: 'RTM Capital', sent_date: '2026-11-01' }], [{ id: 'l', package_id: 'p', bill_id: 'b', amount: 10, is_open: true }], {});
  check('9a: helper: a sent wire → SENT; closed lines show nothing', st.b && st.b.state === 'sent' && /^SENT · WP-0007/.test(WS.wireStateWords(st.b, 10)) && !WS.billWireStates([{ id: 'p', seq: 7, status: 'sent' }], [{ id: 'l', package_id: 'p', bill_id: 'b', amount: 10, is_open: false }], {}).b, WS.wireStateWords(st.b, 10));
  // ── 10. the bank feeds run the matcher; the screens; the SQL
  var PT = R('src/app/api/plaid/transactions/route.js'); var SI = R('src/app/api/accounting/statement-import/route.js');
  check('10a: every bank sync and every statement import runs the matcher (fail-soft — never breaks the import)', /* SF: 4 s budget + maxDuration 60 on the bank sync */ PT.indexOf("wireMatch = await autoMatchSentWires(supabase, { actorId: null, budgetMs: 4000 })") > 0 && PT.indexOf('export var maxDuration = 60;') > 0 && PT.indexOf('catch (eWM)') > 0 &&
    SI.indexOf("wireM = await autoMatchSentWires(d, { actorId: userId, budgetMs: 10000 })") > 0);
  var U = R('src/components/WirePackagesPanel.jsx'); var BT = R('src/components/BillsTab.jsx');
  check('10b: wire screen: 🔎 Look in the bank now, 📅 change the sent date, 🕘 Record a past wire (super admin), the extra shown as "extra charge (accepted)"',
    U.indexOf('🔎 Look in the bank now') > 0 && U.indexOf('📅 Wrong date? Change the sent date') > 0 && U.indexOf("{perms.superAdmin && <Btn light onClick={startPast} disabled={busy}>🕘 Record a past wire</Btn>}") > 0 && U.indexOf("' extra charge (accepted)'") > 0 && U.indexOf('booked with the bill it paid') > 0);
  check('10c: after both signatures the delete button is the super admin’s; others are told why (not a silent missing button)', U.indexOf('Both signatures are in — only the super admin can delete or cancel it now.') > 0 && U.indexOf("(st !== 'ready_to_send' || perms.superAdmin)") > 0);
  check('10d: bills screen shows READY / SENT with the wire, the payee and the part amount', BT.indexOf('function wireChip(b)') > 0 && BT.indexOf("' · part: $' + fmt(w.amount) + ' of $' + fmt(b.open)") > 0);
  var SQ = R('sql/v55-83-RZ-wire-ready-sent-paid.sql');
  check('10e: SQL: past wires need a note; extra 0–50 and frozen once attached; ClickBooks books a vendor wire’s extra WITH THE BILL (its category), never "Bank fee" (Max 16:37)',
    SQ.indexOf('after_the_fact') > 0 && SQ.indexOf("clickbooks_us.wire_fee_cents(p_txn) > 0") > 0 && SQ.indexOf("select clickbooks_us.category_account(p_book, vb.category) into rest_acct") > 0 && SQ.indexOf("category_account(p_book, 'bank_fee')") < 0);
  var WA = R('src/lib/wire-auto-match.js');
  var two = WA.indexOf('if (hits.length !== 1) { return null; }') > 0 && WA.indexOf(".is('classification', null)") > 0;
  check('10f: professional fees only when the line has no category and exactly ONE category is named professional — never overwrites, never guesses', two);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
