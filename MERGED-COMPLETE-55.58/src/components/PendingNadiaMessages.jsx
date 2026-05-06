'use client';
// ============================================================
// PendingNadiaMessages — v55.45.
//
// Shows the user a tidy panel of cross-team relay messages and team
// reminders that are still pending acknowledgment. Each item has a
// "Got it ✓" button. Clicking it marks the row as acknowledged and
// Nadia stops mentioning it (until something new happens).
//
// Items auto-drop from the panel after 7 days even if not acknowledged.
//
// Why a panel instead of just chat: Nadia's greeting is conversational
// — there's no obvious place to attach an Acknowledge button to one of
// the items she rattles off. A panel gives each item its own row and a
// clear button. Nadia's greeting will continue to mention any
// unacknowledged items so users aren't FORCED to use the panel.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export default function PendingNadiaMessages({ userId, getUserName }) {
  var [messages, setMessages] = useState([]);
  var [reminders, setReminders] = useState([]);
  var [loading, setLoading] = useState(true);
  var [busyId, setBusyId] = useState(null);
  var [error, setError] = useState(null);
  var [collapsed, setCollapsed] = useState(false);

  var load = useCallback(async function () {
    if (!userId) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      // Use the dedicated GET endpoint which already applies the ack +
      // 7-day filters, so we don't have to duplicate that logic here.
      var res = await fetch('/api/nadia/acknowledge?user_id=' + encodeURIComponent(userId));
      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        throw new Error((errBody && errBody.error) || ('HTTP ' + res.status));
      }
      var data = await res.json();
      setMessages((data && data.messages) || []);
      setReminders((data && data.reminders) || []);
    } catch (e) {
      try { console.warn('[pending-nadia] load failed:', e && e.message); } catch (_) {}
      setError((e && e.message) || 'Could not load pending messages');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(function () { load(); }, [load]);

  // Refresh every 60s so a new cross-team message appears within a
  // minute of being sent.
  useEffect(function () {
    if (!userId) return undefined;
    var iv = setInterval(load, 60000);
    return function () { clearInterval(iv); };
  }, [userId, load]);

  var acknowledge = async function (table, id) {
    if (busyId) return; // prevent double-click
    setBusyId(table + ':' + id);
    try {
      var res = await fetch('/api/nadia/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: table, id: id, user_id: userId }),
      });
      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        throw new Error((errBody && errBody.error) || ('HTTP ' + res.status));
      }
      // Optimistic local removal so the UI feels immediate
      if (table === 'ai_memory') setMessages(function (prev) { return prev.filter(function (m) { return m.id !== id; }); });
      else if (table === 'team_reminders') setReminders(function (prev) { return prev.filter(function (r) { return r.id !== id; }); });
    } catch (e) {
      try { console.warn('[pending-nadia] ack failed:', e && e.message); } catch (_) {}
      alert('Could not acknowledge: ' + ((e && e.message) || 'unknown error'));
    } finally {
      setBusyId(null);
    }
  };

  var ageInDays = function (iso) {
    if (!iso) return 0;
    try {
      var ms = Date.now() - new Date(iso).getTime();
      return Math.max(0, Math.floor(ms / 86400000));
    } catch (_) { return 0; }
  };

  var fmtSender = function (id) {
    if (!id) return 'Unknown';
    if (getUserName) {
      var n = getUserName(id);
      if (n) return n;
    }
    return 'team member';
  };

  // Don't render anything if there's nothing pending — keeps the
  // dashboard clean for users who don't have any open messages.
  var totalPending = messages.length + reminders.length;
  if (loading) return null; // silent first-load
  if (totalPending === 0 && !error) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 mb-3">
      <button
        onClick={function () { setCollapsed(function (c) { return !c; }); }}
        className="w-full flex items-center justify-between p-3 hover:bg-amber-100/40 transition rounded-xl"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">📬</span>
          <span className="text-sm font-bold text-amber-900">
            {totalPending} pending message{totalPending === 1 ? '' : 's'} from your team
          </span>
          <span className="text-[10px] text-amber-700">— Nadia keeps mentioning these until you acknowledge</span>
        </div>
        <span className="text-amber-700">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {error && (
            <div className="text-xs text-red-600 px-2 py-1 bg-red-50 rounded">
              {error}
            </div>
          )}

          {messages.map(function (m) {
            var key = 'ai_memory:' + m.id;
            var isBusy = busyId === key;
            var age = ageInDays(m.created_at);
            return (
              <div key={m.id} className="bg-white rounded-lg p-3 border border-amber-100 flex items-start gap-3">
                <span className="text-lg flex-shrink-0">💬</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-500 mb-0.5">
                    From <b className="text-slate-700">{fmtSender(m.created_by)}</b>
                    <span className="ml-2 text-amber-700">{age} day{age === 1 ? '' : 's'} old</span>
                    {age >= 5 && <span className="ml-2 text-red-600 font-bold">drops in {7 - age}d</span>}
                  </div>
                  <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">{m.content}</div>
                </div>
                <button
                  onClick={function () { acknowledge('ai_memory', m.id); }}
                  disabled={isBusy}
                  className={'px-3 py-1.5 rounded-lg text-xs font-bold flex-shrink-0 transition ' + (isBusy ? 'bg-emerald-300 text-white cursor-wait' : 'bg-emerald-500 text-white hover:bg-emerald-600')}
                >
                  {isBusy ? '⏳' : '✓ Got it'}
                </button>
              </div>
            );
          })}

          {reminders.map(function (r) {
            var key = 'team_reminders:' + r.id;
            var isBusy = busyId === key;
            var dateRef = r.reminder_date || (r.created_at && r.created_at.substring(0, 10));
            var age = ageInDays(r.created_at);
            var pri = r.priority || 'normal';
            var priColor = pri === 'urgent' || pri === 'high' ? 'text-red-700 bg-red-100' : pri === 'low' ? 'text-slate-500 bg-slate-100' : 'text-amber-700 bg-amber-100';
            return (
              <div key={r.id} className="bg-white rounded-lg p-3 border border-amber-100 flex items-start gap-3">
                <span className="text-lg flex-shrink-0">⏰</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-500 mb-0.5">
                    Reminder from <b className="text-slate-700">{fmtSender(r.created_by)}</b>
                    <span className={'ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold ' + priColor}>{pri.toUpperCase()}</span>
                    {dateRef && <span className="ml-2 text-amber-700">due {dateRef}</span>}
                    {age >= 5 && <span className="ml-2 text-red-600 font-bold">drops in {7 - age}d</span>}
                  </div>
                  <div className="text-sm text-slate-800 font-semibold">{r.title || ''}</div>
                  {(r.message || r.body) && <div className="text-sm text-slate-600 mt-0.5 whitespace-pre-wrap break-words">{r.message || r.body}</div>}
                </div>
                <button
                  onClick={function () { acknowledge('team_reminders', r.id); }}
                  disabled={isBusy}
                  className={'px-3 py-1.5 rounded-lg text-xs font-bold flex-shrink-0 transition ' + (isBusy ? 'bg-emerald-300 text-white cursor-wait' : 'bg-emerald-500 text-white hover:bg-emerald-600')}
                >
                  {isBusy ? '⏳' : '✓ Got it'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
