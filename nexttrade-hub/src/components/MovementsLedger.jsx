// v55.83-A.6.21 (Max May 14 2026) — Inventory Stage B: Movements Ledger
//
// Append-only history of every stock change. Each row is one inv_movements
// record. Filters: SKU, warehouse, movement_type, date range. Newest first.
//
// Movement types (per schema CHECK constraint):
//   receipt, sale, return, transfer_out, transfer_in,
//   adjustment_in, adjustment_out, damage, write_off,
//   opening_balance, physical_count_correction

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

var TYPE_LABELS = {
  receipt: { label: 'Receipt', icon: '📥', tone: 'emerald' },
  sale: { label: 'Sale', icon: '📤', tone: 'red' },
  return: { label: 'Return', icon: '↩️', tone: 'amber' },
  transfer_out: { label: 'Transfer Out', icon: '🚚→', tone: 'blue' },
  transfer_in: { label: 'Transfer In', icon: '←🚚', tone: 'blue' },
  adjustment_in: { label: 'Adjustment In', icon: '➕', tone: 'amber' },
  adjustment_out: { label: 'Adjustment Out', icon: '➖', tone: 'amber' },
  damage: { label: 'Damage', icon: '⚠️', tone: 'red' },
  write_off: { label: 'Write-off', icon: '🗑', tone: 'red' },
  opening_balance: { label: 'Opening Balance', icon: '🏁', tone: 'slate' },
  physical_count_correction: { label: 'Count Correction', icon: '🔢', tone: 'amber' },
};

var TONE_CLASSES = {
  slate: 'bg-slate-100 text-slate-800',
  amber: 'bg-amber-100 text-amber-900',
  blue: 'bg-blue-100 text-blue-900',
  emerald: 'bg-emerald-100 text-emerald-900',
  red: 'bg-red-100 text-red-900',
};

function fmtNum(n) {
  if (n == null) return '—';
  var v = Number(n);
  if (isNaN(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export default function MovementsLedger({ userProfile, modulePerms, toast }) {
  var [movements, setMovements] = useState([]);
  var [skus, setSkus] = useState([]);
  var [warehouses, setWarehouses] = useState([]);
  var [users, setUsers] = useState([]);
  var [loading, setLoading] = useState(true);
  var [loadError, setLoadError] = useState(null);

  // Filters
  var [filterSku, setFilterSku] = useState('all');
  var [filterWarehouse, setFilterWarehouse] = useState('all');
  var [filterType, setFilterType] = useState('all');
  var [dateFrom, setDateFrom] = useState('');
  var [dateTo, setDateTo] = useState('');

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      var [movResp, skuResp, whResp, uResp] = await Promise.all([
        supabase.from('inv_movements').select('*').order('movement_date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
        supabase.from('inv_skus').select('id, sku_number, description, primary_unit'),
        supabase.from('inv_warehouses').select('id, code, name'),
        supabase.from('users').select('id, full_name, email'),
      ]);
      if (movResp.error) {
        setLoadError(movResp.error.message || 'Could not load movements');
      }
      setMovements(movResp.data || []);
      setSkus(skuResp.data || []);
      setWarehouses(whResp.data || []);
      setUsers(uResp.data || []);
    } catch (e) {
      setLoadError(e.message || String(e));
    }
    setLoading(false);
  }
  useEffect(function () { loadAll(); }, []);

  function skuLabel(id) {
    var s = skus.find(function (x) { return x.id === id; });
    return s ? s.sku_number + ' — ' + (s.description || '').substring(0, 40) : (id || '').substring(0, 8);
  }
  function whLabel(id) {
    var w = warehouses.find(function (x) { return x.id === id; });
    return w ? (w.code || w.name) : (id || '').substring(0, 8);
  }
  function userLabel(id) {
    var u = users.find(function (x) { return x.id === id; });
    return u ? (u.full_name || u.email || '').split(' ')[0] : (id ? id.substring(0, 8) : '—');
  }

  // Apply filters
  var visibleMovements = useMemo(function () {
    return movements.filter(function (m) {
      if (filterSku !== 'all' && m.sku_id !== filterSku) return false;
      if (filterWarehouse !== 'all' && m.warehouse_id !== filterWarehouse) return false;
      if (filterType !== 'all' && m.movement_type !== filterType) return false;
      if (dateFrom && (m.movement_date || '') < dateFrom) return false;
      if (dateTo && (m.movement_date || '') > dateTo) return false;
      return true;
    });
  }, [movements, filterSku, filterWarehouse, filterType, dateFrom, dateTo]);

  if (loadError && movements.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-300 rounded-xl p-6">
        <div className="text-sm font-bold text-amber-900 mb-2">⚠️ Inventory schema not detected</div>
        <p className="text-xs text-amber-800 mb-2">
          The Movements ledger needs the v55.83-A inventory schema installed.
          Run <code className="bg-amber-100 px-1 rounded">sql/v55-83-a-inventory-schema.sql</code> in Supabase.
        </p>
        <details className="text-[10px] text-amber-700"><summary className="cursor-pointer">Error</summary><code className="block bg-amber-100 p-2 rounded mt-1 font-mono">{loadError}</code></details>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-4 border border-slate-200">
      <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold">📜 Movements Ledger <span className="text-slate-400 font-normal">/ سجل الحركات</span></h3>
          <p className="text-[11px] text-slate-500">
            Every stock change — receipts, sales, transfers, adjustments. Append-only audit trail. Most recent 500 shown.
          </p>
        </div>
        <button onClick={loadAll} disabled={loading}
          className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-[10px] font-bold">
          {loading ? '⏳' : '🔄'} Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        <select value={filterSku} onChange={function (e) { setFilterSku(e.target.value); }}
          className="border border-slate-300 rounded px-2 py-1 text-xs">
          <option value="all">All SKUs</option>
          {skus.map(function (s) { return <option key={s.id} value={s.id}>{s.sku_number}</option>; })}
        </select>
        <select value={filterWarehouse} onChange={function (e) { setFilterWarehouse(e.target.value); }}
          className="border border-slate-300 rounded px-2 py-1 text-xs">
          <option value="all">All warehouses</option>
          {warehouses.map(function (w) { return <option key={w.id} value={w.id}>{w.name}</option>; })}
        </select>
        <select value={filterType} onChange={function (e) { setFilterType(e.target.value); }}
          className="border border-slate-300 rounded px-2 py-1 text-xs">
          <option value="all">All types</option>
          {Object.keys(TYPE_LABELS).map(function (k) { return <option key={k} value={k}>{TYPE_LABELS[k].icon} {TYPE_LABELS[k].label}</option>; })}
        </select>
        <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value); }}
          placeholder="From" className="border border-slate-300 rounded px-2 py-1 text-xs" />
        <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value); }}
          placeholder="To" className="border border-slate-300 rounded px-2 py-1 text-xs" />
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-slate-500">Loading movements...</div>
      ) : visibleMovements.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-3xl mb-2 opacity-50">📭</div>
          <div className="text-sm font-bold text-slate-700">{movements.length === 0 ? 'No movements yet' : 'No movements match the filter'}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            {movements.length === 0 ? 'Movements appear when you receive a shipment or post an adjustment.' : 'Try clearing some filters.'}
          </div>
        </div>
      ) : (
        <div className="overflow-auto border border-slate-200 rounded max-h-[600px]">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left text-[10px] font-bold">Date</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold">Type</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold">SKU</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold">Warehouse</th>
                <th className="px-2 py-2 text-right text-[10px] font-bold">Qty Change</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold">Reason / Notes</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold">User</th>
              </tr>
            </thead>
            <tbody>
              {visibleMovements.map(function (m) {
                var typeInfo = TYPE_LABELS[m.movement_type] || { label: m.movement_type, icon: '·', tone: 'slate' };
                var qty = Number(m.qty_change || 0);
                return (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-blue-50">
                    <td className="px-2 py-1.5 text-[10px] whitespace-nowrap">{m.movement_date}</td>
                    <td className="px-2 py-1.5">
                      <span className={'inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ' + TONE_CLASSES[typeInfo.tone]}>
                        {typeInfo.icon} {typeInfo.label}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[10px]">{skuLabel(m.sku_id)}</td>
                    <td className="px-2 py-1.5">{whLabel(m.warehouse_id)}</td>
                    <td className={'px-2 py-1.5 text-right font-mono font-bold ' + (qty > 0 ? 'text-emerald-700' : qty < 0 ? 'text-red-700' : 'text-slate-600')}>
                      {qty > 0 ? '+' : ''}{fmtNum(qty)}
                    </td>
                    <td className="px-2 py-1.5 text-[10px] text-slate-600">
                      {m.reason || ''}
                      {m.notes && <div className="text-[9px] text-slate-500 italic">{m.notes}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-[10px] text-slate-600">{userLabel(m.user_id)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 text-[10px] text-slate-500">
        Showing {visibleMovements.length} of {movements.length} loaded movements.
        {movements.length === 500 && ' Hit the 500-row cap — narrow filters to see older entries.'}
      </div>
    </div>
  );
}
