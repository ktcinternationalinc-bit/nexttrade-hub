// v55.83-TQ (Codex QA 17 Nov, P2 #3) — a transaction ENTERED BY HAND and the bank's own copy arriving later. Runs the REAL duplicate
// detection (findDuplicates / twinAutoPicks). Contract:
//   exact same date + amount + in/out on the same account → the sync skips the bank copy whatever its description (static check);
//   a different date → both stay; same description ≤1 day → "likely", different description ≤3 days → "possible"; further apart is
//   not flagged; labelled "Entered by hand" / "Uploaded statement" / "Bank feed"; nothing is removed automatically on a near match;
//   two genuinely different payments from the bank on the same day are not flagged.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var D = require(path.join(root, 'src/lib/duplicate-detect.js'));
var pass = 0, failN = 0;
function check(l, c, x) { if (c) { pass++; } else { failN++; } console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + l + (c ? '' : '  ' + JSON.stringify(x === undefined ? "" : x).substring(0, 600))); }
function tx(id, pid, date, name, o) { return Object.assign({ id: id, plaid_transaction_id: pid, account_id: 'acc-1', date: date, posted_date: date, amount_abs: 1200.5, direction: 'out', iso_currency: 'USD', name: name, review_status: 'unreviewed' }, o || {}); }
function groups(rows) { return D.findDuplicates(rows, {}).groups || D.findDuplicates(rows, {}); }
console.log('TQ — hand entry vs the bank\'s own copy');
check('source labels: hand entry, uploaded statement, bank feed', D.sourceLabel('manual-hand-abc') === 'Entered by hand' && D.sourceLabel('manual-csv-1') === 'Uploaded statement' && D.sourceLabel('plaid-xyz') === 'Bank feed');

var g1 = groups([tx('h', 'manual-hand-1', '2026-11-15', 'Office rent November'), tx('b', 'plaid-77', '2026-11-16', 'Office rent November')]);
var p1 = (g1 || [])[0];
check('Codex repro: hand Nov 15 + bank Nov 16, same description → listed for a person (not "same line")', p1 && (p1.kind === 'likely' || p1.kind === 'possible') && p1.rows.length === 2, g1);
check('…labelled "Entered by hand" and "Bank feed" (was: both "Bank feed")', p1 && p1.rows.map(function (r) { return r.source; }).sort().join('|') === 'Bank feed|Entered by hand', p1 && p1.rows);
check('…and never removed automatically', D.twinAutoPicks(g1 || [], { h: g1 && {}, b: {} }).length === 0);

var g2 = groups([tx('h', 'manual-hand-2', '2026-11-15', 'Office rent November'), tx('b', 'plaid-78', '2026-11-16', 'ACH DEBIT LANDLORD LLC 99821')]);
var p2 = (g2 || [])[0];
check('hand entry + bank copy with a DIFFERENT description, a day apart → "possible", with the reason', p2 && p2.kind === 'possible' && /entered by hand/i.test(p2.why || (p2.rows && '') || ''), g2);
check('…not removed automatically', D.twinAutoPicks(g2 || [], {}).length === 0);

var g3 = groups([tx('b1', 'plaid-80', '2026-11-15', 'ACH DEBIT LANDLORD LLC'), tx('b2', 'plaid-81', '2026-11-15', 'WIRE OUT SUPPLIER ABC')]);
check('two genuinely different bank payments on the same day (different descriptions) → not flagged', !g3 || g3.length === 0, g3);

var g4 = groups([tx('h', 'manual-hand-3', '2026-11-01', 'Office rent November'), tx('b', 'plaid-79', '2026-11-12', 'ACH DEBIT LANDLORD LLC')]);
check('hand entry and a bank line 11 days apart with different text → not flagged', !g4 || g4.length === 0, g4);

var g5 = groups([tx('h', 'manual-hand-5', '2026-11-15', 'Office rent November'), tx('u', 'manual-csv-9', '2026-11-16', 'RENT PAYMENT 4471')]);
var p5 = (g5 || [])[0];
check('Codex 20:45: hand entry + UPLOADED STATEMENT line → explanation names the uploaded statement, never "the bank\'s copy"', p5 && p5.kind === 'possible' && /uploaded statement/i.test(p5.why || '') && !/bank/i.test(p5.why || '') && D.twinAutoPicks(g5, {}).length === 0, p5);
var g6 = groups([tx('h', 'manual-hand-6', '2026-11-15', 'Office rent November'), tx('b', 'plaid-90', '2026-11-16', 'ACH LANDLORD')]);
check('hand entry + bank feed → "possibly the bank\'s copy of the hand entry"', g6 && g6[0] && /bank feed/i.test(g6[0].why) && /bank's copy/.test(g6[0].why), g6);
var AT = fs.readFileSync(path.join(root, 'src/components/AllTransactionsTab.jsx'), 'utf8');
check('the Add-transaction form says what really happens (skipped on the same date; otherwise listed for you; nothing removed on its own)', /the bank’s copy is skipped/.test(AT) && /nothing is removed on its own/.test(AT) && !/the duplicate check keeps one/.test(AT));
var T = fs.readFileSync(path.join(root, 'src/app/api/plaid/transactions/route.js'), 'utf8');
check('exact same date: the sync skips the bank copy — its "already stored" lookup covers manual-% ids, which includes manual-hand-', /\.like\('plaid_transaction_id', 'manual-%'\)/.test(T));
var M = fs.readFileSync(path.join(root, 'src/app/api/accounting/manual-transaction/route.js'), 'utf8');
check('the route comment states the real behaviour (skipped on the exact date; otherwise a "possible" pair for a person)', /SKIPPED at the sync/.test(M) && /nothing is removed automatically on a near match/i.test(M));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
