// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SB — the bug review of Nov 12 (bills / wires / bank matching) and Max's answers, 09:31:
//  "Number 2 is yes. Number 3 is 2 hours. ... Number 1 ... if it matches the selection and of the amount within like $50 or
//   within $100, then do it, okay? And it should also still have the option of being manually overridden and matched as it
//   should, or ... manually selected and matched as well."
// Fixed: (1) the matcher took ANY single money-out of the right amount; (2) two wires of one amount raced for one bank line;
// (3) two matchers at once corrupted the wire's lines; (4) past wires: wrong payee / future date; (5) undo a sent wire =
// super admin only; (7) paging. Bank sync every 2 hours. REAL routes on an in-memory DB.
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
function id(n) { return 'bd100000-0000-0000-0000-' + String(n).padStart(12, '0'); }
function nb(n, vendor, amt, extra) { return Object.assign({ id: id(n), vendor_name: vendor, bill_number: 'B' + n, bill_date: '2026-11-01', total_amount: amt, record_status: 'active', validation_status: 'validated', bill_type: 'supplier', shipment_direction: 'inbound', other_reference: 'REF-' + n, paid_via: null }, extra || {}); }
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }, { id: 'u8', name: 'Owner', role: 'owner', active: true }, { id: 'u9', name: 'Max', role: 'super_admin', active: true }],
  module_permissions: [].concat(['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [nb(1, 'Alpha Freight', 1000), nb(2, 'Beta Freight', 1000), nb(3, 'Gamma Freight', 700), nb(4, 'Delta Freight', 600), nb(5, 'Epsilon Freight', 450), nb(6, 'Zeta Freight', 300),
    nb(7, 'NexPac Corporation', 900, { validation_status: null, paid_via: 'NextTrade' })],
  vendor_bill_lines: [], vendor_bill_payments: [], vendor_bill_events: [], hub_audit_log: [], expense_categories: [],
  wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], wire_bill_reviews: [], expense_rules: [],
  paid_through_parties: [{ name: 'RTM Capital', kind: 'service_provider', active: true }], bank_transactions: [], bill_commission_rules: [], bill_price_rules: [],
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var wires = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var WA = require(path.join(root, 'src/lib/wire-auto-match.js'));
async function call(user, body) { var res = await wires.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
var pkg = function (i) { return db.t.wire_packages.filter(function (x) { return x.id === i; })[0]; };
var pays = function (n) { return db.t.vendor_bill_payments.filter(function (p) { return p.bill_id === id(n) && p.voided !== true; }); };
var seq = 0;
function bankLine(date, amt, name, extra) { seq++; var t = Object.assign({ id: 'b7100000-0000-0000-0000-' + String(seq).padStart(12, '0'), date: date, posted_date: date, amount_abs: amt, direction: 'out', pending: false, wave_business_id: US, review_status: null, name: name, merchant_name: null, third_party_payer: null }, extra || {}); db.t.bank_transactions.push(t); return t; }
async function sentWire(n, vendor, amt) {
  var s = await call('u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: vendor, lines: [{ bill_id: id(n), amount: amt }] });
  if (!s.ok) { console.log('save_draft', JSON.stringify(s).substring(0, 300)); }
  await call('u1', { action: 'review_bill', id: s.id, bill_id: id(n) }); await call('u2', { action: 'review_bill', id: s.id, bill_id: id(n) });
  await call('u1', { action: 'signoff', id: s.id, note: 'checked every bill against the orders' }); await call('u2', { action: 'signoff', id: s.id, note: 'second check — matches' });
  var m = await call('u1', { action: 'mark_sent', id: s.id, sent_date: '2026-11-09', bank_reference: 'FED-' + n, proof_path: 'pv/wire-' + s.id + '-conf.pdf', proof_name: 'conf.pdf' });
  if (!m.ok) { console.log('mark_sent', JSON.stringify(m).substring(0, 300)); }
  return s.id;
}
console.log('SB — the matcher only takes a line it can be sure of; everything else is picked by hand');
(async function () {
  // ── 1. two wires of the SAME amount, one bank line → the Hub does not choose
  var WA1 = await sentWire(1, 'Alpha Freight', 1000); var WB1 = await sentWire(2, 'Beta Freight', 1000);
  var l1 = bankLine('2026-11-10', 1000, 'FEDWIRE OUT');
  var m1 = await WA.autoMatchSentWires(db, { actorId: null });
  check('1a: two sent wires of $1,000 and one $1,000 bank line → neither is matched; both are listed with the reason', m1.matched.length === 0 && m1.ambiguous.length === 2 && /another sent wire of the same amount/.test(m1.ambiguous[0].why) && pkg(WA1).status === 'sent' && pkg(WB1).status === 'sent', m1);
  var p1 = await call('u1', { action: 'attach', id: WB1, bank_transaction_id: l1.id });
  check('1b: a person picks it for the right wire by hand (Max: "manually selected and matched") → PAID', p1.ok && pkg(WB1).status === 'attached' && pays(2).length === 1 && pays(1).length === 0, p1);
  var l1b = bankLine('2026-11-11', 1000, 'FEDWIRE OUT 2');
  var m1b = await WA.autoMatchSentWires(db, { actorId: null });
  check('1c: once only one wire is left for the next $1,000 line, it is matched by itself', m1b.matched.length === 1 && pkg(WA1).status === 'attached' && pkg(WA1).bank_transaction_id === l1b.id, m1b);
  // ── 2. the only line that fits is NOT a wire and not exact → listed, not matched
  var W3 = await sentWire(3, 'Gamma Freight', 700);
  var l3 = bankLine('2026-11-10', 730, 'AMEX EPAYMENT ACH');
  var m3 = await WA.autoMatchSentWires(db, { actorId: null });
  check('2a: a $730 card payment near a $700 wire is NOT taken as the wire', m3.matched.length === 0 && pkg(W3).status === 'sent' && m3.ambiguous.some(function (a) { return /does not read like a wire/.test(a.why); }), m3);
  var c3 = await call('u1', { action: 'bank_candidates', id: W3 });
  check('2b: …but it is still offered, and a person may pick it (within $100)', c3.ok && c3.candidates.length === 1 && c3.candidates[0].id === l3.id && c3.auto_fee_max === 100, c3);
  var l3w = bankLine('2026-11-11', 775, 'WIRE OUT GAMMA FREIGHT');
  var m3b = await WA.autoMatchSentWires(db, { actorId: null });
  check('2c: two lines fit now → still a person’s pick (never guessed)', m3b.matched.length === 0 && pkg(W3).status === 'sent', m3b);
  var p3 = await call('u1', { action: 'attach', id: W3, bank_transaction_id: l3w.id });
  check('2d: picked by hand: $75 over is accepted (up to $100) and kept as the extra charge', p3.ok && pkg(W3).bank_fee === 75 && pays(3)[0].amount === 700, p3);
  // ── 3. a wire-looking line up to $100 over → matched by itself (Max: "within like $50 or within $100, then do it")
  var W4 = await sentWire(4, 'Delta Freight', 600);
  bankLine('2026-11-10', 690, 'WIRE TRANSFER OUT DELTA');
  var m4 = await WA.autoMatchSentWires(db, { actorId: null });
  check('3a: a WIRE line $90 over → matched by itself, $90 kept as the extra charge', m4.matched.length === 1 && pkg(W4).status === 'attached' && pkg(W4).bank_fee === 90 && pkg(W4).matched_auto === true, m4);
  // ── 4. a line whose category a person VERIFIED is never taken by the Hub
  var W5 = await sentWire(5, 'Epsilon Freight', 450);
  var l5 = bankLine('2026-11-10', 450, 'CHECK 1042', { category_verified: true, classification: 'rent' });
  var m5 = await WA.autoMatchSentWires(db, { actorId: null });
  check('4a: exact amount, but a person verified that line as something else → not matched by the Hub', m5.matched.length === 0 && pkg(W5).status === 'sent' && m5.ambiguous.some(function (a) { return /already verified/.test(a.why); }), m5);
  // ── 5. two matchers in the same second: the second one writes NOTHING
  var W6 = await sentWire(6, 'Zeta Freight', 300);
  var l6 = bankLine('2026-11-10', 300, 'WIRE OUT ZETA');
  var stale = Object.assign({}, pkg(W6));                       // what the second matcher read a moment ago
  var first = await WA.attachWire(db, pkg(W6), l6, null, { auto: true });
  var second = await WA.attachWire(db, stale, l6, null, { auto: true });
  var openLines = db.t.wire_package_lines.filter(function (l) { return l.package_id === W6 && l.is_open; });
  check('5a: the first attaches; the second is refused before writing — one payment, the wire’s lines stay closed', first.ok && !second.ok && db.t.vendor_bill_payments.filter(function (p) { return p.bill_id === id(6); }).length === 1 && openLines.length === 0 && pkg(W6).status === 'attached', { first: first, second: second, open: openLines.length });
  var SRC = R('src/lib/wire-auto-match.js');
  check('5b: the wire is CLAIMED (one conditional update) before any payment is written, and released if anything fails', SRC.indexOf(".eq('status', 'sent').is('bank_transaction_id', null).select('id')") > 0 && SRC.indexOf('var claim = await') < SRC.indexOf("from('vendor_bill_payments').insert(") && (SRC.match(/await release\(\);/g) || []).length === 2);
  // ── 6. undo a SENT wire: the super admin only (Max: "Number 2 is yes")
  var u8 = await call('u8', { action: 'delete_wire', id: W5, reason: 'sent by mistake — bank recalled it' });
  check('6a: the owner can no longer undo a sent wire', !u8.ok && /only be undone by the super admin/.test(u8.error) && pkg(W5).status === 'sent', u8);
  var u9 = await call('u9', { action: 'delete_wire', id: W5, reason: 'sent by mistake — bank recalled it' });
  check('6b: the super admin can', u9.ok && pkg(W5).status === 'reversed', u9);
  // ── 7. recording a past wire: right party, not a future date
  var pf = await call('u9', { action: 'record_past_wire', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: id(7), amount: 900 }], sent_date: '2099-01-01', reason: 'June wire to RTM for NexPac B7' });
  check('7a: a future date is refused', !pf.ok && /in the future/.test(pf.error), pf);
  var pw = await call('u9', { action: 'record_past_wire', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: id(7), amount: 900 }], sent_date: '2026-06-14', reason: 'June wire to RTM for NexPac B7' });
  check('7b: a bill paid through NextTrade cannot go on an RTM Capital wire', !pw.ok && /is paid through NextTrade, not RTM Capital/.test(pw.error) && !db.t.wire_packages.some(function (p) { return p.after_the_fact; }), pw);
  // ── 8. the rest
  check('8a: the bank is read every 2 hours (Max: "Number 3 is 2 hours")', /"path": "\/api\/plaid\/sync",\s*"schedule": "0 \*\/2 \* \* \*"/.test(R('vercel.json')));
  check('8b: the extra charge may be up to $100 in the database too', R('sql/v55-83-RZ-wire-ready-sent-paid.sql').indexOf('CHECK (bank_fee >= 0 AND bank_fee <= 100)') > 0 && WA.AUTO_FEE_MAX === 100);
  check('8c: the READY / SENT status on the bills list reads every open wire line (paged)', R('src/app/api/accounting/bills/route.js').indexOf("var wlRows = await fetchAll(function () { return db.from('wire_package_lines').select('*').eq('is_open', true); });") > 0);
  var U = R('src/components/WirePackagesPanel.jsx');
  check('8d: the wire screen says why the Hub did not match it and that you can always pick the line yourself', U.indexOf("'Not matched by itself: ' + (r.ambiguous[0].why") > 0 && U.indexOf('You can always pick the line yourself below.') > 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
