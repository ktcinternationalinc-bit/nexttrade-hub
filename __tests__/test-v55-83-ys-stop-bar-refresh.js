// v55.83-YS — Codex 24 Nov 13:55 UTC, P2 on YQ: the STOP bar read its state only once, so a browser left open kept saying
// "allowed" after releases were stopped from another session. This runs the REAL component with a small stand-in for React's
// hooks, a fake clock and a fake server, and changes the server's answer between reads (the "two sessions" case).
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('YS — the stop bar re-reads its state (two-session change, failed read, parent refresh)');

// ── a tiny hooks runtime: enough to run one function component with useState / useEffect ──
var slots = []; var cursor = 0; var pending = []; var cleanups = {}; var dirty = false; var Comp = null; var props = {}; var tree = null;
var FakeReact = {
  createElement: function (type, p) { var kids = Array.prototype.slice.call(arguments, 2); return { type: type, props: p || {}, children: kids }; },
  useState: function (init) { var i = cursor++; if (!(i in slots)) { slots[i] = { v: typeof init === 'function' ? init() : init }; } var slot = slots[i]; return [slot.v, function (nv) { slot.v = typeof nv === 'function' ? nv(slot.v) : nv; dirty = true; }]; },
  useEffect: function (fn, deps) { var i = cursor++; var prev = slots[i]; var changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some(function (d, k) { return d !== prev.deps[k]; }); slots[i] = { deps: deps }; if (changed) { pending.push({ i: i, fn: fn }); } },
  useRef: function (v) { var i = cursor++; if (!(i in slots)) { slots[i] = { current: v }; } return slots[i]; }
};
FakeReact.default = FakeReact;
function render() {
  for (var guard = 0; guard < 25; guard++) {
    dirty = false; cursor = 0; pending = [];
    tree = Comp(props);
    pending.forEach(function (e) { if (cleanups[e.i]) { cleanups[e.i](); } var c = e.fn(); cleanups[e.i] = typeof c === 'function' ? c : null; });
    if (!dirty) { return; }
  }
  throw new Error('render did not settle');
}
function text(n) { if (n === null || n === undefined || n === false || n === true) { return ''; } if (typeof n === 'string' || typeof n === 'number') { return String(n); } if (Array.isArray(n)) { return n.map(text).join(''); } return text(n.children); }
function find(n, pred, out) { out = out || []; if (!n || typeof n !== 'object') { return out; } if (Array.isArray(n)) { n.forEach(function (k) { find(k, pred, out); }); return out; } if (pred(n)) { out.push(n); } find(n.children, pred, out); return out; }
async function settle() { for (var i = 0; i < 12; i++) { await Promise.resolve(); await new Promise(function (r) { setImmediate(r); }); if (dirty) { render(); } } }

// ── fake clock, window, document, server ──
var intervals = []; var listeners = { focus: [], visibilitychange: [] };
global.setInterval = function (fn, ms) { var t = { fn: fn, ms: ms, on: true }; intervals.push(t); return t; };
global.clearInterval = function (t) { if (t) { t.on = false; } };
global.window = { addEventListener: function (k, fn) { (listeners[k] = listeners[k] || []).push(fn); }, removeEventListener: function (k, fn) { listeners[k] = (listeners[k] || []).filter(function (x) { return x !== fn; }); } };
global.document = { visibilityState: 'visible', addEventListener: global.window.addEventListener, removeEventListener: global.window.removeEventListener };
var server = { paused: false, fail: false, by: 'Max', reason: 'hold everything', can: true }; var reads = 0; var posts = [];
global.fetch = function (url, opts) {
  if (opts && opts.method === 'POST') { var b = JSON.parse(opts.body); posts.push(b); server.paused = b.paused === true; return Promise.resolve({ json: function () { return Promise.resolve({ ok: true, can_switch: true, pause: { paused: server.paused, sentence: server.paused ? 'Warehouse releases are STOPPED by ' + server.by + ' — “' + b.reason + '”.' : '' } }); } }); }
  reads++;
  if (server.fail) { return Promise.reject(new Error('network down')); }
  return Promise.resolve({ json: function () { return Promise.resolve({ ok: true, can_switch: server.can, pause: { paused: server.paused, unreadable: false, by_name: server.paused ? server.by : null, at: server.paused ? '2026-11-24T14:00:00.000Z' : null, reason: server.paused ? server.reason : null, sentence: server.paused ? 'Warehouse releases are STOPPED by ' + server.by + ' — “' + server.reason + '”. Nothing new can be approved or started until the super admin switches them back on.' : '' } }); } });
};
var realLoad = Module._load;
Module._load = function (request) {
  if (request === 'react') { return FakeReact; }
  if (/lib\/supabase$/.test(request)) { return { supabase: { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'tok' } } }); } } } }; }
  return realLoad.apply(this, arguments);
};
Comp = require(path.join(root, 'src/components/ReleasePauseBar.jsx')).default;
Module._load = realLoad;

(async function () {
  var changes = 0; props = { refreshKey: 'a', onChange: function () { changes++; } };
  render(); await settle();
  check('1: on opening it reads the state and shows "allowed"', /Warehouse releases: allowed/.test(text(tree)) && reads >= 1, [text(tree).slice(0, 120), reads]);
  check('2: one 20-second timer is running, and focus / tab-visible listeners are attached', intervals.filter(function (t) { return t.on && t.ms === 20000; }).length === 1 && listeners.focus.length === 1 && listeners.visibilitychange.length === 1, [intervals.length, listeners.focus.length]);
  check('3: the box shows when it last checked and offers "Check now"', /Checked .* re-checked every 20 seconds/.test(text(tree)) && find(tree, function (n) { return n.type === 'button' && text(n) === 'Check now'; }).length === 1);

  // SESSION B stops releases on the server. This browser is untouched: no reload, no remount.
  server.paused = true; var before = reads;
  render(); await settle();   // the parent re-rendering alone (same refreshKey) must NOT be what updates it …
  check('4: (Codex\'s reproduction) a plain parent re-render with nothing new does not by itself read again', reads === before && /Warehouse releases: allowed/.test(text(tree)), [reads, before]);
  intervals.filter(function (t) { return t.on; })[0].fn(); await settle();   // … the 20-second timer does
  check('5: allowed → STOPPED in another session: after the next timed check this screen says STOPPED, with who and why — no reload', reads === before + 1 && /Warehouse releases: STOPPED/.test(text(tree)) && /STOPPED by Max — “hold everything”/.test(text(tree)) && !/Warehouse releases: allowed/.test(text(tree)), text(tree).slice(0, 260));
  check('6: while STOPPED the "approved work starts within about a minute" explanation is gone', !/picked up by the office worker within about a minute/.test(text(tree)));

  // SESSION B restarts. This time the parent's own status refresh carries it (refreshKey changes).
  server.paused = false; before = reads; props = Object.assign({}, props, { refreshKey: 'b' });
  render(); await settle();
  check('7: STOPPED → allowed in another session: the parent\'s next status refresh makes this bar re-read and show "allowed"', reads === before + 1 && /Warehouse releases: allowed/.test(text(tree)), [reads, before, text(tree).slice(0, 80)]);

  // coming back to the tab
  server.paused = true; before = reads; listeners.focus[0](); await settle();
  check('8: coming back to the window re-reads at once (shows STOPPED)', reads === before + 1 && /Warehouse releases: STOPPED/.test(text(tree)));
  global.document.visibilityState = 'hidden'; before = reads; listeners.visibilitychange[0](); await settle();
  check('9: a hidden tab does not read', reads === before);
  global.document.visibilityState = 'visible';

  // a failed re-read must not leave an old answer presented as current
  server.paused = false; props = Object.assign({}, props, { refreshKey: 'c' }); render(); await settle();
  check('10: (set-up) back to allowed', /Warehouse releases: allowed/.test(text(tree)));
  server.fail = true; intervals.filter(function (t) { return t.on; })[0].fn(); await settle();
  check('11: the re-read FAILS → "NOT KNOWN — could not check", not an old "allowed"; it says it may be out of date and that the server still refuses', /Warehouse releases: NOT KNOWN — could not check/.test(text(tree)) && !/Warehouse releases: allowed/.test(text(tree)) && /may be out of date/.test(text(tree)) && /The server still refuses anything that is not allowed/.test(text(tree)) && !/picked up by the office worker/.test(text(tree)), text(tree).slice(0, 300));
  server.fail = false; find(tree, function (n) { return n.type === 'button' && text(n) === 'Check now'; })[0].props.onClick(); await settle();
  check('12: "Check now" reads again and the box recovers to the true state', /Warehouse releases: allowed/.test(text(tree)) && !/NOT KNOWN/.test(text(tree)));

  // stopping from THIS screen still works and tells the parent
  find(tree, function (n) { return n.type === 'button' && text(n) === 'Stop all warehouse releases'; })[0].props.onClick(); render();
  var input = find(tree, function (n) { return n.type === 'input'; })[0]; input.props.onChange({ target: { value: 'waiting for a second review' } }); render();
  find(tree, function (n) { return n.type === 'button' && text(n) === 'Yes, stop them now'; })[0].props.onClick(); await settle();
  check('13: stopping from this screen: sent with the reason, the box turns STOPPED at once, the parent is told', posts.length === 1 && posts[0].paused === true && posts[0].reason === 'waiting for a second review' && /Warehouse releases: STOPPED/.test(text(tree)) && changes === 1, [posts, changes]);
  check('14: it still says plainly that a running move is not interrupted (shown while allowed)', /does not interrupt a move that is already running/.test(fs.readFileSync(path.join(root, 'src/components/ReleasePauseBar.jsx'), 'utf8')));

  // unmount: timer and listeners are removed
  Object.keys(cleanups).forEach(function (k) { if (cleanups[k]) { cleanups[k](); } });
  check('15: leaving the screen stops the timer and removes the listeners', intervals.every(function (t) { return !t.on; }) && listeners.focus.length === 0 && listeners.visibilitychange.length === 0);

  var tab = fs.readFileSync(path.join(root, 'src/components/ChangeScheduleTab.jsx'), 'utf8');
  check('16 (source): Change Schedule hands the bar the time of its own last status read, so both refresh together', tab.indexOf('<ReleasePauseBar refreshKey={checkedAt} onChange={function () { load(); }} />') > 0 && tab.indexOf('setCheckedAt(new Date().toISOString())') > 0);
  var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
  check('17: What\'s New has the YS entry and the badge names the newest entry on top', wn.indexOf("version: 'v55.83-YS'") > 0 && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55.83-[A-Z]{2,3}(?:\.\d+)?)'/.exec(wn); return !!top && page.indexOf('>' + top[1] + '</span>') > 0; })());

  console.log('\nYS: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
