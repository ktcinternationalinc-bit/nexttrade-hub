'use client';
import { useState, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';

const EVENT_TYPES = [{v:'task',l:'Task / مهمة',c:'#3b82f6'},{v:'meeting',l:'Meeting / اجتماع',c:'#8b5cf6'},{v:'call',l:'Call / مكالمة',c:'#f59e0b'},{v:'visit',l:'Visit / زيارة',c:'#10b981'}];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

export default function CalendarTab({ customers, user, onReload }) {
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('month');
  const [curDate, setCurDate] = useState(new Date());
  const [selDate, setSelDate] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selEvent, setSelEvent] = useState(null);
  const [f, setF] = useState({});

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

  const monthEvents = useMemo(() => {
    const prefix = year + '-' + String(month + 1).padStart(2, '0');
    return events.filter(e => (e.event_date || '').startsWith(prefix));
  }, [events, year, month]);

  const dayEvents = (day) => {
    const ds = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    return events.filter(e => e.event_date === ds);
  };

  const selectedDayEvents = selDate ? events.filter(e => e.event_date === selDate) : [];

  const prevMonth = () => setCurDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurDate(new Date(year, month + 1, 1));

  const handleAddEvent = async () => {
    if (!f.title || !f.eventDate) return;
    try {
      await dbInsert('calendar_events', {
        title: f.title, event_date: f.eventDate, event_time: f.eventTime || null,
        event_type: f.eventType || 'task', assigned_to: user?.id,
        customer_id: f.customerId || null, recurring: f.recurring || 'none',
        recurring_end: f.recurringEnd || null,
      }, user?.id);
      setShowAdd(false); setF({}); loadEvents();
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  const completeEvent = async (ev) => {
    try {
      await dbUpdate('calendar_events', ev.id, { completed: true }, user?.id);
      loadEvents();
    } catch (err) { alert('Error / خطأ: ' + err.message); }
  };

  return (
    <div>
      <div className="flex justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-xl font-extrabold">Calendar / التقويم</h2>
        <div className="flex gap-2 items-center">
          <button onClick={() => setView(view === 'month' ? 'day' : 'month')}
            className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold">{view === 'month' ? 'Day View' : 'Month View'}</button>
          <button onClick={() => { setShowAdd(true); setF({eventDate: selDate || todayStr}); }}
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
              <div><label className="text-[10px] font-semibold">Recurring End</label>
                <input type="date" value={f.recurringEnd||''} onChange={e=>setF({...f,recurringEnd:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
            )}
            <div><label className="text-[10px] font-semibold">Client / العميل</label>
              <select value={f.customerId||''} onChange={e=>setF({...f,customerId:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
                <option value="">None</option>
                {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAddEvent} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold">Save / حفظ</button>
            <button onClick={()=>setShowAdd(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel / إلغاء</button>
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
          {(events.filter(e => e.event_date === (selDate || todayStr))).length > 0 ? (
            events.filter(e => e.event_date === (selDate || todayStr)).sort((a,b) => (a.event_time||'').localeCompare(b.event_time||'')).map(ev => {
              const tc = EVENT_TYPES.find(t=>t.v===ev.event_type)?.c || '#3b82f6';
              return (
                <div key={ev.id} className={'flex justify-between items-center p-3 rounded-lg mb-2 border ' + (ev.completed ? 'opacity-50' : '')} style={{borderColor:tc,background:tc+'10'}}>
                  <div>
                    <div className={'text-sm font-bold ' + (ev.completed ? 'line-through' : '')}>{ev.title}</div>
                    <div className="text-[10px] text-slate-500">{ev.event_time || 'All day'} | {ev.event_type}</div>
                  </div>
                  {!ev.completed && <button onClick={() => completeEvent(ev)} className="px-2 py-1 bg-emerald-500 text-white rounded text-[10px]">Done / تم</button>}
                </div>
              );
            })
          ) : (
            <div className="text-center text-slate-400 text-sm py-6">No events / لا توجد أحداث</div>
          )}
        </div>
      )}

      {/* Selected Date Events */}
      {view === 'month' && selDate && selectedDayEvents.length > 0 && (
        <div className="bg-white rounded-xl p-4 mt-3">
          <h3 className="text-sm font-bold mb-2">{selDate}</h3>
          {selectedDayEvents.sort((a,b) => (a.event_time||'').localeCompare(b.event_time||'')).map(ev => {
            const tc = EVENT_TYPES.find(t=>t.v===ev.event_type)?.c || '#3b82f6';
            return (
              <div key={ev.id} className={'flex justify-between items-center p-2 rounded mb-1 ' + (ev.completed ? 'opacity-50' : '')} style={{background:tc+'10'}}>
                <div>
                  <div className={'text-xs font-semibold ' + (ev.completed ? 'line-through' : '')}>{ev.title}</div>
                  <div className="text-[10px] text-slate-500">{ev.event_time || 'All day'} | {ev.event_type}{ev.recurring && ev.recurring !== 'none' ? ' | \u{1F504} ' + ev.recurring : ''}</div>
                </div>
                {!ev.completed && <button onClick={() => completeEvent(ev)} className="px-2 py-0.5 bg-emerald-500 text-white rounded text-[10px]">Done</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
