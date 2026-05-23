'use client';
// v55.83-A.6.27.22 — Inventory Master Admin (Phase 1 Build 1)
//
// Super-admin (or anyone with "Manage Inventory Master" permission) maintains
// the 8 classification levels here. This is the foundation for the inventory
// classification system — Product List (Build 2), Receiving Updates (Build 4),
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

// v55.83-A.6.27.26 (Max May 18 2026) — Max wants EVERY level (2-8) to
// support parent-rule restriction back to Level 1 (Family). Previously
// only Levels 2 and 6 had the parent-rule editor exposed; Max says he
// should be able to restrict Luxurious to Leather only, restrict Foam
// Perforated to Leather + Textile, restrict Honeycomb to PVC Pool, etc.
// Universal application per his earlier direction. All rules cascade
// back to Level 1 — the top of the hierarchy.
var LEVELS = [
  { num: 1, en: 'Product Family',  ar: 'عائلة المنتج',     hasParent: false, parentLevel: null },
  { num: 2, en: 'Category',         ar: 'التصنيف',          hasParent: true,  parentLevel: 1 },
  { num: 3, en: 'Grade',            ar: 'الدرجة',           hasParent: true,  parentLevel: 1 },
  { num: 4, en: 'Construction',     ar: 'التركيب',          hasParent: true,  parentLevel: 1 },
  { num: 5, en: 'Backing',          ar: 'الظهر',            hasParent: true,  parentLevel: 1 },
  { num: 6, en: 'Color',            ar: 'اللون',            hasParent: true,  parentLevel: 1 },
  { num: 7, en: 'Pattern',          ar: 'النمط',            hasParent: true,  parentLevel: 1 },
  { num: 8, en: 'Spec Class',       ar: 'فئة المواصفات',    hasParent: true,  parentLevel: 1 },
  // v55.83-A.6.27.NEXT (Issue 11, Max May 23 2026) — Level 9 (Country) is
  // referenced everywhere else (LEVEL_FIELD_MAP, schema column origin_list_id,
  // variant SQL function, classification slug) but was missing from this
  // admin LEVELS array, so there was no UI to populate it. Without options,
  // the Product form's L9 dropdown stays empty. Marked universal (no parent).
  { num: 9, en: 'Country',          ar: 'الدولة',           hasParent: false, parentLevel: null },
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

  // v55.83-A.6.27.24 — Esc key closes the modal. Guaranteed escape hatch
  // matching Build 2 Product List modal behavior.
  useEffect(function () {
    function onKey(e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && editing) {
        try { cancelEdit(); } catch (_) {}
      }
    }
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, [editing]);

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
    // v55.83-A.6.27.25 (Max May 18 2026) — Max reported "Add button does
    // NOTHING" after Build 1 deployment. Multiple possible causes —
    // unknown without seeing browser console. This rewrite adds:
    //   1. console.log on EVERY step so any failure is debuggable
    //   2. alert() fallback for validation errors (visible regardless
    //      of toast rendering quirks)
    //   3. alert() on caught dbInsert errors so user definitely sees
    //      what failed (most likely: SQL migration was not run yet)
    console.log('[inv-master] save() called. editing =', editing, ' activeLevel =', activeLevel, ' form =', form);

    // Client-side validation
    var code = (form.code || '').trim().toUpperCase();
    var labelEn = (form.label_en || '').trim();
    var labelAr = (form.label_ar || '').trim();
    console.log('[inv-master] validation inputs: code=', JSON.stringify(code), ' labelEn=', JSON.stringify(labelEn), ' labelAr=', JSON.stringify(labelAr));

    if (!validCode(code)) {
      console.warn('[inv-master] validation FAILED: code must be 1-4 uppercase letters/digits');
      toast.error('Code must be 1-4 uppercase letters/digits (A-Z, 0-9)');
      alert('Code must be 1-4 uppercase letters/digits (A-Z, 0-9). You entered: "' + code + '"');
      return;
    }
    if (!labelEn) {
      console.warn('[inv-master] validation FAILED: English label empty');
      toast.error('English label required');
      alert('English Label is required.');
      return;
    }
    if (!labelAr) {
      console.warn('[inv-master] validation FAILED: Arabic label empty');
      toast.error('Arabic label required');
      alert('Arabic Label is required.');
      return;
    }

    // Check duplicate code at same level among ACTIVE rows (excluding current)
    var duplicate = options.find(function (o) {
      return o.level === activeLevel && o.code === code && o.active && o.id !== editing;
    });
    if (duplicate) {
      console.warn('[inv-master] validation FAILED: duplicate code', code, 'at level', activeLevel);
      toast.error('Code "' + code + '" already in use at this level');
      alert('Code "' + code + '" is already in use at this level. Pick a different code.');
      return;
    }

    console.log('[inv-master] validation PASSED. Saving to Supabase...');
    setBusy(true);
    try {
      var savedId;
      if (editing === 'new') {
        var nextOrder = Math.max.apply(null, [0].concat(options.filter(function (o) { return o.level === activeLevel; }).map(function (o) { return o.display_order || 0; }))) + 1;
        console.log('[inv-master] dbInsert called. nextOrder =', nextOrder);
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
        console.log('[inv-master] dbInsert SUCCESS. savedId =', savedId);
        toast.success('Added: ' + labelEn);
      } else {
        console.log('[inv-master] dbUpdate called. id =', editing);
        await dbUpdate('inventory_lists', editing, {
          code: code,
          label_en: labelEn,
          label_ar: labelAr,
          updated_by: userProfile && userProfile.id,
        }, userProfile && userProfile.id);
        savedId = editing;
        console.log('[inv-master] dbUpdate SUCCESS');
        toast.success('Saved: ' + labelEn);
      }

      // Sync parent rules — every level except Level 1 supports them.
      // v55.83-A.6.27.26 — was previously gated to L2 + L6 only;
      // unblocked for L3-L5 + L7-L8 per Max's request.
      if (hasParentLevel) {
        console.log('[inv-master] syncing parent rules for level', activeLevel, ' parentIds =', form.parentIds);
        // Delete existing rules for this child
        var delRes = await supabase.from('inventory_list_rules').delete().eq('child_list_id', savedId);
        if (delRes.error) console.error('[inv-master] rule delete error:', delRes.error);
        // Insert new rules
        if (form.parentIds && form.parentIds.length > 0) {
          var ruleRows = form.parentIds.map(function (pid) {
            return { child_list_id: savedId, parent_list_id: pid };
          });
          var insRes = await supabase.from('inventory_list_rules').insert(ruleRows);
          if (insRes.error) console.error('[inv-master] rule insert error:', insRes.error);
        }
      }

      console.log('[inv-master] reload + close modal');
      await reload();
      cancelEdit();
    } catch (err) {
      console.error('[inv-master] save FAILED with caught error:', err);
      var msg = (err && err.message) || String(err);
      toast.error('Save failed: ' + msg);
      // Visible fallback for users who can't see toasts. Most likely
      // cause: SQL migration was not run yet, so inventory_lists table
      // does not exist in Supabase. Tell user clearly.
      var hint = '';
      if (msg.indexOf('inventory_lists') >= 0 && (msg.toLowerCase().indexOf('does not exist') >= 0 || msg.toLowerCase().indexOf('relation') >= 0)) {
        hint = '\n\nLikely cause: the SQL migration was not run yet in Supabase. Run the v55.83-A.6.27.22 migration first, then try again.';
      } else if (msg.toLowerCase().indexOf('row-level security') >= 0 || msg.toLowerCase().indexOf('rls') >= 0) {
        hint = '\n\nLikely cause: Row Level Security policies on inventory_lists are blocking the insert. Check the policy block at the bottom of the SQL migration.';
      }
      alert('Save failed: ' + msg + hint);
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

          {/* Inline add/edit form
              v55.83-A.6.27.24 (Max May 18 2026) — Max reported "no save
              button" when adding a Category option. Root cause: form was
              inline above the table; with 3 input fields + 4 family
              checkboxes the form grew tall enough to push the save
              button below the viewport. User didn't see it without
              scrolling.
              Fix: convert to centered modal with sticky footer so save
              + cancel are ALWAYS visible regardless of form height.
              Matches the Build 2 Product List modal pattern. */}
          {editing && (
            <div
              className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm overflow-y-auto"
              onClick={cancelEdit}
              style={{ padding: 16 }}
            >
              <div
                className="bg-white rounded-2xl shadow-2xl mx-auto"
                onClick={function (e) { e.stopPropagation(); }}
                style={{ maxWidth: 720 }}
              >
                {/* Modal header */}
                <div
                  className="rounded-t-2xl flex justify-between items-center gap-2"
                  style={{ background: '#3730a3', padding: '14px 20px' }}
                >
                  <div>
                    <div className="text-lg font-extrabold" style={{ color: '#ffffff' }}>
                      {editing === 'new' ? '+ New option in ' : '✏️ Edit option in '}{levelMeta.en}
                    </div>
                    <div className="text-xs font-semibold" style={{ color: '#e0e7ff' }} >
                      L{activeLevel} · {levelMeta.en} / <span style={{ direction: 'rtl' }}>{levelMeta.ar}</span>
                    </div>
                  </div>
                  <button
                    onClick={cancelEdit}
                    aria-label="Close"
                    style={{ background: '#ffffff', color: '#1e293b', width: 36, height: 36, fontSize: 20, lineHeight: 1, border: '2px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', borderRadius: '50%', fontWeight: 800 }}
                  >
                    ✕
                  </button>
                </div>

                {/* Modal body */}
                <div style={{ padding: 20, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
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

                  {hasParentLevel && (
                    <div className="mt-4">
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
                </div>

                {/* Modal footer — sticky, always visible */}
                <div
                  className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl"
                  style={{ padding: '12px 20px' }}
                >
                  <button
                    onClick={cancelEdit}
                    disabled={busy}
                    className="px-4 py-2 bg-slate-300 hover:bg-slate-400 disabled:opacity-50 text-slate-900 text-sm font-bold rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={function () {
                      // v55.83-A.6.27.25 — confirm click is firing.
                      // If user reports "nothing happens" and this log
                      // does NOT appear in console, it's a render/event-
                      // handler problem. If it DOES appear, save() is
                      // running and we'll see further logs from there.
                      console.log('[inv-master] Save/Add button CLICKED');
                      save();
                    }}
                    disabled={busy}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg shadow"
                  >
                    {busy ? 'Saving...' : (editing === 'new' ? '+ Add Option' : 'Save Changes')}
                  </button>
                </div>
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
