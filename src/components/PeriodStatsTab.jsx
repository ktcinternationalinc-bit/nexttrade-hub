'use client';
// v55.83-PH — Accounting > 📉 Stats (Max, Nov 6): "i need a tab from june 1st
// on for both invoices and bills to see stats". Default June 1, 2026 → today;
// invoices and bills side by side; month-by-month table; CSV.
import React, { useState, useEffect } from 'react';
import InvoicePeek from './InvoicePeek'; // v55.83-PS — click a reference → the invoice pops up

var KIND_LABELS = { income: 'Income', cogs: 'Cost of goods sold', expense: 'Expense', other_income: 'Other income', other_expense: 'Other expense', transfer: 'Transfer', not_pnl: 'Not P&L (loan/owner)' }; // v55.83-PW

// v55.83-QB (Max, Nov 7): the RTM radio. Real-cost view = take the RTM
// payments OUT of the category they were paid under (professional fees),
// put the covered bills INTO their real categories, and show the
// unallocated remainder as RTM's service fee. −payments + bills + fee = 0,
// so every total is IDENTICAL in both views — only the breakdown moves.
function rtmAdjust(cats0, rtm) {
  var r2a = function (x) { return Math.round((Number(x) || 0) * 100) / 100; };
  var map = {};
  (cats0 || []).forEach(function (c) { map[c.key] = { key: c.key, label: c.label, kind: c.kind, count: c.count, total: c.total }; });
  ((rtm && rtm.payments_by_cat) || []).forEach(function (p) {
    if (!map[p.key]) { map[p.key] = { key: p.key, label: p.label || p.key, kind: 'expense', count: 0, total: 0 }; }
    map[p.key].total = r2a(map[p.key].total - p.total); map[p.key].rtm_out = p.total;
  });
  ((rtm && rtm.allocations_by_cat) || []).forEach(function (a) {
    if (!map[a.key]) { map[a.key] = { key: a.key, label: a.label || a.key, kind: a.kind || 'expense', count: 0, total: 0 }; }
    map[a.key].total = r2a(map[a.key].total + a.total); map[a.key].via_rtm = r2a((map[a.key].via_rtm || 0) + a.total); map[a.key].count += a.count || 0;
  });
  var fee = r2a((rtm && rtm.service_fee) || 0);
  if (Math.abs(fee) > 0.005) { map.__rtm_fee = { key: '__rtm_fee', label: 'RTM service fee (payments − covered bills)', kind: 'expense', count: (rtm && rtm.payments_count) || 0, total: fee }; }
  return Object.keys(map).map(function (k) { return map[k]; })
    .filter(function (c) { return Math.abs(c.total) > 0.004 || c.via_rtm || c.rtm_out; })
    .sort(function (x, y) { return y.total - x.total; });
}
function nd(x) { return (x === null || x === undefined) ? '—' : '$' + (Number(x) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } // v55.83-PO
function fmt(n) { if (n == null) { return '•••'; } return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } // v55.83-QI — masked totals render as •••
var TODAY = new Date().toISOString().substring(0, 10);

export default function PeriodStatsTab(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var canView = isSuperAdmin || modulePerms['accounting.view_totals'] === true || modulePerms['bills.view'] === true || modulePerms['bills.manage'] === true || modulePerms['ar.view_invoice_balances'] === true; // v55.83-PW — accounting.view_totals is the explicit totals level
  var toast = props.toast || { success: function () {}, error: function () {} };

  var s1 = useState('2026-06-01'); var from = s1[0]; var setFrom = s1[1];
  var s2 = useState(TODAY); var to = s2[0]; var setTo = s2[1];
  var sSp = useState(null); var spCat = sSp[0]; var setSpCat = sSp[1]; // v55.83-PQ — spending-by-category drill (category key or '' = uncategorized, 'transfer')
  var sRt = useState(false); var rtmOn = sRt[0]; var setRtmOn = sRt[1]; // v55.83-QB — DEFAULT false = tax view (one professional-fee line)
  var sIn = useState(null); var inCat = sIn[0]; var setInCat = sIn[1]; // v55.83-PV — income-by-category drill
  var sPk = useState(null); var peekId = sPk[0]; var setPeekId = sPk[1]; // v55.83-PS
  var s3 = useState(null); var data = s3[0]; var setData = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState(null); var drill = s5[0]; var setDrill = s5[1]; // {key, title, unitWho}

  function load(f, t) {
    setBusy(true);
    fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'period_stats', from: f, to: t, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { setData(j); } else { toast.error((j && j.error) || 'Could not load stats.'); setData({ denied: true, error: (j && j.error) || '' }); } })
      .finally(function () { setBusy(false); });
  }
  useEffect(function () { if (canView) { load(from, to); } }, []); // eslint-disable-line

  if (!canView) {
    return <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
      Stats need the <b>Bills: View</b> or <b>AR balances</b> permission — Settings → Permissions.</div>;
  }

  function csv() {
    if (!data || !data.months) { return; }
    var L = ['month,invoiced,invoices,collected,payments,bills_entered,bills,bills_paid,bill_payments,net_cash'];
    data.months.forEach(function (m) {
      L.push([m.month, m.invoiced.toFixed(2), m.invoiced_count, m.collected.toFixed(2), m.collected_count,
        m.billed.toFixed(2), m.billed_count, m.bills_paid.toFixed(2), m.bills_paid_count, m.net.toFixed(2)].join(','));
    });
    var blob = new Blob([L.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'period-stats-' + data.from + '-to-' + data.to + '.csv'; a.click();
  }

  function Card(p2) {
    return <button onClick={p2.onClick} className="rounded-xl p-3 text-left" style={{ background: p2.bg, border: '1px solid ' + p2.border, minWidth: 160, flex: '1 1 160px', cursor: 'pointer' }}>
      <div className="text-[10px] font-extrabold uppercase" style={{ color: p2.fg, opacity: 0.75 }}>{p2.label}</div>
      <div className="text-lg font-extrabold tabular-nums" style={{ color: p2.fg }}>{p2.value}</div>
      {p2.sub && <div className="text-[10px] font-semibold" style={{ color: p2.fg, opacity: 0.75 }}>{p2.sub}</div>}
      <div className="text-[9px] font-bold mt-0.5" style={{ color: p2.fg, opacity: 0.55 }}>click for the rows ▸</div>
    </button>;
  }
  function openDrill(key, title, unitWho) { setDrill({ key: key, title: title, unitWho: unitWho }); }
  function drillRows() { return (data && data.drills && data.drills[drill.key]) || []; }
  function drillSum() { var t2 = 0; drillRows().forEach(function (r) { t2 += Number(r.amount) || 0; }); return Math.round(t2 * 100) / 100; }

  function dl(name, lines) {
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = name; a.click();
  }
  function rowsCsv(rows, kindLabel) {
    var lines = ['reference,who,date,due_date,original,paid,open,amount,source'];
    (rows || []).forEach(function (r) {
      lines.push(['"' + String(r.ref || '').replace(/"/g, '""') + '"', '"' + String(r.who || '').replace(/"/g, '""') + '"',
        r.date || '', r.due || '', r.total === null || r.total === undefined ? '' : Number(r.total).toFixed(2),
        r.paid === null || r.paid === undefined ? '' : Number(r.paid).toFixed(2),
        r.open === null || r.open === undefined ? '' : Number(r.open).toFixed(2),
        Number(r.amount || 0).toFixed(2), '"' + String(r.source || '') + '"'].join(','));
    });
    return lines;
  }
  function taxPack() {
    if (data && data.totals_masked) { toast.error('The accountant pack needs the "Accounting: See Money Totals" permission — totals are hidden for your account.'); return; } // v55.83-QI
    // v55.83-PQ (Max, Nov 7 05:09): "need to make sure we have the reports
    // necessary to file our taxes" — one click, every hub CSV the accountant
    // needs for the chosen period, consistently named. (Wave remains the 2026
    // book of record until cutover; this is the supporting detail.)
    var tag = from + '_to_' + to;
    var d = data.drills || {};
    dl('tax-pack-1-revenue-invoiced-' + tag + '.csv', rowsCsv(d.invoiced));
    var col2 = rowsCsv(d.collected);
    // v55.83-PQ (Max, 05:12): "pull data from other system to complete full tax
    // reporting" — Wave-era payments were imported as LIFETIME totals without
    // per-payment dates, so they cannot appear in a dated CSV. Say so IN the
    // file, so no accountant mistakes this for the whole year's collections.
    col2.push('');
    col2.push('"NOTE: payments recorded in Wave before the hub tracked dated payment rows are NOT listed here (Wave stores them as lifetime totals without dates). For periods before the hub, use Wave\'s own Income/Payments report, or ask for the Wave payment-history migration."');
    dl('tax-pack-2-revenue-collected-' + tag + '.csv', col2);
    dl('tax-pack-3-open-receivables-' + tag + '.csv', rowsCsv(d.open_invoices));
    dl('tax-pack-4-bills-entered-' + tag + '.csv', rowsCsv(d.billed));
    dl('tax-pack-5-bills-paid-' + tag + '.csv', rowsCsv(d.bills_paid));
    dl('tax-pack-6-open-payables-' + tag + '.csv', rowsCsv(d.open_bills));
    if (data.spending) {
      var sp = ['category,type,transactions,total_usd'];
      (data.spending.categories || []).forEach(function (c) { sp.push('"' + String(c.label).replace(/"/g, '""') + '",' + (KIND_LABELS[c.kind] || c.kind || 'Expense') + ',' + c.count + ',' + Number(c.total).toFixed(2)); });
      if (data.spending.not_pnl_out && data.spending.not_pnl_out.count > 0) { sp.push('"NOT P&L - loan principal / owner (NOT deductible)",,' + data.spending.not_pnl_out.count + ',' + Number(data.spending.not_pnl_out.total).toFixed(2)); }
      if (data.spending.deductible_spending !== undefined) { sp.push('"DEDUCTIBLE SPENDING (P&L categories only)",,,' + Number(data.spending.deductible_spending).toFixed(2)); }
      if (data.spending.uncategorized) { sp.push('"UNCATEGORIZED (needs review before filing)",' + data.spending.uncategorized.count + ',' + Number(data.spending.uncategorized.total).toFixed(2)); }
      if (data.spending.transfers) { sp.push('"TRANSFERS BETWEEN OWN ACCOUNTS (not deductible spending)",' + data.spending.transfers.count + ',' + Number(data.spending.transfers.total).toFixed(2)); }
      sp.push('"REAL SPENDING (transfers excluded)",,' + Number(data.spending.real_spending).toFixed(2));
      dl('tax-pack-7-spending-by-category-' + tag + '.csv', sp);
      var det = ['date,who,amount,category,paired_transfer'];
      (data.spending.rows || []).forEach(function (r) { det.push(r.date + ',"' + String(r.who).replace(/"/g, '""') + '",' + Number(r.amount).toFixed(2) + ',' + (r.category || 'UNCATEGORIZED') + ',' + (r.paired ? 'yes' : '')); });
      dl('tax-pack-8-spending-detail-' + tag + '.csv', det);
    }
    if (data.spending && data.spending.in_categories) {
      var spi = ['category,type,deposits,total_usd'];
      (data.spending.in_categories || []).forEach(function (c) { spi.push('"' + String(c.label).replace(/"/g, '""') + '",' + (KIND_LABELS[c.kind] || c.kind || '') + ',' + c.count + ',' + Number(c.total).toFixed(2)); });
      if (data.spending.not_pnl_in && data.spending.not_pnl_in.count > 0) { spi.push('"NOT P&L - loan proceeds / owner (NOT income)",,' + data.spending.not_pnl_in.count + ',' + Number(data.spending.not_pnl_in.total).toFixed(2)); }
      if (data.spending.taxable_income !== undefined) { spi.push('"TAXABLE INCOME (P&L categories only)",,,' + Number(data.spending.taxable_income).toFixed(2)); }
      if (data.spending.in_uncategorized) { spi.push('"UNCATEGORIZED DEPOSITS (match before filing)",' + data.spending.in_uncategorized.count + ',' + Number(data.spending.in_uncategorized.total).toFixed(2)); }
      if (data.spending.in_transfers) { spi.push('"TRANSFERS BETWEEN OWN ACCOUNTS (not income)",' + data.spending.in_transfers.count + ',' + Number(data.spending.in_transfers.total).toFixed(2)); }
      spi.push('"REAL MONEY IN (transfers excluded)",,' + Number(data.spending.real_income).toFixed(2));
      dl('tax-pack-10-income-by-category-' + tag + '.csv', spi);
      var deti = ['date,who,amount,category,paired_transfer'];
      (data.spending.in_rows || []).forEach(function (r) { deti.push(r.date + ',"' + String(r.who).replace(/"/g, '""') + '",' + Number(r.amount).toFixed(2) + ',' + (r.category || 'UNCATEGORIZED') + ',' + (r.paired ? 'yes' : '')); });
      dl('tax-pack-11-income-detail-' + tag + '.csv', deti);
    }
    if (data.spending && data.spending.in_categories) {
      var revP = 0, cogsP = 0, expP = 0, oinP = 0, oexP = 0;
      (data.spending.in_categories || []).forEach(function (c) { if (c.kind === 'income') { revP += c.total; } else if (c.kind === 'other_income') { oinP += c.total; } });
      (data.spending.categories || []).forEach(function (c) { if (c.kind === 'cogs') { cogsP += c.total; } else if (c.kind === 'other_expense') { oexP += c.total; } else if (c.kind !== 'not_pnl') { expP += c.total; } });
      var isCsv = ['line,amount_usd'];
      isCsv.push('"Revenue (cash received)",' + revP.toFixed(2));
      isCsv.push('"Cost of goods sold",-' + cogsP.toFixed(2));
      isCsv.push('"GROSS PROFIT",' + (revP - cogsP).toFixed(2));
      isCsv.push('"Operating expenses",-' + expP.toFixed(2));
      isCsv.push('"OPERATING PROFIT",' + (revP - cogsP - expP).toFixed(2));
      isCsv.push('"Other income",' + oinP.toFixed(2));
      isCsv.push('"Other expenses",-' + oexP.toFixed(2));
      isCsv.push('"NET PROFIT (cash basis)",' + (revP - cogsP - expP + oinP - oexP).toFixed(2));
      if (data.spending.in_uncategorized && data.spending.in_uncategorized.total > 0.005) { isCsv.push('"WARNING: uncategorized deposits OUTSIDE this statement",' + data.spending.in_uncategorized.total.toFixed(2)); }
      if (data.spending.uncategorized && data.spending.uncategorized.total > 0.005) { isCsv.push('"WARNING: uncategorized spending OUTSIDE this statement",' + data.spending.uncategorized.total.toFixed(2)); }
      dl('tax-pack-12-income-statement-cash-basis-' + tag + '.csv', isCsv);
    }
    var mo = ['month,invoiced,collected,bills_entered,bills_paid,net_cash'];
    (data.months || []).forEach(function (m) { mo.push(m.month + ',' + m.invoiced.toFixed(2) + ',' + m.collected.toFixed(2) + ',' + m.billed.toFixed(2) + ',' + m.bills_paid.toFixed(2) + ',' + m.net.toFixed(2)); });
    dl('tax-pack-9-monthly-summary-' + tag + '.csv', mo);
    toast.success('Accountant pack downloaded — 12 CSVs for ' + from + ' → ' + to + ' (incl. the cash-basis income statement).');
  }
  var inv = (data && data.invoices) || null;
  var bl = (data && data.bills) || null;
  return <div className="bg-white rounded-xl border border-slate-200 p-3">
    <InvoicePeek invoiceId={peekId} onClose={function () { setPeekId(null); }} onEdit={function (id2) { try { window.__ntOpenInvoiceEdit = id2; window.dispatchEvent(new CustomEvent('nt-open-invoice-edit', { detail: id2 })); } catch (e4) {} setPeekId(null); onGo('invoices'); }} />
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <div className="text-sm font-extrabold text-slate-900">📉 Stats — invoices & bills</div>
      <input type="date" className="px-2 py-1 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white" value={from} onChange={function (e) { setFrom(e.target.value); }} />
      <span className="text-[10px] text-slate-500">→</span>
      <input type="date" className="px-2 py-1 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white" value={to} onChange={function (e) { setTo(e.target.value); }} />
      <button onClick={function () { load(from, to); }} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff' }}>{busy ? '…' : 'Go'}</button>
      {/* v55.83-PK (Max): "the dates has something from june 1st as selection next to month year etc" */}
      {(function () {
        var y = TODAY.substring(0, 4);
        var m0 = TODAY.substring(0, 8) + '01';
        var lastM = new Date(Number(y), Number(TODAY.substring(5, 7)) - 2, 1);
        var lmFrom = lastM.toISOString().substring(0, 10);
        var lmEnd = new Date(Number(y), Number(TODAY.substring(5, 7)) - 1, 0).toISOString().substring(0, 10);
        var P = [['Jun 1 →', '2026-06-01', TODAY], ['This month', m0, TODAY], ['Last month', lmFrom, lmEnd], ['This year', y + '-01-01', TODAY]];
        return P.map(function (p2) {
          var on = from === p2[1] && to === p2[2];
          return <button key={p2[0]} onClick={function () { setFrom(p2[1]); setTo(p2[2]); load(p2[1], p2[2]); }}
            className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={on ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{p2[0]}</button>;
        });
      })()}
      <div className="flex-1" />
      {data && data.months && <button onClick={csv} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>⬇ CSV</button>}
      {data && data.drills && <button onClick={taxPack} title="Every CSV your accountant needs from the hub for this period, named and dated"
        className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#7c3aed', color: '#ffffff' }}>🧾 Accountant pack</button>}
    </div>

    {!data ? <div className="text-[11px] text-slate-500">Loading…</div> :
     data.denied ? <div className="text-[11px]" style={{ color: '#92400e' }}>{data.error || 'Not permitted.'}</div> :
     <div>
      <div className="text-[10px] font-extrabold uppercase mb-1" style={{ color: '#065f46' }}>Invoices (money we earn) · {data.from} → {data.to}</div>
      <div className="flex gap-2 flex-wrap mb-3">
        <Card onClick={function () { openDrill('invoiced', 'Invoiced in period', 'Customer'); }} label={'Invoiced (' + inv.count + ')'} value={'$' + fmt(inv.invoiced)} bg="#d1fae5" border="#a7f3d0" fg="#065f46" sub="invoices dated in period" />
        <Card onClick={function () { openDrill('collected', 'Collected in period', 'Customer'); }} label={'Collected (' + inv.collected_count + ' payments)'} value={'$' + fmt(inv.collected)} bg="#ecfeff" border="#a5f3fc" fg="#155e75" sub="payments received in period" />
        <Card onClick={function () { openDrill('open_invoices', 'Still open — period invoices', 'Customer'); }} label="Still open from these" value={'$' + fmt(inv.still_open_from_period)} bg="#ffedd5" border="#fed7aa" fg="#431407" sub="unpaid balance of period invoices" />
      </div>
      <div className="text-[10px] font-extrabold uppercase mb-1" style={{ color: '#7f1d1d' }}>Bills (money we owe)</div>
      <div className="flex gap-2 flex-wrap mb-3">
        <Card onClick={function () { openDrill('billed', 'Bills entered in period', 'Vendor'); }} label={'Bills entered (' + bl.count + ')'} value={'$' + fmt(bl.billed)} bg="#fee2e2" border="#fecaca" fg="#7f1d1d" sub="bills dated in period" />
        <Card onClick={function () { openDrill('bills_paid', 'Bill payments in period', 'Vendor'); }} label={'Bills paid (' + bl.paid_count + ')'} value={'$' + fmt(bl.paid)} bg="#e0e7ff" border="#c7d2fe" fg="#312e81" sub="bill payments in period" />
        <Card onClick={function () { openDrill('open_bills', 'Still open — period bills', 'Vendor'); }} label="Still open from these" value={'$' + fmt(bl.still_open_from_period)} bg="#ffedd5" border="#fed7aa" fg="#431407" sub={bl.disputed_open > 0.005 ? ('+ $' + fmt(bl.disputed_open) + ' disputed (excluded)') : 'disputed excluded'} />
      </div>

      {drill && <div className="rounded-xl p-3 mb-3" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
        <div className="flex gap-2 items-center mb-1">
          <div className="text-xs font-extrabold" style={{ color: '#0f172a' }}>{drill.title} — the rows behind the card</div>
          <div className="flex-1" />
          <button onClick={function () { setDrill(null); }} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕ close</button>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1 pr-2 text-left font-semibold">Reference</th>
            <th className="py-1 pr-2 text-left font-semibold">{drill.unitWho}</th>
            <th className="py-1 pr-2 text-left font-semibold">Date</th>
            <th className="py-1 pr-2 text-left font-semibold">Due</th>
            <th className="py-1 pr-2 text-right font-semibold">Original</th>
            <th className="py-1 pr-2 text-right font-semibold">Paid</th>
            <th className="py-1 pr-2 text-right font-semibold">Open</th>
            <th className="py-1 pr-2 text-right font-semibold">Amount</th>
            <th className="py-1 text-left font-semibold">Where it comes from</th></tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {drillRows().slice().sort(function (a, b2) { return b2.amount - a.amount; }).map(function (r, i) {
              return <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td className="py-1 pr-2 font-semibold">{r.invoice_id
                  ? <button onClick={function () { setPeekId(r.invoice_id); }} className="font-bold underline" style={{ color: '#1d4ed8' }} title="Open the invoice">{r.ref}{r.rel ? ' · ' + r.rel : ''}</button>
                  : <span>{r.ref}</span>}</td><td className="py-1 pr-2">{r.who}</td>
                <td className="py-1 pr-2 whitespace-nowrap">{r.date || '—'}</td>
                <td className="py-1 pr-2 whitespace-nowrap" style={{ color: '#7f1d1d' }}>{r.due || '—'}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{nd(r.total)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{nd(r.paid)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{nd(r.open)}</td>
                <td className="py-1 pr-2 text-right font-extrabold tabular-nums">${fmt(r.amount)}</td>
                <td className="py-1 text-[10px]" style={{ color: '#64748b' }}>{r.source}</td></tr>;
            })}
            {drillRows().length === 0 && <tr><td colSpan={9} className="py-2 text-center text-slate-500 text-[11px]">No rows in this period.</td></tr>}
          </tbody>
          <tfoot><tr style={{ borderTop: '2px solid #cbd5e1', color: '#0f172a' }}>
            <td className="py-1.5 pr-2 font-extrabold" colSpan={7}>Σ total — equals the card to the cent</td>
            <td className="py-1.5 pr-2 text-right font-extrabold tabular-nums">${fmt(drillSum())}</td><td /></tr></tfoot>
        </table></div>
      </div>}

      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 640 }}>
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1.5 pr-2 text-left font-semibold">Month</th>
            <th className="py-1.5 px-2 text-right font-semibold">Invoiced</th>
            <th className="py-1.5 px-2 text-right font-semibold">Collected</th>
            <th className="py-1.5 px-2 text-right font-semibold">Bills entered</th>
            <th className="py-1.5 px-2 text-right font-semibold">Bills paid</th>
            <th className="py-1.5 px-2 text-right font-semibold">Net cash (collected − bills paid)</th>
          </tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {(data.months || []).map(function (m) {
              return <tr key={m.month} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td className="py-1.5 pr-2 font-bold">{m.month}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">${fmt(m.invoiced)} <span className="text-[9px] text-slate-400">({m.invoiced_count})</span></td>
                <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: '#065f46' }}>${fmt(m.collected)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">${fmt(m.billed)} <span className="text-[9px] text-slate-400">({m.billed_count})</span></td>
                <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: '#7f1d1d' }}>${fmt(m.bills_paid)}</td>
                <td className="py-1.5 px-2 text-right font-extrabold tabular-nums" style={{ color: m.net >= 0 ? '#065f46' : '#7f1d1d' }}>{(m.net >= 0 ? '+$' : '−$') + fmt(Math.abs(m.net))}</td>
              </tr>;
            })}
            {(data.months || []).length === 0 && <tr><td colSpan={6} className="py-3 text-center text-slate-500 text-[11px]">Nothing in this period.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] mt-2" style={{ color: '#64748b' }}>
        US business, USD. Invoiced = by invoice date; Collected = by payment date (so a payment on an older invoice still counts in its month). Bills by bill date; disputed bills stay out of the open totals.
      </div>

      {data && data.totals_masked && <div className="mt-2 rounded-lg p-2 text-[10px] font-bold" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
        🔒 Totals are hidden for your account ("Accounting: See Money Totals" not granted).{data.rows_visible ? ' You CAN open any card and work with the underlying rows.' : ' Underlying rows are hidden too — ask for "Accounting: Open Cards (rows only)" or "See Money Totals".'}{data.date_filters_locked ? ' · Date range locked to the default — "Accounting: Change Date Filters" unlocks it.' : ''}</div>}
      {data && !data.totals_masked && data.date_filters_locked && <div className="mt-2 rounded-lg p-2 text-[10px] font-bold" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>🔒 Date range was clamped to the default — "Accounting: Change Date Filters" unlocks other periods.</div>}
      {/* v55.83-PQ (Max): "categorizing etc should affect the underlying reports" */}
      {data.spending && <div className="mt-3 rounded-lg p-2" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="text-xs font-extrabold mb-1" style={{ color: '#0f172a' }}>💸 Spending by category — {from} → {to}</div>
        {data.spending.rtm && <div className="flex gap-3 items-center flex-wrap mb-1 rounded p-1.5" style={{ background: '#fdf2f8', border: '1px solid #fbcfe8' }}>
          <span className="text-[10px] font-extrabold" style={{ color: '#9d174d' }}>🏢 RTM Capital (third-party payer):</span>
          <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#0f172a' }}><input type="radio" checked={!rtmOn} onChange={function () { setRtmOn(false); }} /> Tax view — RTM payments stay ONE line (${fmt(data.spending.rtm.payments_total)})</label>
          <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#0f172a' }}><input type="radio" checked={rtmOn} onChange={function () { setRtmOn(true); }} /> Real-cost view — covered bills in their ACTUAL categories (${fmt(data.spending.rtm.allocations_total)} + ${fmt(data.spending.rtm.service_fee)} service fee)</label>
          {rtmOn && <span className="text-[9px]" style={{ color: '#9d174d' }}>Totals identical in both views. The accountant tax pack ALWAYS uses the tax view. Row drills show direct bank rows only.</span>}
        </div>}
        <table className="w-full text-[11px]">
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1 pr-2 text-left font-semibold">Category</th><th className="py-1 pr-2 text-right font-semibold">Txns</th>
            <th className="py-1 pr-2 text-right font-semibold">Total</th><th className="py-1 text-right font-semibold">% of spending</th></tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {((rtmOn && data.spending.rtm) ? rtmAdjust(data.spending.categories, data.spending.rtm) : (data.spending.categories || [])).map(function (c) {
              var pct = data.spending.real_spending > 0 ? Math.round(c.total / data.spending.real_spending * 1000) / 10 : 0;
              return <tr key={c.key} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }} onClick={function () { setSpCat(spCat === c.key ? null : c.key); }}>
                <td className="py-1 pr-2 font-bold">{c.label} {c.kind && <span className="px-1 py-0.5 rounded text-[8px] font-extrabold" style={c.kind === 'not_pnl' ? { background: '#f3e8ff', color: '#6b21a8' } : { background: '#f1f5f9', color: '#475569' }}>{KIND_LABELS[c.kind] || c.kind}</span>} <span className="text-[9px]" style={{ color: '#64748b' }}>(click for rows)</span></td>
                <td className="py-1 pr-2 text-right tabular-nums">{c.count}</td>
                <td className="py-1 pr-2 text-right font-extrabold tabular-nums">${fmt(c.total)}</td>
                <td className="py-1 text-right tabular-nums">{pct}%</td></tr>;
            })}
            {data.spending.uncategorized && data.spending.uncategorized.count > 0 && <tr style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: '#fff7ed' }} onClick={function () { setSpCat(spCat === '' ? null : ''); }}>
              <td className="py-1 pr-2 font-bold" style={{ color: '#9a3412' }}>⚠ Uncategorized — needs a category</td>
              <td className="py-1 pr-2 text-right tabular-nums">{data.spending.uncategorized.count}</td>
              <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#9a3412' }}>${fmt(data.spending.uncategorized.total)}</td><td /></tr>}
            {data.spending.transfers && data.spending.transfers.count > 0 && <tr style={{ cursor: 'pointer', background: '#eff6ff' }} onClick={function () { setSpCat(spCat === 'transfer' ? null : 'transfer'); }}>
              <td className="py-1 pr-2 font-bold" style={{ color: '#1e40af' }}>↔ Transfers between own accounts — NOT spending</td>
              <td className="py-1 pr-2 text-right tabular-nums">{data.spending.transfers.count}</td>
              <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#1e40af' }}>${fmt(data.spending.transfers.total)}</td><td /></tr>}
          </tbody>
          <tfoot>
            {data.spending.not_pnl_out && data.spending.not_pnl_out.count > 0 && <tr style={{ color: '#6b21a8' }}>
              <td className="py-1 pr-2 font-bold">Not P&L — loan principal / owner money (NOT deductible)</td>
              <td className="py-1 pr-2 text-right tabular-nums">{data.spending.not_pnl_out.count}</td>
              <td className="py-1 pr-2 text-right font-extrabold tabular-nums">${fmt(data.spending.not_pnl_out.total)}</td><td /></tr>}
            {data.spending.deductible_spending !== undefined && <tr style={{ color: '#0f172a' }}>
              <td className="py-1 pr-2 font-extrabold">DEDUCTIBLE SPENDING (P&L categories only)</td><td />
              <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#7f1d1d' }}>${fmt(data.spending.deductible_spending)}</td><td /></tr>}
            <tr style={{ borderTop: '2px solid #cbd5e1', color: '#0f172a' }}>
            <td className="py-1.5 pr-2 font-extrabold">Real spending (transfers excluded)</td>
            <td className="py-1.5 pr-2 text-right font-extrabold tabular-nums">{(data.spending.total_out ? '' : '')}</td>
            <td className="py-1.5 pr-2 text-right font-extrabold tabular-nums">${fmt(data.spending.real_spending)}</td><td /></tr></tfoot>
        </table>
        {spCat !== null && <div className="mt-1 rounded p-1.5" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
          <table className="w-full text-[10px]"><tbody style={{ color: '#0f172a' }}>
            {(data.spending.rows || []).filter(function (r) { return spCat === 'transfer' ? r.category === 'transfer' : r.category === spCat; }).map(function (r, i) {
              return <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td className="py-0.5 pr-2 whitespace-nowrap">{r.date}</td>
                <td className="py-0.5 pr-2 font-semibold">{String(r.who).substring(0, 60)}</td>
                <td className="py-0.5 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#7f1d1d' }}>-${fmt(r.amount)}</td>
                <td className="py-0.5 text-[9px]" style={{ color: '#64748b' }}>{r.paired ? '↔ paired transfer' : ''}</td></tr>;
            })}
          </tbody></table>
        </div>}

        {/* v55.83-PV (Max): "tax reports need data for all of 2026" — the income
            side, from the bank feed (the only DATED full-year money record). */}
        {data.spending.in_categories && <div className="mt-3">
          <div className="text-xs font-extrabold mb-1" style={{ color: '#0f172a' }}>💰 Money in by category — {from} → {to} (bank deposits)</div>
          <table className="w-full text-[11px]">
            <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
              <th className="py-1 pr-2 text-left font-semibold">Category</th><th className="py-1 pr-2 text-right font-semibold">Deposits</th>
              <th className="py-1 pr-2 text-right font-semibold">Total</th><th className="py-1 text-right font-semibold">% of income</th></tr></thead>
            <tbody style={{ color: '#0f172a' }}>
              {(data.spending.in_categories || []).map(function (c) {
                var pct = data.spending.real_income > 0 ? Math.round(c.total / data.spending.real_income * 1000) / 10 : 0;
                return <tr key={c.key} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }} onClick={function () { setInCat(inCat === c.key ? null : c.key); }}>
                  <td className="py-1 pr-2 font-bold">{c.label} {c.kind && <span className="px-1 py-0.5 rounded text-[8px] font-extrabold" style={c.kind === 'not_pnl' ? { background: '#f3e8ff', color: '#6b21a8' } : { background: '#f1f5f9', color: '#475569' }}>{KIND_LABELS[c.kind] || c.kind}</span>} <span className="text-[9px]" style={{ color: '#64748b' }}>(click for rows)</span></td>
                  <td className="py-1 pr-2 text-right tabular-nums">{c.count}</td>
                  <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#065f46' }}>${fmt(c.total)}</td>
                  <td className="py-1 text-right tabular-nums">{pct}%</td></tr>;
              })}
              {data.spending.in_uncategorized && data.spending.in_uncategorized.count > 0 && <tr style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: '#fff7ed' }} onClick={function () { setInCat(inCat === '' ? null : ''); }}>
                <td className="py-1 pr-2 font-bold" style={{ color: '#9a3412' }}>⚠ Uncategorized deposits — match or categorize before filing</td>
                <td className="py-1 pr-2 text-right tabular-nums">{data.spending.in_uncategorized.count}</td>
                <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#9a3412' }}>${fmt(data.spending.in_uncategorized.total)}</td><td /></tr>}
              {data.spending.in_transfers && data.spending.in_transfers.count > 0 && <tr style={{ cursor: 'pointer', background: '#eff6ff' }} onClick={function () { setInCat(inCat === 'transfer' ? null : 'transfer'); }}>
                <td className="py-1 pr-2 font-bold" style={{ color: '#1e40af' }}>↔ Transfers between own accounts — NOT income</td>
                <td className="py-1 pr-2 text-right tabular-nums">{data.spending.in_transfers.count}</td>
                <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#1e40af' }}>${fmt(data.spending.in_transfers.total)}</td><td /></tr>}
            </tbody>
            <tfoot>
              {data.spending.not_pnl_in && data.spending.not_pnl_in.count > 0 && <tr style={{ color: '#6b21a8' }}>
                <td className="py-1 pr-2 font-bold">Not P&L — loan proceeds / owner money (NOT income)</td>
                <td className="py-1 pr-2 text-right tabular-nums">{data.spending.not_pnl_in.count}</td>
                <td className="py-1 pr-2 text-right font-extrabold tabular-nums">${fmt(data.spending.not_pnl_in.total)}</td><td /></tr>}
              {data.spending.taxable_income !== undefined && <tr style={{ color: '#0f172a' }}>
                <td className="py-1 pr-2 font-extrabold">TAXABLE INCOME (P&L categories only)</td><td />
                <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#065f46' }}>${fmt(data.spending.taxable_income)}</td><td /></tr>}
              <tr style={{ borderTop: '2px solid #cbd5e1', color: '#0f172a' }}>
              <td className="py-1.5 pr-2 font-extrabold">Real money in (transfers excluded)</td><td />
              <td className="py-1.5 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#065f46' }}>${fmt(data.spending.real_income)}</td><td /></tr></tfoot>
          </table>
          {/* v55.83-PY (Max, Nov 7 11:10: "i need the reports to take over from
            now for 2026. so make it happen.. find a way") — the CASH-BASIS
            INCOME STATEMENT, assembled from the bank record: the one dated,
            complete money source for all of 2026. Revenue = money actually
            received (P&L income kinds), expenses = money actually spent (P&L
            expense kinds). Transfers and Not-P&L money excluded on both
            sides. Uncategorized shown as its own line so the gap to a
            filing-ready statement is VISIBLE, never hidden. */}
        {data.spending.in_categories && (function () {
          var rev = 0; var cogs2 = 0; var exp2 = 0; var oin = 0; var oex = 0;
          (data.spending.in_categories || []).forEach(function (c) {
            if (c.kind === 'income') { rev += c.total; } else if (c.kind === 'other_income') { oin += c.total; }
          });
          // v55.83-QB — the RTM radio applies to the income statement too:
          // same totals, real-category breakdown.
          ((rtmOn && data.spending.rtm) ? rtmAdjust(data.spending.categories, data.spending.rtm) : (data.spending.categories || [])).forEach(function (c) {
            if (c.kind === 'cogs') { cogs2 += c.total; } else if (c.kind === 'other_expense') { oex += c.total; } else if (c.kind !== 'not_pnl') { exp2 += c.total; }
          });
          var r2x = function (x) { return Math.round(x * 100) / 100; };
          rev = r2x(rev); cogs2 = r2x(cogs2); exp2 = r2x(exp2); oin = r2x(oin); oex = r2x(oex);
          var gross = r2x(rev - cogs2);
          var op = r2x(gross - exp2);
          var net = r2x(op + oin - oex);
          var uncIn2 = (data.spending.in_uncategorized && data.spending.in_uncategorized.total) || 0;
          var uncOut2 = (data.spending.uncategorized && data.spending.uncategorized.total) || 0;
          function line(lbl, val, strong, color) {
            return <div className="flex text-[11px] py-0.5" style={{ borderBottom: strong ? '2px solid #cbd5e1' : '1px solid #f1f5f9', color: color || '#0f172a', fontWeight: strong ? 800 : 500 }}>
              <span className="flex-1">{lbl}</span><span className="tabular-nums">{(val < 0 ? '−$' : '$') + fmt(Math.abs(val))}</span></div>;
          }
          return <div className="mt-3 rounded-lg p-3" style={{ background: '#ffffff', border: '2px solid #312e81', maxWidth: 560 }}>
            <div className="text-xs font-extrabold mb-1" style={{ color: '#312e81' }}>📊 INCOME STATEMENT (cash basis, from the bank record) — {from} → {to}{rtmOn && data.spending.rtm ? ' — RTM BREAKDOWN ON' : ''}</div>
            {line('Revenue (money received, income categories)', rev)}
            {line('− Cost of goods sold', -cogs2)}
            {line('GROSS PROFIT', gross, true)}
            {line('− Operating expenses', -exp2)}
            {line('OPERATING PROFIT', op, true)}
            {oin > 0 && line('+ Other income', oin)}
            {oex > 0 && line('− Other expenses', -oex)}
            {line('NET PROFIT (cash basis)', net, true, net >= 0 ? '#065f46' : '#7f1d1d')}
            {(uncIn2 > 0.005 || uncOut2 > 0.005) && <div className="mt-1.5 rounded p-1.5 text-[10px] font-bold" style={{ background: '#fff7ed', color: '#9a3412' }}>
              ⚠ Not filing-ready yet: ${fmt(uncIn2)} of deposits and ${fmt(uncOut2)} of spending are still UNCATEGORIZED and sit outside this statement. Categorize them (rules + bulk updates do most of it) and this statement is complete.</div>}
            {(uncIn2 <= 0.005 && uncOut2 <= 0.005) && <div className="mt-1.5 text-[10px] font-bold" style={{ color: '#065f46' }}>✓ Every transaction in the period is categorized — this statement covers the whole period.</div>}
            <div className="text-[9px] mt-1" style={{ color: '#64748b' }}>Cash basis = income when received, expenses when paid — the standard filing basis for most LLCs (your accountant confirms which basis you file on). Transfers and Not-P&L money (loans, owner) are excluded by the category types.</div>
          </div>;
        })()}
        {inCat !== null && <div className="mt-1 rounded p-1.5" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
            <table className="w-full text-[10px]"><tbody style={{ color: '#0f172a' }}>
              {(data.spending.in_rows || []).filter(function (r) { return inCat === 'transfer' ? r.category === 'transfer' : r.category === inCat; }).map(function (r, i) {
                return <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td className="py-0.5 pr-2 whitespace-nowrap">{r.date}</td>
                  <td className="py-0.5 pr-2 font-semibold">{String(r.who).substring(0, 60)}</td>
                  <td className="py-0.5 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#065f46' }}>+${fmt(r.amount)}</td>
                  <td className="py-0.5 text-[9px]" style={{ color: '#64748b' }}>{r.paired ? '↔ paired transfer' : ''}</td></tr>;
              })}
            </tbody></table>
          </div>}
        </div>}
      </div>}
     </div>}
  </div>;
}
