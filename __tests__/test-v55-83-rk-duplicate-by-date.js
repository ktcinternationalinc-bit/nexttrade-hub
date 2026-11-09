// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RK — Max, Nov 9 11:38: "before wire is sent...AI review will also make
// sure there is no duplicates...previously paid. actually is for a unique
// release number and date and or a unique reference and date etc"
// A duplicate = same vendor + same release + SAME bill date, or same reference
// + SAME date. The same release / reference on another date is a separate
// charge. Rules run here for real; the AI is told the same rule and shown the
// other bills (dates + what was already paid).
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
console.log('RK — duplicates = release + date, or reference + date; AI checks the same, plus previously paid');
var W = loadEsm(R('src/lib/wire-audit.js'));
function codes(r) { return r.checks.map(function (c) { return c.code; }); }
function lvl(r, code) { return r.checks.filter(function (c) { return c.code === code; }).map(function (c) { return c.level; }); }
// fixture realigned (v55.83-RL): OUTBOUND bills (they carry a release #)
function bill(id, vendor, num, rel, total, date) { return { id: id, vendor_name: vendor, bill_number: num, release_number: rel, total_amount: total, bill_date: date, record_status: 'active', validation_status: 'validated', paid_via: 'RTM Capital', shipment_direction: 'outbound' }; }
function line(b) { return { line_id: 'l' + b.id, bill_id: b.id, amount: b.total_amount, bill: b, other_payments: [] }; }
var RTM = { id: 'p', payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 0 };
function run(lines, extra) { return W.auditPackage(Object.assign({ pkg: RTM, lines: lines }, extra || {})); }

// ── release + date
var a = bill('a', 'Fast Trucking', 'T-1', '1003-021', 900, '2026-11-01');
ok('1a: same vendor + same release + SAME date on one wire → BLOCK', lvl(run([line(a), line(bill('b', 'Fast Trucking', 'T-2', '1003-021', 650, '2026-11-01'))]), 'DUP_RELEASE_IN_WIRE').indexOf('block') >= 0);
var diff = run([line(a), line(bill('c', 'Fast Trucking', 'T-3', '1003-021', 900, '2026-11-04'))]);
ok('1b: same vendor + same release on a DIFFERENT date → a separate charge (passes, shown for information) — even with the same amount', diff.pass && lvl(diff, 'SAME_RELEASE_OTHER_DATE').indexOf('info') >= 0 && diff.blocks === 0);
ok('1c: a missing bill date cannot be judged → WARNING for the signers', lvl(run([line(a), line(bill('d', 'Fast Trucking', 'T-4', '1003-021', 900, null))]), 'DUP_RELEASE_IN_WIRE').indexOf('warn') >= 0);
ok('1d: a DIFFERENT vendor on the same release and date (freight + customs) is normal', run([line(a), line(bill('e', 'Port Customs', 'C-1', '1003-021', 300, '2026-11-01'))]).pass);
var paidBefore = run([line(a)], { sameRelease: { '1003-021': [{ bill_id: 'old', vendor_name: 'Fast Trucking', bill_number: 'T-0', bill_date: '2026-11-01', total_amount: 900, paid_total: 900 }] } });
ok('1e: another bill in the books, same vendor + release + date, ALREADY PAID → BLOCK, and it says it was already paid', !paidBefore.pass && paidBefore.checks.some(function (c) { return c.code === 'DUP_RELEASE' && c.level === 'block' && /ALREADY PAID \(\$900\.00\)/.test(c.text); }));
var otherDay = run([line(a)], { sameRelease: { '1003-021': [{ bill_id: 'old', vendor_name: 'Fast Trucking', bill_number: 'T-0', bill_date: '2026-10-20', total_amount: 900, paid_total: 900 }] } });
ok('1f: …the same release on another date in the books → passes (information line mentions it was paid)', otherDay.pass && otherDay.checks.some(function (c) { return c.code === 'SAME_RELEASE_OTHER_DATE' && /ALREADY PAID/.test(c.text); }));

// ── reference + date
var r1 = bill('r1', 'Fast Trucking', 'INV-77', '1003-030', 500, '2026-11-02');
ok('2a: same reference + SAME date on one wire, same vendor → BLOCK', lvl(run([line(r1), line(bill('r2', 'Fast Trucking', 'inv-77', '1003-031', 500, '2026-11-02'))]), 'DUP_REF_IN_WIRE').indexOf('block') >= 0);
ok('2b: same reference on a DIFFERENT date → passes (information only)', run([line(r1), line(bill('r3', 'Fast Trucking', 'INV-77', '1003-031', 500, '2026-12-02'))]).pass);
var refBooks = run([line(r1)], { sameNumber: { 'INV-77': [{ bill_id: 'x', vendor_name: 'Fast Trucking', bill_date: '2026-11-02', paid_total: 500 }] } });
ok('2c: same vendor + reference + date already in the books (paid) → BLOCK "a duplicate bill"', !refBooks.pass && refBooks.checks.some(function (c) { return c.code === 'DUP_REF' && c.level === 'block' && /duplicate bill/.test(c.text) && /ALREADY PAID/.test(c.text); }));
var refOtherV = run([line(r1)], { sameNumber: { 'INV-77': [{ bill_id: 'y', vendor_name: 'Other Co', bill_date: '2026-11-02' }] } });
ok('2d: a different vendor with the same reference + date → WARNING (check it is not the same document)', refOtherV.pass && lvl(refOtherV, 'DUP_REF').indexOf('warn') >= 0);
ok('2e: a different vendor with the same reference on another date → nothing (coincidence)', codes(run([line(r1)], { sameNumber: { 'INV-77': [{ bill_id: 'y', vendor_name: 'Other Co', bill_date: '2026-01-02' }] } })).indexOf('DUP_REF') < 0);

// ── previously paid (the bill itself) still blocks
var self = bill('s', 'Fast Trucking', 'T-9', '1003-040', 400, '2026-11-03');
ok('3: a bill on the wire that was already paid in full → BLOCK', !run([{ line_id: 'ls', bill_id: 's', amount: 400, bill: self, other_payments: [{ amount: 400, paid_date: '2026-11-04' }] }]).pass);

// ── the AI is told the same rule and sees the other bills
var L = R('src/lib/wire-package-server.js');
ok('4a: the AI prompt states the rule: same release AND same date, or same reference AND same date; other dates are normal', L.indexOf('a duplicate is the same vendor with the same release number AND the same bill date') > 0 && L.indexOf('the same release on a DIFFERENT date is a normal separate charge') > 0);
ok('4b: the AI is given every other bill sharing a release / reference, with its date and how much was already paid', L.indexOf('other_bills_sharing_a_release_or_reference') > 0 && L.indexOf('already_paid: o.paid_total || 0') > 0 && L.indexOf('o.paid_total = opBy[o.bill_id] || 0') > 0);
ok('4c: both AI calls pass that context', (R('src/app/api/accounting/wire-packages/route.js').match(/aiReviewPackage\([^)]*\.ctx\)/g) || []).length === 2);
ok('4d: the after-the-fact bank view compares dates too', R('src/app/api/accounting/wires/route.js').indexOf("record_status, bill_date', 'release_number', rels); // RK: + date") > 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
