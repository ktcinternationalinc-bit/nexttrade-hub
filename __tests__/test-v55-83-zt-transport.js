// v55.83-ZT rev3 (Codex 27 Nov 07:12 HOLD) — a lost or unreadable server answer is UNKNOWN, never "not saved". The REAL Invoices
// component + the REAL WarehouseCheckBox wcApi; only hubFetch (the network) is faked. Each request can be: answered, lost AFTER the
// server saved it, lost BEFORE, answered unreadably (502, no JSON), or refused (409 JSON). Run: node __tests__/test-v55-83-zt-transport.js
var path = require('path'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
function stub(file, exp) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exp; require.cache[id] = m0; }
stub('@supabase/supabase-js', { createClient: function () { return {}; } });
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('ZT — real wcApi: lost / unreadable answers are reconciled, never guessed');

// ---- the fake network under the REAL wcApi
var srv = { decided: {}, notes: {}, linked: false, preview: false, plan: {}, calls: [] };
var bill = { id: 'b-14756', vendor: 'NexPac Corporation', bill_number: '14756', bill_date: '2026-09-28', reference: '80218037' };
function row(label, outcome) {
  var k = 'k-' + label; var st = srv.decided[k] || 'unreviewed'; var open = st === 'unreviewed';
  var r = { item_key: k, kind: 'product', outcome: outcome, outcome_words: outcome, product_label: label, figures: { basis: 'lb', unit: 'lb', billed: 1000, received: 1100, diff: 100, pct: 10 }, bill_ids: [bill.id], bills: [bill], receipts: [], needs_decision: open, outstanding: open, allowed: open ? (outcome === 'matched' ? ['validate_match', 'report_issue'] : ['accept_discrepancy', 'report_issue']) : [], comparison_fp: 'fp-' + label, state: st, reasons: [],
    // as the real route (itemPublic): the decision (kind + note) and the confirmed links are on the row — the evidence a re-read gives
    decision: srv.decided[k] ? { kind: srv.decided[k] === 'validated' ? 'validate_match' : (srv.decided[k] === 'accepted' ? 'accept_discrepancy' : 'report_issue'), reason: srv.notes[k] } : null,
    links: srv.linked ? [{ bill_id: bill.id, receipt_id: '2216', state: 'confirmed' }] : [] };
  if (srv.preview && !srv.linked) { r.preview = true; r.needs_decision = false; r.outstanding = false; r.allowed = []; r.state = 'awaiting_link'; r.proposed_receipt = { receipt_id: '2216', bases: ['reference_number'], bill_value: '80218037', receipt_value: '80218037' }; }
  return r;
}
function rows() {
  var out = [row('Texas Thirds', 'matched'), row('Texas Third Folds', 'discrepancy')];
  if (srv.preview && !srv.linked) { out.push({ item_key: 'b:' + bill.id + '|unlinked', kind: 'bill', outcome: 'cannot_compare', needs_link: true, preview_available: true, bill_ids: [bill.id], bills: [bill], candidates: [{ receipt_id: '2216', bases: ['reference_number'] }], outstanding: true, state: 'unreviewed', reasons: [] }); }
  return out;
}
function answer(body) {
  if (body.action === 'settings_view') { return { ok: true, permissions: { validate: true, accept: true, settings: true, super_admin: true }, tolerances: [{ pct: 15 }], lookups: {}, scope: { vendor_names: ['NexPac Corporation'] }, maps: [], vendor_choices: [] }; }
  if (body.action === 'wires_for_check') { return { ok: true, wires: [] }; }
  if (body.action === 'report_preview') { return { ok: true, rows: rows(), feed: { staging: false }, wire: null }; }
  if (body.action === 'link') { srv.linked = true; return { ok: true }; }
  if (body.action === 'decide') { srv.notes[body.item_key] = body.reason; srv.decided[body.item_key] = body.kind === 'validate_match' ? 'validated' : (body.kind === 'accept_discrepancy' ? 'accepted' : 'issue_open'); return { ok: true }; }
  return { ok: false, error: 'not in the fake' };
}
function respond(status, obj) { return { status: status, json: function () { return Promise.resolve(obj); } }; }
stub(path.join(root, 'src/lib/hub-fetch.js'), { hubFetch: function (url, opts) {
  var body = JSON.parse(opts.body); srv.calls.push(body);
  var key = body.action === 'decide' ? 'decide:' + body.item_key : body.action; var how = srv.plan[key] || 'ok';
  if (how === 'lost-after') { answer(body); return Promise.reject(new TypeError('Failed to fetch')); }
  if (how === 'lost-before') { return Promise.reject(new TypeError('Failed to fetch')); }
  if (how === 'unreadable') { return Promise.resolve({ status: 502, json: function () { return Promise.reject(new SyntaxError('Unexpected token <')); } }); }
  if (how === 'refuse') { return Promise.resolve(respond(409, { ok: false, error: 'The figures changed since you opened this — look at them again before deciding.' })); }
  if (how === 'down') { return Promise.reject(new TypeError('Failed to fetch')); }
  return Promise.resolve(respond(200, answer(body)));
} });
var BOX = require(path.join(root, 'src/components/WarehouseCheckBox.jsx'));

// ---- the same in-memory hook driver as the lifecycle test
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
function cardMsg() { var m = all(function (n) { return n.props && n.props['data-testid'] === 'card-message'; })[0]; return m ? text(m) : null; }
function note() { return all(function (n) { return n.type === 'input' && n.props['aria-label'] === 'Note for Approved or Disputed'; })[0]; }
function decides() { return srv.calls.filter(function (c) { return c.action === 'decide'; }).length; }
async function fresh(opts) { srv.decided = {}; srv.notes = {}; srv.linked = false; srv.preview = !!(opts && opts.preview); srv.plan = {}; await click(button('Show (last reading)')); var bar = all(function (n) { return n.props && n.props['data-testid'] === 'card-bar'; })[0]; if (bar && !note()) { await click(bar); } srv.calls = []; }
async function approve(plan) { srv.plan = plan; await type(note(), 'checked against the scale tickets'); await click(button('Approved')); }

(async function () {
  // 0. the real wcApi itself
  srv.plan = { report_preview: 'down' }; var w1 = await BOX.wcApi({ action: 'report_preview' });
  srv.plan = { report_preview: 'unreadable' }; var w2 = await BOX.wcApi({ action: 'report_preview' });
  srv.plan = { report_preview: 'refuse' }; var w3 = await BOX.wcApi({ action: 'report_preview' }); srv.plan = {};
  check('REAL wcApi: server unreachable → { ok:false, uncertain:true }; unreadable 502 → uncertain; an explicit 409 refusal → NOT uncertain (a real "no")', w1.ok === false && w1.uncertain === true && /Could not reach the Hub server/.test(w1.error) && w2.uncertain === true && w2.http_status === 502 && w3.ok === false && !w3.uncertain && w3.http_status === 409, [w1, w2, w3]);
  render(); await flush();
  // 1. response lost AFTER the server saved line 2
  await fresh(); await approve({ 'decide:k-Texas Third Folds': 'lost-after' });
  check('answer LOST after the server saved it → re-read → "Saved — Approved: NexPac Corporation 14756 (2 lines), confirmed after a connection problem." (never "not saved")', cardMsg() === '✓ Saved — Approved: NexPac Corporation 14756 (2 lines), confirmed after a connection problem.' && srv.decided['k-Texas Third Folds'] === 'accepted', cardMsg());
  // 2. unreadable answer on line 1 (not saved) → stop; line 2 never sent
  await fresh(); await approve({ 'decide:k-Texas Thirds': 'unreadable' });
  check('UNREADABLE answer (502, no JSON) on line 1 → it stops (1 decide sent, line 2 not sent), re-reads: "not saved: Texas Thirds; not sent: Texas Third Folds. Press Approved again for the rest."', decides() === 1 && cardMsg() === '⚠ Connection problem — checked again: not saved: Texas Thirds; not sent: Texas Third Folds. Press Approved again for the rest.', [decides(), cardMsg()]);
  // 3. partial known success + an uncertain remainder (lost before saving)
  await fresh(); await approve({ 'decide:k-Texas Third Folds': 'lost-before' });
  check('PARTIAL: line 1 saved, line 2 lost BEFORE saving → "1 line saved; not saved: Texas Third Folds"', cardMsg() === '⚠ Connection problem — checked again: 1 line saved; not saved: Texas Third Folds. Press Approved again for the rest.', cardMsg());
  // 4. an ordinary explicit refusal stays a refusal (no "connection problem")
  await fresh(); await approve({ 'decide:k-Texas Third Folds': 'refuse' });
  check('an EXPLICIT refusal (409 JSON) is a refusal: "Partly saved: 1 line saved; not saved: Texas Third Folds: The figures changed…" — no "connection problem"', /^⚠ Partly saved: 1 line saved; not saved: Texas Third Folds: The figures changed since you opened this/.test(cardMsg() || '') && !/Connection problem/.test(cardMsg() || ''), cardMsg());
  // 5. the answer is lost AND the re-read fails → say it cannot be confirmed, check before retrying
  await fresh(); srv.plan = { 'decide:k-Texas Thirds': 'lost-after' }; await type(note(), 'checked against the scale tickets');
  var realPlan = srv.plan; srv.plan = new Proxy(realPlan, { get: function (t, k) { if (k === 'report_preview' && srv.calls.some(function (c) { return c.action === 'decide'; })) { return 'down'; } return t[k]; } });
  await click(button('Approved'));
  check('answer lost AND the re-read fails → "Connection problem: could not confirm whether Texas Thirds was saved … Press Show (last reading) and check the card before pressing Approved again." — never "not saved", never a blind retry', /^⚠ Connection problem: could not confirm whether Texas Thirds was saved \(Could not reach the Hub server\.\)\. Press Show \(last reading\) and check the card before pressing Approved again\.$/.test(cardMsg() || ''), cardMsg());
  srv.plan = {};
  // 6. the RECEIPT confirm (link POST) on a preview card: answer lost after it was saved
  await fresh({ preview: true });
  check('(set-up) a preview card (receipt not confirmed yet) shows Approved', !!button('Approved') && srv.preview && !srv.linked);
  await approve({ link: 'lost-after' });
  check('the receipt-confirm answer LOST after saving → re-read → "warehouse receipt 2216 WAS confirmed, but nothing was approved yet. Look at the card and press Approved again." — no decision sent', /^⚠ Connection problem — checked again: warehouse receipt 2216 WAS confirmed, but nothing was approved yet\. Look at the card and press Approved again\.$/.test(cardMsg() || '') && decides() === 0 && srv.linked === true, [cardMsg(), decides()]);
  await fresh({ preview: true }); await approve({ link: 'lost-before' });
  check('…lost BEFORE saving → "warehouse receipt 2216 was NOT confirmed. Nothing was saved — press Approved again."', /^⚠ Connection problem — checked again: warehouse receipt 2216 was NOT confirmed\. Nothing was saved — press Approved again\.$/.test(cardMsg() || ''), cardMsg());
  // ---- Codex 07:14 caution: no conclusion from absence — only affirmative evidence of THIS line / receipt
  var R = INV.reconcileWords; var invB = { bills: [bill] };
  var unc = { uncertain: true, wrote: 0, error: 'Could not reach the Hub server.', uncertainLines: [{ key: 'k-A', label: 'Line A', fp: 'fp-A', kind: 'validate_match', reason: 'my note' }], notSent: [], failed: [] };
  var lnk = { uncertain: true, linkUnknown: true, receipt: '2216', wrote: 0, uncertainLines: [], notSent: [], failed: [], error: 'Could not reach the Hub server.' };
  function rowA(o) { return Object.assign({ item_key: 'k-A', bill_ids: [bill.id], comparison_fp: 'fp-A', state: 'validated', decision: { kind: 'validate_match', reason: 'my note' }, links: [] }, o || {}); }
  var cases = [
    ['EMPTY re-read (no rows at all)', R(unc, { ok: true, rows: [] }, invB, 'approve', 'X')],
    ['FILTERED re-read (the line is not in it)', R(unc, { ok: true, rows: [rowA({ item_key: 'k-OTHER' })] }, invB, 'approve', 'X')],
    ['CHANGED fingerprint (the figures moved)', R(unc, { ok: true, rows: [rowA({ comparison_fp: 'fp-A2' })] }, invB, 'approve', 'X')],
    ['decided, but by a DIFFERENT note (another person / an earlier decision)', R(unc, { ok: true, rows: [rowA({ decision: { kind: 'validate_match', reason: 'someone else' } })] }, invB, 'approve', 'X')],
    ['decided, but a different KIND', R(unc, { ok: true, rows: [rowA({ state: 'accepted', decision: { kind: 'accept_discrepancy', reason: 'my note' } })] }, invB, 'approve', 'X')]
  ];
  cases.forEach(function (c) { check('reconcile, decision — ' + c[0] + ' → "cannot tell" (never "saved", never "not saved")', /cannot tell: Line A/.test(c[1].text) && !/not saved: Line A/.test(c[1].text) && !/^Saved/.test(c[1].text) && c[1].kind === 'warn', c[1].text); });
  var proved = R(unc, { ok: true, rows: [rowA()] }, invB, 'approve', 'NexPac 14756'); var provedNot = R(unc, { ok: true, rows: [rowA({ state: 'unreviewed', decision: null })] }, invB, 'approve', 'X');
  check('reconcile, decision — SAME line + fingerprint decided by THIS kind + note → "Saved … confirmed after a connection problem"; the same line still unreviewed → "not saved"', proved.kind === 'ok' && /^Saved — Approved: NexPac 14756 \(1 line\), confirmed after a connection problem\.$/.test(proved.text) && /not saved: Line A/.test(provedNot.text), [proved, provedNot]);
  var lcases = [
    ['EMPTY re-read', R(lnk, { ok: true, rows: [] }, invB, 'approve', 'X')],
    ['a preview of ANOTHER receipt', R(lnk, { ok: true, rows: [rowA({ preview: true, proposed_receipt: { receipt_id: '9999' }, links: [] })] }, invB, 'approve', 'X')],
    ['a confirmed link to ANOTHER receipt', R(lnk, { ok: true, rows: [rowA({ links: [{ bill_id: bill.id, receipt_id: '9999', state: 'confirmed' }] })] }, invB, 'approve', 'X')],
    ['a REJECTED link to this receipt', R(lnk, { ok: true, rows: [rowA({ links: [{ bill_id: bill.id, receipt_id: '2216', state: 'rejected' }] })] }, invB, 'approve', 'X')]
  ];
  lcases.forEach(function (c) { check('reconcile, receipt — ' + c[0] + ' → "cannot tell whether warehouse receipt 2216 was confirmed"', /cannot tell whether warehouse receipt 2216 was confirmed/.test(c[1].text), c[1].text); });
  console.log('\nZT transport: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('  ✗ FAIL: crashed ' + (e && e.stack)); process.exit(1); });
