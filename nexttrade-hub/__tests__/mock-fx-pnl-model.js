/* v55.83-U — FX P&L MODEL VALIDATION (mock data, no DB).
 *
 * Faithfully ports the CORRECTED inventory FX math so the SQL can be trusted:
 *   - At goods ENTRY (receipt finalize): snapshot USD/EGP rate of that day ->
 *     cost_egp_at_receipt (per uom) = landed_cost_per_uom_native * rate(entry_date).
 *   - At SALE: FIFO-consume layers oldest-first. For each consumed slice:
 *       entry EGP cost = qty * layer.cost_egp_at_receipt_per_uom   (locked at purchase)
 *       sale  EGP cost = qty * layer.cost_native_per_uom * rate(invoice_date)
 *   - revenue_egp   = invoice line_total (sales are in EGP)
 *   - real_margin   = revenue_egp - cost_egp_at_receipt          (margin at purchase-date FX)
 *   - realized_fx   = cost_egp_at_receipt - cost_egp_at_sale     (NEG when EGP devalued = FX loss)
 *   - total_gp      = revenue_egp - cost_egp_at_sale = real_margin + realized_fx   <-- identity
 *   - unrealized_fx = cost_egp_at_receipt - today_rate*native_cost_remaining       (on-hand)
 */

function rateForDate(fxRates, from, to, date) {
  // most recent rate on/before date
  var best = null;
  fxRates.forEach(function (r) {
    if (r.from === from && r.to === to && r.date <= date) {
      if (!best || r.date > best.date) best = r;
    }
  });
  return best ? best.rate : null;
}

function finalizeReceipt(receipt, fxRates) {
  // returns a layer with the entry-rate EGP snapshot
  var cur = receipt.currency || 'EGP';
  var rate, egpPerUom;
  if (cur === 'EGP') { rate = 1; egpPerUom = receipt.cost_native_per_uom; }
  else {
    rate = rateForDate(fxRates, cur, 'EGP', receipt.date);
    egpPerUom = rate != null ? receipt.cost_native_per_uom * rate : null;
  }
  return {
    id: receipt.id, product_id: receipt.product_id, date: receipt.date,
    qty_received: receipt.qty, qty_remaining: receipt.qty,
    cost_native_per_uom: receipt.cost_native_per_uom, currency: cur,
    cost_egp_at_receipt_per_uom: egpPerUom, fx_rate_at_receipt: rate,
  };
}

function consumeSale(item, layers, fxRates) {
  // item: { product_id, sale_qty, line_total(EGP), invoice_date }
  var remaining = item.sale_qty;
  var cogs_native = 0, cogs_egp_at_receipt = 0, cogs_egp_at_sale = 0, consumed = 0;
  var slices = [];
  layers.filter(function (l) { return l.product_id === item.product_id && l.qty_remaining > 0; })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
        .forEach(function (l) {
    if (remaining <= 0) return;
    var take = Math.min(l.qty_remaining, remaining);
    var sliceNative = take * l.cost_native_per_uom;
    cogs_native += sliceNative;
    cogs_egp_at_receipt += take * (l.cost_egp_at_receipt_per_uom != null ? l.cost_egp_at_receipt_per_uom : l.cost_native_per_uom);
    var saleRate = (l.currency === 'EGP') ? 1 : rateForDate(fxRates, l.currency, 'EGP', item.invoice_date);
    cogs_egp_at_sale += (saleRate != null) ? sliceNative * saleRate : take * (l.cost_egp_at_receipt_per_uom || 0);
    l.qty_remaining -= take; remaining -= take; consumed += take;
    slices.push({ layer: l.id, qty: take, saleRate: saleRate });
  });
  var revenue = item.line_total;
  var real_margin = revenue - cogs_egp_at_receipt;
  var realized_fx = cogs_egp_at_receipt - cogs_egp_at_sale;
  var total_gp = revenue - cogs_egp_at_sale;
  return { consumed: consumed, backorder: Math.max(0, remaining), cogs_native: cogs_native,
    cogs_egp_at_receipt: cogs_egp_at_receipt, cogs_egp_at_sale: cogs_egp_at_sale,
    revenue: revenue, real_margin: real_margin, realized_fx: realized_fx, total_gp: total_gp, slices: slices };
}

function unrealizedFx(layers, fxRates, todayDate) {
  return layers.filter(function (l) { return l.qty_remaining > 0; }).map(function (l) {
    var atReceipt = l.qty_remaining * (l.cost_egp_at_receipt_per_uom || 0);
    var todayRate = (l.currency === 'EGP') ? 1 : rateForDate(fxRates, l.currency, 'EGP', todayDate);
    var todayValue = (todayRate != null) ? l.qty_remaining * l.cost_native_per_uom * todayRate : atReceipt;
    return { layer: l.id, qty: l.qty_remaining, cost_at_receipt: atReceipt, today_value: todayValue,
             unrealized_fx: atReceipt - todayValue };
  });
}

// ───────────────────────── SCENARIOS ─────────────────────────
var pass = 0, fail = 0;
function approx(a, b) { return Math.abs(a - b) < 0.01; }
function check(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }
function money(n) { return (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// EGP devaluation: 1 USD = 30 -> 40 -> 50 EGP
var fx = [
  { from: 'USD', to: 'EGP', date: '2026-01-01', rate: 30 },
  { from: 'USD', to: 'EGP', date: '2026-03-01', rate: 40 },
  { from: 'USD', to: 'EGP', date: '2026-06-01', rate: 50 },
];

console.log('=== SCENARIO 1: USD-bought goods, EGP devalues, multi-layer FIFO ===');
var layers1 = [
  finalizeReceipt({ id: 'R1', product_id: 'P', date: '2026-01-10', qty: 100, cost_native_per_uom: 10, currency: 'USD' }, fx),
  finalizeReceipt({ id: 'R2', product_id: 'P', date: '2026-03-15', qty: 100, cost_native_per_uom: 12, currency: 'USD' }, fx),
];
check(approx(layers1[0].cost_egp_at_receipt_per_uom, 300), 'R1 entry EGP/uom = 10*30 = 300');
check(approx(layers1[1].cost_egp_at_receipt_per_uom, 480), 'R2 entry EGP/uom = 12*40 = 480');
var s1 = consumeSale({ product_id: 'P', sale_qty: 150, line_total: 105000, invoice_date: '2026-06-05' }, layers1, fx);
console.log('  Revenue (EGP):            ' + money(s1.revenue));
console.log('  COGS @ receipt (EGP):     ' + money(s1.cogs_egp_at_receipt) + '   <- real EGP cost, locked at purchase');
console.log('  COGS @ sale-rate (EGP):   ' + money(s1.cogs_egp_at_sale) + '   <- same goods valued at sale-day rate');
console.log('  REAL MARGIN:              ' + money(s1.real_margin));
console.log('  REALIZED FX gain/(loss):  ' + money(s1.realized_fx));
console.log('  GROSS PROFIT (sale FX):   ' + money(s1.total_gp));
check(approx(s1.cogs_native, 1600), 'native COGS = 100*10+50*12 = $1600');
check(approx(s1.cogs_egp_at_receipt, 54000), 'EGP COGS @ receipt = 100*300+50*480 = 54,000');
check(approx(s1.cogs_egp_at_sale, 80000), 'EGP COGS @ sale = 1600*50 = 80,000');
check(approx(s1.real_margin, 51000), 'real margin = 105,000-54,000 = 51,000');
check(approx(s1.realized_fx, -26000), 'realized FX = 54,000-80,000 = -26,000 (devaluation = FX loss)');
check(approx(s1.total_gp, 25000), 'gross profit @ sale FX = 105,000-80,000 = 25,000');
check(approx(s1.real_margin + s1.realized_fx, s1.total_gp), 'IDENTITY: real_margin + realized_fx == total_gp');

console.log('\n=== SCENARIO 2: EGP-bought goods (no FX exposure) ===');
var layers2 = [ finalizeReceipt({ id: 'E1', product_id: 'Q', date: '2026-02-01', qty: 50, cost_native_per_uom: 200, currency: 'EGP' }, fx) ];
var s2 = consumeSale({ product_id: 'Q', sale_qty: 40, line_total: 12000, invoice_date: '2026-06-05' }, layers2, fx);
check(approx(s2.cogs_egp_at_receipt, 8000), 'EGP COGS = 40*200 = 8,000');
check(approx(s2.realized_fx, 0), 'EGP goods have ZERO realized FX');
check(approx(s2.total_gp, s2.real_margin), 'EGP goods: gross profit == real margin');
console.log('  Real margin = Gross profit = ' + money(s2.total_gp) + ', FX = ' + money(s2.realized_fx));

console.log('\n=== SCENARIO 3: EGP STRENGTHENS after purchase (FX gain) ===');
var fx3 = [ { from: 'USD', to: 'EGP', date: '2026-01-01', rate: 50 }, { from: 'USD', to: 'EGP', date: '2026-06-01', rate: 40 } ];
var layers3 = [ finalizeReceipt({ id: 'S1', product_id: 'R', date: '2026-01-10', qty: 10, cost_native_per_uom: 100, currency: 'USD' }, fx3) ];
var s3 = consumeSale({ product_id: 'R', sale_qty: 10, line_total: 60000, invoice_date: '2026-06-05' }, layers3, fx3);
check(approx(s3.cogs_egp_at_receipt, 50000), 'entry EGP COGS = 10*100*50 = 50,000');
check(approx(s3.cogs_egp_at_sale, 40000), 'sale EGP COGS = 10*100*40 = 40,000');
check(approx(s3.realized_fx, 10000), 'realized FX = 50,000-40,000 = +10,000 (EGP strengthened = FX gain)');
check(approx(s3.real_margin + s3.realized_fx, s3.total_gp), 'IDENTITY holds for FX gain too');
console.log('  Real margin ' + money(s3.real_margin) + ' + FX ' + money(s3.realized_fx) + ' = GP ' + money(s3.total_gp));

console.log('\n=== SCENARIO 4: UNREALIZED FX on stock still on hand ===');
// scenario 1 left 50 units of R2 on hand (bought @ $12, rate 40 -> 480/uom)
var u = unrealizedFx(layers1, fx, '2026-06-05'); // today rate 50
var r2OnHand = u.find(function (x) { return x.layer === 'R2'; });
check(r2OnHand && approx(r2OnHand.qty, 50), 'R2 has 50 units on hand after Scenario 1 sale');
check(r2OnHand && approx(r2OnHand.cost_at_receipt, 24000), 'on-hand cost @ receipt = 50*480 = 24,000');
check(r2OnHand && approx(r2OnHand.today_value, 30000), 'on-hand today value = 50*12*50 = 30,000');
check(r2OnHand && approx(r2OnHand.unrealized_fx, -6000), 'unrealized FX = 24,000-30,000 = -6,000 (would cost 6k more EGP today)');
console.log('  On-hand R2: cost@receipt ' + money(r2OnHand.cost_at_receipt) + ', today ' + money(r2OnHand.today_value) + ', unrealized FX ' + money(r2OnHand.unrealized_fx));

console.log('\n=== SCENARIO 5: backorder (sold more than stock) ===');
var layers5 = [ finalizeReceipt({ id: 'B1', product_id: 'Z', date: '2026-01-10', qty: 5, cost_native_per_uom: 10, currency: 'USD' }, fx) ];
var s5 = consumeSale({ product_id: 'Z', sale_qty: 8, line_total: 8000, invoice_date: '2026-06-05' }, layers5, fx);
check(approx(s5.consumed, 5) && approx(s5.backorder, 3), 'consumed 5, backorder 3');
check(approx(s5.cogs_egp_at_receipt, 1500), 'COGS only for the 5 in stock = 5*10*30 = 1,500');

console.log('\n──────────────────────────────────────────');
console.log('FX P&L model: ' + pass + ' checks passed, ' + fail + ' failed');
if (fail > 0) { console.log('MODEL INVALID'); process.exit(1); }
console.log('ALL IDENTITIES HOLD — math is sound. SQL must mirror this exactly.');
