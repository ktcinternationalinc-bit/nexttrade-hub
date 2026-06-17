'use client';
// v55.83-A.6.27.34 — Inventory Phase 1 Build 4.3: Movements Ledger viewer
//
// Read-only append-only log of every stock change. Auto-populated by the
// on_receipt_finalize_create_ledger() trigger on inventory_stock_receipts.
//
// Future builds (4.4 adjustments, 4.6 sales) will insert their own movement
// rows. This screen just displays them all.
//
// Permission: view = Inventory; cost columns gated by canSeeInventoryCosts.

import { useState, useEffect, useMemo } from 'react';
import RestrictedNotice from './RestrictedNotice';
import { supabase } from '../lib/supabase';
import { canSeeInventoryCosts } from '../lib/inventory-permissions';

var MOVEMENT_LABELS = {
  receipt: { label: 'Receipt In', color: 'bg-emerald-100 text-emerald-900' },
  sale: { label: 'Sale Out', color: 'bg-rose-100 text-rose-900' },
  transfer_in: { label: 'Transfer In', color: 'bg-blue-100 text-blue-900' },
  transfer_out: { label: 'Transfer Out', color: 'bg-blue-100 text-blue-900' },
  adjustment_in: { label: 'Adj. In', color: 'bg-amber-100 text-amber-900' },
  adjustment_out: { label: 'Adj. Out', color: 'bg-amber-100 text-amber-900' },
  reversal: { label: 'Reversal', color: 'bg-slate-200 text-slate-700' },
};

function fmt(n, dec) {
  if (n == null || isNaN(Number(n))) return '—';
  dec = dec == null ? 2 : dec;
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function InventoryMovementsLedger(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  var canView = isSuperAdmin || modulePerms['Inventory'] === true || modulePerms['Edit Inventory'] === true;
  var seeCosts = canSeeInventoryCosts(userProfile, modulePerms);

  var [movements, setMovements] = useState([]);
  var [products, setProducts] = useState([]);
  var [warehouses, setWarehouses] = useState([]);
  var [loading, setLoading] = useState(true);

  // Filters
  var [filterProduct, setFilterProduct] = useState('all');
  var [filterWarehouse, setFilterWarehouse] = useState('all');
  var [filterType, setFilterType] = useState('all');
  var [filterFrom, setFilterFrom] = useState('');
  var [filterTo, setFilterTo] = useState('');
  var [search, setSearch] = useState('');

  useEffect(function () {
    if (!canView) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      try {
        var [mvRes, prodRes, whRes] = await Promise.all([
          supabase.from('inventory_movements').select('*').order('created_at', { ascending: false }).limit(1000),
          supabase.from('inventory_products').select('id,name_en,name_ar,quick_code,classification_slug').eq('active', true),
          supabase.from('inv_warehouses').select('id,name,code').order('name'),
        ]);
        if (cancelled) return;
        // v55.83-HK — surface Supabase query errors (they don't throw → catch won't fire →
        // empty ledger would look like "no movements" instead of a load failure).
        var _errs = [];
        if (mvRes && mvRes.error) { _errs.push('movements: ' + mvRes.error.message); }
        if (prodRes && prodRes.error) { _errs.push('products: ' + prodRes.error.message); }
        if (whRes && whRes.error) { _errs.push('warehouses: ' + whRes.error.message); }
        if (_errs.length) { console.error('[movements] query errors', _errs); toast.error('Failed to load: ' + _errs.join(' · ')); }
        setMovements(mvRes.data || []);
        setProducts(prodRes.data || []);
        setWarehouses(whRes.data || []);
      } catch (e) {
        console.error('[movements] load failed:', e);
        toast.error('Failed to load movements: ' + ((e && e.message) || String(e)));
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
    var list = movements.slice();
    if (filterProduct !== 'all')   list = list.filter(function (m) { return m.product_id === filterProduct; });
    if (filterWarehouse !== 'all') list = list.filter(function (m) { return m.warehouse_id === filterWarehouse; });
    if (filterType !== 'all')      list = list.filter(function (m) { return m.movement_type === filterType; });
    if (filterFrom)                list = list.filter(function (m) { return m.movement_date >= filterFrom; });
    if (filterTo)                  list = list.filter(function (m) { return m.movement_date <= filterTo; });
    if (search.trim()) {
      var q = search.trim().toLowerCase();
      list = list.filter(function (m) {
        var p = productById(m.product_id);
        var hay = (p ? ((p.quick_code || '') + ' ' + (p.name_en || '')) : '') + ' ' + (m.reference_number || '') + ' ' + (m.notes || '');
        return hay.toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }, [movements, products, filterProduct, filterWarehouse, filterType, filterFrom, filterTo, search]);

  if (!canView) {
    return (
      <div style={{ padding: 24 }}>
        <RestrictedNotice title="Access restricted" message="Viewing the movements ledger requires the Inventory permission." />
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 24 }} className="text-slate-600 font-medium">Loading movements...</div>;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200" style={{ padding: 20 }}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 24 }}>📜</span>
          <h2 className="text-xl font-extrabold text-slate-900">Movements Ledger</h2>
        </div>
        <div className="text-sm text-slate-700 font-medium mt-1">
          Append-only history of every stock change — receipts in, sales out, transfers, adjustments. Auto-populated when receipts are finalized.
        </div>
        <div className="text-sm text-slate-700 font-medium" style={{ direction: 'rtl' }}>
          سجل تاريخي مُلحَق فقط لكل تغيير في المخزون — الواردات، المبيعات، التحويلات، التسويات. يُعبأ تلقائياً عند تأكيد الإيصالات.
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="Search product, reference, notes..."
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
        <select value={filterType} onChange={function (e) { setFilterType(e.target.value); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold">
          <option value="all">All types</option>
          <option value="receipt">Receipts</option>
          <option value="sale">Sales</option>
          <option value="transfer_in">Transfers In</option>
          <option value="transfer_out">Transfers Out</option>
          <option value="adjustment_in">Adjustments In</option>
          <option value="adjustment_out">Adjustments Out</option>
          <option value="reversal">Reversals</option>
        </select>
        <input type="date" value={filterFrom} onChange={function (e) { setFilterFrom(e.target.value); }}
          className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
        <input type="date" value={filterTo} onChange={function (e) { setFilterTo(e.target.value); }}
          className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="grid bg-slate-100 text-[10px] font-extrabold text-slate-700 tracking-wider uppercase"
             style={{ gridTemplateColumns: '100px 100px 1fr 100px 110px 130px ' + (seeCosts ? '120px ' : '') + '1fr', padding: '8px 12px' }}>
          <div>Date</div>
          <div>Type</div>
          <div>Product</div>
          <div>Quantity</div>
          <div>UOM</div>
          <div>Warehouse</div>
          {seeCosts && <div>Cost / UOM</div>}
          <div>Reference / Notes</div>
        </div>
        {filtered.length === 0 ? (
          <div className="text-center text-slate-500 italic text-sm py-8">
            {movements.length === 0
              ? 'No movements yet. Finalize a receipt in Inbound Shipments to create the first one.'
              : 'No movements match your filters.'}
          </div>
        ) : (
          filtered.map(function (m) {
            var p = productById(m.product_id);
            var wh = warehouseById(m.warehouse_id);
            var meta = MOVEMENT_LABELS[m.movement_type] || { label: m.movement_type, color: 'bg-slate-100 text-slate-700' };
            var isOut = Number(m.quantity) < 0;
            return (
              <div key={m.id}
                   className="grid items-center border-t border-slate-100 text-sm"
                   style={{ gridTemplateColumns: '100px 100px 1fr 100px 110px 130px ' + (seeCosts ? '120px ' : '') + '1fr', padding: '10px 12px' }}>
                <div className="text-slate-900 font-semibold">{m.movement_date}</div>
                <div>
                  <span className={'text-[10px] px-1.5 py-0.5 rounded font-extrabold ' + meta.color}>{meta.label}</span>
                </div>
                <div className="text-slate-900">
                  <span className="font-mono font-extrabold">{p ? (p.quick_code || '—') : '—'}</span>
                  <div className="text-[10px] text-slate-600">{p ? p.name_en : ''}</div>
                </div>
                <div className={'font-mono font-extrabold ' + (isOut ? 'text-rose-700' : 'text-emerald-700')}>
                  {isOut ? '' : '+'}{fmt(m.quantity, 2)}
                </div>
                <div className="text-slate-700 font-semibold">{m.uom || '—'}</div>
                <div className="text-slate-700 font-semibold">{wh ? wh.name : <span className="text-slate-400 italic">—</span>}</div>
                {seeCosts && (
                  <div className="font-mono text-slate-900">
                    {m.cost_per_uom != null ? fmt(m.cost_per_uom, 4) : <span className="text-slate-400 italic">—</span>}
                    {m.cost_currency && <span className="text-[10px] text-slate-600 ml-1">{m.cost_currency}</span>}
                  </div>
                )}
                <div className="text-[11px] text-slate-700">
                  {m.reference_number && <div className="font-mono font-semibold text-slate-900">{m.reference_number}</div>}
                  {m.notes && <div className="italic text-slate-600 truncate" title={m.notes}>{m.notes}</div>}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="text-[10px] text-slate-500 mt-2 italic">
        Showing {filtered.length} of {movements.length} movement{movements.length === 1 ? '' : 's'}. Capped at 1,000 most recent for performance — narrow filters for older history.
      </div>
    </div>
  );
}
