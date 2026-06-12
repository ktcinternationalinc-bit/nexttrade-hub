// v55.83-BD — Accounting dashboard. ACCURACY-FIRST AR. Open balance is computed
// per invoice from the canonical formula (never stale balance_due):
//   open = total_amount - wave_imported_paid - SUM(non-void hub/plaid payment rows)
// Excludes void/cancelled/archived/deleted invoices. Negative open = customer
// credit (not counted as AR). Adds AR aging buckets + a sortable invoice table.
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { canViewBank, canSeeAmounts } from '../lib/bank-permissions';
import { fetchAllRows } from '../lib/fetch-all-rows';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

export default function AccountingDashboard(props) {
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var mayView = canViewBank(isSuperAdmin, modulePerms);
  var seeAmounts = canSeeAmounts(isSuperAdmin, modulePerms);
  function money(n) { return seeAmounts ? ('$' + fmt(n)) : '•••••'; }

  var [d, setD] = useState(null);
  var [loading, setLoading] = useState(true);
  var [bucket, setBucket] = useState('');   // selected aging bucket key for table filter

  function daysUntil(due, today) {
    if (!due) return 0;
    var dd = new Date(due + 'T00:00:00').getTime();
    var t0 = new Date(today + 'T00:00:00').getTime();
    return Math.round((dd - t0) / 86400000);
  }
  function bucketOf(du) {
    if (du < 0) { var od = -du; if (od <= 30) return 'od30'; if (od <= 60) return 'od60'; if (od <= 90) return 'od90'; return 'od90p'; }
    if (du === 0) return 'now';
    if (du <= 30) return 'd30'; if (du <= 60) return 'd60'; if (du <= 90) return 'd90'; return 'later';
  }

  function load() {
    setLoading(true);
    var today = new Date().toISOString().substring(0, 10);
    Promise.all([
      fetchAllRows('accounting_invoices', '*').catch(function () { return { data: [] }; }),
      fetchAllRows('accounting_customers', 'id,company_name').catch(function () { return { data: [] }; }),
      fetchAllRows('accounting_invoice_payments', 'accounting_invoice_id,amount,sync_status').catch(function () { return { data: [] }; }),
      supabase.from('bank_transactions').select('id,review_status').then(function (x) { return x; }).catch(function () { return { data: [] }; }),
      supabase.from('daily_log').select('entry_text,log_date,log_category').in('log_category', ['accounting_invoices', 'accounting_proformas', 'accounting_customers', 'bank_review']).order('log_date', { ascending: false }).limit(15).then(function (x) { return x; }).catch(function () { return { data: [] }; }),
    ]).then(function (r) {
      var inv = (r[0] && r[0].data) || [];
      var custs = (r[1] && r[1].data) || [];
      var pays = (r[2] && r[2].data) || [];
      var txns = (r[3] && r[3].data) || [];
      var activity = (r[4] && r[4].data) || [];
      var custName = {}; custs.forEach(function (c) { custName[c.id] = c.company_name; });

      // non-void hub/plaid payments per invoice
      var payByInv = {};
      pays.forEach(function (p) {
        var st = p.sync_status;
        if (st === 'void' || st === 'cancelled' || st === 'reversed' || st === 'deleted') return;
        payByInv[p.accounting_invoice_id] = (payByInv[p.accounting_invoice_id] || 0) + (Number(p.amount) || 0);
      });

      function isLive(i) { var st = i.record_status; return st !== 'void' && st !== 'cancelled' && st !== 'archived' && st !== 'deleted'; }
      function paidOf(i) { return r2((Number(i.wave_imported_paid) || 0) + (payByInv[i.id] || 0)); }
      function openOf(i) { return r2((Number(i.total_amount) || 0) - (Number(i.wave_imported_paid) || 0) - (payByInv[i.id] || 0)); }

      // AR = issued (approved) + live invoices. Drafts/in-review are not AR yet.
      var arInv = inv.filter(function (i) { return isLive(i) && i.approval_status === 'approved'; });

      var buckets = {
        now: { label: 'Due now / current', t: 0, c: 0, inv: [], overdue: false },
        d30: { label: 'Due in 1–30 days', t: 0, c: 0, inv: [], overdue: false },
        d60: { label: 'Due in 31–60 days', t: 0, c: 0, inv: [], overdue: false },
        d90: { label: 'Due in 61–90 days', t: 0, c: 0, inv: [], overdue: false },
        later: { label: 'Due in 90+ days', t: 0, c: 0, inv: [], overdue: false },
        od30: { label: 'Overdue 1–30 days', t: 0, c: 0, inv: [], overdue: true },
        od60: { label: 'Overdue 31–60 days', t: 0, c: 0, inv: [], overdue: true },
        od90: { label: 'Overdue 61–90 days', t: 0, c: 0, inv: [], overdue: true },
        od90p: { label: 'Overdue 90+ days', t: 0, c: 0, inv: [], overdue: true }
      };

      var balByCust = {};
      var creditTotal = 0;
      var openTotal = 0, openCount = 0, overdueTotal = 0, overdueCount = 0;
      var tableRows = [];

      arInv.forEach(function (i) {
        var ob = openOf(i);
        if (ob < -0.005) { creditTotal += (-ob); return; }   // overpaid -> credit, not AR
        if (ob <= 0.005) return;                               // fully paid -> not open
        var du = daysUntil(i.due_date, today);
        var bk = bucketOf(du);
        buckets[bk].t += ob; buckets[bk].c += 1;
        openTotal += ob; openCount += 1;
        if (buckets[bk].overdue) { overdueTotal += ob; overdueCount += 1; }
        balByCust[i.accounting_customer_id] = (balByCust[i.accounting_customer_id] || 0) + ob;
        var trow = {
          id: i.id, num: i.invoice_number, cust: custName[i.accounting_customer_id] || '(unknown)',
          inv_date: i.invoice_date || '', due_date: i.due_date || '', status: i.payment_status || '',
          total: r2(i.total_amount), paid: paidOf(i), balance: ob,
          source: i.source === 'wave_import' ? 'Wave' : 'Hub', bucket: bk
        };
        buckets[bk].inv.push(trow);
        tableRows.push(trow);
      });

      Object.keys(buckets).forEach(function (k) { buckets[k].t = r2(buckets[k].t); });

      // sort open/overdue invoices by due date ascending (earliest/most overdue first; blanks last)
      tableRows.sort(function (a, b) {
        var ad = a.due_date || '9999-12-31', bd = b.due_date || '9999-12-31';
        if (ad < bd) return -1; if (ad > bd) return 1; return 0;
      });

      var custBalances = Object.keys(balByCust).map(function (id) { return { name: custName[id] || '(unknown)', bal: r2(balByCust[id]) }; })
        .sort(function (a, b) { return b.bal - a.bal; }).slice(0, 8);

      var unmatched = txns.filter(function (t) { return (t.review_status || 'unreviewed') === 'unreviewed'; });
      var pendingApproval = inv.filter(function (i) { return isLive(i) && i.approval_status === 'internal_review'; });

      // ---- diagnostic audit (completeness + AR math) ----
      var diag = { total: inv.length, wave: 0, hub: 0, withWaveId: 0, bySync: {}, byYear: {}, maxDate: '', maxNum: '', sumTotal: 0, sumWave: 0, sumHub: 0, inclAR: 0, exDead: 0, exNotApproved: 0, exPaid: 0, exCredit: 0 };
      inv.forEach(function (i) {
        if (i.source === 'wave_import') { diag.wave++; } else { diag.hub++; }
        if (i.wave_invoice_id) { diag.withWaveId++; }
        var ss = i.wave_sync_status || '(none)'; diag.bySync[ss] = (diag.bySync[ss] || 0) + 1;
        var yr = i.invoice_date ? String(i.invoice_date).substring(0, 4) : '(no date)'; diag.byYear[yr] = (diag.byYear[yr] || 0) + 1;
        if ((i.invoice_date || '') > diag.maxDate) { diag.maxDate = i.invoice_date || diag.maxDate; }
        if ((i.invoice_number || '') > diag.maxNum) { diag.maxNum = i.invoice_number || diag.maxNum; }
        diag.sumTotal += Number(i.total_amount) || 0;
        diag.sumWave += Number(i.wave_imported_paid) || 0;
        if (!isLive(i)) { diag.exDead++; }
        else if (i.approval_status !== 'approved') { diag.exNotApproved++; }
        else { var ob = openOf(i); if (ob < -0.005) { diag.exCredit++; } else if (ob <= 0.005) { diag.exPaid++; } else { diag.inclAR++; } }
      });
      Object.keys(payByInv).forEach(function (k) { diag.sumHub += payByInv[k]; });
      diag.sumTotal = r2(diag.sumTotal); diag.sumWave = r2(diag.sumWave); diag.sumHub = r2(diag.sumHub);

      setD({
        diag: diag,
        openCount: openCount, openTotal: r2(openTotal),
        overdueCount: overdueCount, overdueTotal: r2(overdueTotal),
        creditTotal: r2(creditTotal),
        buckets: buckets, tableRows: tableRows, custBalances: custBalances,
        unmatchedCount: unmatched.length, pendingApproval: pendingApproval.length,
        arInvCount: arInv.length, activity: activity
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

  var order = ['now', 'd30', 'd60', 'd90', 'later', 'od30', 'od60', 'od90', 'od90p'];
  var rows = bucket ? d.tableRows.filter(function (t) { return t.bucket === bucket; }) : d.tableRows;

  return (
    <div className="p-4">
      <div className="text-lg font-extrabold text-slate-100 mb-3">📊 Accounting Dashboard</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <Card title="Open AR" big={money(d.openTotal)} sub={d.openCount + ' open invoice(s)'} tone="bg-slate-800" />
        <Card title="Overdue" big={money(d.overdueTotal)} sub={d.overdueCount + ' overdue'} tone={d.overdueCount ? 'bg-rose-900' : 'bg-slate-800'} />
        <Card title="Customer credits" big={money(d.creditTotal)} sub="overpaid / not AR" tone={d.creditTotal ? 'bg-violet-900' : 'bg-slate-800'} />
        <Card title="Unmatched bank txns" big={d.unmatchedCount} sub="need review" tone={d.unmatchedCount ? 'bg-amber-900' : 'bg-slate-800'} />
        <Card title="Approvals pending" big={d.pendingApproval} sub="invoices in review" tone={d.pendingApproval ? 'bg-blue-900' : 'bg-slate-800'} />
      </div>

      {/* AR AGING */}
      <div className="mt-4 bg-white text-slate-900 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-extrabold">AR aging {bucket ? '· filtered: ' + d.buckets[bucket].label : ''}</div>
          {bucket && <button onClick={function () { setBucket(''); }} className="text-[11px] text-indigo-700 font-bold">show all</button>}
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          {order.map(function (k) {
            var b = d.buckets[k];
            var active = bucket === k;
            var tone = b.overdue ? (b.t > 0 ? 'bg-rose-100 text-rose-950' : 'bg-slate-100 text-slate-700') : (b.t > 0 ? 'bg-emerald-100 text-emerald-950' : 'bg-slate-100 text-slate-700');
            return (
              <button key={k} onClick={function () { setBucket(active ? '' : k); }} className={'text-left rounded-lg p-2 border-2 ' + tone + ' ' + (active ? 'border-indigo-600' : 'border-transparent') + (b.c ? ' cursor-pointer' : ' cursor-default')}>
                <div className="text-[10px] font-bold uppercase tracking-wide">{b.label}</div>
                <div className="text-base font-extrabold">{money(b.t)}</div>
                <div className="text-[11px] font-medium">{b.c} invoice(s)</div>
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-slate-500 mt-2">Open AR total: <b className="text-slate-900">{money(d.openTotal)}</b> across {d.openCount} invoice(s). Click a bucket to filter the list below.</div>
      </div>

      {/* INVOICE TABLE */}
      <div className="mt-4 bg-white text-slate-900 rounded-lg p-3">
        <div className="text-sm font-extrabold mb-1">Open / overdue invoices <span className="text-[11px] font-medium text-slate-500">· sorted by due date (earliest first)</span></div>
        {rows.length === 0 ? <div className="text-xs text-slate-500 italic">No open invoices{bucket ? ' in this bucket' : ''}.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: '880px' }}>
              <div className="grid text-[11px] font-extrabold text-slate-600 border-b border-slate-200" style={{ gridTemplateColumns: '90px 1fr 84px 84px 80px 92px 84px 90px 56px' }}>
                <div className="py-1">Number</div><div className="py-1">Customer</div><div className="py-1">Inv date</div><div className="py-1">Due date</div><div className="py-1">Status</div><div className="py-1 text-right">Total</div><div className="py-1 text-right">Paid</div><div className="py-1 text-right">Balance</div><div className="py-1">Source</div>
              </div>
              <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
                {rows.map(function (t) {
                  var od = t.due_date && t.due_date < new Date().toISOString().substring(0, 10);
                  return (
                    <div key={t.id} className="grid text-[11px] border-b border-slate-100 last:border-0 items-center" style={{ gridTemplateColumns: '90px 1fr 84px 84px 80px 92px 84px 90px 56px' }}>
                      <div className="py-1 font-mono font-bold text-slate-900">{t.num || '—'}</div>
                      <div className="py-1 text-slate-900 truncate">{t.cust}</div>
                      <div className="py-1 text-slate-600">{t.inv_date || '—'}</div>
                      <div className={'py-1 ' + (od ? 'text-rose-700 font-bold' : 'text-slate-600')}>{t.due_date || '—'}</div>
                      <div className="py-1 text-slate-600">{t.status}</div>
                      <div className="py-1 text-right font-mono text-slate-900">{money(t.total)}</div>
                      <div className="py-1 text-right font-mono text-slate-600">{money(t.paid)}</div>
                      <div className="py-1 text-right font-mono font-bold text-slate-900">{money(t.balance)}</div>
                      <div className="py-1"><span className={'text-[9px] rounded px-1 py-0.5 font-bold text-white ' + (t.source === 'Wave' ? 'bg-sky-700' : 'bg-emerald-700')}>{t.source}</span></div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* TOP CUSTOMER BALANCES */}
      <div className="mt-4 bg-white text-slate-900 rounded-lg p-3">
        <div className="text-sm font-extrabold mb-2">Top customer balances <span className="text-[11px] font-medium text-slate-500">· total − Wave paid − bank payments</span></div>
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

      {isSuperAdmin && (
        <div className="mt-4 bg-slate-950 text-slate-100 rounded-lg p-3 border border-slate-700 text-[11px]">
          <div className="font-extrabold text-amber-300 mb-1">🔬 AR data audit (super-admin) — completeness + math</div>
          <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))' }}>
            <div>Invoices loaded: <b>{d.diag.total}</b> (Wave {d.diag.wave} · Hub {d.diag.hub})</div>
            <div>With Wave ID: <b>{d.diag.withWaveId}</b> <span className="text-slate-400">(Wave audit ≈ 1,285)</span></div>
            <div>Max invoice date: <b>{d.diag.maxDate || '—'}</b></div>
            <div>Max invoice #: <b>{d.diag.maxNum || '—'}</b></div>
            <div>Σ total_amount: <b>{money(d.diag.sumTotal)}</b></div>
            <div>Σ wave_imported_paid: <b>{money(d.diag.sumWave)}</b></div>
            <div>Σ Hub/Plaid payments: <b>{money(d.diag.sumHub)}</b></div>
            <div>Computed Open AR: <b className="text-emerald-300">{money(d.openTotal)}</b></div>
          </div>
          <div>By year: {Object.keys(d.diag.byYear).sort().map(function (y) { return y + ': ' + d.diag.byYear[y]; }).join('  ·  ')}</div>
          <div className="mt-0.5">By Wave sync: {Object.keys(d.diag.bySync).map(function (k) { return k + ': ' + d.diag.bySync[k]; }).join('  ·  ')}</div>
          <div className="mt-0.5">AR included: <b className="text-emerald-300">{d.diag.inclAR}</b> · excluded — not approved: {d.diag.exNotApproved} · void/cancelled/archived: {d.diag.exDead} · fully paid: {d.diag.exPaid} · credit/overpaid: {d.diag.exCredit}</div>
          <div className="mt-1 text-slate-400">If "Invoices loaded" &lt; your Wave count, reads are still capped; if it matches, completeness is good. Open AR = Σtotal − Σwave_paid − Σhub_payments across the AR-included set only.</div>
        </div>
      )}

      {/* RECENT ACTIVITY */}
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
    </div>
  );
}
