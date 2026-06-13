import React, { useState, useEffect, useMemo } from 'react';
import { supabase, dbInsert, dbDelete } from '../lib/supabase';
import { buildComposition } from '../lib/mix-composition';

// PHASE 1 (READ-ONLY): Stock Mix Lot composition.
// - Pick a product flagged is_virtual_mix = true (the sellable "Stock Mix Lot").
// - Map real color products as its components.
// - See live composition: each color's available qty (summed from inventory_layers),
//   % of mix, and total available.
// This screen NEVER consumes inventory, never touches FIFO/COGS/invoices. PVC leather
// stock only — the mix-product picker is filtered to that intent by is_virtual_mix.
export default function InventoryMixComposition(props) {
  var toast = props.toast || { success: function () {}, error: function () {} };
  var isSuperAdmin = props.isSuperAdmin === true;
  var canEdit = isSuperAdmin || (props.modulePerms && props.modulePerms.edit_inventory === true);

  var [loading, setLoading] = useState(true);
  var [mixProducts, setMixProducts] = useState([]);     // is_virtual_mix = true
  var [allProducts, setAllProducts] = useState([]);     // real products (candidates)
  var [components, setComponents] = useState([]);        // inventory_mix_components rows
  var [availByProduct, setAvailByProduct] = useState({});
  var [selMix, setSelMix] = useState('');
  var [addProductId, setAddProductId] = useState('');
  var [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      supabase.from('inventory_products').select('id, name_en, quick_code, color_list_id, is_virtual_mix').order('name_en'),
      supabase.from('inventory_mix_components').select('*'),
      supabase.from('inventory_layers').select('product_id, qty_remaining').gt('qty_remaining', 0)
    ]).then(function (res) {
      var prods = (res[0] && res[0].data) || [];
      setMixProducts(prods.filter(function (p) { return p.is_virtual_mix === true; }));
      setAllProducts(prods.filter(function (p) { return p.is_virtual_mix !== true; }));
      setComponents((res[1] && res[1].data) || []);
      var avail = {};
      ((res[2] && res[2].data) || []).forEach(function (l) {
        avail[l.product_id] = (avail[l.product_id] || 0) + (Number(l.qty_remaining) || 0);
      });
      setAvailByProduct(avail);
    }).catch(function (e) { console.error('[mix] load', e); toast.error('Failed to load mix data'); })
      .finally(function () { setLoading(false); });
  }
  useEffect(function () { load(); }, []);

  var prodById = useMemo(function () {
    var m = {}; allProducts.forEach(function (p) { m[p.id] = p; }); return m;
  }, [allProducts]);

  var myComponents = useMemo(function () {
    return components.filter(function (c) { return c.mix_product_id === selMix; }).map(function (c) {
      var p = prodById[c.component_product_id] || {};
      return Object.assign({}, c, { name_en: p.name_en, quick_code: p.quick_code });
    });
  }, [components, selMix, prodById]);

  var composition = useMemo(function () {
    return buildComposition(myComponents, availByProduct);
  }, [myComponents, availByProduct]);

  function addComponent() {
    if (!canEdit) { toast.error('Edit Inventory permission required.'); return; }
    if (!selMix || !addProductId) { toast.error('Pick a mix product and a component to add.'); return; }
    if (myComponents.some(function (c) { return c.component_product_id === addProductId; })) { toast.error('That component is already mapped.'); return; }
    setBusy(true);
    var p = prodById[addProductId] || {};
    dbInsert('inventory_mix_components', {
      mix_product_id: selMix,
      component_product_id: addProductId,
      component_color: p.name_en || p.quick_code || '',
      is_active: true,
      sort_order: myComponents.length
    }, props.userProfile && props.userProfile.id)
      .then(function () { setAddProductId(''); load(); toast.success('Component added.'); })
      .catch(function (e) { toast.error('Could not add: ' + ((e && e.message) || e)); })
      .finally(function () { setBusy(false); });
  }

  function removeComponent(row) {
    if (!canEdit) { toast.error('Edit Inventory permission required.'); return; }
    if (!window.confirm('Remove ' + (row.name_en || row.component_color) + ' from this mix? (Read-only mapping — does not touch any stock.)')) { return; }
    setBusy(true);
    dbDelete('inventory_mix_components', row.id, props.userProfile && props.userProfile.id)
      .then(function () { load(); toast.success('Component removed.'); })
      .catch(function (e) { toast.error('Could not remove: ' + ((e && e.message) || e)); })
      .finally(function () { setBusy(false); });
  }

  if (loading) { return <div className="p-4 text-slate-400 italic">Loading Stock Mix composition…</div>; }

  return (
    <div className="p-4 text-slate-100">
      <div className="text-lg font-extrabold mb-1">🎨 Stock Mix Composition</div>
      <div className="text-xs text-slate-400 mb-4">Read-only. Shows what a Stock Mix Lot is currently made of, by real color stock. No inventory is changed here.</div>

      <div className="bg-amber-100 text-amber-950 text-xs font-semibold rounded-lg px-3 py-2 mb-4">
        Phase 1 — view only. Defining a mix here does not deduct stock, change costs, or affect invoices. Selling the mix (proportional drawdown) is a later, separate step.
      </div>

      {mixProducts.length === 0 ? (
        <div className="bg-white text-slate-900 rounded-lg p-4">
          <div className="font-bold mb-1">No Stock Mix products yet.</div>
          <div className="text-sm text-slate-700">In Product List, create a product and mark it as a <b>Stock Mix Lot (virtual)</b>. It will appear here so you can map its colors. A virtual mix holds no stock of its own — the real colors keep their own inventory.</div>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1">Stock Mix product</label>
          <select value={selMix} onChange={function (e) { setSelMix(e.target.value); }} className="w-full max-w-lg mb-4 px-3 py-2 rounded bg-slate-800 border border-slate-600 text-slate-100 text-sm">
            <option value="">— choose a mix —</option>
            {mixProducts.map(function (p) { return <option key={p.id} value={p.id}>{p.name_en || p.quick_code}</option>; })}
          </select>

          {selMix && (
            <div>
              <div className="bg-white text-slate-900 rounded-lg p-4 mb-4">
                <div className="font-bold mb-2">Current Mix Composition</div>
                {composition.rows.length === 0 ? (
                  <div className="text-sm text-slate-600 italic">No colors mapped yet. Add component colors below.</div>
                ) : (
                  <div>
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-1">Color</th><th>Code</th><th className="text-right">Available</th><th className="text-right">% of mix</th>
                      </tr></thead>
                      <tbody>
                        {composition.rows.map(function (r) {
                          return (
                            <tr key={r.component_product_id} className="border-b border-slate-100">
                              <td className="py-1 font-semibold text-slate-900">{r.name_en || r.component_color}</td>
                              <td className="text-slate-600 font-mono text-xs">{r.quick_code || ''}</td>
                              <td className="text-right font-mono text-slate-900">{r.available.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                              <td className="text-right font-semibold text-indigo-700">{r.pct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot><tr className="font-extrabold text-slate-900"><td className="py-2" colSpan={2}>Total available mix</td><td className="text-right font-mono">{composition.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td></td></tr></tfoot>
                    </table>
                  </div>
                )}
              </div>

              {canEdit && (
                <div className="bg-slate-800/60 rounded-lg p-3 mb-3">
                  <div className="text-xs font-bold text-slate-300 mb-2">Add a component color</div>
                  <div className="flex gap-2 flex-wrap items-center">
                    <select value={addProductId} onChange={function (e) { setAddProductId(e.target.value); }} className="px-3 py-2 rounded bg-slate-800 border border-slate-600 text-slate-100 text-sm min-w-[260px]">
                      <option value="">— choose a real color product —</option>
                      {allProducts.map(function (p) { return <option key={p.id} value={p.id}>{(p.name_en || p.quick_code) + (p.quick_code ? ' (' + p.quick_code + ')' : '')}</option>; })}
                    </select>
                    <button onClick={addComponent} disabled={busy || !addProductId} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold rounded">Add</button>
                  </div>
                </div>
              )}

              {myComponents.length > 0 && canEdit && (
                <div className="text-xs text-slate-400">
                  <div className="font-bold mb-1 text-slate-300">Mapped colors</div>
                  {myComponents.map(function (r) {
                    var p = prodById[r.component_product_id] || {};
                    return (
                      <div key={r.id} className="flex items-center justify-between py-1 border-t border-slate-800">
                        <span className="text-slate-200">{p.name_en || r.component_color} <span className="text-slate-500 font-mono">{p.quick_code || ''}</span></span>
                        <button onClick={function () { removeComponent(Object.assign({}, r, { name_en: p.name_en })); }} className="text-red-300 hover:text-red-200 text-xs font-bold">Remove</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
