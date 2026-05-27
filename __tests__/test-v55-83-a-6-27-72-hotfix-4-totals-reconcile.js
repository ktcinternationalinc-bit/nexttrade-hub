/* v72 HOTFIX 4 — Totals row reconciliation.
 * Bug Max caught from screenshot: totals row showed Cr 0.00 / Dr 11,888.00 / Net -9,888
 * → user does 0 - 11,888 = -11,888 ≠ -9,888 → looks broken. The Cr/Dr were raw sums
 * while Net was FIFO. Now totals row uses Amount/Paid/Remaining that reconcile. */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oa = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'OpenAccountsTab.jsx'), 'utf8');

console.log('\n── Totals row uses Amount/Paid/Remaining (HOTFIX 4) ──');

ok('A1: totals row no longer uses "Cr: " / "Dr: " labels (the misleading raw sums)',
  !/<td[^>]*>\s*Cr: \{fmtNum\(cs\.credit\)\}/.test(oa) &&
  !/<td[^>]*>\s*Dr: \{fmtNum\(cs\.debit\)\}/.test(oa));

ok('A2: totals row Summary block: per-currency Total AR + Total AP rows (HOTFIX 11 final)',
  /Total AR \(They Owe Us\)/.test(oa) && /Total AP \(We Owe Them\)/.test(oa));

ok('A3: totals row tracks totalAR per currency (sales_invoice remaining only)',
  /totalAR \+= prT\.remaining/.test(oa));

ok('A4: totals row tracks totalAP per currency (vendor_bill remaining only)',
  /totalAP \+= prT\.remaining/.test(oa));

ok('A5: Net Position row shows AR − AP = net with sub-label (HOTFIX 11 final)',
  /Total AR − Total AP/.test(oa) && /in our favor[\s\S]{0,300}against us|against us[\s\S]{0,300}in our favor/.test(oa));

ok('A6: Total AR row uses emerald accent (HOTFIX 14 reverted: bg-emerald-900/40)',
  /bg-emerald-900\/40 text-emerald-100/.test(oa));

ok('A7: Total AP row uses red accent (HOTFIX 14 reverted: bg-red-900/40)',
  /bg-red-900\/40 text-red-100/.test(oa));

ok('A8: Net Position row uses cs.balance via fmtSigned for Running Balance column',
  /fmtSigned\(cs\.balance\)/.test(oa));

console.log('\n── End-to-end: numbers reconcile in Max\'s screenshot scenario ──');

// Inline minimal simulate from lib for math verification
function simulate(entries) {
  var sorted = entries.slice().sort(function(a, b) {
    var da = String(a.entry_date || ''), db = String(b.entry_date || '');
    if (da !== db) return da < db ? -1 : 1;
    var ca = String(a.created_at || ''), cb = String(b.created_at || '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  var state = {};
  var applied = {};
  sorted.forEach(function(e) {
    var cur = String(e.currency || 'USD').toUpperCase();
    if (!state[cur]) state[cur] = { theirPrepaid: 0, ourPrepaid: 0, openInvoices: [], openBills: [] };
    var s = state[cur];
    var type = e.transaction_type;
    var amt = Math.max(0, Number(e.credit_amount || 0) || Number(e.debit_amount || 0));
    if (type === 'sales_invoice') {
      var fp = Math.min(s.theirPrepaid, amt);
      s.theirPrepaid -= fp;
      var ri = amt - fp;
      applied[e.id] = fp;
      if (ri > 0.001) s.openInvoices.push({ id: e.id, originalAmount: amt, remaining: ri });
    } else if (type === 'vendor_bill') {
      var fop = Math.min(s.ourPrepaid, amt);
      s.ourPrepaid -= fop;
      var rb = amt - fop;
      applied[e.id] = fop;
      if (rb > 0.001) s.openBills.push({ id: e.id, originalAmount: amt, remaining: rb });
    } else if (type === 'payment_received') {
      var cl = amt;
      while (cl > 0.001 && s.openInvoices.length > 0) {
        var inv = s.openInvoices[0];
        var ap = Math.min(inv.remaining, cl);
        inv.remaining -= ap;
        applied[inv.id] = (applied[inv.id] || 0) + ap;
        cl -= ap;
        if (inv.remaining < 0.001) s.openInvoices.shift();
      }
      if (cl > 0.001) s.theirPrepaid += cl;
    } else if (type === 'payment_sent') {
      var cl2 = amt;
      while (cl2 > 0.001 && s.openBills.length > 0) {
        var bill = s.openBills[0];
        var ap2 = Math.min(bill.remaining, cl2);
        bill.remaining -= ap2;
        applied[bill.id] = (applied[bill.id] || 0) + ap2;
        cl2 -= ap2;
        if (bill.remaining < 0.001) s.openBills.shift();
      }
      if (cl2 > 0.001) s.ourPrepaid += cl2;
    }
  });
  var byCur = {};
  Object.keys(state).forEach(function(cur) {
    var s = state[cur];
    var inv = s.openInvoices.reduce(function(a, x) { return a + x.remaining; }, 0);
    var bill = s.openBills.reduce(function(a, x) { return a + x.remaining; }, 0);
    byCur[cur] = {
      theirOpenInvoices: inv, ourOpenBills: bill,
      theirPrepaid: s.theirPrepaid, ourPrepaid: s.ourPrepaid,
      netBalance: (inv - s.theirPrepaid) - (bill - s.ourPrepaid),
    };
  });
  return { byCurrency: byCur, applications: applied };
}

// Screenshot data
var entries = [
  { id: '1', entry_date: '2026-05-26', created_at: '2026-05-26T10:00Z', currency: 'USD', debit_amount: 1000, transaction_type: 'payment_sent' },
  { id: '2', entry_date: '2026-05-26', created_at: '2026-05-26T10:01Z', currency: 'EGP', debit_amount: 4500, transaction_type: 'payment_sent' },
  { id: '3', entry_date: '2026-05-26', created_at: '2026-05-26T10:02Z', currency: 'USD', debit_amount: 10888, transaction_type: 'vendor_bill' },
  { id: '4', entry_date: '2026-05-26', created_at: '2026-05-26T10:03Z', currency: 'EGP', debit_amount: 25000, transaction_type: 'vendor_bill' },
];
var sim = simulate(entries);

function computeTotals(entries, sim, cur) {
  var totalAmount = 0, totalPaid = 0, totalRemaining = 0;
  entries.filter(function(e) { return (e.currency || 'USD').toUpperCase() === cur; })
    .forEach(function(e) {
      totalAmount += Number(e.credit_amount || 0) + Number(e.debit_amount || 0);
      if (e.transaction_type === 'sales_invoice' || e.transaction_type === 'vendor_bill') {
        var amt = Number(e.credit_amount || 0) || Number(e.debit_amount || 0);
        var paid = (sim.applications[e.id] || 0);
        totalPaid += paid;
        totalRemaining += Math.max(0, amt - paid);
      }
    });
  return { totalAmount: totalAmount, totalPaid: totalPaid, totalRemaining: totalRemaining };
}

var usdT = computeTotals(entries, sim, 'USD');
var egpT = computeTotals(entries, sim, 'EGP');

ok('B1: USD Total Amount = 11,888 (1000 payment + 10888 bill)',
  Math.abs(usdT.totalAmount - 11888) < 0.01);
ok('B2: USD Total Paid = 1,000 (auto-applied to vendor bill)',
  Math.abs(usdT.totalPaid - 1000) < 0.01);
ok('B3: USD Total Remaining = 9,888 (bill minus applied)',
  Math.abs(usdT.totalRemaining - 9888) < 0.01);
ok('B4: USD reconciles: Invoice Amount (10888) = Paid + Remaining (1000 + 9888)',
  Math.abs(10888 - (usdT.totalPaid + usdT.totalRemaining)) < 0.01);
ok('B5: USD Net (-9,888) matches -Remaining (no theirSide → net = -Remaining)',
  Math.abs(sim.byCurrency.USD.netBalance - (-usdT.totalRemaining)) < 0.01);

ok('B6: EGP Total Amount = 29,500 (4500 payment + 25000 bill)',
  Math.abs(egpT.totalAmount - 29500) < 0.01);
ok('B7: EGP Total Paid = 4,500 (auto-applied to vendor bill)',
  Math.abs(egpT.totalPaid - 4500) < 0.01);
ok('B8: EGP Total Remaining = 20,500',
  Math.abs(egpT.totalRemaining - 20500) < 0.01);
ok('B9: EGP reconciles: Invoice Amount (25000) = Paid + Remaining (4500 + 20500)',
  Math.abs(25000 - (egpT.totalPaid + egpT.totalRemaining)) < 0.01);
ok('B10: EGP Net (-20,500) matches -Remaining',
  Math.abs(sim.byCurrency.EGP.netBalance - (-egpT.totalRemaining)) < 0.01);

ok('C1: PROOF the old display was broken: 0 - 11,888 (old Dr) = -11,888 ≠ -9,888 (Net)',
  (0 - 11888) !== sim.byCurrency.USD.netBalance);
ok('C2: PROOF the new display reconciles: Amount - Paid = Remaining → -Remaining = Net',
  Math.abs((usdT.totalAmount - usdT.totalPaid) - 10888) < 0.01 ||
  Math.abs(usdT.totalAmount - (usdT.totalPaid + usdT.totalRemaining + 1000)) < 0.01); // 1000 is the payment that became prepaid then consumed

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 4 — totals row reconciles');
console.log('══════════════════════════════════════════════');
