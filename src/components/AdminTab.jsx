'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { filterActiveUsers } from '../lib/active-users';
import { supabase, dbUpdate, dbDelete } from '../lib/supabase';
import { fmtET, todayET, yesterdayET, fmtETRange } from '../lib/et-time';
import HRReport from './HRReport';
import AdminHRInbox from './AdminHRInbox';
import EmailStatusPanel from './EmailStatusPanel';
import BackupsPanel from './BackupsPanel';

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
  // v55.81 (Max May 9 2026 #13): rank scorecards by chosen metric.
  // Defaults to overall activity which matches the legacy behavior.
  const [rankBy, setRankBy] = useState('totalActivities');
  const [section, setSection] = useState('scorecards');
  const [auditFilter, setAuditFilter] = useState('all');
  const [drillStage, setDrillStage] = useState(null);
  const [drillUser, setDrillUser] = useState(null);
  const [bubbleDrill, setBubbleDrill] = useState(null); // { userId, type, label } — open when not null
  const [viewTicket, setViewTicket] = useState(null);
  const [ticketComments, setTicketComments] = useState([]);
  const [dateFrom, setDateFrom] = useState(() => todayET());
  const [dateTo, setDateTo] = useState(() => todayET());
  const [datePreset, setDatePreset] = useState('today'); // today | yesterday | 7d | 30d | 3mo | all | custom
  // v55.80 (Phase B / Section 3 — Admin focus mode)
  // ----------------------------------------------------------------
  // viewMode: 'team' (the wide team-scorecard grid, default) vs
  // 'me' (focus on YOUR cards — selUser is auto-set to the viewer).
  // viewMode is global to the Admin tab and persists in localStorage so
  // toggling it survives a refresh. The toggle lives at the top of the
  // tab next to the date filters so it's a single tap to switch.
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'team';
    try { return window.localStorage.getItem('ktc.adminViewMode') || 'team'; }
    catch (e) { return 'team'; }
  });
  // v55.80 (Phase B / Section 6 — pagination)
  // ----------------------------------------------------------------
  // Activity feed and audit log can each grow into hundreds of rows.
  // Render a window: 50 visible, "Load 50 more" extends it. Resets to
  // 50 whenever the filter or selUser changes.
  const ACTIVITY_PAGE = 50;
  const [activityVisible, setActivityVisible] = useState(ACTIVITY_PAGE);
  const [auditVisible, setAuditVisible] = useState(ACTIVITY_PAGE);
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
    // v55.81 (Max May 9 2026 #14): the previous loadData ran 9 queries
    // sequentially via separate await statements. On a slow network each
    // round-trip is 200-500ms, so 9 in series = up to 5 seconds before
    // the UI updated when switching periods. Parallelize them — each
    // query is independent so they can run concurrently. With Promise.all
    // the total time becomes max(query times) instead of sum.
    //
    // Each query keeps its own try/catch so one failure doesn't poison
    // the others (per project rule: independent try/catch per query).
    var queries = [
      // Daily log — date-bounded, capped at 1000
      supabase.from('daily_log').select('*').gte('log_date', dateFrom).lte('log_date', dateTo).order('created_at', { ascending: false }).limit(1000)
        .then(function (r) { setLogs(r.data || []); }).catch(function (e) { console.warn('logs:', e); }),
      // Tickets — all
      supabase.from('tickets').select('*').order('created_at', { ascending: false })
        .then(function (r) { setTickets(r.data || []); }).catch(function (e) { console.warn('tickets:', e); }),
      // Shipping rates — last 500
      supabase.from('shipping_rates').select('id, vendor_name, origin, destination, rate_amount, currency, created_at').order('created_at', { ascending: false }).limit(500)
        .then(function (r) { setRates(r.data || []); }).catch(function (e) { console.warn('rates:', e); }),
      // Quotes — last 500
      supabase.from('shipping_quotes').select('id, quote_number, customer_name, total_amount, created_at, created_by').order('created_at', { ascending: false }).limit(500)
        .then(function (r) { setQuotes(r.data || []); }).catch(function (e) { console.warn('quotes:', e); }),
      // Audit — date-bounded, capped at 300
      supabase.from('audit_log').select('*').gte('created_at', dateFrom + 'T00:00:00').order('created_at', { ascending: false }).limit(300)
        .then(function (r) { setAuditLogs(r.data || []); }).catch(function (e) { console.warn('audit:', e); }),
      // Announcements
      supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(100)
        .then(function (r) { setAnnouncements(r.data || []); }).catch(function (e) { console.warn('announcements:', e); }),
      supabase.from('announcement_acks').select('*')
        .then(function (r) { setAnnAcks(r.data || []); }).catch(function (e) { console.warn('annAcks:', e); }),
      // Sessions — date-bounded, capped at 500
      supabase.from('user_sessions').select('*').gte('date', dateFrom).lte('date', dateTo).order('login_at', { ascending: false }).limit(500)
        .then(function (r) { setSessions(r.data || []); }).catch(function (e) { console.warn('sessions:', e); }),
      // Login summary endpoint
      fetch('/api/login-event?summary=1').then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.summary) setLoginSummary(d.summary);
        if (d && d.warning) setLoginSummaryWarning(d.warning);
        else setLoginSummaryWarning(null);
      }).catch(function (e) { console.warn('login summary:', e.message); }),
    ];
    await Promise.all(queries);
    setLoaded(true);
  };

  useEffect(() => { if (!loaded) loadData(); }, [loaded]);

  // v55.80 (Phase B / Section 2 — cache invalidation on filter change)
  // ----------------------------------------------------------------
  // When the date window changes, immediately clear the visible rows so
  // the old data doesn't linger on screen during the refetch. Without
  // this, switching from "Today" to "Yesterday" briefly shows yesterday
  // labels with today's rows underneath them — looks wrong, erodes trust.
  // We only clear the time-windowed slices (logs / audit / sessions);
  // tickets/quotes/announcements are not date-filtered server-side so
  // they don't suffer from the stale-reuse bug.
  // Also resets pagination windows so a filter change always shows the
  // first page of results.
  useEffect(() => {
    if (loaded) {
      setLogs([]);
      setAuditLogs([]);
      setSessions([]);
    }
    setActivityVisible(ACTIVITY_PAGE);
    setAuditVisible(ACTIVITY_PAGE);
    // intentionally narrow deps — only react to the date window changing
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  // v55.80 (Phase B / Section 6) — also reset pagination when the user
  // filter changes so flipping between "All Team" and a single person
  // doesn't show row #87 first.
  useEffect(() => {
    setActivityVisible(ACTIVITY_PAGE);
    setAuditVisible(ACTIVITY_PAGE);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selUser]);

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
    const today = todayET();
    const shiftDays = (n) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
    };
    setDatePreset(preset);
    if (preset === 'today') { setDateFrom(today); setDateTo(today); }
    else if (preset === 'yesterday') { const y = shiftDays(1); setDateFrom(y); setDateTo(y); }
    else if (preset === '7d') { setDateFrom(shiftDays(6)); setDateTo(today); }
    else if (preset === '30d') { setDateFrom(shiftDays(29)); setDateTo(today); }
    else if (preset === '3mo') { setDateFrom(shiftDays(89)); setDateTo(today); }
    else if (preset === 'all') { setDateFrom('2020-01-01'); setDateTo(today); }
    setLoaded(false);
  };
  const todayStr = todayET();

  // v55.80 (Phase B / Section 3 — Admin focus mode side-effect)
  // ----------------------------------------------------------------
  // When viewMode flips to 'me', auto-set selUser = me and persist.
  // When it flips to 'team', restore selUser to 'all'. Either way
  // the change is silent (no reload) — selUser already drives the
  // already-loaded data through useMemo filters.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('ktc.adminViewMode', viewMode); } catch (e) {}
    }
    if (viewMode === 'me' && myId) {
      if (selUser !== myId) setSelUser(myId);
    } else if (viewMode === 'team') {
      if (selUser !== 'all') setSelUser('all');
      if (drillUser) setDrillUser(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, myId]);

  // Enhanced scorecards
  const scorecards = useMemo(() => {
    return visibleUsers.map(u => {
      const uLogs = logs.filter(l => l.user_id === u.id);
      const autoCount = uLogs.filter(l => l.auto_generated).length;
      const manualCount = uLogs.filter(l => !l.auto_generated).length;
      const uniqueDays = [...new Set(uLogs.map(l => l.log_date))].length;

      // Tickets — v55.82-Z QA uses visibleTickets so private/confidential
      // that this user cannot see don't bleed into their scorecard view.
      // Super admin sees full counts; regular admins see only what they
      // have visibility to.
      const myTickets = visibleTickets.filter(t => t.assigned_to === u.id);
      const openT = myTickets.filter(t => t.status !== 'Closed').length;
      const closedT = myTickets.filter(t => t.status === 'Closed').length;
      const createdT = visibleTickets.filter(t => t.created_by === u.id).length;

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
    }).sort((a, b) => {
      // v55.81 — sort by user-selected metric (rankBy). Default to
      // totalActivities to preserve legacy behavior.
      var key = rankBy;
      var av = (a[key] != null) ? a[key] : 0;
      var bv = (b[key] != null) ? b[key] : 0;
      // For overdueCount/avgOverdueDays, LOWER is better — invert.
      if (key === 'overdueCount' || key === 'avgOverdueDays') return av - bv;
      return bv - av;
    });
  }, [visibleUsers, logs, tickets, visibleTickets, quotes, auditLogs, todayStr, rankBy]);

  // v55.82-Z QA — privacy filter for AdminTab. Super admin sees every
  // ticket; non-super_admin admins see regular tickets, plus confidential
  // tickets they created or are assigned to. Private super-admin tickets
  // never appear in AdminTab unless the viewer is the super admin.
  const visibleTickets = useMemo(() => {
    if (isSuperAdmin) return tickets;
    return tickets.filter(function (t) {
      if (t.is_private) return false; // super-admin-only
      if (t.is_confidential) {
        if (t.created_by === myId) return true;
        if (t.assigned_to === myId) return true;
        if (t.additional_assignees) {
          try {
            var extras = typeof t.additional_assignees === 'string'
              ? JSON.parse(t.additional_assignees)
              : t.additional_assignees;
            if (Array.isArray(extras) && extras.indexOf(myId) >= 0) return true;
          } catch (_) {}
        }
        return false;
      }
      return true;
    });
  }, [tickets, isSuperAdmin, myId]);

  // Filtered data
  const filteredLogs = useMemo(() => { let arr = logs; if (selUser !== 'all') arr = arr.filter(l => l.user_id === selUser); return arr; }, [logs, selUser]);
  const filteredTickets = useMemo(() => { let arr = visibleTickets; if (selUser !== 'all') arr = arr.filter(t => t.assigned_to === selUser || t.created_by === selUser); return arr; }, [visibleTickets, selUser]);
  const filteredAudit = useMemo(() => { let arr = auditLogs; if (selUser !== 'all') arr = arr.filter(a => a.changed_by === selUser); return arr; }, [auditLogs, selUser]);
  const filteredSessions = useMemo(() => { let arr = sessions; if (selUser !== 'all') arr = arr.filter(s => s.user_id === selUser); return arr; }, [sessions, selUser]);
  const selUserName = selUser !== 'all' ? getUserName(selUser) : 'All Team';

  return (<div>
    <h2 className="text-xl font-extrabold mb-3">Admin Dashboard / لوحة الإدارة</h2>

    {/* v55.80 (Phase B / Section 1 — ET disclosure)
        A persistent reminder near the top of Admin so the viewer always
        knows which clock the dates and times below are on. Quiet styling
        — the goal is to inform, not nag. */}
    <div className="text-[10px] text-slate-500 mb-2 font-semibold tracking-wide">
      🕐 All dates and times below are in U.S. Eastern Time (New York)
    </div>

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
      {/* v55.80 (Phase B / Section 3) — Focus-mode toggle. Persists in
          localStorage. 'me' auto-pins selUser to the viewer; 'team'
          restores the wide team view. */}
      <div className="flex gap-0 rounded-lg border-2 border-slate-300 overflow-hidden">
        <button
          onClick={() => setViewMode('team')}
          className={'px-3 py-1.5 text-[11px] font-bold transition ' +
            (viewMode === 'team' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
          title="See the whole team's scorecards"
        >
          👥 Team
        </button>
        <button
          onClick={() => setViewMode('me')}
          disabled={!myId}
          className={'px-3 py-1.5 text-[11px] font-bold transition ' +
            (!myId ? 'bg-slate-100 text-slate-400 cursor-not-allowed' :
            (viewMode === 'me' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'))}
          title={myId ? 'Focus on YOUR scorecard only' : 'Loading user...'}
        >
          👤 Just me
        </button>
      </div>
      <select value={selUser} onChange={e => {
        // v55.81 BUG FIX (Max May 9 2026 — photo evidence):
        // Dropdown changing selUser must ALSO clear drillUser, otherwise
        // the "Reviewing: <name>" header reads from the STALE drillUser
        // (set previously by clicking a scorecard) while the data below
        // correctly reflects the new selUser. The two-state mismatch made
        // the header show the wrong person.
        setSelUser(e.target.value);
        setDrillUser(null);
        if (e.target.value !== myId && viewMode === 'me') setViewMode('team');
      }} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold">
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
      {/* v55.81 (Max May 9 2026): show explicit dates next to the period
          name. "Today — May 9, 2026" not just "Today (ET)". For ranges,
          show "Last 7 Days — May 3 → May 9, 2026". */}
      <div className="text-[11px] text-slate-600 font-semibold">
        {(() => {
          var fmtDay = function (iso) {
            try { return fmtET(iso, 'longdate'); } catch (_) { return iso; }
          };
          var presetLabel = ({
            today: 'Today',
            yesterday: 'Yesterday',
            '7d': 'Last 7 Days',
            '30d': 'Last 30 Days',
            '3mo': 'Last 3 Months',
            all: 'All Time',
          })[datePreset];
          if (datePreset === 'all') return presetLabel + ' (ET)';
          if (dateFrom === dateTo) {
            // Single-day range
            var labelSingle = presetLabel || (dateFrom === todayET() ? 'Today' : dateFrom === yesterdayET() ? 'Yesterday' : '');
            return (labelSingle ? labelSingle + ' — ' : '') + fmtDay(dateFrom) + ' (ET)';
          }
          // Multi-day range
          var prefix = presetLabel ? presetLabel + ' — ' : '';
          return prefix + fmtDay(dateFrom) + ' → ' + fmtDay(dateTo) + ' (ET)';
        })()}
      </div>
      <button
        onClick={() => setLoaded(false)}
        disabled={!loaded}
        className={'px-3 py-1.5 rounded-lg text-xs font-semibold transition ' + (loaded ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-blue-300 text-white cursor-wait')}>
        {loaded ? 'Refresh' : '⟳ Loading…'}
      </button>
    </div>

    {/* v55.80 (Phase B / Section 3) — "Reviewing X" header when drilled in.
        Big, calm, unambiguous: when Max has clicked into one person OR
        toggled Just-me, the page reads as a focused review. Single tap
        to clear.
        v55.81 — Single source of truth for the focused user:
          1. If selUser is an explicit user (not 'all'), it wins. This
             matches the dropdown — what the user just selected is what
             the page should review.
          2. Otherwise fall back to drillUser (set by clicking a scorecard
             tile).
        Previous code did `drillUser || selUser` which let a stale drillUser
        override a fresh dropdown selection — exactly the bug Max caught
        with the photo (dropdown=Tamer, header=Abdelrahman). */}
    {(drillUser || (selUser !== 'all' && viewMode !== 'team')) && (() => {
      var focusId = (selUser !== 'all') ? selUser : drillUser;
      var focusName = getUserName(focusId);
      if (!focusName) return null;
      return (
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2.5 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🔍</span>
            <span className="text-xs text-blue-700 font-semibold">Reviewing:</span>
            <span className="text-sm font-extrabold text-blue-900">{focusName}</span>
            <span className="text-[10px] text-blue-500 ml-1">— scorecards, activity, tickets, audit, logins below all filtered to this person</span>
          </div>
          <button
            onClick={() => { setDrillUser(null); setSelUser('all'); setViewMode('team'); }}
            className="text-[10px] font-bold text-blue-700 bg-white border border-blue-300 rounded px-2 py-1 hover:bg-blue-100"
          >
            ✕ Back to team view
          </button>
        </div>
      );
    })()}

    {/* Section tabs */}
    <div className="flex gap-1 mb-3 flex-wrap">
      {[
        ['scorecards','📊 Scorecards'],
        ...(canSeeHR ? [['hr_report','📋 HR Report']] : []),
        // v55.65 — HR Inbox: routine requests + sensitive complaints from team.
        // super_admin sees ALL; regular admins see admin-visible requests + non-anonymous complaints only.
        ['hr_inbox','📬 HR Inbox'],
        ['pipeline','🏆 Sales Pipeline'],
        ['logins','🕐 Logins'],
        ['messages','📢 Messages'],
        ['activity','📋 Activity'],
        ['tickets','🎫 Tickets'],
        ['audit','🔍 Audit'],
        // v55.74 — Backups: super_admin only. Contains snapshots of every
        // business-critical table (treasury, invoices, customers, etc.) so
        // it MUST NOT be visible to regular admins.
        ...(isSuperAdmin ? [['backups','💾 Backups']] : []),
      ].map(([v,l]) => (
        <button key={v} onClick={() => setSection(v)}
          className={'px-3 py-1.5 rounded-lg text-xs font-semibold transition ' + (section === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{l}</button>
      ))}
    </div>

    {!isSuperAdmin && visibleUsers.length <= 1 && (
      <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3 border border-amber-200 text-xs text-amber-900">
        You can see your direct reports only. Ask a Super Admin to assign team members to you via the <strong>reports_to</strong> field.
      </div>
    )}

    {/* ===== HR REPORT ===== */}
    {section === 'hr_report' && canSeeHR && (
      <HRReport user={user} userProfile={userProfile} users={users} customers={customers} />
    )}
    {section === 'hr_report' && !canSeeHR && (
      <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3 border border-amber-200 text-xs text-amber-900">
        You don't have permission to view the HR Report. Ask a super admin to enable the "HR Report" permission for you in Settings.
      </div>
    )}

    {/* ===== HR INBOX (v55.65) ===== */}
    {section === 'hr_inbox' && (
      <AdminHRInbox user={user} userProfile={userProfile} isSuperAdmin={isSuperAdmin} users={users} />
    )}

    {/* ===== BACKUPS (v55.74) — super_admin only ===== */}
    {section === 'backups' && isSuperAdmin && (
      <BackupsPanel user={user} userProfile={userProfile} />
    )}
    {section === 'backups' && !isSuperAdmin && (
      <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3 border border-amber-200 text-xs text-amber-900">
        Backups are only available to super_admin. They contain sensitive financial and personnel data.
      </div>
    )}

    {/* ===== SCORECARDS ===== */}
    {section === 'scorecards' && (<div>
      {/* v55.81 (Max May 9 2026 #13) — Rank-by selector visible only on
          team view (not when an individual is focused). */}
      {!((selUser !== 'all') || drillUser) && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="text-slate-600 font-semibold">🏆 Rank by:</span>
          <select value={rankBy} onChange={e => setRankBy(e.target.value)}
            className="px-2 py-1 rounded border border-slate-200 text-xs">
            <option value="totalActivities">Total Activity</option>
            <option value="manualCount">Daily Log Entries</option>
            <option value="closedT">Tickets Closed</option>
            <option value="openT">Open Tickets</option>
            <option value="overdueCount">Overdue (low → high)</option>
            <option value="avgOverdueDays">Avg Overdue Days (low → high)</option>
            <option value="ratesCompleted">Shipping Rates Added</option>
            <option value="quotesCompleted">Quotes Created</option>
            <option value="uniqueDays">Active Days</option>
          </select>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(() => {
          // v55.81 (Max May 9 2026): Individual View — when an admin
          // selects a specific user from the dropdown OR drills into a
          // scorecard tile, the grid filters to JUST that person's card.
          // This is the "Individual View" Max specified in #7: focus only
          // on the selected employee, hide unrelated team data.
          var focusId = (selUser !== 'all') ? selUser : drillUser;
          if (viewMode === 'me' && myId) return scorecards.filter(u => u.id === myId);
          if (focusId) return scorecards.filter(u => u.id === focusId);
          return scorecards;
        })().map((u, idx) => (
          <div key={u.id} onClick={() => {
              const newDrill = drillUser === u.id ? null : u.id;
              setDrillUser(newDrill);
              setSelUser(newDrill || 'all');
              if (newDrill) setTimeout(() => drillRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }}
            className={'bg-white rounded-xl p-5 cursor-pointer border-2 transition hover:shadow-lg relative ' + (drillUser === u.id ? 'border-blue-500 shadow-lg ring-2 ring-blue-200' : 'border-slate-200')}>
            {/* v55.81 — Rank position badge in team view only */}
            {!drillUser && selUser === 'all' && viewMode !== 'me' && (
              <div className={'absolute -top-2 -left-2 px-2 py-0.5 rounded-full text-[10px] font-extrabold border-2 ' +
                (idx === 0 ? 'bg-yellow-100 text-yellow-900 border-yellow-400' :
                 idx === 1 ? 'bg-slate-100 text-slate-700 border-slate-400' :
                 idx === 2 ? 'bg-amber-50 text-amber-900 border-amber-300' :
                             'bg-white text-slate-600 border-slate-300')}>
                {idx === 0 ? '🥇 #1' : idx === 1 ? '🥈 #2' : idx === 2 ? '🥉 #3' : '#' + (idx + 1)}
              </div>
            )}
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
                <div className="text-[9px] text-slate-500">actions ({dateFrom.substring(5)} – {dateTo.substring(5)})</div>
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
              <div className="text-[9px] font-bold text-slate-500 mb-1.5">Activity Breakdown</div>
              <div className="flex gap-1.5 flex-wrap">
                {(u.topCats || []).map(([cat, count]) => (
                  <div key={cat} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold"
                    style={{ background: (CAT_COLORS[cat] || '#94a3b8') + '15', color: CAT_COLORS[cat] || '#94a3b8' }}>
                    {CAT_ICONS[cat] || '⚡'} {CAT_LABELS[cat] || cat} <span className="font-extrabold ml-0.5">{count}</span>
                  </div>
                ))}
                {(u.topCats || []).length === 0 && <span className="text-[10px] text-slate-500">No activity</span>}
              </div>
            </div>

            {/* Performance indicator */}
            {u.overdueCount > 2 && <div className="mt-2 px-2 py-1 bg-red-100 border border-red-200 rounded text-[10px] text-red-700 font-bold">⚠️ {u.overdueCount} tickets overdue — needs attention</div>}
            {u.totalActivities === 0 && <div className="mt-2 px-2 py-1 bg-slate-100 border border-slate-200 rounded text-[10px] text-slate-500">No activity in selected period</div>}
          </div>
        ))}
      </div>

      {/* Login Alerts — who didn't log in yesterday.
          v55.82-W (Max May 12 2026): Yasmeen was flagged as "did not login
          yesterday" even though she clearly did. The old check only looked
          at the user_sessions table — but login_events is the more
          reliable source (sendBeacon-based, doesn't depend on a clean
          logout). Fix: a user is "missing" only if BOTH sources show no
          login yesterday. */}
      {(() => {
        const yesterday = yesterdayET();
        const dayName = fmtET(yesterday, 'weekday', { tag: false });
        // Skip Saturday/Sunday in the alert (most teammates don't work weekends).
        const dayOfWeek = new Date(yesterday + 'T12:00:00Z').getUTCDay();
        if (dayOfWeek === 5 || dayOfWeek === 6) return null;
        const loggedInYesterdaySessions = new Set(sessions.filter(s => s.date === yesterday).map(s => s.user_id));
        // v55.82-W — also build the set from the more reliable login_events
        // summary endpoint. loginSummary rows have logins_yesterday_et.
        const loggedInYesterdayEvents = new Set(
          (loginSummary || [])
            .filter(ls => Number(ls.logins_yesterday_et || 0) > 0)
            .map(ls => ls.id)
        );
        const didLogIn = (uid) => loggedInYesterdaySessions.has(uid) || loggedInYesterdayEvents.has(uid);
        const missing = filterActiveUsers(users).filter(u => !didLogIn(u.id) && u.role !== 'super_admin');
        if (!missing.length) return null;
        return (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mt-4">
            <div className="text-sm font-bold text-red-700 mb-2">⚠️ Did Not Login Yesterday ({dayName} {fmtET(yesterday, 'shortdate')} ET)</div>
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
          if (col === 'created_at' || col === 'closed_at') return fmtET(val, 'datetime');
          if (col === 'due_date') return fmtET(val, 'shortdate');
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
                        <div className="text-[9px] text-slate-500 ml-2 whitespace-nowrap">{l.log_time ? l.log_time.substring(0, 5) : fmtET(l.created_at, 'time')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-4">
              <div className="text-sm font-bold mb-2">🕐 Login History (last 7 days, ET)</div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }, (_, i) => {
                  const d = new Date(); d.setDate(d.getDate() - (6 - i));
                  const ds = fmtET(d, 'iso');
                  const dayLabel = fmtET(d, 'weekday', { tag: false }).substring(0, 3);
                  const sess = uSessions.find(s => s.date === ds);
                  return (
                    <div key={ds} className={'rounded-lg p-2 text-center text-[9px] ' + (sess ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200')}>
                      <div className="font-bold">{dayLabel}</div>
                      <div className="text-[8px] text-slate-500">{fmtET(ds, 'monthday')}</div>
                      <div className="mt-0.5">{sess ? '✅' : '❌'}</div>
                      {sess && <div className="text-[8px] text-emerald-600">{fmtET(sess.login_at, 'time', { tag: false })}</div>}
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
                    <div className="sticky top-0 bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-600 border-b">{fmtET(date, 'shortdate')} — {items.length} entries</div>
                    {items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map(l => {
                      const cat = l.log_category || (l.auto_generated ? 'other' : 'manual');
                      return (
                        <div key={l.id} className="flex items-start gap-2 px-3 py-1.5 border-b border-slate-50 hover:bg-blue-50/30">
                          <span className="text-[10px] mt-0.5" style={{ color: CAT_COLORS[cat] || '#94a3b8' }}>{CAT_ICONS[cat] || '⚡'}</span>
                          <div className="flex-1 text-[11px] text-slate-700">{resolveIds(l.entry_text)}</div>
                          <div className="text-[9px] text-slate-500 whitespace-nowrap">{l.log_time ? l.log_time.substring(0, 5) : fmtET(l.created_at, 'time')}</div>
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
                        {c.phone && <div className="text-[10px] text-slate-500">{c.phone}</div>}
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
                      {a.pinned && <span className="text-[9px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-bold border border-amber-200">📌 PINNED</span>}
                      {a.active === false && <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold">ARCHIVED</span>}
                    </div>
                    {a.body && <div style={{ fontSize: '0.8rem', marginTop: '0.3rem', color: '#475569', whiteSpace: 'pre-wrap' }}>{a.body}</div>}
                    <div style={{ fontSize: '0.65rem', marginTop: '0.3rem', color: '#94a3b8' }}>
                      By {poster || 'Admin'} • {fmtET(a.created_at, 'datetime')}
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
                            return u.name + (ack ? ' (' + fmtET(ack.acked_at, 'time') + ')' : '');
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
        <h3 className="text-sm font-bold mb-3">
          {selUserName} — Activity Feed
          {/* v55.80 (Phase B / Section 6) — pagination summary */}
          <span className="text-slate-500 font-normal text-xs ml-1">
            (showing {Math.min(activityVisible, filteredLogs.length)} of {filteredLogs.length})
          </span>
        </h3>
        <div className="space-y-1 max-h-[600px] overflow-auto">
          {filteredLogs.slice(0, activityVisible).map(l => {
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
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    <span className="text-blue-500 font-semibold mr-2">{userName}</span>
                    {fmtET(l.log_date, 'shortdate')} {l.log_time ? l.log_time.substring(0, 5) + ' ET' : ''}
                    {cat !== 'other' && <span className="ml-2 px-1 py-0.5 bg-slate-100 rounded text-[9px]">{cat}</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredLogs.length === 0 && <div className="text-center text-slate-400 text-sm py-6">No activity</div>}
          {/* v55.80 (Phase B / Section 6) — Load More */}
          {activityVisible < filteredLogs.length && (
            <div className="text-center pt-2">
              <button
                onClick={() => setActivityVisible(activityVisible + ACTIVITY_PAGE)}
                className="px-4 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs font-bold text-blue-700"
              >
                Load 50 more ({filteredLogs.length - activityVisible} remaining)
              </button>
            </div>
          )}
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
                    <td className="px-2 py-2 text-center"><span className={'font-bold ' + (t.priority==='critical'?'text-red-900':t.priority==='high'?'text-red-500':t.priority==='low'?'text-green-500':'text-amber-500')}>{t.priority==='critical'?'🚨 critical':t.priority}</span></td>
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
            {/* v55.82 QA-21 (Max May 9 2026): inactive filter buttons used
                red-600 / amber-600 on light bg — failed AA. Bumped both
                to -900 + added border for definition. */}
            <button onClick={() => setAuditFilter('late')} className={'px-2 py-1 rounded text-[10px] font-semibold ' + (auditFilter === 'late' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-900 border border-red-200')}>🚨 Late Edits</button>
            <button onClick={() => setAuditFilter('sensitive')} className={'px-2 py-1 rounded text-[10px] font-semibold ' + (auditFilter === 'sensitive' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-900 border border-amber-200')}>⚠️ Sensitive</button>
            <button onClick={() => setAuditFilter('delete')} className={'px-2 py-1 rounded text-[10px] font-semibold ' + (auditFilter === 'delete' ? 'bg-red-600 text-white' : 'bg-slate-100')}>🗑️ Deletes</button>
          </div>
        </div>
        {(() => { var lateEdits = filteredAudit.filter(a => a.is_late_edit && a.action === 'update'); return lateEdits.length > 0 ? (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3 mb-3">
            {/* v55.82 QA-21 (Max May 9 2026): bumped red-700 → red-900 on the
                header and red-600 → red-800 on the subtitle. The previous
                shades were borderline-readable on bg-red-50 alone and
                effectively unreadable when shown on top of the dark dashboard
                background (Max's photo evidence). Also bumped the border
                shade so the banner outline is visible. */}
            <div className="text-sm font-extrabold text-red-900">🚨 {lateEdits.length} Late Edit{lateEdits.length > 1 ? 's' : ''} Detected</div>
            <div className="text-[11px] text-red-800 font-semibold mt-0.5">Changes made 24+ hours after original entry</div>
          </div>
        ) : null; })()}
        {(() => {
          // v55.80 (Phase B / Section 6) — pagination wrapping the filter chain.
          // The filter result is materialized once so we know the full count
          // for the "showing X of Y" line and the Load More button.
          var auditFiltered = filteredAudit.filter(a => {
            if (auditFilter === 'late') return a.is_late_edit;
            if (auditFilter === 'sensitive') return a.sensitive_fields_changed && a.sensitive_fields_changed.length > 0;
            if (auditFilter === 'delete') return a.action === 'delete';
            return true;
          });
          var auditPaged = auditFiltered.slice(0, auditVisible);
          return (
            <>
              <div className="text-[10px] text-slate-500 mb-2">Showing {auditPaged.length} of {auditFiltered.length}</div>
              <div className="space-y-1 max-h-[600px] overflow-auto">
                {auditPaged.map(a => {
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
                  {/* v55.82 QA-21 (Max May 9 2026): LATE EDIT pill — bumped
                      red-700 → red-900 + added border for AA contrast on the
                      light-red row background (which itself is on a darker
                      page background). Previous shade was unreadable in
                      Max's photo. */}
                  {isLate && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-900 text-[9px] font-extrabold border border-red-300">🚨 LATE EDIT ({a.hours_since_creation || '24+'}h)</span>}
                  {hasSensitive && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[9px] font-bold border border-amber-200">⚠️ {a.sensitive_fields_changed.join(', ')}</span>}
                  {/* v55.82 QA-21: removed the duplicate action label that
                      rendered immediately below the LATE EDIT pill — pre-
                      existing bug, two identical UPDATE/CREATE/DELETE pills
                      side by side. Kept only the first one (line above). */}
                  {linkedTicket ? (
                    <span className="text-blue-600 font-semibold cursor-pointer hover:underline" onClick={() => openTicketDetail(linkedTicket)}>
                      🎫 {friendlyTarget}
                    </span>
                  ) : (
                    <span className="text-slate-500">{friendlyTarget}</span>
                  )}
                  <span className="text-blue-500 font-semibold ml-auto">{userName}</span>
                  <span className="text-slate-400">{fmtET(a.created_at, 'datetime')}</span>
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
                {auditFiltered.length === 0 && <div className="text-center text-slate-400 text-sm py-6">No audit entries</div>}
                {/* v55.80 (Phase B / Section 6) — Load More */}
                {auditVisible < auditFiltered.length && (
                  <div className="text-center pt-2">
                    <button
                      onClick={() => setAuditVisible(auditVisible + ACTIVITY_PAGE)}
                      className="px-4 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs font-bold text-blue-700"
                    >
                      Load 50 more ({auditFiltered.length - auditVisible} remaining)
                    </button>
                  </div>
                )}
              </div>
            </>
          );
        })()}
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
          {/* v55.81 (Max May 9 2026 #9, #10, #11): expanded per-employee
              login stats. When an individual is focused, show the full
              picture; when on team view show the lighter 4-card summary. */}
          {(() => {
            var focusId = (selUser !== 'all') ? selUser : null;
            var sessionsForStats = focusId ? filteredSessions.filter(s => s.user_id === focusId) : filteredSessions;
            // Total logged-in time (sum of login→logout durations, in min).
            var totalLoggedInMin = sessionsForStats.reduce(function (sum, s) {
              if (s.login_at && s.logout_at) {
                return sum + Math.max(0, (new Date(s.logout_at) - new Date(s.login_at)) / 60000);
              }
              return sum;
            }, 0);
            // Active working time: distinct from logged-in time. v55.80 added
            // last_active column. If we have it, sum distinct active windows.
            // For this v55.81 release we approximate with: total logged-in
            // time × (sessions with last_active in last 5 min of session / total sessions).
            // Rough but better than nothing. The exact calc is in hr-metrics.js
            // and the score formula already uses interval-merge.
            var totalActiveMin = sessionsForStats.reduce(function (sum, s) {
              if (s.login_at && (s.last_active || s.last_seen)) {
                var anchor = new Date(s.last_active || s.last_seen);
                return sum + Math.max(0, (anchor - new Date(s.login_at)) / 60000);
              }
              return sum;
            }, 0);
            var avgSessionMins = sessionsForStats.length > 0
              ? Math.round(totalLoggedInMin / Math.max(1, sessionsForStats.filter(s => s.login_at && s.logout_at).length))
              : 0;
            var totalLogins = sessionsForStats.length;
            var totalLogouts = sessionsForStats.filter(s => s.logout_at).length;
            var manualLogouts2 = sessionsForStats.filter(s => s.logout_reason === 'manual').length;
            var autoLogouts2 = sessionsForStats.filter(s => s.logout_reason === 'auto_timeout').length;
            var withTimes = sessionsForStats.filter(s => s.login_at).sort(function (a, b) {
              return (b.login_at || '').localeCompare(a.login_at || '');
            });
            var lastLogin = withTimes[0] ? withTimes[0].login_at : null;
            var withLogout = sessionsForStats.filter(s => s.logout_at).sort(function (a, b) {
              return (b.logout_at || '').localeCompare(a.logout_at || '');
            });
            var lastLogout = withLogout[0] ? withLogout[0].logout_at : null;
            var fmtMins = function (m) {
              if (!m || m < 1) return '0m';
              if (m < 60) return Math.round(m) + 'm';
              var h = Math.floor(m / 60), mins = Math.round(m % 60);
              return h + 'h ' + (mins > 0 ? mins + 'm' : '');
            };

            if (focusId) {
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Total Logins</div>
                    <div className="text-lg font-extrabold text-emerald-600">{totalLogins}</div>
                    <div className="text-[10px] text-slate-500">{totalLogouts} logout{totalLogouts!==1?'s':''}</div>
                  </div>
                  <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#0ea5e9'}}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Total Logged-In Time</div>
                    <div className="text-lg font-extrabold text-sky-700">{fmtMins(totalLoggedInMin)}</div>
                    <div className="text-[10px] text-slate-500">login → logout</div>
                  </div>
                  <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#8b5cf6'}}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Active Working Time</div>
                    <div className="text-lg font-extrabold text-violet-700">{fmtMins(totalActiveMin)}</div>
                    <div className="text-[10px] text-slate-500">tab visible + activity</div>
                  </div>
                  <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Avg Session</div>
                    <div className="text-lg font-extrabold text-amber-900">{fmtMins(avgSessionMins)}</div>
                    <div className="text-[10px] text-slate-500">login → logout/expiry</div>
                  </div>
                  <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#3b82f6'}}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Manual Logouts</div>
                    <div className="text-lg font-extrabold text-blue-700">{manualLogouts2}</div>
                    <div className="text-[10px] text-slate-500">user clicked Sign Out</div>
                  </div>
                  <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Auto Timeouts</div>
                    <div className="text-lg font-extrabold text-red-600">{autoLogouts2}</div>
                    <div className="text-[10px] text-slate-500">tab idle/closed</div>
                  </div>
                  <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Last Login</div>
                    <div className="text-sm font-bold text-emerald-700">{lastLogin ? fmtET(lastLogin, 'datetime') : '—'}</div>
                  </div>
                  <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#64748b'}}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">Last Logout</div>
                    <div className="text-sm font-bold text-slate-700">{lastLogout ? fmtET(lastLogout, 'datetime') : '—'}</div>
                  </div>
                </div>
              );
            }
            // Team view — original 4-card lightweight summary
            return (
              <div className="grid grid-cols-4 gap-3 mb-3">
                <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}><div className="text-[10px] text-slate-500">Total Logins</div><div className="text-lg font-extrabold text-emerald-600">{totalLogins}</div></div>
                <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#3b82f6'}}><div className="text-[10px] text-slate-500">Manual Logouts</div><div className="text-lg font-extrabold">{manualLogouts2}</div></div>
                <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Auto Timeouts</div><div className="text-lg font-extrabold text-red-500">{autoLogouts2}</div></div>
                <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">Avg Session</div><div className="text-lg font-extrabold">{fmtMins(avgSessionMins)}</div></div>
              </div>
            );
          })()}

          {/* v55.81 (Max May 9 2026 #12): Login Consistency card — only
              shown for individuals. Working week = any 6 of 7 days.
              Format: "Logged in X out of expected Y days." */}
          {(() => {
            var focusId = (selUser !== 'all') ? selUser : null;
            if (!focusId) return null;
            // Count distinct days the focused user logged in within the
            // current period.
            var sessionsForFocus = filteredSessions.filter(s => s.user_id === focusId);
            var uniqueDays = new Set();
            sessionsForFocus.forEach(function (s) {
              var d = s.date || (s.login_at ? s.login_at.substring(0, 10) : null);
              if (d) uniqueDays.add(d);
            });
            var actualDays = uniqueDays.size;
            // Compute period span in days.
            var fromDate = new Date(dateFrom + 'T00:00:00');
            var toDate = new Date(dateTo + 'T00:00:00');
            var periodDays = Math.max(1, Math.round((toDate - fromDate) / 86400000) + 1);
            // Working week = any 6 of 7 days (per Max May 9 2026)
            var expectedDays = Math.max(1, Math.round((periodDays * 6) / 7));
            var consistency = expectedDays > 0 ? Math.round((actualDays / expectedDays) * 100) : 0;
            var consistencyTone = consistency >= 100 ? 'text-emerald-700' : consistency >= 80 ? 'text-amber-900' : 'text-red-700';
            // Consecutive missed days (looking backward from period end)
            var sortedDays = Array.from(uniqueDays).sort();
            var lastSeenDay = sortedDays.length > 0 ? sortedDays[sortedDays.length - 1] : null;
            var todayIso = todayET();
            var daysSinceLast = lastSeenDay
              ? Math.round((new Date(todayIso) - new Date(lastSeenDay)) / 86400000)
              : null;
            return (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-4 mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">📅</span>
                  <span className="text-xs font-bold text-blue-900">Login Consistency</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px] text-slate-600 uppercase tracking-wide font-semibold">Logged in</div>
                    <div className={'text-2xl font-extrabold ' + consistencyTone}>
                      {actualDays} / {expectedDays}
                    </div>
                    <div className="text-[11px] text-slate-600">expected work days</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-600 uppercase tracking-wide font-semibold">Consistency</div>
                    <div className={'text-2xl font-extrabold ' + consistencyTone}>{consistency}%</div>
                    <div className="text-[11px] text-slate-600">working week = any 6 of 7 days</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-600 uppercase tracking-wide font-semibold">Days Since Last Login</div>
                    <div className="text-2xl font-extrabold text-slate-700">
                      {daysSinceLast === null ? '—' : daysSinceLast === 0 ? 'Today' : daysSinceLast + 'd ago'}
                    </div>
                    <div className="text-[11px] text-slate-600">{lastSeenDay ? fmtET(lastSeenDay, 'longdate') : 'no logins recorded'}</div>
                  </div>
                </div>
                {actualDays < expectedDays && (
                  <div className="mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    Missed {expectedDays - actualDays} expected day{(expectedDays - actualDays) !== 1 ? 's' : ''} in this period.
                  </div>
                )}
              </div>
            );
          })()}
          {/* Per-user daily breakdown — only when no individual focused */}
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
                  <div className="text-[11px] text-amber-900 mb-2">
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
                      const lastLogin = lastLoginAt ? fmtET(lastLoginAt, 'datetime') : '—';
                      const isOnline = !!lsRow.is_online;
                      // Belt-and-suspenders: if login_events count is 0 but the user actually has an
                      // active session today (from the older user_sessions table), use the session count.
                      // Prevents the "0 logins today" bug when login_events writes fail silently.
                      const etTodayStr = todayET();
                      const etYesterdayStr = yesterdayET();
                      const sessionsTodayCount = uSess.filter(s => (s.date || '') === etTodayStr).length;
                      const sessionsYesterdayCount = uSess.filter(s => (s.date || '') === etYesterdayStr).length;
                      const todayCnt = Math.max(Number(lsRow.logins_today_et || 0), sessionsTodayCount);
                      const yesterdayCnt = Math.max(Number(lsRow.logins_yesterday_et || 0), sessionsYesterdayCount);
                      const sevenDayCnt = Number(lsRow.logins_last_7d_et || 0);
                      return (
                        <tr key={u.id} className="border-b border-slate-50 hover:bg-blue-50 cursor-pointer" onClick={() => setSelUser(u.id)}>
                          <td className="px-3 py-2 font-semibold">{u.name}</td>
                          <td className="px-3 py-2 text-center">
                            {isOnline
                              ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">🟢 Online</span>
                              : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">⚪ Offline</span>}
                          </td>
                          <td className="px-3 py-2 text-center font-bold text-blue-600">{todayCnt}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{yesterdayCnt}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{sevenDayCnt}</td>
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
                      <span className="text-xs font-bold text-slate-700">📅 {fmtET(date, 'date')} <span className="text-slate-400 font-normal">({fmtET(date, 'weekday', { tag: false })})</span></span>
                      <div className="flex gap-3 text-[10px]">
                        <span className="text-emerald-600 font-semibold">🟢 {daySessions.length} login{daySessions.length !== 1 ? 's' : ''}</span>
                        {dayAutoLogouts > 0 && <span className="text-red-500 font-bold">⏱️ {dayAutoLogouts} auto-timeout{dayAutoLogouts !== 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {daySessions.map((s, i) => {
                        const loginTime = s.login_at ? fmtET(s.login_at, 'time', { tag: false }) : '—';
                        const logoutTime = s.logout_at ? fmtET(s.logout_at, 'time', { tag: false }) : '—';
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
                            {duration !== null && <span className="text-slate-500 text-[10px]">({duration}m)</span>}
                            {isTimeout && <span className="px-1.5 py-0.5 bg-red-50 text-red-900 rounded text-[9px] font-bold border border-red-300">AUTO TIMEOUT</span>}
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
              <div><div className="text-[9px] text-slate-500 uppercase font-semibold">Status</div><span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{background:STATUS_COLORS[viewTicket.status]||'#6b7280'}}>{viewTicket.status}</span></div>
              <div><div className="text-[9px] text-slate-500 uppercase font-semibold">Priority</div><span className={'text-sm font-bold ' + (viewTicket.priority==='critical'?'text-red-900':viewTicket.priority==='high'?'text-red-500':viewTicket.priority==='low'?'text-green-500':'text-amber-500')}>{viewTicket.priority==='critical'?'🚨 CRITICAL':(viewTicket.priority || '—')}</span></div>
              <div><div className="text-[9px] text-slate-500 uppercase font-semibold">Assigned To</div><div className="text-xs font-semibold text-purple-600">{getUserName(viewTicket.assigned_to) || 'Unassigned'}</div></div>
              <div><div className="text-[9px] text-slate-500 uppercase font-semibold">Created By</div><div className="text-xs font-semibold">{getUserName(viewTicket.created_by) || '—'}</div></div>
              <div><div className="text-[9px] text-slate-500 uppercase font-semibold">Due Date</div><div className={'text-xs font-semibold ' + (viewTicket.due_date && viewTicket.due_date < todayStr ? 'text-red-600' : '')}>{viewTicket.due_date ? fmtET(viewTicket.due_date, 'shortdate') : '—'}</div></div>
              <div><div className="text-[9px] text-slate-500 uppercase font-semibold">Created</div><div className="text-xs text-slate-500">{fmtET(viewTicket.created_at, 'datetime')}</div></div>
            </div>

            {/* Description */}
            {viewTicket.description && (
              <div className="mb-4">
                <div className="text-[9px] text-slate-500 uppercase font-semibold mb-1">Description</div>
                <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{viewTicket.description}</div>
              </div>
            )}

            {/* Attachments */}
            {viewTicket.attachments && viewTicket.attachments.length > 0 && (
              <div className="mb-4">
                <div className="text-[9px] text-slate-500 uppercase font-semibold mb-1">📎 Attachments</div>
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
              <div className="text-[9px] text-slate-500 uppercase font-semibold mb-2">💬 Notes & Updates ({ticketComments.length})</div>
              {ticketComments.length > 0 ? (
                <div className="space-y-2 max-h-[250px] overflow-auto">
                  {ticketComments.map(c => (
                    <div key={c.id} className={'rounded-lg p-3 text-xs ' + (c.is_system ? 'bg-slate-50 border border-slate-100' : 'bg-blue-50 border border-blue-100')}>
                      <div className="flex justify-between mb-1">
                        <span className="font-bold" style={{ color: c.is_system ? '#64748b' : '#2563eb' }}>
                          {c.is_system ? '🤖 System' : '💬 ' + (getUserName(c.created_by) || 'User')}
                        </span>
                        <span className="text-[10px] text-slate-500">{fmtET(c.created_at, 'datetime')}</span>
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
