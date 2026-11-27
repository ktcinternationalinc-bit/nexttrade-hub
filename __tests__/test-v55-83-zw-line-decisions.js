// v55.83-ZW — Max 27 Nov (bill 14743: 4 lines PASS, Fabrics Canada FAIL +28.9%): "i should be able to put approved and a note on each
// failure not just on the whole.."; "Second signature cannot be completed until all are passing. from the warehouse check"; and "there
// should be a link to the actual invoice that i can open right from there as a pop up and then close which will keep me on the same
// page and location and bill". The REAL WeightCheckInvoices with an in-memory hook driver + a route-shaped fake server.
// Run: node __tests__/test-v55-83-zw-line-decisions.js
var path = require('path'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
function stub(file, exp) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exp; require.cache[id] = m0; }
stub('@supabase/supabase-js', { createClient: function () { return {}; } });
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('ZW — Approved / Disputed + a note on EACH failing line; the bill waits for them; the invoice in a pop-up');

var srv = { decided: {}, dec: {}, calls: [], plan: {}, lines: null, perms: null };
var bill = { id: 'b-14743', vendor: 'NexPac Corporation', bill_number: '14743', bill_date: '2026-09-15', reference: '80216838', attachment_path: 'pv/2026/14743.pdf' };
var L14743 = [['Paper · Paper Canada', 'matched'], ['Leather · Thirds Canada', 'matched'], ['Leather · Seconds Canada', 'matched'], ['Boat Decking · Boat Decking', 'matched'], ['Fabrics · Fabrics Canada', 'discrepancy']];
function rows() {
  return (srv.lines || L14743).map(function (l) {
    var k = 'k-' + l[0]; var st = srv.decided[k] || 'unreviewed'; var d = srv.dec[k] || null;
    var fab = l[1] !== 'matched'; var blocked = l[1] === 'mapping_conflict'; if (blocked) { st = 'blocked'; }
    return { item_key: k, kind: 'product', outcome: l[1], outcome_words: fab ? 'billed LESS than scanned beyond the tolerance' : 'matched', product_label: l[0],
      figures: fab ? { basis: 'lb', unit: 'lb', billed: 301, received: 388, diff: 87, pct: 28.9 } : { basis: 'lb', unit: 'lb', billed: 1000, received: 1050, diff: 50, pct: 5 },
      bill_ids: [bill.id], bills: [bill], receipts: [], needs_decision: !blocked, outstanding: ['validated', 'accepted', 'resolved'].indexOf(st) < 0, allowed: blocked ? [] : fab ? ['accept_discrepancy', 'report_issue'] : ['validate_match', 'report_issue'],
      comparison_fp: 'fp-' + k, state: st, reasons: fab ? ['billed LESS than scanned beyond the tolerance'] : [], decision: d, issue: st === 'issue_open' ? d : null, history: d ? [d] : [] };
  });
}
stub(path.join(root, 'src/components/WarehouseCheckBox.jsx'), {
  wcApi: function (p) {
    srv.calls.push(p);
    if (p.action === 'settings_view') { return Promise.resolve({ ok: true, permissions: srv.perms || { validate: true, accept: true, settings: true, super_admin: true }, tolerances: [{ pct: 15 }], lookups: {}, scope: { vendor_names: ['NexPac Corporation'] }, maps: [], vendor_choices: [] }); }
    if (p.action === 'wires_for_check') { return Promise.resolve({ ok: true, wires: [] }); }
    if (p.action === 'report_preview') { return Promise.resolve({ ok: true, rows: rows(), feed: { staging: false }, wire: null }); }
    if (p.action === 'decide') {
      var how = srv.plan[p.item_key];
      if (how === 'lost-after') { save(p); return Promise.resolve({ ok: false, uncertain: true, error: 'Could not reach the Hub server.' }); }
      if (how === 'refuse') { return Promise.resolve({ ok: false, error: 'The figures changed since you opened this — look at them again before deciding.', http_status: 409 }); }
      if (how === 'lost-before') { return Promise.resolve({ ok: false, uncertain: true, error: 'Could not reach the Hub server.' }); }
      if (srv.decided[p.item_key]) { return Promise.resolve({ ok: false, error: 'This is already decided and unchanged — reopen it first (with a reason) to decide again.', http_status: 409 }); }
      save(p); return Promise.resolve({ ok: true });
    }
    return Promise.resolve({ ok: false, error: 'not in the fake' });
  },
  say: function () {}, num: function (n) { return n == null ? '—' : String(n); }, when: function (x) { return String(x || '').substring(11, 16); }, LinkChooser: function () { return null; }, warehouseMappingLabel: function () { return ''; }
});
function save(p) { srv.decided[p.item_key] = p.kind === 'validate_match' ? 'validated' : p.kind === 'accept_discrepancy' ? 'accepted' : 'issue_open'; srv.dec[p.item_key] = { id: 'd-' + p.item_key, kind: p.kind, reason: p.reason, actor: 'u-max', actor_name: 'Max', at: '2026-11-27T13:30:00Z' }; }
// the real viewer signs storage links; here it only has to show WHICH bill it was given
stub(path.join(root, 'src/components/BillDocViewer.jsx'), { __esModule: true, default: function (props) { return { type: 'div', props: { 'data-testid': 'doc-viewer', children: 'viewer:' + (props.bill && props.bill.attachment_path) } }; } });
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
function byId(id) { return all(function (n) { return n.props && n.props['data-testid'] === id; }); }
function button(label) { return all(function (n) { return n.type === 'button' && text(n).trim().indexOf(label) === 0; })[0]; }
async function click(el) { el.props.onClick({ stopPropagation: function () {} }); await flush(); }
async function type(el, v) { el.props.onChange({ target: { value: v } }); await flush(); }
function bar() { var b = byId('card-bar')[0]; return b ? text(b) : null; }
function lineNote(label) { return all(function (n) { return n.type === 'input' && n.props['aria-label'] === 'Note for ' + label; })[0]; }
function decides() { return srv.calls.filter(function (c) { return c.action === 'decide'; }); }
function msgs() { return byId('card-message').map(text); }
async function fresh(lines) { srv.decided = {}; srv.dec = {}; srv.plan = {}; srv.lines = lines || null; await click(button('Show (last reading)')); var b = byId('card-bar')[0]; if (b && !/CLOSE/.test(text(b))) { await click(b); } srv.calls = []; }
var FAB = 'Fabrics · Fabrics Canada';

(async function () {
  render(); await flush(); await fresh();
  // 1. what the card offers on Max's 14743
  var ld = byId('line-decide');
  check('BILL 14743: exactly ONE line has its own decision row — "Decide this line — Fabrics · Fabrics Canada is FAIL" with its own note box, Approved and Disputed', ld.length === 1 && /^Decide this line — Fabrics · Fabrics Canada is FAIL/.test(text(ld[0])) && !!lineNote(FAB) && byId('line-approve').length === 1 && byId('line-dispute').length === 1, ld.map(text));
  check('…the passing lines get no box of their own', !lineNote('Paper · Paper Canada') && !lineNote('Leather · Thirds Canada'));
  var wait = byId('signoff-waits');
  check('SECOND SIGNATURE WAITS: the bill\'s Approved is not offered; it says "Approve the bill after each failing line is decided above (1 left: Fabrics · Fabrics Canada)"', wait.length === 1 && text(wait[0]) === 'Approve the bill after each failing line is decided above (1 left: Fabrics · Fabrics Canada)' && !all(function (n) { return n.type === 'button' && text(n).trim() === 'Approved' && !(n.props['data-testid']); }).length, wait.map(text));
  check('…the bill\'s Disputed is named "Dispute the whole bill" (it covers every open line)', !!button('Dispute the whole bill'));
  // 2. the Fabrics line without a note
  await click(byId('line-approve')[0]);
  check('Fabrics Approved with NO note → refused ON THAT LINE: "Not saved: Fabrics · Fabrics Canada is FAIL — type a note in the box …", nothing sent', decides().length === 0 && msgs().some(function (t) { return /^✗ Not saved: Fabrics · Fabrics Canada is FAIL — type a note in the box/.test(t); }), msgs());
  // 3. with its note
  await type(lineNote(FAB), 'fabrics discrepancy is ok');
  await click(byId('line-approve')[0]);
  var d = decides();
  check('…with its note: EXACTLY ONE decision — Fabrics, accept_discrepancy, its own note; no passing line is sent with it', d.length === 1 && d[0].item_key === 'k-' + FAB && d[0].kind === 'accept_discrepancy' && d[0].reason === 'fabrics discrepancy is ok', d);
  var ln = byId('line-approval').map(text);
  check('…the Fabrics line now reads "✓ Difference accepted by approval — Max · 13:30 · “fabrics discrepancy is ok”" (who / when / ITS note)', ln.indexOf('✓ Difference accepted by approval — Max · 13:30 · “fabrics discrepancy is ok”') >= 0, ln);
  check('…its own decision row is gone, and the bill\'s Approved is offered now (all failing lines decided)', byId('line-decide').length === 0 && byId('signoff-waits').length === 0 && !!button('Approved'), [byId('line-decide').length, byId('signoff-waits').length]);
  // 4. the sign-off: no note needed now, covers only the 4 passing lines
  srv.calls = []; await click(button('Approved'));
  d = decides();
  check('the bill\'s Approved now needs NO note and sends EXACTLY the 4 passing lines (validate_match, the automatic note) — never Fabrics again', d.length === 4 && d.every(function (x) { return x.kind === 'validate_match' && x.item_key !== 'k-' + FAB && /^Approved: billed weight vs scanned weight within the approved tolerance$/.test(x.reason); }), d);
  check('…the bill reads "PASS — REVIEWED" with "DIFFERENCE ACCEPTED" and nothing is left to decide', /^\s*PASS — REVIEWED\s*DIFFERENCE ACCEPTED/.test(bar() || '') && !button('Approved') && byId('line-decide').length === 0, bar());
  var rec = text(byId('review-record')[0] || null);
  check('…the Review record keeps each line\'s own note apart: "1 difference accepted · note: “fabrics discrepancy is ok”" and "4 lines validated · note: “Approved: …”"', /1 difference accepted · note: “fabrics discrepancy is ok”/.test(rec) && /4 lines validated · note: “Approved: billed weight vs scanned weight within the approved tolerance”/.test(rec), rec);
  // 5. a disputed line keeps the bill open
  await fresh();
  await type(lineNote(FAB), 'short 87 lb against the scale tickets');
  await click(byId('line-dispute')[0]);
  d = decides();
  check('Fabrics DISPUTED on its own line: exactly one report_issue for Fabrics with its note', d.length === 1 && d[0].kind === 'report_issue' && d[0].item_key === 'k-' + FAB && d[0].reason === 'short 87 lb against the scale tickets', d);
  check('…the bill does NOT pass: the bar shows DISPUTED and never PASS — REVIEWED', /DISPUTED/.test(bar() || '') && !/PASS — REVIEWED/.test(bar() || ''), bar());
  // 6. two failing lines, two different notes
  await fresh([['Paper · Paper Canada', 'matched'], [FAB, 'discrepancy'], ['Leather · Folds', 'product_missing']]);
  check('two failing lines → two own rows; the sign-off says "(2 left: Fabrics · Fabrics Canada, Leather · Folds)"', byId('line-decide').length === 2 && text(byId('signoff-waits')[0] || null) === 'Approve the bill after each failing line is decided above (2 left: Fabrics · Fabrics Canada, Leather · Folds)', byId('line-decide').map(text));
  await type(lineNote(FAB), 'fabrics note one'); await click(byId('line-approve')[0]);
  await type(lineNote('Leather · Folds'), 'folds were shipped on the next truck'); await click(byId('line-approve')[0]);
  d = decides();
  check('…each saved with ITS OWN note (fabrics note one / folds were shipped on the next truck), never the other\'s', d.length === 2 && d[0].reason === 'fabrics note one' && d[1].item_key === 'k-Leather · Folds' && d[1].reason === 'folds were shipped on the next truck', d);
  // 7. ZT on a line: the answer was lost after saving → the re-read proves it, said ON that line
  await fresh(); srv.plan['k-' + FAB] = 'lost-after';
  await type(lineNote(FAB), 'fabrics discrepancy is ok'); await click(byId('line-approve')[0]);
  check('LINE answer lost AFTER the server saved it → re-read proves it: "✓ Saved — Approved: NexPac Corporation 14743 — Fabrics · Fabrics Canada (1 line), confirmed after a connection problem."', msgs().some(function (t) { return t === '✓ Saved — Approved: NexPac Corporation 14743 — Fabrics · Fabrics Canada (1 line), confirmed after a connection problem.'; }), msgs());
  await fresh(); srv.plan['k-' + FAB] = 'lost-before';
  await type(lineNote(FAB), 'fabrics discrepancy is ok'); await click(byId('line-approve')[0]);
  check('LINE answer lost BEFORE saving → "not yet confirmed: Fabrics … Wait a moment, press Show … before pressing Approved again" — never "not saved"', msgs().some(function (t) { return /^⚠ Connection problem — checked again: not yet confirmed: Fabrics · Fabrics Canada\. Wait a moment, press Show \(last reading\)/.test(t) && !/not saved/i.test(t); }), msgs());
  // 8. the invoice pop-up
  await fresh();
  var ob = byId('open-invoice');
  check('the opened card has "📄 Invoice" for its bill', ob.length === 1 && text(ob[0]) === '📄 Invoice', ob.map(text));
  await click(ob[0]);
  var pop = byId('invoice-popup');
  check('clicking it opens a POP-UP over the page (role dialog) with this bill\'s own file in the viewer — "NexPac Corporation · Bill 14743 · 2026-09-15"', pop.length === 1 && pop[0].props.role === 'dialog' && /NexPac Corporation · Bill 14743 · 2026-09-15/.test(text(pop[0])) && /viewer:pv\/2026\/14743\.pdf/.test(text(pop[0])), pop.map(text));
  check('…nothing is re-read and nothing is decided by opening it', srv.calls.length === 0, srv.calls);
  await click(byId('close-invoice')[0]);
  check('Close ✕ → the pop-up is gone and the SAME card is still open on the same bill (nothing reloaded)', byId('invoice-popup').length === 0 && /CLOSE/.test(bar() || '') && byId('line-decide').length === 1 && srv.calls.length === 0, bar());
  await click(byId('open-invoice')[0]); await click(byId('invoice-popup')[0]);
  check('…clicking the dark area outside also closes it, same card still open', byId('invoice-popup').length === 0 && /CLOSE/.test(bar() || ''));
  // 10. Codex 13:20 — blocked / REVIEW rows, stale screen, simultaneous clicks, reopen with the same figures, role denial
  await fresh([['Paper · Paper Canada', 'matched'], ['Leather · Thirds Canada', 'mapping_conflict'], [FAB, 'discrepancy'], ['Pool Canada', 'cannot_compare']]);
  var rows10 = byId('line-decide').map(text);
  check('a BLOCKED line (mapping conflict) gets no line buttons; a REVIEW line (cannot compare) gets its own row "… is REVIEW"', rows10.length === 2 && rows10.some(function (t) { return /^Decide this line — Pool Canada is REVIEW/.test(t); }) && !rows10.some(function (t) { return /Thirds/.test(t); }), rows10);
  await type(lineNote(FAB), 'fabrics ok at this tolerance'); await click(byId('line-approve')[0]);
  await type(lineNote('Pool Canada'), 'pool weighed on the yard scale'); await click(byId('line-approve')[0]);
  srv.calls = []; await click(button('Approved'));
  check('…with a BLOCKED line still there the bill-level Approved needs a note ("this bill is …") and sends nothing; the bill never reads PASS — REVIEWED', decides().length === 0 && msgs().some(function (t) { return /^✗ Not saved: this bill is (FAIL|REVIEW) — type a note/.test(t); }) && !/PASS — REVIEWED/.test(bar() || ''), [msgs(), bar()]);
  await fresh(); srv.plan['k-' + FAB] = 'refuse';
  await type(lineNote(FAB), 'fabrics discrepancy is ok'); await click(byId('line-approve')[0]);
  check('STALE screen: the server refuses the line ("The figures changed …") → a red answer on that line, only that line was sent, nothing else saved', decides().length === 1 && msgs().some(function (t) { return /^✗ Not saved: Fabrics · Fabrics Canada: The figures changed since you opened this|^✗ .*The figures changed since you opened this/.test(t); }) && Object.keys(srv.decided).length === 0, msgs());
  await fresh(); await type(lineNote(FAB), 'fabrics discrepancy is ok');
  var la = byId('line-approve')[0]; la.props.onClick(); la.props.onClick(); byId('bill-dispute')[0] && byId('bill-dispute')[0].props.onClick(); await flush();
  check('SIMULTANEOUS clicks: two fast presses on the line Approved (and the bill Disputed in the same instant) send ONE decision (the second is ignored while the first is in flight)', decides().length === 1, decides().length);
  await fresh(); srv.decided['k-' + FAB] = 'reopened'; srv.dec['k-' + FAB] = { id: 'r1', kind: 'reopen', reason: 'recheck the fabrics pallets', actor: 'u-a', actor_name: 'Ahmed', at: '2026-11-27T12:00:00Z' };
  await click(button('Show (last reading)'));
  check('REOPENED with the same figures: the Fabrics line is open again with its own row, and the sign-off waits again', byId('line-decide').length === 1 && byId('signoff-waits').length === 1, byId('line-decide').length);
  srv.perms = { validate: true, accept: false, settings: false, super_admin: false }; H.states = []; H.effects = []; render(); await flush(); await fresh();
  check('ROLE: may validate but NOT accept → the failing line shows Disputed only (no Approved)', byId('line-decide').length === 1 && byId('line-approve').length === 0 && byId('line-dispute').length === 1);
  srv.perms = { validate: false, accept: false, settings: false, super_admin: false }; H.states = []; H.effects = []; render(); await flush(); await fresh();
  check('ROLE: neither → no line row and no decision buttons at all', byId('line-decide').length === 0 && byId('line-approve').length === 0 && !button('Dispute the whole bill'));
  srv.perms = null;
  // 9. pure rules
  var prev = INV.groupInvoices(rows())[0]; prev.previewed = true;
  check('a PREVIEW card (receipt not confirmed) offers no line buttons — the receipt is confirmed first', INV.ownLineControls(prev).length === 0);
  check('lineMsgFor: an answer shows only on the same line + figures; a green "Saved" only while that line is decided', INV.lineMsgFor({ kind: 'ok', text: 'x', fp: 'k-A:fp1' }, { item_key: 'k-A', comparison_fp: 'fp1', state: 'accepted' }) !== null && INV.lineMsgFor({ kind: 'ok', text: 'x', fp: 'k-A:fp1' }, { item_key: 'k-A', comparison_fp: 'fp2', state: 'accepted' }) === null && INV.lineMsgFor({ kind: 'ok', text: 'x', fp: 'k-A:fp1' }, { item_key: 'k-A', comparison_fp: 'fp1', state: 'reopened' }) === null);
  check('billAllPass: a FAIL line already accepted no longer needs a bill note; an open FAIL or a blocked line does', INV.billAllPass({ rows: [{ outcome: 'matched', state: 'unreviewed' }, { outcome: 'discrepancy', state: 'accepted' }] }) === true && INV.billAllPass({ rows: [{ outcome: 'matched', state: 'unreviewed' }, { outcome: 'discrepancy', state: 'unreviewed' }] }) === false && INV.billAllPass({ rows: [{ outcome: 'matched', state: 'unreviewed' }, { outcome: 'mapping_conflict', state: 'blocked' }] }) === false);
  var fs = require('fs'); var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
  var topV = (/version: '([^']+)'/.exec(wn.substring(wn.indexOf('BUILD_HISTORY = ['))) || [])[1];
  check('badge and What\'s New name the newest entry, and the ZW entry exists', wn.indexOf("version: 'v55.83-ZW'") >= 0 && page.indexOf(topV) >= 0, topV);
  console.log('\nZW line decisions: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('  ✗ FAIL: crashed ' + (e && e.stack)); process.exit(1); });
