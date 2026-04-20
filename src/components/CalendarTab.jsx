'use client';
import { useState, useMemo, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { notifyEventScheduled } from '../lib/notify';
import { newUUID, VALID_PATTERNS } from '../lib/recurrence';
import { scheduleEventReminders, rescheduleEventReminders, cancelEventReminders } from '../lib/reminders';

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

export default function CalendarTab({ customers, user, userProfile, users, onReload }) {
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
  const [meetingNotes, setMeetingNotes] = useState('');
  // R1/R2: editing an existing event (basic: title, date, time). Null = not editing.
  const [editEvent, setEditEvent] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editScope, setEditScope] = useState('single'); // 'single' | 'series'
  const myId = userProfile?.id;

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

  // Filter events based on calView
  const visibleEvents = useMemo(() => {
    if (calView === 'my') return events.filter(e => e.assigned_to === myId || e.created_by === myId);
    return events; // team view shows all
  }, [events, calView, user]);

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

  const handleAddEvent = async () => {
    if (!f.title || !f.eventDate) return;
    try {
      const assignees = selectedUsers.length > 0 ? selectedUsers : [myId];
      const pattern = f.recurring || 'none';
      const isRecurring = pattern !== 'none';
      // Safe-clamp interval. UI enforces 1..99 but we defend against tampered form state.
      const rawInt = Number.isFinite(+f.recurringInterval) ? Math.floor(+f.recurringInterval) : 1;
      const interval = Math.min(99, Math.max(1, rawInt || 1));
      // One series_id per (recurring event, assignee). Non-recurring events get no series_id.
      // A single recurring event spanning multiple assignees creates N parallel series —
      // known pre-R9 architectural limitation (see test section 29.hae.gap.1a).

      const createdIds = [];
      for (const uid of assignees) {
        const payload = {
          title: f.title,
          event_date: f.eventDate,
          event_time: f.eventTime || null,
          event_type: f.eventType || 'task',
          assigned_to: uid,
          customer_id: f.customerId || null,
          recurring: pattern,
          recurring_end: f.recurringEnd || null,
          recurrence_interval: isRecurring ? interval : null,
          series_id: isRecurring ? newUUID() : null,
          is_series_master: isRecurring,
        };
        const row = await dbInsert('calendar_events', payload, myId);
        createdIds.push(row);

        // Schedule reminders for the master occurrence itself
        try {
          await scheduleEventReminders(row, [uid], myId);
        } catch (e) { console.log('[calendar] scheduleEventReminders failed: ' + e.message); }

        // If recurring, fire the generator for this series so the user sees the
        // next occurrences immediately. Fire-and-forget — cron will re-run nightly.
        if (isRecurring && row.series_id) {
          try {
            fetch('/api/events/generate-occurrences', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ series_id: row.series_id }),
            }).catch(() => {});
          } catch (e) { /* swallow */ }
        }
      }

      await logActivity(myId, 'Created ' + (f.eventType || 'task') + ': ' + f.title + ' on ' + f.eventDate
        + (isRecurring ? ' (' + recurrenceLabel(pattern, interval) + ')' : ''), 'calendar');
      const otherAssignees = assignees.filter(uid => uid !== myId);
      if (otherAssignees.length) notifyEventScheduled(otherAssignees, f.title, f.eventDate, myId);
      setShowAdd(false); setF({}); setSelectedUsers([]);
      // Slight delay before reload so the generator has time to write occurrences
      setTimeout(() => { loadEvents(); }, 500);
    } catch (err) { alert('Error / خطأ: ' + err.message); }
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

  const checkInWithNotes = async () => {
    if (!notesEvent) return;
    try {
      var notes = meetingNotes.trim();
      var wasCompleted = !!notesEvent.completed;
      var oldNotes = String(notesEvent.meeting_notes || '').trim();
      var notesChanged = notes !== oldNotes;
      // Build update. If already completed, don't overwrite check-in timestamp/owner —
      // just update the notes. For a fresh check-in, stamp attendance too.
      var update = { meeting_notes: notes || null };
      if (!wasCompleted) {
        update.completed = true;
        update.event_status = 'attended';
        update.checked_in_at = new Date().toISOString();
        update.checked_in_by = myId;
      }
      await dbUpdate('calendar_events', notesEvent.id, update, myId);
      // Archive to daily log ONLY when notes exist and actually changed (first time OR later edit).
      // Prevents duplicate log entries if the user reopens the modal and saves without changes.
      if (notes && notesChanged) {
        var verb = wasCompleted ? '📋 Meeting notes updated — ' : '📋 Meeting notes — ';
        await dbInsert('daily_log', {
          user_id: myId,
          log_date: notesEvent.event_date || new Date().toISOString().substring(0, 10),
          entry_text: verb + notesEvent.title + ': ' + notes,
          log_category: 'meeting',
          auto_generated: false,
        }, myId);
      }
      var logVerb = wasCompleted ? (notesChanged ? 'Updated notes: ' : 'Reviewed notes: ') : 'Checked in: ';
      await logActivity(myId, logVerb + notesEvent.title + (notes && notesChanged ? ' — ' + notes.substring(0, 100) : ''), 'calendar');
      // Cancel pending reminders on first-time check-in (attended)
      if (!wasCompleted) {
        try { await cancelEventReminders(notesEvent.id); } catch (e) { /* swallow */ }
      }
      setNotesEvent(null); setMeetingNotes(''); loadEvents();
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
    });
    setEditScope('single');
  };
  const closeEditEvent = () => { setEditEvent(null); setEditForm({}); setEditScope('single'); };

  const saveEditEvent = async () => {
    if (!editEvent) return;
    const hasDateChange = editForm.eventDate && editForm.eventDate !== editEvent.event_date;
    const hasTimeChange = (editForm.eventTime || null) !== (editEvent.event_time || null);
    const hasTitleChange = (editForm.title || '') !== (editEvent.title || '');
    if (!hasDateChange && !hasTimeChange && !hasTitleChange) { closeEditEvent(); return; }

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
            <div><label className="text-[10px] font-semibold">Date / التاريخ</label>
              <input type="date" value={f.eventDate||''} onChange={e=>setF({...f,eventDate:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            <div><label className="text-[10px] font-semibold">Time / الوقت</label>
              <input type="time" value={f.eventTime||''} onChange={e=>setF({...f,eventTime:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
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
            <button onClick={handleAddEvent} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold">Save / حفظ</button>
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
                    const tc = EVENT_TYPES.find(t=>t.v===ev.event_type)?.c || '#3b82f6';
                    return <div key={ev.id} className={'text-[8px] truncate rounded px-0.5 mb-0.5 ' + (ev.completed ? 'line-through opacity-50' : '')} style={{background:tc+'20',color:tc}}>{ev.series_id ? '🔄 ' : ''}{ev.title}</div>;
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
              const tc = EVENT_TYPES.find(t=>t.v===ev.event_type)?.c || '#3b82f6';
              const assignedName = getUserName(ev.assigned_to);
              return (
                <div key={ev.id} className={'flex justify-between items-center p-3 rounded-lg mb-2 border ' + (ev.completed ? 'opacity-50' : '')} style={{borderColor:tc,background:tc+'10'}}>
                  <div>
                    <div className={'text-sm font-bold ' + (ev.completed ? 'line-through' : '')}>{ev.title}</div>
                    <div className="text-[10px] text-slate-500">
                      {ev.event_time || 'All day'} | {ev.event_type}
                      {calView === 'team' && assignedName && <span className="ml-1 text-purple-600">→ {assignedName}</span>}
                      {ev.recurring && ev.recurring !== 'none' && <span className="ml-1">🔄 {recurrenceLabel(ev.recurring, ev.recurrence_interval)}</span>}
                      {ev.original_event_date && ev.original_event_date !== ev.event_date && <span className="ml-1 text-amber-600" title={'Moved from ' + ev.original_event_date}>↪</span>}
                    </div>
                  </div>
                  {!ev.completed && <div className="flex gap-1">
                    {ev.event_status === 'postponed' ? <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-[10px] font-bold">Postponed</span> : <>
                      <button onClick={() => { setNotesEvent(ev); setMeetingNotes(ev.meeting_notes || ''); }} className="px-2 py-1 bg-emerald-500 text-white rounded text-[10px]">✓ Check In</button>
                      <button onClick={() => markEventStatus(ev, 'postponed')} className="px-2 py-1 bg-amber-500 text-white rounded text-[10px]">⏳ Postpone</button>
                      <button onClick={() => openEditEvent(ev)} title="Edit" className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-[10px]">✏️</button>
                    </>}
                  </div>}
                  {ev.completed && <div className="text-right flex flex-col items-end gap-1">
                    <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">✓ Attended</span>
                    {ev.meeting_notes && <div className="text-[9px] text-slate-500 mt-0.5 max-w-[220px] line-clamp-2" title={ev.meeting_notes}>📝 {ev.meeting_notes}</div>}
                    {/* R3: Always allow adding/editing notes on a completed event */}
                    <button onClick={() => { setNotesEvent(ev); setMeetingNotes(ev.meeting_notes || ''); }}
                      className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[9px] font-semibold">
                      {ev.meeting_notes ? '✏️ Edit Notes' : '📝 Add Notes'}
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
            const tc = EVENT_TYPES.find(t=>t.v===ev.event_type)?.c || '#3b82f6';
            const assignedName = getUserName(ev.assigned_to);
            return (
              <div key={ev.id} className={'flex justify-between items-center p-2 rounded mb-1 ' + (ev.completed ? 'opacity-50' : '')} style={{background:tc+'10'}}>
                <div>
                  <div className={'text-xs font-semibold ' + (ev.completed ? 'line-through' : '')}>{ev.title}</div>
                  <div className="text-[10px] text-slate-500">
                    {ev.event_time || 'All day'} | {ev.event_type}
                    {calView === 'team' && assignedName && <span className="ml-1 text-purple-600">→ {assignedName}</span>}
                    {ev.recurring && ev.recurring !== 'none' ? ' | 🔄 ' + recurrenceLabel(ev.recurring, ev.recurrence_interval) : ''}
                  </div>
                </div>
                {!ev.completed && !ev.event_status && <div className="flex gap-1">
                  <button onClick={() => { setNotesEvent(ev); setMeetingNotes(ev.meeting_notes || ''); }} className="px-2 py-0.5 bg-emerald-500 text-white rounded text-[10px]">✓ Check In</button>
                  <button onClick={() => markEventStatus(ev, 'postponed')} className="px-2 py-0.5 bg-amber-500 text-white rounded text-[10px]">⏳</button>
                  <button onClick={() => openEditEvent(ev)} title="Edit" className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[10px]">✏️</button>
                </div>}
                {ev.event_status === 'postponed' && <span className="text-[9px] text-amber-600 font-bold">Postponed</span>}
                {ev.completed && <div className="flex items-center gap-1">
                  <span className="text-[9px] text-emerald-600 font-bold">✓</span>
                  {/* R3: Always allow editing notes on a completed event */}
                  <button onClick={() => { setNotesEvent(ev); setMeetingNotes(ev.meeting_notes || ''); }}
                    title={ev.meeting_notes ? 'Edit notes / تعديل الملاحظات' : 'Add notes / إضافة ملاحظات'}
                    className="text-[10px] hover:bg-slate-200 rounded px-1">
                    {ev.meeting_notes ? '📝' : '✏️'}
                  </button>
                </div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Check-In / Notes Modal — supports both first-time check-in AND note editing after completion (R3) */}
      {notesEvent && (() => {
        // Single close handler — backdrop AND Cancel both go through here.
        // Previously left meetingNotes stale across opens, so a different event
        // would show the previous draft text.
        const closeModal = () => { setNotesEvent(null); setMeetingNotes(''); };
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">
              {notesEvent.completed
                ? (notesEvent.meeting_notes ? '✏️ Edit Meeting Notes / تعديل الملاحظات' : '📝 Add Meeting Notes / إضافة ملاحظات')
                : '✓ Check In / تسجيل حضور'}
            </h3>
            <div className="text-sm text-slate-500 mb-3">{notesEvent.title} — {notesEvent.event_date} {notesEvent.event_time || ''}</div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">Meeting Notes / ملاحظات الاجتماع</label>
            <textarea value={meetingNotes} onChange={e => setMeetingNotes(e.target.value)}
              placeholder="What was discussed? Action items? Decisions made?&#10;ماذا تمت مناقشته؟ بنود العمل؟ القرارات؟"
              rows={5} className="dark-input mb-3" />
            <div className="text-[10px] text-slate-400 mb-3">
              {notesEvent.completed
                ? 'Changes will be archived to the daily log / سيتم أرشفة التعديلات في السجل اليومي'
                : 'Notes will be saved to the daily log automatically / سيتم حفظ الملاحظات تلقائياً'}
            </div>
            <div className="flex gap-2">
              <button onClick={checkInWithNotes}
                className="flex-1 px-4 py-2.5 bg-emerald-500 text-white rounded-lg text-sm font-bold">
                {notesEvent.completed ? '💾 Save Notes' : '✓ Check In & Save Notes'}
              </button>
              <button onClick={closeModal}
                className="px-4 py-2.5 border-2 border-slate-300 rounded-lg text-sm font-bold">Cancel</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Edit Event Modal — basic fields only (R1/R2 prep) */}
      {editEvent && (() => {
        const isSeriesItem = !!editEvent.series_id;
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeEditEvent}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">✏️ Edit Event / تعديل الحدث</h3>
            <div className="text-sm text-slate-500 mb-3">{editEvent.title} — {editEvent.event_date}</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="text-[10px] font-semibold">Title / العنوان</label>
                <input value={editForm.title||''} onChange={e=>setEditForm({...editForm,title:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
              <div><label className="text-[10px] font-semibold">Date / التاريخ</label>
                <input type="date" value={editForm.eventDate||''} onChange={e=>setEditForm({...editForm,eventDate:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
              <div><label className="text-[10px] font-semibold">Time / الوقت</label>
                <input type="time" value={editForm.eventTime||''} onChange={e=>setEditForm({...editForm,eventTime:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
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
              <button onClick={closeEditEvent} className="px-4 py-2.5 border-2 border-slate-300 rounded-lg text-sm font-bold">Cancel / إلغاء</button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
