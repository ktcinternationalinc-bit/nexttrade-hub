// v55.83-AAA rev3 — Codex 27 Nov HOLD AAA-01 / AAA-02: the REAL WorkFeed under an in-memory hook driver (useState / useEffect / useRef)
// with a fake server behind hubFetch. (1) Normal sign-in: the page shows before the person and their switches are known; the feed must
// load when they become ready, and start over for another person. (2) The SAME invoice before and after its bank match (count unchanged)
// must leave the feed and move to Resolved; a FAILED invoice load must never read as resolved.
// Run: node __tests__/test-v55-83-aaa-work-feed-lifecycle.js
var path = require('path'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
function stub(file, exp) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exp; require.cache[id] = m0; }
stub('@supabase/supabase-js', { createClient: function () { return {}; } });
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('AAA rev3 — the feed starts when sign-in finishes; invoice changes are seen by content; failed loads never resolve anything');

// fake server
var srv = { calls: [], bills: [], packages: [] };
stub(path.join(root, 'src/lib/hub-fetch.js'), { hubFetch: function (url, opts) {
  var b = JSON.parse(opts.body); srv.calls.push({ url: url, action: b.action, user: b.user_id });
  var j = url.indexOf('/bills') >= 0 ? { ok: true, bills: srv.bills } : { ok: true, packages: srv.packages, funding_open: [] };
  return Promise.resolve({ status: 200, json: function () { return Promise.resolve(j); } });
} });
// hook driver
var React = require(path.join(root, 'node_modules/react'));
var H = { states: [], effects: [], refs: [], idx: 0, dirty: false, pending: [] };
React.useState = function (init) { var i = H.idx++; if (!(i in H.states)) { H.states[i] = typeof init === 'function' ? init() : init; } return [H.states[i], function (v) { H.states[i] = typeof v === 'function' ? v(H.states[i]) : v; H.dirty = true; }]; };
React.useEffect = function (fn, deps) { var i = H.idx++; var prev = H.effects[i]; var changed = !prev || !deps || deps.some(function (d, k) { return d !== prev.deps[k]; }); if (changed) { H.effects[i] = { deps: deps }; H.pending.push(fn); } };
React.useRef = function (init) { var i = H.idx++; if (!(i in H.refs)) { H.refs[i] = { current: init }; } return H.refs[i]; };
H.idx = 0;
var WF = require(path.join(root, 'src/components/WorkFeed.jsx'));
var props = {}; var out = null;
function render() { H.idx = 0; H.pending = []; out = WF.default(props); var fx = H.pending; H.pending = []; fx.forEach(function (f) { f(); }); }
async function flush() { render(); for (var i = 0; i < 30; i++) { await new Promise(function (r) { setImmediate(r); }); if (H.dirty) { H.dirty = false; render(); i = 0; } } }
function feed() { return H.states[0]; }
function resolved() { return H.states[6] || []; }
function lists() { return srv.calls.filter(function (c) { return c.action === 'list'; }); }

var BILL = { id: 'b1', vendor_name: 'Kronos', bill_number: '14746', status: 'OPEN', record_status: 'active', validation_status: 'pending', created_at: '2026-11-20', due_date: '2026-12-10', total_amount: 500, open: 500 };
var MGR = { 'accounting.clickbooks.access': true, 'bills.manage': true };

(async function () {
  // ── AAA-01: page first, person + switches later ──
  props = { userProfile: null, modulePerms: {}, isSuperAdmin: false, invoices: [], invoicesStatus: null };
  await flush();
  check('01a: before sign-in is known: no request, no panel', lists().length === 0 && out === null);
  props = { userProfile: { id: 'u-staff', role: 'staff' }, modulePerms: {}, isSuperAdmin: false, invoices: [], invoicesStatus: null };
  await flush();
  check('01b: the person is known but the switches are not loaded yet: still no request (nothing to show)', lists().length === 0 && out === null);
  srv.bills = [BILL];
  props = { userProfile: { id: 'u-staff', role: 'staff' }, modulePerms: MGR, isSuperAdmin: false, invoices: [], invoicesStatus: null };
  await flush();
  check('01c: the switches arrive → the feed loads by itself (Codex probe: it used to make zero requests)', lists().length >= 1 && feed() && feed().total === 1, { calls: srv.calls, feed: feed() && feed().total });
  check('01d: it asked with the signed-in person’s id', lists().every(function (c) { return c.user === 'u-staff'; }));
  var n1 = lists().length; await flush();
  check('01e: re-rendering with the same person and switches does not reload', lists().length === n1);
  // another person signs in on the same page
  srv.bills = []; srv.calls = [];
  props = { userProfile: { id: 'u-other', role: 'staff' }, modulePerms: MGR, isSuperAdmin: false, invoices: [], invoicesStatus: null };
  await flush();
  check('01f: another person → a fresh load for them, the first person’s items are gone, nothing moved to Resolved', lists().length >= 1 && lists().every(function (c) { return c.user === 'u-other'; }) && feed().total === 0 && resolved().length === 0, { total: feed() && feed().total, r: resolved() });
  // switches taken away
  srv.calls = [];
  props = { userProfile: { id: 'u-other', role: 'staff' }, modulePerms: {}, isSuperAdmin: false, invoices: [], invoicesStatus: null };
  await flush();
  check('01g: switches taken away → panel gone, no request', out === null && lists().length === 0);

  // ── AAA-02: same invoice, amount changes ──
  srv.calls = []; srv.bills = [];
  var inv1 = [{ id: 'i1', order_number: 'EG-1', customer_name: 'A', total_pending_bank: 100 }];
  props = { userProfile: { id: 'u-tre', role: 'staff' }, modulePerms: { Treasury: true }, isSuperAdmin: false, invoices: inv1, invoicesStatus: { ok: true, n: 1 } };
  await flush();
  check('02a: the invoice with 100.00 EGP pending is one task', feed() && feed().total === 1);
  props = Object.assign({}, props, { invoices: [{ id: 'i1', order_number: 'EG-1', customer_name: 'A', total_pending_bank: 0 }], invoicesStatus: { ok: true, n: 2 } });
  await flush();
  check('02b: the SAME invoice after its bank match (count unchanged) → no task, and it is in Resolved (Codex probe: it stayed 1 / 100.00)', feed().total === 0 && resolved().length === 1 && resolved()[0].key === 'invoice_bank:i1', { total: feed().total, r: resolved() });
  props = Object.assign({}, props, { invoices: [{ id: 'i1', order_number: 'EG-1', customer_name: 'A', total_pending_bank: 40 }], invoicesStatus: { ok: true, n: 3 } });
  await flush();
  check('02c: a NEW pending payment on the same invoice → it is a task again and leaves Resolved', feed().total === 1 && resolved().length === 0 && /40\.00 EGP/.test(feed().groups[0].items[0].issue));
  props = Object.assign({}, props, { invoices: [], invoicesStatus: { ok: false, n: 4 } });
  await flush();
  check('02d: the invoice load FAILED (the page gives an empty list) → the task stays, nothing marked resolved', feed().total === 1 && resolved().length === 0, { total: feed().total, r: resolved() });
  srv.calls = []; H.states[0] && (function () {})();
  // a Refresh while invoices are failed keeps the last good invoice group and resolves nothing
  var refresh = null; (function find(n) { if (!n || typeof n !== 'object') { return; } if (Array.isArray(n)) { n.forEach(find); return; } if (n.type === 'button' && n.props && /Refresh/.test(String([].concat(n.props.children).join('')))) { refresh = n; } find(n.props && n.props.children); })(out);
  if (refresh) { refresh.props.onClick(); } await flush();
  check('02e: ↻ Refresh while the invoice load is failed keeps the last good invoice task, resolves nothing', !!refresh && feed().total === 1 && resolved().length === 0, { found: !!refresh, total: feed() && feed().total });
  props = Object.assign({}, props, { invoices: [{ id: 'i1', order_number: 'EG-1', customer_name: 'A', total_pending_bank: 0 }], invoicesStatus: { ok: true, n: 5 } });
  await flush();
  check('02f: invoices load again and the payment is matched → resolved now', feed().total === 0 && resolved().length === 1);
  props = { userProfile: { id: 'u-tre', role: 'staff' }, modulePerms: { Treasury: true }, isSuperAdmin: false, invoices: inv1, invoicesStatus: null };
  check('02g: helpers: status unknown / failed are not "ready"; the signature follows amounts, not counts', WF.invoicesReady(null) === false && WF.invoicesReady({ ok: false }) === false && WF.invoicesReady({ ok: true }) === true && WF.invoiceSignature(inv1, { ok: true, n: 1 }) !== WF.invoiceSignature([{ id: 'i1', total_pending_bank: 0 }], { ok: true, n: 1 }));

  console.log('\n' + pass + ' passed, ' + failN + ' failed'); if (failN) { process.exit(1); }
})().catch(function (e) { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
