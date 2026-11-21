// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SA — Max, Nov 12 07:27: "Why are people not seeing bills when they have permission"
// (screenshots: the permissions box says "always (admin)" for an admin, and shows Bills ON for staff)
// Cause 1: owner / admin roles have every switch (the box says so, the server agrees) but the Bills screen, the Bills
//          tab button, All Transactions, Categories & Rules and the Audit Trail only checked super admin or an explicit
//          switch → admins without explicit rows saw nothing.
// Cause 2: Bills is a ClickBooks (KTC Hub) screen — with ClickBooks OFF in group 1 the Bills switches did nothing and the
//          box never said so (Wires did).
// Pure source pins + the access function run for real.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var pass = 0, failN = 0;
function check(l, c) { if (c) { pass++; } else { failN++; } console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + l); }
console.log('SA — owners / admins see Bills; the box says Bills needs ClickBooks');
var BT = R('src/components/BillsTab.jsx'); var AT = R('src/components/AccountingTab.jsx'); var WT = R('src/components/WiresTab.jsx');
var TX = R('src/components/AllTransactionsTab.jsx'); var ER = R('src/components/ExpenseRulesTab.jsx'); var BP = R('src/components/BankingAccessPanel.jsx');
check('1 (→UG): Bills screen — only the super admin by role; owner / admin need the switches', /* UG realign (Max, Nov 18: "the admin should not just have access, i need to give him access") */ BT.indexOf('var bossB = isSuperAdmin;') > 0 &&
  BT.indexOf("var canView = bossB || modulePerms['bills.view'] === true") > 0 && BT.indexOf("var canManage = bossB || modulePerms['bills.manage'] === true;") > 0);
check('2: the Bills button in Accounting shows for owner / admin', AT.indexOf("(t[0] !== 'bills' || bossA || mp['bills.view'] === true") > 0);
check('3: All Transactions / Categories & Rules / Audit Trail buttons too', AT.indexOf("(t[0] !== 'categories' || bossA ||") > 0 && AT.indexOf("(t[0] !== 'all_txns' || bossA ||") > 0 && AT.indexOf("(t[0] !== 'audit' || bossA ||") > 0);
check('4 (→UG): …those screens: super admin, or the Categorize switch', /* UG realign (Max, Nov 18: "the admin should not just have access, i need to give him access") */ TX.indexOf("var canUse = isSuperAdmin || modulePerms['bank.classify'] === true;") > 0 &&
  ER.indexOf("var canUse = isSuperAdmin || modulePerms['bank.classify'] === true;") > 0);
check('5: validating a bill from the wire screen — owner / admin too', WT.indexOf("bills: boss || mp['bills.manage'] === true,") > 0);
var bIdx = BP.indexOf("{ title: '4 · Bills (what we owe)'"); var billsSrc = BP.substring(bIdx, BP.indexOf("{ title: '5 · Wires'"));
check('6: the permissions box: Bills says it needs ClickBooks, and each Bills switch warns when ClickBooks is OFF', billsSrc.indexOf("note: 'Needs ClickBooks (KTC Hub) in group 1.'") > 0 && (billsSrc.split(String.fromCharCode(10)).filter(function (ln) { return ln.indexOf('bills.weight_check.') < 0; }).join(String.fromCharCode(10)).match(/needsKtc: true/g) || []).length === 3 /* XB pin: the 5 warehouse-check switches are counted apart, each needs ClickBooks too */ && billsSrc.split(String.fromCharCode(10)).filter(function (ln) { return ln.indexOf("key: 'bills.weight_check.") >= 0 && ln.indexOf('needsKtc: true') > 0; }).length === 5 && BP.indexOf("warn = 'Not working yet — turn on ClickBooks (KTC Hub) in group 1.'") > 0);
var A = require(path.join(root, 'src/lib/accounting-access.js'));
check('7 (→UG): admin needs the ClickBooks switch like staff; staff need the ClickBooks switch', /* UG realign (Max, Nov 18: "the admin should not just have access, i need to give him access") */ A.acctAccess(false, {}, 'admin').ktc === false && A.acctAccess(false, { 'accounting.clickbooks.access': true }, 'admin').ktc === true && A.acctAccess(false, { 'bills.view': true }, 'staff').ktc === false && A.acctAccess(false, { 'accounting.clickbooks.access': true }, 'staff').ktc === true && A.screenHub('bills') === 'ktc');
// "Not just admin." (Max 07:29) — staff with the switches ON: switches were read once at sign-in; and a failed load looked like "no bills"
var PG = R('src/app/page.jsx');
check('8: a person’s switches are re-read when the Hub comes to the front and every 2 minutes (no sign-out needed)', PG.indexOf("window.addEventListener('focus', refresh)") > 0 && PG.indexOf('setInterval(refresh, 120000)') > 0 && PG.indexOf("from('module_permissions').select('module_name, has_access').eq('user_id', uid)") > 0);
check('9: if the bills list fails to load, the reason stays ON the screen with Try again (not an empty list)', BT.indexOf("'⛔ The bills did not load: ' + loadErr") > 0 && BT.indexOf("setLoadErr((j && j.error) || 'Could not load bills.')") > 0);
check('10: the box says when a change reaches the person', BP.indexOf('A change reaches the person within about 2 minutes') > 0);
console.log('\n' + pass + ' passed, ' + failN + ' failed'); if (failN) { process.exit(1); }
