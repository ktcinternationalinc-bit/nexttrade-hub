// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RM — Max, Nov 9 12:41 / 12:49: "When I select the bills for the
// wires. Does it match those bills to the wire in the transaction pages" ·
// "We should always click on the wire transactions. Wires and see the bills
// associated to it and history."
// (The pop-up was also clicked through in a simulated browser in the session.)
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs'); var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); } }
console.log('RM — a wire bank line opens its bills, approvals and history');
var E = R('src/app/api/accounting/expense-rules/route.js'); var T = R('src/components/AllTransactionsTab.jsx'); var Q = R('src/components/WireQuickView.jsx'); var W = R('src/components/WiresTab.jsx');
ok('1: All Transactions knows which bank line IS an approved wire (WP-…), straight from the wires table', E.indexOf("db.from('wire_packages').select('id, seq, status, payee_name, bank_transaction_id').in('bank_transaction_id'") > 0 && E.indexOf("kind: 'package', id: w9.id, label: 'WP-'") > 0);
ok('2: …and flags a money-out that paid bills like a wire WITHOUT an approved wire', E.indexOf("billLegsBy[t7.id] > 0") > 0 && E.indexOf("{ kind: 'bank', id: t7.id }") > 0 && E.indexOf('billLegsBy[p8.bank_transaction_id] = (billLegsBy[p8.bank_transaction_id] || 0) + 1;') > 0);
ok('3: the line shows a clickable “📤 WP-0001” (or “🏦 wire · no approval”) chip that opens the wire', T.indexOf("'📤 ' + t.wire.label") > 0 && T.indexOf("'🏦 wire · no approval'") > 0 && T.indexOf('setWireView(t.wire)') > 0 && T.indexOf('<WireQuickView wire={wireView}') > 0);
ok('4: the pop-up shows who prepared / signed (1st, 2nd) / sent / attached / undid it, the AI review, overrides with reasons',
  ['Prepared:', '✍ 1st signature:', '✍ 2nd signature:', '📤 Sent:', '🔗 Bank line attached:', '↩ Undone:', '🤖 AI review:', 'Overridden problems (who approved, why)'].every(function (k) { return Q.indexOf(k) > 0; }));
ok('5: …every bill with its data (vendor, bill #, in/out, release #, reference, date, category, total, this wire, notes), the full history and the proofs',
  ['Bill #', 'In / Out', 'Release #', 'Reference', 'Bill date', 'Category', 'Bill total', 'This wire', 'Notes', '🧾 History — every step, who and when', 'Proofs'].every(function (k) { return Q.indexOf(k) > 0; }));
ok('6: a line without an approved wire says so plainly and still lists its bills', Q.indexOf('This money went out WITHOUT a wire approved in advance') > 0 && Q.indexOf("action: 'detail', bank_transaction_id: w.id") > 0);
ok('7: in 🏦 Wires → “Already in the bank”, a line that IS an approved wire opens that wire', W.indexOf("if (w.package) { setQuick({ kind: 'package', id: w.package.id, label: w.package.label }); }") > 0);
ok('8: read-only, dark-skin safe, errors shown (never a blank pop-up)', Q.indexOf('nt-paper') > 0 && Q.indexOf('The server did not answer (HTTP ') > 0 && Q.indexOf("action: 'signoff'") < 0);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
