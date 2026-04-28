'use client';
import { useState, useMemo, useEffect, useContext } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { notifyEventScheduled } from '../lib/notify';
import { newUUID, VALID_PATTERNS } from '../lib/recurrence';
import { scheduleEventReminders, rescheduleEventReminders, cancelEventReminders } from '../lib/reminders';
import { ToastContext } from '../lib/toast-context';

const EVENT_TYPES = [{v:'task',l:'Task / مهمة',c:'#3b82f6'},{v:'meeting',l:'Meeting / اجتماع',c:'#8b5cf6'},{v:'call',l:'Call / مكالمة',c:'#f59e0b'},{v:'visit',l:'Visit / زيارة',c:'#10b981'}];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// Human label for "every N of unit" shown on the event chip.
function recurrenceLabel(pattern, interval) {
  const n = Number.isFinite(+interval) && +interval >= 1 ? +interval : 1;
  if (pattern === 'daily')    return n === 1 ? 'Daily'    : 'Every ' + n + ' days';
  if (pattern === 'weekly')   return n === 1 ? 'Weekly'   : 'Every ' + n + ' weeks';
  if (pattern === 'biweekly') return n === 1 ? 'Biweekly' : 'Every ' + (n*2) + ' weeks';
  if (pattern === 'monthly')  return n === 1 ? 'Monthly'  : 'Every ' + n + ' months';
  return '';
}

export default function CalendarTab({ customers, user, userProfile, users, tickets, onOpenTicket, onReload, onRefresh: onRefreshProp }) {
  // v55.25 — Two long-standing bugs that made cancel/delete look broken:
  //
  //   (1) `toast` was referenced throughout this file but never declared
  //       or destructured. Every `if (toast) toast.error(...)` silently
  //       no-op'd, leaving the user with NO feedback when permission
  //       denied them or when an action succeeded. We now consume
  //       ToastContext properly so toasts actually fire.
  //
  //   (2) page.jsx passed `onReload`, but this file's code called
  //       `onRefresh`. Result: the cancel/delete DB write succeeded,
  //       but the calendar grid never re-fetched, so the cancelled
  //       event still appeared "live" on screen — looking exactly like
  //       "nothing happened." We accept either prop name and unify them.
  const toast = useContext(ToastContext);
  const onRefresh = onRefreshProp || onReload;
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('month');
  const [curDate, setCurDate] = useState(new Date());
  const [selDate, setSelDate] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({});
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [calView, setCalView] = useState('my');
  const [notesEvent, setNotesEvent] = useState(null);
  const [meetingNotes, setMeetingNotes] = useState(''); // draft for new note being typed
  // Multi-note thread state. An array of note rows from meeting_notes table,
  // sorted oldest-first so the conversation reads top-to-bottom.
  const [notesThread, setNotesThread] = useState([]);
  const [notesThreadLoading, setNotesThreadLoading] = useState(false);
  const [notesPosting, setNotesPosting] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteDraft, setEditingNoteDraft] = useState('');
  const [newNoteKind, setNewNoteKind] = useState('note'); // 'note' | 'action_item' | 'decision'
  // R1/R2: editing an existing event (basic: title, date, time). Null = not editing.
  const [editEvent, setEditEvent] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editScope, setEditScope] = useState('single'); // 'single' | 'series'
  // v55.22 — In-modal cancel/delete confirmation flow.
  //
  // Background: cancelMeeting and deleteMeeting used window.prompt() and
  // window.confirm() for the reason/confirmation step. Modern Chromium
  // SILENTLY SUPPRESSES those dialogs after the user dismisses them too
  // many times in a session — they return null/false with no UI shown.
  // Symptom: Max clicks "Cancel meeting" → nothing happens. He's been
  // reporting this for multiple iterations and the cause was the browser,
  // not our code.
  //
  // Fix: replace prompt+confirm with an in-app inline form that lives
  // INSIDE the existing edit-event modal. State machine:
  //   actionStage = 'idle'    — show normal Cancel / Delete buttons
  //                'cancel'   — show "Cancel? type optional reason + Confirm"
  //                'delete'   — show "Type DELETE to confirm hard-delete"
  // The user always sees real UI; no browser dialog can be hidden.
  const [actionStage, setActionStage] = useState('idle');
  const [actionReason, setActionReason] = useState('');
  const [actionTyped, setActionTyped] = useState(''); // for delete confirm
  const [actionBusy, setActionBusy] = useState(false);
  const myId = userProfile?.id;
  // v54.6 — `lang` was referenced throughout this file (28+ times) but
  // never declared. ANY click that triggered a path using `lang === 'ar'`
  // crashed with "ReferenceError: lang is not defined". Reading it from
  // userProfile.preferred_language with safe fallback to English.
  const lang = (userProfile && userProfile.preferred_language === 'ar') ? 'ar' : 'en';

  const loadEvents = async () => {
    const { data } = await supabase.from('calendar_events').select('*').order('event_date');
    setEvents(data || []);
    setLoaded(true);
  };

  // Load once on mount. Previously called inline `if (!loaded) loadEvents()` in the
  // render body — that fires on EVERY render until the async resolves and updates
  // `loaded`, producing a burst of redundant network calls. useEffect fires once.
  useEffect(() => { loadEvents(); }, []);

  // Client-side fallback for the reminder dispatcher. If Vercel cron tier throttles
  // to daily-only, the dispatcher still fires whenever ANY team member opens the
  // Calendar. Fire-and-forget. Runs at most once per mount.
  useEffect(() => {
    try {
      fetch('/api/reminders/dispatch', { method: 'GET' }).catch(() => {});
    } catch (e) { /* swallow — cosmetic */ }
  }, []);

  const year = curDate.getFullYear();
  const month = curDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const todayStr = new Date().toISOString().substring(0, 10);

  // ============================================================
  // Ticket due-dates as calendar entries
  // ============================================================
  // Every ticket with a due_date AND non-terminal status gets rendered as
  // a pseudo-event on the calendar. We DON'T write these to calendar_events
  // — they stay synthesized at render time, so when someone edits the
  // ticket's due date, the calendar updates instantly without a sync job.
  //
  // The pseudo-event carries `_ticket: true` and the original ticket so the
  // UI can:
  //   1. style it differently (dashed border, priority color)
  //   2. disable event-only affordances (check-in, postpone, edit)
  //   3. make the card click jump to the ticket
  const ticketEvents = useMemo(() => {
    if (!Array.isArray(tickets)) return [];
    var priColor = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };
    return tickets
      .filter(function(t) {
        if (!t.due_date) return false;
        // Unassigned tickets don't render on calendars — avoids orphan chips
        // on team view. They still show in TicketsTab where they can be
        // assigned.
        if (!t.assigned_to) return false;
        // Skip done/closed tickets — due date is no longer actionable
        var terminal = ['Closed', 'Resolved', 'Fixed'];
        return terminal.indexOf(t.status) === -1;
      })
      .map(function(t) {
        return {
          // Render-compatible shape so existing event views don't branch
          id: 'tkt-' + t.id,
          _ticket: true,
          _ticket_id: t.id,
          title: (t.ticket_number ? '[' + t.ticket_number + '] ' : '') + (t.title || 'Ticket'),
          event_date: t.due_date,
          event_time: null,
          event_type: 'task',
          _ticket_priority: t.priority || 'medium',
          _ticket_color: priColor[t.priority] || priColor.medium,
          assigned_to: t.assigned_to || null,
          created_by: t.created_by || null,
          completed: false,
          notes_count: 0,
          // For sorting stability
          _sort_key: 'zzz' + t.id, // sort ticket pseudo-events AFTER real events on same day
        };
      });
  }, [tickets]);

  // Merge ticket pseudo-events into the main events stream. Kept as a
  // separate useMemo so downstream filters (visibleEvents) see a single
  // unified array.
  var allEvents = useMemo(function() {
    return (events || []).concat(ticketEvents);
  }, [events, ticketEvents]);

  // Filter events based on calView.
  // Real events: "my" = assigned OR created by me (either connection to me matters).
  // Ticket pseudo-events: "my" = assigned to me ONLY. A ticket creator who
  // handed the work off shouldn't see their own past tickets cluttering
  // their personal calendar — the assignee owns the due-date.
  const visibleEvents = useMemo(() => {
    if (calView === 'my') {
      return allEvents.filter(function(e) {
        if (e._ticket) return e.assigned_to === myId;
        // v54.1 — include multi-attendee meetings where the user is in
        // the attendees list. An event with attendees=[uid1, uid2, uid3]
        // shows on ALL three people's "My calendar" views.
        var inAttendees = Array.isArray(e.attendees) && e.attendees.indexOf(myId) !== -1;
        return e.assigned_to === myId || e.created_by === myId || inAttendees;
      });
    }
    return allEvents; // team view shows all
  }, [allEvents, calView, user, myId]);

  const dayEvents = (day) => {
    const ds = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    return visibleEvents.filter(e => e.event_date === ds);
  };

  const selectedDayEvents = selDate ? visibleEvents.filter(e => e.event_date === selDate) : [];

  const prevMonth = () => setCurDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurDate(new Date(year, month + 1, 1));

  const toggleUser = (uid) => {
    setSelectedUsers(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
  };

  const selectAllUsers = () => {
    if (!users) return;
    setSelectedUsers(users.map(u => u.id));
  };

  // S20.1 (Apr 23 2026) — Hardened save flow. Previously:
  //   - Silent return on missing title/date
  //   - Fire-and-forget occurrence generator (future dates might not
  //     appear for a while, making it feel like the save didn't work)
  //   - No "Saving..." state, no success confirmation
  // Max reported creating a weekly Saturday meeting till end of year
  // with 3 participants and nothing saved. This path addresses all of
  // those failure modes at once.
  const [saving, setSaving] = useState(false);
  const handleAddEvent = async () => {
    // Visible validation — never silent-fail
    if (!f.title || !f.title.trim()) {
      alert('Please enter a title for the event.');
      return;
    }
    if (!f.eventDate) {
      alert('Please pick a date for the event.');
      return;
    }
    // If the user asked for recurrence with no end date, we still let it save
    // but warn — otherwise the series will repeat indefinitely.
    if (f.recurring && f.recurring !== 'none' && !f.recurringEnd) {
      if (!confirm('This event is set to repeat but has no end date — it will go on forever. Continue?')) {
        return;
      }
    }
    if (saving) return; // guard against double-click
    setSaving(true);
    try {
      const assignees = selectedUsers.length > 0 ? selectedUsers : [myId];
      const pattern = f.recurring || 'none';
      const isRecurring = pattern !== 'none';
      const rawInt = Number.isFinite(+f.recurringInterval) ? Math.floor(+f.recurringInterval) : 1;
      const interval = Math.min(99, Math.max(1, rawInt || 1));

      // v54.1 — ONE event, multiple attendees. Previous behavior created
      // N separate rows (one per invitee), which meant the creator saw
      // the meeting twice if they also invited themselves, and
      // cancellation had to be repeated for each copy. Now: one row with
      // attendees = [uid1, uid2, ...]. Everyone invited sees it.
      //
      // `assigned_to` stays as the first attendee (usually the creator)
      // so legacy queries and the assignee-based reminder system keep
      // working. `attendees` is authoritative for "who's on this meeting".
      const attendees = Array.from(new Set(assignees)); // dedupe
      const ownerUid = attendees[0];

      const createdIds = [];
      const seriesIdsToExpand = [];
      const payload = {
        title: f.title,
        description: f.description || null,
        event_date: f.eventDate,
        // v55 Stage 1 — when all-day is on, event_time MUST be null. Both
        // the form's time input is disabled and we belt-and-suspenders here
        // so a stray value can't slip through.
        event_time: f.allDay ? null : (f.eventTime || null),
        event_type: f.eventType || 'task',
        // v55 Stage 1 — three new optional fields. Empty strings stored as null
        // so the DB doesn't fill up with '' values that look meaningful.
        location: (f.location && f.location.trim()) ? f.location.trim() : null,
        join_link: (f.joinLink && f.joinLink.trim()) ? f.joinLink.trim() : null,
        all_day: !!f.allDay,
        assigned_to: ownerUid,                // primary owner (first attendee)
        attendees: attendees,                 // ALL invited users
        customer_id: f.customerId || null,
        recurring: pattern,
        recurring_end: f.recurringEnd || null,
        recurrence_interval: isRecurring ? interval : null,
        series_id: isRecurring ? newUUID() : null,
        is_series_master: isRecurring,
        // S22.6 (Apr 23 2026) — Explicitly set created_by. Without this,
        // when Max assigned a weekly recurring event to someone else, his
        // "My" view filter (assigned_to === myId || created_by === myId)
        // matched neither field, so the event was invisible on his
        // calendar even though it saved correctly.
        created_by: myId,
      };
      const row = await dbInsert('calendar_events', payload, myId);
      createdIds.push(row);

      // Reminders go to ALL attendees (each gets their own reminder)
      try {
        await scheduleEventReminders(row, attendees, myId);
      } catch (e) { console.log('[calendar] scheduleEventReminders failed: ' + e.message); }

      if (isRecurring && row.series_id) {
        seriesIdsToExpand.push(row.series_id);
      }

      // S20.1 — AWAIT the occurrence generator (previously fire-and-forget).
      // This is what makes "save a weekly meeting till end of year" actually
      // create all the Saturdays up front, so Max sees them immediately.
      // If the generator hits an error we still consider the save successful
      // (master events are already in the DB) but we tell the user.
      let occurrencesGenerated = 0;
      let generatorFailed = false;
      for (const series_id of seriesIdsToExpand) {
        try {
          const r = await fetch('/api/events/generate-occurrences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ series_id }),
          });
          if (r.ok) {
            try {
              const j = await r.json();
              if (typeof j?.inserted === 'number') occurrencesGenerated += j.inserted;
            } catch (_) {}
          } else {
            generatorFailed = true;
          }
        } catch (e) {
          generatorFailed = true;
          console.log('[calendar] generate-occurrences failed: ' + e.message);
        }
      }

      await logActivity(myId, 'Created ' + (f.eventType || 'task') + ': ' + f.title + ' on ' + f.eventDate
        + (isRecurring ? ' (' + recurrenceLabel(pattern, interval) + ')' : ''), 'calendar');
      const otherAssignees = assignees.filter(uid => uid !== myId);
      if (otherAssignees.length) notifyEventScheduled(otherAssignees, f.title, f.eventDate, myId);

      // Reset form, hide modal
      setShowAdd(false); setF({}); setSelectedUsers([]);

      // Refresh list now that occurrences exist
      await loadEvents();

      // S22.6 (Apr 23 2026) — Navigate the calendar to the event's date
      // so the user sees their freshly-saved event immediately. Without
      // this, saving an event for "next Saturday" (which might be in the
      // next month) left Max looking at the current month wondering where
      // it went — even though it saved fine.
      try {
        var dateParts = String(f.eventDate).split('-');
        if (dateParts.length === 3) {
          var y = parseInt(dateParts[0], 10);
          var m = parseInt(dateParts[1], 10) - 1;
          var d = parseInt(dateParts[2], 10);
          if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
            setCurDate(new Date(y, m, 1));
            setSelDate(f.eventDate);
          }
        }
      } catch (_) { /* navigation is best-effort */ }

      // User-visible success confirmation so Max knows it saved
      const parts = [];
      parts.push('✅ Saved "' + f.title + '" on ' + f.eventDate);
      if (assignees.length > 1) parts.push(' for ' + assignees.length + ' people');
      if (isRecurring) {
        parts.push(' — ' + recurrenceLabel(pattern, interval));
        if (f.recurringEnd) parts.push(' until ' + f.recurringEnd);
        if (occurrencesGenerated > 0) parts.push(' (' + occurrencesGenerated + ' occurrences created)');
        if (generatorFailed) parts.push('\n\n⚠️ Occurrences couldn\'t be expanded right now — the scheduler will create them overnight.');
      }
      alert(parts.join(''));
    } catch (err) {
      alert('❌ Could not save: ' + (err && err.message ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  const markEventStatus = async (ev, status) => {
    try {
      await dbUpdate('calendar_events', ev.id, { completed: status === 'attended', event_status: status }, myId);
      var logText = (ev.event_type || 'Event') + ' "' + ev.title + '" — ' + status;
      await logActivity(myId, logText, 'calendar');
      // If attended/cancelled, no more reminders for this occurrence
      if (status === 'attended' || status === 'cancelled') {
        try { await cancelEventReminders(ev.id); } catch (e) { /* swallow */ }
      }
      loadEvents();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const completeEvent = async (ev) => {
    try {
      await dbUpdate('calendar_events', ev.id, { completed: true, event_status: 'attended' }, myId);
      await logActivity(myId, 'Attended ' + (ev.event_type || 'event') + ': ' + ev.title, 'calendar');
      try { await cancelEventReminders(ev.id); } catch (e) { /* swallow */ }
      loadEvents();
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  // ============================================================
  // Meeting notes thread
  // ============================================================
  // Load all notes for an event, oldest first. Called when the modal opens.
  // We also re-fetch after each post/edit/delete to keep the thread honest
  // rather than relying on optimistic updates that could drift from DB.
  const loadNotesThread = async (eventId) => {
    if (!eventId) return;
    setNotesThreadLoading(true);
    try {
      const { data, error } = await supabase
        .from('meeting_notes')
        .select('id, event_id, author_id, note_text, note_kind, is_completed, completed_at, completed_by, created_at, updated_at')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setNotesThread(data || []);
    } catch (err) {
      // Likely means the migration hasn't been run yet — fall back gracefully
      // to showing the legacy single note as a read-only pseudo-row.
      console.warn('meeting_notes table not reachable:', err.message);
      if (notesEvent && notesEvent.meeting_notes) {
        setNotesThread([{
          id: 'legacy', event_id: eventId, author_id: notesEvent.checked_in_by,
          note_text: notesEvent.meeting_notes, note_kind: 'note',
          is_completed: false, created_at: notesEvent.checked_in_at || notesEvent.updated_at || notesEvent.created_at,
          updated_at: notesEvent.updated_at, _legacy: true,
        }]);
      } else {
        setNotesThread([]);
      }
    }
    setNotesThreadLoading(false);
  };

  // When the modal opens on a new event, kick off the load.
  useEffect(() => {
    if (notesEvent && notesEvent.id) loadNotesThread(notesEvent.id);
    else setNotesThread([]);
  }, [notesEvent && notesEvent.id]);

  // Post a new note to the thread. Also stamps check-in state on the FIRST
  // post for a not-yet-attended event (preserves the old "Check In" semantic).
  const postNewNote = async () => {
    if (!notesEvent) return;
    const text = meetingNotes.trim();
    if (!text) return;
    if (notesPosting) return;
    setNotesPosting(true);
    try {
      const wasCompleted = !!notesEvent.completed;
      // Insert the new note row
      await supabase.from('meeting_notes').insert({
        event_id: notesEvent.id,
        author_id: myId,
        note_text: text,
        note_kind: newNoteKind || 'note',
      });
      // First-time post also stamps attendance on the parent event.
      if (!wasCompleted) {
        await dbUpdate('calendar_events', notesEvent.id, {
          completed: true,
          event_status: 'attended',
          checked_in_at: new Date().toISOString(),
          checked_in_by: myId,
        }, myId);
        try { await cancelEventReminders(notesEvent.id); } catch (e) {}
      }
      // Archive this specific note to the daily log (so Daily Log stays a full timeline)
      await dbInsert('daily_log', {
        user_id: myId,
        log_date: notesEvent.event_date || new Date().toISOString().substring(0, 10),
        entry_text: (wasCompleted ? '📋 Added to meeting notes — ' : '📋 Meeting notes — ') + notesEvent.title + ': ' + text,
        log_category: 'meeting',
        auto_generated: false,
      }, myId);
      await logActivity(myId, (wasCompleted ? 'Added note: ' : 'Checked in with note: ') + notesEvent.title + ' — ' + text.substring(0, 100), 'calendar');
      // Reset local draft, refresh thread + list
      setMeetingNotes('');
      setNewNoteKind('note');
      await loadNotesThread(notesEvent.id);
      // Update the parent event object so its notes_count reflects immediately
      setNotesEvent(prev => prev ? { ...prev, completed: true, notes_count: (prev.notes_count || 0) + 1 } : prev);
      loadEvents();
    } catch (err) {
      alert('Error posting note: ' + (err.message || err));
    }
    setNotesPosting(false);
  };

  // Edit your own note (or any, if admin). Does NOT create a new row.
  const saveEditedNote = async () => {
    if (!editingNoteId) return;
    const text = (editingNoteDraft || '').trim();
    if (!text) return;
    try {
      await supabase.from('meeting_notes').update({ note_text: text }).eq('id', editingNoteId);
      setEditingNoteId(null); setEditingNoteDraft('');
      await loadNotesThread(notesEvent.id);
    } catch (err) { alert('Error: ' + err.message); }
  };

  const deleteNote = async (noteId) => {
    if (!confirm('Delete this note? / حذف هذه الملاحظة؟')) return;
    try {
      await supabase.from('meeting_notes').delete().eq('id', noteId);
      await loadNotesThread(notesEvent.id);
      setNotesEvent(prev => prev ? { ...prev, notes_count: Math.max(0, (prev.notes_count || 1) - 1) } : prev);
      loadEvents();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const toggleActionItem = async (note) => {
    if (note.note_kind !== 'action_item') return;
    try {
      const newCompleted = !note.is_completed;
      await supabase.from('meeting_notes').update({
        is_completed: newCompleted,
        completed_at: newCompleted ? new Date().toISOString() : null,
        completed_by: newCompleted ? myId : null,
      }).eq('id', note.id);
      await loadNotesThread(notesEvent.id);
    } catch (err) { alert('Error: ' + err.message); }
  };

  // Export the entire thread as plain text for copy-paste into email/WhatsApp.
  const exportNotesAsText = () => {
    if (!notesEvent || !notesThread.length) return;
    const authorName = (uid) => {
      const u = (users || []).find(x => x.id === uid);
      return u ? u.name : (uid === myId ? 'Me' : 'Unknown');
    };
    const lines = [];
    lines.push('MEETING: ' + notesEvent.title);
    lines.push('DATE: ' + notesEvent.event_date + (notesEvent.event_time ? ' ' + notesEvent.event_time : ''));
    lines.push('NOTES COUNT: ' + notesThread.length);
    lines.push('EXPORTED: ' + new Date().toLocaleString());
    lines.push('---');
    notesThread.forEach(n => {
      const kindLabel = n.note_kind === 'action_item' ? (n.is_completed ? '[✓] ACTION' : '[ ] ACTION') : n.note_kind === 'decision' ? 'DECISION' : 'NOTE';
      const when = new Date(n.created_at).toLocaleString();
      lines.push('[' + when + '] ' + authorName(n.author_id) + ' — ' + kindLabel);
      lines.push(n.note_text);
      lines.push('');
    });
    const txt = lines.join('\n');
    // Copy to clipboard AND download as .txt
    try { navigator.clipboard.writeText(txt); } catch (e) {}
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meeting-notes-' + (notesEvent.title || 'event').replace(/[^a-z0-9]+/gi, '_').slice(0, 40) + '-' + notesEvent.event_date + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const checkInWithNotes = async () => {
    // Back-compat shim — if user hits the old button with some text in the textarea,
    // treat it as posting a first note. New flow is postNewNote directly.
    if (meetingNotes.trim()) return postNewNote();
    // No text → just check in without a note
    if (!notesEvent) return;
    try {
      if (!notesEvent.completed) {
        await dbUpdate('calendar_events', notesEvent.id, {
          completed: true, event_status: 'attended',
          checked_in_at: new Date().toISOString(), checked_in_by: myId,
        }, myId);
        await logActivity(myId, 'Checked in: ' + notesEvent.title, 'calendar');
        try { await cancelEventReminders(notesEvent.id); } catch (e) {}
      }
      setNotesEvent(null); setMeetingNotes('');
      loadEvents();
    } catch (err) { alert('Error: ' + err.message); }
  };

  // R1/R2 (prep): edit an event. Basic fields only (title/date/time). For a
  // series master, user picks scope: 'single' = this row only, 'series' = apply
  // to all occurrences in the same series. The "this and following" option is
  // surfaced as disabled here — lands in Session 3 alongside R2.
  const openEditEvent = (ev) => {
    setEditEvent(ev);
    setEditForm({
      title: ev.title || '',
      eventDate: ev.event_date || '',
      eventTime: ev.event_time || '',
      // v55 Stage 1 — preload the three new fields so the modal shows
      // current values and the diff in saveEditEvent works correctly.
      location: ev.location || '',
      joinLink: ev.join_link || '',
      allDay: !!ev.all_day,
    });
    setEditScope('single');
  };
  const closeEditEvent = () => {
    setEditEvent(null);
    setEditForm({});
    setEditScope('single');
    // v55.22 — reset in-modal cancel/delete flow state
    setActionStage('idle');
    setActionReason('');
    setActionTyped('');
    setActionBusy(false);
  };

  // v54.3 — Permission helpers for meeting actions.
  //
  // canCancel: creator, super admin, or primary assignee can cancel
  //   (soft-delete with audit trail). Cancelled meetings stay on the
  //   calendar crossed out and can be restored.
  //
  // canDelete: only super admin, and only with typed "DELETE" confirm.
  //   Hard-delete, gone forever.
  //
  // canDecline: any attendee who is NOT the creator AND has not already
  //   declined. Creator shouldn't "decline their own meeting" — that's
  //   a Cancel action instead.
  const isSuperAdmin = userProfile && userProfile.role === 'super_admin';

  const canCancel = (ev) => {
    if (!ev || !myId) return false;
    if (isSuperAdmin) return true;
    if (ev.created_by === myId) return true;
    if (ev.assigned_to === myId) return true;
    return false;
  };

  const canDelete = (ev) => {
    // Hard delete is admin-only for audit safety
    return !!isSuperAdmin;
  };

  const canDecline = (ev) => {
    if (!ev || !myId) return false;
    // Creator can't decline their own meeting — they cancel instead
    if (ev.created_by === myId) return false;
    // Must be an attendee
    const inAttendees = Array.isArray(ev.attendees) && ev.attendees.indexOf(myId) !== -1;
    if (!inAttendees) return false;
    // Already declined?
    const alreadyDeclined = Array.isArray(ev.declined_by) && ev.declined_by.indexOf(myId) !== -1;
    if (alreadyDeclined) return false;
    return true;
  };

  const hasDeclined = (ev) => {
    if (!ev || !myId) return false;
    return Array.isArray(ev.declined_by) && ev.declined_by.indexOf(myId) !== -1;
  };

  // v55.22 — Cancel meeting workflow.
  //
  // Two-step UX: clicking the "Cancel meeting" button switches the modal
  // to actionStage='cancel' (renders an inline reason input + Confirm
  // button). Clicking Confirm calls performCancel(). This avoids
  // window.prompt/confirm which Chromium silently suppresses after a
  // few uses on the same page — that was the root cause of "I click
  // cancel and nothing happens."
  //
  // Cancel = soft-delete with audit trail. status becomes 'cancelled',
  // shows in calendar with strike-through styling, notes preserved,
  // can be uncancelled later.
  const performCancel = async () => {
    if (!editEvent) return;
    if (!canCancel(editEvent)) {
      if (toast) toast.error(lang === 'ar' ? 'لا يمكنك إلغاء هذا الاجتماع' : 'You cannot cancel this meeting (only the creator, primary assignee, or admin can)');
      return;
    }
    setActionBusy(true);
    try {
      const cancelPatch = {
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: myId,
        cancellation_reason: actionReason || null,
      };

      if (editScope === 'series' && editEvent.series_id) {
        // Cancel all occurrences in the series
        await supabase.from('calendar_events')
          .update(cancelPatch)
          .eq('series_id', editEvent.series_id);
        await logActivity(myId, 'Cancelled event series: ' + editEvent.title, 'calendar');
      } else {
        await dbUpdate('calendar_events', editEvent.id, cancelPatch, myId);
        await logActivity(myId, 'Cancelled event: ' + editEvent.title, 'calendar');
      }

      try { await cancelEventReminders(editEvent.id); } catch (e) {}
      if (toast) toast.success(lang === 'ar' ? 'تم إلغاء الاجتماع' : 'Meeting cancelled');
      closeEditEvent();
      if (onRefresh) onRefresh();
    } catch (err) {
      setActionBusy(false);
      if (toast) toast.error((lang === 'ar' ? 'فشل الإلغاء: ' : 'Cancel failed: ') + (err && err.message));
    }
  };

  // v55.22 — Hard DELETE. Super admin only. Gone forever, no recovery.
  // In-modal version: clicking the Delete button switches modal to
  // actionStage='delete' (renders DELETE-typing confirm). Same reason
  // as cancelMeeting — window.prompt was getting silently suppressed.
  const performDelete = async () => {
    if (!editEvent) return;
    if (!canDelete(editEvent)) {
      if (toast) toast.error(lang === 'ar' ? 'الحذف الكامل متاح فقط للمشرف الأعلى' : 'Hard delete is super-admin only');
      return;
    }
    if (actionTyped !== 'DELETE') {
      if (toast) toast.error(lang === 'ar' ? 'اكتب DELETE تماماً للتأكيد' : 'Type DELETE exactly to confirm');
      return;
    }
    setActionBusy(true);
    try {
      // Audit row BEFORE delete so we can still see who/when after removal
      await logActivity(myId, 'HARD-DELETED event: ' + editEvent.title + ' (id=' + editEvent.id + ')', 'calendar');
      try { await cancelEventReminders(editEvent.id); } catch (e) {}
      await supabase.from('calendar_events').delete().eq('id', editEvent.id);
      if (toast) toast.success(lang === 'ar' ? 'تم حذف الاجتماع نهائياً' : 'Meeting permanently deleted');
      closeEditEvent();
      if (onRefresh) onRefresh();
    } catch (err) {
      setActionBusy(false);
      if (toast) toast.error((lang === 'ar' ? 'فشل الحذف: ' : 'Delete failed: ') + (err && err.message));
    }
  };

  // v54.3 — Decline an invitation. Any attendee (not creator) can decline.
  // Adds self to declined_by array, optionally records a reason, emails
  // the creator. Event stays alive for other attendees.
  const declineInvite = async () => {
    if (!editEvent) return;
    if (!canDecline(editEvent)) {
      if (toast) toast.error(lang === 'ar' ? 'لا يمكنك رفض هذه الدعوة' : 'You cannot decline this invitation');
      return;
    }
    const reason = window.prompt(
      (lang === 'ar' ? 'سبب الرفض (اختياري — سيتم إرساله لمنظم الاجتماع):' : 'Reason for declining (optional — sent to the meeting organizer):'),
      ''
    );
    if (reason === null) return;
    try {
      // Add myId to declined_by and (if reason provided) to decline_reasons
      const newDeclinedBy = Array.isArray(editEvent.declined_by) ? editEvent.declined_by.slice() : [];
      if (newDeclinedBy.indexOf(myId) === -1) newDeclinedBy.push(myId);
      const newReasons = editEvent.decline_reasons || {};
      if (reason) newReasons[myId] = reason;
      await dbUpdate('calendar_events', editEvent.id, {
        declined_by: newDeclinedBy,
        decline_reasons: newReasons,
      }, myId);

      // Cancel reminders for just this user (server handles per-user list
      // internally; we best-effort call the existing cancel function which
      // clears all reminders for the event, then the event still stays
      // scheduled for the rest — reminders will regenerate via cron).
      try { await cancelEventReminders(editEvent.id); } catch (e) {}

      // Email the creator
      try {
        const myName = (userProfile && userProfile.name) || 'Someone';
        const creator = (users || []).find((u) => u.id === editEvent.created_by);
        if (creator && creator.id) {
          // /api/notify supports recipientIds targeting; it looks up the
          // email from users table server-side.
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'event_declined',
              recipientIds: [creator.id],
              subject: myName + ' declined: ' + editEvent.title,
              body:
                myName + ' declined your meeting "' + editEvent.title + '"' +
                ' on ' + editEvent.event_date +
                (editEvent.event_time ? ' at ' + editEvent.event_time : '') + '.' +
                (reason ? '\n\nReason: ' + reason : '\n\n(No reason provided)'),
              triggeredBy: myId,
            }),
          });
        }
      } catch (e) { /* email is best-effort; don't block the decline */ }

      await logActivity(myId, 'Declined invitation: ' + editEvent.title, 'calendar');
      if (toast) toast.success(lang === 'ar' ? 'تم رفض الدعوة — تم إعلام المنظم' : 'Invitation declined — organizer notified');
      closeEditEvent();
      if (onRefresh) onRefresh();
    } catch (err) {
      if (toast) toast.error((lang === 'ar' ? 'فشل الرفض: ' : 'Decline failed: ') + (err && err.message));
    }
  };

  // v54.3 — Un-decline (accept again after declining). Removes self from
  // declined_by. No email needed on the reverse action.
  const undeclineInvite = async () => {
    if (!editEvent || !hasDeclined(editEvent)) return;
    try {
      const newDeclinedBy = (editEvent.declined_by || []).filter((id) => id !== myId);
      const newReasons = Object.assign({}, editEvent.decline_reasons || {});
      delete newReasons[myId];
      await dbUpdate('calendar_events', editEvent.id, {
        declined_by: newDeclinedBy,
        decline_reasons: newReasons,
      }, myId);
      await logActivity(myId, 'Accepted (undeclined) invitation: ' + editEvent.title, 'calendar');
      if (toast) toast.success(lang === 'ar' ? 'تم قبول الدعوة' : 'Invitation accepted');
      closeEditEvent();
      if (onRefresh) onRefresh();
    } catch (err) {
      if (toast) toast.error((lang === 'ar' ? 'فشل القبول: ' : 'Accept failed: ') + (err && err.message));
    }
  };

  // v54.1 — Uncancel (restore) a cancelled meeting
  const uncancelMeeting = async () => {
    if (!editEvent) return;
    try {
      await dbUpdate('calendar_events', editEvent.id, {
        status: 'scheduled',
        cancelled_at: null,
        cancelled_by: null,
        cancellation_reason: null,
      }, myId);
      await logActivity(myId, 'Restored event: ' + editEvent.title, 'calendar');
      if (toast) toast.success(lang === 'ar' ? 'تم استعادة الاجتماع' : 'Meeting restored');
      closeEditEvent();
      if (onRefresh) onRefresh();
    } catch (err) {
      if (toast) toast.error((lang === 'ar' ? 'فشل الاستعادة: ' : 'Restore failed: ') + (err && err.message));
    }
  };

  const saveEditEvent = async () => {
    if (!editEvent) return;
    const hasDateChange = editForm.eventDate && editForm.eventDate !== editEvent.event_date;
    const hasTimeChange = (editForm.eventTime || null) !== (editEvent.event_time || null);
    const hasTitleChange = (editForm.title || '') !== (editEvent.title || '');
    // v55 Stage 1 — detect changes to the three new fields. Trim/normalize
    // so trailing spaces don't trigger a phantom "edit".
    const newLoc = (editForm.location || '').trim();
    const oldLoc = (editEvent.location || '').trim();
    const hasLocationChange = newLoc !== oldLoc;
    const newLink = (editForm.joinLink || '').trim();
    const oldLink = (editEvent.join_link || '').trim();
    const hasJoinLinkChange = newLink !== oldLink;
    const newAllDay = !!editForm.allDay;
    const oldAllDay = !!editEvent.all_day;
    const hasAllDayChange = newAllDay !== oldAllDay;
    if (!hasDateChange && !hasTimeChange && !hasTitleChange
        && !hasLocationChange && !hasJoinLinkChange && !hasAllDayChange) {
      closeEditEvent();
      return;
    }

    try {
      const update = {};
      if (hasTitleChange) update.title = editForm.title;
      if (hasTimeChange)  update.event_time = editForm.eventTime || null;
      if (hasDateChange) {
        update.event_date = editForm.eventDate;
        // R2 prep: remember the original date if this is a single-occurrence move
        if (editScope === 'single' && editEvent.series_id && !editEvent.is_series_master) {
          update.original_event_date = editEvent.event_date;
        }
      }
      // v55 Stage 1 — persist new-field changes. Empty strings → null so
      // the DB doesn't accumulate '' values that look meaningful.
      if (hasLocationChange)  update.location  = newLoc || null;
      if (hasJoinLinkChange)  update.join_link = newLink || null;
      if (hasAllDayChange) {
        update.all_day = newAllDay;
        // Switching ON all-day MUST clear the clock time, even if the user
        // didn't touch the time input. Symmetrical to handleAddEvent's
        // belt-and-suspenders rule.
        if (newAllDay) update.event_time = null;
      }

      if (editScope === 'series' && editEvent.series_id) {
        // Apply title/time to ALL rows in the series. Don't mass-apply date (would
        // move every occurrence to the same day, which is wrong).
        const seriesUpdate = {};
        if (hasTitleChange) seriesUpdate.title = editForm.title;
        if (hasTimeChange)  seriesUpdate.event_time = editForm.eventTime || null;
        if (Object.keys(seriesUpdate).length > 0) {
          // bulk update (no audit row — this is an intentional trade-off for UX;
          // individual occurrences don't each warrant an audit row)
          await supabase.from('calendar_events').update(seriesUpdate).eq('series_id', editEvent.series_id);
        }
        // If the master's date moved, also move the master (but not all children)
        if (hasDateChange && editEvent.is_series_master) {
          await dbUpdate('calendar_events', editEvent.id, { event_date: editForm.eventDate }, myId);
        }
        await logActivity(myId, 'Edited event series: ' + (editForm.title || editEvent.title), 'calendar');
      } else {
        // Single row update
        await dbUpdate('calendar_events', editEvent.id, update, myId);
        await logActivity(myId, 'Edited event: ' + (editForm.title || editEvent.title), 'calendar');
      }

      // Reschedule reminders if date or time moved.
      // For series-edit with time change: ALL children's 30min_before reminders are
      // anchored to their (old) event_time, so cancel + reschedule for every child.
      if (editScope === 'series' && editEvent.series_id && hasTimeChange) {
        try {
          const { data: siblings } = await supabase
            .from('calendar_events').select('*')
            .eq('series_id', editEvent.series_id);
          for (const sib of (siblings || [])) {
            if (!sib.assigned_to) continue;
            // Use the updated time if series-wide, else keep sib's own time.
            const asIf = { ...sib, event_time: editForm.eventTime || null };
            try { await rescheduleEventReminders(asIf, [sib.assigned_to], myId); }
            catch (e) { /* per-row swallow */ }
          }
        } catch (e) { console.log('[calendar] series reschedule failed: ' + e.message); }
      } else if ((hasDateChange || hasTimeChange) && editEvent.assigned_to) {
        const fresh = { ...editEvent, ...update };
        try { await rescheduleEventReminders(fresh, [editEvent.assigned_to], myId); }
        catch (e) { console.log('[calendar] reschedule failed: ' + e.message); }
      }

      closeEditEvent();
      loadEvents();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const getUserName = (id) => users?.find(u => u.id === id)?.name || '';

  return (
    <div>
      <div className="flex justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-xl font-extrabold">Calendar / التقويم</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button onClick={() => setCalView('my')}
              className={'px-3 py-1 rounded text-xs font-semibold transition ' + (calView === 'my' ? 'bg-white shadow text-slate-900' : 'text-slate-500')}>My Calendar</button>
            <button onClick={() => setCalView('team')}
              className={'px-3 py-1 rounded text-xs font-semibold transition ' + (calView === 'team' ? 'bg-white shadow text-slate-900' : 'text-slate-500')}>Team</button>
          </div>
          <button onClick={() => setView(view === 'month' ? 'day' : 'month')}
            className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold">{view === 'month' ? 'Day View' : 'Month View'}</button>
          <button onClick={() => { setShowAdd(true); setF({eventDate: selDate || todayStr, recurringInterval: 1}); setSelectedUsers([]); }}
            className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Event / حدث</button>
        </div>
      </div>

      {/* Month Navigation */}
      <div className="flex justify-between items-center bg-white rounded-xl p-3 mb-3">
        <button onClick={prevMonth} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold">←</button>
        <div className="text-center">
          <div className="text-lg font-extrabold">{MONTHS_AR[month]} / {curDate.toLocaleDateString('en', {month:'long'})}</div>
          <div className="text-xs text-slate-500">{year}</div>
        </div>
        <button onClick={nextMonth} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold">→</button>
      </div>

      {/* Add Event Form */}
      {showAdd && (
        <div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
          <h3 className="text-sm font-bold text-blue-800 mb-3">New Event / حدث جديد</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="text-[10px] font-semibold">Title / العنوان</label>
              <input value={f.title||''} onChange={e=>setF({...f,title:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div className="col-span-2">
              <label className="text-[10px] font-semibold">Description / Agenda — الوصف والأجندة <span className="text-slate-400 font-normal">(optional, shown before the meeting)</span></label>
              <textarea value={f.description||''} onChange={e=>setF({...f,description:e.target.value})}
                placeholder="What's this meeting about? Talking points, goals, pre-read links..."
                rows={3}
                className="w-full px-3 py-2 rounded border text-sm" />
            </div>
            <div><label className="text-[10px] font-semibold">Date / التاريخ</label>
              <input type="date" value={f.eventDate||''} onChange={e=>setF({...f,eventDate:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Time / الوقت</label>
              <input type="time" value={f.eventTime||''} onChange={e=>setF({...f,eventTime:e.target.value})} disabled={!!f.allDay} className={'w-full px-3 py-2 rounded border text-sm ' + (f.allDay ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : '')} title={f.allDay ? 'Time is disabled for all-day events' : ''} /></div>
            {/* v55 Stage 1 — All-day toggle. When on, event has no clock time
                and displays as "All day" everywhere (cards, month grid, edit). */}
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer select-none">
                <input type="checkbox" checked={!!f.allDay}
                  onChange={e => setF({ ...f, allDay: e.target.checked, eventTime: e.target.checked ? '' : f.eventTime })}
                  className="w-4 h-4" />
                <span>🌅 All-day event / حدث طوال اليوم</span>
                <span className="text-[10px] text-slate-400 font-normal">(no specific time)</span>
              </label>
            </div>
            {/* v55 Stage 1 — Location. Free-text, optional. Shows on every
                view alongside the time. */}
            <div className="col-span-2"><label className="text-[10px] font-semibold">📍 Location / المكان <span className="text-slate-400 font-normal">(optional)</span></label>
              <input value={f.location||''} onChange={e=>setF({...f,location:e.target.value})}
                placeholder="e.g. KTC office, Cairo Marriott, online..."
                className="w-full px-3 py-2 rounded border text-sm" /></div>
            {/* v55 Stage 1 — Join link. URL for video/audio meetings. Rendered
                as a clickable link on event cards (e.stopPropagation so
                clicking it doesn't trigger the edit modal). */}
            <div className="col-span-2"><label className="text-[10px] font-semibold">🔗 Join Meeting Link / رابط الاجتماع <span className="text-slate-400 font-normal">(optional)</span></label>
              <input value={f.joinLink||''} onChange={e=>setF({...f,joinLink:e.target.value})}
                placeholder="https://zoom.us/j/... or any meeting URL"
                className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Type / النوع</label>
              <select value={f.eventType||'task'} onChange={e=>setF({...f,eventType:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                {EVENT_TYPES.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}</select></div>
            <div><label className="text-[10px] font-semibold">Repeats / التكرار</label>
              <select value={f.recurring||'none'} onChange={e=>setF({...f,recurring:e.target.value, recurringInterval: f.recurringInterval || 1})} className="w-full px-3 py-2 rounded border text-sm">
                <option value="none">None / لا</option><option value="daily">Daily / يومي</option>
                <option value="weekly">Weekly / أسبوعي</option><option value="biweekly">Biweekly / كل أسبوعين</option>
                <option value="monthly">Monthly / شهري</option></select></div>
            {f.recurring && f.recurring !== 'none' && (
              <>
                <div><label className="text-[10px] font-semibold">Every / كل</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min="1" max="99" value={f.recurringInterval||1}
                      onChange={e=>setF({...f,recurringInterval: Math.max(1, Math.min(99, parseInt(e.target.value,10)||1))})}
                      className="w-20 px-3 py-2 rounded border text-sm" />
                    <span className="text-xs text-slate-500">{recurrenceLabel(f.recurring, f.recurringInterval)}</span>
                  </div>
                </div>
                <div><label className="text-[10px] font-semibold">Until / حتى</label>
                  <input type="date" value={f.recurringEnd||''} onChange={e=>setF({...f,recurringEnd:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
              </>
            )}
            <div className={(f.recurring && f.recurring !== 'none') ? 'col-span-2' : ''}>
              <label className="text-[10px] font-semibold">Client / العميل</label>
              <select value={f.customerId||''} onChange={e=>setF({...f,customerId:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                <option value="">None</option>
                {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          {/* Multi-assign */}
          <div className="mt-3">
            <label className="text-[10px] font-semibold block mb-1">Assign To / تعيين إلى</label>
            <div className="flex gap-2 flex-wrap items-center">
              <button onClick={selectAllUsers}
                className={'px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition ' + (selectedUsers.length === (users||[]).length ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500')}>
                All Team / كل الفريق
              </button>
              {(users || []).map(u => (
                <button key={u.id} onClick={() => toggleUser(u.id)}
                  className={'px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition ' + (selectedUsers.includes(u.id) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500')}>
                  {selectedUsers.includes(u.id) ? '✓ ' : ''}{u.name}
                </button>
              ))}
            </div>
            {selectedUsers.length === 0 && <div className="text-[10px] text-slate-400 mt-1">No selection = assigned to you</div>}
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAddEvent}
              disabled={saving}
              className={'px-4 py-2 rounded-lg text-sm font-semibold text-white ' + (saving ? 'bg-slate-400 cursor-wait' : 'bg-emerald-500 hover:bg-emerald-600')}>
              {saving ? 'Saving...' : 'Save / حفظ'}
            </button>
            <button onClick={()=>{setShowAdd(false);setSelectedUsers([]);}} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel / إلغاء</button>
          </div>
        </div>
      )}

      {/* Month Grid */}
      {view === 'month' && (
        <div className="bg-white rounded-xl p-3">
          <div className="grid grid-cols-7 gap-0">
            {DAYS.map(d => <div key={d} className="text-center text-[10px] font-bold text-slate-500 py-1">{d}</div>)}
            {Array.from({length: firstDay}, (_, i) => <div key={'e'+i} className="h-16"></div>)}
            {Array.from({length: daysInMonth}, (_, i) => {
              const day = i + 1;
              const ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
              const de = dayEvents(day);
              const isToday = ds === todayStr;
              const isSel = ds === selDate;
              return (
                <div key={day} onClick={() => setSelDate(ds === selDate ? null : ds)}
                  className={'h-16 border border-slate-100 p-0.5 cursor-pointer hover:bg-blue-50 transition ' + (isToday ? 'bg-blue-50 border-blue-300' : '') + (isSel ? ' ring-2 ring-blue-500' : '')}>
                  <div className={'text-[10px] font-semibold ' + (isToday ? 'text-blue-600' : 'text-slate-600')}>{day}</div>
                  {de.slice(0, 3).map(ev => {
                    if (ev._ticket) {
                      return (
                        <div key={ev.id}
                          onClick={(e) => { e.stopPropagation(); if (onOpenTicket) onOpenTicket(ev._ticket_id); }}
                          title={'🎫 ' + ev.title + ' (' + ev._ticket_priority + ' priority) — click to open'}
                          className="text-[8px] truncate rounded px-0.5 mb-0.5 font-semibold cursor-pointer hover:underline"
                          style={{ background: ev._ticket_color + '22', color: ev._ticket_color, border: '1px dashed ' + ev._ticket_color + '66' }}>
                          🎫 {ev.title}
                        </div>
                      );
                    }
                    const tc = EVENT_TYPES.find(t=>t.v===ev.event_type)?.c || '#3b82f6';
                    return <div key={ev.id} className={'text-[8px] truncate rounded px-0.5 mb-0.5 ' + (ev.completed ? 'line-through opacity-50' : '')} style={{background:tc+'20',color:tc}}>{ev.all_day ? '🌅 ' : ''}{ev.series_id ? '🔄 ' : ''}{ev.location ? '📍 ' : ''}{ev.title}</div>;
                  })}
                  {de.length > 3 && <div className="text-[8px] text-slate-400">+{de.length - 3}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Day View */}
      {view === 'day' && (
        <div className="bg-white rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <button onClick={() => {const d = new Date(selDate || todayStr); d.setDate(d.getDate()-1); setSelDate(d.toISOString().substring(0,10));}} className="px-2 py-1 border rounded text-xs">←</button>
            <div className="text-sm font-bold">{selDate || todayStr}</div>
            <button onClick={() => {const d = new Date(selDate || todayStr); d.setDate(d.getDate()+1); setSelDate(d.toISOString().substring(0,10));}} className="px-2 py-1 border rounded text-xs">→</button>
          </div>
          {(visibleEvents.filter(e => e.event_date === (selDate || todayStr))).length > 0 ? (
            visibleEvents.filter(e => e.event_date === (selDate || todayStr)).sort((a,b) => (a.event_time||'').localeCompare(b.event_time||'')).map(ev => {
              // Ticket pseudo-events render as a distinct clickable card that
              // jumps straight to the ticket. No check-in/postpone/edit —
              // those are handled in the Tickets tab.
              if (ev._ticket) {
                const assignedName = getUserName(ev.assigned_to);
                return (
                  <div key={ev.id}
                    onClick={() => { if (onOpenTicket) onOpenTicket(ev._ticket_id); }}
                    className="flex justify-between items-center p-3 rounded-lg mb-2 border-2 border-dashed cursor-pointer hover:bg-slate-50 transition"
                    style={{ borderColor: ev._ticket_color, background: ev._ticket_color + '08' }}
                    title="Click to open this ticket">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold flex items-center gap-1.5">
                        <span>🎫</span>
                        <span className="truncate">{ev.title}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span style={{ color: ev._ticket_color }} className="font-bold uppercase">{ev._ticket_priority}</span>
                        <span>· Due today</span>
                        {calView === 'team' && assignedName && <span className="text-purple-600">→ {assignedName}</span>}
                      </div>
                    </div>
                    <div className="ml-2 text-[10px] font-bold text-slate-400">Open →</div>
                  </div>
                );
              }
              const tc = EVENT_TYPES.find(t=>t.v===ev.event_type)?.c || '#3b82f6';
              const assignedName = getUserName(ev.assigned_to);
              return (
                <div key={ev.id} className={'flex justify-between items-center p-3 rounded-lg mb-2 border ' + (ev.completed ? 'opacity-50' : '')} style={{borderColor:tc,background:tc+'10'}}>
                  <div onClick={() => openEditEvent(ev)} className="cursor-pointer flex-1 hover:bg-slate-100 rounded px-1 -mx-1" title="Click to edit / cancel / delete">
                    <div className={'text-sm font-bold ' + (ev.completed ? 'line-through' : '')}>{ev.title}</div>
                    <div className="text-[10px] text-slate-500">
                      {/* v55 Stage 1 — All-day badge replaces the time when set.
                          Otherwise show clock time, falling back to "All day"
                          for legacy rows that have no event_time and no all_day. */}
                      {ev.all_day ? <span className="font-semibold text-blue-600">🌅 All day</span> : (ev.event_time || 'All day')} | {ev.event_type}
                      {calView === 'team' && assignedName && <span className="ml-1 text-purple-600">→ {assignedName}</span>}
                      {ev.recurring && ev.recurring !== 'none' && <span className="ml-1">🔄 {recurrenceLabel(ev.recurring, ev.recurrence_interval)}</span>}
                      {ev.original_event_date && ev.original_event_date !== ev.event_date && <span className="ml-1 text-amber-600" title={'Moved from ' + ev.original_event_date}>↪</span>}
                    </div>
                    {/* v55 Stage 1 — Location + join link line. Location is plain
                        text, join link is a real <a> with stopPropagation so a
                        tap on the link doesn't also open the edit modal. */}
                    {(ev.location || ev.join_link) && (
                      <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {ev.location && (
                          <span className="inline-flex items-center gap-1" title="Location">
                            <span>📍</span>
                            <span className="font-medium truncate max-w-[260px]">{ev.location}</span>
                          </span>
                        )}
                        {ev.join_link && (
                          <a href={ev.join_link} target="_blank" rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-blue-600 font-semibold hover:underline">
                            <span>🔗</span>
                            <span>Join meeting</span>
                          </a>
                        )}
                      </div>
                    )}
                    {ev.description && (
                      <div className="text-[11px] text-slate-600 mt-1 pl-0 whitespace-pre-wrap max-w-[520px] leading-snug" title="Agenda / pre-meeting notes">
                        <span className="font-semibold text-slate-500">📋 </span>{ev.description}
                      </div>
                    )}
                  </div>
                  {!ev.completed && <div className="flex gap-1">
                    {ev.event_status === 'postponed' ? <>
                      <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-[10px] font-bold">Postponed</span>
                      <button onClick={() => openEditEvent(ev)} title="Edit / Cancel / Delete" className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-[10px]">✏️</button>
                    </> : <>
                      <button onClick={() => { setNotesEvent(ev); setMeetingNotes(''); setNewNoteKind('note'); }} className="px-2 py-1 bg-emerald-500 text-white rounded text-[10px]">✓ Check In</button>
                      <button onClick={() => markEventStatus(ev, 'postponed')} className="px-2 py-1 bg-amber-500 text-white rounded text-[10px]">⏳ Postpone</button>
                      <button onClick={() => openEditEvent(ev)} title="Edit" className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-[10px]">✏️</button>
                    </>}
                  </div>}
                  {ev.completed && <div className="text-right flex flex-col items-end gap-1">
                    <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">✓ Attended</span>
                    {(ev.notes_count > 0 || ev.meeting_notes) && (
                      <button onClick={() => { setNotesEvent(ev); setMeetingNotes(''); setNewNoteKind('note'); }}
                        className="text-[9px] text-slate-500 mt-0.5 max-w-[220px] flex items-center gap-1 hover:text-emerald-600 font-semibold"
                        title={'View / add to ' + (ev.notes_count || 1) + ' note(s)'}>
                        📝 {ev.notes_count || 1} note{ev.notes_count === 1 ? '' : 's'}
                      </button>
                    )}
                    {/* S18.5 — button label clarifies this is ADD not EDIT.
                        Max: after checking in, the old "Edit Notes" copy made
                        him think he could only edit. The modal always supports
                        adding a new note on top of the existing thread; the
                        label should say so. */}
                    <button onClick={() => { setNotesEvent(ev); setMeetingNotes(''); setNewNoteKind('note'); }}
                      className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[9px] font-semibold">
                      {(ev.notes_count > 0 || ev.meeting_notes) ? '➕ Add Note' : '📝 Add Notes'}
                    </button>
                  </div>}
                </div>
              );
            })
          ) : (
            <div className="text-center text-slate-400 text-sm py-6">No events / لا توجد أحداث</div>
          )}
        </div>
      )}

      {/* Selected Date Events (Month View) */}
      {view === 'month' && selDate && selectedDayEvents.length > 0 && (
        <div className="bg-white rounded-xl p-4 mt-3">
          <h3 className="text-sm font-bold mb-2">{selDate}</h3>
          {selectedDayEvents.sort((a,b) => (a.event_time||'').localeCompare(b.event_time||'')).map(ev => {
            if (ev._ticket) {
              const assignedName = getUserName(ev.assigned_to);
              return (
                <div key={ev.id}
                  onClick={() => { if (onOpenTicket) onOpenTicket(ev._ticket_id); }}
                  className="flex justify-between items-center p-2 rounded mb-1 border-2 border-dashed cursor-pointer hover:bg-slate-50"
                  style={{ borderColor: ev._ticket_color, background: ev._ticket_color + '08' }}
                  title="Click to open this ticket">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold flex items-center gap-1"><span>🎫</span><span className="truncate">{ev.title}</span></div>
                    <div className="text-[10px] text-slate-500">
                      <span style={{ color: ev._ticket_color }} className="font-bold uppercase">{ev._ticket_priority}</span>
                      {calView === 'team' && assignedName && <span className="ml-1 text-purple-600">→ {assignedName}</span>}
                    </div>
                  </div>
                  <span className="text-[9px] font-bold text-slate-400">Open →</span>
                </div>
              );
            }
            const tc = EVENT_TYPES.find(t=>t.v===ev.event_type)?.c || '#3b82f6';
            const assignedName = getUserName(ev.assigned_to);
            return (
              <div key={ev.id} className={'flex justify-between items-center p-2 rounded mb-1 ' + (ev.completed ? 'opacity-50' : '')} style={{background:tc+'10'}}>
                <div onClick={() => openEditEvent(ev)} className="cursor-pointer flex-1 hover:bg-slate-100 rounded px-1 -mx-1" title="Click to edit / cancel / delete">
                  <div className={'text-xs font-semibold ' + (ev.completed ? 'line-through' : '')}>{ev.title}</div>
                  <div className="text-[10px] text-slate-500">
                    {/* v55 Stage 1 — All-day badge replaces clock time. */}
                    {ev.all_day ? <span className="font-semibold text-blue-600">🌅 All day</span> : (ev.event_time || 'All day')} | {ev.event_type}
                    {calView === 'team' && assignedName && <span className="ml-1 text-purple-600">→ {assignedName}</span>}
                    {ev.recurring && ev.recurring !== 'none' ? ' | 🔄 ' + recurrenceLabel(ev.recurring, ev.recurrence_interval) : ''}
                  </div>
                  {/* v55 Stage 1 — Location + join link line. Same pattern as
                      day view: stopPropagation on the join link so tapping
                      it doesn't also open the edit modal. */}
                  {(ev.location || ev.join_link) && (
                    <div className="text-[10px] text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {ev.location && (
                        <span className="inline-flex items-center gap-1 truncate max-w-[200px]" title={ev.location}>
                          <span>📍</span><span className="truncate">{ev.location}</span>
                        </span>
                      )}
                      {ev.join_link && (
                        <a href={ev.join_link} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-blue-600 font-semibold hover:underline">
                          🔗 Join
                        </a>
                      )}
                    </div>
                  )}
                </div>
                {!ev.completed && !ev.event_status && <div className="flex gap-1">
                  <button onClick={() => { setNotesEvent(ev); setMeetingNotes(''); setNewNoteKind('note'); }} className="px-2 py-0.5 bg-emerald-500 text-white rounded text-[10px]">✓ Check In</button>
                  <button onClick={() => markEventStatus(ev, 'postponed')} className="px-2 py-0.5 bg-amber-500 text-white rounded text-[10px]">⏳</button>
                  <button onClick={() => openEditEvent(ev)} title="Edit" className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[10px]">✏️</button>
                </div>}
                {ev.event_status === 'postponed' && <div className="flex items-center gap-1">
                  <span className="text-[9px] text-amber-600 font-bold">Postponed</span>
                  {/* v54.4 — Always give access to the edit modal (where
                      cancel/delete/decline live), regardless of completed
                      or postponed state. Without this, there was no way
                      to cancel a postponed meeting. */}
                  <button onClick={() => openEditEvent(ev)} title="Edit / Cancel / Delete" className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[10px]">✏️</button>
                </div>}
                {ev.completed && <div className="flex items-center gap-1">
                  <span className="text-[9px] text-emerald-600 font-bold">✓</span>
                  {/* S18.5 — open an empty composer so user can append
                      a new note without accidentally editing old ones. */}
                  <button onClick={() => { setNotesEvent(ev); setMeetingNotes(''); setNewNoteKind('note'); }}
                    title={(ev.notes_count > 0 || ev.meeting_notes) ? 'Add Note — ' + (ev.notes_count || 1) + ' already posted' : 'Add Notes / إضافة ملاحظات'}
                    className="text-[10px] hover:bg-slate-200 rounded px-1 flex items-center gap-0.5">
                    {(ev.notes_count > 0 || ev.meeting_notes) ? <span>📝<span className="text-[8px] font-bold text-emerald-600">{ev.notes_count || 1}</span></span> : '✏️'}
                  </button>
                  {/* v54.4 — Always provide access to the edit modal so
                      user can cancel/delete even a completed event. */}
                  <button onClick={() => openEditEvent(ev)} title="Edit / Cancel / Delete" className="text-[10px] hover:bg-slate-200 rounded px-1">
                    ⚙
                  </button>
                </div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Meeting Notes Thread Modal — multi-note, multi-author, append-only,
          always open-able even after the meeting is done. Exportable. */}
      {notesEvent && (() => {
        const closeModal = () => { setNotesEvent(null); setMeetingNotes(''); setNewNoteKind('note'); setEditingNoteId(null); setEditingNoteDraft(''); };
        const authorName = (uid) => {
          const u = (users || []).find(x => x.id === uid);
          return u ? u.name : (uid === myId ? 'Me' : '—');
        };
        const canEditNote = (n) => n && !n._legacy && (n.author_id === myId || !!userProfile?.is_admin);
        // Bottom-right phone widget sits at bottom-6 right-6 on z-50. Our modal
        // is a full-screen overlay so that's fine — but the backdrop clicks and
        // any fixed inner content need to stay above it. z-[60] does the trick.
        return (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={closeModal}>
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl overflow-hidden flex flex-col" style={{ maxHeight: '88vh' }} onClick={e => e.stopPropagation()}>
            {/* Header — title reflects mode so user knows if they're Editing vs Adding vs first-time Check-In */}
            <div className="px-5 py-3 border-b border-slate-100 flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold truncate">
                  {!notesEvent.completed
                    ? '✓ Check In / تسجيل الحضور'
                    : (notesThread.length > 0 || notesEvent.meeting_notes)
                      ? '📝 Meeting Notes / ملاحظات الاجتماع'
                      : '📝 Add Meeting Notes / إضافة ملاحظات'}
                </h3>
                <div className="text-xs text-slate-500 truncate">{notesEvent.title}</div>
                <div className="text-[10px] text-slate-400">{notesEvent.event_date} {notesEvent.event_time || ''} · {notesThread.length} note{notesThread.length === 1 ? '' : 's'}</div>
                {notesEvent.description && (
                  <div className="mt-2 px-2 py-1.5 rounded bg-blue-50 border border-blue-100 text-[11px] text-blue-900 whitespace-pre-wrap leading-snug">
                    <span className="font-semibold">📋 Agenda: </span>{notesEvent.description}
                  </div>
                )}
              </div>
              <div className="flex gap-1 ml-2">
                {notesThread.length > 0 && (
                  <button onClick={exportNotesAsText}
                    title="Export all notes as .txt (also copied to clipboard)"
                    className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 rounded">
                    📥 Export
                  </button>
                )}
                <button onClick={closeModal} className="px-2 py-1 text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
              </div>
            </div>

            {/* Thread */}
            <div className="flex-1 overflow-y-auto px-4 py-3 bg-slate-50" style={{ minHeight: 120 }}>
              {notesThreadLoading && <div className="text-center text-xs text-slate-400 py-4">Loading thread...</div>}
              {!notesThreadLoading && notesThread.length === 0 && (
                <div className="text-center text-xs text-slate-400 py-6">
                  No notes yet. Be the first to add one below.<br />
                  <span className="text-[10px]">Notes stay with this meeting forever — you can keep adding to them later.</span>
                </div>
              )}
              {notesThread.map(n => {
                const isMe = n.author_id === myId;
                const kindStyle = n.note_kind === 'decision'
                  ? { bg: 'bg-amber-50', border: 'border-amber-200', label: '💡 DECISION', lbl: 'text-amber-700' }
                  : n.note_kind === 'action_item'
                  ? { bg: n.is_completed ? 'bg-emerald-50' : 'bg-blue-50', border: n.is_completed ? 'border-emerald-200' : 'border-blue-200', label: n.is_completed ? '✓ DONE' : '☐ ACTION', lbl: n.is_completed ? 'text-emerald-700' : 'text-blue-700' }
                  : { bg: 'bg-white', border: 'border-slate-200', label: null, lbl: '' };
                return (
                  <div key={n.id} className={'mb-2 rounded-xl border ' + kindStyle.bg + ' ' + kindStyle.border + ' p-3'}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="font-bold text-slate-700">{authorName(n.author_id)}</span>
                        <span className="text-slate-400">{new Date(n.created_at).toLocaleString()}</span>
                        {n.updated_at && n.updated_at !== n.created_at && <span className="text-slate-400 italic">(edited)</span>}
                        {kindStyle.label && <span className={'font-bold ' + kindStyle.lbl}>{kindStyle.label}</span>}
                        {n._legacy && <span className="font-bold text-slate-400">(legacy)</span>}
                      </div>
                      {canEditNote(n) && editingNoteId !== n.id && (
                        <div className="flex gap-1">
                          {n.note_kind === 'action_item' && (
                            <button onClick={() => toggleActionItem(n)} title={n.is_completed ? 'Reopen' : 'Mark done'}
                              className="text-[10px] px-1.5 py-0.5 rounded hover:bg-white/60">
                              {n.is_completed ? '↺' : '✓'}
                            </button>
                          )}
                          <button onClick={() => { setEditingNoteId(n.id); setEditingNoteDraft(n.note_text); }}
                            className="text-[10px] px-1.5 py-0.5 rounded hover:bg-white/60">✏️</button>
                          <button onClick={() => deleteNote(n.id)}
                            className="text-[10px] px-1.5 py-0.5 rounded hover:bg-red-100 text-red-500">🗑</button>
                        </div>
                      )}
                    </div>
                    {editingNoteId === n.id ? (
                      <div>
                        <textarea value={editingNoteDraft} onChange={e => setEditingNoteDraft(e.target.value)}
                          rows={3} className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
                        <div className="flex gap-1 mt-1">
                          <button onClick={saveEditedNote} className="px-2 py-1 bg-emerald-500 text-white rounded text-[10px] font-bold">Save</button>
                          <button onClick={() => { setEditingNoteId(null); setEditingNoteDraft(''); }} className="px-2 py-1 bg-slate-200 rounded text-[10px]">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">{n.note_text}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Composer */}
            <div className="border-t-2 border-emerald-200 p-3 bg-white">
              {/* S18.5 — prominent "Add new note" banner so user knows the
                  bottom composer is for appending to the thread, not editing
                  the existing ones above. */}
              {notesThread.length > 0 && (
                <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded text-[11px] text-emerald-800 font-semibold">
                  <span>➕</span>
                  <span>Add a new note — existing notes above stay untouched</span>
                </div>
              )}
              <div className="flex gap-1 mb-2">
                {[
                  ['note', '📝 Note'],
                  ['action_item', '☐ Action'],
                  ['decision', '💡 Decision'],
                ].map(([v, l]) => (
                  <button key={v} onClick={() => setNewNoteKind(v)}
                    className={'px-2 py-1 rounded text-[10px] font-bold ' + (newNoteKind === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600')}>
                    {l}
                  </button>
                ))}
              </div>
              <textarea value={meetingNotes} onChange={e => setMeetingNotes(e.target.value)}
                placeholder={newNoteKind === 'action_item' ? 'Describe the action item...' : newNoteKind === 'decision' ? 'What was decided?' : 'Add a note to the meeting...'}
                rows={3} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg mb-2" />
              <div className="flex gap-2">
                <button onClick={postNewNote} disabled={notesPosting || !meetingNotes.trim()}
                  className="flex-1 px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm font-bold disabled:opacity-40">
                  {notesPosting ? 'Posting...' : notesEvent.completed ? '+ Add Note' : '✓ Check In & Post Note'}
                </button>
                {!notesEvent.completed && (
                  <button onClick={checkInWithNotes}
                    className="px-3 py-2 border-2 border-emerald-500 text-emerald-600 rounded-lg text-sm font-bold"
                    title="Mark attended without adding a note">
                    ✓ Just Check In
                  </button>
                )}
              </div>
              <div className="text-[9px] text-slate-400 mt-1 text-center">All notes visible to team · Each post archived to Daily Log</div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Edit Event Modal — basic fields only (R1/R2 prep) */}
      {editEvent && (() => {
        const isSeriesItem = !!editEvent.series_id;
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={closeEditEvent}>
          {/* v54.4 — Modal is now SCROLLABLE.
              Before: max-w-md with no height cap → on laptops/phones with
              a recurring event, the full form + Cancel/Delete/Decline
              buttons didn't fit and the bottom of the modal was cut off
              by the viewport. User reported "no cancel button".
              Fix: max-h-[90vh] + overflow-y-auto so the modal scrolls when
              content overflows. */}
          <div className="bg-white rounded-2xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto my-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">✏️ Edit Event / تعديل الحدث</h3>
            <div className="text-sm text-slate-500 mb-3">{editEvent.title} — {editEvent.event_date}</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="text-[10px] font-semibold">Title / العنوان</label>
                <input value={editForm.title||''} onChange={e=>setEditForm({...editForm,title:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
              <div><label className="text-[10px] font-semibold">Date / التاريخ</label>
                <input type="date" value={editForm.eventDate||''} onChange={e=>setEditForm({...editForm,eventDate:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
              <div><label className="text-[10px] font-semibold">Time / الوقت</label>
                <input type="time" value={editForm.eventTime||''} onChange={e=>setEditForm({...editForm,eventTime:e.target.value})} disabled={!!editForm.allDay} className={'w-full px-3 py-2 rounded border text-sm ' + (editForm.allDay ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : '')} title={editForm.allDay ? 'Time is disabled for all-day events' : ''} /></div>
              {/* v55 Stage 1 — All-day toggle. Mirrors Add form. When on,
                  the time input above becomes disabled and event_time is
                  cleared on save. */}
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer select-none">
                  <input type="checkbox" checked={!!editForm.allDay}
                    onChange={e => setEditForm({ ...editForm, allDay: e.target.checked, eventTime: e.target.checked ? '' : editForm.eventTime })}
                    className="w-4 h-4" />
                  <span>🌅 All-day event / حدث طوال اليوم</span>
                </label>
              </div>
              {/* v55 Stage 1 — Location, optional. */}
              <div className="col-span-2"><label className="text-[10px] font-semibold">📍 Location / المكان</label>
                <input value={editForm.location||''} onChange={e=>setEditForm({...editForm,location:e.target.value})}
                  placeholder="e.g. KTC office, Cairo Marriott, online..."
                  className="w-full px-3 py-2 rounded border text-sm" /></div>
              {/* v55 Stage 1 — Join link, optional. */}
              <div className="col-span-2"><label className="text-[10px] font-semibold">🔗 Join Meeting Link</label>
                <input value={editForm.joinLink||''} onChange={e=>setEditForm({...editForm,joinLink:e.target.value})}
                  placeholder="https://zoom.us/j/... or any meeting URL"
                  className="w-full px-3 py-2 rounded border text-sm" /></div>
            </div>
            {isSeriesItem && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <label className="text-[10px] font-semibold text-amber-800 block mb-2">Apply changes to / تطبيق التغييرات على</label>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-xs">
                    <input type="radio" name="editScope" checked={editScope==='single'} onChange={()=>setEditScope('single')} />
                    <span>This occurrence only / هذه المرة فقط</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs opacity-60" title="Coming in Session 3 (R2)">
                    <input type="radio" disabled />
                    <span>This and following / هذه وما بعدها <span className="text-[9px] text-amber-600">(Session 3)</span></span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="radio" name="editScope" checked={editScope==='series'} onChange={()=>setEditScope('series')} />
                    <span>All in series / كل التكرارات</span>
                  </label>
                </div>
                {editScope === 'series' && (
                  <div className="text-[10px] text-amber-700 mt-2">Note: title/time apply to all occurrences. Date change applies only to this row to avoid merging all occurrences to a single day.</div>
                )}
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={saveEditEvent} className="flex-1 px-4 py-2.5 bg-emerald-500 text-white rounded-lg text-sm font-bold">💾 Save / حفظ</button>
              <button onClick={closeEditEvent} className="px-4 py-2.5 border-2 border-slate-300 rounded-lg text-sm font-bold">Close / إغلاق</button>
            </div>
            {/* v54.1/v54.3 — Meeting lifecycle actions. Different buttons
                appear depending on the user's relationship to the event:
                - Creator, primary assignee, super admin → can Cancel (soft)
                - Super admin only → can Delete (hard, permanent)
                - Non-creator attendees → can Decline
                - Already declined → can Accept (undecline)
                - Already cancelled → can Restore */}
            <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
              {/* v54.5 — ALWAYS show these buttons. Previously they were
                  hidden behind canCancel/canDecline/canDelete predicates,
                  so a user who didn't pass the check saw NO button and
                  reported "where's delete?". Now buttons always render;
                  the click handler enforces permission and shows a clear
                  toast. Easier to debug, easier to discover. */}
              {editEvent.status === 'cancelled' ? (
                <button
                  onClick={uncancelMeeting}
                  className="w-full px-4 py-2 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg text-xs font-semibold hover:bg-emerald-100"
                >
                  ♻️ {lang === 'ar' ? 'استعادة الاجتماع الملغى' : 'Restore this cancelled meeting'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      // v55.25 — permission check happens BEFORE entering the
                      // confirmation stage. With the toast context now properly
                      // wired, users without permission get a clear toast
                      // instead of silent failure.
                      if (!canCancel(editEvent)) {
                        if (toast) toast.error(lang === 'ar' ? 'لا يمكنك إلغاء هذا الاجتماع' : 'You cannot cancel this meeting (only the creator, primary assignee, or admin can)');
                        return;
                      }
                      setActionStage('cancel');
                    }}
                    className="w-full px-4 py-2 bg-red-50 border-2 border-red-400 text-red-700 rounded-lg text-sm font-bold hover:bg-red-100 hover:border-red-500"
                  >
                    ❌ {lang === 'ar' ? 'إلغاء الاجتماع' : 'Cancel this meeting'}
                  </button>
                  {canDecline(editEvent) && (
                    <button
                      onClick={declineInvite}
                      className="w-full px-4 py-2 bg-orange-50 border-2 border-orange-400 text-orange-700 rounded-lg text-sm font-bold hover:bg-orange-100"
                      title={lang === 'ar' ? 'رفض الدعوة وإشعار المنظم بالبريد' : 'Decline and email the organizer'}
                    >
                      🚫 {lang === 'ar' ? 'رفض الدعوة' : 'Decline invitation'}
                    </button>
                  )}
                  {hasDeclined(editEvent) && (
                    <button
                      onClick={undeclineInvite}
                      className="w-full px-4 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100"
                    >
                      ✓ {lang === 'ar' ? 'قبول الدعوة (كنت قد رفضتها)' : 'Accept invitation (you had declined)'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!canDelete(editEvent)) {
                        if (toast) toast.error(lang === 'ar' ? 'الحذف الكامل متاح فقط للمشرف الأعلى' : 'Hard delete is super-admin only');
                        return;
                      }
                      setActionStage('delete');
                    }}
                    className="w-full px-4 py-2 bg-slate-900 border-2 border-slate-900 text-white rounded-lg text-sm font-bold hover:bg-black"
                    title={lang === 'ar' ? 'حذف كامل (لا يمكن استعادته)' : 'Permanent delete — no recovery'}
                  >
                    🗑 {lang === 'ar' ? 'حذف كامل نهائي' : 'DELETE permanently'}
                  </button>
                </>
              )}
              {editEvent.status === 'cancelled' && editEvent.cancellation_reason && (
                <div className="mt-2 text-[10px] text-slate-500 italic">
                  {lang === 'ar' ? 'السبب: ' : 'Reason: '}{editEvent.cancellation_reason}
                </div>
              )}
              {/* Show decline roster if any attendees declined */}
              {Array.isArray(editEvent.declined_by) && editEvent.declined_by.length > 0 && (
                <div className="mt-2 text-[10px] text-slate-600">
                  <div className="font-semibold mb-1">{lang === 'ar' ? 'رفضوا الدعوة:' : 'Declined by:'}</div>
                  {editEvent.declined_by.map((uid) => {
                    const u = (users || []).find((x) => x.id === uid);
                    const name = u ? u.name : uid;
                    const reason = editEvent.decline_reasons && editEvent.decline_reasons[uid];
                    return (
                      <div key={uid} className="text-slate-500">
                        • {name}{reason ? ' — ' + reason : ''}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* ============================================================
          v55.25 — PROMINENT CONFIRMATION DIALOGS
          ============================================================
          These dialogs render OUTSIDE and ABOVE the edit modal at z-[200]
          so they're impossible to miss. Previous version used inline
          replacement at the bottom of the edit modal — but on smaller
          screens that area was below the fold and looked like nothing
          happened when the button was clicked.

          - Click outside to dismiss = stays open (user must click Back
            or Confirm — backdrop is decorative, not dismissive)
          - Sticky bright color so it's visually obvious
          - Action button is huge and unmistakable
          - Disabled with reason while busy
          ============================================================ */}
      {actionStage === 'cancel' && editEvent && (
        <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border-4 border-red-500 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="text-3xl">❌</div>
              <div>
                <div className="text-lg font-bold text-red-800">
                  {lang === 'ar' ? 'تأكيد إلغاء الاجتماع' : 'Cancel This Meeting?'}
                </div>
                <div className="text-xs text-slate-600 mt-0.5">{editEvent.title}</div>
              </div>
            </div>

            <div className="text-sm text-slate-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {lang === 'ar'
                ? 'سيبقى الاجتماع في التقويم مع شطب، ويمكن استعادته لاحقاً.'
                : 'The meeting will stay on the calendar (crossed out) and can be restored later if needed.'}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                {lang === 'ar' ? 'سبب الإلغاء (اختياري)' : 'Reason (optional)'}
              </label>
              <input
                type="text"
                value={actionReason}
                onChange={e => setActionReason(e.target.value)}
                placeholder={lang === 'ar' ? 'مثال: تم تأجيله' : 'e.g. rescheduled, customer no-show'}
                className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-300 text-sm bg-white focus:border-red-400 outline-none"
                autoFocus
                disabled={actionBusy}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => { setActionStage('idle'); setActionReason(''); }}
                disabled={actionBusy}
                className="px-4 py-3 border-2 border-slate-300 rounded-lg text-sm font-bold bg-white hover:bg-slate-50 disabled:opacity-50"
              >
                {lang === 'ar' ? 'تراجع' : 'Back'}
              </button>
              <button
                onClick={performCancel}
                disabled={actionBusy}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-50"
              >
                {actionBusy
                  ? (lang === 'ar' ? 'جاري الإلغاء...' : 'Cancelling...')
                  : (lang === 'ar' ? '✓ نعم، ألغِ الاجتماع' : '✓ Yes, Cancel This Meeting')}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionStage === 'delete' && editEvent && (
        <div className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-4">
          <div className="bg-slate-900 text-white rounded-2xl shadow-2xl border-4 border-red-600 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="text-3xl">🗑️</div>
              <div>
                <div className="text-lg font-bold text-red-300">
                  {lang === 'ar' ? 'حذف نهائي — لا يمكن التراجع' : 'Permanent Delete — No Undo'}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{editEvent.title}</div>
              </div>
            </div>

            <div className="text-sm bg-red-900/40 border border-red-600 rounded-lg p-3 text-red-100">
              {lang === 'ar'
                ? 'هذا الاجتماع سيختفي للأبد. لن يكون هناك سجل، ولا سبيل للاستعادة. إذا كنت غير متأكد، اضغط تراجع واستخدم "إلغاء" بدلاً من ذلك.'
                : 'This meeting will be erased forever. There will be no record and no recovery. If you\'re not sure, click Back and use Cancel instead.'}
            </div>

            <div>
              <label className="text-xs font-semibold text-red-300 block mb-1">
                {lang === 'ar' ? 'اكتب DELETE تماماً للتأكيد:' : 'Type DELETE exactly to confirm:'}
              </label>
              <input
                type="text"
                value={actionTyped}
                onChange={e => setActionTyped(e.target.value)}
                placeholder="DELETE"
                className="w-full px-3 py-2.5 rounded-lg border-2 border-red-500 text-sm bg-slate-800 text-white font-mono tracking-widest text-center outline-none focus:border-red-400"
                autoFocus
                disabled={actionBusy}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => { setActionStage('idle'); setActionTyped(''); }}
                disabled={actionBusy}
                className="px-4 py-3 border-2 border-slate-500 rounded-lg text-sm font-bold bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50"
              >
                {lang === 'ar' ? 'تراجع' : 'Back'}
              </button>
              <button
                onClick={performDelete}
                disabled={actionBusy || actionTyped !== 'DELETE'}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {actionBusy
                  ? (lang === 'ar' ? 'جاري الحذف...' : 'Deleting...')
                  : (lang === 'ar' ? '🗑 احذف نهائياً' : '🗑 Delete Forever')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
