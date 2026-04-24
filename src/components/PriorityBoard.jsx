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

import { useState, useMemo, useRef } from 'react';
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
  // v52 — priority-number inline edit. Holds the ticket.id currently being
  // edited (null = no edit). User clicks the #N badge → becomes an input;
  // types a number + Enter → reorders the ranked pile to that position.
  var [editingPriorityFor, setEditingPriorityFor] = useState(null);
  var [priorityEditValue, setPriorityEditValue] = useState('');
  // v53 — move-to picker state. null = no picker open; otherwise holds
  // the ticket.id whose picker is currently open. Card on hover shows a
  // small "Move to →" button that opens a dropdown of other users.
  // Clicking a user reassigns the ticket (same effect as dragging there).
  var [moveToPickerFor, setMoveToPickerFor] = useState(null);
  // v52 — horizontal scroll ref for the board strip so the person-picker
  // can scroll a specific column into view.
  var boardStripRef = useRef(null);
  var columnRefs = useRef({}); // user.id → DOM node of that column

  // v53 — EDGE AUTO-SCROLL during drag.
  //
  // Problem v52 didn't solve: to drag a ticket from Omar (col 1) to Sara
  // (col 9), you need Omar visible to GRAB it AND Sara visible to DROP
  // on her. The person-picker jump we built scrolled Sara into view but
  // then the grab source was gone.
  //
  // Fix: while dragging, if the cursor is within EDGE_ZONE of the left
  // or right edge of the scroll container, the board auto-scrolls in
  // that direction. This is how Trello / Asana / Jira handle it.
  //
  // Implementation: pointer position is tracked via `dragover` on the
  // container (dragover fires continuously during HTML5 drag). Scroll
  // is applied via a RAF loop that keeps running as long as we're near
  // an edge. We stop the loop on dragend/drop.
  var edgeScrollRAFRef = useRef(null);
  var edgeScrollSpeedRef = useRef(0); // -N..+N pixels per frame; 0 = not scrolling

  function stopEdgeScroll() {
    if (edgeScrollRAFRef.current) {
      cancelAnimationFrame(edgeScrollRAFRef.current);
      edgeScrollRAFRef.current = null;
    }
    edgeScrollSpeedRef.current = 0;
  }

  function edgeScrollTick() {
    var el = boardStripRef.current;
    if (!el || !edgeScrollSpeedRef.current) {
      edgeScrollRAFRef.current = null;
      return;
    }
    el.scrollLeft += edgeScrollSpeedRef.current;
    edgeScrollRAFRef.current = requestAnimationFrame(edgeScrollTick);
  }

  function handleBoardDragOver(e) {
    if (!dragging) return;
    var el = boardStripRef.current;
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var EDGE_ZONE = 80; // px from edge that triggers scrolling
    var MAX_SPEED = 18; // px per frame at full speed
    var x = e.clientX;
    var speed = 0;
    if (x < rect.left + EDGE_ZONE) {
      // Near left edge → scroll left. Closer = faster.
      var leftT = 1 - (x - rect.left) / EDGE_ZONE; // 0..1
      speed = -Math.max(4, Math.round(leftT * MAX_SPEED));
    } else if (x > rect.right - EDGE_ZONE) {
      var rightT = 1 - (rect.right - x) / EDGE_ZONE;
      speed = Math.max(4, Math.round(rightT * MAX_SPEED));
    }
    edgeScrollSpeedRef.current = speed;
    if (speed !== 0 && !edgeScrollRAFRef.current) {
      edgeScrollRAFRef.current = requestAnimationFrame(edgeScrollTick);
    } else if (speed === 0) {
      stopEdgeScroll();
    }
  }
  // Per-column expand/collapse state for the Unranked pile.
  var [expandedUnranked, setExpandedUnranked] = useState({});
  // S22.14 (Apr 24 2026) — Inline quick-create for a new ticket assigned
  // directly to a team member from their board column. Max: "team members
  // who have no tickets on priority, I need to have the ability to add a
  // ticket to those that don't have tickets." Available to admins for any
  // user, and to a user themselves (self-assign is always allowed).
  var [quickCreateFor, setQuickCreateFor] = useState(null);  // user.id or null
  var [quickCreateForm, setQuickCreateForm] = useState({
    title: '', description: '', priority: 'Medium', dueDate: ''
  });

  function showToast(msg) {
    setToastMsg(msg);
    setTimeout(function() { setToastMsg(''); }, 2800);
  }

  // S22.14 — Quick-create a ticket assigned to a specific user.
  // Mirrors the same insert shape the TicketsTab form uses so the new
  // row shows up correctly in the main tickets list too.
  async function saveQuickTicket() {
    if (busy) return;
    var uid = quickCreateFor;
    var f = quickCreateForm;
    if (!uid) return;
    if (!f.title || !f.title.trim()) {
      showToast('Please enter a title');
      return;
    }
    setBusy(true);
    try {
      // Generate a ticket number mirroring the main form style.
      // Format: TKT-YYYYMMDD-HHMM-<4 random>. Uniqueness is a soft
      // property; collisions are astronomically unlikely.
      var now = new Date();
      var pad = function(n) { return n < 10 ? '0' + n : String(n); };
      var stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate())
        + '-' + pad(now.getHours()) + pad(now.getMinutes());
      var rand = Math.random().toString(36).substring(2, 6).toUpperCase();
      var ticketNum = 'TKT-' + stamp + '-' + rand;

      var newTicket = await dbInsert('tickets', {
        ticket_number: ticketNum,
        title: f.title.trim(),
        description: (f.description || '').trim(),
        priority: f.priority || 'Medium',
        due_date: f.dueDate || null,
        status: 'New',
        assigned_to: uid,
        created_by: currentUserId || null,
      }, currentUserId || null);

      try { await logActivity(currentUserId, 'Created ticket from Priority Board: ' + f.title.trim(), 'ticket'); } catch (_) {}

      // Reset form + close inline editor
      setQuickCreateFor(null);
      setQuickCreateForm({ title: '', description: '', priority: 'Medium', dueDate: '' });
      showToast('Ticket created ✓');
      if (onReorder) onReorder({ created: true });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('[priority-board][quick-create]', err);
      showToast('Could not create: ' + (err && err.message ? err.message : 'unknown error'));
    } finally {
      setBusy(false);
    }
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
    // v52 — flag so drop zones become visible everywhere on the board.
    try { window.__priorityBoardDragging = true; } catch (_) {}
  }

  function onDragEnd() {
    setDragging(null);
    setDropTarget(null);
    try { window.__priorityBoardDragging = false; } catch (_) {}
    stopEdgeScroll();
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

  // v53 — reassign via click (no drag). Click-to-move picker on each card
  // calls this. Reuses the existing onDropCol machinery by constructing a
  // synthetic drag state and simulating a drop at the END of the target's
  // unranked pile. No event object needed because onDropCol only uses
  // e.preventDefault(), which we stub.
  async function reassignTicketTo(ticket, targetUserId) {
    if (!ticket || !targetUserId) return;
    if (ticket.assigned_to === targetUserId) {
      showToast('Already assigned to that person.');
      return;
    }
    if (!canDragTicket(ticket)) {
      showToast('Only people on this ticket can move it.');
      return;
    }
    // Close the picker immediately so the UI feels responsive.
    setMoveToPickerFor(null);
    // Prime the drag state so onDropCol sees a valid source.
    setDragging({ ticketId: ticket.id, fromUserId: ticket.assigned_to });
    // Give React a tick to apply state, then simulate the drop at end of
    // the target's unranked pile.
    setTimeout(function() {
      var targetCol = columns[targetUserId] || { ranked: [], unranked: [] };
      var targetPosition = (targetCol.unranked && targetCol.unranked.length) || 0;
      var fakeEvent = { preventDefault: function() {} };
      onDropCol(fakeEvent, targetUserId, targetPosition, 'unranked');
    }, 0);
  }

  // v52 — set a ticket's priority by typed number. User clicks the #N
  // badge → types a number + Enter. The ranked pile re-sequences to place
  // the ticket at that rank (clamped to 1..N+1 where N is current pile length).
  // Other tickets shift to maintain sequential numbering (no gaps).
  function setPriorityByNumber(ticket, newRank) {
    if (!canDragTicket(ticket)) {
      showToast('Only people on this ticket can rank it.');
      return;
    }
    var userId = ticket.assigned_to;
    var col = columns[userId] || { ranked: [], unranked: [] };
    // Build fresh list without the ticket, insert it at the new position.
    var others = col.ranked.filter(function(t) { return t.id !== ticket.id; });
    var pos = Math.max(0, Math.min(others.length, newRank - 1));
    var list = others.slice();
    list.splice(pos, 0, ticket);
    setBusy(true);
    (async function() {
      try {
        // If the ticket was in the unranked pile, clear its unranked number first.
        // Then write the new ranked priorities for the whole pile.
        for (var i = 0; i < list.length; i++) {
          var newP = i + 1;
          if (list[i].assignee_priority !== newP) {
            try { await dbUpdate('tickets', list[i].id, { assignee_priority: newP }, currentUserId); } catch (_) {}
          }
        }
        if (onReorder) onReorder({ typedPriority: newRank });
        showToast('Priority set to #' + newRank);
      } finally {
        setBusy(false);
      }
    })();
  }

  // v52 — star toggle for "today's focus". Max can mark tickets as things
  // he's committed to working on today. Nadia checks these at 5pm Eastern
  // and nudges about any that aren't closed. Manual remove only — no
  // midnight auto-clear per Max's spec.
  function toggleStar(ticket) {
    if (!canDragTicket(ticket)) {
      showToast('Only people on this ticket can star it.');
      return;
    }
    var newStarred = !ticket.starred_today;
    (async function() {
      try {
        await dbUpdate('tickets', ticket.id, {
          starred_today: newStarred,
          starred_at: newStarred ? new Date().toISOString() : null
        }, currentUserId);
        showToast(newStarred ? '⭐ Starred for today' : 'Star removed');
        if (onReorder) onReorder({ starred: newStarred });
      } catch (e) {
        showToast('Star failed: ' + (e && e.message ? e.message : 'unknown'));
      }
    })();
  }

  // ---- Rendering helpers -----------------------------------------------

  function renderTicketCard(t, rank) {
    var prio = PRIORITY_BADGE[String(t.priority || 'medium').toLowerCase()] || PRIORITY_BADGE.medium;
    var statusColor = STATUS_COLORS_MINI[t.status] || '#64748b';
    var canDrag = canDragTicket(t);
    var additional = parseAdditional(t);
    var isStarred = !!t.starred_today;
    // v52 — starred cards get an amber glow so they stand out at a glance.
    var starredCls = isStarred ? 'bg-gradient-to-br from-amber-50 to-white border-amber-300 shadow-amber-100 shadow-md' : 'bg-white border-slate-200';
    var isEditingPrio = editingPriorityFor === t.id;
    return (
      <div
        key={t.id}
        draggable={canDrag && !isEditingPrio}
        onDragStart={canDrag ? function(e) { onDragStart(e, t); } : undefined}
        onDragEnd={onDragEnd}
        onClick={function() { if (!isEditingPrio && onSelectTicket) onSelectTicket(t); }}
        className={'group relative border rounded-lg p-2 mb-1.5 hover:shadow-md hover:border-indigo-300 transition select-none ' + starredCls + ' ' + (canDrag && !isEditingPrio ? 'cursor-grab' : 'cursor-pointer')}
        title={canDrag ? 'Drag to reorder or move to another column; click to open' : 'Click to open (only people on this ticket can drag)'}
      >
        <div className="flex items-center gap-1.5 mb-1">
          {rank != null && !isEditingPrio && canDrag && (
            <button
              onClick={function(e) {
                e.stopPropagation();
                setEditingPriorityFor(t.id);
                setPriorityEditValue(String(rank));
              }}
              className="text-[10px] font-extrabold bg-indigo-600 hover:bg-indigo-700 text-white rounded-full w-5 h-5 flex items-center justify-center"
              title="Click to type a priority number"
            >
              {rank}
            </button>
          )}
          {rank != null && !canDrag && (
            <span className="text-[10px] font-extrabold bg-indigo-600 text-white rounded-full w-5 h-5 flex items-center justify-center">
              {rank}
            </span>
          )}
          {isEditingPrio && (
            <input
              type="number"
              min="1"
              autoFocus
              value={priorityEditValue}
              onChange={function(e) { setPriorityEditValue(e.target.value); }}
              onClick={function(e) { e.stopPropagation(); }}
              onKeyDown={function(e) {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  var newRank = parseInt(priorityEditValue, 10);
                  setEditingPriorityFor(null);
                  if (!isNaN(newRank) && newRank > 0) {
                    setPriorityByNumber(t, newRank);
                  }
                } else if (e.key === 'Escape') {
                  setEditingPriorityFor(null);
                }
              }}
              onBlur={function() { setEditingPriorityFor(null); }}
              className="text-[10px] font-extrabold bg-white border border-indigo-500 rounded w-10 h-5 px-1 text-center"
            />
          )}
          {/* v52 — star toggle for "working on this today". Visible to
              admins and to the user themselves. Starred tickets have an
              amber glow AND are counted in the Today strip + picker badges. */}
          {(canDrag || isAdmin) && (
            <button
              onClick={function(e) { e.stopPropagation(); toggleStar(t); }}
              className={'text-[14px] leading-none transition hover:scale-125 ' + (isStarred ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400')}
              title={isStarred ? 'Remove from today\'s focus' : 'Mark as today\'s focus — Nadia will check on it at end of day'}
            >
              {isStarred ? '⭐' : '☆'}
            </button>
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
        {/* v53 — MOVE TO PICKER. Button shown on card hover (opacity-0 →
            hover opens). Clicking opens a mini dropdown with all other
            team members; clicking a name reassigns the ticket to them
            (same effect as dragging). Solves the problem where the
            target person was scrolled off-screen during drag. */}
        {canDrag && (users || []).length > 1 && (
          <div className="relative mt-1 pt-1 border-t border-slate-100 opacity-0 group-hover:opacity-100 transition">
            <button
              onClick={function(e) {
                e.stopPropagation();
                setMoveToPickerFor(moveToPickerFor === t.id ? null : t.id);
              }}
              className="w-full text-[9px] text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded py-0.5 transition"
              title="Reassign to someone else without dragging"
            >
              {moveToPickerFor === t.id ? 'Close ▲' : 'Move to → ▾'}
            </button>
            {moveToPickerFor === t.id && (
              <div
                onClick={function(e) { e.stopPropagation(); }}
                className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto"
              >
                {(users || []).filter(function(u) { return u.id !== t.assigned_to; }).map(function(u) {
                  var ini = (u.name || '?').split(' ').map(function(p) { return p[0]; }).filter(Boolean).slice(0, 2).join('').toUpperCase();
                  return (
                    <button key={u.id}
                      onClick={function(e) {
                        e.stopPropagation();
                        reassignTicketTo(t, u.id);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold hover:bg-indigo-50 text-left transition"
                    >
                      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                        {ini}
                      </span>
                      <span className="truncate">{u.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderDropZone(userId, position, pile) {
    var p = pile || 'ranked';
    var active = dropTarget && dropTarget.userId === userId && dropTarget.position === position && (dropTarget.pile || 'ranked') === p;
    // v52 — much larger target. While ANY drag is in progress, drop zones
    // become visible (dashed indigo outline) so the user can see where to
    // drop. The active zone (hovering directly) is bigger still.
    // Previous h-2 (8px) was nearly impossible to hit on touch or
    // imprecise mouse.
    var dragging = !!window.__priorityBoardDragging;
    var cls;
    if (active) {
      cls = 'h-10 bg-indigo-100 border-2 border-dashed border-indigo-500 my-1 rounded-lg';
    } else if (dragging) {
      cls = 'h-6 border border-dashed border-indigo-300 my-0.5 rounded opacity-60 hover:opacity-100 hover:h-8 transition-all';
    } else {
      cls = 'h-3 -my-0.5 rounded transition';
    }
    return (
      <div
        onDragOver={function(e) { onDragOverCol(e, userId, position, p); }}
        onDrop={function(e) { onDropCol(e, userId, position, p); }}
        className={cls}
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
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            📋 Priority Board
          </div>
          {/* v52 — person-picker. Compact row of name chips; click to scroll
              the horizontal board strip to that person's column. Without this
              users had to horizontally scroll-search to find e.g. Omar when he
              was 6 columns to the right. */}
          {(users || []).length > 3 && (
            <div className="flex items-center gap-1 overflow-x-auto max-w-[60%] pb-1">
              <span className="text-[9px] text-slate-400 flex-shrink-0 mr-1">Jump to:</span>
              {(users || []).map(function(u) {
                var col = columns[u.id] || { ranked: [], unranked: [] };
                var starredCount = (col.ranked.concat(col.unranked) || []).filter(function(t) { return t && t.starred_today; }).length;
                var firstName = (u.name || '?').split(' ')[0] || u.name;
                return (
                  <button key={u.id}
                    onClick={function() {
                      var node = columnRefs.current[u.id];
                      if (node && node.scrollIntoView) {
                        node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                      }
                    }}
                    className="flex-shrink-0 px-2 py-1 rounded-full text-[10px] font-semibold bg-white border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 transition flex items-center gap-1"
                    title={'Jump to ' + u.name}>
                    <span>{firstName}</span>
                    {starredCount > 0 && <span className="text-amber-500">⭐{starredCount}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div ref={boardStripRef}
          className="flex gap-3 overflow-x-auto pb-3"
          style={{ scrollSnapType: 'x mandatory' }}
          onDragOver={handleBoardDragOver}
          onDragLeave={stopEdgeScroll}
          onDrop={stopEdgeScroll}
        >
          {(users || []).map(function(u) {
            var col = columns[u.id] || { ranked: [], unranked: [] };
            var total = col.ranked.length + col.unranked.length;
            var initials = (u.name || '?').split(' ').map(function(p) { return p[0]; }).filter(Boolean).slice(0, 2).join('').toUpperCase();
            return (
              <div key={u.id}
                ref={function(el) { if (el) columnRefs.current[u.id] = el; }}
                className="flex-shrink-0 w-64 bg-slate-50 rounded-xl p-2.5"
                style={{ scrollSnapAlign: 'start', scrollMarginLeft: 12 }}>
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
                  // S22.14 — Empty state now gives a direct "+ Add ticket"
                  // button when the column is completely empty. Previously
                  // the label said "create one below ↓" but the button was
                  // a separate footer that users missed. Now the empty
                  // drop zone IS the add-ticket affordance.
                  <div
                    onDragOver={function(e) { onDragOverCol(e, u.id, 0); }}
                    onDrop={function(e) { onDropCol(e, u.id, 0); }}
                    className={'text-center py-6 rounded-lg border-2 border-dashed ' + (dropTarget && dropTarget.userId === u.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200')}>
                    {total === 0 ? (
                      <div>
                        <div className="text-[10px] text-slate-400 italic mb-2">
                          {((u.name || '').split(' ')[0] || 'They')} has no tickets
                        </div>
                        {(isAdmin || u.id === currentUserId) && quickCreateFor !== u.id && (
                          <button
                            onClick={function() {
                              setQuickCreateFor(u.id);
                              setQuickCreateForm({ title: '', description: '', priority: 'Medium', dueDate: '' });
                            }}
                            className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold rounded-md shadow-sm">
                            + Add first ticket
                          </button>
                        )}
                        {!(isAdmin || u.id === currentUserId) && (
                          <div className="text-[9px] text-slate-400">
                            Only {u.name || 'they'} or an admin can create tickets for this person
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-400 italic">Drop a ticket here to prioritize</div>
                    )}
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

                {/* S22.14 — Quick-create new ticket for this person.
                    Available to admins (can assign to anyone) and to the
                    user themselves (self-assign). Small footer button
                    that expands into an inline form. */}
                {(isAdmin || u.id === currentUserId) && (
                  <div className="mt-3 pt-2 border-t border-slate-200">
                    {quickCreateFor !== u.id ? (
                      <button
                        onClick={function() {
                          setQuickCreateFor(u.id);
                          setQuickCreateForm({ title: '', description: '', priority: 'Medium', dueDate: '' });
                        }}
                        className="w-full py-1.5 text-[10px] font-bold text-emerald-700 border border-dashed border-emerald-300 rounded hover:bg-emerald-50 hover:border-emerald-500 transition"
                        title={'Create a new ticket assigned to ' + (u.name || 'this person')}>
                        + New ticket for {(u.name || '').split(' ')[0] || 'them'}
                      </button>
                    ) : (
                      <div className="bg-white border border-emerald-300 rounded-lg p-2 space-y-1.5 shadow-sm">
                        <div className="text-[10px] font-bold text-emerald-700">New ticket for {u.name || 'user'}</div>
                        <input
                          autoFocus
                          type="text"
                          placeholder="Title (required)"
                          value={quickCreateForm.title}
                          onChange={function(e) {
                            var v = e.target.value;
                            setQuickCreateForm(function(prev) { return Object.assign({}, prev, { title: v }); });
                          }}
                          onKeyDown={function(e) {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveQuickTicket(); }
                            if (e.key === 'Escape') { setQuickCreateFor(null); }
                          }}
                          className="w-full px-2 py-1 text-xs rounded border border-slate-200 focus:border-emerald-500 focus:outline-none"
                        />
                        <textarea
                          placeholder="Description (optional)"
                          value={quickCreateForm.description}
                          onChange={function(e) {
                            var v = e.target.value;
                            setQuickCreateForm(function(prev) { return Object.assign({}, prev, { description: v }); });
                          }}
                          rows={2}
                          className="w-full px-2 py-1 text-[11px] rounded border border-slate-200 focus:border-emerald-500 focus:outline-none resize-none"
                        />
                        <div className="flex gap-1.5">
                          <select
                            value={quickCreateForm.priority}
                            onChange={function(e) {
                              var v = e.target.value;
                              setQuickCreateForm(function(prev) { return Object.assign({}, prev, { priority: v }); });
                            }}
                            className="flex-1 px-1.5 py-1 text-[10px] rounded border border-slate-200">
                            <option value="Low">Low</option>
                            <option value="Medium">Medium</option>
                            <option value="High">High</option>
                            <option value="Urgent">Urgent</option>
                          </select>
                          <input
                            type="date"
                            value={quickCreateForm.dueDate}
                            onChange={function(e) {
                              var v = e.target.value;
                              setQuickCreateForm(function(prev) { return Object.assign({}, prev, { dueDate: v }); });
                            }}
                            className="flex-1 px-1.5 py-1 text-[10px] rounded border border-slate-200"
                            title="Due date (optional)"
                          />
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={saveQuickTicket}
                            disabled={busy || !quickCreateForm.title.trim()}
                            className="flex-1 py-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-[10px] font-bold">
                            {busy ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={function() { setQuickCreateFor(null); }}
                            className="px-2 py-1 rounded border border-slate-200 text-slate-600 text-[10px] hover:bg-slate-50">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
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
