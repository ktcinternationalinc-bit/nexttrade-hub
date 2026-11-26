// ═══════════════════════════════════════════════════════════════════════════
// v55.83-ZP — Max, 26 Nov: "also with partner fee if we find a charge for 45250 that is a bill for partner fee. should be placed in
// the correct column but sould not count twice as a bill paid in the wire..get it" and, about the RTM funds box, "held with rtm at
// the end. isnt the 76000 linked to bills so it was sent and spent toward ktc bills".
// The pure rules (lib/partner-fee.js), the REAL wire-packages route on an in-memory database (the partner-fee split on the list and
// on one wire, the service-fee guard: refused, overridden with a reason and audited, never when the bill is on the same wire, a
// failed check refuses), the shared guard on its own (the funds "services rendered" path) and the screens. Fixture data made up.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var PF1 = 'b0000000-0000-0000-0000-0000000000f1'; // partner fee, open
var FR1 = 'b0000000-0000-0000-0000-0000000000f2'; // freight
var PF0 = 'b0000000-0000-0000-0000-0000000000f3'; // same vendor + amount, NO category
var PF2 = 'b0000000-0000-0000-0000-0000000000f4'; // partner fee, half paid already
var FR2 = 'b0000000-0000-0000-0000-0000000000f5'; // RTM bill
function bill(id, vendor, num, total, cat, extra) { return Object.assign({ id: id, vendor_name: vendor, bill_number: num, release_number: '1002-' + num, total_amount: total, record_status: 'active', paid_via: null, validation_status: 'validated', bill_date: '2026-09-30', shipment_direction: 'outbound', category: cat }, extra || {}); }
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Viewer', role: 'staff', active: true }],
  module_permissions: [].concat(
    ['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.view'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [
    bill(PF1, 'NexPac Corporation', '14598', 45250, 'partner_fees'),
    bill(FR1, 'NexPac Corporation', '14600', 1000, 'freight'),
    bill(PF0, 'NexPac Corp.', '14625', 45250, null),
    bill(PF2, 'NexPac Corporation', '14487', 45250, 'partner_fees'),
    bill(FR2, 'Ocean Line', 'O-9', 2000, 'freight', { paid_via: 'RTM Capital' }),
  ],
  vendor_bill_payments: [{ id: 'p0000000-0000-0000-0000-0000000000a1', bill_id: PF2, amount: 20000, voided: false }, { id: 'p0000000-0000-0000-0000-0000000000a2', bill_id: PF2, amount: 25250, voided: true }],
  wire_packages: [], wire_package_lines: [], wire_package_files: [], hub_audit_log: [], paid_through_parties: [], bank_transactions: [],
});
var orig = Module._resolveFilename;
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
Module._resolveFilename = function (req, parent) {
  if (req === '@supabase/supabase-js') { return mockPath; }
  if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); }
  return orig.apply(this, arguments);
};
global.__db = db;
db.rpcs = Object.assign({}, db.rpcs || {}, { hub_payment_guards_installed: function () { return true; } });
var route = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var PF = require(path.join(root, 'src/lib/partner-fee.js'));
var PFS = require(path.join(root, 'src/lib/partner-fee-server.js'));
async function call(user, body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; process.exitCode = 1; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
function auditOf(action) { return db.t.hub_audit_log.filter(function (a) { return a.action === action; }); }

console.log('ZP — partner-fee bills in their own column, counted once; RTM funds with no bills linked');
(async function () {
  // ── the pure rules
  check('a partner fee is exactly what the P&L puts in C · Partner fee: partner_fees, "Partner fee", "management fee" yes; professional fees, freight, empty no',
    PF.isPartnerFeeCategory('partner_fees') && PF.isPartnerFeeCategory('Partner fee') && PF.isPartnerFeeCategory('management_fee') && !PF.isPartnerFeeCategory('professional_fees') && !PF.isPartnerFeeCategory('freight') && !PF.isPartnerFeeCategory('') && !PF.isPartnerFeeCategory(null), null);
  var sp = PF.splitWireLines([{ amount: 39010.88, bill: { category: 'partner_fees' } }, { amount: 60989.12, bill: { category: 'freight' } }, { amount: 0.1, bill: {} }]);
  check('a wire split: each line in ONE column, the two add up to the lines (no partner fee counted twice): 39,010.88 + 60,989.22 = 100,000.10',
    sp.partner_fee_cents === 3901088 && sp.bills_cents === 6098922 && sp.total_cents === 10000010 && sp.partner_fee_cents + sp.bills_cents === sp.total_cents && sp.partner_fee_bills === 1, sp);
  var open = [{ id: 'x', bill_number: '1', total_amount: 45250, paid: 20000, credited: 0, category: 'partner_fees' }, { id: 'y', bill_number: '2', total_amount: 45250, paid: 0, credited: 0, category: 'freight' }];
  check('a fee equal to what is OPEN on a partner-fee bill is spotted (25,250 = 45,250 − 20,000); the full total of a half-paid one, or a freight bill of the same amount, is not',
    PF.feeLooksLikePartnerBill(25250, open) && PF.feeLooksLikePartnerBill(25250, open).id === 'x' && !PF.feeLooksLikePartnerBill(45250, open.slice(0, 1)) && !PF.feeLooksLikePartnerBill(45250, open.slice(1)) && !PF.feeLooksLikePartnerBill(0, open), null);
  var bills = db.t.vendor_bills.map(function (b) { return Object.assign({}, b); });
  var lk = PF.looksLikePartnerFee(bills[2], bills); var all = PF.partnerFeeLookalikes(bills.concat([bill('b0000000-0000-0000-0000-0000000000f6', 'NexPac Corporation', 'old', 45250, null, { record_status: 'void' })]));
  check('#14625 (NexPac Corp., $45,250, no category) looks like partner-fee bill #14598 (vendor name forgiven: Corp. = Corporation); a void copy is never flagged; a bill WITH a category never',
    lk && lk.like.bill_number === '14598' && all[PF0] && all[PF0].bill_number === '14598' && Object.keys(all).length === 1 && !PF.looksLikePartnerFee(bills[1], bills), [lk, Object.keys(all)]);
  check('funds with nothing linked: money sent and $0 to bills → yes; something linked or nothing sent → no', PF.noBillsLinked({ funds_sent: 76000, to_bills: 0 }) && !PF.noBillsLinked({ funds_sent: 76000, to_bills: 12 }) && !PF.noBillsLinked({ funds_sent: 0, to_bills: 0 }), null);
  check('the P&L period: held (sent now or before) and $0 applied → yes; applied → no', PF.periodNoBillsLinked({ opening_held_cents: 7600000, funds_sent_cents: 0, applied_cents: 0 }) && PF.periodNoBillsLinked({ funds_sent_cents: 100, applied_cents: 0 }) && !PF.periodNoBillsLinked({ funds_sent_cents: 100, applied_cents: 5 }) && !PF.periodNoBillsLinked({}), null);
  var trs = [{ id: 't2', date: '2026-11-06', sent: 40000, to_bills: 0, status: 'confirmed' }, { id: 't1', date: '2026-10-02', sent: 36000, to_bills: 0, status: 'needs_reconciliation' }, { id: 't0', date: '2026-09-01', sent: 500, to_bills: 500, status: 'confirmed' }];
  var rec = function (t) { return t.status === 'needs_reconciliation'; };
  check('which transfer to open: the OLDEST with nothing linked (not one already used); its record form when open for it; a confirmed one says "Undo confirm first"; a named one wins',
    PF.linkTarget(trs, null, rec).transfer.id === 't1' && PF.linkTarget(trs, null, rec).how === 'record' && PF.linkTarget(trs, 't2', rec).how === 'confirmed' && PF.linkTarget([trs[2]], null, rec) === null, null);
  check('"of which partner fee" in the P&L funds box adds only partner-fee rows', PF.partnerFeeOfRows([{ cents: 100, category: 'partner_fees' }, { cents: 50, category: 'freight' }, { cents: 7, category: 'Management fee' }]) === 107, null);

  // ── the real route: a NexPac vendor wire with the partner-fee bill + freight
  var w = await call('u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: '', lines: [{ bill_id: PF1, amount: '39010.88' }, { bill_id: FR1, amount: '1000' }] });
  check('setup: a NexPac wire with partner-fee bill #14598 (39,010.88 of it) and a freight bill', w.ok, w);
  var g = await call('u1', { action: 'get', id: w.id });
  check('opened: bills $40,010.88 = other bills $1,000.00 + partner fee $39,010.88; the total is NOT raised (no fee added on top)', g.ok && g.package.bills_total === 40010.88 && g.package.other_bills === 1000 && g.package.partner_fee === 39010.88 && g.package.total === 40010.88, g.package && [g.package.bills_total, g.package.other_bills, g.package.partner_fee, g.package.total]);
  var l = await call('u2', { action: 'list' });
  var row = (l.packages || []).filter(function (p) { return p.id === w.id; })[0];
  check('the list (Wires: View): the same split per wire; total unchanged', l.ok && row && row.partner_fee === 39010.88 && row.other_bills === 1000 && row.total === 40010.88, row);
  check('… the signed fingerprint still reads the same bill fields (category is NOT in it)', !/category/.test(require(path.join(root, 'src/lib/wire-audit.js')).WIRE_FINGERPRINT_BILL_FIELDS), null);

  // ── the service-fee guard on a wire to RTM
  var auditsBefore = db.t.hub_audit_log.length; var pkgsBefore = db.t.wire_packages.length;
  var r1 = await call('u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 25250, lines: [{ bill_id: FR2, amount: '2000' }] });
  check('an RTM service fee of $25,250 = what is open on partner-fee bill #14487 → 409 partner_fee_as_fee, names the bill, says add it instead', !r1.ok && r1._status === 409 && r1.code === 'partner_fee_as_fee' && r1.partner_fee_bill && r1.partner_fee_bill.id === PF2 && r1.partner_fee_bill.open === 25250 && /Add that bill to the wire instead/.test(r1.error), r1);
  check('… nothing was written (no wire, no audit)', db.t.wire_packages.length === pkgsBefore && db.t.hub_audit_log.length === auditsBefore, [db.t.wire_packages.length - pkgsBefore, db.t.hub_audit_log.length - auditsBefore]);
  var r2 = await call('u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 25250, it_is_a_different_fee: true, different_fee_reason: 'no', lines: [{ bill_id: FR2, amount: '2000' }] });
  check('"it is a different fee" without a real reason (under 5 characters) → still refused', !r2.ok && r2._status === 409 && r2.code === 'partner_fee_as_fee', r2);
  var r3 = await call('u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 25250, it_is_a_different_fee: true, different_fee_reason: 'RTM handling fee for October, invoice R-77', lines: [{ bill_id: FR2, amount: '2000' }] });
  var ov = auditOf('wire_fee_not_partner_fee');
  check('a different fee, with a reason → saved, and audited: who, the fee, the bill it looked like, the reason', r3.ok && ov.length === 1 && ov[0].actor_id === 'u1' && ov[0].details.fee === 25250 && ov[0].details.looked_like_bill.id === PF2 && /R-77/.test(ov[0].details.reason), [r3, ov]);
  var r4 = await call('u1', { action: 'save_draft', id: r3.id, payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 1234.5, lines: [{ bill_id: FR2, amount: '2000' }] });
  check('an ordinary fee (not the amount of any open partner-fee bill) → saved as before, no override audit', r4.ok && auditOf('wire_fee_not_partner_fee').length === 1, r4);
  // the partner-fee bill ON the same wire + a fee of its amount: never allowed, even "a different fee"
  db.t.vendor_bills.push(bill('b0000000-0000-0000-0000-0000000000f7', 'Ocean Line', 'PF-RTM', 3000, 'partner_fees', { paid_via: 'RTM Capital' }));
  var r5 = await call('u1', { action: 'save_draft', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 3000, it_is_a_different_fee: true, different_fee_reason: 'trying to sneak it twice', lines: [{ bill_id: 'b0000000-0000-0000-0000-0000000000f7', amount: '3000' }] });
  check('the partner-fee bill is ON this wire and the fee is its amount → 409 partner_fee_on_wire, even with "different fee" (it would be counted twice)', !r5.ok && r5._status === 409 && r5.code === 'partner_fee_on_wire', r5);
  // the check itself fails → refused, never "no partner-fee bills"
  var realFrom = db.from.bind(db);
  db.from = function (name) { var q = realFrom(name); if (name === 'vendor_bills') { var r0 = q.run; q.run = function () { if (this.filters.some(function (f) { return f[0] === 'not_is' && f[1] === 'category'; })) { return { data: null, error: { message: 'timeout' } }; } return r0.call(this); }; } return q; }; // only the guard's own read fails
  var r6 = await call('u1', { action: 'save_draft', id: r3.id, payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 999, lines: [{ bill_id: FR2, amount: '2000' }] });
  db.from = realFrom;
  check('the partner-fee bills cannot be read → 503 "the service fee was not saved", nothing guessed', !r6.ok && r6._status === 503 && /could not be checked/.test(r6.error), r6);

  // ── the same guard on its own (the funds box "services rendered" calls exactly this)
  var gA = await PFS.partnerFeeGuard(db, 25250, [], {});
  var gB = await PFS.partnerFeeGuard(db, 25250, [], { yes: true, reason: 'a real separate fee' });
  var gC = await PFS.partnerFeeGuard(db, 100, [], {});
  check('the shared guard: refused / allowed-as-override with the bill / nothing to say', gA && !gA.allowed && gA.status === 409 && gB && gB.allowed && gB.overridden && gB.bill.id === PF2 && gC === null, [gA, gB, gC]);

  // ── the routes and screens
  var pfRoute = fs.readFileSync(path.join(root, 'src/app/api/accounting/party-funds/route.js'), 'utf8');
  var iGuard = pfRoute.indexOf("pfM = await partnerFeeGuard(db, amount, []"); var iRpc = pfRoute.indexOf("var rf = await db.rpc('hub_party_fee'");
  check('funds box "services rendered": the guard runs BEFORE the fee is written, only for marking (not for reversing), and an override is audited', iGuard > 0 && iRpc > iGuard && /if \(action === 'fee_mark'\) \{\s*\r?\n\s*pfM = await partnerFeeGuard/.test(pfRoute) && /party_fee_not_partner_fee/.test(pfRoute), [iGuard, iRpc]);
  var wr = fs.readFileSync(path.join(root, 'src/app/api/accounting/wire-packages/route.js'), 'utf8');
  check('change_fee (a sent request) uses the same guard, with the request\'s own bills as "on this wire"', /var pfC = await partnerFeeGuard\(db, r2\(feeTyped/.test(wr) && /P\.rawLines\.map/.test(wr.substring(wr.indexOf('var pfC'), wr.indexOf('var pfC') + 200)), null);
  var wp = fs.readFileSync(path.join(root, 'src/components/WirePackagesPanel.jsx'), 'utf8');
  check('wire screen: a Partner fee column (each line in one column), "of which partner fee" in the list, "+ partner fee $" in the summary', /title="The partner-fee bill’s share of this wire[^"]*">Partner fee<\/th>/.test(wp) && /of which partner fee<\/th>/.test(wp) && /' \+ partner fee \$' \+ fmt\(P\.partner_fee\)/.test(wp) && /P\.partner_fee > 0 && isPartnerFee\(b\) \?/.test(wp), null);
  check('wire editor: the fee box offers "＋ Add bill #… instead (fee back to 0)" and "It is a different fee" + reason, sent as it_is_a_different_fee', /＋ Add bill #' \+ \(pb\.bill_number \|\| ''\) \+ ' instead \(fee back to 0\)'/.test(wp) && /It is a different fee/.test(wp) && /payload\.it_is_a_different_fee = true/.test(wp), null);
  var bt = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
  check('bills: the "looks like the monthly partner fee" flag, "Set as partner fee…" opens the editor (person saves), "Make it a rule…" pre-fills the rule form', /Looks like the monthly partner fee/.test(bt) && /Set as partner fee…/.test(bt) && /setEditing\(Object\.assign\(\{\}, b, \{ category: lk\.category/.test(bt) && /prefill=\{rulePrefill\}/.test(bt), null);
  var fh = fs.readFileSync(path.join(root, 'src/components/FundsHeldPanel.jsx'), 'utf8'); var fsx = fs.readFileSync(path.join(root, 'src/components/FundsSent.jsx'), 'utf8'); var at = fs.readFileSync(path.join(root, 'src/components/AccountingTab.jsx'), 'utf8');
  check('funds box and P&L box: "not linked to any bills yet" + "🔗 Link the bills it paid"; the P&L button opens Bills → Funds at that company (event caught by Accounting)',
    /are not linked to any bills yet/.test(fh) && /🔗 Link the bills it paid/.test(fh) && /are not linked to any bills yet/.test(fsx) && /OPEN_PARTY_FUNDS_EVENT/.test(fsx) && /addEventListener\(OPEN_PARTY_FUNDS_EVENT/.test(at) && /fundsTarget=\{fundsTarget\}/.test(at) && /openTarget=\{props\.fundsTarget/.test(bt), null);

  console.log('ZP partner fee: ' + pass + ' passed, ' + failN + ' failed');
})().catch(function (e) { console.log('  ✗ CRASH ' + (e && e.stack)); failN++; process.exitCode = 1; console.log('ZP partner fee: ' + pass + ' passed, ' + failN + ' failed'); });
