// v55.83-AK — Wave Import (Step 1: read-only preview). Pick the exact business
// (by ID, so the two same-named KTC LLCs can't be confused), then preview the
// real customer/invoice records. NOTHING is written to the Hub yet.
import { useState, useEffect } from 'react';

function money(m) { return m && m.value != null ? m.value : ''; }

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
        </div>
      )}
    </div>
  );
}
