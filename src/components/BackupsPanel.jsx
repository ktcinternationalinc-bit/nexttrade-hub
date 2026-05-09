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
import { useState, useEffect, useCallback } from 'react';
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
  if (k === 'weekly')  return { bg: 'bg-amber-100',   text: 'text-amber-800',   label: '📅 Weekly' };
  if (k === 'monthly') return { bg: 'bg-violet-100',  text: 'text-violet-800',  label: '🗓 Monthly' };
  return { bg: 'bg-slate-100', text: 'text-slate-700', label: k || 'unknown' };
}

export default function BackupsPanel({ user, userProfile }) {
  var [backups, setBackups] = useState([]);
  var [loading, setLoading] = useState(true);
  var [running, setRunning] = useState(false);
  var [error, setError] = useState('');
  var [lastResult, setLastResult] = useState(null);

  var load = useCallback(async function () {
    setLoading(true);
    setError('');
    try {
      var res = await fetch('/api/backup/list');
      var json = await res.json();
      if (!json.ok) throw new Error(json.error || 'list failed');
      setBackups(json.backups || []);
    } catch (e) {
      setError('Could not load backups: ' + ((e && e.message) || 'unknown'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(function () { load(); }, [load]);

  var runBackupNow = async function () {
    if (running) return;
    setRunning(true);
    setError('');
    setLastResult(null);
    try {
      var triggeredBy = (userProfile && userProfile.id) || (user && user.id) || null;
      var triggeredByName = (userProfile && userProfile.name) || (user && user.email) || 'super_admin';
      var res = await fetch('/api/backup/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'manual',
          triggered_by: triggeredBy,
          triggered_by_name: triggeredByName,
          notes: 'Manual snapshot from Admin → Backups',
        }),
      });
      var json = await res.json();
      if (!json.ok) throw new Error(json.error || 'snapshot failed');
      setLastResult(json);
      await load();
    } catch (e) {
      setError('Backup failed: ' + ((e && e.message) || 'unknown'));
    } finally {
      setRunning(false);
    }
  };

  var downloadBackup = function (id) {
    if (!id) return;
    // Open in new tab — browser handles the JSON file save via Content-Disposition
    try {
      window.open('/api/backup/download?id=' + encodeURIComponent(id), '_blank');
    } catch (_) {}
  };

  var togglePin = async function (b) {
    try {
      var res = await fetch('/api/backup/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: b.id, pinned: !b.pinned }),
      });
      var json = await res.json();
      if (!json.ok) throw new Error(json.error || 'pin toggle failed');
      await load();
    } catch (e) {
      setError('Could not update pin: ' + ((e && e.message) || 'unknown'));
    }
  };

  var deleteBackup = async function (b) {
    if (!b || !b.id) return;
    var label = (kindStyle(b.kind).label) + ' from ' + fmtDate(b.created_at);
    if (!window.confirm('Delete this backup?\n\n' + label + '\n\nThis cannot be undone.')) return;
    try {
      var res = await fetch('/api/backup/manage?id=' + encodeURIComponent(b.id), { method: 'DELETE' });
      var json = await res.json();
      if (!json.ok) throw new Error(json.error || 'delete failed');
      await load();
    } catch (e) {
      setError('Could not delete: ' + ((e && e.message) || 'unknown'));
    }
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
              Periodic snapshots of your business-critical tables (tickets, invoices, treasury, checks, customers, inventory, HR, and more).
              Daily snapshots run automatically at 4&nbsp;AM&nbsp;ET; weekly on Sundays; monthly on the 1st. You can also run one right now.
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
              <div className="mt-1 text-amber-800 font-semibold">
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
