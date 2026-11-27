// v55.83-ZU — Max 27 Nov (bill 14746): every line was already decided (4 validated + Fabrics accepted at 07:23 UTC), yet the card still
// offered Approved; pressing it re-sent all 5 lines and each was refused "already decided". Cause: the server marks a line decidable
// even after it is decided (needs_decision = the outcome allows a decision), and the screen read that as "still to decide". Now only
// lines not yet validated / accepted / resolved are open; a fully reviewed bill reads "PASS — REVIEWED" (Max: "if all approved the
// entire grouping should get a passing status … PASSING - REVIEWED, different from something just Passing on the first run").
// The REAL WeightCheckInvoices with an in-memory hook driver + a fake server. Run: node __tests__/test-v55-83-zu-reviewed.js
var path = require('path'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
function stub(file, exp) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exp; require.cache[id] = m0; }
stub('@supabase/supabase-js', { createClient: function () { return {}; } });
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('ZU — a reviewed bill is PASS — REVIEWED; Approved never re-sends decided lines');

var srv = { decided: {}, dec: {}, calls: [] };
var bill = { id: 'b-14746', vendor: 'NexPac Corporation', bill_number: '14746', bill_date: '2026-09-24', reference: '80217625' };
var LINES = [['Paper · Paper Canada', 'matched'], ['Boat Decking · Boat Decking', 'matched'], ['Leather · Thirds Canada', 'matched'], ['Fabrics · Fabrics Canada', 'discrepancy'], ['Leather · Seconds Canada', 'matched']];
function rows() {
  return LINES.map(function (l) {
    var k = 'k-' + l[0]; var st = srv.decided[k] || 'unreviewed';
    // as the REAL route: needs_decision follows the OUTCOME (true even after a decision); outstanding follows the state
    return { item_key: k, kind: 'product', outcome: l[1], outcome_words: l[1], product_label: l[0], figures: { basis: 'lb', unit: 'lb', billed: 1000, received: 1080, diff: 80, pct: 8 }, bill_ids: [bill.id], bills: [bill], receipts: [], needs_decision: true, outstanding: st === 'unreviewed', allowed: l[1] === 'matched' ? ['validate_match', 'report_issue'] : ['accept_discrepancy', 'report_issue'], comparison_fp: 'fp-' + k, state: st, reasons: [], decision: st === 'unreviewed' ? null : (srv.dec[k] || { kind: st === 'validated' ? 'validate_match' : 'accept_discrepancy', reason: 'fabric is ok at thistolerance', actor_name: 'Max', at: '2026-11-27T07:23:51Z' }) };
  });
}
stub(path.join(root, 'src/components/WarehouseCheckBox.jsx'), {
  wcApi: function (p) {
    srv.calls.push(p);
    if (p.action === 'settings_view') { return Promise.resolve({ ok: true, permissions: { validate: true, accept: true, settings: true, super_admin: true }, tolerances: [{ pct: 15 }], lookups: {}, scope: { vendor_names: ['NexPac Corporation'] }, maps: [], vendor_choices: [] }); }
    if (p.action === 'wires_for_check') { return Promise.resolve({ ok: true, wires: [] }); }
    if (p.action === 'report_preview') { return Promise.resolve({ ok: true, rows: rows(), feed: { staging: false }, wire: null }); }
    if (p.action === 'decide') {
      if (srv.decided[p.item_key]) { return Promise.resolve({ ok: false, error: 'This is already decided and unchanged — reopen it first (with a reason) to decide again.', http_status: 409 }); }
      srv.decided[p.item_key] = p.kind === 'validate_match' ? 'validated' : 'accepted'; srv.dec[p.item_key] = { kind: p.kind, reason: p.reason, actor_name: 'Ahmed', at: '2026-11-27T09:05:00Z' }; return Promise.resolve({ ok: true });
    }
    return Promise.resolve({ ok: false, error: 'not in the fake' });
  },
  say: function () {}, num: function (n) { return n == null ? '—' : String(n); }, when: function (x) { return String(x || '').substring(11, 16); }, LinkChooser: function () { return null; }, warehouseMappingLabel: function () { return ''; }
});
var React = require('react');
var H = { states: [], effects: [], idx: 0, dirty: false, pending: [] };
React.useState = function (init) { var i = H.idx++; if (!(i in H.states)) { H.states[i] = typeof init === 'function' ? init() : init; } return [H.states[i], function (v) { H.states[i] = typeof v === 'function' ? v(H.states[i]) : v; H.dirty = true; }]; };
React.useEffect = function (fn, deps) { var i = H.idx++; var prev = H.effects[i]; var changed = !prev || !deps || deps.some(function (d, k) { return d !== prev.deps[k]; }); if (changed) { H.effects[i] = { deps: deps }; H.pending.push(fn); } };
var INV = require(path.join(root, 'src/components/WeightCheckInvoices.jsx'));
var tree = null;
function expand(n) { if (n === null || n === undefined || typeof n === 'boolean') { return null; } if (typeof n === 'string' || typeof n === 'number') { return String(n); } if (Array.isArray(n)) { return n.map(expand); } if (typeof n.type === 'function') { return expand(n.type(n.props || {})); } if (typeof n.type !== 'string') { return expand(n.props && n.props.children); } return { type: n.type, props: n.props || {}, kids: expand(n.props && n.props.children) }; }
function render() { H.idx = 0; H.pending = []; tree = expand(INV.default({ toast: function () {} })); var fx = H.pending; H.pending = []; fx.forEach(function (f) { f(); }); }
async function flush() { for (var i = 0; i < 40; i++) { await new Promise(function (r) { setImmediate(r); }); if (H.dirty) { H.dirty = false; render(); i = 0; } } }
function text(n) { if (n === null) { return ''; } if (typeof n === 'string') { return n; } if (Array.isArray(n)) { return n.map(text).join(''); } return text(n.kids); }
function all(pred, n, out) { out = out || []; n = n === undefined ? tree : n; if (!n || typeof n === 'string') { return out; } if (Array.isArray(n)) { n.forEach(function (x) { all(pred, x, out); }); return out; } if (pred(n)) { out.push(n); } all(pred, n.kids, out); return out; }
function button(label) { return all(function (n) { return n.type === 'button' && text(n).trim().indexOf(label) === 0; })[0]; }
async function click(el) { el.props.onClick(); await flush(); }
async function type(el, v) { el.props.onChange({ target: { value: v } }); await flush(); }
function bar() { var b = all(function (n) { return n.props && n.props['data-testid'] === 'card-bar'; })[0]; return b ? text(b) : null; }
function note() { return all(function (n) { return n.type === 'input' && n.props['aria-label'] === 'Note for Approved or Disputed'; })[0]; }
function decides() { return srv.calls.filter(function (c) { return c.action === 'decide'; }); }
async function openCard() { var b = all(function (n) { return n.props && n.props['data-testid'] === 'card-bar'; })[0]; if (b && !/CLOSE/.test(text(b))) { await click(b); } }

(async function () {
  // A. Max's exact case: every line already decided
  LINES.forEach(function (l) { srv.decided['k-' + l[0]] = l[1] === 'matched' ? 'validated' : 'accepted'; });
  render(); await flush(); await click(button('Show (last reading)')); await openCard(); srv.calls = [];
  check('BILL 14746 (all 5 lines already decided, Fabrics accepted): the closed bar reads "PASS — REVIEWED" with a "DIFFERENCE ACCEPTED" tag', /^\s*PASS — REVIEWED\s*DIFFERENCE ACCEPTED/.test(bar() || ''), bar());
  check('…and the card offers NO Approved / Disputed and no note box (nothing left to decide) — so nothing can be re-sent', !button('Approved') && !note() && decides().length === 0, [!!button('Approved'), !!note()]);
  var hdr = all(function (n) { return n.type === 'span' && text(n) === 'PASS — REVIEWED'; });
  check('…the opened card says PASS — REVIEWED in its header too, while the Fabrics line keeps its own FAIL with "discrepancy accepted"', hdr.length >= 1 && all(function (n) { return n.type === 'span' && text(n) === 'FAIL'; }).length >= 1, hdr.length);
  function history() { var h = all(function (n) { return n.props && n.props['data-testid'] === 'review-history'; })[0]; return h ? text(h) : null; }
  var cr = INV.cardResult(INV.groupInvoices(rows())[0]);
  check('PASS — REVIEWED is a solid GREEN block, the same green as PASS', cr.label === 'PASS — REVIEWED' && cr.bg === '#22c55e', cr);
  check('BOTTOM of the opened card: "Review history — ✓ Reviewed by Max · 07:23 · 4 lines validated, 1 difference accepted · note: “fabric is ok at thistolerance”"', /Review history/.test(history() || '') && /✓ Reviewed by Max · 07:23 · 4 lines validated, 1 difference accepted · note: “fabric is ok at thistolerance”/.test(history() || ''), history());
  // B. a partly decided bill: Approved sends ONLY the open lines
  srv.decided = { 'k-Paper · Paper Canada': 'validated', 'k-Boat Decking · Boat Decking': 'validated' };
  await click(button('Show (last reading)')); await openCard(); srv.calls = [];
  check('(set-up) partly decided (2 of 5): the bar is still FAIL (Fabrics open) and Approved is offered', /^\s*FAIL/.test(bar() || '') && !!button('Approved'), bar());
  await type(note(), 'fabric is ok at this tolerance'); await click(button('Approved'));
  var sent = decides().map(function (c) { return c.item_key; });
  check('Approved on a partly decided bill sends ONLY the 3 open lines (never the 2 already decided) — no "already decided" refusal', sent.length === 3 && sent.indexOf('k-Paper · Paper Canada') < 0 && sent.indexOf('k-Boat Decking · Boat Decking') < 0 && !/already decided/.test(JSON.stringify(srv.calls)), sent);
  check('…after the save the bill reads "PASS — REVIEWED + DIFFERENCE ACCEPTED" and the buttons are gone', /^\s*PASS — REVIEWED\s*DIFFERENCE ACCEPTED/.test(bar() || '') && !button('Approved'), bar());
  check('…and the history lists BOTH reviews: Max at 07:23 (2 lines validated) and Ahmed at 09:05 (2 validated, 1 difference accepted) with the note', /✓ Reviewed by Max · 07:23 · 2 lines validated/.test(history() || '') && /✓ Reviewed by Ahmed · 09:05 · 2 lines validated, 1 difference accepted · note: “fabric is ok at this tolerance”/.test(history() || ''), history());
  var stale = INV.reviewSummary({ rows: [{ state: 'needs_revalidation', decision: { kind: 'validate_match', reason: 'ok then', actor_name: 'Max', at: '2026-11-25T10:00:00Z' } }] });
  check('figures changed after a review: "Previously reviewed by Max · 10:00 · 1 line validated · note: “ok then” — the figures changed since; decide again"', stale.length === 1 && stale[0].stale === true && stale[0].text === 'Previously reviewed by Max · 10:00 · 1 line validated · note: “ok then” — the figures changed since; decide again', stale);
  check('a bill nobody has reviewed shows no review history', INV.reviewSummary({ rows: [{ state: 'unreviewed', decision: null }] }).length === 0);
  // C. first run: an untouched all-matching bill is plain PASS (not REVIEWED)
  LINES[3][1] = 'matched'; srv.decided = {};
  await click(button('Show (last reading)'));
  check('a bill that simply passes on the first run reads plain "PASS" — different from "PASS — REVIEWED"', /^\s*PASS(?! — )/.test(bar() || '') && !/REVIEWED/.test(bar() || ''), bar());
  // pure: the open-line rule
  check('openForDecision: a decided line (validated / accepted / resolved) is never open, even though the server still marks it decidable', INV.openForDecision({ needs_decision: true, state: 'validated' }) === false && INV.openForDecision({ needs_decision: true, state: 'accepted' }) === false && INV.openForDecision({ needs_decision: true, state: 'unreviewed' }) === true && INV.openForDecision({ needs_decision: true, state: 'needs_revalidation' }) === true && INV.openForDecision({ needs_decision: false, state: 'unreviewed' }) === false);
  var fs = require('fs'); var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
  var topV = (/version: '([^']+)'/.exec(wn.substring(wn.indexOf('BUILD_HISTORY = ['))) || [])[1];
  check('badge and What\'s New name the newest entry, and the ZU entry exists', wn.indexOf("version: 'v55.83-ZU'") >= 0 && page.indexOf(topV) >= 0, topV);
  console.log('\nZU reviewed: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('  ✗ FAIL: crashed ' + (e && e.stack)); process.exit(1); });
