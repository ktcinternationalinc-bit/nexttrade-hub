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
  // v55.83-ZU (Max 27 Nov: "if all approved the entire grouping should get a passing status … PASSING - REVIEWED")
  ['an approved pass (every line reviewed)', inv([prod('A', 'matched', { state: 'validated' })]), 'PASS — REVIEWED'],
  ['an ACCEPTED difference (every line reviewed; the difference stays tagged)', inv([prod('A', 'discrepancy', { state: 'accepted' })]), 'PASS — REVIEWED + DIFFERENCE ACCEPTED'],
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
check('the wire tally counts by RESULT (ZU): 5 bills → 3 PASS (14657 + approved + reviewed-and-accepted) · 1 FAIL · 1 REVIEW', t.bills === 5 && t.pass === 3 && t.fail === 1 && t.review === 1, t);
var src = fs.readFileSync(path.join(root, 'src/components/WeightCheckInvoices.jsx'), 'utf8');
check('SCREEN: the bar shows the RESULT block first, then each state as a smaller outlined tag beside it', /var cs = cardResult\(inv\); var tags = cardTags\(inv\);/.test(src) && /<span style=\{zBlock\(cs\.bg\)\}>\{cs\.label\}<\/span>\{tags\.map\(function \(tg\) \{ return <span key=\{tg\.key\} style=\{zTag\(tg\.color\)\}>\{tg\.label\}<\/span>; \}\)\}/.test(src) && /function zTag\(color\) \{ return \{[^}]*background: '#000000', color: color, border: '1px solid ' \+ color/.test(src));
check('SCREEN: the wire bar counts PASS · FAIL · REVIEW', /t\.pass \+ ' PASS'/.test(src) && /t\.fail \+ ' FAIL'/.test(src) && /t\.review \+ ' REVIEW'/.test(src) && !/NOT CHECKED'\}<\/span>/.test(src));
// ---- Codex 27 Nov (ZS hold): the RENDERED wire summary must show what is still waiting, not only PASS / FAIL / REVIEW
var React = require('react'); var RDS = require('react-dom/server');
function wireHtml(invs, ids) { return RDS.renderToStaticMarkup(React.createElement(INV.WireSummaryBar, { wire: { seq: 77, payee: 'NexPac Corporation', status: 'needs_check', bills_on_wire: ids.length, bill_ids: ids, out_of_scope: [], no_lines: [], hidden_count: 0 }, invoices: invs, tol: { pct: 15 } })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/&#x27;/g, "'"); }
function barHtml(i, ids) { return RDS.renderToStaticMarkup(React.createElement(INV.BillCardBar, { inv: i, wireIds: ids, isOpen: false, onToggle: function () {} })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); }
var hPrev = wireHtml([b14657], ['b1']);
check('RENDERED wire summary, preview only (bill 14657): "1 PASS" is labelled as a comparison result incl. unconfirmed receipts, AND "1 to CONFIRM RECEIPT" is shown as waiting', /COMPARISON RESULTS \(incl\. receipts not yet confirmed\): 1 PASS 0 FAIL 0 REVIEW/.test(hPrev) && /WAITING ON THIS WIRE: 1 to CONFIRM RECEIPT/.test(hPrev) && !/every result above is final/.test(hPrev), hPrev);
var hDisp = wireHtml([inv([prod('A', 'matched', { state: 'issue_open' })])], ['b1']);
check('RENDERED: a matching but DISPUTED bill → "1 PASS" and "1 DISPUTED" waiting (the match is not turned into a failure)', /1 PASS 0 FAIL 0 REVIEW/.test(hDisp) && /WAITING ON THIS WIRE: 1 DISPUTED/.test(hDisp), hDisp);
var hRe = wireHtml([inv([prod('A', 'matched', { state: 'needs_revalidation', needs_decision: true })])], ['b1']);
check('RENDERED: a matching bill that NEEDS REVALIDATION → "1 PASS" and "1 to RECHECK" waiting', /1 PASS 0 FAIL 0 REVIEW/.test(hRe) && /WAITING ON THIS WIRE: 1 to RECHECK/.test(hRe), hRe);
var B2 = [{ id: 'b1', vendor: 'NexPac Corporation', bill_number: '14657' }, { id: 'b2', vendor: 'NexPac Corporation', bill_number: '14700' }];
var shared = inv([prod('A', 'matched', { preview: true, bill_ids: ['b1', 'b2'], bills: B2 }), { item_key: 'b:b1|unlinked', kind: 'bill', outcome: 'cannot_compare', needs_link: true, bill_ids: ['b1', 'b2'], bills: B2 }]);
var hSh = wireHtml([shared], ['b1']); var barSh = barHtml(shared, ['b1']);
check('RENDERED: a receipt-shared group (one bill on this wire, one not), preview → counts ONE bill: "1 PASS", "1 to CONFIRM RECEIPT"; its card marks the other bill "(not on this wire)"', /1 bill on this wire/.test(hSh) && /1 PASS 0 FAIL 0 REVIEW/.test(hSh) && /1 to CONFIRM RECEIPT/.test(hSh) && /Bill 14700 \(not on this wire\)/.test(barSh) && /^ ?PASS CONFIRM RECEIPT /.test(barSh), [hSh, barSh]);
var hDone = wireHtml([inv([prod('A', 'matched', { state: 'validated' })]), inv([prod('B', 'discrepancy', { state: 'accepted', bill_ids: ['b3'], bills: [{ id: 'b3', vendor: 'NexPac Corporation', bill_number: '14800' }] })])], ['b1', 'b3']);
check('RENDERED: every bill compared, decided and visible → "nothing waiting — every bill on this wire was compared and decided" and "decided: 1 approved · 1 accepted (a difference)"; both reviewed bills PASS (ZU)', /2 PASS 0 FAIL 0 REVIEW/.test(hDone) && /nothing waiting — every bill on this wire was compared and decided/.test(hDone) && /decided: 1 approved · 1 accepted \(a difference\)/.test(hDone), hDone);
// ---- Codex 27 Nov (ZS rev3): never "nothing waiting" while work is open, not compared, or not visible
function notFinal(h) { return !/nothing waiting/.test(h); }
var hUnrev = wireHtml([inv([prod('A', 'matched', { state: 'unreviewed', needs_decision: true, outstanding: true })])], ['b1']);
check('RENDERED (Codex case 1): a matching but UNREVIEWED bill → "1 PASS" and "1 to DECIDE (approve or dispute)" — not final', /1 PASS 0 FAIL 0 REVIEW/.test(hUnrev) && /WAITING ON THIS WIRE: 1 to DECIDE \(approve or dispute\)/.test(hUnrev) && notFinal(hUnrev), hUnrev);
var hUnav = wireHtml([inv([{ item_key: 'g|unavailable', kind: 'group', outcome: 'warehouse_unavailable', reasons: ['the warehouse has not been read'], bill_ids: ['b1'], bills: B, outstanding: true, state: 'not_checked' }])], ['b1']);
check('RENDERED (Codex case 2): warehouse unavailable → "1 REVIEW" and "1 REVIEW — not compared yet" waiting — not final', /0 PASS 0 FAIL 1 REVIEW/.test(hUnav) && /1 REVIEW — not compared yet/.test(hUnav) && notFinal(hUnav), hUnav);
var hNoRec = wireHtml([inv([{ item_key: 'b:b1|unlinked', kind: 'bill', outcome: 'no_receipt', reasons: ['no warehouse receipt'], bill_ids: ['b1'], bills: B, outstanding: true, needs_decision: true }])], ['b1']);
check('RENDERED: no warehouse receipt → REVIEW, waiting "to DECIDE" and "not compared yet" — not final', /1 REVIEW/.test(hNoRec) && /1 to DECIDE/.test(hNoRec) && /1 REVIEW — not compared yet/.test(hNoRec) && notFinal(hNoRec), hNoRec);
var hReop = wireHtml([inv([prod('A', 'matched', { state: 'reopened', needs_decision: true, outstanding: true })])], ['b1']);
check('RENDERED: a REOPENED decision → "1 to DECIDE" — not final', /1 to DECIDE/.test(hReop) && notFinal(hReop), hReop);
var hHid = RDS.renderToStaticMarkup(React.createElement(INV.WireSummaryBar, { wire: { seq: 78, payee: 'NexPac Corporation', status: 'needs_check', bills_on_wire: 3, bill_ids: ['b1'], out_of_scope: [], no_lines: [], hidden_count: 2 }, invoices: [inv([prod('A', 'matched', { state: 'validated' })])], tol: { pct: 15 } })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
check('RENDERED: one decided bill but 2 more on the wire OUTSIDE your access → "2 outside your access (not counted)" — not final', /2 outside your access \(not counted\)/.test(hHid) && notFinal(hHid), hHid);
var hNone = RDS.renderToStaticMarkup(React.createElement(INV.WireSummaryBar, { wire: { seq: 79, payee: 'NexPac Corporation', status: 'needs_check', bills_on_wire: 2, bill_ids: [], out_of_scope: [{ bill_id: 'x', vendor: 'Acme Trucking LLC', bill_number: '9' }], no_lines: [], hidden_count: 1 }, invoices: [], tol: { pct: 15 } })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
check('RENDERED: NO visible bills to check (1 hidden, 1 not in the check) → "0 PASS 0 FAIL 0 REVIEW", waiting names both — never final', /0 PASS 0 FAIL 0 REVIEW/.test(hNone) && /1 outside your access/.test(hNone) && /1 not in the check \(see below\)/.test(hNone) && notFinal(hNone), hNone);
check('…the preview cases above still read the same (14657: "1 to CONFIRM RECEIPT", not final)', /1 to CONFIRM RECEIPT/.test(hPrev) && notFinal(hPrev));
// REVIEW for the states that are neither pass nor fail
var revs = [
  ['limited access', { item_key: 'g|limited', kind: 'group', outcome: 'limited_access', reasons: ['part of this group is a bill outside your access'], bill_ids: ['b1'], bills: B }],
  ['warehouse unavailable', { item_key: 'g|unavailable', kind: 'group', outcome: 'warehouse_unavailable', reasons: ['the warehouse has not been read'], bill_ids: ['b1'], bills: B }],
  ['mapping conflict', prod('A', 'mapping_conflict', { reasons: ['mapping conflict'] })],
  ['no product compared (only an unmapped line)', { item_key: 'b1|line', kind: 'line', outcome: 'cannot_compare', reasons: ['no approved product mapping'], bill_ids: ['b1'], bills: B, figures: null }]
];
revs.forEach(function (rv) { var i = inv([rv[1]]); check('REVIEW (never PASS / FAIL) for ' + rv[0] + ' — with its reason; the rendered bar starts "REVIEW"', INV.cardResult(i).label === 'REVIEW' && !!INV.cardResult(i).why && /^ ?REVIEW /.test(barHtml(i, null)), [INV.cardResult(i), barHtml(i, null)]); });
var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
var topV = (/version: '([^']+)'/.exec(wn.substring(wn.indexOf('BUILD_HISTORY = ['))) || [])[1];
check('badge and What\'s New name the newest entry, and the ZS entry exists', wn.indexOf("version: 'v55.83-ZS'") >= 0 && page.indexOf(topV) >= 0, topV);
console.log('\nZS card result: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
