// v55.83-AK — Wave Import (Step 1: read-only preview). Pick the exact business
// (by ID, so the two same-named KTC LLCs can't be confused), then preview the
// real customer/invoice records. NOTHING is written to the Hub yet.
import { useState, useEffect } from 'react';
import RestrictedNotice from './RestrictedNotice';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { supabase } from '../lib/supabase';
import { getActiveWaveBusiness, setActiveWaveBusiness, canWriteToWaveBusiness } from '../lib/wave-business';

function money(m) { return m && m.value != null ? m.value : ''; }
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function estimateErrorHelp(errors) {
  var text = (errors || []).join(' | ');
  if (!text) { return ''; }
  if (/Cannot query field.*estimates|Cannot query field.*estimate|Field .*estimate/i.test(text)) {
    return 'Wave did not expose Estimates to this API token/response. This only affects optional Estimate -> Proforma import. It does not block categories, bank transactions, invoice payments, or pushes.';
  }
  if (/schema cache|column|accounting_proformas|accounting_proforma_items|wave_estimate_id|wave_business_id/i.test(text)) {
    return 'The Hub proforma/estimate database columns are missing or stale. Run the proforma estimate migration, then retry this optional import.';
  }
  if (/No estimates|business id|token|access|not found|cannot access|permission/i.test(text)) {
    return 'Wave returned no estimate list for the selected business/token. Confirm the selected Wave business, or skip this optional importer if you do not use Wave Estimates.';
  }
  return 'This only affects optional Wave Estimates -> Hub Proformas. It does not block the main Wave import path: categories, bank transactions, invoice payment linking, or push.';
}

export default function WaveImportTab(props) {
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');

  var [businesses, setBusinesses] = useState([]);
  var initialWaveBusiness = getActiveWaveBusiness();
  var [bizId, setBizId] = useState(initialWaveBusiness || '');
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
  var [importingEst, setImportingEst] = useState(false); // v55.83-IQ — estimates → proformas
  var [estReport, setEstReport] = useState(null);
  var [diag, setDiag] = useState(null);
  var [diagBusy, setDiagBusy] = useState(false);
  var [recon, setRecon] = useState(null);
  var [reconBusy, setReconBusy] = useState(false);
  var [registry, setRegistry] = useState([]);
  var [registering, setRegistering] = useState(false);
  var [legacyNulls, setLegacyNulls] = useState(0);
  var [catBusy, setCatBusy] = useState(false);
  var [catMsg, setCatMsg] = useState('');
  var [csvText, setCsvText] = useState('');
  var [csvBusy, setCsvBusy] = useState(false);
  var [csvResult, setCsvResult] = useState(null);
  var [csvOverride, setCsvOverride] = useState(false);
  var [probeBusy, setProbeBusy] = useState(false);
  var [probeResult, setProbeResult] = useState(null);
  var [prefillBusy, setPrefillBusy] = useState(false);
  var [prefillResult, setPrefillResult] = useState(null);

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

  // v55.83-CA — load the Wave business registry + count untagged legacy Wave
  // invoices so we can gate imports and keep test data out of real KTC views.
  function loadRegistry() {
    fetchAllRows('wave_business_registry', '*').then(function (rows) { setRegistry((rows && rows.data) || []); }).catch(function () { setRegistry([]); });
  }
  useEffect(function () {
    loadRegistry();
    fetchAllRows('accounting_invoices', 'id,wave_business_id,wave_invoice_id').then(function (rows) {
      var arr = (rows && rows.data) || []; var n = 0; arr.forEach(function (r) { if ((r.wave_business_id == null || r.wave_business_id === '') && r.wave_invoice_id) n++; });
      setLegacyNulls(n);
    }).catch(function () {});
  }, []);

  function selReg() { var reg = null; registry.forEach(function (b) { if (b.wave_business_id === bizId) reg = b; }); return reg; }
  function registerBusiness(isProd) {
    if (!bizId) { return; }
    var name = ((businesses.find(function (b) { return b.id === bizId; }) || {}).name) || bizId;
    var warn = isProd
      ? 'Register "' + name + '" as a REAL production business?\n\nIt will be READ-ONLY (the Hub never pushes or deletes to Wave). Its records get tagged to this business and stay separated from your other Wave businesses.'
      : 'Register "' + name + '" as a TEST business?\n\nWRITES will be ALLOWED on it and it will be kept OUT of your real KTC views. Only do this for a throwaway/test company \u2014 NEVER for real accounting data.';
    if (!window.confirm(warn)) { return; }
    setRegistering(true);
    supabase.from('wave_business_registry').upsert({ wave_business_id: bizId, label: name, is_production: isProd, writes_enabled: isProd ? false : true }, { onConflict: 'wave_business_id' }).then(function (res) {
      setRegistering(false);
      if (res && res.error) { window.alert('Could not register: ' + res.error.message); return; }
      loadRegistry();
    });
  }
  function importBlockReason() {
    if (!bizId) { return 'Choose a Wave business first.'; }
    if (!selReg()) { return 'This Wave business is not registered yet. Add it to wave_business_registry (with its production/test flag) before importing, so its records stay walled off from your other Wave business.'; }
    if (legacyNulls > 0) { return 'Legacy Wave records need backfill before importing another Wave business — ' + legacyNulls + ' existing invoice(s) have no business tag. Run the backfill SQL first so old KTC data does not get mixed in.'; }
    return null;
  }

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
    var blkI = importBlockReason(); if (blkI) { window.alert(blkI); return; }
    if (!window.confirm('Import ALL invoices (and their line items) from the selected Wave business into the Hub? Safe and re-runnable — it matches on Wave invoice ID, so re-running updates instead of duplicating. Make sure you imported customers first.')) return;
    setImportingInv(true); setInvReport(null);
    fetch('/api/wave/import-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: bizId, userId: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { setInvReport(d && d.report ? d.report : { errors: [d && d.error ? d.error : 'Unknown error'] }); })
      .catch(function (e) { setInvReport({ errors: ['Request failed: ' + ((e && e.message) || 'unknown')] }); })
      .finally(function () { setImportingInv(false); });
  }

  // v55.83-IQ — pull Wave ESTIMATES into the Hub as PROFORMAS (per silo).
  function runImportEstimates() {
    var blkE = importBlockReason(); if (blkE) { window.alert(blkE); return; }
    if (!window.confirm('Import ALL estimates from the selected Wave business into the Hub as Proformas? Safe and re-runnable — matches on Wave estimate ID. Import customers first.')) return;
    setImportingEst(true); setEstReport(null);
    fetch('/api/wave/import-estimates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: bizId, userId: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { setEstReport(d && d.report ? d.report : { errors: [d && d.error ? d.error : 'Unknown error'] }); })
      .catch(function (e) { setEstReport({ errors: ['Request failed: ' + ((e && e.message) || 'unknown')] }); })
      .finally(function () { setImportingEst(false); });
  }

  function runImportCustomers() {
    var blkC = importBlockReason(); if (blkC) { window.alert(blkC); return; }
    if (!window.confirm('Import customers from the selected Wave business into the Hub? This is safe and re-runnable (no duplicates), and customers carry no balances.')) return;
    setImporting(true); setReport(null);
    fetch('/api/wave/import-customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: bizId, userId: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { setReport(d && d.report ? d.report : { errors: [d && d.error ? d.error : 'Unknown error'] }); })
      .catch(function (e) { setReport({ errors: ['Request failed: ' + ((e && e.message) || 'unknown')] }); })
      .finally(function () { setImporting(false); });
  }

  function runCategoryPull() {
    if (!bizId) { window.alert('Choose a Wave business first.'); return; }
    if (!selReg()) { window.alert('Register this Wave business first so the pulled accounts stay in the right silo.'); return; }
    setCatBusy(true); setCatMsg('Pulling Wave Chart of Accounts...');
    fetch('/api/wave/sync-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: bizId, includeProduction: true, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.text().then(function (t) { var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || ''; if (!r.ok || ct.indexOf('application/json') < 0) { throw new Error('Got HTTP ' + r.status + ': ' + t.slice(0, 200)); } return JSON.parse(t); }); })
      .then(function (d) {
        if (d && d.results && d.results.length) {
          var res0 = d.results[0];
          var sum = res0.summary || res0;
          if (res0.ok === false) { setCatMsg('Blocked: ' + (res0.error || (res0.errors && res0.errors.join('; ')) || 'Wave returned an error.')); return; }
          var totalAcc = (res0.total != null) ? res0.total : ((sum.created || 0) + (sum.updated || 0) + (sum.skipped || 0));
          setCatMsg('Done: ' + totalAcc + ' Wave accounts loaded (' + (sum.created || 0) + ' new, ' + (sum.updated || 0) + ' updated, ' + (sum.skipped || 0) + ' unchanged).');
        } else if (d && d.message) { setCatMsg('No accounts pulled: ' + d.message); }
        else if (d && d.error) { setCatMsg('Error: ' + d.error); }
        else { setCatMsg(JSON.stringify(d).slice(0, 300)); }
      })
      .catch(function (e) { setCatMsg('Request failed: ' + ((e && e.message) || String(e))); })
      .finally(function () { setCatBusy(false); });
  }

  function runCsvImport(apply) {
    if (!bizId) { window.alert('Choose a Wave business first.'); return; }
    if (!String(csvText || '').trim()) { window.alert('Paste the Wave Transactions CSV first. In Wave: Accounting > Transactions > Export.'); return; }
    setCsvBusy(true); setCsvResult(null);
    fetch('/api/wave/import-transaction-csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: bizId, csv: csvText, dry_run: !apply, override_conflicts: csvOverride, user_id: userProfile && userProfile.id, filename: 'wave-transactions-export.csv' }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { setCsvResult(d); if (!d || !d.ok) { return; } if (!d.dry_run) { setCsvText(''); } })
      .catch(function (e) { setCsvResult({ ok: false, error: 'Request failed: ' + ((e && e.message) || 'unknown') }); })
      .finally(function () { setCsvBusy(false); });
  }

  function runPaymentReadback() {
    if (!bizId) { window.alert('Choose a Wave business first.'); return; }
    setProbeBusy(true); setProbeResult(null);
    fetch('/api/wave/payment-readback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: bizId, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { setProbeResult(d); })
      .catch(function (e) { setProbeResult({ ok: false, error: 'Request failed: ' + ((e && e.message) || 'unknown') }); })
      .finally(function () { setProbeBusy(false); });
  }

  function runPrefillLinks(apply) {
    if (!bizId) { window.alert('Choose a Wave business first.'); return; }
    setPrefillBusy(true); setPrefillResult(null);
    fetch('/api/wave/prefill-payment-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: bizId, dry_run: !apply, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { setPrefillResult(d); })
      .catch(function (e) { setPrefillResult({ ok: false, error: 'Request failed: ' + ((e && e.message) || 'unknown') }); })
      .finally(function () { setPrefillBusy(false); });
  }

  if (!isSuperAdmin) {
    return <div className="p-6"><RestrictedNotice title="Owner only" message="Only the account owner can use Wave Import." /></div>;
  }

  function runReconcile() {
    if (!bizId) { return; }
    setReconBusy(true); setRecon(null);
    fetch('/api/wave/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: bizId, userId: userProfile && userProfile.id }) })
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
    <div className="p-4 text-slate-100 max-w-5xl">
      <div className="text-lg font-extrabold mb-1">Wave Import - pull Wave truth into the Hub</div>
      <div className="bg-white text-slate-900 rounded p-3 text-xs font-medium mb-3">
        Pick the exact business once, then run the Wave-to-Hub imports below. Customers, invoices, payments, and the Chart of Accounts come from Wave APIs. Prior transaction categorizations require Wave's Transactions CSV export because Wave does not expose historical categorized bank transactions through the public API.
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
        <select value={bizId} onChange={function (e) { setBizId(e.target.value); setActiveWaveBusiness(e.target.value); setData(null); }} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs min-w-[280px]">
          <option value="">{loadingBiz ? 'Loading…' : '— choose a business —'}</option>
          {businesses.map(function (b, i) {
            return <option key={i} value={b.id}>{b.name + '  ·  id ' + String(b.id).slice(0, 10) + '…'}</option>;
          })}
        </select>
        <button disabled={!bizId || busy} onClick={function () { preview('customers', 1); }} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold disabled:opacity-50">Preview customers</button>
        <button disabled={!bizId || busy} onClick={function () { preview('invoices', 1); }} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded text-xs font-bold disabled:opacity-50">Preview invoices</button>
      </div>
      <div className="text-[11px] text-slate-400 mb-3">Two of your businesses share the name "KTC INTERNATIONAL ENTERPRISES LLC" — the ID after each name tells them apart. Choose the one with your real invoices.</div>

      {bizId && (function () {
        var reg = selReg();
        var blk = importBlockReason();
        return (
          <div className="mb-3 space-y-2">
            <div className={'rounded-lg p-2.5 text-xs font-bold border ' + (!reg ? 'bg-red-100 border-red-300 text-red-950' : (reg.is_production !== false ? 'bg-emerald-100 border-emerald-300 text-emerald-950' : 'bg-amber-100 border-amber-300 text-amber-950'))}>
              <div>Current Wave business: <b>{(reg && reg.label) || (businesses.find(function (b) { return b.id === bizId; }) || {}).name || bizId}</b></div>
              <div className="font-mono text-[10px] opacity-80">id {String(bizId).slice(0, 16)}…</div>
              {!reg && (
                <div className="mt-1">
                  <div>⚠ NOT REGISTERED — tell the Hub what this business is before importing:</div>
                  {isSuperAdmin ? (
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      <button disabled={registering} onClick={function () { registerBusiness(true); }} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold disabled:opacity-50">🔒 Register as REAL (read-only)</button>
                      <button disabled={registering} onClick={function () { registerBusiness(false); }} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold disabled:opacity-50">🧪 Register as TEST (writes allowed)</button>
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px]">Ask a super-admin to register this business.</div>
                  )}
                </div>
              )}
              {reg && reg.is_production !== false && <div className="mt-1">🔒 REAL KTC PRODUCTION — READ ONLY — WRITES {canWriteToWaveBusiness(reg) ? 'ENABLED' : 'DISABLED'}. Import pulls from Wave (read-only); no pushes/deletes to Wave.</div>}
              {reg && reg.is_production === false && <div className="mt-1">🧪 TEST BUSINESS — WRITES ALLOWED. Imported records are tagged to this test business and stay out of your real KTC views.</div>}
            </div>
            {legacyNulls > 0 && (
              <div className="rounded-lg p-2.5 text-xs font-bold bg-amber-100 border border-amber-300 text-amber-950">⚠ {legacyNulls} existing Wave invoice(s) have no business tag. Run the backfill SQL before importing another business, or real and test data could mix.</div>
            )}
            {blk && <div className="rounded-lg p-2 text-[11px] font-bold bg-red-100 border border-red-300 text-red-950">Import is blocked: {blk}</div>}
          </div>
        );
      })()}

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
          <div className="rounded-lg border border-indigo-700/60 bg-indigo-950/40 p-3 mb-4">
            <div className="text-base font-extrabold text-indigo-100 mb-1">{'Wave -> Hub import map'}</div>
            <div className="grid gap-2 text-[11px]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))' }}>
              <div className="rounded border border-slate-700 bg-slate-900/70 p-2"><b className="text-slate-100">Chart of Accounts</b><div className="text-slate-400">Pulls real Wave category names into the Bank Review dropdown.</div></div>
              <div className="rounded border border-slate-700 bg-slate-900/70 p-2"><b className="text-slate-100">Old transaction categories</b><div className="text-slate-400">Paste Wave's Transactions CSV here. This is where prior Wave categorizations get stamped onto Hub bank rows.</div></div>
              <div className="rounded border border-slate-700 bg-slate-900/70 p-2"><b className="text-slate-100">Invoice payments</b><div className="text-slate-400">Reads Wave invoice payments and links matching Hub deposits to invoices.</div></div>
              <div className="rounded border border-slate-700 bg-slate-900/70 p-2"><b className="text-slate-100">Customers / invoices</b><div className="text-slate-400">Imports Wave customers, invoices, line items, paid/due/status.</div></div>
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-violet-700/60 bg-violet-950/30 p-3">
            <div className="text-sm font-bold text-slate-100 mb-1">Step 2 - Pull Wave Chart of Accounts</div>
            <div className="text-[11px] text-slate-400 mb-2">Do this before importing transaction CSV categories, so the Hub can resolve each Wave category name to the real Wave account id.</div>
            <button onClick={runCategoryPull} disabled={catBusy} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded text-sm font-bold disabled:opacity-50">{catBusy ? 'Pulling...' : 'Pull Wave Chart of Accounts'}</button>
            {catMsg && <div className="mt-2 rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-200 whitespace-pre-wrap">{catMsg}</div>}
          </div>

          <div className="mb-4 rounded-lg border border-emerald-700/60 bg-emerald-950/25 p-3">
            <div className="text-sm font-bold text-slate-100 mb-1">Step 3 - Import old Wave transaction categories</div>
            <div className="text-[11px] text-slate-400 mb-2">In Wave go to <b>Accounting &gt; Transactions &gt; Export</b>, paste that CSV here, then Preview. Apply only after the preview looks right. This writes only to Hub bank transactions; it does not write to Wave.</div>
            <textarea value={csvText} onChange={function (e) { setCsvText(e.target.value); }} placeholder="Paste the Wave Transactions CSV here, including the header row..." rows={7} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs font-mono text-slate-100 placeholder-slate-500 mb-2" />
            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={function () { runCsvImport(false); }} disabled={csvBusy} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-bold disabled:opacity-50">{csvBusy ? 'Working...' : 'Preview CSV match'}</button>
              <button onClick={function () { runCsvImport(true); }} disabled={csvBusy || !csvResult || !csvResult.dry_run || !csvResult.matched_count} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold disabled:opacity-40">Apply {csvResult && csvResult.dry_run ? '(' + csvResult.matched_count + ')' : ''}</button>
              <label className="text-[11px] text-slate-300 inline-flex items-center gap-1"><input type="checkbox" checked={csvOverride} onChange={function (e) { setCsvOverride(e.target.checked); }} /> override existing Hub categories</label>
            </div>
            {csvResult && (
              <div className={'mt-3 rounded border p-3 text-xs ' + (csvResult.ok ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-rose-700 bg-rose-950/40 text-rose-200')}>
                {!csvResult.ok ? <div>{csvResult.error || 'CSV import failed.'}</div> : (
                  <div className="space-y-2">
                    <div className="flex gap-3 flex-wrap font-bold">
                      <span className="text-emerald-300">{csvResult.dry_run ? (csvResult.matched_count + ' would apply') : (csvResult.applied + ' applied')}</span>
                      {csvResult.ambiguous_count ? <span className="text-orange-300">{csvResult.ambiguous_count} ambiguous</span> : null}
                      {csvResult.conflict_count ? <span className="text-rose-300">{csvResult.conflict_count} conflicts</span> : null}
                      {csvResult.needs_manual_invoice_link_count ? <span className="text-indigo-300">{csvResult.needs_manual_invoice_link_count} invoice/payment rows deferred</span> : null}
                      <span className="text-amber-300">{csvResult.unmatched_count || 0} unmatched</span>
                      {csvResult.category_unresolved_count ? <span className="text-sky-300">{csvResult.category_unresolved_count} unresolved category names</span> : null}
                    </div>
                    {csvResult.detected_columns && <div className="text-[11px] text-slate-400">Detected columns: date <b>{String(csvResult.detected_columns.date)}</b>, amount <b>{String(csvResult.detected_columns.amount || csvResult.detected_columns.debit || csvResult.detected_columns.credit)}</b>, category <b>{String(csvResult.detected_columns.category)}</b>, description <b>{String(csvResult.detected_columns.description)}</b></div>}
                    {csvResult.matched && csvResult.matched.length > 0 && <details><summary className="cursor-pointer text-slate-300">Matched rows</summary><div className="mt-1 max-h-44 overflow-auto">{csvResult.matched.map(function (m) { return <div key={m.row} className="border-t border-slate-800 py-0.5">{m.hub_date} - {m.amount} - {m.hub_name} -&gt; <b>{m.csv_category}</b>{m.category_resolved ? '' : ' (label only - not in pulled chart)'}</div>; })}</div></details>}
                    {csvResult.ambiguous && csvResult.ambiguous.length > 0 && <details><summary className="cursor-pointer text-orange-300">Ambiguous rows</summary><div className="mt-1 max-h-44 overflow-auto">{csvResult.ambiguous.map(function (a, i) { return <div key={i} className="border-t border-slate-800 py-0.5">{a.date} - {a.amount} - {a.category || ''} - {a.reason}</div>; })}</div></details>}
                    {csvResult.conflicts && csvResult.conflicts.length > 0 && <details><summary className="cursor-pointer text-rose-300">Conflicts</summary><div className="mt-1 max-h-44 overflow-auto">{csvResult.conflicts.map(function (c, i) { return <div key={i} className="border-t border-slate-800 py-0.5">{c.hub_name} - existing <b>{c.existing_category}</b> vs CSV <b>{c.csv_category}</b></div>; })}</div></details>}
                    {csvResult.needs_manual_invoice_link && csvResult.needs_manual_invoice_link.length > 0 && <details><summary className="cursor-pointer text-indigo-300">Invoice/payment rows deferred</summary><div className="mt-1 max-h-44 overflow-auto">{csvResult.needs_manual_invoice_link.map(function (n, i) { return <div key={i} className="border-t border-slate-800 py-0.5">{n.date} - {n.amount} - INV <b>{n.invoice}</b> - use payment link prefill below</div>; })}</div></details>}
                    {csvResult.unmatched && csvResult.unmatched.length > 0 && <details><summary className="cursor-pointer text-amber-300">Unmatched CSV rows</summary><div className="mt-1 max-h-44 overflow-auto">{csvResult.unmatched.map(function (u, i) { return <div key={i} className="border-t border-slate-800 py-0.5">{u.date} - {u.amount} - {u.category || ''} - {u.reason}</div>; })}</div></details>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="text-sm font-bold text-slate-200 mb-1">Step 4 - Import customers into the Hub</div>
          <div className="text-[11px] text-slate-400 mb-2">Safe and re-runnable: matches on Wave customer ID, so running it again updates instead of duplicating. Import customers before invoices.</div>
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
            <div className="text-sm font-bold text-slate-200 mb-1">Step 5 - Import invoices (+ line items) into the Hub</div>
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
            <div className="text-sm font-bold text-slate-200 mb-1">Step 6 - Pull Wave invoice payments and link deposits</div>
            <div className="text-[11px] text-slate-400 mb-2">Wave invoice payments are API-readable. Preview first, then apply only the exact one-to-one deposit links. This does not change invoice balances.</div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={runPaymentReadback} disabled={probeBusy} className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-sm font-bold disabled:opacity-50">{probeBusy ? 'Checking...' : 'Check Wave payments'}</button>
              <button onClick={function () { runPrefillLinks(false); }} disabled={prefillBusy} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-bold disabled:opacity-50">{prefillBusy ? 'Working...' : 'Preview deposit links'}</button>
              <button onClick={function () { runPrefillLinks(true); }} disabled={prefillBusy || !prefillResult || !prefillResult.dry_run || !(prefillResult.counts && prefillResult.counts.would_link)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold disabled:opacity-40">Apply links {prefillResult && prefillResult.dry_run && prefillResult.counts ? '(' + (prefillResult.counts.would_link || 0) + ')' : ''}</button>
            </div>
            {probeResult && (
              <div className="mt-3 rounded border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200">
                {probeResult.error && !probeResult.payments_found ? <div className="text-rose-300">{probeResult.error}</div> : <div><b className="text-emerald-300">{probeResult.payments_found || 0}</b> Wave payment(s) across <b>{probeResult.invoices_scanned || 0}</b> invoice(s). Bank account present on <b>{probeResult.payments_with_bank_account || 0}</b>.</div>}
              </div>
            )}
            {prefillResult && (
              <div className={'mt-3 rounded border p-3 text-xs ' + (prefillResult.ok || (prefillResult.counts && prefillResult.counts.payments_found) ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-rose-700 bg-rose-950/40 text-rose-200')}>
                {prefillResult.error && !(prefillResult.counts && prefillResult.counts.payments_found) ? <div>{prefillResult.error}</div> : (
                  <div className="space-y-2">
                    <div className="flex gap-3 flex-wrap font-bold">
                      <span className="text-indigo-300">{prefillResult.dry_run ? ((prefillResult.counts && prefillResult.counts.would_link) || 0) + ' would link' : ((prefillResult.counts && prefillResult.counts.applied) || 0) + ' linked'}</span>
                      {prefillResult.counts && prefillResult.counts.ambiguous ? <span className="text-orange-300">{prefillResult.counts.ambiguous} ambiguous</span> : null}
                      {prefillResult.counts && prefillResult.counts.no_candidate ? <span className="text-amber-300">{prefillResult.counts.no_candidate} no matching deposit</span> : null}
                      {prefillResult.counts && prefillResult.counts.invoice_not_imported ? <span className="text-rose-300">{prefillResult.counts.invoice_not_imported} invoice not imported</span> : null}
                    </div>
                    {prefillResult.plan && prefillResult.plan.length > 0 && <details><summary className="cursor-pointer text-slate-300">Link plan</summary><div className="mt-1 max-h-44 overflow-auto">{prefillResult.plan.map(function (p, i) { return <div key={i} className="border-t border-slate-800 py-0.5">{p.date || ''} - {p.amount} - INV {p.invoice} - <b>{p.action}</b>{p.deposit_name ? (' -> ' + p.deposit_name) : ''}</div>; })}</div></details>}
                  </div>
                )}
              </div>
            )}
          </div>

          <details className="mt-4 border-t border-slate-700 pt-3" open={!!estReport}>
            <summary className="cursor-pointer text-sm font-bold text-slate-200 mb-1 select-none">{'Optional - Wave Estimates -> Hub Proformas (skip unless you use Wave Estimates)'}</summary>
            <div className="text-[11px] text-slate-400 mb-2">This is separate from categories, bank matching, invoice-payment links, and Wave push. It only pulls Wave Estimates into Hub Proformas.</div>
            <button onClick={runImportEstimates} disabled={importingEst} className="px-4 py-2 bg-fuchsia-700 hover:bg-fuchsia-600 text-white rounded text-sm font-bold disabled:opacity-50">
              {importingEst ? 'Importing estimates…' : 'Import estimates into Hub'}
            </button>
            {estReport && (
              <div className="bg-white text-slate-900 rounded-lg p-3 mt-3 border border-slate-200 text-xs">
                <div className="font-extrabold mb-1">📋 Estimate → Proforma import report</div>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  <div className="bg-emerald-100 text-emerald-950 rounded p-2"><div className="text-lg font-extrabold">{estReport.created || 0}</div>created</div>
                  <div className="bg-sky-100 text-sky-950 rounded p-2"><div className="text-lg font-extrabold">{estReport.updated || 0}</div>updated</div>
                  <div className="bg-amber-100 text-amber-950 rounded p-2"><div className="text-lg font-extrabold">{estReport.skipped || 0}</div>skipped</div>
                  <div className="bg-violet-100 text-violet-950 rounded p-2"><div className="text-lg font-extrabold">{estReport.lineItems || 0}</div>line items</div>
                </div>
                <div className="text-slate-600">Total read: {estReport.total == null ? '—' : estReport.total} · {estReport.timestamp || ''}</div>
                {(estReport.placeholders && estReport.placeholders.length > 0) && (
                  <div className="mt-2 bg-amber-50 text-amber-950 rounded p-2"><b>{estReport.placeholders.length} placeholder customer(s) created</b> — flagged for review: {estReport.placeholders.slice(0, 10).join(', ')}{estReport.placeholders.length > 10 ? '…' : ''}</div>
                )}
                {(estReport.errors && estReport.errors.length > 0) ? (
                  <div className="mt-2">
                    <div className="rounded bg-rose-50 border border-rose-200 text-rose-950 p-2 mb-2">
                      <div className="font-extrabold">What this means</div>
                      <div>{estimateErrorHelp(estReport.errors)}</div>
                    </div>
                    <details>
                      <summary className="cursor-pointer font-bold text-rose-700">Technical error details ({estReport.errors.length})</summary>
                      <ul className="list-disc ml-4 text-rose-700 mt-1">{estReport.errors.slice(0, 20).map(function (er, i) { return <li key={i}>{er}</li>; })}</ul>
                    </details>
                  </div>
                ) : <div className="text-emerald-700 font-bold mt-1">✓ No errors.</div>}
              </div>
            )}
          </details>

          <div className="mt-4 border-t border-slate-700 pt-3">
            <div className="text-sm font-bold text-slate-200 mb-1">Step 7 - Reconcile Wave vs Hub (read-only audit)</div>
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
