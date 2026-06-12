// v55.83-AK — Wave Import (Step 1: read-only preview). Pick the exact business
// (by ID, so the two same-named KTC LLCs can't be confused), then preview the
// real customer/invoice records. NOTHING is written to the Hub yet.
import { useState, useEffect } from 'react';

function money(m) { return m && m.value != null ? m.value : ''; }
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function WaveImportTab(props) {
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');

  var [businesses, setBusinesses] = useState([]);
  var [bizId, setBizId] = useState('');
  var [loadingBiz, setLoadingBiz] = useState(true);
  var [type, setType] = useState('customers');
  var [page, setPage] = useState(1);
  var [data, setData] = useState(null);
  var [busy, setBusy] = useState(false);
  var [importing, setImporting] = useState(false);
  var [report, setReport] = useState(null);
  var [conn, setConn] = useState(null);
  var [importingInv, setImportingInv] = useState(false);
  var [invReport, setInvReport] = useState(null);
  var [diag, setDiag] = useState(null);
  var [diagBusy, setDiagBusy] = useState(false);
  var [recon, setRecon] = useState(null);
  var [reconBusy, setReconBusy] = useState(false);

  function loadBusinesses() {
    setLoadingBiz(true);
    fetch('/api/wave/check').then(function (r) { return r.json(); }).then(function (d) {
      setConn(d || { connected: false, error: 'Empty response from server.' });
      setBusinesses(d && d.connected && d.businesses ? d.businesses : []);
    }).catch(function (e) {
      setConn({ connected: false, error: 'Request failed: ' + ((e && e.message) || 'network error') });
      setBusinesses([]);
    }).finally(function () { setLoadingBiz(false); });
  }
  useEffect(function () { loadBusinesses(); }, []);

  function preview(t, p) {
    if (!bizId) return;
    setBusy(true); setType(t); setPage(p);
    fetch('/api/wave/import-preview?businessId=' + encodeURIComponent(bizId) + '&type=' + t + '&page=' + p)
      .then(function (r) { return r.json(); })
      .then(function (d) { setData(d); })
      .catch(function (e) { setData({ ok: false, error: 'Request failed: ' + ((e && e.message) || 'unknown') }); })
      .finally(function () { setBusy(false); });
  }

  function runDiagnostic() {
    if (!bizId) return;
    setDiagBusy(true); setDiag(null);
    fetch('/api/wave/invoice-diagnostic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: bizId }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { setDiag(d); })
      .catch(function (e) { setDiag({ ok: false, error: 'Request failed: ' + ((e && e.message) || 'unknown') }); })
      .finally(function () { setDiagBusy(false); });
  }

  function runImportInvoices() {
    if (!bizId) return;
    if (!window.confirm('Import ALL invoices (and their line items) from the selected Wave business into the Hub? Safe and re-runnable — it matches on Wave invoice ID, so re-running updates instead of duplicating. Make sure you imported customers first.')) return;
    setImportingInv(true); setInvReport(null);
    fetch('/api/wave/import-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: bizId, userId: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { setInvReport(d && d.report ? d.report : { errors: [d && d.error ? d.error : 'Unknown error'] }); })
      .catch(function (e) { setInvReport({ errors: ['Request failed: ' + ((e && e.message) || 'unknown')] }); })
      .finally(function () { setImportingInv(false); });
  }

  function runImportCustomers() {
    if (!bizId) return;
    if (!window.confirm('Import customers from the selected Wave business into the Hub? This is safe and re-runnable (no duplicates), and customers carry no balances.')) return;
    setImporting(true); setReport(null);
    fetch('/api/wave/import-customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: bizId, userId: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { setReport(d && d.report ? d.report : { errors: [d && d.error ? d.error : 'Unknown error'] }); })
      .catch(function (e) { setReport({ errors: ['Request failed: ' + ((e && e.message) || 'unknown')] }); })
      .finally(function () { setImporting(false); });
  }

  if (!isSuperAdmin) {
    return <div className="p-6"><div className="bg-amber-100 border-2 border-amber-300 rounded-lg p-4 text-amber-950"><div className="font-extrabold">🔒 Owner only</div></div></div>;
  }

  function runReconcile() {
    if (!bizId) { return; }
    setReconBusy(true); setRecon(null);
    fetch('/api/wave/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: bizId }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { setRecon(j); })
      .catch(function (e) { setRecon({ ok: false, error: String(e) }); })
      .finally(function () { setReconBusy(false); });
  }
  function downloadReconCsv() {
    if (!recon || !recon.topMismatches) { return; }
    var head = 'invoice,year,where,wave_status,hub_status,wave_total,wave_paid,wave_due,hub_total,hub_paid,hub_balance,delta_total,delta_paid,delta_balance\n';
    var lines = recon.topMismatches.map(function (m) {
      return [m.num, m.year, m.in, m.wStatus || '', m.hStatus || '', m.wTotal, m.wPaid, m.wDue, m.hTotal == null ? '' : m.hTotal, m.hPaid == null ? '' : m.hPaid, m.hBal == null ? '' : m.hBal, m.dTotal == null ? '' : m.dTotal, m.dPaid == null ? '' : m.dPaid, m.dBal == null ? '' : m.dBal].join(',');
    }).join('\n');
    var blob = new Blob([head + lines], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'wave-hub-reconcile-mismatches.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 text-slate-100 max-w-3xl">
      <div className="text-lg font-extrabold mb-1">⬇️ Wave Import — Preview</div>
      <div className="bg-white text-slate-900 rounded p-3 text-xs font-medium mb-3">
        Pick the exact business, then preview its real customers and invoices. <b>This is preview only — nothing is saved into the Hub yet.</b> The next step adds importing with duplicate detection. Wave gives each invoice\u2019s Paid / Due / Status (your AR balance); detailed cash transactions come from Plaid, not Wave.
      </div>

      <div className="rounded p-2 mb-3 text-xs font-semibold flex items-center justify-between gap-2 flex-wrap"
        style={{ background: conn && conn.connected ? '#dcfce7' : (conn && conn.configured === false ? '#fef9c3' : '#fee2e2'), color: '#0f172a' }}>
        <span>
          {loadingBiz ? 'Checking Wave connection…'
            : conn && conn.connected ? ('✅ Connected to Wave — ' + (businesses.length) + ' business(es) found')
            : conn && conn.configured === false ? ('⚙️ Wave token missing on the server. ' + (conn.error || ''))
            : conn ? ('❌ Wave error: ' + (conn.error || 'not connected'))
            : '—'}
        </span>
        <button onClick={loadBusinesses} disabled={loadingBiz} className="bg-white text-slate-900 border border-slate-300 rounded px-2 py-0.5 font-bold disabled:opacity-50">Recheck</button>
      </div>
      {conn && conn.connected && businesses.length === 0 && (
        <div className="bg-amber-100 text-amber-950 rounded p-2 mb-3 text-xs font-medium">Connected, but Wave returned no businesses for this token.</div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <label className="text-xs text-slate-300">Business:</label>
        <select value={bizId} onChange={function (e) { setBizId(e.target.value); setData(null); }} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs min-w-[280px]">
          <option value="">{loadingBiz ? 'Loading…' : '— choose a business —'}</option>
          {businesses.map(function (b, i) {
            return <option key={i} value={b.id}>{b.name + '  ·  id ' + String(b.id).slice(0, 10) + '…'}</option>;
          })}
        </select>
        <button disabled={!bizId || busy} onClick={function () { preview('customers', 1); }} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold disabled:opacity-50">Preview customers</button>
        <button disabled={!bizId || busy} onClick={function () { preview('invoices', 1); }} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded text-xs font-bold disabled:opacity-50">Preview invoices</button>
      </div>
      <div className="text-[11px] text-slate-400 mb-3">Two of your businesses share the name "KTC INTERNATIONAL ENTERPRISES LLC" — the ID after each name tells them apart. Choose the one with your real invoices.</div>

      {busy && <div className="text-slate-300 text-sm">Loading from Wave…</div>}

      {data && (data.ok ? (
        <div className="bg-white text-slate-900 rounded-lg p-3 border border-slate-200">
          <div className="font-extrabold mb-1">{data.businessName} — {data.type === 'invoices' ? 'Invoices' : 'Customers'}</div>
          <div className="text-xs text-slate-600 mb-2">Total in Wave: <b>{data.totalCount == null ? '—' : data.totalCount}</b> · showing page {data.currentPage} of {data.totalPages}</div>
          <div className="overflow-x-auto">
            {data.type === 'invoices' ? (
              <table className="w-full text-xs">
                <thead><tr className="text-slate-600 text-left"><th className="py-1">Invoice #</th><th>Customer</th><th>Status</th><th>Date</th><th className="text-right">Total</th><th className="text-right">Paid</th><th className="text-right">Due</th></tr></thead>
                <tbody>{(data.items || []).map(function (it, i) { return <tr key={i} className="border-t border-slate-100"><td className="py-1 font-bold">{it.invoiceNumber || it.id}</td><td>{it.customer && it.customer.name}</td><td>{it.status}</td><td>{it.invoiceDate}</td><td className="text-right">{money(it.total)}</td><td className="text-right">{money(it.amountPaid)}</td><td className="text-right">{money(it.amountDue)}</td></tr>; })}</tbody>
              </table>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="text-slate-600 text-left"><th className="py-1">Name</th><th>Email</th><th>Phone</th></tr></thead>
                <tbody>{(data.items || []).map(function (it, i) { return <tr key={i} className="border-t border-slate-100"><td className="py-1 font-bold">{it.name}</td><td>{it.email}</td><td>{it.phone}</td></tr>; })}</tbody>
              </table>
            )}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button disabled={busy || data.currentPage <= 1} onClick={function () { preview(data.type, data.currentPage - 1); }} className="px-2 py-1 bg-slate-200 rounded text-xs font-bold disabled:opacity-40">← Prev</button>
            <button disabled={busy || data.currentPage >= data.totalPages} onClick={function () { preview(data.type, data.currentPage + 1); }} className="px-2 py-1 bg-slate-200 rounded text-xs font-bold disabled:opacity-40">Next →</button>
          </div>
        </div>
      ) : (
        <div className="bg-rose-100 text-rose-950 rounded-lg p-3 text-xs font-medium">{data.error || 'Preview failed.'}</div>
      ))}

      {bizId && (
        <div className="mt-5 border-t border-slate-700 pt-4">
          <div className="text-sm font-bold text-slate-200 mb-1">Step 2 — Import customers into the Hub</div>
          <div className="text-[11px] text-slate-400 mb-2">Safe and re-runnable: matches on Wave customer ID, so running it again updates instead of duplicating. (Invoices are a separate, later import.)</div>
          <button onClick={runImportCustomers} disabled={importing} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold disabled:opacity-50">
            {importing ? 'Importing…' : 'Import customers into Hub'}
          </button>
          {report && (
            <div className="bg-white text-slate-900 rounded-lg p-3 mt-3 border border-slate-200 text-xs">
              <div className="font-extrabold mb-1">📋 Import report</div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div className="bg-emerald-100 text-emerald-950 rounded p-2"><div className="text-lg font-extrabold">{report.created || 0}</div>created</div>
                <div className="bg-sky-100 text-sky-950 rounded p-2"><div className="text-lg font-extrabold">{report.updated || 0}</div>updated</div>
                <div className="bg-amber-100 text-amber-950 rounded p-2"><div className="text-lg font-extrabold">{report.skipped || 0}</div>skipped</div>
              </div>
              <div className="text-slate-600">Total read from Wave: {report.total == null ? '—' : report.total} · {report.timestamp || ''}</div>
              {(report.errors && report.errors.length > 0) && (
                <div className="mt-2"><div className="font-bold text-rose-700">Errors ({report.errors.length}):</div>
                  <ul className="list-disc ml-4 text-rose-700">{report.errors.slice(0, 20).map(function (er, i) { return <li key={i}>{er}</li>; })}</ul>
                  {report.errors.length > 20 && <div className="text-rose-700">…and {report.errors.length - 20} more</div>}
                </div>
              )}
              {(!report.errors || report.errors.length === 0) && <div className="text-emerald-700 font-bold mt-1">✓ No errors.</div>}
            </div>
          )}

          <div className="mt-4 border-t border-slate-700 pt-3">
            <div className="text-sm font-bold text-slate-200 mb-1">Step 3 — Import invoices (+ line items) into the Hub</div>
            <div className="text-[11px] text-slate-400 mb-2">Import customers first. Safe and re-runnable: matches on Wave invoice ID. Wave's paid amount is kept as a baseline (wave_imported_paid) — no payment records are created here; bank-matched payments stay separate.</div>
            <button onClick={runImportInvoices} disabled={importingInv} className="px-4 py-2 bg-teal-700 hover:bg-teal-600 text-white rounded text-sm font-bold disabled:opacity-50">
              {importingInv ? 'Importing invoices…' : 'Import invoices into Hub'}
            </button>
            <button onClick={runDiagnostic} disabled={diagBusy} className="ml-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-bold disabled:opacity-50">
              {diagBusy ? 'Running…' : '🔬 Diagnose totals'}
            </button>
            {diag && (
              <div className="bg-slate-950 text-slate-100 rounded-lg p-3 mt-3 border border-slate-700 text-[11px]">
                <div className="font-extrabold mb-1 text-amber-300">🔬 Wave total diagnostic — which field carries the real total?</div>
                {diag.ok === false ? <div className="text-rose-400">{diag.error}</div> : (diag.invoices || []).map(function (iv, ix) {
                  return <div key={ix} className="border-t border-slate-800 py-1">
                    <div className="font-bold text-slate-100">{iv.invoiceNumber} · {iv.status}</div>
                    <div className="text-slate-300">Wave mapped → total: <b className="text-amber-300">{String(iv.mapped_with_num && iv.mapped_with_num.total)}</b> · subtotal: {String(iv.mapped_with_num && iv.mapped_with_num.subtotal)} · tax: {String(iv.mapped_with_num && iv.mapped_with_num.taxTotal)} · paid: {String(iv.mapped_with_num && iv.mapped_with_num.amountPaid)} · due: {String(iv.mapped_with_num && iv.mapped_with_num.amountDue)}</div>
                    <div className="text-slate-400">DB row → total_amount: {iv.db_row ? String(iv.db_row.total_amount) : '(not in DB)'} · balance_due: {iv.db_row ? String(iv.db_row.balance_due) : '—'}</div>
                  </div>;
                })}
                <pre className="mt-2 overflow-x-auto text-[10px] text-slate-400" style={{ maxHeight: '220px' }}>{JSON.stringify(diag, null, 2)}</pre>
              </div>
            )}
            {invReport && (
              <div className="bg-white text-slate-900 rounded-lg p-3 mt-3 border border-slate-200 text-xs">
                <div className="font-extrabold mb-1">📋 Invoice import report</div>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  <div className="bg-emerald-100 text-emerald-950 rounded p-2"><div className="text-lg font-extrabold">{invReport.created || 0}</div>created</div>
                  <div className="bg-sky-100 text-sky-950 rounded p-2"><div className="text-lg font-extrabold">{invReport.updated || 0}</div>updated</div>
                  <div className="bg-amber-100 text-amber-950 rounded p-2"><div className="text-lg font-extrabold">{invReport.skipped || 0}</div>skipped</div>
                  <div className="bg-violet-100 text-violet-950 rounded p-2"><div className="text-lg font-extrabold">{invReport.lineItems || 0}</div>line items</div>
                </div>
                <div className="text-slate-600">Total read: {invReport.total == null ? '—' : invReport.total} · {invReport.timestamp || ''}</div>
                {(invReport.placeholders && invReport.placeholders.length > 0) && (
                  <div className="mt-2 bg-amber-50 text-amber-950 rounded p-2"><b>{invReport.placeholders.length} placeholder customer(s) created</b> (Wave customer wasn't imported) — flagged for review: {invReport.placeholders.slice(0, 10).join(', ')}{invReport.placeholders.length > 10 ? '…' : ''}</div>
                )}
                {(invReport.errors && invReport.errors.length > 0) ? (
                  <div className="mt-2"><div className="font-bold text-rose-700">Errors ({invReport.errors.length}):</div>
                    <ul className="list-disc ml-4 text-rose-700">{invReport.errors.slice(0, 20).map(function (er, i) { return <li key={i}>{er}</li>; })}</ul>
                    {invReport.errors.length > 20 && <div className="text-rose-700">…and {invReport.errors.length - 20} more</div>}
                  </div>
                ) : <div className="text-emerald-700 font-bold mt-1">✓ No errors.</div>}
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-slate-700 pt-3">
            <div className="text-sm font-bold text-slate-200 mb-1">Step 4 — Reconcile Wave vs Hub (read-only audit)</div>
            <div className="text-[11px] text-slate-400 mb-2">Pulls every invoice from Wave and from the Hub, matches them on Wave invoice ID, and shows exactly where totals, paid, or balance disagree. It writes nothing.</div>
            <button onClick={runReconcile} disabled={reconBusy} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm font-bold disabled:opacity-50">
              {reconBusy ? 'Reconciling… (can take a minute)' : '⚖️ Reconcile Wave vs Hub'}
            </button>
            {recon && (recon.ok === false ? (
              <div className="bg-rose-100 text-rose-950 rounded-lg p-3 mt-3 text-xs font-medium">{recon.error}</div>
            ) : (
              <div className="bg-white text-slate-900 rounded-lg p-3 mt-3 border border-slate-200 text-xs">
                <div className="font-extrabold mb-2">⚖️ Reconciliation — Wave vs Hub</div>
                <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
                  <div className="bg-slate-100 rounded p-2"><div className="text-[10px] font-bold text-slate-600">WAVE INVOICES</div><div className="text-lg font-extrabold">{recon.waveCount}</div></div>
                  <div className="bg-slate-100 rounded p-2"><div className="text-[10px] font-bold text-slate-600">HUB (WAVE-LINKED)</div><div className="text-lg font-extrabold">{recon.hubWithWaveId}</div></div>
                  <div className="bg-emerald-100 text-emerald-950 rounded p-2"><div className="text-[10px] font-bold">MATCHED</div><div className="text-lg font-extrabold">{recon.matched}</div></div>
                  <div className="bg-rose-100 text-rose-950 rounded p-2"><div className="text-[10px] font-bold">MISMATCHED</div><div className="text-lg font-extrabold">{recon.mismatched}</div></div>
                  <div className="bg-amber-100 text-amber-950 rounded p-2"><div className="text-[10px] font-bold">IN WAVE, NOT HUB</div><div className="text-lg font-extrabold">{recon.missingInHub}</div></div>
                  <div className="bg-amber-100 text-amber-950 rounded p-2"><div className="text-[10px] font-bold">IN HUB, NOT WAVE</div><div className="text-lg font-extrabold">{recon.missingInWave}</div></div>
                </div>
                <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
                  <div className="bg-slate-100 rounded p-2"><div className="text-[10px] font-bold text-slate-600">WAVE AR (all due)</div><div className="text-base font-extrabold">${fmt(recon.waveAR)}</div></div>
                  <div className="bg-slate-100 rounded p-2"><div className="text-[10px] font-bold text-slate-600">WAVE AR (excl. draft/unsent)</div><div className="text-base font-extrabold">${fmt(recon.waveAR_nonDraft)}</div></div>
                  <div className="bg-slate-100 rounded p-2"><div className="text-[10px] font-bold text-slate-600">HUB AR (open balance)</div><div className="text-base font-extrabold">${fmt(recon.hubAR)}</div></div>
                  <div className={'rounded p-2 ' + (Math.abs(recon.arDifference) < 1 ? 'bg-emerald-100 text-emerald-950' : 'bg-rose-100 text-rose-950')}><div className="text-[10px] font-bold">HUB − WAVE DIFF</div><div className="text-base font-extrabold">${fmt(recon.arDifference)}</div></div>
                </div>
                <div className="mb-2">
                  <div className="font-bold mb-1">By year — Wave / Hub (green = counts match):</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(recon.byYear).sort().map(function (y) { var b = recon.byYear[y]; var okc = b.wave === b.hub; return <span key={y} className={'rounded px-2 py-1 text-[11px] font-bold ' + (okc ? 'bg-emerald-100 text-emerald-950' : 'bg-rose-100 text-rose-950')}>{y}: {b.wave}/{b.hub}</span>; })}
                  </div>
                </div>
                <div className="mb-2">
                  <div className="font-bold mb-1">Wave status counts:</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(recon.statusWave).sort().map(function (st) { return <span key={st} className="rounded px-2 py-1 text-[11px] font-bold bg-slate-100 text-slate-800">{st}: {recon.statusWave[st]}</span>; })}
                  </div>
                </div>
                <div className="flex items-center justify-between mb-1 mt-3">
                  <div className="font-bold">Worst mismatches (top {(recon.topMismatches || []).length})</div>
                  <button onClick={downloadReconCsv} className="bg-slate-800 text-white rounded px-2 py-1 text-[11px] font-bold">⬇ Download CSV</button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="w-full text-[11px]" style={{ minWidth: '820px' }}>
                    <thead><tr className="text-slate-600 text-left border-b border-slate-200"><th className="py-1">Invoice</th><th>Yr</th><th>Wave status</th><th className="text-right">Wave total</th><th className="text-right">Wave paid</th><th className="text-right">Wave due</th><th className="text-right">Hub total</th><th className="text-right">Hub paid</th><th className="text-right">Hub bal</th><th>Where</th></tr></thead>
                    <tbody>{(recon.topMismatches || []).map(function (m, i) {
                      return <tr key={i} className="border-b border-slate-100">
                        <td className="py-1 font-mono font-bold text-slate-900">{m.num}</td><td className="text-slate-700">{m.year}</td><td className="text-slate-700">{m.wStatus || '—'}</td>
                        <td className="text-right font-mono text-slate-900">{fmt(m.wTotal)}</td><td className="text-right font-mono text-slate-900">{fmt(m.wPaid)}</td><td className="text-right font-mono text-slate-900">{fmt(m.wDue)}</td>
                        <td className="text-right font-mono text-slate-900">{m.hTotal == null ? '—' : fmt(m.hTotal)}</td><td className="text-right font-mono text-slate-900">{m.hPaid == null ? '—' : fmt(m.hPaid)}</td><td className="text-right font-mono text-slate-900">{m.hBal == null ? '—' : fmt(m.hBal)}</td>
                        <td className="text-slate-700">{m.in === 'wave_only' ? 'missing in Hub' : 'both'}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
                {recon.arAudit && (
                  <div className="mt-4 border-t border-slate-200 pt-3">
                    <div className="font-extrabold mb-2">💱 AR integrity — currency + drafts</div>
                    <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
                      <div className="bg-rose-100 text-rose-950 rounded p-2"><div className="text-[10px] font-bold">CURRENT AR (native, mixed currency)</div><div className="text-base font-extrabold">{fmt(recon.arAudit.currentNative)}</div><div className="text-[10px]">what the dashboard shows now</div></div>
                      <div className="bg-amber-100 text-amber-950 rounded p-2"><div className="text-[10px] font-bold">AR EXCLUDING DRAFTS</div><div className="text-base font-extrabold">{fmt(recon.arAudit.exDraftNative)}</div><div className="text-[10px]">removed {fmt(recon.arAudit.draftNative)} of drafts</div></div>
                      <div className="bg-amber-100 text-amber-950 rounded p-2"><div className="text-[10px] font-bold">EXCL. DRAFTS + VOID/CANCEL/ARCHIVE</div><div className="text-base font-extrabold">{fmt(recon.arAudit.exDraftVoidNative)}</div><div className="text-[10px]">{fmt(recon.arAudit.voidishNative)} already excluded</div></div>
                      <div className="bg-emerald-100 text-emerald-950 rounded p-2"><div className="text-[10px] font-bold">AFTER CURRENCY NORMALIZATION (USD)</div><div className="text-base font-extrabold">${fmt(recon.arAudit.normalizedUsd)}</div><div className="text-[10px]">clean set converted to USD</div></div>
                    </div>
                    <div className="mb-2 text-[11px]">
                      <span className="font-bold text-slate-900">AR by currency (clean set, native): </span>
                      {Object.keys(recon.arAudit.byCurrencyNative).map(function (c) { return <span key={c} className="inline-block bg-slate-100 text-slate-800 rounded px-2 py-0.5 mr-1 font-bold">{c}: {fmt(recon.arAudit.byCurrencyNative[c])}</span>; })}
                    </div>
                    {recon.arAudit.unconvertibleNative > 0 && (
                      <div className="bg-amber-100 text-amber-950 rounded p-2 text-[11px] mb-2"><b>Note:</b> {fmt(recon.arAudit.unconvertibleNative)} of non-USD AR has no matching FX rate logged, so it isn't in the USD figure yet. Log the USD↔currency rate in FX Rates for an exact number.</div>
                    )}
                    <div className="font-bold mb-1 text-slate-900">Top 20 customers</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="w-full text-[11px]" style={{ minWidth: '640px' }}>
                        <thead><tr className="text-slate-600 text-left border-b border-slate-200"><th className="py-1">Customer</th><th className="text-right">Current (native)</th><th className="text-right">After currency fix (USD)</th><th className="text-right">After draft excl. (native)</th><th className="text-right">Final correct (USD)</th></tr></thead>
                        <tbody>{(recon.topCustomers || []).map(function (c, i) { return <tr key={i} className="border-b border-slate-100"><td className="py-1 font-medium text-slate-900 truncate" style={{ maxWidth: '170px' }}>{c.name}</td><td className="text-right font-mono text-slate-900">{fmt(c.currentNative)}</td><td className="text-right font-mono text-slate-900">{fmt(c.afterCurrencyFix)}</td><td className="text-right font-mono text-slate-900">{fmt(c.afterDraftExclusion)}</td><td className="text-right font-mono font-bold text-emerald-800">{fmt(c.finalCorrect)}</td></tr>; })}</tbody>
                      </table>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">“Current (native)” adds EGP + USD at face value — that is the bug. “After currency fix” converts each invoice to USD via your logged FX rates. “Final correct” = USD + drafts removed.</div>
                  </div>
                )}
                <div className="text-[10px] text-slate-500 mt-2">Read-only — nothing changed. A large “Hub − Wave diff” usually means Hub is counting draft/unsent invoices as open that Wave excludes, or a stale paid amount on specific invoices (download the CSV to see every one).</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
