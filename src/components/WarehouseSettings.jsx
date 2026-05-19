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

  // v55.83-A.6.27.31 — Esc closes the modal
  useEffect(function () {
    function onKey(e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && showAdd) {
        setShowAdd(false); setEditing(null); setForm({});
      }
    }
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, [showAdd]);

  var handleSave = async function () {
    // v55.83-A.6.27.31 (Max May 19 2026) — Max reported "click Add Warehouse,
    // nothing happens". Same root cause pattern as A.6.27.24 Master Lists:
    // inline form rendered ABOVE the list grew the page downward but didn't
    // auto-scroll. Form WAS opening, just below the fold. Fix below: convert
    // to centered modal. Save also gets diagnostic logging + alert fallback
    // so failures are never silent.
    console.log('[warehouse] handleSave called. editing =', editing, ' form =', form);
    if (!form.name || !form.code) {
      console.warn('[warehouse] validation failed: name or code missing');
      if (toast) toast.warning('Name and code are required');
      alert('Name and Code are both required.\n\nName: "' + (form.name || '') + '"\nCode: "' + (form.code || '') + '"');
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
      console.log('[warehouse] payload =', payload);
      if (editing) {
        console.log('[warehouse] dbUpdate id =', editing.id);
        await dbUpdate('inv_warehouses', editing.id, payload, userProfile && userProfile.id);
        console.log('[warehouse] update SUCCESS');
        if (toast) toast.success('Warehouse updated');
      } else {
        payload.created_by = (userProfile && userProfile.id) || null;
        console.log('[warehouse] dbInsert');
        await dbInsert('inv_warehouses', payload, userProfile && userProfile.id);
        console.log('[warehouse] insert SUCCESS');
        if (toast) toast.success('Warehouse added');
      }
      setForm({}); setEditing(null); setShowAdd(false);
      loadWarehouses();
    } catch (err) {
      console.error('[warehouse] save FAILED:', err);
      var msg = (err && err.message) || String(err);
      if (toast) toast.error('Save failed: ' + msg);
      alert('Save failed: ' + msg + '\n\nIf this is the first time you\'re adding a warehouse, make sure your user account has Edit Inventory permission, and that the inv_warehouses table exists in Supabase.');
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
            onClick={function () {
              console.log('[warehouse] + Add Warehouse button CLICKED — opening modal');
              setForm({ default_currency: 'USD', is_active: true });
              setEditing(null);
              setShowAdd(true);
            }}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
          >+ Add Warehouse</button>
        )}
      </div>

      {/* v55.83-A.6.27.31 — converted inline form to centered modal.
          Previously the form rendered inline above the warehouse list,
          growing the page downward. On longer pages users clicked "Add"
          and the form opened below the fold — looking like nothing happened.
          Now: centered modal with sticky footer, always visible regardless
          of page length. Click outside / Esc to close. */}
      {showAdd && (
        <div
          className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm overflow-y-auto"
          onClick={function () { setShowAdd(false); setEditing(null); setForm({}); }}
          style={{ padding: 16 }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl mx-auto"
            onClick={function (e) { e.stopPropagation(); }}
            style={{ maxWidth: 640 }}
          >
            {/* Modal header */}
            <div
              className="rounded-t-2xl flex justify-between items-center gap-2"
              style={{ background: '#3730a3', padding: '14px 20px' }}
            >
              <div>
                <div className="text-lg font-extrabold" style={{ color: '#ffffff' }}>
                  🏭 {editing ? 'Edit warehouse' : 'New warehouse'}
                </div>
                <div className="text-xs font-semibold" style={{ color: '#e0e7ff' }}>
                  Physical stock location. Every receipt needs a warehouse.
                </div>
              </div>
              <button
                onClick={function () { setShowAdd(false); setEditing(null); setForm({}); }}
                aria-label="Close"
                style={{ background: '#ffffff', color: '#1e293b', width: 36, height: 36, fontSize: 20, lineHeight: 1, border: '2px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', borderRadius: '50%', fontWeight: 800 }}
              >
                ✕
              </button>
            </div>

            {/* Modal body */}
            <div style={{ padding: 20, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-extrabold text-slate-700 block">Name *</label>
                  <input value={form.name || ''} onChange={function (e) { setForm(Object.assign({}, form, { name: e.target.value })); }}
                    placeholder="e.g. Cairo Main"
                    className="w-full mt-0.5 px-2 py-1.5 rounded border border-slate-300 text-sm bg-white" />
                </div>
                <div>
                  <label className="text-[11px] font-extrabold text-slate-700 block">Code * (short ID)</label>
                  <input value={form.code || ''} onChange={function (e) { setForm(Object.assign({}, form, { code: e.target.value.toUpperCase() })); }}
                    placeholder="EG-CAI"
                    className="w-full mt-0.5 px-2 py-1.5 rounded border border-slate-300 text-sm font-mono bg-white" />
                </div>
                <div>
                  <label className="text-[11px] font-extrabold text-slate-700 block">Country</label>
                  <input value={form.country || ''} onChange={function (e) { setForm(Object.assign({}, form, { country: e.target.value })); }}
                    placeholder="EG / US / etc."
                    className="w-full mt-0.5 px-2 py-1.5 rounded border border-slate-300 text-sm bg-white" />
                </div>
                <div>
                  <label className="text-[11px] font-extrabold text-slate-700 block">Default currency</label>
                  <select value={form.default_currency || 'USD'} onChange={function (e) { setForm(Object.assign({}, form, { default_currency: e.target.value })); }}
                    className="w-full mt-0.5 px-2 py-1.5 rounded border border-slate-300 text-sm bg-white">
                    <option value="EGP">EGP — Egyptian Pound</option>
                    <option value="USD">USD — US Dollar</option>
                    <option value="EUR">EUR — Euro</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] font-extrabold text-slate-700 block">Address</label>
                  <input value={form.address || ''} onChange={function (e) { setForm(Object.assign({}, form, { address: e.target.value })); }}
                    className="w-full mt-0.5 px-2 py-1.5 rounded border border-slate-300 text-sm bg-white" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] font-extrabold text-slate-700 block">Notes</label>
                  <textarea value={form.notes || ''} onChange={function (e) { setForm(Object.assign({}, form, { notes: e.target.value })); }}
                    rows={2}
                    className="w-full mt-0.5 px-2 py-1.5 rounded border border-slate-300 text-sm bg-white resize-none" />
                </div>
                <label className="col-span-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={form.is_active !== false}
                    onChange={function (e) { setForm(Object.assign({}, form, { is_active: e.target.checked })); }} />
                  <span className="font-semibold text-slate-700">Active (uncheck to hide from new shipments without deleting)</span>
                </label>
              </div>
            </div>

            {/* Sticky footer */}
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl" style={{ padding: '12px 20px' }}>
              <button onClick={function () { setShowAdd(false); setEditing(null); setForm({}); }}
                className="px-4 py-2 rounded-lg bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold">
                Cancel
              </button>
              <button onClick={function () { console.log('[warehouse] Save button CLICKED'); handleSave(); }}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-extrabold shadow">
                {editing ? '✓ Save changes' : '✓ Add warehouse'}
              </button>
            </div>
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
