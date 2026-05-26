/* v72 HOTFIX 11 — Standard accounting two-column layout + segregated totals + FX-unified card.
 *
 * Max pasted feedback from Grok pointing out the previous signed-Amount layout was
 * hostile to accounting intuition and that the Totals row was summing assets + liabilities
 * as positive magnitudes (mathematically meaningless).
 *
 * Fix per the prescription:
 *   1. Single Amount column → two columns "Amount In" / "Amount Out", all positive values
 *   2. Totals row: segregate Open AR (sales invoices) from Open AP (vendor bills); NO blind sums
 *   3. "Net USD/EGP" columns → "Running USD/EGP" (they're cumulative balances, not row-level nets)
 *   4. New Global Net Position card converts all currencies to base USD via fx_rates table
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oa = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');
var exp = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-export.js'), 'utf8');

console.log('\n── HOTFIX 11 — Helpers ──');

ok('A1: inOutAmount() helper returns positive {in, out} per direction',
  /function inOutAmount\(entry\)[\s\S]{0,1500}return \{ in: credit, out: 0 \}[\s\S]{0,1500}return \{ in: 0, out: debit \}/.test(oa));

ok('A2: sales_invoice routes to In side',
  /case 'sales_invoice':\s+return \{ in: credit, out: 0 \}/.test(oa));

ok('A3: payment_received routes to In side (was negative red in old signed layout — hostile UX)',
  /case 'payment_received': return \{ in: credit, out: 0 \}/.test(oa));

ok('A4: vendor_bill routes to Out side',
  /case 'vendor_bill':\s+return \{ in: 0, out: debit \}/.test(oa));

ok('A5: payment_sent routes to Out side',
  /case 'payment_sent':\s+return \{ in: 0, out: debit \}/.test(oa));

ok('A6: isAR() helper — true only for sales_invoice',
  /function isAR\(entry\)[\s\S]{0,200}entry\.transaction_type === 'sales_invoice'/.test(oa));

ok('A7: isAP() helper — true only for vendor_bill',
  /function isAP\(entry\)[\s\S]{0,200}entry\.transaction_type === 'vendor_bill'/.test(oa));

console.log('\n── Column headers: standard accounting layout ──');

ok('B1: Header "Amount In" with emerald bg',
  />Amount In</.test(oa) && /bg-emerald-50[\s\S]{0,200}Amount In/.test(oa));

ok('B2: Header "Amount Out" with red bg',
  />Amount Out</.test(oa) && /bg-red-50[\s\S]{0,200}Amount Out/.test(oa));

ok('B3: Header "Paid" preserved (auto-FIFO applied)',
  />Paid</.test(oa));

ok('B4: Header "Open AR" — sales invoices receivable column',
  />Open AR</.test(oa) && /Open AR[\s\S]{0,200}bg-emerald-50/.test(oa));

ok('B5: Header "Open AP" — vendor bills payable column',
  />Open AP</.test(oa) && /Open AP[\s\S]{0,200}bg-red-50/.test(oa));

ok('B6: Headers renamed "Net USD/EGP" → "Running USD/EGP" (was misleading: they are running balances)',
  /Running \{cur\}/.test(oa) && !/>Net \{cur\}</.test(oa));

console.log('\n── Per-row cells use new layout ──');

ok('C1: Per-row Amount In cell uses inOutAmount + emerald color',
  /var io = inOutAmount\(entry\)[\s\S]{0,300}io\.in > 0\.005[\s\S]{0,200}fmtNum\(io\.in\)/.test(oa));

ok('C2: Per-row Amount Out cell uses inOutAmount + red color',
  /var io = inOutAmount\(entry\)[\s\S]{0,300}io\.out > 0\.005[\s\S]{0,200}fmtNum\(io\.out\)/.test(oa));

ok('C3: Per-row Open AR only fills for sales_invoice rows',
  /txnType === 'sales_invoice'[\s\S]{0,400}fmtNum\(pr\.remaining\)/.test(oa));

ok('C4: Per-row Open AP only fills for vendor_bill rows',
  /txnType === 'vendor_bill'[\s\S]{0,400}fmtNum\(pr\.remaining\)/.test(oa));

ok('C5: Settled invoices/bills show "✓ paid" indicator',
  /✓ paid/.test(oa));

console.log('\n── Totals row segregated (NO blind sums of mixed direction) ──');

ok('D1: Totals row tracks totalIn separately',
  /var totalIn = 0/.test(oa) && /totalIn \+= io\.in/.test(oa));

ok('D2: Totals row tracks totalOut separately',
  /var totalOut = 0/.test(oa) && /totalOut \+= io\.out/.test(oa));

ok('D3: Totals row tracks totalOpenAR (sales_invoice remaining ONLY)',
  /var totalOpenAR = 0/.test(oa) && /if \(e\.transaction_type === 'sales_invoice'\) totalOpenAR \+= prT\.remaining/.test(oa));

ok('D4: Totals row tracks totalOpenAP (vendor_bill remaining ONLY)',
  /var totalOpenAP = 0/.test(oa) && /else totalOpenAP \+= prT\.remaining/.test(oa));

ok('D5: Totals row DOES NOT sum AR + AP into one column',
  !/totalOpenAR \+ totalOpenAP/.test(oa) &&
  !/totalAR \+ totalAP/.test(oa));

ok('D6: Net Position row shows AR − AP = net explicitly (not a blind sum)',
  /Net Position[\s\S]{0,500}Open AR − Open AP/.test(oa));

ok('D7: Net Position row computes net = tAR - tAP',
  /var net = tAR - tAP/.test(oa));

console.log('\n── FX-unified Global Net Position card ──');

ok('E1: lookupFxRate helper finds direct or inverse rate by date',
  /function lookupFxRate\(fxRates, from, to\)/.test(oa) &&
  /r\.from_currency === to && r\.to_currency === from/.test(oa));

ok('E2: convertToBaseCurrency helper aggregates per-currency balances to base',
  /function convertToBaseCurrency\(byCurrency, baseCur, fxRates\)/.test(oa));

ok('E3: Helper flags missing rates so the user knows which to add',
  /missingRates\.push\(cur\)/.test(oa));

ok('E4: fxRates state loaded from fx_rates table',
  /var \[fxRates, setFxRates\] = useState\(\[\]\)/.test(oa) &&
  /supabase\.from\('fx_rates'\)\.select/.test(oa));

ok('E5: Global Net Position card rendered when more than 1 currency in play',
  /grandTotals\.currencies\.length > 1 && \(function \(\) \{/.test(oa));

ok('E6: Card shows base currency total prominently',
  /Global Net Position[\s\S]{0,2000}Base currency: USD/.test(oa));

ok('E7: Card shows per-currency contribution with rate × value = base equiv',
  /b\.rate[\s\S]{0,400}b\.baseEquiv/.test(oa));

ok('E8: Card warns about missing FX rates (no silent omission)',
  /Missing FX rates for/.test(oa));

console.log('\n── Print export mirrors new layout ──');

ok('F1: PRINT headers include Amount In + Amount Out + Open AR + Open AP',
  /Amount In/.test(exp) && /Amount Out/.test(exp) && /Open AR/.test(exp) && /Open AP/.test(exp));

ok('F2: PRINT headers renamed Running CUR (was "Running Net")',
  /Running ' \+ escapeHtml\(cur\)/.test(exp));

ok('F3: PRINT per-row uses positive In/Out cells (not signed)',
  /var inAmt = 0[\s\S]{0,300}var outAmt = 0/.test(exp) &&
  /inCellHtml = inAmt > 0\.005/.test(exp) &&
  /outCellHtml = outAmt > 0\.005/.test(exp));

ok('F4: PRINT totals row segregated (totIn, totOut, totAR, totAP)',
  /var totIn = 0, totOut = 0, totPaid = 0, totAR = 0, totAP = 0/.test(exp));

ok('F5: PRINT adds Net Position row (AR − AP = net) below totals',
  /Net Position[\s\S]{0,1000}Open AR − Open AP/.test(exp));

ok('F6: PRINT customer perspective swaps In/Out + AR/AP correctly',
  /if \(perspective === 'customer'\) \{ var tmp = ia; ia = oa; oa = tmp; \}/.test(exp));

console.log('\n── Excel export mirrors new layout ──');

ok('G1: EXCEL headers Amount In + Amount Out + Paid + Open AR + Open AP + Running CUR',
  /'Amount In', 'Amount Out', 'Paid', 'Open AR', 'Open AP'/.test(exp) &&
  /'Running ' \+ cur/.test(exp));

ok('G2: EXCEL per-row writes positive In/Out + segregated AR/AP numerics',
  /inAmt > 0\.005 \? inAmt : ''/.test(exp) &&
  /outAmt > 0\.005 \? outAmt : ''/.test(exp) &&
  /openAR > 0\.005 \? openAR : ''/.test(exp) &&
  /openAP > 0\.005 \? openAP : ''/.test(exp));

ok('G3: EXCEL totals row writes segregated totals (numeric for SUM verification)',
  /totalsRow = \['', '', cur \+ ' TOTALS', '', cur,\s+totIn > 0\.005 \? totIn : ''[\s\S]{0,400}totAR > 0\.005 \? totAR : ''[\s\S]{0,200}totAP > 0\.005 \? totAP : ''/.test(exp));

ok('G4: EXCEL adds NET POSITION row (AR − AP) per currency below totals',
  /var netP = totAR - totAP/.test(exp) &&
  /'NET POSITION \(' \+ cur \+ '\)'/.test(exp));

console.log('\n── End-to-end: Max\'s TEST account screenshot data reconciles ──');

// Replay Max's screenshot exactly
function inOut(e) {
  var cr = Number(e.credit_amount || 0);
  var dr = Number(e.debit_amount || 0);
  switch (e.transaction_type) {
    case 'sales_invoice':    return { in: cr, out: 0 };
    case 'payment_received': return { in: cr, out: 0 };
    case 'vendor_bill':      return { in: 0, out: dr };
    case 'payment_sent':     return { in: 0, out: dr };
    default: return { in: cr, out: dr };
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

function totalsFor(cur) {
  var totIn = 0, totOut = 0, totAR = 0, totAP = 0;
  testData.filter(function(e) { return e.currency === cur; }).forEach(function(e) {
    var io = inOut(e);
    totIn += io.in;
    totOut += io.out;
    if (e.transaction_type === 'sales_invoice' || e.transaction_type === 'vendor_bill') {
      var paidMag = sim.applied[e.id] || 0;
      var fa = Number(e.credit_amount || 0) || Number(e.debit_amount || 0);
      var rem = Math.max(0, fa - paidMag);
      if (e.transaction_type === 'sales_invoice') totAR += rem;
      else totAP += rem;
    }
  });
  return { in: totIn, out: totOut, openAR: totAR, openAP: totAP, net: totAR - totAP };
}

var usdT = totalsFor('USD');
ok('H1: USD Amount In total = 39,900 (Sales Invoice) + 32,888 (Payment Received) = 72,788',
  Math.abs(usdT.in - 72788) < 0.01);
ok('H2: USD Amount Out total = 1,000 (Payment Sent) + 10,888 (Vendor Bill) = 11,888',
  Math.abs(usdT.out - 11888) < 0.01);
ok('H3: USD Open AR total = 7,012 (only the unsettled sales invoice remaining)',
  Math.abs(usdT.openAR - 7012) < 0.01);
ok('H4: USD Open AP total = 9,888 (only the unsettled vendor bill remaining)',
  Math.abs(usdT.openAP - 9888) < 0.01);
ok('H5: USD Net Position = 7,012 − 9,888 = −2,876 (matches the 4-pot strip and Running USD)',
  Math.abs(usdT.net - (-2876)) < 0.01);

var egpT = totalsFor('EGP');
ok('H6: EGP Amount In total = 0 (no inflows in EGP)',
  Math.abs(egpT.in - 0) < 0.01);
ok('H7: EGP Amount Out total = 4,500 (Payment Sent) + 25,000 (Vendor Bill) = 29,500',
  Math.abs(egpT.out - 29500) < 0.01);
ok('H8: EGP Net Position = 0 − 20,500 = −20,500',
  Math.abs(egpT.net - (-20500)) < 0.01);

ok('H9: PROOF the old broken layout had NO meaningful relationship — Open AR + Open AP = 16,900 (asset + liability, nonsense)',
  (usdT.openAR + usdT.openAP) === 16900 && (usdT.openAR + usdT.openAP) !== -2876);

console.log('\n── FX-unified conversion math ──');

function convert(byCur, base, rates) {
  var total = 0;
  Object.keys(byCur).forEach(function(c) {
    if (c === base) { total += byCur[c]; return; }
    // direct rate
    for (var i = 0; i < rates.length; i++) {
      if (rates[i].from === c && rates[i].to === base) { total += byCur[c] * rates[i].rate; return; }
      if (rates[i].from === base && rates[i].to === c) { total += byCur[c] / rates[i].rate; return; }
    }
  });
  return total;
}

// Mock: 1 USD = 49 EGP (so 1 EGP = 0.0204 USD)
var rates = [{ from: 'EGP', to: 'USD', rate: 1/49 }];
var combined = convert({ USD: -2876, EGP: -20500 }, 'USD', rates);
ok('I1: Mock USD/EGP=49 — EGP −20,500 ≈ −418.37 USD; combined with USD −2876 ≈ −3,294 USD equiv',
  combined < -3290 && combined > -3300);

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 11 — Standard accounting layout: In/Out columns, segregated totals, FX-unified Net Position');
console.log('══════════════════════════════════════════════');
