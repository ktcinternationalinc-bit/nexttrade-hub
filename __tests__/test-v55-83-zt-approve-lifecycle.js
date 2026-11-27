// v55.83-ZT rev2 (Codex 27 Nov 07:01 HOLD) — the REAL WeightCheckInvoices component driven through state transitions: an in-memory
// hook driver (useState / useEffect) + a fake server. Presses the same buttons a person does: Show → open the FAIL card → Approved.
// Covers: the answer after a save; an unchanged refresh keeps it; a recheck that CHANGED the figures (reopened) drops the green
// "Saved"; a filtered view hides the decided card but the lasting "Last action" line stays; partly saved; refresh failed after a save;
// an unknown outcome. Run: node __tests__/test-v55-83-zt-approve-lifecycle.js
var path = require('path'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
(function () { var id = require.resolve('@supabase/supabase-js'); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = { createClient: function () { return {}; } }; require.cache[id] = m0; })();
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('ZT — Approved answer lifecycle on the real component');

// ---- the fake server (WarehouseCheckBox stand-in: wcApi, say, num, when, LinkChooser)
var srv = { calls: [], decided: {}, fpSuffix: '', reopen: false, failDecideFor: null, throwDecide: false, previewFails: false };
var bill = { id: 'b-14756', vendor: 'NexPac Corporation', bill_number: '14756', bill_date: '2026-09-28', reference: '80218037' };
function row(label, outcome, billed, received) {
  var k = 'k-' + label; var st = srv.reopen ? 'reopened' : (srv.decided[k] || 'unreviewed'); var open = st === 'unreviewed' || st === 'reopened';
  return { item_key: k, kind: 'product', outcome: outcome, outcome_words: outcome, product_label: label, figures: { basis: 'lb', unit: 'lb', billed: billed, received: received, diff: received - billed, pct: 1 }, bill_ids: [bill.id], bills: [bill], receipts: [], needs_decision: open, outstanding: open, allowed: open ? (outcome === 'matched' ? ['validate_match', 'report_issue'] : ['accept_discrepancy', 'report_issue']) : [], comparison_fp: 'fp-' + label + srv.fpSuffix, state: st, reasons: [] };
}
function rows() { return [row('Texas Thirds', 'matched', 33703.5, 35728), row('Texas Third Folds', 'discrepancy', 3957, 4562)]; }
var box = {
  wcApi: function (p) {
    srv.calls.push(p);
    if (p.action === 'settings_view') { return Promise.resolve({ ok: true, permissions: { validate: true, accept: true, settings: true, super_admin: true }, tolerances: [{ pct: 15 }], lookups: {}, scope: { vendor_names: ['NexPac Corporation'] }, maps: [], vendor_choices: [] }); }
    if (p.action === 'wires_for_check') { return Promise.resolve({ ok: true, wires: [] }); }
    if (p.action === 'report_preview') { if (srv.previewFails) { return Promise.resolve({ ok: false, error: 'Bad Gateway' }); } return Promise.resolve({ ok: true, rows: rows(), feed: { staging: false }, wire: null }); }
    if (p.action === 'decide') {
      if (srv.throwDecide) { return Promise.reject(new Error('connection reset')); }
      if (srv.failDecideFor === p.item_key) { return Promise.resolve({ ok: false, error: 'The figures changed since you opened this' }); }
      srv.decided[p.item_key] = p.kind === 'validate_match' ? 'validated' : (p.kind === 'accept_discrepancy' ? 'accepted' : 'issue_open'); return Promise.resolve({ ok: true });
    }
    return Promise.resolve({ ok: false, error: 'not in the fake' });
  },
  say: function () {}, num: function (n) { return n == null ? '—' : String(n); }, when: function (x) { return String(x || '').substring(11, 16); }, LinkChooser: function () { return null; }, warehouseMappingLabel: function () { return ''; }
};
(function () { var id = path.join(root, 'src/components/WarehouseCheckBox.jsx'); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = box; require.cache[id] = m0; })();

// ---- a tiny hook driver over the real React element tree
var React = require('react');
var H = { states: [], effects: [], idx: 0, dirty: false, pending: [] };
React.useState = function (init) { var i = H.idx++; if (!(i in H.states)) { H.states[i] = typeof init === 'function' ? init() : init; } return [H.states[i], function (v) { H.states[i] = typeof v === 'function' ? v(H.states[i]) : v; H.dirty = true; }]; };
React.useEffect = function (fn, deps) { var i = H.idx++; var prev = H.effects[i]; var changed = !prev || !deps || deps.some(function (d, k) { return d !== prev.deps[k]; }); if (changed) { H.effects[i] = { deps: deps }; H.pending.push(fn); } };
var INV = require(path.join(root, 'src/components/WeightCheckInvoices.jsx'));
var tree = null;
function expand(n) {
  if (n === null || n === undefined || typeof n === 'boolean') { return null; }
  if (typeof n === 'string' || typeof n === 'number') { return String(n); }
  if (Array.isArray(n)) { return n.map(expand); }
  if (typeof n.type === 'function') { return expand(n.type(n.props || {})); }
  if (typeof n.type !== 'string') { return expand(n.props && n.props.children); }
  return { type: n.type, props: n.props || {}, kids: expand(n.props && n.props.children) };
}
function render() { H.idx = 0; H.pending = []; tree = expand(INV.default({ toast: function () {} })); var fx = H.pending; H.pending = []; fx.forEach(function (f) { f(); }); }
async function flush() { for (var i = 0; i < 40; i++) { await new Promise(function (r) { setImmediate(r); }); if (H.dirty) { H.dirty = false; render(); i = 0; } } }
function text(n) { if (n === null) { return ''; } if (typeof n === 'string') { return n; } if (Array.isArray(n)) { return n.map(text).join(''); } return text(n.kids); }
function all(pred, n, out) { out = out || []; n = n === undefined ? tree : n; if (!n || typeof n === 'string') { return out; } if (Array.isArray(n)) { n.forEach(function (x) { all(pred, x, out); }); return out; } if (pred(n)) { out.push(n); } all(pred, n.kids, out); return out; }
function button(label) { return all(function (n) { return n.type === 'button' && text(n).trim().indexOf(label) === 0; })[0]; }
async function click(el) { el.props.onClick(); await flush(); }
async function type(el, v) { el.props.onChange({ target: { value: v } }); await flush(); }
function cardMsg() { var m = all(function (n) { return n.props && n.props['data-testid'] === 'card-message'; })[0]; return m ? text(m) : null; }
function lastAction() { var m = all(function (n) { return n.props && n.props['data-testid'] === 'last-action'; })[0]; return m ? text(m) : null; }
function note() { return all(function (n) { return n.type === 'input' && n.props['aria-label'] === 'Note for Approved or Disputed'; })[0]; }

(async function () {
  render(); await flush();
  await click(button('Show (last reading)'));
  await click(all(function (n) { return n.props && n.props['data-testid'] === 'card-bar'; })[0]);
  check('(set-up) Show → the FAIL card opens with its note box and Approved', !!note() && !!button('Approved'), text(tree).slice(0, 200));
  // 1. no note
  await click(button('Approved'));
  check('Approved with NO note → a red answer ON the card, nothing sent', /^✗ Not saved: this bill is FAIL — type a note in the box/.test(cardMsg() || '') && srv.calls.filter(function (c) { return c.action === 'decide'; }).length === 0, cardMsg());
  // 2. with a note → saved
  await type(note(), 'folds checked, extra was a bonus');
  await click(button('Approved'));
  check('with a note → "✓ Saved — Approved: NexPac Corporation 14756 (2 lines)." ON the card, both lines decided', cardMsg() === '✓ Saved — Approved: NexPac Corporation 14756 (2 lines).' && srv.decided['k-Texas Thirds'] === 'validated' && srv.decided['k-Texas Third Folds'] === 'accepted', [cardMsg(), srv.decided]);
  check('…and the lasting line above the list says the same, time-stamped', /^Last action \(\d\d:\d\d\): NexPac Corporation 14756: Saved — Approved/.test(lastAction() || ''), lastAction());
  // 3. unchanged refresh keeps it
  await click(button('Show (last reading)'));
  check('an UNCHANGED refresh (same figures, still decided) keeps the green answer on the card', cardMsg() === '✓ Saved — Approved: NexPac Corporation 14756 (2 lines).', cardMsg());
  // 4. a filtered view: the decided card leaves "Not decided", the lasting line stays
  await click(button('Not decided'));
  check('FILTER "Not decided": the approved card is not listed, but "Last action … Saved — Approved" is still on screen', !all(function (n) { return n.props && n.props['data-testid'] === 'card-bar'; }).length && /Saved — Approved/.test(lastAction() || ''), [lastAction()]);
  await click(button('All'));
  // 5. a recheck that CHANGED the figures (reopened) → no stale green answer
  srv.fpSuffix = '-v2'; srv.reopen = true;
  await click(button('Check against the warehouse'));
  check('a recheck that CHANGED the figures (new fingerprint, reopened) → the old green "Saved — Approved" is NOT shown; Approved / Disputed are back', cardMsg() === null && !!button('Approved') && !!note(), [cardMsg()]);
  // 6. partly saved
  srv.reopen = false; srv.decided = {}; srv.fpSuffix = '-v3'; srv.failDecideFor = 'k-Texas Third Folds';
  await click(button('Show (last reading)'));
  await type(note(), 'checked again with the yard');
  await click(button('Approved'));
  check('PARTLY saved (second line refused) → amber "⚠ Partly saved: 1 line saved; not saved: Texas Third Folds …" — never "Saved" or "Not saved"', /^⚠ Partly saved: 1 line saved; not saved: Texas Third Folds: The figures changed/.test(cardMsg() || ''), cardMsg());
  // 7. saved but the refresh failed
  srv.failDecideFor = null; srv.decided = {}; srv.fpSuffix = '-v4';
  await click(button('Show (last reading)'));
  await type(note(), 'third try, all good');
  srv.previewFails = true;
  await click(button('Approved'));
  check('SAVED but the refresh FAILED → amber "⚠ Saved — … The list could not be refreshed — press Show (last reading)"; the list is kept, not replaced by an error', /^⚠ Saved — Approved: NexPac Corporation 14756 \(2 lines\)\. The list could not be refreshed/.test(cardMsg() || '') && all(function (n) { return n.props && n.props['data-testid'] === 'card-bar'; }).length === 1, cardMsg());
  // 8. unknown outcome
  srv.previewFails = false; srv.decided = {}; srv.fpSuffix = '-v5';
  await click(button('Show (last reading)'));
  await type(note(), 'fourth try with a dropped line');
  srv.throwDecide = true;
  await click(button('Approved'));
  check('an UNKNOWN outcome (the request failed mid-way) → "⚠ Could not confirm whether this was saved … press Show (last reading)" — never claims "Not saved"', /^⚠ Could not confirm whether this was saved \(connection reset\) — press Show \(last reading\)/.test(cardMsg() || '') && !/Not saved/.test(cardMsg() || ''), cardMsg());
  console.log('\nZT approve lifecycle: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('  ✗ FAIL: crashed ' + (e && e.stack)); process.exit(1); });
