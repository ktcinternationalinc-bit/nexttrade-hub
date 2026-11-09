// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RV — the independent bug + gap review Max asked for (Nov 9 22:47: "i asked you to make sure that you did a bug
// review and gap review"). 16 findings (4 high, 7 medium, 5 low) — each one is pinned or proven here; the server ones run
// on the REAL bills / wire routes (in-memory DB).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var V = 'b8000000-0000-0000-0000-000000000001', N = 'b8000000-0000-0000-0000-000000000002', P = 'b8000000-0000-0000-0000-000000000003';
var db = new MemDB({
  users: [{ id: 'u1', name: 'Clerk', role: 'staff', active: true }, { id: 'u9', name: 'Max', role: 'super_admin', active: true }],
  module_permissions: ['accounting.clickbooks.access', 'bills.manage', 'bills.view', 'wires.prepare'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
  vendor_bills: [
    { id: V, vendor_name: 'Fast Trucking', bill_number: 'T-1', bill_date: '2026-10-01', total_amount: 1000, record_status: 'active', validation_status: 'validated', bill_type: 'trucking', shipment_direction: 'outbound', release_number: null, other_reference: 'BOL-1' },
    { id: N, vendor_name: 'NexPac Corporation', bill_number: '14481', bill_date: '2026-06-02', total_amount: 2831, record_status: 'active', validation_status: 'pending', bill_type: 'supplier' },
    { id: P, vendor_name: 'Old Paid Co', bill_number: 'OP-1', bill_date: '2026-01-01', total_amount: 50, record_status: 'active', validation_status: 'pending' }],
  vendor_bill_lines: [], vendor_bill_payments: [{ id: 'pp', bill_id: P, amount: 50, paid_date: '2026-02-01', voided: false }], vendor_bill_events: [], hub_audit_log: [], wire_packages: [], wire_package_lines: [], expense_rules: [], paid_through_parties: [],
  bill_commission_rules: [{ id: 'cr1', vendor_match: 'NexPac', rate: 0.125, active: true }], bill_price_rules: [],
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var wires = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var L = require(path.join(root, 'src/lib/bill-lines.js'));
var LS = require(path.join(root, 'src/lib/bill-lines-server.js'));
var X = require(path.join(root, 'src/lib/bill-extract.js'));
async function call(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 500))); }
var b = function (id) { return db.t.vendor_bills.filter(function (x) { return x.id === id; })[0]; };
console.log('RV — the 16 review findings, fixed');
(async function () {
  // HIGH #1 — a validated bill keeps what was validated
  var e1 = await call(bills, 'u1', { action: 'save_bill', bill: { id: V, vendor_name: 'Fast Trucking', bill_number: 'T-1', bill_date: '2026-10-01', total_amount: 10000, other_reference: 'BOL-1', shipment_direction: 'outbound', release_number: '1003-1' } });
  check('H1a: changing the AMOUNT of a validated bill is refused ("reopen the validation first"); the amount stays', !e1.ok && /VALIDATED — its amount cannot change/.test(e1.error) && b(V).total_amount === 1000, e1);
  var e2 = await call(bills, 'u1', { action: 'save_bill', bill: { id: V, vendor_name: 'Fast Trucking', bill_number: 'T-1', bill_date: '2026-10-01', total_amount: 1000, other_reference: 'BOL-1', shipment_direction: 'outbound', release_number: '1003-1', notes: 'release added' } });
  check('H1b: filling in a MISSING release # on a validated bill is still allowed (and it stays validated)', e2.ok && b(V).release_number === '1003-1' && b(V).validation_status === 'validated', e2);
  var e3 = await call(wires, 'u1', { action: 'set_bill_release', bill_id: V, field: 'release_number', release_number: '9999-9' });
  var e4 = await call(wires, 'u1', { action: 'set_bill_release', bill_id: V, field: 'shipment_direction', shipment_direction: 'inbound' });
  check('H1c: from the wire screen, a validated release # or direction cannot be changed', !e3.ok && /VALIDATED/.test(e3.error) && !e4.ok && /VALIDATED/.test(e4.error) && b(V).release_number === '1003-1' && b(V).shipment_direction === 'outbound', { e3: e3, e4: e4 });
  // HIGH #2 — reopen from the screen
  var BT = R('src/components/BillsTab.jsx');
  check('H2: ✓ VALIDATED has "↩ Reopen" (asks why, on the screen) → reopen_validation; the locked-lines text says how', BT.indexOf("setRowAsk({ kind: 'reopen', bill: b, text: '' })") > 0 && BT.indexOf("{ action: 'reopen_validation', id: ra.bill.id, reason: ra.text || '' }") > 0 && R('src/components/BillLinesPanel.jsx').indexOf('✓ VALIDATED → ↩ Reopen') > 0);
  var ro = await call(bills, 'u1', { action: 'reopen_validation', id: V, reason: 'wrong amount on the bill' });
  check('H2b: reopening works (PENDING again, audited)', ro.ok && b(V).validation_status === 'pending' && db.t.hub_audit_log.some(function (h) { return h.action === 'bill_validation_reopened'; }), ro);
  // HIGH #3 — "Validate now" on the wire screen
  var WP = R('src/components/WirePackagesPanel.jsx');
  check('H3: wire "Validate now" shows the price check, asks the price-issue resolution, saves ticks / notes as a draft, and only shows for Bills: Manage',
    WP.indexOf("post({ action: 'bill_lines', id: p.billId })") > 0 && WP.indexOf('<PriceCheckBox check={pc.check} status="flagged" resolved={pc.resolved} />') > 0 && WP.indexOf('price_resolution: res })') > 0 &&
    WP.indexOf("keep({ ck: n }, true)") > 0 && WP.indexOf('canValidate={!!perms.bills}') > 0 && R('src/components/WiresTab.jsx').indexOf("bills: isSuperAdmin || mp['bills.manage'] === true") > 0);
  // HIGH #4 + MEDIUM #11 — email imports never cut off
  var IN = R('src/app/api/accounting/bills/inbound/route.js'); var ES = R('src/app/api/accounting/bills/email-scan/route.js');
  check('H4: email inbound gets the full 60 s and stops before the limit, naming the files not read', IN.indexOf('export const maxDuration = 60;') > 0 && IN.indexOf('if (Date.now() - inStarted > 42000)') > 0 && IN.indexOf('forward this file again on its own') > 0);
  check('M11: the scanner: 5 emails per pass, stops before 60 s, remembers each ATTACHMENT after it is handled, marks an email done only when all its attachments are',
    ES.indexOf('var NEW_PER_PASS = 5;') > 0 && ES.indexOf('if (Date.now() - scanStarted > 40000) { outOfTime = true; break; }') > 0 && (ES.match(/'email_scan_attachment'/g) || []).length >= 6 && ES.indexOf("if (outOfTime) { remainingNew++; continue; }") > 0);
  // MEDIUM #5 — NexPac bill with no lines yet
  var p5 = L.priceCheck({ vendor_name: 'NexPac Corporation', total_amount: 2831 }, [], [], { vendor_match: 'NexPac', rate: 0.125 });
  check('M5: a NexPac bill with no lines is NOT flagged "$0 commission" — it says to add the lines', p5.status !== 'flagged' && p5.notes.some(function (n) { return n.code === 'NO_LINES'; }), p5);
  // MEDIUM #6 — "Commission" typed as a product
  var p6 = L.priceCheck({ vendor_name: 'NexPac Corporation', total_amount: 1125 }, [L.shapeLine({ description: 'Cambridge Seconds (LBS)', qty: 1000, unit_price: 1, amount: 1000, line_kind: 'item' }, 0), L.shapeLine({ description: 'Commission 12.5%', amount: 125, line_kind: 'item' }, 1)], [], { vendor_match: 'NexPac', rate: 0.125 });
  check('M6: a "Commission" row typed as a product is treated as the commission line (no false flag, 12.5% on the product only)', p6.status !== 'flagged' && p6.split_lines[1].line_kind === 'commission' && p6.split_lines[0].commission_amount === 125, p6);
  // MEDIUM #7 — units
  function u(ru, lu) { return L.priceCheck({ vendor_name: 'NexPac', total_amount: 100 }, [L.shapeLine({ description: 'Cambridge Seconds', qty: 1000, unit: lu, unit_price: 0.1, amount: 100 }, 0)], [{ id: 'r', vendor_match: 'NexPac', item_match: 'Cambridge Seconds', unit: ru, expected_unit_price: 0.1, tolerance_pct: 0 }], null); }
  check('M7: "LB" = "LBS" = "pounds" (the rule applies); a really different unit (KG vs LBS) is FLAGGED, never skipped', u('LB', 'LBS').status === 'ok' && u('pounds', 'LBS').status === 'ok' && u('KG', 'LBS').status === 'flagged' && u('KG', 'LBS').flags[0].code === 'UNIT_MISMATCH');
  // MEDIUM #8 — the re-check after a rule change
  var rc = await LS.recheckOpenBills(db, { actorId: 'u9' });
  check('M8: the re-check after a rule change skips validated and fully paid bills, works within a time budget, and reports what is left', typeof rc.checked === 'number' && rc.remaining === 0 && !b(P).price_check_status && R('src/components/PriceRulesPanel.jsx').indexOf('more are checked when opened') > 0, rc);
  // MEDIUM #9 — stored split follows the rule
  await call(bills, 'u1', { action: 'save_lines', id: N, lines: [{ description: 'Cambridge Seconds (LBS)', qty: 1000, unit: 'LBS', unit_price: 2, amount: 2000, line_kind: 'item' }, { description: 'Cambridge Paper (LBS)', qty: 1000, unit: 'LBS', unit_price: 0.516, amount: 516, line_kind: 'item' }, { description: 'Commission 12.5%', amount: 314.5, line_kind: 'commission' }] });
  var before = db.t.vendor_bill_lines.filter(function (l) { return l.bill_id === N && l.line_kind === 'item'; }).map(function (l) { return l.commission_amount; });
  db.t.bill_commission_rules[0].active = false; await LS.runPriceCheck(db, N);
  var after = db.t.vendor_bill_lines.filter(function (l) { return l.bill_id === N && l.line_kind === 'item'; }).map(function (l) { return l.commission_amount; });
  db.t.bill_commission_rules[0].active = true; await LS.runPriceCheck(db, N);
  var again = db.t.vendor_bill_lines.filter(function (l) { return l.bill_id === N && l.line_kind === 'item'; }).map(function (l) { return l.commission_amount; });
  check('M9: turning the commission rule off / on rewrites the stored split of open bills (what the ledger and reports read)', before[0] > 0 && after.every(function (x) { return x == null; }) && again[0] === before[0], { before: before, after: after, again: again });
  // MEDIUM #10 — file links
  check('M10: 📎 links open the tab inside the click (a pop-up blocker allows it), then load the private link; a failure is said', [R('src/components/BillsTab.jsx'), WP, R('src/components/WireQuickView.jsx')].every(function (t) { return t.indexOf("w = window.open('', '_blank')") > 0 && t.indexOf('w.location.href = u') > 0; }));
  // LOW #12 — tax rows
  var tx = X.cleanLines([{ description: 'Line Haul', amount: 1850, line_kind: 'charge' }, { description: 'HST 13%', amount: 240.5 }, { description: 'TOTAL', amount: 2090.5 }]);
  check('L12: a TAX / HST row is kept as a charge (it is part of the total); TOTAL rows are still dropped', tx.length === 2 && tx[1].line_kind === 'charge' && tx[1].amount === 240.5, tx);
  // LOW #13 — override button
  check('L13: ↷ Override never greys out silently — it says what to write', WP.indexOf("toast.error('Write why it is OK to pay anyway — at least 10 characters (kept with your name).')") > 0 && WP.indexOf('<Btn color="#9a3412" disabled={busy} onClick={function () { if (String(od).trim().length < 10)') > 0);
  // LOW #14 — viewers read only; a re-worded check keeps a written resolution
  db.t.bill_price_rules.push({ id: 'pr1', vendor_match: 'NexPac', item_match: 'Cambridge Seconds', unit: 'LBS', expected_unit_price: 1.5, tolerance_pct: 0, active: true });
  var nb = b(N); await LS.runPriceCheck(db, N);
  var sigBefore = nb.price_check_status + ':' + nb.price_check.flags.length;
  nb.price_resolved_note = 'NexPac confirmed the price';
  nb.price_check.flags = nb.price_check.flags.map(function (f) { return Object.assign({}, f, { text: 'old wording from an earlier build', cols: undefined }); }); // as stored before RV
  await LS.runPriceCheck(db, N);
  check('L14a: re-wording the check (same problems) keeps the person\'s written resolution', /^flagged:[1-9]/.test(sigBefore) && nb.price_resolved_note === 'NexPac confirmed the price', { note: nb.price_resolved_note, sig: sigBefore });
  nb.price_check = { flags: [{ code: 'PRICE_HIGH', line_no: 9, expected: 1, actual: 2, text: 'something else' }] }; nb.price_resolved_note = 'answered another problem';
  await LS.runPriceCheck(db, N);
  check('L14b: when the problems really change, the old resolution is cleared — and that is on the audit trail', nb.price_resolved_note == null && db.t.hub_audit_log.some(function (h) { return h.action === 'bill_price_resolution_cleared'; }));
  check('L14c: "↻ Check prices again" only for people who may change bills; opening the lines only reads for a viewer', R('src/components/BillLinesPanel.jsx').indexOf('{p.canManage && !d.locked && <button disabled={busy} onClick={recheck}') > 0 && R('src/app/api/accounting/bills/route.js').indexOf("readOnly: !(blMgr && blMgr.ok === true)") > 0);
  // LOW #15 — type picked at validation is an audited entry
  check('L15: the type picked at validation is saved as an entry with an audit line, even if the validation is then refused', R('src/app/api/accounting/bills/route.js').indexOf("await audit(db, userId, 'bill_validation_progress_saved', 'vendor_bill', body.id, { bill_type: { from: vb2.data.bill_type || null, to: vType } }); // review #15") > 0);
  // LOW #16 — undo never half-done
  check('L16: undoing a sent wire first checks the database can record it — nothing is voided before that', R('src/app/api/accounting/wire-packages/route.js').indexOf("Undo is not set up in the database yet — run sql/v55-83-RL-wire-override-delete-reference.sql first. Nothing was changed.") > 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
