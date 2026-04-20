'use client';
import { useState, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { notifyEventScheduled } from '../lib/notify';

const EVENT_TYPES = [{v:'task',l:'Task / مهمة',c:'#3b82f6'},{v:'meeting',l:'Meeting / اجتماع',c:'#8b5cf6'},{v:'call',l:'Call / مكالمة',c:'#f59e0b'},{v:'visit',l:'Visit / زيارة',c:'#10b981'}];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

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
  const myId = userProfile?.id;

  const loadEvents = async () => {
    const { data } = await supabase.from('calendar_events').select('*').order('event_date');
    setEvents(data || []);
    setLoaded(true);
  };

  if (!loaded) loadEvents();

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
      for (const uid of assignees) {
        await dbInsert('calendar_events', {
          title: f.title, event_date: f.eventDate, event_time: f.eventTime || null,
          event_type: f.eventType || 'task', assigned_to: uid,
          customer_id: f.customerId || null, recurring: f.recurring || 'none',
          recurring_end: f.recurringEnd || null,
        }, myId);
      }
      await logActivity(myId, 'Created ' + (f.eventType || 'task') + ': ' + f.title + ' on ' + f.eventDate, 'calendar');
      const otherAssignees = assignees.filter(uid => uid !== myId);
      if (otherAssignees.length) notifyEventScheduled(otherAssignees, f.title, f.eventDate, myId);
      setShowAdd(false); setF({}); setSelectedUsers([]); loadEvents();
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const markEventStatus = async (ev, status) => {
    try {
      await dbUpdate('calendar_events', ev.id, { completed: status === 'attended', event_status: status }, myId);
      var logText = (ev.event_type || 'Event') + ' "' + ev.title + '" — ' + status;
      await logActivity(myId, logText, 'calendar');
      loadEvents();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const completeEvent = async (ev) => {
    try {
      await dbUpdate('calendar_events', ev.id, { completed: true, event_status: 'attended' }, myId);
      await logActivity(myId, 'Attended ' + (ev.event_type || 'event') + ': ' + ev.title, 'calendar');
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
      setNotesEvent(null); setMeetingNotes(''); loadEvents();
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
          <button onClick={() => { setShowAdd(true); setF({eventDate: selDate || todayStr}); setSelectedUsers([]); }}
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
            <div><label className="text-[10px] font-semibold">Recurring / متكرر</label>
              <select value={f.recurring||'none'} onChange={e=>setF({...f,recurring:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                <option value="none">None / لا</option><option value="daily">Daily / يومي</option>
                <option value="weekly">Weekly / أسبوعي</option><option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly / شهري</option></select></div>
            {f.recurring && f.recurring !== 'none' && (
              <div><label className="text-[10px] font-semibold">Until / حتى</label>
                <input type="date" value={f.recurringEnd||''} onChange={e=>setF({...f,recurringEnd:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            )}
            <div><label className="text-[10px] font-semibold">Client / العميل</label>
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
                    return <div key={ev.id} className={'text-[8px] truncate rounded px-0.5 mb-0.5 ' + (ev.completed ? 'line-through opacity-50' : '')} style={{background:tc+'20',color:tc}}>{ev.title}</div>;
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
                      {ev.recurring && ev.recurring !== 'none' && <span className="ml-1">🔄 {ev.recurring}</span>}
                    </div>
                  </div>
                  {!ev.completed && <div className="flex gap-1">
                    {ev.event_status === 'postponed' ? <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-[10px] font-bold">Postponed</span> : <>
                      <button onClick={() => { setNotesEvent(ev); setMeetingNotes(ev.meeting_notes || ''); }} className="px-2 py-1 bg-emerald-500 text-white rounded text-[10px]">✓ Check In</button>
                      <button onClick={() => markEventStatus(ev, 'postponed')} className="px-2 py-1 bg-amber-500 text-white rounded text-[10px]">⏳ Postpone</button>
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
                    {ev.recurring && ev.recurring !== 'none' ? ' | 🔄 ' + ev.recurring : ''}
                  </div>
                </div>
                {!ev.completed && !ev.event_status && <div className="flex gap-1"><button onClick={() => { setNotesEvent(ev); setMeetingNotes(ev.meeting_notes || ''); }} className="px-2 py-0.5 bg-emerald-500 text-white rounded text-[10px]">✓ Check In</button><button onClick={() => markEventStatus(ev, 'postponed')} className="px-2 py-0.5 bg-amber-500 text-white rounded text-[10px]">⏳</button></div>}
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
      {notesEvent && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setNotesEvent(null)}>
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
              <button onClick={() => setNotesEvent(null)}
                className="px-4 py-2.5 border-2 border-slate-300 rounded-lg text-sm font-bold">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
