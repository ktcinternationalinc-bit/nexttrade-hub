// v55.83-ZL — Warehouse check by WIRE + bill cards CLOSED by default with PASS / FAIL / the real state (Max 26 Nov: "check for a
// specific wire that was built..only looking at those bills related to the wire. Also need it to default to each bill check to be
// closed with a pass or fail showing..user can click on drill down to see what's in it. Like a card broken down in rows.")
// The route part (wire filter, permissions, summary) is in test-v55-83-xb-weight-check-route.js. Run: node __tests__/test-v55-83-zl-wire-cards.js
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
(function () { var id = require.resolve('@supabase/supabase-js'); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = { createClient: function () { return {}; } }; require.cache[id] = m0; })();
var INV = require(path.join(root, 'src/components/WeightCheckInvoices.jsx'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('ZL — warehouse check by wire + closed bill cards');

function prod(outcome, o) { return Object.assign({ item_key: 'k-' + outcome, kind: 'product', outcome: outcome, product_label: 'Leather · Thirds USA', figures: { billed: 1000, received: 1050, diff: 50, unit: 'lb', basis: 'lb' }, bill_ids: ['b1'], bills: [{ id: 'b1', vendor: 'NexPac Corporation', bill_number: '14755' }] }, o || {}); }
function inv(rows, extra) { var g = INV.groupInvoices(rows)[0]; return Object.assign(g, extra || {}); }
var B = [{ id: 'b1', vendor: 'NexPac Corporation', bill_number: '14755' }];
var tests = [
  ['PASS', inv([prod('matched')])],
  ['FAIL', inv([prod('discrepancy', { reasons: ['billed MORE than was scanned'] })])],
  ['NOT CHECKED', inv([{ item_key: 'b:b1|unlinked', kind: 'bill', outcome: 'no_receipt', reasons: ['no warehouse receipt carries this bill’s reference'], bill_ids: ['b1'], bills: B }])],
  ['NOT CHECKED', inv([prod('cannot_compare', { reasons: ['no approved product mapping'] })])],
  ['APPROVED', inv([prod('matched', { state: 'validated' })])],
  ['ACCEPTED', inv([prod('discrepancy', { state: 'accepted' })])],
  ['DISPUTED', inv([prod('discrepancy', { state: 'issue_open' })])],
  ['RECHECK', inv([prod('matched', { state: 'needs_revalidation', needs_decision: true })])],
  ['PROVISIONAL', inv([prod('incomplete', { provisional: true })])],
  ['CONFIRM RECEIPT', inv([prod('matched', { preview: true, proposed_receipt: { receipt_id: '2219' } }), { item_key: 'b:b1|unlinked', kind: 'bill', outcome: 'cannot_compare', needs_link: true, bill_ids: ['b1'], bills: B }])]
];
tests.forEach(function (t) { var cs = INV.cardStatus(t[1]); check('card status: ' + t[0] + (cs.why ? ' — "' + cs.why + '"' : ''), cs.label === t[0], cs); });
check('…an ACCEPTED difference is amber, never green; NOT CHECKED is grey; FAIL / DISPUTED are red; PASS / APPROVED green (solid blocks, black text)', INV.cardStatus(tests[5][1]).bg === '#f59e0b' && INV.cardStatus(tests[2][1]).bg === '#a3a3a3' && INV.cardStatus(tests[1][1]).bg === '#ef4444' && INV.cardStatus(tests[6][1]).bg === '#ef4444' && INV.cardStatus(tests[0][1]).bg === '#22c55e' && INV.cardStatus(tests[4][1]).bg === '#22c55e');
check('…a card mixing a failing product and an uncompared one is FAIL (the failure is never hidden behind "not checked")', INV.cardStatus(inv([prod('discrepancy'), prod('cannot_compare', { item_key: 'k2' })])).label === 'FAIL');
var line = INV.cardLine(tests[0][1]);
check('the closed card says billed vs warehouse in one line: "Leather · Thirds USA: billed 1,000 lb · warehouse 1,050 lb"', /^Leather · Thirds USA: billed 1,000 lb · warehouse 1,050 lb$/.test(line), line);
var many = inv([prod('matched', { item_key: 'a' }), prod('matched', { item_key: 'b', product_label: 'Paper' }), prod('matched', { item_key: 'c', product_label: 'Folds' })]);
check('…with more than two products it shows two and "+1 more"', /\+1 more$/.test(INV.cardLine(many)), INV.cardLine(many));
var t = INV.wireTally([tests[0][1], tests[1][1], tests[2][1], tests[4][1], tests[5][1]]);
// v55.83-ZS: the tally counts by RESULT — an approved pass is PASS, an accepted difference is FAIL (never PASS), not compared is REVIEW
check('the wire tally (by result, ZS): 5 bills → 2 PASS (pass + approved pass) · 2 FAIL (fail + accepted difference) · 1 REVIEW (no receipt) — an accepted difference is never counted as a pass', t.bills === 5 && t.pass === 2 && t.fail === 2 && t.review === 1, t);

var src = fs.readFileSync(path.join(root, 'src/components/WeightCheckInvoices.jsx'), 'utf8');
check('SCREEN: cards are CLOSED by default (openCards starts empty) and a closed card renders only its bar; clicking the bar opens the rows', /var _op = useState\(\{\}\); var openCards = _op\[0\]/.test(src) && /if \(!isOpen\) \{ return <div key=\{inv\.key\}[^\n]*\{bar\}<\/div>; \}/.test(src) && /<BillCardBar inv=\{inv\} wireIds=\{wireIds\} isOpen=\{isOpen\} onToggle=\{function \(\) \{ toggleCard\(inv\.key\); \}\} \/>/.test(src) && /onClick=\{props\.onToggle\} aria-expanded=\{isOpen\}/.test(src));
check('SCREEN: the bar uses the approved look — black, square corners, solid status block with black text, gold bill number', /background: '#000000', color: '#ffffff', border: 'none'/.test(src) && /function zBlock\(bg\) \{ return \{[^}]*background: bg, color: '#000000'[^}]*borderRadius: 2/.test(src) && /color: Z_GOLD/.test(src));
check('SCREEN: a Wire picker ("All bills (by bill date)" or "Wire #n — payee (n bills, status)"); with a wire chosen the dates are not used', /<option value="">All bills \(by bill date\)<\/option>/.test(src) && /'Wire #' \+ w\.seq \+ ' — '/.test(src) && /if \(w\) \{ return wcApi\(\{ action: 'report_preview', wire_id: w, all: true, recheck: !!recheck \}\); \}/.test(src) && /disabled=\{!!wireId\}/.test(src));
check('SCREEN: the wire bar shows the tally and names bills not in the check, with nothing to compare, and outside your access; says plainly when no tolerance is approved', /t\.pass \+ ' PASS'/.test(src) && /Not in the warehouse check \(vendor not selected\)/.test(src) && /Nothing to compare \(no product lines\)/.test(src) && /outside what you may see — not shown, not counted as checked/.test(src) && /No tolerance is approved yet, so only an exact match can PASS/.test(src));
// the way in from the wire
var wp = fs.readFileSync(path.join(root, 'src/components/WirePackagesPanel.jsx'), 'utf8');
var wt = fs.readFileSync(path.join(root, 'src/components/WiresTab.jsx'), 'utf8');
var at = fs.readFileSync(path.join(root, 'src/components/AccountingTab.jsx'), 'utf8');
var bt = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
var pn = fs.readFileSync(path.join(root, 'src/components/WeightCheckPanel.jsx'), 'utf8');
check('FROM THE WIRE: "Bills on this wire" has "🏭 Check these bills against the warehouse" — only for people who may open the Warehouse check — and it sends the wire id', /\{perms\.warehouse && det\.lines\.length \? <button[^\n]*new CustomEvent\('hub-open-warehouse-check', \{ detail: \{ wire_id: P\.id, seq: P\.seq \} \}\)[^\n]*🏭 Check these bills against the warehouse/.test(wp) && /warehouse: boss \|\| \(\(mp\['bills\.view'\] === true \|\| mp\['bills\.manage'\] === true\) && mp\['bills\.weight_check\.view'\] === true\)/.test(wt));
check('…Accounting goes to Bills with that wire (Back returns to the wire) and forgets it when leaving Bills; Bills opens the Warehouse check; the panel shows Invoices for that wire', /window\.addEventListener\('hub-open-warehouse-check', onOpenWc\)/.test(at) && /setWcPreset\(\{ wire_id: d\.wire_id, seq: d\.seq \|\| null, n: Date\.now\(\) \}\); goFrom\('bills'\);/.test(at) && /if \(sub !== 'bills' && wcPreset\) \{ setWcPreset\(null\); \}/.test(at) && /<BillsTab \{\.\.\.props\} warehousePreset=\{wcPreset\}/.test(at) && /if \(wcWire && wcWire\.wire_id && canWeightCheck\) \{ setPanel\('weightcheck'\); \}/.test(bt) && /wirePreset=\{wcWire\}/.test(bt) && /setTab\('invoices'\)/.test(pn) && /<WeightCheckInvoices toast=\{props\.toast\} wirePreset=\{props\.wirePreset \|\| null\} \/>/.test(pn) && /readPreview\(false, flt, wp\.wire_id\)/.test(src));
var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
var topV = (/version: '([^']+)'/.exec(wn.substring(wn.indexOf('BUILD_HISTORY = ['))) || [])[1];
check('badge and What\'s New name the newest entry, and the ZL entry exists', wn.indexOf("version: 'v55.83-ZL'") >= 0 && page.indexOf(topV) >= 0, topV);
console.log('\nZL wire cards: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
