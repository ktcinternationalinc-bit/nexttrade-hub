'use client';
// v55.83-A.6.27.23 — Inventory Product List (Phase 1 Build 2)
//
// The catalog of every product the business stocks, classified via the
// 8-level hierarchy from Build 1. Each product is created ONCE here with
// its 8-level classification, optional quick code, optional design SKU,
// and default tech specs / operational data. Build 4 (warehouse
// receiving) will use these as the source of truth for auto-fill.
//
// Permission: super_admin OR "Edit Product List" — separate from "Edit
// Inventory" (Max's call: editing the master is more sensitive than
// receiving day-to-day inventory).
//
// Cascading dropdowns: universal rule application. Every level checks
// inventory_list_rules for parent restrictions. If rules exist for a
// child, that child only shows when ANY of its parents are selected
// upstream. If no rules exist, the child is universal.

import { useState, useEffect, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';
import InventoryVariantHistory from './InventoryVariantHistory';

var UOM_OPTIONS = [
  { v: 'kg',     en: 'Kilograms',     ar: 'كيلوغرام' },
  { v: 'meter',  en: 'Meters',        ar: 'متر' },
  { v: 'yard',   en: 'Yards',         ar: 'ياردة' },
  { v: 'roll',   en: 'Rolls',         ar: 'لفة' },
  { v: 'piece',  en: 'Pieces',        ar: 'قطعة' },
  { v: 'liter',  en: 'Liters',        ar: 'لتر' },
  { v: 'sqm',    en: 'Square Meters', ar: 'متر مربع' },
];

var CURRENCY_OPTIONS = ['EGP', 'USD', 'EUR'];

// Map of level number → field name on the product master form
var LEVEL_FIELD_MAP = {
  1: 'family_list_id',
  2: 'category_list_id',
  3: 'grade_list_id',
  4: 'construction_list_id',
  5: 'backing_list_id',
  6: 'color_list_id',
  7: 'pattern_list_id',
  8: 'spec_class_list_id',
  9: 'origin_list_id',
};

var LEVEL_LABELS = {
  1: { en: 'Product Family',  ar: 'عائلة المنتج' },
  2: { en: 'Category',         ar: 'التصنيف' },
  3: { en: 'Grade',            ar: 'الدرجة' },
  4: { en: 'Construction',     ar: 'التركيب' },
  5: { en: 'Backing',          ar: 'الظهر' },
  6: { en: 'Color',            ar: 'اللون' },
  7: { en: 'Pattern',          ar: 'النمط' },
  8: { en: 'Spec Class',       ar: 'فئة المواصفات' },
};

// Build the empty form
function emptyForm() {
  return {
    name_en: '',
    name_ar: '',
    quick_code: '',
    design_sku: '',
    family_list_id: '',
    category_list_id: '',
    grade_list_id: '',
    construction_list_id: '',
    backing_list_id: '',
    color_list_id: '',
    pattern_list_id: '',
    spec_class_list_id: '',
    default_uom: '',
    default_thickness_mm: '',
    default_width_m: '',
    default_gsm: '',
    default_density: '',
    default_weight_per_roll: '',
    default_roll_length_m: '',
    default_supplier: '',
    default_cost: '',
    default_currency: 'EGP',
    default_rack: '',
    notes: '',
  };
}

export default function InventoryProductMaster(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  // Permission gates
  var canView = isSuperAdmin || modulePerms['Inventory'] === true || modulePerms['Edit Product List'] === true;
  var canEdit = isSuperAdmin || modulePerms['Edit Product List'] === true;

  var [lists, setLists] = useState([]);          // all inventory_lists rows
  var [rules, setRules] = useState([]);          // all inventory_list_rules rows
  var [products, setProducts] = useState([]);    // all inventory_products rows
  var [loading, setLoading] = useState(true);

  // Filters / search
  var [search, setSearch] = useState('');
  var [familyFilter, setFamilyFilter] = useState('all');
  var [showInactive, setShowInactive] = useState(false);
  // v55.83-A.6.27.40 — featured-only filter ("show me my starred favorites")
  var [featuredOnly, setFeaturedOnly] = useState(false);
  // v55.83-A.6.27.40 — type filter: all | family templates | variants
  var [typeFilter, setTypeFilter] = useState('all');

  // Modal state
  var [modalMode, setModalMode] = useState(null); // null | 'new' | 'edit'
  // v55.83-A.6.27.42 — Create Variant modal state
  var [variantModalOpen, setVariantModalOpen] = useState(false);
  var [variantTemplate, setVariantTemplate] = useState(null); // the family template the variant will belong to
  var [variantForm, setVariantForm] = useState({
    category_code: '',
    construction_code: '',
    backing_code: '',
    pattern_code: '',
  });
  var [variantBusy, setVariantBusy] = useState(false);

  // v55.83-A.6.27.44d.1 — Variant History modal state
  var [historyVariant, setHistoryVariant] = useState(null);  // when non-null, modal is open
  var [modalProductId, setModalProductId] = useState(null);
  var [form, setForm] = useState(emptyForm());
  var [busy, setBusy] = useState(false);
  // v55.83-A.6.27.46 — Schema diagnostic: detect missing SQL migrations and warn user.
  // Avoids the silent-failure trap where a button "doesn't work" because a column doesn't exist.
  var [schemaIssues, setSchemaIssues] = useState([]);  // array of { migration, columns_missing }

  // Load all reference data + products
  useEffect(function () {
    if (!canView) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      try {
        var [lstRes, ruleRes, prodRes] = await Promise.all([
          supabase.from('inventory_lists').select('*').eq('active', true).order('level').order('display_order').order('label_en'),
          supabase.from('inventory_list_rules').select('*'),
          supabase.from('inventory_products').select('*').order('updated_at', { ascending: false }),
        ]);
        if (cancelled) return;
        setLists(lstRes.data || []);
        setRules(ruleRes.data || []);
        setProducts(prodRes.data || []);
        // v55.83-A.6.27.46 — Schema diagnostic: probe optional columns to detect missing
        // SQL migrations. We surface a banner so the user knows WHY their buttons aren't
        // working instead of giving up on the feature.
        var issues = [];
        // Migration .38 — featured + use_count
        try {
          var pr = await supabase.from('inventory_products').select('featured, use_count').limit(1);
          if (pr.error && /(featured|use_count).*does not exist/i.test(pr.error.message || '')) {
            issues.push({ migration: 'v55.83-A.6.27.38', columns_missing: ['featured', 'use_count'], affects: 'Star/favorite button' });
          }
        } catch (e) {/* swallow */}
        // Migration .39 — variant_suffix + parent_template_id + is_family_template
        try {
          var pr2 = await supabase.from('inventory_products').select('is_family_template, variant_suffix, parent_template_id').limit(1);
          if (pr2.error && /(is_family_template|variant_suffix|parent_template_id).*does not exist/i.test(pr2.error.message || '')) {
            issues.push({ migration: 'v55.83-A.6.27.39', columns_missing: ['is_family_template', 'variant_suffix', 'parent_template_id'], affects: 'Family templates / Create Variant' });
          }
        } catch (e) {/* swallow */}
        // Migration .43 — can_delete_product function
        try {
          var fnRes = await supabase.rpc('can_delete_product', { p_id: '00000000-0000-0000-0000-000000000000' });
          // We expect false or null for a non-existent UUID; any "function does not exist" error means migration missing
          if (fnRes.error && /function.*can_delete_product.*does not exist/i.test(fnRes.error.message || '')) {
            issues.push({ migration: 'v55.83-A.6.27.43', columns_missing: ['can_delete_product()'], affects: 'Edit lock + Delete button' });
          }
        } catch (e) {/* swallow */}
        setSchemaIssues(issues);
        // v55.83-A.6.27.50 — Loud toast on page load so user can't miss the banner.
        // Without this, the banner is silent and a user who never scrolls past their
        // product list won't realize their database is missing migrations.
        if (issues.length > 0 && !cancelled) {
          toast.warning(
            '⚠ Database missing ' + issues.length + ' migration' + (issues.length === 1 ? '' : 's') +
            ' — see the amber banner above for details. ' +
            'Some buttons (like the star) won\'t save until the SQL is run.'
          );
        }
      } catch (e) {
        console.error('[product-master] load failed:', e);
        toast.error('Failed to load product master data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [canView]);

  async function reload() {
    try {
      var [lstRes, ruleRes, prodRes] = await Promise.all([
        supabase.from('inventory_lists').select('*').eq('active', true).order('level').order('display_order').order('label_en'),
        supabase.from('inventory_list_rules').select('*'),
        supabase.from('inventory_products').select('*').order('updated_at', { ascending: false }),
      ]);
      setLists(lstRes.data || []);
      setRules(ruleRes.data || []);
      setProducts(prodRes.data || []);
    } catch (e) { console.error('[product-master] reload failed:', e); }
  }

  // Helper: get options for a given level, respecting parent restrictions from form selections
  // Universal rule: if the option has parent rules, it shows ONLY when one of its parents is currently picked.
  // If the option has NO parent rules, it's universal and always shows.
  function optionsForLevel(level, currentForm) {
    var levelOpts = lists.filter(function (l) { return l.level === level && l.active; });
    return levelOpts.filter(function (opt) {
      var optRules = rules.filter(function (r) { return r.child_list_id === opt.id; });
      if (optRules.length === 0) return true; // universal
      // Check whether ANY of this option's parent rules is satisfied by the current form
      return optRules.some(function (rule) {
        var parent = lists.find(function (l) { return l.id === rule.parent_list_id; });
        if (!parent) return false;
        var formFieldForParentLevel = LEVEL_FIELD_MAP[parent.level];
        if (!formFieldForParentLevel) return false;
        return currentForm[formFieldForParentLevel] === parent.id;
      });
    });
  }

  // When a parent level changes, reset child levels whose currently-selected option is no longer valid
  function resetInvalidChildren(updatedForm, changedLevel) {
    var newForm = Object.assign({}, updatedForm);
    for (var lvl = changedLevel + 1; lvl <= 8; lvl++) {
      var fieldName = LEVEL_FIELD_MAP[lvl];
      var currentValue = newForm[fieldName];
      if (!currentValue) continue;
      var validOptions = optionsForLevelGiven(lvl, newForm);
      var stillValid = validOptions.some(function (o) { return o.id === currentValue; });
      if (!stillValid) {
        newForm[fieldName] = '';
      }
    }
    return newForm;
  }

  // Same as optionsForLevel but uses the passed form snapshot (avoids stale state in resets)
  function optionsForLevelGiven(level, formSnapshot) {
    var levelOpts = lists.filter(function (l) { return l.level === level && l.active; });
    return levelOpts.filter(function (opt) {
      var optRules = rules.filter(function (r) { return r.child_list_id === opt.id; });
      if (optRules.length === 0) return true;
      return optRules.some(function (rule) {
        var parent = lists.find(function (l) { return l.id === rule.parent_list_id; });
        if (!parent) return false;
        var formFieldForParentLevel = LEVEL_FIELD_MAP[parent.level];
        if (!formFieldForParentLevel) return false;
        return formSnapshot[formFieldForParentLevel] === parent.id;
      });
    });
  }

  // Compute the classification slug from form selections
  function computeSlug(formData) {
    var parts = [];
    for (var lvl = 1; lvl <= 8; lvl++) {
      var fieldName = LEVEL_FIELD_MAP[lvl];
      var selectedId = formData[fieldName];
      if (!selectedId) return null; // incomplete
      var opt = lists.find(function (l) { return l.id === selectedId; });
      if (!opt) return null;
      parts.push(opt.code);
    }
    return parts.join('.');
  }

  // Build a human-readable description of a product from list IDs (for the table)
  function describeProduct(p) {
    var parts = [];
    for (var lvl = 1; lvl <= 8; lvl++) {
      var fieldName = LEVEL_FIELD_MAP[lvl];
      var id = p[fieldName];
      if (id) {
        var opt = lists.find(function (l) { return l.id === id; });
        if (opt) parts.push(opt.code);
      } else {
        parts.push('??');
      }
    }
    return parts.join('.');
  }

  // v55.83-A.6.27.43 — Build a labeled list of classification levels for a product.
  // Order: Family → Grade → Category → Construction → Backing → Color → Pattern → Spec → Country.
  // (Grade comes BEFORE Category per Max's request — "swap category with grade, then keep the rest".)
  // Returns array of { label_en, code, label_full } so the UI can bullet them.
  function describeProductBullets(p) {
    var order = [
      { lvl: 1, label: 'Family' },
      { lvl: 3, label: 'Grade' },
      { lvl: 2, label: 'Category' },
      { lvl: 4, label: 'Construction' },
      { lvl: 5, label: 'Backing' },
      { lvl: 6, label: 'Color' },
      { lvl: 7, label: 'Pattern' },
      { lvl: 8, label: 'Spec Class' },
      { lvl: 9, label: 'Country' },
    ];
    var out = [];
    for (var i = 0; i < order.length; i++) {
      var spec = order[i];
      var fieldName = LEVEL_FIELD_MAP[spec.lvl];
      var id = p[fieldName];
      if (!id) continue;  // skip levels that aren't filled
      var opt = lists.find(function (l) { return l.id === id; });
      if (!opt) continue;
      out.push({ label: spec.label, code: opt.code, value: opt.label_en });
    }
    return out;
  }

  // Filtered product list for the table
  var filteredProducts = useMemo(function () {
    var list = products.slice();
    if (!showInactive) list = list.filter(function (p) { return p.active; });
    if (familyFilter !== 'all') {
      list = list.filter(function (p) { return p.family_list_id === familyFilter; });
    }
    // v55.83-A.6.27.40 — featured-only filter
    if (featuredOnly) {
      list = list.filter(function (p) { return p.featured === true; });
    }
    // v55.83-A.6.27.40 — type filter (family templates vs variants vs all)
    if (typeFilter === 'templates') {
      list = list.filter(function (p) { return p.is_family_template === true; });
    } else if (typeFilter === 'variants') {
      list = list.filter(function (p) { return p.is_family_template === false && p.variant_suffix; });
    }
    // v55.83-A.6.27.40 — smart multi-keyword search (multi-word, any-order, substring)
    if (search.trim()) {
      var keywords = search.trim().toLowerCase().split(/\s+/).filter(function (k) { return k.length > 0; });
      if (keywords.length > 0) {
        list = list.filter(function (p) {
          var searchable = (
            (p.quick_code || '') + ' ' +
            (p.variant_suffix ? p.quick_code + '-' + p.variant_suffix + ' ' : '') +
            (p.name_en || '') + ' ' +
            (p.name_ar || '') + ' ' +
            (p.design_sku || '') + ' ' +
            (p.classification_slug || '')
          ).toLowerCase();
          for (var i = 0; i < keywords.length; i++) {
            if (searchable.indexOf(keywords[i]) < 0) return false;
          }
          return true;
        });
      }
    }
    // v55.83-A.6.27.40 — Sort: featured DESC, use_count DESC, then alphabetical
    list.sort(function (a, b) {
      var af = a.featured === true ? 1 : 0;
      var bf = b.featured === true ? 1 : 0;
      if (af !== bf) return bf - af;
      var au = Number(a.use_count || 0);
      var bu = Number(b.use_count || 0);
      if (bu !== au) return bu - au;
      return (a.name_en || '').localeCompare(b.name_en || '');
    });
    return list;
  }, [products, showInactive, familyFilter, search, featuredOnly, typeFilter]);

  var familyOptions = useMemo(function () {
    return lists.filter(function (l) { return l.level === 1 && l.active; });
  }, [lists]);

  function openNew() {
    setModalMode('new');
    setModalProductId(null);
    setForm(emptyForm());
  }

  // v55.83-A.6.27.43 — Track if the currently-edited product has any usage references.
  // If yes (used in receipts/movements/layers/adjustments), spec fields are locked.
  var [editLocked, setEditLocked] = useState(false);
  var [editIsTemplate, setEditIsTemplate] = useState(false);

  async function openEdit(p) {
    setModalMode('edit');
    setModalProductId(p.id);
    setEditIsTemplate(p.is_family_template === true);
    // v55.83-A.6.27.43 — Check usage. If product has been used, lock the spec fields.
    var locked = false;
    try {
      var res = await supabase.rpc('can_delete_product', { p_id: p.id });
      if (res.error) {
        // RPC missing or other failure — fall back to permissive (allow edit)
        console.warn('[product-master] can_delete_product unavailable, falling back to edit-allowed:', res.error.message);
      } else {
        // can_delete returns TRUE when no references → safe to edit. FALSE → locked.
        locked = (res.data === false);
      }
    } catch (e) {
      console.warn('[product-master] can_delete_product RPC threw, falling back to edit-allowed:', e);
    }
    setEditLocked(locked);
    setForm({
      name_en: p.name_en || '',
      name_ar: p.name_ar || '',
      quick_code: p.quick_code || '',
      design_sku: p.design_sku || '',
      family_list_id: p.family_list_id || '',
      category_list_id: p.category_list_id || '',
      grade_list_id: p.grade_list_id || '',
      construction_list_id: p.construction_list_id || '',
      backing_list_id: p.backing_list_id || '',
      color_list_id: p.color_list_id || '',
      pattern_list_id: p.pattern_list_id || '',
      spec_class_list_id: p.spec_class_list_id || '',
      default_uom: p.default_uom || '',
      default_thickness_mm: p.default_thickness_mm != null ? String(p.default_thickness_mm) : '',
      default_width_m: p.default_width_m != null ? String(p.default_width_m) : '',
      default_gsm: p.default_gsm != null ? String(p.default_gsm) : '',
      default_density: p.default_density != null ? String(p.default_density) : '',
      default_weight_per_roll: p.default_weight_per_roll != null ? String(p.default_weight_per_roll) : '',
      default_roll_length_m: p.default_roll_length_m != null ? String(p.default_roll_length_m) : '',
      default_supplier: p.default_supplier || '',
      default_cost: p.default_cost != null ? String(p.default_cost) : '',
      default_currency: p.default_currency || 'EGP',
      default_rack: p.default_rack || '',
      notes: p.notes || '',
    });
  }

  // v55.83-A.6.27.43 — Delete handler. Only allowed when product has zero references.
  // Two-step confirmation: dialog → require user to type DELETE.
  async function deleteProduct(p) {
    // Re-check at click time (in case usage was added since list-render)
    try {
      var chk = await supabase.rpc('can_delete_product', { p_id: p.id });
      if (chk.error) throw chk.error;
      if (chk.data === false) {
        alert('Cannot delete "' + (p.name_en || p.quick_code) + '" — it is referenced by one or more receipts, movements, layers, or adjustments. Use Deactivate instead.');
        await reload();
        return;
      }
    } catch (e) {
      console.error('[product-master] can_delete check failed:', e);
      toast.error('Could not verify deletion safety: ' + ((e && e.message) || String(e)));
      return;
    }
    var typed = prompt(
      'PERMANENT DELETE — this cannot be undone.\n\n' +
      'Product: ' + (p.name_en || p.quick_code) + '\n' +
      'Quick code: ' + (p.quick_code || '—') + (p.variant_suffix ? '-' + p.variant_suffix : '') + '\n\n' +
      'Verified: zero references in receipts, movements, layers, or adjustments.\n\n' +
      'Type DELETE (in capitals) to confirm:'
    );
    if (typed !== 'DELETE') {
      if (typed !== null) toast.error('Delete cancelled — confirmation text did not match.');
      return;
    }
    try {
      var del = await supabase.from('inventory_products').delete().eq('id', p.id);
      if (del.error) throw del.error;
      toast.success('Permanently deleted: ' + (p.name_en || p.quick_code));
      await reload();
    } catch (e) {
      console.error('[product-master] deleteProduct failed:', e);
      toast.error('Delete failed: ' + ((e && e.message) || String(e)));
    }
  }

  // v55.83-A.6.27.46 — Fix race condition: openDuplicate must NOT depend on the
  // async openEdit. openEdit awaits can_delete_product RPC, then calls setForm()
  // with the ORIGINAL product data. If openDuplicate calls setForm(prev => ...,
  // quick_code: '') BEFORE that resolves, the await wins and overwrites with the
  // original quick_code, leading to "save does nothing because of unique violation
  // (or stale data)" — the silent failure the user reported.
  //
  // Fix: inline the form-set directly, set modalMode synchronously, skip the
  // can_delete check (a NEW product doesn't need it — there are no references).
  function openDuplicate(p) {
    setModalMode('new');               // synchronous
    setModalProductId(null);
    setEditLocked(false);              // a new copy can't be "locked"
    setEditIsTemplate(p.is_family_template === true);
    setForm({
      name_en: (p.name_en || '') + ' (copy)',
      name_ar: (p.name_ar || '') + ' (نسخة)',
      quick_code: '',                  // user must enter a new quick code (uniqueness)
      design_sku: '',
      family_list_id: p.family_list_id || '',
      category_list_id: p.category_list_id || '',
      grade_list_id: p.grade_list_id || '',
      construction_list_id: p.construction_list_id || '',
      backing_list_id: p.backing_list_id || '',
      color_list_id: p.color_list_id || '',
      pattern_list_id: p.pattern_list_id || '',
      spec_class_list_id: p.spec_class_list_id || '',
      default_uom: p.default_uom || '',
      default_thickness_mm: p.default_thickness_mm != null ? String(p.default_thickness_mm) : '',
      default_width_m: p.default_width_m != null ? String(p.default_width_m) : '',
      default_gsm: p.default_gsm != null ? String(p.default_gsm) : '',
      default_density: p.default_density != null ? String(p.default_density) : '',
      default_weight_per_roll: p.default_weight_per_roll != null ? String(p.default_weight_per_roll) : '',
      default_roll_length_m: p.default_roll_length_m != null ? String(p.default_roll_length_m) : '',
      default_supplier: p.default_supplier || '',
      default_cost: p.default_cost != null ? String(p.default_cost) : '',
      default_currency: p.default_currency || 'EGP',
      default_rack: p.default_rack || '',
      notes: p.notes || '',
    });
    // Immediate user feedback so it's obvious the copy happened.
    toast.success('✓ Copied — change the Quick Code, then Save / تم النسخ — غيّر الكود ثم احفظ');
  }

  function closeModal() {
    setModalMode(null);
    setModalProductId(null);
    setForm(emptyForm());
  }

  // Level dropdown change handler — also resets invalid downstream selections
  function handleLevelChange(level, newValue) {
    var newForm = Object.assign({}, form);
    newForm[LEVEL_FIELD_MAP[level]] = newValue;
    newForm = resetInvalidChildren(newForm, level);
    setForm(newForm);
  }

  async function save() {
    // Validation
    var nameEn = (form.name_en || '').trim();
    var nameAr = (form.name_ar || '').trim();
    if (!nameEn) { toast.error('English name is required'); return; }
    if (!nameAr) { toast.error('Arabic name is required'); return; }

    // All 8 classification levels must be picked
    for (var lvl = 1; lvl <= 8; lvl++) {
      if (!form[LEVEL_FIELD_MAP[lvl]]) {
        toast.error('Please select Level ' + lvl + ' — ' + LEVEL_LABELS[lvl].en);
        return;
      }
    }

    var slug = computeSlug(form);
    if (!slug) { toast.error('Could not compute classification slug — please re-check selections'); return; }

    // Quick code uniqueness (client-side; DB also enforces)
    var quickCode = (form.quick_code || '').trim();
    // v55.83-A.6.27.46 — Helpful explicit message when user clicks Save on a "(copy)"
    // and never set a new quick code. Previous behavior: insert tried with null,
    // sometimes silently failed depending on DB state. Now we tell them what to do.
    if (modalMode === 'new' && (form.name_en || '').endsWith('(copy)') && !quickCode) {
      toast.error('Please change the Quick Code before saving this copied item / يرجى تغيير الكود قبل الحفظ');
      return;
    }
    if (quickCode) {
      var dup = products.find(function (p) {
        if (modalMode === 'edit' && p.id === modalProductId) return false;
        return p.active && (p.quick_code || '').trim().toLowerCase() === quickCode.toLowerCase();
      });
      if (dup) { toast.error('Quick code "' + quickCode + '" is already used by another active product'); return; }
    }

    setBusy(true);
    try {
      var payload = {
        name_en: nameEn,
        name_ar: nameAr,
        quick_code: quickCode || null,
        design_sku: (form.design_sku || '').trim() || null,
        family_list_id: form.family_list_id,
        category_list_id: form.category_list_id,
        grade_list_id: form.grade_list_id,
        construction_list_id: form.construction_list_id,
        backing_list_id: form.backing_list_id,
        color_list_id: form.color_list_id,
        pattern_list_id: form.pattern_list_id,
        spec_class_list_id: form.spec_class_list_id,
        classification_slug: slug,
        default_uom: form.default_uom || null,
        default_thickness_mm: form.default_thickness_mm ? Number(form.default_thickness_mm) : null,
        default_width_m: form.default_width_m ? Number(form.default_width_m) : null,
        default_gsm: form.default_gsm ? Number(form.default_gsm) : null,
        default_density: form.default_density ? Number(form.default_density) : null,
        default_weight_per_roll: form.default_weight_per_roll ? Number(form.default_weight_per_roll) : null,
        default_roll_length_m: form.default_roll_length_m ? Number(form.default_roll_length_m) : null,
        default_supplier: (form.default_supplier || '').trim() || null,
        default_cost: form.default_cost ? Number(form.default_cost) : null,
        default_currency: form.default_currency || null,
        default_rack: (form.default_rack || '').trim() || null,
        notes: (form.notes || '').trim() || null,
        updated_by: userProfile && userProfile.id,
      };

      if (modalMode === 'new') {
        payload.created_by = userProfile && userProfile.id;
        payload.active = true;
        await dbInsert('inventory_products', payload, userProfile && userProfile.id);
        toast.success('Product added: ' + nameEn);
      } else {
        await dbUpdate('inventory_products', modalProductId, payload, userProfile && userProfile.id);
        toast.success('Product saved: ' + nameEn);
      }
      await reload();
      closeModal();
    } catch (err) {
      console.error('[product-master] save failed:', err);
      toast.error('Save failed: ' + ((err && err.message) || String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(p) {
    var action = p.active ? 'deactivate' : 'reactivate';
    if (!confirm('Are you sure you want to ' + action + ' "' + p.name_en + '"? Existing inventory referencing this product will remain valid.')) return;
    try {
      await dbUpdate('inventory_products', p.id, {
        active: !p.active,
        updated_by: userProfile && userProfile.id,
      }, userProfile && userProfile.id);
      toast.success((p.active ? 'Deactivated' : 'Reactivated') + ': ' + p.name_en);
      await reload();
    } catch (err) {
      console.error('[product-master] toggleActive failed:', err);
      toast.error('Failed: ' + ((err && err.message) || String(err)));
    }
  }

  // v55.83-A.6.27.40 — Star toggle: marks/unmarks a product as featured.
  // Featured products always appear at the top of search dropdowns in
  // Inbound Shipments, Adjustments, and Sales Invoice pickers.
  async function toggleFeatured(p) {
    var newVal = !(p.featured === true);
    try {
      // v55.83-A.6.27.46 — Defensive read-back. dbUpdate auto-strips missing columns
      // (when SQL migration .38 hasn't been run), so we directly verify the column exists
      // by querying for it. If the column is missing, give the user a clear, actionable
      // error instead of a silent failure that looks like the button "doesn't work."
      var verifyRes = await supabase.from('inventory_products').select('id, featured').eq('id', p.id).maybeSingle();
      if (verifyRes.error && /column.*featured.*does not exist/i.test(verifyRes.error.message || '')) {
        toast.error('Stars not yet enabled — run SQL migration v55.83-A.6.27.38 (adds featured + use_count columns) / لم يتم تفعيل النجوم — قم بتشغيل ملف SQL');
        console.error('[product-master] featured column missing. Run sql/v55-83-a-6-27-38-catalog-support.sql');
        return;
      }
      await dbUpdate('inventory_products', p.id, {
        featured: newVal,
        updated_by: userProfile && userProfile.id,
      }, userProfile && userProfile.id);
      // Re-read to confirm the write took effect
      var after = await supabase.from('inventory_products').select('featured').eq('id', p.id).maybeSingle();
      if (after && after.data && after.data.featured !== newVal) {
        toast.error('Star save did not persist — check that SQL migration .38 was run / لم يتم الحفظ — تحقق من تشغيل ملف SQL');
        console.error('[product-master] toggleFeatured wrote but read-back shows no change. SQL migration may be missing.');
        return;
      }
      toast.success((newVal ? '⭐ Starred: ' : '☆ Unstarred: ') + (p.name_en || p.quick_code || 'product'));
      await reload();
    } catch (err) {
      console.error('[product-master] toggleFeatured failed:', err);
      toast.error('Star toggle failed: ' + ((err && err.message) || String(err)));
    }
  }

  // v55.83-A.6.27.42 — Create Variant flow.
  // openCreateVariant: opens the modal pre-bound to a family template.
  // saveVariant: calls get_or_create_variant RPC, silent-reuses or creates new.
  function openCreateVariant(template) {
    if (!template || template.is_family_template !== true) {
      toast.error('Variants can only be created from a Family template row.');
      return;
    }
    setVariantTemplate(template);
    setVariantForm({ category_code: '', construction_code: '', backing_code: '', pattern_code: '' });
    setVariantModalOpen(true);
  }

  function closeVariantModal() {
    setVariantModalOpen(false);
    setVariantTemplate(null);
    setVariantForm({ category_code: '', construction_code: '', backing_code: '', pattern_code: '' });
  }

  async function saveVariant() {
    if (!variantTemplate) return;
    if (!variantForm.category_code)     { alert('Category required.'); return; }
    if (!variantForm.construction_code) { alert('Construction required.'); return; }
    if (!variantForm.backing_code)      { alert('Backing required.'); return; }
    if (!variantForm.pattern_code)      { alert('Pattern required.'); return; }
    setVariantBusy(true);
    try {
      var res = await supabase.rpc('get_or_create_variant', {
        p_template_id:       variantTemplate.id,
        p_category_code:     variantForm.category_code,
        p_construction_code: variantForm.construction_code,
        p_backing_code:      variantForm.backing_code,
        p_pattern_code:      variantForm.pattern_code,
        p_user_id:           userProfile && userProfile.id,
      });
      if (res.error) throw res.error;
      await reload();
      toast.success('Variant ready — ' + variantTemplate.quick_code + ' · ' +
        variantForm.category_code + ' · ' + variantForm.construction_code + ' · ' +
        variantForm.backing_code + ' · ' + variantForm.pattern_code);
      closeVariantModal();
    } catch (err) {
      console.error('[product-master] saveVariant failed:', err);
      toast.error('Variant creation failed: ' + ((err && err.message) || String(err)));
    } finally {
      setVariantBusy(false);
    }
  }

  // Permission denied
  if (!canView) {
    return (
      <div style={{ padding: 24 }}>
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
          <div className="text-base font-extrabold text-amber-900">🔒 Access restricted</div>
          <div className="text-sm text-amber-800 mt-1 font-medium">
            Viewing the Product List requires the Inventory permission. Ask Max to grant it from Settings → Roles &amp; Permissions.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 24 }} className="text-slate-600 font-medium">Loading product master...</div>;
  }

  var liveSlug = computeSlug(form) || '(pick all 8 levels to preview)';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200" style={{ padding: 20 }}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 24 }}>📦</span>
          <h2 className="text-xl font-extrabold text-slate-900">Product List</h2>
        </div>
        <div className="text-sm text-slate-700 font-medium mt-1">
          Define each product once with its 8-level classification, optional quick code, and default specs. Used everywhere downstream.
        </div>
        <div className="text-sm text-slate-700 font-medium" style={{ direction: 'rtl' }}>
          عرّف كل منتج مرة واحدة بتصنيفه ذي الثمانية مستويات ورمزه السريع ومواصفاته الافتراضية.
        </div>
      </div>

      {/* v55.83-A.6.27.46 — SCHEMA DIAGNOSTIC BANNER.
          When SQL migrations are missing, certain buttons silently fail. This banner
          tells the user exactly which SQL file to run instead of leaving them confused. */}
      {schemaIssues.length > 0 && (
        <div className="bg-amber-100 border-2 border-amber-500 rounded-xl p-4 mb-4">
          <div className="flex items-start gap-3">
            <span className="text-3xl">⚠️</span>
            <div className="flex-1">
              <div className="text-base font-extrabold text-amber-950">
                Database migrations needed — some buttons will silently fail until you run the SQL
              </div>
              <div className="text-xs font-bold text-amber-900 mt-0.5" style={{ direction: 'rtl' }}>
                هناك ترقيات قاعدة بيانات مطلوبة — بعض الأزرار لن تعمل حتى يتم تشغيل SQL
              </div>
              <div className="mt-3 space-y-2">
                {schemaIssues.map(function (iss, i) {
                  return (
                    <div key={i} className="bg-white border-2 border-amber-300 rounded-lg p-2">
                      <div className="text-sm font-extrabold text-amber-950">
                        <span className="font-mono">{iss.migration}</span>
                      </div>
                      <div className="text-xs text-slate-900 font-bold mt-0.5">
                        Affects: <span className="text-amber-900">{iss.affects}</span>
                      </div>
                      <div className="text-[11px] text-slate-700 font-semibold mt-0.5">
                        Missing: <span className="font-mono">{iss.columns_missing.join(', ')}</span>
                      </div>
                      <div className="text-[11px] text-slate-700 mt-1">
                        Run <span className="font-mono bg-slate-200 px-1 rounded">sql/{iss.migration.toLowerCase().replace(/v/, 'v').replace(/\./g, '-')}-*.sql</span> in Supabase SQL Editor.
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="text-[10px] text-amber-900 italic mt-2">
                This banner will disappear automatically once the migrations run successfully.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="Search name, code, design SKU, or slug..."
          value={search}
          onChange={function (e) { setSearch(e.target.value); }}
          className="flex-1 min-w-[260px] px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
        />
        <select
          value={familyFilter}
          onChange={function (e) { setFamilyFilter(e.target.value); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold"
        >
          <option value="all">All families</option>
          {familyOptions.map(function (f) {
            return <option key={f.id} value={f.id}>{f.code} · {f.label_en}</option>;
          })}
        </select>
        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
          <input type="checkbox" checked={showInactive} onChange={function (e) { setShowInactive(e.target.checked); }} />
          Show inactive
        </label>
        {/* v55.83-A.6.27.40 — Featured-only filter */}
        <label className="text-xs font-bold text-amber-700 flex items-center gap-1 px-2 py-1 rounded bg-amber-50 border border-amber-200">
          <input type="checkbox" checked={featuredOnly} onChange={function (e) { setFeaturedOnly(e.target.checked); }} />
          ⭐ Starred only
        </label>
        {/* v55.83-A.6.27.40 — Type filter: all / templates / variants */}
        <select
          value={typeFilter}
          onChange={function (e) { setTypeFilter(e.target.value); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold"
        >
          <option value="all">All products</option>
          <option value="templates">Family templates only</option>
          <option value="variants">Variants only</option>
        </select>
        {canEdit && (
          <button
            onClick={openNew}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-lg"
          >
            + New Product
          </button>
        )}
      </div>

      {/* Products table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="grid bg-slate-100 text-[10px] font-extrabold text-slate-700 tracking-wider uppercase"
             style={{ gridTemplateColumns: '110px 1.5fr 2fr 140px 60px 370px', padding: '8px 12px' }}>
          <div>Code</div>
          <div>Name</div>
          <div>Classification</div>
          <div>Design SKU / Notes</div>
          <div>UOM</div>
          <div className="text-right">Actions</div>
        </div>
        {filteredProducts.length === 0 ? (
          <div className="text-center text-slate-500 italic text-sm py-8">
            {search || familyFilter !== 'all'
              ? 'No products match your filters'
              : (canEdit ? 'No products yet — click "+ New Product" to define your first one' : 'No products defined yet')}
          </div>
        ) : (
          filteredProducts.map(function (p) {
            return (
              <div
                key={p.id}
                className={'grid items-center border-t border-slate-200 bg-white text-slate-900 ' + (p.active ? '' : 'opacity-60')}
                style={{ gridTemplateColumns: '110px 1.5fr 2fr 140px 60px 370px', padding: '12px 12px' }}
              >
                <div className="text-sm font-mono font-extrabold text-slate-900">
                  {/* v55.83-A.6.27.40 — show variant suffix appended if this is a variant */}
                  {p.quick_code ? (
                    <span>
                      {p.quick_code}{p.variant_suffix ? ('-' + p.variant_suffix) : ''}
                    </span>
                  ) : <span className="text-slate-400 italic font-normal">—</span>}
                  {/* v55.83-A.6.27.40 — badges for family templates vs variants */}
                  {p.is_family_template === true && (
                    <div className="text-[9px] bg-indigo-100 text-indigo-800 font-bold rounded px-1 inline-block mt-0.5">FAMILY</div>
                  )}
                  {p.is_family_template === false && p.variant_suffix && (
                    <div className="text-[9px] bg-emerald-100 text-emerald-800 font-bold rounded px-1 inline-block mt-0.5">VARIANT</div>
                  )}
                  {Number(p.use_count || 0) > 0 && (
                    <div className="text-[9px] text-slate-500 mt-0.5">used {p.use_count}×</div>
                  )}
                </div>
                <div>
                  {/* v55.83-A.6.27.27 — Max requested Arabic description and
                      classification slug be larger + bolder. Bumped Arabic
                      name from text-[11px] font-semibold to text-base
                      font-extrabold. Bumped slug from text-[11px] font-semibold
                      to text-sm font-extrabold. Also bumped English name from
                      text-sm font-bold to text-base font-extrabold for parity
                      and widened the Classification column. */}
                  <div className={'text-base font-extrabold ' + (p.active ? 'text-slate-900' : 'text-slate-500 line-through')}>{p.name_en}</div>
                  <div className={'text-base font-extrabold mt-0.5 ' + (p.active ? 'text-slate-800' : 'text-slate-500 line-through')} style={{ direction: 'rtl' }}>{p.name_ar}</div>
                </div>
                {/* v55.83-A.6.27.43 — Classification breakdown as bullets per level.
                    Order: Family → Grade → Category → Construction → Backing → Color → Pattern → Spec → Country.
                    Each level shows label + value with high contrast (slate-900 on white). */}
                <div className="text-xs">
                  {(function () {
                    var bullets = describeProductBullets(p);
                    if (bullets.length === 0) {
                      return <span className="text-slate-500 italic">No classification set</span>;
                    }
                    return (
                      <ul className="space-y-0.5 list-disc list-inside marker:text-indigo-500">
                        {bullets.map(function (b, i) {
                          return (
                            <li key={i} className="text-slate-900 leading-tight">
                              <span className="font-extrabold text-slate-700">{b.label}:</span>{' '}
                              <span className="font-extrabold text-slate-900">{b.value}</span>
                              <span className="text-slate-700 font-mono"> ({b.code})</span>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
                <div className="text-[11px] text-slate-600">
                  {p.design_sku && <div className="font-semibold text-slate-700">{p.design_sku}</div>}
                  {p.notes && <div className="italic truncate" title={p.notes}>{p.notes.length > 40 ? p.notes.substring(0, 40) + '...' : p.notes}</div>}
                </div>
                <div className="text-[11px] text-slate-700 font-semibold">{p.default_uom || <span className="text-slate-400 italic font-normal">—</span>}</div>
                <div className="text-right flex justify-end gap-1">
                  {/* v55.83-A.6.27.40/41 — ⭐ Star toggle (always shown, click to toggle featured) */}
                  {canEdit && (
                    <button
                      onClick={function () { toggleFeatured(p); }}
                      className={'px-3 py-1.5 text-[16px] leading-none rounded font-bold border-2 ' + (p.featured === true ? 'bg-amber-200 hover:bg-amber-300 text-amber-700 border-amber-400 shadow' : 'bg-white hover:bg-amber-50 text-amber-500 border-amber-300')}
                      title={p.featured === true ? 'Featured — click to unstar (will no longer pin to top of pickers)' : 'Star this product (will pin to top of pickers)'}
                    >
                      {p.featured === true ? '⭐' : '☆'}
                    </button>
                  )}
                  {/* v55.83-A.6.27.44d.1 — 🔍 History button (read-only, available to all viewers).
                      Opens the Variant History modal: 4 tabs (Summary / Inbound / Outbound / Adjustments).
                      v55.83-A.6.27.46 — added toast confirmation so user knows the modal opened
                      (was confusing when scrolled past the modal). */}
                  <button
                    onClick={function () {
                      setHistoryVariant(p);
                      toast.success('📂 History opened for ' + (p.quick_code || p.name_en || 'product') + ' / تم فتح السجل');
                      // Ensure scroll-to-top in case the user is far down the page when they click.
                      setTimeout(function () { window.scrollTo({ top: 0, behavior: 'smooth' }); }, 50);
                    }}
                    className="px-2 py-1 text-[10px] bg-slate-700 hover:bg-slate-800 text-white rounded font-extrabold shadow"
                    title="View full history of this variant — inbound shipments, sales, adjustments, stock summary / سجل المنتج"
                  >
                    🔍 History
                  </button>
                  {canEdit && (
                    <button
                      onClick={function () { openEdit(p); }}
                      className="px-2 py-1 text-[10px] bg-indigo-700 hover:bg-indigo-800 text-white rounded font-extrabold shadow"
                    >
                      Edit
                    </button>
                  )}
                  {/* v55.83-A.6.27.42 — Create Variant button (only on family templates).
                      Opens a modal that picks 4 spec dropdowns and calls get_or_create_variant().
                      Silent-reuses if a matching variant exists, else creates new with next suffix. */}
                  {canEdit && p.is_family_template === true && (
                    <button
                      onClick={function () { openCreateVariant(p); }}
                      className="px-2 py-1 text-[10px] bg-purple-600 hover:bg-purple-700 text-white rounded font-bold shadow"
                      title="Create a spec variant of this family template (Category + Construction + Backing + Pattern)"
                    >
                      + Variant
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={function () { openDuplicate(p); }}
                      className="px-2 py-1 text-[10px] bg-blue-700 hover:bg-blue-800 text-white rounded font-extrabold shadow"
                      title="Duplicate this product as a starting point for a similar one"
                    >
                      Copy
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={function () { deleteProduct(p); }}
                      className="px-2 py-1 text-[10px] bg-red-700 hover:bg-red-800 text-white rounded font-extrabold shadow"
                      title="Permanently delete this product. Only allowed if it has zero references anywhere."
                    >
                      Delete
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={function () { toggleActive(p); }}
                      className={'px-2 py-1 text-[10px] rounded font-extrabold shadow ' + (p.active ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white')}
                    >
                      {p.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="text-[10px] text-slate-500 mt-2 italic">
        {filteredProducts.length} product{filteredProducts.length === 1 ? '' : 's'} shown. Deactivated products remain in the database — existing inventory referencing them stays valid.
      </div>

      {/* New/Edit modal */}
      {modalMode && (
        <div
          className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm overflow-y-auto"
          onClick={closeModal}
          style={{ padding: 16 }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl mx-auto"
            onClick={function (e) { e.stopPropagation(); }}
            style={{ maxWidth: 900, padding: 0 }}
          >
            {/* Modal header — dark indigo with inline color (defensive readability) */}
            <div
              className="rounded-t-2xl flex justify-between items-center gap-2"
              style={{ background: '#3730a3', padding: '14px 20px' }}
            >
              <div>
                <div className="text-lg font-extrabold" style={{ color: '#ffffff' }}>
                  {modalMode === 'new' ? '+ New Product' : '✏️ Edit Product'}
                </div>
                <div className="text-xs font-semibold" style={{ color: '#e0e7ff' }}>
                  {modalMode === 'new' ? 'Define a new product with classification and defaults' : (form.name_en || '(unnamed)')}
                </div>
              </div>
              <button
                onClick={closeModal}
                aria-label="Close"
                style={{ background: '#ffffff', color: '#1e293b', width: 36, height: 36, fontSize: 20, lineHeight: 1, border: '2px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', borderRadius: '50%', fontWeight: 800 }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 20, maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
              {/* v55.83-A.6.27.43 — Edit lock banner: shown when this product has references
                  (used in receipts/movements/layers/adjustments). Spec dropdowns are read-only.
                  Name + notes + defaults remain editable. To change specs, create a new variant. */}
              {modalMode === 'edit' && editLocked && (
                <div className="bg-amber-100 border-2 border-amber-500 rounded-lg p-3 mb-4">
                  <div className="text-base font-extrabold text-amber-900">🔒 This {editIsTemplate ? 'family template' : 'variant'} is in use — spec fields are read-only</div>
                  <div className="text-sm text-amber-900 mt-1 font-semibold">
                    {editIsTemplate
                      ? 'Receipts, movements, or layers reference this template. To change specs, use the "+ Variant" button on the row to create a new variant instead.'
                      : 'Receipts, movements, or layers reference this variant. To change specs, create a new variant via the "+ Variant" button on the parent family template. You CAN still edit the Name and Notes here.'}
                  </div>
                </div>
              )}
              {modalMode === 'edit' && !editLocked && (
                <div className="bg-emerald-100 border-2 border-emerald-500 rounded-lg p-3 mb-4">
                  <div className="text-base font-extrabold text-emerald-900">✏️ This product has zero references — all fields fully editable</div>
                  <div className="text-sm text-emerald-900 mt-1 font-semibold">
                    Once it&apos;s used in any receipt, the spec fields will become read-only to protect historical accuracy.
                  </div>
                </div>
              )}

              {/* Section 1: Identity */}
              <div className="mb-4">
                <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">IDENTITY / الهوية</div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[11px] font-extrabold text-slate-700">Product Name (English) *
                    <input
                      type="text"
                      value={form.name_en}
                      onChange={function (e) { setForm(Object.assign({}, form, { name_en: e.target.value })); }}
                      placeholder="e.g. Premium New Mosaic Dark Blue"
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                    />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Product Name (Arabic) *
                    <input
                      type="text"
                      value={form.name_ar}
                      onChange={function (e) { setForm(Object.assign({}, form, { name_ar: e.target.value })); }}
                      placeholder="مثال: موزاييك جديد بريميوم أزرق غامق"
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                      style={{ direction: 'rtl' }}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <label className="text-[11px] font-extrabold text-slate-700">Quick Code (optional)
                    <input
                      type="text"
                      value={form.quick_code}
                      onChange={function (e) { setForm(Object.assign({}, form, { quick_code: e.target.value })); }}
                      placeholder="e.g. NM-204 or PSL-BK"
                      maxLength={16}
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white font-mono"
                    />
                    <span className="text-[10px] text-slate-500 italic">Typed at receiving time to auto-fill everything</span>
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Design SKU (optional)
                    <input
                      type="text"
                      value={form.design_sku}
                      onChange={function (e) { setForm(Object.assign({}, form, { design_sku: e.target.value })); }}
                      placeholder="e.g. NM-204 design plate"
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                    />
                  </label>
                </div>
              </div>

              {/* Section 2: Classification — the cascading dropdowns */}
              <div className="mb-4">
                <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">CLASSIFICATION / التصنيف</div>
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 mb-2">
                  <div className="text-[10px] text-indigo-700 font-extrabold tracking-wider mb-1">LIVE SLUG / الرمز التلقائي</div>
                  <div className="text-base font-mono font-extrabold text-indigo-900">{liveSlug}</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(function (lvl) {
                    var opts = optionsForLevel(lvl, form);
                    var fieldName = LEVEL_FIELD_MAP[lvl];
                    var currentValue = form[fieldName];
                    return (
                      <label key={lvl} className="text-[11px] font-extrabold text-slate-700">
                        L{lvl} · {LEVEL_LABELS[lvl].en} *
                        <select
                          value={currentValue}
                          onChange={function (e) { handleLevelChange(lvl, e.target.value); }}
                          disabled={editLocked}
                          className={'w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm ' + (editLocked ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : 'bg-white text-slate-900')}
                        >
                          <option value="">— pick {LEVEL_LABELS[lvl].en.toLowerCase()} —</option>
                          {opts.map(function (o) {
                            return <option key={o.id} value={o.id}>{o.code} · {o.label_en} / {o.label_ar}</option>;
                          })}
                        </select>
                        {opts.length === 0 && (
                          <span className="text-[10px] text-amber-700 font-semibold italic">No options yet — add some in Master Lists or pick a different parent level</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Section 3: Tech spec defaults */}
              <div className="mb-4">
                <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">DEFAULT TECHNICAL SPECS / المواصفات الافتراضية (optional)</div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-[11px] font-extrabold text-slate-700">UOM
                    <select
                      value={form.default_uom}
                      onChange={function (e) { setForm(Object.assign({}, form, { default_uom: e.target.value })); }}
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                    >
                      <option value="">—</option>
                      {UOM_OPTIONS.map(function (u) {
                        return <option key={u.v} value={u.v}>{u.en} / {u.ar}</option>;
                      })}
                    </select>
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Thickness (mm)
                    <input type="text" value={form.default_thickness_mm} onChange={function (e) { setForm(Object.assign({}, form, { default_thickness_mm: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" placeholder="e.g. 1.5" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Width (m)
                    <input type="text" value={form.default_width_m} onChange={function (e) { setForm(Object.assign({}, form, { default_width_m: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" placeholder="e.g. 1.6" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">GSM
                    <input type="text" value={form.default_gsm} onChange={function (e) { setForm(Object.assign({}, form, { default_gsm: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Density
                    <input type="text" value={form.default_density} onChange={function (e) { setForm(Object.assign({}, form, { default_density: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Weight per Roll
                    <input type="text" value={form.default_weight_per_roll} onChange={function (e) { setForm(Object.assign({}, form, { default_weight_per_roll: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Roll Length (m)
                    <input type="text" value={form.default_roll_length_m} onChange={function (e) { setForm(Object.assign({}, form, { default_roll_length_m: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                  </label>
                </div>
              </div>

              {/* Section 4: Operational defaults */}
              <div className="mb-4">
                <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">DEFAULT OPERATIONAL DATA / البيانات التشغيلية الافتراضية (optional)</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] font-extrabold text-slate-700">Default Supplier
                    <input type="text" value={form.default_supplier} onChange={function (e) { setForm(Object.assign({}, form, { default_supplier: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" placeholder="e.g. ABC Suppliers" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Default Rack Location
                    <input type="text" value={form.default_rack} onChange={function (e) { setForm(Object.assign({}, form, { default_rack: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" placeholder="e.g. A-12" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Default Cost (per UOM)
                    <input type="text" value={form.default_cost} onChange={function (e) { setForm(Object.assign({}, form, { default_cost: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white font-mono" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Currency
                    <select
                      value={form.default_currency}
                      onChange={function (e) { setForm(Object.assign({}, form, { default_currency: e.target.value })); }}
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                    >
                      {CURRENCY_OPTIONS.map(function (c) { return <option key={c} value={c}>{c}</option>; })}
                    </select>
                  </label>
                </div>
              </div>

              {/* Section 5: Notes */}
              <div className="mb-4">
                <label className="text-[11px] font-extrabold text-slate-700 block">Notes (optional)
                  <textarea
                    value={form.notes}
                    onChange={function (e) { setForm(Object.assign({}, form, { notes: e.target.value })); }}
                    rows={2}
                    placeholder="Anything else about this product..."
                    className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white resize-none"
                  />
                </label>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl" style={{ padding: '12px 20px' }}>
              <button
                onClick={closeModal}
                disabled={busy}
                className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded-lg"
              >
                Cancel
              </button>
              {canEdit && (
                <button
                  onClick={save}
                  disabled={busy}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg"
                >
                  {busy ? 'Saving...' : (modalMode === 'new' ? '+ Add Product' : 'Save Changes')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* v55.83-A.6.27.42 — Create Variant modal */}
      {/* v55.83-A.6.27.44d.1 — Variant History modal */}
      <InventoryVariantHistory
        variant={historyVariant}
        isOpen={!!historyVariant}
        onClose={function () { setHistoryVariant(null); }}
      />

      {variantModalOpen && variantTemplate && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={closeVariantModal}>
          <div
            className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl"
            onClick={function (e) { e.stopPropagation(); }}
          >
            <div className="bg-purple-700 text-white rounded-t-2xl px-6 py-4">
              <div className="text-xs font-bold uppercase tracking-wider text-purple-100">Create Variant</div>
              <div className="text-xl font-extrabold mt-0.5">{variantTemplate.quick_code} — {variantTemplate.name_en}</div>
              <div className="text-xs text-purple-100 mt-1">
                Pick the 4 specs below. If a variant with these specs already exists, the system reuses it. Otherwise a new variant is created (next sequential suffix like {variantTemplate.quick_code}-001, -002, ...).
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <label className="text-xs font-extrabold text-slate-900">Category *
                  <select
                    value={variantForm.category_code}
                    onChange={function (e) { setVariantForm(Object.assign({}, variantForm, { category_code: e.target.value })); }}
                    className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-semibold"
                  >
                    <option value="">— pick —</option>
                    <option value="SM">SM · Smooth</option>
                    <option value="EM">EM · Embossed</option>
                  </select>
                </label>
                <label className="text-xs font-extrabold text-slate-900">Construction *
                  <select
                    value={variantForm.construction_code}
                    onChange={function (e) { setVariantForm(Object.assign({}, variantForm, { construction_code: e.target.value })); }}
                    className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-semibold"
                  >
                    <option value="">— pick —</option>
                    <option value="RG">RG · Regular</option>
                    <option value="PF">PF · Perforated</option>
                    <option value="FN">FN · Foam Non-Perforated</option>
                    <option value="FP">FP · Foam Perforated</option>
                    <option value="TL">TL · Tri-Lam</option>
                  </select>
                </label>
                <label className="text-xs font-extrabold text-slate-900">Backing *
                  <select
                    value={variantForm.backing_code}
                    onChange={function (e) { setVariantForm(Object.assign({}, variantForm, { backing_code: e.target.value })); }}
                    className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-semibold"
                  >
                    <option value="">— pick —</option>
                    <option value="BK">BK · Black</option>
                    <option value="CT">CT · Cotton</option>
                    <option value="FL">FL · Felt</option>
                    <option value="GR">GR · Gray</option>
                    <option value="GS">GS · Gray Suede</option>
                    <option value="NW">NW · Non-Woven</option>
                    <option value="OT">OT · Other</option>
                  </select>
                </label>
                <label className="text-xs font-extrabold text-slate-900">Pattern *
                  <select
                    value={variantForm.pattern_code}
                    onChange={function (e) { setVariantForm(Object.assign({}, variantForm, { pattern_code: e.target.value })); }}
                    className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-semibold"
                  >
                    <option value="">— pick —</option>
                    <option value="NA">NA · None</option>
                    <option value="HC">HC · Honeycomb</option>
                    <option value="MG">MG · Mechanical Grain</option>
                    <option value="RG">RG · Normal Emboss</option>
                  </select>
                </label>
              </div>
              {/* Smooth-Black soft warning — Smooth typically only available in Black */}
              {variantForm.category_code === 'SM' && variantTemplate && (function () {
                var slug = variantTemplate.classification_slug || '';
                var parts = slug.split('-');
                // Slug order: family - category - grade - construction - backing - color - pattern - spec - country
                // For templates, category/constr/back/pattern are blank, so color is at index 5
                var colorCode = parts[5] || '';
                if (colorCode && colorCode !== 'BK') {
                  return (
                    <div className="bg-yellow-100 border-2 border-yellow-400 rounded p-3 text-sm text-yellow-950 font-semibold">
                      ⚠ <span className="font-extrabold">Heads up:</span> Smooth leather is typically only available in Black, but this template is for color <span className="font-mono font-extrabold">{colorCode}</span>. You can still proceed if this is correct.
                    </div>
                  );
                }
                return null;
              })()}
            </div>
            <div className="bg-slate-100 rounded-b-2xl px-6 py-4 flex justify-end gap-2">
              <button
                onClick={closeVariantModal}
                disabled={variantBusy}
                className="px-4 py-2 bg-slate-300 hover:bg-slate-400 disabled:opacity-50 text-slate-900 text-sm font-bold rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={saveVariant}
                disabled={variantBusy}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg shadow"
              >
                {variantBusy ? 'Creating...' : '✓ Create / Reuse Variant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
