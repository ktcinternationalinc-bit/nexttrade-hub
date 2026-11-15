// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RJ — Max, Nov 9 11:21: "the problem is for the wireing is that you do
// not have the option to ... select the bills to include in the wires to
// nextrade or rtm ... how many times do we need to say to review the entire
// workflow and identify any gaps"
// An independent review walked the whole wire flow (RTM / NextTrade / vendor;
// super admin / owner / staff) and found 15 gaps. Each one is pinned here, the
// rule changes run for real.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); } }
function loadEsm(src) {
  var names = [];
  var cjs = src.replace(/^import[^\n]*\n/gm, '')
    .replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; })
    .replace(/export var ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'var ' + n; });
  cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
  var mod = { exports: {} };
  /* eslint-disable no-new-func */
  new Function('module', 'exports', cjs)(mod, mod.exports);
  return mod.exports;
}
console.log('RJ — every gap the independent wire review found, fixed');
var W = loadEsm(R('src/lib/wire-audit.js'));
var S = R('src/app/api/accounting/wire-packages/route.js');
var B = R('src/app/api/accounting/bills/route.js');
var U = R('src/components/WirePackagesPanel.jsx');
var L = R('src/lib/wire-package-server.js');
function codes(r) { return r.checks.map(function (c) { return c.code; }); }
// fixture realigned (v55.83-RL, Max 12:20: bill # + date always required, inbound/outbound ticked): own date per bill, OUTBOUND by default
function bill(id, vendor, num, rel, total, extra) { var n = String(id).replace(/[^0-9]/g, '') || '1'; return Object.assign({ id: id, vendor_name: vendor, bill_number: num, release_number: rel, total_amount: total, record_status: 'active', validation_status: 'validated', bill_date: '2026-10-' + ('0' + n).slice(-2), shipment_direction: 'outbound' }, extra || {}); }
function line(b, amt, extra) { return Object.assign({ line_id: 'l' + b.id, bill_id: b.id, amount: amt, bill: b, other_payments: [] }, extra || {}); }

// THE complaint: bills can be chosen for RTM / NextTrade wires
var rtm = { id: 'p1', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 0 };
var nt = { id: 'p2', payee_kind: 'affiliate', payee_name: 'NextTrade Industries', fee_amount: 0 };
var fresh = bill('b1', 'Fast Trucking', 'T-1', '1003-021', 500); // nobody marked it "paid through" anything
ok('0a: a plain open bill ticked for an RTM wire passes the check (it is marked "paid through RTM" when the wire is sent)',
  W.auditPackage({ pkg: rtm, lines: [line(fresh, 500, { will_mark: true })] }).pass);
ok('0b: …but a bill that is not on the wire\'s list of ticked bills still cannot claim to be RTM\'s', !W.auditPackage({ pkg: rtm, lines: [line(fresh, 500)] }).pass);
ok('0c: the picker lists the company\'s bills AND every unassigned open bill, with search; the whole row ticks', S.indexOf('return samePayee(b.paid_via, payeeO) || !b.paid_via;') > 0 && U.indexOf('togglePick(b)') > 0 && U.indexOf('🔎 search vendor, bill # or release #') > 0);

// gap 1 — a bill on a SENT wire cannot be edited or voided (the wire would be stuck)
ok('1: bills on a SENT wire cannot be edited; a bill on any open wire cannot be voided', B.indexOf('async function openWireOf(db, billId)') > 0 &&
  B.indexOf("if (wOn && wOn.status === 'sent')") > 0 && B.indexOf('var wOnV = await openWireOf(db, body.id);') > 0);
// gap 2 — a wire's payment cannot be voided by hand (double pay)
ok('2: a payment recorded by a wire cannot be voided in Bills', B.indexOf(".from('wire_package_lines').select('package_id').eq('payment_id', body.id)") > 0);
// gap 3 — the 🏢 flow cannot use up the bank line a sent wire is waiting for
ok('3: recording bills against a bank line that matches a SENT wire is refused (attach it in Wires instead)', B.indexOf(".from('wire_packages').select('seq, approved_total, payee_name').eq('status', 'sent')") > 0 && B.indexOf('attach it in 🏦 Wires instead') > 0);
// gap 4 — changing a wire: no-longer-payable bills are shown so they can be unticked
ok('4: "Change the wire" lists ticked bills that are no longer payable, so they can be unticked', U.indexOf('var staleIds = ed.bills ?') > 0 && U.indexOf('can no longer be paid by it') > 0 && U.indexOf('lineInfo: info') > 0);
// gap 5 — NextTrade overhead bills without release; two real charges on one release
ok('5a: NextTrade: a bill with no release # is a WARNING (payroll / rent / utilities), not a block; RTM / vendor: still a block',
  W.auditPackage({ pkg: nt, lines: [line(bill('n1', 'TX Electric', 'E-1', '', 300, { paid_via: 'NextTrade Industries' }), 300)] }).pass &&
  !W.auditPackage({ pkg: rtm, lines: [line(bill('r1', 'Fast Trucking', 'T-9', '', 300, { paid_via: 'RTM Capital' }), 300)] }).pass);
var twoTrucks = W.auditPackage({ pkg: rtm, lines: [line(bill('t1', 'Fast Trucking', 'T-10', '1003-030', 900, { paid_via: 'RTM Capital' }), 900), line(bill('t2', 'Fast Trucking', 'T-11', '1003-030', 650, { paid_via: 'RTM Capital' }), 650)] });
var sameTwice = W.auditPackage({ pkg: rtm, lines: [line(bill('t1', 'Fast Trucking', 'T-10', '1003-030', 900, { paid_via: 'RTM Capital' }), 900), line(bill('t3', 'Fast Trucking', 'T-12', '1003-030', 900, { paid_via: 'RTM Capital' }), 900)] });
// superseded (v55.83-RK, Max 11:38 "a unique release number and date"): the rule is by DATE, not amount — bills without dates can only warn
// superseded (v55.83-RL — dates are now always present): two charges on one release on DIFFERENT dates pass; on the SAME date they block
var sameDayTwice = W.auditPackage({ pkg: rtm, lines: [line(bill('t1', 'Fast Trucking', 'T-10', '1003-030', 900, { paid_via: 'RTM Capital' }), 900), line(bill('t9', 'Fast Trucking', 'T-19', '1003-030', 900, { paid_via: 'RTM Capital', bill_date: '2026-10-01' }), 900)] });
ok('5b: two charges from one vendor on one release: different dates pass (separate charges), the same date BLOCKS', twoTrucks.pass && sameTwice.pass && !sameDayTwice.pass);
var paidOther = W.auditPackage({ pkg: rtm, lines: [line(bill('t4', 'Fast Trucking', 'T-13', '1003-031', 400, { paid_via: 'RTM Capital' }), 400)], sameRelease: { '1003-031': [{ bill_id: 'old', vendor_name: 'Fast Trucking', bill_number: 'T-1', total_amount: 750, bill_date: null }] } });
ok('5c: another (older) bill of the same vendor on the release with no date to compare = WARNING, not a permanent block', paidOther.pass && codes(paidOther).indexOf('DUP_RELEASE') >= 0);
// gap 6 — NextTrade wires do not wait for "proof"
ok('6: proof of vendor payments is only asked from RTM-type companies; NextTrade wires finish when the bank line is attached',
  S.indexOf("var paidThrough = pkg.payee_kind === 'service_provider';") > 0 && S.indexOf("var pt = p.payee_kind === 'service_provider';") > 0 && W.packageStatus({ status: 'attached' }, 'h', 0) === 'complete');
// gap 7 — a failed save never leaves a broken wire
ok('7a: the RI column is checked BEFORE anything is written', S.indexOf("db.from('wire_package_lines').select('marked_paid_via').limit(1)") > 0 && S.indexOf('Run sql/v55-83-RI-wire-simple.sql in Supabase first') > 0);
ok('7b: a new wire whose bills fail to save is removed (no empty drafts); a changed wire adds → updates → removes, never emptied first',
  S.indexOf("await db.from('wire_packages').delete().eq('id', pkgId).eq('status', 'draft');") > 0 && S.indexOf('var adds = clean.filter(') > 0 && S.indexOf('var gone = (oldL.data || []).filter(') > 0 && S.indexOf("db.from('wire_package_lines').delete().eq('package_id', pkgId)") < 0);
ok('7c: the screen shows a "Before your first wire" box (database not ready, missing companies, fewer than 2 signers, unknown "paid through" names, AI off)',
  U.indexOf("api({ action: 'setup' })") > 0 && U.indexOf('Before your first wire:') > 0 && S.indexOf('outS.unknown_paid_via') > 0);
// gap 8 — a draft never hides bills from what-we-owe
ok('8: a bill is marked "paid through" only when the wire is SENT', S.indexOf("toMarkT.length && pkg.payee_kind !== 'vendor'") > 0 && S.indexOf("db.from('vendor_bills').update({ paid_via: payeeS })") < 0);
// gap 9 — no silent failures; the AI never runs past the time limit
ok('9a: every call returns an answer — non-JSON / network errors become a readable message', U.indexOf('The server did not answer properly (HTTP ') > 0 && U.indexOf('Could not reach the server (') > 0);
ok('9b: the AI review is limited to 20 seconds (a save stays inside the 60-second server limit)', L.indexOf('setTimeout(function () { ctl.abort(); }, 20000)') > 0 && L.indexOf('signal: ctl.signal') > 0);
// gap 10 — payee buttons cannot race
ok('10: a slow bill list for an earlier payee click is ignored', U.indexOf("if (!e || e.kind !== kind || String(e.payee || '') !== String(payee || '')) { current = false; return e; }") > 0);
// gap 11 — amounts with commas
ok('11: "1,250.00" is read as 1250; anything unreadable is refused with the bill named (never silently dropped)',
  U.indexOf('"1,250.00" yes, "1,00.00" no') > 0 && U.indexOf('is not a number — type it like 1250.00') > 0 && S.indexOf('commas only as thousands separators') > 0);
// gap 12 — release numbers visible and correctable
ok('12: 💸 Bills loads and shows the release #, and opens it when editing; a draft wire can change it', B.indexOf("dispute_reason, paid_via, release_number')") > 0 &&
  R('src/components/BillsTab.jsx').indexOf("release_number: b.release_number || ''") > 0 && R('src/components/BillsTab.jsx').indexOf('REL {b.release_number}') > 0 && U.indexOf('>change</button>') > 0);
// gap 13 — a failed lookup never looks like "not paid"
ok('13: lookups throw instead of returning nothing (a paid bill can never look open)', L.indexOf("if (r.error) { throw new Error('Could not read ' + table + ': ' + r.error.message); }") > 0);
// gap 14 — the owner can accept a bank fee difference
ok('14: a different bank amount can be accepted by a super admin OR the owner (with the reason)', S.indexOf("g1.ctx.role === 'owner'") > 0);
// gap 15 — older "paid through" spellings
ok('15: "RTM" on an older bill is RTM Capital; unrelated names are not', W.samePayee('RTM', 'RTM Capital') && W.samePayee('rtm capital ', 'RTM Capital') && !W.samePayee('RTMX', 'RTM Capital') && !W.samePayee('NextTrade Industries', 'RTM Capital') && !W.samePayee('', 'RTM Capital'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
