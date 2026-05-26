/* v72 HOTFIX 11 FINAL — Standard accounting layout per the prescriptive spec.
 *
 * Table columns:
 *   Date | Type | Description | Reference | Currency | AR Side | AP Side | Remaining | Running Balance USD | Running Balance EGP | Actions
 *
 * Per-row routing:
 *   Sales Invoice    → AR Side  (increases AR)
 *   Payment Received → AR Side  (reduces AR)
 *   Vendor Bill      → AP Side  (increases AP)
 *   Payment Sent     → AP Side  (reduces AP)
 *
 * All values positive; the Type column tells you whether the row INCREASES or REDUCES the side.
 *
 * Totals: per-currency Summary block (Total AR / Total AP / Net Position rows).
 * Net Position row spells out arithmetic + "in our favor" / "against us" sub-label.
 *
 * Global Net Position card: converts all currencies to USD via fx_rates. */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oa = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');
var exp = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-export.js'), 'utf8');

console.log('\n── HOTFIX 11 — arApSide helper ──');

ok('A1: arApSide() returns {ar, ap} routed by transaction_type',
  /function arApSide\(entry\)/.test(oa));

ok('A2: sales_invoice routes to AR Side',
  /case 'sales_invoice':\s+return \{ ar: credit, ap: 0 \}/.test(oa));

ok('A3: payment_received routes to AR Side (reduces AR, shown positive)',
  /case 'payment_received': return \{ ar: credit, ap: 0 \}/.test(oa));

ok('A4: vendor_bill routes to AP Side',
  /case 'vendor_bill':\s+return \{ ar: 0, ap: debit \}/.test(oa));

ok('A5: payment_sent routes to AP Side (reduces AP, shown positive)',
  /case 'payment_sent':\s+return \{ ar: 0, ap: debit \}/.test(oa));

console.log('\n── Column headers per spec ──');

ok('B1: Header "AR Side" with emerald bg',
  />AR Side</.test(oa) && /bg-emerald-50[\s\S]{0,300}AR Side/.test(oa));

ok('B2: Header "AP Side" with red bg',
  />AP Side</.test(oa) && /bg-red-50[\s\S]{0,300}AP Side/.test(oa));

ok('B3: Single Open Balance column with amber bg (renamed from Remaining per polish)',
  />Open Balance</.test(oa) && /bg-amber-50[\s\S]{0,300}Open Balance/.test(oa));

ok('B4: NO Paid column on screen (spec dropped it)',
  !/>Paid<\/th>/.test(oa));

ok('B5: NO separate Open AR / Open AP columns (merged to single Remaining)',
  !/>Open AR</.test(oa) && !/>Open AP</.test(oa));

ok('B6: Running Balance CUR header (per spec)',
  /Running Balance \{cur\}/.test(oa));

ok('B7: Currency column (full word, not "Cur")',
  />Currency</.test(oa));

console.log('\n── Per-row cells ──');

ok('C1: AR Side cell uses arApSide + fmtNum positive',
  /var s = arApSide\(entry\)[\s\S]{0,400}s\.ar > 0\.005[\s\S]{0,200}fmtNum\(s\.ar\)/.test(oa));

ok('C2: AP Side cell uses arApSide + fmtNum positive',
  /var s = arApSide\(entry\)[\s\S]{0,400}s\.ap > 0\.005[\s\S]{0,200}fmtNum\(s\.ap\)/.test(oa));

ok('C3: Remaining fills only for invoice/bill rows',
  /txnType !== 'sales_invoice' && txnType !== 'vendor_bill'/.test(oa));

ok('C4: Remaining colored emerald for AR, red for AP',
  /txnType === 'sales_invoice' \? 'text-emerald-900' : 'text-red-900'/.test(oa));

ok('C5: Settled invoices show "✓ paid"',
  /✓ paid/.test(oa));

console.log('\n── Per-currency Summary block ──');

ok('D1: Summary tracks totalAR (sales_invoice remaining only)',
  /totalAR \+= prT\.remaining/.test(oa));

ok('D2: Summary tracks totalAP (vendor_bill remaining only)',
  /totalAP \+= prT\.remaining/.test(oa));

ok('D3: Summary header "{cur} Summary"',
  /\{cur\} Summary/.test(oa));

ok('D4: Total AR row labeled "Total AR (They Owe Us)"',
  /Total AR \(They Owe Us\)/.test(oa));

ok('D5: Total AP row labeled "Total AP (We Owe Them)"',
  /Total AP \(We Owe Them\)/.test(oa));

ok('D6: Net Position row labeled "Net CUR Position"',
  /Net \{cur\} Position/.test(oa));

ok('D7: Net Position arithmetic: totalAR − totalAP',
  /var net = totalAR - totalAP/.test(oa));

ok('D8: Sub-label "in our favor" / "against us"',
  /in our favor/.test(oa) && /against us/.test(oa));

ok('D9: AR and AP NEVER summed together blindly',
  !/totalAR \+ totalAP/.test(oa));

console.log('\n── Global FX-unified Net Position card ──');

ok('E1: lookupFxRate finds direct or inverse rate',
  /function lookupFxRate\(fxRates, from, to\)/.test(oa));

ok('E2: convertToBaseCurrency aggregates to base USD',
  /function convertToBaseCurrency\(byCurrency, baseCur, fxRates\)/.test(oa));

ok('E3: fxRates state loaded from fx_rates table',
  /var \[fxRates, setFxRates\] = useState\(\[\]\)/.test(oa) &&
  /supabase\.from\('fx_rates'\)\.select/.test(oa));

ok('E4: Card shown when there is any activity (polish — was multi-cur only, now single-cur too)',
  /grandTotals\.currencies\.length > 0/.test(oa));

ok('E5: Card shows per-currency rate × value = base equiv',
  /b\.rate[\s\S]{0,500}b\.baseEquiv/.test(oa));

ok('E6: Card flags missing FX rate with warning (polish: singular "rate" + open FX panel hint)',
  /Missing FX rate for/.test(oa));

console.log('\n── Print export mirrors spec ──');

ok('F1: PRINT headers AR Side / AP Side / Open Balance / Running Balance CUR (polish)',
  />AR Side</.test(exp) && />AP Side</.test(exp) && />Open Balance</.test(exp) && /Running Balance ' \+ escapeHtml\(cur\)/.test(exp));

ok('F2: PRINT per-row uses arSide / apSide',
  /var arSide = 0[\s\S]{0,300}var apSide = 0/.test(exp));

ok('F3: PRINT Summary: Total AR + Total AP + Net Position',
  /Total AR \(They Owe Us\)/.test(exp) && /Total AP \(We Owe Them\)/.test(exp));

ok('F4: PRINT Net Position spells out AR − AP = net with sub-label',
  /in our favor/.test(exp) && /against us/.test(exp));

ok('F5: PRINT customer perspective swaps AR/AP',
  /if \(perspective === 'customer'\) \{ var tmp = arSide; arSide = apSide; apSide = tmp; \}/.test(exp));

console.log('\n── Excel export mirrors spec ──');

ok('G1: EXCEL headers AR Side + AP Side + Open Balance + Running Balance CUR (polish)',
  /'AR Side', 'AP Side', 'Open Balance'/.test(exp) && /'Running Balance ' \+ cur/.test(exp));

ok('G2: EXCEL per-row writes positive arSide / apSide numerics',
  /arSide > 0\.005 \? arSide : ''/.test(exp) && /apSide > 0\.005 \? apSide : ''/.test(exp));

ok('G3: EXCEL Summary block: Total AR / Total AP / Net Position per currency',
  /cur \+ ' Summary:'/.test(exp) && /Total AR \(They Owe Us\)/.test(exp) && /Total AP \(We Owe Them\)/.test(exp) && /'Net ' \+ cur \+ ' Position:'/.test(exp));

console.log('\n── End-to-end: Max\'s TEST account scenario from screenshot ──');

function arApRoute(e) {
  var cr = Number(e.credit_amount || 0);
  var dr = Number(e.debit_amount || 0);
  switch (e.transaction_type) {
    case 'sales_invoice':    return { ar: cr, ap: 0 };
    case 'payment_received': return { ar: cr, ap: 0 };
    case 'vendor_bill':      return { ar: 0, ap: dr };
    case 'payment_sent':     return { ar: 0, ap: dr };
    default: return { ar: cr, ap: dr };
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
  return { applied: applied };
}

var testData = [
  { id: '1', created_at: '01', currency: 'USD', debit_amount: 1000, transaction_type: 'payment_sent' },
  { id: '2', created_at: '02', currency: 'EGP', debit_amount: 4500, transaction_type: 'payment_sent' },
  { id: '3', created_at: '03', currency: 'USD', debit_amount: 10888, transaction_type: 'vendor_bill' },
  { id: '4', created_at: '04', currency: 'EGP', debit_amount: 25000, transaction_type: 'vendor_bill' },
  { id: '5', created_at: '05', currency: 'USD', credit_amount: 39900, transaction_type: 'sales_invoice' },
  { id: '6', created_at: '06', currency: 'USD', credit_amount: 32888, transaction_type: 'payment_received' },
];

var sim = applyFIFO(testData);

console.log('\n  ── Per-row AR Side / AP Side routing ──');
var expectations = [
  { id: '1', type: 'payment_sent USD 1000', expectAR: 0, expectAP: 1000 },
  { id: '2', type: 'payment_sent EGP 4500', expectAR: 0, expectAP: 4500 },
  { id: '3', type: 'vendor_bill USD 10888', expectAR: 0, expectAP: 10888 },
  { id: '4', type: 'vendor_bill EGP 25000', expectAR: 0, expectAP: 25000 },
  { id: '5', type: 'sales_invoice USD 39900', expectAR: 39900, expectAP: 0 },
  { id: '6', type: 'payment_received USD 32888', expectAR: 32888, expectAP: 0 },
];
expectations.forEach(function (ex) {
  var row = testData.find(function (r) { return r.id === ex.id; });
  var routed = arApRoute(row);
  ok('  H' + ex.id + ': ' + ex.type + ' → AR: ' + ex.expectAR + ' AP: ' + ex.expectAP,
    Math.abs(routed.ar - ex.expectAR) < 0.01 && Math.abs(routed.ap - ex.expectAP) < 0.01);
});

function summaryFor(cur) {
  var totAR = 0, totAP = 0;
  testData.filter(function(e) { return e.currency === cur; }).forEach(function(e) {
    if (e.transaction_type === 'sales_invoice' || e.transaction_type === 'vendor_bill') {
      var paidMag = sim.applied[e.id] || 0;
      var fa = Number(e.credit_amount || 0) || Number(e.debit_amount || 0);
      var rem = Math.max(0, fa - paidMag);
      if (e.transaction_type === 'sales_invoice') totAR += rem;
      else totAP += rem;
    }
  });
  return { totAR: totAR, totAP: totAP, net: totAR - totAP };
}

console.log('\n  ── USD Summary (matches screenshot) ──');
var usd = summaryFor('USD');
ok('  I1: Total AR (They Owe Us): 7,012.00 USD',
  Math.abs(usd.totAR - 7012) < 0.01);
ok('  I2: Total AP (We Owe Them): 9,888.00 USD',
  Math.abs(usd.totAP - 9888) < 0.01);
ok('  I3: Net USD Position: 7,012 − 9,888 = -2,876.00',
  Math.abs(usd.net - (-2876)) < 0.01);
ok('  I4: USD sub-label: "against us" (Net is negative)',
  usd.net < 0);

console.log('\n  ── EGP Summary (matches screenshot) ──');
var egp = summaryFor('EGP');
ok('  J1: Total AR (They Owe Us): 0.00 EGP',
  Math.abs(egp.totAR - 0) < 0.01);
ok('  J2: Total AP (We Owe Them): 20,500.00 EGP',
  Math.abs(egp.totAP - 20500) < 0.01);
ok('  J3: Net EGP Position: -20,500.00',
  Math.abs(egp.net - (-20500)) < 0.01);

console.log('\n  ── FX-unified Global Net Position (spec example math) ──');
var rate = 50;
var globalNet = usd.net + (egp.net / rate);
ok('  K1: EGP −20,500 / 50 = −410 USD',
  Math.abs((egp.net / rate) - (-410)) < 0.01);
ok('  K2: Global Net USD = −2,876 + −410 = −3,286 (matches spec example exactly)',
  Math.abs(globalNet - (-3286)) < 0.01);

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 11 FINAL — standard accounting spec compliant');
console.log('══════════════════════════════════════════════');
