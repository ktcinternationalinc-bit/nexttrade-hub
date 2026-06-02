'use client';
// v55.83-A.6.27.33 — Inventory Phase 1 Build 4.2: Finalize Landed Cost
//
// When a receipt's status is 'received', the user clicks "Finalize Cost"
// on that receipt. This dialog opens, lets them:
//   1. Enter freight / customs duty / insurance / clearing / local transport / other costs
//      — each with its own currency
//   2. Auto-fetch USD→EGP FX rate for the arrival_date (or receipt_date); allow manual override
//   3. Pick allocation method: by qty / by kg / by value
//   4. See live preview: total landed cost + per-line allocated + final per-uom landed cost
//   5. Confirm → writes landed_cost_per_uom + landed_total back to each line of the receipt,
//      sets status='finalized', and stores the cost-component breakdown in inventory_landed_costs.
//
// Permission: gated upstream by canSeeInventoryCosts. If the user can't see costs they
// can't open this dialog.

import { useState, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';
import { getRateForDate, computeFinalization } from '../lib/inventory-landed-cost-engine';
import { saveManualRate } from '../lib/inventory-fx';

var CURRENCIES = ['EGP', 'USD', 'EUR'];

function fmt(n, dec) {
  if (n == null || isNaN(Number(n))) return '—';
  dec = dec == null ? 2 : dec;
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function asNum(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

export default function InventoryFinalizeCostDialog(props) {
  // Props: shipmentGroup (the grouped receipt object from the parent
  //        with .receipt_number, .receipt_date, .arrival_date, .lines[]),
  //        products map, warehouses map, userProfile, toast, onClose, onFinalized.
  var shipmentGroup = props.shipmentGroup;
  var productById = props.productById || function () { return null; };
  var userProfile = props.userProfile;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };
  var onClose = props.onClose;
  var onFinalized = props.onFinalized;

  // Cost components state — each {amount, currency}. Default currency = shipment's purchase_currency.
  var defaultCurrency = (shipmentGroup && shipmentGroup.lines && shipmentGroup.lines[0] && shipmentGroup.lines[0].purchase_currency) || 'USD';
  var [components, setComponents] = useState({
    freight_amount: '',
    freight_currency: defaultCurrency,
    customs_duty_amount: '',
    customs_duty_currency: defaultCurrency,
    insurance_amount: '',
    insurance_currency: defaultCurrency,
    clearing_amount: '',
    clearing_currency: defaultCurrency,
    local_transport_amount: '',
    local_transport_currency: defaultCurrency,
    other_amount: '',
    other_currency: defaultCurrency,
    other_description: '',
  });

  // FX rate state
  var [fxRate, setFxRate] = useState(null);
  var [fxSource, setFxSource] = useState(null);
  var [fxLoading, setFxLoading] = useState(false);
  var [fxOverride, setFxOverride] = useState('');
  var [fxOverrideMode, setFxOverrideMode] = useState(false);

  var [method, setMethod] = useState('by_qty');
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState(null);

  // FX fetch on mount — uses arrival_date if present, else receipt_date
  useEffect(function () {
    var cancelled = false;
    async function loadFx() {
      setFxLoading(true);
      var date = (shipmentGroup && shipmentGroup.lines && shipmentGroup.lines[0] && shipmentGroup.lines[0].arrival_date)
        || (shipmentGroup && shipmentGroup.receipt_date)
        || new Date().toISOString().substring(0, 10);
      var r = await getRateForDate(date);
      if (cancelled) return;
      if (r) {
        setFxRate(r.rate);
        setFxSource(r.source);
        setFxOverride(String(r.rate));
      } else {
        // Couldn't fetch — let user type one
        setFxOverrideMode(true);
        setError('Could not fetch USD→EGP rate. Enter it manually below.');
      }
      setFxLoading(false);
    }
    loadFx();
    return function () { cancelled = true; };
  }, []);

  // Compute preview when components / fx / method change
  var effectiveRate = fxOverrideMode ? Number(fxOverride) : fxRate;
  var preview = null;
  if (effectiveRate && shipmentGroup && shipmentGroup.lines) {
    preview = computeFinalization(components, shipmentGroup.lines, effectiveRate, method);
  }

  function setComp(key, value) {
    setComponents(function (prev) {
      var next = Object.assign({}, prev);
      next[key] = value;
      return next;
    });
  }

  async function commitFinalize() {
    if (!effectiveRate) {
      alert('FX rate is required. Enter the USD→EGP rate manually if auto-fetch failed.');
      return;
    }
    if (!preview || !preview.allocations.length) {
      alert('Cannot finalize — no lines to allocate against.');
      return;
    }
    setBusy(true);
    try {
      // 1. If user manually entered an FX rate, save it for future use
      if (fxOverrideMode && fxRate !== Number(fxOverride)) {
        try {
          var date = shipmentGroup.receipt_date || new Date().toISOString().substring(0, 10);
          await saveManualRate(date, 'USD', 'EGP', Number(fxOverride), userProfile && userProfile.id);
        } catch (_) {}
      }

      // 2. Insert the landed-cost breakdown row
      var totalUsd = preview.totalLandedUsd;
      var totalEgp = preview.totalLandedEgp;
      var lcPayload = {
        receipt_number: shipmentGroup.receipt_number,
        freight_amount: asNum(components.freight_amount) || 0,
        freight_currency: asNum(components.freight_amount) ? components.freight_currency : null,
        customs_duty_amount: asNum(components.customs_duty_amount) || 0,
        customs_duty_currency: asNum(components.customs_duty_amount) ? components.customs_duty_currency : null,
        insurance_amount: asNum(components.insurance_amount) || 0,
        insurance_currency: asNum(components.insurance_amount) ? components.insurance_currency : null,
        clearing_amount: asNum(components.clearing_amount) || 0,
        clearing_currency: asNum(components.clearing_amount) ? components.clearing_currency : null,
        local_transport_amount: asNum(components.local_transport_amount) || 0,
        local_transport_currency: asNum(components.local_transport_amount) ? components.local_transport_currency : null,
        other_amount: asNum(components.other_amount) || 0,
        other_currency: asNum(components.other_amount) ? components.other_currency : null,
        other_description: (components.other_description || '').trim() || null,
        fx_rate_usd_to_egp: effectiveRate,
        fx_source: fxOverrideMode ? 'manual' : (fxSource || 'unknown'),
        fx_rate_date: (shipmentGroup.lines[0] && shipmentGroup.lines[0].arrival_date) || shipmentGroup.receipt_date,
        total_usd_value: totalUsd,
        total_egp_value: totalEgp,
        base_purchase_total: preview.basePurchaseEgp,
        base_purchase_currency: (shipmentGroup.lines[0] && shipmentGroup.lines[0].currency) || 'EGP',
        allocation_method: method,
        created_by: userProfile && userProfile.id,
        updated_by: userProfile && userProfile.id,
      };

      // Upsert — if a previous finalize attempt left a row, this should replace it.
      var existing = await supabase.from('inventory_landed_costs').select('id').eq('receipt_number', shipmentGroup.receipt_number).maybeSingle();
      if (existing.data && existing.data.id) {
        await dbUpdate('inventory_landed_costs', existing.data.id, lcPayload, userProfile && userProfile.id);
      } else {
        await dbInsert('inventory_landed_costs', lcPayload, userProfile && userProfile.id);
      }

      // 3. Update each receipt row with its landed cost
      var nowIso = new Date().toISOString();
      for (var i = 0; i < preview.allocations.length; i++) {
        var alloc = preview.allocations[i];
        var L = alloc.line;
        await dbUpdate('inventory_stock_receipts', L.id, {
          landed_cost_per_uom: alloc.landed_per_uom,
          landed_total: alloc.landed_total,
          allocation_method: method,
          fx_rate_used: effectiveRate,
          finalized_at: nowIso,
          finalized_by: userProfile && userProfile.id,
          status: 'finalized',
          updated_by: userProfile && userProfile.id,
        }, userProfile && userProfile.id);
      }

      toast.success('Receipt ' + shipmentGroup.receipt_number + ' finalized. Total landed cost: ' + fmt(totalEgp) + ' EGP across ' + preview.allocations.length + ' line(s).');
      if (onFinalized) onFinalized();
      if (onClose) onClose();
    } catch (err) {
      console.error('[finalize] failed:', err);
      setError((err && err.message) || String(err));
      toast.error('Finalize failed: ' + ((err && err.message) || String(err)));
      alert('Finalize failed: ' + ((err && err.message) || String(err)) + '\n\nMost likely cause: the v55.83-A.6.27.33 SQL migration was not run yet in Supabase.');
    } finally {
      setBusy(false);
    }
  }

  if (!shipmentGroup) return null;

  return (
    <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={onClose} style={{ padding: 16 }}>
      <div className="bg-white rounded-2xl shadow-2xl mx-auto" onClick={function (e) { e.stopPropagation(); }} style={{ maxWidth: 980 }}>

        {/* Header */}
        <div className="rounded-t-2xl flex justify-between items-center gap-2" style={{ background: '#3730a3', padding: '14px 20px' }}>
          <div>
            <div className="text-lg font-extrabold" style={{ color: '#ffffff' }}>💰 Finalize Landed Cost</div>
            <div className="text-xs font-semibold" style={{ color: '#e0e7ff' }}>
              Receipt <span className="font-mono">{shipmentGroup.receipt_number}</span> · {shipmentGroup.lineCount} line{shipmentGroup.lineCount === 1 ? '' : 's'} · {shipmentGroup.receipt_date}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: '#ffffff', color: '#1e293b', width: 36, height: 36, fontSize: 20, lineHeight: 1, border: '2px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', borderRadius: '50%', fontWeight: 800 }}>✕</button>
        </div>

        <div style={{ padding: 20, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>

          {/* Cost components grid */}
          <div className="mb-4 bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">COST COMPONENTS</div>
            <div className="text-[10px] text-slate-600 mb-2">Enter each cost in its original currency. Leave amount blank to skip.</div>
            <div className="grid grid-cols-3 gap-2 mb-2">

              {[
                { key: 'freight', label: 'Freight' },
                { key: 'customs_duty', label: 'Customs Duty' },
                { key: 'insurance', label: 'Insurance' },
                { key: 'clearing', label: 'Clearing / Broker' },
                { key: 'local_transport', label: 'Local Transport' },
                { key: 'other', label: 'Other' },
              ].map(function (c) {
                return (
                  <div key={c.key} className="bg-white border border-slate-200 rounded p-2">
                    <label className="text-[11px] font-extrabold text-slate-700 block">{c.label}</label>
                    <div className="flex gap-1 mt-0.5">
                      <input
                        type="text"
                        value={components[c.key + '_amount']}
                        onChange={function (e) { setComp(c.key + '_amount', e.target.value); }}
                        placeholder="0.00"
                        className="flex-1 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white font-mono"
                      />
                      <select
                        value={components[c.key + '_currency']}
                        onChange={function (e) { setComp(c.key + '_currency', e.target.value); }}
                        className="px-2 py-1.5 border border-slate-300 rounded text-sm bg-white font-semibold"
                      >
                        {CURRENCIES.map(function (cc) { return <option key={cc} value={cc}>{cc}</option>; })}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Other description */}
            <label className="text-[11px] font-extrabold text-slate-700 block mt-1">Other — what is it?
              <input
                type="text"
                value={components.other_description}
                onChange={function (e) { setComp('other_description', e.target.value); }}
                placeholder="e.g. inspection fee, demurrage, etc."
                className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
              />
            </label>
          </div>

          {/* FX rate row */}
          <div className="mb-4 bg-blue-50 rounded-lg p-3 border border-blue-200">
            <div className="text-[11px] font-extrabold text-blue-900 tracking-wider mb-2">USD → EGP EXCHANGE RATE</div>
            {fxLoading ? (
              <div className="text-sm text-blue-800 italic">Fetching latest rate from dashboard FX rates...</div>
            ) : (fxOverrideMode || (!fxRate)) ? (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[11px] font-extrabold text-blue-900">Manual rate (1 USD = ? EGP):</label>
                <input
                  type="text"
                  value={fxOverride}
                  onChange={function (e) { setFxOverride(e.target.value); }}
                  placeholder="e.g. 48.5"
                  className="px-2 py-1.5 border border-blue-300 rounded text-sm bg-white font-mono w-32"
                />
                {fxRate && (
                  <button onClick={function () { setFxOverrideMode(false); setFxOverride(String(fxRate)); }} className="text-[10px] text-blue-700 underline">use auto-fetched rate ({fmt(fxRate, 4)})</button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm font-extrabold text-blue-900">1 USD = <span className="font-mono">{fmt(fxRate, 4)}</span> EGP</span>
                <span className="text-[10px] text-blue-700 italic">({fxSource})</span>
                <button onClick={function () { setFxOverrideMode(true); }} className="text-[10px] text-blue-700 underline">override manually</button>
              </div>
            )}
          </div>

          {/* Allocation method */}
          <div className="mb-4 bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">ALLOCATION METHOD</div>
            <div className="flex gap-2">
              {[
                { id: 'by_qty', label: 'By Quantity', desc: 'Split proportionally to line quantity' },
                { id: 'by_kg', label: 'By Weight (kg)', desc: 'Split by line quantity_kg' },
                { id: 'by_value', label: 'By Value', desc: 'Split proportionally to line base cost' },
              ].map(function (m) {
                var active = method === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={function () { setMethod(m.id); }}
                    className={'flex-1 px-3 py-2 rounded border-2 text-left ' + (active ? 'bg-indigo-100 border-indigo-500' : 'bg-white border-slate-300 hover:bg-slate-50')}
                  >
                    <div className={'text-xs font-extrabold ' + (active ? 'text-indigo-900' : 'text-slate-700')}>{m.label}</div>
                    <div className="text-[10px] text-slate-600">{m.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          {preview && (
            <div className="mb-4 bg-white rounded-lg p-3 border-2 border-indigo-300">
              <div className="text-[11px] font-extrabold text-indigo-900 tracking-wider mb-2">PREVIEW</div>

              {/* Totals strip */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-emerald-50 border border-emerald-300 rounded p-2">
                  <div className="text-[10px] font-extrabold text-emerald-700 tracking-wider">BASE PURCHASE</div>
                  <div className="text-base font-extrabold font-mono text-emerald-900">{fmt(preview.basePurchaseEgp)}</div>
                </div>
                <div className="bg-amber-50 border border-amber-300 rounded p-2">
                  <div className="text-[10px] font-extrabold text-amber-700 tracking-wider">LANDED COSTS</div>
                  <div className="text-base font-extrabold font-mono text-amber-900">{fmt(preview.totalLandedEgp)}</div>
                  <div className="text-[10px] text-amber-700">= {fmt(preview.totalLandedUsd)} USD</div>
                </div>
                <div className="bg-indigo-50 border border-indigo-400 rounded p-2">
                  <div className="text-[10px] font-extrabold text-indigo-700 tracking-wider">GRAND TOTAL</div>
                  <div className="text-base font-extrabold font-mono text-indigo-900">{fmt(preview.grandTotalEgp)}</div>
                </div>
              </div>

              {/* Per-line allocation table */}
              <div className="text-[10px] font-extrabold text-slate-700 tracking-wider mb-1">PER-LINE BREAKDOWN</div>
              <div className="border border-slate-200 rounded overflow-hidden">
                <div className="grid bg-slate-100 text-[10px] font-extrabold text-slate-700 tracking-wider uppercase" style={{ gridTemplateColumns: '1fr 100px 80px 110px 110px 130px', padding: '6px 10px' }}>
                  <div>Product</div>
                  <div>Qty</div>
                  <div>UOM</div>
                  <div>Base cost</div>
                  <div>+ Allocated</div>
                  <div>= Landed/UOM</div>
                </div>
                {preview.allocations.map(function (a, i) {
                  var p = productById(a.line.product_id);
                  return (
                    <div key={i} className="grid border-t border-slate-100 items-center text-xs" style={{ gridTemplateColumns: '1fr 100px 80px 110px 110px 130px', padding: '8px 10px' }}>
                      <div className="font-semibold text-slate-900">
                        <div className="font-mono text-[11px] font-extrabold">{p ? (p.quick_code || '—') : '—'}</div>
                        <div className="text-[10px] text-slate-600">{p ? p.name_en : ''}</div>
                      </div>
                      <div className="font-mono text-slate-900">{fmt(a.line.quantity, 0)}</div>
                      <div className="text-slate-700">{a.line.uom || '—'}</div>
                      <div className="font-mono text-slate-900">{fmt(a.base_cost_total)}</div>
                      <div className="font-mono text-amber-900 font-extrabold">+{fmt(a.allocated_landed_egp)}</div>
                      <div className="font-mono text-indigo-900 font-extrabold">{fmt(a.landed_per_uom, 4)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border-2 border-red-300 rounded p-2 text-xs text-red-900 font-bold mb-3">⚠ {error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl" style={{ padding: '12px 20px' }}>
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold disabled:opacity-50">Cancel</button>
          <button
            onClick={commitFinalize}
            disabled={busy || !preview || !effectiveRate}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-extrabold shadow disabled:opacity-50"
          >
            {busy ? 'Finalizing...' : '✓ Confirm & Finalize Cost'}
          </button>
        </div>
      </div>
    </div>
  );
}
