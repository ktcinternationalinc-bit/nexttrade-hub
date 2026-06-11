// v55.83-AC — Accounting dashboard. Read-only widgets. Amounts respect See Amounts.
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { canViewBank, canSeeAmounts } from '../lib/bank-permissions';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function AccountingDashboard(props) {
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var mayView = canViewBank(isSuperAdmin, modulePerms);
  var seeAmounts = canSeeAmounts(isSuperAdmin, modulePerms);
  function money(n) { return seeAmounts ? ('$' + fmt(n)) : '•••••'; }

  var [d, setD] = useState(null);
  var [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    var today = new Date().toISOString().substring(0, 10);
    Promise.all([
      supabase.from('accounting_invoices').select('*'),
      supabase.from('accounting_customers').select('id,company_name'),
      supabase.from('bank_transactions').select('id,direction,review_status,amount_abs'),
      supabase.from('unapplied_deposits').select('amount,status'),
      supabase.from('payment_matches').select('matched_amount,matched_at'),
      supabase.from('daily_log').select('entry_text,log_date,log_category').in('log_category', ['accounting_invoices', 'accounting_proformas', 'accounting_customers', 'bank_review']).order('log_date', { ascending: false }).limit(15),
    ]).then(function (r) {
      var inv = (r[0] && r[0].data) || [];
      var custs = (r[1] && r[1].data) || [];
      var txns = (r[2] && r[2].data) || [];
      var deps = (r[3] && r[3].data) || [];
      var pms = (r[4] && r[4].data) || [];
      var activity = (r[5] && r[5].data) || [];
      var custName = {}; custs.forEach(function (c) { custName[c.id] = c.company_name; });

      var open = inv.filter(function (i) { return (i.payment_status !== 'paid') && i.approval_status === 'approved'; });
      var overdue = open.filter(function (i) { return i.due_date && i.due_date < today && Number(i.balance_due || 0) > 0; });
      var pendingApproval = inv.filter(function (i) { return i.approval_status === 'internal_review'; });
      var waveErrors = inv.filter(function (i) { return i.sync_status === 'error'; }); // placeholder until Phase 4

      var balByCust = {};
      inv.forEach(function (i) { if (Number(i.balance_due || 0) > 0) { balByCust[i.accounting_customer_id] = (balByCust[i.accounting_customer_id] || 0) + Number(i.balance_due || 0); } });
      var custBalances = Object.keys(balByCust).map(function (id) { return { name: custName[id] || '(unknown)', bal: balByCust[id] }; }).sort(function (a, b) { return b.bal - a.bal; }).slice(0, 6);

      var unmatched = txns.filter(function (t) { return (t.review_status || 'unreviewed') === 'unreviewed'; });
      var depositsOpen = deps.filter(function (x) { return x.status === 'open'; });
      var depositsTotal = depositsOpen.reduce(function (a, x) { return a + Number(x.amount || 0); }, 0);
      var paidToday = pms.filter(function (m) { return m.matched_at && String(m.matched_at).substring(0, 10) === today; });
      var paidTodayTotal = paidToday.reduce(function (a, m) { return a + Number(m.matched_amount || 0); }, 0);

      setD({
        openCount: open.length, openTotal: open.reduce(function (a, i) { return a + Number(i.balance_due || 0); }, 0),
        overdueCount: overdue.length, overdueTotal: overdue.reduce(function (a, i) { return a + Number(i.balance_due || 0); }, 0),
        custBalances: custBalances,
        unmatchedCount: unmatched.length,
        depositsCount: depositsOpen.length, depositsTotal: depositsTotal,
        paidTodayCount: paidToday.length, paidTodayTotal: paidTodayTotal,
        pendingApproval: pendingApproval.length,
        waveErrors: waveErrors.length,
        activity: activity,
      });
    }).catch(function (e) { console.error('[acctdash]', e); }).finally(function () { setLoading(false); });
  }
  useEffect(function () { if (mayView) load(); else setLoading(false); }, []);

  if (!mayView) return null;
  if (loading || !d) return <div className="p-4 text-slate-400 text-sm">Loading dashboard…</div>;

  function Card(p) {
    return (
      <div className={'rounded-lg p-3 ' + (p.tone || 'bg-slate-800')}>
        <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">{p.title}</div>
        <div className="text-xl font-extrabold text-white mt-1">{p.big}</div>
        {p.sub ? <div className="text-[11px] text-slate-300 mt-0.5">{p.sub}</div> : null}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="text-lg font-extrabold text-slate-100 mb-3">📊 Accounting Dashboard</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <Card title="Open invoices" big={d.openCount} sub={money(d.openTotal) + ' outstanding'} tone="bg-slate-800" />
        <Card title="Overdue invoices" big={d.overdueCount} sub={money(d.overdueTotal) + ' overdue'} tone={d.overdueCount ? 'bg-rose-900' : 'bg-slate-800'} />
        <Card title="Payments received today" big={d.paidTodayCount} sub={money(d.paidTodayTotal)} tone="bg-emerald-900" />
        <Card title="Unmatched bank txns" big={d.unmatchedCount} sub="need review" tone={d.unmatchedCount ? 'bg-amber-900' : 'bg-slate-800'} />
        <Card title="Deposits to allocate" big={d.depositsCount} sub={money(d.depositsTotal)} tone="bg-slate-800" />
        <Card title="Approvals pending" big={d.pendingApproval} sub="invoices in review" tone={d.pendingApproval ? 'bg-blue-900' : 'bg-slate-800'} />
        <Card title="Wave sync errors" big={d.waveErrors} sub="(Phase 4 placeholder)" tone="bg-slate-800" />
      </div>

      <div className="mt-4 bg-white text-slate-900 rounded-lg p-3">
        <div className="text-sm font-extrabold mb-2">Recent accounting activity</div>
        {(!d.activity || d.activity.length === 0) ? <div className="text-xs text-slate-500 italic">No recent activity.</div> :
          d.activity.map(function (a, i) {
            return (
              <div key={i} className="flex justify-between gap-2 text-xs py-1 border-b border-slate-100 last:border-0">
                <span className="text-slate-900 truncate">{a.entry_text}</span>
                <span className="text-slate-400 font-mono whitespace-nowrap">{a.log_date}</span>
              </div>
            );
          })}
      </div>

      <div className="mt-4 bg-white text-slate-900 rounded-lg p-3">
        <div className="text-sm font-extrabold mb-2">Top customer balances</div>
        {d.custBalances.length === 0 ? <div className="text-xs text-slate-500 italic">No outstanding balances.</div> :
          d.custBalances.map(function (c, i) {
            return (
              <div key={i} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                <span className="font-medium text-slate-900 truncate">{c.name}</span>
                <span className="font-mono font-bold text-slate-900">{money(c.bal)}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
