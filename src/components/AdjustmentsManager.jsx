// v55.83-A.6.27.9 (Max May 15 2026) — Inventory Stage E: Adjustments
//
// Users can record stock changes that aren't shipments or sales:
//   - damage (drops qty, write_off COGS)
//   - return (adds qty back, optionally reversing a sale)
//   - count_correction (audit reconciliation, +/-)
//   - transfer (between warehouses)
//   - manual_add / manual_remove (gen-purpose with required reason)
//
// Workflow:
//   1. User creates pending adjustment with SKU, warehouse, qty_change, reason
//   2. Super admin (or user with adjustment permission) approves
//   3. On approve: a matching inv_movement is created; for OUT adjustments
//      the FIFO layers are drained (oldest first) and COGS computed; for IN
//      adjustments a new layer is created at the weighted-avg cost of
//      existing layers, OR provisional zero-cost if no layers exist.
//
// Permissions:
//   - everyone with inventory access can VIEW + create pending
//   - super_admin or canAdjustInventory can APPROVE/REJECT

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { consumeFifo, reverseFifoConsumption } from '../lib/inventory-cost-engine';
import { canApproveAdjustments } from '../lib/inventory-permissions';

var ADJ_TYPES = [
  { value: 'damage', label: '💥 Damage', direction: 'out', desc: 'Goods damaged/destroyed; qty decreases' },
  { value: 'return', label: '↩️ Return', direction: 'in', desc: 'Goods returned by customer; qty increases' },
  { value: 'count', label: '🔍 Count Correction', direction: 'either', desc: 'Physical count differs from system; +/- to match' },
  { value: 'write_off', label: '❌ Write-off', direction: 'out', desc: 'Inventory removed without sale (expired, lost, etc.)' },
  { value: 'manual_add', label: '➕ Manual Add', direction: 'in', desc: 'Add stock without a receipt (transfer-in, found stock, etc.)' },
  { value: 'manual_remove', label: '➖ Manual Remove', direction: 'out', desc: 'Remove stock without a sale (general-purpose, requires reason)' },
];

function fmt(n, dec) {
  if (n == null || isNaN(Number(n))) return '—';
  dec = dec == null ? 2 : dec;
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function AdjustmentsManager({ skus, warehouses, userProfile, modulePerms, toast }) {
  var [adjustments, setAdjustments] = useState([]);
  var [loading, setLoading] = useState(true);
  var [statusFilter, setStatusFilter] = useState('pending');
  var [showCreate, setShowCreate] = useState(false);
  var [form, setForm] = useState({ sku_id: '', warehouse_id: '', adjustment_type: 'count', qty_change: '', reason: '', reference_doc: '', notes: '' });
  var [busyApproveId, setBusyApproveId] = useState(null);

  var isSuperAdmin = userProfile && userProfile.role === 'super_admin';
  var canApprove = canApproveAdjustments(userProfile, modulePerms);
  var myId = userProfile ? userProfile.id : null;

  async function load() {
    setLoading(true);
    try {
      var q = supabase.from('inv_adjustments').select('*').order('created_at', { ascending: false });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      var resp = await q;
      if (resp.error) {
        toast && toast.error && toast.error('Load failed: ' + resp.error.message);
        setLoading(false);
        return;
      }
      setAdjustments(resp.data || []);
    } catch (e) {
      toast && toast.error && toast.error('Load error: ' + (e && e.message ? e.message : e));
    }
    setLoading(false);
  }

  useEffect(function () { load(); }, [statusFilter]);

  var skuById = useMemo(function () {
    var m = {}; (skus || []).forEach(function (s) { m[s.id] = s; }); return m;
  }, [skus]);

  var warehouseById = useMemo(function () {
    var m = {}; (warehouses || []).forEach(function (w) { m[w.id] = w; }); return m;
  }, [warehouses]);

  async function createAdjustment() {
    if (!form.sku_id || !form.warehouse_id || !form.adjustment_type || !form.qty_change || !form.reason) {
      toast && toast.warn && toast.warn('Fill all required fields (SKU, warehouse, type, qty, reason)');
      return;
    }
    var q = Number(form.qty_change);
    if (!q || isNaN(q)) { toast && toast.warn && toast.warn('Qty must be a non-zero number (+ for IN, - for OUT)'); return; }
    var typeDef = ADJ_TYPES.find(function (t) { return t.value === form.adjustment_type; });
    // Auto-sign for type direction
    if (typeDef && typeDef.direction === 'out' && q > 0) q = -q;
    if (typeDef && typeDef.direction === 'in' && q < 0) q = Math.abs(q);
    try {
      var resp = await supabase.from('inv_adjustments').insert({
        sku_id: form.sku_id,
        warehouse_id: form.warehouse_id,
        adjustment_type: form.adjustment_type,
        qty_change: q,
        reason: form.reason,
        reference_doc: form.reference_doc || null,
        notes: form.notes || null,
        status: 'pending',
        created_by: myId,
      }).select().single();
      if (resp.error) {
        toast && toast.error && toast.error('Create failed: ' + resp.error.message);
        return;
      }
      toast && toast.success && toast.success('Adjustment created — pending approval');
      setShowCreate(false);
      setForm({ sku_id: '', warehouse_id: '', adjustment_type: 'count', qty_change: '', reason: '', reference_doc: '', notes: '' });
      await load();
    } catch (e) {
      toast && toast.error && toast.error('Create error: ' + (e && e.message ? e.message : e));
    }
  }

  async function approveAdjustment(adj) {
    if (!canApprove) return;
    if (!confirm('Approve adjustment: ' + (adj.adjustment_type) + ' ' + adj.qty_change + ' for ' + ((skuById[adj.sku_id] || {}).sku_number || adj.sku_id.substring(0,8)) + '?')) return;
    setBusyApproveId(adj.id);
    try {
      var qty = Number(adj.qty_change);
      var movementType = qty < 0 ? (adj.adjustment_type === 'damage' ? 'damage' : adj.adjustment_type === 'write_off' ? 'write_off' : 'adjustment_out') :
                                    (adj.adjustment_type === 'return' ? 'return' : 'adjustment_in');
      var movRow = {
        sku_id: adj.sku_id,
        warehouse_id: adj.warehouse_id,
        movement_type: movementType,
        qty_change: qty,
        source_table: 'inv_adjustments',
        source_id: adj.id,
        note: '[' + adj.adjustment_type + '] ' + adj.reason,
        occurred_at: new Date().toISOString(),
        created_by: myId,
      };
      var consumed = null;
      if (qty < 0) {
        // OUT — drain FIFO layers
        var drain = await consumeFifo(adj.sku_id, adj.warehouse_id, Math.abs(qty));
        if (drain && !drain.error && drain.qtyDrained > 0) {
          movRow.consumed_layers = drain.consumed;
          movRow.unit_cost_usd = drain.weightedUnitUsd;
          movRow.unit_cost_egp = drain.weightedUnitEgp;
          movRow.total_cost_usd = drain.totalCogsUsd;
          movRow.total_cost_egp = drain.totalCogsEgp;
          consumed = drain.consumed;
          if (drain.shortfall > 0) {
            // v55.83-A.6.27.11 — shortfall handling. Block by default; let
            // user choose to proceed with partial (in which case the
            // adjustment's qty_change is updated to reflect what was
            // ACTUALLY drained, otherwise we'd record a phantom -50 when
            // only -10 came off layers).
            var partialOK = window.confirm(
              'Only ' + drain.qtyDrained + ' units in stock (you requested ' + Math.abs(qty) + ').\n\n' +
              'OK = Adjust qty_change to ' + drain.qtyDrained + ' and proceed.\n' +
              'Cancel = Cancel approval, leave adjustment pending.'
            );
            if (!partialOK) {
              // Rollback the drain we already did
              await reverseFifoConsumption(consumed);
              setBusyApproveId(null);
              return;
            }
            // Update qty on the adjustment record to match actual drained
            qty = -drain.qtyDrained;
            movRow.qty_change = qty;
            // Reflect in the adjustment update below
            adj = Object.assign({}, adj, { qty_change: qty });
          }
        } else if (drain && drain.error) {
          toast && toast.error && toast.error('Drain failed: ' + drain.error);
          setBusyApproveId(null);
          return;
        }
      } else {
        // IN — create a new layer at the weighted-avg cost of existing layers
        var existing = await supabase.from('inv_layers')
          .select('qty_remaining, landed_unit_cost_usd, landed_unit_cost_egp')
          .eq('sku_id', adj.sku_id).eq('warehouse_id', adj.warehouse_id).gt('qty_remaining', 0);
        var totalQty = 0, totalValueUsd = 0, totalValueEgp = 0;
        (existing.data || []).forEach(function (L) {
          var q = Number(L.qty_remaining || 0);
          totalQty += q;
          totalValueUsd += q * Number(L.landed_unit_cost_usd || 0);
          totalValueEgp += q * Number(L.landed_unit_cost_egp || 0);
        });
        var avgUnitUsd = totalQty > 0 ? totalValueUsd / totalQty : 0;
        var avgUnitEgp = totalQty > 0 ? totalValueEgp / totalQty : 0;
        movRow.unit_cost_usd = avgUnitUsd;
        movRow.unit_cost_egp = avgUnitEgp;
        movRow.total_cost_usd = avgUnitUsd * qty;
        movRow.total_cost_egp = avgUnitEgp * qty;
        // Create a new layer for the added stock
        await supabase.from('inv_layers').insert({
          sku_id: adj.sku_id,
          warehouse_id: adj.warehouse_id,
          source_shipment_id: null,
          qty_received: qty,
          qty_remaining: qty,
          landed_unit_cost_usd: avgUnitUsd,
          landed_unit_cost_egp: avgUnitEgp,
          cost_is_provisional: totalQty === 0,
          received_at: new Date().toISOString().substring(0, 10),
        });
      }
      var mRes = await supabase.from('inv_movements').insert(movRow).select().single();
      if (mRes.error) {
        toast && toast.error && toast.error('Movement insert failed: ' + mRes.error.message);
        // Best-effort rollback: if we drained, reverse it
        if (consumed) await reverseFifoConsumption(consumed);
        setBusyApproveId(null);
        return;
      }
      await supabase.from('inv_adjustments').update({
        status: 'approved',
        approved_by: myId,
        approved_at: new Date().toISOString(),
        movement_id: mRes.data.id,
        // v55.83-A.6.27.11 — persist any qty correction made during partial-drain flow
        qty_change: qty,
      }).eq('id', adj.id);
      toast && toast.success && toast.success('Approved');
      await load();
    } catch (e) {
      toast && toast.error && toast.error('Approve error: ' + (e && e.message ? e.message : e));
    }
    setBusyApproveId(null);
  }

  async function rejectAdjustment(adj) {
    if (!canApprove) return;
    var reason = prompt('Why are you rejecting this adjustment?');
    if (!reason) return;
    try {
      var resp = await supabase.from('inv_adjustments').update({
        status: 'rejected',
        approved_by: myId,
        approved_at: new Date().toISOString(),
        rejected_reason: reason,
      }).eq('id', adj.id);
      if (resp.error) { toast && toast.error && toast.error('Reject failed: ' + resp.error.message); return; }
      toast && toast.success && toast.success('Rejected');
      await load();
    } catch (e) {
      toast && toast.error && toast.error('Reject error: ' + (e && e.message ? e.message : e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg p-3 border border-slate-200">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="text-sm font-bold">🔧 Inventory Adjustments</h3>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {['pending', 'approved', 'rejected', 'all'].map(function (s) {
                return (
                  <button key={s} onClick={function () { setStatusFilter(s); }}
                    className={'px-2.5 py-1 rounded text-[10px] font-bold capitalize ' + (statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
                    {s}
                  </button>
                );
              })}
            </div>
            <button onClick={function () { setShowCreate(!showCreate); }}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-xs font-bold">
              {showCreate ? 'Cancel' : '+ New Adjustment'}
            </button>
          </div>
        </div>

        {showCreate && (
          <div className="mt-3 p-3 bg-slate-50 rounded border border-slate-200 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-700">SKU *</label>
                <select value={form.sku_id} onChange={function (e) { setForm(Object.assign({}, form, { sku_id: e.target.value })); }}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
                  <option value="">— select —</option>
                  {(skus || []).map(function (s) { return <option key={s.id} value={s.id}>{s.sku_number} — {s.name}</option>; })}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-700">Warehouse *</label>
                <select value={form.warehouse_id} onChange={function (e) { setForm(Object.assign({}, form, { warehouse_id: e.target.value })); }}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
                  <option value="">— select —</option>
                  {(warehouses || []).map(function (w) { return <option key={w.id} value={w.id}>{w.name}</option>; })}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-700">Type *</label>
                <select value={form.adjustment_type} onChange={function (e) { setForm(Object.assign({}, form, { adjustment_type: e.target.value })); }}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
                  {ADJ_TYPES.map(function (t) { return <option key={t.value} value={t.value}>{t.label}</option>; })}
                </select>
                <div className="text-[9px] text-slate-500 mt-0.5">
                  {(ADJ_TYPES.find(function (t) { return t.value === form.adjustment_type; }) || {}).desc}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-700">Qty Change *</label>
                <input type="number" step="any" value={form.qty_change}
                  onChange={function (e) { setForm(Object.assign({}, form, { qty_change: e.target.value })); }}
                  placeholder="+ for IN, - for OUT (auto for damage/return)"
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
              </div>
              <div className="md:col-span-2">
                <label className="text-[10px] font-bold text-slate-700">Reason *</label>
                <input type="text" value={form.reason}
                  onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }}
                  placeholder="Why is this adjustment being made?"
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-700">Reference Doc (optional)</label>
                <input type="text" value={form.reference_doc}
                  onChange={function (e) { setForm(Object.assign({}, form, { reference_doc: e.target.value })); }}
                  placeholder="e.g. damage report #, return slip #"
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-700">Notes (optional)</label>
                <input type="text" value={form.notes}
                  onChange={function (e) { setForm(Object.assign({}, form, { notes: e.target.value })); }}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={function () { setShowCreate(false); }}
                className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded text-xs font-bold">Cancel</button>
              <button onClick={createAdjustment}
                className="px-3 py-1.5 bg-emerald-500 text-white rounded text-xs font-bold">Submit for Approval</button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-lg p-6 text-center text-xs text-slate-500">⏳ Loading adjustments…</div>
      ) : adjustments.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-900">
          No adjustments {statusFilter !== 'all' ? 'in "' + statusFilter + '" status' : 'recorded yet'}. Use "+ New Adjustment" to record damage, returns, count corrections, or transfers.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-2 text-left text-[10px]">Date</th>
                  <th className="px-2 py-2 text-left text-[10px]">SKU</th>
                  <th className="px-2 py-2 text-left text-[10px]">Warehouse</th>
                  <th className="px-2 py-2 text-left text-[10px]">Type</th>
                  <th className="px-2 py-2 text-right text-[10px]">Qty</th>
                  <th className="px-2 py-2 text-left text-[10px]">Reason</th>
                  <th className="px-2 py-2 text-center text-[10px]">Status</th>
                  <th className="px-2 py-2 text-right text-[10px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map(function (a) {
                  var sku = skuById[a.sku_id];
                  var wh = warehouseById[a.warehouse_id];
                  var typeDef = ADJ_TYPES.find(function (t) { return t.value === a.adjustment_type; });
                  var q = Number(a.qty_change);
                  return (
                    <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-2">{a.created_at ? a.created_at.substring(0, 10) : '—'}</td>
                      <td className="px-2 py-2">{sku ? sku.sku_number : a.sku_id.substring(0, 8) + '…'}</td>
                      <td className="px-2 py-2">{wh ? wh.name : a.warehouse_id.substring(0, 8) + '…'}</td>
                      <td className="px-2 py-2">{typeDef ? typeDef.label : a.adjustment_type}</td>
                      <td className={'px-2 py-2 text-right font-mono font-bold ' + (q < 0 ? 'text-red-700' : 'text-emerald-700')}>
                        {q > 0 ? '+' : ''}{fmt(q, 0)}
                      </td>
                      <td className="px-2 py-2 max-w-[250px] truncate" title={a.reason}>{a.reason}</td>
                      <td className="px-2 py-2 text-center">
                        {a.status === 'pending' && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">⏳ Pending</span>}
                        {a.status === 'approved' && <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold">✓ Approved</span>}
                        {a.status === 'rejected' && <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-900 font-bold" title={a.rejected_reason}>✗ Rejected</span>}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {a.status === 'pending' && canApprove && (
                          <>
                            <button onClick={function () { approveAdjustment(a); }}
                              disabled={busyApproveId === a.id}
                              className="px-2 py-0.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-[10px] font-bold mr-1 disabled:opacity-50">
                              {busyApproveId === a.id ? '…' : 'Approve'}
                            </button>
                            <button onClick={function () { rejectAdjustment(a); }}
                              className="px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded text-[10px] font-bold">
                              Reject
                            </button>
                          </>
                        )}
                        {a.status === 'pending' && !canApprove && (
                          <span className="text-[10px] text-slate-500 italic">Awaiting approval</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
