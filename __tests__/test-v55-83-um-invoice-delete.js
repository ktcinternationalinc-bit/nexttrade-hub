// v55.83-UM — "Delete / void invoices 🔒": the REAL /api/accounting/invoice-lifecycle handler (FakeDb, verified-caller and
// permissions stubbed), the shared rule, the "Are you sure?" rules (lib/confirm-queue) and the screen / Wave-route wiring.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('UM — Delete / void invoices switch');
var state = { db: null, who: { userId: 'u-staff' }, users: {}, audits: [], rpcCalls: [] };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve(state.who); } });
stub('src/lib/server-permissions.js', { loadUserPermissions: function (db, id) { var u = state.users[id] || { role: 'staff', mp: {} }; return Promise.resolve({ role: u.role, isSuperAdmin: u.role === 'super_admin', mp: u.mp || {}, deny: u.deny || {} }); } });
stub('src/lib/audit-server.js', { audit: function (db, actor, action, entity, id, details) { state.audits.push({ actor: actor, action: action, id: id, details: details }); return Promise.resolve(); } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var R = require(path.join(root, 'src/app/api/accounting/invoice-lifecycle/route.js'));
var A = require(path.join(root, 'src/lib/invoice-delete-access.js'));
var CQ = require(path.join(root, 'src/lib/confirm-queue.js'));
function call(body) { return R.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: 'Bearer t' } })).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); }); }
var IDC = '00000000-0000-0000-0000-000000000001';
function fresh(answer) {
  state.db = new FakeDb({}); state.audits = []; state.rpcCalls = [];
  state.users = { 'u-staff': { role: 'staff', mp: {} }, 'u-admin': { role: 'admin', mp: {} }, 'u-owner': { role: 'owner', mp: {} }, 'u-switch': { role: 'staff', mp: { 'invoice.delete': true } }, 'u-am': { role: 'accounting_manager', mp: {} }, 'u-amsw': { role: 'accounting_manager', mp: { 'invoice.delete': true } }, 'u-off': { role: 'staff', mp: { 'invoice.delete': true }, deny: { 'invoice.delete': true } }, 'u-super': { role: 'super_admin', mp: {} } };
  // the locked database step itself is proven on real Postgres (test-v55-83-um-invoice-delete-sql.mjs); here it answers as told
  state.db.rpcs.hub_invoice_lifecycle = function (args) { state.rpcCalls.push(args.p); return typeof answer === 'function' ? answer(args.p) : (answer || { data: { ok: true, action: args.p.action, released: 0, name: 'INV-1' }, error: null }); };
}
(async function () {
  // ── the shared rule
  // Max (via the parent session): "should an accounting manager be able to delete or void invoices automatically, or only when you switch it on for them?" → "switch it on"
  check('rule: the super admin, or the switch ON — yes', A.canDeleteInvoices(true, {}) && A.canDeleteInvoices(false, { 'invoice.delete': true }) && A.canDeleteInvoices(false, { 'invoice.delete': true }, {}));
  check('rule: no switch → no, whatever the role (the rule takes no role at all)', !A.canDeleteInvoices(false, {}) && A.canDeleteInvoices.length === 3);
  check('rule: the screen map with the switch OFF (false) → no', !A.canDeleteInvoices(false, { 'invoice.delete': false }));
  check('rule: ON and OFF rows both present → OFF wins (shared effectiveSwitch rule)', !A.canDeleteInvoices(false, { 'invoice.delete': true }, { 'invoice.delete': true }));

  // ── who may act — refused BEFORE the database step is ever called
  fresh(); state.who = { error: 'Sign in again.', status: 401 };
  var r0 = await call({ action: 'delete', kind: 'invoice', id: IDC, user_id: 'u-super' });
  check('no verified sign-in (even with the super admin\'s id in the body) → 401, step never called', r0.status === 401 && state.rpcCalls.length === 0, r0);
  for (var who of ['u-staff', 'u-admin', 'u-owner', 'u-am', 'u-off']) {
    for (var act of ['delete', 'void', 'archive', 'restore']) {
      fresh(); state.who = { userId: who };
      var rr = await call({ action: act, kind: 'invoice', id: IDC });
      if (act === 'delete' || who === 'u-admin') { check(who + ' without the switch, ' + act + ' → 403 “ask the super admin”, step never called', rr.status === 403 && /Delete \/ void invoices/.test(rr.j.error) && state.rpcCalls.length === 0, rr); }
      else if (rr.status !== 403 || state.rpcCalls.length) { check(who + ' ' + act + ' refused', false, rr); }
    }
  }

  // ── with the switch: the step gets the VERIFIED person and the request; its answer becomes the reply
  fresh(); state.who = { userId: 'u-switch' };
  var r1 = await call({ action: 'void', kind: 'invoice', id: IDC, reason: '  customer cancelled  ', user_id: 'u-switch' });
  check('switch ON: one call of the locked step, with the verified person as actor and the trimmed reason', r1.status === 200 && r1.j.ok && state.rpcCalls.length === 1 && state.rpcCalls[0].actor === 'u-switch' && state.rpcCalls[0].action === 'void' && state.rpcCalls[0].id === IDC && state.rpcCalls[0].reason === 'customer cancelled' && state.rpcCalls[0].is_super === false, [r1, state.rpcCalls]);
  check('… and the Hub audit records it under that person', state.audits.some(function (a) { return a.actor === 'u-switch' && a.action === 'invoice_void' && a.id === IDC; }));
  fresh(); state.who = { userId: 'u-amsw' };
  check('an Accounting Manager WITH the switch may act', (await call({ action: 'archive', kind: 'proforma', id: IDC })).status === 200 && state.rpcCalls[0].kind === 'proforma');
  fresh(); state.who = { userId: 'u-super' };
  var bad1 = await call({ action: 'erase', kind: 'invoice', id: IDC }); var bad2 = await call({ action: 'void', kind: 'invoice', id: 'not-an-id' });
  check('unknown action / not an invoice id → 400, step never called', bad1.status === 400 && bad2.status === 400 && state.rpcCalls.length === 0, [bad1, bad2]);
  var codes = [['payments', 409, /Payments are never deleted/], ['wave', 409, /linked to Wave/], ['historical', 409, /imported from Wave/], ['converted', 409, /converted to an invoice/], ['state', 409, /while it is void/], ['not_found', 404, /not there any more/], ['scope', 403, /not a member of/]];
  for (var ci = 0; ci < codes.length; ci++) {
    fresh({ data: { ok: false, code: codes[ci][0], status: 'void' }, error: null }); state.who = { userId: 'u-super' };
    var rc = await call({ action: 'delete', kind: 'invoice', id: IDC });
    check('step refuses “' + codes[ci][0] + '” → ' + codes[ci][1] + ' with a plain message, no audit', rc.status === codes[ci][1] && codes[ci][2].test(rc.j.error) && state.audits.length === 0, rc);
  }
  fresh({ data: null, error: { message: 'Could not find the function public.hub_invoice_lifecycle(p) in the schema cache' } }); state.who = { userId: 'u-super' };
  var rm = await call({ action: 'delete', kind: 'invoice', id: IDC });
  check('database update not run yet → 409 “run sql/v55-83-UM-invoice-delete.sql”', rm.status === 409 && /v55-83-UM-invoice-delete\.sql/.test(rm.j.error), rm);
  fresh({ data: null, error: { message: 'deadlock detected' } }); state.who = { userId: 'u-super' };
  var re = await call({ action: 'delete', kind: 'invoice', id: IDC });
  check('a database error → 500 “Nothing was changed” (the step is one transaction), no audit', re.status === 500 && /Nothing was changed/.test(re.j.error) && state.audits.length === 0, re);

  // ── "Are you sure?" rules (behaviour, not text)
  var got = []; var s1 = CQ.nextConfirmState(null, { title: 'A' }, function (v) { got.push(['A', v]); });
  var s2 = CQ.nextConfirmState(s1, { title: 'B' }, function (v) { got.push(['B', v]); });
  check('a second question while one is open answers the first NO', JSON.stringify(got) === '[["A",false]]' && s2.title === 'B');
  var after = CQ.answerConfirm(s2, true);
  check('Confirm answers the open question YES and closes the box', JSON.stringify(got) === '[["A",false],["B",true]]' && after === null);
  var got2 = []; CQ.answerConfirm(CQ.nextConfirmState(null, {}, function (v) { got2.push(v); }), false);
  check('Cancel / Esc / outside click answers NO', JSON.stringify(got2) === '[false]');
  var got3 = []; CQ.answerConfirm(CQ.nextConfirmState(null, {}, function (v) { got3.push(v); }), 'yes');
  check('only a real true is a yes (anything else is NO)', JSON.stringify(got3) === '[false]');
  var alerted = 0; global.window = { alert: function () { alerted++; } };
  var fb = await CQ.HUB_TOAST_FALLBACK.confirm({ title: 'Undo Import', message: 'DELETE 12 records' });
  delete global.window;
  check('NO provider: the question is answered NO, with a visible notice (was: an automatic YES)', fb === false && alerted === 1);

  // ── P1 "Accounting Access" (Max: Undo payment refused although ClickBooks is ON) — the REAL resolver
  var PA = require(path.join(root, 'src/lib/permission-aliases.js'));
  check('P1: ClickBooks ON + an OLD hidden OFF on accounting.view → allowed (the visible switch wins)', PA.effectiveSwitch({ 'accounting.clickbooks.access': true }, { 'accounting.view': true }, 'accounting.view') === true);
  check('P1: Wave Hub ON + old OFF → allowed', PA.effectiveSwitch({ 'accounting.wavehub.access': true }, { 'accounting.view': true }, 'accounting.view') === true);
  check('P1: both books switches OFF / not set + old OFF → refused (nothing opened by accident)', PA.effectiveSwitch({}, { 'accounting.view': true }, 'accounting.view') === false && PA.effectiveSwitch({}, { 'accounting.view': true, 'accounting.clickbooks.access': true }, 'accounting.view') === false);
  check('P1: ClickBooks switched OFF explicitly is still OFF for ClickBooks itself', PA.effectiveSwitch({ 'accounting.view': true }, { 'accounting.clickbooks.access': true }, 'accounting.clickbooks.access') === false);
  check('P1: nothing set → not set (role defaults decide, as before)', PA.effectiveSwitch({}, {}, 'accounting.view') === null);
  // ── wiring (source)
  var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
  check('page: App wraps HubApp in the provider; the fallback and the rules come from lib/confirm-queue; no automatic yes left', /return <ToastProvider><HubApp \/><\/ToastProvider>;/.test(page) && /_toastRaw \|\| HUB_TOAST_FALLBACK/.test(page) && page.indexOf('confirm: async () => true') < 0);
  check('page: the box is a dialog — Esc = Cancel, focus starts on Cancel, Tab stays inside, focus returns', /role="alertdialog"/.test(page) && /e\.key === 'Escape'\) \{ e\.preventDefault\(\); cancelFn\.current\(\)/.test(page) && /ref=\{cancelRef\}/.test(page) && /before\.focus\(\)/.test(page));
  var tab = fs.readFileSync(path.join(root, 'src/components/AccountingInvoicesTab.jsx'), 'utf8');
  check('invoice screen: Delete / Void / Cancel / Archive / Restore all go through the server route; no browser delete or status write left', /\/api\/accounting\/invoice-lifecycle/.test(tab) && tab.indexOf('dbDelete(lcTbl()') < 0 && tab.indexOf('dbUpdate(lcTbl()') < 0 && /lcServer\('delete'/.test(tab) && /lcServer\('archive'/.test(tab) && /lcServer\('restore'/.test(tab) && /lcServer\(kind === 'cancelled' \? 'cancel' : 'void'/.test(tab));
  check('invoice screen: the buttons and “Delete incl. Wave” use the SAME rule (mayLifecycle)', /var mayLifecycle = canDeleteInvoices\(/.test(tab) && /userProfile\.role, mayLifecycle\)/.test(tab) && /editing\.source !== 'wave_import' && mayLifecycle &&/.test(tab) && /if \(!mayLifecycle\) \{ toast\.error\(INVOICE_DELETE_DENIED\)/.test(tab));
  var wave = fs.readFileSync(path.join(root, 'src/app/api/wave/delete-invoice/route.js'), 'utf8');
  var iV = wave.indexOf('verifiedCaller(req, body, createClient)'); var iC = wave.indexOf('canDeleteInvoices(_ctxD.isSuperAdmin'); var iG = wave.indexOf("assertPermission(db, by, 'wave.invoices.push', req)");
  check('Wave delete route: verified person FIRST, then the invoice-delete rule, then wave.invoices.push; body user_id no longer trusted', iV > 0 && iC > iV && iG > iC && wave.indexOf('var by = body.user_id') < 0);
  var rec = fs.readFileSync(path.join(root, 'src/components/WaveReconciliationCenter.jsx'), 'utf8');
  check('Wave reconciliation sends the signed-in token to the delete route', (rec.match(/hubFetch\('\/api\/wave\/delete-invoice'/g) || []).length === 2 && rec.indexOf("fetch('/api/wave/delete-invoice'") < 0);
  var panel = fs.readFileSync(path.join(root, 'src/components/BankingAccessPanel.jsx'), 'utf8'); var sp = fs.readFileSync(path.join(root, 'src/lib/server-permissions.js'), 'utf8'); var st = fs.readFileSync(path.join(root, 'src/components/SettingsTab.jsx'), 'utf8');
  check('the switch is on Banking & Accounting Access and is 🔒 (server list, Settings list)', /key: 'invoice\.delete', label: 'Delete \/ void invoices 🔒'/.test(panel) && /'invoice\.delete': 1/.test(sp) && /'invoice\.delete': true/.test(st));
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-UM-invoice-delete.sql'), 'utf8');
  check('SQL: the database guard lists invoice.delete; browser DELETE on invoices / proformas revoked; read-only check list', /'invoice\.delete', 'advances\.manage'\) THEN/.test(sql) && /REVOKE DELETE ON TABLE public\.accounting_invoices FROM public, anon, authenticated/.test(sql) && /REVOKE DELETE ON TABLE public\.accounting_proformas/.test(sql) && /browser cannot delete invoices/.test(sql));
  // ── Codex 21:35 P1 #4 — "Delete incl. Wave": nothing changed before the answer; payments never deleted; DB step checked before Wave
  var wave2 = fs.readFileSync(path.join(root, 'src/app/api/wave/delete-invoice/route.js'), 'utf8');
  check('Wave route: payment records are never deleted (no delete on accounting_invoice_payments, no "acknowledge" path)', !/accounting_invoice_payments'\)\.delete\(\)/.test(wave2) && wave2.indexOf('acknowledge_hub_payments') < 0 && /reason: 'hub_payments_block'/.test(wave2));
  var iProbe = wave2.indexOf('after_wave_delete: true, check_only: true } })'); var iWaveCall = wave2.indexOf('await fetch(WAVE_URL'); var iHubStep = wave2.lastIndexOf("after_wave_delete: true } })");
  check('Wave route: checks the database step is installed BEFORE calling Wave, and does the Hub part through it AFTER Wave', iProbe > 0 && iWaveCall > iProbe && iHubStep > iWaveCall && wave2.indexOf("from('accounting_invoices').delete()") < 0);
  var tab2 = fs.readFileSync(path.join(root, 'src/components/AccountingInvoicesTab.jsx'), 'utf8');
  var dw = tab2.substring(tab2.indexOf('function deleteWithWave'), tab2.indexOf('function deleteWithWave') + 2500);
  check('invoice screen: “Delete incl. Wave” changes nothing before the server answers (no releaseBankMatches) and offers no “delete payments too?”', dw.indexOf('releaseBankMatches(') < 0 && dw.indexOf('acknowledge_hub_payments') < 0 && dw.indexOf('hub_payments_need_ack') < 0);
  var sqlx = fs.readFileSync(path.join(root, 'sql/v55-83-UM-invoice-delete.sql'), 'utf8');
  check('SQL: one locked step only the server may run; browser status changes guarded by a trigger', /FUNCTION public\.hub_invoice_lifecycle\(p jsonb\)/.test(sqlx) && /REVOKE ALL ON FUNCTION public\.hub_invoice_lifecycle\(jsonb\) FROM public, anon, authenticated/.test(sqlx) && /GRANT EXECUTE ON FUNCTION public\.hub_invoice_lifecycle\(jsonb\) TO service_role/.test(sqlx) && /CREATE TRIGGER hub_guard_invoice_status BEFORE UPDATE ON public\.accounting_invoices/.test(sqlx));
  console.log('\nUM invoice delete: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
