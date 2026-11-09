// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RL — Max, Nov 9 12:17–12:20:
//  "should be override button. with reason and audit of who approved it."
//  "also ability to delete the wire and everything return to previous state."
//  "DID we created audit of approvals of wires and approvals of bills that are
//   in system so we have records of who checked etc"
//  "also should have a reference column to fill if there is a reference that is
//   part of it that is besides the bill # and release # etc"
//  "audit should include whatever we need that was done... deleted wire
//   included or edited wire etc"
//  "also check box if outbound or inbound -- if inbound release number not
//   necessary but a reference number is necessary. if outbound then release
//   number is necessary and reference number is not. Billing is always
//   necessary and date is always necessary"
// The REAL wire + bills routes run end to end on an in-memory database; the
// rules run for real; the SQL locks were run on PG16 (pinned at the end).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var B1 = 'b1000000-0000-0000-0000-000000000001', B2 = 'b1000000-0000-0000-0000-000000000002', B3 = 'b1000000-0000-0000-0000-000000000003', TX = '71000000-0000-0000-0000-000000000001';
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }, { id: 'u9', name: 'Max', role: 'super_admin', active: true }],
  module_permissions: [].concat(
    ['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send', 'wires.override', 'bills.manage'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [
    { id: B1, vendor_name: 'Fast Trucking', bill_number: 'T-1', release_number: null, total_amount: 1000, record_status: 'active', paid_via: null, bill_date: '2026-10-01', shipment_direction: 'outbound', validation_status: 'validated' },
    { id: B2, vendor_name: 'Ocean Line', bill_number: 'O-7', release_number: null, total_amount: 500, record_status: 'active', paid_via: 'RTM Capital', bill_date: '2026-10-02', shipment_direction: 'inbound', other_reference: null, validation_status: 'validated' },
    { id: B3, vendor_name: 'Mystery Co', bill_number: '', release_number: '1003-099', total_amount: 50, record_status: 'active', paid_via: null, bill_date: null, shipment_direction: null, validation_status: 'validated' },
  ],
  vendor_bill_payments: [], wire_packages: [], wire_package_lines: [], wire_package_files: [], wire_package_overrides: [], hub_audit_log: [], paid_through_parties: [],
  bank_transactions: [{ id: TX, date: '2026-11-10', amount_abs: 1500, direction: 'out', pending: false, name: 'WIRE RTM', wave_business_id: US, review_status: 'needs_review', third_party_payer: null }],
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var route = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
async function call(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 500))); }
function hist(action) { return db.t.hub_audit_log.filter(function (h) { return h.action === action; }); }
console.log('RL — override with reason, delete / undo a wire, reference + inbound/outbound, full audit');
(async function () {
  // ── inbound / outbound + reference + bill # + date
  var sv = await call(route, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: B1, amount: 1000 }, { bill_id: B2, amount: 500 }] });
  var codes = sv.ok ? (await call(route, 'u1', { action: 'get', id: sv.id })).checks.checks.filter(function (c) { return c.level === 'block'; }).map(function (c) { return c.code; }) : [];
  check('1a: OUTBOUND bill without a release # → blocked; INBOUND bill without its reference → blocked (and NOT for its missing release)', sv.ok && codes.indexOf('RELEASE_MISSING') >= 0 && codes.indexOf('REFERENCE_MISSING') >= 0 && codes.filter(function (c) { return c === 'RELEASE_MISSING'; }).length === 1, { sv: sv, codes: codes });
  var ref = await call(route, 'u1', { action: 'set_bill_release', bill_id: B2, field: 'other_reference', other_reference: 'bol-5512' });
  check('1b: the reference is typed right from the wire (upper-cased, audited)', ref.ok && ref.value === 'BOL-5512' && db.t.vendor_bills[1].other_reference === 'BOL-5512' && hist('bill_reference_set').length === 1, ref);
  var sv3 = await call(route, 'u1', { action: 'save_draft', payee_kind: 'vendor', lines: [{ bill_id: B3, amount: 50 }] });
  var c3 = (await call(route, 'u1', { action: 'get', id: sv3.id })).checks.checks.filter(function (c) { return c.level === 'block'; }).map(function (c) { return c.code; });
  check('1c: bill # and date are ALWAYS required; inbound / outbound must be ticked', c3.indexOf('BILL_NUMBER_MISSING') >= 0 && c3.indexOf('BILL_DATE_MISSING') >= 0 && c3.indexOf('DIRECTION_MISSING') >= 0, c3);
  var dirSet = await call(route, 'u1', { action: 'set_bill_release', bill_id: B3, field: 'shipment_direction', shipment_direction: 'outbound' });
  check('1d: inbound / outbound can be ticked from the wire (audited)', dirSet.ok && db.t.vendor_bills[2].shipment_direction === 'outbound' && hist('bill_direction_set').length === 1, dirSet);
  // ── delete a draft: everything back, record kept in the audit log
  var del = await call(route, 'u1', { action: 'delete_wire', id: sv3.id, reason: 'made by mistake' });
  check('2a: deleting a DRAFT erases it; its bill is free for another wire; the audit log keeps a full snapshot (who, why, bills)',
    del.ok && del.erased && !db.t.wire_packages.some(function (p) { return p.id === sv3.id; }) && !db.t.wire_package_lines.some(function (l) { return l.bill_id === B3 && l.is_open; }) &&
    hist('wire_package_deleted').length === 1 && hist('wire_package_deleted')[0].details.reason === 'made by mistake' && hist('wire_package_deleted')[0].details.bills.length === 1, del);
  // ── override with reason, who approved it
  var g = await call(route, 'u1', { action: 'get', id: sv.id });
  var rel = g.checks.checks.filter(function (c) { return c.code === 'RELEASE_MISSING'; })[0];
  check('3a: each problem says whether it can be overridden', rel && rel.overridable === true && !!rel.key, rel);
  var noPerm = await call(route, 'u2', { action: 'override_check', id: sv.id, check_key: rel.key, reason: 'release comes next week' });
  check('3b: someone without "Override wire checks" cannot override', !noPerm.ok && /Override wire checks/.test(noPerm.error), noPerm);
  var short = await call(route, 'u1', { action: 'override_check', id: sv.id, check_key: rel.key, reason: 'ok' });
  check('3c: an override needs a real reason (10+ characters)', !short.ok, short);
  var ov = await call(route, 'u1', { action: 'override_check', id: sv.id, check_key: rel.key, reason: 'release number issued by the plant next week' });
  check('3d: override recorded → the wire can be signed; WHO and WHY are stored and in the audit log', ov.ok && ov.pass === true && db.t.wire_package_overrides.length === 1 &&
    db.t.wire_package_overrides[0].overridden_by === 'u1' && hist('wire_check_overridden').length === 1 && /next week/.test(hist('wire_check_overridden')[0].details.reason), ov);
  var g2 = await call(route, 'u2', { action: 'get', id: sv.id });
  var ovLine = g2.checks.checks.filter(function (c) { return c.level === 'overridden'; })[0];
  check('3e: signers see the overridden problem with the name and the reason', g2.package.status === 'awaiting_1st' && ovLine && ovLine.override.by_name === 'Preparer' && /next week/.test(ovLine.override.reason) && g2.overrides.length === 1, g2.checks);
  // a void bill can never be overridden
  var W = require(path.join(root, 'src/lib/wire-audit.js'));
  check('3f: problems the books would refuse can NOT be overridden (void, overpaid, paid in full, another wire, wrong company)', ['BILL_VOID', 'OVERPAID', 'PAID_BEFORE', 'IN_OTHER_PACKAGE', 'PAYEE_MISMATCH'].every(function (k) { return !W.OVERRIDABLE[k] && !!W.NOT_OVERRIDABLE_WHY[k]; }));
  // changing the wire voids the override
  var ch = await call(route, 'u1', { action: 'save_draft', id: sv.id, payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: B1, amount: 900 }, { bill_id: B2, amount: 500 }] });
  var g3 = await call(route, 'u1', { action: 'get', id: sv.id });
  check('3g: change the wire → the earlier override no longer counts (the problem blocks again until re-approved)', ch.ok && g3.package.status === 'flagged' && g3.overrides[0].counts === false, g3.package);
  check('3h: an EDITED wire is audited with exactly what changed (amounts, bills, payee, fee)', hist('wire_package_updated').length === 1 && hist('wire_package_updated')[0].details.changes.amounts_changed.length === 1 && hist('wire_package_updated')[0].details.changes.amounts_changed[0].to === 900);
  var rel2 = g3.checks.checks.filter(function (c) { return c.code === 'RELEASE_MISSING' && c.level === 'block'; })[0];
  await call(route, 'u1', { action: 'save_draft', id: sv.id, payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: B1, amount: 1000 }, { bill_id: B2, amount: 500 }] });
  var g4 = await call(route, 'u1', { action: 'get', id: sv.id });
  check('3i: put the wire back exactly as approved → the override (bound to that exact wire) counts again', g4.package.status === 'awaiting_1st' && g4.checks.checks.some(function (c) { return c.level === 'overridden'; }), g4.package);
  // ── sign, send, attach, then UNDO
  await call(route, 'u2', { action: 'signoff', id: sv.id, note: 'checked the bills and the override' });
  await call(route, 'u1', { action: 'signoff', id: sv.id, note: 'checked totals against the RTM invoice' });
  var sent = await call(route, 'u1', { action: 'mark_sent', id: sv.id, sent_date: '2026-11-09', bank_reference: 'FED-1', proof_path: 'pv/wire-a-conf.pdf' });
  var at = await call(route, 'u1', { action: 'attach', id: sv.id, bank_transaction_id: TX });
  check('4a: (setup) the wire went through: signed by two, sent, attached — B1 was marked "paid through RTM" when sent', sent.ok && at.ok && db.t.vendor_bills[0].paid_via === 'RTM Capital' && db.t.bank_transactions[0].third_party_payer === 'RTM Capital', { sent: sent, at: at });
  var notBoss = await call(route, 'u1', { action: 'delete_wire', id: sv.id, reason: 'sent to the wrong account by mistake' });
  check('4b: undoing a SENT wire: only a super admin or the owner', !notBoss.ok && /super admin or the owner/.test(notBoss.error), notBoss);
  var shortU = await call(route, 'u9', { action: 'delete_wire', id: sv.id, reason: 'oops' });
  check('4c: …and only with a real reason (10+ characters)', !shortU.ok, shortU);
  var undo = await call(route, 'u9', { action: 'delete_wire', id: sv.id, reason: 'bank rejected the wire, money came back' });
  var pk = db.t.wire_packages.filter(function (p) { return p.id === sv.id; })[0];
  check('4d: "everything returns to previous state": the wire\'s payments voided, B1 back to "we pay it directly", the bank line\'s label restored and free',
    undo.ok && db.t.vendor_bill_payments.every(function (p) { return p.voided === true; }) && db.t.vendor_bills[0].paid_via === null && db.t.vendor_bills[1].paid_via === 'RTM Capital' &&
    db.t.bank_transactions[0].third_party_payer === null && pk.bank_transaction_id === null && db.t.wire_package_lines.every(function (l) { return l.is_open === false; }), undo);
  check('4e: the undone wire stays ON RECORD as reversed (who sent, who signed, who undid it and why) + the audit log snapshot',
    pk.status === 'reversed' && pk.reversed_by === 'u9' && /bank rejected/.test(pk.reverse_note) && pk.signoff1_by && pk.signoff2_by && hist('wire_package_reversed').length === 1 && hist('wire_package_reversed')[0].details.undone.payments_voided.length === 2);
  var g5 = await call(route, 'u9', { action: 'get', id: sv.id });
  check('4f: the wire\'s own history lists every step with who and when (prepared, changed, overridden, signed ×2, sent, attached, undone)',
    ['wire_package_prepared', 'wire_package_updated', 'wire_check_overridden', 'wire_package_signoff_1', 'wire_package_signoff_2', 'wire_package_sent', 'wire_package_attached', 'wire_package_reversed'].every(function (a) { return g5.history.some(function (h) { return h.action === a; }); }) &&
    g5.history.filter(function (h) { return h.action === 'wire_package_reversed'; })[0].by === 'Max', g5.history.map(function (h) { return h.action + ':' + h.by; }));
  var sv9 = await call(route, 'u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', lines: [{ bill_id: B1, amount: 1000 }] });
  check('4g: after the undo the same bills can go on a NEW wire (they are owed again)', sv9.ok, sv9);
  // ── bills: bill # always, inbound needs reference, outbound needs release; voids audited
  var nb = await call(bills, 'u1', { action: 'save_bill', bill: { vendor_name: 'X', total_amount: 10, bill_date: '2026-11-01' } });
  check('5a: a bill without a bill # cannot be saved', nb.error && /bill # is required/.test(nb.error), nb);
  var ib = await call(bills, 'u1', { action: 'save_bill', bill: { vendor_name: 'X', bill_number: 'X-1', total_amount: 10, bill_date: '2026-11-01', shipment_direction: 'inbound' } });
  var ob = await call(bills, 'u1', { action: 'save_bill', bill: { vendor_name: 'X', bill_number: 'X-2', total_amount: 10, bill_date: '2026-11-01', shipment_direction: 'outbound' } });
  var okb = await call(bills, 'u1', { action: 'save_bill', bill: { vendor_name: 'X', bill_number: 'X-3', total_amount: 10, bill_date: '2026-11-01', shipment_direction: 'inbound', other_reference: 'po-9' } });
  check('5b: INBOUND needs the reference, OUTBOUND needs the release #; a complete inbound bill saves with its reference', /INBOUND bill needs its reference/.test(ib.error || '') && /OUTBOUND bill needs its release/.test(ob.error || '') && okb.ok && db.t.vendor_bills.some(function (b) { return b.other_reference === 'PO-9' && b.shipment_direction === 'inbound'; }), { ib: ib, ob: ob, okb: okb });
  var newId = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'X-3'; })[0].id;
  var vb = await call(bills, 'u1', { action: 'void_bill', id: newId, reason: 'duplicate of X-1' });
  check('5c: voiding a bill is now in the audit trail (with the reason)', vb.ok && hist('bill_voided').length === 1 && hist('bill_voided')[0].details.reason === 'duplicate of X-1', vb);

  // ── pinned: screens, permissions, audit trail, SQL
  var U = R('src/components/WirePackagesPanel.jsx'); var A = R('src/components/AuditTrailTab.jsx'); var AR = R('src/app/api/accounting/audit/route.js'); var Q = R('sql/v55-83-RL-wire-override-delete-reference.sql');
  check('6a: the wire screen: ↷ Override… per problem (reason box), 🗑 Delete wire (draft), ↩ Undo & delete wire (sent, super admin / owner), the overridden list for signers, the full history',
    U.indexOf('↷ Override…') > 0 && U.indexOf('🗑 Delete wire') > 0 && U.indexOf('↩ Undo &amp; delete wire') > 0 && U.indexOf('problem(s) were OVERRIDDEN — read before signing') > 0 && U.indexOf('🧾 History — every step, who and when') > 0);
  check('6b: the bill cell on wires: ⬅ Inbound / Outbound ➡ tick, release # and reference editable in place', U.indexOf("chip('inbound', '⬅ Inbound')") > 0 && U.indexOf("field('Reference', b.other_reference") > 0);
  check('6c: 💸 Bills: inbound / outbound tick, release # and reference fields, bill # marked required; chips on the list', R('src/components/BillsTab.jsx').indexOf("[['inbound', '⬅ Inbound'], ['outbound', 'Outbound ➡']]") > 0 && R('src/components/BillsTab.jsx').indexOf("placeholder=\"Bill # *\"") > 0 && R('src/components/BillsTab.jsx').indexOf('REF {b.other_reference}') > 0);
  check('6d: Settings → 🏦 Banking & Accounting Access has the “Override wire checks” switch', R('src/components/BankingAccessPanel.jsx').indexOf("key: 'wires.override'") > 0);
  check('6e: the Audit Trail has “📤 Wire approvals” and “🧾 Bill approvals” views read straight from the database, with names', A.indexOf("['wires', '📤 Wire approvals']") > 0 && A.indexOf("['bills', '🧾 Bill approvals']") > 0 && AR.indexOf("if (scope === 'wires')") > 0 && AR.indexOf("d.from('users').select('id, name, email')") > 0 && A.indexOf("wire_package_deleted: '🗑 deleted a wire (draft)'") > 0);
  check('6f: database: overrides need a reason and are append-only; a sent wire can only become "reversed" (with who + why), never cancelled or deleted; inbound/outbound only those two values',
    Q.indexOf('reason text NOT NULL CHECK (length(reason) >= 10)') > 0 && Q.indexOf('wire_package_overrides_update ON public.wire_package_overrides FOR UPDATE TO authenticated USING (false)') > 0 &&
    Q.indexOf("CHECK (status <> 'reversed' OR (reversed_by IS NOT NULL AND reversed_at IS NOT NULL AND length(coalesce(reverse_note, '')) >= 10))") > 0 &&
    Q.indexOf('a sent wire cannot be cancelled — it can only be reversed (with a reason)') > 0 && Q.indexOf("CHECK (shipment_direction IS NULL OR shipment_direction IN ('inbound', 'outbound'))") > 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN || pass < 28) { process.exit(1); }
})().catch(function (e) { console.log('CRASH', e.stack); process.exit(1); });
