// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RX — Max, Nov 9 23:41 (screenshot of WP-0003, RTM Capital, 2 NexPac bills; the AI review said
// "Both bills have release = null; the company requires every bill to belong to a release number"):
//  "this is not true unless it is for outbound!! otherwise inbound needs a reference and a billing number"
//  "(every outbound bill needs a release!!)"
//  "next step after both signatures...SEND TO RTM (if for RTM). SEND to NEXTRADE (if set up for nextrade)
//   Send to Supplier/Vendor (if being sent directly)"
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs'); var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var W = require(path.join(root, 'src/lib/wire-audit.js'));
var pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name + '  ' + JSON.stringify(extra || '').substring(0, 400)); } }
console.log('RX — the AI review knows inbound vs outbound; the next step names who the money goes to');
var S = R('src/lib/wire-package-server.js');
ok('1a: the AI review is told the real rule: outbound needs a release; inbound needs its reference + bill number and NO release ("release = null on an inbound bill is NORMAL, never mention it")',
  S.indexOf('an OUTBOUND bill (direction "outbound") must have a release number') > 0 && S.indexOf('release = null on an inbound bill is NORMAL, never mention it') > 0 && S.indexOf('every bill belongs to a release number') < 0);
ok('1b: the AI sees each bill\'s direction and type', S.indexOf("direction: b.shipment_direction || null, bill_type: b.bill_type || null") > 0);
// the rule checks agree: inbound with reference + bill # + date → no release problem
var res = W.auditPackage({ pkg: { payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 0 }, lines: [
  { bill_id: 'a', amount: 2830.04, bill: { id: 'a', vendor_name: 'NexPac Corporation', bill_number: '14354', bill_date: '2026-06-08', total_amount: 2830.04, record_status: 'active', paid_via: 'RTM Capital', shipment_direction: 'inbound', other_reference: '80209194', release_number: null, validation_status: 'validated' }, other_payments: 0 },
  { bill_id: 'b', amount: 3471.76, bill: { id: 'b', vendor_name: 'NexPac Corporation', bill_number: '14353', bill_date: '2026-06-08', total_amount: 3471.76, record_status: 'active', paid_via: 'RTM Capital', shipment_direction: 'inbound', other_reference: '80208996', release_number: null, validation_status: 'validated' }, other_payments: 0 }],
  ctx: {} });
var codes = ((res && res.checks) || []).filter(function (c) { return c.level === 'block'; }).map(function (c) { return c.code; });
var outRes = W.auditPackage({ pkg: { payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 0 }, lines: [{ bill_id: 'c', amount: 100, bill: { id: 'c', vendor_name: 'Fast Trucking', bill_number: 'T-9', bill_date: '2026-10-01', total_amount: 100, record_status: 'active', paid_via: 'RTM Capital', shipment_direction: 'outbound', release_number: null, validation_status: 'validated' }, other_payments: 0 }], ctx: {} });
var outCodes = ((outRes && outRes.checks) || []).filter(function (c) { return c.level === 'block'; }).map(function (c) { return c.code; });
ok('1c: the rule check on WP-0003\'s two inbound NexPac bills (reference + bill # + date, no release) raises no release problem — while an OUTBOUND bill without a release IS blocked',
  (res.checks || []).length > 0 && codes.indexOf('RELEASE_MISSING') < 0 && codes.indexOf('REFERENCE_MISSING') < 0 && outCodes.indexOf('RELEASE_MISSING') >= 0, { codes: codes, out: outCodes, n: (res.checks || []).length });
var U = R('src/components/WirePackagesPanel.jsx');
ok('2a: after both signatures the next step says who gets the money: "Send to RTM Capital" / "Send to NextTrade Industries" / "Send to the vendor — <name>"',
  U.indexOf("if (p.payee_kind === 'service_provider') { return 'Send to ' + (p.payee_name || 'RTM Capital'); }") > 0 && U.indexOf("if (p.payee_kind === 'affiliate') { return 'Send to ' + (p.payee_name || 'NextTrade Industries'); }") > 0 && U.indexOf("return 'Send to the vendor — ' + (p.payee_name || '?');") > 0);
ok('2b: the list, the NEXT STEP box, its button and the progress bar all use it', U.indexOf("p.status === 'ready_to_send' ? sendWords(p) : NEXT_WORDS[p.status]") > 0 && U.indexOf("'📤 ' + sendWords(P) + ' — $' + fmt(P.total)") > 0 && U.indexOf("'📤 Mark as sent to ' + (P.payee_kind === 'vendor' ? 'the vendor' : P.payee_name)") > 0 && U.indexOf('[sentWords(P), !!P.sent]') > 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
