// v55.83-XV — Max, 23 Nov 2026: "need to have ability to override the 7% requirement with a note that is saved in the audit clearly."
// Part 1: the REAL rule functions. Part 2: the REAL route (invoice-write POST) driven against an in-memory stand-in for the
// database; the sign-in check and the permission check are stand-ins that always allow (they are not what is tested here).
// Part 3: source checks of the screen wiring (they show the wiring exists; they are not browser behaviour).
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder';
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('XV — shipping below cost + 7%: override with a written reason, on the audit trail');

// ── Part 1: the rule ──
var S = require(path.join(root, 'src/lib/shipping-terms.js'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var LINES = [{ description: 'STOCK PVC ROLLS', amount: 24335.62 }, { description: 'Shipping Costs', amount: 3966 }];
var r1 = S.checkShippingTerms('CNF_SEPARATE', '3966', LINES, P.isTransportLine);
check('1: Max\'s invoice (cost 3966, shipping line 3966) is below cost + 7%: need 4243.62, short 277.62', r1.ok === true && r1.markup && r1.markup.need === 4243.62 && r1.markup.charged === 3966 && r1.markup.short === 277.62 && r1.markup.cost === 3966 && r1.warnings.indexOf(r1.markup.warning) >= 0, r1);
check('2: charged exactly cost + 7% (or more) is not a shortfall', S.checkShippingTerms('CNF_SEPARATE', '3966', [{ description: 'Shipping Costs', amount: 4243.62 }], P.isTransportLine).markup === null && S.markupShortfall('CNF_SEPARATE', 3966, [{ description: 'Freight', amount: 5000 }], P.isTransportLine) === null);
check('3: the rule does not apply to CNF in the price, nor to EXW with no shipping line', S.markupShortfall('CNF_INCLUDED', 3966, [{ description: 'Goods', amount: 100 }], P.isTransportLine) === null && S.markupShortfall('EXW', null, [{ description: 'Goods', amount: 100 }], P.isTransportLine) === null);
check('4: EXW with a shipping line below cost + 7% is a shortfall too', (function () { var x = S.markupShortfall('EXW', 1000, [{ description: 'Trucking', amount: 1000 }], P.isTransportLine); return !!x && x.need === 1070 && x.short === 70; })());
check('5: the reason must be at least 10 characters after trimming; spaces alone do not count', S.markupOverrideNote('').ok === false && S.markupOverrideNote('   short   ').ok === false && S.markupOverrideNote(null).ok === false && S.markupOverrideNote('          ').ok === false && S.MARKUP_NOTE_MIN === 10);
check('6: a real reason is accepted, tidied, and cut at 500 characters', S.markupOverrideNote('  Price agreed   before freight rose ').note === 'Price agreed before freight rose' && S.markupOverrideNote(new Array(700).join('x')).note.length === 500);

// ── Part 2: the real route with stand-ins ──
var state;
function fresh(o) { state = Object.assign({ items: [{ description: 'STOCK PVC ROLLS', quantity: 24581.43, unit_price: 0.99, line_total: 24335.62 }, { description: 'Shipping Costs', quantity: 1, unit_price: 3966, line_total: 3966 }], itemsError: null, auditFail: false, audit: [], terms: null, log: [], perms: {}, parts: [], partRows: [] }, o || {}); }
function run(st, single) {
  if (st.table === 'accounting_invoices') { return { data: { id: 'inv-1' }, error: null }; }
  if (st.table === 'accounting_invoice_items') { state.log.push('read-lines'); return state.itemsError ? { data: null, error: { message: state.itemsError } } : { data: state.items, error: null }; }
  if (st.table === 'hub_audit_log') {
    if (st.op === 'insert') { if (state.auditFail && st.row.action === 'shipping_markup_override') { state.log.push('audit-FAILED'); return { data: null, error: { message: 'audit table is down' } }; } state.audit.push(st.row); state.log.push('audit:' + st.row.action); return { data: null, error: null }; }
    return { data: state.audit.filter(function (a) { return a.action === st.filters.action && a.entity_id === st.filters.entity_id; }).slice(-1).map(function (a) { return { details: a.details, at: '2026-11-23T18:00:00Z' }; }), error: null };
  }
  if (st.table === 'pl_release_part_estimates') {
    if (st.op === 'upsert') { state.partRows.push(st.row); state.log.push('save-part'); return { data: null, error: null }; }
    return { data: state.parts, error: null };
  }
  if (st.table === 'pl_invoice_terms') {
    if (st.op === 'upsert') { state.terms = st.row; state.log.push('save-terms'); return { data: [st.row], error: null }; }
    return { data: state.terms, error: null };
  }
  return { data: single ? null : [], error: null };
}
function q(table) {
  var st = { table: table, op: 'select', filters: {} };
  var b = { select: function () { return b; }, eq: function (k, v) { st.filters[k] = v; return b; }, in: function (k, v) { st.filters[k] = v; return b; }, order: function () { return b; }, limit: function () { return b; },
    insert: function (row) { st.op = 'insert'; st.row = row; return b; }, upsert: function (row) { st.op = 'upsert'; st.row = row; return b; },
    maybeSingle: function () { return Promise.resolve(run(st, true)); }, then: function (res, rej) { return Promise.resolve(run(st, false)).then(res, rej); } };
  return b;
}
var realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'next/server') { return { NextResponse: { json: function (body, init) { return { body: body, status: (init && init.status) || 200 }; } } }; }
  if (request === '@supabase/supabase-js') { return { createClient: function () { return { from: q }; } }; }
  if (/lib\/verified-caller$/.test(request)) { return { verifiedCaller: function () { return Promise.resolve({ userId: 'user-1' }); } }; }
  if (/lib\/server-permissions$/.test(request)) { return { assertPermission: function () { return Promise.resolve({ ok: true }); } }; }
  if (/lib\/invoice-extract-server$/.test(request)) { return { readInvoiceFromBase64: function () { return Promise.resolve(null); } }; }
  return realLoad.apply(this, arguments);
};
var route = require(path.join(root, 'src/app/api/accounting/invoice-write/route.js'));
Module._load = realLoad;
// the Profitability route (shipping breakdown actions): same database stand-in; here the PERMISSION stand-in answers from state.perms
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'user-1' }); } });
stub('src/lib/server-permissions.js', { assertPermission: function (db, uid, perm) { return Promise.resolve(state.perms[perm] ? { ok: true, ctx: { isSuperAdmin: false, mp: state.perms } } : { ok: false, status: 403, error: 'no ' + perm }); }, loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: false, mp: state.perms }); }, userHasPermission: function (ctx, perm) { return !!(ctx && ctx.mp && ctx.mp[perm]); } });
stub('src/lib/visibility-window-server.js', { windowFloorFor: function () { return Promise.resolve({ floor: null }); }, clampFrom: function (x) { return x; } });
var supaP = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supaP] = { id: supaP, filename: supaP, loaded: true, exports: { createClient: function () { return { from: q }; } } };
var PR = require(path.join(root, 'src/app/api/accounting/profitability/route.js'));
function pcall(body) { return PR.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'user-1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); }); }
var SP = require(path.join(root, 'src/components/ShippingPartsBox.jsx'));
function call(body) { return route.POST({ json: function () { return Promise.resolve(Object.assign({ invoice_id: 'inv-1' }, body)); }, headers: { get: function () { return null; } } }); }
function setTerms(extra) { return call(Object.assign({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 3966 }, extra || {})); }
var REASON = 'Price agreed with the customer before the freight went up';

(async function () {
  fresh(); var a = await setTerms();
  check('7: below cost + 7% with NO reason → refused (markup_note_needed); nothing saved, nothing on the audit trail', a.status === 400 && a.body.ok === false && a.body.code === 'markup_note_needed' && /4243\.62/.test(a.body.error) && /3966\.00/.test(a.body.error) && state.terms === null && state.audit.length === 0, [a, state.log]);
  fresh(); var b = await setTerms({ markup_override_note: '  too short ' });
  check('8: a reason shorter than 10 characters → refused the same way', b.status === 400 && b.body.code === 'markup_note_needed' && state.terms === null && state.audit.length === 0, b);
  fresh(); var c = await setTerms({ markup_override_note: '  ' + REASON + '  ' });
  var row = state.audit.filter(function (x) { return x.action === 'shipping_markup_override'; })[0];
  check('9: with a reason → saved; ONE audit row: who, which invoice, the reason, cost 3966, minimum 4243.62, charged 3966, short by 277.62', c.status === 200 && c.body.ok === true && !!row && row.actor_id === 'user-1' && row.entity === 'accounting_invoice' && row.entity_id === 'inv-1' && row.details.reason === REASON && row.details.overridden === true && row.details.shipping_cost === 3966 && row.details.minimum_required === 4243.62 && row.details.shipping_charged === 3966 && row.details.short_by === 277.62 && row.details.shipping_terms === 'CNF_SEPARATE' && state.audit.filter(function (x) { return x.action === 'shipping_markup_override'; }).length === 1, [c, row]);
  check('10: the reason is written to the audit trail BEFORE the shipping terms are saved', state.log.indexOf('audit:shipping_markup_override') >= 0 && state.log.indexOf('audit:shipping_markup_override') < state.log.indexOf('save-terms') && state.log.indexOf('read-lines') < state.log.indexOf('audit:shipping_markup_override'), state.log);
  check('11: the answer says an override was recorded, with the shortfall', !!c.body.markup_override && c.body.markup_override.short_by === 277.62 && state.terms && state.terms.shipping_terms === 'CNF_SEPARATE' && state.terms.shipping_cost_estimate === 3966, c.body);
  fresh({ auditFail: true }); var d = await setTerms({ markup_override_note: REASON });
  check('12: if the audit trail cannot be written, NOTHING is saved and the person is told', d.status === 500 && d.body.ok === false && /audit trail/.test(d.body.error) && state.terms === null, [d, state.log]);
  fresh({ items: [{ description: 'Goods', quantity: 1, unit_price: 100, line_total: 100 }, { description: 'Shipping Costs', quantity: 1, unit_price: 4243.62, line_total: 4243.62 }] }); var e = await setTerms({ markup_override_note: REASON });
  check('13: at or above cost + 7% → saved normally and NO override row, even if a reason was sent', e.status === 200 && e.body.ok === true && e.body.markup_override === null && state.audit.filter(function (x) { return x.action === 'shipping_markup_override'; }).length === 0 && state.terms !== null, [e, state.audit]);
  fresh(); var f = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_INCLUDED', shipping_cost_estimate: 3966 });
  check('14: CNF in the price is not held to the separate-line rule (no reason asked)', f.status === 200 && f.body.ok === true && state.audit.filter(function (x) { return x.action === 'shipping_markup_override'; }).length === 0, f);
  fresh({ itemsError: 'timeout' }); var g = await setTerms({ markup_override_note: REASON });
  check('15: if the invoice lines cannot be read, nothing is saved (the rule is never skipped silently)', g.status === 500 && g.body.ok === false && /invoice lines/.test(g.body.error) && state.terms === null && state.audit.length === 0, g);
  fresh({ items: [{ description: 'Goods', quantity: 1, unit_price: 100, line_total: 0 }, { description: 'Freight', quantity: 2, unit_price: 1000, line_total: null }] }); var h = await setTerms({ shipping_cost_estimate: 2000 });
  check('16: a line with no stored total is counted as quantity × price (2 × 1000 = 2000 < 2140 → reason needed)', h.status === 400 && h.body.code === 'markup_note_needed' && /2140\.00/.test(h.body.error), h);
  fresh(); await setTerms({ markup_override_note: REASON }); var i = await call({ action: 'get_shipping_terms' });
  check('17: opening the invoice again gives the saved reason back', i.status === 200 && i.body.ok === true && i.body.markup_override_note === REASON && i.body.shipping_terms === 'CNF_SEPARATE', i.body);
  fresh(); var j = await call({ action: 'get_shipping_terms' });
  check('18: an invoice with no override gives an empty reason', j.status === 200 && j.body.markup_override_note === '' && j.body.markup_override_at === null, j.body);

  // ── Part 2b: "Inside the shipping" works with the invoicing permission (real Profitability route) ──
  var PARTS = [{ release_key: '10011622', part: 'trucking', amount: 1500, note: null, updated_at: null }];
  fresh({ perms: {}, parts: PARTS }); var p1 = await pcall({ action: 'release_parts', releases: ['1001-1622'] });
  check('23: no invoicing and no P&L permission → the breakdown is refused, and the message names the invoicing permission', p1.status === 403 && p1.body.ok === false && /Invoices: Edit/.test(p1.body.error), p1);
  fresh({ perms: { 'invoices.edit': true }, parts: PARTS }); var p2 = await pcall({ action: 'release_parts', releases: ['1001-1622'] });
  check('24: invoicing permission ONLY → the breakdown opens and can be typed (no P&L permission needed)', p2.status === 200 && p2.body.ok === true && p2.body.can_edit === true && p2.body.parts['10011622'].trucking.amount === 1500, p2);
  fresh({ perms: { 'invoices.edit': true } }); var p3 = await pcall({ action: 'set_part_estimate', release: '1001-1622', part: 'freight', amount: '2466' });
  check('25: invoicing permission ONLY → a part is saved for the release, and the change is on the audit trail', p3.status === 200 && p3.body.ok === true && state.partRows.length === 1 && state.partRows[0].release_key === '10011622' && state.partRows[0].part === 'freight' && state.partRows[0].amount === 2466 && state.partRows[0].updated_by === 'user-1' && state.audit.some(function (x) { return x.action === 'pl_part_estimate_set' && x.entity_id === '10011622'; }), [p3, state.partRows, state.audit]);
  fresh({ perms: { 'invoices.edit': true } }); var p4 = await pcall({ action: 'report' }); var p5 = await pcall({ action: 'set_estimate', release: '1001-1622', amount: '5' }); var p5b = await pcall({ action: 'inbound_trucking' });
  check('26: invoicing permission ONLY opens NOTHING else of the profit report (report, other set-up, inbound trucking all refused; nothing written)', p4.status === 403 && /P&L: View/.test(p4.body.error) && p5.status === 403 && p5b.status === 403 && state.partRows.length === 0 && state.audit.length === 0, [p4, p5, p5b]);
  fresh({ perms: { 'pnl.view': true }, parts: PARTS }); var p6 = await pcall({ action: 'release_parts', releases: ['1001-1622'] }); var p7 = await pcall({ action: 'set_part_estimate', release: '1001-1622', part: 'freight', amount: '1' });
  check('27: "P&L: View" alone still only READS the breakdown (as before): can_edit false, typing refused', p6.status === 200 && p6.body.can_edit === false && p7.status === 403 && state.partRows.length === 0, [p6, p7]);
  fresh({ perms: { 'pnl.view': true, 'invoices.edit': true } }); var p8 = await pcall({ action: 'set_part_estimate', release: '1001-1622', part: 'trucking', amount: '0' }); var p9 = await pcall({ action: 'set_estimate', release: '1001-1622', amount: '5' });
  check('28: with invoicing + "P&L: View": a part can be typed (0 is a value), but the other set-up actions still need "P&L: Edit Product Costs"', p8.status === 200 && state.partRows.length === 1 && state.partRows[0].amount === 0 && p9.status === 403 && /Edit Product Costs/.test(p9.body.error), [p8, p9]);

  // ── Part 2c: the breakdown adds itself up (real function) ──
  function pp(t, f2, o, bnd) { var x = {}; if (t !== undefined) { x.trucking = { amount: t }; } if (f2 !== undefined) { x.freight = { amount: f2 }; } if (o !== undefined) { x.other = { amount: o }; } if (bnd !== undefined) { x.bond = { amount: bnd }; } return x; }
  var g1 = SP.aggregateTyped({ '10011622': pp(1500, 2466, 34, 250) }, ['1001-1622']);
  check('29: trucking 1500 + freight 2466 + other 34 = 4000 for the cost box; bond 250 is NOT added', g1.complete === true && g1.total === 4000, g1);
  check('30: only ONE of trucking / freight typed → not complete, the cost box is left alone', SP.aggregateTyped({ '10011622': pp(1500) }, ['1001-1622']).complete === false && SP.aggregateTyped({ '10011622': pp(undefined, 2466, 10) }, ['1001-1622']).complete === false && SP.aggregateTyped({}, ['1001-1622']).complete === false && SP.aggregateTyped({ '10011622': pp(1, 2) }, []).complete === false);
  check('31: 0 counts as typed (there was none): trucking 0 + freight 2466 = 2466', (function () { var x = SP.aggregateTyped({ '10011622': pp(0, 2466) }, ['1001-1622']); return x.complete === true && x.total === 2466; })());
  check('32: an invoice on two releases is complete only when BOTH have trucking and freight; then the two are added', SP.aggregateTyped({ '10021176': pp(100, 200), '10021177': pp(50) }, ['1002-1176', '1002-1177']).complete === false && (function () { var x = SP.aggregateTyped({ '10021176': pp(100, 200), '10021177': pp(50, 25.5) }, ['1002-1176', '1002-1177']); return x.complete === true && x.total === 375.5; })());

  // ── Part 2d: the total fills the shipping CHARGE line (real function) ──
  function blank() { return { description: '', quantity: '1', unit_price: '0', sku: '' }; }
  var IT = [{ description: 'STOCK PVC ROLLS', quantity: '24581.43', unit_price: '0.99' }, { description: 'Shipping Costs', quantity: '1', unit_price: '3966' }];
  var fa = S.fillShippingLine(IT, 4000, 'CNF_SEPARATE', P.isTransportLine, blank);
  check('35: one shipping line → it becomes 1 × 4000; the goods line and the original list are untouched', fa.changed === true && fa.why === 'updated' && fa.items[1].unit_price === '4000' && fa.items[1].quantity === '1' && fa.items[1].description === 'Shipping Costs' && fa.items[0] === IT[0] && IT[1].unit_price === '3966', fa);
  var fb = S.fillShippingLine([IT[0]], 4000, 'CNF_SEPARATE', P.isTransportLine, blank);
  check('36: no shipping line on “CNF, separate line” → one line “Shipping Costs” 1 × 4000 is added', fb.changed === true && fb.why === 'added' && fb.items.length === 2 && fb.items[1].description === 'Shipping Costs' && fb.items[1].unit_price === '4000' && fb.items[1].quantity === '1', fb);
  check('37: no shipping line on EXW or on CNF in the price → nothing is added', S.fillShippingLine([IT[0]], 4000, 'EXW', P.isTransportLine, blank).changed === false && S.fillShippingLine([IT[0]], 4000, 'CNF_INCLUDED', P.isTransportLine, blank).changed === false);
  var fc = S.fillShippingLine(IT.concat([{ description: 'Trucking to port', quantity: '1', unit_price: '500' }]), 4000, 'CNF_SEPARATE', P.isTransportLine, blank);
  check('38: several shipping lines → nothing is changed and the count is reported', fc.changed === false && fc.why === 'several_lines' && fc.count === 2 && fc.items[1].unit_price === '3966', fc);
  var fd = S.fillShippingLine(IT.concat([{ description: 'Overweight surcharge', quantity: '1', unit_price: '300' }]), 4000, 'CNF_SEPARATE', P.isTransportLine, blank);
  check('39: a surcharge line is never taken for the shipping line (it keeps its 300; the shipping line is filled)', fd.changed === true && fd.items[1].unit_price === '4000' && fd.items[2].unit_price === '300', fd);
  check('40: a total of 0, or the same amount already there, changes nothing', S.fillShippingLine(IT, 0, 'CNF_SEPARATE', P.isTransportLine, blank).changed === false && S.fillShippingLine(IT, 3966, 'CNF_SEPARATE', P.isTransportLine, blank).changed === false);
  var after = S.checkShippingTerms('CNF_SEPARATE', '4000', fa.items.map(function (it) { return { description: it.description, amount: Number(it.quantity) * Number(it.unit_price) }; }), P.isTransportLine);
  check('41: charging exactly the cost is below cost + 7%, so the written reason is then required (4000 charged, 4280 needed)', !!after.markup && after.markup.need === 4280 && after.markup.short === 280, after);

  // ── Part 3: source checks of the screen ──
  var tab = fs.readFileSync(path.join(root, 'src/components/AccountingInvoicesTab.jsx'), 'utf8');
  check('19 (source): the screen stops the save without a reason, before anything is written, and no longer offers a bare "Save anyway" for this rule', tab.indexOf("if (mk7 && mkNote.length < MARKUP_NOTE_MIN) {") > 0 && tab.indexOf("var otherW = shipCheck.warnings.filter(function (w) { return !(mk7 && w === mk7.warning); });") > 0 && tab.indexOf("if (mk7 && mkNote.length < MARKUP_NOTE_MIN)") < tab.indexOf('setBusy(true);', tab.indexOf('var mk7 = shipCheck.markup')));
  check('20 (source): the red reason box is shown only while the shipping is below cost + 7%, and the reason goes to the server', tab.indexOf('id="nt-ship-override"') > 0 && tab.indexOf("shipAmt > 0 && shipAmt + 0.005 < minShippingCharge(c) && <div id=\"nt-ship-override\"") > 0 && tab.indexOf("markup_override_note: shipCheck.markup ? String(hdr.markup_override_note || '') : ''") > 0);
  check('21 (source): a copy of an invoice does not inherit the reason', tab.indexOf("Object.assign({}, h, t, { markup_override_note: ''") > 0);
  var box = fs.readFileSync(path.join(root, 'src/components/ShippingPartsBox.jsx'), 'utf8');
  check('33 (source): the box hands the total to the invoice form only when complete; the form fills the cost box unless the invoice is locked or EXW without a shipping line', box.indexOf('if (data && agg.complete && props.onTotal) { props.onTotal(agg.total, { fromSave: fromSave }); }') > 0 && tab.indexOf('onTotal={function (tot, info) { if (locked(editing) || noLineExw) { return; }') > 0 && tab.indexOf("Object.assign({}, h, { shipping_cost_estimate: String(tot) })") > 0);
  check('34 (source): the heading is coloured and says it can be clicked', box.indexOf("color: '#fde047', textDecoration: 'underline'") > 0 && box.indexOf("(open ? '' : 'Click to enter: ') + 'Inside the shipping") > 0);
  check('42 (source): the charge line is filled only after a Save in the box (never on merely opening it), with the real helper', box.indexOf('savedNow.current = true; load(); }') > 0 && tab.indexOf("if (info && info.fromSave) { var fl = fillShippingLine(items, tot, st, isTransportLine, blankItem); if (fl.changed) { setItems(fl.items);") > 0);
  var WN = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8'); var PG = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
  check('22 (source): What\'s New has the XV entry and the badge names the newest entry (XV or later)', /version: 'v55\.83-XV'/.test(WN) && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(WN); return !!top && PG.indexOf('>' + top[1] + '</span>') > 0; })());
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (err) { console.log('  ✗ FAIL: the test itself crashed  ' + (err && err.stack || err)); process.exit(1); });
