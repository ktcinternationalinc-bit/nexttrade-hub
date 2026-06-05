'use client';
// ============================================================
// NexpacShipmentPanel — lives INSIDE an inbound shipment.
// Holds the EXPECTED layer (imported from a NEXPAC report, linked to this
// shipment) and shows it beside the ACTUAL received lines. View toggle:
// Expected · Actual · Both. An "AI match & compare" button asks Claude to map
// each expected line to the actual item(s) it belongs to and report differences.
// Importing/looking at the expected layer never changes inventory.
// ============================================================
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { parseNexpac, NEXPAC_DEFAULTS } from '../lib/nexpac-parse';

var PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function fmt(n, d) {
  if (n == null || n === '') return '—';
  var v = Number(n);
  if (isNaN(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 2 : d });
}
function diffColor(d) {
  if (d == null) return 'text-slate-300';
  if (Math.abs(d) < 0.0001) return 'text-emerald-300';
  return d < 0 ? 'text-red-300' : 'text-amber-300';
}
function confBadge(c) {
  var map = { high: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40', medium: 'bg-amber-500/20 text-amber-200 border-amber-500/40', low: 'bg-red-500/20 text-red-200 border-red-500/40' };
  return map[c] || 'bg-slate-600/30 text-slate-200 border-slate-500/40';
}

export default function NexpacShipmentPanel(props) {
  var shipment = props.shipment;
  var actualLines = props.actualLines || [];
  var skuById = props.skuById || function () { return null; };
  var canEdit = props.canEdit;
  var rawToast = props.toast;
  function toast(msg, kind) {
    try {
      if (typeof rawToast === 'function') { rawToast(msg, kind || 'success'); return; }
      if (rawToast && typeof rawToast[kind || 'success'] === 'function') { rawToast[kind || 'success'](msg); return; }
      if (rawToast && typeof rawToast.success === 'function') { rawToast.success(msg); return; }
    } catch (e) {}
  }

  var [pdfReady, setPdfReady] = useState(false);
  var [expected, setExpected] = useState(null);   // { shipment row, lines: [] }
  var [loading, setLoading] = useState(true);
  var [view, setView] = useState('both');          // expected | actual | both
  var [expOpen, setExpOpen] = useState(true);
  var [actOpen, setActOpen] = useState(true);
  var [importing, setImporting] = useState(false);
  var [err, setErr] = useState('');
  var [ai, setAi] = useState(null);
  var [aiBusy, setAiBusy] = useState(false);

  useEffect(function () {
    if (typeof window === 'undefined') return;
    if (window.pdfjsLib) { setPdfReady(true); return; }
    var s = document.querySelector('script[data-pdfjs]');
    if (s) { s.addEventListener('load', function () { setPdfReady(true); }); return; }
    var el = document.createElement('script');
    el.src = PDFJS_SRC; el.setAttribute('data-pdfjs', '1');
    el.onload = function () { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch (e) {} setPdfReady(true); };
    el.onerror = function () { setErr('Could not load the PDF reader — check the connection.'); };
    document.body.appendChild(el);
  }, []);

  useEffect(function () { loadExpected(); }, [shipment && shipment.id]);

  async function loadExpected() {
    if (!shipment || !shipment.id) { setLoading(false); return; }
    setLoading(true);
    try {
      var h = await supabase.from('nexpac_expected_shipments').select('*').eq('inv_shipment_id', shipment.id).order('created_at', { ascending: false }).limit(1);
      if (h.error) throw h.error;
      if (!h.data || !h.data.length) { setExpected(null); setLoading(false); return; }
      var head = h.data[0];
      var l = await supabase.from('nexpac_expected_lines').select('*').eq('shipment_id', head.id);
      var lines = (!l.error && l.data) ? l.data.slice().sort(function (a, b) { return (b.gross_weight || 0) - (a.gross_weight || 0); }) : [];
      setExpected({ head: head, lines: lines });
    } catch (e) {
      setErr(/(relation|does not exist|column)/i.test(String(e.message || '')) ? 'NEXPAC tables not fully set up — run the SQL from the handoff.' : ('Could not load expected: ' + (e.message || e)));
    }
    setLoading(false);
  }

  async function handleImport(file) {
    if (!file) return;
    setErr(''); setImporting(true);
    try {
      if (!window.pdfjsLib) throw new Error('PDF reader not ready — try again in a second.');
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
      if (!parsed.orderRows.length) throw new Error("Couldn't find order rows — is this a NEXPAC report?");
      var hd = parsed.header;
      var head = await supabase.from('nexpac_expected_shipments').insert({
        inv_shipment_id: shipment.id,
        release_number: hd.releaseNumber || null, container_number: hd.containerNumber || null, seal_number: hd.sealNumber || null,
        total_rolls: hd.totalRolls || 0, scale_gross_lbs: hd.scaleGrossLbs || 0, scale_gross_kgs: hd.scaleGrossKgs || 0,
        net_billable_lbs: hd.netBillableLbs || 0, net_billable_kgs: hd.netBillableKgs || 0,
        roll_tare_factor: NEXPAC_DEFAULTS.rollTareFactor, pallet_tare_per_line: NEXPAC_DEFAULTS.palletTarePerLine,
        source_filename: file.name || null,
      }).select().single();
      if (head.error) throw head.error;
      var rows = parsed.lines.map(function (g) {
        return {
          shipment_id: head.data.id, product_type: g.productType, ktc_grade: g.ktcGrade, nt_grade: g.ntGrade, color: g.color,
          total_rolls: g.totalRolls, gross_weight: g.grossWeight, gross_weight_kg: g.grossWeightKg, line_items: g.lineItems,
          roll_tare_weight: g.rollTareWeight, pallet_tare_weight: g.palletTareWeight, total_tare_weight: g.totalTareWeight,
          final_net_weight: g.finalNetWeight, final_net_weight_kg: g.finalNetWeightKg,
        };
      });
      var lr = await supabase.from('nexpac_expected_lines').insert(rows);
      if (lr.error) throw lr.error;
      toast('NEXPAC report attached to this shipment (' + rows.length + ' lines). Inventory not changed.', 'success');
      setAi(null);
      loadExpected();
    } catch (e) {
      setErr('Import failed: ' + (e.message || e));
    }
    setImporting(false);
  }

  async function handleRemoveExpected() {
    if (!expected || !expected.head) return;
    if (!window.confirm('Remove the attached NEXPAC report from this shipment? The actual received lines are not touched.')) return;
    try {
      var r = await supabase.from('nexpac_expected_shipments').delete().eq('id', expected.head.id);
      if (r.error) throw r.error;
      toast('NEXPAC report removed from this shipment.', 'success');
      setExpected(null); setAi(null);
    } catch (e) { setErr('Could not remove: ' + (e.message || e)); }
  }

  function buildActualPayload() {
    return actualLines.map(function (li, idx) {
      var sku = skuById(li.sku_id) || {};
      return {
        _id: 'A' + (idx + 1),
        sku: sku.sku_number || ('line ' + (idx + 1)),
        description: sku.description || '',
        qty: li.qty_primary != null ? li.qty_primary : null,
        unit: sku.primary_unit || '',
        rolls: li.roll_count != null ? li.roll_count : null,
        received: li.qty_received_actual != null ? li.qty_received_actual : null,
      };
    });
  }

  async function runAi() {
    setAiBusy(true); setErr(''); setAi(null);
    try {
      var exp = (expected && expected.lines || []).map(function (l, idx) {
        return { _id: 'E' + (idx + 1), ktcGrade: l.ktc_grade, ntGrade: l.nt_grade, color: l.color, productType: l.product_type,
          totalRolls: l.total_rolls, grossWeight: l.gross_weight, finalNetWeight: l.final_net_weight, finalNetWeightKg: l.final_net_weight_kg };
      });
      var act = buildActualPayload();
      var resp = await fetch('/api/nexpac-match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected: exp, actual: act }) });
      var data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'AI match failed.');
      setAi({ result: data.result, exp: exp, act: act });
    } catch (e) {
      setErr('AI match failed: ' + (e.message || e));
    }
    setAiBusy(false);
  }

  var thL = 'px-3 py-2 text-left text-[10px] uppercase tracking-wider font-extrabold text-slate-400 border-b border-slate-700';
  var thR = thL.replace('text-left', 'text-right');

  function segBtn(key, label) {
    var on = view === key;
    return (
      <button onClick={function () { setView(key); }}
        className={'px-3 py-1.5 text-xs font-extrabold rounded-md transition ' + (on ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}>
        {label}
      </button>
    );
  }

  var expTotals = (expected && expected.lines || []).reduce(function (t, l) {
    t.rolls += Number(l.total_rolls || 0); t.gross += Number(l.gross_weight || 0); t.netKg += Number(l.final_net_weight_kg || 0); return t;
  }, { rolls: 0, gross: 0, netKg: 0 });

  return (
    <div className="bg-slate-900/70 border border-slate-700/60 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-sm font-extrabold text-slate-100">Expected vs Actual</div>
          <div className="text-[11px] text-slate-400">Expected comes from the NEXPAC report · Actual is what you received. Comparing never changes inventory.</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-800/60 rounded-lg p-1">
            {segBtn('expected', 'Expected')}
            {segBtn('actual', 'Actual')}
            {segBtn('both', 'Both')}
          </div>
          {expected && (
            <button onClick={runAi} disabled={aiBusy || !actualLines.length}
              className="px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-extrabold disabled:opacity-50">
              {aiBusy ? 'Matching…' : '✨ AI match & compare'}
            </button>
          )}
        </div>
      </div>

      {err && <div className="mx-4 mt-3 bg-red-100 border border-red-300 text-red-950 text-sm font-semibold rounded px-3 py-2">{err}</div>}

      {/* No expected attached yet */}
      {!loading && !expected && (
        <div className="p-5 text-center">
          <div className="text-sm font-bold text-slate-200 mb-1">No NEXPAC report attached to this shipment yet</div>
          <div className="text-[12px] text-slate-400 mb-3">Import the report to set the expected rolls and weights for this container.</div>
          {canEdit && (
            <label className={'inline-block px-4 py-2 rounded-lg text-sm font-extrabold cursor-pointer ' + (pdfReady && !importing ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-700 text-slate-400 cursor-wait')}>
              {importing ? 'Reading…' : (pdfReady ? '📥 Import NEXPAC report' : 'Loading reader…')}
              <input type="file" accept="application/pdf,.pdf" disabled={!pdfReady || importing} className="hidden"
                onChange={function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; handleImport(f); }} />
            </label>
          )}
        </div>
      )}

      {loading && <div className="p-5 text-center text-xs text-slate-500">Loading…</div>}

      {/* AI comparison result */}
      {ai && ai.result && (
        <div className="mx-4 mt-4 bg-violet-500/10 border border-violet-500/30 rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-violet-500/20 text-[11px] font-extrabold uppercase tracking-wider text-violet-200">AI match & differences</div>
          {ai.result.summary && <div className="px-3 py-2 text-[12px] text-slate-200 bg-white/5">{ai.result.summary}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr>
                <th className={thL}>Expected line</th><th className={thL}>Matched actual</th>
                <th className={thR}>Exp rolls</th><th className={thR}>Act rolls</th><th className={thR}>Roll diff</th>
                <th className={thL}>Confidence</th><th className={thL}>Note</th>
              </tr></thead>
              <tbody>
                {(ai.result.matches || []).map(function (m, i) {
                  var ex = ai.exp.find(function (x) { return x._id === m.expectedId; }) || {};
                  var actNames = (m.actualIds || []).map(function (id) { var a = ai.act.find(function (x) { return x._id === id; }); return a ? (a.sku || a.description) : id; }).join(', ');
                  return (
                    <tr key={i} className="border-b border-slate-800">
                      <td className="px-3 py-2 text-slate-100 font-semibold">{(ex.ktcGrade || '') + ' · ' + (ex.color || '')}</td>
                      <td className="px-3 py-2 text-slate-300">{actNames || <span className="text-red-300">no match</span>}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{fmt(m.expectedRolls)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{fmt(m.actualRolls)}</td>
                      <td className={'px-3 py-2 text-right font-mono font-extrabold ' + diffColor(m.rollDiff)}>{m.rollDiff != null ? (m.rollDiff > 0 ? '+' : '') + fmt(m.rollDiff) : '—'}</td>
                      <td className="px-3 py-2"><span className={'px-2 py-0.5 rounded text-[10px] font-bold border ' + confBadge(m.confidence)}>{m.confidence || '—'}</span></td>
                      <td className="px-3 py-2 text-[11px] text-slate-400">{m.note || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {((ai.result.unmatchedExpected || []).length > 0 || (ai.result.unmatchedActual || []).length > 0) && (
            <div className="px-3 py-2 text-[11px] text-amber-200 bg-amber-500/10 border-t border-amber-500/20">
              {(ai.result.unmatchedExpected || []).length > 0 && <div>Expected with no actual match: {(ai.result.unmatchedExpected || []).map(function (id) { var e = ai.exp.find(function (x) { return x._id === id; }); return e ? (e.ktcGrade + '/' + e.color) : id; }).join(', ')}</div>}
              {(ai.result.unmatchedActual || []).length > 0 && <div>Actual with no expected match: {(ai.result.unmatchedActual || []).map(function (id) { var a = ai.act.find(function (x) { return x._id === id; }); return a ? (a.sku || a.description) : id; }).join(', ')}</div>}
            </div>
          )}
          <div className="px-3 py-1.5 text-[10px] text-slate-500 bg-white/5 border-t border-violet-500/20">AI estimate — review before acting. It reads the grades, colors, and counts to suggest matches.</div>
        </div>
      )}

      {/* Expected panel */}
      {expected && (view === 'expected' || view === 'both') && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <button onClick={function () { setExpOpen(!expOpen); }} className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-300">
              <span>{expOpen ? '▾' : '▸'}</span> Expected (NEXPAC)
              <span className="text-slate-500 font-bold normal-case tracking-normal">· {expected.head.container_number || expected.head.release_number} · {fmt(expTotals.rolls)} rolls</span>
            </button>
            {canEdit && <button onClick={handleRemoveExpected} className="text-[11px] text-red-300 hover:text-red-200 font-bold">Remove report</button>}
          </div>
          {expOpen && (
            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="w-full text-xs">
                <thead><tr>
                  <th className={thL}>Grade</th><th className={thL}>Color</th>
                  <th className={thR}>Rolls</th><th className={thR}>Gross (lbs)</th><th className={thR}>Final net (lbs)</th><th className={thR}>Final net (kg)</th>
                </tr></thead>
                <tbody>
                  {expected.lines.map(function (l, i) {
                    return (
                      <tr key={i} className="border-b border-slate-800">
                        <td className="px-3 py-1.5"><div className="text-slate-100 font-bold">{l.ktc_grade || l.nt_grade}</div>{l.ktc_grade && l.nt_grade && l.ktc_grade !== l.nt_grade && <div className="text-[9px] text-slate-500">{l.nt_grade}</div>}</td>
                        <td className="px-3 py-1.5 text-slate-100 font-semibold">{l.color}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-extrabold text-amber-300">{fmt(l.total_rolls)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-blue-200">{fmt(l.gross_weight)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-emerald-300">{fmt(l.final_net_weight, 1)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-teal-300">{fmt(l.final_net_weight_kg, 2)}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-800/60 font-extrabold">
                    <td className="px-3 py-1.5 text-slate-200" colSpan={2}>Totals</td>
                    <td className="px-3 py-1.5 text-right font-mono text-amber-200">{fmt(expTotals.rolls)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-blue-100">{fmt(expTotals.gross)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-300">—</td>
                    <td className="px-3 py-1.5 text-right font-mono text-teal-200">{fmt(expTotals.netKg, 2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Actual panel */}
      {(view === 'actual' || view === 'both') && (
        <div className="p-4 pt-0">
          <button onClick={function () { setActOpen(!actOpen); }} className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-blue-300 mb-2">
            <span>{actOpen ? '▾' : '▸'}</span> Actual (received) <span className="text-slate-500 font-bold normal-case tracking-normal">· {actualLines.length} line{actualLines.length === 1 ? '' : 's'}</span>
          </button>
          {actOpen && (
            actualLines.length === 0 ? (
              <div className="text-[12px] text-slate-500 border border-slate-800 rounded-lg px-3 py-3">No received SKU lines on this shipment yet.</div>
            ) : (
              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-xs">
                  <thead><tr>
                    <th className={thL}>SKU</th><th className={thL}>Description</th>
                    <th className={thR}>Qty</th><th className={thR}>Rolls</th><th className={thR}>Received</th>
                  </tr></thead>
                  <tbody>
                    {actualLines.map(function (li, i) {
                      var sku = skuById(li.sku_id) || {};
                      return (
                        <tr key={i} className="border-b border-slate-800">
                          <td className="px-3 py-1.5 text-slate-100 font-semibold">{sku.sku_number || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-300">{sku.description || '—'}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-slate-200">{fmt(li.qty_primary)} <span className="text-slate-500">{sku.primary_unit || ''}</span></td>
                          <td className="px-3 py-1.5 text-right font-mono text-amber-300">{fmt(li.roll_count)}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-emerald-300">{li.qty_received_actual != null ? fmt(li.qty_received_actual) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
