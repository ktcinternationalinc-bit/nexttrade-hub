'use client';
// ============================================================
// NexpacImport — upload a NEXPAC report PDF, auto-read it, preview the
// aggregated EXPECTED inbound shipment, and save it for later comparison
// against actual receiving. Does NOT touch inventory.
//
// PDF reading happens in the browser via pdf.js (loaded from CDN). The parse
// logic lives in src/lib/nexpac-parse.js (unit-tested against real reports).
// Storage: nexpac_expected_shipments + nexpac_expected_lines (run the SQL).
// ============================================================
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { parseNexpac, NEXPAC_DEFAULTS } from '../lib/nexpac-parse';

var PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function fmt(n, d) {
  var v = Number(n || 0);
  return v.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 2 : d });
}

export default function NexpacImport(props) {
  var toast = props.toast || function () {};
  var userProfile = props.userProfile || null;

  var [pdfReady, setPdfReady] = useState(false);
  var [parsing, setParsing] = useState(false);
  var [result, setResult] = useState(null);
  var [fileName, setFileName] = useState('');
  var [rollFactor, setRollFactor] = useState(NEXPAC_DEFAULTS.rollTareFactor);
  var [saving, setSaving] = useState(false);
  var [error, setError] = useState('');
  var [saved, setSaved] = useState([]);
  var [openId, setOpenId] = useState(null);
  var [openLines, setOpenLines] = useState([]);

  // Load pdf.js from CDN once.
  useEffect(function () {
    if (typeof window === 'undefined') return;
    if (window.pdfjsLib) { setPdfReady(true); return; }
    var existing = document.querySelector('script[data-pdfjs]');
    if (existing) { existing.addEventListener('load', function () { setPdfReady(true); }); return; }
    var s = document.createElement('script');
    s.src = PDFJS_SRC;
    s.setAttribute('data-pdfjs', '1');
    s.onload = function () {
      try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch (e) {}
      setPdfReady(true);
    };
    s.onerror = function () { setError('Could not load the PDF reader. Check your internet connection and try again.'); };
    document.body.appendChild(s);
  }, []);

  // Load saved expected shipments.
  useEffect(function () { loadSaved(); }, []);

  async function loadSaved() {
    try {
      var r = await supabase.from('nexpac_expected_shipments').select('*').order('created_at', { ascending: false });
      if (!r.error && r.data) setSaved(r.data);
    } catch (e) { /* table may not exist yet */ }
  }

  async function handleFile(file) {
    if (!file) return;
    setError(''); setResult(null); setFileName(file.name); setParsing(true);
    try {
      if (!window.pdfjsLib) throw new Error('PDF reader not ready yet — give it a second and try again.');
      var buf = await file.arrayBuffer();
      var doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      var items = [];
      for (var p = 1; p <= doc.numPages; p++) {
        var page = await doc.getPage(p);
        var tc = await page.getTextContent();
        for (var i = 0; i < tc.items.length; i++) {
          var it = tc.items[i];
          if (it.str && it.str.trim()) items.push({ x: it.transform[4], y: it.transform[5], page: p, str: it.str });
        }
      }
      var parsed = parseNexpac(items, { rollTareFactor: Number(rollFactor) || NEXPAC_DEFAULTS.rollTareFactor });
      if (!parsed.orderRows.length) throw new Error("Couldn't find any order-history rows. Is this a NEXPAC report PDF?");
      setResult(parsed);
    } catch (e) {
      setError(e.message || 'Could not read this PDF.');
    } finally {
      setParsing(false);
    }
  }

  // Re-run aggregation if the tare factor changes after a parse.
  function applyFactor(f) {
    setRollFactor(f);
    if (result) {
      var parsed = parseNexpac(
        result.orderRows.map(function (r) { return { ntGrade: r.ntGrade, productType: r.productType, color: r.color, rolls: r.rolls, weight: r.weight, num: r.seq }; }),
        { rollTareFactor: Number(f) || NEXPAC_DEFAULTS.rollTareFactor }
      );
      // parseNexpac re-reads header from items; keep original header, re-aggregate only.
      setResult(Object.assign({}, result, { lines: parsed.lines, totals: parsed.totals }));
    }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true); setError('');
    try {
      var h = result.header;
      var head = await supabase.from('nexpac_expected_shipments').insert({
        release_number: h.releaseNumber || null,
        container_number: h.containerNumber || null,
        seal_number: h.sealNumber || null,
        total_rolls: h.totalRolls || 0,
        scale_gross_lbs: h.scaleGrossLbs || 0,
        scale_gross_kgs: h.scaleGrossKgs || 0,
        net_billable_lbs: h.netBillableLbs || 0,
        net_billable_kgs: h.netBillableKgs || 0,
        roll_tare_factor: Number(rollFactor) || NEXPAC_DEFAULTS.rollTareFactor,
        pallet_tare_per_line: NEXPAC_DEFAULTS.palletTarePerLine,
        source_filename: fileName || null,
        created_by: userProfile ? userProfile.id : null,
      }).select().single();
      if (head.error) throw head.error;
      var sid = head.data.id;
      var rows = result.lines.map(function (g) {
        return {
          shipment_id: sid,
          product_type: g.productType,
          ktc_grade: g.ktcGrade,
          nt_grade: g.ntGrade,
          color: g.color,
          total_rolls: g.totalRolls,
          gross_weight: g.grossWeight,
          gross_weight_kg: g.grossWeightKg,
          line_items: g.lineItems,
          roll_tare_weight: g.rollTareWeight,
          pallet_tare_weight: g.palletTareWeight,
          total_tare_weight: g.totalTareWeight,
          final_net_weight: g.finalNetWeight,
          final_net_weight_kg: g.finalNetWeightKg,
        };
      });
      var lr = await supabase.from('nexpac_expected_lines').insert(rows);
      if (lr.error) throw lr.error;
      toast('Expected shipment saved — ' + (h.containerNumber || h.releaseNumber || 'NEXPAC') + ' (' + rows.length + ' lines). Inventory was not changed.', 'success');
      setResult(null); setFileName('');
      loadSaved();
    } catch (e) {
      setError('Could not save: ' + (e.message || e) + (/(relation|does not exist|schema cache)/i.test(String(e.message || '')) ? ' — the NEXPAC tables may not be set up yet. Run the SQL from the handoff.' : ''));
    } finally {
      setSaving(false);
    }
  }

  async function toggleSaved(id) {
    if (openId === id) { setOpenId(null); setOpenLines([]); return; }
    setOpenId(id); setOpenLines([]);
    try {
      var r = await supabase.from('nexpac_expected_lines').select('*').eq('shipment_id', id);
      if (!r.error && r.data) setOpenLines(r.data.slice().sort(function (a, b) { return (b.gross_weight || 0) - (a.gross_weight || 0); }));
    } catch (e) {}
  }

  var th = 'px-3 py-2 text-right text-[10px] uppercase tracking-wider font-extrabold text-slate-400 border-b border-slate-700';
  var thL = th.replace('text-right', 'text-left');

  return (
    <div className="space-y-5">
      <div className="pt-1">
        <div className="text-xl font-extrabold text-slate-100">NEXPAC Import</div>
        <div className="text-xs text-slate-400 mt-0.5">Upload a NEXPAC report to create an <span className="font-bold text-slate-300">expected</span> inbound shipment. This is a reference for comparing against what actually arrives — it does not change inventory.</div>
      </div>

      {/* Uploader */}
      <div className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className={'px-4 py-2 rounded-lg text-sm font-extrabold cursor-pointer ' + (pdfReady ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-700 text-slate-400 cursor-wait')}>
            {pdfReady ? '📄 Choose NEXPAC PDF' : 'Loading PDF reader…'}
            <input type="file" accept="application/pdf,.pdf" disabled={!pdfReady || parsing} className="hidden"
              onChange={function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; handleFile(f); }} />
          </label>
          {fileName && <span className="text-xs text-slate-300 font-semibold">{fileName}</span>}
          {parsing && <span className="text-xs text-amber-300 font-bold">Reading…</span>}
          <label className="ml-auto flex items-center gap-2 text-xs font-bold text-slate-300" title="Final Net = Gross − (Rolls × this factor) − (Line Items × 55)">
            Roll tare / roll:
            <input type="number" step="0.1" value={rollFactor} onChange={function (e) { applyFactor(e.target.value); }}
              className="w-16 px-2 py-1 border border-slate-600 rounded bg-slate-800 text-slate-100 text-right font-mono" />
            lbs
          </label>
        </div>
        {error && <div className="mt-3 bg-red-100 border border-red-300 text-red-950 text-sm font-semibold rounded px-3 py-2">{error}</div>}
      </div>

      {/* Preview */}
      {result && (
        <div className="bg-slate-900/70 border border-slate-700/60 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-700/60 flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs font-extrabold uppercase tracking-[0.15em] text-slate-300">Expected Shipment — Preview</span>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold disabled:opacity-60">
              {saving ? 'Saving…' : '✓ Save Expected Shipment'}
            </button>
          </div>

          {/* Header values */}
          <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-2 border-b border-slate-800">
            {[
              ['Release #', result.header.releaseNumber || '—'],
              ['Container', result.header.containerNumber || '—'],
              ['Seal #', result.header.sealNumber || '—'],
              ['Total Rolls', fmt(result.header.totalRolls)],
              ['Scale Gross (LBS)', fmt(result.header.scaleGrossLbs)],
              ['Scale Gross (KGS)', fmt(result.header.scaleGrossKgs, 2)],
              ['Net Billable (LBS)', fmt(result.header.netBillableLbs)],
              ['Net Billable (KGS)', fmt(result.header.netBillableKgs, 2)],
            ].map(function (kv, i) {
              return (
                <div key={i} className="bg-slate-800/60 rounded px-3 py-2">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{kv[0]}</div>
                  <div className="text-sm font-extrabold font-mono text-slate-100">{kv[1]}</div>
                </div>
              );
            })}
          </div>

          {result.warnings && result.warnings.length > 0 && (
            <div className="mx-4 mt-3 bg-amber-100 border border-amber-300 text-amber-950 text-xs font-semibold rounded px-3 py-2">
              {result.warnings.map(function (w, i) { return <div key={i}>⚠️ {w}</div>; })}
            </div>
          )}

          {/* Detail table */}
          <div className="overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={thL}>Product Type</th>
                  <th className={thL}>Grade</th>
                  <th className={thL}>Color</th>
                  <th className={th}>Total Rolls</th>
                  <th className={th}>Gross (lbs)</th>
                  <th className={th}>Line Items</th>
                  <th className={th}>Roll Tare</th>
                  <th className={th}>Pallet Tare</th>
                  <th className={th}>Total Tare</th>
                  <th className={th}>Final Net (lbs)</th>
                  <th className={th}>Final Net (kg)</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map(function (g, i) {
                  return (
                    <tr key={i} className="border-b border-slate-800">
                      <td className="px-3 py-2 text-slate-200">{g.productType}</td>
                      <td className="px-3 py-2">
                        <div className="font-extrabold text-slate-100">{g.ktcGrade}</div>
                        <div className="text-[10px] text-slate-500">{g.ntGrade}</div>
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-100">{g.color}</td>
                      <td className="px-3 py-2 text-right font-mono font-extrabold text-amber-300">{fmt(g.totalRolls)}</td>
                      <td className="px-3 py-2 text-right font-mono text-blue-200">{fmt(g.grossWeight)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{fmt(g.lineItems)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-400">{fmt(g.rollTareWeight, 1)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-400">{fmt(g.palletTareWeight)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{fmt(g.totalTareWeight, 1)}</td>
                      <td className="px-3 py-2 text-right font-mono font-extrabold text-emerald-300">{fmt(g.finalNetWeight, 1)}</td>
                      <td className="px-3 py-2 text-right font-mono font-extrabold text-teal-300">{fmt(g.finalNetWeightKg, 2)}</td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-800/60 font-extrabold">
                  <td className="px-3 py-2 text-slate-200" colSpan={3}>Totals</td>
                  <td className="px-3 py-2 text-right font-mono text-amber-200">{fmt(result.totals.totalRolls)}</td>
                  <td className="px-3 py-2 text-right font-mono text-blue-100">{fmt(result.totals.grossWeight)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-200">{fmt(result.totals.lineItems)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-300">{fmt(result.totals.rollTareWeight, 1)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-300">{fmt(result.totals.palletTareWeight)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-200">{fmt(result.totals.totalTareWeight, 1)}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-200">{fmt(result.totals.finalNetWeight, 1)}</td>
                  <td className="px-3 py-2 text-right font-mono text-teal-200">{fmt(result.totals.finalNetWeightKg, 2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Saved expected shipments */}
      <div className="bg-slate-900/70 border border-slate-700/60 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-700/60 text-xs font-extrabold uppercase tracking-[0.15em] text-slate-300">
          Saved Expected Shipments ({saved.length})
        </div>
        {saved.length === 0 ? (
          <div className="px-4 py-4 text-sm text-slate-500">None yet. Upload a NEXPAC report above to create one.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {saved.map(function (s) {
              return (
                <div key={s.id}>
                  <button onClick={function () { toggleSaved(s.id); }} className="w-full text-left px-4 py-2.5 hover:bg-slate-800/50 flex items-center justify-between gap-3">
                    <span className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-extrabold text-slate-100">{s.container_number || s.release_number || 'NEXPAC'}</span>
                      <span className="text-[11px] text-slate-400">Release {s.release_number || '—'} · Seal {s.seal_number || '—'}</span>
                      <span className="text-[11px] text-amber-300 font-bold">{fmt(s.total_rolls)} rolls</span>
                    </span>
                    <span className="text-[11px] text-slate-500">{s.created_at ? String(s.created_at).slice(0, 10) : ''}</span>
                  </button>
                  {openId === s.id && (
                    <div className="px-4 pb-3 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr>
                          <th className={thL}>Grade</th><th className={thL}>Color</th>
                          <th className={th}>Rolls</th><th className={th}>Gross (lb)</th><th className={th}>Lines</th><th className={th}>Net (lb)</th><th className={th}>Net (kg)</th>
                        </tr></thead>
                        <tbody>
                          {openLines.map(function (l, i) {
                            return (
                              <tr key={i} className="border-b border-slate-800">
                                <td className="px-3 py-1.5">
                                  <div className="text-slate-100 font-bold">{l.ktc_grade || l.nt_grade}</div>
                                  {l.ktc_grade && l.nt_grade && l.ktc_grade !== l.nt_grade && <div className="text-[9px] text-slate-500">{l.nt_grade}</div>}
                                </td>
                                <td className="px-3 py-1.5 text-slate-100 font-semibold">{l.color}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-amber-300">{fmt(l.total_rolls)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-blue-200">{fmt(l.gross_weight)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-slate-300">{fmt(l.line_items)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-emerald-300">{fmt(l.final_net_weight, 1)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-teal-300">{fmt(l.final_net_weight_kg, 2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
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
