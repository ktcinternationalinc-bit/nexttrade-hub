// v55.83-ZO — Max, 26 Nov 2026: "returned checks 3964 there should be another part when we deposited in so it should 0 itself out",
// then "yes build". A return a person categorized as a returned check, whose bank text names its deposit (date + amount), nets that
// deposit automatically when exactly one money-in line fits. Nothing is guessed, nothing is saved.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
console.log('ZO — a returned deposit nets itself from the bank\'s own text');
var P = require(path.join(root, 'src/lib/returned-deposit-pairing.js'));
var isRet = function (k) { return k === 'returned_checks'; };
var T1 = 'DEPOSITED ITEM RETURNED Altered/Fictiti099021739 # OF ITEMS00001CK#:0000000100 DEP AMT0000396400 DEP DATE060226CK AMT0000396400';
var T2 = 'DEPOSITED ITEM RETURNED NSF 1st 099004275 # OF ITEMS00001CK#:0000001041 DEP AMT0000800000 DEP DATE082526CK AMT0000450000';
var T3 = 'DEPOSITED ITEM RETURNED NSF 1st 099018069 # OF ITEMS00001CK#:0000000107 DEP AMT DEP DATE010101CK AMT0000250000';
var T4 = 'DEPOSITED ITEM RETURNED       NSF 1st        099002382                                       # OF ITEMS00001CK#:0000000496                                        DEP AMT0003687568     DEP DATE031826CK AMT0003687568';

var p1 = P.parseReturnText(T1);
check('1: the bank text gives the deposit amount, deposit date and check amount', !!p1 && p1.deposit_cents === 396400 && p1.deposit_date === '2026-06-02' && p1.check_cents === 396400, p1);
var p4 = P.parseReturnText(T4);
check('2: the wide-spaced form of the same text reads the same way', !!p4 && p4.deposit_cents === 3687568 && p4.deposit_date === '2026-03-18', p4);
check('3: a return that names no deposit (empty amount, date 010101), other text, or an impossible date → nothing', P.parseReturnText(T3) === null && P.parseReturnText('CHECK # 370') === null && P.parseReturnText('') === null && P.parseReturnText(null) === null && P.parseReturnText('DEPOSITED ITEM RETURNED DEP AMT0000100000 DEP DATE133126CK AMT0000100000') === null && P.parseReturnText('DEPOSITED ITEM RETURNED DEP AMT0000100000 DEP DATE023026CK AMT0000100000') === null);

function L(id, dir, amt, date, name, cls, extra) { return Object.assign({ id: id, direction: dir, amount_abs: amt, date: date, posted_date: date, name: name, classification: cls || null, transfer_group_id: null }, extra || {}); }
// Max's case: the deposit sits under Customer payment, the return under Returned checks
var r = P.pairReturnedDeposits([L('dep', 'in', '3964.00', '2026-06-02', 'DEPOSIT ID NUMBER 862176', 'customer_payment'), L('ret', 'out', '3964.00', '2026-06-03', T1, 'returned_checks'), L('other', 'in', '500.00', '2026-06-02', 'DEPOSIT', 'customer_payment')], isRet);
check('4: Max\'s case — the $3,964 deposit is netted in full against its return', !!r.byDeposit.dep && r.byDeposit.dep.amount === 3964 && r.byDeposit.dep.category === 'returned_checks' && r.byDeposit.dep.return_ids.join() === 'ret' && r.byDeposit.dep.return_date === '2026-06-03' && r.count === 1 && r.total === 3964 && !r.byDeposit.other && r.not_paired.length === 0, r);
r = P.pairReturnedDeposits([L('dep', 'in', '3964.00', '2026-06-02', 'DEPOSIT', 'customer_payment'), L('ret', 'out', '3964.00', '2026-06-03', T1, null)], isRet);
check('5: a return nobody categorized as a returned check pairs NOTHING (a person decides first)', Object.keys(r.byDeposit).length === 0 && r.not_paired.length === 0);
r = P.pairReturnedDeposits([L('d1', 'in', '3964.00', '2026-06-02', 'DEPOSIT A', null), L('d2', 'in', '3964.00', '2026-06-02', 'DEPOSIT B', null), L('ret', 'out', '3964.00', '2026-06-03', T1, 'returned_checks')], isRet);
check('6: two deposits fit → nothing is matched, and it is reported', Object.keys(r.byDeposit).length === 0 && r.not_paired.length === 1 && r.not_paired[0].reason === 'more_than_one_deposit' && r.not_paired[0].deposit_date === '2026-06-02' && r.not_paired[0].deposit_amount === 3964, r);
r = P.pairReturnedDeposits([L('d1', 'in', '3964.01', '2026-06-02', 'DEPOSIT', null), L('d2', 'in', '3964.00', '2026-06-01', 'DEPOSIT', null), L('ret', 'out', '3964.00', '2026-06-03', T1, 'returned_checks')], isRet);
check('7: a cent off or a day off is NOT a match (reported as no deposit found)', Object.keys(r.byDeposit).length === 0 && r.not_paired.length === 1 && r.not_paired[0].reason === 'no_deposit_found');
r = P.pairReturnedDeposits([L('dep', 'in', '8000.00', '2026-08-25', 'DEPOSIT', 'customer_payment'), L('ret', 'out', '4500.00', '2026-08-27', T2, 'returned_checks')], isRet);
check('8: a deposit of several checks, one returned → only the returned $4,500 of the $8,000 is netted', !!r.byDeposit.dep && r.byDeposit.dep.amount === 4500 && r.total === 4500, r);
r = P.pairReturnedDeposits([L('dep', 'in', '8000.00', '2026-08-25', 'DEPOSIT', null), L('r1', 'out', '4500.00', '2026-08-27', T2, 'returned_checks'), L('r2', 'out', '4500.00', '2026-08-28', T2, 'returned_checks')], isRet);
check('9: returns can never net more than the deposit itself (4,500 + 3,500, not 9,000)', r.byDeposit.dep.amount === 8000 && r.byDeposit.dep.return_ids.length === 2 && r.total === 8000, r);
r = P.pairReturnedDeposits([L('dep', 'in', '3964.00', '2026-06-02', 'DEPOSIT', 'returned_checks'), L('ret', 'out', '3964.00', '2026-06-03', T1, 'returned_checks')], isRet);
check('10: a deposit a person already put under Returned checks is left to the old rule (never counted twice)', Object.keys(r.byDeposit).length === 0 && r.not_paired.length === 0 && r.total === 0);
r = P.pairReturnedDeposits([L('dep', 'in', '3964.00', '2026-06-02', 'TRANSFER', 'transfer'), L('dep2', 'in', '3964.00', '2026-06-02', 'X', null, { transfer_group_id: 'g' }), L('dep3', 'in', '3964.00', '2026-06-02', 'RTM', null), L('ret', 'out', '3964.00', '2026-06-03', T1, 'returned_checks')], isRet, function (t) { return t.id === 'dep3'; });
check('11: transfers between own accounts and money back from RTM / NextTrade are never taken as the deposit', Object.keys(r.byDeposit).length === 0 && r.not_paired[0].reason === 'no_deposit_found');
r = P.pairReturnedDeposits([L('dep', 'in', '3964.00', '2026-06-01', 'DEPOSIT', null, { posted_date: '2026-06-02' }), L('ret', 'out', '3964.00', '2026-06-03', T1, 'returned_checks')], isRet);
check('12: the bank date can be the line\'s date or its posted date', !!r.byDeposit.dep);
check('13: empty / missing input never crashes', P.pairReturnedDeposits(null, isRet).count === 0 && P.pairReturnedDeposits([], isRet).total === 0);

var rt = read('src/app/api/accounting/bills/route.js');
check('14 (source): the report asks the shared rule, in-period lines only, and excludes money-back lines', rt.indexOf("import { pairReturnedDeposits } from '../../../../lib/returned-deposit-pairing';") > 0 && rt.indexOf('var autoPair = pairReturnedDeposits(spTx.filter(function (tA) { var dA = tA.posted_date || tA.date; return dA >= pFrom && dA <= pTo; }), isContraCat, function (tS) { return !!moneyBack[tS.id]; });') > 0);
check('15 (source): pairing is decided after money-back is known and before the lines are counted', rt.indexOf('var autoPair = pairReturnedDeposits(') > rt.indexOf('var moneyBack = {};') && rt.indexOf('var autoPair = pairReturnedDeposits(') < rt.indexOf('var ap6 = (!isTrf && !isContraCat(t6.classification))'));
check('16 (source): the matched part comes off Returned checks and is not income; the rest of the deposit carries on', rt.indexOf('byCat[kA].total = r2(byCat[kA].total - amtA); byCat[kA].net = true;') > 0 && rt.indexOf("kind: 'not_pnl', count: 0, total: 0 }; }\r\n              byCatIn[kA].count++".replace('\r\n', rt.indexOf('\r\n') >= 0 ? '\r\n' : '\n')) > 0 && rt.indexOf('amt6 = r2(amt6 - amtA); if (!(amt6 > 0)) { return; }') > 0 && rt.indexOf('var amtA = Math.min(amt6, r2(ap6.amount));') > 0);
check('17 (source): the row says it was matched automatically, and unmatched returns are reported', rt.indexOf("' — matched automatically to the bank return of ' + ap6.return_date") > 0 && rt.indexOf('auto_paired: true') > 0 && rt.indexOf('contra.not_paired = autoPair.not_paired;') > 0 && rt.indexOf('returned_checks: contra,') > 0);
check('18 (source): the old person-categorized rule is untouched', rt.indexOf('var contraIn = !isTrf && isContraCat(t6.classification);') > 0 && rt.indexOf("var contraOut = !isTrf && !fund6 && isContraCat(key6);") > 0);
var lib = read('src/lib/returned-deposit-pairing.js');
check('19 (source): the rule writes nothing and reads no database', !/supabase|\.from\(|fetch\(|\.update\(|\.insert\(/.test(lib));
var page = read('src/app/page.jsx'); var wn = read('src/components/WhatsNewWidget.jsx');
check('20: What\'s New has the ZO entry and the badge names the newest entry on top', wn.indexOf("version: 'v55.83-ZO'") > 0 && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]{2}(?:\.\d+)?)'/.exec(wn); return !!top && page.indexOf('>' + top[1] + '</span>') > 0; })());
console.log('\nZO: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
