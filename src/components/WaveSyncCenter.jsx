import React, { useState, useEffect, useMemo } from 'react';
import { supabase, dbUpdate } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { getActiveWaveBusiness, scopeIfRegistered } from '../lib/wave-business';
import { dryRunRecord } from '../lib/wave-sync-eligibility';
import SiloBanner from './SiloBanner';

export default function WaveSyncCenter(props) {
  var toast = props.toast || { success: function () {}, error: function () {} };
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');

  var [tab, setTab] = useState('pending');
  var [loading, setLoading] = useState(true);
  var [registry, setRegistry] = useState([]);
  var [customers, setCustomers] = useState([]);
  var [invoices, setInvoices] = useState([]);
  var [syncLog, setSyncLog] = useState([]);
  var [sel, setSel] = useState({});
  var [busy, setBusy] = useState(false);
  var [savingFlags, setSavingFlags] = useState(false);

  var active = getActiveWaveBusiness();
  var reg = registry.find(function (r) { return r.wave_business_id === active; });
  var isProd = !!(reg && reg.is_production !== false);

  function load() {
    setLoading(true);
    Promise.all([
      fetchAllRows('wave_business_registry', '*'),
      fetchAllRows('accounting_customers', '*', 'company_name', true),
      fetchAllRows('accounting_invoices', '*', 'created_at', false),
      supabase.from('wave_sync_log').select('*').order('id', { ascending: false }).limit(100)
    ]).then(function (res) {
      var rg = (res[0] && res[0].data) || [];
      setRegistry(rg);
      setCustomers(scopeIfRegistered((res[1] && res[1].data) || [], getActiveWaveBusiness(), rg, true));
      setInvoices(scopeIfRegistered((res[2] && res[2].data) || [], getActiveWaveBusiness(), rg, true));
      setSyncLog(((res[3] && res[3].data) || []).filter(function (l) { return !active || l.wave_business_id === active; }));
    }).catch(function (e) { console.error('[wave-sync] load', e); toast.error('Failed to load sync data'); })
      .finally(function () { setLoading(false); });
  }
  useEffect(function () { load(); }, [active]);

  // Eligible (pushable) Hub records for the active silo
  var queue = useMemo(function () {
    var rows = [];
    customers.forEach(function (c) {
      if (!c.wave_customer_id && c.source !== 'wave_import' && (c.company_name || c.name)) {
        rows.push({ key: 'customer:' + c.id, action: 'customer', id: c.id, label: c.company_name || c.name, amount: null, record: c });
      }
    });
    invoices.forEach(function (inv) {
      if (!inv.wave_invoice_id && inv.source !== 'wave_import' && inv.is_historical !== true && (!inv.approval_status || inv.approval_status === 'approved')) {
        rows.push({ key: 'invoice:' + inv.id, action: 'invoice', id: inv.id, label: 'Invoice ' + inv.invoice_number, amount: inv.total_amount, record: inv });
      }
    });
    return rows;
  }, [customers, invoices]);

  function toggle(key) { setSel(function (p) { var n = Object.assign({}, p); if (n[key]) { delete n[key]; } else { n[key] = true; } return n; }); }
  var selectedRows = queue.filter(function (q) { return sel[q.key]; });

  function runDryRun() {
    if (isProd) { toast.error('Production is read-only in this build. Dry run is available for the Test business only.'); return; }
    if (selectedRows.length === 0) { toast.error('Select at least one record.'); return; }
    var results = selectedRows.map(function (q) {
      var v = dryRunRecord({ action: q.action, record: q.record, waveBusinessId: active, registry: registry });
      return { label: q.label, verdict: v.verdict, message: v.message, wouldDo: v.wouldDo };
    });
    setDryResults(results);
    setTab('dryrun');
  }
  var [dryResults, setDryResults] = useState([]);

  function pushSelected() {
    if (isProd) { toast.error('Production writes are disabled. Use read-only reconcile or unlock production in a future controlled build.'); return; }
    if (selectedRows.length === 0) { toast.error('Select records and Dry Run first.'); return; }
    setBusy(true);
    var seq = Promise.resolve();
    var done = 0, failed = 0;
    selectedRows.forEach(function (q) {
      seq = seq.then(function () {
        var route = q.action === 'customer' ? '/api/wave/push-customer' : (q.action === 'invoice' ? '/api/wave/push-invoice' : '/api/wave/push-payment');
        return fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: active, hub_record_id: q.id, dry_run: false, user_id: userProfile && userProfile.id }) })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d && d.success) { done++; } else { failed++; } })
          .catch(function () { failed++; });
      });
    });
    seq.then(function () { setBusy(false); toast.success('Push finished — ' + done + ' ok, ' + failed + ' blocked/failed. See Sync Log.'); setSel({}); load(); });
  }

  function setFlag(field, val) {
    if (!reg) { return; }
    if (isProd) { toast.error('Production flags are locked in this build.'); return; }
    setSavingFlags(true);
    var patch = {}; patch[field] = val;
    supabase.from('wave_business_registry').update(patch).eq('wave_business_id', active)
      .then(function () { load(); }).catch(function (e) { toast.error('Could not save: ' + (e.message || e)); })
      .finally(function () { setSavingFlags(false); });
  }

  if (loading) { return <div className="p-4 text-slate-400 italic">Loading Wave Sync Center…</div>; }

  var tabs = [['pending', 'Pending Sync'], ['dryrun', 'Dry Run'], ['synced', 'Synced'], ['failed', 'Failed'], ['log', 'Sync Log'], ['settings', 'Settings']];

  return (
    <div className="p-4 text-slate-100">
      <div className="text-lg font-extrabold mb-3">🔄 Wave Sync Center</div>
      <SiloBanner registered={!!reg} isTest={!!(reg && reg.is_production === false)} canWrite={!!(reg && reg.writes_enabled === true)} label={reg ? (reg.label || active) : (active || 'No business selected')} />

      {isProd && (
        <div className="mb-3 rounded-lg px-3 py-2 text-sm font-bold" style={{ background: '#7f1d1d', color: '#fff' }}>
          Production writes are disabled in this build. Use read-only reconcile, or unlock production in a future controlled build.
        </div>
      )}

      <div className="flex gap-1 mb-3 flex-wrap">
        {tabs.map(function (t) {
          return <button key={t[0]} onClick={function () { setTab(t[0]); }} className={'px-3 py-1.5 rounded text-xs font-bold ' + (tab === t[0] ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}>{t[1]}</button>;
        })}
      </div>

      {tab === 'pending' && (
        <div className="border border-slate-700 rounded overflow-hidden">
          <div className="bg-slate-800/70 px-3 py-2 flex items-center justify-between">
            <div className="text-xs font-bold">Pushable Hub records in this silo: {queue.length}</div>
            <div className="flex gap-2">
              <button onClick={runDryRun} disabled={isProd || selectedRows.length === 0} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold rounded">Dry Run Selected ({selectedRows.length})</button>
              <button onClick={pushSelected} disabled={isProd || busy || selectedRows.length === 0} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded">{busy ? 'Pushing…' : 'Push Selected'}</button>
            </div>
          </div>
          {queue.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">Nothing pending — no Hub-created customers/invoices in this silo are waiting to go to Wave.</div> : (
            <div>
              {queue.map(function (q) {
                return (
                  <div key={q.key} className="flex items-center gap-2 px-3 py-2 border-t border-slate-800 text-sm">
                    <input type="checkbox" checked={!!sel[q.key]} onChange={function () { toggle(q.key); }} className="w-4 h-4" />
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700">{q.action}</span>
                    <span className="flex-1">{q.label}</span>
                    {q.amount != null && <span className="font-mono text-slate-300">{Number(q.amount).toLocaleString()}</span>}
                    <span className="text-[10px] text-slate-500">not synced</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'dryrun' && (
        <div className="border border-slate-700 rounded overflow-hidden">
          {dryResults.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">No dry run yet. Select records under Pending Sync and click Dry Run Selected.</div> : dryResults.map(function (r, i) {
            var color = r.verdict === 'dry_run_ok' ? 'text-emerald-300' : (r.verdict === 'unsupported' ? 'text-amber-300' : 'text-red-300');
            return (
              <div key={i} className="px-3 py-2 border-t border-slate-800 text-sm">
                <div className="font-bold">{r.label}</div>
                <div className={'text-xs ' + color}>{r.verdict} — {r.message}</div>
                {r.targetBusinessId && <div className="text-[10px] text-cyan-300 font-mono mt-0.5">Target: {r.targetBusinessName || ''} · {r.targetBusinessId}</div>}
                {r.wouldDo && <div className="text-[11px] text-slate-400">Would: {r.wouldDo}</div>}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'synced' && (
        <div className="text-sm text-slate-300">
          Customers in Wave: {customers.filter(function (c) { return c.wave_customer_id; }).length} · Invoices in Wave: {invoices.filter(function (i) { return i.wave_invoice_id; }).length}
        </div>
      )}

      {tab === 'failed' && (
        <div className="border border-slate-700 rounded overflow-hidden">
          {syncLog.filter(function (l) { return l.success === false; }).length === 0 ? <div className="p-4 text-slate-400 italic text-sm">No failures logged for this silo.</div> :
            syncLog.filter(function (l) { return l.success === false; }).map(function (l) {
              return <div key={l.id} className="px-3 py-2 border-t border-slate-800 text-xs"><b>{l.entity_type}</b> · {l.action} · <span className="text-red-300">{l.error_message}</span></div>;
            })}
        </div>
      )}

      {tab === 'log' && (
        <div className="border border-slate-700 rounded overflow-hidden">
          {syncLog.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">No sync log entries for this silo yet.</div> :
            syncLog.map(function (l) {
              return (
                <div key={l.id} className="px-3 py-2 border-t border-slate-800 text-xs flex gap-2 flex-wrap">
                  <span className="font-bold">{l.entity_type}</span>
                  <span>{l.action}{l.dry_run ? ' (dry run)' : ''}</span>
                  <span className={l.success ? 'text-emerald-300' : 'text-red-300'}>{l.success ? 'ok' : 'blocked/failed'}</span>
                  {l.error_message && <span className="text-slate-400">{l.error_message}</span>}
                </div>
              );
            })}
        </div>
      )}

      {tab === 'settings' && (
        <div className="bg-white rounded-lg p-4 text-slate-900">
          <div className="font-bold mb-2">Push permissions for: {reg ? (reg.label || active) : 'No business selected'}</div>
          {!reg ? <div className="text-sm text-slate-500">Select a registered Wave business first.</div> : isProd ? (
            <div className="text-sm text-red-700 font-semibold">This is a PRODUCTION business. All push flags are locked in this build.</div>
          ) : (
            <div className="space-y-2 text-sm">
              {[['writes_enabled', 'Writes enabled (master switch)'], ['allow_customer_push', 'Allow customer push'], ['allow_invoice_push', 'Allow invoice push'], ['allow_payment_push', 'Allow payment push (Wave does not support — stays off)'], ['allow_auto_push', 'Allow auto-push (keep OFF)']].map(function (f) {
                var disabled = savingFlags || f[0] === 'allow_payment_push' || f[0] === 'allow_auto_push';
                return (
                  <label key={f[0]} className="flex items-center gap-2">
                    <input type="checkbox" checked={reg[f[0]] === true} disabled={disabled} onChange={function (e) { setFlag(f[0], e.target.checked); }} />
                    <span className={disabled && (f[0] === 'allow_payment_push' || f[0] === 'allow_auto_push') ? 'text-slate-400' : ''}>{f[1]}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
