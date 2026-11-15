// v55.83-A.6.27.33 — Inventory Phase 1 cost engine
//
// Pure functions that compute landed-cost rollups and per-line allocations
// for the new inventory_stock_receipts / inventory_landed_costs tables.
// No DB calls here — that lives in InventoryFinalizeCostDialog. Reuses
// getFxRate from inventory-fx.js for USD→EGP conversion.

import { getFxRate } from './inventory-fx';
import { supabase } from './supabase';

var SUPPORTED = ['EGP', 'USD', 'EUR'];

// Convert any supported currency amount to EGP given a USD→EGP rate.
// For EUR we assume EUR ≈ USD for now (Build 4.2 v1 — real EUR→EGP rate
// can be added later if Max imports EU goods regularly).
export function toEgp(amount, currency, usdToEgp) {
  var a = Number(amount);
  if (!a || isNaN(a)) return 0;
  if (currency === 'EGP') return a;
  if (currency === 'USD') return a * Number(usdToEgp || 0);
  if (currency === 'EUR') return a * Number(usdToEgp || 0); // approximation
  return 0;
}

// Convert EGP to USD
export function toUsd(amountEgp, usdToEgp) {
  var a = Number(amountEgp);
  var r = Number(usdToEgp);
  if (!a || isNaN(a) || !r || isNaN(r) || r === 0) return 0;
  return a / r;
}

// Roll up all cost components into a {usd, egp} total
export function rollupCosts(components, usdToEgp) {
  var totalEgp = 0;
  if (!components || !usdToEgp) return { totalEgp: 0, totalUsd: 0 };
  ['freight', 'customs_duty', 'insurance', 'clearing', 'local_transport', 'other'].forEach(function (k) {
    var amount = components[k + '_amount'];
    var currency = components[k + '_currency'];
    if (amount && currency && SUPPORTED.indexOf(currency) >= 0) {
      totalEgp += toEgp(amount, currency, usdToEgp);
    }
  });
  return {
    totalEgp: totalEgp,
    totalUsd: toUsd(totalEgp, usdToEgp),
  };
}

// Compute base purchase cost (sum of line cost_per_uom × quantity) across all
// lines of the shipment. Used as the "value" basis for by_value allocation
// and shown in the dialog so user knows what they're allocating ON TOP OF.
export function rollupBasePurchase(lines) {
  var total = 0;
  var currency = null;
  if (!lines || !lines.length) return { totalEgp: 0, currency: null };
  lines.forEach(function (L) {
    var qty = Number(L.quantity || 0);
    var cost = Number(L.cost_per_uom || 0);
    if (qty && cost) {
      total += qty * cost;
      if (!currency && L.currency) currency = L.currency;
    }
  });
  return { totalEgp: total, currency: currency };
}

// Allocate the total landed-cost EGP across lines using the chosen method.
// Returns array of { line, allocated_egp, landed_per_uom, landed_total }.
export function allocateLandedCost(lines, totalLandedEgp, method) {
  if (!lines || !lines.length) return [];
  method = method || 'by_qty';

  // Determine the "basis" amount per line based on method
  function basisOf(L) {
    if (method === 'by_qty') return Number(L.quantity || 0);
    if (method === 'by_kg') {
      // Prefer explicit quantity_kg; if missing, fall back to quantity if
      // UOM is already kg. Otherwise 0 (line gets no allocation by this method).
      var kg = Number(L.quantity_kg || 0);
      if (kg > 0) return kg;
      if ((L.uom || '').toLowerCase() === 'kg') return Number(L.quantity || 0);
      return 0;
    }
    if (method === 'by_value') {
      var qty = Number(L.quantity || 0);
      var cost = Number(L.cost_per_uom || 0);
      return qty * cost;
    }
    return 0;
  }

  var totalBasis = 0;
  lines.forEach(function (L) { totalBasis += basisOf(L); });

  // If total basis is 0 (e.g. by_kg with no kg values), fall back to equal split
  var fallbackEqual = totalBasis === 0;
  var equalShare = fallbackEqual ? (Number(totalLandedEgp || 0) / lines.length) : 0;

  return lines.map(function (L) {
    var allocated;
    if (fallbackEqual) {
      allocated = equalShare;
    } else {
      var b = basisOf(L);
      allocated = (b / totalBasis) * Number(totalLandedEgp || 0);
    }
    var qty = Number(L.quantity || 0);
    var baseCostTotal = qty * Number(L.cost_per_uom || 0);
    var grandTotal = baseCostTotal + allocated;
    var perUom = qty > 0 ? grandTotal / qty : 0;
    return {
      line: L,
      basis: basisOf(L),
      allocated_landed_egp: allocated,
      base_cost_total: baseCostTotal,
      landed_total: grandTotal,
      landed_per_uom: perUom,
    };
  });
}

// Compute everything needed for the preview UI in one call.
export function computeFinalization(components, lines, usdToEgp, allocationMethod) {
  var rollup = rollupCosts(components, usdToEgp);
  var basePurchase = rollupBasePurchase(lines);
  var allocations = allocateLandedCost(lines, rollup.totalEgp, allocationMethod);
  return {
    totalLandedEgp: rollup.totalEgp,
    totalLandedUsd: rollup.totalUsd,
    basePurchaseEgp: basePurchase.totalEgp,
    grandTotalEgp: basePurchase.totalEgp + rollup.totalEgp,
    allocations: allocations,
  };
}

// Fetch the FX rate for a given date with the chosen base/quote pair.
// Default base=USD, quote=EGP. Reuses the existing getFxRate helper.
export async function getRateForDate(date) {
  if (!date) date = new Date().toISOString().substring(0, 10);
  // v55.83-A (Max Jun 1 2026) — read the SAME fx_rates table the dashboard FX panel
  // writes to (was previously looking at inv_fx_rates and always failing). Strategy:
  //   1. exact rate for this date,  2. most recent rate ON OR BEFORE this date,
  //   3. most recent rate of any date,  4. legacy engine fallback.
  try {
    // 1) exact date
    var exact = await supabase.from('fx_rates')
      .select('rate, rate_date, source')
      .eq('from_currency', 'USD').eq('to_currency', 'EGP')
      .eq('rate_date', date).limit(1);
    if (exact && exact.data && exact.data.length > 0) {
      return { rate: Number(exact.data[0].rate), source: exact.data[0].source || 'dashboard (' + date + ')' };
    }
    // 2) most recent on or before the receipt date
    var onBefore = await supabase.from('fx_rates')
      .select('rate, rate_date, source')
      .eq('from_currency', 'USD').eq('to_currency', 'EGP')
      .lte('rate_date', date)
      .order('rate_date', { ascending: false }).limit(1);
    if (onBefore && onBefore.data && onBefore.data.length > 0) {
      var r2 = onBefore.data[0];
      return { rate: Number(r2.rate), source: (r2.source || 'dashboard') + ' (as of ' + r2.rate_date + ')' };
    }
    // 3) most recent of any date (e.g. only future-dated rates exist)
    var anyRate = await supabase.from('fx_rates')
      .select('rate, rate_date, source')
      .eq('from_currency', 'USD').eq('to_currency', 'EGP')
      .order('rate_date', { ascending: false }).limit(1);
    if (anyRate && anyRate.data && anyRate.data.length > 0) {
      var r3 = anyRate.data[0];
      return { rate: Number(r3.rate), source: (r3.source || 'dashboard') + ' (latest ' + r3.rate_date + ')' };
    }
  } catch (e1) { /* fall through to legacy engine */ }
  // 4) legacy engine fallback (inv_fx_rates / API)
  try {
    var r = await getFxRate(date, 'USD', 'EGP');
    return r;
  } catch (err) {
    return null;
  }
}
