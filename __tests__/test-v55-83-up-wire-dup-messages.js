// v55.83-UP (Max, Nov 18, wire WP-0008: "why is this error message repeating several times and purpose") — the REAL wire audit:
// a bill on the wire with TWO extra copies in the Hub (same vendor, number, reference and date) gives ONE line per copy, and the
// lines say WHICH copy (entered when, amount, paid or not) — not four look-alike lines.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var W = require(path.join(root, 'src/lib/wire-audit.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('UP — wire duplicate messages: one per copy, naming the copy');
var bill = { id: 'b-wire', vendor_name: 'NexPac Corporation', bill_number: '14481', other_reference: '1001-1567', bill_date: '2026-06-02', total_amount: 2831, release_number: '1001-1567', record_status: 'active', shipment_direction: 'in', validation_status: 'validated' };
var copyA = { bill_id: 'b-copyA', vendor_name: 'NexPac Corporation', bill_number: '14481', bill_date: '2026-06-02', total_amount: 2831, created_at: '2026-06-05T10:00:00Z', paid_total: 0 };
var copyB = { bill_id: 'b-copyB', vendor_name: 'NexPac Corporation', bill_number: '14481', bill_date: '2026-06-02', total_amount: 2831, created_at: '2026-06-09T10:00:00Z', paid_total: 2831 };
var out = W.auditWire({
  wire: { id: 'w1', amount: 2831, direction: 'out' },
  lines: [{ bill_id: 'b-wire', amount: 2831, bill: bill, other_payments: [] }],
  sameNumber: { '14481': [copyA, copyB] },
  sameOther: { '1001-1567': [Object.assign({}, copyA), Object.assign({}, copyB)] },
  sameRelease: {}, knownReleases: ['1001-1567'], directionRules: true
});
var dups = out.checks.filter(function (c) { return /^DUP_(REF|OTHER_REF)$/.test(c.code); });
check('two extra copies → exactly TWO duplicate lines (was four: two by number + two by reference)', dups.length === 2, dups);
check('… both block the wire', dups.every(function (c) { return c.level === 'block'; }));
check('… the two lines read differently: each names its copy (entered 2026-06-05 / 2026-06-09)', dups.length === 2 && dups[0].text !== dups[1].text && dups.some(function (c) { return /entered in the Hub 2026-06-05/.test(c.text); }) && dups.some(function (c) { return /entered in the Hub 2026-06-09/.test(c.text); }), dups.map(function (c) { return c.text; }));
check('… amount and paid / not paid are named (the paid copy says ALREADY PAID)', dups.some(function (c) { return /\$2831\.00, not paid/.test(c.text); }) && dups.some(function (c) { return /ALREADY PAID \$2831\.00/.test(c.text); }));
check('… and they say what to do: void the extra copy in Bills', dups.every(function (c) { return /Void the extra copy in 💸 Bills/.test(c.text); }));
// only the reference matches (different bill numbers) → still reported, once, naming the copy
var copyC = { bill_id: 'b-copyC', vendor_name: 'NexPac Corporation', bill_number: '99999', bill_date: '2026-06-02', total_amount: 100, created_at: '2026-06-07T00:00:00Z', paid_total: 0 };
var out2 = W.auditWire({ wire: { id: 'w2', amount: 2831, direction: 'out' }, lines: [{ bill_id: 'b-wire', amount: 2831, bill: bill, other_payments: [] }], sameNumber: {}, sameOther: { '1001-1567': [copyC] }, sameRelease: {}, knownReleases: ['1001-1567'], directionRules: true });
var d2 = out2.checks.filter(function (c) { return c.code === 'DUP_OTHER_REF'; });
check('a copy matching only by reference + date is still reported once, naming #99999, and points to it', d2.length === 1 && /#99999/.test(d2[0].text) && d2[0].other_bill_id === 'b-copyC', d2);
// ── Codex 22:51: the normal loader fills sameRelease too — a copy matching by release AND number AND reference is still ONE line
var out3 = W.auditWire({ wire: { id: 'w3', amount: 2831, direction: 'out' }, lines: [{ bill_id: 'b-wire', amount: 2831, bill: bill, other_payments: [] }],
  sameNumber: { '14481': [copyA, copyB] }, sameOther: { '1001-1567': [Object.assign({}, copyA), Object.assign({}, copyB)] }, sameRelease: { '1001-1567': [Object.assign({}, copyA), Object.assign({}, copyB)] }, knownReleases: ['1001-1567'], directionRules: true });
var d3 = out3.checks.filter(function (c) { return /^DUP_/.test(c.code); });
check('triple match (release + number + reference): still exactly TWO lines for two extra copies, both blocking, each naming the release and pointing to its copy', d3.length === 2 && d3.every(function (c) { return c.level === 'block' && c.code === 'DUP_REF' && /release 1001-1567/.test(c.text); }) && d3.map(function (c) { return c.other_bill_id; }).sort().join() === 'b-copyA,b-copyB' && out3.pass === false, d3);
var relOnly = { bill_id: 'b-rel', vendor_name: 'NexPac Corporation', bill_number: '77777', bill_date: '2026-06-02', total_amount: 500, paid_total: 0 };
var out4 = W.auditWire({ wire: { id: 'w4', amount: 2831, direction: 'out' }, lines: [{ bill_id: 'b-wire', amount: 2831, bill: bill, other_payments: [] }], sameNumber: {}, sameOther: {}, sameRelease: { '1001-1567': [relOnly] }, knownReleases: ['1001-1567'], directionRules: true });
check('release-only match (another number, same vendor + release + date) is still reported and still blocks', out4.checks.filter(function (c) { return c.code === 'DUP_RELEASE' && c.level === 'block'; }).length === 1 && out4.pass === false, out4.checks);
var otherDate = Object.assign({}, copyA, { bill_id: 'b-od', bill_date: '2026-07-15' });
var out5 = W.auditWire({ wire: { id: 'w5', amount: 2831, direction: 'out' }, lines: [{ bill_id: 'b-wire', amount: 2831, bill: bill, other_payments: [] }], sameNumber: { '14481': [otherDate] }, sameOther: {}, sameRelease: { '1001-1567': [otherDate] }, knownReleases: ['1001-1567'], directionRules: true });
check('same number + release on a DIFFERENT date: information only, nothing blocks', out5.checks.filter(function (c) { return /^DUP_/.test(c.code); }).length === 0 && out5.checks.some(function (c) { return c.level === 'info' && /OTHER_DATE/.test(c.code); }), out5.checks);
var otherVendor = Object.assign({}, copyA, { bill_id: 'b-ov', vendor_name: 'Ontrek' });
var out6 = W.auditWire({ wire: { id: 'w6', amount: 2831, direction: 'out' }, lines: [{ bill_id: 'b-wire', amount: 2831, bill: bill, other_payments: [] }], sameNumber: { '14481': [otherVendor] }, sameOther: {}, sameRelease: {}, knownReleases: ['1001-1567'], directionRules: true });
var d6 = out6.checks.filter(function (c) { return c.code === 'DUP_REF'; });
check('a DIFFERENT vendor with the same number + date: a warning (not a block), pointing to that bill', d6.length === 1 && d6[0].level === 'warn' && d6[0].other_bill_id === 'b-ov', d6);
var noDate = Object.assign({}, copyA, { bill_id: 'b-nd', bill_date: null });
var out7 = W.auditWire({ wire: { id: 'w7', amount: 2831, direction: 'out' }, lines: [{ bill_id: 'b-wire', amount: 2831, bill: bill, other_payments: [] }], sameNumber: { '14481': [noDate] }, sameOther: {}, sameRelease: { '1001-1567': [noDate] }, knownReleases: ['1001-1567'], directionRules: true });
check('a copy with NO date: still raised for checking (warnings kept, nothing silently dropped)', out7.checks.filter(function (c) { return /^DUP_/.test(c.code) && c.level === 'warn'; }).length >= 1, out7.checks);
console.log('\nUP wire duplicate messages: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
