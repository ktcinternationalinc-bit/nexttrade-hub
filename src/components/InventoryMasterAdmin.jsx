'use client';
// v55.83-A.6.27.22 — Inventory Master Admin (Phase 1 Build 1)
//
// Super-admin (or anyone with "Manage Inventory Master" permission) maintains
// the 8 classification levels here. This is the foundation for the inventory
// classification system — Product Master (Build 2), Receiving Updates (Build 4),
// and Reports (Build 5) all pull from these lists.
//
// Five rules that mirror the Payment Instruments work:
//   1. NO free-text classification values — everything is a controlled list.
//   2. Soft delete only — deactivated options stay in DB so existing inventory
//      references survive.
//   3. Codes are uppercase alphanumeric 1-4 chars, unique per level (per
//      active row). Enforced by DB CHECK constraint AND client-side.
//   4. Bilingual everywhere — English + Arabic both required on save.
//   5. Parent-rule edits cascade ONLY at the rules table — never mutate
//      child or parent option records.

import { useState, useEffect, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';

var LEVELS = [
  { num: 1, en: 'Product Family',  ar: 'عائلة المنتج',     hasParent: false, parentLevel: null },
  { num: 2, en: 'Category',         ar: 'التصنيف',          hasParent: true,  parentLevel: 1 },
  { num: 3, en: 'Grade',            ar: 'الدرجة',           hasParent: false, parentLevel: null },
  { num: 4, en: 'Construction',     ar: 'التركيب',          hasParent: false, parentLevel: null },
  { num: 5, en: 'Backing',          ar: 'الظهر',            hasParent: false, parentLevel: null },
  { num: 6, en: 'Color',            ar: 'اللون',            hasParent: false, parentLevel: 1 }, // optional parent rules per Max — pool colors restricted
  { num: 7, en: 'Pattern',          ar: 'النمط',            hasParent: false, parentLevel: null },
  { num: 8, en: 'Spec Class',       ar: 'فئة المواصفات',    hasParent: false, parentLevel: null },
];

// Code validation — uppercase alphanumeric, 1-4 chars
function validCode(s) {
  return typeof s === 'string' && /^[A-Z0-9]{1,4}$/.test(s);
}

export default function InventoryMasterAdmin(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  // Permission gate
  var canManage = isSuperAdmin || modulePerms['Manage Inventory Master'] === true;

  var [activeLevel, setActiveLevel] = useState(1);
  var [options, setOptions] = useState([]);
  var [rules, setRules] = useState([]);
  var [loading, setLoading] = useState(true);
  var [showInactive, setShowInactive] = useState(false);
  var [search, setSearch] = useState('');
  var [editing, setEditing] = useState(null); // {id} or 'new'
  var [form, setForm] = useState({ code: '', label_en: '', label_ar: '', parentIds: [] });
  var [busy, setBusy] = useState(false);

  // Load everything once on mount
  useEffect(function () {
    if (!canManage) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      try {
        var [optRes, ruleRes] = await Promise.all([
          supabase.from('inventory_lists').select('*').order('level').order('display_order').order('label_en'),
          supabase.from('inventory_list_rules').select('*'),
        ]);
        if (cancelled) return;
        setOptions(optRes.data || []);
        setRules(ruleRes.data || []);
      } catch (e) {
        console.error('[inv-master] load failed:', e);
        toast.error('Failed to load inventory master data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [canManage]);

  async function reload() {
    try {
      var [optRes, ruleRes] = await Promise.all([
        supabase.from('inventory_lists').select('*').order('level').order('display_order').order('label_en'),
        supabase.from('inventory_list_rules').select('*'),
      ]);
      setOptions(optRes.data || []);
      setRules(ruleRes.data || []);
    } catch (e) { console.error('[inv-master] reload failed:', e); }
  }

  // Filtered options for the active level
  var levelOptions = useMemo(function () {
    var list = options.filter(function (o) { return o.level === activeLevel; });
    if (!showInactive) list = list.filter(function (o) { return o.active; });
    if (search.trim()) {
      var q = search.trim().toLowerCase();
      list = list.filter(function (o) {
        return (o.code || '').toLowerCase().indexOf(q) >= 0
          || (o.label_en || '').toLowerCase().indexOf(q) >= 0
          || (o.label_ar || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }, [options, activeLevel, showInactive, search]);

  // Parent options (only relevant if active level has parent rules)
  var levelMeta = LEVELS.find(function (l) { return l.num === activeLevel; }) || LEVELS[0];
  var hasParentLevel = levelMeta.parentLevel != null;
  var parentOptions = useMemo(function () {
    if (!hasParentLevel) return [];
    return options.filter(function (o) { return o.level === levelMeta.parentLevel && o.active; });
  }, [options, levelMeta.parentLevel, hasParentLevel]);

  // Get parent IDs for a given child option
  function parentIdsFor(childId) {
    return rules.filter(function (r) { return r.child_list_id === childId; }).map(function (r) { return r.parent_list_id; });
  }

  function openAdd() {
    setEditing('new');
    setForm({ code: '', label_en: '', label_ar: '', parentIds: [] });
  }

  function openEdit(opt) {
    setEditing(opt.id);
    setForm({
      code: opt.code,
      label_en: opt.label_en,
      label_ar: opt.label_ar,
      parentIds: parentIdsFor(opt.id),
    });
  }

  function cancelEdit() {
    setEditing(null);
    setForm({ code: '', label_en: '', label_ar: '', parentIds: [] });
  }

  async function save() {
    // Client-side validation
    var code = (form.code || '').trim().toUpperCase();
    var labelEn = (form.label_en || '').trim();
    var labelAr = (form.label_ar || '').trim();
    if (!validCode(code)) { toast.error('Code must be 1-4 uppercase letters/digits (A-Z, 0-9)'); return; }
    if (!labelEn) { toast.error('English label required'); return; }
    if (!labelAr) { toast.error('Arabic label required'); return; }
    // Check duplicate code at same level among ACTIVE rows (excluding current)
    var duplicate = options.find(function (o) {
      return o.level === activeLevel && o.code === code && o.active && o.id !== editing;
    });
    if (duplicate) { toast.error('Code "' + code + '" already in use at this level'); return; }

    setBusy(true);
    try {
      var savedId;
      if (editing === 'new') {
        var nextOrder = Math.max.apply(null, [0].concat(options.filter(function (o) { return o.level === activeLevel; }).map(function (o) { return o.display_order || 0; }))) + 1;
        var inserted = await dbInsert('inventory_lists', {
          level: activeLevel,
          code: code,
          label_en: labelEn,
          label_ar: labelAr,
          active: true,
          display_order: nextOrder,
          created_by: userProfile && userProfile.id,
          updated_by: userProfile && userProfile.id,
        }, userProfile && userProfile.id);
        savedId = inserted.id;
        toast.success('Added: ' + labelEn);
      } else {
        await dbUpdate('inventory_lists', editing, {
          code: code,
          label_en: labelEn,
          label_ar: labelAr,
          updated_by: userProfile && userProfile.id,
        }, userProfile && userProfile.id);
        savedId = editing;
        toast.success('Saved: ' + labelEn);
      }

      // Sync parent rules — only if this level uses them
      if (hasParentLevel || activeLevel === 6) {
        // Delete existing rules for this child
        await supabase.from('inventory_list_rules').delete().eq('child_list_id', savedId);
        // Insert new rules
        if (form.parentIds && form.parentIds.length > 0) {
          var ruleRows = form.parentIds.map(function (pid) {
            return { child_list_id: savedId, parent_list_id: pid };
          });
          await supabase.from('inventory_list_rules').insert(ruleRows);
        }
      }

      await reload();
      cancelEdit();
    } catch (err) {
      console.error('[inv-master] save failed:', err);
      toast.error('Save failed: ' + ((err && err.message) || String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(opt) {
    var action = opt.active ? 'deactivate' : 'reactivate';
    if (!confirm('Are you sure you want to ' + action + ' "' + opt.label_en + '"? Existing inventory referencing this option will stay intact.')) return;
    try {
      await dbUpdate('inventory_lists', opt.id, {
        active: !opt.active,
        updated_by: userProfile && userProfile.id,
      }, userProfile && userProfile.id);
      toast.success((opt.active ? 'Deactivated' : 'Reactivated') + ': ' + opt.label_en);
      await reload();
    } catch (err) {
      console.error('[inv-master] toggleActive failed:', err);
      toast.error('Failed: ' + ((err && err.message) || String(err)));
    }
  }

  // Permission denied screen
  if (!canManage) {
    return (
      <div style={{ padding: 24 }}>
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
          <div className="text-base font-extrabold text-amber-900">🔒 Access restricted</div>
          <div className="text-sm text-amber-800 mt-1 font-medium">
            The Inventory Master admin screen requires the "Manage Inventory Master" permission. Ask Max to grant it from Settings → Roles & Permissions.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 24 }} className="text-slate-600 font-medium">Loading inventory master...</div>;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200" style={{ padding: 20 }}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 24 }}>🗂️</span>
          <h2 className="text-xl font-extrabold text-slate-900">Inventory Master Lists</h2>
        </div>
        <div className="text-sm text-slate-700 font-medium mt-1">
          Manage the 8 classification levels. Changes affect dropdowns across the entire inventory system.
        </div>
        <div className="text-sm text-slate-700 font-medium" style={{ direction: 'rtl' }}>
          إدارة مستويات التصنيف الثمانية. التغييرات تؤثر على القوائم في كامل نظام المخزون.
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '220px 1fr' }}>
        {/* Level selector sidebar */}
        <div className="bg-slate-50 rounded-xl border border-slate-200" style={{ padding: 12 }}>
          <div className="text-[10px] font-extrabold text-slate-500 tracking-wider mb-2">CLASSIFICATION LEVELS</div>
          {LEVELS.map(function (lvl) {
            var count = options.filter(function (o) { return o.level === lvl.num && o.active; }).length;
            var inactive = options.filter(function (o) { return o.level === lvl.num && !o.active; }).length;
            var isActive = activeLevel === lvl.num;
            return (
              <button
                key={lvl.num}
                onClick={function () { setActiveLevel(lvl.num); cancelEdit(); setSearch(''); }}
                className={'w-full text-left rounded-lg mb-1 ' + (isActive ? 'bg-indigo-600 text-white' : 'bg-white hover:bg-slate-100 text-slate-900 border border-slate-200')}
                style={{ padding: '8px 10px' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-extrabold">L{lvl.num} · {lvl.en}</div>
                    <div className={'text-[10px] ' + (isActive ? 'text-indigo-100' : 'text-slate-600')} style={{ direction: 'rtl' }}>{lvl.ar}</div>
                  </div>
                  <div className={'text-[10px] font-bold px-1.5 py-0.5 rounded ' + (isActive ? 'bg-white text-indigo-700' : 'bg-slate-200 text-slate-700')}>
                    {count}{inactive > 0 ? ' / +' + inactive : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Options list + editor */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input
              type="text"
              placeholder="Search code or label..."
              value={search}
              onChange={function (e) { setSearch(e.target.value); }}
              className="flex-1 min-w-[200px] px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            />
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <input type="checkbox" checked={showInactive} onChange={function (e) { setShowInactive(e.target.checked); }} />
              Show inactive
            </label>
            <button
              onClick={openAdd}
              disabled={editing === 'new'}
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-extrabold rounded-lg"
            >
              + Add Option
            </button>
          </div>

          {/* Inline add/edit form */}
          {editing && (
            <div className="bg-indigo-50 border-2 border-indigo-300 rounded-xl mb-3" style={{ padding: 16 }}>
              <div className="text-sm font-extrabold text-indigo-900 mb-2">
                {editing === 'new' ? '+ New option in ' : '✏️ Edit option in '}{levelMeta.en}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="text-[11px] font-extrabold text-slate-700">Code *
                  <input
                    type="text"
                    value={form.code}
                    onChange={function (e) { setForm(Object.assign({}, form, { code: e.target.value.toUpperCase() })); }}
                    maxLength={4}
                    placeholder="A-Z, 0-9 (max 4)"
                    className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm font-mono uppercase bg-white"
                  />
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">English Label *
                  <input
                    type="text"
                    value={form.label_en}
                    onChange={function (e) { setForm(Object.assign({}, form, { label_en: e.target.value })); }}
                    placeholder="e.g. Premium"
                    className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                  />
                </label>
                <label className="text-[11px] font-extrabold text-slate-700">Arabic Label *
                  <input
                    type="text"
                    value={form.label_ar}
                    onChange={function (e) { setForm(Object.assign({}, form, { label_ar: e.target.value })); }}
                    placeholder="مثال: بريميوم"
                    className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                    style={{ direction: 'rtl' }}
                  />
                </label>
              </div>

              {(hasParentLevel || activeLevel === 6) && (
                <div className="mt-3">
                  <div className="text-[11px] font-extrabold text-slate-700 mb-1">
                    Valid under which Product Family? <span className="font-normal text-slate-500">(leave all unchecked → applies to ALL families)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {parentOptions.map(function (p) {
                      var checked = form.parentIds.indexOf(p.id) >= 0;
                      return (
                        <label key={p.id} className={'flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-semibold cursor-pointer ' + (checked ? 'bg-emerald-100 border-emerald-400 text-emerald-900' : 'bg-white border-slate-300 text-slate-700')}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={function (e) {
                              var next = form.parentIds.slice();
                              if (e.target.checked) {
                                if (next.indexOf(p.id) < 0) next.push(p.id);
                              } else {
                                next = next.filter(function (x) { return x !== p.id; });
                              }
                              setForm(Object.assign({}, form, { parentIds: next }));
                            }}
                          />
                          <span>{p.code} · {p.label_en}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-3">
                <button
                  onClick={save}
                  disabled={busy}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg"
                >
                  {busy ? 'Saving...' : (editing === 'new' ? '+ Add' : 'Save')}
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={busy}
                  className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Options table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="grid bg-slate-100 text-[10px] font-extrabold text-slate-700 tracking-wider uppercase" style={{ gridTemplateColumns: '70px 1fr 1fr 1fr 100px', padding: '8px 12px' }}>
              <div>Code</div>
              <div>English</div>
              <div style={{ direction: 'rtl' }}>العربية</div>
              <div>Valid Under</div>
              <div className="text-right">Actions</div>
            </div>
            {levelOptions.length === 0 ? (
              <div className="text-center text-slate-500 italic text-sm py-6">
                {search ? 'No matches for "' + search + '"' : 'No options yet — click "+ Add Option" to create one'}
              </div>
            ) : (
              levelOptions.map(function (opt) {
                var ruleParentIds = parentIdsFor(opt.id);
                var ruleParents = ruleParentIds.map(function (pid) {
                  var p = options.find(function (o) { return o.id === pid; });
                  return p ? p.code : '?';
                });
                return (
                  <div
                    key={opt.id}
                    className={'grid items-center border-t border-slate-100 ' + (opt.active ? '' : 'bg-slate-50 opacity-60')}
                    style={{ gridTemplateColumns: '70px 1fr 1fr 1fr 100px', padding: '10px 12px' }}
                  >
                    <div className="text-sm font-mono font-extrabold text-slate-900">{opt.code}</div>
                    <div className={'text-sm font-semibold ' + (opt.active ? 'text-slate-900' : 'text-slate-500 line-through')}>{opt.label_en}</div>
                    <div className={'text-sm font-semibold ' + (opt.active ? 'text-slate-900' : 'text-slate-500 line-through')} style={{ direction: 'rtl' }}>{opt.label_ar}</div>
                    <div className="text-[11px] text-slate-700 font-medium">
                      {ruleParents.length === 0 ? <span className="italic text-slate-500">all families</span> : ruleParents.join(', ')}
                    </div>
                    <div className="text-right flex justify-end gap-1">
                      <button
                        onClick={function () { openEdit(opt); }}
                        className="px-2 py-1 text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-bold"
                      >
                        Edit
                      </button>
                      <button
                        onClick={function () { toggleActive(opt); }}
                        className={'px-2 py-1 text-[10px] rounded font-bold ' + (opt.active ? 'bg-red-100 hover:bg-red-200 text-red-900' : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900')}
                      >
                        {opt.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="text-[10px] text-slate-500 mt-2 italic">
            Deactivated options stay in the database — existing inventory rows that reference them remain valid.
          </div>
        </div>
      </div>
    </div>
  );
}
