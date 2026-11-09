// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RP — Max, Nov 9 21:04:
//  "during importing of bill -- Hub should be able to assess if bill is for
//   Trucking or Shipping or Bonded Brokerage fees or supplier bill. The other
//   selection will be for outbound or inbound bills. Outbound will always have
//   a release number so you should be smart enough to automatically check it
//   as outbound. Otherwise leave blank and it will be manually updated during
//   the validation aspect. If hub cannot assess the type of bill ....leave
//   blank and again it will be part of the validation process manually done.
//   Prior to validation. there MUST be a selection of the TYPE of bill and the
//   direction of the bill (outbound or inbound)"
// The real extraction rules, the real import insert and the real bills route
// run here (in-memory DB, the AI reply mocked); the SQL ran 3× on PG16.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
var savedKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-key';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var V1 = 'b3000000-0000-0000-0000-000000000001', V2 = 'b3000000-0000-0000-0000-000000000002', V3 = 'b3000000-0000-0000-0000-000000000003';
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }],
  module_permissions: ['accounting.clickbooks.access', 'bills.manage', 'bills.view', 'wires.prepare'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
  vendor_bills: [
    { id: V1, vendor_name: 'Atlantic Ocean Lines', bill_number: 'A-1', total_amount: 900, record_status: 'active', bill_date: '2026-09-01', validation_status: 'validated', bill_type: 'shipping', shipment_direction: 'outbound', release_number: '1003-500' },
    { id: V2, vendor_name: 'Atlantic Ocean Lines', bill_number: 'A-2', total_amount: 950, record_status: 'active', bill_date: '2026-09-15', validation_status: 'validated', bill_type: 'shipping', shipment_direction: 'outbound', release_number: '1003-501' },
    { id: V3, vendor_name: 'Mixed Co', bill_number: 'M-1', total_amount: 50, record_status: 'active', bill_date: '2026-10-01', validation_status: 'pending', bill_type: null, shipment_direction: null, release_number: null },
  ],
  vendor_bill_payments: [], vendor_bill_events: [], hub_audit_log: [], wire_packages: [], wire_package_lines: [], expense_rules: [], paid_through_parties: [],
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var X = require(path.join(root, 'src/lib/bill-extract.js'));
var XS = require(path.join(root, 'src/lib/bill-extract-server.js'));
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
async function call(r, user, body) { var res = await r.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 500))); }
var aiReply = '';
var realFetch = global.fetch;
global.fetch = function (url) { if (/anthropic/.test(String(url))) { return Promise.resolve({ json: function () { return Promise.resolve({ content: [{ type: 'text', text: aiReply }] }); } }); } return realFetch.apply(this, arguments); };
var CK = { matches_records: true, goods_received: true, charges_accurate: true };
console.log('RP — bill type + direction on import; both required to validate');
(async function () {
  // ── 1. the reader
  check('1a: the reader is asked for the TYPE (trucking / shipping / bonded-brokerage / supplier), the release # and a reference — and told: unclear = null, never guess',
    ['"trucking"|"shipping"|"bonded_brokerage"|"supplier"|null', 'release_number', 'other_reference', 'If it is not clear, use null — NEVER guess.', 'Never use the bill/invoice number, a PO, a BOL or a container number as the release.'].every(function (k) { return X.BILL_EXTRACT_PROMPT.indexOf(k) >= 0; }));
  var p1 = X.parseBillExtraction('{"vendor_name":"Fast Trucking","bill_number":"T-9","bill_date":"2026-11-01","total_amount":450,"release_number":"1003-077","bill_type":"TRUCKING"}');
  check('1b: a release # on the bill → OUTBOUND automatically; the type read is kept', p1.draft.release_number === '1003-077' && p1.draft.shipment_direction === 'outbound' && p1.draft.bill_type === 'trucking', p1.draft);
  var p2 = X.parseBillExtraction('{"vendor_name":"Customs Pro","bill_number":"C-1","bill_date":"2026-11-01","total_amount":80,"release_number":null,"bill_type":"taxi","other_reference":"bol 5512"}');
  check('1c: no release # → direction left BLANK (never guessed inbound); a type outside the four → blank', p2.draft.shipment_direction === null && p2.draft.bill_type === null && p2.draft.other_reference === 'BOL 5512', p2.draft);
  check('1d: the four types, plainly named', X.BILL_TYPES.join() === 'trucking,shipping,bonded_brokerage,supplier' && /Bonded/.test(X.BILL_TYPE_LABEL.bonded_brokerage));
  // ── 2. what an import puts on the bill, and where it came from
  var hist = await XS.vendorBillType(db, 'atlantic ocean lines');
  var none = await XS.vendorBillType(db, 'Mixed Co');
  check('2a: type unreadable → this vendor\'s VALIDATED bills decide it only if they all agree; otherwise blank', hist === 'shipping' && none === null, { hist: hist, none: none });
  var s1 = X.importSort({ bill_type: 'supplier', release_number: 'R-1' }, 'shipping');
  var s2 = X.importSort({ bill_type: null, release_number: null }, 'shipping');
  var s3 = X.importSort({ bill_type: null, release_number: null }, null);
  check('2b: read from the bill wins; vendor history is the fallback; each value says where it came from; nothing known = blank',
    s1.bill_type === 'supplier' && s1.bill_type_source === 'read_from_bill' && s1.shipment_direction === 'outbound' && s1.direction_source === 'release_number' &&
    s2.bill_type === 'shipping' && s2.bill_type_source === 'vendor_history' && s2.shipment_direction === null &&
    s3.bill_type === null && s3.bill_type_source === null && s3.shipment_direction === null, { s1: s1, s2: s2, s3: s3 });
  // ── 3. a real import (bulk file import door), AI reply mocked
  aiReply = '{"vendor_name":"Atlantic Ocean Lines","bill_number":"A-77","bill_date":"2026-11-05","total_amount":1200,"release_number":"1003-900","bill_type":null}';
  var g = await call(bills, 'u1', { action: 'ingest_bill_file', file_base64: 'x'.repeat(200), media_type: 'application/pdf', filename: 'a77.pdf' });
  var nb = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'A-77'; })[0];
  check('3a: imported bill: release 1003-900 → OUTBOUND; type from this vendor\'s history (Shipping); still PENDING validation',
    g.ok && g.created && nb && nb.shipment_direction === 'outbound' && nb.direction_source === 'release_number' && nb.bill_type === 'shipping' && nb.bill_type_source === 'vendor_history' && nb.validation_status === 'pending', { g: g, nb: nb });
  aiReply = '{"vendor_name":"New Broker LLC","bill_number":"NB-1","bill_date":"2026-11-05","total_amount":300,"release_number":null,"bill_type":null}';
  var g2 = await call(bills, 'u1', { action: 'ingest_bill_file', file_base64: 'x'.repeat(200), media_type: 'application/pdf', filename: 'nb1.pdf' });
  var nb2 = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'NB-1'; })[0];
  check('3b: nothing clear on the bill → type AND direction left blank for the validator', g2.ok && nb2 && nb2.bill_type == null && nb2.shipment_direction == null, nb2);
  aiReply = '{"vendor_name":"New Broker LLC","bill_number":"NB-2","bill_date":"2026-11-06","total_amount":310,"bill_type":"bonded_brokerage"}';
  var ex = await call(bills, 'u1', { action: 'extract_bill', file_base64: 'x'.repeat(200), media_type: 'application/pdf' });
  check('3c: 📷 Import (read, then a person checks the form) gets the same sorting back', ex.ok && ex.sorted && ex.sorted.bill_type === 'bonded_brokerage' && ex.sorted.bill_type_source === 'read_from_bill' && ex.sorted.shipment_direction === null, ex);
  // the other import doors use the same insert
  check('3d: email inbound + email scanner + bulk import all insert through the same sorter', ['src/app/api/accounting/bills/inbound/route.js', 'src/app/api/accounting/bills/email-scan/route.js'].every(function (f) { var t = R(f); return t.indexOf('await insertImportedBill(db, {') > 0 && t.indexOf("}, d); // v55.83-RP") > 0; }) &&
    R('src/app/api/accounting/bills/route.js').indexOf('var gIns = await insertImportedBill(db, {') > 0);
  // SQL not run yet → the bill is still created
  var tries = [];
  var fakeDb = { from: function () { return { select: function () { return this; }, ilike: function () { return this; }, eq: function () { return this; }, limit: function () { return Promise.resolve({ data: [] }); },
    insert: function (row) { tries.push(row); return { select: function () { return { maybeSingle: function () { return Promise.resolve(('bill_type' in row) ? { error: { message: 'column "bill_type" does not exist' } } : { data: { id: 'new' }, error: null }); } }; } }; } }; } };
  var fb = await XS.insertImportedBill(fakeDb, { vendor_name: 'Z' }, { vendor_name: 'Z', release_number: 'R-9', bill_type: 'supplier' });
  check('3e: before the RP SQL is run, an import still creates the bill (without the new columns) — never lost', fb.data && fb.data.id === 'new' && fb.sql_missing === true && tries.length === 2 && tries[1].shipment_direction === 'outbound', { fb: fb, n: tries.length });
  // ── 4. typed by hand: a release # = outbound
  var sb = await call(bills, 'u1', { action: 'save_bill', bill: { vendor_name: 'Hand Typed', bill_number: 'H-1', bill_date: '2026-11-01', total_amount: 10, release_number: '1003-321' } });
  var hb = db.t.vendor_bills.filter(function (b) { return b.bill_number === 'H-1'; })[0];
  check('4a: a new bill typed with a release # and no direction → OUTBOUND', sb.ok && hb.shipment_direction === 'outbound' && hb.direction_source === 'release_number', { sb: sb, hb: hb });
  var bad = await call(bills, 'u1', { action: 'save_bill', bill: { vendor_name: 'Hand Typed', bill_number: 'H-2', bill_date: '2026-11-01', total_amount: 10, bill_type: 'taxi' } });
  check('4b: only the four bill types are accepted', !bad.ok && /bill type/.test(bad.error), bad);
  db.t.vendor_bills.forEach(function (b) { if (b.record_status == null) { b.record_status = 'active'; } }); // the real table defaults record_status to 'active'
  // ── 5. "Prior to validation there MUST be a selection of the TYPE of bill and the direction"
  var v0 = await call(bills, 'u1', { action: 'validate_bill', id: nb2.id, checks: CK, notes: 'checked against the customs entry', shipment_direction: 'inbound' });
  check('5a: no type → validation refused', !v0.ok && /bill TYPE/.test(v0.error) && nb2.validation_status === 'pending', v0);
  var v1 = await call(bills, 'u1', { action: 'validate_bill', id: nb2.id, checks: CK, notes: 'checked against the customs entry', bill_type: 'bonded_brokerage' });
  check('5b: type but no direction → refused', !v1.ok && /Inbound or Outbound/.test(v1.error), v1);
  var v2 = await call(bills, 'u1', { action: 'validate_bill', id: nb2.id, checks: CK, notes: 'checked against the customs entry', bill_type: 'bonded_brokerage', shipment_direction: 'inbound' });
  var au = db.t.hub_audit_log.filter(function (h) { return h.action === 'bill_validated' && h.entity_id === nb2.id; })[0];
  check('5c: type + direction + checks + HOW → validated; both stored as "set at validation"; the audit trail has them', v2.ok && nb2.validation_status === 'validated' && nb2.bill_type === 'bonded_brokerage' && nb2.bill_type_source === 'validator' &&
    nb2.shipment_direction === 'inbound' && nb2.direction_source === 'validator' && au && au.details.bill_type === 'bonded_brokerage' && au.details.shipment_direction === 'inbound', { v2: v2, au: au });
  var v3 = await call(bills, 'u1', { action: 'validate_bill', id: nb.id, checks: CK, notes: 'release 1003-900 matches the shipment' });
  check('5d: an imported bill whose type + direction were sorted on import validates by confirming them (sources kept)', v3.ok && nb.bill_type_source === 'vendor_history' && nb.direction_source === 'release_number', v3);

  // ── 6. on screen
  var BT = R('src/components/BillsTab.jsx'); var U = R('src/components/WirePackagesPanel.jsx');
  check('6a: 💸 Bills validation: "Type of bill" buttons + "This bill is for" — both required, pre-picked values say where they came from',
    BT.indexOf('Type of bill:') > 0 && BT.indexOf("bill_type: validating.btype") > 0 && BT.indexOf("'pick the TYPE of bill'") > 0 && BT.indexOf("' — pre-picked: ' + SRC_WORDS[validating.bill.bill_type_source]") > 0);
  check('6b: 📷 Import fills type / release / reference / direction and says plainly what it found or left blank',
    BT.indexOf("bill_type: (j.sorted && j.sorted.bill_type) || ''") > 0 && BT.indexOf('Type: could not tell from the bill — left blank, it is picked at validation.') > 0 && BT.indexOf('Direction: no release # on the bill — left blank, it is marked at validation.') > 0);
  check('6c: the bill form has the type; typing a release # ticks Outbound when nothing is ticked; the list shows the type (or "type?")',
    BT.indexOf('<option value="">type of bill…</option>') > 0 && BT.indexOf("{ shipment_direction: 'outbound', direction_source: 'release_number' }") > 0 && BT.indexOf('>type?</span>') > 0);
  check('6d: validating from the wire screen asks the type too; the wire and the quick view show it',
    U.indexOf("shipment_direction: dir, bill_type: btype, price_resolution: res") > 0 /* superseded (RV, review #3) */ && U.indexOf("'pick the TYPE of bill'") > 0 && R('src/components/WireQuickView.jsx').indexOf("BILL_TYPE_LABEL[b.bill_type] || '—'") > 0);
  // ── 7. SQL
  var Q = R('sql/v55-83-RP-bill-type.sql');
  check('7a: bill_type limited to the four; sources recorded; existing bills with a release # (not yet validated) become outbound; the DATABASE refuses a validation without type + direction',
    Q.indexOf("CHECK (bill_type IS NULL OR bill_type IN ('trucking', 'shipping', 'bonded_brokerage', 'supplier'))") > 0 && Q.indexOf("SET shipment_direction = 'outbound', direction_source = 'release_number'") > 0 &&
    Q.indexOf("RAISE EXCEPTION 'Pick the bill TYPE before validating it.'") > 0 && Q.indexOf("RAISE EXCEPTION 'Mark the bill Inbound or Outbound before validating it.'") > 0 && Q.indexOf('ADD COLUMN IF NOT EXISTS bill_type text;') > 0);

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (savedKey === undefined) { delete process.env.ANTHROPIC_API_KEY; } else { process.env.ANTHROPIC_API_KEY = savedKey; }
  if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
