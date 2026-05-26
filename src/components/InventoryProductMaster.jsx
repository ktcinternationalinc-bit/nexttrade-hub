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
  // v55.83-A.6.27.71 HOTFIX 5 (Max May 25 2026): L9 was added in .66 but
  // never registered in LEVEL_LABELS — line 1242 + 1249 threw "undefined
  // is not an object" trying to render the level picker for L9.
  9: { en: 'Country',          ar: 'البلد' },
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
  // v55.83-A.6.27.55 — DEFAULT CHANGED to 'variants' per Max:
  // "default of product list should be the variants. Family products should not
  //  display on the main overview as product lists; only there for user to use
  //  to create products." User can switch to 'all' or 'templates' explicitly.
  // v55.83-A.6.27.72 HOTFIX 8 (Max May 26 2026):
  //   Max created two products manually via "+ New Product", they saved
  //   correctly to inventory_products (verified in DB), but did NOT appear in
  //   the front-end list — leading to "I saved it and nothing happened".
  //   Root cause: this filter defaulted to 'variants' which requires
  //   p.variant_suffix to be truthy. Manually-added products don't have a
  //   variant_suffix (only ones created via the template/variant flow do),
  //   so they got silently filtered out. Default is now 'all'.
  var [typeFilter, setTypeFilter] = useState('all');

  // Modal state
  var [modalMode, setModalMode] = useState(null); // null | 'new' | 'edit'
  // v55.83-A.6.27.71 (Phase 4) — Removed dead variant modal state.
  // The variant modal was replaced by openCloneTemplate() in v55.83-A.6.27.42
  // but the JSX + state + helpers were left in place. None of variantModalOpen,
  // variantTemplate, variantForm, variantBusy, closeVariantModal, saveVariant,
  // openCreateVariant were ever called from anywhere outside this file. Safely
  // removed in Phase 4. ~115 lines of dead code eliminated.

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
    // v55.83-A.6.27.NEXT (Issue 11) — now iterates through Level 9 too
    for (var lvl = changedLevel + 1; lvl <= 9; lvl++) {
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

  // Compute the classification slug from form selections.
  // v55.83-A.6.27.NEXT (Issue 11, Max May 23 2026) — Levels 1-8 required;
  // Level 9 (Country/origin) is OPTIONAL — appended to the slug only if
  // the user actually picked one. Returns null if any of 1-8 is missing.
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
    // Level 9 — optional, append only if picked
    var l9Id = formData[LEVEL_FIELD_MAP[9]];
    if (l9Id) {
      var l9Opt = lists.find(function (l) { return l.id === l9Id; });
      if (l9Opt) parts.push(l9Opt.code);
    }
    return parts.join('.');
  }

  // Build a human-readable description of a product from list IDs (for the table)
  // v55.83-A.6.27.NEXT (Issue 11) — iterates all 9 levels (was 8, dropping Country)
  function describeProduct(p) {
    var parts = [];
    for (var lvl = 1; lvl <= 9; lvl++) {
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
      // v55.83-A.6.27.72 HOTFIX 8 — "Products" filter now means "anything that
      // is NOT a family template", regardless of whether it has a variant_suffix.
      // Previously required p.variant_suffix which silently excluded all
      // manually-added products (the "+ New Product" flow doesn't set
      // variant_suffix — only the template/variant flow does). This caused
      // Max's two test products to be invisible despite being saved correctly.
      list = list.filter(function (p) { return p.is_family_template !== true; });
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
    // v55.83-A.6.27.60 — Spec-field edit lock REMOVED per Max May 22 2026.
    // The mental model: when a variant is created from a template, the variant
    // is a snapshot. From then on the variant is independent. Editing or deleting
    // the template does NOT propagate to existing variants. So there's no reason
    // to lock template editing once variants exist — they're not affected.
    // Variants themselves are also always editable (they're already independent
    // entities; editing them only changes the one variant).
    //
    // We keep editLocked state for back-compat with the JSX banner conditionals,
    // but always set it to false.
    setEditLocked(false);
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
    console.log('[product-master] deleteProduct clicked for:', p && p.quick_code, p && p.id, 'is_template:', p && p.is_family_template);

    // v55.83-A.6.27.60 — Always allow deleting templates (per Max: variants are
    // independent snapshots, so removing a template never affects existing
    // products). For VARIANTS, we still check FK references because deleting
    // a variant with inventory layers/movements would orphan real warehouse
    // stock — that's not what Max meant by "independent."
    var isTemplate = (p && p.is_family_template === true);

    if (!isTemplate) {
      // Variant: try the RPC if available; fall back to permissive if missing.
      try {
        var chk = await supabase.rpc('can_delete_product', { p_id: p.id });
        if (!chk.error && chk.data === false) {
          alert('Cannot delete Product "' + (p.name_en || p.quick_code) + '" — it has inventory layers, movements, or invoice references. Use Deactivate instead.\n\nIf you want to delete anyway, first clear all related inventory rows.');
          await reload();
          return;
        }
        // If RPC errored (missing function), log and proceed permissive.
        if (chk.error) {
          console.warn('[product-master] can_delete_product unavailable, proceeding permissive (DB FK constraints will still block if unsafe):', chk.error.message);
        }
      } catch (e) {
        console.warn('[product-master] can_delete_product threw, proceeding permissive:', e);
      }
    }

    var typed = prompt(
      'PERMANENT DELETE — this cannot be undone.\n\n' +
      (isTemplate ? '[TEMPLATE PRODUCT — blueprint only, no stock attached]\n\n' : '[PRODUCT — actual SKU. Will fail if inventory rows reference it.]\n\n') +
      'Name: ' + (p.name_en || p.quick_code) + '\n' +
      'Quick code: ' + (p.quick_code || '—') + (p.variant_suffix ? '-' + p.variant_suffix : '') + '\n\n' +
      'Type DELETE (in capitals) to confirm:'
    );
    if (typed !== 'DELETE') {
      if (typed !== null) {
        try { toast.error('Delete cancelled — confirmation text did not match.'); } catch (_) {}
      }
      return;
    }
    try {
      var del = await supabase.from('inventory_products').delete().eq('id', p.id);
      if (del.error) throw del.error;
      try { toast.success('Permanently deleted: ' + (p.name_en || p.quick_code)); } catch (_) {}
      await reload();
    } catch (e) {
      console.error('[product-master] deleteProduct failed:', e);
      var errMsg2 = (e && e.message) || String(e);
      try { toast.error('Delete failed: ' + errMsg2); } catch (_) {}
      // Better error messages for the most common FK violations
      var hint = '';
      if (/violates foreign key constraint|still referenced/i.test(errMsg2)) {
        hint = '\n\nThis product is referenced by inventory layers, movements, or invoice items. Database refused the delete. Use Deactivate instead, or remove the related rows first.';
      }
      alert('Delete failed: ' + errMsg2 + hint);
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
    // v55.83-A.6.27.NEXT (Issue 11, Max May 23 2026 — URGENT):
    //   "i tried to add a product manually and i clicked save after entering
    //    all the levels and data and nothing happened when i clicked on save.
    //    it just remained in the current pop box."
    //
    // v55.83-A.6.27.72 HOTFIX 7 (Max May 26 2026):
    //   "if there is any error it should tell the user that they need to fill
    //    out something they missed ...regular ui conformity and regulations
    //    that should be there in teh first place. also if there is a duplicate
    //    created you must say that this is a duplicate with another and name
    //    it....no duplicates allowed."
    //
    // Hardened against ALL silent-failure modes:
    //   1. console.log breadcrumbs at every step so we can see in DevTools
    //      exactly where it stops
    //   2. alert() fallback alongside every toast — if the toast UI is
    //      broken/dismissed, alert() is unmissable
    //   3. Level 9 (Country/origin_list_id) now validated AND included in
    //      payload AND included in slug — was missing before, causing inserts
    //      to fail or origin data to be silently dropped
    //   4. Audit-log failure no longer swallowed silently
    //   5. HOTFIX 7 — Collect ALL missing fields and list them in ONE message
    //      (not one-at-a-time). Tells user every single thing they missed.
    //   6. HOTFIX 7 — Comprehensive duplicate detection: checks quick_code,
    //      classification_slug, name_en, AND name_ar against ALL products
    //      (active + inactive). Names the specific conflicting product so the
    //      user knows exactly what's clashing.
    var DEBUG = '[product-master.save]';
    console.log(DEBUG, 'START — modalMode:', modalMode, 'form:', form);

    function fail(msg) {
      console.error(DEBUG, 'FAIL:', msg);
      toast.error(msg);
      // Belt-and-braces: if the toast UI is broken/offscreen, the user
      // gets an unmissable native alert instead of silently nothing.
      try { alert(msg); } catch (_) {}
    }

    // v55.83-A.6.27.72 HOTFIX 7 — Collect ALL validation errors first, report once.
    // Previous behavior: stopped at the FIRST missing field, told user that one
    // thing, then they fixed it and got another error, and another. Now: one
    // message lists EVERY field they missed.
    var missing = [];
    var nameEn = (form.name_en || '').trim();
    var nameAr = (form.name_ar || '').trim();
    if (!nameEn) missing.push('• English name (name_en)');
    if (!nameAr) missing.push('• Arabic name (name_ar)');

    // Levels 1-8 are required. Level 9 (Country/origin) is OPTIONAL because
    // the InventoryMasterAdmin UI doesn't expose Level 9 management yet, so
    // most installs have no L9 options to pick. If/when L9 options exist
    // and the user picks one, it's included in the slug and payload.
    for (var lvl = 1; lvl <= 8; lvl++) {
      if (!form[LEVEL_FIELD_MAP[lvl]]) {
        missing.push('• Level ' + lvl + ' — ' + (LEVEL_LABELS[lvl] ? LEVEL_LABELS[lvl].en : 'level ' + lvl));
      }
    }

    if (missing.length > 0) {
      fail('Cannot save — please fill in these required fields:\n\n' + missing.join('\n') +
           '\n\n(' + missing.length + ' field' + (missing.length === 1 ? '' : 's') + ' missing)');
      return;
    }

    var slug = computeSlug(form);
    if (!slug) { fail('Could not compute classification slug — please re-check selections'); return; }

    // Quick code uniqueness (client-side; DB also enforces)
    var quickCode = (form.quick_code || '').trim();
    if (modalMode === 'new' && (form.name_en || '').endsWith('(copy)') && !quickCode) {
      fail('Please change the Quick Code before saving this copied item / يرجى تغيير الكود قبل الحفظ');
      return;
    }

    // v55.83-A.6.27.72 HOTFIX 7 — Comprehensive duplicate detection.
    // Checks quick_code, classification_slug, name_en, AND name_ar against
    // ALL products (active + inactive). NAMES the conflicting product.
    // No duplicates allowed.
    function describeConflict(p, conflictField) {
      var label = (p.name_en || p.name_ar || '(unnamed)') + (p.name_ar && p.name_en !== p.name_ar ? ' / ' + p.name_ar : '');
      var code = p.quick_code ? p.quick_code : '(no quick code)';
      var status = p.active ? 'ACTIVE' : 'INACTIVE (deactivated)';
      return '"' + label + '" — Quick Code: ' + code + ' — Status: ' + status + ' — ID: ' + p.id;
    }

    // 1) Quick code conflict (only if user typed one)
    if (quickCode) {
      var dupCode = products.find(function (p) {
        if (modalMode === 'edit' && p.id === modalProductId) return false;
        return (p.quick_code || '').trim().toLowerCase() === quickCode.toLowerCase();
      });
      if (dupCode) {
        fail('DUPLICATE QUICK CODE — cannot save.\n\nThe code "' + quickCode + '" is already used by:\n' +
             describeConflict(dupCode, 'quick_code') +
             '\n\nNo duplicates allowed. Use a different Quick Code, or open the existing product and edit it.');
        return;
      }
    }

    // 2) Classification slug conflict (same exact combo of Family/Category/Grade/...etc)
    var dupSlug = products.find(function (p) {
      if (modalMode === 'edit' && p.id === modalProductId) return false;
      return p.classification_slug === slug;
    });
    if (dupSlug) {
      fail('DUPLICATE CLASSIFICATION — cannot save.\n\nA product with the EXACT same Family/Category/Grade/Construction/Backing/Color/Pattern/Spec' + (form.origin_list_id ? '/Country' : '') + ' combination already exists:\n' +
           describeConflict(dupSlug, 'classification_slug') +
           '\n\nClassification slug: ' + slug +
           '\n\nNo duplicates allowed. Change at least one of your level selections, or open the existing product and edit it.');
      return;
    }

    // 3) English name conflict (case-insensitive, trimmed)
    var dupNameEn = products.find(function (p) {
      if (modalMode === 'edit' && p.id === modalProductId) return false;
      return (p.name_en || '').trim().toLowerCase() === nameEn.toLowerCase();
    });
    if (dupNameEn) {
      fail('DUPLICATE ENGLISH NAME — cannot save.\n\nA product named "' + nameEn + '" already exists:\n' +
           describeConflict(dupNameEn, 'name_en') +
           '\n\nNo duplicates allowed. Adjust the name slightly to differentiate (e.g. add a thickness, color shade, or roll-length suffix), or open the existing product and edit it.');
      return;
    }

    // 4) Arabic name conflict
    var dupNameAr = products.find(function (p) {
      if (modalMode === 'edit' && p.id === modalProductId) return false;
      return (p.name_ar || '').trim().toLowerCase() === nameAr.toLowerCase();
    });
    if (dupNameAr) {
      fail('DUPLICATE ARABIC NAME — cannot save.\n\nA product with the Arabic name "' + nameAr + '" already exists:\n' +
           describeConflict(dupNameAr, 'name_ar') +
           '\n\nNo duplicates allowed. Adjust the Arabic name slightly to differentiate, or open the existing product and edit it.');
      return;
    }

    console.log(DEBUG, 'validation passed — proceeding to insert');
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
        // v55.83-A.6.27.NEXT (Issue 11) — origin_list_id was missing!
        origin_list_id: form.origin_list_id,
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
      console.log(DEBUG, 'payload built:', payload);

      var saved;
      if (modalMode === 'new') {
        payload.created_by = userProfile && userProfile.id;
        payload.active = true;
        console.log(DEBUG, 'calling dbInsert...');
        saved = await dbInsert('inventory_products', payload, userProfile && userProfile.id);
        console.log(DEBUG, 'dbInsert returned:', saved);
        if (!saved || !saved.id) {
          // dbInsert should always return data on success. If we get here
          // with no id, something went wrong in the helper without throwing.
          throw new Error('Insert returned no data — check console for [dbInsert] warnings about stripped columns.');
        }
        toast.success('Product added: ' + nameEn);
        try { console.log(DEBUG, 'product saved id:', saved.id); } catch (_) {}
      } else {
        console.log(DEBUG, 'calling dbUpdate id=' + modalProductId);
        await dbUpdate('inventory_products', modalProductId, payload, userProfile && userProfile.id);
        toast.success('Product saved: ' + nameEn);
      }
      console.log(DEBUG, 'reloading list...');
      await reload();
      console.log(DEBUG, 'closing modal');
      closeModal();
      console.log(DEBUG, 'DONE — save flow complete');
    } catch (err) {
      console.error(DEBUG, 'CAUGHT EXCEPTION:', err);
      var msg = (err && err.message) || String(err);
      var hint = '';
      // Common cases — give actionable guidance.
      if (/column.*does not exist/i.test(msg)) {
        hint = '\n\nLikely a missing column. Open DevTools → Console and look for [dbInsert] warnings about stripped columns. If the column is critical, you may need to run a SQL migration.';
      } else if (/violates.*not-null/i.test(msg)) {
        hint = '\n\nA required column is null. Check that every classification level is selected, including Country (Level 9).';
      } else if (/violates.*unique/i.test(msg)) {
        hint = '\n\nSomething is duplicated (probably quick_code or classification_slug). Try a different code.';
      } else if (/permission denied|rls/i.test(msg)) {
        hint = '\n\nDatabase Row Level Security is blocking this write. Check Supabase RLS policies on inventory_products.';
      }
      fail('Save failed: ' + msg + hint);
    } finally {
      console.log(DEBUG, 'setBusy(false)');
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

  // v55.83-A.6.27.NEXT (Issue 10, Max May 23 2026): replaced the old 4-spec
  // "Create Variant" flow with a Clone-Template flow.
  //
  // OLD flow: 4 inline dropdowns + RPC get_or_create_variant + auto-suffix.
  //   Problem reported by Max: "Trying to add a product. NOTHING HAPPENS
  //   and no error message." The hardcoded dropdowns and the dedup RPC made
  //   the path opaque — if the RPC silently returned a no-op or the toast
  //   wasn't surfacing, the user got no feedback.
  //
  // NEW flow: clone the template into the FULL edit modal with name blank
  //   and let the user fill in the rest. No RPC, no dedup magic — what you
  //   see is what gets saved. Errors surface as toast messages from save().
  //   Max May 23 2026: "all i care about is to clone a family template and
  //   then we just add the description and the remainder of the levels.
  //   Not sure if variant is even viable or makes sense any more."
  function openCloneTemplate(template) {
    if (!template) return;
    if (template.is_family_template !== true) {
      toast.error('Clone only works on Template rows (📋 TEMPLATE badge). Use Copy for regular products.');
      return;
    }
    setModalMode('new');
    setModalProductId(null);
    setEditIsTemplate(false);  // cloning a template produces a Product, not a template
    setEditLocked(false);
    setForm({
      // Name fields BLANK — user types the new product's name
      name_en: '',
      name_ar: '',
      // Quick code blank too — user enters a new unique code
      quick_code: '',
      // Design SKU blank — usually variant-specific
      design_sku: '',
      // Classification: copy every level the template has set.
      // For levels the template DIDN'T set (typically category/construction/
      // backing/pattern on a leather family template), user fills in.
      family_list_id:       template.family_list_id || '',
      category_list_id:     template.category_list_id || '',
      grade_list_id:        template.grade_list_id || '',
      construction_list_id: template.construction_list_id || '',
      backing_list_id:      template.backing_list_id || '',
      color_list_id:        template.color_list_id || '',
      pattern_list_id:      template.pattern_list_id || '',
      spec_class_list_id:   template.spec_class_list_id || '',
      origin_list_id:       template.origin_list_id || '',
      // Defaults inherited from template
      default_uom:                template.default_uom || '',
      default_thickness_mm:       template.default_thickness_mm != null ? String(template.default_thickness_mm) : '',
      default_width_m:            template.default_width_m != null ? String(template.default_width_m) : '',
      default_gsm:                template.default_gsm != null ? String(template.default_gsm) : '',
      default_density:            template.default_density != null ? String(template.default_density) : '',
      default_weight_per_roll:    template.default_weight_per_roll != null ? String(template.default_weight_per_roll) : '',
      default_roll_length_m:      template.default_roll_length_m != null ? String(template.default_roll_length_m) : '',
      default_supplier:           template.default_supplier || '',
      default_cost:               template.default_cost != null ? String(template.default_cost) : '',
      default_currency:           template.default_currency || 'EGP',
      default_rack:               template.default_rack || '',
      notes:                      '',  // notes are per-product, not inherited
    });
    toast.success('Cloned from template "' + (template.name_en || template.quick_code || 'unnamed') + '" — fill in the name and any remaining classification levels, then Save.');
  }

  // v55.83-A.6.27.71 (Phase 4) — Removed openCreateVariant + closeVariantModal +
  // saveVariant helpers along with their modal JSX (see state block above).

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
        {/* v55.83-A.6.27.72 HOTFIX 8 — relabel options to match fixed semantics.
            "Products" now correctly includes both variants AND manually-added products. */}
        <select
          value={typeFilter}
          onChange={function (e) { setTypeFilter(e.target.value); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold"
        >
          <option value="all">All (Products + Template blueprints) — default</option>
          <option value="variants">Products only (actual SKUs, no template blueprints)</option>
          <option value="templates">Template blueprints only (for creating Products)</option>
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
            // v55.83-A.6.27.60 — Light-blue background on template rows so they
            // visually distinguish from real Products. Templates are blueprints
            // (don't hold stock); Products are the actual SKUs that get received
            // and sold.
            var rowBgClass = p.is_family_template === true
              ? 'bg-sky-50 hover:bg-sky-100'
              : 'bg-white hover:bg-slate-50';
            return (
              <div
                key={p.id}
                className={'grid items-center border-t border-slate-200 text-slate-900 transition-colors ' + rowBgClass + ' ' + (p.active ? '' : 'opacity-60')}
                style={{ gridTemplateColumns: '110px 1.5fr 2fr 140px 60px 370px', padding: '12px 12px' }}
              >
                <div className="text-sm font-mono font-extrabold text-slate-900">
                  {/* v55.83-A.6.27.40 — show variant suffix appended if this is a variant */}
                  {p.quick_code ? (
                    <span>
                      {p.quick_code}{p.variant_suffix ? ('-' + p.variant_suffix) : ''}
                    </span>
                  ) : <span className="text-slate-400 italic font-normal">—</span>}
                  {/* v55.83-A.6.27.40 — badges for template vs variant
                      v55.83-A.6.27.55 — "FAMILY" → "TEMPLATE" per Max
                      v55.83-A.6.27.60 — TEMPLATE badge uses stronger sky color to match row */}
                  {p.is_family_template === true && (
                    <div className="text-[9px] bg-sky-200 text-sky-900 font-extrabold rounded px-1.5 inline-block mt-0.5">📋 TEMPLATE</div>
                  )}
                  {p.is_family_template === false && p.variant_suffix && (
                    <div className="text-[9px] bg-emerald-100 text-emerald-800 font-bold rounded px-1 inline-block mt-0.5">PRODUCT</div>
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
                    title="View full history of this Product — inbound shipments, sales, adjustments, stock summary / سجل المنتج"
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
                      onClick={function () { openCloneTemplate(p); }}
                      className="px-2 py-1 text-[10px] bg-purple-600 hover:bg-purple-700 text-white rounded font-extrabold shadow"
                      title="Create an actual Product from this Template blueprint (independent — edits/deletes to template won't affect it)"
                    >
                      + Product
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
              {/* v55.83-A.6.27.60 — Lock banner REMOVED. Edits are always allowed because
                  variants are snapshots — independent of their parent template. */}
              {modalMode === 'edit' && (
                <div className="bg-emerald-100 border-2 border-emerald-500 rounded-lg p-3 mb-4">
                  <div className="text-base font-extrabold text-emerald-900">✏️ All fields editable</div>
                  <div className="text-sm text-emerald-900 mt-1 font-semibold">
                    {editIsTemplate
                      ? 'This is a Template Product (blueprint). Editing or deleting does NOT affect any Products already created from it — they\'re independent snapshots.'
                      : 'This is a Product. Editing changes only this product. Existing inventory/sales attribution stays intact.'}
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
                  {/* v55.83-A.6.27.NEXT (Issue 11, Max May 23 2026): was
                      [1..8].map — dropped Level 9 (Country/origin) from the
                      form even though it's in LEVEL_FIELD_MAP, LEVEL_LABELS,
                      emptyForm, and the row display. Because Country wasn't
                      in the form, two products in the same 8-level classi-
                      fication but different countries collided on the unique
                      classification_slug index, which silently failed the
                      insert with a unique-violation that didn't reach the
                      UI. Now all 9 render. */}
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (lvl) {
                    var opts = optionsForLevel(lvl, form);
                    var fieldName = LEVEL_FIELD_MAP[lvl];
                    var currentValue = form[fieldName];
                    // v55.83-A.6.27.NEXT (Issue 11) — L9 (Country) is optional
                    var isOptional = lvl === 9;
                    return (
                      <label key={lvl} className="text-[11px] font-extrabold text-slate-700">
                        L{lvl} · {LEVEL_LABELS[lvl].en} {isOptional ? <span className="text-[10px] font-semibold text-slate-500">(optional)</span> : '*'}
                        <select
                          value={currentValue}
                          onChange={function (e) { handleLevelChange(lvl, e.target.value); }}
                          disabled={editLocked}
                          className={'w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm ' + (editLocked ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : 'bg-white text-slate-900')}
                        >
                          <option value="">{isOptional ? '— none —' : '— pick ' + LEVEL_LABELS[lvl].en.toLowerCase() + ' —'}</option>
                          {opts.map(function (o) {
                            return <option key={o.id} value={o.id}>{o.code} · {o.label_en} / {o.label_ar}</option>;
                          })}
                        </select>
                        {opts.length === 0 && !isOptional && (
                          <span className="text-[10px] text-amber-700 font-semibold italic">No options yet — add some in Master Lists or pick a different parent level</span>
                        )}
                        {opts.length === 0 && isOptional && (
                          <span className="text-[10px] text-slate-500 italic">No countries set up yet — leave blank or add via Master Lists</span>
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

    </div>
  );
}
