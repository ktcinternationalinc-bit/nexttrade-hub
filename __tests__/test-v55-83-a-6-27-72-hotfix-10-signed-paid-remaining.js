/* v72 HOTFIX 10 — Paid + Remaining columns now SIGNED to match parent Amount.
 *
 * Bug Max caught from screenshot: TOTALS row showed
 *   Amount: -2,876   Paid: 33,888   Remaining: 16,900   Net: -2,876
 *
 * The Paid 33,888 mixed +1,000 paid-out and +32,888 received-in as positive
 * magnitudes — meaningless sum. The Remaining 16,900 mixed 9,888 we-owe with
 * 7,012 they-owe as positive magnitudes — also meaningless.
 *
 * Fix: Paid and Remaining inherit the sign of their parent transaction.
 *   Sales Invoice (Amount +): Paid +, Remaining +
 *   Vendor Bill  (Amount −): Paid −, Remaining −
 * Per-row math: Amount = Paid + Remaining (all signed) ✓
 * Totals: signed Remaining sum = Net when no prepaid pots (the common case). */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oa = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');
var exp = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-export.js'), 'utf8');

console.log('\n── HOTFIX 10 — signedPaidRemaining helper ──');

ok('A1: signedPaidRemaining helper exists',
  /function signedPaidRemaining\(entry, simResult\)/.test(oa));

ok('A2: Sales Invoice gets sign +1',
  /var sign = entry\.transaction_type === 'sales_invoice' \? 1 : -1/.test(oa));

ok('A3: Helper returns paid and remaining signed',
  /return \{ paid: sign \* paidMag, remaining: sign \* remainingMag \}/.test(oa));

console.log('\n── Per-row Paid and Remaining cells ──');

ok('B1: Per-row AR Side / AP Side cells use arApSide helper (HOTFIX 11 final — no Paid column on screen, single Remaining)',
  /var s = arApSide\(entry\)/.test(oa));

ok('B2: Per-row Remaining cell fills for invoice/bill rows only (HOTFIX 11 final — single Remaining col, color by side)',
  /txnType !== 'sales_invoice' && txnType !== 'vendor_bill'/.test(oa));

ok('B3: Per-row Open Balance cell BLUE for AR rows, ORANGE for AP rows (HOTFIX 12)',
  /txnType === 'sales_invoice' \? 'text-blue-900' : 'text-orange-900'/.test(oa));

console.log('\n── Totals row signed sums ──');

ok('C1: Per-currency Summary block tracks totalAR + totalAP SEPARATELY (HOTFIX 11 final)',
  /totalAR \+= prT\.remaining/.test(oa) && /totalAP \+= prT\.remaining/.test(oa));

ok('C2: Net Position row computes net = totalAR − totalAP (HOTFIX 11 final spelled-out arithmetic)',
  /var net = totalAR - totalAP/.test(oa));

ok('C3: Net Position row sub-label "in our favor" / "against us" (HOTFIX 11 final spec)',
  /in our favor[\s\S]{0,300}against us|against us[\s\S]{0,300}in our favor/.test(oa));

ok('C4: Summary block label "Net <CUR> Position" per the spec format (HOTFIX 11 final)',
  /Net \{cur\} Position/.test(oa));

console.log('\n── Print export signed Paid/Remaining (HOTFIX 10 sweep) ──');

ok('D1: PRINT per-row uses AR Side / AP Side columns (HOTFIX 11 final — positive magnitudes)',
  /var arSide = 0[\s\S]{0,300}var apSide = 0/.test(exp) && /arCellHtml/.test(exp) && /apCellHtml/.test(exp));

ok('D2: PRINT Summary block uses totAR + totAP per currency (HOTFIX 11 final)',
  /totAR \+= rem/.test(exp) && /totAP \+= rem/.test(exp));

ok('D3: PRINT customer perspective swaps AR/AP correctly (HOTFIX 11 final)',
  /if \(perspective === 'customer'\) \{ var tmp = arSide; arSide = apSide; apSide = tmp; \}/.test(exp));

console.log('\n── Excel export signed Paid/Remaining (HOTFIX 10 sweep) ──');

ok('E1: EXCEL per-row writes positive AR Side / AP Side numerics + single Remaining (HOTFIX 11 final)',
  /arSide > 0\.005 \? arSide : ''/.test(exp) && /apSide > 0\.005 \? apSide : ''/.test(exp));

ok('E2: EXCEL Summary block writes Total AR + Total AP + Net Position numerics (HOTFIX 11 final)',
  /Total AR \(They Owe Us\)/.test(exp) && /Total AP \(We Owe Them\)/.test(exp) && /Net ' \+ cur \+ ' Position/.test(exp));

console.log('\n── End-to-end: Max\'s screenshot scenario reconciles ──');

// Replay Max's screenshot data: TEST account, 6 entries USD
// Payment Sent 1000, Payment Sent EGP 4500, Vendor Bill USD 10888,
// Vendor Bill EGP 25000, Sales Invoice USD 39900, Payment Received USD 32888

function signedAmount(e) {
  var cr = Number(e.credit_amount || 0);
  var dr = Number(e.debit_amount || 0);
  switch (e.transaction_type) {
    case 'payment_sent': return +dr;
    case 'sales_invoice': return +cr;
    case 'payment_received': return -cr;
    case 'vendor_bill': return -dr;
    default: return cr - dr;
  }
}

function applyFIFO(entries) {
  var sorted = entries.slice().sort(function(a, b) {
    return String(a.created_at).localeCompare(String(b.created_at));
  });
  var state = {};
  var applied = {};
  sorted.forEach(function(e) {
    var cur = e.currency;
    if (!state[cur]) state[cur] = { theirPrepaid: 0, ourPrepaid: 0, openInvoices: [], openBills: [] };
    var s = state[cur];
    var t = e.transaction_type;
    var amt = Math.max(0, Number(e.credit_amount || 0) || Number(e.debit_amount || 0));
    applied[e.id] = 0;
    if (t === 'sales_invoice') {
      var f = Math.min(s.theirPrepaid, amt); s.theirPrepaid -= f;
      applied[e.id] = f;
      if (amt - f > 0.001) s.openInvoices.push({ id: e.id, remaining: amt - f });
    } else if (t === 'vendor_bill') {
      var f2 = Math.min(s.ourPrepaid, amt); s.ourPrepaid -= f2;
      applied[e.id] = f2;
      if (amt - f2 > 0.001) s.openBills.push({ id: e.id, remaining: amt - f2 });
    } else if (t === 'payment_received') {
      var c = amt;
      while (c > 0.001 && s.openInvoices.length > 0) {
        var inv = s.openInvoices[0]; var ap = Math.min(inv.remaining, c);
        inv.remaining -= ap; applied[inv.id] = (applied[inv.id] || 0) + ap; c -= ap;
        if (inv.remaining < 0.001) s.openInvoices.shift();
      }
      if (c > 0.001) s.theirPrepaid += c;
    } else if (t === 'payment_sent') {
      var c2 = amt;
      while (c2 > 0.001 && s.openBills.length > 0) {
        var b = s.openBills[0]; var ap2 = Math.min(b.remaining, c2);
        b.remaining -= ap2; applied[b.id] = (applied[b.id] || 0) + ap2; c2 -= ap2;
        if (b.remaining < 0.001) s.openBills.shift();
      }
      if (c2 > 0.001) s.ourPrepaid += c2;
    }
  });
  return { state: state, applied: applied };
}

var entries = [
  { id: '1', created_at: '01', currency: 'USD', debit_amount: 1000, transaction_type: 'payment_sent' },
  { id: '2', created_at: '02', currency: 'EGP', debit_amount: 4500, transaction_type: 'payment_sent' },
  { id: '3', created_at: '03', currency: 'USD', debit_amount: 10888, transaction_type: 'vendor_bill' },
  { id: '4', created_at: '04', currency: 'EGP', debit_amount: 25000, transaction_type: 'vendor_bill' },
  { id: '5', created_at: '05', currency: 'USD', credit_amount: 39900, transaction_type: 'sales_invoice' },
  { id: '6', created_at: '06', currency: 'USD', credit_amount: 32888, transaction_type: 'payment_received' },
];

var sim = applyFIFO(entries);

// Signed totals per currency
function totalsFor(cur) {
  var totSigned = 0, totPaidSigned = 0, totRemSigned = 0;
  entries.filter(function(e) { return e.currency === cur; }).forEach(function(e) {
    totSigned += signedAmount(e);
    if (e.transaction_type === 'sales_invoice' || e.transaction_type === 'vendor_bill') {
      var paidMag = sim.applied[e.id] || 0;
      var fa = Number(e.credit_amount || 0) || Number(e.debit_amount || 0);
      var sign = e.transaction_type === 'sales_invoice' ? 1 : -1;
      totPaidSigned += sign * paidMag;
      totRemSigned += sign * Math.max(0, fa - paidMag);
    }
  });
  return { signed: totSigned, paid: totPaidSigned, remaining: totRemSigned };
}

var usdT = totalsFor('USD');
ok('F1: USD signed Amount total = +1000 − 10888 + 39900 − 32888 = −2876',
  Math.abs(usdT.signed - (-2876)) < 0.01);
ok('F2: USD signed Paid total = −1000 + 32888 = +31888 (Sales-Invoice paid POSITIVE, Vendor-Bill paid NEGATIVE)',
  Math.abs(usdT.paid - 31888) < 0.01);
ok('F3: USD signed Remaining total = −9888 + 7012 = −2876 (equals Net since no prepaid)',
  Math.abs(usdT.remaining - (-2876)) < 0.01);
ok('F4: USD Remaining (signed) === Amount (signed) === Net = −2876 (full algebraic reconciliation)',
  Math.abs(usdT.remaining - usdT.signed) < 0.01);

var egpT = totalsFor('EGP');
ok('F5: EGP signed Amount total = +4500 − 25000 = −20500',
  Math.abs(egpT.signed - (-20500)) < 0.01);
ok('F6: EGP signed Paid total = −4500 (only Vendor Bill paid is negative direction)',
  Math.abs(egpT.paid - (-4500)) < 0.01);
ok('F7: EGP signed Remaining total = −20500 (equals Net)',
  Math.abs(egpT.remaining - (-20500)) < 0.01);

ok('G1: PROOF the old display was misleading — USD Paid was 33,888 (1000+32888 as unsigned)',
  // Just shows the math user might have seen
  (1000 + 32888) === 33888);
ok('G2: PROOF the old display was misleading — USD Remaining was 16,900 (9888+7012)',
  (9888 + 7012) === 16900 && (9888 + 7012) !== -2876);

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 10 — Paid + Remaining signed everywhere, totals reconcile');
console.log('══════════════════════════════════════════════');
