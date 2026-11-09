// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RQ — Max, Nov 9:
//  21:10 "need you to learn the different types of bills that we are receiving so you know how to pull out the data.
//         FOR all of NEXPAC BILLS ... 1) Keep track of the qty of items received ... and amount of money paid for these
//         2) ... commission fee and the rest is the actual cgt charge ... broken down for each product billed line with
//         2 lines. actual cost and commission line. ... aggregating each like items and the total cost and total
//         commission paid for each items. for other types of bills.. keep track of the service, amount and vendor and
//         dates ... since june 1st and last week, month, quarter or custom dates or last year."
//  21:18 "also later on with bills we can sort them by the types and the direction. so it is supposed to be cost then
//         12.5% is added to the cost... we also need a section to enter the prices of the types of products supplied so
//         the HUB can validate that the correct prices were entered into the bill. Same for trucking.. rule creation ...
//         if there is an issue that the HUB sees, then it should flag it for manual intervention."
//  21:19 sample bills: NexPac 14350 / 14351 / 14353 / 14354, AMB Logistic 36100 (twice), Trinity 9867052-1.
// The REAL bills route runs on an in-memory DB with the AI reply mocked from those bills' printed numbers; the SQL ran on PG16.
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
  users: [{ id: 'u1', name: 'Clerk', role: 'staff', active: true }, { id: 'u9', name: 'Max', role: 'super_admin', active: true }],
  module_permissions: ['accounting.clickbooks.access', 'bills.manage', 'bills.view'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
  vendor_bills: [], vendor_bill_lines: [], vendor_bill_payments: [], vendor_bill_events: [], hub_audit_log: [], wire_packages: [], wire_package_lines: [], expense_rules: [], paid_through_parties: [],
  bill_commission_rules: [{ id: 'cr1', vendor_match: 'NexPac', rate: 0.125, active: true }], bill_price_rules: [],
});
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
global.__db = db;
var L = require(path.join(root, 'src/lib/bill-lines.js'));
var X = require(path.join(root, 'src/lib/bill-extract.js'));
var bills = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
async function call(user, body) { var res = await bills.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
var aiReply = '';
var realFetch = global.fetch;
global.fetch = function (url) { if (/anthropic/.test(String(url))) { return Promise.resolve({ json: function () { return Promise.resolve({ content: [{ type: 'text', text: aiReply }] }); } }); } return realFetch.apply(this, arguments); };
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
function bill(no) { return db.t.vendor_bills.filter(function (b) { return b.bill_number === no; })[0]; }
function linesOf(no) { var b = bill(no); return db.t.vendor_bill_lines.filter(function (l) { return l.bill_id === b.id; }).sort(function (a, c) { return a.line_no - c.line_no; }); }
async function ingest(reply, name) { aiReply = JSON.stringify(reply); var r = await call('u1', { action: 'ingest_bill_file', file_base64: 'x'.repeat(200), media_type: 'application/pdf', filename: name }); db.t.vendor_bills.forEach(function (b) { if (b.record_status == null) { b.record_status = 'active'; } if (b.validation_status == null) { b.validation_status = 'pending'; } }); return r; }
var CK = { matches_records: true, goods_received: true, charges_accurate: true };
// NexPac 14350 as printed
var NP14350 = { vendor_name: 'NexPac Corporation', bill_number: '14350', bill_date: '2026-06-16', due_date: '2026-07-16', total_amount: 4354.48, other_reference: '80210265', bill_type: 'supplier', release_number: null, lines: [
  { description: 'Cambridge PVC (LBS)', qty: 901, unit: 'LBS', unit_price: 0.05, amount: 45.05, line_kind: 'item' },
  { description: 'Cambridge Seconds (LBS)', qty: 12153.5, unit: 'LBS', unit_price: 0.26, amount: 3159.91, line_kind: 'item' },
  { description: 'Cambridge Paper (LBS)', qty: 4887, unit: 'LBS', unit_price: 0.05, amount: 244.35, line_kind: 'item' },
  { description: 'Cambridge Pool (LBS)', qty: 684, unit: 'LBS', unit_price: 0.11, amount: 75.24, line_kind: 'item' },
  { description: 'Cambridge Thirds (LBS)', qty: 3461, unit: 'LBS', unit_price: 0.10, amount: 346.10, line_kind: 'item' },
  { description: 'Commission 12.5%', qty: 1, unit: null, unit_price: 483.83125, amount: 483.83, line_kind: 'commission' }] };
var NP14353 = { vendor_name: 'NexPac Corporation', bill_number: '14353', bill_date: '2026-06-08', total_amount: 3471.76, other_reference: '80208996', bill_type: 'supplier', lines: [
  { description: 'Cambridge Seconds (LBS)', qty: 5416, unit: 'LBS', unit_price: 0.26, amount: 1408.16, line_kind: 'item' },
  { description: 'Cambridge Paper (LBS)', qty: 2748, unit: 'LBS', unit_price: 0.05, amount: 137.40, line_kind: 'item' },
  { description: 'Cambridge Thirds (LBS)', qty: 8134, unit: 'LBS', unit_price: 0.10, amount: 813.40, line_kind: 'item' },
  { description: 'Cambridge Roofing (LBS)', qty: 6609.5, unit: 'LBS', unit_price: 0.11, amount: 727.05, line_kind: 'item' },
  { description: 'Commission 12.5%', qty: 1, unit_price: 385.75, amount: 385.75, line_kind: 'commission' }] };
var AMB = { vendor_name: 'AMB Logistic', bill_number: '36100', bill_date: '2026-11-03', total_amount: 2050, other_reference: 'GLDU9404318', bill_type: 'trucking', lines: [
  { description: 'Line Haul', amount: 1850, line_kind: 'charge' }, { description: 'Rail swing Fee', amount: 200, line_kind: 'charge' }] };
var TRIN = { vendor_name: 'Trinity Logistics, Inc.', bill_number: '9867052-1', bill_date: '2026-09-30', due_date: '2026-10-15', total_amount: 2375, other_reference: 'ID 2690', bill_type: 'trucking', lines: [
  { description: 'LINEHAUL', qty: 1, unit: 'Flat Rate', unit_price: 2375, amount: 2375, line_kind: 'charge' }] };
console.log('RQ — bill lines, NexPac cost + 12.5%, price rules, reports, sort by type / direction');
(async function () {
  // ── 1. the reader learned our bills
  var P = X.BILL_EXTRACT_PROMPT;
  check('1a: the reader knows NexPac (LBS rows at cost + one "Commission 12.5%" row, DO/ORDER # = reference), Trinity (LINEHAUL, PU#) and AMB (vendor only in logo / bank details, Line Haul + Rail swing, container #)',
    ['NexPac Corporation', 'Commission 12.5%', 'DO/ORDER/QUOTE NO.', 'Trinity Logistics', 'LINEHAUL', 'PU# : ID 2690', 'AMB Logistic', 'Rail swing Fee', 'CONTAINER NO.', 'NEVER the vendor', 'Never copy bank account or routing numbers'].every(function (k) { return P.indexOf(k) >= 0; }));
  var pl = X.parseBillExtraction(JSON.stringify({ vendor_name: 'NexPac Corporation', total_amount: 100, lines: [{ description: 'Cambridge Seconds (LBS)', qty: '12,153.50', unit_price: '0.26', amount: '3,159.91', line_kind: 'item' }, { description: 'SUBTOTAL', amount: 3159.91 }, { description: 'TOTAL DUE', amount: 3159.91 }, { description: 'Commission 12.5%', amount: 483.83 }] }));
  check('1b: lines come back as plain numbers; subtotal / total rows are dropped; "Commission" is recognised', pl.draft.lines.length === 2 && pl.draft.lines[0].qty === 12153.5 && pl.draft.lines[0].amount === 3159.91 && pl.draft.lines[1].line_kind === 'commission', pl.draft.lines);
  // ── 2. NexPac: each product = actual cost + its commission (cost, then 12.5% added to it)
  var g = await ingest(NP14350, 'Invoice_14350_from_NexPac_Corporation.pdf');
  var ls = linesOf('14350'); var items = ls.filter(function (l) { return l.line_kind === 'item'; });
  var sec = items.filter(function (l) { return /Seconds/.test(l.description); })[0];
  check('2a: NexPac 14350 imported with its 6 lines; every product carries its cost AND its commission', g.ok && g.created && ls.length === 6 && items.length === 5 && items.every(function (l) { return l.cost_amount === l.amount && l.commission_amount > 0 && l.commission_rate === 0.125; }), { g: g, ls: ls });
  check('2b: Cambridge Seconds: 12,153.50 LBS × $0.26 = $3,159.91 cost + $394.99 commission (12.5% of its cost)', sec.qty === 12153.5 && sec.unit === 'LBS' && sec.cost_amount === 3159.91 && sec.commission_amount === 394.99, sec);
  var sumC = Math.round(items.reduce(function (a, l) { return a + l.commission_amount * 100; }, 0)) / 100;
  check('2c: the product commissions add up EXACTLY to the bill\'s commission line ($483.83) and cost + commission = the bill total ($4,354.48)', sumC === 483.83 && Math.round((items.reduce(function (a, l) { return a + l.cost_amount; }, 0) + sumC) * 100) / 100 === 4354.48, sumC);
  // superseded (v55.83-RW, Max 23:26 "nexpac bills are always inbounds"): no release → NexPac's default, INBOUND (changeable)
  check('2d: type Supplier, the order # is the reference; no release → NexPac bills default to INBOUND', bill('14350').bill_type === 'supplier' && bill('14350').other_reference === '80210265' && bill('14350').shipment_direction === 'inbound' && bill('14350').direction_source === 'vendor_default');
  check('2e: the commission is checked: 12.5% of $3,870.65 = $483.83 ✓ (no flag); no price rules yet → "no rule"', bill('14350').price_check_status === 'no_rules' && bill('14350').price_check.flags.length === 0, bill('14350').price_check);
  var bad = JSON.parse(JSON.stringify(NP14353)); bad.bill_number = '14353-X'; bad.lines[4].amount = 400; bad.total_amount = 3486.01;
  await ingest(bad, 'bad.pdf');
  check('2f: a NexPac bill whose commission is NOT 12.5% of the product cost is FLAGGED', bill('14353-X').price_check_status === 'flagged' && bill('14353-X').price_check.flags.some(function (f) { return f.code === 'COMMISSION_RATE'; }), bill('14353-X').price_check);
  // ── 3. price rules: products and trucking
  var deny = await call('u1', { action: 'price_rule_save', rule: { vendor_match: 'NexPac', item_match: 'Cambridge Seconds', unit: 'LBS', expected_unit_price: 0.26 } });
  check('3a: setting price rules needs its own switch ("Set price rules")', !deny.ok && /Price rules/.test(deny.error), deny);
  var r1 = await call('u9', { action: 'price_rule_save', rule: { vendor_match: 'NexPac', item_match: 'Cambridge Seconds', unit: 'LBS', expected_unit_price: 0.26, tolerance_pct: 0 } });
  var r2 = await call('u9', { action: 'price_rule_save', rule: { vendor_match: 'NexPac', item_match: 'Cambridge Thirds', unit: 'LBS', expected_unit_price: 0.09, tolerance_pct: 0, note: 'agreed Jun 2026' } });
  check('3b: rules saved, audited, and every open bill is checked again at once', r1.ok && r2.ok && r2.rechecked >= 2 && db.t.hub_audit_log.filter(function (h) { return h.action === 'price_rule_created'; }).length === 2, { r1: r1, r2: r2 });
  var pc = bill('14350').price_check;
  check('3c: 14350: Seconds at $0.26 matches; Thirds billed $0.10/LBS vs the expected $0.09 → FLAGGED for a person', bill('14350').price_check_status === 'flagged' && pc.flags.length === 1 && pc.flags[0].code === 'PRICE_HIGH' && /Thirds/.test(pc.flags[0].text) && /0\.09/.test(pc.flags[0].text), pc);
  var r3 = await call('u9', { action: 'price_rule_save', rule: { vendor_match: 'AMB', item_match: 'Line Haul', expected_amount: 1850, tolerance_pct: 0 } });
  var r4 = await call('u9', { action: 'price_rule_save', rule: { vendor_match: 'AMB', item_match: 'Rail swing', expected_amount: 150, tolerance_pct: 0 } });
  var r5 = await call('u9', { action: 'price_rule_save', rule: { vendor_match: 'Trinity', bill_type: 'trucking', item_match: 'linehaul', expected_unit_price: 2375, unit: 'Flat Rate', tolerance_pct: 2 } });
  var bad1 = await call('u9', { action: 'price_rule_save', rule: { item_match: 'Line Haul' } });
  var bad2 = await call('u9', { action: 'price_rule_save', rule: { expected_amount: 5 } });
  check('3d: a rule must say what it is for AND the expected price', r3.ok && r4.ok && r5.ok && !bad1.ok && !bad2.ok, { bad1: bad1, bad2: bad2 });
  await ingest(AMB, 'Invoice_36100.pdf'); await ingest(TRIN, '9867052-1.pdf');
  check('3e: AMB 36100: Line Haul $1,850 ✓, Rail swing Fee $200 vs the expected $150 → FLAGGED', bill('36100').price_check_status === 'flagged' && bill('36100').price_check.flags.length === 1 && /Rail swing/.test(bill('36100').price_check.flags[0].text), bill('36100').price_check);
  check('3f: Trinity 9867052-1: LINEHAUL 1 × $2,375 flat rate matches → ✅ prices OK; its lines are "charges"', bill('9867052-1').price_check_status === 'ok' && linesOf('9867052-1')[0].line_kind === 'charge', bill('9867052-1').price_check);
  var dup = await ingest(AMB, 'Invoice_36100_1.pdf');
  check('3g: the second copy of AMB 36100 is caught as a duplicate (not imported twice)', dup.skipped === true && db.t.vendor_bills.filter(function (b) { return b.bill_number === '36100'; }).length === 1, dup);
  // ── 4. flagged → manual intervention before validation
  var b350 = bill('14350');
  var v0 = await call('u1', { action: 'validate_bill', id: b350.id, checks: CK, notes: 'weighed at receiving, matches order 80210265', bill_type: 'supplier', shipment_direction: 'inbound' });
  check('4a: a flagged bill cannot be validated without a written resolution — the refusal lists the flags', !v0.ok && /price check flagged/.test(v0.error) && (v0.price_flags || []).length === 1 && b350.validation_status === 'pending', v0);
  var v1 = await call('u1', { action: 'validate_bill', id: b350.id, checks: CK, notes: 'weighed at receiving, matches order 80210265', bill_type: 'supplier', shipment_direction: 'inbound', price_resolution: 'NexPac confirmed Thirds went to $0.10 in June; rule to be updated' });
  var au = db.t.hub_audit_log.filter(function (h) { return h.action === 'bill_validated' && h.entity_id === b350.id; })[0];
  check('4b: with the resolution it validates; who resolved it, when and why are stored and on the audit trail', v1.ok && b350.validation_status === 'validated' && b350.price_resolved_by === 'u1' && /\$0\.10/.test(b350.price_resolved_note) && au && au.details.price_flags.length === 1 && /NexPac confirmed/.test(au.details.price_resolution), { v1: v1, au: au && au.details });
  var lk = await call('u1', { action: 'save_lines', id: b350.id, lines: [{ description: 'x', amount: 1 }] });
  check('4c: a validated bill\'s lines are locked', !lk.ok && /validated/.test(lk.error), lk);
  // edit lines by hand on an open bill → re-checked
  var ab = bill('36100');
  var ed = await call('u1', { action: 'save_lines', id: ab.id, lines: [{ description: 'Line Haul', amount: 1850, line_kind: 'charge' }, { description: 'Rail swing Fee', amount: 150, line_kind: 'charge' }, { description: 'Chassis', amount: 50, line_kind: 'charge' }] });
  check('4d: lines edited by hand → the check runs again (Rail swing now matches → ✅; the new Chassis line has no rule yet and says so; the bill still adds up to $2,050)', ed.ok && ab.price_check_status === 'ok' && ab.price_check.flags.length === 0 && ab.price_check.notes.length === 1 && /Chassis/.test(ab.price_check.notes[0].text), { ed: ed, st: ab.price_check_status, pc: ab.price_check });
  // ── 5. reports
  await ingest(NP14353, 'Invoice_14353_from_NexPac_Corporation.pdf');
  var b353 = bill('14353');
  db.t.vendor_bill_payments.push({ id: 'p1', bill_id: b353.id, amount: 3471.76 / 2, paid_date: '2026-07-01', voided: false });
  db.t.vendor_bill_payments.push({ id: 'p2', bill_id: bill('9867052-1').id, amount: 2375, paid_date: '2026-10-10', voided: false });
  var rp = await call('u1', { action: 'bill_reports', period: 'since_jun1', today: '2026-11-09' });
  var secR = (rp.inventory || []).filter(function (r) { return r.item === 'Cambridge Seconds'; })[0];
  check('5a: products received (like items added together): Cambridge Seconds 12,153.5 + 5,416 + 5,416 (the flagged copy) LBS with cost, commission, billed', rp.ok && secR && secR.qty === 22985.5 && secR.unit === 'LBS' && secR.cost === Math.round((3159.91 + 1408.16 * 2) * 100) / 100 && secR.commission > 0 && secR.billed === Math.round((secR.cost + secR.commission) * 100) / 100 && secR.bills === 3, secR);
  var thr = rp.inventory.filter(function (r) { return r.item === 'Cambridge Thirds'; })[0];
  check('5b: "amount of money paid for these": half of 14353 was paid → its products show half their billed amount as paid', thr && Math.abs(thr.paid - (813.40 * 1.125) / 2) < 0.05, thr);
  check('5c: the totals: cost + commission = billed for the products', Math.abs(rp.inventory_totals.cost + rp.inventory_totals.commission - rp.inventory_totals.billed) < 0.02, rp.inventory_totals);
  var sp = rp.spend;
  check('5d: charges & services (not NexPac products): by type (trucking), by vendor (AMB, Trinity) and by service (Line Haul, Rail swing, Chassis, LINEHAUL); billed vs paid',
    sp.by_type.length === 1 && sp.by_type[0].key === 'trucking' && sp.by_type[0].billed === 4425 && sp.by_type[0].paid === 2375 &&
    sp.by_vendor.map(function (v) { return v.label; }).sort().join() === 'AMB Logistic,Trinity Logistics, Inc.' && sp.by_service.some(function (s) { return s.label === 'Chassis' && s.billed === 50; }), sp);
  var rpLW = await call('u1', { action: 'bill_reports', period: 'last_month', today: '2026-11-09' });
  check('5e: periods work: "last month" (October) has no bills dated in it but shows the $2,375 paid to Trinity on Oct 10', rpLW.range.from === '2026-10-01' && rpLW.range.to === '2026-10-31' && rpLW.spend.totals.billed === 0 && rpLW.spend.totals.paid === 2375, rpLW.spend.totals);
  var pr = function (k) { return L.periodRange(k, '2026-11-09'); };
  check('5f: since June 1, last week, this / last quarter, last year, custom', pr('since_jun1').from === '2026-06-01' && pr('last_week').from === '2026-11-02' && pr('last_week').to === '2026-11-08' &&
    pr('this_quarter').from === '2026-10-01' && pr('last_quarter').from === '2026-07-01' && pr('last_quarter').to === '2026-09-30' && pr('last_year').from === '2025-01-01' && L.periodRange('custom', '2026-11-09', { from: '2026-08-01', to: '2026-08-31' }).to === '2026-08-31');
  // ── 6. on screen
  var BT = R('src/components/BillsTab.jsx'); var BL = R('src/components/BillLinesPanel.jsx'); var PR = R('src/components/PriceRulesPanel.jsx'); var RP = R('src/components/BillReportsPanel.jsx');
  check('6a: 💸 Bills filters by type, inbound / outbound and price check, and sorts by type / direction / vendor / newest / amount',
    BT.indexOf('<option value="none">❔ type not set</option>') > 0 && BT.indexOf('<option value="none">❔ direction not set</option>') > 0 && BT.indexOf('<option value="type">type of bill</option>') > 0 && BT.indexOf('<option value="direction">inbound / outbound</option>') > 0 && BT.indexOf('<option value="flagged">⚠ price flagged</option>') > 0);
  check('6b: a NexPac bill shows each product with its actual cost and a "↳ commission 12.5%" line under it, plus totals', BL.indexOf("'↳ commission ' + (Number(l.commission_rate) * 100) + '%'") > 0 && BL.indexOf("cr ? 'Actual cost' : 'Amount'") > 0 && BL.indexOf('(spread over the products above)') > 0);
  check('6c: 📏 Price rules: products or services, per unit or fixed, any / one vendor or type, allowed difference, cost vs cost + commission; commission vendors editable',
    PR.indexOf('📏 Price rules — what each product or service should cost') > 0 && PR.indexOf("['unit', 'Price per unit']") > 0 && PR.indexOf("'cost + commission'") > 0 && PR.indexOf('Vendors that bill COST + a commission') > 0 && BT.indexOf('<PriceRulesPanel api={api}') > 0);
  check('6d: validation shows the flags and asks how the price issue was resolved', BT.indexOf('How was the price issue was resolved') < 0 && BT.indexOf('How was the price issue resolved? (required') > 0 && BT.indexOf("'write how the price issue was resolved (10+ characters)'") > 0 && BT.indexOf('price_resolution: validating.price_resolution') > 0);
  check('6e: 📊 Reports: products received (qty, avg cost, cost, commission, billed, paid) and charges by type / vendor / service over the chosen period', RP.indexOf('Qty received') > 0 && RP.indexOf("['service', 'by service']") > 0 && RP.indexOf('REPORT_PERIODS.map') > 0 && BT.indexOf('<BillReportsPanel api={api}') > 0);
  check('6f: "Set price rules" is in the 🏦 Banking & Accounting Access box', R('src/components/BankingAccessPanel.jsx').indexOf("key: 'bills.price_rules'") > 0);
  // ── 7. SQL
  var Q = R('sql/v55-83-RQ-bill-lines-price-rules.sql');
  check('7a: tables for lines / commission rules / price rules; NexPac 12.5% seeded once; the DATABASE locks a validated bill\'s lines and refuses validating a flagged bill without a written resolution; written only by the server',
    Q.indexOf('CREATE TABLE IF NOT EXISTS public.vendor_bill_lines') > 0 && Q.indexOf("SELECT 'NexPac', 0.125") > 0 && Q.indexOf("WHERE NOT EXISTS (SELECT 1 FROM public.bill_commission_rules WHERE lower(vendor_match) = 'nexpac')") > 0 &&
    Q.indexOf("RAISE EXCEPTION 'This bill is validated — reopen its validation to change its lines.'") > 0 && Q.indexOf('write how the price issue was resolved before validating it') > 0 && Q.indexOf('FOR ALL TO authenticated USING (false) WITH CHECK (false)') > 0);

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (savedKey === undefined) { delete process.env.ANTHROPIC_API_KEY; } else { process.env.ANTHROPIC_API_KEY = savedKey; }
  if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
