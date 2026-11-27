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
  if (url.indexOf('/api/work-feed/assignments') >= 0) { srv.calls.push({ url: url, action: 'assignments' }); var aj = srv.assignments || { ok: true, tasks: {}, names: {} }; return Promise.resolve({ status: 200, json: function () { return Promise.resolve(aj); } }); } // v55.83-AAH
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

  // ── rev4 (Codex HOLD): the ACTUAL loader. A query error on the first or a LATER page must fail the invoice load; the page keeps the
  // last good list and says "not ok"; the feed keeps the task, resolves nothing, and shows "Invoices: unavailable" ──
  var PF = require(path.join(root, 'src/lib/paged-fetch.js'));
  var rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  async function tryLoad(plan) {
    try {
      var r = await PF.fetchAllPagesStrict(function (from, to) { var p = plan[from / 2]; return Promise.resolve(p === 'error' ? { data: null, error: { message: 'permission denied' } } : p === 'null' ? { data: null, error: null } : { data: rows.slice(from, to + 1), error: null }); }, 2);
      return { ok: true, rows: r };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  var l1 = await tryLoad(['ok', 'ok']);
  check('03a: every page read → all rows, in order (paging unchanged)', l1.ok && l1.rows.map(function (x) { return x.id; }).join() === 'a,b,c');
  var l2 = await tryLoad(['error']);
  check('03b: the FIRST page comes back { data: null, error } → the load fails (it used to read as "no invoices")', !l2.ok && /page 1 could not be read: permission denied/.test(l2.error), l2);
  var l3 = await tryLoad(['ok', 'error']);
  check('03c: a LATER page fails → the whole load fails (never half a list)', !l3.ok && /page 2/.test(l3.error), l3);
  var l4 = await tryLoad(['null']);
  check('03d: a page with no data and no error is a failure too', !l4.ok);
  // loader → page → feed, as page.jsx does it: if (invLoadOk) { setInvoices(inv); } setInvoicesStatus({ ok: invLoadOk, n })
  var lastGood = [{ id: 'i9', order_number: 'EG-9', customer_name: 'Z', total_pending_bank: 250 }];
  srv.calls = [];
  props = { userProfile: { id: 'u-loader', role: 'staff' }, modulePerms: { Treasury: true }, isSuperAdmin: false, invoices: lastGood, invoicesStatus: { ok: true, n: 10 } };
  await flush();
  check('03e: the good load shows the invoice task', feed() && feed().total === 1);
  var again = await tryLoad(['error']); var invLoadOk = again.ok; var pageInvoices = invLoadOk ? again.rows : lastGood;
  props = Object.assign({}, props, { invoices: pageInvoices, invoicesStatus: { ok: invLoadOk, n: 11 } });
  await flush();
  function hasUnavailable(n) { if (!n || typeof n !== 'object') { return false; } if (Array.isArray(n)) { return n.some(hasUnavailable); } if (n.props && n.props['data-testid'] === 'feed-invoices-unavailable') { return true; } return hasUnavailable(n.props && n.props.children); }
  check('03f: after a failed reload the task is still there and Resolved is empty (Codex probe: it resolved invoice_bank:i1)', feed().total === 1 && resolved().length === 0, { total: feed().total, r: resolved() });
  check('03g: and the feed says "Invoices: unavailable"', hasUnavailable(out));
  var P = require('fs').readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
  check('03h: page.jsx reads invoices through the strict loader and keeps the last good list on failure',
    P.indexOf("safe(fetchAllStrict('invoices', 'invoice_date').then(function (r) { invLoadOk = true; return r; }))") > 0 &&
    P.indexOf('if (invLoadOk) { setInvoices(inv); } setInvoicesStatus({ ok: invLoadOk, n: Date.now() });') > 0 &&
    P.indexOf("fetchAllPagesStrict(function (from, to) { return supabase.from(table).select('*').order(orderCol, { ascending: asc }).order('id', { ascending: true }).range(from, to); }, 1000)") > 0);

  // ── v55.83-AAG (Codex AAA-03, its exact repro): good 250 task → its real Go resolve button → the home screen un-mounts and re-mounts
  // (hook state reset) → the invoice reload FAILED while away (page kept its list, says not-ok) → Back. Must NOT say Resolved; must say
  // "could not verify"; the task must still be there (not refreshed). Then a later successful load with the payment matched resolves it. ──
  function findAll(n, pred, acc0) { acc0 = acc0 || []; if (!n || typeof n !== 'object') { return acc0; } if (Array.isArray(n)) { n.forEach(function (x) { findAll(x, pred, acc0); }); return acc0; } if (pred(n)) { acc0.push(n); } findAll(n.props && n.props.children, pred, acc0); return acc0; }
  function txt(n) { if (n === null || n === undefined || typeof n === 'boolean') { return ''; } if (typeof n === 'string' || typeof n === 'number') { return String(n); } if (Array.isArray(n)) { return n.map(txt).join(''); } return txt(n.props && n.props.children); }
  function byTest(id) { return findAll(out, function (n) { return n.props && n.props['data-testid'] === id; }); }
  function resolvedMemReset() { /* each journey signs in as its own person, so the Resolved memory starts empty by itself */ }
  var back1 = [{ id: 'back1', order_number: 'EG-77', customer_name: 'Y', total_pending_bank: 250 }];
  var jumps = [];
  srv.calls = []; resolvedMemReset();
  props = { userProfile: { id: 'u-back', role: 'staff' }, modulePerms: { Treasury: true }, isSuperAdmin: false, invoices: back1, invoicesStatus: { ok: true, n: 20 }, backN: 0, onOpen: function (t) { jumps.push(t); } };
  await flush();
  var go = findAll(out, function (n) { return n.type === 'button' && /Go resolve/.test(txt(n)); })[0];
  check('04a: the good load shows the 250 task with its Go resolve button', feed().total === 1 && !!go);
  go.props.onClick(); await flush();
  check('04b: Go resolve opens that exact invoice', jumps.length === 1 && jumps[0].kind === 'invoice' && jumps[0].id === 'back1');
  // home screen un-mounts while the person is on the invoice; Back re-mounts it (fresh hook state, no on-screen copy)
  H.states = []; H.effects = []; H.refs = [];
  props = Object.assign({}, props, { invoices: back1, invoicesStatus: { ok: false, n: 21 }, backN: 1 });
  await flush();
  check('04c: Back after a FAILED reload: no "Resolved" banner (Codex probe: green RESOLVED, openedStillOpen:false)', byTest('feed-back-resolved').length === 0 && byTest('feed-back-still-open').length === 0);
  check('04d: it says COULD NOT VERIFY — still needs review', byTest('feed-back-unverified').length === 1 && /still needs review/.test(txt(byTest('feed-back-unverified')[0])));
  check('04e: the task is still in To do (Codex probe: feedTotal 0), marked NOT REFRESHED, and nothing went to Resolved', feed().total === 1 && feed().groups[0].stale === true && byTest('feed-group-stale').length === 1 && resolved().length === 0, { total: feed().total, r: resolved() });
  check('04f: the opened task is marked NEEDS REVIEW in the list', /NEEDS REVIEW/.test(txt(out)));
  // the same journey when the page kept no list at all: the copy taken when the person left the feed is used
  H.states = []; H.effects = []; H.refs = []; jumps = []; resolvedMemReset();
  props = Object.assign({}, props, { invoices: back1, invoicesStatus: { ok: true, n: 22 }, backN: 1 });
  await flush();
  findAll(out, function (n) { return n.type === 'button' && /Go resolve/.test(txt(n)); })[0].props.onClick(); await flush();
  H.states = []; H.effects = []; H.refs = [];
  props = Object.assign({}, props, { invoices: [], invoicesStatus: { ok: false, n: 23 }, backN: 2 });
  await flush();
  check('04g: page kept nothing → the copy taken on leaving keeps the task (stale), still COULD NOT VERIFY, nothing resolved', feed().total === 1 && feed().groups[0].stale === true && byTest('feed-back-unverified').length === 1 && resolved().length === 0, { total: feed().total });
  // a later SUCCESSFUL load where the payment is now matched → resolved for real
  props = Object.assign({}, props, { invoices: [{ id: 'back1', order_number: 'EG-77', customer_name: 'Y', total_pending_bank: 0 }], invoicesStatus: { ok: true, n: 24 } });
  await flush();
  check('04h: the next successful load with the payment matched → the task leaves To do and is in Resolved', feed().total === 0 && resolved().length === 1 && resolved()[0].key === 'invoice_bank:back1', { total: feed().total, r: resolved() });
  // and when the reload WORKED, Back still says the truth both ways
  check('04i: backVerdict: own list loaded → Resolved / Still open; own list failed → could not verify (bills/wires use their own lists)',
    WF.backVerdict('invoice_bank:x', 'T', { groups: [] }, { invoicesOk: true, othersOk: true }).openedStillOpen === false &&
    WF.backVerdict('invoice_bank:x', 'T', { groups: [{ items: [{ key: 'invoice_bank:x' }] }] }, { invoicesOk: true, othersOk: false }).openedStillOpen === true &&
    WF.backVerdict('invoice_bank:x', 'T', { groups: [] }, { invoicesOk: false, othersOk: true }).unverified === true &&
    WF.backVerdict('bill_validate:b1', 'T', { groups: [] }, { invoicesOk: true, othersOk: false }).unverified === true &&
    WF.backVerdict('bill_validate:b1', 'T', { groups: [] }, { invoicesOk: false, othersOk: true }).unverified === false);
  // a failed reload while the feed stays open (no Back) marks the group not refreshed too
  props = Object.assign({}, props, { invoices: back1, invoicesStatus: { ok: true, n: 25 } }); await flush();
  props = Object.assign({}, props, { invoicesStatus: { ok: false, n: 26 } }); await flush();
  check('04j: a failed reload with the feed open: the task stays, NOT REFRESHED, nothing resolved', feed().total === 1 && feed().groups[0].stale === true && resolved().filter(function (r) { return r.at && r.key === 'invoice_bank:back1'; }).length === 0);

  console.log('\n' + pass + ' passed, ' + failN + ' failed'); if (failN) { process.exit(1); }
})().catch(function (e) { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
