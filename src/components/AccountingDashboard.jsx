// v55.83-BG — Accounting dashboard. Sections: A Receivables Summary, B Upcoming
// Due, C Overdue Aging (+ per-row View/Ignore + $200 threshold toggle), D Bank
// Review, E Wave Sync. AR is computed per invoice (never stale balance_due):
//   open = total_amount - wave_imported_paid - SUM(non-void hub/plaid payments)
// Excludes void/cancelled/archived/deleted. Ignored overdue invoices are kept out
// of overdue totals unless the toggle is on.
import { useState, useEffect } from 'react';
import { supabase, dbUpdate, logActivity } from '../lib/supabase';
import { canViewBank, canSeeAmounts } from '../lib/bank-permissions';
import { fetchAllRows } from '../lib/fetch-all-rows';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
var OVERDUE_MIN = 200;

export default function AccountingDashboard(props) {
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var mayView = canViewBank(isSuperAdmin, modulePerms);
  var seeAmounts = canSeeAmounts(isSuperAdmin, modulePerms);
  function money(n) { return seeAmounts ? ('$' + fmt(n)) : '•••••'; }

  var [d, setD] = useState(null);
  var [loading, setLoading] = useState(true);
  var [showSmall, setShowSmall] = useState(false);     // show small (<$200) + ignored overdue
  var [busy, setBusy] = useState(false);
  var [viewing, setViewing] = useState(null);
  var [viewItems, setViewItems] = useState([]);

  function daysUntil(due, today) {
    if (!due) return 0;
    return Math.round((new Date(due + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000);
  }

  function load() {
    setLoading(true);
    var today = new Date().toISOString().substring(0, 10);
    Promise.all([
      fetchAllRows('accounting_invoices', '*').catch(function () { return { data: [] }; }),
      fetchAllRows('accounting_customers', 'id,company_name').catch(function () { return { data: [] }; }),
      fetchAllRows('accounting_invoice_payments', 'accounting_invoice_id,amount,payment_date,sync_status').catch(function () { return { data: [] }; }),
      supabase.from('bank_transactions').select('id,review_status').then(function (x) { return x; }).catch(function () { return { data: [] }; }),
      supabase.from('wave_sync_log').select('entity_type,success,error_message,completed_at,attempted_at').order('id', { ascending: false }).limit(1).then(function (x) { return x; }).catch(function () { return { data: [] }; }),
      supabase.from('daily_log').select('entry_text,log_date,log_category').in('log_category', ['accounting_invoices', 'accounting_proformas', 'accounting_customers', 'bank_review']).order('log_date', { ascending: false }).limit(12).then(function (x) { return x; }).catch(function () { return { data: [] }; }),
    ]).then(function (r) {
      var inv = (r[0] && r[0].data) || [];
      var custs = (r[1] && r[1].data) || [];
      var pays = (r[2] && r[2].data) || [];
      var txns = (r[3] && r[3].data) || [];
      var lastLog = (r[4] && r[4].data && r[4].data[0]) || null;
      var activity = (r[5] && r[5].data) || [];
      var custName = {}; custs.forEach(function (c) { custName[c.id] = c.company_name; });

      var payByInv = {};
      pays.forEach(function (p) {
        var st = p.sync_status;
        if (st === 'void' || st === 'cancelled' || st === 'reversed' || st === 'deleted') return;
        payByInv[p.accounting_invoice_id] = (payByInv[p.accounting_invoice_id] || 0) + (Number(p.amount) || 0);
      });
      var paidTodayTotal = 0, paidTodayCount = 0;
      pays.forEach(function (p) { if (p.payment_date === today && p.sync_status !== 'void') { paidTodayTotal += Number(p.amount) || 0; paidTodayCount++; } });

      function isLive(i) { var st = i.record_status; return st !== 'void' && st !== 'cancelled' && st !== 'archived' && st !== 'deleted'; }
      function paidOf(i) { return r2((Number(i.wave_imported_paid) || 0) + (payByInv[i.id] || 0)); }
      function openOf(i) { return r2((Number(i.total_amount) || 0) - (Number(i.wave_imported_paid) || 0) - (payByInv[i.id] || 0)); }
      var arInv = inv.filter(function (i) { return isLive(i) && i.approval_status === 'approved'; });

      var overdueRows = [], currentRows = [];
      var openTotal = 0, openCount = 0, creditTotal = 0;
      var balByCust = {};
      arInv.forEach(function (i) {
        var ob = openOf(i);
        if (ob < -0.005) { creditTotal += (-ob); return; }
        if (ob <= 0.005) return;
        openTotal += ob; openCount += 1;
        balByCust[i.accounting_customer_id] = (balByCust[i.accounting_customer_id] || 0) + ob;
        var du = daysUntil(i.due_date, today);
        var row = {
          id: i.id, num: i.invoice_number, cust: custName[i.accounting_customer_id] || '(unknown)',
          inv_date: i.invoice_date || '', due_date: i.due_date || '', status: i.payment_status || '',
          total: r2(i.total_amount), paid: paidOf(i), balance: ob,
          source: i.source === 'wave_import' ? 'Wave' : 'Hub',
          du: du, ignored: i.overdue_dashboard_ignored === true
        };
        if (du < 0) overdueRows.push(row); else currentRows.push(row);
      });
      function byDue(a, b) { var ad = a.due_date || '9999-12-31', bd = b.due_date || '9999-12-31'; return ad < bd ? -1 : ad > bd ? 1 : 0; }
      overdueRows.sort(byDue); currentRows.sort(byDue);

      var custBalances = Object.keys(balByCust).map(function (id) { return { name: custName[id] || '(unknown)', bal: r2(balByCust[id]) }; })
        .sort(function (a, b) { return b.bal - a.bal; }).slice(0, 8);

      var unmatched = txns.filter(function (t) { return (t.review_status || 'unreviewed') === 'unreviewed'; });
      var pendingApproval = inv.filter(function (i) { return isLive(i) && i.approval_status === 'internal_review'; });

      // Wave sync counts (from invoice wave_sync_status)
      var ws = { pending: 0, failed: 0, conflict: 0, synced: 0 };
      arInv.forEach(function (i) { var s = i.wave_sync_status; if (s === 'pending_sync') ws.pending++; else if (s === 'failed') ws.failed++; else if (s === 'conflict') ws.conflict++; else if (s === 'synced') ws.synced++; });

      // diagnostic audit
      var diag = { total: inv.length, wave: 0, hub: 0, withWaveId: 0, byYear: {}, maxDate: '', maxNum: '', sumTotal: 0, sumWave: 0, sumHub: 0, inclAR: 0 };
      inv.forEach(function (i) {
        if (i.source === 'wave_import') diag.wave++; else diag.hub++;
        if (i.wave_invoice_id) diag.withWaveId++;
        var yr = i.invoice_date ? String(i.invoice_date).substring(0, 4) : '(no date)'; diag.byYear[yr] = (diag.byYear[yr] || 0) + 1;
        if ((i.invoice_date || '') > diag.maxDate) diag.maxDate = i.invoice_date || diag.maxDate;
        if ((i.invoice_number || '') > diag.maxNum) diag.maxNum = i.invoice_number || diag.maxNum;
        diag.sumTotal += Number(i.total_amount) || 0; diag.sumWave += Number(i.wave_imported_paid) || 0;
      });
      Object.keys(payByInv).forEach(function (k) { diag.sumHub += payByInv[k]; });
      diag.inclAR = openCount; diag.sumTotal = r2(diag.sumTotal); diag.sumWave = r2(diag.sumWave); diag.sumHub = r2(diag.sumHub);

      setD({
        openTotal: r2(openTotal), openCount: openCount, creditTotal: r2(creditTotal),
        overdueRows: overdueRows, currentRows: currentRows, custBalances: custBalances,
        unmatchedCount: unmatched.length, pendingApproval: pendingApproval.length,
        paidTodayTotal: r2(paidTodayTotal), paidTodayCount: paidTodayCount,
        ws: ws, lastLog: lastLog, activity: activity, diag: diag
      });
    }).catch(function (e) { console.error('[acctdash]', e); }).finally(function () { setLoading(false); });
  }
  useEffect(function () { if (mayView) load(); else setLoading(false); }, []);

  function toggleIgnore(row, ignore) {
    if (busy) return;
    var note = '';
    if (ignore) { note = window.prompt('Hide ' + (row.num || 'invoice') + ' from overdue dashboard. Optional note:') ; if (note === null) return; }
    setBusy(true);
    var patch = ignore
      ? { overdue_dashboard_ignored: true, overdue_dashboard_ignored_by: userProfile && userProfile.id, overdue_dashboard_ignored_at: new Date().toISOString(), overdue_dashboard_ignore_note: (note || '').trim() || null }
      : { overdue_dashboard_ignored: false, overdue_dashboard_ignored_by: null, overdue_dashboard_ignored_at: null, overdue_dashboard_ignore_note: null };
    dbUpdate('accounting_invoices', row.id, patch, userProfile && userProfile.id)
      .then(function () { return logActivity(userProfile && userProfile.id, (ignore ? 'Ignored' : 'Un-ignored') + ' overdue invoice ' + (row.num || row.id) + ' on dashboard' + (ignore && note ? ' (' + note + ')' : ''), 'accounting_invoices'); })
      .then(function () { load(); })
      .catch(function (e) { console.error('[ignore]', e); })
      .finally(function () { setBusy(false); });
  }
  function openView(row) {
    setViewing(row); setViewItems([]);
    supabase.from('accounting_invoice_items').select('*').eq('invoice_id', row.id).order('sort_order', { ascending: true })
      .then(function (r) { setViewItems((r && r.data) || []); }).catch(function () { setViewItems([]); });
  }

  if (!mayView) return null;
  if (loading || !d) return <div className="p-4 text-slate-400 text-sm">Loading dashboard…</div>;

  // overdue filter: default hide <$200 and ignored; toggle shows all
  var shownOverdue = showSmall ? d.overdueRows : d.overdueRows.filter(function (r) { return !r.ignored && r.balance >= OVERDUE_MIN; });
  var overdueTotal = r2(shownOverdue.reduce(function (a, r) { return a + r.balance; }, 0));
  function odBucket(rows, lo, hi) { var f = rows.filter(function (r) { var o = -r.du; return o >= lo && (hi == null || o <= hi); }); return { t: r2(f.reduce(function (a, r) { return a + r.balance; }, 0)), c: f.length }; }
  function duBucket(rows, lo, hi) { var f = rows.filter(function (r) { return r.du >= lo && (hi == null || r.du <= hi); }); return { t: r2(f.reduce(function (a, r) { return a + r.balance; }, 0)), c: f.length }; }
  var nowB = duBucket(d.currentRows, 0, 0), d30 = duBucket(d.currentRows, 1, 30), d60 = duBucket(d.currentRows, 31, 60), d90 = duBucket(d.currentRows, 61, 90);
  var o30 = odBucket(shownOverdue, 1, 30), o60 = odBucket(shownOverdue, 31, 60), o90 = odBucket(shownOverdue, 61, 90), o90p = odBucket(shownOverdue, 91, null);

  function Stat(p) {
    return (
      <div className={'rounded-lg p-3 ' + (p.tone || 'bg-slate-800')}>
        <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wide">{p.title}</div>
        <div className="text-lg font-extrabold text-white mt-0.5">{p.big}</div>
        {p.sub ? <div className="text-[10px] text-slate-300 mt-0.5">{p.sub}</div> : null}
      </div>
    );
  }
  function Section(p) { return <div className="mt-5"><div className="text-sm font-extrabold text-slate-100 mb-2">{p.title}</div>{p.children}</div>; }

  return (
    <div className="p-4">
      <div className="text-lg font-extrabold text-slate-100 mb-1">📊 Accounting Dashboard</div>

      {/* A — Receivables Summary */}
      <Section title="A · Receivables summary">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
          <Stat title="Open AR" big={money(d.openTotal)} sub={d.openCount + ' open invoice(s)'} tone="bg-slate-800" />
          <Stat title="Overdue AR" big={money(overdueTotal)} sub={shownOverdue.length + ' overdue' + (showSmall ? '' : ' (≥ $200)')} tone={shownOverdue.length ? 'bg-rose-900' : 'bg-slate-800'} />
          <Stat title="Customer credits" big={money(d.creditTotal)} sub="overpaid / not AR" tone={d.creditTotal ? 'bg-violet-900' : 'bg-slate-800'} />
          <Stat title="Approvals pending" big={d.pendingApproval} sub="invoices in review" tone={d.pendingApproval ? 'bg-blue-900' : 'bg-slate-800'} />
        </div>
      </Section>

      {/* B — Upcoming Due */}
      <Section title="B · Upcoming due (not overdue)">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
          <Stat title="Due now" big={money(nowB.t)} sub={nowB.c + ' invoice(s)'} tone="bg-slate-800" />
          <Stat title="Due in 1–30 days" big={money(d30.t)} sub={d30.c + ' invoice(s)'} tone="bg-slate-800" />
          <Stat title="Due in 31–60 days" big={money(d60.t)} sub={d60.c + ' invoice(s)'} tone="bg-slate-800" />
          <Stat title="Due in 61–90 days" big={money(d90.t)} sub={d90.c + ' invoice(s)'} tone="bg-slate-800" />
        </div>
      </Section>

      {/* C — Overdue Aging */}
      <Section title="C · Overdue aging">
        <div className="flex items-center justify-between mb-2">
          <div className="grid gap-2 flex-1" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <Stat title="Overdue 1–30" big={money(o30.t)} sub={o30.c + ' inv'} tone={o30.t ? 'bg-rose-900' : 'bg-slate-800'} />
            <Stat title="Overdue 31–60" big={money(o60.t)} sub={o60.c + ' inv'} tone={o60.t ? 'bg-rose-900' : 'bg-slate-800'} />
            <Stat title="Overdue 61–90" big={money(o90.t)} sub={o90.c + ' inv'} tone={o90.t ? 'bg-rose-900' : 'bg-slate-800'} />
            <Stat title="Overdue 90+" big={money(o90p.t)} sub={o90p.c + ' inv'} tone={o90p.t ? 'bg-rose-950' : 'bg-slate-800'} />
          </div>
        </div>
        <label className="text-[11px] text-slate-200 font-bold flex items-center gap-2 mb-2 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 cursor-pointer w-fit">
          <input type="checkbox" checked={showSmall} onChange={function (e) { setShowSmall(e.target.checked); }} /> Show small (under $200) &amp; ignored overdue invoices
        </label>
        <div className="bg-white text-slate-900 rounded-lg p-3">
          {shownOverdue.length === 0 ? <div className="text-xs text-slate-500 italic">No overdue invoices{showSmall ? '' : ' at or above $200'}.</div> : (
            <div style={{ overflowX: 'auto' }}><div style={{ minWidth: '760px' }}>
              <div className="grid text-[11px] font-extrabold text-slate-600 border-b border-slate-200" style={{ gridTemplateColumns: '90px 1fr 84px 70px 84px 64px 150px' }}>
                <div className="py-1">Number</div><div className="py-1">Customer</div><div className="py-1">Due date</div><div className="py-1 text-right">Days</div><div className="py-1 text-right">Balance</div><div className="py-1">Source</div><div className="py-1">Actions</div>
              </div>
              <div style={{ maxHeight: '40vh', overflowY: 'auto' }}>
                {shownOverdue.map(function (t) {
                  return (
                    <div key={t.id} className={'grid text-[11px] border-b border-slate-100 last:border-0 items-center ' + (t.ignored ? 'opacity-60' : '')} style={{ gridTemplateColumns: '90px 1fr 84px 70px 84px 64px 150px' }}>
                      <div className="py-1 font-mono font-bold text-slate-900">{t.num || '—'}</div>
                      <div className="py-1 text-slate-900 truncate">{t.cust}</div>
                      <div className="py-1 text-rose-700 font-bold">{t.due_date || '—'}</div>
                      <div className="py-1 text-right text-rose-700 font-bold">{-t.du}</div>
                      <div className="py-1 text-right font-mono font-bold text-slate-900">{money(t.balance)}</div>
                      <div className="py-1"><span className={'text-[9px] rounded px-1 py-0.5 font-bold text-white ' + (t.source === 'Wave' ? 'bg-sky-700' : 'bg-emerald-700')}>{t.source}</span></div>
                      <div className="py-1 flex gap-1">
                        <button onClick={function () { openView(t); }} className="text-[10px] bg-sky-700 hover:bg-sky-600 text-white rounded px-1.5 py-0.5 font-bold">View</button>
                        {t.ignored
                          ? <button disabled={busy} onClick={function () { toggleIgnore(t, false); }} className="text-[10px] bg-amber-600 hover:bg-amber-500 text-white rounded px-1.5 py-0.5 font-bold">Un-ignore</button>
                          : <button disabled={busy} onClick={function () { toggleIgnore(t, true); }} className="text-[10px] bg-slate-600 hover:bg-slate-500 text-white rounded px-1.5 py-0.5 font-bold">Ignore</button>}
                        {t.ignored ? <span className="text-[9px] text-slate-500 self-center">ignored</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div></div>
          )}
          <div className="text-[10px] text-slate-500 mt-1">Ignore hides an invoice from overdue reporting only — it does not delete it or change Wave, and it is reversible (toggle above to see &amp; un-ignore).</div>
        </div>
      </Section>

      {/* D — Bank Review */}
      <Section title="D · Bank review">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
          <Stat title="Unmatched bank txns" big={d.unmatchedCount} sub="not yet reviewed/matched" tone={d.unmatchedCount ? 'bg-amber-900' : 'bg-slate-800'} />
          <Stat title="Payments received today" big={d.paidTodayCount} sub={money(d.paidTodayTotal)} tone="bg-emerald-900" />
        </div>
        <div className="text-[10px] text-slate-400 mt-1">“Deposits awaiting allocation” will appear here once its calculation is verified.</div>
      </Section>

      {/* E — Wave Sync */}
      <Section title="E · Wave sync">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          <Stat title="Pending sync" big={d.ws.pending} sub="awaiting push" tone={d.ws.pending ? 'bg-blue-900' : 'bg-slate-800'} />
          <Stat title="Failed sync" big={d.ws.failed} sub="need attention" tone={d.ws.failed ? 'bg-rose-900' : 'bg-slate-800'} />
          <Stat title="Conflicts" big={d.ws.conflict} sub="changed both sides" tone={d.ws.conflict ? 'bg-amber-900' : 'bg-slate-800'} />
          <Stat title="Last sync" big={d.lastLog ? (d.lastLog.success ? 'OK' : 'Failed') : '—'} sub={d.lastLog ? String(d.lastLog.completed_at || d.lastLog.attempted_at || '').substring(0, 16).replace('T', ' ') : 'no runs yet'} tone={d.lastLog && !d.lastLog.success ? 'bg-rose-900' : 'bg-slate-800'} />
        </div>
        <div className="text-[10px] text-slate-400 mt-1">Hub→Wave push is staged (payments carry wave IDs + pending_wave_sync); the scheduled sync job is a later build.</div>
      </Section>

      {/* Top customers */}
      <Section title="Top customer balances">
        <div className="bg-white text-slate-900 rounded-lg p-3">
          {d.custBalances.length === 0 ? <div className="text-xs text-slate-500 italic">No outstanding balances.</div> :
            d.custBalances.map(function (c, i) {
              return <div key={i} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0"><span className="font-medium text-slate-900 truncate">{c.name}</span><span className="font-mono font-bold text-slate-900">{money(c.bal)}</span></div>;
            })}
          <div className="text-[10px] text-slate-500 mt-1">total − Wave paid − bank payments · void/cancelled/archived excluded</div>
        </div>
      </Section>

      {isSuperAdmin && (
        <div className="mt-4 bg-slate-950 text-slate-100 rounded-lg p-3 border border-slate-700 text-[11px]">
          <div className="font-extrabold text-amber-300 mb-1">🔬 AR data audit (super-admin)</div>
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))' }}>
            <div>Invoices loaded: <b>{d.diag.total}</b> (Wave {d.diag.wave} · Hub {d.diag.hub})</div>
            <div>With Wave ID: <b>{d.diag.withWaveId}</b> <span className="text-slate-400">(audit ≈ 1,285)</span></div>
            <div>Max invoice date: <b>{d.diag.maxDate || '—'}</b></div>
            <div>Max invoice #: <b>{d.diag.maxNum || '—'}</b></div>
            <div>Σ total: <b>{money(d.diag.sumTotal)}</b></div>
            <div>Σ Wave paid: <b>{money(d.diag.sumWave)}</b></div>
            <div>Σ Hub paid: <b>{money(d.diag.sumHub)}</b></div>
            <div>Open AR: <b className="text-emerald-300">{money(d.openTotal)}</b></div>
          </div>
          <div className="mt-1">By year: {Object.keys(d.diag.byYear).sort().map(function (y) { return y + ': ' + d.diag.byYear[y]; }).join('  ·  ')}</div>
        </div>
      )}

      {viewing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '24px' }} onClick={function () { setViewing(null); }}>
          <div className="bg-slate-900 border border-slate-600 rounded-xl w-full text-slate-100" style={{ maxWidth: '720px' }} onClick={function (e) { e.stopPropagation(); }}>
            <div className="flex items-center justify-between p-3 border-b border-slate-700">
              <div className="font-extrabold">Invoice {viewing.num} <span className="text-[10px] text-slate-400">(read-only)</span></div>
              <button onClick={function () { setViewing(null); }} className="text-slate-300 hover:text-white px-2">✕</button>
            </div>
            <div className="p-3 text-xs">
              <div className="grid gap-1 mb-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <div><div className="text-[10px] text-slate-400">Customer</div>{viewing.cust}</div>
                <div><div className="text-[10px] text-slate-400">Due date</div><span className="text-rose-400 font-bold">{viewing.due_date || '—'}</span></div>
                <div><div className="text-[10px] text-slate-400">Source</div>{viewing.source}</div>
              </div>
              <table className="w-full mb-2"><thead><tr className="text-slate-400 text-left"><th className="py-1">Description</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Line</th></tr></thead>
                <tbody>{viewItems.length === 0 ? <tr><td colSpan={4} className="text-slate-500 italic py-1">No line items.</td></tr> : viewItems.map(function (it, i) {
                  var lt = (it.line_total != null && Number(it.line_total) !== 0) ? Number(it.line_total) : (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
                  return <tr key={i} className="border-t border-slate-800"><td className="py-1">{it.description || it.product_ref || ''}</td><td className="text-right">{it.quantity}</td><td className="text-right font-mono">{fmt(it.unit_price)}</td><td className="text-right font-mono">{fmt(lt)}</td></tr>;
                })}</tbody>
              </table>
              <div className="flex justify-end gap-4 text-right">
                <div><div className="text-[10px] text-slate-400">Total</div><b>{money(viewing.total)}</b></div>
                <div><div className="text-[10px] text-slate-400">Paid</div>{money(viewing.paid)}</div>
                <div><div className="text-[10px] text-slate-400">Balance</div><b className="text-rose-300">{money(viewing.balance)}</b></div>
              </div>
              <div className="text-[10px] text-slate-500 mt-2">To edit this invoice, open it from Accounting → Invoices (Reopen if approved).</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
