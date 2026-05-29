/* v72 HOTFIX 6 — Amount column is now SIGNED so it algebraically sums to Net.
 *
 * Bug: Max screenshot showed Payment Sent 1,000 and Vendor Bill 10,888 both as
 * positive amounts, summing to 11,888 — but Net was -9,888. Two different number
 * systems on the same row of totals, looked broken.
 *
 * Fix: Amount column shows signed value based on the transaction's effect on
 * our net position. Sums algebraically to Net. */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oa = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'OpenAccountsTab.jsx'), 'utf8');

console.log('\n── HOTFIX 6 — code structure ──');

ok('A1: signedAmount helper exists with sign rules per type',
  /function signedAmount\(entry\)/.test(oa) &&
  /case 'payment_sent':\s*return \+debit/.test(oa) &&
  /case 'sales_invoice':\s*return \+credit/.test(oa) &&
  /case 'payment_received':\s*return -credit/.test(oa) &&
  /case 'vendor_bill':\s*return -debit/.test(oa));

ok('A2: signedAmount handles credit_adjustment (debit minus credit)',
  /case 'credit_adjustment':\s*return debit - credit/.test(oa));

ok('A3: signedAmount handles offset (the two halves cancel)',
  /case 'offset':[\s\S]{0,400}if \(credit > 0 && entry\.offset_bill_id\) return \+credit[\s\S]{0,200}if \(debit > 0 && entry\.offset_invoice_id\) return -debit/.test(oa));

ok('A4: fmtSigned helper exists (formats with − prefix for negatives)',
  /function fmtSigned\(n\)/.test(oa) &&
  /return v < 0 \? '−' \+ abs : abs/.test(oa));

ok('B1: signedAmount helper still exists for running-balance computation (HOTFIX 11 uses In/Out columns for display, but signedAmount still drives the running balance arithmetic)',
  /function signedAmount\(entry\)/.test(oa));

ok('B2: per-row AR Side / AP Side cells display positive magnitudes via fmtNum (HOTFIX 11 final)',
  /var s = arApSide\(entry\)[\s\S]{0,400}fmtNum\(s\.ar\)/.test(oa) && /var s = arApSide\(entry\)[\s\S]{0,400}fmtNum\(s\.ap\)/.test(oa));

ok('C1: per-currency Summary block computes totalAR + totalAP SEPARATELY (HOTFIX 19: now from FIFO cs.theyOweUs/cs.weOweThem)',
  /var totalAR = Number\(cs\.theyOweUs \|\| 0\)/.test(oa) && /var totalAP = Number\(cs\.weOweThem \|\| 0\)/.test(oa));

ok('C2: Summary block displays Total AR + Total AP via fmtNum, Net Position via fmtSigned (HOTFIX 11 final)',
  /fmtNum\(totalAR\)/.test(oa) && /fmtNum\(totalAP\)/.test(oa) && /fmtSigned\(net\)/.test(oa));

ok('C3: Net Position row spells out arithmetic: Total AR − Total AP = Net (HOTFIX 11 final)',
  /Total AR − Total AP/.test(oa));

ok('C4: per-row Net column also uses fmtSigned (consistent with Amount)',
  /\{fmtSigned\(rbForCur\)\}/.test(oa));

console.log('\n── End-to-end: Max\'s screenshot scenario (signed sums tie to Net) ──');

// Inline minimal simulate + signedAmount for verification
function signedAmount(e) {
  if (!e) return 0;
  var cr = Number(e.credit_amount || 0);
  var dr = Number(e.debit_amount || 0);
  switch (e.transaction_type) {
    case 'payment_sent': return +dr;
    case 'sales_invoice': return +cr;
    case 'payment_received': return -cr;
    case 'vendor_bill': return -dr;
    case 'credit_adjustment': return dr - cr;
    case 'offset':
      if (cr > 0 && e.offset_bill_id) return +cr;
      if (dr > 0 && e.offset_invoice_id) return -dr;
      return 0;
    default: return cr - dr;
  }
}

function simulate(entries) {
  var sorted = entries.slice().sort(function(a, b) {
    var da = String(a.entry_date || ''), db = String(b.entry_date || '');
    if (da !== db) return da < db ? -1 : 1;
    var ca = String(a.created_at || ''), cb = String(b.created_at || '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  var state = {};
  sorted.forEach(function(e) {
    var cur = String(e.currency || 'USD').toUpperCase();
    if (!state[cur]) state[cur] = { theirPrepaid: 0, ourPrepaid: 0, openInvoices: [], openBills: [] };
    var s = state[cur];
    var t = e.transaction_type;
    var amt = Math.max(0, Number(e.credit_amount || 0) || Number(e.debit_amount || 0));
    if (t === 'sales_invoice') {
      var fp = Math.min(s.theirPrepaid, amt);
      s.theirPrepaid -= fp;
      if (amt - fp > 0.001) s.openInvoices.push({ remaining: amt - fp });
    } else if (t === 'vendor_bill') {
      var fop = Math.min(s.ourPrepaid, amt);
      s.ourPrepaid -= fop;
      if (amt - fop > 0.001) s.openBills.push({ remaining: amt - fop });
    } else if (t === 'payment_received') {
      var cl = amt;
      while (cl > 0.001 && s.openInvoices.length > 0) {
        var inv = s.openInvoices[0];
        var ap = Math.min(inv.remaining, cl);
        inv.remaining -= ap; cl -= ap;
        if (inv.remaining < 0.001) s.openInvoices.shift();
      }
      if (cl > 0.001) s.theirPrepaid += cl;
    } else if (t === 'payment_sent') {
      var cl2 = amt;
      while (cl2 > 0.001 && s.openBills.length > 0) {
        var bill = s.openBills[0];
        var ap2 = Math.min(bill.remaining, cl2);
        bill.remaining -= ap2; cl2 -= ap2;
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
    byCur[cur] = { netBalance: (inv - s.theirPrepaid) - (bill - s.ourPrepaid) };
  });
  return { byCurrency: byCur };
}

function totalSignedFor(entries, cur) {
  return entries.filter(function(e) { return (e.currency || 'USD').toUpperCase() === cur; })
    .reduce(function(a, e) { return a + signedAmount(e); }, 0);
}

// Screenshot data
var screenshotEntries = [
  { id: '1', entry_date: '2026-05-26', created_at: '2026-05-26T10:00Z', currency: 'USD', debit_amount: 1000, transaction_type: 'payment_sent' },
  { id: '2', entry_date: '2026-05-26', created_at: '2026-05-26T10:01Z', currency: 'EGP', debit_amount: 4500, transaction_type: 'payment_sent' },
  { id: '3', entry_date: '2026-05-26', created_at: '2026-05-26T10:02Z', currency: 'USD', debit_amount: 10888, transaction_type: 'vendor_bill' },
  { id: '4', entry_date: '2026-05-26', created_at: '2026-05-26T10:03Z', currency: 'EGP', debit_amount: 25000, transaction_type: 'vendor_bill' },
];
var sim = simulate(screenshotEntries);

ok('D1: USD signed total = +1000 (payment) + −10888 (bill) = −9888',
  Math.abs(totalSignedFor(screenshotEntries, 'USD') - (-9888)) < 0.01);
ok('D2: USD signed total === Net USD (-9888)',
  Math.abs(totalSignedFor(screenshotEntries, 'USD') - sim.byCurrency.USD.netBalance) < 0.01);
ok('D3: EGP signed total = +4500 (payment) + −25000 (bill) = −20500',
  Math.abs(totalSignedFor(screenshotEntries, 'EGP') - (-20500)) < 0.01);
ok('D4: EGP signed total === Net EGP (-20500)',
  Math.abs(totalSignedFor(screenshotEntries, 'EGP') - sim.byCurrency.EGP.netBalance) < 0.01);

// Per-type direction checks
ok('E1: payment_sent USD 1000 → +1000 (improves our position)',
  signedAmount({ transaction_type: 'payment_sent', debit_amount: 1000, currency: 'USD' }) === 1000);
ok('E2: vendor_bill USD 10888 → −10888 (worsens our position)',
  signedAmount({ transaction_type: 'vendor_bill', debit_amount: 10888, currency: 'USD' }) === -10888);
ok('E3: sales_invoice USD 5000 → +5000 (they will owe us)',
  signedAmount({ transaction_type: 'sales_invoice', credit_amount: 5000, currency: 'USD' }) === 5000);
ok('E4: payment_received USD 3000 → −3000 (their debt to us was settled)',
  signedAmount({ transaction_type: 'payment_received', credit_amount: 3000, currency: 'USD' }) === -3000);

// More complex scenario — sales invoice with auto-applied payment
var scen2 = [
  { id: 's1', entry_date: '2026-05-23', currency: 'USD', credit_amount: 10000, transaction_type: 'sales_invoice' },
  { id: 'p1', entry_date: '2026-05-24', currency: 'USD', credit_amount: 3000, transaction_type: 'payment_received' },
];
var sim2 = simulate(scen2);
ok('F1: Sales 10000 + payment received 3000 → signed sum +10000 + −3000 = +7000 = Net (they still owe 7000)',
  Math.abs(totalSignedFor(scen2, 'USD') - sim2.byCurrency.USD.netBalance) < 0.01 &&
  Math.abs(totalSignedFor(scen2, 'USD') - 7000) < 0.01);

// Cross-cancel scenario — vendor bill that auto-consumed prepaid
var scen3 = [
  { id: 'p1', entry_date: '2026-05-23', currency: 'USD', debit_amount: 5000, transaction_type: 'payment_sent' },
  { id: 'v1', entry_date: '2026-05-24', currency: 'USD', debit_amount: 3000, transaction_type: 'vendor_bill' },
];
var sim3 = simulate(scen3);
ok('F2: Payment sent 5000 + vendor bill 3000 → signed sum +5000 + −3000 = +2000 = Net (we have 2000 prepaid left)',
  Math.abs(totalSignedFor(scen3, 'USD') - sim3.byCurrency.USD.netBalance) < 0.01 &&
  Math.abs(totalSignedFor(scen3, 'USD') - 2000) < 0.01);

// PROOF the old display was misleading
console.log('\n── PROOF the old display was misleading ──');
var oldUnsignedTotal = screenshotEntries
  .filter(function(e) { return (e.currency || 'USD') === 'USD'; })
  .reduce(function(a, e) { return a + Number(e.credit_amount || 0) + Number(e.debit_amount || 0); }, 0);
ok('G1: Old unsigned USD total was 11,888 (1000+10888) — DID NOT match Net −9,888',
  oldUnsignedTotal === 11888 && oldUnsignedTotal !== sim.byCurrency.USD.netBalance);

console.log('\n── PRINT & EXCEL exports also fixed (HOTFIX 6 sweep) ──');
var exp = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'open-account-export.js'), 'utf8');

ok('H1: open-account-export.js has signedAmount + fmtSignedMoney helpers',
  /function signedAmount\(e\)/.test(exp) &&
  /function fmtSignedMoney\(n\)/.test(exp));

ok('H2: PRINT export: per-row running walks signed cumulative (FIFO net), NOT credit-debit',
  /var signed = signedAmount\(e\)/.test(exp) &&
  /running \+= signed/.test(exp) &&
  !/running \+= dispCredit - dispDebit/.test(exp));

ok('H3: PRINT export: customer perspective negates signed amount',
  /if \(perspective === 'customer'\) signed = -signed/.test(exp));

ok('H4: PRINT export: per-row AR Side / AP Side cells display positive via fmtMoney (HOTFIX 11 final)',
  /arCellHtml = arSide > 0\.005[\s\S]{0,200}fmtMoney\(arSide\)/.test(exp) && /apCellHtml = apSide > 0\.005[\s\S]{0,200}fmtMoney\(apSide\)/.test(exp));

ok('H5: PRINT export: totals row no longer uses "Cr: / Dr:" labels',
  !/'<td class="num">Cr: ' \+ fmtMoney\(cs\.credit\)/.test(exp));

ok('H6: PRINT export Summary block: Total AR + Total AP + Net Position (HOTFIX 11 final)',
  /Total AR \(They Owe Us\)/.test(exp) && /Total AP \(We Owe Them\)/.test(exp) && /Net.{0,20}Position/.test(exp));

ok('I1: EXCEL export: per-row running walks signed (FIFO net), NOT credit-debit',
  /running\[entryCur\] \+= signed/.test(exp) &&
  !/running\[entryCur\] \+= credit - debit/.test(exp));

ok('I2: EXCEL export: AR Side + AP Side write positive numerics by column (HOTFIX 11 final)',
  /arSide > 0\.005 \? arSide : ''/.test(exp) && /apSide > 0\.005 \? apSide : ''/.test(exp));

ok('I3: EXCEL export: totals row no longer uses "Cr: / Dr:" labels',
  !/'Cr: ' \+ \(cs\.credit \|\| 0\)/.test(exp) &&
  !/'Dr: ' \+ \(cs\.debit \|\| 0\)/.test(exp));

ok('I4: EXCEL export Summary block: Total AR + Total AP + Net Position numerics (HOTFIX 11 final)',
  /Total AR \(They Owe Us\)/.test(exp) && /Total AP \(We Owe Them\)/.test(exp) && /Net ' \+ cur \+ ' Position/.test(exp));

console.log('\n── Account header: Cr/Dr removed (HOTFIX 6) ──');

ok('J1: Account header pill area no longer renders Cr: / Dr: raw sums (caused reconciliation confusion)',
  !/<span>Cr: <span className="text-emerald-800">\{fmtNum\(cs\.credit\)\}<\/span><\/span>/.test(oa) &&
  !/<span>Dr: <span className="text-red-700">\{fmtNum\(cs\.debit\)\}<\/span><\/span>/.test(oa));

ok('J2: Account header Bal pill uses fmtSigned (consistent with totals row)',
  /Bal: \{fmtSigned\(cs\.balance\)\} \{cur\}/.test(oa));

ok('J3: Grand-totals Net Balance also uses fmtSigned',
  /<div className="text-xl font-extrabold mt-0\.5">\{fmtSigned\(t\.balance\)\}/.test(oa));

ok('J4: 4-pot Net Balance tile uses fmtSigned (HOTFIX 30: now rendered at 28px / weight 900)',
  /fontSize: '28px'[\s\S]{0,300}fontWeight: 900[\s\S]{0,500}\{fmtSigned\(b\.netBalance\)\}/.test(oa));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 6 — sign convention applied EVERYWHERE (screen + print + Excel + header + grand totals + 4-pot)');
console.log('══════════════════════════════════════════════');
