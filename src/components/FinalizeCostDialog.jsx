// v55.83-A.6.27 (Max May 14 2026) — Stage C UI: finalize landed cost.
//
// When a shipment is 'received' and the user clicks "Finalize Landed Cost",
// this dialog opens:
//   1. Pulls FX (USD→EGP) from API for the receipt date
//   2. Sums all cost components → converts → shows USD + EGP totals
//   3. User picks allocation method (by qty / by kg / by value)
//   4. Preview shows per-SKU allocated cost + unit cost
//   5. User can override FX rate before confirming
//   6. On confirm: writes back to inv_shipment_skus + creates inv_layers
//
// If sales had already drained from provisional layers, the finalize writes
// a cost_adjustment row + restates COGS on those sales — and the dialog
// shows a summary of "X invoice lines were restated, total COGS change: $Y".

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { getFxRate, saveManualRate } from '../lib/inventory-fx';
import { rollupShipmentCost, allocateAcrossSkus, finalizeShipmentCost } from '../lib/inventory-cost-engine';

function fmt(n, dec) {
  if (n == null || isNaN(Number(n))) return '—';
  dec = dec == null ? 2 : dec;
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function FinalizeCostDialog({ shipment, lineItems, userId, toast, onClose, onFinalized }) {
  var [method, setMethod] = useState(shipment.allocation_method || 'by_qty');
  var [fxRate, setFxRate] = useState(shipment.fx_usd_to_egp || null);
  var [fxSource, setFxSource] = useState(shipment.fx_source || null);
  var [fxLoading, setFxLoading] = useState(false);
  var [fxOverrideMode, setFxOverrideMode] = useState(false);
  var [fxOverrideValue, setFxOverrideValue] = useState('');
  var [rollup, setRollup] = useState(null);
  var [allocations, setAllocations] = useState([]);
  var [rollupError, setRollupError] = useState(null);
  var [working, setWorking] = useState(false);

  // Initial FX fetch
  useEffect(function () {
    var cancelled = false;
    async function loadFx() {
      setFxLoading(true);
      var shipDate = shipment.received_date || shipment.arrival_date || shipment.eta_date
        || new Date().toISOString().substring(0, 10);
      var r = await getFxRate(shipDate, 'USD', 'EGP');
      if (cancelled) return;
      if (r) {
        setFxRate(r.rate);
        setFxSource(r.source);
        setFxOverrideValue(String(r.rate));
      } else {
        setRollupError('Could not fetch USD→EGP rate. Enter manually below.');
        setFxOverrideMode(true);
      }
      setFxLoading(false);
    }
    loadFx();
    return function () { cancelled = true; };
  }, [shipment.id]);

  // Recompute rollup + allocations whenever fxRate or method changes
  useEffect(function () {
    if (!fxRate) return;
    var cancelled = false;
    async function compute() {
      var r = await rollupShipmentCost(shipment, { rate: fxRate, source: fxSource || 'manual' });
      if (cancelled) return;
      if (r.error) {
        setRollupError(r.error);
        setRollup(null);
        setAllocations([]);
        return;
      }
      setRollupError(null);
      setRollup(r);
      var a = allocateAcrossSkus(r.totalUsd, r.totalEgp, lineItems || [], method);
      if (a.error) {
        setRollupError(a.error);
        setAllocations([]);
        return;
      }
      setAllocations(a.allocations);
    }
    compute();
    return function () { cancelled = true; };
  }, [fxRate, fxSource, method, shipment.id, lineItems]);

  async function applyOverride() {
    var v = Number(fxOverrideValue);
    if (!v || v <= 0) {
      toast && toast.error && toast.error('Enter a positive FX rate');
      return;
    }
    var shipDate = shipment.received_date || shipment.arrival_date || shipment.eta_date
      || new Date().toISOString().substring(0, 10);
    var saved = await saveManualRate(shipDate, 'USD', 'EGP', v, userId);
    if (saved) {
      setFxRate(saved.rate);
      setFxSource('manual');
      setFxOverrideMode(false);
      toast && toast.success && toast.success('FX rate locked at ' + v + ' (manual)');
    } else {
      toast && toast.error && toast.error('Could not save manual FX rate');
    }
  }

  async function confirmFinalize() {
    if (!fxRate || rollupError) {
      toast && toast.error && toast.error('Resolve FX/rollup issues before confirming');
      return;
    }
    if (!allocations.length) {
      toast && toast.error && toast.error('No SKU lines to allocate to. Add line items first.');
      return;
    }
    if (!confirm('Finalize landed cost? This locks the cost basis for these ' + allocations.length + ' SKU(s). Any sales already drained from these layers will have their COGS restated.')) return;

    setWorking(true);
    try {
      var result = await finalizeShipmentCost(shipment, lineItems, {
        allocation_method: method,
        fxOverride: { rate: fxRate, source: fxSource || 'manual' },
      }, userId);
      if (result.error) {
        toast && toast.error && toast.error('Finalize failed: ' + result.error);
        setWorking(false);
        return;
      }
      var msg = 'Landed cost finalized. ' + (result.layersCreated || 0) + ' layer(s) created, ' + (result.layersUpdated || 0) + ' updated.';
      if (result.restatedAdjustments && result.restatedAdjustments.length > 0) {
        msg += ' ' + result.restatedAdjustments.length + ' cost adjustment(s) recorded — prior sales restated.';
      }
      toast && toast.success && toast.success(msg);
      if (onFinalized) await onFinalized();
      if (onClose) onClose();
    } catch (e) {
      toast && toast.error && toast.error('Finalize error: ' + (e && e.message ? e.message : e));
    }
    setWorking(false);
  }

  var ccy = shipment.purchase_currency || 'USD';
  var isReadyToFinalize = !!fxRate && !rollupError && allocations.length > 0 && rollup && rollup.totalUsd > 0;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex justify-between items-start sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-extrabold">💰 Finalize Landed Cost</h2>
            <div className="text-[11px] text-slate-600">{shipment.shipment_ref} · {shipment.supplier_name || 'no supplier'}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 text-2xl leading-none">×</button>
        </div>

        {/* FX rate block */}
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-700 mb-2">🌐 FX Rate (USD → EGP)</h3>
          {fxLoading ? (
            <div className="text-xs text-slate-500">⏳ Fetching from exchangerate.host…</div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-slate-500">Rate:</span>
                <span className="font-mono font-bold text-sm text-slate-900">{fxRate ? fmt(fxRate, 4) : '—'}</span>
                {fxSource && (
                  <span className={'text-[10px] px-2 py-0.5 rounded ' + (fxSource === 'manual' ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-900')}>
                    {fxSource === 'manual' ? '✏️ manual override' : '🌐 ' + fxSource}
                  </span>
                )}
                <button onClick={function () { setFxOverrideMode(!fxOverrideMode); }}
                  className="text-[10px] text-blue-600 hover:underline ml-auto">
                  {fxOverrideMode ? 'Cancel override' : 'Override rate'}
                </button>
              </div>
              {fxOverrideMode && (
                <div className="flex gap-2 items-center bg-amber-50 border border-amber-200 rounded p-2">
                  <input type="number" step="0.0001" value={fxOverrideValue}
                    onChange={function (e) { setFxOverrideValue(e.target.value); }}
                    className="border border-slate-300 rounded px-2 py-1 text-xs w-32" />
                  <button onClick={applyOverride}
                    className="px-2 py-1 rounded bg-amber-600 text-white text-xs font-bold">Apply</button>
                  <span className="text-[10px] text-amber-800">This rate will be saved as a manual override for {shipment.received_date || shipment.arrival_date || 'today'}.</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cost rollup */}
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-700 mb-2">📊 Cost Rollup</h3>
          {rollupError ? (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-900">⚠️ {rollupError}</div>
          ) : !rollup ? (
            <div className="text-xs text-slate-500">⏳ Computing…</div>
          ) : (
            <div className="space-y-2">
              <div className="overflow-auto border border-slate-200 rounded">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-[10px]">Component</th>
                      <th className="px-2 py-1.5 text-right text-[10px]">Amount ({ccy})</th>
                      <th className="px-2 py-1.5 text-right text-[10px]">USD</th>
                      <th className="px-2 py-1.5 text-right text-[10px]">EGP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollup.breakdown.map(function (b) {
                      return (
                        <tr key={b.component} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 capitalize">{b.component.replace(/_/g, ' ')}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmt(b.amount)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmt(b.usd)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmt(b.egp)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-indigo-50 font-bold">
                    <tr>
                      <td className="px-2 py-2">TOTAL</td>
                      <td></td>
                      <td className="px-2 py-2 text-right font-mono text-indigo-900">${fmt(rollup.totalUsd)}</td>
                      <td className="px-2 py-2 text-right font-mono text-indigo-900">£E {fmt(rollup.totalEgp)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Allocation method */}
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-700 mb-2">⚖️ Allocation Method</h3>
          <div className="flex gap-2 mb-2 flex-wrap">
            {[
              { v: 'by_qty', label: '📏 By Quantity', desc: 'Split equally per unit (default)' },
              { v: 'by_kg', label: '⚖️ By Weight (kg)', desc: 'Heavier SKUs absorb more freight' },
              { v: 'by_value', label: '💵 By Purchase Value', desc: 'Higher-value SKUs absorb more cost' },
            ].map(function (opt) {
              return (
                <button key={opt.v} onClick={function () { setMethod(opt.v); }}
                  title={opt.desc}
                  className={'px-3 py-2 rounded-md text-xs font-bold border transition ' +
                    (method === opt.v ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')}>
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-500">{
            method === 'by_qty' ? 'Each unit gets an equal share of the total landed cost.' :
            method === 'by_kg' ? 'Heavier line items absorb more of the freight/customs cost. Falls back to qty for lines without kg data.' :
            'Pricier line items absorb more cost. Uses unit_purchase_cost × qty. Falls back to qty for lines without unit cost.'
          }</p>
        </div>

        {/* Per-SKU allocation preview */}
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-700 mb-2">📦 Per-SKU Allocation Preview</h3>
          {allocations.length === 0 ? (
            <div className="text-xs text-slate-500">No allocations to preview.</div>
          ) : (
            <div className="overflow-auto border border-slate-200 rounded">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-[10px]">SKU Line</th>
                    <th className="px-2 py-1.5 text-right text-[10px]">Qty</th>
                    <th className="px-2 py-1.5 text-right text-[10px]">Total USD</th>
                    <th className="px-2 py-1.5 text-right text-[10px]">Unit USD</th>
                    <th className="px-2 py-1.5 text-right text-[10px]">Unit EGP</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map(function (a, i) {
                    var li = a.line;
                    return (
                      <tr key={li.id || i} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-mono text-[10px]">{li.sku_id ? li.sku_id.substring(0, 8) : '—'}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(li.qty_primary, 0)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">${fmt(a.usd)}</td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold">${fmt(a.unitUsd, 4)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">£E {fmt(a.unitEgp, 2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer / actions */}
        <div className="p-4 flex justify-between items-center sticky bottom-0 bg-white border-t border-slate-200">
          <div className="text-[10px] text-slate-500">
            Once finalized, these unit costs become the cost basis for FIFO sale deduction. Cost can still be re-finalized later, with restate audit.
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={working}
              className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 text-xs font-bold">Cancel</button>
            <button onClick={confirmFinalize} disabled={!isReadyToFinalize || working}
              className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-extrabold">
              {working ? '⏳ Finalizing…' : '✓ Finalize Landed Cost'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
