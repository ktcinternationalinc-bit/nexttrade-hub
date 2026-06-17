'use client';
// v55.83-A.6.27.36 — Inventory Phase 1 Build 4.5: Adjustments
//
// Three operation types:
//   1. Quantity Adjustment (increase or decrease) — for damage/theft/count corrections
//   2. Warehouse Transfer — moves stock from one warehouse to another (paired movements)
//   3. Cost Restatement — corrects the cost_per_uom on a specific layer
//
// All three create an inventory_adjustments row + auto-generate movement(s) via
// SQL functions: apply_quantity_adjustment, apply_warehouse_transfer, apply_cost_adjustment.
// FIFO consumption is handled atomically by consume_layers_fifo() server-side.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { canSeeInventoryCosts } from '../lib/inventory-permissions';

var TYPE_LABELS = {
  quantity_increase: { label: 'Qty +', color: 'bg-emerald-100 text-emerald-900' },
  quantity_decrease: { label: 'Qty -', color: 'bg-rose-100 text-rose-900' },
  warehouse_transfer: { label: 'Transfer', color: 'bg-blue-100 text-blue-900' },
  cost_restatement: { label: 'Cost Restate', color: 'bg-amber-100 text-amber-900' },
};

function fmt(n, dec) {
  if (n == null || isNaN(Number(n))) return '—';
  dec = dec == null ? 2 : dec;
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function asNum(v) {
  if (v == null || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

export default function InventoryAdjustments(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  var canView = isSuperAdmin || modulePerms['Inventory'] === true || modulePerms['Edit Inventory'] === true;
  var canEditAdj = isSuperAdmin || modulePerms['Edit Inventory'] === true;
  var canCostAdj = isSuperAdmin;  // cost restatements super_admin only
  var seeCosts = canSeeInventoryCosts(userProfile, modulePerms);

  var [adjustments, setAdjustments] = useState([]);
  var [products, setProducts] = useState([]);
  var [warehouses, setWarehouses] = useState([]);
  var [layers, setLayers] = useState([]);
  var [loading, setLoading] = useState(true);
  var [busy, setBusy] = useState(false);

  // Filters
  var [filterType, setFilterType] = useState('all');
  var [filterProduct, setFilterProduct] = useState('all');
  var [filterWarehouse, setFilterWarehouse] = useState('all');
  var [search, setSearch] = useState('');

  // Modal state — picks type first, then form
  var [modalType, setModalType] = useState(null);  // null | 'quantity' | 'transfer' | 'cost'
  var [form, setForm] = useState({});

  function resetForm() { setForm({}); }

  async function load() {
    setLoading(true);
    try {
      var [adjRes, prodRes, whRes, lyRes] = await Promise.all([
        supabase.from('inventory_adjustments').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('inventory_products').select('id,name_en,name_ar,quick_code,classification_slug').eq('active', true),
        supabase.from('inv_warehouses').select('id,name,code').order('name'),
        supabase.from('inventory_layers').select('*').eq('status', 'open').gt('qty_remaining', 0).order('receipt_date'),
      ]);
      // v55.83-HK — Supabase returns {data:null,error} on a query failure (RLS / missing
      // column) WITHOUT throwing, so the catch below never fires and the screen would show an
      // empty list instead of the real reason. Surface per-table query errors explicitly.
      var _errs = [];
      if (adjRes && adjRes.error) { _errs.push('adjustments: ' + adjRes.error.message); }
      if (prodRes && prodRes.error) { _errs.push('products: ' + prodRes.error.message); }
      if (whRes && whRes.error) { _errs.push('warehouses: ' + whRes.error.message); }
      if (lyRes && lyRes.error) { _errs.push('layers: ' + lyRes.error.message); }
      if (_errs.length) { console.error('[adjustments] query errors', _errs); toast.error('Failed to load: ' + _errs.join(' · ')); }
      setAdjustments(adjRes.data || []);
      setProducts(prodRes.data || []);
      setWarehouses(whRes.data || []);
      setLayers(lyRes.data || []);
    } catch (e) {
      console.error('[adjustments] load failed:', e);
      toast.error('Failed to load adjustments: ' + ((e && e.message) || String(e)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(function () {
    if (!canView) { setLoading(false); return; }
    load();
  }, [canView]);

  function productById(id) { return products.find(function (p) { return p.id === id; }) || null; }
  function warehouseById(id) { return warehouses.find(function (w) { return w.id === id; }) || null; }
  function layerById(id) { return layers.find(function (l) { return l.id === id; }) || null; }

  var filtered = useMemo(function () {
    var list = adjustments.slice();
    if (filterType !== 'all')      list = list.filter(function (a) { return a.adjustment_type === filterType; });
    if (filterProduct !== 'all')   list = list.filter(function (a) { return a.product_id === filterProduct; });
    if (filterWarehouse !== 'all') list = list.filter(function (a) { return a.source_warehouse_id === filterWarehouse || a.destination_warehouse_id === filterWarehouse; });
    if (search.trim()) {
      var q = search.trim().toLowerCase();
      list = list.filter(function (a) {
        var p = productById(a.product_id);
        var hay = (p ? ((p.quick_code || '') + ' ' + (p.name_en || '')) : '') + ' ' + (a.reason || '') + ' ' + (a.notes || '');
        return hay.toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }, [adjustments, products, filterType, filterProduct, filterWarehouse, search]);

  // Open-stock helper: how much do we have for (product, warehouse)?
  function openStockFor(productId, warehouseId) {
    return layers
      .filter(function (l) { return l.product_id === productId && (l.warehouse_id || null) === (warehouseId || null); })
      .reduce(function (a, b) { return a + Number(b.qty_remaining || 0); }, 0);
  }

  // ── Submit handlers ──────────────────────────────────────────────
  async function submitQuantityAdj() {
    if (!form.product_id) { alert('Pick a product'); return; }
    if (!form.warehouse_id) { alert('Pick a warehouse'); return; }
    if (!form.direction) { alert('Pick increase or decrease'); return; }
    var qty = asNum(form.quantity);
    if (qty == null || qty <= 0) { alert('Quantity must be > 0'); return; }
    if (!form.reason || !form.reason.trim()) { alert('Reason required'); return; }
    // Safety check: if decrease, warn if would exceed available
    if (form.direction === 'decrease') {
      var available = openStockFor(form.product_id, form.warehouse_id);
      if (qty > available) {
        if (!window.confirm('Available stock at this warehouse: ' + fmt(available) + '. You\'re trying to decrease by ' + fmt(qty) + '. This will fail server-side. Continue anyway?')) return;
      }
    }
    setBusy(true);
    try {
      var res = await supabase.rpc('apply_quantity_adjustment', {
        p_product_id: form.product_id,
        p_warehouse_id: form.warehouse_id,
        p_quantity: qty,
        p_direction: form.direction,
        p_uom: form.uom || null,
        p_reason: form.reason.trim(),
        p_notes: (form.notes || '').trim() || null,
        p_user_id: userProfile && userProfile.id,
        p_adjustment_date: form.adjustment_date || new Date().toISOString().substring(0, 10),
      });
      if (res.error) throw res.error;
      toast.success('Quantity adjustment recorded.');
      setModalType(null); resetForm();
      await load();
    } catch (err) {
      console.error('[adjustments] qty failed:', err);
      toast.error('Failed: ' + ((err && err.message) || String(err)));
      alert('Failed: ' + ((err && err.message) || String(err)) + '\n\nIf this is the first adjustment, verify the v55.83-A.6.27.36 SQL migration was run in Supabase.');
    } finally {
      setBusy(false);
    }
  }

  async function submitTransfer() {
    if (!form.product_id) { alert('Pick a product'); return; }
    if (!form.source_warehouse_id) { alert('Pick source warehouse'); return; }
    if (!form.destination_warehouse_id) { alert('Pick destination warehouse'); return; }
    if (form.source_warehouse_id === form.destination_warehouse_id) { alert('Source and destination must differ'); return; }
    var qty = asNum(form.quantity);
    if (qty == null || qty <= 0) { alert('Quantity must be > 0'); return; }
    if (!form.reason || !form.reason.trim()) { alert('Reason required'); return; }
    var available = openStockFor(form.product_id, form.source_warehouse_id);
    if (qty > available) {
      if (!window.confirm('Available stock at source: ' + fmt(available) + '. You\'re trying to transfer ' + fmt(qty) + '. This will fail server-side. Continue anyway?')) return;
    }
    setBusy(true);
    try {
      var res = await supabase.rpc('apply_warehouse_transfer', {
        p_product_id: form.product_id,
        p_source_warehouse_id: form.source_warehouse_id,
        p_dest_warehouse_id: form.destination_warehouse_id,
        p_quantity: qty,
        p_uom: form.uom || null,
        p_reason: form.reason.trim(),
        p_notes: (form.notes || '').trim() || null,
        p_user_id: userProfile && userProfile.id,
        p_adjustment_date: form.adjustment_date || new Date().toISOString().substring(0, 10),
      });
      if (res.error) throw res.error;
      toast.success('Transfer recorded — ' + fmt(qty) + ' moved.');
      setModalType(null); resetForm();
      await load();
    } catch (err) {
      console.error('[adjustments] transfer failed:', err);
      toast.error('Failed: ' + ((err && err.message) || String(err)));
      alert('Failed: ' + ((err && err.message) || String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function submitCostRestate() {
    if (!form.source_layer_id) { alert('Pick a cost layer to restate'); return; }
    var newCost = asNum(form.new_cost_per_uom);
    if (newCost == null || newCost < 0) { alert('New cost must be a non-negative number'); return; }
    if (!form.reason || !form.reason.trim()) { alert('Reason required'); return; }
    setBusy(true);
    try {
      var res = await supabase.rpc('apply_cost_adjustment', {
        p_layer_id: form.source_layer_id,
        p_new_cost_per_uom: newCost,
        p_reason: form.reason.trim(),
        p_notes: (form.notes || '').trim() || null,
        p_user_id: userProfile && userProfile.id,
        p_adjustment_date: form.adjustment_date || new Date().toISOString().substring(0, 10),
      });
      if (res.error) throw res.error;
      toast.success('Cost restated.');
      setModalType(null); resetForm();
      await load();
    } catch (err) {
      console.error('[adjustments] cost failed:', err);
      toast.error('Failed: ' + ((err && err.message) || String(err)));
      alert('Failed: ' + ((err && err.message) || String(err)));
    } finally {
      setBusy(false);
    }
  }

  // ── Render guards ────────────────────────────────────────────────
  if (!canView) {
    return (
      <div style={{ padding: 24 }}>
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
          <div className="text-base font-extrabold text-amber-900">🔒 Access restricted</div>
          <div className="text-sm text-amber-800 mt-1 font-medium">Viewing adjustments requires the Inventory permission.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 24 }} className="text-slate-600 font-medium">Loading adjustments...</div>;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200" style={{ padding: 20 }}>
      <div className="mb-4 flex justify-between items-start gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 24 }}>🔧</span>
            <h2 className="text-xl font-extrabold text-slate-900">Adjustments</h2>
          </div>
          <div className="text-sm text-slate-700 font-medium mt-1">
            Record damage / theft / count corrections / transfers between warehouses / cost restatements. Every change creates a movement ledger entry.
          </div>
        </div>
        {canEditAdj && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={function () { setModalType('quantity'); setForm({ direction: 'decrease', adjustment_date: new Date().toISOString().substring(0,10) }); }}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-extrabold rounded-lg shadow">+ Quantity Adjustment</button>
            <button onClick={function () { setModalType('transfer'); setForm({ adjustment_date: new Date().toISOString().substring(0,10) }); }}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-extrabold rounded-lg shadow">+ Warehouse Transfer</button>
            {canCostAdj && (
              <button onClick={function () { setModalType('cost'); setForm({ adjustment_date: new Date().toISOString().substring(0,10) }); }}
                className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-extrabold rounded-lg shadow">+ Cost Restatement</button>
            )}
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="Search reason, notes, product..."
          value={search}
          onChange={function (e) { setSearch(e.target.value); }}
          className="flex-1 min-w-[200px] px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
        />
        <select value={filterType} onChange={function (e) { setFilterType(e.target.value); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold">
          <option value="all">All types</option>
          <option value="quantity_increase">Quantity Increase</option>
          <option value="quantity_decrease">Quantity Decrease</option>
          <option value="warehouse_transfer">Warehouse Transfer</option>
          <option value="cost_restatement">Cost Restatement</option>
        </select>
        <select value={filterProduct} onChange={function (e) { setFilterProduct(e.target.value); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold">
          <option value="all">All products</option>
          {products.slice().sort(function (a, b) { return (a.quick_code || a.name_en || '').localeCompare(b.quick_code || b.name_en || ''); }).map(function (p) {
            return <option key={p.id} value={p.id}>{p.quick_code || p.name_en}</option>;
          })}
        </select>
        <select value={filterWarehouse} onChange={function (e) { setFilterWarehouse(e.target.value); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold">
          <option value="all">All warehouses</option>
          {warehouses.map(function (w) { return <option key={w.id} value={w.id}>{w.name}</option>; })}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="grid bg-slate-100 text-[10px] font-extrabold text-slate-700 tracking-wider uppercase"
             style={{ gridTemplateColumns: '100px 110px 1fr 100px 130px 130px 1fr', padding: '8px 12px' }}>
          <div>Date</div>
          <div>Type</div>
          <div>Product</div>
          <div>Quantity</div>
          <div>Source WH</div>
          <div>Dest WH</div>
          <div>Reason / Notes</div>
        </div>
        {filtered.length === 0 ? (
          <div className="text-center text-slate-500 italic text-sm py-8">
            {adjustments.length === 0
              ? 'No adjustments recorded yet. Click "+ Quantity Adjustment" or "+ Warehouse Transfer" to make the first one.'
              : 'No adjustments match your filters.'}
          </div>
        ) : (
          filtered.map(function (a) {
            var p = productById(a.product_id);
            var srcWh = warehouseById(a.source_warehouse_id);
            var dstWh = warehouseById(a.destination_warehouse_id);
            var meta = TYPE_LABELS[a.adjustment_type] || { label: a.adjustment_type, color: 'bg-slate-100 text-slate-700' };
            return (
              <div key={a.id}
                   className="grid items-center border-t border-slate-100 text-sm"
                   style={{ gridTemplateColumns: '100px 110px 1fr 100px 130px 130px 1fr', padding: '10px 12px' }}>
                <div className="text-slate-900 font-semibold">{a.adjustment_date}</div>
                <div>
                  <span className={'text-[10px] px-1.5 py-0.5 rounded font-extrabold ' + meta.color}>{meta.label}</span>
                </div>
                <div className="text-slate-900">
                  <span className="font-mono font-extrabold">{p ? (p.quick_code || '—') : '—'}</span>
                  <div className="text-[10px] text-slate-600">{p ? p.name_en : ''}</div>
                </div>
                <div className="font-mono font-extrabold text-slate-900">
                  {a.adjustment_type === 'cost_restatement' && seeCosts ? (
                    <span className="text-amber-700">{fmt(a.old_cost_per_uom, 4)} → {fmt(a.new_cost_per_uom, 4)}</span>
                  ) : a.quantity != null ? (
                    <span>{fmt(a.quantity, 2)}{a.uom ? <span className="text-[10px] text-slate-600 ml-1">{a.uom}</span> : null}</span>
                  ) : '—'}
                </div>
                <div className="text-slate-700 font-semibold">{srcWh ? srcWh.name : <span className="text-slate-400 italic">—</span>}</div>
                <div className="text-slate-700 font-semibold">{dstWh ? dstWh.name : <span className="text-slate-400 italic">—</span>}</div>
                <div className="text-[11px] text-slate-700">
                  <div className="font-semibold text-slate-900">{a.reason}</div>
                  {a.notes && <div className="italic text-slate-600 truncate" title={a.notes}>{a.notes}</div>}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="text-[10px] text-slate-500 mt-2 italic">
        Showing {filtered.length} of {adjustments.length} adjustment{adjustments.length === 1 ? '' : 's'}.
      </div>

      {/* ───────── Modal: Quantity Adjustment ───────── */}
      {modalType === 'quantity' && (
        <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={function () { setModalType(null); resetForm(); }} style={{ padding: 16 }}>
          <div className="bg-white rounded-2xl shadow-2xl mx-auto" onClick={function (e) { e.stopPropagation(); }} style={{ maxWidth: 640 }}>
            <div className="rounded-t-2xl flex justify-between items-center gap-2" style={{ background: '#3730a3', padding: '14px 20px' }}>
              <div>
                <div className="text-lg font-extrabold" style={{ color: '#ffffff' }}>📦 Quantity Adjustment</div>
                <div className="text-xs font-semibold" style={{ color: '#e0e7ff' }}>Record damage, theft, or count correction</div>
              </div>
              <button onClick={function () { setModalType(null); resetForm(); }} aria-label="Close" style={{ background: '#ffffff', color: '#1e293b', width: 36, height: 36, fontSize: 20, lineHeight: 1, border: '2px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', borderRadius: '50%', fontWeight: 800 }}>✕</button>
            </div>
            <div style={{ padding: 20, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
              {/* Direction */}
              <div className="flex gap-2 mb-3">
                {[
                  { id: 'decrease', label: 'Decrease (- damage/theft/over-count)', color: 'rose' },
                  { id: 'increase', label: 'Increase (+ found stock/under-count)', color: 'emerald' },
                ].map(function (d) {
                  var active = form.direction === d.id;
                  return (
                    <button key={d.id} onClick={function () { setForm(Object.assign({}, form, { direction: d.id })); }}
                      className={'flex-1 px-3 py-2 rounded-lg text-sm font-extrabold border-2 ' +
                        (active && d.id === 'decrease' ? 'bg-rose-100 border-rose-500 text-rose-900' :
                         active && d.id === 'increase' ? 'bg-emerald-100 border-emerald-500 text-emerald-900' :
                         'bg-white border-slate-300 text-slate-700 hover:bg-slate-50')}>{d.label}</button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <label className="text-[11px] font-extrabold text-slate-700">Product *
                  <select value={form.product_id || ''} onChange={function (e) { setForm(Object.assign({}, form, { product_id: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white">
                    <option value="">— pick product —</option>
                    {products.slice().sort(function (a, b) { return (a.quick_code || a.name_en || '').localeCompare(b.quick_code || b.name_en || ''); }).map(function (p) {
                      return <option key={p.id} value={p.id}>{(p.quick_code || '?')} — {p.name_en}</option>;
                    })}
                  </select>
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">Warehouse *
                  <select value={form.warehouse_id || ''} onChange={function (e) { setForm(Object.assign({}, form, { warehouse_id: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white">
                    <option value="">— pick warehouse —</option>
                    {warehouses.map(function (w) { return <option key={w.id} value={w.id}>{w.name}</option>; })}
                  </select>
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">Quantity *
                  <input type="text" value={form.quantity || ''} onChange={function (e) { setForm(Object.assign({}, form, { quantity: e.target.value })); }} placeholder="positive number" className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white font-mono" />
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">UOM
                  <select value={form.uom || ''} onChange={function (e) { setForm(Object.assign({}, form, { uom: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white">
                    <option value="">—</option>
                    <option value="kg">kg</option>
                    <option value="meter">meter</option>
                    <option value="yard">yard</option>
                    <option value="roll">roll</option>
                    <option value="piece">piece</option>
                    <option value="liter">liter</option>
                    <option value="sqm">sqm</option>
                  </select>
                </label>
                <label className="text-[11px] font-extrabold text-slate-700 col-span-2">Reason *
                  <input type="text" value={form.reason || ''} onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} placeholder="e.g. water damage during transit / count correction after audit" className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                </label>
                <label className="text-[11px] font-extrabold text-slate-700 col-span-2">Notes
                  <textarea value={form.notes || ''} onChange={function (e) { setForm(Object.assign({}, form, { notes: e.target.value })); }} rows={2} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white resize-none" />
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">Adjustment Date
                  <input type="date" value={form.adjustment_date || ''} onChange={function (e) { setForm(Object.assign({}, form, { adjustment_date: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                </label>
              </div>

              {/* Available-stock helper */}
              {form.product_id && form.warehouse_id && form.direction === 'decrease' && (
                <div className="bg-blue-50 border border-blue-300 rounded p-2 text-xs text-blue-900 mb-2">
                  Available open stock at this warehouse: <span className="font-mono font-extrabold">{fmt(openStockFor(form.product_id, form.warehouse_id), 2)}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl" style={{ padding: '12px 20px' }}>
              <button onClick={function () { setModalType(null); resetForm(); }} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold">Cancel</button>
              <button onClick={submitQuantityAdj} disabled={busy} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-extrabold shadow disabled:opacity-50">{busy ? 'Saving...' : '✓ Save Adjustment'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ───────── Modal: Warehouse Transfer ───────── */}
      {modalType === 'transfer' && (
        <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={function () { setModalType(null); resetForm(); }} style={{ padding: 16 }}>
          <div className="bg-white rounded-2xl shadow-2xl mx-auto" onClick={function (e) { e.stopPropagation(); }} style={{ maxWidth: 640 }}>
            <div className="rounded-t-2xl flex justify-between items-center gap-2" style={{ background: '#3730a3', padding: '14px 20px' }}>
              <div>
                <div className="text-lg font-extrabold" style={{ color: '#ffffff' }}>🔄 Warehouse Transfer</div>
                <div className="text-xs font-semibold" style={{ color: '#e0e7ff' }}>Move stock from one warehouse to another</div>
              </div>
              <button onClick={function () { setModalType(null); resetForm(); }} aria-label="Close" style={{ background: '#ffffff', color: '#1e293b', width: 36, height: 36, fontSize: 20, lineHeight: 1, border: '2px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', borderRadius: '50%', fontWeight: 800 }}>✕</button>
            </div>
            <div style={{ padding: 20, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <label className="text-[11px] font-extrabold text-slate-700 col-span-2">Product *
                  <select value={form.product_id || ''} onChange={function (e) { setForm(Object.assign({}, form, { product_id: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white">
                    <option value="">— pick product —</option>
                    {products.slice().sort(function (a, b) { return (a.quick_code || a.name_en || '').localeCompare(b.quick_code || b.name_en || ''); }).map(function (p) {
                      return <option key={p.id} value={p.id}>{(p.quick_code || '?')} — {p.name_en}</option>;
                    })}
                  </select>
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">From Warehouse *
                  <select value={form.source_warehouse_id || ''} onChange={function (e) { setForm(Object.assign({}, form, { source_warehouse_id: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white">
                    <option value="">— source —</option>
                    {warehouses.map(function (w) { return <option key={w.id} value={w.id}>{w.name}</option>; })}
                  </select>
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">To Warehouse *
                  <select value={form.destination_warehouse_id || ''} onChange={function (e) { setForm(Object.assign({}, form, { destination_warehouse_id: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white">
                    <option value="">— destination —</option>
                    {warehouses.map(function (w) { return <option key={w.id} value={w.id}>{w.name}</option>; })}
                  </select>
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">Quantity *
                  <input type="text" value={form.quantity || ''} onChange={function (e) { setForm(Object.assign({}, form, { quantity: e.target.value })); }} placeholder="positive number" className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white font-mono" />
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">UOM
                  <select value={form.uom || ''} onChange={function (e) { setForm(Object.assign({}, form, { uom: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white">
                    <option value="">—</option>
                    <option value="kg">kg</option><option value="meter">meter</option><option value="yard">yard</option>
                    <option value="roll">roll</option><option value="piece">piece</option><option value="liter">liter</option><option value="sqm">sqm</option>
                  </select>
                </label>
                <label className="text-[11px] font-extrabold text-slate-700 col-span-2">Reason *
                  <input type="text" value={form.reason || ''} onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} placeholder="e.g. rebalancing stock / customer location closer to dest" className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                </label>
                <label className="text-[11px] font-extrabold text-slate-700 col-span-2">Notes
                  <textarea value={form.notes || ''} onChange={function (e) { setForm(Object.assign({}, form, { notes: e.target.value })); }} rows={2} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white resize-none" />
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">Date
                  <input type="date" value={form.adjustment_date || ''} onChange={function (e) { setForm(Object.assign({}, form, { adjustment_date: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                </label>
              </div>

              {form.product_id && form.source_warehouse_id && (
                <div className="bg-blue-50 border border-blue-300 rounded p-2 text-xs text-blue-900 mb-2">
                  Available open stock at source: <span className="font-mono font-extrabold">{fmt(openStockFor(form.product_id, form.source_warehouse_id), 2)}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl" style={{ padding: '12px 20px' }}>
              <button onClick={function () { setModalType(null); resetForm(); }} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold">Cancel</button>
              <button onClick={submitTransfer} disabled={busy} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-extrabold shadow disabled:opacity-50">{busy ? 'Saving...' : '✓ Save Transfer'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ───────── Modal: Cost Restatement (super_admin only) ───────── */}
      {modalType === 'cost' && (
        <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={function () { setModalType(null); resetForm(); }} style={{ padding: 16 }}>
          <div className="bg-white rounded-2xl shadow-2xl mx-auto" onClick={function (e) { e.stopPropagation(); }} style={{ maxWidth: 640 }}>
            <div className="rounded-t-2xl flex justify-between items-center gap-2" style={{ background: '#3730a3', padding: '14px 20px' }}>
              <div>
                <div className="text-lg font-extrabold" style={{ color: '#ffffff' }}>💲 Cost Restatement</div>
                <div className="text-xs font-semibold" style={{ color: '#e0e7ff' }}>Restate cost on a specific FIFO layer (super_admin only)</div>
              </div>
              <button onClick={function () { setModalType(null); resetForm(); }} aria-label="Close" style={{ background: '#ffffff', color: '#1e293b', width: 36, height: 36, fontSize: 20, lineHeight: 1, border: '2px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', borderRadius: '50%', fontWeight: 800 }}>✕</button>
            </div>
            <div style={{ padding: 20, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
              <div className="bg-amber-50 border-2 border-amber-300 rounded p-2 text-xs text-amber-900 mb-3">
                ⚠ Cost restatement updates the cost on this layer. Sales that already drew from this layer at the OLD cost will need COGS restatement in reports.
              </div>

              <label className="text-[11px] font-extrabold text-slate-700 block mb-2">Layer to restate *
                <select value={form.source_layer_id || ''} onChange={function (e) {
                  var L = layerById(e.target.value);
                  setForm(Object.assign({}, form, { source_layer_id: e.target.value, old_cost_per_uom: L ? L.cost_per_uom : '' }));
                }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white">
                  <option value="">— pick a layer —</option>
                  {layers.slice(0, 200).map(function (L) {
                    var p = productById(L.product_id);
                    var w = warehouseById(L.warehouse_id);
                    return (
                      <option key={L.id} value={L.id}>
                        {L.receipt_number || '?'} — {p ? p.quick_code : '?'} @ {w ? w.name : '?'} — {fmt(L.qty_remaining, 2)} remain @ {fmt(L.cost_per_uom, 4)} {L.cost_currency}
                      </option>
                    );
                  })}
                </select>
              </label>

              {form.source_layer_id && (() => {
                var L = layerById(form.source_layer_id);
                if (!L) return null;
                return (
                  <div className="bg-slate-50 border border-slate-200 rounded p-2 mb-2 text-xs">
                    <div><span className="font-bold">Receipt:</span> <span className="font-mono">{L.receipt_number}</span></div>
                    <div><span className="font-bold">Current cost:</span> <span className="font-mono font-extrabold text-amber-900">{fmt(L.cost_per_uom, 4)} {L.cost_currency}</span></div>
                    <div><span className="font-bold">Qty remaining:</span> <span className="font-mono">{fmt(L.qty_remaining, 2)} / {fmt(L.qty_received, 2)}</span></div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-2 mb-3">
                <label className="text-[11px] font-extrabold text-slate-700">New cost per UOM *
                  <input type="text" value={form.new_cost_per_uom || ''} onChange={function (e) { setForm(Object.assign({}, form, { new_cost_per_uom: e.target.value })); }} placeholder="e.g. 4.50" className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white font-mono" />
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">Date
                  <input type="date" value={form.adjustment_date || ''} onChange={function (e) { setForm(Object.assign({}, form, { adjustment_date: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                </label>
                <label className="text-[11px] font-extrabold text-slate-700 col-span-2">Reason *
                  <input type="text" value={form.reason || ''} onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} placeholder="e.g. supplier corrected invoice / freight charge missed" className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                </label>
                <label className="text-[11px] font-extrabold text-slate-700 col-span-2">Notes
                  <textarea value={form.notes || ''} onChange={function (e) { setForm(Object.assign({}, form, { notes: e.target.value })); }} rows={2} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white resize-none" />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl" style={{ padding: '12px 20px' }}>
              <button onClick={function () { setModalType(null); resetForm(); }} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold">Cancel</button>
              <button onClick={submitCostRestate} disabled={busy} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-extrabold shadow disabled:opacity-50">{busy ? 'Saving...' : '✓ Save Restatement'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
