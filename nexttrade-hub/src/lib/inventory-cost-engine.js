// v55.83-A.6.27 (Max May 14 2026) — Inventory cost engine
//
// Three responsibilities:
//   1. ROLLUP — sum all cost components on a shipment, convert each to USD
//      and EGP using locked FX, allocate across SKUs by qty/kg/value, write
//      back to inv_shipment_skus, and create one inv_layer per SKU line.
//   2. CONSUME — FIFO drain layers when a sale movement is created. Returns
//      the consumed_layers array (which layer(s) and how much from each)
//      plus the weighted COGS.
//   3. RESTATE — when a layer's cost is changed AFTER sales have drained
//      from it, recompute COGS on every affected invoice_item and write a
//      cost_adjustment audit row.
//
// var + concatenation, no template literals (Vercel SWC).

import { supabase } from './supabase';
import { convert as fxConvert, getFxRate } from './inventory-fx';

// Cost components on a shipment row that get summed.
var COST_COMPONENTS = [
  'purchase_cost',
  'freight_cost',
  'customs_cost',
  'port_fees',
  'inland_transport',
  'handling_fees',
  'other_charges',
];

// ─────────────────────────────────────────────────────────────────────────
// ROLLUP
// ─────────────────────────────────────────────────────────────────────────

// Sum cost components into USD + EGP totals.
// Returns: { totalUsd, totalEgp, breakdown: [{component, amount, ccy, usd, egp}], fxUsdToEgp, fxSource }
// If anything fails, returns { error: 'message' }.
//
// shipment: full inv_shipments row
// fxOverride: optional { rate, source } to skip API and use this rate directly
export async function rollupShipmentCost(shipment, fxOverride) {
  if (!shipment) return { error: 'shipment is required' };

  var shipDate = shipment.received_date || shipment.arrival_date || shipment.eta_date
    || new Date().toISOString().substring(0, 10);
  var baseCcy = shipment.purchase_currency || 'USD';

  // Get USD→EGP rate (always needed since we store both)
  var fxUsdToEgp;
  var fxSource;
  if (fxOverride && fxOverride.rate) {
    fxUsdToEgp = Number(fxOverride.rate);
    fxSource = fxOverride.source || 'manual';
  } else {
    var rateResp = await getFxRate(shipDate, 'USD', 'EGP');
    if (!rateResp) {
      return { error: 'Could not get USD→EGP rate for ' + shipDate + '. Enter manually.' };
    }
    fxUsdToEgp = rateResp.rate;
    fxSource = rateResp.source;
  }

  // Sum components, converting each to USD.
  var totalUsd = 0;
  var breakdown = [];
  for (var i = 0; i < COST_COMPONENTS.length; i++) {
    var component = COST_COMPONENTS[i];
    var amount = Number(shipment[component] || 0);
    if (amount <= 0) continue;
    var usdAmount;
    if (baseCcy === 'USD') {
      usdAmount = amount;
    } else {
      var conv = await fxConvert(amount, baseCcy, 'USD', shipDate);
      if (!conv) {
        return { error: 'FX conversion failed: ' + amount + ' ' + baseCcy + ' → USD on ' + shipDate };
      }
      usdAmount = conv.converted;
    }
    var egpAmount = usdAmount * fxUsdToEgp;
    totalUsd += usdAmount;
    breakdown.push({
      component: component,
      amount: amount,
      currency: baseCcy,
      usd: usdAmount,
      egp: egpAmount,
    });
  }

  return {
    totalUsd: totalUsd,
    totalEgp: totalUsd * fxUsdToEgp,
    breakdown: breakdown,
    fxUsdToEgp: fxUsdToEgp,
    fxSource: fxSource,
    shipDate: shipDate,
  };
}

// Allocate a shipment's total landed cost across SKU lines.
// method: 'by_qty' | 'by_kg' | 'by_value'
// Returns: { allocations: [{ line, usd, egp, unitUsd, unitEgp }], error? }
export function allocateAcrossSkus(totalUsd, totalEgp, lineItems, method) {
  if (!lineItems || lineItems.length === 0) {
    return { error: 'no SKU lines to allocate to' };
  }
  var key;
  if (method === 'by_kg') key = 'qty_kg';
  else if (method === 'by_value') key = '__purchase_value__';   // computed inline
  else key = 'qty_primary';   // default 'by_qty'

  // Total basis
  var totalBasis = 0;
  var basisPerLine = [];
  for (var i = 0; i < lineItems.length; i++) {
    var li = lineItems[i];
    var basis;
    if (method === 'by_value') {
      // unit purchase price × qty — if unit price not set, fall back to qty
      var unitPrice = Number(li.unit_purchase_cost || 0);
      basis = unitPrice > 0 ? unitPrice * Number(li.qty_primary || 0) : Number(li.qty_primary || 0);
    } else {
      basis = Number(li[key] || 0);
    }
    if (basis <= 0 && method !== 'by_qty') {
      // Fall back to qty for this specific line if its basis is missing
      basis = Number(li.qty_primary || 0);
    }
    basisPerLine.push(basis);
    totalBasis += basis;
  }
  if (totalBasis <= 0) {
    return { error: 'all lines have zero basis for method ' + method };
  }

  var allocations = lineItems.map(function (li, idx) {
    var share = basisPerLine[idx] / totalBasis;
    var usd = totalUsd * share;
    var egp = totalEgp * share;
    var qty = Number(li.qty_primary || 0);
    return {
      line: li,
      usd: usd,
      egp: egp,
      unitUsd: qty > 0 ? usd / qty : 0,
      unitEgp: qty > 0 ? egp / qty : 0,
    };
  });

  return { allocations: allocations };
}

// Finalize a shipment: rollup → allocate → write back to shipment + shipment_skus
// + create inv_layers (or update if they already exist as provisional).
// Returns: { ok: true, layersCreated, layersUpdated } | { error: '...' }
export async function finalizeShipmentCost(shipment, lineItems, options, userId) {
  options = options || {};
  var method = options.allocation_method || shipment.allocation_method || 'by_qty';
  var fxOverride = options.fxOverride;

  var rollup = await rollupShipmentCost(shipment, fxOverride);
  if (rollup.error) return rollup;

  var alloc = allocateAcrossSkus(rollup.totalUsd, rollup.totalEgp, lineItems, method);
  if (alloc.error) return alloc;

  // Update shipment header
  var nowIso = new Date().toISOString();
  var shipUpdate = await supabase.from('inv_shipments').update({
    total_landed_cost_usd: rollup.totalUsd,
    total_landed_cost_egp: rollup.totalEgp,
    fx_usd_to_egp: rollup.fxUsdToEgp,
    fx_source: rollup.fxSource,
    fx_locked_at: nowIso,
    allocation_method: method,
    cost_finalized_at: nowIso,
    cost_finalized_by: userId,
  }).eq('id', shipment.id);
  if (shipUpdate.error) return { error: 'shipment update failed: ' + shipUpdate.error.message };

  // Update each line + ensure a layer exists for each line.
  var layersCreated = 0;
  var layersUpdated = 0;
  var restatedAdjustments = [];

  for (var i = 0; i < alloc.allocations.length; i++) {
    var a = alloc.allocations[i];
    var li = a.line;

    // Write allocation back to the line
    var liUpdate = await supabase.from('inv_shipment_skus').update({
      allocated_cost_usd: a.usd,
      allocated_cost_egp: a.egp,
      landed_unit_cost_usd: a.unitUsd,
      landed_unit_cost_egp: a.unitEgp,
    }).eq('id', li.id);
    if (liUpdate.error) {
      // Log but continue — partial success is better than nothing
      console.warn('[finalize] line update failed for', li.id, liUpdate.error.message);
    }

    // Find existing layer for this shipment_sku
    var existingLayer = await supabase.from('inv_layers')
      .select('*')
      .eq('source_shipment_sku_id', li.id)
      .maybeSingle();

    if (existingLayer.data) {
      // Layer exists — this is a re-finalize or cost adjustment.
      // If the layer's cost changed AND sales have already consumed from it,
      // create a cost_adjustment row + restate affected COGS.
      var oldUnitUsd = Number(existingLayer.data.landed_unit_cost_usd || 0);
      if (Math.abs(oldUnitUsd - a.unitUsd) > 0.0001) {
        // Restate
        var restateResult = await restateCostForLayer(
          existingLayer.data, a.unitUsd, a.unitEgp, rollup.fxUsdToEgp, userId
        );
        if (restateResult.adjustment) restatedAdjustments.push(restateResult.adjustment);
      }
      // Update the layer cost
      var layerUpdate = await supabase.from('inv_layers').update({
        landed_unit_cost_usd: a.unitUsd,
        landed_unit_cost_egp: a.unitEgp,
        fx_usd_to_egp: rollup.fxUsdToEgp,
        cost_is_provisional: false,
        finalized_at: nowIso,
      }).eq('id', existingLayer.data.id);
      if (!layerUpdate.error) layersUpdated++;
    } else {
      // Create new layer
      var layerInsert = await supabase.from('inv_layers').insert({
        sku_id: li.sku_id,
        warehouse_id: li.warehouse_id || shipment.warehouse_id,
        source_shipment_id: shipment.id,
        source_shipment_sku_id: li.id,
        qty_received: Number(li.qty_primary || 0),
        qty_remaining: Number(li.qty_primary || 0),
        landed_unit_cost_usd: a.unitUsd,
        landed_unit_cost_egp: a.unitEgp,
        fx_usd_to_egp: rollup.fxUsdToEgp,
        cost_is_provisional: false,
        received_at: shipment.received_date || rollup.shipDate,
        finalized_at: nowIso,
      });
      if (!layerInsert.error) layersCreated++;
    }
  }

  return {
    ok: true,
    rollup: rollup,
    allocations: alloc.allocations,
    layersCreated: layersCreated,
    layersUpdated: layersUpdated,
    restatedAdjustments: restatedAdjustments,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CONSUME (FIFO drain on sale)
// ─────────────────────────────────────────────────────────────────────────

// Drain `qty` of `skuId` from `warehouseId` (or any warehouse if null).
// FIFO: oldest received_at, oldest created_at as tiebreaker.
// Returns: {
//   consumed: [{layer_id, qty, unit_cost_usd, unit_cost_egp}],
//   weightedUnitUsd, weightedUnitEgp,
//   totalCogsUsd, totalCogsEgp,
//   shortfall  // qty we couldn't fulfill (no stock)
// }
//
// IMPORTANT: This function writes to inv_layers (decrements qty_remaining).
// Caller is responsible for creating the inv_movements row.
export async function consumeFifo(skuId, warehouseId, qtyToConsume) {
  qtyToConsume = Number(qtyToConsume);
  if (!qtyToConsume || qtyToConsume <= 0) {
    return { error: 'qtyToConsume must be > 0' };
  }
  if (!skuId) return { error: 'skuId required' };

  // Get available layers, oldest first
  var q = supabase.from('inv_layers')
    .select('*')
    .eq('sku_id', skuId)
    .gt('qty_remaining', 0)
    .order('received_at', { ascending: true })
    .order('created_at', { ascending: true });
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);

  var resp = await q;
  if (resp.error) return { error: resp.error.message };
  var layers = resp.data || [];

  var consumed = [];
  var remaining = qtyToConsume;
  var totalCogsUsd = 0;
  var totalCogsEgp = 0;

  for (var i = 0; i < layers.length && remaining > 0; i++) {
    var L = layers[i];
    var take = Math.min(remaining, Number(L.qty_remaining));
    var uUsd = Number(L.landed_unit_cost_usd || 0);
    var uEgp = Number(L.landed_unit_cost_egp || 0);

    consumed.push({
      layer_id: L.id,
      qty: take,
      unit_cost_usd: uUsd,
      unit_cost_egp: uEgp,
      cost_was_provisional: !!L.cost_is_provisional,
    });
    totalCogsUsd += take * uUsd;
    totalCogsEgp += take * uEgp;
    remaining -= take;

    // Decrement layer qty_remaining
    var newRemaining = Number(L.qty_remaining) - take;
    var upd = await supabase.from('inv_layers').update({
      qty_remaining: newRemaining,
    }).eq('id', L.id);
    if (upd.error) {
      // Best effort — if a layer update fails, undo what we did so caller can retry cleanly
      console.warn('[consume] layer drain failed for', L.id, upd.error.message);
      // Rollback already-drained layers
      for (var j = 0; j < consumed.length - 1; j++) {
        var c = consumed[j];
        var rollbackLayer = layers[j];
        await supabase.from('inv_layers').update({
          qty_remaining: Number(rollbackLayer.qty_remaining),
        }).eq('id', c.layer_id);
      }
      return { error: 'layer drain failed: ' + upd.error.message };
    }
  }

  var totalDrained = qtyToConsume - remaining;
  return {
    consumed: consumed,
    weightedUnitUsd: totalDrained > 0 ? totalCogsUsd / totalDrained : 0,
    weightedUnitEgp: totalDrained > 0 ? totalCogsEgp / totalDrained : 0,
    totalCogsUsd: totalCogsUsd,
    totalCogsEgp: totalCogsEgp,
    qtyDrained: totalDrained,
    shortfall: remaining,
  };
}

// Reverse a FIFO consumption — used when an invoice line is deleted or its
// qty is reduced. Returns qty back to each layer per the original consumed_layers.
export async function reverseFifoConsumption(consumedLayers) {
  if (!consumedLayers || !Array.isArray(consumedLayers)) {
    return { error: 'consumedLayers must be an array' };
  }
  var reversed = [];
  for (var i = 0; i < consumedLayers.length; i++) {
    var c = consumedLayers[i];
    var layer = await supabase.from('inv_layers').select('qty_remaining').eq('id', c.layer_id).maybeSingle();
    if (!layer.data) continue;
    var newRemaining = Number(layer.data.qty_remaining) + Number(c.qty);
    var upd = await supabase.from('inv_layers').update({
      qty_remaining: newRemaining,
    }).eq('id', c.layer_id);
    if (!upd.error) reversed.push({ layer_id: c.layer_id, returned: c.qty });
  }
  return { reversed: reversed };
}

// ─────────────────────────────────────────────────────────────────────────
// RESTATE (cost adjustment on a layer that's already been consumed)
// ─────────────────────────────────────────────────────────────────────────

// Recompute COGS on every movement that drained from this layer, then update
// the linked invoice_items.cogs_usd/cogs_egp. Writes an audit row.
async function restateCostForLayer(oldLayer, newUnitUsd, newUnitEgp, newFx, userId) {
  // Find all sale movements that include this layer in consumed_layers
  var movsResp = await supabase.from('inv_movements')
    .select('id, consumed_layers, total_cost_usd, total_cost_egp, linked_invoice_item_id, qty_change')
    .eq('movement_type', 'sale')
    .not('consumed_layers', 'is', null);
  if (movsResp.error) return { error: movsResp.error.message };

  var affectedIds = [];
  var totalDeltaUsd = 0;
  var totalDeltaEgp = 0;
  var oldUnitUsd = Number(oldLayer.landed_unit_cost_usd || 0);

  for (var i = 0; i < (movsResp.data || []).length; i++) {
    var m = movsResp.data[i];
    var layers = m.consumed_layers || [];
    if (!Array.isArray(layers)) continue;
    var touched = false;
    var newTotalUsd = 0;
    var newTotalEgp = 0;
    var updatedLayersArr = layers.map(function (cl) {
      if (cl.layer_id === oldLayer.id) {
        touched = true;
        newTotalUsd += Number(cl.qty) * newUnitUsd;
        newTotalEgp += Number(cl.qty) * newUnitEgp;
        return Object.assign({}, cl, {
          unit_cost_usd: newUnitUsd,
          unit_cost_egp: newUnitEgp,
          restated_at: new Date().toISOString(),
        });
      }
      newTotalUsd += Number(cl.qty) * Number(cl.unit_cost_usd || 0);
      newTotalEgp += Number(cl.qty) * Number(cl.unit_cost_egp || 0);
      return cl;
    });
    if (!touched) continue;

    var deltaUsd = newTotalUsd - Number(m.total_cost_usd || 0);
    var deltaEgp = newTotalEgp - Number(m.total_cost_egp || 0);
    totalDeltaUsd += deltaUsd;
    totalDeltaEgp += deltaEgp;
    affectedIds.push(m.id);

    // Update movement
    await supabase.from('inv_movements').update({
      consumed_layers: updatedLayersArr,
      total_cost_usd: newTotalUsd,
      total_cost_egp: newTotalEgp,
      unit_cost_usd: Number(m.qty_change) !== 0 ? newTotalUsd / Math.abs(Number(m.qty_change)) : 0,
      unit_cost_egp: Number(m.qty_change) !== 0 ? newTotalEgp / Math.abs(Number(m.qty_change)) : 0,
    }).eq('id', m.id);

    // Restate the linked invoice_item
    if (m.linked_invoice_item_id) {
      await supabase.from('invoice_items').update({
        cogs_usd: newTotalUsd,
        cogs_egp: newTotalEgp,
      }).eq('id', m.linked_invoice_item_id);
    }
  }

  // Write audit row
  var adj = null;
  if (affectedIds.length > 0 || Math.abs(newUnitUsd - oldUnitUsd) > 0.0001) {
    var adjInsert = await supabase.from('inv_cost_adjustments').insert({
      layer_id: oldLayer.id,
      shipment_id: oldLayer.source_shipment_id,
      field_changed: 'landed_unit_cost_usd',
      old_value: oldUnitUsd,
      new_value: newUnitUsd,
      delta: newUnitUsd - oldUnitUsd,
      affected_movement_ids: affectedIds.length > 0 ? affectedIds : null,
      total_cogs_delta_usd: totalDeltaUsd,
      total_cogs_delta_egp: totalDeltaEgp,
      reason: 'Layer cost finalized/adjusted after sales had already drained from it',
      adjusted_by: userId,
    }).select().single();
    if (!adjInsert.error) adj = adjInsert.data;
  }

  return { adjustment: adj, affectedMovementCount: affectedIds.length, totalDeltaUsd: totalDeltaUsd, totalDeltaEgp: totalDeltaEgp };
}
