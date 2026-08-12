'use client';
// WaveReconciliationCenter — v55.83-ND (Max Aug 12 2026):
// "from time to time comparing wave to our hub ... like a monthly
//  reconciliation ... if there's any differences we have to report them ...
//  for each item this difference but there's an action ... either sync it to
//  wave or sync it to hub ... each issue will have a button match Hub or Match
//  Wave to select and at the end of the list you would SUBMIT at anytime (like
//  it goes in a queue and then when you submit your process and match to the
//  appropriate selections)"
//
// HOW IT EXECUTES — nothing here writes directly. Every queued action calls an
// existing, individually-guarded route, so every money guard applies unchanged:
//   push          -> invoice-write set_approval, then /api/wave/push-invoice-v2
//   replace_push  -> set_approval, /api/wave/replace-invoice, then push-invoice-v2
//   delete_hub    -> /api/wave/delete-invoice (payment ack round-trip included)
//   import        -> ONE /api/wave/import-invoices run at the end covers every
//                    import-type selection at once (idempotent by wave id)
//   push_payments -> /api/wave/push-payment per unpushed payment row
//   void_payments -> dbUpdate voided:true per row (void, never delete — the
//                    row stays for audit)
// Processing is sequential with a visible per-row outcome, same discipline as
// the Sync Center multi-push. A failure marks its row and moves on — one bad
// invoice must not strand the rest of the month's reconciliation.
import React, { useState } from 'react';
import { supabase, dbUpdate, logActivity } from '../lib/supabase';

export default function WaveReconciliationCenter(props) {
  var userProfile = props.userProfile;
  var toast = props.toast;
  var waveBiz = props.waveBiz || props.activeWaveBusinessId || '';
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var mayRun = isSuperAdmin || props.canWaveSync === true;

  var s1 = useState(null); var report = s1[0]; var setReport = s1[1];
  var s2 = useState(false); var loading = s2[0]; var setLoading = s2[1];
  var s3 = useState({}); var choices = s3[0]; var setChoices = s3[1]; // rowKey -> 'match_hub' | 'match_wave'
  var s4 = useState({}); var results = s4[0]; var setResults = s4[1]; // rowKey -> {status, detail}
  var s5 = useState(false); var running = s5[0]; var setRunning = s5[1];

  function rowKey(d) { return d.type + '|' + (d.hub_id || '') + '|' + (d.wave_invoice_id || ''); }
  function fmtMoney(v, cur) {
    if (v == null) { return '—'; }
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');
  }

  function runCompare() {
    if (!waveBiz) { toast.error('Select a Wave business first.'); return; }
    setLoading(true); setReport(null); setChoices({}); setResults({});
    fetch('/api/wave/reconcile-detail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: waveBiz, userId: (userProfile && userProfile.id) || null }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.ok !== true) { toast.error('Compare failed: ' + ((j && j.error) || 'unknown')); return; }
        setReport(j);
        if (j.diff_count === 0) { toast.success('Wave and the Hub match — nothing to reconcile. ✅'); }
      })
      .catch(function (e) { toast.error('Compare failed: ' + ((e && e.message) || 'network')); })
      .finally(function () { setLoading(false); });
  }

  function choose(d, side) {
    var k = rowKey(d);
    var act = d.actions && d.actions[side];
    if (!act || act.blocked) { return; }
    var next = Object.assign({}, choices);
    if (next[k] === side) { delete next[k]; } else { next[k] = side; }
    setChoices(next);
  }

  function queuedCount() { return Object.keys(choices).length; }

  function setRowResult(k, status, detail) {
    setResults(function (prev) { var n = Object.assign({}, prev); n[k] = { status: status, detail: detail || '' }; return n; });
  }

  async function submitQueue() {
    if (running) { return; }
    var keys = Object.keys(choices);
    if (keys.length === 0) { toast.error('Nothing queued — pick Match Hub or Match Wave on at least one line.'); return; }
    var diffMap = {};
    (report.diffs || []).forEach(function (d) { diffMap[rowKey(d)] = d; });
    var sure = window.confirm('Process ' + keys.length + ' queued reconciliation action(s)?\n\nEach line runs through the same guarded routes as a manual fix — payment protections and Wave locks all apply. This may take a minute.');
    if (!sure) { return; }
    setRunning(true);
    var uid = (userProfile && userProfile.id) || null;
    var needsImport = false;
    var k, d, side, act;

    // Pass 1 — everything except imports, sequentially, visible per row.
    for (var idx = 0; idx < keys.length; idx++) {
      k = keys[idx]; d = diffMap[k]; side = choices[k];
      if (!d) { setRowResult(k, 'error', 'Row no longer in the report — re-run Compare.'); continue; }
      act = d.actions && d.actions[side];
      if (!act || act.blocked) { setRowResult(k, 'error', 'Action not available.'); continue; }
      if (act.kind === 'import') { needsImport = true; setRowResult(k, 'queued_import', 'Will be covered by the import run below.'); continue; }
      setRowResult(k, 'running', act.label);
      try {
        if (act.kind === 'push') {
          var ap = await fetch('/api/accounting/invoice-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_approval', invoice_id: d.hub_id, status: 'approved', user_id: uid }) }).then(function (r) { return r.json(); });
          if (!ap || !ap.ok) { throw new Error('approve failed: ' + ((ap && ap.error) || '?')); }
          var pj = await fetch('/api/wave/push-invoice-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: waveBiz, hub_record_id: d.hub_id, dry_run: false, user_id: uid }) }).then(function (r) { return r.json(); });
          if (pj && (pj.success === true || pj.ok === true) && pj.currency_mismatch !== true) { setRowResult(k, 'done', 'Pushed to Wave' + (pj.needs_approval ? ' (still DRAFT in Wave — approve it in the Sync Center)' : '')); }
          else { throw new Error((pj && pj.error) || 'push refused'); }
        } else if (act.kind === 'replace_push') {
          var ap2 = await fetch('/api/accounting/invoice-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_approval', invoice_id: d.hub_id, status: 'approved', user_id: uid }) }).then(function (r) { return r.json(); });
          if (!ap2 || !ap2.ok) { throw new Error('approve failed: ' + ((ap2 && ap2.error) || '?')); }
          var rj = await fetch('/api/wave/replace-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: waveBiz, hub_record_id: d.hub_id, confirm_replace: true, user_id: uid }) }).then(function (r) { return r.json(); });
          if (!rj || rj.ok !== true) { throw new Error((rj && rj.error) || 'Wave refused the replace — nothing changed on this line'); }
          var pj2 = await fetch('/api/wave/push-invoice-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: waveBiz, hub_record_id: d.hub_id, dry_run: false, user_id: uid }) }).then(function (r) { return r.json(); });
          if (pj2 && (pj2.success === true || pj2.ok === true) && pj2.currency_mismatch !== true) { setRowResult(k, 'done', 'Wave now matches the Hub version'); }
          else { throw new Error('old copy removed but re-push failed: ' + ((pj2 && pj2.error) || '?') + ' — invoice is in Pending Sync, push it from the Sync Center'); }
        } else if (act.kind === 'delete_hub') {
          var dj = await fetch('/api/wave/delete-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: waveBiz, hub_record_id: d.hub_id, confirm_delete: true, user_id: uid }) }).then(function (r) { return r.json(); });
          if (dj && dj.ok === true) { setRowResult(k, 'done', 'Hub invoice deleted' + (dj.hub_payments_deleted ? ' (' + dj.hub_payments_deleted + ' payment record(s) removed)' : '')); }
          else if (dj && dj.reason === 'hub_payments_need_ack') {
            var ack = window.confirm('Invoice ' + (d.invoice_number || '') + ': ' + (dj.error || 'has Hub payment records.') + '\n\nDelete them together with the invoice?');
            if (!ack) { throw new Error('cancelled — payments kept'); }
            var dj2 = await fetch('/api/wave/delete-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: waveBiz, hub_record_id: d.hub_id, confirm_delete: true, acknowledge_hub_payments: true, user_id: uid }) }).then(function (r) { return r.json(); });
            if (dj2 && dj2.ok === true) { setRowResult(k, 'done', 'Hub invoice + ' + (dj2.hub_payments_deleted || 0) + ' payment record(s) deleted'); }
            else { throw new Error((dj2 && dj2.error) || 'delete refused'); }
          }
          else { throw new Error((dj && dj.error) || 'delete refused'); }
        } else if (act.kind === 'push_payments') {
          var okCount = 0; var failMsg = null;
          for (var pi2 = 0; pi2 < (d.unpushed_payments || []).length; pi2++) {
            var pay = d.unpushed_payments[pi2];
            var ppj = await fetch('/api/wave/push-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: waveBiz, hub_record_id: pay.id, dry_run: false, user_id: uid }) }).then(function (r) { return r.json(); });
            if (ppj && (ppj.success === true || ppj.ok === true)) { okCount += 1; }
            else { failMsg = (ppj && ppj.error) || 'payment push refused'; break; }
          }
          if (failMsg) { throw new Error(okCount + ' payment(s) pushed, then: ' + failMsg); }
          setRowResult(k, 'done', okCount + ' payment(s) pushed to Wave');
        } else if (act.kind === 'void_payments') {
          var vCount = 0;
          for (var vi = 0; vi < (d.unpushed_payments || []).length; vi++) {
            await dbUpdate('accounting_invoice_payments', d.unpushed_payments[vi].id, { voided: true, sync_status: 'voided_reconcile' }, uid);
            vCount += 1;
          }
          setRowResult(k, 'done', vCount + ' Hub payment(s) voided (kept for audit, no longer counted)');
        } else {
          throw new Error('Unknown action kind: ' + act.kind);
        }
      } catch (e) {
        setRowResult(k, 'error', (e && e.message) || 'failed');
      }
    }

    // Pass 2 — one import run covers ALL match-Wave import selections at once
    // (the importer is idempotent by wave id: creates the missing, updates the
    // mismatched, touches nothing else).
    if (needsImport) {
      try {
        var ij = await fetch('/api/wave/import-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: waveBiz, userId: uid }) }).then(function (r) { return r.json(); });
        var iok = !!(ij && (ij.ok === true || ij.report));
        keys.forEach(function (kk) {
          if (results[kk] && results[kk].status !== 'queued_import') { return; }
          var dd = diffMap[kk]; var aa = dd && dd.actions && dd.actions[choices[kk]];
          if (aa && aa.kind === 'import') {
            setRowResult(kk, iok ? 'done' : 'error', iok ? 'Covered by the Wave import run' : ('Import run failed: ' + ((ij && ij.error) || '?')));
          }
        });
      } catch (e2) {
        keys.forEach(function (kk) {
          var dd = diffMap[kk]; var aa = dd && dd.actions && dd.actions[choices[kk]];
          if (aa && aa.kind === 'import') { setRowResult(kk, 'error', 'Import run failed: ' + ((e2 && e2.message) || 'network')); }
        });
      }
    }

    logActivity(uid, 'Ran Wave reconciliation: processed ' + keys.length + ' queued action(s)', 'accounting_invoices');
    toast.success('Reconciliation queue processed — re-running the compare to verify…');
    setRunning(false);
    setChoices({});
    runCompare(); // the proof: the list should shrink to exactly what was skipped
  }

  if (!mayRun) {
    return <div className="p-3 text-xs rounded" style={{ background: '#fef3c7', color: '#1c1917' }}>Reconciliation needs Wave sync access.</div>;
  }

  var typeLabels = {
    wave_only: 'In Wave, not in Hub',
    hub_only: 'In Hub, not in Wave',
    total_mismatch: 'Different totals',
    paid_mismatch: 'Different paid amounts'
  };

  return (
    <div>
      <div className="rounded-xl p-3 mb-3" style={{ background: '#0f172a', border: '1px solid #334155' }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-sm font-extrabold text-slate-100">⚖️ Wave ↔ Hub Reconciliation</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Compares every invoice and its payments on both sides. Pick Match Hub or Match Wave per line, then submit the queue.</div>
          </div>
          <button onClick={runCompare} disabled={loading || running}
            className="px-4 py-2 rounded-lg text-xs font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50">
            {loading ? 'Comparing…' : '🔍 Compare Wave ↔ Hub'}
          </button>
        </div>
        {report && (
          <div className="flex gap-2 mt-3 flex-wrap">
            <span className="text-[11px] font-bold px-2 py-1 rounded bg-slate-800 text-slate-200">Wave: {report.wave_count}</span>
            <span className="text-[11px] font-bold px-2 py-1 rounded bg-slate-800 text-slate-200">Hub: {report.hub_count}</span>
            <span className="text-[11px] font-bold px-2 py-1 rounded" style={{ background: '#dcfce7', color: '#052e16' }}>✓ Matched: {report.matched}</span>
            <span className="text-[11px] font-bold px-2 py-1 rounded" style={report.diff_count === 0 ? { background: '#dcfce7', color: '#052e16' } : { background: '#fef3c7', color: '#1c1917' }}>
              {report.diff_count === 0 ? '✅ No differences' : '⚠ Differences: ' + report.diff_count}
            </span>
          </div>
        )}
      </div>

      {report && report.diff_count > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#0f172a', border: '1px solid #334155' }}>
          <div className="overflow-auto max-h-[520px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0" style={{ background: '#1e293b' }}>
                <tr>
                  <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Issue</th>
                  <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Invoice</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-sky-200">Wave total / paid</th>
                  <th className="px-2 py-1.5 text-right font-extrabold text-emerald-200">Hub total / paid</th>
                  <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Your decision</th>
                  <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Result</th>
                </tr>
              </thead>
              <tbody>
                {report.diffs.map(function (d) {
                  var k = rowKey(d);
                  var chosen = choices[k];
                  var res = results[k];
                  function actBtn(side, colorOn) {
                    var act = d.actions && d.actions[side];
                    if (!act) { return null; }
                    if (act.blocked) {
                      return <span className="text-[10px] px-1.5 py-1 rounded block mb-1" style={{ background: '#fef3c7', color: '#1c1917' }} title={act.blocked}>🚫 {side === 'match_hub' ? 'Match Hub' : 'Match Wave'} — {act.blocked}</span>;
                    }
                    var on = chosen === side;
                    return (
                      <button onClick={function () { choose(d, side); }} disabled={running}
                        className="text-[10px] font-extrabold px-2 py-1 rounded mr-1 mb-1"
                        style={on ? { background: colorOn, color: '#0f172a', border: '2px solid #f8fafc' } : { background: '#1e293b', color: '#cbd5e1', border: '2px solid #334155' }}
                        title={act.label}>
                        {on ? '✓ ' : ''}{side === 'match_hub' ? 'Match Hub' : 'Match Wave'}
                      </button>
                    );
                  }
                  return (
                    <tr key={k} className="border-b border-slate-800 align-top">
                      <td className="px-2 py-1.5">
                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded"
                          style={d.type === 'wave_only' ? { background: '#e0f2fe', color: '#0c4a6e' }
                            : d.type === 'hub_only' ? { background: '#dcfce7', color: '#052e16' }
                            : { background: '#fef3c7', color: '#1c1917' }}>
                          {typeLabels[d.type] || d.type}
                        </span>
                        {d.note && <div className="text-[10px] text-amber-300 mt-1 font-semibold">{d.note}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-mono font-extrabold text-indigo-300">{d.invoice_number || '—'}</div>
                        <div className="text-slate-400 text-[10px]">{d.customer || ''} {d.date ? '· ' + String(d.date).substring(0, 10) : ''}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-sky-200 whitespace-nowrap">
                        {fmtMoney(d.wave_total, d.currency)}<br /><span className="text-slate-400">{fmtMoney(d.wave_paid, '')}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-emerald-200 whitespace-nowrap">
                        {fmtMoney(d.hub_total, d.currency)}<br /><span className="text-slate-400">{fmtMoney(d.hub_paid, '')}</span>
                      </td>
                      <td className="px-2 py-1.5" style={{ minWidth: 190 }}>
                        {actBtn('match_hub', '#6ee7b7')}
                        {actBtn('match_wave', '#7dd3fc')}
                        {chosen && d.actions[chosen] && !d.actions[chosen].blocked && (
                          <div className="text-[10px] text-slate-300 mt-0.5">→ {d.actions[chosen].label}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5" style={{ minWidth: 150 }}>
                        {res && res.status === 'done' && <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: '#dcfce7', color: '#052e16' }}>✓ {res.detail}</span>}
                        {res && res.status === 'error' && <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: '#fee2e2', color: '#450a0a' }}>✗ {res.detail}</span>}
                        {res && res.status === 'running' && <span className="text-[10px] font-bold text-slate-300">⏳ {res.detail}…</span>}
                        {res && res.status === 'queued_import' && <span className="text-[10px] font-bold text-slate-400">{res.detail}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="p-3 flex items-center justify-between flex-wrap gap-2" style={{ background: '#1e293b', borderTop: '1px solid #334155' }}>
            <div className="text-[11px] font-bold text-slate-200">
              {queuedCount()} of {report.diff_count} line(s) queued
              {queuedCount() < report.diff_count && <span className="text-slate-400 font-medium"> — unqueued lines are left untouched; you can submit in batches.</span>}
            </div>
            <button onClick={submitQueue} disabled={running || queuedCount() === 0}
              className="px-5 py-2 rounded-lg text-xs font-extrabold text-white disabled:opacity-50"
              style={{ background: running ? '#475569' : '#059669' }}>
              {running ? '⏳ Processing queue…' : '▶ SUBMIT ' + queuedCount() + ' action(s)'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
