// v55.83-UG (Codex QA 18:24) — runs the ACTUAL Settings togglePermission (extracted from SettingsTab.jsx) against an in-memory
// module_permissions table, then checks the page view and the real server rule after: normal save, a failed second write with a
// good re-read, and a failed second write whose re-read also fails (page must warn and refuse more changes).
var path = require('path'); var fs = require('fs'); var vm = require('vm');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var PA = require(path.join(root, 'src/lib/permission-aliases.js'));
var SP = require(path.join(root, 'src/lib/server-permissions.js'));
var pass = 0, failN = 0;
function check(l, c, x) { if (c) { pass++; } else { failN++; } console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + l + (c ? '' : '  ' + JSON.stringify(x === undefined ? '' : x).substring(0, 400))); }
var src = fs.readFileSync(path.join(root, 'src/components/SettingsTab.jsx'), 'utf8');
var a = src.indexOf('const togglePermission = async'); var i = src.indexOf('{', src.indexOf('=>', a)); var d = 0, j = i;
for (; j < src.length; j++) { if (src[j] === '{') { d++; } else if (src[j] === '}') { d--; if (d === 0) { break; } } }
var fnSrc = src.slice(a, j + 1);
var code = require('sucrase').transform(fnSrc + '; module.exports = togglePermission;', { transforms: ['jsx'] }).code;

function makeEnv(rows, opts) {
  var st = { perms: {}, stale: {}, toasts: [] };
  function match(x, f) { return f.eqs.every(function (e) { return x[e[0]] === e[1]; }); }
  function q() {
    var f = { eqs: [], ins: null, op: 'select', val: null };
    var api = {
      select: function () { return api; },
      eq: function (k, v) { f.eqs.push([k, v]); return api; },
      in: function (k, v) { f.ins = [k, v]; return api; },
      update: function (v) { f.op = 'update'; f.val = v; return api; },
      insert: function (v) { f.op = 'insert'; f.val = v; return api; },
      maybeSingle: function () { var r = rows.filter(function (x) { return match(x, f); })[0]; return Promise.resolve({ data: r ? { id: r.id } : null, error: null }); },
      then: function (res, rej) {
        var out;
        if (f.op === 'insert') { rows.push(Object.assign({ id: 'n' + rows.length }, f.val)); out = { error: null }; }
        else if (f.op === 'update' && f.ins) {
          if (opts.failSecond) { out = { error: { message: 'network' } }; }
          else { rows.forEach(function (x) { if (match(x, f) && f.ins[1].indexOf(x[f.ins[0]]) >= 0) { x.has_access = f.val.has_access; } }); out = { error: null }; }
        }
        else if (f.op === 'update') { rows.forEach(function (x) { if (x.id === (f.eqs[0] || [])[1] || match(x, f)) { x.has_access = f.val.has_access; } }); out = { error: null }; }
        else if (opts.failReread === 'throw') { return Promise.reject(new Error('offline')).then(res, rej); }
        else if (opts.failReread) { out = { data: null, error: { message: 'offline' } }; }
        else { out = { data: rows.filter(function (x) { return match(x, f); }).map(function (x) { return { module_name: x.module_name, has_access: x.has_access }; }), error: null }; }
        return Promise.resolve(out).then(res, rej);
      }
    };
    return api;
  }
  rows.forEach(function (x) { (st.perms[x.user_id] = st.perms[x.user_id] || {})[x.module_name] = x.has_access; });
  // v55.83-WW — the switch is now saved by the server (/api/admin/permissions): this stand-in does what that route does
  // (writes the switch under every name it is stored under, adds the asked name if missing); opts.failSecond = the server
  // could not save. The route itself is run for real in test-v55-83-ww-grant-writes.js.
  function hubFetch(url, init) {
    var b = JSON.parse(init.body); var fam = PA.permFamily(b.module_name); if (fam.indexOf(b.module_name) < 0) { fam.unshift(b.module_name); }
    if (url !== '/api/admin/permissions' || b.action !== 'set') { return Promise.resolve({ status: 400, json: function () { return Promise.resolve({ ok: false, error: 'wrong call' }); } }); }
    if (opts.failSecond) { return Promise.resolve({ status: 500, json: function () { return Promise.resolve({ ok: false, error: 'network' }); } }); }
    var have = false; rows.forEach(function (x) { if (x.user_id === b.target_user_id && fam.indexOf(x.module_name) >= 0) { x.has_access = b.has_access; if (x.module_name === b.module_name) { have = true; } } });
    if (!have) { rows.push({ id: 'n' + rows.length, user_id: b.target_user_id, module_name: b.module_name, has_access: b.has_access }); }
    return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ ok: true }); } });
  }
  var ctx = { module: {}, console: { error: function () {} }, supabase: { from: q }, hubFetch: hubFetch, userProfile: { id: 'boss' },
    toast: { success: function (m) { st.toasts.push('ok:' + m); }, error: function (m) { st.toasts.push('err:' + m); } },
    SENSITIVE_PERMS_UI: {}, isSuperAdmin: true, TAB_PERMS: [], permFamily: PA.permFamily,
    setPermissions: function (fn) { st.perms = typeof fn === 'function' ? fn(st.perms) : fn; },
    setStaleUsers: function (fn) { st.stale = typeof fn === 'function' ? fn(st.stale) : fn; } };
  Object.defineProperty(ctx, 'permissions', { get: function () { return st.perms; } });
  Object.defineProperty(ctx, 'staleUsers', { get: function () { return st.stale; } });
  vm.runInNewContext(code, ctx);
  return { toggle: ctx.module.exports, st: st, rows: rows };
}
function page(perms, key) { var on = {}, off = {}; Object.keys(perms || {}).forEach(function (k) { if (perms[k] === true) { on[k] = true; } else if (perms[k] === false) { off[k] = true; } }); return PA.effectiveSwitch(on, off, key) === true; }
function server(rows, uid, perm) { var mp = {}, deny = {}; rows.filter(function (x) { return x.user_id === uid; }).forEach(function (x) { (x.has_access ? mp : deny)[x.module_name] = true; }); return SP.userHasPermission({ role: 'admin', isSuperAdmin: false, mp: mp, deny: deny }, perm); }

(async function () {
  console.log('UG — the real Settings toggle, saved rows, page and server');
  var e1 = makeEnv([{ id: 'r1', user_id: 'u', module_name: 'Invoice: Create', has_access: true }], {});
  await e1.toggle('u', 'invoice.create', true);
  check('normal save: turning OFF saves OFF under every name; page and server both OFF', !page(e1.st.perms.u, 'invoice.create') && !server(e1.rows, 'u', 'invoices.create') && e1.rows.every(function (x) { return x.has_access === false; }), e1.rows);
  await e1.toggle('u', 'invoice.create', false);
  check('normal save: turning ON again → page and server both ON', page(e1.st.perms.u, 'invoice.create') && server(e1.rows, 'u', 'invoices.create'), e1.rows);
  var e2 = makeEnv([{ id: 'r1', user_id: 'u', module_name: 'Invoice: Create', has_access: true }], { failSecond: true });
  await e2.toggle('u', 'invoice.create', true);
  check('second write fails, re-read works → page shows what is really saved (= server)', page(e2.st.perms.u, 'invoice.create') === server(e2.rows, 'u', 'invoices.create') && !e2.st.stale.u, { p: e2.st.perms.u, rows: e2.rows });
  var e3 = makeEnv([{ id: 'r1', user_id: 'u', module_name: 'Invoice: Create', has_access: true }], { failSecond: true, failReread: true });
  await e3.toggle('u', 'invoice.create', true);
  check('second write AND re-read fail → person marked "may be partly saved" with a clear message', e3.st.stale.u === true && e3.st.toasts.some(function (t) { return /may have saved/.test(t); }), e3.st);
  var before = JSON.stringify(e3.rows);
  await e3.toggle('u', 'invoice.create', false);
  check('…and no more changes are allowed for that person until the page is reloaded', JSON.stringify(e3.rows) === before && e3.st.toasts.some(function (t) { return /Reload the page/.test(t); }));
  var e4 = makeEnv([{ id: 'r1', user_id: 'u', module_name: 'Invoice: Create', has_access: true }], { failSecond: true, failReread: 'throw' });
  await e4.toggle('u', 'invoice.create', true);
  check('Codex 18:29: a re-read that THROWS is treated the same (flagged, warned)', e4.st.stale.u === true && e4.st.toasts.some(function (t) { return /may have saved/.test(t); }), e4.st);
  var e5 = makeEnv(JSON.parse(JSON.stringify(e4.rows)), {});
  check('Codex 18:29: after a reload the page shows what is really saved (= server)', page(e5.st.perms.u, 'invoice.create') === server(e5.rows, 'u', 'invoices.create') && !e5.st.stale.u, e5.rows);
  await e5.toggle('u', 'invoice.create', page(e5.st.perms.u, 'invoice.create'));
  await e5.toggle('u', 'invoice.create', page(e5.st.perms.u, 'invoice.create'));
  check('Codex 18:29: …and changes work again after the reload; page and server agree', page(e5.st.perms.u, 'invoice.create') === server(e5.rows, 'u', 'invoices.create') && e5.st.toasts.filter(function (t) { return /^ok:/.test(t); }).length === 2, e5.st);
  var panel = fs.readFileSync(path.join(root, 'src/components/BankingAccessPanel.jsx'), 'utf8');
  check('the Banking & Accounting Access page shows the red "may be only partly saved" warning for that person', panel.indexOf('(props.staleUsers || {})[u.id]') >= 0 && panel.indexOf('only partly saved') >= 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
