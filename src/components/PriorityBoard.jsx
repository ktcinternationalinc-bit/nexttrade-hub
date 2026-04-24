'use client';
// ============================================================
// PriorityBoard — visual per-person ticket priority board
//
// RULES (per Max, Apr 23 2026):
//   1. A ticket lives in its PRIMARY assignee's column (not duplicated)
//   2. Inside a column, tickets are ranked 1..N by assignee_priority.
//      Below the ranked pile is an "Unranked" section with everything
//      that doesn't have a priority number yet.
//   3. Anyone who is an assignee on the ticket (primary OR additional)
//      can drag the ticket — they don't have to be an admin.
//   4. Dragging a ticket to another person's column REASSIGNS it:
//      - `tickets.assigned_to` becomes the target user
//      - The old primary is pushed to `additional_assignees` (so they
//        stay on the ticket as a secondary)
//      - If the target was NOT already an assignee, they are auto-added
//        as an assignee by virtue of becoming the new primary
//   5. Admins and super-admins can drag anything regardless of current
//      assignees (emergency override).
//
// Storage: still `tickets.assignee_priority` (column from s21 SQL).
// We did NOT introduce the multi-row ticket_assignee_priorities table
// in this iteration because the "one ticket per column" rule above
// means one priority per ticket is enough.
// ============================================================

import { useState, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';

var STATUS_COLORS_MINI = {
  'Open': '#3b82f6',
  'Acknowledged': '#8b5cf6',
  'In Progress': '#f59e0b',
  'Blocked': '#ef4444',
  'On Hold': '#f97316',
  'Review': '#06b6d4',
  'Closed': '#64748b',
  'Reopened': '#eab308',
  'New': '#3b82f6',
  'Done': '#10b981',
};
var PRIORITY_BADGE = {
  high:   { bg: '#fee2e2', fg: '#b91c1c', label: '🔴' },
  medium: { bg: '#fef3c7', fg: '#a16207', label: '🟡' },
  low:    { bg: '#dcfce7', fg: '#166534', label: '🟢' },
};

// Parse additional_assignees (stored as a JSON string in the DB).
// Always returns an array of user ids (never null).
function parseAdditional(t) {
  try {
    var parsed = JSON.parse(t.additional_assignees || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (e) { return []; }
}

// Full assignee list (primary + additional). Used for "can this user
// drag this ticket?" permission checks.
function allAssigneesOf(t) {
  var list = t.assigned_to ? [t.assigned_to] : [];
  parseAdditional(t).forEach(function(id) {
    if (id && list.indexOf(id) === -1) list.push(id);
  });
  return list;
}

export default function PriorityBoard({
  tickets,
  users,
  currentUserId,
  isAdmin,
  onReorder,        // callback after successful drag — parent reloads
  onSelectTicket,   // (ticket) => void - open ticket detail
  onRefresh,
  lang,
}) {
  var [dragging, setDragging] = useState(null); // { ticketId, fromUserId }
  var [dropTarget, setDropTarget] = useState(null); // { userId, position }
  var [statusFilter, setStatusFilter] = useState('open'); // open | all
  var [busy, setBusy] = useState(false);
  var [toastMsg, setToastMsg] = useState('');
  // Per-column expand/collapse state for the Unranked pile.
  var [expandedUnranked, setExpandedUnranked] = useState({});

  function showToast(msg) {
    setToastMsg(msg);
    setTimeout(function() { setToastMsg(''); }, 2800);
  }

  // Only show open / in-progress tickets by default. The board is about
  // "what's on deck," not archive.
  var visibleTickets = useMemo(function() {
    return (tickets || []).filter(function(t) {
      if (!t.assigned_to) return false;
      if (statusFilter === 'open') {
        var s = String(t.status || '').toLowerCase();
        return s !== 'closed' && s !== 'done' && s !== 'cancelled' && s !== 'resolved';
      }
      return true;
    });
  }, [tickets, statusFilter]);

  // Build per-user columns. Ranked first (priority 1 at top), then unranked.
  //
  // S22.8 (Apr 23 2026) — Priority convention:
  //   1..999    = RANKED pile (Max's top-N list)
  //   1001..    = UNRANKED pile with explicit user-set order
  //   null      = UNRANKED pile, never touched, sorted by creation date
  //
  // This lets users reorder the unranked pile too (previously it was
  // frozen to creation-date sort). When a ticket is dropped into the
  // unranked section, it gets a priority in the 1001+ range that
  // encodes its unranked position.
  var UNRANKED_FLOOR = 1000;
  var columns = useMemo(function() {
    var byUser = {};
    (users || []).forEach(function(u) {
      byUser[u.id] = { user: u, ranked: [], unranked: [] };
    });
    visibleTickets.forEach(function(t) {
      if (!byUser[t.assigned_to]) return;
      var p = t.assignee_priority;
      if (p != null && p < UNRANKED_FLOOR) {
        byUser[t.assigned_to].ranked.push(t);
      } else {
        byUser[t.assigned_to].unranked.push(t);
      }
    });
    Object.keys(byUser).forEach(function(uid) {
      var col = byUser[uid];
      col.ranked.sort(function(a, b) { return Number(a.assignee_priority) - Number(b.assignee_priority); });
      // Unranked sort: user-ordered (≥1001) come first in their order,
      // then untouched (null priority) by creation date. That way, any
      // tickets Max has hand-ordered stay at the top of the unranked
      // pile, and freshly-created tickets land below them.
      col.unranked.sort(function(a, b) {
        var pa = a.assignee_priority, pb = b.assignee_priority;
        var aOrdered = pa != null && pa >= UNRANKED_FLOOR;
        var bOrdered = pb != null && pb >= UNRANKED_FLOOR;
        if (aOrdered && bOrdered) return Number(pa) - Number(pb);
        if (aOrdered) return -1;
        if (bOrdered) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    });
    return byUser;
  }, [visibleTickets, users]);

  // "Today" strip: each person's priority-1 ticket
  var todayStrip = useMemo(function() {
    return (users || []).map(function(u) {
      var col = columns[u.id];
      return { user: u, top: col && col.ranked.length > 0 ? col.ranked[0] : null };
    });
  }, [columns, users]);

  // ---- Drag handlers ---------------------------------------------------

  function onDragStart(e, t) {
    setDragging({ ticketId: t.id, fromUserId: t.assigned_to });
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', t.id); } catch (_) {}
  }

  function onDragEnd() {
    setDragging(null);
    setDropTarget(null);
  }

  function onDragOverCol(e, userId, position, pile) {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ userId: userId, position: position, pile: pile || 'ranked' });
  }

  // Check: can the current user drag this ticket?
  // Rule (per Max): admins can always drag. Anyone on the ticket
  // (primary OR additional assignee) can drag.
  function canDragTicket(ticket) {
    if (isAdmin) return true;
    if (!ticket) return false;
    return allAssigneesOf(ticket).indexOf(currentUserId) !== -1;
  }

  // S22.8 — Pile-aware drop.
  //   pile = 'ranked'   → set priorities 1..N for the target's ranked list
  //   pile = 'unranked' → set priorities UNRANKED_FLOOR+1.. for the target's unranked list
  // Drops also handle cross-column (reassign) when fromUserId !== targetUserId.
  async function onDropCol(e, targetUserId, targetPosition, pile) {
    e.preventDefault();
    if (!dragging) return;
    var src = dragging;
    setDragging(null);
    setDropTarget(null);
    if (busy) return;

    var draggedTicket = (tickets || []).find(function(t) { return t.id === src.ticketId; });
    if (!draggedTicket) return;

    // Permission: current user must be on the ticket OR be an admin.
    if (!canDragTicket(draggedTicket)) {
      showToast('Only people on this ticket can move it. Ask to be added first.');
      return;
    }

    var targetPile = pile || 'ranked';
    var crossColumn = src.fromUserId !== targetUserId;
    setBusy(true);

    try {
      // --------------------------------------------------------------
      // CROSS-COLUMN MOVE — reassign
      // --------------------------------------------------------------
      if (crossColumn) {
        var oldPrimary = draggedTicket.assigned_to;
        var existingAdditional = parseAdditional(draggedTicket);

        var newAdditional = existingAdditional.filter(function(id) {
          return id && id !== targetUserId;
        });
        if (oldPrimary && oldPrimary !== targetUserId && newAdditional.indexOf(oldPrimary) === -1) {
          newAdditional.push(oldPrimary);
        }

        var wasAlreadyOnTicket = existingAdditional.indexOf(targetUserId) !== -1 || oldPrimary === targetUserId;

        await dbUpdate('tickets', draggedTicket.id, {
          assigned_to: targetUserId,
          additional_assignees: newAdditional.length ? JSON.stringify(newAdditional) : null,
          updated_by: currentUserId,
        }, currentUserId);

        try {
          var commentText;
          if (wasAlreadyOnTicket) {
            commentText = '🔀 Reassigned on Priority Board — now primary';
          } else {
            commentText = '🔀 Added as assignee via Priority Board (auto-added by system)';
          }
          await dbInsert('ticket_comments', {
            ticket_id: draggedTicket.id,
            comment_text: commentText,
            is_system: true,
            created_by: currentUserId,
          }, currentUserId);
        } catch (_) { /* non-fatal */ }

        try { await logActivity(currentUserId, 'Reassigned ticket on Priority Board: ' + draggedTicket.title, 'ticket'); } catch (_) {}
      }

      // --------------------------------------------------------------
      // BUILD THE TARGET PILE AFTER THE DROP
      // --------------------------------------------------------------
      var targetCol = columns[targetUserId] || { ranked: [], unranked: [] };
      var listRef = targetPile === 'unranked' ? targetCol.unranked : targetCol.ranked;
      var list = listRef.slice();

      // Same-column move: remove ticket from its CURRENT position first.
      // (The ticket might be in either pile of the source column.)
      if (!crossColumn) {
        list = list.filter(function(t) { return t.id !== src.ticketId; });
        // Also remove from the other pile of the same column, in case
        // the drag is pile→pile within the same column.
        if (targetPile === 'ranked') {
          targetCol.unranked = targetCol.unranked.filter(function(t) { return t.id !== src.ticketId; });
        } else {
          targetCol.ranked = targetCol.ranked.filter(function(t) { return t.id !== src.ticketId; });
        }
      }

      var pos = Math.max(0, Math.min(list.length, targetPosition));
      var insertedTicket = Object.assign({}, draggedTicket, { assigned_to: targetUserId });
      list.splice(pos, 0, insertedTicket);

      // Renumber the pile with the right base.
      //   ranked:   1, 2, 3, ...
      //   unranked: 1001, 1002, 1003, ...
      var base = targetPile === 'unranked' ? UNRANKED_FLOOR : 0;
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        var newPriority = base + i + 1;
        if (t.assignee_priority !== newPriority) {
          try {
            await dbUpdate('tickets', t.id, { assignee_priority: newPriority }, currentUserId);
          } catch (_) {}
        }
      }

      // --------------------------------------------------------------
      // RENUMBER THE SOURCE COLUMN (gap closed after removal)
      // Runs for BOTH cross-column AND pile-crossing same-column moves.
      // --------------------------------------------------------------
      if (crossColumn) {
        var srcCol = columns[src.fromUserId];
        if (srcCol) {
          var srcRanked = srcCol.ranked.filter(function(t) { return t.id !== src.ticketId; });
          for (var j = 0; j < srcRanked.length; j++) {
            var newP = j + 1;
            if (srcRanked[j].assignee_priority !== newP) {
              try { await dbUpdate('tickets', srcRanked[j].id, { assignee_priority: newP }, currentUserId); } catch (_) {}
            }
          }
          // Also renumber the source's unranked ordered pile (keep their
          // relative order, fill any gap left by removal).
          var srcUnranked = srcCol.unranked
            .filter(function(t) { return t.id !== src.ticketId; })
            .filter(function(t) { return t.assignee_priority != null && t.assignee_priority >= UNRANKED_FLOOR; });
          for (var k = 0; k < srcUnranked.length; k++) {
            var newUP = UNRANKED_FLOOR + k + 1;
            if (srcUnranked[k].assignee_priority !== newUP) {
              try { await dbUpdate('tickets', srcUnranked[k].id, { assignee_priority: newUP }, currentUserId); } catch (_) {}
            }
          }
        }
      }

      var toastMsg = crossColumn
        ? 'Moved & reassigned ✓'
        : (targetPile === 'unranked' ? 'Unranked order updated ✓' : 'Priority updated ✓');
      showToast(toastMsg);
      if (onReorder) onReorder({ crossColumn: crossColumn, pile: targetPile });
    } catch (err) {
      console.error('[priority-board]', err);
      showToast('Could not save: ' + (err && err.message ? err.message : 'unknown error'));
    } finally {
      setBusy(false);
    }
  }

  // Clear all priority numbers in a column. Only admins or the column owner.
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
          try {
            await dbUpdate('tickets', col.ranked[i].id, { assignee_priority: null }, currentUserId);
          } catch (_) {}
        }
        if (onReorder) onReorder({ cleared: col.ranked.length });
        showToast('Cleared ' + col.ranked.length + ' priority ' + (col.ranked.length === 1 ? 'rank' : 'ranks'));
      } finally {
        setBusy(false);
      }
    })();
  }

  // ---- Rendering helpers -----------------------------------------------

  function renderTicketCard(t, rank) {
    var prio = PRIORITY_BADGE[String(t.priority || 'medium').toLowerCase()] || PRIORITY_BADGE.medium;
    var statusColor = STATUS_COLORS_MINI[t.status] || '#64748b';
    var canDrag = canDragTicket(t);
    var additional = parseAdditional(t);
    return (
      <div
        key={t.id}
        draggable={canDrag}
        onDragStart={canDrag ? function(e) { onDragStart(e, t); } : undefined}
        onDragEnd={onDragEnd}
        onClick={function() { if (onSelectTicket) onSelectTicket(t); }}
        className={'bg-white border border-slate-200 rounded-lg p-2 mb-1.5 hover:shadow-md hover:border-indigo-300 transition select-none ' + (canDrag ? 'cursor-grab' : 'cursor-pointer')}
        title={canDrag ? 'Drag to reorder or move to another column; click to open' : 'Click to open (only people on this ticket can drag)'}
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
        <div className="flex items-center gap-1 mt-1">
          {t.due_date && (
            <div className="text-[9px] text-slate-500">Due {t.due_date}</div>
          )}
          {additional.length > 0 && (
            <div className="text-[9px] text-slate-400 ml-auto" title="Also assigned to others">
              +{additional.length} other{additional.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderDropZone(userId, position, pile) {
    var p = pile || 'ranked';
    var active = dropTarget && dropTarget.userId === userId && dropTarget.position === position && (dropTarget.pile || 'ranked') === p;
    return (
      <div
        onDragOver={function(e) { onDragOverCol(e, userId, position, p); }}
        onDrop={function(e) { onDropCol(e, userId, position, p); }}
        className={'h-2 -my-1 rounded transition ' + (active ? 'h-8 bg-indigo-100 border-2 border-dashed border-indigo-400' : '')}
      />
    );
  }

  // ---- Main render -----------------------------------------------------

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
          Drag within a column to reorder. Drag across columns to reassign — if the new person wasn't on the ticket, they're added automatically.
        </div>
      </div>

      {/* Today strip */}
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

                {/* Unranked pile — clickable "show more/less".
                    S22.8 — Drop zones between cards make the unranked pile
                    also draggable. Tickets dropped here keep the same
                    visual treatment (no rank number) but get a stored order
                    using the UNRANKED_FLOOR+N convention. */}
                {col.unranked.length > 0 && (function() {
                  var isExpanded = !!expandedUnranked[u.id];
                  var shownCount = isExpanded ? col.unranked.length : Math.min(6, col.unranked.length);
                  var hiddenCount = col.unranked.length - shownCount;
                  var shown = col.unranked.slice(0, shownCount);
                  return (
                    <div className="mt-3 pt-2 border-t border-slate-200">
                      <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Unranked ({col.unranked.length})</div>
                      {renderDropZone(u.id, 0, 'unranked')}
                      {shown.map(function(t, idx) {
                        return (
                          <div key={t.id}>
                            {renderTicketCard(t, null)}
                            {renderDropZone(u.id, idx + 1, 'unranked')}
                          </div>
                        );
                      })}
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

                {/* S22.8 — Empty-unranked drop zone.
                    If a column has a ranked pile but no unranked pile yet,
                    the user still needs a way to drop a ticket into the
                    unranked section (e.g. demote a ranked ticket). This
                    zone appears only when ranked has items AND unranked
                    is empty, so there's always a target. */}
                {col.unranked.length === 0 && col.ranked.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-slate-200">
                    <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Unranked (0)</div>
                    <div
                      onDragOver={function(e) { onDragOverCol(e, u.id, 0, 'unranked'); }}
                      onDrop={function(e) { onDropCol(e, u.id, 0, 'unranked'); }}
                      className={'text-center text-[9px] text-slate-400 italic py-3 rounded-lg border-2 border-dashed ' + (dropTarget && dropTarget.userId === u.id && dropTarget.pile === 'unranked' ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200')}>
                      Drop here to demote (unranked)
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
