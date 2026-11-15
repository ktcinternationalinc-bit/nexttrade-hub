// v55.83-A — Master SKU List (Inventory Module)
//
// CRUD on inv_skus. Permission-aware:
//   • Everyone with tab access sees: SKU number, description, quantity, warehouse, last updated
//   • Users with inv.see_costs ALSO see: avg landed cost, last purchase cost
//   • Users with inv.see_pnl ALSO see: target sell price, margin, gross profit
// Generate-SKU helper produces SKU-00001 style values for users without their own scheme.
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { dbInsert, dbUpdate } from '../lib/supabase';
import {
  canEditInventory,
  canSeeInventoryCosts,
  canSeeInventoryPnL,
} from '../lib/inventory-permissions';

var PRIMARY_UNITS = [
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'yard', label: 'Yards' },
  { value: 'meter', label: 'Meters' },
  { value: 'roll', label: 'Rolls' },
  { value: 'piece', label: 'Pieces' },
  { value: 'liter', label: 'Liters' },
  { value: 'box', label: 'Boxes' },
];

var CURRENCIES = [
  { value: 'EGP', label: 'EGP — Egyptian Pound' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
];

export default function MasterSKUList({ userProfile, modulePerms, toast }) {
  var [skus, setSkus] = useState([]);
  var [loading, setLoading] = useState(true);
  var [editing, setEditing] = useState(null);
  var [showAdd, setShowAdd] = useState(false);
  var [form, setForm] = useState({});
  var [q, setQ] = useState('');
  var [typeFilter, setTypeFilter] = useState('all');

  var canEdit = canEditInventory(userProfile, modulePerms);
  var seeCosts = canSeeInventoryCosts(userProfile, modulePerms);
  var seePnL = canSeeInventoryPnL(userProfile, modulePerms);

  var loadSKUs = async function () {
    setLoading(true);
    var res = await supabase
      .from('inv_skus')
      .select('*')
      .is('deleted_at', null)
      .order('sku_number');
    setSkus((res && res.data) || []);
    setLoading(false);
  };

  useEffect(function () { loadSKUs(); }, []);

  // Generate the next SKU-00001 style number for users without a numbering scheme.
  var generateSKUNumber = function () {
    var existing = skus
      .map(function (s) { return s.sku_number || ''; })
      .filter(function (n) { return /^SKU-\d+$/.test(n); })
      .map(function (n) { return parseInt(n.replace('SKU-', ''), 10); })
      .filter(function (n) { return !isNaN(n); });
    var next = existing.length > 0 ? Math.max.apply(null, existing) + 1 : 1;
    return 'SKU-' + String(next).padStart(5, '0');
  };

  var handleSave = async function () {
    if (!form.sku_number || !form.description) {
      if (toast) toast.warning('SKU number and description are required');
      return;
    }
    try {
      var payload = {
        sku_number: form.sku_number.trim(),
        description: form.description.trim(),
        description_ar: form.description_ar || null,
        product_type: form.product_type || null,
        subcategory: form.subcategory || null,
        color_en: form.color_en || null,
        color_ar: form.color_ar || null,
        material: form.material || null,
        primary_unit: form.primary_unit || 'piece',
        kg_per_yard: form.kg_per_yard || null,
        kg_per_meter: form.kg_per_meter || null,
        yards_per_meter: form.yards_per_meter || null,
        yards_per_roll: form.yards_per_roll || null,
        meters_per_roll: form.meters_per_roll || null,
        cost_currency: form.cost_currency || 'USD',
        target_sell_price: form.target_sell_price || null,
        target_sell_currency: form.target_sell_currency || null,
        standard_cost: form.standard_cost || null,
        notes: form.notes || null,
        is_active: form.is_active !== false,
      };
      if (editing) {
        await dbUpdate('inv_skus', editing.id, payload, userProfile && userProfile.id);
        if (toast) toast.success('SKU updated');
      } else {
        payload.created_by = (userProfile && userProfile.id) || null;
        await dbInsert('inv_skus', payload, userProfile && userProfile.id);
        if (toast) toast.success('SKU created');
      }
      setForm({}); setEditing(null); setShowAdd(false);
      loadSKUs();
    } catch (err) {
      if (toast) toast.error('Save failed: ' + (err && err.message));
    }
  };

  var openEdit = function (sku) {
    setEditing(sku);
    setForm(Object.assign({}, sku));
    setShowAdd(true);
  };

  var handleDelete = async function (sku) {
    if (!window.confirm('Soft-delete SKU "' + sku.sku_number + '"? It will be hidden from new shipments and lists. Historical data is preserved.')) return;
    try {
      await dbUpdate('inv_skus', sku.id, { deleted_at: new Date().toISOString(), is_active: false }, userProfile && userProfile.id);
      if (toast) toast.success('SKU archived');
      loadSKUs();
    } catch (err) {
      if (toast) toast.error('Delete failed: ' + (err && err.message));
    }
  };

  var filtered = useMemo(function () {
    var arr = skus;
    if (typeFilter !== 'all') {
      arr = arr.filter(function (s) { return s.product_type === typeFilter; });
    }
    if (q) {
      var ql = q.toLowerCase();
      arr = arr.filter(function (s) {
        return (s.sku_number || '').toLowerCase().indexOf(ql) >= 0
          || (s.description || '').toLowerCase().indexOf(ql) >= 0
          || (s.description_ar || '').toLowerCase().indexOf(ql) >= 0
          || (s.color_en || '').toLowerCase().indexOf(ql) >= 0;
      });
    }
    return arr;
  }, [skus, q, typeFilter]);

  var productTypes = useMemo(function () {
    var set = {};
    skus.forEach(function (s) { if (s.product_type) set[s.product_type] = true; });
    return Object.keys(set).sort();
  }, [skus]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">📦 Master SKU List</h3>
          <p className="text-xs text-slate-500">
            {skus.length} SKU{skus.length === 1 ? '' : 's'} on file. The permanent identity for every product you stock.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={function (e) { setQ(e.target.value); }}
            placeholder="🔍 Search SKU, name, color…"
            className="px-3 py-1.5 rounded-lg border text-xs w-48" />
          <select value={typeFilter} onChange={function (e) { setTypeFilter(e.target.value); }}
            className="px-2 py-1.5 rounded border text-xs">
            <option value="all">All types</option>
            {productTypes.map(function (pt) {
              return <option key={pt} value={pt}>{pt}</option>;
            })}
          </select>
          {canEdit && !showAdd && (
            <button onClick={function () {
              setForm({ sku_number: generateSKUNumber(), primary_unit: 'piece', cost_currency: 'USD', is_active: true });
              setEditing(null);
              setShowAdd(true);
            }} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
              + Add SKU
            </button>
          )}
        </div>
      </div>

      {showAdd && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-emerald-900">
              {editing ? 'Edit SKU ' + editing.sku_number : 'New SKU'}
            </div>
            {!editing && (
              <button
                onClick={function () { setForm(Object.assign({}, form, { sku_number: generateSKUNumber() })); }}
                className="text-[10px] text-emerald-700 hover:underline">
                🔄 Generate new SKU number
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-semibold block">SKU number *</label>
              <input value={form.sku_number || ''} onChange={function (e) { setForm(Object.assign({}, form, { sku_number: e.target.value })); }}
                className="w-full px-2 py-1.5 rounded border text-xs font-mono" />
            </div>
            <div className="md:col-span-2">
              <label className="text-[10px] font-semibold block">Description (English) *</label>
              <input value={form.description || ''} onChange={function (e) { setForm(Object.assign({}, form, { description: e.target.value })); }}
                className="w-full px-2 py-1.5 rounded border text-xs" />
            </div>
            <div>
              <label className="text-[10px] font-semibold block">Description (Arabic)</label>
              <input value={form.description_ar || ''} onChange={function (e) { setForm(Object.assign({}, form, { description_ar: e.target.value })); }}
                dir="rtl"
                className="w-full px-2 py-1.5 rounded border text-xs" />
            </div>
            <div>
              <label className="text-[10px] font-semibold block">Product type</label>
              <input value={form.product_type || ''} onChange={function (e) { setForm(Object.assign({}, form, { product_type: e.target.value })); }}
                placeholder="leather, PVC, fabric…"
                list="sku-type-suggestions"
                className="w-full px-2 py-1.5 rounded border text-xs" />
              <datalist id="sku-type-suggestions">
                {productTypes.map(function (pt) { return <option key={pt} value={pt} />; })}
              </datalist>
            </div>
            <div>
              <label className="text-[10px] font-semibold block">Subcategory</label>
              <input value={form.subcategory || ''} onChange={function (e) { setForm(Object.assign({}, form, { subcategory: e.target.value })); }}
                className="w-full px-2 py-1.5 rounded border text-xs" />
            </div>
            <div>
              <label className="text-[10px] font-semibold block">Color (EN)</label>
              <input value={form.color_en || ''} onChange={function (e) { setForm(Object.assign({}, form, { color_en: e.target.value })); }}
                className="w-full px-2 py-1.5 rounded border text-xs" />
            </div>
            <div>
              <label className="text-[10px] font-semibold block">Color (AR)</label>
              <input value={form.color_ar || ''} onChange={function (e) { setForm(Object.assign({}, form, { color_ar: e.target.value })); }}
                dir="rtl"
                className="w-full px-2 py-1.5 rounded border text-xs" />
            </div>
            <div>
              <label className="text-[10px] font-semibold block">Material</label>
              <input value={form.material || ''} onChange={function (e) { setForm(Object.assign({}, form, { material: e.target.value })); }}
                className="w-full px-2 py-1.5 rounded border text-xs" />
            </div>
            <div>
              <label className="text-[10px] font-semibold block">Primary unit *</label>
              <select value={form.primary_unit || 'piece'} onChange={function (e) { setForm(Object.assign({}, form, { primary_unit: e.target.value })); }}
                className="w-full px-2 py-1.5 rounded border text-xs">
                {PRIMARY_UNITS.map(function (u) { return <option key={u.value} value={u.value}>{u.label}</option>; })}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold block">Cost currency</label>
              <select value={form.cost_currency || 'USD'} onChange={function (e) { setForm(Object.assign({}, form, { cost_currency: e.target.value })); }}
                className="w-full px-2 py-1.5 rounded border text-xs">
                {CURRENCIES.map(function (c) { return <option key={c.value} value={c.value}>{c.label}</option>; })}
              </select>
            </div>

            {/* Conversion factors — collapsible, optional */}
            <details className="col-span-2 md:col-span-3 mt-2 bg-white rounded-lg border border-slate-200 p-2">
              <summary className="text-[10px] font-bold text-slate-600 cursor-pointer">
                Unit conversion factors (optional) — fill if you need to display in alternate units
              </summary>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                <div>
                  <label className="text-[10px] text-slate-500">kg per yard</label>
                  <input type="number" step="any" value={form.kg_per_yard || ''} onChange={function (e) { setForm(Object.assign({}, form, { kg_per_yard: e.target.value })); }}
                    className="w-full px-2 py-1 rounded border text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">kg per meter</label>
                  <input type="number" step="any" value={form.kg_per_meter || ''} onChange={function (e) { setForm(Object.assign({}, form, { kg_per_meter: e.target.value })); }}
                    className="w-full px-2 py-1 rounded border text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">yards per meter (default 1.0936)</label>
                  <input type="number" step="any" value={form.yards_per_meter || ''} onChange={function (e) { setForm(Object.assign({}, form, { yards_per_meter: e.target.value })); }}
                    className="w-full px-2 py-1 rounded border text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">yards per roll</label>
                  <input type="number" step="any" value={form.yards_per_roll || ''} onChange={function (e) { setForm(Object.assign({}, form, { yards_per_roll: e.target.value })); }}
                    className="w-full px-2 py-1 rounded border text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">meters per roll</label>
                  <input type="number" step="any" value={form.meters_per_roll || ''} onChange={function (e) { setForm(Object.assign({}, form, { meters_per_roll: e.target.value })); }}
                    className="w-full px-2 py-1 rounded border text-xs" />
                </div>
              </div>
            </details>

            {/* Cost & target — only visible to users who can see costs */}
            {seeCosts && (
              <details className="col-span-2 md:col-span-3 bg-white rounded-lg border border-amber-200 p-2">
                <summary className="text-[10px] font-bold text-amber-700 cursor-pointer">
                  💰 Cost & pricing references (visible to you because you have cost permissions)
                </summary>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                  <div>
                    <label className="text-[10px] text-slate-500">Standard cost</label>
                    <input type="number" step="any" value={form.standard_cost || ''} onChange={function (e) { setForm(Object.assign({}, form, { standard_cost: e.target.value })); }}
                      className="w-full px-2 py-1 rounded border text-xs" />
                  </div>
                  {seePnL && (
                    <>
                      <div>
                        <label className="text-[10px] text-slate-500">Target sell price</label>
                        <input type="number" step="any" value={form.target_sell_price || ''} onChange={function (e) { setForm(Object.assign({}, form, { target_sell_price: e.target.value })); }}
                          className="w-full px-2 py-1 rounded border text-xs" />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500">Target sell currency</label>
                        <select value={form.target_sell_currency || 'USD'} onChange={function (e) { setForm(Object.assign({}, form, { target_sell_currency: e.target.value })); }}
                          className="w-full px-2 py-1 rounded border text-xs">
                          {CURRENCIES.map(function (c) { return <option key={c.value} value={c.value}>{c.value}</option>; })}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              </details>
            )}

            <div className="col-span-2 md:col-span-3">
              <label className="text-[10px] font-semibold block">Notes</label>
              <textarea value={form.notes || ''} onChange={function (e) { setForm(Object.assign({}, form, { notes: e.target.value })); }}
                rows={2} className="w-full px-2 py-1.5 rounded border text-xs" />
            </div>
            <label className="col-span-2 md:col-span-3 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={form.is_active !== false}
                onChange={function (e) { setForm(Object.assign({}, form, { is_active: e.target.checked })); }} />
              <span>Active (uncheck to hide from new shipments without deleting)</span>
            </label>
          </div>
          <div className="flex gap-2 pt-3">
            <button onClick={handleSave}
              className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
              {editing ? 'Save changes' : 'Add SKU'}
            </button>
            <button onClick={function () { setShowAdd(false); setEditing(null); setForm({}); }}
              className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-slate-500 py-6 text-center">Loading SKUs…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-50 border border-dashed rounded-xl py-10 text-center">
          <div className="text-3xl mb-2">📦</div>
          <div className="text-sm font-semibold text-slate-700 mb-1">
            {skus.length === 0 ? 'No SKUs yet' : 'No SKUs match the filters'}
          </div>
          <div className="text-xs text-slate-500 mb-3">
            {skus.length === 0
              ? 'Add your first SKU above to start building your product database. Once you create a shipment, the SKU will start accumulating inventory.'
              : 'Try clearing the search or changing the type filter.'}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">SKU</th>
                <th className="text-left px-3 py-2 font-semibold">Description</th>
                <th className="text-left px-3 py-2 font-semibold">Type</th>
                <th className="text-left px-3 py-2 font-semibold">Color</th>
                <th className="text-right px-3 py-2 font-semibold">Unit</th>
                {seeCosts && <th className="text-right px-3 py-2 font-semibold">Avg Cost</th>}
                {seeCosts && <th className="text-right px-3 py-2 font-semibold">Last Purchase</th>}
                {seePnL && <th className="text-right px-3 py-2 font-semibold">Target Price</th>}
                {canEdit && <th className="text-right px-3 py-2 font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(function (sku) {
                return (
                  <tr key={sku.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono font-bold text-slate-700">{sku.sku_number}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold">{sku.description}</div>
                      {sku.description_ar && <div className="text-[10px] text-slate-500" dir="rtl">{sku.description_ar}</div>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {sku.product_type || '—'}
                      {sku.subcategory && <span className="text-[10px] text-slate-500 block">{sku.subcategory}</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{sku.color_en || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-mono font-bold">{sku.primary_unit}</span>
                    </td>
                    {seeCosts && (
                      <td className="px-3 py-2 text-right font-mono">
                        {sku.avg_landed_cost
                          ? Number(sku.avg_landed_cost).toFixed(2) + ' ' + (sku.cost_currency || '')
                          : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {seeCosts && (
                      <td className="px-3 py-2 text-right font-mono">
                        {sku.last_purchase_cost
                          ? Number(sku.last_purchase_cost).toFixed(2) + ' ' + (sku.last_purchase_currency || '')
                          : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {seePnL && (
                      <td className="px-3 py-2 text-right font-mono text-emerald-700">
                        {sku.target_sell_price
                          ? Number(sku.target_sell_price).toFixed(2) + ' ' + (sku.target_sell_currency || '')
                          : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {canEdit && (
                      <td className="px-3 py-2 text-right">
                        <button onClick={function () { openEdit(sku); }}
                          className="px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 text-[10px] font-bold mr-1">
                          Edit
                        </button>
                        <button onClick={function () { handleDelete(sku); }}
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
