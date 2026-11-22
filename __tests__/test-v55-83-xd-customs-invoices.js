// v55.83-XD (Max, 21 Nov 2026: a customs invoice "saved under te original invoice like a proforma invoice" with "ZEROR implications
// on any underlying reported data") — isolation, the REAL route (permissions, history window, versions, void), the REAL rules
// in src/lib/customs-invoice.js, and the screen wiring. The report-by-report proof is test-v55-83-xd-reports-unchanged.js; the
// database proof is test-v55-83-xd-customs-sql.mjs.
var path = require('path'); var fs = require('fs'); var crypto = require('crypto');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }
console.log('XD — customs invoice under a customer invoice');
function rd(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// ── 1. isolation: which files may name the customs tables / route / steps
function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); } else if (/\.(js|jsx|mjs|ts|tsx)$/.test(e.name)) { out.push(path.relative(root, p).replace(/\\/g, '/')); }
  });
  return out;
}
var files = walk(path.join(root, 'src'), []);
var NAMES = /accounting_customs_invoice|hub_customs_invoice_|\/api\/accounting\/customs-invoices|customs-invoice['"]|CustomsInvoiceBox/;
var allowed = ['src/app/api/accounting/customs-invoices/route.js', 'src/lib/customs-invoice.js', 'src/components/CustomsInvoiceBox.jsx', 'src/components/AccountingInvoicesTab.jsx', 'src/components/WhatsNewWidget.jsx'];
var naming = files.filter(function (f) { return NAMES.test(fs.readFileSync(path.join(root, f), 'utf8')); });
check('only the customs route, its rules, its box, the invoice screen (mount) and What\'s New name the customs tables / route', naming.every(function (f) { return allowed.indexOf(f) >= 0; }) && naming.length === allowed.length, naming);
var readers = files.filter(function (f) { return /accounting_invoices|accounting_invoice_items|accounting_invoice_payments/.test(fs.readFileSync(path.join(root, f), 'utf8')); });
var outside = readers.filter(function (f) { return allowed.indexOf(f) < 0; });
check('every other file that reads invoices (' + outside.length + ' of them: reports, balances, Wave, reminders, matching, orders) never names a customs table', outside.length >= 45 && outside.every(function (f) { return !/customs_invoice|hub_customs_invoice_|customs-invoices/.test(fs.readFileSync(path.join(root, f), 'utf8')); }), outside.length);
['src/app/api/accounting/sales-report/route.js', 'src/app/api/accounting/pnl/route.js', 'src/app/api/accounting/profitability/route.js', 'src/app/api/accounting/customers-overview/route.js',
  'src/app/api/accounting/reminders/route.js', 'src/app/api/accounting/order-monitor/route.js', 'src/app/api/wave/push-invoice-v2/route.js', 'src/app/api/wave/approve-invoice/route.js', 'src/app/api/ai/reports/route.js', 'src/lib/duplicates-server.js', 'src/app/api/plaid/match/route.js', 'src/app/api/accounting/invoice-lifecycle/route.js', 'src/app/api/accounting/invoice-write/route.js'].forEach(function (f) {
  check('in the reader list and untouched by customs: ' + f, readers.indexOf(f) >= 0 && outside.indexOf(f) >= 0);
});
var tab = rd('src/components/AccountingInvoicesTab.jsx');
var tabCustoms = tab.split('\n').filter(function (l) { return /customs/i.test(l); });
check('the invoice screen only imports and mounts the box (2 lines), nothing in its load / save / print / totals', tabCustoms.length === 3 && /^import CustomsInvoiceBox/.test(tabCustoms[0].trim()) && /CustomsInvoiceBox invoice=\{viewing\}/.test(tabCustoms[2]), tabCustoms);

// ── 2. the route writes ONLY the customs steps and the audit log; no Wave / reminder / payment code
var route = rd('src/app/api/accounting/customs-invoices/route.js');
var writes = (route.match(/\.(insert|update|upsert|delete)\(/g) || []);
check('the route has no direct insert / update / upsert / delete at all (writes go through the three locked steps)', writes.length === 0, writes);
var rpcs = (route.match(/rpc\('([a-z_]+)'/g) || []).map(function (s) { return s.replace("rpc('", '').replace("'", ''); });
check('the only database steps it calls are the three customs steps', rpcs.length === 3 && rpcs.every(function (r) { return /^hub_customs_invoice_(create|save|void)$/.test(r); }), rpcs);
var tablesRead = (route.match(/from\('([a-z_]+)'\)/g) || []).map(function (s) { return s.replace("from('", '').replace("')", ''); }).concat(route.indexOf('from(DOCS)') >= 0 ? ['DOCS'] : []).concat(route.indexOf('from(VERS)') >= 0 ? ['VERS'] : []);
check('it reads only invoices (one), users (a name), and its own tables', tablesRead.every(function (t) { return ['accounting_invoices', 'users', 'DOCS', 'VERS'].indexOf(t) >= 0; }), tablesRead);
check('it imports nothing about Wave, reminders, payments or numbering', !/wave|reminder|payment-matching|bank-allocation|invoice-number/i.test(route.split('\n').filter(function (l) { return /^import /.test(l); }).join('\n')));
check('the sign-in comes from verifiedCaller, never a user_id in the request', /verifiedCaller\(req, body, createClient\)/.test(route) && !/body\.user_id/.test(route));
check('SWC-safe: no template strings / arrows / let in the route', !/`|=>|\blet\s/.test(route));

// ── 3. the rules (real module)
var L = require(path.join(root, 'src/lib/customs-invoice.js'));
var good = { title: 'commercial invoice', printed_number: ' INV-7 ', doc_date: '2026-10-01', currency: 'usd', lines: [{ description: 'Kraft', quantity: '1,000', unit_price: '0.45' }, { description: '', quantity: '', unit_price: '' }, { description: 'Liner', quantity: 2, unit_price: 10.005 }], freight: '100', insurance: 5.5, other_charges: '' };
var c = L.cleanDoc(good);
check('a good doc is cleaned: title, number trimmed, currency upper-case, the blank line dropped, amounts per line', c.ok && c.doc.title === 'COMMERCIAL INVOICE' && c.doc.printed_number === 'INV-7' && c.doc.currency === 'USD' && c.doc.lines.length === 2 && c.doc.lines[0].amount === 450 && c.doc.lines[1].amount === 20.01, c);
check('the total is worked out on the server: lines + freight + insurance (450 + 20.01 + 100 + 5.5 = 575.51)', c.total === 575.51 && c.doc.total === 575.51, c.total);
check('a browser total is ignored', L.cleanDoc(Object.assign({}, good, { total: 1 })).total === 575.51);
check('an unknown title becomes CUSTOMS INVOICE', L.cleanDoc(Object.assign({}, good, { title: '<b>x</b>' })).doc.title === 'CUSTOMS INVOICE');
check('no printed number = refused', !L.cleanDoc(Object.assign({}, good, { printed_number: '  ' })).ok);
check('a fake date = refused', !L.cleanDoc(Object.assign({}, good, { doc_date: '2026-02-30' })).ok);
check('a negative price = refused', !L.cleanDoc(Object.assign({}, good, { lines: [{ description: 'x', quantity: 1, unit_price: -1 }] })).ok);
check('a price that is not a number = refused', !L.cleanDoc(Object.assign({}, good, { lines: [{ description: 'x', quantity: 1, unit_price: 'abc' }] })).ok);
check('a line with a price but no description = refused', !L.cleanDoc(Object.assign({}, good, { lines: [{ description: '', quantity: 1, unit_price: 5 }] })).ok);
check('no lines = refused', !L.cleanDoc(Object.assign({}, good, { lines: [] })).ok);
check('more than 200 lines = refused', !L.cleanDoc(Object.assign({}, good, { lines: new Array(201).fill(0).map(function () { return { description: 'x', quantity: 1, unit_price: 1 }; }) })).ok);
check('a negative freight = refused', !L.cleanDoc(Object.assign({}, good, { freight: -3 })).ok);
check('a bad currency = refused', !L.cleanDoc(Object.assign({}, good, { currency: 'dollars' })).ok);
check('very long text is cut, never refused', L.cleanDoc(Object.assign({}, good, { notes: new Array(5000).join('a') })).doc.notes.length === 2000);
check('not an object = refused', !L.cleanDoc(null).ok && !L.cleanDoc([1]).ok);
var pre = L.prefillDoc({ invoice_number: 'INV-9', invoice_date: '2026-10-03', currency: 'eur', release_number: '1002-5' }, [{ description: 'Paper', quantity: 3, unit_price: 2 }], { company_name: 'KTC', address: 'Houston' }, { company_name: 'Alpha', billing_address: 'Cairo' });
check('the starting point copies the invoice number (Max: "original number"), date, currency, lines, exporter, consignee, release', pre.printed_number === 'INV-9' && pre.doc_date === '2026-10-03' && pre.currency === 'EUR' && pre.lines[0].description === 'Paper' && /KTC/.test(pre.exporter) && /Alpha/.test(pre.consignee) && /1002-5/.test(pre.reference));
check('the starting point is itself a valid doc', L.cleanDoc(pre).ok);
var html = L.customsPrintHtml(c.doc, { logoDataUrl: 'javascript:alert(1)' });
check('the print shows the title and the printed number', /COMMERCIAL INVOICE/.test(html) && /Invoice # INV-7/.test(html));
check('the print never shows amount paid / balance due', !/Balance due|Amount paid/i.test(html));
check('the print shows the total and freight / insurance', /575\.51/.test(html) && /Freight/.test(html) && /Insurance/.test(html));
check('text is escaped in the print, and a non-image logo is never used', !/<script>alert/.test(L.customsPrintHtml(Object.assign({}, c.doc, { notes: '<script>alert(1)</script>' }), {})) && !/javascript:/.test(html));
check('window: no floor = all; the saved date AND the invoice date today must both be inside', L.customsVisible({ invoice_date_at_creation: '2020-01-01' }, null, null) && L.customsVisible({ invoice_date_at_creation: '2026-07-01' }, { invoice_date: '2026-07-02' }, '2026-06-01')
  && !L.customsVisible({ invoice_date_at_creation: '2026-05-01' }, { invoice_date: '2026-07-02' }, '2026-06-01') && !L.customsVisible({ invoice_date_at_creation: '2026-07-01' }, { invoice_date: '2026-05-02' }, '2026-06-01')
  && L.customsVisible({ invoice_date_at_creation: '2026-07-01' }, null, '2026-06-01') && !L.customsVisible({ invoice_date_at_creation: null }, null, '2026-06-01'));
check('database refusals become plain answers (stale 409, voided 409, not installed 409)', L.stepError({ message: 'HUB_STALE: someone saved version 3 meanwhile.' }).status === 409 && L.stepError({ message: 'HUB_VOIDED: x' }).code === 'voided' && L.stepError({ message: 'function public.hub_customs_invoice_create(p jsonb) does not exist' }).code === 'not_installed');

// ── 4. the REAL route on an in-memory database
var state = { db: null, who: { userId: null } };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve(state.who); } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var R = require(path.join(root, 'src/app/api/accounting/customs-invoices/route.js'));
var U = function (n) { return '00000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); };
var SUPER = U(1), VIEW = U(2), EDIT = U(3), EDIT2 = U(4), NONE = U(5), ADMIN = U(6);
var INV = U(201), INV_OLD = U(202), INV_VOID = U(203), INV_GONE = U(299);
function fresh(windowFrom) {
  var db = new FakeDb({}); state.ops = [];
  var raw = db.from; db.from = function (t) { var q = raw(t); var ins = q.insert, upd = q.update, del = q.delete;
    q.insert = function (r) { state.ops.push(t + ':insert'); return ins.call(q, r); }; q.update = function (p) { state.ops.push(t + ':update'); return upd.call(q, p); }; q.delete = function () { state.ops.push(t + ':delete'); return del.call(q); }; return q; };
  db.t.users = [{ id: SUPER, role: 'super_admin', name: 'Max' }, { id: VIEW, role: 'staff', name: 'Vera' }, { id: EDIT, role: 'staff', name: 'Eddie' }, { id: EDIT2, role: 'staff', name: 'Ella' }, { id: NONE, role: 'staff', name: 'Nobody' }, { id: ADMIN, role: 'admin', name: 'Admin' }];
  db.t.module_permissions = [{ user_id: VIEW, module_name: 'invoice.view', has_access: true }, { user_id: EDIT, module_name: 'invoice.create', has_access: true }, { user_id: EDIT2, module_name: 'Invoice: Edit', has_access: true }];
  db.t.app_settings = [{ id: 's1', key: 'accounting_visibility_window', value: { window: 'custom', customFrom: windowFrom || '2026-06-01', customDays: null } }];
  db.t.accounting_invoices = [
    { id: INV, invoice_number: 'INV-1', invoice_date: '2026-10-05', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', record_status: 'active', total_amount: 1000 },
    { id: INV_OLD, invoice_number: 'INV-OLD', invoice_date: '2026-02-01', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', record_status: 'active', total_amount: 9 },
    { id: INV_VOID, invoice_number: 'INV-V', invoice_date: '2026-10-06', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', record_status: 'void', total_amount: 9 }];
  db.calls = [];
  db.rpcs.hub_customs_invoice_create = function (a) { db.calls.push(['create', a.p]); var rows = db.t.accounting_customs_invoices || (db.t.accounting_customs_invoices = []); var seq = rows.filter(function (r) { return r.invoice_id === a.p.invoice_id; }).length + 1; var id = crypto.randomUUID();
    rows.push({ id: id, invoice_id: a.p.invoice_id, seq: seq, invoice_number_at_creation: a.p.invoice_number, invoice_date_at_creation: a.p.invoice_date, created_by_name: a.p.actor_name, created_at: 'now', voided_at: null });
    (db.t.accounting_customs_invoice_versions = db.t.accounting_customs_invoice_versions || []).push({ id: crypto.randomUUID(), customs_invoice_id: id, version: 1, doc: a.p.doc, total: a.p.total, currency: a.p.currency, saved_by_name: a.p.actor_name, saved_at: 'now' });
    return { data: { id: id, seq: seq, version: 1 }, error: null }; };
  db.rpcs.hub_customs_invoice_save = function (a) { db.calls.push(['save', a.p]); var vs = db.t.accounting_customs_invoice_versions.filter(function (v) { return v.customs_invoice_id === a.p.customs_invoice_id; }); var n = vs.reduce(function (m, v) { return Math.max(m, v.version); }, 0);
    if (a.p.base_version !== n) { return { data: null, error: { message: 'HUB_STALE: someone saved version ' + n + ' meanwhile. Reload to see it, then make your change again.' } }; }
    db.t.accounting_customs_invoice_versions.push({ id: crypto.randomUUID(), customs_invoice_id: a.p.customs_invoice_id, version: n + 1, doc: a.p.doc, total: a.p.total, currency: a.p.currency, saved_by_name: a.p.actor_name, saved_at: 'now' }); return { data: { version: n + 1 }, error: null }; };
  db.rpcs.hub_customs_invoice_void = function (a) { db.calls.push(['void', a.p]); var r = db.t.accounting_customs_invoices.filter(function (x) { return x.id === a.p.customs_invoice_id; })[0]; r.voided_at = 'now'; r.voided_by_name = a.p.actor_name; r.void_reason = a.p.reason; return { data: { voided: true }, error: null }; };
  state.db = db; return db;
}
function call(who, body) {
  state.who = who === null ? { error: 'Sign in again.', status: 401 } : { userId: who };
  return R.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: 'Bearer t' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
}
var DOC = { printed_number: 'INV-1', doc_date: '2026-10-05', currency: 'USD', lines: [{ description: 'Kraft', quantity: 10, unit_price: 2 }], freight: 5 };

(async function main() {
  var db = fresh();
  var r;
  r = await call(null, { action: 'list', invoice_id: INV }); check('no sign-in = 401', r._status === 401, r);
  r = await call(NONE, { action: 'list', invoice_id: INV }); check('no invoice switch = 403', r._status === 403, r);
  r = await call(ADMIN, { action: 'list', invoice_id: INV }); check('an admin with no invoice switch = 403 (switches only, Max UG)', r._status === 403, r);
  r = await call(VIEW, { action: 'list', invoice_id: INV }); check('Invoices: View sees the (empty) list, cannot edit', r._status === 200 && r.items.length === 0 && r.can_edit === false, r);
  r = await call(VIEW, { action: 'create', invoice_id: INV, doc: DOC }); check('Invoices: View cannot make one (403), nothing written', r._status === 403 && db.calls.length === 0, r);
  r = await call(EDIT, { action: 'create', invoice_id: INV_OLD, doc: DOC }); check('an invoice older than the window = 403, nothing written', r._status === 403 && db.calls.length === 0, r);
  r = await call(EDIT, { action: 'create', invoice_id: INV_VOID, doc: DOC }); check('a voided invoice = refused, nothing written', r._status === 409 && db.calls.length === 0, r);
  r = await call(EDIT, { action: 'create', invoice_id: INV_GONE, doc: DOC }); check('an invoice that is not there = 404', r._status === 404, r);
  r = await call(EDIT, { action: 'create', invoice_id: INV, doc: Object.assign({}, DOC, { lines: [] }) }); check('a doc with no lines = 400, nothing written', r._status === 400 && db.calls.length === 0, r);
  r = await call(EDIT, { action: 'create', invoice_id: INV, doc: DOC, user_id: SUPER });
  check('Invoice: Create makes one (Customs #1, version 1) in ONE database step', r._status === 200 && r.seq === 1 && r.version === 1 && db.calls.length === 1, r);
  var made = db.calls[0][1];
  check('the snapshot comes from the real invoice (number, date, customer, business), the actor is the signed-in person', made.invoice_number === 'INV-1' && made.invoice_date === '2026-10-05' && made.accounting_customer_id === 'cA' && made.business_id === 'b1' && made.actor_id === EDIT && made.actor_name === 'Eddie', made);
  check('the server worked out the total (20 + 5 = 25)', made.total === 25 && made.doc.total === 25);
  check('nothing written outside the customs steps except one audit row', state.ops.join(',') === 'hub_audit_log:insert', state.ops);
  check('the audit row names the action and the invoice', (db.t.hub_audit_log || []).some(function (a) { return a.action === 'customs_invoice_created' && a.details.invoice_id === INV; }));
  var cid = r.id;
  r = await call(EDIT2, { action: 'save', id: cid, base_version: 1, doc: Object.assign({}, DOC, { printed_number: 'INV-1-A' }) }); check('Invoice: Edit saves version 2', r._status === 200 && r.version === 2, r);
  r = await call(EDIT, { action: 'save', id: cid, base_version: 1, doc: DOC }); check('a save on top of an older version = 409 (no silent overwrite)', r._status === 409 && r.code === 'stale', r);
  r = await call(EDIT, { action: 'save', id: cid, doc: DOC }); check('a save that does not say which version it edited = 400', r._status === 400, r);
  r = await call(VIEW, { action: 'get', id: cid }); check('the viewer sees every version, newest first, each with what it says', r._status === 200 && r.versions.length === 2 && r.versions[0].version === 2 && r.versions[0].doc.printed_number === 'INV-1-A' && r.versions[1].doc.printed_number === 'INV-1' && r.invoice_exists === true, r);
  r = await call(VIEW, { action: 'list', invoice_id: INV }); check('the list shows Customs #1 at version 2', r.items.length === 1 && r.items[0].label === 'Customs #1' && r.items[0].newest.version === 2, r);
  r = await call(EDIT, { action: 'void', id: cid, reason: '' }); check('void needs a reason', r._status === 400, r);
  r = await call(VIEW, { action: 'void', id: cid, reason: 'x' }); check('a viewer cannot void', r._status === 403, r);
  r = await call(EDIT, { action: 'void', id: cid, reason: 'wrong goods' }); check('void works and is audited', r._status === 200 && (db.t.hub_audit_log || []).some(function (a) { return a.action === 'customs_invoice_voided'; }), r);
  r = await call(EDIT, { action: 'save', id: cid, base_version: 2, doc: DOC }); check('a voided customs invoice cannot be edited', r._status === 409 && r.code === 'voided', r);
  r = await call(EDIT, { action: 'void', id: cid, reason: 'again' }); check('cannot be voided twice', r._status === 409, r);
  r = await call(VIEW, { action: 'get', id: cid }); check('the voided one stays readable with all versions and who voided it', r._status === 200 && r.customs.voided === true && r.customs.void_reason === 'wrong goods' && r.versions.length === 2, r);
  // the invoice is deleted later: the customs paper stays on record; the window still applies, on its saved date
  db.t.accounting_invoices = db.t.accounting_invoices.filter(function (x) { return x.id !== INV; });
  r = await call(VIEW, { action: 'get', id: cid }); check('after the invoice is deleted the customs paper is still readable (inside the window)', r._status === 200 && r.invoice_exists === false, r);
  r = await call(SUPER, { action: 'get', id: cid }); check('the super admin reads it too', r._status === 200, r);
  fresh('2026-11-01'); state.db.t.accounting_customs_invoices = [{ id: cid, invoice_id: INV, seq: 1, invoice_date_at_creation: '2026-10-05', voided_at: null }];
  state.db.t.accounting_customs_invoice_versions = [{ id: 'v', customs_invoice_id: cid, version: 1, doc: DOC }];
  r = await call(VIEW, { action: 'get', id: cid }); check('a deleted-invoice customs paper dated before the person\'s window = 403 (its saved date decides)', r._status === 403, r);
  r = await call(SUPER, { action: 'get', id: cid }); check('…and the super admin (no window) still reads it', r._status === 200, r);
  // the invoice's date was moved earlier after the customs paper was made: the stricter of the two dates decides
  state.db.t.accounting_invoices = [{ id: INV, invoice_number: 'INV-1', invoice_date: '2026-10-20', record_status: 'active' }];
  state.db.t.accounting_customs_invoices[0].invoice_date_at_creation = '2026-11-05';
  r = await call(VIEW, { action: 'get', id: cid }); check('invoice date today before the window (saved date inside) = 403', r._status === 403, r);
  r = await call(VIEW, { action: 'list', invoice_id: INV }); check('…and the list for that invoice = 403', r._status === 403, r);
  // not installed yet
  var db2 = fresh(); db2.fail.accounting_customs_invoices = { select: 'relation "public.accounting_customs_invoices" does not exist' };
  r = await call(VIEW, { action: 'list', invoice_id: INV }); check('before the SQL is installed the list says so (installed: false), no error', r._status === 200 && r.installed === false, r);
  db2.rpcs.hub_customs_invoice_create = function () { return { data: null, error: { message: 'Could not find the function public.hub_customs_invoice_create(p) in the schema cache' } }; };
  r = await call(EDIT, { action: 'create', invoice_id: INV, doc: DOC }); check('…and making one says which update is needed', r._status === 409 && /v55-83-XD/.test(r.error), r);
  r = await call(EDIT, { action: 'delete', id: cid }); check('there is no delete action', r._status === 400 && /Unknown action/.test(r.error), r);

  // ── 5. the screen
  var box = rd('src/components/CustomsInvoiceBox.jsx');
  check('the box talks only to the customs route, with the sign-in token (hubFetch)', /hubFetch\('\/api\/accounting\/customs-invoices'/.test(box) && !/supabase/.test(box));
  check('the box prints a SAVED version (newest, or the chosen one), never the unsaved form', /printNewest/.test(box) && /printCustomsVersion\(v\.doc/.test(box) && !/printCustomsVersion\(doc, props/.test(box));
  check('the box says plainly it is counted nowhere', /not counted anywhere/.test(box));
  check('edit sends the version it was edited from', /base_version: ed\.base_version/.test(box));
  check('no delete anywhere in the box', !/action: 'delete'|\.delete\(/.test(box));
  // v55.83-XO: a later build moves the badge on — the XD entry stays in What's New, and the badge always names the top entry
  check('What\'s New keeps the XD entry, and the badge names the newest entry on top (XD or a later build)', (function () { var wn = rd('src/components/WhatsNewWidget.jsx'); var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(wn); return wn.indexOf("version: 'v55.83-XD'") > 0 && !!top && rd('src/app/page.jsx').indexOf('>' + top[1] + '</span>') > 0; })());

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
