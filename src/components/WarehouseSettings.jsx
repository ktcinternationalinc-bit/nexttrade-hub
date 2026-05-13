// v55.83-A — Warehouse Management (Inventory Module)
// CRUD on inv_warehouses. Admin gate. Used both inline in the Inventory tab
// and standalone in Settings.
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { dbInsert, dbUpdate } from '../lib/supabase';
import { canEditInventory } from '../lib/inventory-permissions';

export default function WarehouseSettings({ userProfile, modulePerms, toast }) {
  var [warehouses, setWarehouses] = useState([]);
  var [loading, setLoading] = useState(true);
  var [editing, setEditing] = useState(null); // row being edited, or null
  var [showAdd, setShowAdd] = useState(false);
  var [form, setForm] = useState({});

  var canEdit = canEditInventory(userProfile, modulePerms);

  var loadWarehouses = async function () {
    setLoading(true);
    var res = await supabase
      .from('inv_warehouses')
      .select('*')
      .is('deleted_at', null)
      .order('code');
    setWarehouses((res && res.data) || []);
    setLoading(false);
  };

  useEffect(function () { loadWarehouses(); }, []);

  var handleSave = async function () {
    if (!form.name || !form.code) {
      if (toast) toast.warning('Name and code are required');
      return;
    }
    try {
      var payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        country: form.country || null,
        address: form.address || null,
        default_currency: form.default_currency || 'USD',
        is_active: form.is_active !== false,
        notes: form.notes || null,
      };
      if (editing) {
        await dbUpdate('inv_warehouses', editing.id, payload, userProfile && userProfile.id);
        if (toast) toast.success('Warehouse updated');
      } else {
        payload.created_by = (userProfile && userProfile.id) || null;
        await dbInsert('inv_warehouses', payload, userProfile && userProfile.id);
        if (toast) toast.success('Warehouse added');
      }
      setForm({}); setEditing(null); setShowAdd(false);
      loadWarehouses();
    } catch (err) {
      if (toast) toast.error('Save failed: ' + (err && err.message));
    }
  };

  var handleDelete = async function (wh) {
    if (!window.confirm('Soft-delete warehouse "' + wh.name + '"? It will be hidden but the data is preserved. Stock movements referencing it remain intact.')) return;
    try {
      await dbUpdate('inv_warehouses', wh.id, { deleted_at: new Date().toISOString(), is_active: false }, userProfile && userProfile.id);
      if (toast) toast.success('Warehouse archived');
      loadWarehouses();
    } catch (err) {
      if (toast) toast.error('Delete failed: ' + (err && err.message));
    }
  };

  var openEdit = function (wh) {
    setEditing(wh);
    setForm({
      name: wh.name,
      code: wh.code,
      country: wh.country || '',
      address: wh.address || '',
      default_currency: wh.default_currency || 'USD',
      is_active: wh.is_active,
      notes: wh.notes || '',
    });
    setShowAdd(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">🏭 Warehouses</h3>
          <p className="text-xs text-slate-500">Physical stock locations. Every shipment receives into one.</p>
        </div>
        {canEdit && !showAdd && (
          <button
            onClick={function () { setForm({ default_currency: 'USD', is_active: true }); setEditing(null); setShowAdd(true); }}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
          >+ Add Warehouse</button>
        )}
      </div>

      {showAdd && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
          <div className="text-xs font-bold text-emerald-900 mb-2">
            {editing ? 'Edit warehouse' : 'New warehouse'}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold block">Name *</label>
              <input value={form.name || ''} onChange={function (e) { setForm(Object.assign({}, form, { name: e.target.value })); }}
                placeholder="e.g. Cairo Main"
                className="w-full px-2 py-1.5 rounded border text-xs" />
            </div>
            <div>
              <label className="text-[10px] font-semibold block">Code * (short ID)</label>
              <input value={form.code || ''} onChange={function (e) { setForm(Object.assign({}, form, { code: e.target.value.toUpperCase() })); }}
                placeholder="EG-CAI"
                className="w-full px-2 py-1.5 rounded border text-xs font-mono" />
            </div>
            <div>
              <label className="text-[10px] font-semibold block">Country</label>
              <input value={form.country || ''} onChange={function (e) { setForm(Object.assign({}, form, { country: e.target.value })); }}
                placeholder="EG / US / etc."
                className="w-full px-2 py-1.5 rounded border text-xs" />
            </div>
            <div>
              <label className="text-[10px] font-semibold block">Default currency</label>
              <select value={form.default_currency || 'USD'} onChange={function (e) { setForm(Object.assign({}, form, { default_currency: e.target.value })); }}
                className="w-full px-2 py-1.5 rounded border text-xs">
                <option value="EGP">EGP — Egyptian Pound</option>
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-semibold block">Address</label>
              <input value={form.address || ''} onChange={function (e) { setForm(Object.assign({}, form, { address: e.target.value })); }}
                className="w-full px-2 py-1.5 rounded border text-xs" />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-semibold block">Notes</label>
              <textarea value={form.notes || ''} onChange={function (e) { setForm(Object.assign({}, form, { notes: e.target.value })); }}
                rows={2}
                className="w-full px-2 py-1.5 rounded border text-xs" />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={form.is_active !== false}
                onChange={function (e) { setForm(Object.assign({}, form, { is_active: e.target.checked })); }} />
              <span>Active (uncheck to hide from new shipments without deleting)</span>
            </label>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={handleSave}
              className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
              {editing ? 'Save changes' : 'Add warehouse'}
            </button>
            <button onClick={function () { setShowAdd(false); setEditing(null); setForm({}); }}
              className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-slate-500 py-4 text-center">Loading warehouses…</div>
      ) : warehouses.length === 0 ? (
        <div className="text-xs text-slate-500 py-4 text-center bg-slate-50 rounded-lg border border-dashed">
          No warehouses yet. Click <strong>Add Warehouse</strong> above to create one.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Code</th>
                <th className="text-left px-3 py-2 font-semibold">Name</th>
                <th className="text-left px-3 py-2 font-semibold">Country</th>
                <th className="text-left px-3 py-2 font-semibold">Default Currency</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
                {canEdit && <th className="text-right px-3 py-2 font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {warehouses.map(function (wh) {
                return (
                  <tr key={wh.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono font-bold text-slate-700">{wh.code}</td>
                    <td className="px-3 py-2 font-semibold">{wh.name}</td>
                    <td className="px-3 py-2 text-slate-600">{wh.country || '—'}</td>
                    <td className="px-3 py-2"><span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 text-[10px] font-bold">{wh.default_currency}</span></td>
                    <td className="px-3 py-2">
                      {wh.is_active
                        ? <span className="text-emerald-700 font-semibold">● Active</span>
                        : <span className="text-slate-500">○ Inactive</span>}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2 text-right">
                        <button onClick={function () { openEdit(wh); }}
                          className="px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 text-[10px] font-bold mr-1">
                          Edit
                        </button>
                        <button onClick={function () { handleDelete(wh); }}
                          className="px-2 py-1 rounded bg-rose-100 text-rose-700 hover:bg-rose-200 text-[10px] font-bold">
                          Archive
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
