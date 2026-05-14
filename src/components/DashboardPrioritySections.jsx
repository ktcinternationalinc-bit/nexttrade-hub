// v55.83-A.6.18 (Max May 14 2026) — Three high-priority dashboard cards.
//
// Per Max May 14 2026: the dashboard should organize the employee's day with
// three immediately-actionable sections AFTER the AI hero, BEFORE the rest of
// the widgets. Each card stands out visually (color-coded, strong type,
// generous spacing) but doesn't clutter the page.
//
// Sections:
//   1. 🚨 Your Overdue Tickets — newest-overdue first, top 10. Each row shows
//      title, status, assigned person, days overdue, last update preview.
//      Click row → opens ticket in dashboard-mounted modal (no tab switch).
//
//   2. 💬 Recent Updates to Your Assigned Tickets — tickets assigned to me
//      that got a comment/status change in the last 3 days. Shows latest
//      comment preview directly so user doesn't need to open each ticket.
//
//   3. ✨ Newly Assigned Tickets — status === 'New' AND assigned to me.
//      Big Acknowledge button right on the card (one click → status changes
//      to 'Acknowledged' + system comment logged).
//
// All ticket clicks go through onOpenTicket(t) which the parent wires to a
// dashboard-mounted modal overlay. Acknowledge is wired through onAcknowledge.

import { useMemo } from 'react';

var STATUS_COLORS = {
  New: '#3b82f6',
  Acknowledged: '#8b5cf6',
  'In Progress': '#eab308',
  Blocked: '#ef4444',
  'On Hold': '#f97316',
  Review: '#06b6d4',
  Closed: '#1e293b',
  Reopened: '#eab308',
};

function daysBetween(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function fmtRelative(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  var now = new Date();
  var mins = Math.floor((now - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return d.toISOString().substring(0, 10);
}

function getUserName(users, id) {
  if (!id) return '';
  var u = (users || []).find(function (x) { return x.id === id; });
  if (!u) return '';
  return u.full_name || u.email || '';
}

export default function DashboardPrioritySections({
  dashTickets,
  recentTicketUpdates,
  myId,
  users,
  todayStr,
  onOpenTicket,
  onAcknowledge,
  busyAckId,
}) {
  // ─── Compute the three lists ───────────────────────────────────────────

  var myTickets = useMemo(function () {
    return (dashTickets || []).filter(function (t) {
      // Assigned to me as primary OR as additional_assignees, and not closed
      if (t.status === 'Closed') return false;
      if (t.assigned_to === myId) return true;
      try {
        var extras = typeof t.additional_assignees === 'string'
          ? JSON.parse(t.additional_assignees)
          : t.additional_assignees;
        if (Array.isArray(extras) && extras.indexOf(myId) >= 0) return true;
      } catch (_) {}
      return false;
    });
  }, [dashTickets, myId]);

  // 1. Overdue — top 10, newest-overdue (most recent due_date in the past) first
  var overdue = useMemo(function () {
    var list = myTickets.filter(function (t) {
      return t.due_date && t.due_date < todayStr;
    });
    list.sort(function (a, b) {
      // Newest overdue first = largest due_date (closest to today)
      return (b.due_date || '').localeCompare(a.due_date || '');
    });
    return list.slice(0, 10);
  }, [myTickets, todayStr]);

  // 3-day cutoff for "recent updates"
  var threeDaysAgoIso = useMemo(function () {
    return new Date(Date.now() - 3 * 86400000).toISOString();
  }, []);

  // 2. Recent Updates — tickets assigned to me with a comment in last 3 days
  //    Group comments by ticket id, take the latest one per ticket.
  var recentUpdates = useMemo(function () {
    var myTixIds = {};
    myTickets.forEach(function (t) { myTixIds[t.id] = true; });
    var latestByTicket = {};
    (recentTicketUpdates || []).forEach(function (c) {
      var tid = c.tickets && c.tickets.id;
      if (!tid || !myTixIds[tid]) return;
      if (!c.created_at || c.created_at < threeDaysAgoIso) return;
      var prev = latestByTicket[tid];
      if (!prev || (c.created_at || '') > (prev.created_at || '')) {
        latestByTicket[tid] = c;
      }
    });
    var result = Object.values(latestByTicket);
    // Sort: newest comment first
    result.sort(function (a, b) {
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    // Attach the ticket to make rendering easier
    return result.slice(0, 5).map(function (c) {
      var ticket = myTickets.find(function (t) { return t.id === (c.tickets && c.tickets.id); });
      return { comment: c, ticket: ticket };
    }).filter(function (x) { return !!x.ticket; });
  }, [myTickets, recentTicketUpdates, threeDaysAgoIso]);

  // 3. Newly assigned — status === 'New' AND assigned to me
  var newlyAssigned = useMemo(function () {
    var list = myTickets.filter(function (t) { return t.status === 'New'; });
    list.sort(function (a, b) {
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    return list;
  }, [myTickets]);

  // v55.83-A.6.20 (Max May 14 2026) — Always render all three cards.
  // Previously when all lists were empty, we collapsed to a single quiet
  // "all clear" tile that looked identical to a blank dashboard. Per Max:
  // "The dashboard cannot look exactly the same as before." So we keep the
  // three big colored cards visible at all times with per-card empty states.
  var allEmpty = overdue.length === 0 && recentUpdates.length === 0 && newlyAssigned.length === 0;

  return (
    <div className="space-y-3 mb-4">
      {/* ============================================================
          PRIORITY HEADER — always visible, color-coded counts
          ============================================================ */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-xl p-3 shadow-md text-white">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-extrabold tracking-tight flex items-center gap-2">
              📌 Your Daily Priorities <span className="text-[10px] font-normal opacity-70">/ أولوياتك اليومية</span>
            </h2>
            <div className="text-[10px] opacity-70">What needs your attention right now</div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className={'px-2 py-1 rounded-md font-bold ' + (overdue.length > 0 ? 'bg-red-500/90' : 'bg-slate-700')}>
              🚨 {overdue.length} overdue
            </span>
            <span className={'px-2 py-1 rounded-md font-bold ' + (recentUpdates.length > 0 ? 'bg-blue-500/90' : 'bg-slate-700')}>
              💬 {recentUpdates.length} updates
            </span>
            <span className={'px-2 py-1 rounded-md font-bold ' + (newlyAssigned.length > 0 ? 'bg-purple-500/90' : 'bg-slate-700')}>
              ✨ {newlyAssigned.length} new
            </span>
          </div>
        </div>
        {allEmpty && (
          <div className="mt-2 text-[11px] bg-emerald-500/20 border border-emerald-400/30 rounded-md p-2 flex items-center gap-2">
            <span className="text-lg">✅</span>
            <span className="font-bold">You're all clear — no overdue, no new assignments, no recent updates. Great work!</span>
          </div>
        )}
      </div>

      {/* ============================================================
          1. OVERDUE TICKETS — RED, BIG, ATTENTION-GRABBING
          ============================================================ */}
      <div className="bg-gradient-to-br from-red-50 to-rose-50 border-2 border-red-300 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-red-600 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🚨</span>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Your Overdue Tickets</h3>
              <div className="text-[10px] font-bold opacity-90">تذاكرك المتأخرة</div>
            </div>
          </div>
          <div className="bg-white text-red-700 px-2.5 py-0.5 rounded-full text-xs font-extrabold">
            {overdue.length} {overdue.length === 1 ? 'ticket' : 'tickets'}
          </div>
        </div>

        <div className="p-2 space-y-2">
          {overdue.length === 0 ? (
            <div className="py-5 text-center">
              <div className="text-2xl mb-1 opacity-50">✅</div>
              <div className="text-sm font-bold text-red-900">No overdue tickets / لا توجد تذاكر متأخرة</div>
              <div className="text-[11px] text-red-700/70 mt-0.5">You're on top of your due dates.</div>
            </div>
          ) : overdue.map(function (t) {
            var dueDate = new Date(t.due_date + 'T00:00:00');
              var daysOver = daysBetween(dueDate, new Date());
              var lastUpdate = (recentTicketUpdates || []).find(function (c) {
                return c.tickets && c.tickets.id === t.id;
              });
              var assignedName = getUserName(users, t.assigned_to) || 'Unassigned';

              return (
                <div key={t.id}
                  onClick={function () { onOpenTicket && onOpenTicket(t); }}
                  className="bg-white rounded-lg p-3 border border-red-200 hover:border-red-400 hover:shadow-md cursor-pointer transition">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[10px] font-mono text-slate-500">{t.ticket_number}</span>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: STATUS_COLORS[t.status] || '#6b7280' }}>{t.status}</span>
                        {t.priority === 'critical' && <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-900 text-white">🚨 CRITICAL</span>}
                        {t.priority === 'high' && <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-600 text-white">🔴 HIGH</span>}
                      </div>
                      <div className="text-sm font-bold text-slate-900 leading-snug">{t.title}</div>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
                        <span className="text-slate-700 font-medium">👤 {assignedName}</span>
                        <span className="text-slate-500">📅 due {t.due_date}</span>
                        {lastUpdate && lastUpdate.created_at && (
                          <span className="text-slate-500">💬 {fmtRelative(lastUpdate.created_at)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="bg-red-100 border border-red-300 rounded-lg px-2.5 py-1.5 text-center">
                        <div className="text-lg font-black text-red-700 leading-none">{daysOver}</div>
                        <div className="text-[9px] font-bold text-red-600 uppercase tracking-wider">day{daysOver === 1 ? '' : 's'} late</div>
                      </div>
                      <button onClick={function (ev) { ev.stopPropagation(); onOpenTicket && onOpenTicket(t); }}
                        className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold whitespace-nowrap">
                        Open →
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      {/* ============================================================
          2. RECENT UPDATES TO YOUR ASSIGNED TICKETS — BLUE
          ============================================================ */}
      <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-300 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-blue-600 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">💬</span>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Recent Updates to Your Tickets</h3>
              <div className="text-[10px] font-bold opacity-90">آخر تحديثات تذاكرك (٣ أيام)</div>
            </div>
          </div>
          <div className="bg-white text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-extrabold">
            {recentUpdates.length} update{recentUpdates.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="p-2 space-y-2">
          {recentUpdates.length === 0 ? (
            <div className="py-5 text-center">
              <div className="text-2xl mb-1 opacity-50">📭</div>
              <div className="text-sm font-bold text-blue-900">No recent updates / لا توجد تحديثات حديثة</div>
              <div className="text-[11px] text-blue-700/70 mt-0.5">No comments or status changes on your tickets in the last 3 days.</div>
            </div>
          ) : recentUpdates.map(function (item) {
              var t = item.ticket;
              var c = item.comment;
              var commentBy = getUserName(users, c.created_by) || 'System';
              var commentPreview = (c.comment_text || '').replace(/<[^>]+>/g, '').substring(0, 140);
              var assignedName = getUserName(users, t.assigned_to) || 'Unassigned';

              return (
                <div key={t.id}
                  onClick={function () { onOpenTicket && onOpenTicket(t); }}
                  className="bg-white rounded-lg p-3 border border-blue-200 hover:border-blue-400 hover:shadow-md cursor-pointer transition">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[10px] font-mono text-slate-500">{t.ticket_number}</span>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: STATUS_COLORS[t.status] || '#6b7280' }}>{t.status}</span>
                      </div>
                      <div className="text-sm font-bold text-slate-900 leading-snug">{t.title}</div>
                      <div className="mt-1.5 p-2 bg-slate-50 border-l-2 border-blue-400 rounded text-[11px] text-slate-800">
                        {c.is_system && <span className="font-mono text-slate-500 mr-1">[system]</span>}
                        {commentPreview}{(c.comment_text || '').length > 140 ? '…' : ''}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
                        <span className="text-slate-700 font-medium">✍️ {commentBy}</span>
                        <span className="text-slate-500">{fmtRelative(c.created_at)}</span>
                        <span className="text-slate-500">👤 {assignedName}</span>
                      </div>
                    </div>
                    <button onClick={function (ev) { ev.stopPropagation(); onOpenTicket && onOpenTicket(t); }}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold whitespace-nowrap flex-shrink-0">
                      Open →
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* ============================================================
          3. NEWLY ASSIGNED — PURPLE, ACKNOWLEDGE BUTTON
          ============================================================ */}
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-300 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-purple-600 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Newly Assigned — Acknowledge</h3>
              <div className="text-[10px] font-bold opacity-90">تذاكر جديدة — أكّد الاستلام</div>
            </div>
          </div>
          <div className="bg-white text-purple-700 px-2.5 py-0.5 rounded-full text-xs font-extrabold">
            {newlyAssigned.length} new
          </div>
        </div>

        <div className="p-2 space-y-2">
          {newlyAssigned.length === 0 ? (
            <div className="py-5 text-center">
              <div className="text-2xl mb-1 opacity-50">📭</div>
              <div className="text-sm font-bold text-purple-900">No new tickets to acknowledge / لا توجد تذاكر جديدة</div>
              <div className="text-[11px] text-purple-700/70 mt-0.5">All your assignments have been acknowledged.</div>
            </div>
          ) : newlyAssigned.map(function (t) {
              var assignedByName = getUserName(users, t.created_by) || 'Unknown';
              var isAcking = busyAckId === t.id;

              return (
                <div key={t.id}
                  className="bg-white rounded-lg p-3 border border-purple-200 hover:border-purple-400 hover:shadow-md transition">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={function () { onOpenTicket && onOpenTicket(t); }}>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[10px] font-mono text-slate-500">{t.ticket_number}</span>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: STATUS_COLORS[t.status] || '#6b7280' }}>{t.status}</span>
                        {t.priority === 'critical' && <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-900 text-white">🚨 CRITICAL</span>}
                        {t.priority === 'high' && <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-600 text-white">🔴 HIGH</span>}
                      </div>
                      <div className="text-sm font-bold text-slate-900 leading-snug">{t.title}</div>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
                        <span className="text-slate-700 font-medium">👤 from {assignedByName}</span>
                        <span className="text-slate-500">📅 assigned {fmtRelative(t.created_at)}</span>
                        {t.due_date && <span className="text-slate-500">⏰ due {t.due_date}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      <button onClick={function () { onAcknowledge && onAcknowledge(t); }}
                        disabled={isAcking}
                        className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-extrabold whitespace-nowrap">
                        {isAcking ? '⏳ ...' : '✓ Acknowledge'}
                      </button>
                      <button onClick={function () { onOpenTicket && onOpenTicket(t); }}
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-purple-300 hover:bg-purple-50 text-purple-700 text-[11px] font-bold whitespace-nowrap">
                        Open
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
