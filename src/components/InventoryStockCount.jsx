'use client';
// InventoryStockCount — v55.83-NE (Max, Aug 12 2026)
//
// WHY THIS SCREEN EXISTS: every sale made before the MX migration threw away
// its inventory link, so on-hand stock is overstated by everything ever sold
// through the Hub — and that history is unrecoverable. The honest fix is a
// physical count: walk the warehouse, type what is actually there, submit.
//
// HOW IT WORKS
//   - Lists every real product with the SYSTEM quantity (open FIFO layers) and
//     SYSTEM rolls (received - sold + prior count deltas, Max's general-count
//     rule — no per-roll records).
//   - The counter types the counted qty and (optionally) counted rolls only on
//     rows they actually counted. Untouched rows are completely ignored.
//   - Submit runs apply_stock_count per changed row: shrinkage reduces open
//     layers oldest-first with adjustment_out movements; found stock enters as
//     a COUNT-ADJ receipt that the arrival trigger turns into a provisional
//     layer (priced when finalized). Everything is one DB transaction per
//     product and fully audited in the Adjustments ledger.
//   - Results shown per row; the list reloads after, so the Difference column
//     going to zero is the proof.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function InventoryStockCount(props) {
  var userProfile = props.userProfile;
  var toast = props.toast;
  var isSuperAdmin = props.isSuperAdmin === true;
  var modulePerms = props.modulePerms;
  var canCount = isSuperAdmin || (modulePerms && (modulePerms['Edit Inventory'] === true || modulePerms['Adjust Inventory'] === true));

  var s1 = useState([]); var rows = s1[0]; var setRows = s1[1];
  var s2 = useState(true); var loading = s2[0]; var setLoading = s2[1];
  var s3 = useState({}); var entries = s3[0]; var setEntries = s3[1]; // productId -> {qty:'', rolls:''}
  var s4 = useState({}); var results = s4[0]; var setResults = s4[1];
  var s5 = useState(false); var running = s5[0]; var setRunning = s5[1];
  var s6 = useState(''); var filter = s6[0]; var setFilter = s6[1];
  var s7 = useState(''); var note = s7[0]; var setNote = s7[1];

  async function load() {
    setLoading(true);
    try {
      var prodRes = await supabase.from('inventory_products')
        .select('id, quick_code, name_en, name_ar, default_uom, is_family_template, is_virtual_mix, active')
        .neq('active', false);
      var products = (prodRes.data || []).filter(function (p) { return p.is_family_template !== true && p.is_virtual_mix !== true; });

      var layerRes = await supabase.from('inventory_layers')
        .select('product_id, qty_remaining, uom')
        .eq('status', 'open').gt('qty_remaining', 0);
      var qtyBy = {};
      (layerRes.data || []).forEach(function (l) {
        if (!qtyBy[l.product_id]) { qtyBy[l.product_id] = { qty: 0, uom: l.uom || '' }; }
        qtyBy[l.product_id].qty += Number(l.qty_remaining) || 0;
      });

      // Rolls, Max's general-count arithmetic: received - sold + prior deltas.
      var recRes = await supabase.from('inventory_stock_receipts')
        .select('product_id, roll_count, status');
      var rollsBy = {};
      (recRes.data || []).forEach(function (r) {
        if (!r.product_id) { return; }
        var st = r.status;
        if (st === 'cancelled' || st === 'pending_detail' || st === 'merged' || st === 'reversed') { return; }
        rollsBy[r.product_id] = (rollsBy[r.product_id] || 0) + (Number(r.roll_count) || 0);
      });
      var soldRes = await supabase.from('invoice_items')
        .select('variant_id, rolls_sold, inventory_status')
        .eq('uses_inventory', true);
      (soldRes.data || []).forEach(function (it) {
        if (!it.variant_id || it.inventory_status === 'reversed') { return; }
        rollsBy[it.variant_id] = (rollsBy[it.variant_id] || 0) - (Number(it.rolls_sold) || 0);
      });
      // Prior count deltas (may not exist until the NE SQL is run — tolerate).
      try {
        var adjRes = await supabase.from('inventory_adjustments')
          .select('product_id, rolls_delta, adjustment_type')
          .eq('adjustment_type', 'count');
        (adjRes.data || []).forEach(function (a) {
          rollsBy[a.product_id] = (rollsBy[a.product_id] || 0) + (Number(a.rolls_delta) || 0);
        });
      } catch (e) { /* table absent pre-SQL — counts still load */ }

      var out = products.map(function (p) {
        var q = qtyBy[p.id] || { qty: 0, uom: p.default_uom || '' };
        return {
          id: p.id, code: p.quick_code || '', name_en: p.name_en || '', name_ar: p.name_ar || '',
          uom: (q.uom || p.default_uom || '').toUpperCase(),
          sys_qty: Math.round(q.qty * 100) / 100,
          sys_rolls: Math.round((rollsBy[p.id] || 0))
        };
      });
      // Products holding stock first — that's what gets counted.
      out.sort(function (a, b) { return (b.sys_qty - a.sys_qty) || a.code.localeCompare(b.code); });
      setRows(out);
    } catch (e) {
      toast.error('Load failed: ' + ((e && e.message) || 'error'));
    } finally { setLoading(false); }
  }
  useEffect(function () { if (canCount) { load(); } else { setLoading(false); } }, []);

  function setEntry(id, field, val) {
    setEntries(function (prev) {
      var n = Object.assign({}, prev);
      var e = Object.assign({}, n[id] || { qty: '', rolls: '' });
      e[field] = val;
      if (e.qty === '' && e.rolls === '') { delete n[id]; } else { n[id] = e; }
      return n;
    });
  }

  function countedRows() {
    return rows.filter(function (r) { var e = entries[r.id]; return e && e.qty !== ''; });
  }

  async function submitCount() {
    if (running) { return; }
    var todo = countedRows();
    if (todo.length === 0) { toast.error('Enter a counted quantity on at least one product. Rows you leave empty are not touched.'); return; }
    var big = [];
    todo.forEach(function (r) {
      var e = entries[r.id];
      var diff = (Number(e.qty) || 0) - r.sys_qty;
      if (Math.abs(diff) > r.sys_qty * 0.5 && r.sys_qty > 0) { big.push(r.code + ' (' + (diff > 0 ? '+' : '') + Math.round(diff) + ')'); }
    });
    var msg = 'Apply the physical count to ' + todo.length + ' product(s)?\n\n' +
      'Shrinkage reduces stock; found stock is added at cost 0 until you price it.\n' +
      'Every change is recorded in the Adjustments ledger.' +
      (big.length ? '\n\n⚠ LARGE differences (>50%) on: ' + big.join(', ') + ' — double-check these were counted correctly.' : '');
    if (!window.confirm(msg)) { return; }
    setRunning(true);
    var uid = (userProfile && userProfile.id) || null;
    for (var i = 0; i < todo.length; i++) {
      var r = todo[i];
      var e = entries[r.id];
      setResults(function (prev) { var n = Object.assign({}, prev); n[r.id] = { status: 'running' }; return n; });
      try {
        var res = await supabase.rpc('apply_stock_count', {
          p_product_id: r.id,
          p_warehouse_id: null,
          p_qty_counted: Number(e.qty) || 0,
          p_rolls_system: e.rolls === '' ? null : r.sys_rolls,
          p_rolls_counted: e.rolls === '' ? null : (Number(e.rolls) || 0),
          p_uom: (r.uom || '').toLowerCase() || null,
          p_notes: note || null,
          p_user: uid
        });
        if (res.error) { throw new Error(res.error.message); }
        var d = res.data || {};
        (function (id, detail) {
          setResults(function (prev) { var n = Object.assign({}, prev); n[id] = { status: 'done', detail: detail }; return n; });
        })(r.id, (d.qty_delta === 0 ? 'matched exactly' : (d.qty_delta > 0 ? '+' + d.qty_delta + ' added (price it on the COUNT-ADJ receipt)' : d.qty_delta + ' removed across ' + (d.layers_reduced || 0) + ' layer(s)')) + (d.rolls_delta ? (' · rolls ' + (d.rolls_delta > 0 ? '+' : '') + d.rolls_delta) : ''));
      } catch (err) {
        (function (id, m) {
          setResults(function (prev) { var n = Object.assign({}, prev); n[id] = { status: 'error', detail: m }; return n; });
        })(r.id, (err && err.message) || 'failed');
      }
    }
    setRunning(false);
    setEntries({});
    toast.success('Count applied — reloading the live figures…');
    load(); // proof: the Difference column should be zero on counted rows
  }

  if (!canCount) {
    return <div className="p-3 text-xs rounded" style={{ background: '#fef3c7', color: '#1c1917' }}>Stock counting needs the "Edit Inventory" or "Adjust Inventory" permission.</div>;
  }

  var visible = rows.filter(function (r) {
    if (!filter) { return true; }
    var f = filter.toLowerCase();
    return (r.code || '').toLowerCase().indexOf(f) > -1 || (r.name_en || '').toLowerCase().indexOf(f) > -1 || (r.name_ar || '').indexOf(filter) > -1;
  });

  return (
    <div>
      <div className="rounded-xl p-3 mb-3" style={{ background: '#0f172a', border: '1px solid #334155' }}>
        <div className="text-sm font-extrabold text-slate-100">🔢 Physical Stock Count / جرد المخزون</div>
        <div className="text-[11px] text-slate-400 mt-1">
          Type what was actually counted — only rows you fill in are touched. Rolls are optional.
          Shortfalls reduce stock; found stock is added at cost 0 until you price it on its COUNT-ADJ receipt.
        </div>
        <div className="flex gap-2 mt-2 flex-wrap items-center">
          <input value={filter} onChange={function (e) { setFilter(e.target.value); }} placeholder="Filter products / بحث"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', minWidth: 220 }} />
          <input value={note} onChange={function (e) { setNote(e.target.value); }} placeholder="Count note, e.g. 'August full count' (saved on every line)"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-1" style={{ background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', minWidth: 240 }} />
        </div>
      </div>

      {loading ? <div className="text-xs text-slate-400 p-3">Loading live stock…</div> : (
        <div className="rounded-xl overflow-hidden" style={{ background: '#0f172a', border: '1px solid #334155' }}>
          <div className="overflow-auto max-h-[560px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0" style={{ background: '#1e293b' }}>
                <tr>
                  <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Product</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-slate-100">System qty</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-sky-200">Counted qty</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-slate-100">System rolls</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-sky-200">Counted rolls</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-slate-100">Difference</th>
                  <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Result</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(function (r) {
                  var e = entries[r.id] || { qty: '', rolls: '' };
                  var diff = e.qty === '' ? null : (Number(e.qty) || 0) - r.sys_qty;
                  var res = results[r.id];
                  return (
                    <tr key={r.id} className="border-b border-slate-800">
                      <td className="px-2 py-1.5">
                        <div className="font-mono font-extrabold text-indigo-300">{r.code}</div>
                        <div className="text-slate-300 text-[10px]">{r.name_en}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-bold text-slate-200 whitespace-nowrap">
                        {r.sys_qty.toLocaleString()} <span className="text-slate-500">{r.uom}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input type="number" min="0" value={e.qty} disabled={running}
                          onChange={function (ev) { setEntry(r.id, 'qty', ev.target.value); }}
                          placeholder="—"
                          className="w-24 px-2 py-1 rounded text-right font-mono font-bold"
                          style={{ background: e.qty === '' ? '#1e293b' : '#f8fafc', color: e.qty === '' ? '#94a3b8' : '#0f172a', border: '2px solid ' + (e.qty === '' ? '#334155' : '#38bdf8') }} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.sys_rolls}</td>
                      <td className="px-2 py-1.5 text-right">
                        <input type="number" min="0" value={e.rolls} disabled={running}
                          onChange={function (ev) { setEntry(r.id, 'rolls', ev.target.value); }}
                          placeholder="—"
                          className="w-20 px-2 py-1 rounded text-right font-mono font-bold"
                          style={{ background: e.rolls === '' ? '#1e293b' : '#f8fafc', color: e.rolls === '' ? '#94a3b8' : '#0f172a', border: '2px solid ' + (e.rolls === '' ? '#334155' : '#38bdf8') }} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-extrabold whitespace-nowrap"
                        style={{ color: diff == null ? '#475569' : (Math.abs(diff) < 0.005 ? '#6ee7b7' : (diff < 0 ? '#fca5a5' : '#fcd34d')) }}>
                        {diff == null ? '—' : (diff > 0 ? '+' : '') + (Math.round(diff * 100) / 100).toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5" style={{ minWidth: 170 }}>
                        {res && res.status === 'done' && <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: '#dcfce7', color: '#052e16' }}>✓ {res.detail}</span>}
                        {res && res.status === 'error' && <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: '#fee2e2', color: '#450a0a' }}>✗ {res.detail}</span>}
                        {res && res.status === 'running' && <span className="text-[10px] font-bold text-slate-300">⏳ applying…</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="p-3 flex items-center justify-between flex-wrap gap-2" style={{ background: '#1e293b', borderTop: '1px solid #334155' }}>
            <div className="text-[11px] font-bold text-slate-200">
              {countedRows().length} product(s) counted — empty rows are left exactly as they are.
            </div>
            <button onClick={submitCount} disabled={running || countedRows().length === 0}
              className="px-5 py-2 rounded-lg text-xs font-extrabold text-white disabled:opacity-50"
              style={{ background: running ? '#475569' : '#059669' }}>
              {running ? '⏳ Applying count…' : '▶ APPLY COUNT to ' + countedRows().length + ' product(s)'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
