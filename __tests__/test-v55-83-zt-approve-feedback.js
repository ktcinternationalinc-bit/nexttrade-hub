// v55.83-ZT — Max 27 Nov: "nothing happens when clicked on approved" (Approved on a FAIL bill's opened card). Cause: a FAIL / REVIEW needs a
// note before Approved; the refusal went only to the corner message for 5 seconds, so on the card nothing seemed to happen. Now the
// answer (refusal or "Saved") stays ON the card, the note box says it is required and turns red. Run: node __tests__/test-v55-83-zt-approve-feedback.js
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
(function () { var id = require.resolve('@supabase/supabase-js'); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = { createClient: function () { return {}; } }; require.cache[id] = m0; })();
var INV = require(path.join(root, 'src/components/WeightCheckInvoices.jsx'));
var React = require('react'); var RDS = require('react-dom/server');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('ZT — Approved / Disputed always answer on the card');

var bill = { id: 'b-14756', vendor: 'NexPac Corporation', bill_number: '14756' };
function row(label, outcome) { return { item_key: 'k-' + label, kind: 'product', outcome: outcome, product_label: label, figures: { basis: 'lb', unit: 'lb', billed: 1000, received: 1200, diff: 200 }, bill_ids: [bill.id], bills: [bill], needs_decision: true, outstanding: true, allowed: outcome === 'matched' ? ['validate_match', 'report_issue'] : ['accept_discrepancy', 'report_issue'], comparison_fp: 'fp-' + label, state: 'unreviewed' }; }
var fail = INV.groupInvoices([row('Texas Thirds', 'matched'), row('Texas Third Folds', 'discrepancy')])[0];
(async function () {
  var sent = []; function api(b) { sent.push(b); return Promise.resolve({ ok: true }); } function reload() { return Promise.resolve([]); }
  var r0 = await INV.runInvoiceDecision({ inv: fail, mode: 'approve', reason: '', api: api, reload: reload });
  check('Approved on a FAIL bill with NO note → not saved, nothing sent, and a plain reason: "Not saved: this bill is FAIL — type a note in the box … then press Approved again"', r0.ok === false && r0.wrote === 0 && sent.length === 0 && /^Not saved: this bill is FAIL — type a note in the box \(a few words saying why you approve it anyway\), then press Approved again\.$/.test(r0.error), r0);
  var r1 = await INV.runInvoiceDecision({ inv: fail, mode: 'approve', reason: 'ok', api: api, reload: reload });
  check('…a 2-letter note ("ok") is refused the same way (a few words are needed)', r1.ok === false && sent.length === 0 && /type a note in the box/.test(r1.error), r1);
  var r2 = await INV.runInvoiceDecision({ inv: fail, mode: 'dispute', reason: '', api: api, reload: reload });
  check('Disputed with no note → "Not saved: type what is wrong in the box …", nothing sent', r2.ok === false && sent.length === 0 && /^Not saved: type what is wrong in the box/.test(r2.error), r2);
  var r3 = await INV.runInvoiceDecision({ inv: fail, mode: 'approve', reason: 'folds checked, extra was a bonus', api: api, reload: reload });
  check('…with a note it SAVES: the matching line validated, the FAIL line accepted, both with the note', r3.ok === true && r3.wrote === 2 && sent.map(function (b) { return b.kind; }).join() === 'validate_match,accept_discrepancy' && sent.every(function (b) { return b.reason === 'folds checked, extra was a bonus'; }), [r3, sent]);
  // the message ON the card (rendered)
  var hErr = RDS.renderToStaticMarkup(React.createElement(INV.CardMessage, { msg: { kind: 'err', text: r0.error } }));
  var hOk = RDS.renderToStaticMarkup(React.createElement(INV.CardMessage, { msg: { kind: 'ok', text: 'Saved — ' + r3.message + ' (2 lines).' } }));
  check('RENDERED on the card: a refusal is a red alert "✗ Not saved: this bill is FAIL …"; a save is a green status "✓ Saved — Approved: NexPac Corporation 14756 (2 lines)."', /role="alert"/.test(hErr) && /✗ Not saved: this bill is FAIL/.test(hErr) && /role="status"/.test(hOk) && /✓ Saved — Approved: NexPac Corporation 14756 \(2 lines\)\./.test(hOk) && RDS.renderToStaticMarkup(React.createElement(INV.CardMessage, { msg: null })) === '', [hErr, hOk]);
  var src = fs.readFileSync(path.join(root, 'src/components/WeightCheckInvoices.jsx'), 'utf8');
  check('SCREEN: every Approved / Disputed answer is written to the card (tied to its comparison), to the lasting line above the list, and still to the corner message; an exception is "could not confirm", never "not saved"', /var msgKey = inv\.key; m\.fp = fpk;[\s\S]{0,400}putCardMsg\(msgKey, m\);\n\s*setLastAction\(/.test(src.replace(/\r\n/g, '\n')) && /catch \(eD\) \{ unknown = true; res = \{ ok: false, wrote: 0, error: 'Could not confirm whether this was saved/.test(src) && /say\(props\.toast, m\.text, m\.kind === 'ok' \? 'success' : 'error'\)/.test(src));
  check('SCREEN: the card shows its answer under the buttons, OUTSIDE the buttons\' own condition, but only while it still applies (cardMsgFor)', /\{canDecide && \(perms\.validate \|\| perms\.accept\) && !inv\.approved && !inv\.disputed \? <div[\s\S]*?<\/div> : null\}\n\s*<CardMessage msg=\{cardMsgFor\(cardMsg\[inv\.key\], inv\)\} \/>/.test(src.replace(/\r\n/g, '\n')));
  check('SCREEN: the note box says it is REQUIRED for this FAIL / REVIEW, turns red when it was missing, and Approved shows "Saving…" while it saves', /'Note — REQUIRED to approve this ' \+ cardResult\(inv\)\.label \+ ' \(a few words why\), or to dispute'/.test(src) && /cardMsg\[inv\.key\]\.needNote && String\(reasons\[inv\.key\] \|\| ''\)\.trim\(\)\.length < 5 \? \{ border: '2px solid #ef4444' \}/.test(src) && /\{busy === inv\.key \? 'Saving…' : 'Approved'\}/.test(src));
  check('SCREEN: inside the opened card a difference line says FAIL (as the bar does), not REVIEW; "Why FAIL:" names the card result', /\(r\.outcome === 'discrepancy' \|\| r\.outcome === 'product_missing' \? 'FAIL' : 'REVIEW'\)/.test(src) && /'Why ' \+ cardResult\(inv\)\.label \+ ': '/.test(src));
  var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
  var topV = (/version: '([^']+)'/.exec(wn.substring(wn.indexOf('BUILD_HISTORY = ['))) || [])[1];
  check('badge and What\'s New name the newest entry, and the ZT entry exists', wn.indexOf("version: 'v55.83-ZT'") >= 0 && page.indexOf(topV) >= 0, topV);
  console.log('\nZT approve feedback: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('  ✗ FAIL: crashed ' + (e && e.stack)); process.exit(1); });
