'use client';
// v55.83-A.6.27.53 — Business Entities Settings Panel.
//
// Edits the seeded entities (KTC International Inc., KTC Egypt). Used to keep
// addresses/phones up-to-date so printed statements + Excel exports always
// show current contact info.
//
// Super admin only.

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function BusinessEntitiesPanel(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  var [entities, setEntities] = useState([]);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);
  var [editing, setEditing] = useState(null); // { ...entity row } or null
  var [busy, setBusy] = useState(false);

  useEffect(function () {
    if (!isSuperAdmin) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      try {
        var res = await supabase.from('business_entities').select('*').order('display_order');
        if (cancelled) return;
        if (res.error) {
          var msg = res.error.message || '';
          if (/relation.*business_entities.*does not exist/i.test(msg)) {
            setError('Database not yet set up. Run SQL migration v55.83-A.6.27.53 (sql/v55-83-a-6-27-53-business-entities.sql) in Supabase.');
          } else {
            setError(msg);
          }
          return;
        }
        setEntities(res.data || []);
      } catch (e) {
        if (!cancelled) setError((e && e.message) || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [isSuperAdmin]);

  function openEdit(ent) {
    setEditing(Object.assign({}, ent));
  }
  function field(key, val) {
    setEditing(function (prev) { return Object.assign({}, prev, { [key]: val }); });
  }
  async function save() {
    if (!editing) return;
    var name = (editing.entity_name || '').trim();
    if (!name) { alert('Entity name is required / اسم الكيان مطلوب'); return; }
    setBusy(true);
    try {
      var payload = {
        entity_name: name,
        entity_name_ar: (editing.entity_name_ar || '').trim() || null,
        address_line1: (editing.address_line1 || '').trim() || null,
        address_line2: (editing.address_line2 || '').trim() || null,
        city: (editing.city || '').trim() || null,
        region: (editing.region || '').trim() || null,
        postal_code: (editing.postal_code || '').trim() || null,
        country: (editing.country || '').trim() || null,
        phone: (editing.phone || '').trim() || null,
        email: (editing.email || '').trim() || null,
        tax_id: (editing.tax_id || '').trim() || null,
        default_currency: (editing.default_currency || '').trim() || null,
      };
      var res = await supabase.from('business_entities').update(payload).eq('entity_code', editing.entity_code).select().single();
      if (res.error) throw res.error;
      toast.success('Entity updated: ' + name);
      setEditing(null);
      // Reload
      var res = await supabase.from('business_entities').select('*').order('display_order');
      if (res && !res.error) setEntities(res.data || []);
    } catch (e) {
      console.error('[business-entities] save failed:', e);
      toast.error('Failed to save: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3 text-amber-900 text-sm font-bold">
        Business entity editing is super-admin only.
      </div>
    );
  }

  return (
    <div className="bg-white border-2 border-slate-300 rounded-lg overflow-hidden">
      <div className="bg-indigo-700 text-white px-4 py-2">
        <div className="text-sm font-extrabold">🏢 Business Entities / كيانات الأعمال</div>
        <div className="text-xs text-indigo-100">Edit the contact info shown as the &quot;from&quot; header on Open Accounts statements + Excel exports.</div>
      </div>

      {loading && <div className="p-4 text-slate-600 text-sm font-bold">Loading entities... / جاري التحميل</div>}
      {error && !loading && (
        <div className="m-3 bg-red-100 border-2 border-red-400 text-red-900 rounded p-3 text-sm font-bold">
          <strong>Error:</strong> {error}
        </div>
      )}
      {!loading && !error && entities.length === 0 && (
        <div className="p-4 text-slate-700 text-sm">No entities found. Run SQL migration v55.83-A.6.27.53 to seed the default entities.</div>
      )}

      {!loading && !error && entities.map(function (e) {
        return (
          <div key={e.entity_code} className="border-b border-slate-200 last:border-b-0 p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="px-2 py-0.5 bg-slate-800 text-white text-[10px] font-extrabold uppercase tracking-wider rounded">{e.entity_code}</span>
                <span className="text-base font-extrabold text-slate-900">{e.entity_name}</span>
                {e.entity_name_ar && <span className="text-sm font-bold text-slate-700" style={{ direction: 'rtl' }}>/ {e.entity_name_ar}</span>}
                {e.default_currency && <span className="text-xs text-slate-600 font-bold">({e.default_currency})</span>}
              </div>
              <div className="text-xs text-slate-700 mt-1">
                {[e.address_line1, e.address_line2, [e.city, e.region, e.postal_code].filter(Boolean).join(', '), e.country].filter(Boolean).join(' · ') || <em className="text-slate-400">no address</em>}
              </div>
              <div className="text-xs text-slate-700">
                {[e.phone ? 'Tel: ' + e.phone : '', e.email, e.tax_id ? 'Tax ID: ' + e.tax_id : ''].filter(Boolean).join(' · ') || <em className="text-slate-400">no contact info</em>}
              </div>
            </div>
            <button onClick={function () { openEdit(e); }} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded shadow">Edit / تعديل</button>
          </div>
        );
      })}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-start justify-center pt-10 px-4 overflow-y-auto" onClick={function () { if (!busy) setEditing(null); }}>
          <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl" onClick={function (ev) { ev.stopPropagation(); }}>
            <div className="bg-indigo-700 text-white rounded-t-2xl px-5 py-3">
              <div className="text-lg font-extrabold">Edit Entity: {editing.entity_code}</div>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block md:col-span-2">
                <span className="text-xs font-extrabold text-slate-900">Entity Name * / اسم الكيان</span>
                <input type="text" value={editing.entity_name || ''} onChange={function (ev) { field('entity_name', ev.target.value); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold" />
              </label>
              <label className="block md:col-span-2">
                <span className="text-xs font-extrabold text-slate-900">Arabic Name / اسم بالعربية</span>
                <input type="text" value={editing.entity_name_ar || ''} onChange={function (ev) { field('entity_name_ar', ev.target.value); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold" style={{ direction: 'rtl' }} />
              </label>
              <label className="block md:col-span-2">
                <span className="text-xs font-extrabold text-slate-900">Address Line 1</span>
                <input type="text" value={editing.address_line1 || ''} onChange={function (ev) { field('address_line1', ev.target.value); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
              <label className="block md:col-span-2">
                <span className="text-xs font-extrabold text-slate-900">Address Line 2</span>
                <input type="text" value={editing.address_line2 || ''} onChange={function (ev) { field('address_line2', ev.target.value); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">City</span>
                <input type="text" value={editing.city || ''} onChange={function (ev) { field('city', ev.target.value); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">State / Region / Governorate</span>
                <input type="text" value={editing.region || ''} onChange={function (ev) { field('region', ev.target.value); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Postal Code</span>
                <input type="text" value={editing.postal_code || ''} onChange={function (ev) { field('postal_code', ev.target.value); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Country</span>
                <input type="text" value={editing.country || ''} onChange={function (ev) { field('country', ev.target.value); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Phone</span>
                <input type="text" value={editing.phone || ''} onChange={function (ev) { field('phone', ev.target.value); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-mono" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Email</span>
                <input type="email" value={editing.email || ''} onChange={function (ev) { field('email', ev.target.value); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-mono" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Tax ID (optional)</span>
                <input type="text" value={editing.tax_id || ''} onChange={function (ev) { field('tax_id', ev.target.value); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-mono" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Default Currency</span>
                <input type="text" value={editing.default_currency || ''} onChange={function (ev) { field('default_currency', ev.target.value); }} placeholder="USD / EGP / EUR..." className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold" />
              </label>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={function () { setEditing(null); }} disabled={busy} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded disabled:opacity-50">Cancel</button>
              <button onClick={save} disabled={busy} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-extrabold rounded shadow disabled:opacity-50">{busy ? 'Saving...' : '💾 Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
