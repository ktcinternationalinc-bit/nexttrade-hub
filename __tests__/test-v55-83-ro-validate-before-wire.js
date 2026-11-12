// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RO — Max, Nov 9:
//  20:49 "work flow should show that validation needs to take place first
//         before wiring. with validation after i select all and mark save...it
//         does NOT save...you cannot pay a wire unless it has been validated"
//  20:50 "i need to be able to delete a wire that is in progress..."
//  20:54 "we need to know whether a bill is for inbound or outbound and it should
//         be marked during validation. and only validated bills should be
//         displayed for the bills that can be wired in the wired section"
// The REAL wire + bills routes run on an in-memory database.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var B1 = 'b2000000-0000-0000-0000-000000000001', B2 = 'b2000000-0000-0000-0000-000000000002', B3 = 'b2000000-0000-0000-0000-000000000003';
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }, { id: 'u9', name: 'Max', role: 'super_admin', active: true }],
  module_permissions: [].concat(
    ['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send', 'wires.override', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [
    { id: B1, vendor_name: 'Fast Trucking', bill_number: 'T-1', release_number: '1003-001', total_amount: 1000, record_status: 'active', paid_via: null, bill_date: '2026-10-01', shipment_direction: null, validation_status: null },
    { id: B2, vendor_name: 'Ocean Line', bill_number: 'O-7', release_number: '1003-002', total_amount: 500, record_status: 'active', paid_via: null, bill_date: '2026-10-02', shipment_direction: 'outbound', validation_status: 'validated' },
    { id: B3, vendor_name: 'Port Fees', bill_number: 'P-3', release_number: '1003-003', total_amount: 80, record_status: 'active', paid_via: null, bill_date: '2026-10-03', shipment_direction: 'outbound', validation_status: 'validated' },
  ],
  vendor_bill_payments: [], vendor_bill_events: [], wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], hub_audit_log: [], paid_through_parties: [], bank_transactions: [],
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var route = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var W = require(path.join(root, 'src/lib/wire-audit.js'));
// superseded (v55.83-RY, Max Nov 10 00:11: "view each bill and close the bill as you check before you approve it and sign it"):
// a signer must open + check every bill of the wire first — the sign-off calls below do that, like a person would
async function call(r, user, body) {
  if (body && body.action === 'signoff' && r.POST) {
    var gq = await callRaw(r, user, { action: 'get', id: body.id });
    if (gq && gq.ok) { for (var qi = 0; qi < gq.lines.length; qi++) { await callRaw(r, user, { action: 'review_bill', id: body.id, bill_id: gq.lines[qi].bill_id }); } }
  }
  return callRaw(r, user, body);
}
async function callRaw(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 500))); }
function hist(a) { return db.t.hub_audit_log.filter(function (h) { return h.action === a; }); }
var CK = { matches_records: true, goods_received: true, charges_accurate: true };
console.log('RO — validate first, then wire; delete a wire in progress');
(async function () {
  // ── 1. "only validated bills should be displayed for the bills that can be wired"
  var ob = await call(route, 'u1', { action: 'open_bills', payee_kind: 'service_provider', payee_name: 'RTM Capital' });
  check('1a: the wire picker lists ONLY validated bills; the unvalidated one is counted apart ("waiting for validation")',
    ob.ok && ob.bills.map(function (b) { return b.id; }).sort().join() === [B2, B3].sort().join() && ob.not_validated.length === 1 && ob.not_validated[0].id === B1, ob);
  var sv0 = await call(route, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: B1, amount: 1000 }, { bill_id: B2, amount: 500 }] });
  check('1b: the server refuses to put a bill that is not validated on a wire (even if sent by hand)', !sv0.ok && /not validated yet/.test(sv0.error) && db.t.wire_packages.length === 0, sv0);
  // ── 2. validate — inbound / outbound is part of it
  // superseded (v55.83-RP, Max 21:04 "there MUST be a selection of the TYPE of bill and the direction"): every validation below also sends the bill type
  var v0 = await call(bills, 'u1', { action: 'validate_bill', id: B1, checks: CK, notes: '', shipment_direction: 'outbound', bill_type: 'trucking' });
  check('2a: the 3 boxes ticked but HOW empty → refused WITH the reason (this was the "does NOT save")', !v0.ok && /HOW you verified/.test(v0.error) && db.t.vendor_bills[0].validation_status === null, v0);
  var v0b = await call(bills, 'u1', { action: 'validate_bill', id: B1, checks: { matches_records: true, goods_received: true }, notes: 'checked the delivery receipt', shipment_direction: 'outbound', bill_type: 'trucking' });
  check('2b: a missing tick → refused', !v0b.ok && /three checks/.test(v0b.error), v0b);
  var v0c = await call(bills, 'u1', { action: 'validate_bill', id: B1, checks: CK, notes: 'matched to PO 4411 and the delivery receipt', bill_type: 'trucking' });
  check('2c: inbound / outbound not marked → refused ("it is part of validating it")', !v0c.ok && /Inbound or Outbound/.test(v0c.error) && db.t.vendor_bills[0].validation_status === null, v0c);
  var v1 = await call(bills, 'u1', { action: 'validate_bill', id: B1, checks: CK, notes: 'matched to PO 4411 and the delivery receipt', shipment_direction: 'outbound', bill_type: 'trucking' });
  check('2d: direction + 3 checks + HOW → validated; Outbound saved on the bill; who / when / direction on the audit trail',
    v1.ok && db.t.vendor_bills[0].validation_status === 'validated' && db.t.vendor_bills[0].shipment_direction === 'outbound' && db.t.vendor_bills[0].validated_by === 'u1' &&
    hist('bill_validated').length === 1 && hist('bill_validated')[0].details.shipment_direction === 'outbound', v1);
  var ob2 = await call(route, 'u1', { action: 'open_bills', payee_kind: 'service_provider', payee_name: 'RTM Capital' });
  check('2e: once validated it shows up in the wire picker', ob2.bills.some(function (b) { return b.id === B1; }) && ob2.not_validated.length === 0, ob2);
  var sv = await call(route, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: B1, amount: 1000 }, { bill_id: B2, amount: 500 }] });
  var g2 = await call(route, 'u1', { action: 'get', id: sv.id });
  check('2f: the wire saves and its check passes → ready for the 1st signature', sv.ok && g2.package.status === 'awaiting_1st', { sv: sv, st: g2.package && g2.package.status });
  // ── 3. a signature is bound to "every bill validated"; reopening blocks — and that block cannot be overridden
  var sA = await call(route, 'u2', { action: 'signoff', id: sv.id, note: 'bills validated and amounts right' });
  var ro = await call(bills, 'u1', { action: 'reopen_validation', id: B1, reason: 'the receipt was for a different load' });
  var g3a = await call(route, 'u1', { action: 'get', id: sv.id });
  var rc3 = await call(route, 'u1', { action: 'run_check', id: sv.id });
  var g3 = await call(route, 'u1', { action: 'get', id: sv.id });
  var nv = (g3.checks.checks || []).filter(function (c) { return c.code === 'BILL_NOT_VALIDATED'; });
  check('3a: reopening a bill\'s validation before the wire is sent → the wire must be re-checked, the check BLOCKS it, the earlier signature no longer counts',
    sA.ok && ro.ok && g3a.package.status === 'needs_check' && rc3.pass === false && g3.package.status === 'flagged' && nv.length === 1 && nv[0].level === 'block' && hist('bill_validation_reopened').length === 1, { a: g3a.package.status, s: g3.package.status, rc3: rc3 });
  check('3b: that block can NOT be overridden — "a bill must be validated before it can be wired"', nv[0] && nv[0].overridable === false && !W.OVERRIDABLE.BILL_NOT_VALIDATED && /validated before/.test(W.NOT_OVERRIDABLE_WHY.BILL_NOT_VALIDATED));
  var ov = await call(route, 'u1', { action: 'override_check', id: sv.id, check_key: nv[0] && nv[0].key, reason: 'we will validate it later, promise' });
  var s1 = await call(route, 'u1', { action: 'signoff', id: sv.id, note: 'looks fine to me anyway' });
  check('3c: the server refuses the override, and nobody can sign while it is not validated', !ov.ok && !s1.ok, { ov: ov, s1: s1 });
  var ob3 = await call(route, 'u1', { action: 'open_bills', payee_kind: 'service_provider', payee_name: 'RTM Capital', package_id: sv.id });
  var keep = await call(route, 'u1', { action: 'save_draft', id: sv.id, payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: B1, amount: 1000 }, { bill_id: B2, amount: 500 }] });
  check('3d: changing that wire still shows the bill already on it (so it can be unticked) and saving it is allowed — the check keeps blocking',
    ob3.bills.some(function (b) { return b.id === B1; }) && keep.ok && keep.audit && keep.audit.pass === false, { ob3: ob3.bills && ob3.bills.length, keep: keep });
  await call(bills, 'u1', { action: 'validate_bill', id: B1, checks: CK, notes: 'right receipt found, load 7781 matches' });
  await call(route, 'u1', { action: 'run_check', id: sv.id });
  await call(route, 'u1', { action: 'signoff', id: sv.id, note: 'second check of the totals' });
  var gS = await call(route, 'u1', { action: 'get', id: sv.id });
  if (gS.package.status !== 'ready_to_send') { await call(route, 'u2', { action: 'signoff', id: sv.id, note: 'bills validated and amounts right' }); await call(route, 'u1', { action: 'signoff', id: sv.id, note: 'second check of the totals' }); }
  var sent = await call(route, 'u1', { action: 'mark_sent', id: sv.id, sent_date: '2026-11-09', bank_reference: 'FED-9', proof_path: 'pv/wire-x-conf.pdf' });
  check('3e: (setup) validated again, signed by two, sent', sent.ok, sent);
  var ro2 = await call(bills, 'u1', { action: 'reopen_validation', id: B1, reason: 'want to look again' });
  check('3f: once SENT, the validation it was paid on cannot be reopened', !ro2.ok && /already SENT/.test(ro2.error) && db.t.vendor_bills[0].validation_status === 'validated', ro2);
  // ── 4. "delete a wire that is in progress"
  var d = await call(route, 'u1', { action: 'save_draft', payee_kind: 'vendor', lines: [{ bill_id: B3, amount: 80 }] });
  var sd = await call(route, 'u2', { action: 'signoff', id: d.id, note: 'one signature only so far' });
  var del = await call(route, 'u1', { action: 'delete_wire', id: d.id, reason: 'paying it by card instead' });
  check('4a: a wire in progress (checked, even signed once, not sent) is deleted; its bill is free again; the audit keeps the snapshot',
    d.ok && sd.ok && del.ok && del.erased && !db.t.wire_packages.some(function (p) { return p.id === d.id; }) && !db.t.wire_package_lines.some(function (l) { return l.bill_id === B3 && l.is_open; }) &&
    hist('wire_package_deleted').length === 1 && hist('wire_package_deleted')[0].details.signed_by.length === 1, { d: d, sd: sd, del: del });
  var d2 = await call(route, 'u1', { action: 'save_draft', payee_kind: 'vendor', lines: [{ bill_id: B3, amount: 80 }] });
  check('4b: …and the same bill can go on a new wire right away', d2.ok, d2);
  var undoNo = await call(route, 'u1', { action: 'delete_wire', id: sv.id, reason: 'sent to the wrong account by mistake' });
  check('4c: a SENT wire is undone only by a super admin or the owner (the screen says so)', !undoNo.ok && /* superseded pin (v55.83-SB, Max Nov 12 09:31 "Number 2 is yes"): the super admin only, no longer the owner */ /only be undone by the super admin/.test(undoNo.error), undoNo);

  // ── 5. on screen
  var U = R('src/components/WirePackagesPanel.jsx'); var BT = R('src/components/BillsTab.jsx');
  check('5a: the progress bar starts with "Bills validated"; the picker says only VALIDATED bills are listed and offers the waiting ones apart',
    U.indexOf("[['Bills validated', allValid], ['Prepared', true]") > 0 && U.indexOf('Only VALIDATED bills are listed here') > 0 && U.indexOf("' open bill(s) waiting for validation'") > 0);
  check('5b: a waiting bill can be validated right there (Inbound / Outbound + 3 checks + HOW, same endpoint) and then joins the list; a kept unvalidated bill cannot be ticked',
    U.indexOf('(notValid && !on)') > 0 && U.indexOf('function ValidateInline(p)') > 0 && U.indexOf("action: 'validate_bill', id: p.billId, checks: ck, notes: how, shipment_direction: dir") > 0 &&
    U.indexOf("'mark it Inbound or Outbound'") > 0 && U.indexOf("bills: (e.bills || []).concat([nb])") > 0);
  check('5c: a bill on a draft wire can be validated from the wire too, then the wire re-checks itself', U.indexOf("onDone={function () { toast.success('✓ Validated.'); recheck(); }}") > 0);
  check('5d: in 💸 Bills, validating asks Inbound / Outbound first; "Mark validated" says what is still missing and a refusal shows in red (no silent fail)',
    BT.indexOf('This bill is for:') > 0 && BT.indexOf("shipment_direction: validating.dir") > 0 && BT.indexOf("'mark it Inbound or Outbound'") > 0 &&
    BT.indexOf('Still needed: ') > 0 && BT.indexOf('validating.err') > 0 && BT.indexOf("write HOW you verified it (10+ characters)") > 0);
  check('5e: delete / undo ask right on the screen (no browser pop-up that can be blocked), with the reason, and a 🗑 on each wire in progress in the list',
    U.indexOf('window.prompt') < 0 && U.indexOf("setDelAsk({ mode: 'erase', reason: '' })") > 0 && U.indexOf("setDelAsk({ mode: 'undo', reason: '' })") > 0 && U.indexOf('title="Delete this wire (not sent yet)"') > 0);

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
