// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RU — Max, Nov 9:
//  21:48 "please save entries when we validate even if we have not yet fully validated. such as just entering the
//         type or the direction."
//  21:49 "also the price check should always check based on the rules when importing and flagging if something looks
//         off stating what exactly is off"
// The REAL bills route runs on an in-memory DB (AI reply mocked from the real bills' printed numbers).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
var savedKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-key';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var B1 = 'b6000000-0000-0000-0000-000000000001';
var db = new MemDB({
  users: [{ id: 'u1', name: 'Clerk', role: 'staff', active: true }, { id: 'u2', name: 'Sara', role: 'staff', active: true }],
  module_permissions: [].concat(['accounting.clickbooks.access', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; })),
  vendor_bills: [{ id: B1, vendor_name: 'Kronos Logistics Inc.', bill_number: 'KLNT043', bill_date: '2026-10-20', total_amount: 725, record_status: 'active', validation_status: 'pending', bill_type: null, shipment_direction: null }],
  vendor_bill_lines: [], vendor_bill_payments: [], vendor_bill_events: [], hub_audit_log: [], wire_packages: [], wire_package_lines: [], expense_rules: [], paid_through_parties: [],
  bill_commission_rules: [{ id: 'cr1', vendor_match: 'NexPac', rate: 0.125, active: true }],
  bill_price_rules: [
    { id: 'p1', vendor_match: 'NexPac', item_match: 'Cambridge Thirds', unit: 'LBS', expected_unit_price: 0.09, tolerance_pct: 0, applies_to: 'cost', active: true, note: 'agreed Jun 2026' },
    { id: 'p2', vendor_match: 'AMB', bill_type: 'trucking', item_match: null, expected_amount: 1850, tolerance_pct: 2, applies_to: 'cost', active: true, note: 'drayage Bayport → San Antonio' }],
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
async function call(user, body) { var res = await bills.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var aiReply = ''; var realFetch = global.fetch;
global.fetch = function (url) { if (/anthropic/.test(String(url))) { return Promise.resolve({ json: function () { return Promise.resolve({ content: [{ type: 'text', text: aiReply }] }); } }); } return realFetch.apply(this, arguments); };
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
function hist(a) { return db.t.hub_audit_log.filter(function (h) { return h.action === a; }); }
var CK = { matches_records: true, goods_received: true, charges_accurate: true };
console.log('RU — validation progress is saved as you go; the price check says exactly what is off');
(async function () {
  var b = db.t.vendor_bills[0];
  // ── 1. save as you go
  var s1 = await call('u1', { action: 'save_validation_progress', id: B1, bill_type: 'trucking' });
  check('1a: picking just the TYPE saves it on the bill at once (who / from → to on the audit trail); still PENDING', s1.ok && b.bill_type === 'trucking' && b.bill_type_source === 'manual' && b.validation_status === 'pending' &&
    hist('bill_validation_progress_saved').length === 1 && hist('bill_validation_progress_saved')[0].details.bill_type.to === 'trucking', s1);
  var s2 = await call('u1', { action: 'save_validation_progress', id: B1, bill_type: 'trucking', shipment_direction: 'inbound' });
  check('1b: then just the DIRECTION — saved too (the unchanged type is not logged again)', s2.ok && b.shipment_direction === 'inbound' && hist('bill_validation_progress_saved').length === 2 && !hist('bill_validation_progress_saved')[1].details.bill_type, s2);
  var s3 = await call('u1', { action: 'save_validation_progress', id: B1, draft: { checks: { matches_records: true }, notes: 'checked the POD, waiting on' } });
  check('1c: ticks and a half-written HOW note are kept as a DRAFT (with who and when) — not as a validation', s3.ok && b.validation_draft && b.validation_draft.checks.matches_records === true && b.validation_draft.checks.goods_received === false &&
    /POD/.test(b.validation_draft.notes) && b.validation_draft.by === 'u1' && b.validation_draft.by_name === 'Clerk' && b.validation_status === 'pending', b.validation_draft);
  var lst = await call('u2', { action: 'list' });
  var lb = (lst.bills || []).filter(function (x) { return x.id === B1; })[0];
  check('1d: the next person sees it: the list carries the type, the direction and the draft (screen shows “PENDING · started” and picks up where it was left)', lb && lb.bill_type === 'trucking' && lb.shipment_direction === 'inbound' && lb.validation_draft && /POD/.test(lb.validation_draft.notes), lb);
  var bad = await call('u1', { action: 'save_validation_progress', id: B1, bill_type: 'taxi' });
  check('1e: only the four types are accepted', !bad.ok && /Unknown bill type/.test(bad.error), bad);
  var v = await call('u2', { action: 'validate_bill', id: B1, checks: CK, notes: 'POD signed, rate per the Kronos quote' });
  check('1f: finishing the validation works with what was saved (type + direction already on the bill) and clears the draft', v.ok && b.validation_status === 'validated' && b.validation_draft === null, { v: v, d: b.validation_draft });
  var after = await call('u1', { action: 'save_validation_progress', id: B1, shipment_direction: 'outbound' });
  check('1g: a validated bill cannot be changed through the draft', !after.ok && /already validated/.test(after.error) && b.shipment_direction === 'inbound', after);
  // ── 2. every import is checked against the rules; flags say exactly what is off
  aiReply = JSON.stringify({ vendor_name: 'NexPac Corporation', bill_number: '14350', bill_date: '2026-06-16', total_amount: 4354.48, bill_type: 'supplier', other_reference: '80210265', lines: [
    { description: 'Cambridge Seconds (LBS)', qty: 12153.5, unit: 'LBS', unit_price: 0.26, amount: 3159.91, line_kind: 'item' },
    { description: 'Cambridge PVC (LBS)', qty: 901, unit: 'LBS', unit_price: 0.05, amount: 45.05, line_kind: 'item' },
    { description: 'Cambridge Paper (LBS)', qty: 4887, unit: 'LBS', unit_price: 0.05, amount: 244.35, line_kind: 'item' },
    { description: 'Cambridge Pool (LBS)', qty: 684, unit: 'LBS', unit_price: 0.11, amount: 75.24, line_kind: 'item' },
    { description: 'Cambridge Thirds (LBS)', qty: 3461, unit: 'LBS', unit_price: 0.10, amount: 346.10, line_kind: 'item' },
    { description: 'Commission 12.5%', qty: 1, unit_price: 483.83125, amount: 483.83, line_kind: 'commission' }] });
  var ex = await call('u1', { action: 'extract_bill', file_base64: 'x'.repeat(200), media_type: 'application/pdf' });
  var f0 = ex.price_preview && ex.price_preview.flags[0];
  check('2a: 📷 Import shows the price check BEFORE saving', ex.ok && ex.price_preview && ex.price_preview.status === 'flagged' && ex.price_preview.flags.length === 1, ex.price_preview);
  check('2b: …stating exactly what is off: the line, billed vs expected per unit, how much and % too high, the dollars on this bill, and which rule',
    f0 && /Line 5 \(Cambridge Thirds \(LBS\)\)/.test(f0.text) && /billed \$0\.10\/LBS/.test(f0.text) && /expected \$0\.09\/LBS/.test(f0.text) && /\$0\.01\/LBS TOO HIGH \(\+11\.1%\)/.test(f0.text) && /on 3,461 LBS that is \$34\.61 more than expected/.test(f0.text) && /rule: NexPac, “Cambridge Thirds” — agreed Jun 2026, ±0% allowed/.test(f0.text) && f0.impact === 34.61, f0);
  check('2c: lines without a rule are listed as such (nothing to compare), not passed silently', ex.price_preview.notes.length === 4 && /no price rule yet/.test(ex.price_preview.notes[0].text));
  aiReply = JSON.stringify({ vendor_name: 'AMB Logistic', bill_number: '36101', bill_date: '2026-11-08', total_amount: 2050, bill_type: 'trucking', other_reference: 'GLDU9404318', lines: [] });
  var g = await call('u1', { action: 'ingest_bill_file', file_base64: 'x'.repeat(200), media_type: 'application/pdf', filename: 'Invoice_36101.pdf' });
  check('2d: an import with NO readable lines is still checked (whole-bill rule: AMB trucking $1,850 ±2%) — and the import result says what is off',
    g.ok && g.created && g.lines_read === 0 && g.price_check === 'flagged' && g.price_flags.length === 1 && /Bill total: billed \$2,050\.00, expected \$1,850\.00 — \$200\.00 TOO HIGH \(\+10\.8%\)/.test(g.price_flags[0]) && /drayage Bayport/.test(g.price_flags[0]), g);
  var nb = db.t.vendor_bills.filter(function (x) { return x.bill_number === '36101'; })[0];
  var ev = db.t.vendor_bill_events.filter(function (e) { return e.bill_id === nb.id && e.kind === 'file_ingested'; })[0];
  check('2e: the bill carries the flag, and its import record keeps what was found', nb.price_check_status === 'flagged' && ev && ev.details.price_check === 'flagged' && ev.details.price_flags.length === 1);
  // 2f other flag wording
  var L = require(path.join(root, 'src/lib/bill-lines.js'));
  var com = L.priceCheck({ vendor_name: 'NexPac', total_amount: 1162.5 }, [L.shapeLine({ description: 'Cambridge Seconds (LBS)', qty: 1000, unit_price: 1, amount: 1000 }, 0), L.shapeLine({ description: 'Commission 12.5%', amount: 162.5 }, 1)], [], { vendor_match: 'NexPac', rate: 0.125 });
  var qx = L.priceCheck({ vendor_name: 'X', total_amount: 120 }, [L.shapeLine({ description: 'Line Haul', qty: 2, unit_price: 50, amount: 120 }, 0)], [], null);
  check('2f: commission, math and totals problems are spelled out too', /Commission: billed \$162\.50, expected 12\.5% of the product cost \$1000\.00 = \$125\.00 — \$37\.50 TOO HIGH \(that is 16\.25% instead of 12\.5%\)/.test(com.flags[0].text) &&
    /2 × \$50\.00 = \$100\.00, but the line charges \$120\.00 — \$20\.00 more than the math/.test(qx.flags[0].text), { c: com.flags[0].text, q: qx.flags[0].text });
  // ── 3. screens
  var BT = R('src/components/BillsTab.jsx');
  check('3a: in the validation panel a click (type, direction, a tick) saves at once, typing saves after a moment and on leaving the box; “Close — finish later” keeps everything; it says “✓ Saved hh:mm”',
    BT.indexOf("onClick={function () { setV({ btype: t }, true); }}") > 0 && BT.indexOf("onClick={function () { setV({ dir: o[0] }, true); }}") > 0 && BT.indexOf('setV({ checks: ch }, true)') > 0 && BT.indexOf("onChange={function (e) { setV({ notes: e.target.value }); }} onBlur={flushV}") > 0 &&
    BT.indexOf('Close — finish later') > 0 && BT.indexOf("'✓ Saved '") > 0 && BT.indexOf("'Picked up where '") > 0 && BT.indexOf("'PENDING · started'") > 0);
  check('3b: 📷 Import shows the price check box before Save; Save says the result; bulk import and the mailbox scan list each flag',
    BT.indexOf('{editing._imported && pricePreview && <PriceCheckBox check={pricePreview}') > 0 && BT.indexOf("'Bill saved — ⚠ PRICE CHECK FLAGGED: '") > 0 && BT.indexOf("(jq.price_flags || []).forEach(function (ft) { notesQ.push('      ⚠ ' + ft); });") > 0 && BT.indexOf("(b0.price_flags || []).forEach(function (ft) { lines.push('      ⚠ ' + ft); });") > 0);
  check('3c: the email inbox and scanner also return what was flagged', R('src/app/api/accounting/bills/inbound/route.js').indexOf('price_flags: ins.price_flags || []') > 0 && R('src/app/api/accounting/bills/email-scan/route.js').indexOf('price_flags: ins.price_flags || []') > 0);
  var WP = R('src/components/WirePackagesPanel.jsx');
  check('3e: the “Validate now” form on the wire screen saves the type and direction the moment they are picked too', WP.indexOf("keep({ fields: { bill_type: t } }, true)") > 0 && WP.indexOf("keep({ fields: { shipment_direction: o[0] } }, true)") > 0 /* superseded (RV, review #3): also saves ticks / notes */ && WP.indexOf("action: 'save_validation_progress'") > 0);
  check('3d: SQL: one draft column, safe to re-run', /ADD COLUMN IF NOT EXISTS validation_draft jsonb;/.test(R('sql/v55-83-RU-validation-progress.sql')));
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (savedKey === undefined) { delete process.env.ANTHROPIC_API_KEY; } else { process.env.ANTHROPIC_API_KEY = savedKey; }
  if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
