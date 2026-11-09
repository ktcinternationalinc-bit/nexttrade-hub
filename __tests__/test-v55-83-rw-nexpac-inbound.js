// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RW — Max, Nov 9 23:26: "nexpac bills are always inbounds — default validation to that with option to manually change"
// The REAL bills route on an in-memory DB (AI reply mocked); the SQL ran twice on PG16 (NexPac → inbound, AMB untouched).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
var savedKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-key';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var db = new MemDB({
  users: [{ id: 'u9', name: 'Max', role: 'super_admin', active: true }], module_permissions: [],
  vendor_bills: [], vendor_bill_lines: [], vendor_bill_payments: [], vendor_bill_events: [], hub_audit_log: [], wire_packages: [], wire_package_lines: [], expense_rules: [], paid_through_parties: [],
  bill_commission_rules: [{ id: 'cr1', vendor_match: 'NexPac', rate: 0.125, active: true, default_direction: 'inbound' }], bill_price_rules: [],
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var L = require(path.join(root, 'src/lib/bill-lines.js'));
async function call(user, body) { var res = await bills.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var aiReply = ''; var realFetch = global.fetch;
global.fetch = function (url) { if (/anthropic/.test(String(url))) { return Promise.resolve({ json: function () { return Promise.resolve({ content: [{ type: 'text', text: aiReply }] }); } }); } return realFetch.apply(this, arguments); };
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 400))); }
function bill(no) { return db.t.vendor_bills.filter(function (b) { return b.bill_number === no; })[0]; }
var CK = { matches_records: true, goods_received: true, charges_accurate: true };
console.log('RW — NexPac bills default to inbound (changeable)');
(async function () {
  check('1a: NexPac → inbound; any other vendor → no default; before the SQL is run NexPac is still inbound', L.defaultDirectionFor(db.t.bill_commission_rules, 'NexPac Corporation') === 'inbound' &&
    L.defaultDirectionFor(db.t.bill_commission_rules, 'AMB Logistic') === null && L.defaultDirectionFor([{ vendor_match: 'NexPac', rate: 0.125 }], 'NEXPAC CORP') === 'inbound');
  aiReply = JSON.stringify({ vendor_name: 'NexPac Corporation', bill_number: '14481', bill_date: '2026-06-02', total_amount: 2831, bill_type: 'supplier', other_reference: '80210999', lines: [] });
  var g = await call('u9', { action: 'ingest_bill_file', file_base64: 'x'.repeat(200), media_type: 'application/pdf', filename: 'Invoice_14481.pdf' });
  check('1b: an imported NexPac bill is INBOUND from the start (source: the vendor’s default)', g.ok && bill('14481').shipment_direction === 'inbound' && bill('14481').direction_source === 'vendor_default', bill('14481'));
  var ex = await call('u9', { action: 'extract_bill', file_base64: 'x'.repeat(200), media_type: 'application/pdf' });
  check('1c: 📷 Import pre-fills inbound too', ex.ok && ex.sorted.shipment_direction === 'inbound' && ex.sorted.direction_source === 'vendor_default', ex.sorted);
  aiReply = JSON.stringify({ vendor_name: 'AMB Logistic', bill_number: '36200', bill_date: '2026-11-08', total_amount: 2050, bill_type: 'trucking', lines: [] });
  await call('u9', { action: 'ingest_bill_file', file_base64: 'x'.repeat(200), media_type: 'application/pdf', filename: 'amb.pdf' });
  check('1d: other vendors are untouched (no release # → left blank for the validator)', !bill('36200').shipment_direction);
  var sb = await call('u9', { action: 'save_bill', bill: { vendor_name: 'NexPac Corporation', bill_number: '14490', bill_date: '2026-07-01', total_amount: 100 } });
  check('1e: a NexPac bill typed by hand is saved INBOUND — and the missing reference does not block saving (the wire check still asks for it)', sb.ok && bill('14490').shipment_direction === 'inbound', sb);
  var lst = await call('u9', { action: 'list' });
  check('1f: the list tells the screen each bill’s vendor default (the validation panel pre-picks it)', (lst.bills || []).some(function (b) { return b.bill_number === '36200' && !b.default_direction; }) && (lst.bills || []).some(function (b) { return b.bill_number === '14490' && b.default_direction === 'inbound'; }));
  db.t.vendor_bills.forEach(function (b) { if (b.record_status == null) { b.record_status = 'active'; } if (b.validation_status == null) { b.validation_status = 'pending'; } }); // the real table defaults
  var v = await call('u9', { action: 'validate_bill', id: bill('14481').id, checks: CK, notes: 'weights match order 80210999', bill_type: 'supplier', shipment_direction: 'outbound' });
  check('1g: the person can still change it — validated as OUTBOUND on purpose, saved as set at validation', v.ok && bill('14481').shipment_direction === 'outbound' && bill('14481').direction_source === 'validator', v);
  var cr = await call('u9', { action: 'commission_rule_save', rule: { id: 'cr1', vendor_match: 'NexPac', rate_pct: '12.5', default_direction: 'outbound' } });
  check('1h: the default is a setting in 📏 Price rules (vendors that bill cost + commission)', cr.ok && db.t.bill_commission_rules[0].default_direction === 'outbound', cr);
  var BT = R('src/components/BillsTab.jsx'); var WP = R('src/components/WirePackagesPanel.jsx'); var PR = R('src/components/PriceRulesPanel.jsx'); var Q = R('sql/v55-83-RW-vendor-default-direction.sql');
  check('2a: the validation panel pre-picks it and says so ("NexPac Corporation bills are always inbound — click the other one to change it"); the wire screen too',
    BT.indexOf("dir: (b.shipment_direction === 'inbound' || b.shipment_direction === 'outbound') ? b.shipment_direction : (b.default_direction || '')") > 0 && BT.indexOf("' bills are always ' + validating.dir + ' — click the other one to change it'") > 0 && WP.indexOf("if (!dir && j.default_direction) { setDir(j.default_direction);") > 0);
  check('2b: 📏 Price rules shows and edits it', PR.indexOf("'bills are ' + (c.default_direction === 'outbound' ? 'Outbound ➡' : '⬅ Inbound')") > 0 && PR.indexOf('<option value="inbound">⬅ Inbound</option>') > 0);
  check('2c: SQL: NexPac set to inbound; open NexPac bills without a direction become inbound; validated bills untouched; safe to re-run',
    Q.indexOf("SET default_direction = 'inbound' WHERE lower(vendor_match) = 'nexpac' AND default_direction IS NULL") > 0 && Q.indexOf("COALESCE(vb.validation_status, 'pending') <> 'validated'") > 0 && Q.indexOf("'vendor_default'") > 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (savedKey === undefined) { delete process.env.ANTHROPIC_API_KEY; } else { process.env.ANTHROPIC_API_KEY = savedKey; }
  if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
