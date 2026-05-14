// v55.83-A.6.23 (Max May 14 2026) — Three priority cards, each split into
// TWO sub-sections per the user's spec: "My Direct" (assigned to me) and
// "I Delegated" (I created and assigned to someone else).
//
// THIS WORKS FOR EVERY LOGGED-IN USER — the filters use `myId` which is passed
// from page.jsx as the current user's ID. Yasmeen, Mohamed, Omar, etc. all see
// their own version of these cards based on whoever is logged in.
//
// Filter parity with the working PersonalDashboard surface:
//   • My Direct  = isMineByAssign(t) (assigned_to OR in additional_assignees)
//   • I Delegated = created_by === me AND NOT isMineByAssign(t)
//   • Visibility gate: dashTickets is already pre-filtered for visibility in
//     page.jsx (private/confidential checks), so we trust it here.
//
// Previous builds only computed My Direct and called it a day, which is why
// every card was empty for super_admin (who delegates almost everything).

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

function parseExtras(t) {
  if (!t || !t.additional_assignees) return [];
  try {
    var v = typeof t.additional_assignees === 'string'
      ? JSON.parse(t.additional_assignees) : t.additional_assignees;
    return Array.isArray(v) ? v : [];
  } catch (_) { return []; }
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
  // ─── Bucket tickets ────────────────────────────────────────────────────

  function isMineByAssign(t) {
    return t.assigned_to === myId || parseExtras(t).indexOf(myId) >= 0;
  }

  var myDirectTickets = useMemo(function () {
    return (dashTickets || []).filter(function (t) {
      if (t.status === 'Closed') return false;
      return isMineByAssign(t);
    });
  }, [dashTickets, myId]);

  var iDelegatedTickets = useMemo(function () {
    return (dashTickets || []).filter(function (t) {
      if (t.status === 'Closed') return false;
      if (t.created_by !== myId) return false;
      if (isMineByAssign(t)) return false;
      return true;
    });
  }, [dashTickets, myId]);

  // ─── Overdue (per bucket) ──────────────────────────────────────────────

  var overdueMyDirect = useMemo(function () {
    var list = myDirectTickets.filter(function (t) {
      return t.due_date && t.due_date < todayStr;
    });
    list.sort(function (a, b) { return (b.due_date || '').localeCompare(a.due_date || ''); });
    return list.slice(0, 10);
  }, [myDirectTickets, todayStr]);

  var overdueDelegated = useMemo(function () {
    var list = iDelegatedTickets.filter(function (t) {
      return t.due_date && t.due_date < todayStr;
    });
    list.sort(function (a, b) { return (b.due_date || '').localeCompare(a.due_date || ''); });
    return list.slice(0, 10);
  }, [iDelegatedTickets, todayStr]);

  // ─── Recent Updates (last 3 days, latest comment per ticket) ───────────

  var threeDaysAgoIso = useMemo(function () {
    return new Date(Date.now() - 3 * 86400000).toISOString();
  }, []);

  function pickLatestPerTicket(ticketBucket) {
    var bucketIds = {};
    ticketBucket.forEach(function (t) { bucketIds[t.id] = true; });
    var latestByTicket = {};
    (recentTicketUpdates || []).forEach(function (c) {
      var tid = c.tickets && c.tickets.id;
      if (!tid || !bucketIds[tid]) return;
      if (!c.created_at || c.created_at < threeDaysAgoIso) return;
      var prev = latestByTicket[tid];
      if (!prev || (c.created_at || '') > (prev.created_at || '')) {
        latestByTicket[tid] = c;
      }
    });
    var arr = Object.values(latestByTicket);
    arr.sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
    return arr.slice(0, 5).map(function (c) {
      var ticket = ticketBucket.find(function (t) { return t.id === (c.tickets && c.tickets.id); });
      return { comment: c, ticket: ticket };
    }).filter(function (x) { return !!x.ticket; });
  }

  var updatesMyDirect = useMemo(function () {
    return pickLatestPerTicket(myDirectTickets);
  }, [myDirectTickets, recentTicketUpdates, threeDaysAgoIso]);

  var updatesDelegated = useMemo(function () {
    return pickLatestPerTicket(iDelegatedTickets);
  }, [iDelegatedTickets, recentTicketUpdates, threeDaysAgoIso]);

  // ─── Newly Assigned (status === 'New', per bucket) ─────────────────────

  var newMyDirect = useMemo(function () {
    var list = myDirectTickets.filter(function (t) { return t.status === 'New'; });
    list.sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
    return list;
  }, [myDirectTickets]);

  var newDelegated = useMemo(function () {
    var list = iDelegatedTickets.filter(function (t) { return t.status === 'New'; });
    list.sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
    return list;
  }, [iDelegatedTickets]);

  // ─── Totals for the header badges ──────────────────────────────────────

  var overdueTotal = overdueMyDirect.length + overdueDelegated.length;
  var updatesTotal = updatesMyDirect.length + updatesDelegated.length;
  var newTotal = newMyDirect.length + newDelegated.length;
  var allEmpty = overdueTotal === 0 && updatesTotal === 0 && newTotal === 0;

  // ────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3 mb-4">
      {/* ============================================================
          PRIORITY HEADER — counts color-coded per card
          ============================================================ */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-xl p-3 shadow-md text-white">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-extrabold tracking-tight flex items-center gap-2">
              📌 Your Daily Priorities <span className="text-[10px] font-normal opacity-70">/ أولوياتك اليومية</span>
            </h2>
            <div className="text-[10px] opacity-70">Direct work + what you've delegated</div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className={'px-2 py-1 rounded-md font-bold ' + (overdueTotal > 0 ? 'bg-red-500/90' : 'bg-slate-700')}>
              🚨 {overdueTotal} overdue
            </span>
            <span className={'px-2 py-1 rounded-md font-bold ' + (updatesTotal > 0 ? 'bg-blue-500/90' : 'bg-slate-700')}>
              💬 {updatesTotal} updates
            </span>
            <span className={'px-2 py-1 rounded-md font-bold ' + (newTotal > 0 ? 'bg-purple-500/90' : 'bg-slate-700')}>
              ✨ {newTotal} new
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
          1. OVERDUE — RED
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
            {overdueTotal} {overdueTotal === 1 ? 'ticket' : 'tickets'}
          </div>
        </div>

        <div className="p-2 space-y-3">
          <SubSection
            title="📥 My Direct"
            subtitle="مُسنَدة إليّ"
            count={overdueMyDirect.length}
            emptyMsg="No overdue tickets directly assigned to you"
            tone="red"
            items={overdueMyDirect}
            renderRow={function (t) {
              return <OverdueRow key={t.id} t={t} users={users} recentTicketUpdates={recentTicketUpdates} onOpenTicket={onOpenTicket} />;
            }}
          />
          <SubSection
            title="📤 I Delegated"
            subtitle="فوّضتها لآخرين"
            count={overdueDelegated.length}
            emptyMsg="None of the tickets you delegated are overdue"
            tone="red"
            items={overdueDelegated}
            renderRow={function (t) {
              return <OverdueRow key={t.id} t={t} users={users} recentTicketUpdates={recentTicketUpdates} onOpenTicket={onOpenTicket} />;
            }}
          />
        </div>
      </div>

      {/* ============================================================
          2. RECENT UPDATES — BLUE
          ============================================================ */}
      <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-300 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-blue-600 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">💬</span>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Recent Updates (Last 3 Days)</h3>
              <div className="text-[10px] font-bold opacity-90">آخر التحديثات (٣ أيام)</div>
            </div>
          </div>
          <div className="bg-white text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-extrabold">
            {updatesTotal} update{updatesTotal === 1 ? '' : 's'}
          </div>
        </div>

        <div className="p-2 space-y-3">
          <SubSection
            title="📥 My Direct"
            subtitle="مُسنَدة إليّ"
            count={updatesMyDirect.length}
            emptyMsg="No recent updates on tickets assigned to you"
            tone="blue"
            items={updatesMyDirect}
            renderRow={function (item) {
              return <UpdateRow key={item.ticket.id + ':' + item.comment.id} item={item} users={users} onOpenTicket={onOpenTicket} />;
            }}
          />
          <SubSection
            title="📤 I Delegated"
            subtitle="فوّضتها لآخرين"
            count={updatesDelegated.length}
            emptyMsg="No recent updates on tickets you delegated"
            tone="blue"
            items={updatesDelegated}
            renderRow={function (item) {
              return <UpdateRow key={item.ticket.id + ':' + item.comment.id} item={item} users={users} onOpenTicket={onOpenTicket} />;
            }}
          />
        </div>
      </div>

      {/* ============================================================
          3. NEWLY ASSIGNED — PURPLE
          ============================================================ */}
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-300 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-purple-600 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Newly Assigned</h3>
              <div className="text-[10px] font-bold opacity-90">تذاكر جديدة</div>
            </div>
          </div>
          <div className="bg-white text-purple-700 px-2.5 py-0.5 rounded-full text-xs font-extrabold">
            {newTotal} new
          </div>
        </div>

        <div className="p-2 space-y-3">
          <SubSection
            title="📥 My Direct — Acknowledge"
            subtitle="مُسنَدة إليّ — أكّد الاستلام"
            count={newMyDirect.length}
            emptyMsg="No new tickets waiting for your acknowledgment"
            tone="purple"
            items={newMyDirect}
            renderRow={function (t) {
              var isAcking = busyAckId === t.id;
              return <NewRow key={t.id} t={t} users={users} onOpenTicket={onOpenTicket}
                showAck={true} isAcking={isAcking} onAcknowledge={onAcknowledge} />;
            }}
          />
          <SubSection
            title="📤 I Delegated — Awaiting Acknowledgment"
            subtitle="فوّضتها — بانتظار الاستلام"
            count={newDelegated.length}
            emptyMsg="Everyone has acknowledged tickets you delegated"
            tone="purple"
            items={newDelegated}
            renderRow={function (t) {
              return <NewRow key={t.id} t={t} users={users} onOpenTicket={onOpenTicket} showAck={false} />;
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// SUB-SECTION WRAPPER
// ────────────────────────────────────────────────────────────────────────

function SubSection({ title, subtitle, count, emptyMsg, tone, items, renderRow }) {
  var headerBg = {
    red: 'bg-red-100/70 border-red-200 text-red-900',
    blue: 'bg-blue-100/70 border-blue-200 text-blue-900',
    purple: 'bg-purple-100/70 border-purple-200 text-purple-900',
  }[tone] || 'bg-slate-100 border-slate-200 text-slate-900';

  var emptyTextClass = {
    red: 'text-red-700/60',
    blue: 'text-blue-700/60',
    purple: 'text-purple-700/60',
  }[tone] || 'text-slate-600';

  return (
    <div>
      <div className={'flex items-center justify-between px-2.5 py-1.5 rounded-md border ' + headerBg}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-extrabold">{title}</span>
          <span className="text-[9px] opacity-70">{subtitle}</span>
        </div>
        <span className="text-[10px] font-bold opacity-80">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      </div>
      {count === 0 ? (
        <div className={'text-[11px] italic px-2.5 py-2 ' + emptyTextClass}>{emptyMsg}</div>
      ) : (
        <div className="space-y-1.5 mt-1.5">{items.map(renderRow)}</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// ROW COMPONENTS
// ────────────────────────────────────────────────────────────────────────

function OverdueRow({ t, users, recentTicketUpdates, onOpenTicket }) {
  var dueDate = new Date(t.due_date + 'T00:00:00');
  var daysOver = daysBetween(dueDate, new Date());
  var lastUpdate = (recentTicketUpdates || []).find(function (c) {
    return c.tickets && c.tickets.id === t.id;
  });
  var assignedName = getUserName(users, t.assigned_to) || 'Unassigned';

  return (
    <div onClick={function () { onOpenTicket && onOpenTicket(t); }}
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
}

function UpdateRow({ item, users, onOpenTicket }) {
  var t = item.ticket;
  var c = item.comment;
  var commentBy = getUserName(users, c.created_by) || 'System';
  var commentPreview = (c.comment_text || '').replace(/<[^>]+>/g, '').substring(0, 140);
  var assignedName = getUserName(users, t.assigned_to) || 'Unassigned';

  return (
    <div onClick={function () { onOpenTicket && onOpenTicket(t); }}
      className="bg-white rounded-lg p-3 border border-blue-200 hover:border-blue-400 hover:shadow-md cursor-pointer transition">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-mono text-slate-500">{t.ticket_number}</span>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: STATUS_COLORS[t.status] || '#6b7280' }}>{t.status}</span>
            <span className="text-[10px] text-slate-500">👤 {assignedName}</span>
          </div>
          <div className="text-sm font-bold text-slate-900 leading-snug">{t.title}</div>
          <div className="mt-1.5 bg-slate-50 border-l-2 border-blue-400 px-2 py-1 rounded text-[11px] text-slate-700 italic">
            "{commentPreview}{(c.comment_text || '').length > 140 ? '…' : ''}"
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
            <span>by {commentBy}</span>
            <span>· {fmtRelative(c.created_at)}</span>
          </div>
        </div>
        <button onClick={function (ev) { ev.stopPropagation(); onOpenTicket && onOpenTicket(t); }}
          className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold whitespace-nowrap self-start">
          Open →
        </button>
      </div>
    </div>
  );
}

function NewRow({ t, users, onOpenTicket, showAck, isAcking, onAcknowledge }) {
  var assignedByName = getUserName(users, t.created_by) || 'Unknown';
  var assignedToName = getUserName(users, t.assigned_to) || 'Unassigned';

  return (
    <div onClick={function () { onOpenTicket && onOpenTicket(t); }}
      className="bg-white rounded-lg p-3 border border-purple-200 hover:border-purple-400 hover:shadow-md cursor-pointer transition">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-mono text-slate-500">{t.ticket_number}</span>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white bg-blue-500">New</span>
            {t.priority === 'critical' && <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-900 text-white">🚨 CRITICAL</span>}
            {t.priority === 'high' && <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-600 text-white">🔴 HIGH</span>}
          </div>
          <div className="text-sm font-bold text-slate-900 leading-snug">{t.title}</div>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
            {showAck ? (
              <span className="text-slate-600">📥 from <span className="font-bold">{assignedByName}</span></span>
            ) : (
              <span className="text-slate-600">📤 to <span className="font-bold">{assignedToName}</span></span>
            )}
            {t.created_at && <span className="text-slate-500">· assigned {fmtRelative(t.created_at)}</span>}
            {t.due_date && <span className="text-slate-500">· due {t.due_date}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {showAck && (
            <button onClick={function (ev) { ev.stopPropagation(); onAcknowledge && onAcknowledge(t); }}
              disabled={isAcking}
              className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-extrabold whitespace-nowrap">
              {isAcking ? '⏳ ...' : '✓ Acknowledge'}
            </button>
          )}
          <button onClick={function (ev) { ev.stopPropagation(); onOpenTicket && onOpenTicket(t); }}
            className="px-2.5 py-1.5 rounded-lg bg-white border border-purple-300 hover:bg-purple-50 text-purple-700 text-[11px] font-bold whitespace-nowrap">
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
