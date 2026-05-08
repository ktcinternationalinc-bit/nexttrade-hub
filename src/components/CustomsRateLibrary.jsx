'use client';
// ============================================================
// CustomsRateLibrary — v55.51.
//
// Lives inside the Settings tab. Two sections:
//   1. Government Rates — VAT, Advance Income Tax, Bank Commission.
//      Loaded from / saved to customs_settings (singleton row, id=1).
//   2. Product Customs Rates — list of products with their customs duty %,
//      loaded from customs_rates. Add / Edit / Delete + Active toggle.
//
// Both are referenced by the Customs tab when creating new clearances.
// Existing clearances are NOT retroactively recalculated when these
// values change — see customs-phase-1.sql for rationale (snapshotting).
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export default function CustomsRateLibrary({ user, isAdmin }) {
  var [settings, setSettings] = useState(null);
  var [rates, setRates] = useState([]);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);
  var [savingSettings, setSavingSettings] = useState(false);
  var [editingRateId, setEditingRateId] = useState(null);
  var [showAddRate, setShowAddRate] = useState(false);
  var [rateForm, setRateForm] = useState({});
  var [savingRate, setSavingRate] = useState(false);
  var [confirmDelId, setConfirmDelId] = useState(null);

  var canEdit = !!isAdmin || user?.role === 'super_admin';

  var load = useCallback(async function () {
    setLoading(true);
    setError(null);
    try {
      var setRes = await supabase.from('customs_settings').select('*').eq('id', 1).maybeSingle();
      if (setRes.error) throw new Error('settings: ' + setRes.error.message);
      setSettings(setRes.data || { id: 1, vat_pct: 14, advance_income_tax_pct: 1, bank_commission_pct: 10 });

      var ratesRes = await supabase.from('customs_rates').select('*').order('product_name', { ascending: true });
      if (ratesRes.error) throw new Error('rates: ' + ratesRes.error.message);
      setRates(ratesRes.data || []);
    } catch (e) {
      // If the tables don't exist yet, surface a friendly hint
      var msg = (e && e.message) || 'Could not load customs configuration';
      if (/does not exist|relation.*customs/i.test(msg)) {
        setError('Customs tables are not yet created in your database. Run supabase/customs-phase-1.sql in Supabase first.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(function () { load(); }, [load]);

  var saveSettings = async function () {
    if (savingSettings) return;
    if (!canEdit) return;
    setSavingSettings(true);
    try {
      var payload = {
        id: 1,
        vat_pct: Number(settings.vat_pct) || 0,
        advance_income_tax_pct: Number(settings.advance_income_tax_pct) || 0,
        bank_commission_pct: Number(settings.bank_commission_pct) || 0,
        notes: settings.notes || null,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      };
      var res = await supabase.from('customs_settings').upsert(payload).select().maybeSingle();
      if (res.error) throw new Error(res.error.message);
      setSettings(res.data || payload);
      alert('Government rates saved. New clearances will use these rates. Existing clearances are unchanged.');
    } catch (e) {
      alert('Could not save government rates: ' + ((e && e.message) || 'unknown error'));
    } finally {
      setSavingSettings(false);
    }
  };

  var addOrUpdateRate = async function () {
    if (savingRate) return;
    if (!canEdit) return;
    var name = String(rateForm.product_name || '').trim();
    var pct = Number(rateForm.customs_duty_pct);
    if (!name) { alert('Product name is required.'); return; }
    if (isNaN(pct) || pct < 0 || pct > 100) { alert('Customs duty % must be a number between 0 and 100.'); return; }
    setSavingRate(true);
    try {
      var nowIso = new Date().toISOString();
      var payload = {
        product_name: name,
        product_name_ar: rateForm.product_name_ar || null,
        customs_duty_pct: pct,
        notes: rateForm.notes || null,
        active: rateForm.active !== false,
        updated_at: nowIso,
        updated_by: user?.id || null,
      };
      var res;
      if (editingRateId) {
        res = await supabase.from('customs_rates').update(payload).eq('id', editingRateId).select().maybeSingle();
      } else {
        payload.created_at = nowIso;
        payload.created_by = user?.id || null;
        res = await supabase.from('customs_rates').insert(payload).select().maybeSingle();
      }
      if (res.error) {
        if (/duplicate key|unique constraint/i.test(res.error.message || '')) {
          alert('A product called "' + name + '" already exists. Edit that one instead.');
        } else {
          alert('Could not save: ' + res.error.message);
        }
        return;
      }
      setRateForm({});
      setShowAddRate(false);
      setEditingRateId(null);
      await load();
    } catch (e) {
      alert('Could not save: ' + ((e && e.message) || 'unknown error'));
    } finally {
      setSavingRate(false);
    }
  };

  var deleteRate = async function (id) {
    if (!canEdit) return;
    try {
      var res = await supabase.from('customs_rates').delete().eq('id', id);
      if (res.error) throw new Error(res.error.message);
      setConfirmDelId(null);
      await load();
    } catch (e) {
      alert('Could not delete: ' + ((e && e.message) || 'unknown error'));
    }
  };

  var startEdit = function (r) {
    setEditingRateId(r.id);
    setRateForm({
      product_name: r.product_name,
      product_name_ar: r.product_name_ar || '',
      customs_duty_pct: r.customs_duty_pct,
      notes: r.notes || '',
      active: r.active !== false,
    });
    setShowAddRate(true);
  };

  if (loading) {
    return <div className="bg-white rounded-xl p-4 border border-slate-200"><div className="text-sm text-slate-400">Loading customs configuration…</div></div>;
  }
  if (error) {
    return (
      <div className="bg-amber-50 rounded-xl p-4 border border-amber-300">
        <div className="text-sm font-bold text-amber-800 mb-1">⚠️ Customs Rate Library unavailable</div>
        <div className="text-xs text-amber-700">{error}</div>
        <button onClick={load} className="mt-2 px-3 py-1 text-xs font-semibold bg-amber-500 text-white rounded">↻ Try again</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ===== Government Rates ===== */}
      <div className="bg-white rounded-xl p-4 border border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-extrabold text-slate-800">🏛️ Government Rates / المعدلات الحكومية</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">VAT, advance income tax, and bank commission. These rarely change but when they do, update once here and every NEW clearance uses the new rate. Existing clearances stay locked at the rates that were in effect when they were saved.</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-semibold text-slate-600">VAT % / ض ق م</label>
            <input type="number" step="0.01" disabled={!canEdit}
              value={settings?.vat_pct ?? ''}
              onChange={e => setSettings(Object.assign({}, settings, { vat_pct: e.target.value }))}
              className="w-full px-3 py-2 rounded border border-slate-200 text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-600">Advance Income Tax % / ض ا ت</label>
            <input type="number" step="0.01" disabled={!canEdit}
              value={settings?.advance_income_tax_pct ?? ''}
              onChange={e => setSettings(Object.assign({}, settings, { advance_income_tax_pct: e.target.value }))}
              className="w-full px-3 py-2 rounded border border-slate-200 text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-600">Bank Commission % / عمولة البنك</label>
            <input type="number" step="0.01" disabled={!canEdit}
              value={settings?.bank_commission_pct ?? ''}
              onChange={e => setSettings(Object.assign({}, settings, { bank_commission_pct: e.target.value }))}
              className="w-full px-3 py-2 rounded border border-slate-200 text-sm" />
            <p className="text-[9px] text-slate-500 mt-0.5">% of the advance income tax</p>
          </div>
        </div>
        {canEdit && (
          <button onClick={saveSettings} disabled={savingSettings}
            className={'mt-3 px-4 py-2 rounded-lg text-xs font-bold transition ' + (savingSettings ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600')}>
            {savingSettings ? '⏳ Saving…' : '💾 Save Government Rates'}
          </button>
        )}
        {!canEdit && <p className="text-[10px] text-slate-500 mt-2 italic">View-only — only super admin can edit government rates.</p>}
      </div>

      {/* ===== Product Customs Rates ===== */}
      <div className="bg-white rounded-xl p-4 border border-slate-200">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-slate-800">📦 Product Customs Rates / معدلات الجمارك للمنتجات</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">The customs duty % that applies to each product type. Used by the Customs tab when you create a new clearance — pick the product and the % auto-fills.</p>
          </div>
          {canEdit && !showAddRate && (
            <button onClick={() => { setShowAddRate(true); setEditingRateId(null); setRateForm({ active: true }); }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-500 text-white hover:bg-blue-600">
              + Add Product
            </button>
          )}
        </div>

        {/* Add/Edit form */}
        {showAddRate && (
          <div className="mb-3 p-3 rounded-lg border-2 border-blue-300 bg-blue-50">
            <div className="text-xs font-bold text-blue-900 mb-2">{editingRateId ? '✏️ Edit Product' : '➕ Add Product'}</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Product Name (English)</label>
                <input value={rateForm.product_name || ''} onChange={e => setRateForm(Object.assign({}, rateForm, { product_name: e.target.value }))}
                  placeholder="e.g. PVC Leather"
                  className="w-full px-3 py-2 rounded border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">اسم المنتج بالعربية (Optional)</label>
                <input value={rateForm.product_name_ar || ''} onChange={e => setRateForm(Object.assign({}, rateForm, { product_name_ar: e.target.value }))}
                  placeholder="مثال: بي في سي"
                  className="w-full px-3 py-2 rounded border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600">Customs Duty % *</label>
                <input type="number" step="0.01" value={rateForm.customs_duty_pct ?? ''} onChange={e => setRateForm(Object.assign({}, rateForm, { customs_duty_pct: e.target.value }))}
                  placeholder="e.g. 10"
                  className="w-full px-3 py-2 rounded border border-slate-200 text-sm" />
              </div>
              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={rateForm.active !== false} onChange={e => setRateForm(Object.assign({}, rateForm, { active: e.target.checked }))} />
                  <span>Active (show in Customs tab dropdown)</span>
                </label>
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-semibold text-slate-600">Notes (optional)</label>
                <input value={rateForm.notes || ''} onChange={e => setRateForm(Object.assign({}, rateForm, { notes: e.target.value }))}
                  placeholder="e.g. Government decree XYZ effective 2026-01-01"
                  className="w-full px-3 py-2 rounded border border-slate-200 text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={addOrUpdateRate} disabled={savingRate}
                className={'px-3 py-1.5 rounded-lg text-xs font-bold ' + (savingRate ? 'bg-slate-300 text-slate-500' : 'bg-emerald-500 text-white hover:bg-emerald-600')}>
                {savingRate ? '⏳ Saving…' : (editingRateId ? '💾 Update' : '➕ Add')}
              </button>
              <button onClick={() => { setShowAddRate(false); setEditingRateId(null); setRateForm({}); }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Rates list */}
        {rates.length === 0 ? (
          <div className="text-center py-6 text-slate-400">
            <div className="text-3xl mb-1">📭</div>
            <div className="text-sm font-semibold">No products yet</div>
            <div className="text-[10px] mt-1">Add your first product to start tracking customs clearances.</div>
          </div>
        ) : (
          <div className="space-y-1">
            {rates.map(function (r) {
              return (
                <div key={r.id} className={'flex items-center justify-between p-2 rounded border ' + (r.active === false ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-200')}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-800">
                      {r.product_name}
                      {r.product_name_ar ? <span className="text-slate-500 font-normal ml-2">/ {r.product_name_ar}</span> : null}
                      {r.active === false ? <span className="text-[9px] bg-slate-300 text-slate-700 px-1.5 py-0.5 rounded ml-2">INACTIVE</span> : null}
                    </div>
                    {r.notes && <div className="text-[10px] text-slate-500 mt-0.5">{r.notes}</div>}
                  </div>
                  <div className="text-sm font-extrabold text-emerald-600 mr-3">{Number(r.customs_duty_pct).toFixed(2)}%</div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(r)} className="px-2 py-1 text-[10px] font-bold border border-slate-300 rounded hover:bg-slate-50">✏️ Edit</button>
                      {confirmDelId === r.id ? (
                        <>
                          <button onClick={() => deleteRate(r.id)} className="px-2 py-1 text-[10px] font-bold bg-red-500 text-white rounded">Confirm</button>
                          <button onClick={() => setConfirmDelId(null)} className="px-2 py-1 text-[10px] font-bold border border-slate-300 rounded">Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDelId(r.id)} className="px-2 py-1 text-[10px] font-bold border border-red-300 text-red-600 rounded hover:bg-red-50">🗑</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
