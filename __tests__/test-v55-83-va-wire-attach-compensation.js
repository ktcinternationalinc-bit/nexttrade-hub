// v55.83-VA (Codex 06:07 / 07:16) — the REAL attachWire (src/lib/wire-auto-match.js) on a FakeDb with the one-step database function
// present: a normal multi-line attach; a failure on the 2nd line (everything written for the 1st is undone and its line reopened);
// a clean-up that itself fails (the answer SAYS so — never "nothing changed"); a retry after a failure; the two-step way when the
// database function is not installed. The database rules themselves are proven on real Postgres (us-partial-wires-sql, us-wire-stack-sql).
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('VA — attaching a wire: one step per line, truthful clean-up');
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/audit-server.js', { audit: function () { return Promise.resolve(); } });
stub('src/lib/bank-allocation-server.js', { autoReviewIfComplete: function () { return Promise.resolve(null); } });
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var W = require(path.join(root, 'src/lib/wire-auto-match.js'));
var db, payFail, rpcCalls;
function fresh(opts) {
  var o = opts || {}; db = new FakeDb({}); payFail = o.failLine || null; rpcCalls = [];
  db.t.wire_packages = [{ id: 'pk1', seq: 1, status: 'sent', payee_kind: 'vendor', payee_name: 'V', approved_total: 300, bank_transaction_id: null, updated_at: new Date().toISOString() }];
  db.t.wire_package_lines = [{ id: 'l1', package_id: 'pk1', bill_id: 'b1', amount: 100, is_open: true, payment_id: null }, { id: 'l2', package_id: 'pk1', bill_id: 'b2', amount: 200, is_open: true, payment_id: null }];
  db.t.vendor_bills = [{ id: 'b1', vendor_name: 'V', bill_number: '1', total_amount: 100, record_status: 'active' }, { id: 'b2', vendor_name: 'V', bill_number: '2', total_amount: 200, record_status: 'active' }];
  db.t.vendor_bill_payments = []; db.t.bank_transactions = [];
  if (!o.noFunction) {
    db.rpcs.hub_wire_line_pay = function (args) {
      var p = args.p; rpcCalls.push(p.line_id);
      if (payFail === p.line_id) { return { data: null, error: { message: 'HUB_GUARD: $50.00 of this bill is held on an open wire — lower the payment.' } }; }
      var l = db.t.wire_package_lines.filter(function (x) { return x.id === p.line_id; })[0];
      if (!l || !l.is_open) { return { data: { ok: false, code: 'line_closed' }, error: null }; }
      var pay = { id: 'pay-' + l.id + '-' + (db.t.vendor_bill_payments.length + 1), bill_id: l.bill_id, amount: l.amount, paid_date: p.paid_date, bank_transaction_id: p.bank_transaction_id, voided: false };
      db.t.vendor_bill_payments.push(pay); l.is_open = false; l.payment_id = pay.id;
      return { data: { ok: true, payment_id: pay.id, line_id: l.id }, error: null };
    };
  }
}
var bank = { id: 'bank1', direction: 'out', pending: false, wave_business_id: US, amount_abs: 300, date: '2026-08-05', posted_date: '2026-08-05' };
function pk() { return db.t.wire_packages[0]; }
function live() { return db.t.vendor_bill_payments.filter(function (p) { return p.voided !== true; }); }
function openLines() { return db.t.wire_package_lines.filter(function (l) { return l.is_open; }).map(function (l) { return l.id; }).join(); }
(async function () {
  fresh(); var r1 = await W.attachWire(db, pk(), bank, 'u1', {});
  check('normal wire with two bills: each line paid through the one-step function, both lines closed and linked, wire attached', r1.ok === true && rpcCalls.join() === 'l1,l2' && live().length === 2 && openLines() === '' && pk().status === 'attached' && db.t.wire_package_lines.every(function (l) { return !!l.payment_id; }), [r1, rpcCalls]);
  var r1b = await W.attachWire(db, pk(), bank, 'u1', {});
  check('attaching it again → refused ("Already attached"), no new payments', r1b.ok === false && live().length === 2, r1b);

  fresh({ failLine: 'l2' }); var r2 = await W.attachWire(db, pk(), bank, 'u1', {});
  check('2nd line refused by the database: the 1st line\'s payment is UNDONE and its line REOPENED; the wire stays sent and unclaimed; plain 409', r2.ok === false && r2.status === 409 && live().length === 0 && db.t.vendor_bill_payments.length === 1 && db.t.vendor_bill_payments[0].voided === true && openLines() === 'l1,l2' && db.t.wire_package_lines[0].payment_id === null && pk().status === 'sent' && pk().bank_transaction_id === null, [r2, db.t.vendor_bill_payments, db.t.wire_package_lines]);
  check('… the message carries the database\'s reason and says the clean-up worked; no cleanup_failed flag', /held on an open wire/.test(r2.error) && /were undone and their wire lines reopened; nothing changed/.test(r2.error) && r2.cleanup_failed === undefined && r2.error.indexOf('HUB_GUARD') < 0, r2);
  payFail = null; var r3 = await W.attachWire(db, pk(), bank, 'u1', {});
  check('RETRY after the failure: works — two fresh live payments (the undone one stays on record as undone), wire attached', r3.ok === true && live().length === 2 && db.t.vendor_bill_payments.length === 3 && openLines() === '' && pk().status === 'attached', [r3, db.t.vendor_bill_payments]);

  fresh({ failLine: 'l2' }); db.fail = { wire_package_lines: { update: 'connection lost' } };
  var r4 = await W.attachWire(db, pk(), bank, 'u1', {});
  check('the clean-up itself fails (the line cannot be reopened): the answer SAYS so — 500, cleanup_failed lists it, and it does NOT say "nothing changed"', r4.ok === false && r4.status === 500 && Array.isArray(r4.cleanup_failed) && /wire line l1 was NOT reopened/.test(r4.cleanup_failed.join(' ')) && /clean-up did NOT fully work/.test(r4.error) && !/nothing changed/.test(r4.error), r4);
  fresh({ failLine: 'l2' }); db.fail = { vendor_bill_payments: { update: 'connection lost' } };
  var r5 = await W.attachWire(db, pk(), bank, 'u1', {});
  check('the payment cannot be undone: said too ("payment … was NOT undone"), and its line is left closed (still tied to that live payment)', r5.ok === false && r5.status === 500 && /payment pay-l1-1 was NOT undone/.test(r5.error) && db.t.wire_package_lines[0].is_open === false, r5);

  // ── Codex 07:16 — giving the bank line back can fail too: it must be reported, in BOTH failure branches
  function hook(match, mode) { var orig = db.from; db.from = function (t) { var q = orig(t); if (t === 'wire_packages') { var u = q.update; q.update = function (p) { if (match(p || {})) { q.exec = function () { return mode === 'error' ? { error: { message: 'connection lost' }, data: null } : { error: null, data: [] }; }; return q; } return u.call(q, p); }; } return q; }; }
  function isRelease(p) { return Object.keys(p).length === 1 && p.bank_transaction_id === null; }
  function isAttach(p) { return p.status === 'attached'; }
  fresh({ failLine: 'l2' }); hook(isRelease, 'error'); var r7 = await W.attachWire(db, pk(), bank, 'u1', {});
  check('payment-failure branch, the bank line cannot be given back (error): 500, cleanup_failed names the held bank line, and it does NOT say "nothing changed"', r7.ok === false && r7.status === 500 && Array.isArray(r7.cleanup_failed) && /still holds bank line bank1/.test(r7.cleanup_failed.join(' ')) && !/nothing changed/.test(r7.error) && pk().bank_transaction_id === 'bank1' && live().length === 0, r7);
  fresh({ failLine: 'l2' }); hook(isRelease, 'zero'); var r8 = await W.attachWire(db, pk(), bank, 'u1', {});
  check('… the release changes ZERO rows and the wire still holds the line: reported the same way', r8.ok === false && r8.status === 500 && /still holds bank line bank1/.test(r8.error) && !/nothing changed/.test(r8.error), r8);
  fresh(); hook(isAttach, 'error'); var r9 = await W.attachWire(db, pk(), bank, 'u1', {});
  check('final-step branch (the wire cannot be marked attached): both payments undone, both lines reopened, bank line given back → truthful "nothing changed", 409', r9.ok === false && r9.status === 409 && live().length === 0 && openLines() === 'l1,l2' && pk().bank_transaction_id === null && pk().status === 'sent' && /nothing changed/.test(r9.error) && r9.cleanup_failed === undefined, [r9, db.t.wire_packages]);
  fresh(); hook(function (p) { return isAttach(p) || isRelease(p); }, 'error'); var r10 = await W.attachWire(db, pk(), bank, 'u1', {});
  check('final-step branch AND the bank line cannot be given back: 500, cleanup_failed, no "nothing changed"', r10.ok === false && r10.status === 500 && /still holds bank line bank1/.test(r10.error) && !/nothing changed/.test(r10.error) && live().length === 0, r10);
  fresh({ failLine: 'l2' }); var r11a = await W.attachWire(db, pk(), bank, 'u1', {}); payFail = null; var r11 = await W.attachWire(db, pk(), bank, 'u1', {});
  check('after a failure whose release WORKED, an immediate retry succeeds (the bank line was free again)', r11a.ok === false && r11a.cleanup_failed === undefined && r11.ok === true && pk().status === 'attached' && live().length === 2, [r11a, r11]);
  fresh({ noFunction: true }); var r6 = await W.attachWire(db, pk(), bank, 'u1', {});
  check('database function NOT installed (US SQL not run): the old two-step way still works — payments written, lines closed, wire attached', r6.ok === true && live().length === 2 && openLines() === '' && pk().status === 'attached', r6);
  console.log('\nVA wire attach compensation: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
