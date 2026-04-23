'use client';
// ============================================================
// PriorityBoard — a visual "what everyone is working on" board.
//
// S21 (Apr 23 2026) — Max wanted a way to see every team member's
// prioritized ticket stack at a glance. One column per person.
// Within each column, tickets are ordered by `assignee_priority`
// (1 = top). Drag to reorder within a column. Drag across columns
// to reassign + reprioritize. A "Today" strip at the top shows each
// person's current priority-1 ticket — one glance tells you who is
// on what.
//
// Rules:
//   - Anyone on the team can SEE the whole board.
//   - A person can reorder their OWN column freely.
//   - Admins and super-admins can drag across columns (reassign).
//   - Non-admins dragging outside their column is disallowed; we
//     revert the move and show a toast.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { supabase, dbUpdate } from '../lib/supabase';

var STATUS_COLORS_MINI = {
  'Open': '#3b82f6',
  'In Progress': '#f59e0b',
  'Blocked': '#ef4444',
  'Closed': '#64748b',
  'Done': '#10b981',
};
var PRIORITY_BADGE = {
  high: { bg: '#fee2e2', fg: '#b91c1c', label: '🔴' },
  medium: { bg: '#fef3c7', fg: '#a16207', label: '🟡' },
  low: { bg: '#dcfce7', fg: '#166534', label: '🟢' },
};

export default function PriorityBoard({
  tickets,           // current array of all tickets
  users,             // all team users
  currentUserId,     // caller's id — allowed to reorder own column freely
  isAdmin,           // allowed to move across columns
  onReorder,         // async (payload) => void - called when user drops
  onSelectTicket,    // (ticket) => void - open ticket detail
  onRefresh,         // manual refresh
  lang,              // 'ar' | 'en'
}) {
  var [dragging, setDragging] = useState(null); // { ticketId, fromUserId }
  var [dropTarget, setDropTarget] = useState(null); // { userId, position }
  var [statusFilter, setStatusFilter] = useState('open'); // open | all
  var [busy, setBusy] = useState(false);
  var [toastMsg, setToastMsg] = useState('');
  // S22.3 (Apr 23 2026) — Per-column expand state for the Unranked pile.
  // Max: "haitham has 10 more to show.. but we cannot open it." Previously
  // we hid everything past the 6th ticket behind a non-clickable counter.
  // Now each user's Unranked section can be toggled open to show all.
  var [expandedUnranked, setExpandedUnranked] = useState({});

  // Only show open/in-progress on the board by default — closed tickets
  // don't need prioritizing. Admins can toggle to see everything.
  var visibleTickets = useMemo(function() {
    return (tickets || []).filter(function(t) {
      if (!t.assigned_to) return false; // unassigned tickets go in a special column below
      if (statusFilter === 'open') {
        var s = (t.status || '').toLowerCase();
        return s !== 'closed' && s !== 'done' && s !== 'cancelled' && s !== 'resolved';
      }
      return true;
    });
  }, [tickets, statusFilter]);

  // Build per-user columns. Ranked tickets first (by assignee_priority ASC),
  // then unranked below. An "Unassigned" pseudo-column collects tickets
  // whose assigned_to is null or unknown.
  var columns = useMemo(function() {
    var byUser = {};
    (users || []).forEach(function(u) {
      byUser[u.id] = { user: u, ranked: [], unranked: [] };
    });
    visibleTickets.forEach(function(t) {
      if (!byUser[t.assigned_to]) return; // assignee not in current team list
      if (t.assignee_priority != null) {
        byUser[t.assigned_to].ranked.push(t);
      } else {
        byUser[t.assigned_to].unranked.push(t);
      }
    });
    Object.values(byUser).forEach(function(col) {
      col.ranked.sort(function(a, b) { return Number(a.assignee_priority) - Number(b.assignee_priority); });
      col.unranked.sort(function(a, b) { return new Date(b.created_at).getTime() - new Date(a.created_at).getTime(); });
    });
    return byUser;
  }, [visibleTickets, users]);

  // "Today" strip: each person's priority-1 ticket
  var todayStrip = useMemo(function() {
    return (users || []).map(function(u) {
      var col = columns[u.id];
      var top = col && col.ranked.length > 0 ? col.ranked[0] : null;
      return { user: u, top: top };
    });
  }, [columns, users]);

  function showToast(msg) {
    setToastMsg(msg);
    setTimeout(function() { setToastMsg(''); }, 2500);
  }

  function onDragStart(e, t) {
    setDragging({ ticketId: t.id, fromUserId: t.assigned_to });
    e.dataTransfer.effectAllowed = 'move';
    // Firefox needs data set to allow drop events
    try { e.dataTransfer.setData('text/plain', t.id); } catch (_) {}
  }

  function onDragEnd() {
    setDragging(null);
    setDropTarget(null);
  }

  function onDragOverCol(e, userId, position) {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ userId: userId, position: position });
  }

  async function onDropCol(e, targetUserId, targetPosition) {
    e.preventDefault();
    if (!dragging) return;
    var src = dragging;
    setDragging(null);
    setDropTarget(null);
    if (busy) return;

    // Permission: non-admins can only reorder within their own column
    var crossColumn = src.fromUserId !== targetUserId;
    if (crossColumn && !isAdmin) {
      showToast('Only admins can move tickets between people.');
      return;
    }
    if (!crossColumn && src.fromUserId !== currentUserId && !isAdmin) {
      showToast('You can only reorder your own column.');
      return;
    }

    setBusy(true);
    try {
      // Build the new priority order for the target column
      var targetCol = columns[targetUserId];
      var ranked = targetCol ? targetCol.ranked.slice() : [];
      // If it's a move WITHIN the same column, first remove from current position
      if (!crossColumn) {
        ranked = ranked.filter(function(t) { return t.id !== src.ticketId; });
      }
      // Find the dragged ticket (from its source column) so we can insert it
      var draggedTicket = (tickets || []).find(function(t) { return t.id === src.ticketId; });
      if (!draggedTicket) { setBusy(false); return; }
      var insertedTicket = Object.assign({}, draggedTicket, {
        assigned_to: targetUserId,
      });
      // Clamp position to valid range [0 .. ranked.length]
      var pos = Math.max(0, Math.min(ranked.length, targetPosition));
      ranked.splice(pos, 0, insertedTicket);

      // Compute new priorities (1-based) for each ticket in the target column
      var updates = [];
      ranked.forEach(function(t, idx) {
        var newPriority = idx + 1;
        if (t.assignee_priority !== newPriority || t.assigned_to !== targetUserId) {
          var changes = { assignee_priority: newPriority };
          if (t.assigned_to !== targetUserId) changes.assigned_to = targetUserId;
          updates.push({ id: t.id, changes: changes });
        }
      });

      // If the dragged ticket came from a different column, we also need to
      // renumber the SOURCE column to close the gap.
      if (crossColumn) {
        var srcCol = columns[src.fromUserId];
        if (srcCol) {
          var srcRanked = srcCol.ranked.filter(function(t) { return t.id !== src.ticketId; });
          srcRanked.forEach(function(t, idx) {
            var np = idx + 1;
            if (t.assignee_priority !== np) {
              updates.push({ id: t.id, changes: { assignee_priority: np } });
            }
          });
        }
      }

      // Persist
      for (var i = 0; i < updates.length; i++) {
        await dbUpdate('tickets', updates[i].id, updates[i].changes, currentUserId);
      }

      if (onReorder) onReorder({ affected: updates.length });
      showToast('Updated ' + updates.length + ' ticket' + (updates.length === 1 ? '' : 's'));
    } catch (err) {
      console.error('[priority-board]', err);
      showToast('Could not save: ' + (err && err.message ? err.message : 'unknown error'));
    } finally {
      setBusy(false);
    }
  }

  function clearRanking(userId) {
    if (!isAdmin && userId !== currentUserId) {
      showToast('You can only clear your own priorities.');
      return;
    }
    var col = columns[userId];
    if (!col || col.ranked.length === 0) return;
    if (!confirm('Clear all priority numbers for this person? The tickets stay assigned; they just drop back to the unranked pool.')) return;
    setBusy(true);
    (async function() {
      try {
        for (var i = 0; i < col.ranked.length; i++) {
          await dbUpdate('tickets', col.ranked[i].id, { assignee_priority: null }, currentUserId);
        }
        if (onReorder) onReorder({ affected: col.ranked.length });
        showToast('Cleared ' + col.ranked.length + ' priority ' + (col.ranked.length === 1 ? 'rank' : 'ranks'));
      } catch (err) {
        showToast('Could not clear: ' + (err && err.message ? err.message : err));
      } finally {
        setBusy(false);
      }
    })();
  }

  function renderTicketCard(t, rank) {
    var assignees = (users || []);
    var prio = PRIORITY_BADGE[String(t.priority || 'medium').toLowerCase()] || PRIORITY_BADGE.medium;
    var statusColor = STATUS_COLORS_MINI[t.status] || '#64748b';
    return (
      <div
        key={t.id}
        draggable
        onDragStart={function(e) { onDragStart(e, t); }}
        onDragEnd={onDragEnd}
        onClick={function() { if (onSelectTicket) onSelectTicket(t); }}
        className="bg-white border border-slate-200 rounded-lg p-2 mb-1.5 cursor-grab hover:shadow-md hover:border-indigo-300 transition select-none"
        title="Drag to reorder; click to open"
      >
        <div className="flex items-center gap-1.5 mb-1">
          {rank != null && (
            <span className="text-[10px] font-extrabold bg-indigo-600 text-white rounded-full w-5 h-5 flex items-center justify-center">
              {rank}
            </span>
          )}
          <span
            className="text-[8px] font-semibold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: prio.bg, color: prio.fg }}
          >
            {prio.label}
          </span>
          <span
            className="text-[8px] font-semibold px-1.5 py-0.5 rounded text-white"
            style={{ backgroundColor: statusColor }}
          >
            {t.status}
          </span>
          {t.due_date && new Date(t.due_date) < new Date(new Date().toISOString().substring(0, 10)) && (
            <span className="text-[8px] font-bold text-red-600">⏰ overdue</span>
          )}
        </div>
        <div className="text-xs font-semibold text-slate-800 leading-tight line-clamp-2">{t.title}</div>
        {t.due_date && (
          <div className="text-[9px] text-slate-500 mt-1">Due {t.due_date}</div>
        )}
      </div>
    );
  }

  function renderDropZone(userId, position) {
    var active = dropTarget && dropTarget.userId === userId && dropTarget.position === position;
    return (
      <div
        onDragOver={function(e) { onDragOverCol(e, userId, position); }}
        onDrop={function(e) { onDropCol(e, userId, position); }}
        className={'h-2 -my-1 rounded transition ' + (active ? 'h-8 bg-indigo-100 border-2 border-dashed border-indigo-400' : '')}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-lg z-[100]">
          {toastMsg}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={function() { setStatusFilter('open'); }}
            className={'px-2.5 py-1 rounded text-[11px] font-semibold ' + (statusFilter === 'open' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
            Active only
          </button>
          <button
            onClick={function() { setStatusFilter('all'); }}
            className={'px-2.5 py-1 rounded text-[11px] font-semibold ' + (statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
            Include done/closed
          </button>
        </div>
        {onRefresh && (
          <button onClick={onRefresh} className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-600">
            ↻ Refresh
          </button>
        )}
        <div className="text-[11px] text-slate-500 flex-1 min-w-[180px]">
          Drag tickets to reorder within a column. {isAdmin ? 'Drag across columns to reassign.' : 'Only admins can reassign to other people.'}
        </div>
      </div>

      {/* Today strip — one-glance view of each person's #1 priority */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">
          🎯 Today — Everyone's #1 Priority
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {todayStrip.map(function(s) {
            var initials = (s.user.name || '?').split(' ').map(function(p) { return p[0]; }).filter(Boolean).slice(0, 2).join('').toUpperCase();
            return (
              <div key={s.user.id}
                onClick={function() { if (s.top && onSelectTicket) onSelectTicket(s.top); }}
                className={'bg-white border rounded-lg p-2.5 ' + (s.top ? 'cursor-pointer hover:border-indigo-300 hover:shadow-sm border-slate-200' : 'border-slate-100')}>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold text-slate-700 truncate">{s.user.name}</div>
                    {s.top ? (
                      <div className="text-[11px] font-semibold text-slate-800 truncate" title={s.top.title}>{s.top.title}</div>
                    ) : (
                      <div className="text-[10px] text-slate-400 italic">No priority set</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Board */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">
          📋 Priority Board
        </div>
        <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollSnapType: 'x mandatory' }}>
          {(users || []).map(function(u) {
            var col = columns[u.id] || { ranked: [], unranked: [] };
            var total = col.ranked.length + col.unranked.length;
            var initials = (u.name || '?').split(' ').map(function(p) { return p[0]; }).filter(Boolean).slice(0, 2).join('').toUpperCase();
            return (
              <div key={u.id} className="flex-shrink-0 w-64 bg-slate-50 rounded-xl p-2.5" style={{ scrollSnapAlign: 'start' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                      {initials}
                    </div>
                    <div>
                      <div className="text-xs font-bold leading-tight">{u.name}</div>
                      <div className="text-[9px] text-slate-500">{total} ticket{total === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                  {(isAdmin || u.id === currentUserId) && col.ranked.length > 0 && (
                    <button onClick={function() { clearRanking(u.id); }}
                      className="text-[9px] text-slate-400 hover:text-red-500"
                      title="Clear all priority ranks for this person">↺</button>
                  )}
                </div>

                {/* Ranked tickets */}
                {col.ranked.length > 0 ? (
                  <div>
                    {renderDropZone(u.id, 0)}
                    {col.ranked.map(function(t, idx) {
                      return (
                        <div key={t.id}>
                          {renderTicketCard(t, idx + 1)}
                          {renderDropZone(u.id, idx + 1)}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    onDragOver={function(e) { onDragOverCol(e, u.id, 0); }}
                    onDrop={function(e) { onDropCol(e, u.id, 0); }}
                    className={'text-center text-[10px] text-slate-400 italic py-6 rounded-lg border-2 border-dashed ' + (dropTarget && dropTarget.userId === u.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200')}>
                    Drop a ticket here to prioritize
                  </div>
                )}

                {/* Unranked pile — S22.3: clickable "show all / show less" */}
                {col.unranked.length > 0 && (function() {
                  var isExpanded = !!expandedUnranked[u.id];
                  var shownCount = isExpanded ? col.unranked.length : Math.min(6, col.unranked.length);
                  var hiddenCount = col.unranked.length - shownCount;
                  return (
                    <div className="mt-3 pt-2 border-t border-slate-200">
                      <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Unranked ({col.unranked.length})</div>
                      {col.unranked.slice(0, shownCount).map(function(t) { return renderTicketCard(t, null); })}
                      {col.unranked.length > 6 && (
                        <button
                          onClick={function() {
                            setExpandedUnranked(function(prev) {
                              var next = {};
                              for (var k in prev) next[k] = prev[k];
                              next[u.id] = !prev[u.id];
                              return next;
                            });
                          }}
                          className="w-full mt-1 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 rounded py-1 transition"
                        >
                          {isExpanded ? '− Show less' : '+ Show ' + hiddenCount + ' more'}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
