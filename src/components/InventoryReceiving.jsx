'use client';
// v55.83-A.6.27.29 — Inventory Phase 1 Build 4.0: Receive Stock
//
// The everyday warehouse receiving flow. When a shipment arrives, the user
// creates a receipt with one or more product lines. Each product is
// identified by Quick Code (typed) or by browsing the Product Master.
//
// Decisions locked (Max May 18 2026):
//   - Receipt number: RCV-YYYY-MM-DD-NNN (full date + 3-digit daily seq)
//   - View tab: Inventory permission
//   - Create/Edit/Cancel: super_admin OR Edit Inventory
//   - See/Enter cost fields: super_admin OR View Costs (canSeeInventoryCosts)
//   - Multiple lines per receipt: yes, share receipt_number
//   - Cancel = soft delete + grey out
//   - Override pattern: save to receipt; small "Update master" button on
//     supplier/cost/rack with confirm; tech specs just save no popup

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';
import { canSeeInventoryCosts } from '../lib/inventory-permissions';

var UOM_OPTIONS = ['kg','meter','yard','roll','piece','liter','sqm'];
var CURRENCY_OPTIONS = ['EGP','USD','EUR'];

function asNum(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

// Empty line factory
function emptyLine() {
  return {
    product_id: '',
    product: null,        // hydrated product master row when picked
    quickCodeQuery: '',   // what user is typing
    showSuggestions: false,
    quantity: '',
    uom: '',
    actual_thickness_mm: '',
    actual_width_m: '',
    actual_gsm: '',
    actual_density: '',
    actual_weight_per_roll: '',
    actual_roll_length_m: '',
    supplier: '',
    batch_number: '',
    cost_per_uom: '',
    currency: 'EGP',
    rack: '',
    // Track which fields came from master vs user-typed (for visual cue)
    fromMaster: {},
    // Track which fields the user wants to push back to master
    updateMaster: {},
  };
}

export default function InventoryReceiving(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  // Permission gates
  var canView = isSuperAdmin || modulePerms['Inventory'] === true || modulePerms['Edit Inventory'] === true;
  var canEdit = isSuperAdmin || modulePerms['Edit Inventory'] === true;
  var seeCosts = canSeeInventoryCosts(userProfile, modulePerms);

  // Data
  var [receipts, setReceipts] = useState([]);
  var [products, setProducts] = useState([]);
  var [warehouses, setWarehouses] = useState([]);
  var [loading, setLoading] = useState(true);

  // Filters
  var [search, setSearch] = useState('');
  var [filterWarehouse, setFilterWarehouse] = useState('all');
  var [filterStatus, setFilterStatus] = useState('active');
  var [filterFrom, setFilterFrom] = useState('');
  var [filterTo, setFilterTo] = useState('');

  // Modal state for new/edit receipt
  var [modalOpen, setModalOpen] = useState(false);
  var [editingReceiptNumber, setEditingReceiptNumber] = useState(null);
  var [header, setHeader] = useState({
    receipt_date: new Date().toISOString().substring(0, 10),
    warehouse_id: '',
    supplier: '',
    container_number: '',
    notes: '',
  });
  var [lines, setLines] = useState([emptyLine()]);
  var [busy, setBusy] = useState(false);

  // Cancel-receipt prompt
  var [cancelTarget, setCancelTarget] = useState(null);
  var [cancelReason, setCancelReason] = useState('');

  // ── Load reference data ──────────────────────────────────────────
  useEffect(function () {
    if (!canView) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      try {
        var [recRes, prodRes, whRes] = await Promise.all([
          supabase.from('inventory_stock_receipts').select('*').order('created_at', { ascending: false }),
          supabase.from('inventory_products').select('*').eq('active', true),
          supabase.from('inv_warehouses').select('*').order('name'),
        ]);
        if (cancelled) return;
        setReceipts(recRes.data || []);
        setProducts(prodRes.data || []);
        setWarehouses(whRes.data || []);
      } catch (e) {
        console.error('[receiving] load failed:', e);
        toast.error('Failed to load receiving data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [canView]);

  async function reload() {
    try {
      var [recRes, prodRes, whRes] = await Promise.all([
        supabase.from('inventory_stock_receipts').select('*').order('created_at', { ascending: false }),
        supabase.from('inventory_products').select('*').eq('active', true),
        supabase.from('inv_warehouses').select('*').order('name'),
      ]);
      setReceipts(recRes.data || []);
      setProducts(prodRes.data || []);
      setWarehouses(whRes.data || []);
    } catch (e) { console.error('[receiving] reload failed:', e); }
  }

  // Filtered receipt list
  var filteredReceipts = useMemo(function () {
    var list = receipts.slice();
    if (filterStatus !== 'all') list = list.filter(function (r) { return r.status === filterStatus; });
    if (filterWarehouse !== 'all') list = list.filter(function (r) { return r.warehouse_id === filterWarehouse; });
    if (filterFrom) list = list.filter(function (r) { return r.receipt_date >= filterFrom; });
    if (filterTo) list = list.filter(function (r) { return r.receipt_date <= filterTo; });
    if (search.trim()) {
      var q = search.trim().toLowerCase();
      list = list.filter(function (r) {
        var p = products.find(function (x) { return x.id === r.product_id; });
        var name = p ? (p.name_en || '') + ' ' + (p.quick_code || '') : '';
        return (r.receipt_number || '').toLowerCase().indexOf(q) >= 0
          || name.toLowerCase().indexOf(q) >= 0
          || (r.batch_number || '').toLowerCase().indexOf(q) >= 0
          || (r.supplier || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }, [receipts, products, search, filterWarehouse, filterStatus, filterFrom, filterTo]);

  // ── Product helpers ──────────────────────────────────────────────
  function productById(id) { return products.find(function (p) { return p.id === id; }) || null; }
  function warehouseById(id) { return warehouses.find(function (w) { return w.id === id; }) || null; }

  // Autocomplete matches for typed quick code (also matches by name)
  function suggestionsFor(query) {
    if (!query || !query.trim()) return [];
    var q = query.trim().toLowerCase();
    return products.filter(function (p) {
      return p.active && (
        (p.quick_code || '').toLowerCase().indexOf(q) >= 0
        || (p.name_en || '').toLowerCase().indexOf(q) >= 0
        || (p.name_ar || '').indexOf(query.trim()) >= 0
        || (p.classification_slug || '').toLowerCase().indexOf(q) >= 0
      );
    }).slice(0, 10);
  }

  // ── Modal management ─────────────────────────────────────────────
  function openNew() {
    setEditingReceiptNumber(null);
    setHeader({
      receipt_date: new Date().toISOString().substring(0, 10),
      warehouse_id: warehouses[0] ? warehouses[0].id : '',
      supplier: '',
      container_number: '',
      notes: '',
    });
    setLines([emptyLine()]);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingReceiptNumber(null);
    setHeader({
      receipt_date: new Date().toISOString().substring(0, 10),
      warehouse_id: '',
      supplier: '',
      container_number: '',
      notes: '',
    });
    setLines([emptyLine()]);
  }

  // When user picks a product on a line — autofill defaults from master
  function pickProductForLine(lineIdx, product) {
    setLines(function (prev) {
      var next = prev.slice();
      var line = Object.assign({}, next[lineIdx]);
      line.product_id = product.id;
      line.product = product;
      line.quickCodeQuery = product.quick_code || product.name_en;
      line.showSuggestions = false;
      // Autofill defaults (only where line is empty)
      var fromMaster = {};
      if (!line.uom) { line.uom = product.default_uom || ''; if (line.uom) fromMaster.uom = true; }
      if (!line.actual_thickness_mm && product.default_thickness_mm != null) { line.actual_thickness_mm = String(product.default_thickness_mm); fromMaster.actual_thickness_mm = true; }
      if (!line.actual_width_m && product.default_width_m != null) { line.actual_width_m = String(product.default_width_m); fromMaster.actual_width_m = true; }
      if (!line.actual_gsm && product.default_gsm != null) { line.actual_gsm = String(product.default_gsm); fromMaster.actual_gsm = true; }
      if (!line.actual_density && product.default_density != null) { line.actual_density = String(product.default_density); fromMaster.actual_density = true; }
      if (!line.actual_weight_per_roll && product.default_weight_per_roll != null) { line.actual_weight_per_roll = String(product.default_weight_per_roll); fromMaster.actual_weight_per_roll = true; }
      if (!line.actual_roll_length_m && product.default_roll_length_m != null) { line.actual_roll_length_m = String(product.default_roll_length_m); fromMaster.actual_roll_length_m = true; }
      if (!line.supplier) { line.supplier = product.default_supplier || header.supplier || ''; if (line.supplier && product.default_supplier) fromMaster.supplier = true; }
      if (!line.cost_per_uom && product.default_cost != null) { line.cost_per_uom = String(product.default_cost); fromMaster.cost_per_uom = true; }
      if (!line.currency) { line.currency = product.default_currency || 'EGP'; if (product.default_currency) fromMaster.currency = true; }
      if (!line.rack) { line.rack = product.default_rack || ''; if (line.rack && product.default_rack) fromMaster.rack = true; }
      line.fromMaster = fromMaster;
      next[lineIdx] = line;
      return next;
    });
  }

  // Update a single field on a line and mark it as user-overridden if it differs from master default
  function updateLineField(lineIdx, field, value) {
    setLines(function (prev) {
      var next = prev.slice();
      var line = Object.assign({}, next[lineIdx]);
      line[field] = value;
      // If this field came from master and the value is different now, clear the fromMaster flag
      if (line.product && line.fromMaster[field]) {
        var masterMap = {
          uom: line.product.default_uom,
          actual_thickness_mm: line.product.default_thickness_mm,
          actual_width_m: line.product.default_width_m,
          actual_gsm: line.product.default_gsm,
          actual_density: line.product.default_density,
          actual_weight_per_roll: line.product.default_weight_per_roll,
          actual_roll_length_m: line.product.default_roll_length_m,
          supplier: line.product.default_supplier,
          cost_per_uom: line.product.default_cost,
          currency: line.product.default_currency,
          rack: line.product.default_rack,
        };
        var masterVal = masterMap[field];
        if (masterVal != null && String(masterVal) !== String(value)) {
          var newFromMaster = Object.assign({}, line.fromMaster);
          delete newFromMaster[field];
          line.fromMaster = newFromMaster;
        }
      }
      next[lineIdx] = line;
      return next;
    });
  }

  // Toggle "update master" flag for a specific overridden field on a line
  function toggleUpdateMaster(lineIdx, field) {
    setLines(function (prev) {
      var next = prev.slice();
      var line = Object.assign({}, next[lineIdx]);
      var um = Object.assign({}, line.updateMaster);
      if (um[field]) delete um[field];
      else um[field] = true;
      line.updateMaster = um;
      next[lineIdx] = line;
      return next;
    });
  }

  function addLine() {
    var newLine = emptyLine();
    // Inherit supplier from header by default
    newLine.supplier = header.supplier || '';
    setLines(function (prev) { return prev.concat([newLine]); });
  }

  function duplicateLine(lineIdx) {
    setLines(function (prev) {
      var src = prev[lineIdx];
      var copy = Object.assign({}, src, {
        batch_number: '',
        fromMaster: Object.assign({}, src.fromMaster),
        updateMaster: {},
      });
      var next = prev.slice();
      next.splice(lineIdx + 1, 0, copy);
      return next;
    });
  }

  function removeLine(lineIdx) {
    setLines(function (prev) {
      if (prev.length === 1) return prev; // always keep at least one line
      var next = prev.slice();
      next.splice(lineIdx, 1);
      return next;
    });
  }

  // ── Save receipt ─────────────────────────────────────────────────
  async function saveReceipt() {
    // Validate
    if (!header.receipt_date) { alert('Receipt date required'); return; }
    if (!header.warehouse_id) { alert('Warehouse required'); return; }
    var anyValid = false;
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!L.product_id) { alert('Line ' + (i + 1) + ': product not selected. Pick a product or remove the line.'); return; }
      if (!L.quantity || asNum(L.quantity) === null || asNum(L.quantity) <= 0) { alert('Line ' + (i + 1) + ': quantity must be a positive number'); return; }
      if (!L.batch_number || !L.batch_number.trim()) { alert('Line ' + (i + 1) + ': batch number required'); return; }
      anyValid = true;
    }
    if (!anyValid) { alert('At least one valid line required'); return; }

    setBusy(true);
    try {
      // Generate receipt number ONCE — all lines of this shipment share it
      var rnRes = await supabase.rpc('generate_receipt_number', { p_date: header.receipt_date });
      if (rnRes.error) throw rnRes.error;
      var receiptNumber = rnRes.data;

      var masterUpdatesQueued = []; // {product_id, patch}

      // Insert each line
      for (var j = 0; j < lines.length; j++) {
        var L2 = lines[j];
        var qty = asNum(L2.quantity);
        var cost = asNum(L2.cost_per_uom);
        var total = (qty != null && cost != null) ? qty * cost : null;
        var payload = {
          receipt_number: receiptNumber,
          receipt_type: 'new_shipment',
          receipt_date: header.receipt_date,
          status: 'active',
          product_id: L2.product_id,
          quantity: qty,
          uom: L2.uom || null,
          actual_thickness_mm: asNum(L2.actual_thickness_mm),
          actual_width_m: asNum(L2.actual_width_m),
          actual_gsm: asNum(L2.actual_gsm),
          actual_density: asNum(L2.actual_density),
          actual_weight_per_roll: asNum(L2.actual_weight_per_roll),
          actual_roll_length_m: asNum(L2.actual_roll_length_m),
          supplier: (L2.supplier || header.supplier || '').trim() || null,
          batch_number: (L2.batch_number || '').trim(),
          container_number: (header.container_number || '').trim() || null,
          cost_per_uom: cost,
          currency: L2.currency || null,
          total_cost: total,
          warehouse_id: header.warehouse_id,
          rack: (L2.rack || '').trim() || null,
          notes: (header.notes || '').trim() || null,
          created_by: userProfile && userProfile.id,
          updated_by: userProfile && userProfile.id,
        };
        await dbInsert('inventory_stock_receipts', payload, userProfile && userProfile.id);

        // Queue any master updates the user requested
        if (L2.product_id && L2.updateMaster) {
          var patch = {};
          var fieldMap = {
            supplier: { master: 'default_supplier', val: payload.supplier },
            cost_per_uom: { master: 'default_cost', val: payload.cost_per_uom },
            rack: { master: 'default_rack', val: payload.rack },
          };
          Object.keys(L2.updateMaster).forEach(function (k) {
            if (fieldMap[k]) patch[fieldMap[k].master] = fieldMap[k].val;
          });
          if (Object.keys(patch).length) {
            masterUpdatesQueued.push({ product_id: L2.product_id, patch: patch });
          }
        }
      }

      // Apply any master updates
      for (var k2 = 0; k2 < masterUpdatesQueued.length; k2++) {
        var mu = masterUpdatesQueued[k2];
        await dbUpdate('inventory_products', mu.product_id, mu.patch, userProfile && userProfile.id);
      }

      toast.success('Receipt ' + receiptNumber + ' saved — ' + lines.length + ' line(s)' + (masterUpdatesQueued.length ? '. Updated ' + masterUpdatesQueued.length + ' master record(s).' : ''));
      await reload();
      closeModal();
    } catch (err) {
      console.error('[receiving] save failed:', err);
      toast.error('Save failed: ' + ((err && err.message) || String(err)));
      alert('Save failed: ' + ((err && err.message) || String(err)) + '\n\nIf this is the first time you\'re using Receive Stock, make sure the v55.83-A.6.27.29 SQL migration has been run in Supabase.');
    } finally {
      setBusy(false);
    }
  }

  // ── Cancel / restore ─────────────────────────────────────────────
  async function confirmCancelReceipt() {
    if (!cancelTarget) return;
    if (!cancelReason || !cancelReason.trim()) { alert('Cancellation reason required'); return; }
    try {
      // Cancel ALL lines sharing the same receipt_number
      var rn = cancelTarget.receipt_number;
      var rows = receipts.filter(function (r) { return r.receipt_number === rn && r.status === 'active'; });
      for (var i = 0; i < rows.length; i++) {
        await dbUpdate('inventory_stock_receipts', rows[i].id, {
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: userProfile && userProfile.id,
          cancel_reason: cancelReason.trim(),
          updated_by: userProfile && userProfile.id,
        }, userProfile && userProfile.id);
      }
      toast.success('Receipt ' + rn + ' cancelled (' + rows.length + ' line(s)).');
      setCancelTarget(null);
      setCancelReason('');
      await reload();
    } catch (err) {
      console.error('[receiving] cancel failed:', err);
      toast.error('Cancel failed: ' + ((err && err.message) || String(err)));
    }
  }

  async function restoreReceipt(receipt) {
    if (!confirm('Restore receipt ' + receipt.receipt_number + '? This brings the stock back into the active inventory.')) return;
    try {
      var rn = receipt.receipt_number;
      var rows = receipts.filter(function (r) { return r.receipt_number === rn && r.status === 'cancelled'; });
      for (var i = 0; i < rows.length; i++) {
        await dbUpdate('inventory_stock_receipts', rows[i].id, {
          status: 'active',
          cancelled_at: null,
          cancelled_by: null,
          cancel_reason: null,
          updated_by: userProfile && userProfile.id,
        }, userProfile && userProfile.id);
      }
      toast.success('Receipt ' + rn + ' restored.');
      await reload();
    } catch (err) {
      console.error('[receiving] restore failed:', err);
      toast.error('Restore failed: ' + ((err && err.message) || String(err)));
    }
  }

  // ── Render ───────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div style={{ padding: 24 }}>
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
          <div className="text-base font-extrabold text-amber-900">🔒 Access restricted</div>
          <div className="text-sm text-amber-800 mt-1 font-medium">
            Viewing stock receipts requires the Inventory permission.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 24 }} className="text-slate-600 font-medium">Loading receiving data...</div>;
  }

  // Group receipts by receipt_number for the list display (so multi-line shipments show as one row)
  var groupedReceipts = {};
  filteredReceipts.forEach(function (r) {
    if (!groupedReceipts[r.receipt_number]) groupedReceipts[r.receipt_number] = [];
    groupedReceipts[r.receipt_number].push(r);
  });
  var grouped = Object.keys(groupedReceipts).map(function (rn) {
    var rows = groupedReceipts[rn];
    return {
      receipt_number: rn,
      receipt_date: rows[0].receipt_date,
      status: rows[0].status,
      receipt_type: rows[0].receipt_type,
      warehouse_id: rows[0].warehouse_id,
      supplier: rows[0].supplier,
      lines: rows,
      lineCount: rows.length,
      totalQty: rows.reduce(function (a, b) { return a + Number(b.quantity || 0); }, 0),
      totalCost: rows.reduce(function (a, b) { return a + Number(b.total_cost || 0); }, 0),
    };
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200" style={{ padding: 20 }}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 24 }}>🚚</span>
          <h2 className="text-xl font-extrabold text-slate-900">Receive Stock</h2>
        </div>
        <div className="text-sm text-slate-700 font-medium mt-1">
          Record incoming shipments. Each receipt can have multiple product lines. Auto-fills from Product Master defaults.
        </div>
        <div className="text-sm text-slate-700 font-medium" style={{ direction: 'rtl' }}>
          سجّل الشحنات الواردة. كل إيصال يمكن أن يحتوي على عدة منتجات. يُعبأ تلقائياً من القيم الافتراضية للمنتج.
        </div>
      </div>

      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="Search receipt#, product, batch, supplier..."
          value={search}
          onChange={function (e) { setSearch(e.target.value); }}
          className="flex-1 min-w-[260px] px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
        />
        <select
          value={filterWarehouse}
          onChange={function (e) { setFilterWarehouse(e.target.value); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold"
        >
          <option value="all">All warehouses</option>
          {warehouses.map(function (w) {
            return <option key={w.id} value={w.id}>{w.name}</option>;
          })}
        </select>
        <select
          value={filterStatus}
          onChange={function (e) { setFilterStatus(e.target.value); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-semibold"
        >
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={filterFrom} onChange={function (e) { setFilterFrom(e.target.value); }} className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
        <input type="date" value={filterTo} onChange={function (e) { setFilterTo(e.target.value); }} className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
        {canEdit && (
          <button
            onClick={openNew}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-lg"
          >
            + New Receipt
          </button>
        )}
      </div>

      {/* Receipts list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="grid bg-slate-100 text-[10px] font-extrabold text-slate-700 tracking-wider uppercase"
             style={{ gridTemplateColumns: '170px 100px 90px 1fr 110px 130px ' + (seeCosts ? '130px ' : '') + '110px', padding: '8px 12px' }}>
          <div>Receipt #</div>
          <div>Date</div>
          <div>Type</div>
          <div>Products</div>
          <div>Total Qty</div>
          <div>Warehouse</div>
          {seeCosts && <div>Total Cost</div>}
          <div className="text-right">Actions</div>
        </div>
        {grouped.length === 0 ? (
          <div className="text-center text-slate-500 italic text-sm py-8">
            {search || filterWarehouse !== 'all' || filterFrom || filterTo
              ? 'No receipts match your filters'
              : 'No receipts yet — click "+ New Receipt" to record one'}
          </div>
        ) : (
          grouped.map(function (g) {
            var wh = warehouseById(g.warehouse_id);
            var isCancelled = g.status === 'cancelled';
            var rowClass = 'grid items-center border-t border-slate-100 ' +
              (isCancelled ? 'bg-slate-100 opacity-60' : '');
            var typeBadge = g.receipt_type === 'legacy_import' ? 'bg-purple-100 text-purple-900' :
                            g.receipt_type === 'adjustment' ? 'bg-amber-100 text-amber-900' :
                            'bg-emerald-100 text-emerald-900';
            return (
              <div key={g.receipt_number} className={rowClass}
                   style={{ gridTemplateColumns: '170px 100px 90px 1fr 110px 130px ' + (seeCosts ? '130px ' : '') + '110px', padding: '12px 12px' }}>
                <div className={'text-sm font-mono font-extrabold ' + (isCancelled ? 'text-slate-500 line-through' : 'text-slate-900')}>{g.receipt_number}</div>
                <div className={'text-sm font-semibold ' + (isCancelled ? 'text-slate-500 line-through' : 'text-slate-900')}>{g.receipt_date}</div>
                <div>
                  <span className={'text-[10px] px-1.5 py-0.5 rounded font-extrabold ' + (isCancelled ? 'bg-slate-200 text-slate-600' : typeBadge)}>
                    {g.receipt_type === 'legacy_import' ? 'Legacy' : g.receipt_type === 'adjustment' ? 'Adjust' : 'New'}
                  </span>
                </div>
                <div className={'text-sm ' + (isCancelled ? 'text-slate-500 line-through' : 'text-slate-900')}>
                  {g.lines.slice(0, 2).map(function (ln) {
                    var p = productById(ln.product_id);
                    return p ? (p.quick_code || p.name_en || '?') : '?';
                  }).join(', ')}
                  {g.lineCount > 2 && <span className="text-slate-500 italic ml-1">+ {g.lineCount - 2} more</span>}
                  <div className="text-[10px] text-slate-600">{g.lineCount} line{g.lineCount === 1 ? '' : 's'}{g.supplier ? ' · ' + g.supplier : ''}</div>
                </div>
                <div className={'text-sm font-extrabold ' + (isCancelled ? 'text-slate-500 line-through' : 'text-slate-900')}>{g.totalQty.toLocaleString()}</div>
                <div className={'text-sm ' + (isCancelled ? 'text-slate-500 line-through' : 'text-slate-700 font-semibold')}>{wh ? wh.name : <span className="italic text-slate-400">—</span>}</div>
                {seeCosts && (
                  <div className={'text-sm font-mono font-extrabold ' + (isCancelled ? 'text-slate-500 line-through' : 'text-slate-900')}>
                    {g.totalCost > 0 ? g.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 }) : <span className="italic text-slate-400 font-normal">—</span>}
                  </div>
                )}
                <div className="text-right flex justify-end gap-1">
                  {canEdit && !isCancelled && (
                    <button
                      onClick={function () { setCancelTarget(g); setCancelReason(''); }}
                      className="px-2 py-1 text-[10px] bg-red-100 hover:bg-red-200 text-red-900 rounded font-bold"
                      title="Cancel this receipt (greys out, doesn't count toward stock)"
                    >
                      Cancel
                    </button>
                  )}
                  {canEdit && isCancelled && (
                    <button
                      onClick={function () { restoreReceipt(g); }}
                      className="px-2 py-1 text-[10px] bg-emerald-100 hover:bg-emerald-200 text-emerald-900 rounded font-bold"
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="text-[10px] text-slate-500 mt-2 italic">
        {grouped.length} receipt{grouped.length === 1 ? '' : 's'} shown. Cancelled receipts stay in the database but don't count toward stock-on-hand.
      </div>

      {/* New receipt modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm overflow-y-auto"
          onClick={closeModal}
          style={{ padding: 16 }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl mx-auto"
            onClick={function (e) { e.stopPropagation(); }}
            style={{ maxWidth: 1100 }}
          >
            {/* Modal header */}
            <div
              className="rounded-t-2xl flex justify-between items-center gap-2"
              style={{ background: '#3730a3', padding: '14px 20px' }}
            >
              <div>
                <div className="text-lg font-extrabold" style={{ color: '#ffffff' }}>🚚 New Stock Receipt</div>
                <div className="text-xs font-semibold" style={{ color: '#e0e7ff' }}>
                  One shipment can contain multiple product lines. Receipt # auto-generated on save.
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

            <div style={{ padding: 20, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
              {/* Header section */}
              <div className="mb-4 bg-slate-50 rounded-lg p-3 border border-slate-200">
                <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">SHIPMENT INFO (applies to all lines)</div>
                <div className="grid grid-cols-4 gap-2">
                  <label className="text-[11px] font-extrabold text-slate-700">Receipt Date *
                    <input type="date" value={header.receipt_date} onChange={function (e) { setHeader(Object.assign({}, header, { receipt_date: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Warehouse *
                    <select value={header.warehouse_id} onChange={function (e) { setHeader(Object.assign({}, header, { warehouse_id: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white">
                      <option value="">— pick warehouse —</option>
                      {warehouses.map(function (w) {
                        return <option key={w.id} value={w.id}>{w.name}</option>;
                      })}
                    </select>
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Default Supplier
                    <input type="text" value={header.supplier} onChange={function (e) { setHeader(Object.assign({}, header, { supplier: e.target.value })); }} placeholder="e.g. ABC Suppliers" className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-700">Container #
                    <input type="text" value={header.container_number} onChange={function (e) { setHeader(Object.assign({}, header, { container_number: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                  </label>
                </div>
                <label className="text-[11px] font-extrabold text-slate-700 block mt-2">Shipment Notes
                  <textarea value={header.notes} onChange={function (e) { setHeader(Object.assign({}, header, { notes: e.target.value })); }} rows={1} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white resize-none" />
                </label>
              </div>

              {/* Lines */}
              <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">PRODUCT LINES ({lines.length})</div>

              {lines.map(function (line, lineIdx) {
                var suggestions = suggestionsFor(line.quickCodeQuery);
                return (
                  <div key={lineIdx} className="bg-white border-2 border-indigo-200 rounded-lg p-3 mb-3">
                    <div className="flex justify-between items-center mb-2">
                      <div className="text-xs font-extrabold text-indigo-900">Line {lineIdx + 1}{line.product ? ': ' + (line.product.name_en || line.product.quick_code) : ''}</div>
                      <div className="flex gap-1">
                        {lines.length > 1 && (
                          <button onClick={function () { removeLine(lineIdx); }} className="px-2 py-1 text-[10px] bg-red-100 hover:bg-red-200 text-red-900 rounded font-bold">Remove</button>
                        )}
                        <button onClick={function () { duplicateLine(lineIdx); }} className="px-2 py-1 text-[10px] bg-blue-100 hover:bg-blue-200 text-blue-900 rounded font-bold">Duplicate</button>
                      </div>
                    </div>

                    {/* Quick-code field with autocomplete */}
                    <div className="mb-2 relative">
                      <label className="text-[11px] font-extrabold text-slate-700 block">Quick code or product name *
                        <input
                          type="text"
                          value={line.quickCodeQuery}
                          onChange={function (e) {
                            var v = e.target.value;
                            setLines(function (prev) {
                              var next = prev.slice();
                              next[lineIdx] = Object.assign({}, next[lineIdx], { quickCodeQuery: v, showSuggestions: true });
                              return next;
                            });
                          }}
                          onFocus={function () {
                            setLines(function (prev) {
                              var next = prev.slice();
                              next[lineIdx] = Object.assign({}, next[lineIdx], { showSuggestions: true });
                              return next;
                            });
                          }}
                          placeholder="Type e.g. NM-204 or 'mosaic dark blue'..."
                          className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm font-mono bg-white"
                        />
                      </label>
                      {line.showSuggestions && suggestions.length > 0 && (
                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border-2 border-indigo-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                          {suggestions.map(function (s) {
                            return (
                              <button
                                key={s.id}
                                onClick={function () { pickProductForLine(lineIdx, s); }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 border-b border-slate-100 last:border-0"
                              >
                                <div className="font-mono font-extrabold text-slate-900">{s.quick_code || '(no code)'}</div>
                                <div className="text-slate-700">{s.name_en} / <span style={{ direction: 'rtl' }}>{s.name_ar}</span></div>
                                <div className="text-[10px] text-slate-500 font-mono">{s.classification_slug}</div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {line.product && (
                      <>
                        {/* Product header (read-only) */}
                        <div className="bg-indigo-50 border border-indigo-200 rounded px-2 py-1.5 mb-2 text-[11px]">
                          <div className="font-extrabold text-indigo-900">{line.product.name_en} / <span style={{ direction: 'rtl' }}>{line.product.name_ar}</span></div>
                          <div className="font-mono text-indigo-700">Classification: {line.product.classification_slug}</div>
                        </div>

                        {/* Quantity + UOM + batch (required) */}
                        <div className="grid grid-cols-4 gap-2 mb-2">
                          <label className="text-[11px] font-extrabold text-slate-700">Quantity *
                            <input type="text" value={line.quantity} onChange={function (e) { updateLineField(lineIdx, 'quantity', e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                          </label>
                          <label className="text-[11px] font-extrabold text-slate-700">UOM
                            <select value={line.uom} onChange={function (e) { updateLineField(lineIdx, 'uom', e.target.value); }} className={'w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm ' + (line.fromMaster.uom ? 'bg-blue-50' : 'bg-white')}>
                              <option value="">—</option>
                              {UOM_OPTIONS.map(function (u) { return <option key={u} value={u}>{u}</option>; })}
                            </select>
                          </label>
                          <label className="text-[11px] font-extrabold text-slate-700">Batch # *
                            <input type="text" value={line.batch_number} onChange={function (e) { updateLineField(lineIdx, 'batch_number', e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" />
                          </label>
                          <label className="text-[11px] font-extrabold text-slate-700">Rack
                            <input type="text" value={line.rack} onChange={function (e) { updateLineField(lineIdx, 'rack', e.target.value); }} className={'w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm ' + (line.fromMaster.rack ? 'bg-blue-50' : 'bg-white')} />
                            {line.product && !line.fromMaster.rack && line.product.default_rack && line.rack && line.rack !== line.product.default_rack && (
                              <button onClick={function () { toggleUpdateMaster(lineIdx, 'rack'); }} className={'mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-bold ' + (line.updateMaster.rack ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-100 text-amber-900 hover:bg-amber-200')}>
                                📌 {line.updateMaster.rack ? 'Will update master' : 'Update master?'}
                              </button>
                            )}
                          </label>
                        </div>

                        {/* Tech specs (overrides on receipt only — no popup) */}
                        <div className="bg-slate-50 border border-slate-200 rounded p-2 mb-2">
                          <div className="text-[10px] font-extrabold text-slate-600 tracking-wider mb-1">TECH SPECS (per-roll overrides — saved on receipt only)</div>
                          <div className="grid grid-cols-6 gap-2">
                            <label className="text-[11px] font-extrabold text-slate-700">Thickness (mm)
                              <input type="text" value={line.actual_thickness_mm} onChange={function (e) { updateLineField(lineIdx, 'actual_thickness_mm', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-sm ' + (line.fromMaster.actual_thickness_mm ? 'bg-blue-50' : 'bg-white')} />
                            </label>
                            <label className="text-[11px] font-extrabold text-slate-700">Width (m)
                              <input type="text" value={line.actual_width_m} onChange={function (e) { updateLineField(lineIdx, 'actual_width_m', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-sm ' + (line.fromMaster.actual_width_m ? 'bg-blue-50' : 'bg-white')} />
                            </label>
                            <label className="text-[11px] font-extrabold text-slate-700">GSM
                              <input type="text" value={line.actual_gsm} onChange={function (e) { updateLineField(lineIdx, 'actual_gsm', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-sm ' + (line.fromMaster.actual_gsm ? 'bg-blue-50' : 'bg-white')} />
                            </label>
                            <label className="text-[11px] font-extrabold text-slate-700">Density
                              <input type="text" value={line.actual_density} onChange={function (e) { updateLineField(lineIdx, 'actual_density', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-sm ' + (line.fromMaster.actual_density ? 'bg-blue-50' : 'bg-white')} />
                            </label>
                            <label className="text-[11px] font-extrabold text-slate-700">Weight/roll
                              <input type="text" value={line.actual_weight_per_roll} onChange={function (e) { updateLineField(lineIdx, 'actual_weight_per_roll', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-sm ' + (line.fromMaster.actual_weight_per_roll ? 'bg-blue-50' : 'bg-white')} />
                            </label>
                            <label className="text-[11px] font-extrabold text-slate-700">Roll length (m)
                              <input type="text" value={line.actual_roll_length_m} onChange={function (e) { updateLineField(lineIdx, 'actual_roll_length_m', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-sm ' + (line.fromMaster.actual_roll_length_m ? 'bg-blue-50' : 'bg-white')} />
                            </label>
                          </div>
                        </div>

                        {/* Sourcing + cost (cost gated by seeCosts) */}
                        <div className="bg-slate-50 border border-slate-200 rounded p-2">
                          <div className="text-[10px] font-extrabold text-slate-600 tracking-wider mb-1">
                            SOURCING{seeCosts ? ' + COST' : ''} (master defaults can be updated via 📌 button)
                          </div>
                          <div className={'grid gap-2 ' + (seeCosts ? 'grid-cols-3' : 'grid-cols-1')}>
                            <label className="text-[11px] font-extrabold text-slate-700">Supplier
                              <input type="text" value={line.supplier} onChange={function (e) { updateLineField(lineIdx, 'supplier', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-sm ' + (line.fromMaster.supplier ? 'bg-blue-50' : 'bg-white')} />
                              {line.product && !line.fromMaster.supplier && line.product.default_supplier && line.supplier && line.supplier !== line.product.default_supplier && (
                                <button onClick={function () { toggleUpdateMaster(lineIdx, 'supplier'); }} className={'mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-bold ' + (line.updateMaster.supplier ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-100 text-amber-900 hover:bg-amber-200')}>
                                  📌 {line.updateMaster.supplier ? 'Will update master' : 'Update master?'}
                                </button>
                              )}
                            </label>
                            {seeCosts && (
                              <label className="text-[11px] font-extrabold text-slate-700">Cost per UOM
                                <input type="text" value={line.cost_per_uom} onChange={function (e) { updateLineField(lineIdx, 'cost_per_uom', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-sm font-mono ' + (line.fromMaster.cost_per_uom ? 'bg-blue-50' : 'bg-white')} />
                                {line.product && !line.fromMaster.cost_per_uom && line.product.default_cost != null && line.cost_per_uom && Number(line.cost_per_uom) !== Number(line.product.default_cost) && (
                                  <button onClick={function () { toggleUpdateMaster(lineIdx, 'cost_per_uom'); }} className={'mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-bold ' + (line.updateMaster.cost_per_uom ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-100 text-amber-900 hover:bg-amber-200')}>
                                    📌 {line.updateMaster.cost_per_uom ? 'Will update master' : 'Update master?'}
                                  </button>
                                )}
                              </label>
                            )}
                            {seeCosts && (
                              <label className="text-[11px] font-extrabold text-slate-700">Currency
                                <select value={line.currency} onChange={function (e) { updateLineField(lineIdx, 'currency', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-sm ' + (line.fromMaster.currency ? 'bg-blue-50' : 'bg-white')}>
                                  {CURRENCY_OPTIONS.map(function (c) { return <option key={c} value={c}>{c}</option>; })}
                                </select>
                              </label>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 italic mt-1">Light blue background = inherited from product master · White = manually entered</div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              <button onClick={addLine} className="w-full px-4 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-sm font-extrabold rounded-lg border-2 border-dashed border-emerald-400">
                + Add another product line
              </button>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl" style={{ padding: '12px 20px' }}>
              <button onClick={closeModal} disabled={busy} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 disabled:opacity-50 text-slate-900 text-sm font-bold rounded-lg">
                Cancel
              </button>
              <button onClick={saveReceipt} disabled={busy} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg shadow">
                {busy ? 'Saving...' : '✓ Save Receipt (' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + ')'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel-receipt prompt */}
      {cancelTarget && (
        <div className="fixed inset-0 z-[210] bg-black/70 flex items-center justify-center" style={{ padding: 16 }}>
          <div className="bg-white rounded-xl shadow-2xl" style={{ maxWidth: 480, padding: 20 }}>
            <div className="text-base font-extrabold text-red-900 mb-2">Cancel receipt {cancelTarget.receipt_number}?</div>
            <div className="text-sm text-slate-700 mb-3">
              This soft-cancels all {cancelTarget.lineCount} line(s) of this shipment. The records stay in the database (greyed out) but stop counting toward stock-on-hand. You can restore later if it was a mistake.
            </div>
            <label className="text-[11px] font-extrabold text-slate-700 block">Reason *
              <textarea value={cancelReason} onChange={function (e) { setCancelReason(e.target.value); }} rows={2} placeholder="Why is this being cancelled?" className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white resize-none" />
            </label>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={function () { setCancelTarget(null); setCancelReason(''); }} className="px-3 py-1.5 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded-lg">Keep it</button>
              <button onClick={confirmCancelReceipt} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-extrabold rounded-lg">Confirm Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
