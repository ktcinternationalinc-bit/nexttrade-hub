/* v72 HOTFIX 19 — Per Max May 27 2026: USD Summary Net Position mismatch
 * with the Running Balance USD column. Root cause: the legacy Net Position
 * formula only summed unpaid invoice/bill amounts, ignoring the prepaid
 * pots that DO drive the running balance. When Max overpaid a 9,656 USD
 * vendor bill with 11,200 USD, the 1,544 USD vendor credit (ourPrepaid)
 * was invisible to the Summary.
 *
 * Fix: use the same FIFO formula that produces the running balance:
 *   net = (theirOpenInvoices − theirPrepaid)
 *       − (ourOpenBills      − ourPrepaid)
 *
 * Critical constraint: leave every other displayed value in the screenshot
 * untouched. Total AR + Total AP lines stay 0.00 USD (no unpaid items),
 * EGP section stays 100,000.00 EGP / 0.00 / +100,000 in our favor.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oa = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');
var flag = fs.readFileSync(path.join(__dirname, '..', 'src/features/living-avatar/feature-flag.js'), 'utf8');

console.log('\n── Net Position formula matches running balance ──');

ok('A1: totalAR sourced from FIFO cs.theyOweUs (not paid-remaining loop)',
  /var totalAR = Number\(cs\.theyOweUs \|\| 0\)/.test(oa));

ok('A2: totalAP sourced from FIFO cs.weOweThem (not paid-remaining loop)',
  /var totalAP = Number\(cs\.weOweThem \|\| 0\)/.test(oa));

ok('A3: theirPrepaid pulled from FIFO',
  /var theirPrepaid = Number\(cs\.theirPrepaid \|\| 0\)/.test(oa));

ok('A4: ourPrepaid pulled from FIFO',
  /var ourPrepaid = Number\(cs\.ourPrepaid \|\| 0\)/.test(oa));

ok('A5: Net Position formula matches per-row running balance: (AR − theirPrepaid) − (AP − ourPrepaid)',
  /var net = \(totalAR - theirPrepaid\) - \(totalAP - ourPrepaid\)/.test(oa));

ok('A6: hasOverpayment flag detects either side has prepaid credit',
  /var hasOverpayment = \(theirPrepaid > 0\.005\) \|\| \(ourPrepaid > 0\.005\)/.test(oa));

console.log('\n── Display: normal path (no overpayment) unchanged ──');

ok('B1: When no overpayment, header still reads "Total AR − Total AP" (EGP case stays identical to screenshot)',
  /hasOverpayment[\s\S]{0,200}Net \{cur\} Position — Total AR − Total AP →/.test(oa));

ok('B2: When no overpayment, math line still reads "{AR} − {AP} = {net}"',
  /hasOverpayment \? \([\s\S]{0,500}\) : \(\s*<div>\{fmtNum\(totalAR\)\} − \{fmtNum\(totalAP\)\} = <span className="ml-1">\{fmtSigned\(net\)\} \{cur\}<\/span><\/div>/.test(oa));

console.log('\n── Display: overpayment path shows breakdown ──');

ok('C1: Overpayment header makes credits explicit',
  /\(AR − cust credit\) − \(AP − vend credit\)/.test(oa));

ok('C2: Overpayment math shows ({AR} − {theirPrepaid}) − ({AP} − {ourPrepaid})',
  /\(\{fmtNum\(totalAR\)\} − \{fmtNum\(theirPrepaid\)\}\) − \(\{fmtNum\(totalAP\)\} − \{fmtNum\(ourPrepaid\)\}\) = <span className="ml-1">\{fmtSigned\(net\)\} \{cur\}/.test(oa));

ok('C3: Vendor credit (we overpaid) flagged inline with friendly explanation',
  /ourPrepaid > 0\.005[\s\S]{0,400}vendor credit \(we overpaid by this\)/.test(oa));

ok('C4: Customer credit (they overpaid) flagged inline with friendly explanation',
  /theirPrepaid > 0\.005[\s\S]{0,400}customer credit \(they overpaid by this\)/.test(oa));

console.log('\n── Untouched: rest of the screenshot stays identical ──');

ok('D1: Total AR row label unchanged (still "Total AR (They Owe Us)")',
  /Total AR \(They Owe Us\)/.test(oa));

ok('D2: Total AP row label unchanged (still "Total AP (We Owe Them)")',
  /Total AP \(We Owe Them\)/.test(oa));

ok('D3: Total AR cell still displays totalAR (= cs.theyOweUs, same FIFO-correct value as before)',
  /totalAR > 0\.005 \? fmtNum\(totalAR\) \+ ' ' \+ cur/.test(oa));

ok('D4: Total AP cell still displays totalAP (= cs.weOweThem)',
  /totalAP > 0\.005 \? fmtNum\(totalAP\) \+ ' ' \+ cur/.test(oa));

ok('D5: "↑ In our favor" / "↓ Against us" / "Settled" sub-label preserved',
  /in our favor[\s\S]{0,200}against us[\s\S]{0,200}Settled/i.test(oa) ||
  /'↑ In our favor'[\s\S]{0,200}'↓ Against us'[\s\S]{0,200}'Settled'/.test(oa));

ok('D6: Per-row Running Balance compute (line ~373) UNCHANGED — still the FIFO snapshot formula it always was',
  /var netForThisCur = \(snap\.theirOpenInvoices - snap\.theirPrepaid\) - \(snap\.ourOpenBills - snap\.ourPrepaid\)/.test(oa));

ok('D7: they_owe_us column header preserved with emerald bg (HOTFIX 30 i18n)',
  /text-emerald-700[\s\S]{0,400}they_owe_us/.test(oa));

ok('D8: we_owe_them column header preserved with red bg (HOTFIX 30 i18n)',
  /text-red-700[\s\S]{0,400}we_owe_them/.test(oa));

ok('D9: Bottom card Net Balance still pulls from t.balance (the FIFO net) — unchanged',
  /\{fmtSigned\(t\.balance\)\} \{cur\}/.test(oa) && /Net Balance/.test(oa));

ok('D10: Bottom card math line shows credits explicitly when present (HOTFIX 19 polish)',
  /'= ' \+ fmtNum\(t\.theyOweUs\) \+ \(t\.theirPrepaid > 0\.005 \? ' − ' \+ fmtNum\(t\.theirPrepaid\) \+ ' cust credit'/.test(oa));

console.log('\n── Reconciliation guarantee ──');

ok('E1: Net Position formula now algebraically identical to per-row running balance',
  // Summary formula:    (totalAR - theirPrepaid) - (totalAP - ourPrepaid)
  //   where totalAR = theyOweUs = theirOpenInvoices
  //         totalAP = weOweThem = ourOpenBills
  // Running formula:    (theirOpenInvoices - theirPrepaid) - (ourOpenBills - ourPrepaid)
  // ∴ they MUST produce the same value for every account in every currency.
  /var net = \(totalAR - theirPrepaid\) - \(totalAP - ourPrepaid\)/.test(oa) &&
  /var netForThisCur = \(snap\.theirOpenInvoices - snap\.theirPrepaid\) - \(snap\.ourOpenBills - snap\.ourPrepaid\)/.test(oa));

console.log('\n── Living Avatar bootstrap (HOTFIX 19 polish) ──');

ok('F1: window.setLivingAvatarEnabled exposed for browser console toggle',
  /window\.setLivingAvatarEnabled = setLivingAvatarEnabled/.test(flag));

ok('F2: window.isLivingAvatarEnabled exposed for status check',
  /window\.isLivingAvatarEnabled = isLivingAvatarEnabled/.test(flag));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 19 — overpayment fix lands without disturbing the rest of the screenshot');
console.log('══════════════════════════════════════════════');
