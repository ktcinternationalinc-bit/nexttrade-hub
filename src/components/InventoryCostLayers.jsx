'use client';
// v55.83-A.6.27.34 — Inventory Phase 1 Build 4.3: Cost Layers viewer
//
// Read-only view of FIFO cost layers. Each row = one receipt's stock that
// hasn't been fully consumed yet. The age (oldest first) shows which layer
// the system will draw from when sales happen (Build 4.6+).
//
// Also shows roll-up: total stock-on-hand + inventory value by product/warehouse.
//
// Permission: view = Inventory; cost columns gated by canSeeInventoryCosts.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { canSeeInventoryCosts } from '../lib/inventory-permissions';

function fmt(n, dec) {
  if (n == null || isNaN(Number(n))) return '—';
  dec = dec == null ? 2 : dec;
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function ageDays(dateStr) {
  if (!dateStr) return null;
  var d = new Date(dateStr);
  var now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

export default function InventoryCostLayers(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  var canView = isSuperAdmin || modulePerms['Inventory'] === true || modulePerms['Edit Inventory'] === true;
  var seeCosts = canSeeInventoryCosts(userProfile, modulePerms);

  var [layers, setLayers] = useState([]);
  var [products, setProducts] = useState([]);
  var [warehouses, setWarehouses] = useState([]);
  var [loading, setLoading] = useState(true);

  // Filters
  var [filterProduct, setFilterProduct] = useState('all');
  var [filterWarehouse, setFilterWarehouse] = useState('all');
  var [filterStatus, setFilterStatus] = useState('open');
  var [view, setView] = useState('layers'); // 'layers' or 'summary'
  var [search, setSearch] = useState('');

  useEffect(function () {
    if (!canView) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      try {
        var [lyRes, prodRes, whRes] = await Promise.all([
          supabase.from('inventory_layers').select('*').order('receipt_date', { ascending: true }),
          supabase.from('inventory_products').select('id,name_en,name_ar,quick_code,classification_slug').eq('active', true),
          supabase.from('inv_warehouses').select('id,name,code').order('name'),
        ]);
        if (cancelled) return;
        setLayers(lyRes.data || []);
        setProducts(prodRes.data || []);
        setWarehouses(whRes.data || []);
      } catch (e) {
        console.error('[layers] load failed:', e);
        toast.error('Failed to load cost layers: ' + ((e && e.message) || String(e)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [canView]);

  function productById(id) { return products.find(function (p) { return p.id === id; }) || null; }
  function warehouseById(id) { return warehouses.find(function (w) { return w.id === id; }) || null; }

  var filtered = useMemo(function () {
    var list = layers.slice();
    if (filterStatus !== 'all')    list = list.filter(function (L) { return L.status === filterStatus; });
    if (filterProduct !== 'all')   list = list.filter(function (L) { return L.product_id === filterProduct; });
    if (filterWarehouse !== 'all') list = list.filter(function (L) { return L.warehouse_id === filterWarehouse; });
    if (search.trim()) {
      var q = search.trim().toLowerCase();
      list = list.filter(function (L) {
        var p = productById(L.product_id);
        var hay = (p ? ((p.quick_code || '') + ' ' + (p.name_en || '')) : '') + ' ' + (L.receipt_number || '') + ' ' + (L.batch_number || '');
        return hay.toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }, [layers, products, filterProduct, filterWarehouse, filterStatus, search]);

  // Summary roll-up by product × warehouse (open layers only, ignoring filters)
  var summary = useMemo(function () {
    var summaryFiltered = layers.filter(function (L) { return L.status === 'open' && Number(L.qty_remaining) > 0; });
    if (filterProduct !== 'all')   summaryFiltered = summaryFiltered.filter(function (L) { return L.product_id === filterProduct; });
    if (filterWarehouse !== 'all') summaryFiltered = summaryFiltered.filter(function (L) { return L.warehouse_id === filterWarehouse; });
    var map = {};
    summaryFiltered.forEach(function (L) {
      var key = L.product_id + ':' + (L.warehouse_id || 'none');
      if (!map[key]) {
        map[key] = {
          product_id: L.product_id,
          warehouse_id: L.warehouse_id,
          qty_remaining: 0,
          total_value: 0,
          layer_count: 0,
          uom: L.uom,
        };
      }
      map[key].qty_remaining += Number(L.qty_remaining || 0);
      map[key].total_value += Number(L.qty_remaining || 0) * Number(L.cost_per_uom || 0);
      map[key].layer_count++;
    });
    var rows = Object.values(map);
    rows.sort(function (a, b) {
      var pa = productById(a.product_id);
      var pb = productById(b.product_id);
      var ka = pa ? (pa.quick_code || pa.name_en || '') : '';
      var kb = pb ? (pb.quick_code || pb.name_en || '') : '';
      return ka.localeCompare(kb);
    });
    return rows;
  }, [layers, products, filterProduct, filterWarehouse]);

  // Grand totals (over the summary set)
  var grandTotalValue = summary.reduce(function (a, b) { return a + Number(b.total_value || 0); }, 0);
  var grandTotalLayers = summary.reduce(function (a, b) { return a + Number(b.layer_count || 0); }, 0);

  if (!canView) {
    return (
      <div style={{ padding: 24 }}>
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
          <div className="text-base font-extrabold text-amber-900">🔒 Access restricted</div>
          <div className="text-sm text-amber-800 mt-1 font-medium">Viewing cost layers requires the Inventory permission.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 24 }} className="text-slate-600 font-medium">Loading cost layers...</div>;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200" style={{ padding: 20 }}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 24 }}>🧱</span>
          <h2 className="text-xl font-extrabold text-slate-900">Cost Layers</h2>
        </div>
        <div className="text-sm text-slate-700 font-medium mt-1">
          FIFO cost layers per product per warehouse. Each finalized receipt creates one layer. Future sales consume from oldest layer first. Shows current stock-on-hand and inventory value.
        </div>
        <div className="text-sm text-slate-700 font-medium" style={{ direction: 'rtl' }}>
          طبقات التكلفة بنظام الوارد أولاً صادر أولاً لكل منتج في كل مستودع. كل إيصال مُؤكَّد يُنشئ طبقة واحدة. المبيعات المستقبلية تستهلك من أقدم طبقة أولاً.
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={function () { setView('summary'); }}
          className={'px-4 py-2 rounded-lg text-sm font-extrabold ' + (view === 'summary' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300')}
        >
          📊 Summary (stock-on-hand by product × warehouse)
        </button>
        <button
          onClick={function () { setView('layers'); }}
          className={'px-4 py-2 rounded-lg text-sm font-extrabold ' + (view === 'layers' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300')}
        >
          🧱 Individual layers (FIFO detail)
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="Search product, receipt #, batch..."
          value={search}
          onChange={function (e) { setSearch(e.target.value); }}
          className="flex-1 min-w-[200px] px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
        />
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
        {view === 'layers' && (
          <select value={filterStatus} onChange={function (e) { setFilterStatus(e.target.value); }}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold">
            <option value="open">Open only</option>
            <option value="closed">Closed only</option>
            <option value="reversed">Reversed only</option>
            <option value="all">All statuses</option>
          </select>
        )}
      </div>

      {/* Grand-total strip (always visible) */}
      {seeCosts && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3">
            <div className="text-[10px] font-extrabold text-emerald-700 tracking-wider">TOTAL INVENTORY VALUE</div>
            <div className="text-2xl font-extrabold text-emerald-900 font-mono">{fmt(grandTotalValue)} EGP</div>
            <div className="text-[10px] text-emerald-700">across {summary.length} product/warehouse pair{summary.length === 1 ? '' : 's'}</div>
          </div>
          <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-3">
            <div className="text-[10px] font-extrabold text-blue-700 tracking-wider">OPEN LAYERS</div>
            <div className="text-2xl font-extrabold text-blue-900">{grandTotalLayers}</div>
            <div className="text-[10px] text-blue-700">individual cost layers still active</div>
          </div>
          <div className="bg-slate-100 border-2 border-slate-300 rounded-lg p-3">
            <div className="text-[10px] font-extrabold text-slate-700 tracking-wider">TOTAL LAYERS (ALL TIME)</div>
            <div className="text-2xl font-extrabold text-slate-900">{layers.length}</div>
            <div className="text-[10px] text-slate-700">includes closed + reversed</div>
          </div>
        </div>
      )}

      {/* Summary view */}
      {view === 'summary' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="grid bg-slate-100 text-[10px] font-extrabold text-slate-700 tracking-wider uppercase"
               style={{ gridTemplateColumns: '1fr 150px 130px 120px ' + (seeCosts ? '130px ' : '') + '80px', padding: '8px 12px' }}>
            <div>Product</div>
            <div>Warehouse</div>
            <div>Qty On-Hand</div>
            <div>UOM</div>
            {seeCosts && <div>Value</div>}
            <div># Layers</div>
          </div>
          {summary.length === 0 ? (
            <div className="text-center text-slate-500 italic text-sm py-8">
              {layers.length === 0
                ? 'No cost layers yet. Finalize a receipt in Inbound Shipments to create the first one.'
                : 'No open stock matches your filters.'}
            </div>
          ) : (
            summary.map(function (s, i) {
              var p = productById(s.product_id);
              var wh = warehouseById(s.warehouse_id);
              return (
                <div key={i} className="grid items-center border-t border-slate-100 text-sm"
                     style={{ gridTemplateColumns: '1fr 150px 130px 120px ' + (seeCosts ? '130px ' : '') + '80px', padding: '10px 12px' }}>
                  <div className="text-slate-900">
                    <span className="font-mono font-extrabold">{p ? (p.quick_code || '—') : '—'}</span>
                    <div className="text-[11px] text-slate-700 font-semibold">{p ? p.name_en : ''}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{p ? p.classification_slug : ''}</div>
                  </div>
                  <div className="text-slate-700 font-semibold">{wh ? wh.name : <span className="text-slate-400 italic">—</span>}</div>
                  <div className="font-mono font-extrabold text-emerald-700">{fmt(s.qty_remaining, 2)}</div>
                  <div className="text-slate-700 font-semibold">{s.uom || '—'}</div>
                  {seeCosts && (
                    <div className="font-mono font-extrabold text-slate-900">{fmt(s.total_value)} EGP</div>
                  )}
                  <div className="font-mono text-slate-700">{s.layer_count}</div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Layers view */}
      {view === 'layers' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="grid bg-slate-100 text-[10px] font-extrabold text-slate-700 tracking-wider uppercase"
               style={{ gridTemplateColumns: '110px 110px 80px 1fr 110px 100px 90px ' + (seeCosts ? '110px ' : '') + '90px', padding: '8px 12px' }}>
            <div>Receipt #</div>
            <div>Date</div>
            <div>Age</div>
            <div>Product</div>
            <div>Warehouse</div>
            <div>Qty Remain</div>
            <div>UOM</div>
            {seeCosts && <div>Cost / UOM</div>}
            <div>Status</div>
          </div>
          {filtered.length === 0 ? (
            <div className="text-center text-slate-500 italic text-sm py-8">
              {layers.length === 0
                ? 'No cost layers yet. Finalize a receipt in Inbound Shipments to create the first one.'
                : 'No layers match your filters.'}
            </div>
          ) : (
            filtered.map(function (L) {
              var p = productById(L.product_id);
              var wh = warehouseById(L.warehouse_id);
              var age = ageDays(L.receipt_date);
              var isOpen = L.status === 'open' && Number(L.qty_remaining) > 0;
              var isReversed = L.status === 'reversed';
              var rowFade = (!isOpen && !isReversed) ? 'opacity-60' : isReversed ? 'opacity-50 bg-slate-50' : '';
              var statusBadge = L.status === 'open' && Number(L.qty_remaining) > 0 ? 'bg-emerald-100 text-emerald-900' :
                                L.status === 'open' && Number(L.qty_remaining) === 0 ? 'bg-slate-200 text-slate-700' :
                                L.status === 'closed' ? 'bg-slate-200 text-slate-700' :
                                'bg-rose-100 text-rose-900';
              var statusLabel = L.status === 'open' && Number(L.qty_remaining) > 0 ? 'Open' :
                                L.status === 'open' && Number(L.qty_remaining) === 0 ? 'Empty' :
                                L.status === 'closed' ? 'Closed' : 'Reversed';
              return (
                <div key={L.id} className={'grid items-center border-t border-slate-100 text-sm ' + rowFade}
                     style={{ gridTemplateColumns: '110px 110px 80px 1fr 110px 100px 90px ' + (seeCosts ? '110px ' : '') + '90px', padding: '10px 12px' }}>
                  <div className="font-mono font-extrabold text-slate-900">{L.receipt_number || '—'}</div>
                  <div className="text-slate-900 font-semibold">{L.receipt_date}</div>
                  <div className="text-slate-700">{age != null ? age + 'd' : '—'}</div>
                  <div className="text-slate-900">
                    <span className="font-mono font-extrabold">{p ? (p.quick_code || '—') : '—'}</span>
                    <div className="text-[10px] text-slate-600">{p ? p.name_en : ''}</div>
                  </div>
                  <div className="text-slate-700 font-semibold">{wh ? wh.name : <span className="text-slate-400 italic">—</span>}</div>
                  <div className="font-mono font-extrabold text-emerald-700">
                    {fmt(L.qty_remaining, 2)} <span className="text-slate-400 font-normal">/ {fmt(L.qty_received, 2)}</span>
                  </div>
                  <div className="text-slate-700 font-semibold">{L.uom || '—'}</div>
                  {seeCosts && (
                    <div className="font-mono text-slate-900">{fmt(L.cost_per_uom, 4)} <span className="text-[10px] text-slate-600">{L.cost_currency}</span></div>
                  )}
                  <div>
                    <span className={'text-[10px] px-1.5 py-0.5 rounded font-extrabold ' + statusBadge}>{statusLabel}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="text-[10px] text-slate-500 mt-2 italic">
        Showing {view === 'summary' ? summary.length + ' summary row(s)' : filtered.length + ' of ' + layers.length + ' layer(s)'}.
        {' '}Layers ordered FIFO (oldest first). The system will consume from the top when sales draw stock (Build 4.6).
      </div>
    </div>
  );
}
