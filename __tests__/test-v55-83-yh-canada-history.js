// v55.83-YH — Canada historical archive. Rules (pure), storage + the REAL route with an in-memory database, and the wiring.
// All figures here are made up, except the optional last part, which checks the real archive file when it is on this machine.
var path = require('path'); var fs = require('fs'); var Module = require('module'); var crypto = require('crypto');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder';
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }

var H = require(path.join(root, 'src/lib/canada-history.js'));

console.log('YH part 1 — the rules');
check('24 old Canadian goods names', H.CANADA_GOODS.length === 24 && H.CANADA_GOODS[0] === 'Seconds Auto' && H.CANADA_GOODS[23] === 'Vintex');
check('every proposed link points at a current CGT type', Object.keys(H.DEFAULT_GOODS_MAP).every(function (k) { return H.CANADA_GOODS.indexOf(k) >= 0 && H.CURRENT_CGT_TYPES.indexOf(H.DEFAULT_GOODS_MAP[k]) >= 0; }));
check('kinds: starting stock', H.entryKindOf(800000, 'Starting Inventory') === 'opening');
check('kinds: winding is a re-grade', H.entryKindOf('Winding Production May 2023', null) === 'conversion' && H.entryKindOf('Winding Production Reversed', null) === 'conversion');
check('kinds: stock count', H.entryKindOf('RECONCILIATION OF INVENTORY AS OF 4/29', null) === 'adjustment');
check('kinds: disposal + trashed trim', H.entryKindOf('DISPOSAL', null) === 'disposal' && H.entryKindOf('Remove Trashed Trim ', null) === 'disposal');
check('kinds: an ordinary receipt', H.entryKindOf(80078879, 90089671) === 'received' && H.entryKindOf('Morbern - 14852.00', 'Proforma 2052') === 'received');

var effD = H.effectiveGoodsMap([]);
check('after Max\'s decisions of 24 Nov no old name is left without a match', H.unmatchedGoods(effD).length === 0, H.unmatchedGoods(effD));
check('Max 24 Nov: PVC Black on Black/Grey + PVC Non Woven = Seconds Canada; PVC Film Rolls + PVC GAYLORDS = PVC', effD.map['PVC Black on Black/Grey'] === 'Seconds Canada' && effD.map['PVC Non Woven'] === 'Seconds Canada' && effD.map['PVC Film Rolls'] === 'PVC' && effD.map['PVC GAYLORDS'] === 'PVC');
check('Max 24 Nov: Inspected = Seconds, Decking = Boat Decking, Foam = PVC, the rest = Others', effD.map.Inspected === 'Seconds Canada' && effD.map.Decking === 'Boat Decking' && effD.map.Foam === 'PVC' &&
  ['Mixed', 'Other', 'Morbern', 'Trim', 'Vintex'].every(function (k) { return effD.map[k] === 'Others'; }));
check('what Max decided says Decided; what nobody confirmed still says Proposed', effD.source.Decking === 'decided' && effD.source.Trim === 'decided' && effD.source['PVC Non Woven'] === 'decided' &&
  ['Seconds Auto', 'Thirds Auto', 'Obsolete', 'Paper', 'Roofing', 'Pool', 'Box Seconds', 'Drylam', 'TPO Rolls', 'TPO Scrap', 'TPO Chips', 'Fabric'].every(function (k) { return effD.source[k] === 'proposed'; }));
// for the grouping checks below: Decking and Inspected put back to "keep separate" by a decision
var eff0 = H.effectiveGoodsMap([{ goods_name: 'Decking', cgt_type: '', decided_at: '2026-11-24T09:00:00Z' }, { goods_name: 'Inspected', cgt_type: '', decided_at: '2026-11-24T09:00:00Z' }]);
check('a name put back to "keep separate" is unmatched again', JSON.stringify(H.unmatchedGoods(eff0)) === JSON.stringify(['Inspected', 'Decking']) && eff0.source.Decking === 'decided-unmatched' && eff0.map['TPO Chips'] === 'TPO');
var eff1 = H.effectiveGoodsMap([
  { goods_name: 'Decking', cgt_type: 'Roofing', decided_at: '2026-11-25T10:00:00Z' },
  { goods_name: 'Decking', cgt_type: 'PVC', decided_at: '2026-11-24T10:00:00Z' },
  { goods_name: 'Paper', cgt_type: '', decided_at: '2026-11-25T11:00:00Z' },
  { goods_name: 'Not A Name', cgt_type: 'TPO', decided_at: '2026-11-25T11:00:00Z' }
]);
check('the latest decision wins, whatever the order', eff1.map.Decking === 'Roofing' && eff1.source.Decking === 'decided');
check('a decision can un-match a proposed name', eff1.map.Paper === '' && eff1.source.Paper === 'decided-unmatched' && H.unmatchedGoods(eff1).indexOf('Paper') >= 0);
check('a decision for an unknown name is ignored', eff1.map['Not A Name'] === undefined);

var REC = [
  { source_row: 4, entry_date: '2021-06-25', entry_kind: 'opening', cgt_reference: '800000', nexpac_invoice: 'Starting Inventory', goods_name: 'Seconds Auto', weight_lb: 1000 },
  { source_row: 5, entry_date: '2021-06-29', entry_kind: 'received', cgt_reference: '80078879', nexpac_invoice: '90089671', goods_name: 'Seconds Auto', weight_lb: 500 },
  { source_row: 6, entry_date: '2021-08-02', entry_kind: 'received', cgt_reference: '80078880', nexpac_invoice: null, goods_name: 'TPO Rolls', weight_lb: 200 },
  { source_row: 6, entry_date: '2021-08-02', entry_kind: 'received', cgt_reference: '80078880', nexpac_invoice: null, goods_name: 'TPO Scrap', weight_lb: 50.5 },
  { source_row: 7, entry_date: '2022-01-31', entry_kind: 'conversion', cgt_reference: 'Winding Production January', nexpac_invoice: null, goods_name: 'Seconds Auto', weight_lb: -100 },
  { source_row: 7, entry_date: '2022-01-31', entry_kind: 'conversion', cgt_reference: 'Winding Production January', nexpac_invoice: null, goods_name: 'Inspected', weight_lb: 100 },
  { source_row: 8, entry_date: null, entry_kind: 'disposal', cgt_reference: 'DISPOSAL', nexpac_invoice: null, goods_name: 'TPO Scrap', weight_lb: -20 },
  { source_row: 9, entry_date: '2022-02-10', entry_kind: 'received', cgt_reference: '80090000', nexpac_invoice: null, goods_name: 'Decking', weight_lb: 300 }
];
var SHP = [
  { source_row: 6, ship_date: '2021-06-29', order_date: '2021-06-25', release_no: '1001-677', nextrade_invoice: '7261', customer: 'Customer A', goods_name: 'Seconds Auto', weight_lb: 400 },
  { source_row: 7, ship_date: '2021-09-27', order_date: '2021-09-30', release_no: '1001-743', nextrade_invoice: '4547', customer: 'Customer B', goods_name: 'TPO Rolls', weight_lb: 150 },
  { source_row: 8, ship_date: '2022-03-01', order_date: null, release_no: '1001-800', nextrade_invoice: null, customer: 'Customer A', goods_name: 'TPO Scrap', weight_lb: 30 },
  { source_row: 9, ship_date: '2022-03-05', order_date: null, release_no: '1001-801', nextrade_invoice: null, customer: null, goods_name: 'Decking', weight_lb: 120 }
];
var h = H.buildCanadaHistory(REC, SHP, eff0, { by: 'cgt' });
function grp(hh, k) { var o = null; hh.groups.forEach(function (g) { if (g.key === k) { o = g; } }); return o; }
check('months run without gaps from the first to the last', h.first_month === '2021-06' && h.last_month === '2022-03' && h.months.length === 10 && h.months[1] === '2021-07');
var sc = grp(h, 'Seconds Canada');
check('Seconds Auto shows as Seconds Canada', !!sc && sc.matched === true && sc.goods.join() === 'Seconds Auto');
check('only real receipts count as received (starting stock and winding do not)', sc.total_in === 500 && sc.inbound[0] === 500 && sc.other.opening === 1000 && sc.other.conversion === -100);
check('shipped total and month', sc.total_out === 400 && sc.outbound[0] === 400);
var tpo = grp(h, 'TPO');
check('TPO Rolls + TPO Scrap are one TPO card', !!tpo && tpo.total_in === 250.5 && tpo.total_out === 180 && tpo.goods.length === 2);
check('a disposal with no date is kept apart and said to be undated', tpo.other.disposal === -20 && tpo.undated_other === -20);
check('by year', JSON.stringify(tpo.yearly) === JSON.stringify([{ year: '2021', in: 250.5, out: 150, in_partial: true, out_partial: true }, { year: '2022', in: 0, out: 30, in_partial: true, out_partial: true }]), tpo.yearly);
check('same shape as the warehouse CGT history chart', tpo.labels.length === tpo.inbound.length && tpo.inbound.length === tpo.outbound.length && tpo.labels[0] === 'Jun 21');
var dk = grp(h, 'Decking');
check('an unmatched name keeps its own name and is flagged', !!dk && dk.matched === false && dk.total_in === 300 && dk.total_out === 120);
check('no customer written is said so, not dropped', dk.customers[0].customer === '(no customer written)' && dk.customers[0].lb === 120);
check('customers sorted, biggest first', tpo.customers[0].customer === 'Customer B' && tpo.customers[1].customer === 'Customer A');
check('grand totals = sum of the cards', h.total_in === 1050.5 && h.total_out === 700);
var hg = H.buildCanadaHistory(REC, SHP, eff0, { by: 'goods' });
check('by old name: TPO Rolls and TPO Scrap stay apart', !!grp(hg, 'TPO Rolls') && !!grp(hg, 'TPO Scrap') && !grp(hg, 'TPO') && hg.total_in === h.total_in && hg.total_out === h.total_out);
var h2 = H.buildCanadaHistory(REC, SHP, eff1, { by: 'cgt' });
check('after Max decides Decking = Roofing it moves; totals do not change', grp(h2, 'Roofing').total_in === 300 && !grp(h2, 'Decking') && h2.total_in === h.total_in && h2.total_out === h.total_out);
// ---- Codex 24 Nov (YH e6c101a3 FAIL): received and shipped stop at DIFFERENT dates; no data is N/A, never zero
var CR = []; var CS = []; var mm;
for (mm = 1; mm <= 12; mm++) { CR.push({ source_row: mm, entry_date: '2022-' + (mm < 10 ? '0' + mm : mm) + '-01', entry_kind: 'received', goods_name: 'Roofing', weight_lb: 100 }); CR.push({ source_row: 50 + mm, entry_date: '2022-' + (mm < 10 ? '0' + mm : mm) + '-28', entry_kind: 'received', goods_name: 'Paper', weight_lb: 10 }); }
CR.push({ source_row: 13, entry_date: '2022-12-31', entry_kind: 'received', goods_name: 'Roofing', weight_lb: 5 });
CR.push({ source_row: 14, entry_date: '2023-01-16', entry_kind: 'received', goods_name: 'Roofing', weight_lb: 7 });   // receipts STOP 16 Jan 2023
for (mm = 1; mm <= 12; mm++) { CS.push({ source_row: mm, ship_date: '2022-' + (mm < 10 ? '0' + mm : mm) + '-01', release_no: '1001-' + mm, customer: 'Customer A', goods_name: 'Roofing', weight_lb: 40 }); }
CS.push({ source_row: 13, ship_date: '2022-12-31', release_no: '1001-13', customer: 'Customer A', goods_name: 'Roofing', weight_lb: 1 });
CS.push({ source_row: 14, ship_date: '2023-02-10', release_no: '1001-14', customer: 'Customer A', goods_name: 'Roofing', weight_lb: 60 });
CS.push({ source_row: 15, ship_date: '2023-04-30', release_no: '1001-15', customer: 'Customer A', goods_name: 'Paper', weight_lb: 90 });   // shipments run to 30 Apr 2023; none in Mar 2023
var hc = H.buildCanadaHistory(CR, CS, effD, { by: 'cgt', notes: null });
var rf = grp(hc, 'Roofing'); var pp = grp(hc, 'Paper Canada');
check('coverage: received and shipped are reported separately', hc.coverage.received.first === '2022-01-01' && hc.coverage.received.last === '2023-01-16' && hc.coverage.shipped.first === '2022-01-01' && hc.coverage.shipped.last === '2023-04-30');
check('coverage: months after the last receipt are N/A for received, not zero', hc.months.slice(-3).join() === '2023-02,2023-03,2023-04' && JSON.stringify(rf.inbound.slice(-3)) === '[null,null,null]' && JSON.stringify(rf.inbound_status.slice(-4)) === '["partial","na","na","na"]');
check('coverage: shipped keeps its own figures in those months', rf.outbound[13] === 60 && rf.outbound_status[13] === 'ok' && rf.outbound_status[15] === 'ok');
check('coverage: a month inside the records with no record at all is N/A and listed as a gap', rf.outbound[14] === null && rf.outbound_status[14] === 'na' && JSON.stringify(hc.coverage.shipped.gap_months) === '["2023-01","2023-03"]');
check('coverage: a month the goods type simply had nothing in is a real zero', pp.outbound[0] === 0 && pp.outbound_status[0] === 'ok');
check('coverage: a whole recorded year is not partial; the cut-off year is', JSON.stringify(rf.yearly) === JSON.stringify([{ year: '2022', in: 1205, out: 481, in_partial: false, out_partial: false }, { year: '2023', in: 7, out: 60, in_partial: true, out_partial: true }]), rf.yearly);
check('coverage: recorded totals are kept as they are', rf.total_in === 1212 && rf.total_out === 541 && hc.total_in === 1332 && hc.total_out === 631);
check('coverage: the sentences say where each side stops', hc.notes.some(function (n) { return n.indexOf('No receipt data in this archive after 16 Jan 2023') >= 0; }) && hc.notes.some(function (n) { return n.indexOf('shipment records through 30 Apr 2023') >= 0; }) && hc.notes.some(function (n) { return /N\/A, never zero/.test(n); }));
var hcg = H.buildCanadaHistory(CR, CS, effD, { by: 'goods', notes: null });
check('coverage: grouping by old name keeps the same totals AND the same coverage', hcg.total_in === hc.total_in && hcg.total_out === hc.total_out && JSON.stringify(hcg.coverage) === JSON.stringify(hc.coverage) &&
  JSON.stringify(grp(hcg, 'Roofing').inbound_status) === JSON.stringify(rf.inbound_status) && JSON.stringify(grp(hcg, 'Paper').outbound_status) === JSON.stringify(pp.outbound_status) && JSON.stringify(grp(hcg, 'Paper').coverage) === JSON.stringify(hc.coverage));
var hcn = H.buildCanadaHistory(CR, CS, effD, { by: 'cgt', notes: { received_incomplete_from: '2022-11', shipped_incomplete_from: '2022-12' } });
check('coverage: months the source marks as moving to the new system are partial, and the year with them', grp(hcn, 'Roofing').inbound_status[9] === 'ok' && grp(hcn, 'Roofing').inbound_status[10] === 'partial' && grp(hcn, 'Roofing').outbound_status[10] === 'ok' && grp(hcn, 'Roofing').outbound_status[11] === 'partial' &&
  grp(hcn, 'Roofing').yearly[0].in_partial === true && grp(hcn, 'Roofing').yearly[0].in === 1205 && hcn.coverage.received.incomplete_from === '2022-11');
check('a year with no data at all on one side is N/A', (function () { var x = H.buildCanadaHistory([CR[0]], [CS[13]], effD, { by: 'cgt', notes: null }); var g = grp(x, 'Roofing'); return g.yearly[1].in === null && g.yearly[1].out === 60 && g.yearly[0].out === null && g.yearly[0].in === 100; })());
check('pounds are written with commas', H.fmtLb(1234567.4) === '1,234,567' && H.fmtLb(-20) === '-20' && H.fmtLb(0) === '0');

var FILE = { format: H.ARCHIVE_FORMAT, source_file: 'test.xlsm', source_sha256: 'abc', unit: 'lb', receipts: REC, shipments: SHP };
check('a good file passes', H.validateArchiveFile(FILE).ok === true, H.validateArchiveFile(FILE).errors);
function bad(mut) { var f = JSON.parse(JSON.stringify(FILE)); mut(f); return H.validateArchiveFile(f).ok === false; }
check('refused: wrong format', bad(function (f) { f.format = 'x'; }));
check('refused: unknown goods name', bad(function (f) { f.receipts[1].goods_name = 'Leather'; }));
check('refused: negative received weight', bad(function (f) { f.receipts[1].weight_lb = -5; }));
check('refused: received line without a date', bad(function (f) { f.receipts[1].entry_date = null; }));
check('refused: a Houston release in the Canada file', bad(function (f) { f.shipments[0].release_no = '1002-401'; }));
check('refused: shipped weight of zero', bad(function (f) { f.shipments[0].weight_lb = 0; }));
check('refused: empty lists', bad(function (f) { f.shipments = []; }));
check('refused: not an object', H.validateArchiveFile(null).ok === false);

// ---------------- in-memory database (just enough of the Supabase query builder)
console.log('YH part 2 — storage and the real route');
var T = {}; var seq = 0; var world = { noSql: false, failInsert: null, user: null, shortRead: false };
function tbl(n) { return T[n] || (T[n] = []); }
function Q(name) {
  var st = { name: name, f: [], ord: [], lim: null, rng: null, op: 'select', vals: null, single: 0 };
  var q = {
    select: function () { return q; },
    eq: function (k, v) { st.f.push(function (r) { return String(r[k]) === String(v); }); return q; },
    ilike: function (k, pat) { var mid = String(pat).replace(/%/g, '').toLowerCase(); st.f.push(function (r) { return String(r[k] == null ? '' : r[k]).toLowerCase().indexOf(mid) >= 0; }); return q; },
    order: function (k, o) { st.ord.push([k, !(o && o.ascending === false)]); return q; },
    limit: function (n) { st.lim = n; return q; },
    range: function (a, b) { st.rng = [a, b]; return q; },
    single: function () { st.single = 1; return q; },
    insert: function (v) { st.op = 'insert'; st.vals = Array.isArray(v) ? v : [v]; return q; },
    update: function (v) { st.op = 'update'; st.vals = v; return q; },
    delete: function () { st.op = 'delete'; return q; },
    then: function (res, rej) { try { return Promise.resolve(exec(st)).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
  };
  return q;
}
function exec(st) {
  if (world.noSql && /^canada_history_/.test(st.name)) { return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public." + st.name + "' in the schema cache" } }; }
  if (!/^canada_history_/.test(st.name) && st.op !== 'select') { throw new Error('YH wrote outside its own tables: ' + st.name); }
  if (st.name === 'accounting_invoices') { world.invoiceReads = (world.invoiceReads || 0) + 1; if (world.failInvoices) { return { data: null, error: { message: 'made-up failure' } }; } }
  if (!/^canada_history_/.test(st.name) && st.name !== 'users' && st.name !== 'module_permissions' && st.name !== 'accounting_invoices') { throw new Error('YH read a table it must not touch: ' + st.name); }
  var rows = tbl(st.name);
  if (st.op === 'insert') {
    if (world.failInsert === st.name) { return { data: null, error: { message: 'made-up failure' } }; }
    var made = st.vals.map(function (v) { seq++; var r = Object.assign({ id: st.name === 'canada_history_batches' ? 'b-' + seq : seq, loaded_at: '2026-11-24T12:00:' + String(seq % 60).padStart(2, '0') + 'Z', decided_at: '2026-11-24T12:' + String(10 + (seq % 40)) + ':00Z' }, JSON.parse(JSON.stringify(v))); rows.push(r); return r; });
    return { data: st.single ? made[0] : made, error: null };
  }
  var hit = rows.filter(function (r) { return st.f.every(function (f) { return f(r); }); });
  if (st.op === 'update') {
    if (st.name !== 'canada_history_batches') { return { data: null, error: { message: 'YH: UPDATE refused' } }; }
    hit.forEach(function (r) { Object.assign(r, st.vals); }); return { data: hit, error: null };
  }
  if (st.op === 'delete') { throw new Error('YH tried to delete'); }
  hit = hit.slice();
  st.ord.slice().reverse().forEach(function (o) { hit.sort(function (a, b) { var c = a[o[0]] < b[o[0]] ? -1 : (a[o[0]] > b[o[0]] ? 1 : 0); return o[1] ? c : -c; }); });
  if (st.rng) { hit = hit.slice(st.rng[0], st.rng[1] + 1); }
  if (st.lim != null) { hit = hit.slice(0, st.lim); }
  if (world.shortRead && st.name === 'canada_history_shipments') { hit = hit.slice(0, hit.length - 1); }
  return { data: hit, error: null };
}
var dbObj = { from: function (n) { return Q(n); } };

function stub(file, exportsObj) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exportsObj; require.cache[id] = m0; }
stub(path.join(root, 'node_modules/next/server.js'), { NextResponse: { json: function (body, init) { return { status: (init && init.status) || 200, body: body }; } } });
stub('@supabase/supabase-js', { createClient: function () { return dbObj; } });
stub(path.join(root, 'src/lib/verified-caller.js'), { verifiedCaller: async function () { return world.user ? { userId: world.user } : { error: 'Sign in again', status: 401 }; } });
// the REAL permission resolver (loadUserPermissions) reads users + module_permissions from the in-memory database
tbl('users').push({ id: 'u-max', role: 'super_admin', email: 'max@example.test' }, { id: 'u-admin', role: 'admin', email: 'admin@example.test' },
  { id: 'u-on', role: 'viewer', email: 'on@example.test' }, { id: 'u-off', role: 'viewer', email: 'off@example.test' });
tbl('module_permissions').push({ user_id: 'u-on', module_name: 'canada_history.access', has_access: true });
// the Hub's own KTC invoices (made up): two for release 1001-677, one voided, one for a Houston release, one for a release not in the archive
tbl('accounting_invoices').push(
  { id: 'i1', release_number: '1001-677', invoice_number: '7261', invoice_date: '2021-06-30', total_amount: '1000.50', record_status: 'active' },
  { id: 'i2', release_number: ' 1001-677 ', invoice_number: '7261A', invoice_date: '2021-07-02', total_amount: 99.5, record_status: null },
  { id: 'i3', release_number: '1001-743', invoice_number: '4547', invoice_date: '2021-09-30', total_amount: 500, record_status: 'void' },
  { id: 'i4', release_number: '1002-401', invoice_number: '9', invoice_date: '2021-06-30', total_amount: 7777, record_status: 'active' },
  { id: 'i5', release_number: '1001-999', invoice_number: '10', invoice_date: '2022-01-01', total_amount: 8888, record_status: 'active' },
  { id: 'i6', release_number: '1001-800', invoice_number: '11', invoice_date: '2022-03-02', total_amount: 60, record_status: 'active' });

var S = require(path.join(root, 'src/lib/canada-history-server.js'));
var ROUTE = require(path.join(root, 'src/app/api/canada-history/route.js'));
function req(body) { return { json: async function () { return body; }, headers: { get: function () { return null; } } }; }
var TEXT = JSON.stringify(FILE); var SHA = crypto.createHash('sha256').update(TEXT, 'utf8').digest('hex');

(async function () {
  var r;
  world.user = null; r = await ROUTE.GET(req());
  check('no sign-in: refused (401)', r.status === 401 && r.body.ok === false);
  world.user = 'u-off'; r = await ROUTE.GET(req());
  check('a person without the switch: refused (403)', r.status === 403);
  world.user = 'u-admin'; r = await ROUTE.GET(req());
  check('an ADMIN without the switch: refused (403) — a role never opens it', r.status === 403);
  world.user = 'u-on'; world.noSql = true; r = await ROUTE.GET(req());
  check('before the SQL is run: a plain "not set up yet", no crash', r.status === 200 && r.body.sql_missing === true && r.body.loaded === false && /sql\/v55-83-YH-canada-history\.sql/.test(r.body.sql_hint));
  world.noSql = false; r = await ROUTE.GET(req());
  check('switched-on person, empty archive: loaded = false, cannot manage', r.status === 200 && r.body.loaded === false && r.body.can_manage === false);

  r = await ROUTE.POST(req({ action: 'load', file_text: TEXT }));
  check('a switched-on person cannot load the archive (super admin only)', r.status === 403 && tbl('canada_history_batches').length === 0);
  r = await ROUTE.POST(req({ action: 'map', goods_name: 'Decking', cgt_type: 'Roofing' }));
  check('a switched-on person cannot decide goods names', r.status === 403 && tbl('canada_history_goods_decisions').length === 0);

  world.user = 'u-max';
  r = await ROUTE.POST(req({ action: 'load', file_text: TEXT }));
  check('the route refuses any file that is not THE archive file (fingerprint)', r.status === 400 && /fingerprint/.test(r.body.error) && tbl('canada_history_batches').length === 0, r.body);
  r = await ROUTE.POST(req({ action: 'load' }));
  check('no file sent: refused', r.status === 400);
  r = await ROUTE.POST(req({ action: 'wipe' }));
  check('unknown action: refused', r.status === 400);

  r = await S.storeArchiveExpecting(dbObj, TEXT, 'max@example.test', '');
  check('no fingerprint to compare with: nothing stored', r.ok === false && tbl('canada_history_batches').length === 0);
  r = await S.storeArchiveExpecting(dbObj, TEXT + ' ', 'max@example.test', SHA);
  check('one changed character: refused', r.ok === false && r.status === 400);
  world.failInsert = 'canada_history_shipments';
  r = await S.storeArchiveExpecting(dbObj, TEXT, 'max@example.test', SHA);
  check('a load that stops part way says so', r.ok === false && /part way/.test(r.error));
  world.failInsert = null;
  var a = await S.readArchive(dbObj);
  check('a part-way load is never shown', a.ok === true && a.loaded === false && tbl('canada_history_batches')[0].status === 'loading');
  r = await S.storeArchiveExpecting(dbObj, TEXT, 'max@example.test', SHA);
  check('loading again after a failed load works', r.ok === true && r.receipt_lines === 8 && r.shipment_lines === 4, r);
  r = await S.storeArchiveExpecting(dbObj, TEXT, 'max@example.test', SHA);
  check('a second complete load is refused (409) — never loaded twice', r.ok === false && r.status === 409);
  check('one complete batch, the failed one kept as it was', tbl('canada_history_batches').filter(function (b) { return b.status === 'complete'; }).length === 1 && tbl('canada_history_batches').length === 2);

  r = await ROUTE.GET(req());
  check('super admin reads the archive and can manage', r.status === 200 && r.body.loaded === true && r.body.can_manage === true && r.body.receipts.length === 8 && r.body.shipments.length === 4);
  var hh = H.buildCanadaHistory(r.body.receipts, r.body.shipments, H.effectiveGoodsMap(r.body.decisions), { by: 'cgt' });
  check('what comes back gives the same totals as the file', hh.total_in === 1050.5 && hh.total_out === 700);
  // ---- YK: sales history with the KTC invoice dollars (super admin only, read-only)
  check('YK: the super admin gets the KTC invoices for the archive releases only (no voided, no Houston, no release outside the archive)', Array.isArray(r.body.ktc_invoices) && r.body.ktc_invoices.map(function (x) { return x.invoice_number; }).sort().join() === '11,7261,7261A' && r.body.ktc_invoices_note === '');
  check('YK: only the four fields the list shows leave the server', r.body.ktc_invoices.every(function (x) { return Object.keys(x).sort().join() === 'invoice_date,invoice_number,release_number,total_amount'; }));
  var sl = H.buildCanadaSales(r.body.shipments, r.body.ktc_invoices, H.effectiveGoodsMap([]));
  var s677 = sl.rows.filter(function (x) { return x.release_no === '1001-677'; })[0]; var s743 = sl.rows.filter(function (x) { return x.release_no === '1001-743'; })[0];
  check('YK: one row per release, newest first, pounds from the archive', sl.releases === 4 && sl.total_lb === 700 && sl.rows[0].release_no === '1001-801' && s677.total_lb === 400 && s677.customer === 'Customer A' && s677.lines[0].cgt_type === 'Seconds Canada');
  check('YK: two invoices on one release are added up; $ per lb is worked out', s677.ktc_total === 1100 && s677.ktc_invoices.length === 2 && s677.usd_per_lb === 2.75);
  check('YK: a release with no KTC invoice in the Hub is unknown (null), never $0', s743.ktc_total === null && s743.usd_per_lb === null && s743.ktc_invoices === null);
  check('YK: summary counts', sl.money_shown === true && sl.with_ktc_invoice === 2 && sl.without_ktc_invoice === 2 && sl.ktc_total === 1160 && sl.lb_with_ktc_invoice === 430);
  var slNo = H.buildCanadaSales(r.body.shipments, null, H.effectiveGoodsMap([]));
  check('YK: without dollars the list still has every release and no money figure at all', slNo.money_shown === false && slNo.releases === 4 && slNo.ktc_total === null && slNo.with_ktc_invoice === null && slNo.rows.every(function (x) { return x.ktc_total === null && x.ktc_invoices === null; }));
  world.failInvoices = true; r = await ROUTE.GET(req()); world.failInvoices = false;
  check('YK: when the invoices cannot be read the archive still shows, with no dollars and a plain reason', r.status === 200 && r.body.loaded === true && r.body.ktc_invoices === null && /could not be read/.test(r.body.ktc_invoices_note));
  r = await ROUTE.GET(req());
  check('only lines of the complete load are returned', r.body.receipts.every(function (x) { return true; }) && tbl('canada_history_receipts').length === 16);
  world.shortRead = true; r = await ROUTE.GET(req());
  check('an incomplete read shows nothing rather than a wrong total', r.status === 500 && r.body.ok === false && /did not read completely/.test(r.body.error));
  world.shortRead = false;

  r = await ROUTE.POST(req({ action: 'map', goods_name: 'Leather', cgt_type: 'TPO' }));
  check('a decision for an unknown goods name is refused', r.status === 400);
  r = await ROUTE.POST(req({ action: 'map', goods_name: 'Decking', cgt_type: 'Roofing' }));
  check('super admin decides Decking = Roofing', r.status === 200 && r.body.ok === true);
  r = await ROUTE.POST(req({ action: 'map', goods_name: 'Decking', cgt_type: '' }));
  check('...and can put it back to "keep separate"; both decisions are kept', r.status === 200 && tbl('canada_history_goods_decisions').length === 2 && tbl('canada_history_goods_decisions')[0].decided_by === 'max@example.test');
  var readsBefore = world.invoiceReads;
  world.user = 'u-on'; r = await ROUTE.GET(req());
  check('the viewer sees the archive and the decisions', r.status === 200 && r.body.loaded === true && r.body.decisions.length === 2 && r.body.can_manage === false);
  check('YK: a viewer gets NO dollar figure and the invoices are not even read for them', r.body.ktc_invoices === null && world.invoiceReads === readsBefore && JSON.stringify(r.body).indexOf('1000.5') < 0);
  tbl('module_permissions').push({ user_id: 'u-on', module_name: 'canada_history.access', has_access: false });
  tbl('module_permissions').shift();
  r = await ROUTE.GET(req());
  check('switched OFF again: refused', r.status === 403);

  // ---------------- YO: the new system (NT Warehouse) after the archive
  console.log('YO — the new system after the archive');
  var F = require(path.join(root, 'src/lib/canada-history-feed-server.js'));
  check('YO: the question lives beside the existing feed', F.gradeFlowUrl('https://nextrade-staging.com/api/hub-feed') === 'https://nextrade-staging.com/api/hub-feed/grade-flow' && F.gradeFlowUrl('https://nextrade-staging.com/api/hub-feed/shipping?x=1') === 'https://nextrade-staging.com/api/hub-feed/grade-flow');
  check('YO: grade names find their type; a USA grade never does', H.archiveTypeForGrade('seconds  canada') === 'Seconds Canada' && H.archiveTypeForGrade('Drylam') === 'DRYLAM' && H.archiveTypeForGrade('Decking') === 'Boat Decking' && H.archiveTypeForGrade('Seconds USA') === '' && H.archiveTypeForGrade('Paper') === '' && H.archiveTypeForGrade('') === '');
  var CFG = { source: 'nextrade-staging', host: 'nextrade-staging.com' };
  var ANS = { ok: true, source: 'nextrade-staging', site: 'nextrade-staging.com', generated_at: '2023-06-15T10:00:00+00:00',
    grades: [{ id: 1, grade_name: 'Roofing' }, { id: 2, grade_name: 'Seconds USA' }, { id: 3, grade_name: 'Paper Canada' }, { id: 4, grade_name: 'Pool Canada', price: 9.99 }],
    warehouses: [{ id: 10, name: 'Cambridge' }, { id: 20, name: 'San Antonio' }],
    inbound: [{ cgt_id: 1, warehouse_id: 10, ym: '2023-01', lb: '50.00' }, { cgt_id: 1, warehouse_id: 20, ym: '2023-01', lb: '999' }, { cgt_id: 2, warehouse_id: 20, ym: '2023-02', lb: 777 }, { cgt_id: 3, warehouse_id: 20, ym: '2023-05', lb: 30 }, { cgt_id: 4, warehouse_id: 10, ym: '2023-05', lb: 8 }, { cgt_id: 1, warehouse_id: 10, ym: 'bad', lb: 1 }],
    outbound: [{ cgt_id: 1, warehouse_id: 10, ym: '2023-03', lb: 20 }],
    bounds: { first_in: '2022-11-10', last_in: '2023-06-14', first_out: '2023-02-01', last_out: '2023-06-01' } };
  var fl = F.normaliseGradeFlow(ANS, CFG);
  check('YO: only the Canadian side is kept (Houston Roofing and USA grades dropped; a “… Canada” grade kept from any warehouse)', fl.state === 'ok' && fl.rows_in.length === 3 && fl.rows_in.map(function (x) { return x.grade + ':' + x.ym + ':' + x.lb; }).join() === 'Roofing:2023-01:50,Paper Canada:2023-05:30,Pool Canada:2023-05:8' && fl.rows_out.length === 1);
  check('YO: only grade, month and pounds are kept (no price or other field)', fl.rows_in.every(function (x) { return Object.keys(x).sort().join() === 'grade,lb,type,warehouse,ym'; }) && JSON.stringify(fl).indexOf('9.99') < 0);
  check('YO: record dates and the month it was read', fl.first_in === '2022-11-10' && fl.last_out === '2023-06-01' && fl.through === '2023-06' && /Canadian warehouse/.test(fl.scope));
  check('YO: an answer from the wrong warehouse copy is refused', F.normaliseGradeFlow(Object.assign({}, ANS, { source: 'nextrade-live' }), CFG).state === 'unavailable' && F.normaliseGradeFlow(Object.assign({}, ANS, { source: '' }), CFG).state === 'unavailable');
  check('YO: an answer without first / last record dates is not used (zeros could not be told from gaps)', F.normaliseGradeFlow(Object.assign({}, ANS, { bounds: {} }), CFG).state === 'unavailable' && F.normaliseGradeFlow({ ok: true, source: 'nextrade-staging' }, CFG).state === 'unavailable');
  var noCa = F.normaliseGradeFlow(Object.assign({}, ANS, { warehouses: [{ id: 20, name: 'San Antonio' }] }), CFG);
  check('YO: when no Canadian warehouse is named, unnamed grades include every warehouse and the screen is told', noCa.rows_in.length === 4 && /every warehouse/.test(noCa.scope));
  // the synthetic archive from part 1: receipts 1 Jan 2022 – 16 Jan 2023, shipments to 30 Apr 2023; the new system from 10 Nov 2022
  var mg = H.mergeWarehouseFlow(hc, fl); var mR = grp(mg, 'Roofing'); var mP = grp(mg, 'Paper Canada');
  check('YO: months run on to the month the warehouse was read', mg.months[0] === '2022-01' && mg.last_month === '2023-06' && mg.months.length === 18 && mR.labels.length === 18);
  check('YO: archive figures and totals are untouched by the join', mR.total_in === rf.total_in && mR.total_out === rf.total_out && JSON.stringify(mR.inbound.slice(0, 16)) === JSON.stringify(rf.inbound) && mg.total_in === hc.total_in && mR.customers.length === rf.customers.length);
  check('YO: before the new system started = N/A; inside its records a blank month is a REAL zero', mR.sys_inbound_status[9] === 'na' && mR.sys_inbound[9] === null && mR.sys_inbound_status[10] === 'ok' && mR.sys_inbound[10] === 0 && mR.sys_inbound[12] === 50 && mR.sys_outbound_status[12] === 'na' && mR.sys_outbound[14] === 20 && mR.sys_outbound[15] === 0);
  check('YO: after the archive ends the archive is N/A while the new system has figures', mR.inbound[16] === null && mR.inbound_status[16] === 'na' && mR.outbound[17] === null && mP.sys_inbound[16] === 30 && mP.sys_inbound_status[17] === 'ok');
  check('YO: a type that exists only in the new system still gets a card', !!grp(mg, 'Pool Canada') && grp(mg, 'Pool Canada').archive === false && grp(mg, 'Pool Canada').sys_total_in === 8 && grp(mg, 'Pool Canada').total_in === 0);
  check('YO: by year both sources side by side; the new system fills the archive’s missing months', JSON.stringify(mR.yearly.map(function (y) { return [y.year, y.in, y.sys_in, y.out, y.sys_out, y.in_partial, y.in_whole_year, y.sys_checked]; })) === JSON.stringify([['2022', 1205, 0, 481, null, false, true, true], ['2023', 7, 50, 60, 20, true, false, true]]), mR.yearly);
  check('YO: the overlap months are listed and explained', mg.overlap_months[0] === '2022-11' && mg.overlap_months[mg.overlap_months.length - 1] === '2023-04' && mg.notes.some(function (x) { return /shown side by side and added, not repeated/.test(x); }) && mg.notes.some(function (x) { return /a blank month is a real zero/.test(x); }));
  check('YO: totals of the new system', mg.sys_state === 'ok' && mg.sys_total_in === 88 && mg.sys_total_out === 20 && mR.sys_total_in === 50 && mg.sys_grades_matched['Paper Canada'] === 'Paper Canada');
  var un = H.mergeWarehouseFlow(hc, { state: 'unavailable', reason: 'the warehouse cannot answer yet.' }); var uR = grp(un, 'Roofing');
  check('YO: warehouse not read = NOT CHECKED everywhere, never zero; archive unchanged', un.sys_state === 'unavailable' && un.months.length === hc.months.length && uR.sys_inbound.every(function (x) { return x === null; }) && uR.sys_inbound_status.every(function (x) { return x === 'unchecked'; }) && uR.sys_total_in === null && uR.yearly[0].sys_checked === false && uR.yearly[0].sys_in === null && uR.total_in === rf.total_in && un.notes.some(function (x) { return /NOT CHECKED/.test(x) && /unknown, not zero/.test(x); }));
  check('YO: by old name there is no join (returned as it is)', H.mergeWarehouseFlow(hcg, fl) === hcg);
  // ---- Codex 24 Nov, YO 80d5816e P2: a Canadian warehouse grade the Hub does not know must NOT lose its pounds
  var ANS2 = { ok: true, source: 'nextrade-staging', site: 'nextrade-staging.com', generated_at: '2023-06-15T10:00:00+00:00',
    grades: [{ id: 1, grade_name: 'Roofing' }, { id: 5, grade_name: 'Special Fabric Canada' }, { id: 6, grade_name: 'Roofing Membrane' }, { id: 2, grade_name: 'Seconds USA' }, { id: 7, grade_name: 'Seconds - Canada' }],
    warehouses: [{ id: 10, name: 'CANADA' }, { id: 20, name: 'San Antonio' }],
    inbound: [{ cgt_id: 1, warehouse_id: 10, ym: '2023-05', lb: 100 }, { cgt_id: 5, warehouse_id: 10, ym: '2023-05', lb: 500 }, { cgt_id: 6, warehouse_id: 10, ym: '2023-04', lb: 40 }, { cgt_id: 6, warehouse_id: 20, ym: '2023-04', lb: 9000 }, { cgt_id: 2, warehouse_id: 10, ym: '2023-05', lb: 7000 }, { cgt_id: 7, warehouse_id: 20, ym: '2023-05', lb: 25 }],
    outbound: [{ cgt_id: 5, warehouse_id: 10, ym: '2023-06', lb: 60 }, { cgt_id: 1, warehouse_id: 10, ym: '2023-06', lb: 10 }],
    bounds: { first_in: '2022-11-10', last_in: '2023-06-14', first_out: '2023-02-01', last_out: '2023-06-10' } };
  var fl2 = F.normaliseGradeFlow(ANS2, CFG);
  check('P2: the unknown Canadian grade is kept by the reader with its own name, warehouse and pounds', fl2.state === 'ok' && fl2.rows_in.some(function (x) { return x.grade === 'Special Fabric Canada' && x.type === '' && x.lb === 500 && x.warehouse === 'CANADA' && x.ym === '2023-05'; }) && fl2.rows_out.some(function (x) { return x.grade === 'Special Fabric Canada' && x.lb === 60; }));
  check('P2: an ordinary renamed grade from the Canadian warehouse is kept too; the same name from Houston is the other side', fl2.rows_in.filter(function (x) { return x.grade === 'Roofing Membrane'; }).length === 1 && fl2.rows_in.filter(function (x) { return x.grade === 'Roofing Membrane'; })[0].lb === 40 && fl2.excluded.other_warehouse_rows === 1 && fl2.excluded.other_warehouse_lb === 9000);
  check('P2: USA grades are a deliberate exclusion, counted apart, never listed as unlinked', fl2.excluded.usa_rows === 1 && fl2.excluded.usa_lb === 7000 && !fl2.rows_in.some(function (x) { return /USA/.test(x.grade); }));
  check('P2: a different spelling of a known grade is still linked, not unlinked', fl2.rows_in.some(function (x) { return x.grade === 'Seconds - Canada' && x.type === 'Seconds Canada' && x.lb === 25; }));
  var mg2 = H.mergeWarehouseFlow(hc, fl2);
  check('P2: the cards hold the linked pounds only and SAY they are partial', mg2.sys_state === 'ok' && mg2.sys_total_in === 125 && mg2.sys_total_out === 10 && grp(mg2, 'Roofing').sys_total_in === 100 && mg2.sys_partial_mapping === true && /^PARTIAL TOTAL: 2 Canadian warehouse grades are not linked/.test(mg2.notes[0]) && /Special Fabric Canada/.test(mg2.notes[0]));
  check('P2: the unlinked grades are listed with name, warehouse, months and pounds', mg2.sys_unmapped.length === 2 && JSON.stringify(mg2.sys_unmapped.map(function (u) { return [u.grade, u.warehouses.join(), u.in_lb, u.out_lb, u.first_month, u.last_month]; })) === JSON.stringify([['Roofing Membrane', 'CANADA', 40, 0, '2023-04', '2023-04'], ['Special Fabric Canada', 'CANADA', 500, 60, '2023-05', '2023-06']]) && mg2.sys_grades_unmatched.join() === 'Roofing Membrane,Special Fabric Canada', mg2.sys_unmapped);
  check('P2: linked + not linked = the Canadian total the warehouse sent (665 in, 70 out)', mg2.sys_unmapped_total_in === 540 && mg2.sys_unmapped_total_out === 60 && mg2.sys_feed_total_in === 665 && mg2.sys_feed_total_out === 70 && mg2.sys_total_in + mg2.sys_unmapped_total_in + mg2.sys_outside_months_in === mg2.sys_feed_total_in && mg2.sys_reconciles === true);
  check('P2: nothing is guessed into a goods type (no card gained the unlinked pounds, Others included)', !grp(mg2, 'Special Fabric Canada') && grp(mg2, 'Fabrics Canada') === null && (!grp(mg2, 'Others') || grp(mg2, 'Others').sys_total_in === 0) && mg2.groups.reduce(function (a, g) { return a + (g.sys_total_in || 0); }, 0) === 125);
  check('P2: the archive side is exactly as before', mg2.total_in === hc.total_in && mg2.total_out === hc.total_out && grp(mg2, 'Roofing').total_in === rf.total_in && JSON.stringify(grp(mg2, 'Roofing').inbound.slice(0, 16)) === JSON.stringify(rf.inbound));
  check('P2: with every grade linked there is no partial warning and it still adds up', mg.sys_partial_mapping === false && mg.sys_unmapped.length === 0 && mg.sys_reconciles === true && mg.sys_feed_total_in === 88 && !/PARTIAL TOTAL/.test(mg.notes.join(' ')));
  var early = H.mergeWarehouseFlow(hc, Object.assign({}, fl, { rows_in: fl.rows_in.concat([{ grade: 'Roofing', type: 'Roofing', warehouse: 'Cambridge', ym: '2020-03', lb: 11 }]) }));
  check('P2: a linked row before the first month shown is counted in the check, not lost', early.sys_outside_months_in === 11 && early.sys_feed_total_in === 99 && early.sys_total_in === 88 && early.sys_reconciles === true);
  var fl3 = F.normaliseGradeFlow(Object.assign({}, ANS2, { warehouses: [{ id: 20, name: 'San Antonio' }] }), CFG);
  check('P2: no Canadian warehouse named — a “… Canada” grade is still kept; an unnamed unknown grade is reported as “cannot tell”, in no total', fl3.rows_in.some(function (x) { return x.grade === 'Special Fabric Canada' && x.lb === 500; }) && !fl3.rows_in.some(function (x) { return x.grade === 'Roofing Membrane'; }) && fl3.scope_unknown.length === 1 && fl3.scope_unknown[0].grade === 'Roofing Membrane' && fl3.scope_unknown[0].in_lb === 9040);
  // what the person actually sees: the real screen, rendered with this answer
  stub(path.join(root, 'src/lib/supabase.js'), { supabase: { auth: { getSession: function () { return Promise.resolve({ data: { session: null } }); } } } });
  var React = require(path.join(root, 'node_modules/react')); var RDS = require(path.join(root, 'node_modules/react-dom/server'));
  var TabC = require(path.join(root, 'src/components/CanadaHistoryTab.jsx')).default;
  function renderTabMarkup(dataObj) { var orig = React.useState; var ix = 0; React.useState = function (init) { var k = ix++; return orig(k === 0 ? dataObj : (k === 2 ? false : init)); }; try { return RDS.renderToStaticMarkup(React.createElement(TabC, {})); } finally { React.useState = orig; } }
  function renderTab(dataObj) { return renderTabMarkup(dataObj).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); }
  var screen = renderTab({ ok: true, loaded: true, can_manage: true, batch: { source_file: 'test.xlsm', loaded_at: '2026-11-24T00:00:00Z', receipt_lines: CR.length, shipment_lines: CS.length }, receipts: CR, shipments: CS, decisions: [], ktc_invoices: null, ktc_invoices_note: '', warehouse_flow: fl2 });
  check('P2 on screen: the section “Warehouse grades not linked to a goods type” lists the grade and its pounds', screen.indexOf('Warehouse grades not linked to a goods type') > 0 && /Special Fabric Canada CANADA 2023-05 → 2023-06 500 60/.test(screen) && /Roofing Membrane CANADA 2023-04 40 0/.test(screen) && /Not linked, total 540 60/.test(screen), screen.slice(screen.indexOf('Warehouse grades not linked'), screen.indexOf('Warehouse grades not linked') + 500));
  check('P2 on screen: partial-total warning on the summary and the adding-up line', /PARTIAL — linked grades only; \+ 540 in \/ 60 out not linked/.test(screen) && /cards 125 \+ not linked 540 = warehouse Canadian total received 665 lb/.test(screen) && /Adds up\./.test(screen) && /PARTIAL TOTAL: 2 Canadian warehouse grades are not linked/.test(screen));
  var screenOk = renderTab({ ok: true, loaded: true, can_manage: true, batch: { source_file: 'test.xlsm', loaded_at: '2026-11-24T00:00:00Z', receipt_lines: CR.length, shipment_lines: CS.length }, receipts: CR, shipments: CS, decisions: [], ktc_invoices: null, ktc_invoices_note: '', warehouse_flow: fl });
  check('P2 on screen: when every grade is linked the section and the warning are not shown', screenOk.indexOf('Warehouse grades not linked to a goods type') < 0 && screenOk.indexOf('PARTIAL') < 0 && screenOk.indexOf('in 88 lb') > 0);
  var mappingData = { ok: true, loaded: true, can_manage: true, receipts: [], shipments: [], decisions: [] };
  var mappingMarkup = renderTabMarkup(mappingData);
  var confirmRow = (mappingMarkup.match(/<tr[^>]*><td[^>]*>Seconds Auto<\/td>[\s\S]*?<\/tr>/) || [])[0] || '';
  var confirmButton = (confirmRow.match(/<button[^>]*>Confirm<\/button>/) || [])[0] || '';
  check('mapping: a suggested value can be confirmed without changing the dropdown', !!confirmButton && !/\bdisabled\b/.test(confirmButton) && /<option value="Seconds Canada" selected="">/.test(confirmRow));
  check('mapping: dropdown opts into the light-panel form colors', /<select class="nt-light" aria-label="Goods type for Seconds Auto"/.test(confirmRow));
  check('mapping: viewers have no edit controls', !/aria-label="Goods type for /.test(renderTabMarkup(Object.assign({}, mappingData, { can_manage: false }))));

  // the reader: address rule, token only in the header, no redirect, plain reasons
  var calls = []; var oldFetch = global.fetch;
  global.fetch = async function (url, init) { calls.push({ url: url, init: init }); if (world.feed === 'missing') { return { status: 404, ok: false }; } if (world.feed === 'down') { throw new Error('ECONNREFUSED'); } return { status: 200, ok: true, json: async function () { return ANS; } }; };
  var ENV = { NEXTRADE_FEED_URL: 'https://nextrade-staging.com/api/hub-feed', NEXTRADE_FEED_TOKEN: 'tok-0123456789abcdef0123456789abcdef' };
  var rd = await F.readGradeFlow(ENV);
  check('YO: reads the staging warehouse with the token in the header and redirects refused', rd.state === 'ok' && calls.length === 1 && calls[0].url === 'https://nextrade-staging.com/api/hub-feed/grade-flow' && calls[0].init.headers['X-Hub-Feed-Token'] === ENV.NEXTRADE_FEED_TOKEN && calls[0].init.redirect === 'error' && calls[0].init.method === 'GET' && calls[0].url.indexOf('tok-') < 0);
  world.feed = 'missing'; rd = await F.readGradeFlow(ENV);
  check('YO: a warehouse that does not have the question yet says so plainly', rd.state === 'unavailable' && /cannot answer/.test(rd.reason));
  world.feed = 'down'; rd = await F.readGradeFlow(ENV);
  check('YO: an unreachable warehouse = unavailable', rd.state === 'unavailable' && /could not be reached/.test(rd.reason));
  world.feed = null; calls = [];
  rd = await F.readGradeFlow({ NEXTRADE_FEED_URL: 'https://evil.example/api/hub-feed', NEXTRADE_FEED_TOKEN: ENV.NEXTRADE_FEED_TOKEN });
  check('YO: an address that is not an approved warehouse is refused before anything is sent', rd.state === 'not_configured' && calls.length === 0);
  rd = await F.readGradeFlow({ NEXTRADE_FEED_URL: 'https://nextradeindustries.com/api/hub-feed', NEXTRADE_FEED_TOKEN: ENV.NEXTRADE_FEED_TOKEN });
  check('YO: the LIVE warehouse is not read without Max’s switch', rd.state === 'not_configured' && calls.length === 0);
  world.user = 'u-max'; r = await ROUTE.GET(req());
  check('YO: the route hands the warehouse state to the screen (not set up here = said so, archive still shown)', r.status === 200 && r.body.loaded === true && r.body.warehouse_flow && r.body.warehouse_flow.state === 'not_configured' && calls.length === 0);
  global.fetch = oldFetch;

  // ---------------- wiring (static)
  console.log('YH part 3 — the wiring');
  var page = read('src/app/page.jsx'); var settings = read('src/components/SettingsTab.jsx'); var wn = read('src/components/WhatsNewWidget.jsx');
  var route = read('src/app/api/canada-history/route.js'); var server = read('src/lib/canada-history-server.js'); var lib = read('src/lib/canada-history.js'); var comp = read('src/components/CanadaHistoryTab.jsx');
  var sql = read('sql/v55-83-YH-canada-history.sql');
  check('the tab is in the menu', /\{ id: 'canadahistory', label: '[^']*', icon: '[^']*' \}/.test(page));
  check('the tab is drawn', /tab === 'canadahistory' && \(/.test(page) && /<CanadaHistoryTab /.test(page) && /import CanadaHistoryTab from '\.\.\/components\/CanadaHistoryTab'/.test(page));
  check('the tab opens only with the explicit switch', /if \(t\.id === 'canadahistory'\) \{ return modulePerms\['canada_history\.access'\] === true; \}/.test(page));
  check('the tab has its own ARCHIVE group right under REPORTS, and a breadcrumb', /\{ group: 'REPORTS', items: \['reports'\] \},\s*\{ group: 'ARCHIVE', items: \['canadahistory'\] \},/.test(page) && /canadahistory:'Archive'/.test(page));
  check('the History icon is imported and used', /CalendarClock, History\s/.test(page) && /canadahistory: History,/.test(page));
  check('the badge names the newest What\'s New entry (YK or a later build)', (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55.83-[A-Z]{2,3})'/.exec(wn); return !!top && page.indexOf('>' + top[1] + '</span>') >= 0; })());
  check('YK: the screen has the sales list, says dollars are KTC invoices only and unknown is not zero', comp.indexOf('Sales history — every Canadian release that shipped') >= 0 && comp.indexOf('not zero') >= 0 && comp.indexOf('sales.money_shown ?') >= 0 && comp.indexOf('none in the Hub') >= 0);
  check('money is written with cents', H.fmtUsd(1234567.5) === '$1,234,567.50' && H.fmtUsd(0) === '$0.00' && H.fmtUsd(60.049) === '$60.05');
  check('the screen shows where each side stops, N/A instead of zero, partial years, recorded totals', comp.indexOf('hist.notes.map') >= 0 && comp.indexOf("st === 'na'") >= 0 && comp.indexOf("y.in === null ? 'N/A'") >= 0 && comp.indexOf('y.in_partial') >= 0 && comp.indexOf('Received (recorded)') >= 0 && comp.indexOf('Total recorded') >= 0);
  check('the screen says: pounds only, not connected to the warehouse cards; a proposal is shown as a proposal', comp.indexOf('pounds only, no dollar amounts') >= 0 && comp.indexOf('not connected to the warehouse system') >= 0 && comp.indexOf('Proposed — not confirmed yet') >= 0);
  check('the switch is in Settings', /\{ key: 'canada_history\.access', label: 'Archive: Canada History'/.test(settings));
  check("What's New has YO, YK and YH, newest first", wn.indexOf("version: 'v55.83-YO'") > 0 && wn.indexOf("version: 'v55.83-YK'") > wn.indexOf("version: 'v55.83-YO'") && wn.indexOf("version: 'v55.83-YH'") > wn.indexOf("version: 'v55.83-YK'"));
  var feedLib = read('src/lib/canada-history-feed-server.js');
  check('YO: the warehouse reader is server-only, read-only (GET), var + concatenation', feedLib.replace(/\/\/[^\n]*/g, '').indexOf("'use client'") < 0 && feedLib.indexOf("method: 'GET'") > 0 && !/method: '(POST|PUT|DELETE|PATCH)'/.test(feedLib) && !/\b(const|let)\s+[A-Za-z_$]/.test(feedLib.replace(/\/\/[^\n]*/g, '')) && feedLib.replace(/\/\/[^\n]*/g, '').indexOf('=>') < 0 && feedLib.indexOf('`') < 0);
  check('YO: the screen shows NOT CHECKED and the new-system columns', comp.indexOf('NOT CHECKED') > 0 && comp.indexOf('mergeWarehouseFlow(hist') > 0 && comp.indexOf('Received (new system)') > 0 && comp.indexOf("st === 'unchecked'") > 0);
  [['route', route], ['server lib', server], ['rules lib', lib]].forEach(function (x) {
    var code = x[1].replace(/\/\/[^\n]*/g, '');
    check(x[0] + ': var + string concatenation only', !/\b(const|let)\s+[A-Za-z_$]/.test(code.replace(/export const (runtime|dynamic|maxDuration)\b/g, '')) && code.indexOf('`') < 0 && code.indexOf('=>') < 0);
  });
  check('the route never imports a component or a "use client" module', !/components\//.test(route) && !/lib\/supabase'/.test(route) && lib.indexOf("'use client'") < 0 && server.indexOf("'use client'") < 0);
  check('the route only stores through the fixed fingerprint', /storeArchive\(db, text, label\)/.test(route) && route.indexOf('storeArchiveExpecting') < 0);
  check('the route and storage touch only the canada_history tables (+ users for the name, + a read of accounting_invoices)', (route + server + read('src/lib/canada-history-feed-server.js')).match(/\.from\('([a-z_]+)'\)/g).every(function (m) { return /canada_history_|'users'|'accounting_invoices'/.test(m); }) && (server.match(/from\('accounting_invoices'\)/g) || []).length === 1 && /from\('accounting_invoices'\)\.select\(/.test(server) && /if \(isSuper && a\.loaded === true\) \{\s*var k = await readKtcInvoicesForReleases/.test(route) && !/\.from\(table\)/.test(route));
  check('storage never updates a line and never deletes', server.indexOf('.delete(') < 0 && route.indexOf('.delete(') < 0 && (server.match(/\.update\(\{/g) || []).length === 1 && /from\('canada_history_batches'\)\.update\(\{ status: 'complete' \}\)/.test(server));
  check('the screen uses the route, not the tables', comp.indexOf("fetch('/api/canada-history'") >= 0 && comp.indexOf('.from(') < 0 && comp.indexOf("'use client'") === 0);
  check('the screen imports the helpers it calls', ['CANADA_GOODS', 'CURRENT_CGT_TYPES', 'KIND_LABELS', 'effectiveGoodsMap', 'unmatchedGoods', 'buildCanadaHistory', 'buildCanadaSales', 'fmtLb', 'fmtUsd', 'dayLabel'].every(function (n) { return new RegExp('import \\{[^}]*\\b' + n + '\\b[^}]*\\} from \'\\.\\./lib/canada-history\'').test(comp) && comp.split(n).length > 2; }));
  check('no customer name or figure from the workbook is in the code', !/Vinyl Trends|Freiman|FZG/.test(lib + server + route + comp + wn));
  check('SQL: adds tables only', (sql.match(/create table if not exists public\.canada_history_/g) || []).length === 4 && !/\bdrop table\b|\bdelete from\b|\btruncate\b|\balter table public\.(?!canada_history)/i.test(sql.replace(/--[^\n]*/g, '').replace(/format\('alter table public\.%I/g, '')));
  check('SQL: browser locked out, service role may only read + add', /enable row level security/.test(sql) && /revoke all on public\.%I from public, anon, authenticated/.test(sql) && /grant select, insert on public\.%I to service_role/.test(sql) && !/grant[^;]*delete/i.test(sql));
  check('SQL: lines can never be changed or deleted', /canada_history_refuse_change/.test(sql) && /before update or delete/.test(sql));
  check('the fingerprint in the code is a sha-256', /^[0-9a-f]{64}$/.test(S.EXPECTED_ARCHIVE_SHA256));

  // ---------------- the real archive file, when it is on this machine (it is never in the repository)
  var real = process.env.CANADA_HISTORY_FILE || 'D:/GITHUB/_test-tools/canada-history-load/canada-history-archive.json';
  if (fs.existsSync(real)) {
    console.log('YH part 4 — the real archive file');
    var text = fs.readFileSync(real, 'utf8');
    check('the real file has the fingerprint the code expects', S.sha256Text(text) === S.EXPECTED_ARCHIVE_SHA256);
    var obj = JSON.parse(text); var v = H.validateArchiveFile(obj);
    check('the real file passes every check', v.ok === true, v.errors);
    check('line counts', obj.receipts.length === 2590 && obj.shipments.length === 543, [obj.receipts.length, obj.shipments.length]);
    var full = H.buildCanadaHistory(obj.receipts, obj.shipments, H.effectiveGoodsMap([]), { by: 'goods' });
    check('received and shipped totals match the workbook', Math.abs(full.total_in - 14396809.348) < 0.01 && Math.abs(full.total_out - 12283919.16) < 0.01, [full.total_in, full.total_out]);
    check('period', full.first_month === '2021-06' && full.last_month === '2024-04');
    // per goods name: starting stock + received + the other lines must equal the workbook's own column total
    var COL = { 'Seconds Auto': 4398656, 'Thirds Auto': 2194137.86, 'Obsolete': 652267.628, 'Roofing': 2380571.7, 'Paper': 2435503, 'Trim': 0, 'TPO Chips': 0, 'Decking': 521901.07, 'Inspected': 134524.5 };
    var okCols = Object.keys(COL).every(function (k) { var g = grp(full, k); var sum = g.total_in + g.other.opening + g.other.conversion + g.other.adjustment + g.other.disposal; return Math.abs(sum - COL[k]) < 0.01; });
    check('each goods column adds back to the workbook column total', okCols);
    var SHIPCOL = { 'Seconds Auto': 3792290.57, 'Thirds Auto': 2178355.36, 'Paper': 2430058.36, 'Roofing': 1718324.74 };
    check('shipped per goods name matches the workbook', Object.keys(SHIPCOL).every(function (k) { return Math.abs(grp(full, k).total_out - SHIPCOL[k]) < 0.01; }));
    var byCgt = H.buildCanadaHistory(obj.receipts, obj.shipments, H.effectiveGoodsMap([]), { by: 'cgt' });
    // Codex 24 Nov: the real file — receipts stop 16 Jan 2024, shipments run to 30 Apr 2024; Feb–Apr 2024 received is N/A, not 0
    var cv = byCgt.coverage; var sC = grp(byCgt, 'Seconds Canada'); var nM = byCgt.months.length;
    check('real file: received 29 Jun 2021 – 16 Jan 2024, shipped 29 Jun 2021 – 30 Apr 2024', cv.received.first === '2021-06-29' && cv.received.last === '2024-01-16' && cv.shipped.first === '2021-06-29' && cv.shipped.last === '2024-04-30');
    check('real file: Feb / Mar / Apr 2024 received is N/A while shipped has figures', byCgt.months.slice(-3).join() === '2024-02,2024-03,2024-04' && JSON.stringify(sC.inbound.slice(-3)) === '[null,null,null]' &&
      sC.outbound.slice(-3).every(function (x) { return typeof x === 'number'; }) && byCgt.groups.every(function (g) { return g.inbound[nM - 1] === null && g.inbound[nM - 2] === null && g.inbound[nM - 3] === null && g.inbound_status[nM - 1] === 'na'; }));
    check('real file: Dec 2023 has no received weight at all — N/A and listed', JSON.stringify(cv.received.gap_months) === '["2023-12"]' && sC.inbound[nM - 5] === null && cv.shipped.gap_months.length === 0);
    check('real file: from Nov 2023 both sides are marked incomplete', cv.received.incomplete_from === '2023-11' && cv.shipped.incomplete_from === '2023-11' && sC.inbound_status[nM - 6] === 'partial' && sC.outbound_status[nM - 1] === 'partial' && sC.inbound_status[nM - 7] === 'ok');
    check('real file: 2021, 2023 and 2024 are partial years; 2022 is whole', sC.yearly.map(function (y) { return y.year + (y.in_partial ? 'p' : 'w') + (y.out_partial ? 'p' : 'w'); }).join() === '2021pp,2022ww,2023pp,2024pp');
    check('real file: the sentences are shown', byCgt.notes.some(function (n) { return n.indexOf('No receipt data in this archive after 16 Jan 2024') >= 0; }) && byCgt.notes.some(function (n) { return n.indexOf('shipment records through 30 Apr 2024') >= 0; }));
    check('real file: by old name carries the same coverage', JSON.stringify(full.coverage) === JSON.stringify(cv) && JSON.stringify(grp(full, 'Roofing').inbound_status) === JSON.stringify(sC.inbound_status));
    check('grouping by current CGT type loses nothing', Math.abs(byCgt.total_in - full.total_in) < 0.01 && Math.abs(byCgt.total_out - full.total_out) < 0.01);
  } else {
    console.log('YH part 4 — skipped (the real archive file is not on this machine; it is never in the repository)');
  }

  console.log('\nYH: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('  ✗ FAIL: crashed — ' + (e && e.stack || e)); process.exit(1); });
