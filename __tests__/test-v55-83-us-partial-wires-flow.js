// v55.83-US — Max, Nov 19: "as soon as it is on a wire even if it is a draft...the remaining split amount should display in the
// queue for availability for a new wire even if the first did not go out. and it should be of only the remaining amount. if the
// wire is voided or cancelled. then the split amount will be returned to that bill for future use on another wire".
// Runs the REAL wire route and the REAL bills route on an in-memory database (same harness as the RJ end-to-end test).
// The database's own cap under a lock (two drafts racing) is proven on real Postgres: test-v55-83-us-partial-wires-sql.mjs.
var path = require('path'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var B = 'b0000000-0000-0000-0000-000000014277'; var B2 = 'b0000000-0000-0000-0000-000000000002';
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }],
  module_permissions: ['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send', 'bills.manage'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
  vendor_bills: [
    { id: B, vendor_name: 'NexPac Corporation', bill_number: '14277', other_reference: 'BOL-77', total_amount: 45250, record_status: 'active', paid_via: null, validation_status: 'validated', bill_date: '2026-06-30', shipment_direction: 'inbound' },
    { id: B2, vendor_name: 'NexPac Corporation', bill_number: '14300', other_reference: 'BOL-78', total_amount: 1000, record_status: 'active', paid_via: null, validation_status: 'validated', bill_date: '2026-07-02', shipment_direction: 'inbound' }
  ],
  vendor_bill_payments: [], wire_packages: [], wire_package_lines: [], wire_package_files: [], hub_audit_log: [], paid_through_parties: [], bank_transactions: []
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req, parent) {
  if (req === '@supabase/supabase-js') { return mockPath; }
  if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); }
  return orig.apply(this, arguments);
};
require('fs').writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
global.__db = db;
db.rpcs = Object.assign({}, db.rpcs || {}, { hub_payment_guards_installed: function () { return true; } });
db.partialWires = true; // sql/v55-83-US-partial-wires.sql is run: the one-open-line index is gone
var route = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
async function call(r, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: 'u1' }, body)); }, headers: new Map() }); return res.json(); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 500))); if (!cond) { process.exitCode = 1; } }
function offer(list, id) { return ((list && list.bills) || []).filter(function (b) { return b.id === id; })[0] || null; }
function queue(pkgId) { return call(route, { action: 'open_bills', payee_kind: 'vendor', payee_name: '', package_id: pkgId || undefined }); }
(async function () {
  console.log('US — partial wires: the remaining amount stays in the queue (real routes)');
  var q0 = await queue();
  check('start: bill 14277 is offered for its full $45,250', offer(q0, B) && offer(q0, B).open === 45250, q0);
  // draft A takes part of it
  var a = await call(route, { action: 'save_draft', payee_kind: 'vendor', payee_name: 'NexPac Corporation', lines: [{ bill_id: B, amount: 27885.78 }] });
  check('draft wire A: $27,885.78 of bill 14277 saved', a.ok === true && !!a.id, a);
  var q1 = await queue();
  var o1 = offer(q1, B);
  check('at once — wire A is only a DRAFT — the bill is still in the queue, for ONLY the remaining $17,364.22', !!o1 && o1.open === 17364.22 && o1.reserved_elsewhere === 27885.78, o1 || q1);
  check('… and it says where the rest is ("$27,885.78 on WP-…")', !!o1 && /\$27885\.78 on /.test(String(o1.on_package || '')), o1);
  // wire B cannot take more than what is left
  var bTooMuch = await call(route, { action: 'save_draft', payee_kind: 'vendor', payee_name: 'NexPac Corporation', lines: [{ bill_id: B, amount: 17364.23 }] });
  check('wire B asking one cent more than the remainder → refused in plain words, nothing saved', !bTooMuch.ok && /only \$17364\.22 is left for this wire/.test(bTooMuch.error || '') && db.t.wire_packages.length === 1, bTooMuch);
  var b = await call(route, { action: 'save_draft', payee_kind: 'vendor', payee_name: 'NexPac Corporation', lines: [{ bill_id: B, amount: 10000 }] });
  check('wire B: $10,000 of the same bill saved while A is still a draft', b.ok === true && !!b.id && b.id !== a.id, b);
  var q2 = await queue();
  check('a third wire is offered what is left after A and B: $7,364.22', offer(q2, B) && offer(q2, B).open === 7364.22, offer(q2, B));
  var gB = await call(route, { action: 'get', id: b.id });
  var codesB = ((gB.checks && gB.checks.checks) || []).map(function (c) { return c.level + ':' + c.code; });
  check('wire B\'s check: "also on another wire" is information, not a block', codesB.indexOf('info:ALSO_ON_OTHER_PACKAGE') >= 0 && codesB.indexOf('block:IN_OTHER_PACKAGE') < 0, codesB);
  // editing A's amount: the others follow
  var aLow = await call(route, { action: 'save_draft', id: a.id, payee_kind: 'vendor', payee_name: 'NexPac Corporation', lines: [{ bill_id: B, amount: 20000 }] });
  check('wire A lowered to $20,000', aLow.ok === true, aLow);
  var q3 = await queue();
  check('… the queue follows: $45,250 − 20,000 − 10,000 = $15,250 available', offer(q3, B) && offer(q3, B).open === 15250, offer(q3, B));
  var aHigh = await call(route, { action: 'save_draft', id: a.id, payee_kind: 'vendor', payee_name: 'NexPac Corporation', lines: [{ bill_id: B, amount: 35250.01 }] });
  check('wire A raised above what B leaves (35,250.01 + 10,000 > 45,250) → refused, A unchanged', !aHigh.ok && db.t.wire_package_lines.filter(function (l) { return l.package_id === a.id; })[0].amount === 20000, aHigh);
  var qA = await queue(a.id);
  check('while editing wire A itself, its own amount is not counted against it: $35,250 available to A', offer(qA, B) && offer(qA, B).open === 35250, offer(qA, B));
  // cancel A → its amount returns
  var cx = await call(route, { action: 'cancel', id: a.id, note: 'not sending this one after all' });
  check('wire A cancelled', cx.ok === true, cx);
  var q4 = await queue();
  check('… its $20,000 is back on the bill: $35,250 available (only B\'s $10,000 held)', offer(q4, B) && offer(q4, B).open === 35250, offer(q4, B));
  // delete B → everything returns
  var dx = await call(route, { action: 'delete_wire', id: b.id, reason: 'made by mistake, deleting it' });
  check('wire B deleted', dx.ok === true, dx);
  var q5 = await queue();
  check('… the bill is offered for its full $45,250 again, no "on another wire" note', offer(q5, B) && offer(q5, B).open === 45250 && !offer(q5, B).on_package, offer(q5, B));
  // a bill wholly on a draft wire leaves the queue; it returns when the line is removed
  var c = await call(route, { action: 'save_draft', payee_kind: 'vendor', payee_name: 'NexPac Corporation', lines: [{ bill_id: B, amount: 45250 }, { bill_id: B2, amount: 1000 }] });
  var q6 = await queue();
  check('a bill put on a wire in full is no longer in the queue', c.ok === true && offer(q6, B) === null, [c.ok, offer(q6, B)]);
  var c2 = await call(route, { action: 'save_draft', id: c.id, payee_kind: 'vendor', payee_name: 'NexPac Corporation', lines: [{ bill_id: B2, amount: 1000 }] });
  var q7 = await queue();
  check('unticking it on that wire puts it back in the queue in full', c2.ok === true && offer(q7, B) && offer(q7, B).open === 45250, [c2.ok, offer(q7, B)]);
  // voiding a bill with a live payment
  db.t.vendor_bill_payments.push({ id: 'p1', bill_id: B, amount: 27885.79, voided: null, paid_date: '2026-08-05' });
  var v1 = await call(bills, { action: 'void_bill', id: B, reason: 'duplicate copy' });
  check('a bill with a payment that is not undone cannot be voided (a blank voided flag counts as live)', !!v1.error && /1 payment\(s\) totalling \$27885\.79 that are not undone/.test(v1.error) && db.t.vendor_bills[0].record_status === 'active', v1);
  var q8 = await queue();
  check('… and the queue counts that payment: $45,250 − 27,885.79 = $17,364.21 left', offer(q8, B) && offer(q8, B).open === 17364.21, offer(q8, B));
  db.t.vendor_bill_payments[0].voided = true;
  var v2 = await call(bills, { action: 'void_bill', id: B, reason: 'duplicate copy' });
  check('once the payment is undone, the bill can be voided', v2.ok === true && db.t.vendor_bills[0].record_status === 'void', v2);
  var wam = require('fs').readFileSync(path.join(root, 'src/lib/wire-auto-match.js'), 'utf8');
  check('attaching a wire pays each line through the one-step database function; a failed attach undoes what it wrote and SAYS so if the clean-up did not fully work', wam.indexOf('hub_wire_line_pay') > 0 && wam.indexOf('var bad1 = await undoMade();') > 0 && wam.indexOf('var rel2 = await release(); if (rel2) { bad2.push(rel2); }') > 0 && wam.indexOf('The clean-up did NOT fully work') > 0);
  console.log('\nUS partial wires flow: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
