'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const PIPELINE_STAGES = [
  { v: 'lead', l: 'Lead', c: '#94a3b8', icon: '🔘' },
  { v: 'contacted', l: 'Contacted', c: '#3b82f6', icon: '📞' },
  { v: 'qualified', l: 'Qualified', c: '#8b5cf6', icon: '✅' },
  { v: 'proposal', l: 'Proposal', c: '#f59e0b', icon: '📋' },
  { v: 'negotiation', l: 'Negotiation', c: '#ec4899', icon: '🤝' },
  { v: 'won', l: 'Won / Deal', c: '#10b981', icon: '🏆' },
  { v: 'lost', l: 'Lost', c: '#ef4444', icon: '❌' },
];
const STATUS_COLORS = {New:'#3b82f6',Acknowledged:'#8b5cf6','In Progress':'#f59e0b',Waiting:'#6b7280',Review:'#ec4899',Testing:'#14b8a6',Ready:'#10b981',Closed:'#374151',Reopened:'#ef4444'};

export default function AdminTab({ user, userProfile, users, isAdmin, customers }) {
  const [logs, setLogs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [ticketComments, setTicketComments] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const [section, setSection] = useState('scorecards');
  const [selUser, setSelUser] = useState(null);
  const [dateMode, setDateMode] = useState('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [expandedBucket, setExpandedBucket] = useState(null);
  const [drillStage, setDrillStage] = useState(null);
  const [drillUser, setDrillUser] = useState(null);

  const myId = userProfile?.id || user?.id;
  const isSuperAdmin = userProfile?.role === 'super_admin';
  const getUserName = (id) => (users || []).find(u => u.id === id)?.name || '';
  const todayStr = new Date().toISOString().substring(0, 10);

  const visibleUsers = useMemo(() => {
    if (!users) return [];
    if (isSuperAdmin) return users;
    return users.filter(u => u.reports_to === myId || u.id === myId);
  }, [users, myId, isSuperAdmin]);

  const { rangeFrom, rangeTo } = useMemo(() => {
    const now = new Date();
    const to = now.toISOString().substring(0, 10);
    if (dateMode === 'today') return { rangeFrom: to, rangeTo: to };
    if (dateMode === 'week') { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return { rangeFrom: d.toISOString().substring(0,10), rangeTo: to }; }
    if (dateMode === 'month') return { rangeFrom: to.substring(0,7) + '-01', rangeTo: to };
    if (dateMode === 'year') return { rangeFrom: to.substring(0,4) + '-01-01', rangeTo: to };
    if (dateMode === 'all') return { rangeFrom: '2014-01-01', rangeTo: to };
    if (dateMode === 'custom') return { rangeFrom: customFrom || to, rangeTo: customTo || to };
    return { rangeFrom: to, rangeTo: to };
  }, [dateMode, customFrom, customTo]);

  const loadData = useCallback(async () => {
    const safe = async (fn) => { try { const r = await fn; return r.data || []; } catch(e) { return []; } };
    const [lg, tk, tc, fu, al, qt] = await Promise.all([
      safe(supabase.from('daily_log').select('*').order('created_at', { ascending: false }).limit(5000)),
      safe(supabase.from('tickets').select('*').order('created_at', { ascending: false })),
      safe(supabase.from('ticket_comments').select('*').order('created_at', { ascending: false }).limit(3000)),
      safe(supabase.from('follow_ups').select('*').order('created_at', { ascending: false }).limit(2000)),
      safe(supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(3000)),
      safe(supabase.from('shipping_quotes').select('id, quote_number, customer_name, total_amount, created_at, created_by').order('created_at', { ascending: false }).limit(500)),
    ]);
    setLogs(lg); setTickets(tk); setTicketComments(tc); setFollowUps(fu); setAuditLogs(al); setQuotes(qt);
    setLoaded(true);
  }, []);

  useEffect(() => { if (!loaded) loadData(); }, [loaded, loadData]);

  const inRange = useCallback((dateStr) => {
    if (!dateStr) return false;
    const d = dateStr.substring(0, 10);
    return d >= rangeFrom && d <= rangeTo;
  }, [rangeFrom, rangeTo]);

  const scorecards = useMemo(() => {
    return visibleUsers.map(u => {
      const uLogs = logs.filter(l => l.user_id === u.id && inRange(l.log_date || l.created_at));
      const catCounts = {};
      uLogs.forEach(l => { const c = l.log_category || (l.auto_generated ? 'other' : 'manual'); catCounts[c] = (catCounts[c] || 0) + 1; });

      const createdInRange = tickets.filter(t => t.created_by === u.id && inRange(t.created_at));
      const closedInRange = tickets.filter(t => t.assigned_to === u.id && t.status === 'Closed' && inRange(t.updated_at || t.created_at));
      const assignedAll = tickets.filter(t => t.assigned_to === u.id);
      const overdueNow = assignedAll.filter(t => t.due_date && t.due_date < todayStr && t.status !== 'Closed');
      const commentsInRange = ticketComments.filter(c => c.user_id === u.id && inRange(c.created_at));

      const fuInRange = followUps.filter(f => f.assigned_to === u.id && inRange(f.created_at));
      const fuCompletedInRange = followUps.filter(f => f.assigned_to === u.id && f.completed && inRange(f.updated_at || f.created_at));

      const myCust = (customers || []).filter(c => c.assigned_rep === u.id);
      const pipelineByStage = {};
      PIPELINE_STAGES.forEach(s => { pipelineByStage[s.v] = myCust.filter(c => (c.pipeline_stage || 'lead') === s.v).length; });

      const userAudit = auditLogs.filter(a => a.changed_by === u.id && inRange(a.created_at));
      const auditByCat = {};
      userAudit.forEach(a => { const k = (a.table_name || 'other'); auditByCat[k] = (auditByCat[k] || 0) + 1; });

      const quotesInRange = quotes.filter(q => q.created_by === u.id && inRange(q.created_at));

      const totalActions = uLogs.length + createdInRange.length + closedInRange.length + commentsInRange.length + fuCompletedInRange.length + quotesInRange.length;
      let stars = 0;
      if (totalActions >= 1) stars = 1;
      if (totalActions >= 5) stars = 2;
      if (totalActions >= 15) stars = 3;
      if (totalActions >= 30) stars = 4;
      if (totalActions >= 50) stars = 5;
      if (overdueNow.length > 3) stars = Math.max(0, stars - 1);

      return {
        ...u, totalActions, stars, catCounts,
        createdInRange, closedInRange, overdueNow, commentsInRange,
        fuInRange, fuCompletedInRange, myCust, pipelineByStage,
        quotesInRange, userAudit, auditByCat, uLogs,
        assignedOpen: assignedAll.filter(t => t.status !== 'Closed').length,
      };
    }).sort((a, b) => b.totalActions - a.totalActions);
  }, [visibleUsers, logs, tickets, ticketComments, followUps, auditLogs, quotes, customers, inRange, todayStr]);

  const selectedCard = selUser ? scorecards.find(s => s.id === selUser) : null;

  const DateSelector = () => (
    <div className="flex gap-1 flex-wrap items-center mb-3">
      {[['today','📅 Today'],['week','📆 Week'],['month','🗓️ Month'],['year','📊 Year'],['all','♾️ All'],['custom','🔧 Custom']].map(([v,l]) => (
        <button key={v} onClick={() => { setDateMode(v); setExpandedBucket(null); }}
          className={'px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition ' + (dateMode === v ? 'bg-slate-800 text-white shadow' : 'bg-white text-slate-500 border border-slate-200')}>
          {l}
        </button>
      ))}
      {dateMode === 'custom' && (
        <div className="flex gap-1 items-center ml-1">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="px-2 py-1 rounded border text-[11px]" />
          <span className="text-[10px] text-slate-400">→</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="px-2 py-1 rounded border text-[11px]" />
        </div>
      )}
      <span className="text-[10px] text-slate-400 ml-2">{rangeFrom === rangeTo ? rangeFrom : rangeFrom + ' → ' + rangeTo}</span>
    </div>
  );

  const Bucket = ({ id, icon, label, count, color, children }) => {
    const isOpen = expandedBucket === id;
    return (
      <div className="mb-2">
        <button onClick={() => setExpandedBucket(isOpen ? null : id)}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition hover:shadow-sm"
          style={{ background: color + '10', borderLeft: '3px solid ' + color }}>
          <span className="text-base">{icon}</span>
          <span className="flex-1 text-xs font-bold" style={{ color }}>{label}</span>
          <span className="text-lg font-extrabold" style={{ color }}>{count}</span>
          <span className="text-slate-400 text-xs">{isOpen ? '▼' : '▶'}</span>
        </button>
        {isOpen && count > 0 && (
          <div className="mt-1 ml-4 border-l-2 pl-3 max-h-[400px] overflow-auto" style={{ borderColor: color + '40' }}>
            {children}
          </div>
        )}
      </div>
    );
  };

  const Entry = ({ icon, text, sub, overdue }) => (
    <div className={'flex items-start gap-2 py-1.5 border-b border-slate-50 ' + (overdue ? 'bg-red-50 rounded px-1' : '')}>
      <span className="text-xs mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] truncate">{text}</div>
        {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
      </div>
    </div>
  );

  // ── DETAIL VIEW ──
  const renderDetail = () => {
    if (!selectedCard) return null;
    const u = selectedCard;

    return (<div>
      <button onClick={() => { setSelUser(null); setExpandedBucket(null); }} className="flex items-center gap-1 text-xs text-blue-600 font-bold mb-3 hover:underline">← Back to Scorecards</button>

      <div className="bg-white rounded-xl p-4 mb-3 border-2 border-blue-100">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-lg font-extrabold">{u.name}</div>
            <div className="text-[11px]">
              <span className={'font-bold ' + (u.role === 'super_admin' ? 'text-red-500' : u.role === 'admin' ? 'text-purple-500' : 'text-blue-500')}>
                {u.role === 'super_admin' ? '🔴 Super Admin' : u.role === 'admin' ? '🟣 Admin' : '🔵 Team'}
              </span>
              <span className="text-slate-400 ml-3">{u.email}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl tracking-wider" style={{color: u.stars >= 4 ? '#f59e0b' : u.stars >= 2 ? '#94a3b8' : '#ef4444'}}>{'★'.repeat(u.stars)}{'☆'.repeat(5 - u.stars)}</div>
            <div className="text-2xl font-extrabold text-slate-800">{u.totalActions}</div>
            <div className="text-[9px] text-slate-400 font-bold">TOTAL ACTIONS</div>
          </div>
        </div>
      </div>

      <DateSelector />

      {/* TICKETS */}
      <div className="mb-4">
        <div className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">🎫 Tickets</div>
        <Bucket id="t-created" icon="✨" label="Tickets Created" count={u.createdInRange.length} color="#3b82f6">
          {u.createdInRange.map(t => <Entry key={t.id} icon={t.priority==='high'?'🔴':t.priority==='low'?'🟢':'🟡'} text={(t.ticket_number||'')+' '+t.title} sub={t.status+' · '+t.priority+' · '+(t.created_at||'').substring(0,10)} />)}
        </Bucket>
        <Bucket id="t-closed" icon="✅" label="Tickets Closed" count={u.closedInRange.length} color="#10b981">
          {u.closedInRange.map(t => <Entry key={t.id} icon="✅" text={(t.ticket_number||'')+' '+t.title} sub={'Closed · '+(t.updated_at||t.created_at||'').substring(0,10)} />)}
        </Bucket>
        <Bucket id="t-comments" icon="💬" label="Comments Posted" count={u.commentsInRange.length} color="#8b5cf6">
          {u.commentsInRange.map(c => { const tk = tickets.find(t => t.id === c.ticket_id); return <Entry key={c.id} icon="💬" text={(c.comment||'').substring(0,120)} sub={'On: '+(tk?.ticket_number||'')+' '+(tk?.title||'').substring(0,40)+' · '+(c.created_at||'').substring(0,10)} />; })}
        </Bucket>
        <Bucket id="t-overdue" icon="🚨" label="Currently Overdue" count={u.overdueNow.length} color="#ef4444">
          {u.overdueNow.map(t => { const days = Math.floor((Date.now()-new Date(t.due_date).getTime())/86400000); return <Entry key={t.id} icon="🚨" overdue text={(t.ticket_number||'')+' '+t.title} sub={'Due: '+t.due_date+' ('+days+'d overdue) · '+t.status} />; })}
        </Bucket>
        <Bucket id="t-open" icon="📋" label="Open Assigned" count={u.assignedOpen} color="#f59e0b">
          {tickets.filter(t => t.assigned_to === u.id && t.status !== 'Closed').map(t => <Entry key={t.id} icon={t.priority==='high'?'🔴':'🟡'} text={(t.ticket_number||'')+' '+t.title} sub={t.status+' · '+t.priority+(t.due_date?' · Due: '+t.due_date:'')} overdue={t.due_date && t.due_date < todayStr} />)}
        </Bucket>
      </div>

      {/* CRM */}
      <div className="mb-4">
        <div className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">🤝 CRM & Clients</div>
        <Bucket id="crm-pipeline" icon="📊" label="Pipeline (All Assigned)" count={u.myCust.length} color="#0ea5e9">
          <div className="flex gap-1 flex-wrap mb-2">
            {PIPELINE_STAGES.map(s => { const cnt = u.pipelineByStage[s.v]||0; if (!cnt) return null; return <span key={s.v} className="px-2 py-1 rounded text-[10px] font-bold text-white" style={{background:s.c}}>{s.icon} {s.l}: {cnt}</span>; })}
          </div>
          {u.myCust.map(c => <Entry key={c.id} icon={PIPELINE_STAGES.find(s=>s.v===(c.pipeline_stage||'lead'))?.icon||'🔘'} text={c.name_en||c.name} sub={(c.pipeline_stage||'lead')+' · '+(c.industry||'')+(c.group_name?' · '+c.group_name:'')} />)}
        </Bucket>
        <Bucket id="crm-fu" icon="📌" label="Follow-ups Created" count={u.fuInRange.length} color="#f59e0b">
          {u.fuInRange.map(f => <Entry key={f.id} icon={f.completed?'✅':'📌'} text={f.task} sub={'Due: '+(f.due_date||'—')+' · '+(f.completed?'Done':'Pending')} />)}
        </Bucket>
        <Bucket id="crm-done" icon="✅" label="Follow-ups Completed" count={u.fuCompletedInRange.length} color="#10b981">
          {u.fuCompletedInRange.map(f => <Entry key={f.id} icon="✅" text={f.task} sub={'Due: '+(f.due_date||'—')} />)}
        </Bucket>
        <Bucket id="crm-quotes" icon="📄" label="Quotes Created" count={u.quotesInRange.length} color="#6366f1">
          {u.quotesInRange.map(q => <Entry key={q.id} icon="📄" text={(q.quote_number||'')+' — '+(q.customer_name||'')} sub={(q.total_amount?(q.total_amount).toLocaleString():'—')+' · '+(q.created_at||'').substring(0,10)} />)}
        </Bucket>
      </div>

      {/* AUDIT ACTIONS */}
      <div className="mb-4">
        <div className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">⚡ All Actions (Audit)</div>
        {Object.entries(u.auditByCat).sort((a,b)=>b[1]-a[1]).map(([table, count]) => {
          const ico = {tickets:'🎫',customers:'🤝',shipping_rates:'🛳️',shipping_quotes:'📄',follow_ups:'📌',treasury:'💰',invoices:'🧾',inventory:'📦',calendar_events:'📅',checks:'💳',warehouse_expenses:'🏭',debts:'💸',daily_log:'📝',users:'👤',module_permissions:'🔑',expense_rules:'📏',vendor_contacts:'🏢'};
          const lbl = {tickets:'Tickets',customers:'Customers',shipping_rates:'Shipping Rates',shipping_quotes:'Quotes',follow_ups:'Follow-ups',treasury:'Treasury',invoices:'Invoices',inventory:'Inventory',calendar_events:'Calendar',checks:'Checks',warehouse_expenses:'Warehouse',debts:'Debts',daily_log:'Daily Log',users:'Users',module_permissions:'Permissions',expense_rules:'Rules',vendor_contacts:'Vendors'};
          const clr = {tickets:'#8b5cf6',customers:'#0ea5e9',shipping_rates:'#10b981',shipping_quotes:'#6366f1',follow_ups:'#f59e0b',treasury:'#ec4899',invoices:'#3b82f6',inventory:'#14b8a6',calendar_events:'#a855f7',checks:'#f97316',warehouse_expenses:'#64748b',debts:'#ef4444'};
          return (
            <Bucket key={table} id={'a-'+table} icon={ico[table]||'⚡'} label={lbl[table]||table} count={count} color={clr[table]||'#64748b'}>
              {u.userAudit.filter(a=>a.table_name===table).map(a => {
                const ai = a.action==='create'?'✨':a.action==='delete'?'🗑️':'✏️';
                let det = '';
                if (a.new_values && typeof a.new_values === 'object') { const v = a.new_values; det = v.title||v.name||v.description||v.entry_text||v.task||v.quote_number||v.order_number||''; if (typeof det === 'string') det = det.substring(0,80); }
                return <Entry key={a.id} icon={ai} text={(a.action||'').toUpperCase()+' '+det} sub={(a.created_at||'').substring(0,16).replace('T',' ')} />;
              })}
            </Bucket>
          );
        })}
        {Object.keys(u.auditByCat).length === 0 && <div className="text-xs text-slate-400 text-center py-3">No audit entries in this period</div>}
      </div>

      {/* ACTIVITY LOG */}
      <div className="mb-4">
        <div className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">📋 Activity Log ({u.uLogs.length})</div>
        {(() => {
          const logCats = {};
          u.uLogs.forEach(l => { const c = l.log_category || (l.auto_generated ? 'other' : 'manual'); logCats[c] = (logCats[c] || 0) + 1; });
          const ci = {ticket:'🎫',crm:'🤝',shipping:'🛳️',customs:'🚢',calendar:'📅',finance:'💰',inventory:'📦',communication:'📬',ai:'🤖',manual:'✏️',other:'⚡',login:'🟢'};
          const cc = {ticket:'#8b5cf6',crm:'#0ea5e9',shipping:'#10b981',customs:'#f59e0b',calendar:'#ec4899',finance:'#6366f1',inventory:'#14b8a6',communication:'#38bdf8',ai:'#a78bfa',manual:'#3b82f6',other:'#94a3b8',login:'#22c55e'};
          const cl = {ticket:'Tickets',crm:'CRM',shipping:'Shipping',customs:'Customs',calendar:'Calendar',finance:'Finance',inventory:'Inventory',communication:'Comms',ai:'AI',manual:'Notes',other:'System',login:'Logins'};
          return Object.entries(logCats).sort((a,b)=>b[1]-a[1]).map(([cat, count]) => (
            <Bucket key={cat} id={'l-'+cat} icon={ci[cat]||'⚡'} label={cl[cat]||cat} count={count} color={cc[cat]||'#94a3b8'}>
              {u.uLogs.filter(l => (l.log_category || (l.auto_generated ? 'other' : 'manual')) === cat).map(l => (
                <Entry key={l.id} icon={l.auto_generated?'⚡':'✏️'} text={l.entry_text} sub={l.log_date+' '+(l.log_time?l.log_time.substring(0,5):'')} />
              ))}
            </Bucket>
          ));
        })()}
      </div>
    </div>);
  };

  // ── SCORECARD GRID ──
  const renderGrid = () => (
    <div>
      <DateSelector />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {scorecards.map(u => (
          <div key={u.id} onClick={() => { setSelUser(u.id); setExpandedBucket(null); }}
            className="bg-white rounded-xl p-4 cursor-pointer border-2 border-slate-100 transition hover:border-blue-300 hover:shadow-lg active:scale-[0.99]">
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="text-sm font-extrabold">{u.name}</div>
                <div className="text-[10px]">
                  <span className={'font-bold ' + (u.role==='super_admin'?'text-red-500':u.role==='admin'?'text-purple-500':'text-blue-500')}>
                    {u.role==='super_admin'?'🔴 Super Admin':u.role==='admin'?'🟣 Admin':'🔵 Team'}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-base tracking-wide" style={{color:u.stars>=4?'#f59e0b':u.stars>=2?'#94a3b8':'#ef4444'}}>{'★'.repeat(u.stars)}{'☆'.repeat(5-u.stars)}</div>
                <div className="text-xl font-extrabold">{u.totalActions}</div>
                <div className="text-[8px] text-slate-400 font-bold">ACTIONS</div>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1 mb-2">
              {[
                {n:u.createdInRange.length,l:'Created',c:'#3b82f6'},
                {n:u.closedInRange.length,l:'Closed',c:'#10b981'},
                {n:u.assignedOpen,l:'Open',c:'#f59e0b'},
                {n:u.overdueNow.length,l:'Overdue',c:u.overdueNow.length>0?'#ef4444':'#d1d5db'},
                {n:u.commentsInRange.length,l:'Comments',c:'#8b5cf6'},
              ].map((s,i) => (
                <div key={i} className="text-center rounded-lg py-1" style={{background:s.c+'10'}}>
                  <div className="text-sm font-extrabold" style={{color:s.c}}>{s.n}</div>
                  <div className="text-[7px] font-bold text-slate-400">{s.l}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1 mb-2">
              <div className="text-center rounded-lg py-1" style={{background:'#0ea5e910'}}><div className="text-sm font-extrabold text-sky-600">{u.myCust.length}</div><div className="text-[7px] font-bold text-slate-400">Clients</div></div>
              <div className="text-center rounded-lg py-1" style={{background:'#10b98110'}}><div className="text-sm font-extrabold text-emerald-600">{u.fuCompletedInRange.length}</div><div className="text-[7px] font-bold text-slate-400">Follow-ups</div></div>
              <div className="text-center rounded-lg py-1" style={{background:'#6366f110'}}><div className="text-sm font-extrabold text-indigo-600">{u.quotesInRange.length}</div><div className="text-[7px] font-bold text-slate-400">Quotes</div></div>
            </div>
            {u.overdueNow.length > 0 && <div className="px-2 py-1 bg-red-50 border border-red-200 rounded text-[10px] text-red-700 font-bold">⚠️ {u.overdueNow.length} overdue</div>}
            {u.totalActions === 0 && <div className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[10px] text-slate-400">No activity</div>}
            <div className="text-[9px] text-blue-400 font-bold mt-2 text-center">Tap for full breakdown →</div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── PIPELINE ──
  const renderPipeline = () => {
    const cust = customers || [];
    const userStats = (users||[]).map(u => {
      const assigned = cust.filter(c => c.assigned_rep === u.id);
      const byStage = {};
      PIPELINE_STAGES.forEach(s => { byStage[s.v] = assigned.filter(c => (c.pipeline_stage||'lead') === s.v).length; });
      return { ...u, assigned: assigned.length, byStage };
    }).filter(u => u.assigned > 0);
    const overallByStage = {};
    PIPELINE_STAGES.forEach(s => { overallByStage[s.v] = cust.filter(c => (c.pipeline_stage||'lead') === s.v).length; });
    const drillClients = drillStage ? cust.filter(c => (c.pipeline_stage||'lead') === drillStage && (!drillUser || c.assigned_rep === drillUser)) : [];

    return (<div>
      <div className="bg-white rounded-xl p-4 mb-3">
        <h3 className="text-sm font-bold mb-3">Overall Pipeline</h3>
        <div className="flex gap-1 flex-wrap">
          {PIPELINE_STAGES.map(s => (
            <button key={s.v} onClick={() => { setDrillStage(s.v); setDrillUser(null); }}
              className={'px-3 py-2 rounded-lg text-xs font-bold transition flex-1 min-w-[70px] text-center '+(drillStage===s.v&&!drillUser?'text-white shadow':'')}
              style={drillStage===s.v&&!drillUser?{background:s.c}:{background:s.c+'15',color:s.c}}>
              <div className="text-lg">{overallByStage[s.v]}</div>
              <div className="text-[9px]">{s.icon} {s.l}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-xl p-4 mb-3">
        <h3 className="text-sm font-bold mb-3">By Team Member</h3>
        <div className="overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead><tr className="bg-slate-50">
              <th className="px-3 py-2 text-left font-bold">Rep</th>
              <th className="px-3 py-2 text-center font-bold">Total</th>
              {PIPELINE_STAGES.map(s => <th key={s.v} className="px-2 py-2 text-center" style={{color:s.c}}>{s.icon}</th>)}
            </tr></thead>
            <tbody>{userStats.map(u => (
              <tr key={u.id} className="border-b border-slate-50">
                <td className="px-3 py-2 font-semibold">{u.name}</td>
                <td className="px-3 py-2 text-center font-bold">{u.assigned}</td>
                {PIPELINE_STAGES.map(s => (
                  <td key={s.v} className="px-2 py-2 text-center">
                    {u.byStage[s.v]>0 ? <button onClick={()=>{setDrillStage(s.v);setDrillUser(u.id);}} className="px-2 py-0.5 rounded font-bold text-white text-[10px]" style={{background:s.c}}>{u.byStage[s.v]}</button> : <span className="text-slate-300">—</span>}
                  </td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      {drillStage && (
        <div className="bg-white rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-bold">{PIPELINE_STAGES.find(s=>s.v===drillStage)?.icon} {PIPELINE_STAGES.find(s=>s.v===drillStage)?.l}{drillUser&&' — '+getUserName(drillUser)} <span className="text-slate-400">({drillClients.length})</span></h3>
            <button onClick={()=>{setDrillStage(null);setDrillUser(null);}} className="px-2 py-1 border rounded text-xs">✕</button>
          </div>
          <div className="space-y-1 max-h-[300px] overflow-auto">
            {drillClients.map(c => {
              const rep = users?.find(u => u.id === c.assigned_rep);
              return (<div key={c.id} className="flex justify-between items-center py-2 px-2 border-b border-slate-50 hover:bg-slate-50 rounded">
                <div><div className="text-xs font-bold">{c.name_en||c.name}</div><div className="text-[10px] text-slate-500">{c.industry||''} {c.group_name?'· '+c.group_name:''}</div></div>
                <div className="text-right">{rep&&<div className="text-[10px] text-indigo-600 font-semibold">{rep.name}</div>}{c.phone&&<div className="text-[10px] text-slate-400">{c.phone}</div>}</div>
              </div>);
            })}
            {drillClients.length===0&&<div className="text-xs text-slate-400 text-center py-4">No clients</div>}
          </div>
        </div>
      )}
    </div>);
  };

  return (<div>
    <h2 className="text-xl font-extrabold mb-3">Admin Dashboard / لوحة الإدارة</h2>
    {!isSuperAdmin && visibleUsers.length <= 1 && (
      <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3 border border-amber-200 text-xs text-amber-700">
        You see direct reports only. Ask Super Admin to set <strong>reports_to</strong>.
      </div>
    )}
    {!selUser && (
      <div className="flex gap-1 mb-3 flex-wrap">
        {[['scorecards','📊 Scorecards'],['pipeline','🏆 Sales Pipeline']].map(([v,l]) => (
          <button key={v} onClick={()=>setSection(v)}
            className={'px-3 py-1.5 rounded-lg text-xs font-semibold transition '+(section===v?'bg-slate-900 text-white':'bg-slate-100 text-slate-500')}>{l}</button>
        ))}
      </div>
    )}
    {selUser ? renderDetail() : section === 'scorecards' ? renderGrid() : renderPipeline()}
  </div>);
}
