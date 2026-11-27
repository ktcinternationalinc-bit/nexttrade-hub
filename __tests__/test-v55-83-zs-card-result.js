// v55.83-ZS — the closed bill card shows the comparison RESULT first (Max 27 Nov: "if something is full passing then there should be a
// status of Pass or Fail or Review in the top layer near confirm receipt..."). Bill 14657 showed only "CONFIRM RECEIPT" while every
// line inside was "PASS — within tolerance". Run: node __tests__/test-v55-83-zs-card-result.js
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
(function () { var id = require.resolve('@supabase/supabase-js'); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = { createClient: function () { return {}; } }; require.cache[id] = m0; })();
var INV = require(path.join(root, 'src/components/WeightCheckInvoices.jsx'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('ZS — result first, state as a second tag');

var B = [{ id: 'b1', vendor: 'NexPac Corporation', bill_number: '14657' }];
function prod(label, outcome, o) { return Object.assign({ item_key: 'k-' + label, kind: 'product', outcome: outcome, product_label: label, figures: { billed: 1000, received: 1090, diff: 90, unit: 'lb', basis: 'lb' }, bill_ids: ['b1'], bills: B }, o || {}); }
function inv(rows) { return INV.groupInvoices(rows)[0]; }
function show(i) { var r = INV.cardResult(i); return r.label + (INV.cardTags(i).length ? ' + ' + INV.cardTags(i).map(function (t) { return t.label; }).join(' + ') : ''); }
// Max's bill 14657: four products, every one within tolerance, receipt matched by reference and not yet confirmed (a preview)
var b14657 = inv([prod('Seconds Canada', 'matched', { preview: true, proposed_receipt: { receipt_id: '2190' } }), prod('Thirds Canada', 'matched', { preview: true }), prod('Boat Decking', 'matched', { preview: true }), prod('Paper Canada', 'matched', { preview: true }),
  { item_key: 'b:b1|unlinked', kind: 'bill', outcome: 'cannot_compare', needs_link: true, bill_ids: ['b1'], bills: B }]);
check('BILL 14657 (every line PASS — within tolerance, receipt not confirmed yet) reads "PASS + CONFIRM RECEIPT" — the result first', show(b14657) === 'PASS + CONFIRM RECEIPT' && INV.cardResult(b14657).bg === '#22c55e', show(b14657));
var cases = [
  ['a plain pass', inv([prod('A', 'matched')]), 'PASS'],
  ['a difference outside the tolerance', inv([prod('A', 'discrepancy')]), 'FAIL'],
  ['billed more than scanned', inv([prod('A', 'discrepancy', { reasons: ['billed MORE than was scanned'] })]), 'FAIL'],
  ['an approved pass', inv([prod('A', 'matched', { state: 'validated' })]), 'PASS + APPROVED'],
  ['an ACCEPTED difference (never a pass)', inv([prod('A', 'discrepancy', { state: 'accepted' })]), 'FAIL + ACCEPTED'],
  ['a disputed difference', inv([prod('A', 'discrepancy', { state: 'issue_open' })]), 'FAIL + DISPUTED'],
  ['figures changed after approval', inv([prod('A', 'matched', { state: 'needs_revalidation', needs_decision: true })]), 'PASS + RECHECK'],
  ['a draft warehouse receipt', inv([prod('A', 'incomplete', { provisional: true })]), 'REVIEW + PROVISIONAL'],
  ['no warehouse receipt yet', inv([{ item_key: 'b:b1|unlinked', kind: 'bill', outcome: 'no_receipt', reasons: ['no warehouse receipt carries this bill’s reference'], bill_ids: ['b1'], bills: B }]), 'REVIEW'],
  ['a product with no mapping', inv([prod('A', 'cannot_compare', { reasons: ['no approved product mapping'] })]), 'REVIEW'],
  ['a failing preview (receipt not confirmed)', inv([prod('A', 'discrepancy', { preview: true }), { item_key: 'b:b1|unlinked', kind: 'bill', outcome: 'cannot_compare', needs_link: true, bill_ids: ['b1'], bills: B }]), 'FAIL + CONFIRM RECEIPT']
];
cases.forEach(function (c) { check(c[0] + ' → "' + c[2] + '"', show(c[1]) === c[2], show(c[1])); });
check('REVIEW is amber and says why (e.g. no receipt, a draft); FAIL is red; the second tags are outlined, never a solid result block', INV.cardResult(cases[8][1]).bg === '#f59e0b' && /no warehouse receipt/.test(INV.cardResult(cases[8][1]).why) && /draft/.test(INV.cardResult(cases[7][1]).why) && INV.cardResult(cases[1][1]).bg === '#ef4444');
var t = INV.wireTally([b14657, cases[1][1], cases[4][1], cases[8][1], cases[3][1]]);
check('the wire tally counts by RESULT: 5 bills → 2 PASS (14657 + approved) · 2 FAIL (fail + accepted) · 1 REVIEW', t.bills === 5 && t.pass === 2 && t.fail === 2 && t.review === 1, t);
var src = fs.readFileSync(path.join(root, 'src/components/WeightCheckInvoices.jsx'), 'utf8');
check('SCREEN: the bar shows the RESULT block first, then each state as a smaller outlined tag beside it', /var cs = cardResult\(inv\); var tags = cardTags\(inv\);/.test(src) && /<span style=\{zBlock\(cs\.bg\)\}>\{cs\.label\}<\/span>\{tags\.map\(function \(tg\) \{ return <span key=\{tg\.key\} style=\{zTag\(tg\.color\)\}>\{tg\.label\}<\/span>; \}\)\}/.test(src) && /function zTag\(color\) \{ return \{[^}]*background: '#000000', color: color, border: '1px solid ' \+ color/.test(src));
check('SCREEN: the wire bar counts PASS · FAIL · REVIEW', /t\.pass \+ ' PASS'/.test(src) && /t\.fail \+ ' FAIL'/.test(src) && /t\.review \+ ' REVIEW'/.test(src) && !/NOT CHECKED'\}<\/span>/.test(src));
var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
var topV = (/version: '([^']+)'/.exec(wn.substring(wn.indexOf('BUILD_HISTORY = ['))) || [])[1];
check('badge and What\'s New name the newest entry, and the ZS entry exists', wn.indexOf("version: 'v55.83-ZS'") >= 0 && page.indexOf(topV) >= 0, topV);
console.log('\nZS card result: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
