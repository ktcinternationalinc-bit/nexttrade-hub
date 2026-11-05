'use client';
// ============================================================
// BackupsPanel — v55.74
//
// super_admin-only UI for browsing, creating, downloading,
// pinning, and deleting business-data backups.
//
// Mounted inside AdminTab → "💾 Backups" section. Hidden
// completely from non-super-admins (gated at the section nav).
//
// Features:
//   - Run Backup Now button (creates a 'manual' snapshot)
//   - List of all snapshots: kind, when, size, row counts, who triggered
//   - Download button → fetches /api/backup/download as a JSON file
//   - Pin toggle → exempts a backup from automatic retention
//   - Delete button (with confirmation)
//   - Auto-refresh after each operation
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { fetchBackup } from '../lib/backup-client';
import { fmtET } from '../lib/et-time';

function fmtBytes(n) {
  if (!n || n < 1024) return (n || 0) + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
function fmtDuration(ms) {
  if (!ms || ms < 1000) return (ms || 0) + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}
function fmtDate(iso) {
  if (!iso) return '—';
  return fmtET(iso, 'datetime');
}
function kindStyle(k) {
  if (k === 'manual')  return { bg: 'bg-blue-100',    text: 'text-blue-800',    label: '👆 Manual' };
  if (k === 'daily')   return { bg: 'bg-emerald-100', text: 'text-emerald-800', label: '☀️ Daily' };
  if (k === 'weekly')  return { bg: 'bg-amber-100',   text: 'text-amber-900',   label: '📅 Weekly' };
  if (k === 'monthly') return { bg: 'bg-violet-100',  text: 'text-violet-800',  label: '🗓 Monthly' };
  return { bg: 'bg-slate-100', text: 'text-slate-700', label: k || 'unknown' };
}

export default function BackupsPanel() {
  var [backups, setBackups] = useState([]);
  var [loading, setLoading] = useState(true);
  var [running, setRunning] = useState(false);
  var [error, setError] = useState('');
  var [lastResult, setLastResult] = useState(null);
  var activity = useRef({ mounted: true, epoch: 0, userId: null, controllers: new Set() });

  var requestBackup = useCallback(async function (url, init, download) {
    var state = activity.current, epoch = state.epoch, controller = new AbortController();
    state.controllers.add(controller);
    try {
      var response = await fetchBackup(supabase, url, Object.assign({}, init, { signal: controller.signal }));
      var result = download && response.ok ? await response.blob() : await response.json();
      if (!state.mounted || epoch !== state.epoch) { var stale = new Error('Session changed'); stale.ignored = true; throw stale; }
      if (!response.ok || (!download && !result.ok)) {
        if (response.status === 401 || response.status === 403 || response.status === 503) { setBackups([]); setLastResult(null); }
        throw new Error(result.error || 'The backup request failed.');
      }
      return download ? { blob: result, disposition: response.headers.get('content-disposition') || '' } : result;
    } catch (e) {
      if (!state.mounted || epoch !== state.epoch || e.name === 'AbortError') e.ignored = true;
      throw e;
    } finally { state.controllers.delete(controller); }
  }, []);

  var showError = function (prefix, e) {
    if (activity.current.mounted && !e?.ignored) setError(prefix + ((e && e.message) || 'Please retry.'));
  };
  var load = useCallback(async function () {
    setLoading(true); setError('');
    try {
      var json = await requestBackup('/api/backup/list');
      setBackups(json.backups || []);
    } catch (e) {
      if (activity.current.mounted && !e?.ignored) { setBackups([]); setLastResult(null); setError('Could not load backups: ' + (e.message || 'Please sign in again.')); }
    } finally { if (activity.current.mounted) setLoading(false); }
  }, [requestBackup]);

  useEffect(function () {
    var state = activity.current;
    state.mounted = true;
    void load();
    var auth = supabase.auth.onAuthStateChange(function (event, session) {
      var id = session?.user?.id || null;
      if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && id !== state.userId)) {
        state.epoch += 1; state.controllers.forEach(function (controller) { controller.abort(); });
        setBackups([]); setLastResult(null); setRunning(false); setLoading(false);
        setError(event === 'SIGNED_OUT' ? 'Sign in again to access backups.' : '');
        if (event === 'SIGNED_IN') setTimeout(function () { if (state.mounted) void load(); }, 0);
      }
      state.userId = id;
    });
    return function () {
      state.mounted = false; state.epoch += 1;
      state.controllers.forEach(function (controller) { controller.abort(); });
      auth.data.subscription.unsubscribe();
    };
  }, [load]);

  var runBackupNow = async function () {
    if (running) return;
    setRunning(true); setError(''); setLastResult(null);
    try {
      var json = await requestBackup('/api/backup/snapshot', { method: 'POST',
        body: JSON.stringify({ kind: 'manual', notes: 'Manual snapshot from Admin → Backups' }) });
      setLastResult(json);
      await load();
    } catch (e) { showError('Backup failed: ', e); }
    finally { if (activity.current.mounted) setRunning(false); }
  };

  var downloadBackup = async function (id) {
    if (!id) return;
    try {
      var result = await requestBackup('/api/backup/download?id=' + encodeURIComponent(id), undefined, true);
      var match = /filename="([a-z0-9.-]+)"/i.exec(result.disposition);
      var url = URL.createObjectURL(result.blob), link = document.createElement('a');
      link.href = url; link.download = match ? match[1] : 'ktc-backup.json';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { showError('Could not download: ', e); }
  };

  var togglePin = async function (b) {
    try {
      await requestBackup('/api/backup/manage', { method: 'POST', body: JSON.stringify({ id: b.id, pinned: !b.pinned }) });
      await load();
    } catch (e) { showError('Could not update pin: ', e); }
  };

  var deleteBackup = async function (b) {
    if (!b || !b.id) return;
    var label = kindStyle(b.kind).label + ' from ' + fmtDate(b.created_at);
    if (!window.confirm('Delete this backup?\n\n' + label + '\n\nThis cannot be undone.')) return;
    try {
      await requestBackup('/api/backup/manage?id=' + encodeURIComponent(b.id), { method: 'DELETE' });
      await load();
    } catch (e) { showError('Could not delete: ', e); }
  };

  // Summary stats
  var totalSize = backups.reduce(function (sum, b) { return sum + (b.size_bytes || 0); }, 0);
  var totalRows = backups.reduce(function (sum, b) {
    var rc = b.row_counts || {};
    var n = 0;
    for (var k in rc) if (Object.prototype.hasOwnProperty.call(rc, k)) n += rc[k] || 0;
    return sum + n;
  }, 0);
  var lastBackup = backups.length > 0 ? backups[0] : null;

  return (
    <div className="space-y-3">
      {/* Header card */}
      <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">💾 Business Data Backups</h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Snapshots of your business-critical tables (tickets, invoices, treasury, checks, customers, inventory, HR, and more). Provider credentials are excluded from new snapshots and downloads.
              When the backup schedule is activated, daily snapshots can also create weekly copies on Sundays and monthly copies on the 1st. You can run a manual snapshot here.
            </p>
          </div>
          <button
            onClick={runBackupNow}
            disabled={running}
            className={'px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap shadow ' + (running ? 'bg-slate-300 text-slate-500 cursor-wait' : 'bg-emerald-600 text-white hover:bg-emerald-700')}>
            {running ? '⏳ Running…' : '💾 Run Backup Now'}
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-slate-50 rounded-lg p-2 text-center">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Snapshots</div>
            <div className="text-xl font-extrabold text-slate-900">{backups.length}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-2 text-center">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Last Backup</div>
            <div className="text-xs font-extrabold text-slate-900 mt-1">{lastBackup ? fmtDate(lastBackup.created_at) : '—'}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-2 text-center">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Total Size</div>
            <div className="text-xl font-extrabold text-slate-900">{fmtBytes(totalSize)}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-2 text-center">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Total Rows</div>
            <div className="text-xl font-extrabold text-slate-900">{totalRows.toLocaleString()}</div>
          </div>
        </div>

        {/* Last result */}
        {lastResult && lastResult.ok && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
            ✅ Backup complete — {lastResult.tables_count} tables, {(lastResult.total_rows || 0).toLocaleString()} rows, {fmtBytes(lastResult.size_bytes)}, took {fmtDuration(lastResult.duration_ms)}.
            {lastResult.tables_with_errors && lastResult.tables_with_errors.length > 0 && (
              <div className="mt-1 text-amber-900 font-semibold">
                ⚠️ {lastResult.tables_with_errors.length} table(s) had errors (check the notes column on this backup).
              </div>
            )}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 font-semibold">
            ⚠️ {error}
          </div>
        )}

        {/* Retention explanation */}
        <details className="mt-3">
          <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-700 select-none">How retention works</summary>
          <div className="mt-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700 leading-relaxed">
            • <strong>Daily</strong> snapshots: last 7 kept.<br />
            • <strong>Weekly</strong> snapshots: last 4 kept (Sundays).<br />
            • <strong>Monthly</strong> snapshots: last 12 kept (1st of month).<br />
            • <strong>Manual</strong> snapshots: kept for 30 days unless 📌 pinned.<br />
            • <strong>Pinned</strong> snapshots are NEVER deleted by retention. Use this to preserve year-end snapshots, before-migration snapshots, etc.
          </div>
        </details>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border-2 border-slate-200 overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <h4 className="text-sm font-extrabold text-slate-900">All snapshots</h4>
          <button onClick={load} className="text-xs font-bold text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-white">
            🔄 Refresh
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-sm text-slate-500">Loading backups…</div>
        ) : backups.length === 0 ? (
          <div className="p-6 text-center">
            <div className="text-3xl mb-2">📭</div>
            <div className="text-sm font-bold text-slate-900">No backups yet.</div>
            <div className="text-xs text-slate-500 mt-1">Click "Run Backup Now" above to create your first one.</div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {backups.map(function (b) {
              var k = kindStyle(b.kind);
              var rowsTotal = 0;
              var rc = b.row_counts || {};
              for (var key in rc) if (Object.prototype.hasOwnProperty.call(rc, key)) rowsTotal += rc[key] || 0;
              return (
                <div key={b.id} className="px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + k.bg + ' ' + k.text}>{k.label}</span>
                        {b.pinned && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">📌 Pinned</span>}
                        <span className="text-sm font-extrabold text-slate-900">{fmtDate(b.created_at)}</span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-1">
                        By <strong>{b.triggered_by_name || 'cron'}</strong>
                        &nbsp;·&nbsp; {(b.tables_included || []).length} tables
                        &nbsp;·&nbsp; {rowsTotal.toLocaleString()} rows
                        &nbsp;·&nbsp; {fmtBytes(b.size_bytes)}
                        &nbsp;·&nbsp; {fmtDuration(b.duration_ms)}
                      </div>
                      {b.notes && (
                        <div className="text-[11px] text-slate-500 mt-1 italic">{b.notes}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={function () { downloadBackup(b.id); }}
                        className="px-2.5 py-1 rounded text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700"
                        title="Download as JSON file">
                        ⬇ Download
                      </button>
                      <button
                        onClick={function () { togglePin(b); }}
                        className={'px-2.5 py-1 rounded text-[11px] font-bold ' + (b.pinned ? 'bg-amber-300 text-amber-900 hover:bg-amber-400' : 'bg-slate-200 text-slate-700 hover:bg-slate-300')}
                        title={b.pinned ? 'Unpin (allow retention to delete)' : 'Pin (exempt from retention)'}>
                        {b.pinned ? '📌 Unpin' : '📌 Pin'}
                      </button>
                      <button
                        onClick={function () { deleteBackup(b); }}
                        className="px-2.5 py-1 rounded text-[11px] font-bold text-red-700 bg-red-100 hover:bg-red-200"
                        title="Delete this backup">
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
