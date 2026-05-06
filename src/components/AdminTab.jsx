'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { filterActiveUsers } from '../lib/active-users';
import { supabase, dbUpdate, dbDelete } from '../lib/supabase';
import HRReport from './HRReport';
import EmailStatusPanel from './EmailStatusPanel';

const STATUS_COLORS = {New:'#3b82f6',Acknowledged:'#8b5cf6','In Progress':'#f59e0b',Waiting:'#6b7280',Review:'#ec4899',Testing:'#14b8a6',Ready:'#10b981',Closed:'#374151',Reopened:'#ef4444'};
const CAT_ICONS = { ticket:'🎫', crm:'🤝', shipping:'🛳️', customs:'🚢', calendar:'📅', finance:'💰', inventory:'📦', communication:'📬', ai:'🤖', manual:'✏️', other:'⚡', login:'🟢' };
const CAT_COLORS = { ticket:'#8b5cf6', crm:'#0ea5e9', shipping:'#10b981', customs:'#f59e0b', calendar:'#ec4899', finance:'#6366f1', inventory:'#14b8a6', communication:'#38bdf8', ai:'#a78bfa', manual:'#3b82f6', other:'#94a3b8', login:'#22c55e' };
const CAT_LABELS = { ticket:'Tickets', crm:'CRM', shipping:'Shipping', customs:'Customs', calendar:'Calendar', finance:'Finance', inventory:'Inventory', communication:'Comms', ai:'AI', manual:'Notes', other:'System', login:'Logins' };
const PIPELINE_STAGES = [
  { v: 'lead', l: 'Lead', c: '#94a3b8', icon: '🔘' },
  { v: 'contacted', l: 'Contacted', c: '#3b82f6', icon: '📞' },
  { v: 'qualified', l: 'Qualified', c: '#8b5cf6', icon: '✅' },
  { v: 'proposal', l: 'Proposal', c: '#f59e0b', icon: '📋' },
  { v: 'negotiation', l: 'Negotiation', c: '#ec4899', icon: '🤝' },
  { v: 'won', l: 'Won / Deal', c: '#10b981', icon: '🏆' },
  { v: 'lost', l: 'Lost', c: '#ef4444', icon: '❌' },
];

export default function AdminTab({ user, userProfile, users, isAdmin, customers, modulePerms }) {
  const [logs, setLogs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [rates, setRates] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [annAcks, setAnnAcks] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loginSummary, setLoginSummary] = useState([]);  // user_login_summary view (ET-aware)
  // v55.61 — Track whether the login_events table is set up. If the SQL
  // wasn't run, every user appears "Offline" forever even when they're
  // actively using the portal. We need to surface this clearly to admins
  // instead of silently lying about who's online.
  var [loginSummaryWarning, setLoginSummaryWarning] = useState(null);
  const [msgFilter, setMsgFilter] = useState('all');
  const [loaded, setLoaded] = useState(false);
  const [selUser, setSelUser] = useState('all');
  const [section, setSection] = useState('scorecards');
  const [auditFilter, setAuditFilter] = useState('all');
  const [drillStage, setDrillStage] = useState(null);
  const [drillUser, setDrillUser] = useState(null);
  const [bubbleDrill, setBubbleDrill] = useState(null); // { userId, type, label } — open when not null
  const [viewTicket, setViewTicket] = useState(null);
  const [ticketComments, setTicketComments] = useState([]);
  const [dateFrom, setDateFrom] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()));
  const [dateTo, setDateTo] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()));
  const [datePreset, setDatePreset] = useState('today'); // today | yesterday | 7d | 30d | 3mo | all | custom
  const drillRef = useRef(null);

  const myId = userProfile?.id || user?.id;
  const isSuperAdmin = userProfile?.role === 'super_admin';
  const canSeeHR = isSuperAdmin || (modulePerms && modulePerms['HR Report'] === true);
  const getUserName = (id) => (users || []).find(u => u.id === id)?.name || '';

  // Helper: resolve UUIDs in text to human-readable names
  const resolveIds = (text) => {
    if (!text || typeof text !== 'string') return text || '';
    let resolved = text;
    (users || []).forEach(u => {
      if (u.id && u.name) resolved = resolved.replaceAll(u.id, u.name);
    });
    return resolved;
  };

  // Helper: resolve UUID values in audit log objects
  const resolveAuditValue = (key, val) => {
    if (!val) return String(val);
    const s = String(val);
    const idFields = ['assigned_to', 'created_by', 'updated_by', 'user_id', 'changed_by', 'sales_rep', 'posted_by'];
    if (idFields.includes(key)) {
      const name = getUserName(s);
      return name || s.substring(0, 8) + '…';
    }
    // If value looks like a UUID, try to resolve
    if (s.match(/^[0-9a-f]{8}-[0-9a-f]{4}-/i)) {
      const name = getUserName(s);
      if (name) return name;
      // Try to find ticket
      const ticket = tickets.find(t => t.id === s);
      if (ticket) return ticket.ticket_number || ticket.title?.substring(0, 30);
    }
    return s.substring(0, 50);
  };

  // Open ticket detail popup with comments
  const openTicketDetail = async (ticket) => {
    setViewTicket(ticket);
    try {
      const { data } = await supabase.from('ticket_comments').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: true });
      setTicketComments(data || []);
    } catch(e) { setTicketComments([]); }
  };

  // Filter visible team members based on role
  const visibleUsers = useMemo(() => {
    if (!users) return [];
    // v55.62 — Stricter "active" check: a user counts as active only if
    // active is explicitly true OR undefined (legacy rows that never had
    // the column set). null and false BOTH disqualify them. Reported by
    // Max May 7 2026: deactivated users were still appearing on the admin
    // scorecard after v55.61 deployed. Root cause: a deactivated user with
    // active=NULL passed the `u.active !== false` test (NULL !== false is
    // true). New test rejects NULL too.
    var activeOnly = users.filter(function (u) {
      if (!u) return false;
      // active is either true, false, or null. Anything not strictly !== true
      // when present is treated as inactive — UNLESS the column was never set
      // (undefined), in which case we keep the row to preserve legacy data.
      if (u.active === false) return false;
      if (u.active === null) return false;
      return true;
    });
    if (isSuperAdmin) return activeOnly;
    // Admin/manager sees only direct reports (still active-only)
    return activeOnly.filter(u => u.reports_to === myId || u.id === myId);
  }, [users, myId, isSuperAdmin]);

  const loadData = async () => {
    try { const { data } = await supabase.from('daily_log').select('*').gte('log_date', dateFrom).lte('log_date', dateTo).order('created_at', { ascending: false }).limit(1000); setLogs(data || []); } catch(e) { console.warn(e); }
    try { const { data } = await supabase.from('tickets').select('*').order('created_at', { ascending: false }); setTickets(data || []); } catch(e) { console.warn(e); }
    try { const { data } = await supabase.from('shipping_rates').select('id, vendor_name, origin, destination, rate_amount, currency, created_at').order('created_at', { ascending: false }).limit(500); setRates(data || []); } catch(e) { console.warn(e); }
    try { const { data } = await supabase.from('shipping_quotes').select('id, quote_number, customer_name, total_amount, created_at, created_by').order('created_at', { ascending: false }).limit(500); setQuotes(data || []); } catch(e) { console.warn(e); }
    try { const { data } = await supabase.from('audit_log').select('*').gte('created_at', dateFrom + 'T00:00:00').order('created_at', { ascending: false }).limit(300); setAuditLogs(data || []); } catch(e) { console.warn(e); }
    try { const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(100); setAnnouncements(data || []); } catch(e) { console.warn(e); }
    try { const { data } = await supabase.from('announcement_acks').select('*'); setAnnAcks(data || []); } catch(e) { console.warn(e); }
    try { const { data } = await supabase.from('user_sessions').select('*').gte('date', dateFrom).lte('date', dateTo).order('login_at', { ascending: false }).limit(500); setSessions(data || []); } catch(e) { console.warn(e); }
    // Load ET-timezone-aware login summary (separate endpoint reads the SQL view)
    try {
      const r = await fetch('/api/login-event?summary=1');
      const d = await r.json();
      if (d && d.summary) setLoginSummary(d.summary);
      // v55.61 — Surface the "table not found" warning so admin can run SQL
      if (d && d.warning) setLoginSummaryWarning(d.warning);
      else setLoginSummaryWarning(null);
    } catch(e) { console.warn('login summary unavailable:', e.message); }
    setLoaded(true);
  };

  useEffect(() => { if (!loaded) loadData(); }, [loaded]);

  // Poll login_summary every 60s so Team Activity feels realtime.
  // Refreshes only the login-summary slice (not the whole dataset) — cheap call.
  useEffect(() => {
    const refreshLoginSummary = async () => {
      try {
        const r = await fetch('/api/login-event?summary=1');
        const d = await r.json();
        if (d && d.summary) setLoginSummary(d.summary);
        if (d && d.warning) setLoginSummaryWarning(d.warning);
        else setLoginSummaryWarning(null);
      } catch (e) { /* non-fatal — next tick will retry */ }
    };
    const id = setInterval(refreshLoginSummary, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const handleDateChange = (field, value) => { if (field === 'from') setDateFrom(value); else setDateTo(value); setDatePreset('custom'); setLoaded(false); };

  // Apply one of the preset date ranges. ET-aware so "today" is today in New York.
  const applyDatePreset = (preset) => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
    const todayET = fmt.format(new Date());
    const shiftDays = (n) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return fmt.format(d);
    };
    setDatePreset(preset);
    if (preset === 'today') { setDateFrom(todayET); setDateTo(todayET); }
    else if (preset === 'yesterday') { const y = shiftDays(1); setDateFrom(y); setDateTo(y); }
    else if (preset === '7d') { setDateFrom(shiftDays(6)); setDateTo(todayET); }
    else if (preset === '30d') { setDateFrom(shiftDays(29)); setDateTo(todayET); }
    else if (preset === '3mo') { setDateFrom(shiftDays(89)); setDateTo(todayET); }
    else if (preset === 'all') { setDateFrom('2020-01-01'); setDateTo(todayET); }
    setLoaded(false);
  };
  const todayStr = new Date().toISOString().substring(0, 10);

  // Enhanced scorecards
  const scorecards = useMemo(() => {
    return visibleUsers.map(u => {
      const uLogs = logs.filter(l => l.user_id === u.id);
      const autoCount = uLogs.filter(l => l.auto_generated).length;
      const manualCount = uLogs.filter(l => !l.auto_generated).length;
      const uniqueDays = [...new Set(uLogs.map(l => l.log_date))].length;

      // Tickets
      const myTickets = tickets.filter(t => t.assigned_to === u.id);
      const openT = myTickets.filter(t => t.status !== 'Closed').length;
      const closedT = myTickets.filter(t => t.status === 'Closed').length;
      const createdT = tickets.filter(t => t.created_by === u.id).length;

      // Overdue analysis
      const overdueNow = myTickets.filter(t => t.due_date && t.due_date < todayStr && t.status !== 'Closed');
      const overdueCount = overdueNow.length;
      // Count all tickets that were ever overdue (closed after due date)
      const closedOverdue = myTickets.filter(t => t.status === 'Closed' && t.due_date && t.closed_at && new Date(t.closed_at) > new Date(t.due_date + 'T23:59:59'));
      const totalTimesOverdue = overdueCount + closedOverdue.length;
      // Average overdue days
      var totalOverdueDays = 0;
      var overdueItemCount = 0;
      overdueNow.forEach(function(t) {
        var days = Math.floor((Date.now() - new Date(t.due_date).getTime()) / 86400000);
        totalOverdueDays += days;
        overdueItemCount++;
      });
      closedOverdue.forEach(function(t) {
        var days = Math.floor((new Date(t.closed_at).getTime() - new Date(t.due_date).getTime()) / 86400000);
        if (days > 0) { totalOverdueDays += days; overdueItemCount++; }
      });
      var avgOverdueDays = overdueItemCount > 0 ? Math.round(totalOverdueDays / overdueItemCount) : 0;

      // Rates & Quotes (approximation - check if user created them via audit or direct match)
      // We'll count rates where the audit shows this user created them
      var ratesCompleted = 0;
      var quotesCompleted = 0;
      try {
        var userAudits = auditLogs.filter(function(a) { return a.changed_by === u.id; });
        ratesCompleted = userAudits.filter(function(a) { return a.table_name === 'shipping_rates' && a.action === 'create'; }).length;
        quotesCompleted = quotes.filter(function(q) { return q.created_by === u.id; }).length;
      } catch(e) { console.warn(e); }

      // Category breakdown
      const catCounts = {};
      uLogs.forEach(l => {
        const c = l.log_category || (l.auto_generated ? 'other' : 'manual');
        catCounts[c] = (catCounts[c] || 0) + 1;
      });
      const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

      return {
        ...u, totalActivities: uLogs.length, autoCount, manualCount, uniqueDays,
        openT, closedT, createdT, overdueCount, totalTimesOverdue, avgOverdueDays,
        ratesCompleted, quotesCompleted, topCats
      };
    }).sort((a, b) => b.totalActivities - a.totalActivities);
  }, [visibleUsers, logs, tickets, quotes, auditLogs, todayStr]);

  // Filtered data
  const filteredLogs = useMemo(() => { let arr = logs; if (selUser !== 'all') arr = arr.filter(l => l.user_id === selUser); return arr; }, [logs, selUser]);
  const filteredTickets = useMemo(() => { let arr = tickets; if (selUser !== 'all') arr = arr.filter(t => t.assigned_to === selUser || t.created_by === selUser); return arr; }, [tickets, selUser]);
  const filteredAudit = useMemo(() => { let arr = auditLogs; if (selUser !== 'all') arr = arr.filter(a => a.changed_by === selUser); return arr; }, [auditLogs, selUser]);
  const filteredSessions = useMemo(() => { let arr = sessions; if (selUser !== 'all') arr = arr.filter(s => s.user_id === selUser); return arr; }, [sessions, selUser]);
  const selUserName = selUser !== 'all' ? getUserName(selUser) : 'All Team';

  return (<div>
    <h2 className="text-xl font-extrabold mb-3">Admin Dashboard / لوحة الإدارة</h2>

    {/* v55.46 — Resend health + test-email so admin can verify email is
        actually working end-to-end. Renders as a status pill with stats
        + a Send-test-email-to-me button. */}
    <EmailStatusPanel
      userId={userProfile?.id || user?.id}
      userEmail={userProfile?.email || user?.email}
      userName={userProfile?.name}
    />

    {/* Filters */}
    <div className="flex gap-2 flex-wrap mb-3 items-center">
      <select value={selUser} onChange={e => setSelUser(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold">
        <option value="all">👥 All Team ({visibleUsers.length})</option>
        {visibleUsers.map(u => <option key={u.id} value={u.id}>👤 {u.name} ({u.role})</option>)}
      </select>
      <div className="flex gap-1 rounded-lg border border-slate-200 p-0.5 bg-slate-50">
        {[
          ['today', 'Today'],
          ['yesterday', 'Yesterday'],
          ['7d', 'Last 7d'],
          ['30d', 'Last 30d'],
          ['3mo', 'Last 3mo'],
          ['all', 'All time'],
        ].map(([k, label]) => (
          <button key={k} onClick={() => applyDatePreset(k)}
            className={'px-2.5 py-1 rounded-md text-[11px] font-semibold transition ' +
              (datePreset === k ? 'bg-blue-500 text-white shadow' : 'text-slate-600 hover:bg-white')}>
            {label}
          </button>
        ))}
        <button onClick={() => setDatePreset('custom')}
          className={'px-2.5 py-1 rounded-md text-[11px] font-semibold transition ' +
            (datePreset === 'custom' ? 'bg-blue-500 text-white shadow' : 'text-slate-600 hover:bg-white')}>
          Custom
        </button>
      </div>
      {datePreset === 'custom' && (
        <>
          <input type="date" value={dateFrom} onChange={e => handleDateChange('from', e.target.value)} className="px-2 py-1.5 rounded border text-xs" />
          <span className="text-xs text-slate-400">to</span>
          <input type="date" value={dateTo} onChange={e => handleDateChange('to', e.target.value)} className="px-2 py-1.5 rounded border text-xs" />
        </>
      )}
      <div className="text-[11px] text-slate-500 font-semibold">
        {dateFrom === dateTo
          ? (dateFrom === new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) ? 'Today (ET)' : dateFrom)
          : (dateFrom + ' → ' + dateTo)}
      </div>
      <button onClick={() => setLoaded(false)} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">Refresh</button>
    </div>

    {/* Section tabs */}
    <div className="flex gap-1 mb-3 flex-wrap">
      {[
        ['scorecards','📊 Scorecards'],
        ...(canSeeHR ? [['hr_report','📋 HR Report']] : []),
        ['pipeline','🏆 Sales Pipeline'],
        ['logins','🕐 Logins'],
        ['messages','📢 Messages'],
        ['activity','📋 Activity'],
        ['tickets','🎫 Tickets'],
        ['audit','🔍 Audit'],
      ].map(([v,l]) => (
        <button key={v} onClick={() => setSection(v)}
          className={'px-3 py-1.5 rounded-lg text-xs font-semibold transition ' + (section === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{l}</button>
      ))}
    </div>

    {!isSuperAdmin && visibleUsers.length <= 1 && (
      <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3 border border-amber-200 text-xs text-amber-700">
        You can see your direct reports only. Ask a Super Admin to assign team members to you via the <strong>reports_to</strong> field.
      </div>
    )}

    {/* ===== HR REPORT ===== */}
    {section === 'hr_report' && canSeeHR && (
      <HRReport user={user} userProfile={userProfile} users={users} customers={customers} />
    )}
    {section === 'hr_report' && !canSeeHR && (
      <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3 border border-amber-200 text-xs text-amber-700">
        You don't have permission to view the HR Report. Ask a super admin to enable the "HR Report" permission for you in Settings.
      </div>
    )}

    {/* ===== SCORECARDS ===== */}
    {section === 'scorecards' && (<div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scorecards.map(u => (
          <div key={u.id} onClick={() => {
              const newDrill = drillUser === u.id ? null : u.id;
              setDrillUser(newDrill);
              setSelUser(newDrill || 'all');
              if (newDrill) setTimeout(() => drillRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }}
            className={'bg-white rounded-xl p-5 cursor-pointer border-2 transition hover:shadow-lg ' + (drillUser === u.id ? 'border-blue-500 shadow-lg ring-2 ring-blue-200' : 'border-slate-200')}>
            {/* Header */}
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-base font-extrabold">{u.name}</div>
                <div className="text-[10px]">
                  <span className={'font-semibold ' + (u.role === 'super_admin' ? 'text-red-500' : u.role === 'admin' ? 'text-purple-500' : 'text-blue-500')}>
                    {u.role === 'super_admin' ? '🔴 Super Admin' : u.role === 'admin' ? '🟣 Admin' : '🔵 Team'}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-extrabold">{u.totalActivities}</div>
                <div className="text-[9px] text-slate-400">actions ({dateFrom.substring(5)} – {dateTo.substring(5)})</div>
              </div>
            </div>

            {/* Ticket Metrics — each bubble is clickable to drill into the underlying records */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              <button
                onClick={(e) => { e.stopPropagation(); setBubbleDrill({ userId: u.id, userName: u.name, type: 'inqueue', label: 'In Queue' }); }}
                className="bg-blue-50 rounded-lg p-2 text-center hover:bg-blue-100 hover:ring-2 hover:ring-blue-300 transition cursor-pointer"
                title="Click to see these tickets"
              >
                <div className="text-lg font-bold text-blue-600">{u.openT}</div>
                <div className="text-[8px] text-slate-500 font-semibold">In Queue</div>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setBubbleDrill({ userId: u.id, userName: u.name, type: 'closed', label: 'Closed Tickets' }); }}
                className="bg-emerald-50 rounded-lg p-2 text-center hover:bg-emerald-100 hover:ring-2 hover:ring-emerald-300 transition cursor-pointer"
                title="Click to see these tickets"
              >
                <div className="text-lg font-bold text-emerald-600">{u.closedT}</div>
                <div className="text-[8px] text-slate-500 font-semibold">Closed</div>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setBubbleDrill({ userId: u.id, userName: u.name, type: 'overdue', label: 'Overdue Tickets' }); }}
                className={'rounded-lg p-2 text-center hover:ring-2 transition cursor-pointer ' + (u.overdueCount > 0 ? 'bg-red-50 hover:bg-red-100 hover:ring-red-300' : 'bg-slate-50 hover:bg-slate-100 hover:ring-slate-300')}
                title="Click to see overdue tickets"
              >
                <div className={'text-lg font-bold ' + (u.overdueCount > 0 ? 'text-red-600' : 'text-slate-400')}>{u.overdueCount}</div>
                <div className="text-[8px] text-slate-500 font-semibold">Overdue Now</div>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setBubbleDrill({ userId: u.id, userName: u.name, type: 'created', label: 'Tickets Created' }); }}
                className="bg-purple-50 rounded-lg p-2 text-center hover:bg-purple-100 hover:ring-2 hover:ring-purple-300 transition cursor-pointer"
                title="Click to see tickets this user created"
              >
                <div className="text-lg font-bold text-purple-600">{u.createdT}</div>
                <div className="text-[8px] text-slate-500 font-semibold">Created</div>
              </button>
            </div>

            {/* Rates & Quotes — also clickable */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={(e) => { e.stopPropagation(); setBubbleDrill({ userId: u.id, userName: u.name, type: 'rates', label: 'Rates Added' }); }}
                className="bg-cyan-50 rounded-lg p-2 text-center hover:bg-cyan-100 hover:ring-2 hover:ring-cyan-300 transition cursor-pointer"
                title="Click to see rates added"
              >
                <div className="text-lg font-bold text-cyan-600">{u.ratesCompleted}</div>
                <div className="text-[8px] text-slate-500 font-semibold">Rates Added</div>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setBubbleDrill({ userId: u.id, userName: u.name, type: 'quotes', label: 'Quotes Created' }); }}
                className="bg-amber-50 rounded-lg p-2 text-center hover:bg-amber-100 hover:ring-2 hover:ring-amber-300 transition cursor-pointer"
                title="Click to see quotes created"
              >
                <div className="text-lg font-bold text-amber-600">{u.quotesCompleted}</div>
                <div className="text-[8px] text-slate-500 font-semibold">Quotes Created</div>
              </button>
            </div>

            {/* Overdue History */}
            <div className="flex gap-3 text-[10px] border-t border-slate-100 pt-2 mb-2">
              <span className={u.totalTimesOverdue > 0 ? 'text-red-500 font-bold' : 'text-slate-400'}>
                🚨 {u.totalTimesOverdue} times overdue
              </span>
              <span className={u.avgOverdueDays > 0 ? 'text-orange-500 font-bold' : 'text-slate-400'}>
                ⏱️ {u.avgOverdueDays}d avg overdue
              </span>
            </div>

            {/* Activity breakdown by category */}
            <div className="border-t border-slate-100 pt-2 mb-2">
              <div className="text-[9px] font-bold text-slate-400 mb-1.5">Activity Breakdown</div>
              <div className="flex gap-1.5 flex-wrap">
                {(u.topCats || []).map(([cat, count]) => (
                  <div key={cat} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold"
                    style={{ background: (CAT_COLORS[cat] || '#94a3b8') + '15', color: CAT_COLORS[cat] || '#94a3b8' }}>
                    {CAT_ICONS[cat] || '⚡'} {CAT_LABELS[cat] || cat} <span className="font-extrabold ml-0.5">{count}</span>
                  </div>
                ))}
                {(u.topCats || []).length === 0 && <span className="text-[10px] text-slate-400">No activity</span>}
              </div>
            </div>

            {/* Performance indicator */}
            {u.overdueCount > 2 && <div className="mt-2 px-2 py-1 bg-red-100 border border-red-200 rounded text-[10px] text-red-700 font-bold">⚠️ {u.overdueCount} tickets overdue — needs attention</div>}
            {u.totalActivities === 0 && <div className="mt-2 px-2 py-1 bg-slate-100 border border-slate-200 rounded text-[10px] text-slate-500">No activity in selected period</div>}
          </div>
        ))}
      </div>

      {/* Login Alerts — who didn't log in yesterday */}
      {(() => {
        const yesterday = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
        const dayName = new Date(yesterday).toLocaleDateString('en-US', { weekday: 'long' });
        const day = new Date(yesterday).getDay();
        if (day === 5 || day === 6) return null;
        const loggedInYesterday = new Set(sessions.filter(s => s.date === yesterday).map(s => s.user_id));
        const missing = filterActiveUsers(users).filter(u => !loggedInYesterday.has(u.id) && u.role !== 'super_admin');
        if (!missing.length) return null;
        return (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mt-4">
            <div className="text-sm font-bold text-red-700 mb-2">⚠️ Did Not Login Yesterday ({dayName} {yesterday})</div>
            <div className="flex flex-wrap gap-2">
              {missing.map(u => (
                <span key={u.id} className="px-3 py-1.5 bg-red-100 rounded-lg text-xs font-semibold text-red-800">{u.name}</span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* BUBBLE DRILL-DOWN MODAL — opens when you click any metric bubble on a scorecard.
          Shows the actual tickets / rates / quotes that make up the count. */}
      {bubbleDrill && (() => {
        const uid = bubbleDrill.userId;
        const type = bubbleDrill.type;
        let rows = [];
        let columns = [];
        if (type === 'inqueue') {
          rows = tickets.filter(t => t.assigned_to === uid && t.status !== 'Closed');
          columns = ['ticket_number', 'title', 'status', 'priority', 'due_date'];
        } else if (type === 'closed') {
          rows = tickets.filter(t => t.assigned_to === uid && t.status === 'Closed');
          columns = ['ticket_number', 'title', 'closed_at', 'due_date'];
        } else if (type === 'overdue') {
          rows = tickets.filter(t => t.assigned_to === uid && t.due_date && t.due_date < todayStr && t.status !== 'Closed');
          columns = ['ticket_number', 'title', 'status', 'due_date'];
        } else if (type === 'created') {
          rows = tickets.filter(t => t.created_by === uid);
          columns = ['ticket_number', 'title', 'assigned_to', 'status', 'created_at'];
        } else if (type === 'rates') {
          // Rates are counted via audit — resolve back to the actual rate rows when possible.
          const rateIds = auditLogs
            .filter(a => a.changed_by === uid && a.table_name === 'shipping_rates' && a.action === 'create')
            .map(a => a.record_id);
          rows = rates.filter(r => rateIds.includes(r.id));
          if (rows.length === 0) {
            // Fallback: show the audit rows themselves so user still sees what was created
            rows = auditLogs
              .filter(a => a.changed_by === uid && a.table_name === 'shipping_rates' && a.action === 'create')
              .map(a => ({ id: a.id, vendor_name: '(rate created)', origin: a.record_id, destination: '', created_at: a.created_at }));
          }
          columns = ['vendor_name', 'origin', 'destination', 'rate_amount', 'created_at'];
        } else if (type === 'quotes') {
          rows = quotes.filter(q => q.created_by === uid);
          columns = ['quote_number', 'customer_name', 'total_amount', 'created_at'];
        }

        const friendlyCol = (c) => ({
          ticket_number: 'Ticket #', title: 'Title', status: 'Status', priority: 'Priority',
          due_date: 'Due', closed_at: 'Closed', created_at: 'Created', assigned_to: 'Assigned',
          vendor_name: 'Vendor', origin: 'Origin', destination: 'Destination', rate_amount: 'Rate',
          quote_number: 'Quote #', customer_name: 'Customer', total_amount: 'Total',
        })[c] || c;

        const fmtCell = (col, val) => {
          if (val == null) return '—';
          if (col === 'assigned_to' || col === 'created_by') return getUserName(val) || String(val).substring(0, 8) + '…';
          if (col === 'created_at' || col === 'closed_at') {
            try { return new Date(val).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return String(val); }
          }
          if (col === 'title') return String(val).substring(0, 70);
          if (col === 'total_amount' || col === 'rate_amount') return Number(val).toLocaleString() + ' ' + (val.currency || '');
          return String(val);
        };

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setBubbleDrill(null)}
          >
            <div
              className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
                <div>
                  <div className="text-base font-extrabold text-slate-900">{bubbleDrill.userName} — {bubbleDrill.label}</div>
                  <div className="text-[11px] text-slate-500">{rows.length} {rows.length === 1 ? 'item' : 'items'} · {dateFrom === dateTo ? dateFrom : (dateFrom + ' → ' + dateTo)}</div>
                </div>
                <button
                  onClick={() => setBubbleDrill(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold"
                >
                  ✕ Close
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                {rows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-400">No records to show.</div>
                ) : (
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-50 shadow-sm">
                      <tr>
                        {columns.map(c => (
                          <th key={c} className="px-3 py-2 text-left text-[10px] uppercase font-bold text-slate-500">{friendlyCol(c)}</th>
                        ))}
                        {(type === 'inqueue' || type === 'closed' || type === 'overdue' || type === 'created') && (
                          <th className="px-3 py-2 text-left text-[10px] uppercase font-bold text-slate-500">Action</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                          {columns.map(c => (
                            <td key={c} className="px-3 py-2 text-slate-700">{fmtCell(c, r[c])}</td>
                          ))}
                          {(type === 'inqueue' || type === 'closed' || type === 'overdue' || type === 'created') && (
                            <td className="px-3 py-2">
                              <button
                                onClick={() => { setBubbleDrill(null); openTicketDetail(r); }}
                                className="px-2 py-0.5 rounded bg-blue-500 text-white text-[10px] font-semibold hover:bg-blue-600"
                              >
                                Open
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* DRILL-DOWN: Activity breakdown for selected user */}
      {drillUser && (() => {
        const dUser = (users || []).find(u => u.id === drillUser);
        if (!dUser) return null;
        const uLogs = logs.filter(l => l.user_id === drillUser);
        const todayLogs = uLogs.filter(l => l.log_date === todayStr);
        const uSessions = sessions.filter(s => s.user_id === drillUser).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const catGroups = {};
        todayLogs.forEach(l => {
          const cat = l.log_category || (l.auto_generated ? 'other' : 'manual');
          if (!catGroups[cat]) catGroups[cat] = [];
          catGroups[cat].push(l);
        });
        const catEntries = Object.entries(catGroups).sort((a, b) => b[1].length - a[1].length);
        const byDate = {};
        uLogs.forEach(l => {
          const d = l.log_date || 'unknown';
          if (!byDate[d]) byDate[d] = [];
          byDate[d].push(l);
        });
        const dateEntries = Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0]));

        return (
          <div ref={drillRef} className="mt-6 bg-white rounded-xl border-2 border-blue-400 p-5">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="text-lg font-extrabold text-blue-700">{dUser.name} — Activity Detail</div>
                <div className="text-[10px] text-slate-500">{dUser.role} · {dUser.email}</div>
              </div>
              <button onClick={() => { setDrillUser(null); setSelUser('all'); }} className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold">✕ Close</button>
            </div>

            <div className="mb-4">
              <div className="text-sm font-bold mb-2">📊 Today ({todayStr}) — {todayLogs.length} entries</div>
              {catEntries.length === 0 && <div className="text-xs text-slate-400 bg-slate-50 p-3 rounded">No activity today</div>}
              {catEntries.map(([cat, items]) => (
                <div key={cat} className="mb-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm">{CAT_ICONS[cat] || '⚡'}</span>
                    <span className="text-xs font-bold" style={{ color: CAT_COLORS[cat] || '#64748b' }}>{CAT_LABELS[cat] || cat}</span>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{ background: CAT_COLORS[cat] || '#94a3b8' }}>{items.length}</span>
                  </div>
                  <div className="ml-6 space-y-1">
                    {items.map(l => (
                      <div key={l.id} className="flex justify-between items-start text-[11px] py-1 border-b border-slate-50">
                        <div className="flex-1 text-slate-700">{resolveIds(l.entry_text)}</div>
                        <div className="text-[9px] text-slate-400 ml-2 whitespace-nowrap">{l.log_time || new Date(l.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-4">
              <div className="text-sm font-bold mb-2">🕐 Login History (last 7 days)</div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }, (_, i) => {
                  const d = new Date(); d.setDate(d.getDate() - (6 - i));
                  const ds = d.toISOString().substring(0, 10);
                  const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
                  const sess = uSessions.find(s => s.date === ds);
                  return (
                    <div key={ds} className={'rounded-lg p-2 text-center text-[9px] ' + (sess ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200')}>
                      <div className="font-bold">{dayLabel}</div>
                      <div className="text-[8px] text-slate-400">{ds.substring(5)}</div>
                      <div className="mt-0.5">{sess ? '✅' : '❌'}</div>
                      {sess && <div className="text-[8px] text-emerald-600">{(sess.login_at || '').substring(11, 16)}</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-sm font-bold mb-2">📋 Full Activity Log ({uLogs.length} entries)</div>
              <div className="max-h-[400px] overflow-auto rounded-lg border border-slate-200">
                {dateEntries.map(([date, items]) => (
                  <div key={date}>
                    <div className="sticky top-0 bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-600 border-b">{date} — {items.length} entries</div>
                    {items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map(l => {
                      const cat = l.log_category || (l.auto_generated ? 'other' : 'manual');
                      return (
                        <div key={l.id} className="flex items-start gap-2 px-3 py-1.5 border-b border-slate-50 hover:bg-blue-50/30">
                          <span className="text-[10px] mt-0.5" style={{ color: CAT_COLORS[cat] || '#94a3b8' }}>{CAT_ICONS[cat] || '⚡'}</span>
                          <div className="flex-1 text-[11px] text-slate-700">{resolveIds(l.entry_text)}</div>
                          <div className="text-[9px] text-slate-400 whitespace-nowrap">{l.log_time || new Date(l.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>)}

    {/* ===== SALES PIPELINE ===== */}
    {section === 'pipeline' && (<div>
      {(() => {
        const cust = customers || [];

        // Per-user pipeline stats
        // v55.61 — Filter out deactivated teammates so they don't show on
        // the pipeline-by-rep table with stale assigned counts. Active
        // reps only.
        const pipelineActiveUsers = filterActiveUsers(users);
        const userStats = pipelineActiveUsers.map(u => {
          const assigned = cust.filter(c => c.assigned_rep === u.id);
          const byStage = {};
          PIPELINE_STAGES.forEach(s => { byStage[s.v] = assigned.filter(c => (c.pipeline_stage || 'lead') === s.v).length; });
          return { ...u, assigned: assigned.length, byStage };
        }).filter(u => u.assigned > 0);

        // Overall pipeline
        const overallByStage = {};
        PIPELINE_STAGES.forEach(s => { overallByStage[s.v] = cust.filter(c => (c.pipeline_stage || 'lead') === s.v).length; });

        // Drill-down clients
        const drillClients = drillStage ? cust.filter(c =>
          (c.pipeline_stage || 'lead') === drillStage &&
          (!drillUser || c.assigned_rep === drillUser)
        ) : [];

        return (<div>
          {/* Overall funnel */}
          <div className="bg-white rounded-xl p-4 mb-3">
            <h3 className="text-sm font-bold mb-3">Overall Pipeline / خط المبيعات</h3>
            <div className="flex gap-1 flex-wrap">
              {PIPELINE_STAGES.map(s => (
                <button key={s.v} onClick={() => { setDrillStage(s.v); setDrillUser(null); }}
                  className={'px-3 py-2 rounded-lg text-xs font-bold transition flex-1 min-w-[80px] text-center ' + (drillStage === s.v && !drillUser ? 'text-white shadow' : '')}
                  style={drillStage === s.v && !drillUser ? { background: s.c } : { background: s.c + '15', color: s.c }}>
                  <div className="text-lg">{overallByStage[s.v]}</div>
                  <div className="text-[9px]">{s.icon} {s.l}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Per-user breakdown */}
          <div className="bg-white rounded-xl p-4 mb-3">
            <h3 className="text-sm font-bold mb-3">By Team Member / حسب الفريق</h3>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead><tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left font-bold">Rep</th>
                  <th className="px-3 py-2 text-center font-bold">Total</th>
                  {PIPELINE_STAGES.map(s => <th key={s.v} className="px-2 py-2 text-center" style={{color:s.c}}>{s.icon}</th>)}
                </tr></thead>
                <tbody>
                  {userStats.map(u => (
                    <tr key={u.id} className="border-b border-slate-50">
                      <td className="px-3 py-2 font-semibold">{u.name}</td>
                      <td className="px-3 py-2 text-center font-bold">{u.assigned}</td>
                      {PIPELINE_STAGES.map(s => (
                        <td key={s.v} className="px-2 py-2 text-center">
                          {u.byStage[s.v] > 0 ? (
                            <button onClick={() => { setDrillStage(s.v); setDrillUser(u.id); }}
                              className="px-2 py-0.5 rounded font-bold text-white text-[10px]" style={{background:s.c}}>
                              {u.byStage[s.v]}
                            </button>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Drill-down */}
          {drillStage && (
            <div className="bg-white rounded-xl p-4 mb-3">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-bold">
                  {PIPELINE_STAGES.find(s=>s.v===drillStage)?.icon} {PIPELINE_STAGES.find(s=>s.v===drillStage)?.l}
                  {drillUser && ' — ' + (users?.find(u=>u.id===drillUser)?.name || '')}
                  <span className="text-slate-400 ml-1">({drillClients.length})</span>
                </h3>
                <button onClick={() => { setDrillStage(null); setDrillUser(null); }} className="px-2 py-1 border rounded text-xs">Close</button>
              </div>
              <div className="space-y-1 max-h-[300px] overflow-auto">
                {drillClients.map(c => {
                  const rep = users?.find(u => u.id === c.assigned_rep);
                  return (
                    <div key={c.id} className="flex justify-between items-center py-2 px-2 border-b border-slate-50 hover:bg-slate-50 rounded">
                      <div>
                        <div className="text-xs font-bold" style={{direction:'rtl'}}>{c.name_en || c.name}</div>
                        <div className="text-[10px] text-slate-500">{c.industry || ''} {c.group_name ? '· ' + c.group_name : ''}</div>
                      </div>
                      <div className="text-right">
                        {rep && <div className="text-[10px] text-indigo-600 font-semibold">{rep.name}</div>}
                        {c.phone && <div className="text-[10px] text-slate-400">{c.phone}</div>}
                      </div>
                    </div>
                  );
                })}
                {drillClients.length === 0 && <div className="text-xs text-slate-400 text-center py-4">No clients in this stage</div>}
              </div>
            </div>
          )}
        </div>);
      })()}
    </div>)}

    {/* ===== ACTIVITY FEED ===== */}
    {section === 'messages' && (<div>
      <div className="bg-white rounded-xl p-4">
        <h3 className="text-sm font-bold mb-3">📢 All Announcements / Messages ({announcements.length})</h3>
        <div className="flex gap-1 mb-3">
          {['all', 'active', 'archived'].map(f => (
            <button key={f} onClick={() => setMsgFilter(f)}
              className={'px-2.5 py-1 rounded-lg text-[10px] font-semibold ' + (msgFilter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>
              {f === 'all' ? 'All (' + announcements.length + ')' : f === 'active' ? 'Active (' + announcements.filter(a => a.active !== false).length + ')' : 'Archived (' + announcements.filter(a => a.active === false).length + ')'}
            </button>
          ))}
        </div>
        <div className="space-y-2 max-h-[600px] overflow-auto">
          {announcements.filter(a => {
            if (msgFilter === 'active') return a.active !== false;
            if (msgFilter === 'archived') return a.active === false;
            return true;
          }).map(a => {
            var poster = getUserName(a.posted_by);
            var thisAcks = annAcks.filter(ak => ak.announcement_id === a.id);
            // v55.60 — Only count ACTIVE teammates as targets so deactivated
            // users don't pollute the "not acknowledged" list. Past acks
            // from now-deactivated users still display correctly because
            // the ack row remains in the DB.
            var activeUsers = filterActiveUsers(users);
            var targetUsers = a.target_user ? activeUsers.filter(u => u.id === a.target_user) : activeUsers;
            var ackedUsers = targetUsers.filter(u => thisAcks.some(ak => ak.user_id === u.id));
            var unackedUsers = targetUsers.filter(u => !thisAcks.some(ak => ak.user_id === u.id));
            var priorityStyle = a.priority === 'urgent' ? { bg: '#fef2f2', border: '#ef4444', color: '#dc2626', icon: '🚨' }
              : a.priority === 'warning' ? { bg: '#fffbeb', border: '#f59e0b', color: '#b45309', icon: '⚠️' }
              : { bg: '#eff6ff', border: '#3b82f6', color: '#1d4ed8', icon: 'ℹ️' };
            return (
              <div key={a.id} className="rounded-xl p-4" style={{ background: priorityStyle.bg, border: '1px solid ' + priorityStyle.border }}>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: '0.95rem', fontWeight: 800, color: priorityStyle.color }}>{priorityStyle.icon} {a.title}</span>
                      {a.pinned && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">📌 PINNED</span>}
                      {a.active === false && <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold">ARCHIVED</span>}
                    </div>
                    {a.body && <div style={{ fontSize: '0.8rem', marginTop: '0.3rem', color: '#475569', whiteSpace: 'pre-wrap' }}>{a.body}</div>}
                    <div style={{ fontSize: '0.65rem', marginTop: '0.3rem', color: '#94a3b8' }}>
                      By {poster || 'Admin'} • {new Date(a.created_at).toLocaleString()}
                      {a.target_user ? ' • 👤 Direct to: ' + getUserName(a.target_user) : ' • 👥 Everyone'}
                      {a.send_email && ' • 📧'}{a.send_whatsapp && ' • 💬'}
                    </div>
                    {/* Acknowledgment status */}
                    <div style={{ marginTop: '0.5rem', padding: '6px 10px', background: 'rgba(255,255,255,0.7)', borderRadius: 8 }}>
                      <div className="text-[10px] font-bold text-slate-600 mb-1">
                        Acknowledgments: {ackedUsers.length}/{targetUsers.length}
                        {ackedUsers.length === targetUsers.length && targetUsers.length > 0 && <span className="text-green-600 ml-2">✅ ALL ACKNOWLEDGED</span>}
                      </div>
                      {ackedUsers.length > 0 && (
                        <div className="text-[10px] text-green-600 mb-0.5">
                          ✅ {ackedUsers.map(u => {
                            var ack = thisAcks.find(ak => ak.user_id === u.id);
                            return u.name + (ack ? ' (' + new Date(ack.acked_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ')' : '');
                          }).join(', ')}
                        </div>
                      )}
                      {unackedUsers.length > 0 && (
                        <div className="text-[10px] text-red-600 font-bold">
                          ⏳ Not acknowledged: {unackedUsers.map(u => u.name).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 ml-3">
                    {a.active !== false ? (
                      <button onClick={async () => { try { await dbUpdate('announcements', a.id, { active: false }, user?.id); loadData(); } catch(err) { alert(err.message); } }}
                        className="text-[10px] text-red-500 bg-red-50 px-2 py-1 rounded font-semibold border border-red-200">Archive</button>
                    ) : (
                      <button onClick={async () => { try { await dbUpdate('announcements', a.id, { active: true }, user?.id); loadData(); } catch(err) { alert(err.message); } }}
                        className="text-[10px] text-green-600 bg-green-50 px-2 py-1 rounded font-semibold border border-green-200">Restore</button>
                    )}
                    <button onClick={async () => { try { await dbUpdate('announcements', a.id, { pinned: !a.pinned }, user?.id); loadData(); } catch(err) { alert(err.message); } }}
                      className="text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded font-semibold">{a.pinned ? 'Unpin' : '📌 Pin'}</button>
                    <button onClick={async () => { if (!confirm('Delete this message permanently?')) return; try { await dbDelete('announcements', a.id, user?.id); loadData(); } catch(err) { alert(err.message); } }}
                      className="text-[10px] text-red-400 bg-red-50 px-2 py-1 rounded font-semibold">🗑️ Delete</button>
                  </div>
                </div>
              </div>
            );
          })}
          {announcements.length === 0 && <div className="text-center text-slate-400 text-sm py-6">No messages sent yet</div>}
        </div>
      </div>
    </div>)}

    {section === 'activity' && (<div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#3b82f6'}}><div className="text-[10px] text-slate-500">Activities</div><div className="text-lg font-extrabold">{filteredLogs.length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Auto Actions</div><div className="text-lg font-extrabold">{filteredLogs.filter(l=>l.auto_generated).length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Manual Entries</div><div className="text-lg font-extrabold">{filteredLogs.filter(l=>!l.auto_generated).length}</div></div>
      </div>
      <div className="bg-white rounded-xl p-4">
        <h3 className="text-sm font-bold mb-3">{selUserName} — Activity Feed ({filteredLogs.length})</h3>
        <div className="space-y-1 max-h-[600px] overflow-auto">
          {filteredLogs.map(l => {
            var userName = getUserName(l.user_id);
            var cat = l.log_category || 'other';
            var icons = {ticket:'🎫',crm:'🤝',shipping:'🛳️',customs:'🚢',calendar:'📅',finance:'💰',manual:'✏️',other:'⚡',login:'🟢'};

            // Make ticket numbers clickable in entry_text
            var resolvedText = resolveIds(l.entry_text || '');
            var textParts = resolvedText.split(/(TKT-\d+)/g);

            return (
              <div key={l.id} className="flex items-start gap-2 py-2 border-b border-slate-50">
                <span className="text-sm mt-0.5">{icons[cat] || (l.auto_generated ? '⚡' : '✏️')}</span>
                <div className="flex-1">
                  <div className="text-xs">
                    {textParts.map(function(part, idx) {
                      if (/^TKT-\d+$/.test(part)) {
                        var matchedTicket = tickets.find(function(t) { return t.ticket_number === part; });
                        if (matchedTicket) {
                          return <span key={idx} className="text-blue-600 font-bold cursor-pointer hover:underline" onClick={function() { openTicketDetail(matchedTicket); }}>{part}</span>;
                        }
                        return <span key={idx} className="text-blue-500 font-bold">{part}</span>;
                      }
                      return <span key={idx}>{part}</span>;
                    })}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    <span className="text-blue-500 font-semibold mr-2">{userName}</span>
                    {l.log_date} {l.log_time ? l.log_time.substring(0, 5) : ''}
                    {cat !== 'other' && <span className="ml-2 px-1 py-0.5 bg-slate-100 rounded text-[9px]">{cat}</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredLogs.length === 0 && <div className="text-center text-slate-400 text-sm py-6">No activity</div>}
        </div>
      </div>
    </div>)}

    {/* ===== TICKETS VIEW ===== */}
    {section === 'tickets' && (<div>
      <div className="grid grid-cols-4 gap-3 mb-3">
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#3b82f6'}}><div className="text-[10px] text-slate-500">Open</div><div className="text-lg font-extrabold">{filteredTickets.filter(t=>t.status!=='Closed').length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Overdue</div><div className="text-lg font-extrabold text-red-500">{filteredTickets.filter(t=>t.due_date&&t.due_date<todayStr&&t.status!=='Closed').length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Closed</div><div className="text-lg font-extrabold">{filteredTickets.filter(t=>t.status==='Closed').length}</div></div>
        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}><div className="text-[10px] text-slate-500">Total</div><div className="text-lg font-extrabold">{filteredTickets.length}</div></div>
      </div>
      <div className="bg-white rounded-xl p-4">
        <h3 className="text-sm font-bold mb-3">{selUserName} — Tickets</h3>
        <div className="overflow-auto max-h-[500px] rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0"><tr className="bg-slate-50">
              <th className="px-2 py-2 text-[10px] text-left">#</th>
              <th className="px-2 py-2 text-[10px] text-left">Title</th>
              <th className="px-2 py-2 text-[10px]">Status</th>
              <th className="px-2 py-2 text-[10px]">Priority</th>
              <th className="px-2 py-2 text-[10px] text-left">Assigned</th>
              <th className="px-2 py-2 text-[10px] text-left">Created By</th>
              <th className="px-2 py-2 text-[10px]">Due</th>
            </tr></thead>
            <tbody>
              {filteredTickets.filter(t=>t.status!=='Closed').concat(filteredTickets.filter(t=>t.status==='Closed').slice(0,20)).map(t => {
                var isOverdue = t.due_date && t.due_date < todayStr && t.status !== 'Closed';
                return (
                  <tr key={t.id} className={'border-b border-slate-50 cursor-pointer hover:bg-blue-50 ' + (isOverdue ? 'bg-red-50' : t.status === 'Closed' ? 'opacity-50' : '')}
                    onClick={() => openTicketDetail(t)}>
                    <td className="px-2 py-2 text-blue-500 font-mono text-[10px]">{t.ticket_number || '—'}</td>
                    <td className="px-2 py-2 font-semibold max-w-[200px] truncate">{t.title}</td>
                    <td className="px-2 py-2 text-center"><span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{background:STATUS_COLORS[t.status]||'#6b7280'}}>{t.status}</span></td>
                    <td className="px-2 py-2 text-center"><span className={'font-bold ' + (t.priority==='high'?'text-red-500':t.priority==='low'?'text-green-500':'text-amber-500')}>{t.priority}</span></td>
                    <td className="px-2 py-2"><span className={t.assigned_to ? 'text-purple-600 font-semibold' : 'text-red-400'}>{t.assigned_to ? getUserName(t.assigned_to) : 'UNASSIGNED'}</span></td>
                    <td className="px-2 py-2 text-[10px]">{getUserName(t.created_by) || '—'}</td>
                    <td className={'px-2 py-2 text-center ' + (isOverdue ? 'text-red-600 font-bold' : '')}>{t.due_date || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>)}

    {/* ===== AUDIT LOG ===== */}
    {section === 'audit' && (<div>
      <div className="bg-white rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">{selUserName} — Audit Log ({filteredAudit.length})</h3>
          <div className="flex gap-1">
            <button onClick={() => setAuditFilter('all')} className={'px-2 py-1 rounded text-[10px] font-semibold ' + (auditFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100')}>All</button>
            <button onClick={() => setAuditFilter('late')} className={'px-2 py-1 rounded text-[10px] font-semibold ' + (auditFilter === 'late' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600')}>🚨 Late Edits</button>
            <button onClick={() => setAuditFilter('sensitive')} className={'px-2 py-1 rounded text-[10px] font-semibold ' + (auditFilter === 'sensitive' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-600')}>⚠️ Sensitive</button>
            <button onClick={() => setAuditFilter('delete')} className={'px-2 py-1 rounded text-[10px] font-semibold ' + (auditFilter === 'delete' ? 'bg-red-600 text-white' : 'bg-slate-100')}>🗑️ Deletes</button>
          </div>
        </div>
        {(() => { var lateEdits = filteredAudit.filter(a => a.is_late_edit && a.action === 'update'); return lateEdits.length > 0 ? (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl p-3 mb-3">
            <div className="text-sm font-extrabold text-red-700">🚨 {lateEdits.length} Late Edit{lateEdits.length > 1 ? 's' : ''} Detected</div>
            <div className="text-[10px] text-red-600">Changes made 24+ hours after original entry</div>
          </div>
        ) : null; })()}
        <div className="space-y-1 max-h-[600px] overflow-auto">
          {filteredAudit.filter(a => {
            if (auditFilter === 'late') return a.is_late_edit;
            if (auditFilter === 'sensitive') return a.sensitive_fields_changed && a.sensitive_fields_changed.length > 0;
            if (auditFilter === 'delete') return a.action === 'delete';
            return true;
          }).map(a => {
            var userName = getUserName(a.changed_by);
            var actionColors = { create: 'text-emerald-600', update: 'text-blue-600', delete: 'text-red-600' };
            var actionIcons = { create: '✨', update: '✏️', delete: '🗑️' };
            var isLate = a.is_late_edit;
            var hasSensitive = a.sensitive_fields_changed && a.sensitive_fields_changed.length > 0;

            // Resolve ticket reference
            var linkedTicket = null;
            var friendlyTarget = a.table_name || '';
            if (a.table_name === 'tickets' && a.record_id) {
              linkedTicket = tickets.find(t => t.id === a.record_id);
              if (linkedTicket) friendlyTarget = (linkedTicket.ticket_number || 'Ticket') + ' — ' + (linkedTicket.title || '').substring(0, 40);
            } else if (a.table_name === 'ticket_comments' && a.new_values) {
              var ticketId = typeof a.new_values === 'object' ? a.new_values.ticket_id : null;
              if (ticketId) linkedTicket = tickets.find(t => t.id === ticketId);
              if (linkedTicket) friendlyTarget = 'Comment on ' + (linkedTicket.ticket_number || 'Ticket') + ' — ' + (linkedTicket.title || '').substring(0, 30);
              else friendlyTarget = 'Ticket Comment';
            }

            // Build user-friendly change summary for updates
            var changeSummary = null;
            if (a.action === 'update' && a.new_values && typeof a.new_values === 'object') {
              var parts = [];
              Object.entries(a.new_values).forEach(function(entry) {
                var key = entry[0]; var val = entry[1];
                if (['updated_at','last_seen','created_at'].includes(key)) return;
                var label = key.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
                var resolved = resolveAuditValue(key, val);
                parts.push({ label: label, value: resolved });
              });
              if (parts.length > 0) changeSummary = parts;
            }

            return (
              <div key={a.id} className={'py-2.5 border-b ' + (isLate ? 'border-red-200 bg-red-50/50' : hasSensitive ? 'border-amber-200 bg-amber-50/30' : 'border-slate-50')}>
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <span>{actionIcons[a.action] || '📋'}</span>
                  <span className={'font-bold ' + (actionColors[a.action] || '')}>{(a.action||'').toUpperCase()}</span>
                  {isLate && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[9px] font-extrabold">🚨 LATE EDIT ({a.hours_since_creation || '24+'}h)</span>}
                  {hasSensitive && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-bold">⚠️ {a.sensitive_fields_changed.join(', ')}</span>}
                  <span className={'font-bold ' + (actionColors[a.action] || '')}>{(a.action||'').toUpperCase()}</span>
                  {linkedTicket ? (
                    <span className="text-blue-600 font-semibold cursor-pointer hover:underline" onClick={() => openTicketDetail(linkedTicket)}>
                      🎫 {friendlyTarget}
                    </span>
                  ) : (
                    <span className="text-slate-500">{friendlyTarget}</span>
                  )}
                  <span className="text-blue-500 font-semibold ml-auto">{userName}</span>
                  <span className="text-slate-400">{a.created_at ? new Date(a.created_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : ''}</span>
                </div>

                {/* User-friendly change details */}
                {changeSummary && (
                  <div className="mt-1.5 flex gap-2 flex-wrap">
                    {changeSummary.slice(0, 5).map(function(ch, idx) {
                      return (
                        <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 rounded text-[10px]">
                          <span className="text-slate-400">{ch.label}:</span>
                          <span className="font-bold text-slate-700">{ch.value}</span>
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Fallback for create actions — show key fields */}
                {a.action === 'create' && a.new_values && !changeSummary && (
                  <div className="text-[10px] text-slate-500 mt-1 bg-slate-50 rounded p-1.5 max-h-[60px] overflow-auto">
                    {typeof a.new_values === 'object' ? Object.entries(a.new_values).filter(function(e) { return !['id','created_at','updated_at'].includes(e[0]); }).slice(0, 4).map(function(entry) {
                      return <span key={entry[0]} className="mr-2"><span className="text-slate-400">{entry[0].replace(/_/g,' ')}:</span> <span className="font-semibold">{resolveAuditValue(entry[0], entry[1])}</span></span>;
                    }) : resolveIds(String(a.new_values).substring(0, 200))}
                  </div>
                )}
              </div>
            );
          })}
          {filteredAudit.length === 0 && <div className="text-center text-slate-400 text-sm py-6">No audit entries</div>}
        </div>
      </div>
    </div>)}

    {/* ===== LOGIN HISTORY ===== */}
    {section === 'logins' && (<div>
      {(() => {
        // Group sessions by date
        const byDate = {};
        filteredSessions.forEach(s => {
          const d = s.date || (s.login_at ? s.login_at.substring(0, 10) : 'unknown');
          if (!byDate[d]) byDate[d] = [];
          byDate[d].push(s);
        });
        const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

        // Summary stats
        const totalLogins = filteredSessions.length;
        const autoLogouts = filteredSessions.filter(s => s.logout_reason === 'auto_timeout').length;
        const manualLogouts = filteredSessions.filter(s => s.logout_reason === 'manual').length;
        const avgSessionMins = (() => {
          const durations = filteredSessions.filter(s => s.login_at && s.logout_at).map(s => (new Date(s.logout_at) - new Date(s.login_at)) / 60000);
          return durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
        })();

        return (<>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Total Logins</div><div className="text-lg font-extrabold text-emerald-600">{totalLogins}</div></div>
            <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#3b82f6'}}><div className="text-[10px] text-slate-500">Manual Logouts</div><div className="text-lg font-extrabold">{manualLogouts}</div></div>
            <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Auto Timeouts</div><div className="text-lg font-extrabold text-red-500">{autoLogouts}</div></div>
            <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Avg Session</div><div className="text-lg font-extrabold">{avgSessionMins}m</div></div>
          </div>

          {/* Per-user daily breakdown */}
          {selUser === 'all' && (
            <div className="bg-white rounded-xl p-4 mb-3">
              <h3 className="text-sm font-bold mb-3">👥 Team Login Summary</h3>

              {/* v55.61 — Warning banner when login_events table isn't set up.
                  Without it, the Online column shows everyone as Offline forever
                  even when actively using the portal. Reported by Max May 7
                  2026: "admin page.. login. why is online status offline if I
                  am online". */}
              {loginSummaryWarning && (
                <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3 mb-3">
                  <div className="font-bold text-amber-900 text-xs mb-1">⚠️ Online status not working — database setup needed</div>
                  <div className="text-[11px] text-amber-800 mb-2">
                    Everyone shows as "Offline" because the login-events table doesn't exist in Supabase yet. To fix:
                    open Supabase → SQL Editor → New query, paste the SQL from <code className="bg-amber-100 px-1 rounded">supabase/login-events.sql</code> in the project repo, click Run. Then refresh this page. Logins from this point forward will track correctly.
                  </div>
                  <div className="text-[10px] font-mono bg-amber-100 text-amber-900 p-2 rounded border border-amber-200 break-all">
                    Server returned: {loginSummaryWarning}
                  </div>
                </div>
              )}
              <div className="overflow-auto max-h-[300px] rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0"><tr className="bg-slate-50">
                    <th className="px-3 py-2 text-[10px] text-left">Team Member</th>
                    <th className="px-3 py-2 text-[10px] text-center" title="Online if heartbeat within last 10 min">Status</th>
                    <th className="px-3 py-2 text-[10px] text-center" title="Logins today (Eastern Time, midnight–midnight)">Today (ET)</th>
                    <th className="px-3 py-2 text-[10px] text-center" title="Logins yesterday (ET)">Yesterday (ET)</th>
                    <th className="px-3 py-2 text-[10px] text-center" title="Logins in last 7 ET days">7 days (ET)</th>
                    <th className="px-3 py-2 text-[10px] text-center">Logins (range)</th>
                    <th className="px-3 py-2 text-[10px] text-center">Days Active</th>
                    <th className="px-3 py-2 text-[10px] text-center">Auto Timeouts</th>
                    <th className="px-3 py-2 text-[10px] text-center">Avg Session</th>
                    <th className="px-3 py-2 text-[10px] text-left">Last Login</th>
                  </tr></thead>
                  <tbody>
                    {visibleUsers.map(u => {
                      const uSess = sessions.filter(s => s.user_id === u.id);
                      const uAuto = uSess.filter(s => s.logout_reason === 'auto_timeout').length;
                      const uDays = [...new Set(uSess.map(s => s.date))].length;
                      const uDurations = uSess.filter(s => s.login_at && s.logout_at).map(s => (new Date(s.logout_at) - new Date(s.login_at)) / 60000);
                      const uAvg = uDurations.length > 0 ? Math.round(uDurations.reduce((a, b) => a + b, 0) / uDurations.length) : 0;
                      // ET-aware data from user_login_summary view
                      const lsRow = loginSummary.find(l => l.id === u.id) || {};
                      const lastLoginAt = lsRow.last_login_at || uSess[0]?.login_at;
                      const lastLogin = lastLoginAt ? new Date(lastLoginAt).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
                      const isOnline = !!lsRow.is_online;
                      // Belt-and-suspenders: if login_events count is 0 but the user actually has an
                      // active session today (from the older user_sessions table), use the session count.
                      // Prevents the "0 logins today" bug when login_events writes fail silently.
                      const etTodayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
                      const etYesterdayStr = (function() { const d = new Date(); d.setDate(d.getDate() - 1); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d); })();
                      const sessionsTodayCount = uSess.filter(s => (s.date || '') === etTodayStr).length;
                      const sessionsYesterdayCount = uSess.filter(s => (s.date || '') === etYesterdayStr).length;
                      const todayET = Math.max(Number(lsRow.logins_today_et || 0), sessionsTodayCount);
                      const yesterdayET = Math.max(Number(lsRow.logins_yesterday_et || 0), sessionsYesterdayCount);
                      const sevenDayET = Number(lsRow.logins_last_7d_et || 0);
                      return (
                        <tr key={u.id} className="border-b border-slate-50 hover:bg-blue-50 cursor-pointer" onClick={() => setSelUser(u.id)}>
                          <td className="px-3 py-2 font-semibold">{u.name}</td>
                          <td className="px-3 py-2 text-center">
                            {isOnline
                              ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">🟢 Online</span>
                              : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">⚪ Offline</span>}
                          </td>
                          <td className="px-3 py-2 text-center font-bold text-blue-600">{todayET}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{yesterdayET}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{sevenDayET}</td>
                          <td className="px-3 py-2 text-center font-bold text-emerald-600">{uSess.length}</td>
                          <td className="px-3 py-2 text-center">{uDays}</td>
                          <td className="px-3 py-2 text-center"><span className={uAuto > 0 ? 'text-red-500 font-bold' : 'text-slate-400'}>{uAuto}</span></td>
                          <td className="px-3 py-2 text-center">{uAvg}m</td>
                          <td className="px-3 py-2 text-slate-500">{lastLogin}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daily session log */}
          <div className="bg-white rounded-xl p-4">
            <h3 className="text-sm font-bold mb-3">🕐 {selUserName} — Daily Login Archive</h3>
            <div className="space-y-3 max-h-[500px] overflow-auto">
              {dates.map(date => {
                const daySessions = byDate[date];
                const dayAutoLogouts = daySessions.filter(s => s.logout_reason === 'auto_timeout').length;
                return (
                  <div key={date} className="border border-slate-100 rounded-lg overflow-hidden">
                    <div className="bg-slate-50 px-3 py-2 flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-700">📅 {date} <span className="text-slate-400 font-normal">({new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })})</span></span>
                      <div className="flex gap-3 text-[10px]">
                        <span className="text-emerald-600 font-semibold">🟢 {daySessions.length} login{daySessions.length !== 1 ? 's' : ''}</span>
                        {dayAutoLogouts > 0 && <span className="text-red-500 font-bold">⏱️ {dayAutoLogouts} auto-timeout{dayAutoLogouts !== 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {daySessions.map((s, i) => {
                        const loginTime = s.login_at ? new Date(s.login_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '—';
                        const logoutTime = s.logout_at ? new Date(s.logout_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '—';
                        const duration = s.login_at && s.logout_at ? Math.round((new Date(s.logout_at) - new Date(s.login_at)) / 60000) : null;
                        const isTimeout = s.logout_reason === 'auto_timeout';
                        return (
                          <div key={s.id || i} className="px-3 py-2 flex items-center gap-3 text-xs">
                            <span className="text-blue-600 font-semibold min-w-[80px]">{getUserName(s.user_id) || 'Unknown'}</span>
                            <span className="text-emerald-600 font-mono">🟢 {loginTime}</span>
                            <span className="text-slate-300">→</span>
                            <span className={isTimeout ? 'text-red-500 font-bold font-mono' : 'text-slate-500 font-mono'}>
                              {isTimeout ? '⏱️' : '🔴'} {logoutTime}
                            </span>
                            {duration !== null && <span className="text-slate-400 text-[10px]">({duration}m)</span>}
                            {isTimeout && <span className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-[9px] font-bold">AUTO TIMEOUT</span>}
                            {s.logout_reason === 'manual' && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[9px] font-bold">CLOCKED OUT</span>}
                            {!s.logout_at && <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[9px] font-bold animate-pulse">ACTIVE</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {dates.length === 0 && <div className="text-center text-slate-400 text-sm py-6">No login records found</div>}
            </div>
          </div>
        </>);
      })()}
    </div>)}

    {/* ===== TICKET DETAIL POPUP ===== */}
    {viewTicket && (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setViewTicket(null)}>
        <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="p-4 border-b border-slate-100 flex justify-between items-start">
            <div>
              <div className="text-xs font-mono text-blue-500 font-bold mb-0.5">{viewTicket.ticket_number || '—'}</div>
              <h3 className="text-base font-extrabold">{viewTicket.title}</h3>
            </div>
            <div className="flex gap-2 items-start">
              {/* S18.4 — Deep-link to Tickets tab. Max: from Admin he wants
                  a way to click through into a specific ticket so he can add
                  a comment, reassign, etc. Dispatching briefing-open-ticket
                  reuses the existing handler in page.jsx. */}
              <button
                onClick={() => {
                  try {
                    window.dispatchEvent(new CustomEvent('briefing-open-ticket', { detail: { ticket_id: viewTicket.id } }));
                  } catch(e){}
                  setViewTicket(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-bold hover:bg-blue-600"
                title="Jump to this ticket in the Tickets tab to comment, reassign, or change status"
              >↗ Open in Tickets</button>
              <button onClick={() => setViewTicket(null)} className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 text-lg font-bold">✕</button>
            </div>
          </div>

          <div className="p-4 overflow-auto" style={{ maxHeight: 'calc(85vh - 120px)' }}>
            {/* Status / Priority / Dates */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div><div className="text-[9px] text-slate-400 uppercase font-semibold">Status</div><span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{background:STATUS_COLORS[viewTicket.status]||'#6b7280'}}>{viewTicket.status}</span></div>
              <div><div className="text-[9px] text-slate-400 uppercase font-semibold">Priority</div><span className={'text-sm font-bold ' + (viewTicket.priority==='high'?'text-red-500':viewTicket.priority==='low'?'text-green-500':'text-amber-500')}>{viewTicket.priority || '—'}</span></div>
              <div><div className="text-[9px] text-slate-400 uppercase font-semibold">Assigned To</div><div className="text-xs font-semibold text-purple-600">{getUserName(viewTicket.assigned_to) || 'Unassigned'}</div></div>
              <div><div className="text-[9px] text-slate-400 uppercase font-semibold">Created By</div><div className="text-xs font-semibold">{getUserName(viewTicket.created_by) || '—'}</div></div>
              <div><div className="text-[9px] text-slate-400 uppercase font-semibold">Due Date</div><div className={'text-xs font-semibold ' + (viewTicket.due_date && viewTicket.due_date < todayStr ? 'text-red-600' : '')}>{viewTicket.due_date || '—'}</div></div>
              <div><div className="text-[9px] text-slate-400 uppercase font-semibold">Created</div><div className="text-xs text-slate-500">{viewTicket.created_at ? new Date(viewTicket.created_at).toLocaleDateString() : '—'}</div></div>
            </div>

            {/* Description */}
            {viewTicket.description && (
              <div className="mb-4">
                <div className="text-[9px] text-slate-400 uppercase font-semibold mb-1">Description</div>
                <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{viewTicket.description}</div>
              </div>
            )}

            {/* Attachments */}
            {viewTicket.attachments && viewTicket.attachments.length > 0 && (
              <div className="mb-4">
                <div className="text-[9px] text-slate-400 uppercase font-semibold mb-1">📎 Attachments</div>
                <div className="space-y-1">
                  {(Array.isArray(viewTicket.attachments) ? viewTicket.attachments : []).map((att, i) => (
                    <a key={i} href={att.url || att} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg text-xs text-blue-600 font-semibold hover:bg-blue-100">
                      📄 {att.name || att.filename || `Attachment ${i + 1}`}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Comments / Notes */}
            <div>
              <div className="text-[9px] text-slate-400 uppercase font-semibold mb-2">💬 Notes & Updates ({ticketComments.length})</div>
              {ticketComments.length > 0 ? (
                <div className="space-y-2 max-h-[250px] overflow-auto">
                  {ticketComments.map(c => (
                    <div key={c.id} className={'rounded-lg p-3 text-xs ' + (c.is_system ? 'bg-slate-50 border border-slate-100' : 'bg-blue-50 border border-blue-100')}>
                      <div className="flex justify-between mb-1">
                        <span className="font-bold" style={{ color: c.is_system ? '#64748b' : '#2563eb' }}>
                          {c.is_system ? '🤖 System' : '💬 ' + (getUserName(c.created_by) || 'User')}
                        </span>
                        <span className="text-[10px] text-slate-400">{c.created_at ? new Date(c.created_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : ''}</span>
                      </div>
                      <div className="text-slate-600 whitespace-pre-wrap">{c.comment_text}</div>
                    </div>
                  ))}
                </div>
              ) : <div className="text-xs text-slate-400 py-3 text-center">No notes yet</div>}
            </div>
          </div>
        </div>
      </div>
    )}
  </div>);
}
