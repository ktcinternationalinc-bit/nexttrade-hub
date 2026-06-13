'use client';
// v55.83-A.6.27.29 — Inventory Phase 1 Build 4.0: Inbound Shipments
//
// The everyday warehouse receiving flow. When a shipment arrives, the user
// creates a receipt with one or more product lines. Each product is
// identified by Quick Code (typed) or by browsing the Product List.
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
import { supabase, dbInsert, dbUpdate, dbDelete } from '../lib/supabase';
import { canSeeInventoryCosts } from '../lib/inventory-permissions';
import InventoryFinalizeCostDialog from './InventoryFinalizeCostDialog';
import { parseNexpac, NEXPAC_DEFAULTS } from '../lib/nexpac-parse';
import { mergePlan } from '../lib/shipment-merge';

var NEXPAC_PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var NEXPAC_PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

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
    line_uid: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10), // v55.83-DP — stable client id for autosave dedup
    product_id: '',
    product: null,        // hydrated product master row when picked
    quickCodeQuery: '',   // what user is typing
    showSuggestions: false,
    // v55.83-A.6.27.35 — EXPECTED totals (Phase 1 data — what supplier said they shipped)
    expected_rolls: '',
    expected_gross_kg: '',
    expected_net_kg: '',
    expected_uom_total: '',
    // v55.83-A.6.27.32 — ordered_quantity is what the supplier said they
    // shipped; quantity (below) is what actually arrived. If they differ,
    // variance_reason becomes required.
    ordered_quantity: '',
    quantity: '',
    variance_reason: '',
    variance_acknowledged: false,
    uom: '',
    // v55.83-A.6.27.32 — quantity in kg + roll_count from old Shipments form
    quantity_kg: '',
    roll_count: '',
    actual_thickness_mm: '',
    actual_width_m: '',
    actual_gsm: '',
    actual_density: '',
    actual_weight_per_roll: '',
    actual_roll_length_m: '',
    supplier: '',
    batch_number: '',
    cost_per_uom: '',
    // v55.83-A.6.27.35 — per-line currency default USD (was EGP)
    currency: 'USD',
    rack: '',
    // v55.83-A.6.27.32 — per-line notes (separate from shipment-level notes)
    line_notes: '',
    // Track which fields came from master vs user-typed (for visual cue)
    fromMaster: {},
    // Track which fields the user wants to push back to master
    updateMaster: {},
    // v55.83-A.6.27.35 — Phase 2 roll detail rows (loaded for existing receipts)
    rolls: [],
    // v55.83-A.6.27.35 — tracks if this is editing an existing receipt row
    existing_id: null,
    // v55.83-A.6.27.39 — Variant specs (mandatory when product is a family template)
    //   When operator picks a family template, these 4 are required before save.
    //   On save, the system calls get_or_create_variant() to either reuse an
    //   existing variant or create a new one with the next sequential suffix.
    variant_category_code: '',     // SM / EM
    variant_construction_code: '', // RG / PF / FN / FP / TL
    variant_backing_code: '',      // BK / CT / FL / GR / GS / NW / OT
    variant_pattern_code: '',      // NA / HC / MG / RG
    // After save, the picker shows the resolved variant info:
    resolved_variant_id: '',       // the actual product_id used in the receipt insert
    resolved_variant_suffix: '',   // -001, -002, etc.
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
  // v55.83-A.6.27.37 — shipment headers (shell shipments before product lines added)
  var [headers, setHeaders] = useState([]);
  var [products, setProducts] = useState([]);
  var [warehouses, setWarehouses] = useState([]);
  // v55.83-A.6.27.49 — classification lists, used to enrich the product search
  // (so typing "headliner" or "leather" or "BMW" matches by readable category names).
  var [lists, setLists] = useState([]);
  var [loading, setLoading] = useState(true);

  // Filters
  var [search, setSearch] = useState('');
  var [filterWarehouse, setFilterWarehouse] = useState('all');
  var [filterStatus, setFilterStatus] = useState('all');
  var [filterFrom, setFilterFrom] = useState('');
  var [filterTo, setFilterTo] = useState('');

  // Modal state for new/edit receipt
  var [modalOpen, setModalOpen] = useState(false);
  var [editingReceiptNumber, setEditingReceiptNumber] = useState(null);
  var [autosaveStatus, setAutosaveStatus] = useState(''); // v55.83-DO — per-line autosave indicator
  // v55.83-A.6.27.56 — collapsible Shipment Info section. Default expanded.
  // Auto-collapses after Save Draft (so user can focus on product lines).
  var [headerCollapsed, setHeaderCollapsed] = useState(false);
  var [header, setHeader] = useState({
    receipt_date: new Date().toISOString().substring(0, 10),
    warehouse_id: '',
    supplier: '',
    container_number: '',
    notes: '',
    // v55.83-A.6.27.32 — new header fields from old Shipments form
    shipment_reference: '',
    freight_forwarder: '',
    shipping_line: '',
    eta_date: '',
    arrival_date: '',
    purchase_currency: 'USD',
    origin_country_code: 'US',
    // v55.83-A.6.27.43 — Shipment-level expected totals (supplier docs / "what they said is in the container").
    // Required at Submit time (not at Save Draft). Drives reconciliation against per-line actuals.
    expected_total_rolls: '',
    expected_total_gross_kg: '',
    expected_total_net_kg: '',
    expected_total_uom: '',
    expected_uom_type: 'kg',   // kg | meter | yard | piece | sqm
    variance_notes: '',
  });
  var [lines, setLines] = useState([emptyLine()]);
  var [busy, setBusy] = useState(false);

  // ---- NEXPAC report import: reads the PDF and auto-fills the expected totals ----
  var [nexpacReady, setNexpacReady] = useState(false);
  var [nexpacBusy, setNexpacBusy] = useState(false);
  var [nexpacPreview, setNexpacPreview] = useState(null);
  var [nexpacErr, setNexpacErr] = useState('');
  useEffect(function () {
    if (typeof window === 'undefined') return;
    if (window.pdfjsLib) { setNexpacReady(true); return; }
    var ex = document.querySelector('script[data-pdfjs]');
    if (ex) { ex.addEventListener('load', function () { setNexpacReady(true); }); return; }
    var el = document.createElement('script');
    el.src = NEXPAC_PDFJS_SRC; el.setAttribute('data-pdfjs', '1');
    el.onload = function () { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = NEXPAC_PDFJS_WORKER; } catch (e) {} setNexpacReady(true); };
    el.onerror = function () { setNexpacErr('Could not load the PDF reader — check the connection.'); };
    document.body.appendChild(el);
  }, []);
  async function handleNexpacImport(file) {
    if (!file) return;
    setNexpacErr(''); setNexpacBusy(true);
    try {
      if (!window.pdfjsLib) throw new Error('PDF reader not ready yet — try again in a second.');
      var buf = await file.arrayBuffer();
      var doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      var items = [];
      var p, k;
      for (p = 1; p <= doc.numPages; p++) {
        var page = await doc.getPage(p);
        var tc = await page.getTextContent();
        for (k = 0; k < tc.items.length; k++) {
          var it = tc.items[k];
          if (it.str && it.str.trim()) items.push({ x: it.transform[4], y: it.transform[5], page: p, str: it.str });
        }
      }
      var parsed = parseNexpac(items, { rollTareFactor: NEXPAC_DEFAULTS.rollTareFactor });
      if (!parsed.orderRows.length) throw new Error("Couldn't find order rows — is this a NEXPAC report PDF?");
      var hd = parsed.header;
      var netKg = hd.netBillableKgs != null ? hd.netBillableKgs : parsed.totals.finalNetWeightKg;
      var grossKg = hd.scaleGrossKgs || parsed.totals.grossWeightKg;
      setHeader(function (prev) {
        var patch = Object.assign({}, prev);
        // Container / Shipment Reference: fill only if you haven't typed one (don't clobber).
        if (!prev.container_number) patch.container_number = hd.containerNumber || '';
        if (!prev.shipment_reference) patch.shipment_reference = hd.releaseNumber || hd.containerNumber || '';
        // Rolls / Gross kg / Net kg: ALWAYS overwrite from the report (Max, Jun 6 2026).
        // (Only skipped if the report itself has no value — so a good report never wipes a box.)
        var rolls = hd.totalRolls || parsed.totals.totalRolls;
        if (rolls != null && rolls !== '' && !isNaN(Number(rolls))) patch.expected_total_rolls = String(rolls);
        if (grossKg) patch.expected_total_gross_kg = Number(grossKg).toFixed(3);
        if (netKg) patch.expected_total_net_kg = Number(netKg).toFixed(3);
        // UOM: default to kg and the net billable total — editable afterwards (Max, Jun 7 2026).
        patch.expected_uom_type = 'kg';
        if (netKg) patch.expected_total_uom = Number(netKg).toFixed(3);
        return patch;
      });
      setNexpacPreview(parsed);
    } catch (e) {
      setNexpacErr('Import failed: ' + (e.message || e));
    }
    setNexpacBusy(false);
  }
  // v55.83-A.6.27.43 — Variance prompt modal (shown on Submit click when variance exists)
  var [variancePromptOpen, setVariancePromptOpen] = useState(false);
  var [variancePromptData, setVariancePromptData] = useState(null);  // { rolls, gross, net, uom }
  // v55.83-BO — reconciliation panel collapsed by default to give back screen space;
  // auto-expands on Submit / Save Draft (see those handlers).
  var [varExpanded, setVarExpanded] = useState(false);
  // v55.83-BP (A2) — per-line collapse. Keyed by line index; collapsed lines hide
  // their body and show a one-line summary in the header. Default expanded.
  var [collapsedLines, setCollapsedLines] = useState({});
  function toggleLineCollapsed(i) {
    setCollapsedLines(function (p) {
      var n = Object.assign({}, p);
      var collapsingNow = !n[i]; // true when we are about to collapse this line
      n[i] = !n[i];
      // v55.83-DO — Autosave the working draft when a product line is collapsed.
      // Only fires when there is something safe to save: the line has a product and
      // the header has the two fields a draft save requires (so no alert pops).
      if (collapsingNow) {
        var L = lines[i];
        var canDraft = L && L.product_id && header.warehouse_id && header.shipment_reference && String(header.shipment_reference).trim();
        if (canDraft) {
          setAutosaveStatus('Saving…');
          Promise.resolve().then(function () { return saveReceipt({ autosave: true }); }).catch(function () { setAutosaveStatus(''); });
        }
      }
      return n;
    });
  }
  // v55.83-BR (B5) — product search hides family templates by default to prevent
  // picking a template instead of a real product. Admins can opt in.
  var [includeTemplates, setIncludeTemplates] = useState(false);
  // v55.83-BS (B4) — let the Container Shell collapse to a one-line summary so the
  // product-entry area can take most of the screen. Default expanded.
  var [shellCollapsed, setShellCollapsed] = useState(false);

  // Cancel-receipt prompt
  var [cancelTarget, setCancelTarget] = useState(null);
  var [cancelReason, setCancelReason] = useState('');

  // v55.83-CR — Merge shipments
  var [mergeSel, setMergeSel] = useState({});            // { receipt_number: true }
  var [mergeShell, setMergeShell] = useState({ shipment_reference: '', receipt_date: '', supplier: '', warehouse_id: '', container_number: '', notes: '' });
  function initMergeShell(sel) {
    var fh = headers.find(function (h) { return sel.indexOf(h.receipt_number) >= 0; }) || {};
    var fl = receipts.find(function (r) { return sel.indexOf(r.receipt_number) >= 0; }) || {};
    setMergeShell({
      shipment_reference: '',
      receipt_date: fh.receipt_date || fl.receipt_date || new Date().toISOString().slice(0, 10),
      supplier: fh.supplier || fl.supplier || '',
      warehouse_id: fh.warehouse_id || fl.warehouse_id || (warehouses[0] ? warehouses[0].id : ''),
      container_number: fh.container_number || '',
      notes: ''
    });
  }
  var [showMerged, setShowMerged] = useState(false);     // reveal merged source shipments
  var [mergeModalOpen, setMergeModalOpen] = useState(false);
  var [mergeTarget, setMergeTarget] = useState('new');   // 'new' | existing receipt_number
  var [mergeNotes, setMergeNotes] = useState('');
  var [mergeConfirmText, setMergeConfirmText] = useState('');
  var [mergeBusy, setMergeBusy] = useState(false);
  // v55.83-CT — 4-step accordion: which step is expanded (0 = all collapsed) + submit-attempt flag
  var [openStep, setOpenStep] = useState(1);
  var [submitAttempted, setSubmitAttempted] = useState(false);
  // v55.83-CU — View Merge Audit modal
  var [mergeAuditGroup, setMergeAuditGroup] = useState(null);
  var [mergeAuditRows, setMergeAuditRows] = useState([]);
  var [mergeAuditBusy, setMergeAuditBusy] = useState(false);
  var [previewExpanded, setPreviewExpanded] = useState({});
  function togglePreviewRow(i) { setPreviewExpanded(function (p) { var n = Object.assign({}, p); n[i] = !n[i]; return n; }); }
  // v55.83-DA — Unmerge (reverse a merge)
  var [unmergeTarget, setUnmergeTarget] = useState(null); // the grouped row being unmerged
  var [unmergeConfirmText, setUnmergeConfirmText] = useState('');
  var [unmergeNotes, setUnmergeNotes] = useState('');
  var [unmergeBusy, setUnmergeBusy] = useState(false);
  var [unmergeData, setUnmergeData] = useState({ loading: false, error: null, groupId: null, srcLines: [], targetLines: [], diag: null });
  function mergeGroupOf(g) { var grp = null; (g.lines || []).forEach(function (l) { if (l.merge_group_id && l.merged_source_breakdown) { grp = l.merge_group_id; } }); return grp; }
  function isMergeTarget(g) { return !!mergeGroupOf(g); }
  function isUnmergedTarget(g) { var hdrUn = g.header && g.header.unmerged_at; var allRev = g.lines && g.lines.length > 0 && g.lines.every(function (l) { return l.status === 'reversed'; }); return !!(hdrUn || allRev); }
  // Load the source + target lines for a merge. Tries every place the source data can live,
  // in order, so a merge tagged differently by an older build can still be recovered:
  //   1) source lines tagged merge_group_id + status=merged (DD path)
  //   2) source lines whose ids are listed in the target lines' merged_source_breakdown
  //   3) source lines whose ids are in the inventory_shipment_merges audit row
  //   4) source lines tagged merged_into_shipment_id = target receipt number
  // If none resolve to real rows, block with a copyable diagnostic.
  async function loadUnmergeData(g) {
    var targetRn = g.receipt_number;
    setUnmergeData({ loading: true, error: null, groupId: null, srcLines: [], targetLines: [], diag: null });
    try {
      // Target aggregated lines — by receipt_number (robust; does not depend on the capped in-memory list)
      var tgtRes = await supabase.from('inventory_stock_receipts').select('*').eq('receipt_number', targetRn);
      var targetLines = ((tgtRes && tgtRes.data) || []).filter(function (r) { return r.status !== 'reversed'; });
      var groupId = null;
      targetLines.forEach(function (t) { if (t.merge_group_id) { groupId = t.merge_group_id; } });
      if (!groupId) { groupId = mergeGroupOf(g); }

      // Candidate source line ids from the breakdown on the target lines
      var breakdownIds = [];
      var breakdownCount = 0;
      targetLines.forEach(function (t) { (t.merged_source_breakdown || []).forEach(function (sb) { breakdownCount++; if (sb.line_id != null) { breakdownIds.push(sb.line_id); } }); });

      // Audit row (by group or by target receipt number)
      var auditRow = null;
      try {
        var aq = supabase.from('inventory_shipment_merges').select('*');
        if (groupId) { aq = aq.or('merge_group_id.eq.' + groupId + ',target_receipt_number.eq.' + targetRn); } else { aq = aq.eq('target_receipt_number', targetRn); }
        var aRes = await aq.order('created_at', { ascending: false }).limit(1);
        if (aRes && aRes.data && aRes.data.length) { auditRow = aRes.data[0]; }
      } catch (eA) { console.error('[unmerge] audit lookup', eA); }
      var auditIds = (auditRow && auditRow.source_line_ids) || [];

      // Fallback chain to find the actual source rows
      var srcLines = [];
      var via = null;
      if (groupId) {
        var r1 = await supabase.from('inventory_stock_receipts').select('*').eq('merge_group_id', groupId).eq('status', 'merged');
        if (r1 && r1.data && r1.data.length) { srcLines = r1.data; via = 'merge_group_id+status'; }
      }
      if (srcLines.length === 0 && breakdownIds.length) {
        var r2 = await supabase.from('inventory_stock_receipts').select('*').in('id', breakdownIds);
        if (r2 && r2.data && r2.data.length) { srcLines = r2.data; via = 'merged_source_breakdown ids'; }
      }
      if (srcLines.length === 0 && auditIds.length) {
        var r3 = await supabase.from('inventory_stock_receipts').select('*').in('id', auditIds);
        if (r3 && r3.data && r3.data.length) { srcLines = r3.data; via = 'audit source_line_ids'; }
      }
      if (srcLines.length === 0) {
        var r4 = await supabase.from('inventory_stock_receipts').select('*').eq('merged_into_shipment_id', targetRn);
        if (r4 && r4.data && r4.data.length) { srcLines = r4.data; via = 'merged_into_shipment_id'; }
      }
      // never include the target's own aggregated lines as "sources"
      srcLines = srcLines.filter(function (r) { return r.receipt_number !== targetRn; });

      var diag = {
        target_receipt_number: targetRn,
        merge_group_id: groupId || null,
        target_line_count: targetLines.length,
        source_line_count: srcLines.length,
        source_found_via: via,
        audit_row_found: !!auditRow,
        breakdown_found: breakdownCount > 0,
        breakdown_id_count: breakdownIds.length,
        audit_source_id_count: auditIds.length
      };

      var err = null;
      if (srcLines.length === 0) {
        err = 'Unmerge blocked because source lines cannot be found for merge group ' + (groupId || '(unknown)') + '. Checked: merged_source_breakdown (' + breakdownIds.length + ' ids), inventory_shipment_merges.source_line_ids (' + auditIds.length + ' ids), and source lines tagged merged_into_shipment_id=' + targetRn + '. The original source rows may have been deleted. Use Copy Diagnostics and send it over so we can recover safely — do not force anything.';
      }
      setUnmergeData({ loading: false, error: err, groupId: groupId, srcLines: srcLines, targetLines: targetLines, diag: diag });
    } catch (e) {
      console.error('[unmerge] load source data failed', e);
      setUnmergeData({ loading: false, error: 'Could not load merge source data: ' + ((e && e.message) || 'unknown'), groupId: null, srcLines: [], targetLines: [], diag: null });
    }
  }
  async function executeUnmerge(g) {
    var targetRn = g.receipt_number;
    var groupId = unmergeData.groupId || mergeGroupOf(g);
    var srcLines = unmergeData.srcLines || [];
    var targetLines = unmergeData.targetLines || [];
    if (srcLines.length === 0) { toast.error('No source shipment lines were found for this merge — cannot restore anything. Unmerge blocked.'); return; }
    var anyFinal = targetLines.some(function (r) { return r.status === 'finalized'; });
    if (anyFinal && unmergeConfirmText.trim() !== 'UNMERGE SHIPMENT') { toast.error('This merged shipment is finalized/costed — type UNMERGE SHIPMENT to confirm.'); return; }
    var uid = userProfile && userProfile.id;
    // Original per-line status preserved in each target line's merged_source_breakdown
    var origStatus = {};
    targetLines.forEach(function (tl) { (tl.merged_source_breakdown || []).forEach(function (sb) { if (sb.line_id) { origStatus[sb.line_id] = sb.status || 'received'; } }); });
    setUnmergeBusy(true);
    try {
      for (var i = 0; i < srcLines.length; i++) {
        var sl = srcLines[i];
        var uRestore = await supabase.from('inventory_stock_receipts').update({ status: origStatus[sl.id] || 'received', merged_into_shipment_id: null, merge_group_id: null, updated_by: uid }).eq('id', sl.id);
        if (uRestore && uRestore.error) { throw new Error('Could not restore source line ' + sl.id + ': ' + uRestore.error.message); }
      }
      var rnSet = {};
      srcLines.forEach(function (sl) { var rn = sl.source_receipt_number || sl.receipt_number; if (rn && rn !== targetRn) { rnSet[rn] = true; } });
      var rns = Object.keys(rnSet);
      for (var h = 0; h < rns.length; h++) {
        await supabase.from('inventory_shipment_headers').update({ merged_into_shipment_id: null, merged_at: null, merged_by: null, merge_group_id: null }).eq('receipt_number', rns[h]);
      }
      var reversedIds = [];
      for (var t = 0; t < targetLines.length; t++) {
        var uRev = await supabase.from('inventory_stock_receipts').update({ status: 'reversed', updated_by: uid }).eq('id', targetLines[t].id);
        if (uRev && uRev.error) { throw new Error('Could not reverse target line ' + targetLines[t].id + ': ' + uRev.error.message); }
        reversedIds.push(targetLines[t].id);
      }
      await supabase.from('inventory_shipment_headers').update({ unmerged_at: new Date().toISOString(), unmerged_by: uid, unmerge_notes: unmergeNotes || null }).eq('receipt_number', targetRn);
      await dbInsert('inventory_shipment_unmerges', {
        original_merge_group_id: groupId, unmerge_type: 'full_shipment', target_receipt_number: targetRn,
        restored_source_receipt_numbers: rns, restored_source_line_ids: srcLines.map(function (x) { return x.id; }),
        reversed_target_line_ids: reversedIds,
        totals_before_unmerge: { target_lines: targetLines.length },
        totals_after_unmerge: { restored_source_lines: srcLines.length, restored_shipments: rns.length },
        unmerged_by: uid, notes: unmergeNotes || null
      }, uid);
      toast.success('Unmerged — ' + rns.length + ' source shipment(s) restored to the list.');
      setUnmergeTarget(null); setUnmergeConfirmText(''); setUnmergeNotes('');
      setUnmergeData({ loading: false, error: null, groupId: null, srcLines: [], targetLines: [] });
      load();
    } catch (e) { console.error('[unmerge] failed', e); toast.error('Unmerge failed: ' + ((e && e.message) || 'unknown — check console')); }
    setUnmergeBusy(false);
  }
  async function openMergeAudit(groupId) {
    if (!groupId) { return; }
    setMergeAuditGroup(groupId); setMergeAuditRows([]); setMergeAuditBusy(true);
    try {
      var res = await supabase.from('inventory_shipment_merges').select('*').eq('merge_group_id', groupId).order('created_at', { ascending: false });
      if (res.error) { console.error('[merge-audit]', res.error); toast.error('Could not load merge audit: ' + res.error.message); }
      setMergeAuditRows((res && res.data) || []);
    } catch (e) { console.error('[merge-audit]', e); toast.error('Could not load merge audit.'); }
    setMergeAuditBusy(false);
  }
  function toggleMergeSel(rn) { setMergeSel(function (p) { var n = Object.assign({}, p); if (n[rn]) { delete n[rn]; } else { n[rn] = true; } return n; }); }
  function isMergedSource(g) { var hdrMerged = g.header && g.header.merged_into_shipment_id; var allMerged = g.lines && g.lines.length > 0 && g.lines.every(function (l) { return l.status === 'merged'; }); return !!(hdrMerged || allMerged); }
  function selectedNumbers() { return Object.keys(mergeSel).filter(function (k) { return mergeSel[k]; }); }
  function mergeSourceLines() { var sel = selectedNumbers(); return receipts.filter(function (r) { return sel.indexOf(r.receipt_number) >= 0 && r.status !== 'cancelled' && r.status !== 'merged'; }); }
  function mergeSourceHeaders() { var sel = selectedNumbers(); return headers.filter(function (h) { return sel.indexOf(h.receipt_number) >= 0; }); }
  function mergeAnyFinalized() { return mergeSourceLines().some(function (r) { return r.status === 'finalized'; }) || mergeSourceHeaders().some(function (h) { return h.status === 'finalized'; }); }
  async function executeMerge() {
    var sel = selectedNumbers();
    if (sel.length < 2) { toast.error('Select at least 2 shipments to merge.'); return; }
    var srcLines = mergeSourceLines();
    var srcHeaders = mergeSourceHeaders();
    if (mergeAnyFinalized() && mergeConfirmText.trim() !== 'MERGE FINALIZED SHIPMENTS') { toast.error('Type MERGE FINALIZED SHIPMENTS to confirm merging finalized shipments.'); return; }
    var plan = mergePlan(srcLines, srcHeaders);
    var uid = userProfile && userProfile.id;
    var targetRn = mergeTarget === 'new' ? ('MERGE-' + Date.now()) : mergeTarget;
    var groupId = 'mg-' + Date.now();
    var base = srcLines[0] || {};
    var useShell = mergeTarget === 'new';
    var shellSupplier = useShell ? (mergeShell.supplier || base.supplier || null) : (base.supplier || null);
    var shellWh = useShell ? (mergeShell.warehouse_id || base.warehouse_id || null) : (base.warehouse_id || null);
    var shellDate = useShell ? (mergeShell.receipt_date || base.receipt_date || new Date().toISOString().slice(0, 10)) : (base.receipt_date || new Date().toISOString().slice(0, 10));
    setMergeBusy(true);
    try {
      var targetLineIds = [];
      for (var i = 0; i < plan.aggregated.length; i++) {
        var g = plan.aggregated[i];
        var ins = await dbInsert('inventory_stock_receipts', {
          receipt_number: targetRn, product_id: g.product_id, uom: g.uom,
          quantity: g.quantity, quantity_kg: g.quantity_kg, roll_count: g.roll_count,
          status: 'received', receipt_date: shellDate,
          warehouse_id: shellWh, supplier: shellSupplier,
          merge_group_id: groupId, merged_source_breakdown: g.sources
        }, uid);
        if (ins && ins.id) { targetLineIds.push(ins.id); }
      }
      if (mergeTarget === 'new') {
        await dbInsert('inventory_shipment_headers', {
          receipt_number: targetRn, supplier: shellSupplier, status: 'received', merge_group_id: groupId,
          shipment_reference: mergeShell.shipment_reference || null, warehouse_id: shellWh, receipt_date: shellDate,
          container_number: mergeShell.container_number || null, notes: mergeShell.notes || null,
          expected_total_rolls: plan.header_totals.expected_total_rolls || null,
          expected_total_gross_kg: plan.header_totals.expected_total_gross_kg || null,
          expected_total_net_kg: plan.header_totals.expected_total_net_kg || null
        }, uid);
      } else {
        await supabase.from('inventory_shipment_headers').update({ merge_group_id: groupId,
          expected_total_rolls: plan.header_totals.expected_total_rolls || null,
          expected_total_gross_kg: plan.header_totals.expected_total_gross_kg || null,
          expected_total_net_kg: plan.header_totals.expected_total_net_kg || null }).eq('receipt_number', targetRn);
      }
      // Mark every original source line merged (incl. the target's own originals, which were aggregated in)
      for (var s2 = 0; s2 < srcLines.length; s2++) {
        var uMerge = await supabase.from('inventory_stock_receipts').update({ status: 'merged', merged_into_shipment_id: targetRn, merge_group_id: groupId, source_receipt_number: srcLines[s2].receipt_number, source_line_id: srcLines[s2].id, updated_by: uid }).eq('id', srcLines[s2].id);
        if (uMerge && uMerge.error) { throw new Error('Could not tag source line as merged (schema/status issue?): ' + uMerge.error.message); }
      }
      // Mark source shipment shells merged (not the target)
      for (var h = 0; h < sel.length; h++) {
        if (sel[h] === targetRn) { continue; }
        await supabase.from('inventory_shipment_headers').update({ merged_into_shipment_id: targetRn, merge_group_id: groupId, merged_at: new Date().toISOString(), merged_by: uid, merge_notes: mergeNotes || null }).eq('receipt_number', sel[h]);
      }
      await dbInsert('inventory_shipment_merges', {
        merge_group_id: groupId, target_receipt_number: targetRn, source_receipt_numbers: sel,
        source_line_ids: srcLines.map(function (r) { return r.id; }), target_line_ids: targetLineIds,
        totals_before: plan.totals_before, totals_after: plan.totals_after, merged_by: uid, merge_notes: mergeNotes || null
      }, uid);
      toast.success('Merged ' + sel.length + ' shipments into ' + targetRn);
      setMergeModalOpen(false); setMergeSel({}); setMergeConfirmText(''); setMergeNotes('');
      load();
    } catch (e) { console.error('[merge] failed:', e); toast.error('Merge failed: ' + ((e && e.message) || 'unknown — check console')); }
    setMergeBusy(false);
  }

  // v55.83-A.6.27.33 — Finalize Cost dialog target
  var [finalizeTarget, setFinalizeTarget] = useState(null);

  // ── Load reference data ──────────────────────────────────────────
  useEffect(function () {
    if (!canView) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      try {
        var [recRes, prodRes, whRes, hdrRes, lstRes] = await Promise.all([
          supabase.from('inventory_stock_receipts').select('*').order('created_at', { ascending: false }),
          supabase.from('inventory_products').select('*').eq('active', true),
          supabase.from('inv_warehouses').select('*').order('name'),
          supabase.from('inventory_shipment_headers').select('*').order('created_at', { ascending: false }),
          supabase.from('inventory_lists').select('id, level, code, label_en, label_ar').eq('active', true),
        ]);
        if (cancelled) return;
        setReceipts(recRes.data || []);
        setProducts(prodRes.data || []);
        setWarehouses(whRes.data || []);
        setHeaders(hdrRes.data || []);
        setLists(lstRes.data || []);
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
      var [recRes, prodRes, whRes, hdrRes, lstRes] = await Promise.all([
        supabase.from('inventory_stock_receipts').select('*').order('created_at', { ascending: false }),
        supabase.from('inventory_products').select('*').eq('active', true),
        supabase.from('inv_warehouses').select('*').order('name'),
        supabase.from('inventory_shipment_headers').select('*').order('created_at', { ascending: false }),
        supabase.from('inventory_lists').select('id, level, code, label_en, label_ar').eq('active', true),
      ]);
      setReceipts(recRes.data || []);
      setProducts(prodRes.data || []);
      setWarehouses(whRes.data || []);
      setHeaders(hdrRes.data || []);
      setLists(lstRes.data || []);
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
  function listLabel(id) { if (!id) { return ''; } var l = lists.find(function (x) { return x.id === id; }); return l ? (l.label_en || l.code || '') : ''; }
  function productClassSummary(p) {
    if (!p) { return ''; }
    var parts = [];
    if (p.family_list_id) { parts.push('F: ' + listLabel(p.family_list_id)); }
    if (p.category_list_id) { parts.push('Cat: ' + listLabel(p.category_list_id)); }
    if (p.grade_list_id) { parts.push('Gr: ' + listLabel(p.grade_list_id)); }
    if (p.construction_list_id) { parts.push('Co: ' + listLabel(p.construction_list_id)); }
    if (p.backing_list_id) { parts.push('B: ' + listLabel(p.backing_list_id)); }
    if (p.color_list_id) { parts.push('Cl: ' + listLabel(p.color_list_id)); }
    if (p.pattern_list_id) { parts.push('P: ' + listLabel(p.pattern_list_id)); }
    if (p.spec_class_list_id) { parts.push('Sp: ' + listLabel(p.spec_class_list_id)); }
    if (p.origin_list_id) { parts.push('Or: ' + listLabel(p.origin_list_id)); }
    return parts.join(' | ');
  }
  function shipmentRef(rn) { var h = headers.find(function (x) { return x.receipt_number === rn; }); return h ? (h.shipment_reference || h.release_number || h.container_number || '') : ''; }
  function warehouseById(id) { return warehouses.find(function (w) { return w.id === id; }) || null; }

  // Autocomplete matches for typed quick code (also matches by name)
  function suggestionsFor(query) {
    if (!query || !query.trim()) return [];
    // v55.83-A.6.27.39 — Smart multi-keyword search.
    // v55.83-A.6.27.49 — EXPANDED searchable surface so the user can find a product
    // by ANY meaningful word in any order: design_sku, classification names
    // (family/category/grade/construction/backing/color/pattern/spec — both English
    // AND Arabic labels), variant_suffix, supplier, origin, and notes. This is
    // the "AI-smart" search the user asked for — it's exact-keyword matching after
    // normalization, but the matched surface is wide enough that natural words like
    // "headliner brown leather BMW" all hit the right product.
    var keywords = query.trim().toLowerCase().split(/\s+/).filter(function (k) { return k.length > 0; });
    if (keywords.length === 0) return [];

    // Build a quick lookup from list_id → "code label_en label_ar" string.
    var listsById = {};
    lists.forEach(function (l) {
      listsById[l.id] = ((l.code || '') + ' ' + (l.label_en || '') + ' ' + (l.label_ar || '')).toLowerCase();
    });
    function classText(p) {
      // Concatenate every level's classification text (whatever's set)
      var parts = [];
      var idFields = [
        'family_list_id', 'category_list_id', 'grade_list_id', 'construction_list_id',
        'backing_list_id', 'color_list_id', 'pattern_list_id', 'spec_class_list_id',
        // v55.83-A.6.27.40+ — origin classification (some installs use this)
        'origin_list_id',
      ];
      for (var i = 0; i < idFields.length; i++) {
        var lid = p[idFields[i]];
        if (lid && listsById[lid]) parts.push(listsById[lid]);
      }
      return parts.join(' ');
    }

    var matches = products.filter(function (p) {
      if (!p.active) return false;
      // B5: hide family templates (and archived) from the picker by default.
      if (p.is_family_template === true && !includeTemplates) return false;
      if ((p.is_archived === true || p.status === 'archived') && !includeTemplates) return false;
      // Build the expanded searchable string for this product
      var searchable = (
        (p.quick_code || '') + ' ' +
        (p.variant_suffix ? p.quick_code + '-' + p.variant_suffix + ' ' : '') +
        (p.design_sku || '') + ' ' +
        (p.name_en || '') + ' ' +
        (p.name_ar || '') + ' ' +
        (p.classification_slug || '') + ' ' +
        (p.default_supplier || '') + ' ' +
        (p.notes || '') + ' ' +
        classText(p)
      ).toLowerCase();
      // Every keyword must appear somewhere in the searchable string (any order)
      for (var i = 0; i < keywords.length; i++) {
        if (searchable.indexOf(keywords[i]) < 0) return false;
      }
      return true;
    });
    matches.sort(function (a, b) {
      // featured DESC
      if ((b.featured === true ? 1 : 0) !== (a.featured === true ? 1 : 0)) {
        return (b.featured === true ? 1 : 0) - (a.featured === true ? 1 : 0);
      }
      // use_count DESC
      var au = Number(a.use_count || 0);
      var bu = Number(b.use_count || 0);
      if (bu !== au) return bu - au;
      // name ASC
      return (a.name_en || '').localeCompare(b.name_en || '');
    });
    return matches.slice(0, 20);
  }

  // ── Modal management ─────────────────────────────────────────────
  function openNew() {
    setEditingReceiptNumber(null);
    setAutosaveStatus('');
    setHeader({
      receipt_date: new Date().toISOString().substring(0, 10),
      warehouse_id: warehouses[0] ? warehouses[0].id : '',
      supplier: '',
      container_number: '',
      notes: '',
      shipment_reference: '',
      freight_forwarder: '',
      shipping_line: '',
      eta_date: '',
      arrival_date: '',
      purchase_currency: 'USD',
    origin_country_code: 'US',
      expected_total_rolls: '', expected_total_gross_kg: '', expected_total_net_kg: '',
      expected_total_uom: '', expected_uom_type: 'kg',
    });
    setLines([emptyLine()]);
    setNexpacPreview(null);
    setNexpacErr(null);
    setHeaderCollapsed(false);  // v55.83-A.6.27.56 — always start with header expanded
    setOpenStep(0);            // v55.83-CT.2 — all 4 steps collapsed by default on NEW
    setSubmitAttempted(false); // no required-field warnings until a submit attempt
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingReceiptNumber(null);
    setAutosaveStatus('');
    setHeader({
      receipt_date: new Date().toISOString().substring(0, 10),
      warehouse_id: '',
      supplier: '',
      container_number: '',
      notes: '',
      shipment_reference: '',
      freight_forwarder: '',
      shipping_line: '',
      eta_date: '',
      arrival_date: '',
      purchase_currency: 'USD',
    origin_country_code: 'US',
      expected_total_rolls: '', expected_total_gross_kg: '', expected_total_net_kg: '',
      expected_total_uom: '', expected_uom_type: 'kg',
    });
    setLines([emptyLine()]);
    setNexpacPreview(null);
    setNexpacErr(null);
  }

  // v55.83-A.6.27.35 — Open an existing receipt for editing (all lines + rolls)
  async function openEdit(grouped) {
    if (!canEdit) { alert('Edit Inventory permission required'); return; }
    if (grouped.status === 'cancelled') {
      alert('Cannot edit a cancelled receipt. Restore it first.');
      return;
    }
    if (grouped.status === 'finalized') {
      alert('Cannot edit a finalized receipt directly. Use "Reopen" to reverse the cost layer first, then edit.');
      return;
    }
    setBusy(true);
    try {
      // v55.83-A.6.27.37 — Header-only shell: open with empty line, load header data from grouped.header
      if (grouped.isHeaderOnly && grouped.header) {
        var h = grouped.header;
        setEditingReceiptNumber(grouped.receipt_number);
        setAutosaveStatus('');
        setHeader({
          receipt_date: h.receipt_date || '',
          warehouse_id: h.warehouse_id || '',
          supplier: h.supplier || '',
          container_number: h.container_number || '',
          notes: h.notes || '',
          shipment_reference: h.shipment_reference || '',
          freight_forwarder: h.freight_forwarder || '',
          shipping_line: h.shipping_line || '',
          eta_date: h.eta_date || '',
          arrival_date: h.arrival_date || '',
          purchase_currency: h.purchase_currency || 'USD',
          origin_country_code: h.origin_country_code || 'US',
          expected_total_rolls: h.expected_total_rolls != null ? String(h.expected_total_rolls) : '',
          expected_total_gross_kg: h.expected_total_gross_kg != null ? String(h.expected_total_gross_kg) : '',
          expected_total_net_kg: h.expected_total_net_kg != null ? String(h.expected_total_net_kg) : '',
          expected_total_uom: h.expected_total_uom != null ? String(h.expected_total_uom) : '',
          expected_uom_type: h.expected_uom_type || 'kg',
        });
        setLines([emptyLine()]);
        setNexpacPreview((h && h.nexpac_breakdown) || null);
        setNexpacErr(null);
        setHeaderCollapsed(false);
        setSubmitAttempted(false);
        setOpenStep(grouped.status === 'submitted_unbalanced' ? 3 : 0); // collapsed unless variance issue
        setModalOpen(true);
        setBusy(false);
        return;
      }

      var rows = grouped.lines || [];
      var first = rows[0];
      setEditingReceiptNumber(grouped.receipt_number);
        setAutosaveStatus('');
      setHeader({
        receipt_date: first.receipt_date || '',
        warehouse_id: first.warehouse_id || '',
        supplier: first.supplier || '',
        container_number: first.container_number || '',
        notes: first.notes || '',
        shipment_reference: first.shipment_reference || '',
        freight_forwarder: first.freight_forwarder || '',
        shipping_line: first.shipping_line || '',
        eta_date: first.eta_date || '',
        arrival_date: first.arrival_date || '',
        purchase_currency: first.purchase_currency || 'USD',
        origin_country_code: first.origin_country_code || 'US',
      });

      // Fetch rolls for all line ids in parallel
      var ids = rows.map(function (r) { return r.id; });
      var rollsRes = ids.length
        ? await supabase.from('inventory_receipt_rolls').select('*').in('receipt_id', ids).order('roll_sequence')
        : { data: [] };
      var rollsByReceipt = {};
      (rollsRes.data || []).forEach(function (r) {
        if (!rollsByReceipt[r.receipt_id]) rollsByReceipt[r.receipt_id] = [];
        rollsByReceipt[r.receipt_id].push(r);
      });

      var loadedLines = rows.map(function (r) {
        var L = emptyLine();
        L.existing_id = r.id;
        L.line_uid = r.line_uid || L.line_uid; // v55.83-DP — keep stable id; emptyLine() seeded one for legacy rows
        L.product_id = r.product_id;
        L.product = productById(r.product_id) || null;
        L.quickCodeQuery = L.product ? (L.product.quick_code || L.product.name_en) : '';
        L.expected_rolls = r.expected_rolls != null ? String(r.expected_rolls) : '';
        L.expected_gross_kg = r.expected_gross_kg != null ? String(r.expected_gross_kg) : '';
        L.expected_net_kg = r.expected_net_kg != null ? String(r.expected_net_kg) : '';
        L.expected_uom_total = r.expected_uom_total != null ? String(r.expected_uom_total) : '';
        L.ordered_quantity = r.ordered_quantity != null ? String(r.ordered_quantity) : '';
        L.quantity = r.quantity != null && r.status !== 'pending_detail' ? String(r.quantity) : '';
        L.variance_reason = r.variance_reason || '';
        L.variance_acknowledged = r.variance_acknowledged === true;
        L.uom = r.uom || '';
        L.quantity_kg = r.quantity_kg != null ? String(r.quantity_kg) : '';
        L.roll_count = r.roll_count != null ? String(r.roll_count) : '';
        L.actual_thickness_mm = r.actual_thickness_mm != null ? String(r.actual_thickness_mm) : '';
        L.actual_width_m = r.actual_width_m != null ? String(r.actual_width_m) : '';
        L.actual_gsm = r.actual_gsm != null ? String(r.actual_gsm) : '';
        L.actual_density = r.actual_density != null ? String(r.actual_density) : '';
        L.actual_weight_per_roll = r.actual_weight_per_roll != null ? String(r.actual_weight_per_roll) : '';
        L.actual_roll_length_m = r.actual_roll_length_m != null ? String(r.actual_roll_length_m) : '';
        L.supplier = r.supplier || '';
        L.batch_number = r.batch_number || '';
        L.cost_per_uom = r.cost_per_uom != null ? String(r.cost_per_uom) : '';
        L.currency = r.currency || 'USD';
        L.rack = r.rack || '';
        L.line_notes = r.line_notes || '';
        L.merged_source_breakdown = r.merged_source_breakdown || null;
        L.merge_group_id = r.merge_group_id || null;
        L.rolls = (rollsByReceipt[r.id] || []).map(function (rl) {
          return {
            existing_id: rl.id,
            roll_number: rl.roll_number || '',
            gross_kg: rl.gross_kg != null ? String(rl.gross_kg) : '',
            net_kg: rl.net_kg != null ? String(rl.net_kg) : '',
            meters: rl.meters != null ? String(rl.meters) : '',
            rack: rl.rack || '',
            notes: rl.notes || '',
          };
        });
        return L;
      });

      setLines(loadedLines.length ? loadedLines : [emptyLine()]);
      setSubmitAttempted(false);
      setOpenStep(grouped.status === 'submitted_unbalanced' ? 3 : 0); // v55.83-CT.2 — collapsed unless variance
      // When opening an EXISTING shipment, default every already-entered product
      // line (and the container shell) to collapsed so the screen opens clean.
      var _collapseAll = {};
      loadedLines.forEach(function (_, i) { _collapseAll[i] = true; });
      setCollapsedLines(_collapseAll);
      setShellCollapsed(loadedLines.length > 0);
      var hdrBd = await supabase.from('inventory_shipment_headers').select('expected_total_rolls, expected_total_gross_kg, expected_total_net_kg, expected_total_uom, expected_uom_type, nexpac_breakdown').eq('receipt_number', grouped.receipt_number).maybeSingle();
      var hRow = (hdrBd && hdrBd.data) || {};
      setHeader(function (prev) {
        return Object.assign({}, prev, {
          expected_total_rolls: hRow.expected_total_rolls != null ? String(hRow.expected_total_rolls) : '',
          expected_total_gross_kg: hRow.expected_total_gross_kg != null ? String(hRow.expected_total_gross_kg) : '',
          expected_total_net_kg: hRow.expected_total_net_kg != null ? String(hRow.expected_total_net_kg) : '',
          expected_total_uom: hRow.expected_total_uom != null ? String(hRow.expected_total_uom) : '',
          expected_uom_type: hRow.expected_uom_type || 'kg',
        });
      });
      setNexpacPreview(hRow.nexpac_breakdown || null);
      setNexpacErr(null);
      setHeaderCollapsed(false);
      setModalOpen(true);
    } catch (err) {
      console.error('[receiving] openEdit failed:', err);
      toast.error('Failed to load receipt for editing: ' + ((err && err.message) || String(err)));
    } finally {
      setBusy(false);
    }
  }

  // v55.83-A.6.27.35 — Reopen a finalized receipt (super_admin only)
  // Calls the reopen_finalized_receipt SQL function which reverses the FIFO layer
  // and flips status back to 'received'. Re-finalization later creates a new layer.
  async function reopenReceipt(grouped) {
    if (!isSuperAdmin && !canEdit) {
      alert('Editing a finalized shipment requires Edit Inventory permission.');
      return;
    }
    if (grouped.status !== 'finalized') {
      alert('Receipt is not in Finalized state. Status: ' + grouped.status);
      return;
    }
    // v55.83-W — reopening reverses the cost layer. If stock was already sold,
    // only a super-admin may proceed (COGS on those sales will need restatement).
    var ddR = await shipmentDrawdown(grouped);
    if (!ddR.error && ddR.consumedQty > 0 && !isSuperAdmin) {
      alert('Cannot reopen ' + grouped.receipt_number + ': ' + ddR.consumedQty.toLocaleString() + ' unit(s) already sold from this shipment. Reversing would restate COGS on those sales — only a super-admin can do this.');
      return;
    }
    var soldWarn = (!ddR.error && ddR.consumedQty > 0) ? ('\n\nWARNING: ' + ddR.consumedQty.toLocaleString() + ' unit(s) already sold — those sales will need COGS restatement.') : '';
    var reason = window.prompt('Reopening "' + grouped.receipt_number + '" will REVERSE its cost layer so you can edit it, then you re-finalize.' + soldWarn + '\n\nEnter a reason for reopening:');
    if (!reason || !reason.trim()) { alert('Reason required.'); return; }
    if (!window.confirm('Confirm reopen of ' + grouped.receipt_number + '?\n\nThis creates a reversal movement, marks the cost layer as reversed, and changes status back to "Received" so you can edit and re-finalize.\n\nReason: ' + reason.trim())) return;

    setBusy(true);
    try {
      // The reopen function processes the FIRST line of the receipt by default.
      // For multi-line receipts, iterate.
      for (var i = 0; i < (grouped.lines || []).length; i++) {
        var lineRow = grouped.lines[i];
        if (lineRow.status === 'finalized') {
          var res = await supabase.rpc('reopen_finalized_receipt', {
            p_receipt_id: lineRow.id,
            p_user_id: userProfile && userProfile.id,
            p_reason: reason.trim(),
          });
          if (res.error) throw res.error;
        }
      }
      toast.success('Receipt ' + grouped.receipt_number + ' reopened. Cost layer reversed. You can edit and re-finalize.');
      await reload();
    } catch (err) {
      console.error('[receiving] reopen failed:', err);
      toast.error('Reopen failed: ' + ((err && err.message) || String(err)));
      alert('Reopen failed: ' + ((err && err.message) || String(err)) + '\n\nMost likely the v55.83-A.6.27.35 SQL migration was not run. Run it in Supabase.');
    } finally {
      setBusy(false);
    }
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
      // v55.83-BP (B6): when UoM is kg, auto-fill Quantity in Kilos from Quantity
      // Received. Stays EDITABLE (not read-only) — a manual override is preserved and
      // only re-mirrored if the kg field is still in sync with the received qty.
      var uomNow = String(line.uom || '').trim().toLowerCase();
      if (uomNow === 'kg') {
        if (field === 'uom') {
          line.quantity_kg = String(line.quantity == null ? '' : line.quantity);
        } else if (field === 'quantity') {
          var oldQty = prev[lineIdx] && prev[lineIdx].quantity != null ? String(prev[lineIdx].quantity) : '';
          var oldKg = prev[lineIdx] && prev[lineIdx].quantity_kg != null ? String(prev[lineIdx].quantity_kg) : '';
          if (oldKg === '' || oldKg === oldQty) { line.quantity_kg = String(value == null ? '' : value); }
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
    setLines(function (prev) {
      var next = prev.concat([newLine]);
      // v55.83-A.6.27.56 — auto-collapse Shipment Info when going from 1 line → 2+
      // lines (user is in lines-editing mode now). Saves vertical space.
      if (prev.length >= 1) {
        try { setHeaderCollapsed(true); } catch (_) {}
      }
      return next;
    });
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
  // v55.83-A.6.27.37 — Save just the shipment shell (no products yet).
  // Writes to inventory_shipment_headers (separate from inventory_stock_receipts
  // which requires product_id NOT NULL). Operator returns later via Edit to add
  // product lines and the lines link back via header_id.
  async function saveShipmentHeaderOnly() {
    if (!header.warehouse_id) { alert('Warehouse required'); return; }
    if (!header.shipment_reference || !header.shipment_reference.trim()) {
      alert('Shipment Reference required (container number, PO number, or supplier reference).');
      return;
    }

    setBusy(true);
    try {
      // Generate a receipt_number for this shell shipment
      var receiptNumber;
      if (editingReceiptNumber) {
        receiptNumber = editingReceiptNumber;
      } else {
        var rnRes = await supabase.rpc('generate_receipt_number', { p_date: header.receipt_date });
        if (rnRes.error) throw rnRes.error;
        receiptNumber = rnRes.data;
      }

      var payload = {
        receipt_number: receiptNumber,
        receipt_date: header.receipt_date || new Date().toISOString().substring(0, 10),
        status: 'pending_detail',
        shipment_reference: header.shipment_reference.trim(),
        supplier: (header.supplier || '').trim() || null,
        warehouse_id: header.warehouse_id,
        freight_forwarder: (header.freight_forwarder || '').trim() || null,
        shipping_line: (header.shipping_line || '').trim() || null,
        container_number: (header.container_number || '').trim() || null,
        eta_date: header.eta_date || null,
        arrival_date: header.arrival_date || null,
        purchase_currency: header.purchase_currency || 'USD',
        origin_country_code: header.origin_country_code || null,
        notes: (header.notes || '').trim() || null,
        updated_by: userProfile && userProfile.id,
      };

      // Upsert: insert new, or update existing
      var existingHeaderRes = await supabase.from('inventory_shipment_headers').select('id').eq('receipt_number', receiptNumber).maybeSingle();
      if (existingHeaderRes.data && existingHeaderRes.data.id) {
        await dbUpdate('inventory_shipment_headers', existingHeaderRes.data.id, payload, userProfile && userProfile.id);
      } else {
        payload.created_by = userProfile && userProfile.id;
        await dbInsert('inventory_shipment_headers', payload, userProfile && userProfile.id);
      }

      // v55.83-AS — also propagate the reference to any existing receipt lines so
      // a with-lines shipment's top-level reference updates from "Save Shipment Only" too.
      try {
        await supabase.from('inventory_stock_receipts').update({ shipment_reference: header.shipment_reference.trim(), updated_by: userProfile && userProfile.id }).eq('receipt_number', receiptNumber);
      } catch (refErr) { console.error('[receiving] shell reference propagate failed', refErr); }

      toast.success('Shipment ' + receiptNumber + ' saved as Pending Detail. Add products later via Edit.');
      await reload();
      closeModal();
    } catch (err) {
      console.error('[receiving] header save failed:', err);
      toast.error('Save failed: ' + ((err && err.message) || String(err)));
      alert('Save failed: ' + ((err && err.message) || String(err)) + '\n\nMake sure the v55.83-A.6.27.37 SQL migration has been run in Supabase (creates inventory_shipment_headers table).');
    } finally {
      setBusy(false);
    }
  }

  // v55.83-A.6.27.43 — Reconciliation helpers.
  // Computes the sum of all per-line actuals to compare against the shipment-level expected.
  function computeActualTotals(linesArr) {
    // v55.83-A (Max Jun 1 2026) — ACTUAL totals now read from the LINE fields the
    // user actually fills in (Roll Count, Quantity in Kilos, Quantity Received),
    // NOT only from hand-added per-roll entries. Net KG removed from reconciliation.
    //   rolls  = line Roll Count  (+ any individually-added rolls)
    //   gross  = line Quantity in Kilos (+ any per-roll gross_kg)
    //   uom    = line Quantity Received (in the line's unit of measure)
    var totals = { rolls: 0, gross: 0, uom: 0 };
    for (var i = 0; i < linesArr.length; i++) {
      var L = linesArr[i];
      var addedRolls = (Array.isArray(L.rolls) && L.rolls.length) ? L.rolls.length : 0;
      var addedGross = 0;
      if (Array.isArray(L.rolls) && L.rolls.length) {
        for (var j = 0; j < L.rolls.length; j++) {
          addedGross += Number(L.rolls[j].gross_kg || 0) || 0;
        }
      }
      // Prefer the line's typed Roll Count; if individual rolls were added, use the larger of the two.
      var lineRolls = Number(L.roll_count || 0) || 0;
      totals.rolls += Math.max(lineRolls, addedRolls);
      // Prefer the line's typed Quantity in Kilos; if per-roll gross was entered, use the larger.
      var lineGross = Number(L.quantity_kg || 0) || 0;
      totals.gross += Math.max(lineGross, addedGross);
      // UOM: the line's received quantity (in its unit of measure)
      totals.uom += Number(L.quantity || 0) || 0;
    }
    return totals;
  }

  function computeVariance(headerObj, linesArr) {
    var actual = computeActualTotals(linesArr);
    var expectedRolls = headerObj.expected_total_rolls === '' || headerObj.expected_total_rolls == null ? null : Number(headerObj.expected_total_rolls);
    var expectedGross = headerObj.expected_total_gross_kg === '' || headerObj.expected_total_gross_kg == null ? null : Number(headerObj.expected_total_gross_kg);
    var expectedUom   = headerObj.expected_total_uom      === '' || headerObj.expected_total_uom      == null ? null : Number(headerObj.expected_total_uom);
    // Per-dimension variance is null when no expected was provided (can't compare).
    // Otherwise it's expected - actual (positive = under-delivered, negative = over-delivered).
    var variance = {
      rolls: expectedRolls == null ? null : (expectedRolls - actual.rolls),
      gross: expectedGross == null ? null : (Math.round((expectedGross - actual.gross) * 1000) / 1000),
      uom:   expectedUom   == null ? null : (Math.round((expectedUom   - actual.uom)   * 1000) / 1000),
    };
    // is_balanced: true ONLY if every comparable dimension is exactly zero.
    // Any dimension where expected wasn't provided is ignored.
    var anyMismatch = false;
    var compared = 0;
    if (variance.rolls != null) { compared++; if (variance.rolls !== 0) anyMismatch = true; }
    if (variance.gross != null) { compared++; if (variance.gross !== 0) anyMismatch = true; }
    if (variance.uom   != null) { compared++; if (variance.uom   !== 0) anyMismatch = true; }
    return {
      actual: actual,
      variance: variance,
      compared: compared,
      is_balanced: compared > 0 && !anyMismatch,
      has_any_expected: compared > 0,
    };
  }

  // v55.83-A.6.27.43 — Submit flow: save receipt + run reconciliation + capture variance.
  // On Submit click, if variance exists, the variancePromptOpen modal asks for notes BEFORE
  // the save actually fires. If notes are filled, status becomes submitted_unbalanced (yellow).
  // If no variance, status becomes submitted_balanced (green).
  async function submitReceipt() {
    setVarExpanded(true);
    var rec = computeVariance(header, lines);
    if (!rec.has_any_expected) {
      // No expected totals filled in — can't reconcile, force user back to fill them
      alert('Please fill in at least one Shipment Expected Total (rolls, gross kg, or UOM) before submitting.\n\nIf you want to save without committing yet, use "Save Draft" instead.');
      return;
    }
    if (!rec.is_balanced) {
      // Variance exists → prompt for notes before submitting
      setVariancePromptData(rec);
      setVariancePromptOpen(true);
      return;
    }
    // Balanced — save with submitted_balanced + green status
    await saveReceipt({ submitWithStatus: 'submitted_balanced', variance: rec });
  }

  // Called from the variance prompt modal after user fills notes
  async function submitWithVarianceNote(noteText) {
    if (!noteText || !noteText.trim()) {
      alert('Variance notes are required when expected totals do not match actuals.');
      return;
    }
    setHeader(Object.assign({}, header, { variance_notes: noteText.trim() }));
    setVariancePromptOpen(false);
    var rec = variancePromptData;
    await saveReceipt({
      submitWithStatus: 'submitted_unbalanced',
      variance: rec,
      varianceNotesOverride: noteText.trim(),
    });
  }

  async function saveReceipt(opts) {
    // v55.83-A.6.27.35 — Validation rewritten for two-phase flow.
    // Phase 1: header + at least one product line with expected_* totals (quantity can be blank)
    // Phase 2: roll details + actual quantity filled in
    if (!header.warehouse_id) { alert('Warehouse required'); return; }
    if (!header.shipment_reference || !header.shipment_reference.trim()) {
      alert('Shipment Reference required (e.g. container number, PO number, or supplier reference).');
      return;
    }
    // v55.83-A.6.27.43 — Draft saves are lenient — skip product line validation.
    // Submit (with status) enforces full validation including filled lines.
    var optsForSafetyCheck = opts || {};
    var isSubmitting = !!optsForSafetyCheck.submitWithStatus;
    var anyValid = false;
    if (isSubmitting) {
      for (var i = 0; i < lines.length; i++) {
        var L = lines[i];
        if (!L.product_id) { alert('Line ' + (i + 1) + ': product not selected. Pick a product or remove the line.'); return; }
        // v55.83-A.6.27.39 — Variant specs required when product is a family template
        if (L.product && L.product.is_family_template === true) {
          if (!L.variant_category_code) {
            alert('Line ' + (i + 1) + ': Category required (Smooth or Embossed) for family template ' + (L.product.quick_code || '?') + '.');
            return;
          }
        if (!L.variant_construction_code) {
          alert('Line ' + (i + 1) + ': Construction required for family template ' + (L.product.quick_code || '?') + '.');
          return;
        }
        if (!L.variant_backing_code) {
          alert('Line ' + (i + 1) + ': Backing required for family template ' + (L.product.quick_code || '?') + '.');
          return;
        }
        if (!L.variant_pattern_code) {
          alert('Line ' + (i + 1) + ': Pattern required for family template ' + (L.product.quick_code || '?') + '.');
          return;
        }
      }
      // v55.83-A.6.27.35 — at least one of: actual quantity, expected_uom_total, expected_rolls, or rolls[] must be present
      var hasActual = L.quantity && asNum(L.quantity) !== null && asNum(L.quantity) > 0;
      var hasExpected = asNum(L.expected_uom_total) > 0 || asNum(L.expected_rolls) > 0 || asNum(L.expected_gross_kg) > 0;
      var hasRolls = (L.rolls || []).length > 0;
      if (!hasActual && !hasExpected && !hasRolls) {
        alert('Line ' + (i + 1) + ': enter either the actual received quantity OR the expected totals (rolls / gross kg / uom total) — at least one is required.');
        return;
      }
      // Validate roll_count
      if (L.roll_count !== '' && L.roll_count != null) {
        var rc = Number(L.roll_count);
        if (isNaN(rc) || rc < 0 || rc !== Math.floor(rc)) {
          alert('Line ' + (i + 1) + ': roll count must be a non-negative whole number.');
          return;
        }
      }
      // v55.83-A.6.27.49 — REQUIRED FIELDS (at submit, not at draft save):
      //   Unit of Measure, Roll Count, Release #, and Quantity in Kilos (if UoM is kg).
      if (!L.uom || !String(L.uom).trim()) {
        alert('Line ' + (i + 1) + ': Unit of Measure is required.');
        return;
      }
      if (L.roll_count === '' || L.roll_count == null) {
        alert('Line ' + (i + 1) + ': Roll Count is required.');
        return;
      }
      // v55.83-DO — Release # is OPTIONAL (Max): no longer blocks submit.
      var uomLow = String(L.uom || '').trim().toLowerCase();
      var uomIsKg = (uomLow === 'kg' || uomLow === 'kgs' || uomLow === 'kilo' || uomLow === 'kilogram' || uomLow === 'kilograms');
      if (uomIsKg) {
        if (L.quantity_kg === '' || L.quantity_kg == null) {
          alert('Line ' + (i + 1) + ': Quantity in Kilos is required because Unit of Measure is kg.');
          return;
        }
      }
      // v55.83-A (Max Jun 1 2026) — PER-LINE variance reason requirement REMOVED.
      // There is no expected/non-expected at the line level — reconciliation happens
      // only at the shipment (top) level against Expected Totals (rolls + weight).
      // ordered_quantity / variance_reason may still be entered, but are never required.
      anyValid = true;
    }
    if (!anyValid) { alert('At least one valid line required'); return; }
    } // end if (isSubmitting)

    setBusy(true);
    try {
      // Decide receipt_number: existing if editing, else generate new
      var receiptNumber;
      if (editingReceiptNumber) {
        receiptNumber = editingReceiptNumber;
      } else {
        var rnRes = await supabase.rpc('generate_receipt_number', { p_date: header.receipt_date });
        if (rnRes.error) throw rnRes.error;
        receiptNumber = rnRes.data;
      }

      // v55.83-A.6.27.43 — Upsert the shipment header with expected totals + status.
      // opts.submitWithStatus = 'submitted_balanced' | 'submitted_unbalanced' | undefined (draft save)
      var optsSafe = opts || {};
      var statusToSet = optsSafe.submitWithStatus || null;
      var variance = optsSafe.variance || null;
      var varianceNotes = optsSafe.varianceNotesOverride != null ? optsSafe.varianceNotesOverride : (header.variance_notes || null);

      var headerPayload = {
        receipt_number: receiptNumber,
        receipt_date: header.receipt_date || new Date().toISOString().substring(0, 10),
        shipment_reference: header.shipment_reference.trim(),
        supplier: (header.supplier || '').trim() || null,
        warehouse_id: header.warehouse_id,
        freight_forwarder: (header.freight_forwarder || '').trim() || null,
        shipping_line: (header.shipping_line || '').trim() || null,
        container_number: (header.container_number || '').trim() || null,
        eta_date: header.eta_date || null,
        arrival_date: header.arrival_date || null,
        purchase_currency: header.purchase_currency || 'USD',
        origin_country_code: header.origin_country_code || null,
        notes: (header.notes || '').trim() || null,
        // v55.83-A.6.27.43 expected totals
        expected_total_rolls: header.expected_total_rolls === '' || header.expected_total_rolls == null ? null : Number(header.expected_total_rolls),
        expected_total_gross_kg: header.expected_total_gross_kg === '' || header.expected_total_gross_kg == null ? null : Number(header.expected_total_gross_kg),
        expected_total_net_kg: header.expected_total_net_kg === '' || header.expected_total_net_kg == null ? null : Number(header.expected_total_net_kg),
        expected_total_uom: header.expected_total_uom === '' || header.expected_total_uom == null ? null : Number(header.expected_total_uom),
        expected_uom_type: header.expected_uom_type || null,
        updated_by: userProfile && userProfile.id,
      };

      // v55.83-O — persist the imported NEXPAC breakdown on the shipment header so the
      // expected per-line detail is kept. Only set when a report was imported this
      // session; a plain edit without re-import leaves any saved breakdown untouched.
      if (nexpacPreview) {
        headerPayload.nexpac_breakdown = {
          header: { releaseNumber: (nexpacPreview.header && nexpacPreview.header.releaseNumber) || null, containerNumber: (nexpacPreview.header && nexpacPreview.header.containerNumber) || null },
          totals: nexpacPreview.totals || null,
          lines: nexpacPreview.lines || [],
          warnings: nexpacPreview.warnings || [],
          imported_at: new Date().toISOString(),
        };
      }

      if (statusToSet) {
        headerPayload.status = statusToSet;
        headerPayload.submitted_at = new Date().toISOString();
        headerPayload.submitted_by = userProfile && userProfile.id;
        headerPayload.is_balanced = (statusToSet === 'submitted_balanced');
        if (variance) {
          headerPayload.variance_rolls    = variance.variance.rolls;
          headerPayload.variance_gross_kg = variance.variance.gross;
          headerPayload.variance_net_kg   = null;  // Net kg removed from reconciliation (Max Jun 1 2026)
          headerPayload.variance_uom      = variance.variance.uom;
          headerPayload.variance_notes    = varianceNotes;
        }
      } else {
        headerPayload.status = 'draft';
      }

      var existingHeaderRes = await supabase.from('inventory_shipment_headers').select('id').eq('receipt_number', receiptNumber).maybeSingle();
      var savedHeaderId;
      if (existingHeaderRes.data && existingHeaderRes.data.id) {
        await dbUpdate('inventory_shipment_headers', existingHeaderRes.data.id, headerPayload, userProfile && userProfile.id);
        savedHeaderId = existingHeaderRes.data.id;
      } else {
        headerPayload.created_by = userProfile && userProfile.id;
        var insHeader = await dbInsert('inventory_shipment_headers', headerPayload, userProfile && userProfile.id);
        savedHeaderId = insHeader && insHeader.id;
      }

      var masterUpdatesQueued = []; // {product_id, patch}

      // Process each line
      for (var j = 0; j < lines.length; j++) {
        var L2 = lines[j];
        // v55.83-A.6.27.43 — On Draft save, skip lines that have no product picked yet
        // (operator may have added blank rows but not filled them)
        if (!isSubmitting && !L2.product_id) continue;
        // v55.83-A.6.27.39 — If product is a family template, resolve to a variant
        // via get_or_create_variant() — either reuses existing or creates a new one.
        var effectiveProductId = L2.product_id;
        if (L2.product && L2.product.is_family_template === true) {
          var vRes = await supabase.rpc('get_or_create_variant', {
            p_template_id:       L2.product_id,
            p_category_code:     L2.variant_category_code,
            p_construction_code: L2.variant_construction_code,
            p_backing_code:      L2.variant_backing_code,
            p_pattern_code:      L2.variant_pattern_code,
            p_user_id:           userProfile && userProfile.id,
          });
          if (vRes.error) {
            console.error('[receiving] get_or_create_variant failed:', vRes.error);
            toast.error('Variant resolution failed: ' + vRes.error.message);
            setBusy(false);
            return;
          }
          effectiveProductId = vRes.data;
        }
        var qty = asNum(L2.quantity);
        var cost = asNum(L2.cost_per_uom);
        // Use expected_uom_total as a fallback if no actual quantity entered yet
        var effectiveQty = qty != null ? qty : asNum(L2.expected_uom_total);
        var total = (effectiveQty != null && cost != null) ? effectiveQty * cost : null;
        // v55.83-A.6.27.35 — status derivation:
        //   pending_detail → no actual quantity AND no rolls (only expected totals)
        //   received       → has actual quantity OR rolls
        var hasActualOrRolls = (qty != null && qty > 0) || (L2.rolls || []).length > 0;
        var lineStatus = hasActualOrRolls ? 'received' : 'pending_detail';

        var payload = {
          receipt_number: receiptNumber,
          line_uid: L2.line_uid || null,
          receipt_type: 'new_shipment',
          receipt_date: header.receipt_date || new Date().toISOString().substring(0, 10),
          status: lineStatus,
          product_id: effectiveProductId,
          // Store actual quantity if entered, else fall back to expected_uom_total so
          // downstream queries (movements/layers) get a number to work with.
          quantity: effectiveQty != null ? effectiveQty : 0.001, // CHECK requires > 0; use tiny number if neither set
          uom: L2.uom || null,
          actual_thickness_mm: asNum(L2.actual_thickness_mm),
          actual_width_m: asNum(L2.actual_width_m),
          actual_gsm: asNum(L2.actual_gsm),
          actual_density: asNum(L2.actual_density),
          actual_weight_per_roll: asNum(L2.actual_weight_per_roll),
          actual_roll_length_m: asNum(L2.actual_roll_length_m),
          supplier: (L2.supplier || header.supplier || '').trim() || null,
          batch_number: (L2.batch_number || '').trim() || null,
          container_number: (header.container_number || '').trim() || null,
          cost_per_uom: cost,
          currency: L2.currency || null,
          total_cost: total,
          warehouse_id: header.warehouse_id,
          rack: (L2.rack || '').trim() || null,
          notes: (header.notes || '').trim() || null,
          shipment_reference: header.shipment_reference.trim(),
          freight_forwarder: (header.freight_forwarder || '').trim() || null,
          shipping_line: (header.shipping_line || '').trim() || null,
          eta_date: header.eta_date || null,
          arrival_date: header.arrival_date || null,
          purchase_currency: header.purchase_currency || null,
          ordered_quantity: asNum(L2.ordered_quantity),
          origin_country_code: header.origin_country_code || null,
          variance_reason: (L2.variance_reason || '').trim() || null,
          variance_acknowledged: L2.variance_acknowledged === true,
          quantity_kg: asNum(L2.quantity_kg),
          roll_count: (L2.roll_count !== '' && L2.roll_count != null) ? Number(L2.roll_count) : null,
          line_notes: (L2.line_notes || '').trim() || null,
          // v55.83-A.6.27.35 — expected totals (Phase 1 data)
          expected_rolls: asNum(L2.expected_rolls),
          expected_gross_kg: asNum(L2.expected_gross_kg),
          expected_net_kg: asNum(L2.expected_net_kg),
          expected_uom_total: asNum(L2.expected_uom_total),
          updated_by: userProfile && userProfile.id,
        };

        // v55.83-A.6.27.35 — INSERT new line vs UPDATE existing
        var lineId;
        if (L2.existing_id) {
          // Edit mode: update existing row
          await dbUpdate('inventory_stock_receipts', L2.existing_id, payload, userProfile && userProfile.id);
          lineId = L2.existing_id;
        } else {
          // v55.83-DP — Timing-proof dedup: even if the in-memory existing_id has not
          // been backfilled yet (fast repeated autosaves), look the row up by its stable
          // receipt_number + line_uid at the DB. If it already exists, UPDATE it; only
          // insert when there is genuinely no row yet. Prevents duplicate product lines.
          var matchedId = null;
          if (L2.line_uid) {
            try {
              var dupRes = await supabase.from('inventory_stock_receipts').select('id').eq('receipt_number', receiptNumber).eq('line_uid', L2.line_uid).limit(1);
              if (dupRes && dupRes.data && dupRes.data.length > 0) { matchedId = dupRes.data[0].id; }
            } catch (eDup) { /* fall through to insert */ }
          }
          if (matchedId) {
            await dbUpdate('inventory_stock_receipts', matchedId, payload, userProfile && userProfile.id);
            lineId = matchedId;
          } else {
            // New line: insert
            payload.created_by = userProfile && userProfile.id;
            var ins = await dbInsert('inventory_stock_receipts', payload, userProfile && userProfile.id);
            lineId = ins && ins.id;
          }
        }

        // v55.83-A.6.27.35 — save rolls if any (delete-then-insert for simplicity)
        if (lineId && (L2.rolls || []).length > 0) {
          // Delete existing rolls for this line (cascades on receipt cancel; this is for edit-mode replacement)
          if (L2.existing_id) {
            await supabase.from('inventory_receipt_rolls').delete().eq('receipt_id', lineId);
          }
          for (var ri = 0; ri < L2.rolls.length; ri++) {
            var roll = L2.rolls[ri];
            await dbInsert('inventory_receipt_rolls', {
              receipt_id: lineId,
              roll_number: (roll.roll_number || '').trim() || null,
              roll_sequence: ri + 1,
              gross_kg: asNum(roll.gross_kg),
              net_kg: asNum(roll.net_kg),
              meters: asNum(roll.meters),
              rack: (roll.rack || '').trim() || null,
              notes: (roll.notes || '').trim() || null,
              created_by: userProfile && userProfile.id,
              updated_by: userProfile && userProfile.id,
            }, userProfile && userProfile.id);
          }
        }

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

      // v55.83-AS — propagate the shipment-level reference to ALL lines of this
      // receipt so the top-level list (which reads the reference from the first
      // line) always reflects the edit, even if a line wasn't matched/updated above.
      try {
        await supabase.from('inventory_stock_receipts').update({ shipment_reference: header.shipment_reference.trim(), updated_by: userProfile && userProfile.id }).eq('receipt_number', receiptNumber);
      } catch (refErr) { console.error('[receiving] reference propagate failed', refErr); }

      // Apply any master updates
      for (var k2 = 0; k2 < masterUpdatesQueued.length; k2++) {
        var mu = masterUpdatesQueued[k2];
        await dbUpdate('inventory_products', mu.product_id, mu.patch, userProfile && userProfile.id);
      }

      // v55.83-A.6.27.43 — Submit-aware toast
      if (statusToSet === 'submitted_balanced') {
        toast.success('✓ Receipt ' + receiptNumber + ' submitted (balanced). All totals match — green status.');
      } else if (statusToSet === 'submitted_unbalanced') {
        toast.success('⚠ Receipt ' + receiptNumber + ' submitted with variance. Yellow status. Notes recorded.');
      } else {
        var verb = editingReceiptNumber ? 'updated' : 'saved';
        toast.success('Receipt ' + receiptNumber + ' draft ' + verb + ' — ' + lines.length + ' line(s)' + (masterUpdatesQueued.length ? '. Updated ' + masterUpdatesQueued.length + ' master record(s).' : ''));
      }
      // v55.83-DO — Autosave keeps the editor OPEN (no reload/close). It also
      // pins the receipt number and re-hydrates saved line IDs so a second autosave
      // UPDATES the same rows instead of inserting duplicates.
      if (optsSafe.autosave) {
        if (!editingReceiptNumber) { setEditingReceiptNumber(receiptNumber); }
        try {
          var rhRes = await supabase.from('inventory_stock_receipts').select('id, product_id, line_uid').eq('receipt_number', receiptNumber);
          var rhRows = (rhRes && rhRes.data) || [];
          var idByUid = {};
          var idByProduct = {};
          for (var rh = 0; rh < rhRows.length; rh++) {
            if (rhRows[rh].line_uid != null && idByUid[rhRows[rh].line_uid] == null) { idByUid[rhRows[rh].line_uid] = rhRows[rh].id; }
            if (rhRows[rh].product_id != null && idByProduct[rhRows[rh].product_id] == null) { idByProduct[rhRows[rh].product_id] = rhRows[rh].id; }
          }
          setLines(function (prevLines) {
            return prevLines.map(function (ln) {
              if (ln.existing_id) { return ln; }
              var found = (ln.line_uid != null ? idByUid[ln.line_uid] : null);
              if (found == null && ln.product_id != null) { found = idByProduct[ln.product_id]; }
              if (found != null) { var copy = Object.assign({}, ln); copy.existing_id = found; return copy; }
              return ln;
            });
          });
        } catch (eRehydrate) { /* non-fatal — DB-level line_uid dedup still prevents duplicates */ }
        var hh = new Date();
        var hhmm = ('0' + hh.getHours()).slice(-2) + ':' + ('0' + hh.getMinutes()).slice(-2);
        setAutosaveStatus('Saved ' + hhmm);
        setBusy(false);
        return;
      }
      await reload();
      closeModal();
    } catch (err) {
      console.error('[receiving] save failed:', err);
      toast.error('Save failed: ' + ((err && err.message) || String(err)));
      alert('Save failed: ' + ((err && err.message) || String(err)) + '\n\nIf this is the first time you\'re using Inbound Shipments, make sure the v55.83-A.6.27.29 + v55.83-A.6.27.35 SQL migrations have been run in Supabase.');
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
      var rows = receipts.filter(function (r) { return r.receipt_number === rn && r.status !== 'cancelled'; });

      // v55.83-W — don't reverse stock that an outbound order already consumed.
      var ddC = await shipmentDrawdown(cancelTarget);
      if (!ddC.error && ddC.consumedQty > 0) {
        alert('Cannot cancel ' + rn + ': ' + ddC.consumedQty.toLocaleString() + ' unit(s) have already been sold / drawn down from this shipment.\n\nReverse or edit the invoice(s) that consumed this stock first, then cancel.');
        return;
      }

      // v55.83-A.6.27.66 (C4, Max May 23 2026) — finalized lines need their
      // FIFO cost layer reversed BEFORE we flip status to 'cancelled'.
      // Previously the cancel just set status='cancelled' on every line
      // including finalized ones, leaving the cost layer in place — so
      // stock counts and COGS still pointed to a "cancelled" receipt.
      // Now we route finalized lines through reopen_finalized_receipt first
      // (which writes a reversal movement, marks the layer as reversed, and
      // resets status to 'received'). Only THEN do we flip everything to
      // 'cancelled'.
      var finalizedLines = rows.filter(function (r) { return r.status === 'finalized'; });
      for (var f = 0; f < finalizedLines.length; f++) {
        var fLine = finalizedLines[f];
        var rRes = await supabase.rpc('reopen_finalized_receipt', {
          p_receipt_id: fLine.id,
          p_user_id: userProfile && userProfile.id,
          p_reason: 'Cancellation: ' + cancelReason.trim(),
        });
        if (rRes && rRes.error) {
          // If reversal fails, abort the whole cancel — partial state is worse
          // than no state. Surface the error so user can investigate.
          console.error('[receiving] cancel aborted: reopen_finalized_receipt failed for line ' + fLine.id, rRes.error);
          throw new Error('Cannot cancel — finalized line ' + (fLine.product_name || fLine.id) + ' could not be reversed: ' + ((rRes.error && rRes.error.message) || rRes.error));
        }
      }

      // Now flip all lines (including the just-reopened ones) to 'cancelled'
      for (var i = 0; i < rows.length; i++) {
        await dbUpdate('inventory_stock_receipts', rows[i].id, {
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: userProfile && userProfile.id,
          cancel_reason: cancelReason.trim(),
          updated_by: userProfile && userProfile.id,
        }, userProfile && userProfile.id);
      }
      // v55.83-V — also cancel the shipment HEADER so NEXPAC shells (header, no lines) cancel too.
      var hdrCancel = headers.find(function (h) { return h.receipt_number === rn; });
      if (hdrCancel) {
        await dbUpdate('inventory_shipment_headers', hdrCancel.id, {
          status: 'cancelled', cancelled_at: new Date().toISOString(),
          cancelled_by: userProfile && userProfile.id, cancel_reason: cancelReason.trim(),
        }, userProfile && userProfile.id);
      }
      toast.success('Shipment ' + rn + ' cancelled' + (rows.length > 0 ? ' (' + rows.length + ' line(s)' + (finalizedLines.length > 0 ? ', ' + finalizedLines.length + ' cost layer(s) reversed' : '') + ')' : ' (shell — no product lines yet)') + '.');
      setCancelTarget(null);
      setCancelReason('');
      await reload();
    } catch (err) {
      console.error('[receiving] cancel failed:', err);
      toast.error('Cancel failed: ' + ((err && err.message) || String(err)));
      alert('Cancel failed: ' + ((err && err.message) || String(err)));
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
      var hdrRestore = headers.find(function (h) { return h.receipt_number === rn; });
      if (hdrRestore) {
        await dbUpdate('inventory_shipment_headers', hdrRestore.id, { status: 'pending_detail', cancelled_at: null, cancelled_by: null, cancel_reason: null }, userProfile && userProfile.id);
      }
      toast.success('Shipment ' + rn + ' restored.');
      await reload();
    } catch (err) {
      console.error('[receiving] restore failed:', err);
      toast.error('Restore failed: ' + ((err && err.message) || String(err)));
    }
  }

  // v55.83-W — has any stock from this shipment's cost layers been drawn down
  // (sold/consumed by an outbound)? Protects delete/cancel/reopen: we never remove
  // or reverse stock an outbound order already consumed.
  async function shipmentDrawdown(g) {
    var rn = g.receipt_number;
    var lineIds = receipts.filter(function (r) { return r.receipt_number === rn; }).map(function (r) { return r.id; });
    if (lineIds.length === 0) return { layers: [], consumedQty: 0, error: null };
    try {
      var res = await supabase.from('inventory_layers').select('id, qty_received, qty_remaining, source_receipt_id').in('source_receipt_id', lineIds);
      if (res.error) return { layers: [], consumedQty: 0, error: res.error.message };
      var layers = res.data || [];
      var consumedQty = layers.reduce(function (a, l) { return a + Math.max(0, Number(l.qty_received || 0) - Number(l.qty_remaining || 0)); }, 0);
      return { layers: layers, consumedQty: consumedQty, error: null };
    } catch (e) { return { layers: [], consumedQty: 0, error: (e && e.message) || String(e) }; }
  }

  // ── Delete (hard, super_admin only) ──────────────────────────────
  // v55.83-V — permanent removal. Cancel keeps a record (greyed out); Delete wipes
  // the lines, their rolls, and the shipment header. Blocked on finalized shipments
  // (they own cost layers — reopen first). Restricted to super_admin; logged via dbDelete.
  async function deleteShipment(g) {
    if (!isSuperAdmin) { alert('Permanently deleting a shipment is restricted to super-admins. Use Cancel instead.'); return; }
    var rn = g.receipt_number;
    var lineRows = receipts.filter(function (r) { return r.receipt_number === rn; });

    // v55.83-W — never delete stock an outbound order already consumed.
    var dd = await shipmentDrawdown(g);
    if (dd.error) {
      if (!window.confirm('Could not verify whether any stock from ' + rn + ' has been sold (' + dd.error + ').\n\nDeleting anyway could corrupt sales/COGS if it was sold. Proceed ONLY if you are certain nothing was sold from this shipment. Continue?')) return;
    } else if (dd.consumedQty > 0) {
      alert('Cannot delete ' + rn + ': ' + dd.consumedQty.toLocaleString() + ' unit(s) have already been sold / drawn down from this shipment.\n\nReverse or edit the invoice(s) that consumed this stock first, then delete.');
      return;
    }

    var typed = window.prompt('PERMANENTLY DELETE shipment ' + rn + '?\n\nThis removes its cost layers, stock movements, ' + lineRows.length + ' product line(s) and rolls, and the shipment header — so it disappears from the inventory overview. It CANNOT be undone. To keep a record instead, use Cancel.\n\nType the shipment number to confirm:');
    if (typed == null) return;
    if (typed.trim() !== rn) { alert('What you typed did not match "' + rn + '". Delete aborted.'); return; }
    try {
      var lineIds = lineRows.map(function (r) { return r.id; });
      // v55.83-W — remove the inventory-overview entries this shipment created:
      // its stock movements + cost layers (safe: guarded above as not consumed).
      if (lineIds.length > 0) {
        try { await supabase.from('inventory_movements').delete().in('source_receipt_id', lineIds); } catch (e) { console.warn('[receiving] movement delete:', e); }
        try { await supabase.from('inventory_layers').delete().in('source_receipt_id', lineIds); } catch (e) { console.warn('[receiving] layer delete:', e); }
      }
      for (var i = 0; i < lineRows.length; i++) {
        try { await supabase.from('inventory_receipt_rolls').delete().eq('receipt_id', lineRows[i].id); } catch (e) { console.warn('[receiving] roll delete:', e); }
      }
      for (var j = 0; j < lineRows.length; j++) {
        await dbDelete('inventory_stock_receipts', lineRows[j].id, userProfile && userProfile.id);
      }
      var hdrDel = headers.find(function (h) { return h.receipt_number === rn; });
      if (hdrDel) await dbDelete('inventory_shipment_headers', hdrDel.id, userProfile && userProfile.id);
      toast.success('Shipment ' + rn + ' permanently deleted (cost layers + stock removed from the overview).');
      await reload();
    } catch (err) {
      console.error('[receiving] delete failed:', err);
      toast.error('Delete failed: ' + ((err && err.message) || String(err)));
      alert('Delete failed: ' + ((err && err.message) || String(err)));
    }
  }

  // ── Render ───────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div style={{ padding: 24 }}>
        <div className="bg-amber-500/15 border-2 border-amber-600/50 rounded-lg p-4 text-amber-100">
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
  var headerByNumber = {};
  headers.forEach(function (h) { headerByNumber[h.receipt_number] = h; });
  var groupedReceipts = {};
  filteredReceipts.forEach(function (r) {
    if (!groupedReceipts[r.receipt_number]) groupedReceipts[r.receipt_number] = [];
    groupedReceipts[r.receipt_number].push(r);
  });
  var grouped = Object.keys(groupedReceipts).map(function (rn) {
    var rows = groupedReceipts[rn];
    // v55.83-A.6.27.33 — when finalized, prefer landed_total (purchase + freight/duty/etc).
    // Otherwise show provisional total_cost (just purchase cost × qty).
    var totalCost = rows.reduce(function (a, b) {
      var v = b.landed_total != null ? Number(b.landed_total) : Number(b.total_cost || 0);
      return a + v;
    }, 0);
    return {
      receipt_number: rn,
      receipt_date: rows[0].receipt_date,
      status: rows[0].status,
      receipt_type: rows[0].receipt_type,
      warehouse_id: rows[0].warehouse_id,
      supplier: rows[0].supplier,
      shipment_reference: rows[0].shipment_reference,
      lines: rows,
      lineCount: rows.length,
      totalQty: rows.reduce(function (a, b) { return a + Number(b.quantity || 0); }, 0),
      totalCost: totalCost,
      isHeaderOnly: false,
      header: headerByNumber[rn] || null,
    };
  });

  // v55.83-A.6.27.37 — merge in shell shipments (headers with no product lines yet).
  // Apply the same filter logic to headers, then add phantom rows for any header
  // whose receipt_number isn't already represented in grouped.
  var existingNumbers = {};
  grouped.forEach(function (g) { existingNumbers[g.receipt_number] = true; });
  headers.forEach(function (h) {
    if (existingNumbers[h.receipt_number]) return; // already represented by lines
    // Apply same filter rules
    if (filterStatus !== 'all' && h.status !== filterStatus) return;
    if (filterWarehouse !== 'all' && h.warehouse_id !== filterWarehouse) return;
    if (filterFrom && h.receipt_date < filterFrom) return;
    if (filterTo && h.receipt_date > filterTo) return;
    if (search.trim()) {
      var q = search.trim().toLowerCase();
      var hay = ((h.shipment_reference || '') + ' ' + (h.supplier || '') + ' ' + (h.receipt_number || '') + ' ' + (h.notes || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return;
    }
    grouped.push({
      receipt_number: h.receipt_number,
      receipt_date: h.receipt_date,
      status: h.status || 'pending_detail',
      receipt_type: 'new_shipment',
      warehouse_id: h.warehouse_id,
      supplier: h.supplier,
      shipment_reference: h.shipment_reference,
      lines: [],
      lineCount: 0,
      totalQty: 0,
      totalCost: 0,
      isHeaderOnly: true,
      header_id: h.id,
      header: h,
    });
  });
  // Sort newest first by date desc then receipt_number desc
  grouped.sort(function (a, b) {
    if (a.receipt_date !== b.receipt_date) return a.receipt_date < b.receipt_date ? 1 : -1;
    return a.receipt_number < b.receipt_number ? 1 : -1;
  });

  return (
    <div className="bg-slate-950 rounded-2xl shadow-xl border border-slate-800" style={{ padding: 20 }}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 24 }}>🚚</span>
          <h2 className="text-xl font-extrabold text-slate-100">Inbound Shipments</h2>
        </div>
        <div className="text-sm text-slate-400 font-medium mt-1">
          Record incoming shipments. Each receipt can have multiple product lines. Auto-fills from Product List defaults.
        </div>
        <div className="text-sm text-slate-400 font-medium" style={{ direction: 'rtl' }}>
          سجّل الشحنات الواردة. كل إيصال يمكن أن يحتوي على عدة منتجات. يُعبأ تلقائياً من القيم الافتراضية للمنتج.
        </div>
      </div>

      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="Search receipt#, product, release, supplier..."
          value={search}
          onChange={function (e) { setSearch(e.target.value); }}
          className="flex-1 min-w-[260px] px-3 py-2 border border-slate-600 rounded-lg text-sm bg-slate-800 text-slate-100 placeholder-slate-500"
        />
        <select
          value={filterWarehouse}
          onChange={function (e) { setFilterWarehouse(e.target.value); }}
          className="px-3 py-2 border border-slate-600 rounded-lg text-sm bg-slate-800 text-slate-100 placeholder-slate-500 font-semibold"
        >
          <option value="all">All warehouses</option>
          {warehouses.map(function (w) {
            return <option key={w.id} value={w.id}>{w.name}</option>;
          })}
        </select>
        <select
          value={filterStatus}
          onChange={function (e) { setFilterStatus(e.target.value); }}
          className="px-3 py-2 border border-slate-600 rounded-lg text-sm bg-slate-800 text-slate-100 placeholder-slate-500 font-semibold"
        >
          <option value="all">All status</option>
          <option value="pending_detail">Pending Detail (no rolls/qty yet)</option>
          <option value="received">Received (not finalized)</option>
          <option value="finalized">Finalized</option>
          <option value="active">Active (legacy)</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={filterFrom} onChange={function (e) { setFilterFrom(e.target.value); }} className="px-2 py-1.5 border border-slate-600 rounded-lg text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
        <input type="date" value={filterTo} onChange={function (e) { setFilterTo(e.target.value); }} className="px-2 py-1.5 border border-slate-600 rounded-lg text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
        {canEdit && (
          <button
            onClick={openNew}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-lg"
          >
            + New Receipt
          </button>
        )}
        {canEdit && (
          <button
            onClick={function () {
              var sel = selectedNumbers();
              if (sel.length < 2) { toast.error('Tick at least 2 shipments to merge.'); return; }
              try {
                var validLines = receipts.filter(function (r) { return sel.indexOf(r.receipt_number) >= 0 && r.status !== 'cancelled' && r.status !== 'merged'; });
                if (validLines.length === 0) { toast.error('The selected shipments have no mergeable product lines (all cancelled or already merged).'); return; }
                initMergeShell(sel);
                setMergeTarget('new'); setMergeConfirmText(''); setMergeNotes('');
                setMergeModalOpen(true);
                console.log('[merge] opening modal for', sel);
              } catch (e) { console.error('[merge] open failed', e); toast.error('Could not open merge: ' + ((e && e.message) || 'unknown')); }
            }}
            disabled={selectedNumbers().length < 2}
            className={'px-3 py-2 text-xs font-extrabold rounded-lg ' + (selectedNumbers().length >= 2 ? 'bg-violet-600 hover:bg-violet-700 text-white' : 'bg-slate-700 text-slate-400 cursor-not-allowed')}
          >
            ⎘ Merge Shipments{selectedNumbers().length ? ' (' + selectedNumbers().length + ' selected)' : ''}
          </button>
        )}
        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
          <input type="checkbox" checked={showMerged} onChange={function (e) { setShowMerged(e.target.checked); }} className="w-4 h-4" />
          Show merged
        </label>
      </div>

      {/* Receipts list */}
      <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden">
        <div className="grid bg-slate-800/60 text-[10px] font-extrabold text-slate-300 tracking-wider uppercase"
             style={{ gridTemplateColumns: '170px 100px 80px 90px 1fr 110px 120px ' + (seeCosts ? '120px ' : '') + '140px', padding: '8px 12px' }}>
          <div>Receipt # / Ref</div>
          <div>Date</div>
          <div>Type</div>
          <div>Status</div>
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
          grouped.filter(function (g) { return showMerged || (!isMergedSource(g) && !isUnmergedTarget(g)); }).map(function (g) {
            var wh = warehouseById(g.warehouse_id);
            var isCancelled = g.status === 'cancelled';
            var isFinalized = g.status === 'finalized';
            var isUnmerged = isUnmergedTarget(g);
            var rowClass = 'grid items-center border-t border-slate-100 ' +
              (isCancelled ? 'bg-slate-100 opacity-60' : '');
            var typeBadge = g.receipt_type === 'legacy_import' ? 'bg-purple-700 text-white' :
                            g.receipt_type === 'adjustment' ? 'bg-amber-600 text-white' :
                            'bg-emerald-600 text-white';
            // v55.83-A.6.27.43 — High-contrast status badges. Solid bg + white text.
            // Statuses: draft / pending_detail / received / submitted_balanced / submitted_unbalanced / finalized / cancelled
            var statusBadge = isCancelled ? 'bg-red-700 text-white' :
                              isUnmerged ? 'bg-violet-700 text-white' :
                              isFinalized ? 'bg-blue-700 text-white' :
                              g.status === 'submitted_balanced' ? 'bg-emerald-600 text-white' :
                              g.status === 'submitted_unbalanced' ? 'bg-amber-500 text-white' :
                              g.status === 'received' ? 'bg-indigo-600 text-white' :
                              g.status === 'pending_detail' ? 'bg-orange-600 text-white' :
                              g.status === 'draft' ? 'bg-slate-600 text-white' :
                              'bg-slate-500 text-white';
            var statusLabel = isCancelled ? 'CANCELLED' :
                              isUnmerged ? '⎘ UNMERGED' :
                              isFinalized ? 'FINALIZED' :
                              g.status === 'submitted_balanced' ? '✓ SUBMITTED' :
                              g.status === 'submitted_unbalanced' ? '⚠ VARIANCE' :
                              g.status === 'received' ? 'RECEIVED' :
                              g.status === 'pending_detail' ? 'PENDING DETAIL' :
                              g.status === 'draft' ? 'DRAFT' :
                              'ACTIVE';
            // v55.83-V — expected NEXPAC totals from the shipment header (shell or full)
            var hx = g.header || {};
            var expRolls = (hx.expected_total_rolls != null && hx.expected_total_rolls !== '') ? Number(hx.expected_total_rolls) : null;
            var expGross = (hx.expected_total_gross_kg != null && hx.expected_total_gross_kg !== '') ? Number(hx.expected_total_gross_kg) : null;
            var expNet = (hx.expected_total_net_kg != null && hx.expected_total_net_kg !== '') ? Number(hx.expected_total_net_kg) : null;
            var hasExpected = expRolls != null || expGross != null || expNet != null;
            return (
              <div key={g.receipt_number} className={rowClass}
                   style={{ gridTemplateColumns: '170px 100px 80px 90px 1fr 110px 120px ' + (seeCosts ? '120px ' : '') + '140px', padding: '12px 12px' }}>
                <div>
                  <div className="flex items-center gap-2">
                    {canEdit && !isMergedSource(g) && <input type="checkbox" checked={!!mergeSel[g.receipt_number]} onClick={function (e) { e.stopPropagation(); }} onChange={function () { toggleMergeSel(g.receipt_number); }} className="w-4 h-4 flex-shrink-0" title="Select to merge" />}
                    <div className={'text-sm font-mono font-extrabold ' + (isCancelled ? 'text-slate-600 line-through' : 'text-slate-100')}>{g.receipt_number}{isMergedSource(g) ? <span className="ml-1 px-1 py-0.5 bg-slate-600 text-white text-[8px] rounded align-middle">MERGED</span> : null}</div>
                  </div>
                  {g.shipment_reference && <div className={'text-[10px] font-mono ' + (isCancelled ? 'text-slate-500 line-through' : 'text-slate-600')}>{g.shipment_reference}</div>}
                </div>
                <div className={'text-sm font-semibold ' + (isCancelled ? 'text-slate-600 line-through' : 'text-slate-100')}>{g.receipt_date}</div>
                <div>
                  <span className={'text-[10px] px-1.5 py-0.5 rounded font-extrabold ' + (isCancelled ? 'bg-slate-200 text-slate-600' : typeBadge)}>
                    {g.receipt_type === 'legacy_import' ? 'Legacy' : g.receipt_type === 'adjustment' ? 'Adjust' : 'New'}
                  </span>
                </div>
                <div>
                  <span className={'text-xs px-2 py-1 rounded font-extrabold ' + statusBadge}>
                    {statusLabel}
                  </span>
                </div>
                <div className={'text-sm ' + (isCancelled ? 'text-slate-600 line-through' : 'text-slate-100')}>
                  {g.lineCount === 0 ? (
                    hasExpected ? (
                      <div>
                        <div className="text-[11px] font-extrabold text-indigo-200">📋 NEXPAC expected</div>
                        <div className="text-[11px] text-slate-100 font-semibold">
                          {expRolls != null ? expRolls.toLocaleString() + ' rolls' : ''}
                          {expNet != null ? ((expRolls != null ? ' · ' : '') + expNet.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' kg net') : ''}
                          {expGross != null ? (' · ' + expGross.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' kg gross') : ''}
                        </div>
                        <div className="text-[10px] text-slate-500 italic">{g.supplier ? g.supplier + ' · ' : ''}awaiting product lines — click Edit to add</div>
                      </div>
                    ) : (
                      <span className="italic text-slate-500 text-[11px]">Shell — no detail yet{g.supplier ? ' · ' + g.supplier : ''}</span>
                    )
                  ) : (
                    <div>
                      {g.lines.slice(0, 2).map(function (ln) {
                        var p = productById(ln.product_id);
                        return p ? (p.quick_code || p.name_en || '?') : '?';
                      }).join(', ')}
                      {g.lineCount > 2 && <span className="text-slate-500 italic ml-1">+ {g.lineCount - 2} more</span>}
                      <div className="text-[10px] text-slate-600">
                        {g.lineCount} line{g.lineCount === 1 ? '' : 's'}{g.supplier ? ' · ' + g.supplier : ''}
                        {hasExpected ? <span className="text-indigo-300"> · Expected: {expNet != null ? (expNet.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' kg net') : (expRolls != null ? (expRolls.toLocaleString() + ' rolls') : 'NEXPAC')}</span> : null}
                      </div>
                    </div>
                  )}
                </div>
                <div className={'text-sm font-extrabold ' + (isCancelled ? 'text-slate-600 line-through' : 'text-slate-100')}>
                  {g.totalQty > 0 ? g.totalQty.toLocaleString() : (hasExpected ? <span className="text-indigo-300 text-xs font-semibold" title="Expected from NEXPAC; no actuals received yet">{expNet != null ? ('Expected: ' + expNet.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' kg net') : (expRolls != null ? ('Expected: ' + expRolls + ' rolls') : 'Expected')}</span> : g.totalQty.toLocaleString())}
                </div>
                <div className={'text-sm ' + (isCancelled ? 'text-slate-600 line-through' : 'text-slate-200 font-semibold')}>{wh ? wh.name : <span className="italic text-slate-400">—</span>}</div>
                {seeCosts && (
                  <div className={'text-sm font-mono font-extrabold ' + (isCancelled ? 'text-slate-600 line-through' : 'text-slate-100')}>
                    {g.totalCost > 0 ? g.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 }) : <span className="italic text-slate-400 font-normal">—</span>}
                  </div>
                )}
                <div className="text-right flex justify-end gap-1 flex-wrap">
                  {/* v55.83-A.6.27.35 — Edit button: any non-finalized, non-cancelled receipt; Edit Inventory perm */}
                  {canEdit && !isCancelled && !isFinalized && (
                    <button
                      onClick={function () { openEdit(g); }}
                      className="px-2 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-bold border border-slate-700"
                      title="Edit this receipt — change header, lines, rolls, costs"
                    >
                      ✏️ Edit
                    </button>
                  )}
                  {canEdit && isMergeTarget(g) && !isUnmergedTarget(g) && (
                    <button
                      onClick={function (e) { e.stopPropagation(); setUnmergeConfirmText(''); setUnmergeNotes(''); setUnmergeTarget(g); loadUnmergeData(g); }}
                      className="px-2 py-1 text-[10px] bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 rounded font-bold border border-violet-600/40"
                      title="Reverse this merge — restore the original source shipments"
                    >
                      ⎘ Unmerge
                    </button>
                  )}
                  {/* v55.83-A.6.27.35 — Reopen button: finalized receipts only, super_admin only */}
                  {(isSuperAdmin || canEdit) && isFinalized && (
                    <button
                      onClick={function () { reopenReceipt(g); }}
                      className="px-2 py-1 text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded font-bold border border-amber-600/40"
                      title="Edit this finalized shipment — reverses its cost layer so you can change it, then re-finalize"
                    >
                      🔓 Edit (reopen)
                    </button>
                  )}
                  {/* v55.83-A.6.27.33 — Finalize Cost button opens landed-cost dialog */}
                  {canEdit && !isCancelled && !isFinalized && seeCosts && g.status === 'received' && (
                    <button
                      onClick={function () { setFinalizeTarget(g); }}
                      className="px-2 py-1 text-[10px] bg-blue-100 hover:bg-blue-200 text-blue-900 rounded font-bold"
                      title="Add freight / customs / duty / insurance / clearing costs and allocate them across all lines"
                    >
                      Finalize Cost
                    </button>
                  )}
                  {canEdit && !isCancelled && (
                    <button
                      onClick={function () { setCancelTarget(g); setCancelReason(''); }}
                      className="px-2 py-1 text-[10px] bg-red-100 hover:bg-red-200 text-red-900 rounded font-bold"
                      title="Cancel this receipt (greys out, doesn't count toward stock)"
                    >
                      Cancel
                    </button>
                  )}
                  {isSuperAdmin && (
                    <button
                      onClick={function () { deleteShipment(g); }}
                      className="px-2 py-1 text-[10px] bg-red-700 hover:bg-red-600 text-white rounded font-bold border border-red-800"
                      title="Permanently delete this shipment (super-admin only). Use Cancel to keep a record instead."
                    >
                      🗑 Delete
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
          className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-start justify-center"
          onClick={closeModal}
          style={{ padding: 6 }}
        >
          <div
            className="bg-slate-950 text-slate-100 rounded-2xl shadow-2xl"
            onClick={function (e) { e.stopPropagation(); }}
            style={{ width: '99vw', maxWidth: 'none', height: 'calc(100vh - 12px)', maxHeight: 'calc(100vh - 12px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            {/* v55.83-A.6.27.72 HOTFIX 21+23 — Max May 27 2026 screenshots: form
                appearing short with bottom buttons scrolled off below the fold;
                then after the height fix, the modal centered vertically and
                pushed its TOP off-screen above the viewport.
                Combined fix:
                  (1) outer overlay = `flex items-start` (HOTFIX 23: anchor to
                      TOP, not center — modal title + first fields always
                      visible when it opens)
                  (2) inner box gets `overflow: hidden` + Region 1 max-height
                  (3) footer (Region 3) gets `flexShrink: 0` so it can never
                      be compressed off-screen
                Net effect: modal opens at top of viewport, fills 99vh, Region 2
                (product lines) scrolls; footer always visible at bottom. */}
            <div
              className="rounded-t-2xl flex justify-between items-center gap-2"
              style={{ background: '#3730a3', padding: '14px 20px', flexShrink: 0 }}
            >
              <div>
                <div className="text-lg font-extrabold" style={{ color: '#ffffff' }}>🚚 {editingReceiptNumber ? 'Edit Receipt ' + editingReceiptNumber : 'New Stock Receipt'}
                  {autosaveStatus ? <span className="ml-2 align-middle text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: autosaveStatus === 'Saving…' ? '#1e3a8a' : '#14532d', color: '#ffffff' }}>{autosaveStatus === 'Saving…' ? '⏳ ' : '✅ '}{autosaveStatus}</span> : null}
                </div>
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

            {/* v55.83-A.6.27.56 — 3-region modal layout:
                Region 1 (this div): non-scrolling top — Shipment Info form (collapsible)
                Region 2 (next div): scrollable middle — only Product Lines scroll
                Region 3: existing footer (Cancel/Save Draft/Submit) stays sticky at bottom

                Why: previously the entire modal scrolled as one block, so the Shipment
                Info form got pushed off-screen once you added 2-3 product lines. Now you
                can keep adding lines without losing sight of the header or the Save button.

                v55.83-A.6.27.72 HOTFIX 21 — Cap Region 1 max-height at 45vh so the
                Expected Totals block + collapsible header can NEVER eat all the room.
                If a user fully expands Shipment Info, Region 1 internally scrolls
                instead of pushing the footer off-screen. */}
            {(function () {
              var step1Done = !!(header.expected_total_rolls || header.expected_total_gross_kg || header.expected_total_uom || header.supplier || header.shipment_reference || header.container_number);
              var step2Done = lines.some(function (l) { return l.product_id && (Number(l.quantity) > 0 || Number(l.roll_count) > 0 || (l.rolls && l.rolls.length > 0)); });
              var steps = [
                { n: 1, en: 'STEP 1 — Nexpac / Expected', ar: 'الخطوة ١ — تقرير نكسباك / المتوقع', done: step1Done },
                { n: 2, en: 'STEP 2 — Actual Received', ar: 'الخطوة ٢ — المستلم الفعلي', done: step2Done },
                { n: 3, en: 'STEP 3 — Variance / Reconcile', ar: 'الخطوة ٣ — مراجعة الفروقات', done: step2Done },
                { n: 4, en: 'STEP 4 — Submit / Finalize', ar: 'الخطوة ٤ — إرسال / اعتماد', done: step1Done && step2Done }
              ];
              return (
                <div style={{ padding: '10px 20px 0', flexShrink: 0 }}>
                  <div className="flex flex-wrap gap-1.5">
                    {steps.map(function (st) {
                      var active = openStep === st.n;
                      var warn = submitAttempted && !st.done;
                      return (
                        <button key={st.n} type="button" onClick={function () { setOpenStep(active ? 0 : st.n); }}
                          className={'flex-1 min-w-[150px] text-left rounded-lg px-2.5 py-1.5 border transition-colors ' + (active ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700')}>
                          <div className="flex items-center gap-1 text-[11px] font-extrabold"><span>{st.done ? '✅' : (warn ? '⚠️' : '⬜')}</span><span className="truncate">{st.en}</span><span className="ml-auto">{active ? '▾' : '▸'}</span></div>
                          <div className="text-[10px] opacity-80" dir="rtl">{st.ar}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {openStep === 1 && (
            <div style={{ padding: '20px 20px 0 20px', flexShrink: 0, borderBottom: '1px solid #e2e8f0', maxHeight: '45vh', overflowY: 'auto' }}>
              {/* v55.83-CX — Prominent NEXPAC import at the TOP of Step 1 so it's the first thing seen (no scrolling). */}
              <div className="mb-3 rounded-lg border border-indigo-500/40 bg-indigo-950/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-extrabold text-indigo-100">📥 Start here — Import NEXPAC report</div>
                    <div className="text-[11px] text-indigo-300">ابدأ هنا — استورد تقرير نكسباك · auto-fills expected rolls &amp; weights. Or enter the shipment details below manually.</div>
                  </div>
                  <label className={'shrink-0 px-4 py-2 rounded-lg text-sm font-extrabold cursor-pointer ' + (nexpacReady && !nexpacBusy ? 'bg-indigo-500 hover:bg-indigo-400 text-white' : 'bg-slate-700 text-slate-400 cursor-wait')}
                    title="Read a NEXPAC report PDF and fill the expected rolls and weights automatically">
                    {nexpacBusy ? 'Reading…' : (nexpacReady ? '📥 Import NEXPAC report' : 'Loading reader…')}
                    <input type="file" accept="application/pdf,.pdf" disabled={!nexpacReady || nexpacBusy} className="hidden"
                      onChange={function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; handleNexpacImport(f); }} />
                  </label>
                </div>
                {nexpacErr && <div className="mt-2 bg-red-100 border border-red-300 text-red-950 text-xs font-semibold rounded px-3 py-1.5">{nexpacErr}</div>}
                {nexpacPreview && (
                  <div className="mt-2 bg-emerald-100 text-emerald-950 rounded px-3 py-1.5 text-xs font-semibold flex flex-wrap items-center justify-between gap-2">
                    <span>✅ Loaded{nexpacPreview.header && nexpacPreview.header.releaseNumber ? ' · Release ' + nexpacPreview.header.releaseNumber : ''}{nexpacPreview.header && nexpacPreview.header.containerNumber ? ' · ' + nexpacPreview.header.containerNumber : ''}</span>
                    <span>{nexpacPreview.totals ? (nexpacPreview.totals.totalRolls + ' rolls · ' + Number(nexpacPreview.totals.finalNetWeightKg || 0).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' kg net') : ''} · {(nexpacPreview.lines || []).length} line(s) — details in Expected Totals below</span>
                  </div>
                )}
              </div>
              {/* Header section — v55.83-A.6.27.32 extended with old Shipments form fields
                  v55.83-A.6.27.56 — collapsible header */}
              <div className="mb-3 bg-slate-900/60 rounded-lg border border-slate-700">
                <button
                  onClick={function () { setHeaderCollapsed(!headerCollapsed); }}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-800 transition-colors rounded-t-lg"
                  title={headerCollapsed ? 'Click to expand Shipment Info' : 'Click to collapse Shipment Info and give product lines more space'}
                >
                  <div className="text-[11px] font-extrabold text-slate-300 tracking-wider">
                    {headerCollapsed ? '▶' : '▼'} SHIPMENT INFO (applies to all lines)
                    {headerCollapsed && header.shipment_reference && (
                      <span className="ml-2 font-mono font-bold text-indigo-700">{header.shipment_reference}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 font-semibold">{headerCollapsed ? 'expand' : 'collapse'}</span>
                </button>
                {!headerCollapsed && (
                <div className="px-3 pb-3">

                {/* Row 1: reference + warehouse + receipt date + container # */}
                <div className="grid grid-cols-4 gap-2 mb-2">
                  <label className="text-[11px] font-extrabold text-slate-300">Shipment Reference *
                    <input
                      type="text"
                      value={header.shipment_reference}
                      onChange={function (e) { setHeader(Object.assign({}, header, { shipment_reference: e.target.value })); }}
                      placeholder="e.g. KTC-2026-042"
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500 font-mono"
                    />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-300">Warehouse *
                    <select value={header.warehouse_id} onChange={function (e) { setHeader(Object.assign({}, header, { warehouse_id: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500">
                      <option value="">— pick warehouse —</option>
                      {warehouses.map(function (w) {
                        return <option key={w.id} value={w.id}>{w.name}</option>;
                      })}
                    </select>
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-300">Receipt Date
                    <input type="date" value={header.receipt_date} onChange={function (e) { setHeader(Object.assign({}, header, { receipt_date: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-300">Container #
                    <input type="text" value={header.container_number} onChange={function (e) { setHeader(Object.assign({}, header, { container_number: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
                  </label>
                </div>

                {/* Row 2: supplier + freight forwarder + shipping line + purchase currency */}
                <div className="grid grid-cols-4 gap-2 mb-2">
                  <label className="text-[11px] font-extrabold text-slate-300">Default Supplier
                    <input type="text" value={header.supplier} onChange={function (e) { setHeader(Object.assign({}, header, { supplier: e.target.value })); }} placeholder="e.g. ABC Suppliers" className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-300">Freight Forwarder
                    <input type="text" value={header.freight_forwarder} onChange={function (e) { setHeader(Object.assign({}, header, { freight_forwarder: e.target.value })); }} placeholder="e.g. DHL" className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-300">Shipping Line
                    <input type="text" value={header.shipping_line} onChange={function (e) { setHeader(Object.assign({}, header, { shipping_line: e.target.value })); }} placeholder="e.g. Maersk" className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-300">Purchase Currency
                    <select value={header.purchase_currency} onChange={function (e) { setHeader(Object.assign({}, header, { purchase_currency: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500">
                      <option value="EGP">EGP</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </label>
                  {/* v55.83-A (Max Jun 1 2026) — Origin Country is a CONSCIOUS choice now
                      (was silently defaulting to US). Pick where THIS batch actually came from
                      so US-vs-Canada intake is tracked correctly. */}
                  <label className="text-[11px] font-extrabold text-slate-300">Origin Country (where this batch came from)
                    <select value={header.origin_country_code || ''} onChange={function (e) { setHeader(Object.assign({}, header, { origin_country_code: e.target.value })); }} className={'w-full mt-0.5 px-2 py-1.5 border rounded text-sm bg-slate-800 text-slate-100 ' + ((!header.origin_country_code) ? 'border-amber-400' : 'border-slate-600')}>
                      <option value="">— Select country —</option>
                      <option value="US">🇺🇸 United States</option>
                      <option value="CA">🇨🇦 Canada</option>
                      <option value="EG">🇪🇬 Egypt</option>
                      <option value="CN">🇨🇳 China</option>
                      <option value="TR">🇹🇷 Turkey</option>
                      <option value="IT">🇮🇹 Italy</option>
                      <option value="KR">🇰🇷 South Korea</option>
                    </select>
                  </label>
                </div>

                {/* Row 3: ETA + arrival */}
                <div className="grid grid-cols-4 gap-2">
                  <label className="text-[11px] font-extrabold text-slate-300">ETA Date
                    <input type="date" value={header.eta_date} onChange={function (e) { setHeader(Object.assign({}, header, { eta_date: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
                  </label>
                  <label className="text-[11px] font-extrabold text-slate-300">Arrival Date
                    <input type="date" value={header.arrival_date} onChange={function (e) { setHeader(Object.assign({}, header, { arrival_date: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
                  </label>
                </div>

                <label className="text-[11px] font-extrabold text-slate-300 block mt-2">Shipment Notes
                  <textarea value={header.notes} onChange={function (e) { setHeader(Object.assign({}, header, { notes: e.target.value })); }} rows={1} className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500 resize-none" />
                </label>
              </div>
              )}

              {/* v55.83-A.6.27.43 — SHIPMENT EXPECTED TOTALS (per supplier docs)
                  Big, prominent, can't-miss. Optional during Draft, required at Submit.
                  v55.83-A.6.27.48 — widened: more padding + larger inputs to use the full modal width.
                  v55.83-A.6.27.56 — NOT collapsible (small and important; stays visible). */}
              <div className="bg-slate-800/50 border border-violet-500/40 border-l-4 border-l-violet-500 rounded-xl p-6 mt-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] font-extrabold tracking-widest text-violet-300">🅰 CONTAINER SHELL · FROM SHIPPING DOCUMENTS</div>
                  <button type="button" onClick={function () { setShellCollapsed(!shellCollapsed); }} className="text-[10px] font-bold bg-violet-700 hover:bg-violet-600 text-white rounded px-2 py-0.5">{shellCollapsed ? 'Expand ▾' : 'Collapse ▴'}</button>
                </div>
                {shellCollapsed && (
                  <div className="text-sm font-bold text-slate-200">📦 Expected: {header.expected_total_rolls === '' ? '—' : header.expected_total_rolls} rolls · {header.expected_total_gross_kg === '' ? '—' : header.expected_total_gross_kg} kg gross · {header.expected_total_uom === '' ? '—' : header.expected_total_uom} {header.expected_uom_type || 'kg'}</div>
                )}
                <div style={shellCollapsed ? { display: 'none' } : undefined}>
                <div className="flex items-baseline justify-between mb-4">
                  <div>
                    <div className="text-lg font-extrabold text-slate-100">📦 Shipment Expected Totals</div>
                    <div className="text-sm text-slate-400 font-medium mt-0.5">
                      What the supplier&apos;s shipping documents say came in this container.
                      Per-product details go in the lines below. We reconcile at the bottom.
                    </div>
                  </div>
                  <label className={'shrink-0 px-3 py-2 rounded-lg text-sm font-extrabold cursor-pointer self-start ' + (nexpacReady && !nexpacBusy ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-700 text-slate-400 cursor-wait')}
                    title="Read a NEXPAC report PDF and fill the expected rolls and weights automatically">
                    {nexpacBusy ? 'Reading…' : (nexpacReady ? '📥 Import NEXPAC report' : 'Loading reader…')}
                    <input type="file" accept="application/pdf,.pdf" disabled={!nexpacReady || nexpacBusy} className="hidden"
                      onChange={function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; handleNexpacImport(f); }} />
                  </label>
                </div>
                {nexpacErr && <div className="mb-3 bg-red-100 border border-red-300 text-red-950 text-sm font-semibold rounded px-3 py-2">{nexpacErr}</div>}
                <div className="grid grid-cols-5 gap-4">
                  <label className="text-sm font-extrabold text-slate-100 block">Expected Total Rolls
                    <input
                      type="number"
                      step="1"
                      value={header.expected_total_rolls}
                      onChange={function (e) { setHeader(Object.assign({}, header, { expected_total_rolls: e.target.value })); }}
                      placeholder="e.g. 23"
                      className="w-full mt-1 px-3 py-2.5 border-2 border-slate-600 rounded text-base bg-slate-800 text-slate-100 font-bold focus:border-violet-500 outline-none"
                    />
                  </label>
                  <label className="text-sm font-extrabold text-slate-100 block">Expected Gross Weight (kg)
                    <input
                      type="number"
                      step="0.001"
                      value={header.expected_total_gross_kg}
                      onChange={function (e) { setHeader(Object.assign({}, header, { expected_total_gross_kg: e.target.value })); }}
                      placeholder="e.g. 5750.000"
                      className="w-full mt-1 px-3 py-2.5 border-2 border-slate-600 rounded text-base bg-slate-800 text-slate-100 font-bold focus:border-violet-500 outline-none"
                    />
                  </label>
                  <label className="text-sm font-extrabold text-slate-100 block">Expected Net Weight (kg) <span className="text-[10px] font-bold text-slate-500">· reference only — not reconciled</span>
                    <input
                      type="number"
                      step="0.001"
                      value={header.expected_total_net_kg}
                      onChange={function (e) { setHeader(Object.assign({}, header, { expected_total_net_kg: e.target.value })); }}
                      placeholder="e.g. 5400.000"
                      className="w-full mt-1 px-3 py-2.5 border-2 border-slate-600 rounded text-base bg-slate-800 text-slate-100 font-bold focus:border-violet-500 outline-none"
                    />
                  </label>
                  <label className="text-sm font-extrabold text-slate-100 block">Expected Total UOM
                    <input
                      type="number"
                      step="0.001"
                      value={header.expected_total_uom}
                      onChange={function (e) { setHeader(Object.assign({}, header, { expected_total_uom: e.target.value })); }}
                      placeholder="optional"
                      className="w-full mt-1 px-3 py-2.5 border-2 border-slate-600 rounded text-base bg-slate-800 text-slate-100 font-bold focus:border-violet-500 outline-none"
                    />
                  </label>
                  <label className="text-sm font-extrabold text-slate-100 block">UOM Type
                    <select
                      value={header.expected_uom_type || 'kg'}
                      onChange={function (e) { setHeader(Object.assign({}, header, { expected_uom_type: e.target.value })); }}
                      className="w-full mt-1 px-3 py-2.5 border-2 border-slate-600 rounded text-base bg-slate-800 text-slate-100 font-bold focus:border-violet-500 outline-none"
                    >
                      <option value="kg">kg</option>
                      <option value="meter">meter</option>
                      <option value="yard">yard</option>
                      <option value="piece">piece</option>
                      <option value="sqm">square meter</option>
                    </select>
                  </label>
                </div>
                {nexpacPreview && (
                  <div className="mt-4 bg-slate-900/60 border border-slate-700 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-slate-800 text-slate-200 text-xs font-extrabold flex items-center justify-between gap-2">
                      <span>📥 From NEXPAC report{nexpacPreview.header.releaseNumber ? ' · Release ' + nexpacPreview.header.releaseNumber : ''}{nexpacPreview.header.containerNumber ? ' · ' + nexpacPreview.header.containerNumber : ''}</span>
                      <span className="shrink-0">{nexpacPreview.totals.totalRolls} rolls · {Number(nexpacPreview.totals.finalNetWeightKg).toLocaleString('en-US', { maximumFractionDigits: 1 })} kg net</span>
                    </div>
                    {nexpacPreview.warnings && nexpacPreview.warnings.length > 0 && (
                      <div className="px-3 py-1.5 bg-slate-800/60 text-slate-300 text-[11px] font-semibold">
                        {nexpacPreview.warnings.map(function (w, i) { return <div key={i}>⚠️ {w}</div>; })}
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-slate-700 bg-slate-800/50">
                          <th className="px-3 py-1.5 text-left font-extrabold text-slate-300">KTC Grade</th>
                          <th className="px-3 py-1.5 text-left font-extrabold text-slate-300">Color</th>
                          <th className="px-3 py-1.5 text-right font-extrabold text-slate-300">Rolls</th>
                          <th className="px-3 py-1.5 text-right font-extrabold text-slate-300">Net (kg)</th>
                        </tr></thead>
                        <tbody>
                          {nexpacPreview.lines.map(function (g, i) {
                            return (
                              <tr key={i} className="border-b border-slate-800">
                                <td className="px-3 py-1.5 text-slate-100 font-bold">{g.ktcGrade || '—'}{g.ntGrade ? <span className="text-[9px] text-slate-400 font-normal block">{g.ntGrade}</span> : null}</td>
                                <td className="px-3 py-1.5 text-slate-200 font-semibold">{g.color || '—'}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-slate-200">{g.totalRolls}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-slate-200">{Number(g.finalNetWeightKg).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-3 py-1.5 text-[10px] text-slate-400 bg-transparent">The totals above were auto-filled from this report. This breakdown is the expected detail to check your product lines against. Inventory is not affected until you receive the shipment.</div>
                  </div>
                )}
                </div>
                </div>
              </div>
            </div>
            )}

            {openStep === 2 && (
            <div className="bg-slate-950/50 border-t-2 border-indigo-500/30" style={{ padding: '12px 20px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {/* Lines */}
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-[10px] font-extrabold tracking-widest text-indigo-300">🅱 PRODUCTS RECEIVED · PER-PRODUCT DETAIL</div>
                  <div className="text-[11px] font-extrabold text-slate-300 tracking-wider">PRODUCT LINES ({lines.length})</div>
                </div>
                {lines.length > 1 && (
                  <div className="flex gap-1.5">
                    <button type="button" onClick={function () { var m = {}; lines.forEach(function (_, i) { m[i] = true; }); setCollapsedLines(m); }} className="text-[10px] font-bold bg-slate-700 hover:bg-slate-600 text-white rounded px-2 py-0.5">Collapse all</button>
                    <button type="button" onClick={function () { setCollapsedLines({}); }} className="text-[10px] font-bold bg-slate-700 hover:bg-slate-600 text-white rounded px-2 py-0.5">Expand all</button>
                  </div>
                )}
              </div>
              {isSuperAdmin && (
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 mb-2 cursor-pointer w-fit">
                  <input type="checkbox" checked={includeTemplates} onChange={function (e) { setIncludeTemplates(e.target.checked); }} />
                  Include templates &amp; archived in product search (admin)
                </label>
              )}

              {lines.map(function (line, lineIdx) {
                var suggestions = suggestionsFor(line.quickCodeQuery);
                return (
                  <div key={lineIdx} className="bg-slate-900/70 rounded-xl mb-4 shadow-md border border-slate-700">
                    <div className="flex justify-between items-center px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 rounded-t-xl">
                      <div className="text-sm font-extrabold text-white flex items-center gap-2 flex-wrap">
                        <button type="button" onClick={function () { toggleLineCollapsed(lineIdx); }} title={collapsedLines[lineIdx] ? 'Expand line' : 'Collapse line'} className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/20 hover:bg-white/35 text-white text-xs">{collapsedLines[lineIdx] ? '►' : '▼'}</button>
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-white text-xs">{lineIdx + 1}</span>
                        {line.product ? (line.product.name_en || line.product.quick_code) : 'New product line'}
                        {collapsedLines[lineIdx] && (
                          <span className="text-[11px] font-bold text-indigo-100">
                            · {(line.roll_count === '' || line.roll_count == null) ? 0 : line.roll_count} rolls · {(line.quantity === '' || line.quantity == null) ? 0 : line.quantity} {line.uom || ''}
                            {line.quantity_kg && String(line.uom || '').toLowerCase() !== 'kg' ? ' · ' + line.quantity_kg + ' kg' : ''}
                            {line.merged_source_breakdown && line.merged_source_breakdown.length ? <span className="ml-1 px-1.5 py-0.5 bg-violet-500/40 text-violet-50 rounded text-[10px]">⎘ Sources: {line.merged_source_breakdown.length}</span> : null}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        {lines.length > 1 && (
                          <button onClick={function () { removeLine(lineIdx); }} className="px-2.5 py-1 text-[10px] bg-white/15 hover:bg-red-500 text-white rounded font-bold transition-colors">Remove</button>
                        )}
                        <button onClick={function () { duplicateLine(lineIdx); }} className="px-2.5 py-1 text-[10px] bg-white/15 hover:bg-white/30 text-white rounded font-bold transition-colors">Duplicate</button>
                      </div>
                    </div>
                    <div className="p-4" style={collapsedLines[lineIdx] ? { display: 'none' } : undefined}>
                    {line.merged_source_breakdown && line.merged_source_breakdown.length > 0 && (
                      <div className="mb-3 rounded-lg border border-violet-300 bg-violet-50">
                        <div className="px-3 py-1.5 text-[11px] font-extrabold text-violet-900 border-b border-violet-200 flex items-center justify-between">
                          <span>⎘ Merged from {line.merged_source_breakdown.length} source line(s) — read-only audit</span>
                          <span className="flex items-center gap-2">
                            {line.merge_group_id ? <span className="font-mono text-[9px] text-violet-700">{line.merge_group_id}</span> : null}
                            {line.merge_group_id ? <button type="button" onClick={function () { openMergeAudit(line.merge_group_id); }} className="px-2 py-0.5 bg-violet-700 hover:bg-violet-800 text-white text-[10px] font-bold rounded">View Merge Audit</button> : null}
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px] text-slate-900">
                            <thead><tr className="bg-violet-100 text-violet-900"><th className="px-2 py-1 text-left">Source shipment</th><th className="px-2 py-1 text-left">Line ID</th><th className="px-2 py-1 text-right">Rolls</th><th className="px-2 py-1 text-right">Qty</th><th className="px-2 py-1 text-left">UOM</th><th className="px-2 py-1 text-right">KG</th><th className="px-2 py-1 text-left">Status</th><th className="px-2 py-1 text-left">Notes</th></tr></thead>
                            <tbody>
                              {line.merged_source_breakdown.map(function (sb, si) {
                                return <tr key={si} className="border-t border-violet-200"><td className="px-2 py-1 font-mono">{sb.receipt_number || '—'}</td><td className="px-2 py-1 font-mono text-[9px] text-slate-500">{sb.line_id || '—'}</td><td className="px-2 py-1 text-right">{sb.roll_count || 0}</td><td className="px-2 py-1 text-right">{sb.quantity || 0}</td><td className="px-2 py-1">{sb.uom || '—'}</td><td className="px-2 py-1 text-right">{sb.quantity_kg || 0}</td><td className="px-2 py-1">{sb.status || '—'}</td><td className="px-2 py-1">{sb.notes || ''}</td></tr>;
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Quick-code field with autocomplete.
                        v55.83-F (Max Jun 1 2026) — dropdown was rendering BEHIND the form
                        (z-10 trapped under sibling cards). Container gets a high z-index while
                        open so the results float in front and are clickable. */}
                    <div className={'mb-2 relative ' + (line.showSuggestions && suggestions.length > 0 ? 'z-[80]' : '')}>
                      <label className="text-[11px] font-extrabold text-slate-300 block">Quick code or product name *
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
                          className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm font-mono bg-slate-800 text-slate-100 placeholder-slate-500"
                        />
                      </label>
                      {line.showSuggestions && suggestions.length > 0 && (
                        <div className="absolute z-[90] left-0 right-0 mt-1 bg-slate-800 border-2 border-indigo-500 rounded-lg shadow-2xl max-h-72 overflow-auto ring-1 ring-black/10">
                          {suggestions.map(function (s) {
                            // v55.83-A.6.27.39 — show ⭐ for featured + variant suffix + use_count badge
                            var displayCode = s.variant_suffix ? (s.quick_code + '-' + s.variant_suffix) : s.quick_code;
                            return (
                              <button
                                key={s.id}
                                onClick={function () { pickProductForLine(lineIdx, s); }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-900/40 active:bg-indigo-900/60 border-b border-slate-700 last:border-0 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  {s.featured === true && <span title="Featured" className="text-amber-500">⭐</span>}
                                  <span className="font-mono font-extrabold text-slate-100">{displayCode || '(no code)'}</span>
                                  {s.is_family_template === true && <span className="text-[9px] bg-indigo-200 text-indigo-900 font-bold rounded px-1.5">TEMPLATE</span>}
                                  {s.is_family_template === false && s.variant_suffix && <span className="text-[9px] bg-emerald-200 text-emerald-900 font-bold rounded px-1.5">PRODUCT</span>}
                                  {Number(s.use_count || 0) > 0 && <span className="text-[10px] text-slate-400 font-bold ml-auto">used {s.use_count}×</span>}
                                </div>
                                <div className="text-slate-800 font-semibold">{s.name_en} / <span style={{ direction: 'rtl' }}>{s.name_ar}</span></div>
                                <div className="text-[10px] text-slate-400 font-mono font-semibold">{s.classification_slug}</div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {line.product && (
                      <>
                        {/* Product header (read-only) */}
                        <div className="bg-indigo-950/40 border border-indigo-800 rounded px-2 py-1.5 mb-2 text-[11px] text-slate-200">
                          <div className="font-extrabold text-indigo-900">{line.product.name_en} / <span style={{ direction: 'rtl' }}>{line.product.name_ar}</span></div>
                          <div className="font-mono text-indigo-700">Classification: {line.product.classification_slug}</div>
                          {line.product.is_family_template === true && (
                            <div className="font-bold text-amber-700 mt-1">⚠ Family template — fill the 4 spec dropdowns below to create or match a variant</div>
                          )}
                        </div>

                        {/* v55.83-A.6.27.39 — VARIANT SPEC DROPDOWNS (only for family templates) */}
                        {line.product.is_family_template === true && (
                          <div className="bg-purple-50 border-2 border-purple-300 rounded p-2 mb-2">
                            <div className="text-[11px] font-extrabold text-purple-900 tracking-wider mb-1">🎯 VARIANT SPECS — fill in to identify the exact product variant</div>
                            <div className="text-[10px] text-purple-800 mb-2 italic">Each combination creates a unique variant (e.g. {line.product.quick_code}-001). System reuses an existing variant if specs match.</div>
                            <div className="grid grid-cols-4 gap-2">
                              <label className="text-[11px] font-extrabold text-purple-900">Category *
                                <select value={line.variant_category_code} onChange={function (e) { updateLineField(lineIdx, 'variant_category_code', e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border border-purple-500 rounded text-sm bg-slate-800 text-slate-100">
                                  <option value="">— pick —</option>
                                  <option value="SM">SM · Smooth</option>
                                  <option value="EM">EM · Embossed</option>
                                </select>
                              </label>
                              <label className="text-[11px] font-extrabold text-purple-900">Construction *
                                <select value={line.variant_construction_code} onChange={function (e) { updateLineField(lineIdx, 'variant_construction_code', e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border border-purple-500 rounded text-sm bg-slate-800 text-slate-100">
                                  <option value="">— pick —</option>
                                  <option value="RG">RG · Regular</option>
                                  <option value="PF">PF · Perforated</option>
                                  <option value="FN">FN · Foam Non-Perforated</option>
                                  <option value="FP">FP · Foam Perforated</option>
                                  <option value="TL">TL · Tri-Lam</option>
                                </select>
                              </label>
                              <label className="text-[11px] font-extrabold text-purple-900">Backing *
                                <select value={line.variant_backing_code} onChange={function (e) { updateLineField(lineIdx, 'variant_backing_code', e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border border-purple-500 rounded text-sm bg-slate-800 text-slate-100">
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
                              <label className="text-[11px] font-extrabold text-purple-900">Pattern *
                                <select value={line.variant_pattern_code} onChange={function (e) { updateLineField(lineIdx, 'variant_pattern_code', e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border border-purple-500 rounded text-sm bg-slate-800 text-slate-100">
                                  <option value="">— pick —</option>
                                  <option value="NA">NA · None</option>
                                  <option value="HC">HC · Honeycomb</option>
                                  <option value="MG">MG · Mechanical Grain</option>
                                  <option value="RG">RG · Normal Emboss</option>
                                </select>
                              </label>
                            </div>
                            {/* v55.83-A.6.27.39 — Smooth-Black soft warning (overridable) */}
                            {line.variant_category_code === 'SM' && line.product && (function () {
                              var colorCode = (line.product.classification_slug || '').split('-')[5] || '';
                              if (colorCode && colorCode !== 'BK') {
                                return (
                                  <div className="mt-2 bg-yellow-100 border border-yellow-400 rounded px-2 py-1.5 text-[11px] text-yellow-900">
                                    <span className="font-extrabold">⚠ Heads up:</span> Smooth leather is typically only available in Black, but you picked color <span className="font-mono font-bold">{colorCode}</span>. You can still proceed if this is correct.
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        )}

                        {/* v55.83-A.6.27.55 — REMOVED per-line PHASE 1 EXPECTED TOTALS box.
                            Max repeatedly asked for this. The shipment-level Expected Totals
                            card at the top of the modal is the one that matters. Per-line
                            expected_* fields still exist in state + DB for back-compat with
                            older receipts; they're just no longer surfaced in the UI. */}

                        {/* v55.83-A.6.27.35 — PHASE 2: Individual rolls + variance summary */}
                        {(function () {
                          var rolls = line.rolls || [];
                          // Variance computations
                          var rollSumGross = rolls.reduce(function (a, r) { return a + (Number(r.gross_kg) || 0); }, 0);
                          var rollSumNet = rolls.reduce(function (a, r) { return a + (Number(r.net_kg) || 0); }, 0);
                          var rollSumMeters = rolls.reduce(function (a, r) { return a + (Number(r.meters) || 0); }, 0);
                          var expRolls = Number(line.expected_rolls) || null;
                          var expGross = Number(line.expected_gross_kg) || null;
                          var expNet = Number(line.expected_net_kg) || null;
                          var expMeters = Number(line.expected_uom_total) || null;
                          var hasAnyVariance =
                            (expRolls != null && rolls.length !== expRolls) ||
                            (expGross != null && Math.abs(rollSumGross - expGross) > 0.01) ||
                            (expNet != null && rollSumNet > 0 && Math.abs(rollSumNet - expNet) > 0.01) ||
                            (expMeters != null && Math.abs(rollSumMeters - expMeters) > 0.01);

                          return (
                            <div className="bg-blue-50 border-2 border-blue-300 rounded p-2 mb-2">
                              <div className="flex justify-between items-center mb-1">
                                <div className="text-[11px] font-extrabold text-blue-900 tracking-wider">📦 PHASE 2 — INDIVIDUAL ROLLS ({rolls.length})</div>
                                <button
                                  onClick={function () {
                                    var newRolls = (line.rolls || []).slice();
                                    newRolls.push({ roll_number: '', gross_kg: '', net_kg: '', meters: '', rack: line.rack || '', notes: '' });
                                    updateLineField(lineIdx, 'rolls', newRolls);
                                  }}
                                  className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded font-extrabold"
                                >+ Add Roll</button>
                              </div>
                              <div className="text-[10px] text-blue-800 mb-2 italic">Add each physical roll as it arrives. Variance vs expected is shown below.</div>

                              {rolls.length === 0 ? (
                                <div className="text-[11px] italic text-blue-700 text-center py-2">No rolls entered yet. Click "+ Add Roll" once physical units arrive.</div>
                              ) : (
                                <div className="space-y-1">
                                  {/* Roll header */}
                                  <div className="grid gap-1 text-[10px] font-extrabold text-blue-900 tracking-wider px-1" style={{ gridTemplateColumns: '40px 110px 90px 90px 90px 90px 1fr 40px' }}>
                                    <div>#</div>
                                    <div>Roll #</div>
                                    <div>Gross kg</div>
                                    <div>Net kg</div>
                                    <div>{line.uom || 'UOM'}</div>
                                    <div>Rack</div>
                                    <div>Notes</div>
                                    <div></div>
                                  </div>
                                  {rolls.map(function (r, rIdx) {
                                    return (
                                      <div key={rIdx} className="grid gap-1 items-center bg-slate-800/50 rounded px-1 py-1" style={{ gridTemplateColumns: '40px 110px 90px 90px 90px 90px 1fr 40px' }}>
                                        <div className="text-[11px] font-mono font-extrabold text-blue-900">{rIdx + 1}</div>
                                        <input type="text" value={r.roll_number} onChange={function (e) {
                                          var nr = (line.rolls || []).slice(); nr[rIdx] = Object.assign({}, nr[rIdx], { roll_number: e.target.value }); updateLineField(lineIdx, 'rolls', nr);
                                        }} placeholder="release / ID" className="w-full px-1 py-1 border border-slate-600 rounded text-xs bg-slate-800 text-slate-100 placeholder-slate-500 font-mono" />
                                        <input type="text" value={r.gross_kg} onChange={function (e) {
                                          var nr = (line.rolls || []).slice(); nr[rIdx] = Object.assign({}, nr[rIdx], { gross_kg: e.target.value }); updateLineField(lineIdx, 'rolls', nr);
                                        }} placeholder="0.00" className="w-full px-1 py-1 border border-slate-600 rounded text-xs bg-slate-800 text-slate-100 placeholder-slate-500 font-mono" />
                                        <input type="text" value={r.net_kg} onChange={function (e) {
                                          var nr = (line.rolls || []).slice(); nr[rIdx] = Object.assign({}, nr[rIdx], { net_kg: e.target.value }); updateLineField(lineIdx, 'rolls', nr);
                                        }} placeholder="0.00" className="w-full px-1 py-1 border border-slate-600 rounded text-xs bg-slate-800 text-slate-100 placeholder-slate-500 font-mono" />
                                        <input type="text" value={r.meters} onChange={function (e) {
                                          var nr = (line.rolls || []).slice(); nr[rIdx] = Object.assign({}, nr[rIdx], { meters: e.target.value }); updateLineField(lineIdx, 'rolls', nr);
                                        }} placeholder="0.00" className="w-full px-1 py-1 border border-slate-600 rounded text-xs bg-slate-800 text-slate-100 placeholder-slate-500 font-mono" />
                                        <input type="text" value={r.rack} onChange={function (e) {
                                          var nr = (line.rolls || []).slice(); nr[rIdx] = Object.assign({}, nr[rIdx], { rack: e.target.value }); updateLineField(lineIdx, 'rolls', nr);
                                        }} placeholder="A-12" className="w-full px-1 py-1 border border-slate-600 rounded text-xs bg-slate-800 text-slate-100 placeholder-slate-500" />
                                        <input type="text" value={r.notes} onChange={function (e) {
                                          var nr = (line.rolls || []).slice(); nr[rIdx] = Object.assign({}, nr[rIdx], { notes: e.target.value }); updateLineField(lineIdx, 'rolls', nr);
                                        }} placeholder="optional" className="w-full px-1 py-1 border border-slate-600 rounded text-xs bg-slate-800 text-slate-100 placeholder-slate-500" />
                                        <button
                                          onClick={function () {
                                            var nr = (line.rolls || []).slice(); nr.splice(rIdx, 1); updateLineField(lineIdx, 'rolls', nr);
                                          }}
                                          className="px-1 py-1 text-[10px] bg-red-100 hover:bg-red-200 text-red-900 rounded font-bold"
                                          title="Remove this roll"
                                        >✕</button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Variance summary panel */}
                              {(rolls.length > 0 || expRolls != null || expGross != null) && (
                                <div className={'mt-2 rounded p-2 border-2 ' + (hasAnyVariance ? 'bg-red-950/40 border-red-700' : 'bg-emerald-950/40 border-emerald-700')}>
                                  <div className={'text-[11px] font-extrabold tracking-wider mb-1 ' + (hasAnyVariance ? 'text-red-900' : 'text-emerald-900')}>
                                    {hasAnyVariance ? '⚠ VARIANCE DETECTED' : '✓ EXPECTED MATCHES ACTUAL'}
                                  </div>
                                  <div className="grid grid-cols-4 gap-2 text-[11px]">
                                    <div>
                                      <div className="font-bold text-slate-300">Rolls</div>
                                      <div className="font-mono">{rolls.length}{expRolls != null && <span className="text-slate-500"> / {expRolls}</span>}</div>
                                      {expRolls != null && rolls.length !== expRolls && (
                                        <div className={'text-[10px] font-extrabold ' + (rolls.length > expRolls ? 'text-emerald-700' : 'text-red-700')}>
                                          {rolls.length > expRolls ? '+' : ''}{rolls.length - expRolls}
                                        </div>
                                      )}
                                    </div>
                                    <div>
                                      <div className="font-bold text-slate-300">Gross kg</div>
                                      <div className="font-mono">{rollSumGross.toLocaleString(undefined, {maximumFractionDigits: 2})}{expGross != null && <span className="text-slate-500"> / {expGross}</span>}</div>
                                      {expGross != null && Math.abs(rollSumGross - expGross) > 0.01 && (
                                        <div className={'text-[10px] font-extrabold ' + (rollSumGross > expGross ? 'text-emerald-700' : 'text-red-700')}>
                                          {rollSumGross > expGross ? '+' : ''}{(rollSumGross - expGross).toFixed(2)}
                                        </div>
                                      )}
                                    </div>
                                    <div>
                                      <div className="font-bold text-slate-300">Net kg</div>
                                      <div className="font-mono">{rollSumNet.toLocaleString(undefined, {maximumFractionDigits: 2})}{expNet != null && <span className="text-slate-500"> / {expNet}</span>}</div>
                                      {expNet != null && rollSumNet > 0 && Math.abs(rollSumNet - expNet) > 0.01 && (
                                        <div className={'text-[10px] font-extrabold ' + (rollSumNet > expNet ? 'text-emerald-700' : 'text-red-700')}>
                                          {rollSumNet > expNet ? '+' : ''}{(rollSumNet - expNet).toFixed(2)}
                                        </div>
                                      )}
                                    </div>
                                    <div>
                                      <div className="font-bold text-slate-300">{line.uom || 'UOM Total'}</div>
                                      <div className="font-mono">{rollSumMeters.toLocaleString(undefined, {maximumFractionDigits: 2})}{expMeters != null && <span className="text-slate-500"> / {expMeters}</span>}</div>
                                      {expMeters != null && Math.abs(rollSumMeters - expMeters) > 0.01 && (
                                        <div className={'text-[10px] font-extrabold ' + (rollSumMeters > expMeters ? 'text-emerald-700' : 'text-red-700')}>
                                          {rollSumMeters > expMeters ? '+' : ''}{(rollSumMeters - expMeters).toFixed(2)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {hasAnyVariance && (
                                    <div className="mt-2 space-y-1">
                                      <label className="text-[11px] font-extrabold text-red-900 block">Variance reason *
                                        <input type="text" value={line.variance_reason} onChange={function (e) { updateLineField(lineIdx, 'variance_reason', e.target.value); }} placeholder="e.g. short shipment / damaged / overage / counting error" className="w-full mt-0.5 px-2 py-1.5 border border-red-500 rounded text-sm bg-slate-800 text-slate-100" />
                                      </label>
                                      <label className="flex items-center gap-1 text-[11px] text-red-800">
                                        <input type="checkbox" checked={line.variance_acknowledged === true} onChange={function (e) { updateLineField(lineIdx, 'variance_acknowledged', e.target.checked); }} />
                                        <span>Acknowledge variance (will be saved with audit trail)</span>
                                      </label>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Quantity row 1: received + uom + release_number
                            v55.83-A (Max Jun 1 2026) — Order Qty removed; reconciliation is top-level only. */}
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <label className="text-[11px] font-extrabold text-slate-300">Quantity Received *
                            <input type="text" value={line.quantity} onChange={function (e) { updateLineField(lineIdx, 'quantity', e.target.value); }} placeholder="required at submit" className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
                          </label>
                          <label className="text-[11px] font-extrabold text-slate-300">Unit of Measure *
                            <select value={line.uom} onChange={function (e) { updateLineField(lineIdx, 'uom', e.target.value); }} className={'w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm text-slate-100 ' + (line.fromMaster.uom ? 'bg-blue-900/40' : 'bg-slate-800')}>
                              <option value="">—</option>
                              {UOM_OPTIONS.map(function (u) { return <option key={u} value={u}>{u}</option>; })}
                            </select>
                          </label>
                          <label className="text-[11px] font-extrabold text-slate-300">Release #
                            <input type="text" value={line.batch_number} onChange={function (e) { updateLineField(lineIdx, 'batch_number', e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
                          </label>
                        </div>

                        {/* v55.83-A (Max Jun 1 2026) — per-line variance reason UI removed.
                            Reconciliation is top-level only (Expected Totals vs received). */}

                        {/* Quantity row 2: qty_kg (conditional required) + roll_count (always required) + rack
                            v55.83-A.6.27.49 — Quantity in Kilos required only when UoM = kg;
                            otherwise optional. Roll count is always required. */}
                        <div className="grid grid-cols-4 gap-2 mb-2">
                          {(function () {
                            var u = String(line.uom || '').trim().toLowerCase();
                            var kgRequired = (u === 'kg' || u === 'kgs' || u === 'kilo' || u === 'kilogram' || u === 'kilograms');
                            return (
                              <label className="text-[11px] font-extrabold text-slate-300">
                                Quantity in Kilos {kgRequired ? '*' : '(optional)'}
                                <input
                                  type="text"
                                  value={line.quantity_kg}
                                  onChange={function (e) { updateLineField(lineIdx, 'quantity_kg', e.target.value); }}
                                  placeholder={kgRequired ? 'required because UoM = kg' : 'optional cross-unit tracking'}
                                  className={'w-full mt-0.5 px-2 py-1.5 border rounded text-sm bg-slate-800 text-slate-100 ' + (kgRequired && (line.quantity_kg === '' || line.quantity_kg == null) ? 'border-red-400' : 'border-slate-600')}
                                />
                              </label>
                            );
                          })()}
                          <label className="text-[11px] font-extrabold text-slate-300">Roll Count *
                            <input
                              type="text"
                              value={line.roll_count}
                              onChange={function (e) { updateLineField(lineIdx, 'roll_count', e.target.value); }}
                              placeholder="required: # of physical rolls"
                              className={'w-full mt-0.5 px-2 py-1.5 border rounded text-sm bg-slate-800 text-slate-100 ' + ((line.roll_count === '' || line.roll_count == null) ? 'border-red-400' : 'border-slate-600')}
                            />
                          </label>
                          <label className="text-[11px] font-extrabold text-slate-300">Rack
                            <input type="text" value={line.rack} onChange={function (e) { updateLineField(lineIdx, 'rack', e.target.value); }} className={'w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm text-slate-100 ' + (line.fromMaster.rack ? 'bg-blue-900/40' : 'bg-slate-800')} />
                            {line.product && !line.fromMaster.rack && line.product.default_rack && line.rack && line.rack !== line.product.default_rack && (
                              <button onClick={function () { toggleUpdateMaster(lineIdx, 'rack'); }} className={'mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-bold ' + (line.updateMaster.rack ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-100 text-amber-900 hover:bg-amber-200')}>
                                📌 {line.updateMaster.rack ? 'Will update master' : 'Update master?'}
                              </button>
                            )}
                          </label>
                          <label className="text-[11px] font-extrabold text-slate-300">Line Notes
                            <input type="text" value={line.line_notes} onChange={function (e) { updateLineField(lineIdx, 'line_notes', e.target.value); }} placeholder="per-line note" className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500" />
                          </label>
                        </div>

                        {/* Tech specs (overrides on receipt only — no popup) */}
                        <div className="bg-slate-800/40 border border-slate-700 rounded p-2 mb-2">
                          <div className="text-[10px] font-extrabold text-slate-600 tracking-wider mb-1">TECH SPECS (per-roll overrides — saved on receipt only)</div>
                          <div className="grid grid-cols-6 gap-2">
                            <label className="text-[11px] font-extrabold text-slate-300">Thickness (mm)
                              <input type="text" value={line.actual_thickness_mm} onChange={function (e) { updateLineField(lineIdx, 'actual_thickness_mm', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-600 rounded text-sm text-slate-100 ' + (line.fromMaster.actual_thickness_mm ? 'bg-blue-900/40' : 'bg-slate-800')} />
                            </label>
                            <label className="text-[11px] font-extrabold text-slate-300">Width (m)
                              <input type="text" value={line.actual_width_m} onChange={function (e) { updateLineField(lineIdx, 'actual_width_m', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-600 rounded text-sm text-slate-100 ' + (line.fromMaster.actual_width_m ? 'bg-blue-900/40' : 'bg-slate-800')} />
                            </label>
                            <label className="text-[11px] font-extrabold text-slate-300">GSM
                              <input type="text" value={line.actual_gsm} onChange={function (e) { updateLineField(lineIdx, 'actual_gsm', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-600 rounded text-sm text-slate-100 ' + (line.fromMaster.actual_gsm ? 'bg-blue-900/40' : 'bg-slate-800')} />
                            </label>
                            <label className="text-[11px] font-extrabold text-slate-300">Density
                              <input type="text" value={line.actual_density} onChange={function (e) { updateLineField(lineIdx, 'actual_density', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-600 rounded text-sm text-slate-100 ' + (line.fromMaster.actual_density ? 'bg-blue-900/40' : 'bg-slate-800')} />
                            </label>
                            <label className="text-[11px] font-extrabold text-slate-300">Weight/roll
                              <input type="text" value={line.actual_weight_per_roll} onChange={function (e) { updateLineField(lineIdx, 'actual_weight_per_roll', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-600 rounded text-sm text-slate-100 ' + (line.fromMaster.actual_weight_per_roll ? 'bg-blue-900/40' : 'bg-slate-800')} />
                            </label>
                            <label className="text-[11px] font-extrabold text-slate-300">Roll length (m)
                              <input type="text" value={line.actual_roll_length_m} onChange={function (e) { updateLineField(lineIdx, 'actual_roll_length_m', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-600 rounded text-sm text-slate-100 ' + (line.fromMaster.actual_roll_length_m ? 'bg-blue-900/40' : 'bg-slate-800')} />
                            </label>
                          </div>
                        </div>

                        {/* Sourcing + cost (cost gated by seeCosts) */}
                        <div className="bg-slate-800/40 border border-slate-700 rounded p-2">
                          <div className="text-[10px] font-extrabold text-slate-600 tracking-wider mb-1">
                            SOURCING{seeCosts ? ' + COST' : ''} (master defaults can be updated via 📌 button)
                          </div>
                          <div className={'grid gap-2 ' + (seeCosts ? 'grid-cols-3' : 'grid-cols-1')}>
                            <label className="text-[11px] font-extrabold text-slate-300">Supplier
                              <input type="text" value={line.supplier} onChange={function (e) { updateLineField(lineIdx, 'supplier', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-600 rounded text-sm text-slate-100 ' + (line.fromMaster.supplier ? 'bg-blue-900/40' : 'bg-slate-800')} />
                              {line.product && !line.fromMaster.supplier && line.product.default_supplier && line.supplier && line.supplier !== line.product.default_supplier && (
                                <button onClick={function () { toggleUpdateMaster(lineIdx, 'supplier'); }} className={'mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-bold ' + (line.updateMaster.supplier ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-100 text-amber-900 hover:bg-amber-200')}>
                                  📌 {line.updateMaster.supplier ? 'Will update master' : 'Update master?'}
                                </button>
                              )}
                            </label>
                            {seeCosts && (
                              <label className="text-[11px] font-extrabold text-slate-300">Cost per UOM
                                <input type="text" value={line.cost_per_uom} onChange={function (e) { updateLineField(lineIdx, 'cost_per_uom', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-600 rounded text-sm font-mono text-slate-100 ' + (line.fromMaster.cost_per_uom ? 'bg-blue-900/40' : 'bg-slate-800')} />
                                {line.product && !line.fromMaster.cost_per_uom && line.product.default_cost != null && line.cost_per_uom && Number(line.cost_per_uom) !== Number(line.product.default_cost) && (
                                  <button onClick={function () { toggleUpdateMaster(lineIdx, 'cost_per_uom'); }} className={'mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-bold ' + (line.updateMaster.cost_per_uom ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-100 text-amber-900 hover:bg-amber-200')}>
                                    📌 {line.updateMaster.cost_per_uom ? 'Will update master' : 'Update master?'}
                                  </button>
                                )}
                              </label>
                            )}
                            {seeCosts && (
                              <label className="text-[11px] font-extrabold text-slate-300">Currency
                                <select value={line.currency} onChange={function (e) { updateLineField(lineIdx, 'currency', e.target.value); }} className={'w-full mt-0.5 px-2 py-1 border border-slate-600 rounded text-sm text-slate-100 ' + (line.fromMaster.currency ? 'bg-blue-900/40' : 'bg-slate-800')}>
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
                  </div>
                );
              })}

              <button onClick={addLine} className="w-full px-4 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-sm font-extrabold rounded-lg border-2 border-dashed border-emerald-400">
                + Add another product line
              </button>
            </div>
            )}

            {openStep === 3 && (function () {
              var rec = computeVariance(header, lines);
              if (!rec.has_any_expected) {
                return (
                  <div className="bg-slate-900/80 border-t-2 border-slate-700 px-5 py-3">
                    <div className="text-sm font-bold text-slate-300">
                      📊 Reconciliation will appear once you fill in Shipment Expected Totals above.
                    </div>
                  </div>
                );
              }
              var bgClass = rec.is_balanced ? 'bg-emerald-100 border-emerald-500' : 'bg-amber-100 border-amber-500';
              var titleColor = rec.is_balanced ? 'text-emerald-900' : 'text-amber-900';
              function vtxt(v, dec) { if (v == null) { return '—'; } if (v === 0) { return '✓'; } var a = dec ? Math.abs(v).toFixed(2) : Math.abs(v); return (v > 0 ? '-' : '+') + a; }
              // Collapsed status bar by default (gives back screen space). Auto-expands on
              // Submit / Save Draft. Balanced always stays compact.
              if (!varExpanded) {
                return (
                  <div className={'border-t-4 ' + bgClass + ' px-5 py-2 flex items-center justify-between gap-3 flex-wrap'}>
                    <div className={'text-sm font-extrabold ' + titleColor}>
                      {rec.is_balanced
                        ? '✓ Reconciliation: Balanced (all totals match)'
                        : '⚠ Reconciliation Variance — Rolls: ' + vtxt(rec.variance.rolls, false) + ' · Weight: ' + vtxt(rec.variance.gross, true) + ' kg · UOM: ' + vtxt(rec.variance.uom, true)}
                    </div>
                    {!rec.is_balanced && (
                      <button type="button" onClick={function () { setVarExpanded(true); }} className="text-xs font-extrabold bg-amber-800 text-white rounded px-3 py-1 hover:bg-amber-700">Expand ▾</button>
                    )}
                  </div>
                );
              }
              return (
                <div className={'border-t-4 ' + bgClass + ' px-5 py-3'}>
                  <div className="flex items-center justify-between mb-2">
                    <div className={'text-base font-extrabold ' + titleColor}>
                      {rec.is_balanced ? '✓ Reconciliation: Balanced (all totals match)' : '⚠ Reconciliation: Variance detected (yellow status on submit)'}
                    </div>
                    <button type="button" onClick={function () { setVarExpanded(false); }} className={'text-xs font-extrabold rounded px-3 py-1 ' + (rec.is_balanced ? 'bg-emerald-700 text-white hover:bg-emerald-600' : 'bg-amber-800 text-white hover:bg-amber-700')}>Collapse ▴</button>
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-sm">
                    <div className="bg-slate-800/60 border border-slate-700 rounded p-2">
                      <div className="text-[11px] font-bold text-slate-600 uppercase">Rolls</div>
                      <div className="text-slate-100 font-bold">Expected: {header.expected_total_rolls === '' ? '—' : header.expected_total_rolls}</div>
                      <div className="text-slate-100 font-bold">Actual: {rec.actual.rolls}</div>
                      <div className={'font-extrabold ' + (rec.variance.rolls === 0 || rec.variance.rolls == null ? 'text-emerald-700' : 'text-amber-800')}>
                        {rec.variance.rolls == null ? '—' : (rec.variance.rolls === 0 ? '✓ match' : (rec.variance.rolls > 0 ? 'short ' + rec.variance.rolls : 'extra ' + Math.abs(rec.variance.rolls)))}
                      </div>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700 rounded p-2">
                      <div className="text-[11px] font-bold text-slate-600 uppercase">Gross kg</div>
                      <div className="text-slate-100 font-bold">Expected: {header.expected_total_gross_kg === '' ? '—' : header.expected_total_gross_kg}</div>
                      <div className="text-slate-100 font-bold">Actual: {rec.actual.gross.toFixed(3)}</div>
                      <div className={'font-extrabold ' + (rec.variance.gross === 0 || rec.variance.gross == null ? 'text-emerald-700' : 'text-amber-800')}>
                        {rec.variance.gross == null ? '—' : (rec.variance.gross === 0 ? '✓ match' : (rec.variance.gross > 0 ? 'short ' + rec.variance.gross.toFixed(3) : 'extra ' + Math.abs(rec.variance.gross).toFixed(3)))}
                      </div>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700 rounded p-2">
                      <div className="text-[11px] font-bold text-slate-600 uppercase">UOM ({header.expected_uom_type || 'kg'})</div>
                      <div className="text-slate-100 font-bold">Expected: {header.expected_total_uom === '' ? '—' : header.expected_total_uom}</div>
                      <div className="text-slate-100 font-bold">Actual: {rec.actual.uom.toFixed(3)}</div>
                      <div className={'font-extrabold ' + (rec.variance.uom === 0 || rec.variance.uom == null ? 'text-emerald-700' : 'text-amber-800')}>
                        {rec.variance.uom == null ? '—' : (rec.variance.uom === 0 ? '✓ match' : (rec.variance.uom > 0 ? 'short ' + rec.variance.uom.toFixed(3) : 'extra ' + Math.abs(rec.variance.uom).toFixed(3)))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {openStep === 4 && (() => {
              var rec = computeVariance(header, lines);
              var act = rec.actual || { rolls: 0, gross: 0, uom: 0 };
              var realLines = lines.filter(function (l) { return l.product_id; });
              var s1 = !!(header.supplier || header.shipment_reference || header.container_number) && (header.warehouse_id || header.receipt_date);
              var sExp = rec.has_any_expected;
              var sLines = realLines.length > 0;
              var sActual = act.rolls > 0 || act.uom > 0;
              var needNotes = rec.has_any_expected && !rec.is_balanced && !((header.variance_notes || '').trim());
              var mergedLines = realLines.filter(function (l) { return l.merged_source_breakdown && l.merged_source_breakdown.length; });
              var fmtN = function (v) { return (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); };
              var wh = warehouseById(header.warehouse_id);
              var expSource = header.nexpac_breakdown || nexpacPreview ? 'Nexpac report' : (sExp ? 'Manual' : '—');
              var Card = function (title, children) { return <div className="bg-white border border-slate-200 rounded-lg p-3"><div className="text-[11px] font-extrabold text-slate-500 uppercase mb-1.5">{title}</div>{children}</div>; };
              var Row = function (k, v) { return <div className="flex justify-between gap-3 text-xs py-0.5"><span className="text-slate-500">{k}</span><span className="text-slate-900 font-semibold text-right">{v == null || v === '' ? '—' : v}</span></div>; };
              var vCardCls = !rec.has_any_expected ? 'bg-slate-100 text-slate-700' : (rec.is_balanced ? 'bg-emerald-100 text-emerald-950' : 'bg-amber-100 text-amber-950');
              var checklist = [
                { ok: s1, label: 'Shipment shell complete', step: 1, fix: 'Add supplier / reference / warehouse — go to Step 1' },
                { ok: sExp, label: 'Expected totals entered', step: 1, fix: 'Enter expected rolls / weight / UOM — go to Step 1' },
                { ok: sLines, label: 'Product lines entered', step: 2, fix: 'Add at least one product line — go to Step 2' },
                { ok: sActual, label: 'Actual totals entered', step: 2, fix: 'Enter received rolls / quantity — go to Step 2' },
                { ok: !needNotes, label: needNotes ? 'Variance notes required' : 'Variance reviewed', step: 3, fix: 'Variance exists — add variance notes in Step 3' }
              ];
              var allReady = checklist.every(function (c) { return c.ok; });
              return (
                <div style={{ padding: '14px 20px', flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }} className="border-t border-slate-800 bg-slate-100">
                  <div className="bg-white text-slate-900 rounded-lg p-2 mb-3">
                    <div className="font-extrabold text-base">STEP 4 — Review Summary &amp; Submit / Finalize</div>
                    <div className="text-xs text-slate-600" dir="rtl">الخطوة ٤ — مراجعة الملخص والإرسال / الاعتماد</div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                    {Card('Shipment', <div>{Row('Receipt #', editingReceiptNumber || '(new)')}{Row('Reference', header.shipment_reference)}{Row('Supplier', header.supplier)}{Row('Warehouse', wh ? wh.name : header.warehouse_id)}{Row('Date', header.receipt_date)}{Row('Container', header.container_number)}{Row('Notes', header.notes)}</div>)}
                    {Card('Expected', <div>{Row('Rolls', header.expected_total_rolls)}{Row('Gross kg', header.expected_total_gross_kg)}{Row('Net kg', header.expected_total_net_kg)}{Row('UOM total', header.expected_total_uom)}{Row('Source', expSource)}</div>)}
                    {Card('Actual received', <div>{Row('Product lines', realLines.length)}{Row('Rolls', fmtN(act.rolls))}{Row('Quantity (UOM)', fmtN(act.uom))}{Row('Gross kg', fmtN(act.gross))}</div>)}
                    {Card('Variance', !rec.has_any_expected
                      ? <div className="text-xs text-slate-500 italic">No expected totals entered — nothing to reconcile.</div>
                      : <div className={'text-xs rounded p-2 ' + vCardCls}>
                          <div className="flex justify-between"><span>Rolls (exp/act)</span><span className="font-bold">{fmtN(header.expected_total_rolls)} / {fmtN(act.rolls)}{rec.variance.rolls ? ' (' + (rec.variance.rolls > 0 ? '-' : '+') + fmtN(Math.abs(rec.variance.rolls)) + ')' : ''}</span></div>
                          <div className="flex justify-between"><span>Gross (exp/act)</span><span className="font-bold">{fmtN(header.expected_total_gross_kg)} / {fmtN(act.gross)}</span></div>
                          <div className="flex justify-between"><span>UOM (exp/act)</span><span className="font-bold">{fmtN(header.expected_total_uom)} / {fmtN(act.uom)}</span></div>
                          <div className="mt-1 font-extrabold">{rec.is_balanced ? '✅ Balanced' : (needNotes ? '⚠️ Variance — notes required' : '⚠️ Variance (noted)')}</div>
                        </div>)}
                  </div>
                  {mergedLines.length > 0 && (
                    <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 mb-2 text-xs text-violet-950">
                      <div className="font-extrabold mb-1">⎘ Merged shipment</div>
                      <div>{mergedLines.length} merged line(s). Merge group: <span className="font-mono">{mergedLines[0].merge_group_id || '—'}</span>. Open Step 2 to expand each line's source breakdown, or use View Merge Audit.</div>
                    </div>
                  )}
                  {Card('Product lines (' + realLines.length + ')',
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead><tr className="bg-slate-100 text-slate-600"><th className="px-2 py-1 text-left">Code</th><th className="px-2 py-1 text-left">Product</th><th className="px-2 py-1 text-left">Grade</th><th className="px-2 py-1 text-left">Color</th><th className="px-2 py-1 text-left">UOM</th><th className="px-2 py-1 text-right">Rolls</th><th className="px-2 py-1 text-right">Qty</th><th className="px-2 py-1 text-right">KG</th><th className="px-2 py-1 text-left">Status</th></tr></thead>
                        <tbody>
                          {realLines.map(function (l, li) { var p = l.product || productById(l.product_id);
                            return <tr key={li} className="border-t border-slate-100"><td className="px-2 py-1 font-mono">{p ? (p.quick_code || '') : ''}</td><td className="px-2 py-1">{p ? (p.name_en || l.product_id) : l.product_id}</td><td className="px-2 py-1">{p ? listLabel(p.grade_list_id) : ''}</td><td className="px-2 py-1">{p ? listLabel(p.color_list_id) : ''}</td><td className="px-2 py-1">{l.uom || '—'}</td><td className="px-2 py-1 text-right">{l.roll_count || 0}</td><td className="px-2 py-1 text-right">{l.quantity || 0}</td><td className="px-2 py-1 text-right">{l.quantity_kg || 0}</td><td className="px-2 py-1">{l.merged_source_breakdown && l.merged_source_breakdown.length ? ('Sources: ' + l.merged_source_breakdown.length) : '—'}</td></tr>;
                          })}
                          {realLines.length === 0 && <tr><td colSpan={9} className="px-2 py-2 text-center text-slate-400 italic">No product lines yet — go to Step 2.</td></tr>}
                        </tbody>
                      </table>
                    </div>)}
                  <div className="bg-white border border-slate-200 rounded-lg p-3 mt-2">
                    <div className="text-[11px] font-extrabold text-slate-500 uppercase mb-1.5">Readiness checklist</div>
                    {checklist.map(function (c, ci) {
                      return <div key={ci} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-slate-100 last:border-0">
                        <span className={c.ok ? 'text-emerald-700 font-semibold' : 'text-amber-800 font-semibold'}>{c.ok ? '✅ ' : '⚠️ '}{c.label}</span>
                        {!c.ok && <button type="button" onClick={function () { setOpenStep(c.step); }} className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded whitespace-nowrap">Go to Step {c.step}</button>}
                      </div>;
                    })}
                    <div className={'mt-2 font-extrabold text-sm ' + (allReady ? 'text-emerald-700' : 'text-amber-800')}>{allReady ? '✅ Ready to submit — use Submit below to finalize.' : '⚠️ Not ready — resolve the items above. You can still Save Draft.'}</div>
                  </div>
                </div>
              );
            })()}

            {/* Footer — v55.83-A.6.27.72 HOTFIX 21: explicit flexShrink:0 so
                Cancel/Save/Submit stay pinned at the bottom no matter how
                much content is above them. Combined with the parent flex-col
                + Region 2 owning the scroll, this guarantees the buttons are
                always visible without scrolling. */}
            <div className="flex justify-end gap-2 border-t border-slate-800 bg-slate-900/80 rounded-b-2xl flex-wrap" style={{ padding: '12px 20px', flexShrink: 0 }}>
              <button onClick={closeModal} disabled={busy} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-100 text-base font-bold rounded-lg border border-slate-600">
                Cancel
              </button>
              {/* v55.83-A.6.27.37 — Save Shipment Only: writes JUST the header (no products). */}
              <button
                onClick={saveShipmentHeaderOnly}
                disabled={busy}
                title="Save shipment shell (header only, no products). Come back later via Edit to add products."
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-base font-extrabold rounded-lg shadow">
                {busy ? 'Saving...' : '📋 Save Shell Only'}
              </button>
              {/* v55.83-A.6.27.43 — Save Draft (no submission, no reconciliation gate, no variance check) */}
              <button
                onClick={function () { setVarExpanded(true); saveReceipt(); }}
                disabled={busy}
                title="Save your work-in-progress. Can be reopened and edited freely. Does not generate inventory layers or submit."
                className="px-4 py-2 bg-slate-600 hover:bg-slate-700 disabled:opacity-50 text-white text-base font-extrabold rounded-lg shadow">
                {busy ? 'Saving...' : '💾 Save Draft'}
              </button>
              {/* v55.83-A.6.27.43 — Submit: runs reconciliation. Balanced → green. Variance → yellow + note required. */}
              <button
                onClick={function () { setSubmitAttempted(true); var hasExp = !!(header.expected_total_rolls || header.expected_total_gross_kg || header.expected_total_uom); setOpenStep(hasExp ? 3 : 1); submitReceipt(); }}
                disabled={busy}
                title="Submit this receipt. Reconciliation will run — if totals match it'll be green; if they don't, you'll be asked for a variance note."
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-base font-extrabold rounded-lg shadow">
                {busy ? 'Submitting...' : '✓ Submit (' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + ')'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v55.83-A.6.27.43 — Variance prompt modal (shown when Submit is clicked with variance) */}
      {variancePromptOpen && variancePromptData && (() => {
        var rec = variancePromptData;
        var noteRef = { current: header.variance_notes || '' };
        return (
          <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4">
            <div className="bg-slate-950 text-slate-100 rounded-2xl shadow-2xl w-full max-w-2xl">
              <div className="bg-amber-500 text-white rounded-t-2xl px-6 py-4">
                <div className="text-xs font-bold uppercase tracking-wider text-amber-100">Variance detected</div>
                <div className="text-xl font-extrabold">⚠ Expected totals don&apos;t match actual</div>
                <div className="text-sm text-amber-50 mt-1">Please document why before submitting. This will be saved with the receipt and audited.</div>
              </div>
              <div className="p-6 space-y-3">
                <div className="bg-amber-500/15 border-2 border-amber-600/40 rounded p-3 text-sm font-semibold text-amber-100">
                  <div className="font-extrabold text-amber-900 mb-2">Variance summary:</div>
                  {rec.variance.rolls != null && rec.variance.rolls !== 0 && (
                    <div>• Rolls: <span className="font-extrabold">{rec.variance.rolls > 0 ? 'short ' + rec.variance.rolls : 'extra ' + Math.abs(rec.variance.rolls)}</span></div>
                  )}
                  {rec.variance.gross != null && rec.variance.gross !== 0 && (
                    <div>• Gross kg: <span className="font-extrabold">{rec.variance.gross > 0 ? 'short ' + rec.variance.gross.toFixed(3) : 'extra ' + Math.abs(rec.variance.gross).toFixed(3)}</span></div>
                  )}
                  {rec.variance.uom != null && rec.variance.uom !== 0 && (
                    <div>• UOM: <span className="font-extrabold">{rec.variance.uom > 0 ? 'short ' + rec.variance.uom.toFixed(3) : 'extra ' + Math.abs(rec.variance.uom).toFixed(3)}</span></div>
                  )}
                </div>
                <label className="block text-sm font-extrabold text-slate-100">Variance Notes <span className="text-red-600">*</span>
                  <textarea
                    defaultValue={noteRef.current}
                    onChange={function (e) { noteRef.current = e.target.value; }}
                    placeholder="e.g. Truck broke a roll during unloading. 2 rolls damaged, supplier credit pending. Net weight short by 30 kg explained by paper-wrap residue removed."
                    rows={5}
                    className="w-full mt-1 px-3 py-2.5 border-2 border-slate-600 rounded text-base bg-slate-800 text-slate-100 font-medium resize-y"
                  />
                </label>
              </div>
              <div className="bg-slate-100 rounded-b-2xl px-6 py-4 flex justify-end gap-2">
                <button
                  onClick={function () { setVariancePromptOpen(false); setVariancePromptData(null); }}
                  disabled={busy}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-100 text-base font-bold rounded-lg border border-slate-600"
                >
                  Back
                </button>
                <button
                  onClick={function () { submitWithVarianceNote(noteRef.current); }}
                  disabled={busy}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-base font-extrabold rounded-lg shadow"
                >
                  {busy ? 'Submitting...' : '⚠ Submit with Variance Note'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Cancel-receipt prompt */}
      {mergeAuditGroup && (() => {
        var fmtDt = function (v) { if (!v) return '—'; try { return new Date(v).toLocaleString(); } catch (e) { return String(v); } };
        var num = function (v) { return (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); };
        return (
          <div className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-sm flex items-start justify-center" style={{ padding: 16, overflow: 'hidden' }} onClick={function () { setMergeAuditGroup(null); }}>
            <div className="bg-white rounded-2xl shadow-2xl" onClick={function (e) { e.stopPropagation(); }} style={{ maxWidth: 760, width: '100%', maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column' }}>
              <div className="rounded-t-2xl flex justify-between items-center" style={{ background: '#6d28d9', padding: '14px 20px', flexShrink: 0 }}>
                <div className="text-lg font-extrabold text-white">⎘ Merge Audit</div>
                <button onClick={function () { setMergeAuditGroup(null); }} className="text-white text-xl font-bold" style={{ width: 32, height: 32 }}>✕</button>
              </div>
              <div style={{ padding: 20, overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }} className="text-slate-900">
                <div className="text-[11px] font-bold text-slate-500 mb-1">MERGE GROUP</div>
                <div className="font-mono text-xs mb-3 break-all">{mergeAuditGroup}</div>
                {mergeAuditBusy ? <div className="text-sm text-slate-500 italic">Loading audit…</div> : (
                  mergeAuditRows.length === 0 ? <div className="text-sm text-slate-500 italic">No audit record found for this merge group.</div> : (
                    mergeAuditRows.map(function (a, ai) {
                      var tb = a.totals_before || {}; var ta = a.totals_after || {};
                      return (
                        <div key={ai} className="border border-violet-200 rounded-lg mb-3 overflow-hidden">
                          <div className="bg-violet-50 px-3 py-2 text-sm">
                            <div className="flex flex-wrap gap-x-6 gap-y-1">
                              <span><b>Target shipment:</b> <span className="font-mono">{a.target_receipt_number || '—'}</span></span>
                              <span><b>Merged by:</b> {a.merged_by || '—'}</span>
                              <span><b>Merged at:</b> {fmtDt(a.created_at)}</span>
                            </div>
                          </div>
                          <div className="px-3 py-2 text-xs space-y-1">
                            <div><b>Source shipments:</b> <span className="font-mono">{(a.source_receipt_numbers || []).join(', ') || '—'}</span></div>
                            <div><b>Source line IDs:</b> <span className="font-mono text-[10px] text-slate-500 break-all">{(a.source_line_ids || []).join(', ') || '—'}</span></div>
                            <div><b>Target line IDs:</b> <span className="font-mono text-[10px] text-slate-500 break-all">{(a.target_line_ids || []).join(', ') || '—'}</span></div>
                            <div className="grid grid-cols-2 gap-3 mt-2">
                              <div className="bg-slate-100 rounded p-2"><div className="font-bold text-slate-700 mb-0.5">Totals BEFORE</div><div>Lines: {tb.line_count != null ? tb.line_count : '—'}</div><div>Rolls: {num(tb.roll_count)}</div><div>Qty: {num(tb.quantity)} · {num(tb.quantity_kg)} kg</div></div>
                              <div className="bg-emerald-100 rounded p-2"><div className="font-bold text-emerald-900 mb-0.5">Totals AFTER</div><div>Lines: {ta.line_count != null ? ta.line_count : '—'}</div><div>Rolls: {num(ta.roll_count)}</div><div>Qty: {num(ta.quantity)} · {num(ta.quantity_kg)} kg</div></div>
                            </div>
                            {a.merge_notes ? <div className="mt-2"><b>Notes:</b> {a.merge_notes}</div> : null}
                          </div>
                        </div>
                      );
                    })
                  )
                )}
              </div>
              <div className="flex justify-end border-t border-slate-200 bg-slate-50 rounded-b-2xl" style={{ padding: '12px 20px', flexShrink: 0 }}>
                <button onClick={function () { setMergeAuditGroup(null); }} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded-lg">Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {unmergeTarget && (() => {
        var g = unmergeTarget;
        var d = unmergeData;
        var srcLines = d.srcLines || [];
        var targetLines = d.targetLines || [];
        var rnSet = {}; srcLines.forEach(function (sl) { var rn = sl.source_receipt_number || sl.receipt_number; if (rn && rn !== g.receipt_number) { rnSet[rn] = true; } });
        var rns = Object.keys(rnSet);
        var anyFinal = targetLines.some(function (r) { return r.status === 'finalized'; });
        var fmt = function (n) { return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); };
        var sumRolls = srcLines.reduce(function (a, b) { return a + (Number(b.roll_count) || 0); }, 0);
        var sumQty = srcLines.reduce(function (a, b) { return a + (Number(b.quantity) || 0); }, 0);
        var sumKg = srcLines.reduce(function (a, b) { return a + (Number(b.quantity_kg) || 0); }, 0);
        var nothingToRestore = !d.loading && srcLines.length === 0;
        var confirmDisabled = unmergeBusy || d.loading || nothingToRestore;
        return (
          <div className="fixed inset-0 z-[215] bg-black/70 backdrop-blur-sm flex items-start justify-center" style={{ padding: 16, overflow: 'hidden' }} onClick={function () { if (!unmergeBusy) { setUnmergeTarget(null); } }}>
            <div className="bg-white rounded-2xl shadow-2xl" onClick={function (e) { e.stopPropagation(); }} style={{ maxWidth: 620, width: '100%', maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column' }}>
              <div className="rounded-t-2xl flex justify-between items-center" style={{ background: '#6d28d9', padding: '14px 20px', flexShrink: 0 }}>
                <div className="text-lg font-extrabold text-white">⎘ Unmerge shipment {g.receipt_number}</div>
                <button onClick={function () { if (!unmergeBusy) { setUnmergeTarget(null); } }} className="text-white text-xl font-bold" style={{ width: 32, height: 32 }}>✕</button>
              </div>
              <div style={{ padding: 20, overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }} className="text-slate-900 text-sm">
                {d.loading ? (
                  <div className="text-slate-500 italic py-6 text-center">Loading source shipment data…</div>
                ) : d.error ? (
                  <div>
                    <div className="bg-red-100 text-red-950 rounded-lg p-3 text-sm font-semibold">{d.error}</div>
                    {d.diag && (
                      <div className="mt-2 bg-slate-100 rounded-lg p-2 text-[11px] text-slate-800">
                        <div className="font-bold mb-1">Diagnostics</div>
                        <div>Target receipt: <span className="font-mono">{d.diag.target_receipt_number}</span></div>
                        <div>Merge group: <span className="font-mono">{d.diag.merge_group_id || '—'}</span></div>
                        <div>Target lines: {d.diag.target_line_count} · Source lines found: {d.diag.source_line_count}</div>
                        <div>Audit row found: {d.diag.audit_row_found ? 'yes' : 'no'} · Breakdown found: {d.diag.breakdown_found ? 'yes' : 'no'}</div>
                        <div>Breakdown ids: {d.diag.breakdown_id_count} · Audit source ids: {d.diag.audit_source_id_count}</div>
                        <button onClick={function () { try { navigator.clipboard.writeText(JSON.stringify(d.diag, null, 2)); toast.success('Diagnostics copied'); } catch (eC) { toast.error('Copy failed — see console'); console.log('[unmerge diag]', d.diag); } }} className="mt-2 px-3 py-1 bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold rounded">Copy Diagnostics</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="mb-3">You are about to unmerge this shipment. The original source shipments below will be restored as separate shipments on the list, and this merged shipment will be marked reversed (kept for audit under <b>Show merged</b>). <b>Total inventory quantity does not change</b> — only how it is represented.</p>
                    <div className="bg-slate-100 rounded-lg p-3 mb-3 text-xs space-y-1">
                      <div><b>Merged shipment:</b> <span className="font-mono">{g.receipt_number}</span></div>
                      <div><b>Merge group:</b> <span className="font-mono text-[10px]">{d.groupId || '—'}</span></div>
                      <div><b>Source shipments to restore:</b></div>
                      <ul className="list-disc ml-5">
                        {rns.length ? rns.map(function (rn) { return <li key={rn} className="font-mono">{rn}</li>; }) : <li className="text-slate-500 italic">none found</li>}
                      </ul>
                      <div className="pt-1"><b>Source lines to restore:</b> {srcLines.length} lines · <b>{fmt(sumRolls)}</b> rolls · <b>{fmt(sumQty)}</b> qty{sumKg ? ' · ' + fmt(sumKg) + ' kg' : ''}</div>
                      <div><b>Aggregated lines to reverse:</b> {targetLines.length} lines</div>
                    </div>
                    {nothingToRestore && (
                      <div className="bg-red-100 text-red-950 rounded-lg p-3 text-sm font-semibold mb-2">Cannot unmerge because no source shipment lines were found. This merge is missing its source breakdown data — Confirm is disabled.</div>
                    )}
                    {!nothingToRestore && (
                      <div className="bg-amber-100 text-amber-950 rounded-lg p-2 text-xs font-semibold mb-2">⚠️ After unmerge, the Overview counts the restored source shipments again and stops counting this merged shipment. Same total, no double-count.</div>
                    )}
                    {anyFinal && !nothingToRestore && (
                      <div className="bg-red-100 text-red-950 rounded-lg p-2 text-xs font-semibold mb-2">
                        This merged shipment is finalized/costed and may already affect inventory, costing or sales. Unmerge may change reporting.
                        <input value={unmergeConfirmText} onChange={function (e) { setUnmergeConfirmText(e.target.value); }} placeholder="Type: UNMERGE SHIPMENT" className="w-full mt-1 bg-white border border-red-300 rounded px-2 py-1 text-slate-900" />
                      </div>
                    )}
                    <textarea value={unmergeNotes} onChange={function (e) { setUnmergeNotes(e.target.value); }} placeholder="Unmerge notes (optional)" rows={2} className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs text-slate-900" />
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl" style={{ padding: '12px 20px', flexShrink: 0 }}>
                <button onClick={function () { if (!unmergeBusy) { setUnmergeTarget(null); } }} disabled={unmergeBusy} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded-lg">Cancel</button>
                <button onClick={function () { executeUnmerge(g); }} disabled={confirmDisabled} title={nothingToRestore ? 'No source lines to restore' : ''} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg">{unmergeBusy ? 'Unmerging…' : 'Confirm Unmerge'}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {mergeModalOpen && (() => {
        var fmt = function (n) { return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); };
        var sel = selectedNumbers();
        var srcLines, srcHeaders, plan, planErr = null;
        try {
          srcLines = mergeSourceLines();
          srcHeaders = mergeSourceHeaders();
          plan = mergePlan(srcLines, srcHeaders);
        } catch (e) {
          console.error('[merge] preview failed', e);
          planErr = (e && e.message) || 'Could not build the merge preview.';
          srcLines = srcLines || []; srcHeaders = srcHeaders || [];
        }
        if (planErr) {
          return (
            <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm flex items-start justify-center" style={{ padding: 16 }} onClick={function () { setMergeModalOpen(false); }}>
              <div className="bg-white rounded-2xl shadow-2xl p-5" onClick={function (e) { e.stopPropagation(); }} style={{ maxWidth: 520 }}>
                <div className="text-base font-extrabold text-red-700 mb-2">⚠ Merge preview failed</div>
                <div className="text-sm text-slate-800 mb-3">{planErr}</div>
                <div className="text-xs text-slate-500 mb-3">This usually means the merge database columns aren't set up yet. Run the merge SQL (inventory_shipment_merges + the merged columns) in Supabase, then try again.</div>
                <button onClick={function () { setMergeModalOpen(false); }} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded-lg">Close</button>
              </div>
            </div>
          );
        }
        var anyFinal = mergeAnyFinalized();
        return (
          <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm flex items-start justify-center" style={{ padding: 16, overflow: 'hidden' }} onClick={function () { if (!mergeBusy) setMergeModalOpen(false); }}>
            <div className="bg-white rounded-2xl shadow-2xl" onClick={function (e) { e.stopPropagation(); }} style={{ maxWidth: 820, width: '100%', maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column' }}>
              <div className="rounded-t-2xl flex justify-between items-center" style={{ background: '#6d28d9', padding: '14px 20px', flexShrink: 0 }}>
                <div><div className="text-lg font-extrabold text-white">⎘ Merge Shipments</div><div className="text-xs font-semibold text-violet-100">{sel.length} selected</div></div>
                <button onClick={function () { if (!mergeBusy) setMergeModalOpen(false); }} className="text-white text-xl font-bold" style={{ width: 32, height: 32 }}>✕</button>
              </div>
              <div style={{ padding: 20, overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }} className="text-slate-900">
                <div className="text-xs font-bold text-slate-500 mb-1">SELECTED SHIPMENTS</div>
                <div className="border border-slate-200 rounded-lg overflow-hidden mb-3">
                  {srcHeaders.concat(sel.filter(function (rn) { return !srcHeaders.some(function (h) { return h.receipt_number === rn; }); }).map(function (rn) { return { receipt_number: rn }; })).map(function (h) {
                    var ls = srcLines.filter(function (r) { return r.receipt_number === h.receipt_number; });
                    return (
                      <div key={h.receipt_number} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-100 text-xs">
                        <span className="font-mono font-bold">{h.receipt_number}</span>
                        <span className="text-slate-600">{h.supplier || '—'}</span>
                        <span className="text-slate-600">{ls.length} line(s)</span>
                        <span className="text-slate-600">{fmt(ls.reduce(function (a, b) { return a + (Number(b.roll_count) || 0); }, 0))} rolls</span>
                      </div>
                    );
                  })}
                </div>
                <div className="text-xs font-bold text-slate-500 mb-1">MERGE INTO</div>
                <div className="flex flex-wrap gap-2 mb-3">
                  <button onClick={function () { setMergeTarget('new'); }} className={'px-3 py-1.5 rounded text-xs font-bold border ' + (mergeTarget === 'new' ? 'bg-violet-600 text-white border-violet-700' : 'bg-slate-100 text-slate-800 border-slate-300')}>＋ New merged shell</button>
                  {sel.map(function (rn) { return <button key={rn} onClick={function () { setMergeTarget(rn); }} className={'px-3 py-1.5 rounded text-xs font-bold border ' + (mergeTarget === rn ? 'bg-violet-600 text-white border-violet-700' : 'bg-slate-100 text-slate-800 border-slate-300')}>Into {rn}</button>; })}
                </div>
                {mergeTarget === 'new' && (
                  <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 mb-3">
                    <div className="text-[11px] font-extrabold text-violet-900 uppercase mb-2">New merged shell — review before merging</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      <label className="block">Reference (optional)
                        <input value={mergeShell.shipment_reference} onChange={function (e) { var v = e.target.value; setMergeShell(function (p) { return Object.assign({}, p, { shipment_reference: v }); }); }} placeholder="will be generated on save if blank" className="w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-slate-900" />
                      </label>
                      <label className="block">Receipt date
                        <input type="date" value={mergeShell.receipt_date} onChange={function (e) { var v = e.target.value; setMergeShell(function (p) { return Object.assign({}, p, { receipt_date: v }); }); }} className="w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-slate-900" />
                      </label>
                      <label className="block">Supplier / source
                        <input value={mergeShell.supplier} onChange={function (e) { var v = e.target.value; setMergeShell(function (p) { return Object.assign({}, p, { supplier: v }); }); }} className="w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-slate-900" />
                      </label>
                      <label className="block">Warehouse *
                        <select value={mergeShell.warehouse_id} onChange={function (e) { var v = e.target.value; setMergeShell(function (p) { return Object.assign({}, p, { warehouse_id: v }); }); }} className="w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-slate-900 bg-white">
                          <option value="">— choose —</option>
                          {warehouses.map(function (w) { return <option key={w.id} value={w.id}>{w.name}</option>; })}
                        </select>
                      </label>
                      <label className="block">Container / release
                        <input value={mergeShell.container_number} onChange={function (e) { var v = e.target.value; setMergeShell(function (p) { return Object.assign({}, p, { container_number: v }); }); }} className="w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-slate-900" />
                      </label>
                      <label className="block">Shell notes
                        <input value={mergeShell.notes} onChange={function (e) { var v = e.target.value; setMergeShell(function (p) { return Object.assign({}, p, { notes: v }); }); }} className="w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-slate-900" />
                      </label>
                    </div>
                    <div className="mt-2 text-[11px] text-violet-800">
                      Receipt #: <b>will be generated on save</b> · Expected totals auto-filled from the {sel.length} selected shipments: <b>{fmt(plan.header_totals.expected_total_rolls)} rolls · {fmt(plan.header_totals.expected_total_gross_kg)} kg gross</b> · Actual lines auto-aggregated below: <b>{fmt(plan.totals_after.roll_count)} rolls · {fmt(plan.totals_after.quantity)} qty</b>.
                    </div>
                  </div>
                )}
                <div className="text-xs font-bold text-slate-500 mb-1">PREVIEW — AGGREGATED LINES (tap a row to see full details &amp; sources)</div>
                <div className="border border-slate-200 rounded-lg overflow-hidden mb-2">
                  {plan.aggregated.map(function (g, i) {
                    var p = productById(g.product_id);
                    var code = p ? (p.quick_code || '') + (p.design_sku && p.design_sku !== p.quick_code ? ' / ' + p.design_sku : '') : '';
                    var single = g.sources.length === 1 ? g.sources[0] : null;
                    var srcLabel = single ? ((single.receipt_number || '—') + (shipmentRef(single.receipt_number) ? ' / ' + shipmentRef(single.receipt_number) : '')) : (g.sources.length + ' combined');
                    var open = !!previewExpanded[i];
                    return (
                      <div key={i} className="border-t border-slate-100">
                        <button type="button" onClick={function () { togglePreviewRow(i); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2">
                          <span className="text-slate-400 text-xs mt-0.5">{open ? '▾' : '▸'}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs font-bold text-slate-900">{code ? code + ' · ' : ''}{p ? (p.name_en || g.product_id) : g.product_id}</span>
                            {p && p.name_ar ? <span className="block text-[11px] text-slate-600" dir="rtl">{p.name_ar}</span> : null}
                            <span className="block text-[11px] text-slate-500 mt-0.5">{g.uom || '—'} · {fmt(g.roll_count)} rolls · {fmt(g.quantity)}{g.quantity_kg ? (' / ' + fmt(g.quantity_kg) + ' kg') : ''}</span>
                          </span>
                          <span className={'text-[11px] font-bold whitespace-nowrap ' + (g.sources.length > 1 ? 'text-violet-700' : 'text-slate-600')}>{srcLabel}</span>
                        </button>
                        {open && (
                          <div className="px-3 pb-3 pt-1 bg-slate-50 text-[11px] text-slate-800">
                            {p && productClassSummary(p) ? <div className="mb-2 text-slate-700"><b>Classification:</b> {productClassSummary(p)}</div> : null}
                            <div className="font-bold text-slate-600 mb-1">Source breakdown ({g.sources.length}):</div>
                            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                              <table className="w-full text-[11px]">
                                <thead><tr className="bg-slate-100 text-slate-600"><th className="px-2 py-1 text-left">Receipt #</th><th className="px-2 py-1 text-left">Reference</th><th className="px-2 py-1 text-right">Rolls</th><th className="px-2 py-1 text-right">Qty</th><th className="px-2 py-1 text-left">UOM</th><th className="px-2 py-1 text-right">KG</th><th className="px-2 py-1 text-left">Status</th></tr></thead>
                                <tbody>
                                  {g.sources.map(function (sb, si) {
                                    return <tr key={si} className="border-t border-slate-100"><td className="px-2 py-1 font-mono">{sb.receipt_number || '—'}</td><td className="px-2 py-1">{shipmentRef(sb.receipt_number) || '—'}</td><td className="px-2 py-1 text-right">{fmt(sb.roll_count)}</td><td className="px-2 py-1 text-right">{fmt(sb.quantity)}</td><td className="px-2 py-1">{sb.uom || '—'}</td><td className="px-2 py-1 text-right">{fmt(sb.quantity_kg)}</td><td className="px-2 py-1">{sb.status || '—'}</td></tr>;
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="text-[11px] text-slate-600 mb-2">{plan.totals_before.line_count} source line(s) → <b>{plan.totals_after.line_count}</b> line(s). {plan.balanced ? '✓ totals conserved (no double-count)' : '⚠ total mismatch — do not proceed'}</div>
                {plan.warnings.map(function (w, i) { return <div key={i} className="bg-amber-100 text-amber-950 rounded px-2 py-1 text-xs font-semibold mb-1">⚠ Product {w.product_id} appears in multiple UOMs ({w.uoms.join(', ')}) — kept as separate lines.</div>; })}
                {anyFinal && (
                  <div className="bg-red-100 text-red-950 rounded-lg p-2 text-xs font-semibold my-2">
                    You are merging finalized shipments. This will move/aggregate product lines and affect reporting.
                    <input value={mergeConfirmText} onChange={function (e) { setMergeConfirmText(e.target.value); }} placeholder="Type: MERGE FINALIZED SHIPMENTS" className="w-full mt-1 bg-white border border-red-300 rounded px-2 py-1 text-slate-900" />
                  </div>
                )}
                <textarea value={mergeNotes} onChange={function (e) { setMergeNotes(e.target.value); }} placeholder="Merge notes (optional)" className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs text-slate-900 mt-1" rows={2} />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl" style={{ padding: '12px 20px', flexShrink: 0 }}>
                <button onClick={function () { if (!mergeBusy) setMergeModalOpen(false); }} disabled={mergeBusy} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded-lg">Cancel</button>
                <button onClick={executeMerge} disabled={mergeBusy || !plan.balanced || (mergeTarget === 'new' && !mergeShell.warehouse_id)} title={mergeTarget === 'new' && !mergeShell.warehouse_id ? 'Choose a warehouse for the new shell first' : (!plan.balanced ? 'Totals do not balance' : '')} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg">{mergeBusy ? 'Merging…' : (mergeTarget === 'new' ? 'Create Shell & Confirm Merge' : 'Confirm Merge')}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {cancelTarget && (
        <div className="fixed inset-0 z-[210] bg-black/70 flex items-center justify-center" style={{ padding: 16 }}>
          <div className="bg-slate-950 text-slate-100 rounded-xl shadow-2xl border border-slate-800" style={{ maxWidth: 480, padding: 20 }}>
            <div className="text-base font-extrabold text-red-900 mb-2">Cancel receipt {cancelTarget.receipt_number}?</div>
            <div className="text-sm text-slate-300 mb-3">
              This soft-cancels all {cancelTarget.lineCount} line(s) of this shipment. The records stay in the database (greyed out) but stop counting toward stock-on-hand. You can restore later if it was a mistake.
            </div>
            <label className="text-[11px] font-extrabold text-slate-300 block">Reason *
              <textarea value={cancelReason} onChange={function (e) { setCancelReason(e.target.value); }} rows={2} placeholder="Why is this being cancelled?" className="w-full mt-0.5 px-2 py-1.5 border border-slate-600 rounded text-sm bg-slate-800 text-slate-100 placeholder-slate-500 resize-none" />
            </label>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={function () { setCancelTarget(null); setCancelReason(''); }} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm font-bold rounded-lg border border-slate-600">Keep it</button>
              <button onClick={confirmCancelReceipt} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-extrabold rounded-lg">Confirm Cancel</button>
            </div>
          </div>
        </div>
      )}
      {/* v55.83-A.6.27.33 — Finalize Landed Cost dialog */}
      {finalizeTarget && (
        <InventoryFinalizeCostDialog
          shipmentGroup={finalizeTarget}
          productById={productById}
          userProfile={userProfile}
          toast={toast}
          onClose={function () { setFinalizeTarget(null); }}
          onFinalized={function () { reload(); }}
        />
      )}
    </div>
  );
}
