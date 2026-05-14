// v55.83-A.6.21 (Max May 14 2026) — Inventory Stage B: Shipments
//
// Manages shipments from supplier → port → warehouse → reconciled. Five states:
//   • draft        — being created, can edit freely
//   • in_transit   — committed, on its way (no inventory impact yet)
//   • arrived      — landed at port, awaiting receive
//   • received     — physical receipt confirmed → writes inv_movements rows
//   • reconciled   — expected vs actual variance recorded and accepted
//
// Receive workflow is the critical part: when a shipment moves to 'received',
// every SKU on it generates an inv_movements row (movement_type='receipt',
// qty_change = +qty_primary). Stage C will populate the cost/FX fields; for
// now we write the qty side only so Inventory View works correctly.
//
// Reconciliation: each shipment_sku row may carry actual vs expected qty.
// We track this via a `qty_received_actual` field (added in this build's
// SQL). User clicks Reconcile after physical receipt to confirm or note
// variance with a reason.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { canEditInventory } from '../lib/inventory-permissions';

var STATUSES = [
  { v: 'draft', label: 'Draft', tone: 'slate' },
  { v: 'in_transit', label: 'In Transit', tone: 'amber' },
  { v: 'arrived', label: 'Arrived at Port', tone: 'blue' },
  { v: 'received', label: 'Received', tone: 'emerald' },
  { v: 'reconciled', label: 'Reconciled', tone: 'indigo' },
  { v: 'cancelled', label: 'Cancelled', tone: 'red' },
];

var TONE_CLASSES = {
  slate: 'bg-slate-100 text-slate-800 border-slate-300',
  amber: 'bg-amber-100 text-amber-900 border-amber-300',
  blue: 'bg-blue-100 text-blue-900 border-blue-300',
  emerald: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  indigo: 'bg-indigo-100 text-indigo-900 border-indigo-300',
  red: 'bg-red-100 text-red-900 border-red-300',
};

function fmtNum(n) {
  if (n == null || n === '') return '—';
  var v = Number(n);
  if (isNaN(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function statusBadge(status) {
  var s = STATUSES.find(function (x) { return x.v === status; }) || STATUSES[0];
  return <span className={'inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ' + TONE_CLASSES[s.tone]}>{s.label}</span>;
}

export default function ShipmentsManager({ userProfile, modulePerms, toast }) {
  var myId = userProfile && userProfile.id;
  var canEdit = canEditInventory(userProfile, modulePerms);

  var [shipments, setShipments] = useState([]);
  var [skus, setSkus] = useState([]);
  var [warehouses, setWarehouses] = useState([]);
  var [loading, setLoading] = useState(true);
  var [loadError, setLoadError] = useState(null);
  var [view, setView] = useState('list'); // list | create | detail
  var [selectedShipmentId, setSelectedShipmentId] = useState(null);
  var [statusFilter, setStatusFilter] = useState('all');
  var [working, setWorking] = useState(false);

  // Load everything (best-effort — gracefully handle missing tables)
  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      var [shipResp, skuResp, whResp] = await Promise.all([
        supabase.from('inv_shipments').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
        supabase.from('inv_skus').select('id, sku_number, description, description_ar, primary_unit').is('deleted_at', null),
        supabase.from('inv_warehouses').select('id, code, name, location').is('deleted_at', null),
      ]);
      // Independent error tracking per query (per the user's permanent rule)
      if (shipResp.error) {
        setLoadError(shipResp.error.message || 'Could not load shipments. The inventory schema may not be installed.');
        setShipments([]);
      } else {
        setShipments(shipResp.data || []);
      }
      setSkus(skuResp.data || []);
      setWarehouses(whResp.data || []);
    } catch (e) {
      setLoadError(e.message || String(e));
      setShipments([]); setSkus([]); setWarehouses([]);
    }
    setLoading(false);
  }

  useEffect(function () { loadAll(); }, []);

  var filteredShipments = useMemo(function () {
    if (statusFilter === 'all') return shipments;
    return shipments.filter(function (s) { return s.status === statusFilter; });
  }, [shipments, statusFilter]);

  var selectedShipment = useMemo(function () {
    if (!selectedShipmentId) return null;
    return shipments.find(function (s) { return s.id === selectedShipmentId; }) || null;
  }, [shipments, selectedShipmentId]);

  // ─── Render gates ───────────────────────────────────────────────────────

  if (loadError && shipments.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-300 rounded-xl p-6">
        <div className="text-sm font-bold text-amber-900 mb-2">⚠️ Inventory schema not detected</div>
        <p className="text-xs text-amber-800 mb-2">
          The Shipments tab needs the v55.83-A inventory schema to be installed.
          Run <code className="bg-amber-100 px-1 rounded">sql/v55-83-a-inventory-schema.sql</code> in Supabase, then refresh.
        </p>
        <details className="text-[10px] text-amber-700">
          <summary className="cursor-pointer">Error details</summary>
          <code className="block mt-1 bg-amber-100 p-2 rounded font-mono">{loadError}</code>
        </details>
      </div>
    );
  }

  // ─── Views ─────────────────────────────────────────────────────────────

  if (view === 'create') {
    return (
      <ShipmentCreateForm
        skus={skus}
        warehouses={warehouses}
        canEdit={canEdit}
        myId={myId}
        toast={toast}
        onCancel={function () { setView('list'); }}
        onCreated={async function (newShipmentId) {
          await loadAll();
          setSelectedShipmentId(newShipmentId);
          setView('detail');
        }}
      />
    );
  }

  if (view === 'detail' && selectedShipment) {
    return (
      <ShipmentDetail
        shipment={selectedShipment}
        skus={skus}
        warehouses={warehouses}
        canEdit={canEdit}
        myId={myId}
        toast={toast}
        working={working}
        setWorking={setWorking}
        onBack={function () { setView('list'); setSelectedShipmentId(null); }}
        onChanged={async function () { await loadAll(); }}
      />
    );
  }

  // ── Default: list view ─────────────────────────────────────────────────

  return (
    <div>
      <div className="bg-white rounded-xl p-4 mb-3 border border-slate-200">
        <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold">🚢 Shipments <span className="text-slate-400 font-normal">/ الشحنات</span></h3>
            <p className="text-[11px] text-slate-500">
              Track every incoming shipment from supplier → port → warehouse. Each receipt writes movement records to update inventory.
            </p>
          </div>
          {canEdit && (
            <button onClick={function () { setView('create'); }}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold">
              ➕ New Shipment / شحنة جديدة
            </button>
          )}
        </div>

        {/* Status filter */}
        <div className="flex gap-1 flex-wrap mb-3">
          <button onClick={function () { setStatusFilter('all'); }}
            className={'px-2.5 py-1 rounded-md text-[10px] font-bold border ' + (statusFilter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')}>
            All ({shipments.length})
          </button>
          {STATUSES.map(function (s) {
            var count = shipments.filter(function (x) { return x.status === s.v; }).length;
            return (
              <button key={s.v} onClick={function () { setStatusFilter(s.v); }}
                className={'px-2.5 py-1 rounded-md text-[10px] font-bold border ' + (statusFilter === s.v ? TONE_CLASSES[s.tone] + ' ring-2 ring-offset-1 ring-slate-400' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')}>
                {s.label} ({count})
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="text-center py-8 text-sm text-slate-500">Loading shipments...</div>
        ) : filteredShipments.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-2 opacity-50">📦</div>
            <div className="text-sm font-bold text-slate-700">No shipments {statusFilter === 'all' ? 'yet' : 'with this status'}</div>
            <div className="text-[11px] text-slate-500 mt-1">
              {canEdit ? 'Click "New Shipment" above to create your first one.' : 'Ask a super admin to create one.'}
            </div>
          </div>
        ) : (
          <div className="overflow-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-bold">Ref / المرجع</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold">Supplier / المورد</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold">ETA / Arrival</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold">Warehouse</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold">Total kg</th>
                  <th className="px-3 py-2 text-center text-[10px] font-bold">Status / الحالة</th>
                  <th className="px-3 py-2 text-center text-[10px] font-bold w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filteredShipments.map(function (s) {
                  var wh = warehouses.find(function (w) { return w.id === s.warehouse_id; });
                  return (
                    <tr key={s.id} className="border-t border-slate-100 hover:bg-blue-50">
                      <td className="px-3 py-2 font-mono font-bold text-slate-900">{s.shipment_ref}</td>
                      <td className="px-3 py-2 text-slate-700">{s.supplier_name || '—'}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-600">
                        {s.received_date ? <span className="text-emerald-700">📅 {s.received_date}</span>
                          : s.arrival_date ? <span className="text-blue-700">⚓ {s.arrival_date}</span>
                          : s.eta_date ? <span className="text-amber-700">⏰ {s.eta_date}</span>
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{wh ? wh.name : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtNum(s.total_kg)}</td>
                      <td className="px-3 py-2 text-center">{statusBadge(s.status)}</td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={function () { setSelectedShipmentId(s.id); setView('detail'); }}
                          className="px-2 py-1 rounded bg-slate-100 hover:bg-blue-100 text-slate-700 text-[10px] font-bold">
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// ShipmentCreateForm — minimal header to create a draft shipment.
// Line items (SKU breakdown) are added in the detail view after creation.
// =====================================================================
function ShipmentCreateForm({ skus, warehouses, canEdit, myId, toast, onCancel, onCreated }) {
  var [form, setForm] = useState({
    shipment_ref: '',
    supplier_name: '',
    freight_forwarder: '',
    shipping_line: '',
    eta_date: '',
    arrival_date: '',
    warehouse_id: warehouses[0] && warehouses[0].id || '',
    purchase_currency: 'USD',
    notes: '',
  });
  var [saving, setSaving] = useState(false);

  if (!canEdit) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <p className="text-sm font-bold text-amber-900">Edit access required / يلزم صلاحية التعديل</p>
        <button onClick={onCancel} className="mt-2 px-3 py-1 rounded bg-slate-200 text-slate-700 text-xs font-bold">Back</button>
      </div>
    );
  }

  async function submit() {
    if (!form.shipment_ref || !form.shipment_ref.trim()) {
      toast && toast.error && toast.error('Shipment reference is required / المرجع مطلوب');
      return;
    }
    setSaving(true);
    try {
      var resp = await supabase.from('inv_shipments').insert({
        shipment_ref: form.shipment_ref.trim(),
        supplier_name: form.supplier_name || null,
        freight_forwarder: form.freight_forwarder || null,
        shipping_line: form.shipping_line || null,
        eta_date: form.eta_date || null,
        arrival_date: form.arrival_date || null,
        warehouse_id: form.warehouse_id || null,
        purchase_currency: form.purchase_currency || 'USD',
        notes: form.notes || null,
        status: 'draft',
        created_by: myId,
      }).select().single();
      if (resp.error) throw resp.error;
      toast && toast.success && toast.success('Draft shipment created / تم إنشاء مسودة الشحنة');
      if (onCreated) await onCreated(resp.data.id);
    } catch (e) {
      toast && toast.error && toast.error('Create failed: ' + (e.message || e));
    }
    setSaving(false);
  }

  return (
    <div className="bg-white rounded-xl p-4 border border-slate-200">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold">➕ New Shipment <span className="text-slate-400 font-normal">/ شحنة جديدة</span></h3>
        <button onClick={onCancel} disabled={saving}
          className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-xs">← Back</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Shipment Reference <span className="text-red-600">*</span> / المرجع</label>
          <input value={form.shipment_ref} onChange={function (e) { setForm(Object.assign({}, form, { shipment_ref: e.target.value })); }}
            placeholder="e.g. KTC-2026-042 or container # / مثال: رقم الحاوية"
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Supplier / المورد</label>
          <input value={form.supplier_name} onChange={function (e) { setForm(Object.assign({}, form, { supplier_name: e.target.value })); }}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Destination Warehouse / المستودع</label>
          <select value={form.warehouse_id} onChange={function (e) { setForm(Object.assign({}, form, { warehouse_id: e.target.value })); }}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
            <option value="">— Select warehouse —</option>
            {warehouses.map(function (w) { return <option key={w.id} value={w.id}>{w.name} {w.code ? '(' + w.code + ')' : ''}</option>; })}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Freight Forwarder / وكيل الشحن</label>
          <input value={form.freight_forwarder} onChange={function (e) { setForm(Object.assign({}, form, { freight_forwarder: e.target.value })); }}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Shipping Line / خط الشحن</label>
          <input value={form.shipping_line} onChange={function (e) { setForm(Object.assign({}, form, { shipping_line: e.target.value })); }}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">ETA Date / التاريخ المتوقع</label>
          <input type="date" value={form.eta_date} onChange={function (e) { setForm(Object.assign({}, form, { eta_date: e.target.value })); }}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Arrival Date / تاريخ الوصول</label>
          <input type="date" value={form.arrival_date} onChange={function (e) { setForm(Object.assign({}, form, { arrival_date: e.target.value })); }}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Purchase Currency / عملة الشراء</label>
          <select value={form.purchase_currency} onChange={function (e) { setForm(Object.assign({}, form, { purchase_currency: e.target.value })); }}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="EGP">EGP</option>
            <option value="GBP">GBP</option>
            <option value="CNY">CNY</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-[11px] font-bold text-slate-700 mb-1">Notes / ملاحظات</label>
          <textarea value={form.notes} onChange={function (e) { setForm(Object.assign({}, form, { notes: e.target.value })); }}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" rows={2} />
        </div>
      </div>

      <div className="mt-3 text-[10px] text-slate-500">
        Cost components (freight, customs, etc.) and SKU line items are added next, in the detail view.
      </div>

      <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-100">
        <button onClick={onCancel} disabled={saving}
          className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold">
          Cancel
        </button>
        <button onClick={submit} disabled={saving || !form.shipment_ref.trim()}
          className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold">
          {saving ? 'Saving...' : '💾 Create Draft'}
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// ShipmentDetail — view & edit a single shipment, add SKU line items,
// edit costs, transition status, run reconciliation. The big one.
// =====================================================================
function ShipmentDetail({ shipment, skus, warehouses, canEdit, myId, toast, working, setWorking, onBack, onChanged }) {
  var [lineItems, setLineItems] = useState([]);
  var [movements, setMovements] = useState([]);
  var [loadingLines, setLoadingLines] = useState(true);
  var [addingItem, setAddingItem] = useState(false);
  var [itemForm, setItemForm] = useState({ sku_id: '', qty_primary: '', roll_count: '', qty_kg: '', notes: '' });
  var [editingCosts, setEditingCosts] = useState(false);
  var [costForm, setCostForm] = useState({
    purchase_cost: shipment.purchase_cost || '',
    freight_cost: shipment.freight_cost || '',
    customs_cost: shipment.customs_cost || '',
    port_fees: shipment.port_fees || '',
    inland_transport: shipment.inland_transport || '',
    handling_fees: shipment.handling_fees || '',
    other_charges: shipment.other_charges || '',
  });

  async function loadLines() {
    setLoadingLines(true);
    try {
      var [linesResp, movsResp] = await Promise.all([
        supabase.from('inv_shipment_skus').select('*').eq('shipment_id', shipment.id),
        supabase.from('inv_movements').select('*').eq('source_table', 'inv_shipments').eq('source_id', shipment.id),
      ]);
      setLineItems(linesResp.data || []);
      setMovements(movsResp.data || []);
    } catch (e) {
      setLineItems([]); setMovements([]);
    }
    setLoadingLines(false);
  }

  useEffect(function () { loadLines(); }, [shipment.id]);

  function skuById(id) {
    return skus.find(function (x) { return x.id === id; });
  }

  // ─── Status transitions ────────────────────────────────────────────────
  // valid transitions: draft → in_transit | cancelled
  //                    in_transit → arrived | cancelled
  //                    arrived → received
  //                    received → reconciled
  var allowedNext = useMemo(function () {
    switch (shipment.status) {
      case 'draft': return [{ v: 'in_transit', label: 'Mark In Transit', tone: 'amber' }, { v: 'cancelled', label: 'Cancel', tone: 'red' }];
      case 'in_transit': return [{ v: 'arrived', label: 'Mark Arrived at Port', tone: 'blue' }, { v: 'cancelled', label: 'Cancel', tone: 'red' }];
      case 'arrived': return [{ v: 'received', label: 'Receive into Warehouse', tone: 'emerald' }];
      case 'received': return [{ v: 'reconciled', label: 'Mark Reconciled', tone: 'indigo' }];
      default: return [];
    }
  }, [shipment.status]);

  async function transitionTo(nextStatus) {
    if (!canEdit) return;
    // For 'received', generate inv_movements rows
    if (nextStatus === 'received') {
      if (lineItems.length === 0) {
        toast && toast.error && toast.error('Cannot receive a shipment with no SKU line items / لا توجد بنود لاستلامها');
        return;
      }
      if (!shipment.warehouse_id) {
        toast && toast.error && toast.error('Set a destination warehouse before receiving / حدد المستودع أولاً');
        return;
      }
      if (!confirm('Receive this shipment into warehouse "' + (warehouses.find(function (w) { return w.id === shipment.warehouse_id; }) || {}).name + '"? This will create inventory movement records for each SKU. / تأكيد الاستلام؟')) return;
    } else if (nextStatus === 'cancelled') {
      if (!confirm('Cancel this shipment? This cannot be undone via the UI. / إلغاء؟')) return;
    }
    setWorking(true);
    try {
      var updates = { status: nextStatus };
      if (nextStatus === 'received') {
        updates.received_date = new Date().toISOString().substring(0, 10);
      }
      var r = await supabase.from('inv_shipments').update(updates).eq('id', shipment.id);
      if (r.error) throw r.error;

      // Write inv_movements rows for 'received' transition
      if (nextStatus === 'received') {
        var movRows = lineItems.map(function (li) {
          var lineWh = li.warehouse_id || shipment.warehouse_id;
          return {
            sku_id: li.sku_id,
            warehouse_id: lineWh,
            movement_type: 'receipt',
            qty_change: Number(li.qty_primary || 0),
            source_table: 'inv_shipments',
            source_id: shipment.id,
            movement_date: new Date().toISOString().substring(0, 10),
            user_id: myId,
            reason: 'Received from shipment ' + shipment.shipment_ref,
            notes: li.notes || null,
          };
        }).filter(function (m) { return Number(m.qty_change) > 0; });

        if (movRows.length > 0) {
          var movResp = await supabase.from('inv_movements').insert(movRows);
          if (movResp.error) {
            // Don't fail the status transition if movements fail — log it
            // and let user retry via a manual receive UI later (Stage C)
            console.warn('[shipment-receive] movement write failed:', movResp.error);
            toast && toast.error && toast.error('Status changed, but movements write failed: ' + (movResp.error.message || ''));
          }
        }
      }
      toast && toast.success && toast.success('Status updated to ' + nextStatus + ' / تم تحديث الحالة');
      if (onChanged) await onChanged();
      await loadLines();
    } catch (e) {
      toast && toast.error && toast.error('Status change failed: ' + (e.message || e));
    }
    setWorking(false);
  }

  // ─── Line item add/delete ──────────────────────────────────────────────
  async function addLineItem() {
    if (!itemForm.sku_id) { toast && toast.error && toast.error('Pick a SKU / اختر منتجًا'); return; }
    if (!itemForm.qty_primary || Number(itemForm.qty_primary) <= 0) {
      toast && toast.error && toast.error('Quantity must be > 0 / الكمية يجب أن تكون أكبر من صفر');
      return;
    }
    setWorking(true);
    try {
      var resp = await supabase.from('inv_shipment_skus').insert({
        shipment_id: shipment.id,
        sku_id: itemForm.sku_id,
        qty_primary: Number(itemForm.qty_primary),
        qty_kg: itemForm.qty_kg ? Number(itemForm.qty_kg) : null,
        roll_count: itemForm.roll_count ? Number(itemForm.roll_count) : null,
        warehouse_id: shipment.warehouse_id || null,
        notes: itemForm.notes || null,
        created_by: myId,
      });
      if (resp.error) throw resp.error;
      toast && toast.success && toast.success('Line item added / تم إضافة البند');
      setItemForm({ sku_id: '', qty_primary: '', roll_count: '', qty_kg: '', notes: '' });
      setAddingItem(false);
      await loadLines();
    } catch (e) {
      toast && toast.error && toast.error('Add failed: ' + (e.message || e));
    }
    setWorking(false);
  }

  async function deleteLineItem(lineId) {
    if (!confirm('Delete this line item from the shipment? / حذف هذا البند؟')) return;
    setWorking(true);
    try {
      var r = await supabase.from('inv_shipment_skus').delete().eq('id', lineId);
      if (r.error) throw r.error;
      toast && toast.success && toast.success('Line removed / تم الحذف');
      await loadLines();
    } catch (e) {
      toast && toast.error && toast.error('Delete failed: ' + (e.message || e));
    }
    setWorking(false);
  }

  async function saveCosts() {
    setWorking(true);
    try {
      var updates = {
        purchase_cost: costForm.purchase_cost ? Number(costForm.purchase_cost) : null,
        freight_cost: costForm.freight_cost ? Number(costForm.freight_cost) : null,
        customs_cost: costForm.customs_cost ? Number(costForm.customs_cost) : null,
        port_fees: costForm.port_fees ? Number(costForm.port_fees) : null,
        inland_transport: costForm.inland_transport ? Number(costForm.inland_transport) : null,
        handling_fees: costForm.handling_fees ? Number(costForm.handling_fees) : null,
        other_charges: costForm.other_charges ? Number(costForm.other_charges) : null,
      };
      var r = await supabase.from('inv_shipments').update(updates).eq('id', shipment.id);
      if (r.error) throw r.error;
      toast && toast.success && toast.success('Costs saved / تم الحفظ');
      setEditingCosts(false);
      if (onChanged) await onChanged();
    } catch (e) {
      toast && toast.error && toast.error('Save failed: ' + (e.message || e));
    }
    setWorking(false);
  }

  // ─── Reconciliation per line item ──────────────────────────────────────
  async function reconcileLine(line, actualQty, reason) {
    setWorking(true);
    try {
      var variance = Number(actualQty) - Number(line.qty_primary);
      var r = await supabase.from('inv_shipment_skus').update({
        qty_received_actual: Number(actualQty),
        variance: variance,
        variance_reason: reason || null,
      }).eq('id', line.id);
      if (r.error) {
        // Column may not exist if SQL migration for A.6.21 not run
        toast && toast.error && toast.error('Reconciliation save failed (run the v55.83-A.6.21 SQL): ' + (r.error.message || ''));
      } else {
        toast && toast.success && toast.success('Reconciled / تم التسوية. Variance: ' + variance);
      }
      await loadLines();
    } catch (e) {
      toast && toast.error && toast.error('Reconcile failed: ' + (e.message || e));
    }
    setWorking(false);
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  var warehouseName = (warehouses.find(function (w) { return w.id === shipment.warehouse_id; }) || {}).name || '—';
  var isReceived = shipment.status === 'received' || shipment.status === 'reconciled';

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex justify-between items-start flex-wrap gap-2">
        <div>
          <button onClick={onBack} className="text-[11px] text-slate-500 hover:text-slate-900 mb-1">← Back to shipments list</button>
          <h3 className="text-base font-extrabold">🚢 {shipment.shipment_ref}</h3>
          <div className="text-[11px] text-slate-600 mt-0.5">
            {shipment.supplier_name && <span>{shipment.supplier_name} · </span>}
            <span>→ {warehouseName}</span>
            {shipment.received_date && <span> · received {shipment.received_date}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {statusBadge(shipment.status)}
          {canEdit && allowedNext.map(function (n) {
            return (
              <button key={n.v} onClick={function () { transitionTo(n.v); }} disabled={working}
                className={'px-2.5 py-1 rounded text-[10px] font-bold border disabled:opacity-50 ' + TONE_CLASSES[n.tone]}>
                → {n.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Costs section */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-xs font-bold text-slate-700">💰 Cost Components ({shipment.purchase_currency || 'USD'})</h4>
          {canEdit && !isReceived && (
            <button onClick={function () { setEditingCosts(!editingCosts); }}
              className="text-[10px] text-blue-600 hover:underline">
              {editingCosts ? 'Cancel' : '✏️ Edit'}
            </button>
          )}
        </div>
        {editingCosts ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {['purchase_cost', 'freight_cost', 'customs_cost', 'port_fees', 'inland_transport', 'handling_fees', 'other_charges'].map(function (k) {
              return (
                <div key={k}>
                  <label className="block text-[10px] font-bold text-slate-600 capitalize">{k.replace(/_/g, ' ')}</label>
                  <input type="number" value={costForm[k]} onChange={function (e) { setCostForm(Object.assign({}, costForm, { [k]: e.target.value })); }}
                    className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
                </div>
              );
            })}
            <div className="md:col-span-4 flex justify-end gap-2 mt-2">
              <button onClick={function () { setEditingCosts(false); }} className="px-2 py-1 text-xs">Cancel</button>
              <button onClick={saveCosts} disabled={working}
                className="px-3 py-1 rounded bg-indigo-600 text-white text-xs font-bold disabled:opacity-50">Save</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            {[
              ['Purchase', shipment.purchase_cost],
              ['Freight', shipment.freight_cost],
              ['Customs', shipment.customs_cost],
              ['Port Fees', shipment.port_fees],
              ['Inland', shipment.inland_transport],
              ['Handling', shipment.handling_fees],
              ['Other', shipment.other_charges],
            ].map(function (pair) {
              return (
                <div key={pair[0]} className="bg-slate-50 rounded p-2">
                  <div className="text-[9px] text-slate-500 font-bold uppercase">{pair[0]}</div>
                  <div className="font-mono">{fmtNum(pair[1])}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SKU line items section */}
      <div className="p-4">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-xs font-bold text-slate-700">📦 SKU Breakdown ({lineItems.length} {lineItems.length === 1 ? 'item' : 'items'})</h4>
          {canEdit && !isReceived && (
            <button onClick={function () { setAddingItem(!addingItem); }}
              className="px-2 py-1 rounded bg-blue-100 hover:bg-blue-200 text-blue-800 text-[10px] font-bold">
              {addingItem ? '✕ Cancel' : '➕ Add SKU'}
            </button>
          )}
        </div>

        {addingItem && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="md:col-span-3">
                <label className="block text-[10px] font-bold text-slate-700">SKU</label>
                <select value={itemForm.sku_id} onChange={function (e) { setItemForm(Object.assign({}, itemForm, { sku_id: e.target.value })); }}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
                  <option value="">— Pick a SKU —</option>
                  {skus.map(function (s) { return <option key={s.id} value={s.id}>{s.sku_number} — {s.description}</option>; })}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-700">Qty (primary unit) <span className="text-red-600">*</span></label>
                <input type="number" value={itemForm.qty_primary} onChange={function (e) { setItemForm(Object.assign({}, itemForm, { qty_primary: e.target.value })); }}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-700">Qty in kg</label>
                <input type="number" value={itemForm.qty_kg} onChange={function (e) { setItemForm(Object.assign({}, itemForm, { qty_kg: e.target.value })); }}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-700">Roll count</label>
                <input type="number" value={itemForm.roll_count} onChange={function (e) { setItemForm(Object.assign({}, itemForm, { roll_count: e.target.value })); }}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] font-bold text-slate-700">Notes</label>
                <input value={itemForm.notes} onChange={function (e) { setItemForm(Object.assign({}, itemForm, { notes: e.target.value })); }}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
              </div>
            </div>
            <div className="flex justify-end mt-2">
              <button onClick={addLineItem} disabled={working}
                className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-bold disabled:opacity-50">
                {working ? 'Adding...' : '💾 Add Line'}
              </button>
            </div>
          </div>
        )}

        {loadingLines ? (
          <div className="text-center py-4 text-xs text-slate-500">Loading...</div>
        ) : lineItems.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-500">
            <div className="text-2xl mb-1 opacity-40">📭</div>
            No SKU line items yet. {canEdit ? 'Add at least one before receiving.' : ''}
          </div>
        ) : (
          <div className="overflow-auto border border-slate-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[10px]">SKU</th>
                  <th className="px-2 py-1.5 text-left text-[10px]">Description</th>
                  <th className="px-2 py-1.5 text-right text-[10px]">Expected Qty</th>
                  <th className="px-2 py-1.5 text-right text-[10px]">Kg</th>
                  <th className="px-2 py-1.5 text-right text-[10px]">Actual Received</th>
                  <th className="px-2 py-1.5 text-right text-[10px]">Variance</th>
                  {canEdit && <th className="px-2 py-1.5 text-center text-[10px] w-16"></th>}
                </tr>
              </thead>
              <tbody>
                {lineItems.map(function (li) {
                  var sku = skuById(li.sku_id);
                  var hasReconcile = li.qty_received_actual != null;
                  return (
                    <ReconcileRow key={li.id}
                      line={li} sku={sku} canEdit={canEdit} isReceived={isReceived}
                      working={working}
                      onDelete={function () { deleteLineItem(li.id); }}
                      onReconcile={function (actualQty, reason) { reconcileLine(li, actualQty, reason); }}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Movements summary if any */}
      {movements.length > 0 && (
        <div className="p-4 border-t border-slate-100">
          <h4 className="text-xs font-bold text-slate-700 mb-2">📜 Inventory Movements Created ({movements.length})</h4>
          <div className="text-[10px] text-slate-500">
            This shipment created {movements.length} inventory movement record{movements.length === 1 ? '' : 's'} when it was received. See the Movements tab for full audit history.
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// ReconcileRow — single line item row with inline reconcile action.
// =====================================================================
function ReconcileRow({ line, sku, canEdit, isReceived, working, onDelete, onReconcile }) {
  var [editing, setEditing] = useState(false);
  var [actual, setActual] = useState(line.qty_received_actual != null ? String(line.qty_received_actual) : String(line.qty_primary || ''));
  var [reason, setReason] = useState(line.variance_reason || '');

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-2 py-1.5 font-mono text-[10px] text-slate-700">{sku ? sku.sku_number : '—'}</td>
        <td className="px-2 py-1.5 text-xs">{sku ? sku.description : '(deleted)'}</td>
        <td className="px-2 py-1.5 text-right font-mono">{fmtNum(line.qty_primary)}</td>
        <td className="px-2 py-1.5 text-right font-mono">{fmtNum(line.qty_kg)}</td>
        <td className="px-2 py-1.5 text-right font-mono">
          {line.qty_received_actual != null ? <span className="font-bold text-emerald-700">{fmtNum(line.qty_received_actual)}</span> : <span className="text-slate-400">—</span>}
        </td>
        <td className="px-2 py-1.5 text-right font-mono">
          {line.variance != null ? (
            <span className={'font-bold ' + (Number(line.variance) === 0 ? 'text-emerald-700' : Math.abs(Number(line.variance)) < 1 ? 'text-amber-700' : 'text-red-700')}>
              {Number(line.variance) > 0 ? '+' : ''}{fmtNum(line.variance)}
            </span>
          ) : <span className="text-slate-400">—</span>}
        </td>
        {canEdit && (
          <td className="px-2 py-1.5 text-center">
            <div className="flex gap-1 justify-center">
              {isReceived && (
                <button onClick={function () { setEditing(!editing); }}
                  className="px-1.5 py-0.5 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-800 text-[9px] font-bold">
                  {editing ? '✕' : '⚖️'}
                </button>
              )}
              {!isReceived && (
                <button onClick={onDelete} disabled={working}
                  className="px-1.5 py-0.5 rounded text-red-600 hover:bg-red-100 text-[10px] font-bold">
                  🗑
                </button>
              )}
            </div>
          </td>
        )}
      </tr>
      {editing && (
        <tr>
          <td colSpan={7} className="bg-indigo-50 p-3">
            <div className="text-[11px] font-bold text-indigo-900 mb-2">⚖️ Reconcile actual quantity received</div>
            <div className="flex gap-2 items-end flex-wrap">
              <div>
                <label className="block text-[10px] text-slate-700">Actual qty received</label>
                <input type="number" value={actual} onChange={function (e) { setActual(e.target.value); }}
                  className="w-32 border border-slate-300 rounded px-2 py-1 text-xs" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-[10px] text-slate-700">Reason (if variance)</label>
                <input value={reason} onChange={function (e) { setReason(e.target.value); }}
                  placeholder="e.g. damaged on arrival, short shipment, etc."
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
              </div>
              <button onClick={function () { onReconcile(actual, reason); setEditing(false); }} disabled={working}
                className="px-3 py-1 rounded bg-indigo-600 text-white text-xs font-bold disabled:opacity-50">
                {working ? 'Saving...' : '💾 Save'}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
