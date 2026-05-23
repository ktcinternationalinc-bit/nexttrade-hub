'use client';
// v55.83-A.6.27.65 — Sales-rep KPI dashboard.
//
// Aggregates invoices by sales_rep field and shows per-rep performance:
//   • Total invoiced (sum of total_amount)
//   • Total collected (sum of total_collected)
//   • Outstanding (sum of outstanding)
//   • Collection rate % (collected / invoiced)
//   • Invoice count
//   • Avg invoice size (invoiced / count)
//   • Best customer per rep (top by revenue)
//
// Date range and customer filter passed in via props so dashboard
// reflects the same window the user is already looking at in the
// Sales tab. Standalone — doesn't fetch its own data.

import { useMemo, useState } from 'react';

function fmtMoney(n) {
  if (n == null || isNaN(Number(n))) return '0.00';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
  if (n == null || isNaN(Number(n))) return '—';
  return Number(n).toFixed(1) + '%';
}
function fmtInt(n) {
  if (n == null || isNaN(Number(n))) return '0';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function SalesRepDashboard(props) {
  // invoices: already-filtered array (the Sales tab's filteredInvoices)
  var invoices = props.invoices || [];
  var label = props.label || 'in selected range';

  // Aggregate per sales_rep
  var perRep = useMemo(function () {
    var bucket = {}; // rep_name → totals
    invoices.forEach(function (inv) {
      var rep = (inv.sales_rep || '').trim() || '(Unassigned)';
      if (!bucket[rep]) {
        bucket[rep] = {
          rep: rep,
          count: 0,
          invoiced: 0,
          collected: 0,
          outstanding: 0,
          customers: {}, // customer_name → revenue
        };
      }
      var b = bucket[rep];
      b.count++;
      b.invoiced += Number(inv.total_amount || inv.amount || 0);
      b.collected += Number(inv.total_collected || 0);
      b.outstanding += Number(inv.outstanding || 0);
      var cust = (inv.customer_name_en || inv.customer_name || '(no customer)').trim();
      b.customers[cust] = (b.customers[cust] || 0) + Number(inv.total_amount || inv.amount || 0);
    });
    var rows = Object.keys(bucket).map(function (rep) {
      var b = bucket[rep];
      b.avg = b.count > 0 ? b.invoiced / b.count : 0;
      b.collection_rate = b.invoiced > 0 ? (b.collected / b.invoiced) * 100 : 0;
      // Best customer = highest revenue
      var best = null; var bestRev = 0;
      Object.keys(b.customers).forEach(function (cust) {
        if (b.customers[cust] > bestRev) { best = cust; bestRev = b.customers[cust]; }
      });
      b.best_customer = best;
      b.best_customer_revenue = bestRev;
      return b;
    });
    rows.sort(function (a, b) { return b.invoiced - a.invoiced; });
    return rows;
  }, [invoices]);

  var grand = useMemo(function () {
    var t = { count: 0, invoiced: 0, collected: 0, outstanding: 0 };
    perRep.forEach(function (r) {
      t.count += r.count;
      t.invoiced += r.invoiced;
      t.collected += r.collected;
      t.outstanding += r.outstanding;
    });
    t.collection_rate = t.invoiced > 0 ? (t.collected / t.invoiced) * 100 : 0;
    return t;
  }, [perRep]);

  if (perRep.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center text-slate-600 italic text-sm">
        No invoices {label} to compute KPIs from.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-700 text-white rounded-lg p-3">
        <h3 className="text-base font-extrabold">📊 Sales-Rep Leaderboard / لوحة قيادة المبيعات</h3>
        <div className="text-[11px] font-semibold text-blue-100 mt-0.5">
          KPIs computed from filtered invoices ({invoices.length} total) · {label}
        </div>
      </div>

      {/* Grand totals row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="bg-slate-100 border border-slate-300 rounded p-2">
          <div className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider">Reps Active</div>
          <div className="text-base font-mono font-extrabold text-slate-900">{fmtInt(perRep.length)}</div>
        </div>
        <div className="bg-blue-100 border border-blue-300 rounded p-2">
          <div className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wider">Invoices</div>
          <div className="text-base font-mono font-extrabold text-blue-900">{fmtInt(grand.count)}</div>
        </div>
        <div className="bg-emerald-100 border border-emerald-300 rounded p-2">
          <div className="text-[10px] font-extrabold text-emerald-900 uppercase tracking-wider">Invoiced</div>
          <div className="text-base font-mono font-extrabold text-emerald-900">{fmtMoney(grand.invoiced)}</div>
        </div>
        <div className="bg-teal-100 border border-teal-300 rounded p-2">
          <div className="text-[10px] font-extrabold text-teal-900 uppercase tracking-wider">Collected</div>
          <div className="text-base font-mono font-extrabold text-teal-900">{fmtMoney(grand.collected)}</div>
        </div>
        <div className={'border rounded p-2 ' + (grand.outstanding > 0 ? 'bg-amber-100 border-amber-300' : 'bg-slate-100 border-slate-300')}>
          <div className={'text-[10px] font-extrabold uppercase tracking-wider ' + (grand.outstanding > 0 ? 'text-amber-900' : 'text-slate-700')}>Outstanding</div>
          <div className={'text-base font-mono font-extrabold ' + (grand.outstanding > 0 ? 'text-amber-900' : 'text-slate-700')}>{fmtMoney(grand.outstanding)}</div>
        </div>
      </div>

      {/* Per-rep table */}
      <div className="overflow-auto border-2 border-slate-200 rounded">
        <table className="w-full text-xs">
          <thead className="bg-slate-800 text-white">
            <tr>
              <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider">#</th>
              <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider">Sales Rep</th>
              <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Invoices</th>
              <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Invoiced</th>
              <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Collected</th>
              <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Outstanding</th>
              <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Collection %</th>
              <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Avg Invoice</th>
              <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider">Best Customer</th>
            </tr>
          </thead>
          <tbody>
            {perRep.map(function (r, i) {
              var rankBg = i === 0 ? 'bg-amber-50' : i === 1 ? 'bg-slate-50' : i === 2 ? 'bg-orange-50' : '';
              var rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
              return (
                <tr key={r.rep} className={'border-b border-slate-200 hover:bg-slate-50 ' + rankBg}>
                  <td className="px-3 py-1.5 text-slate-700 font-mono font-bold">{rankEmoji || (i + 1)}</td>
                  <td className="px-3 py-1.5 text-slate-900 font-extrabold">{r.rep}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-blue-900">{fmtInt(r.count)}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-800">{fmtMoney(r.invoiced)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-teal-800">{fmtMoney(r.collected)}</td>
                  <td className={'px-3 py-1.5 text-right font-mono font-bold ' + (r.outstanding > 0 ? 'text-amber-800' : 'text-slate-500')}>{fmtMoney(r.outstanding)}</td>
                  <td className={'px-3 py-1.5 text-right font-mono font-extrabold ' + (r.collection_rate >= 90 ? 'text-emerald-800' : r.collection_rate >= 70 ? 'text-amber-700' : 'text-red-700')}>{fmtPct(r.collection_rate)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-700">{fmtMoney(r.avg)}</td>
                  <td className="px-3 py-1.5 text-slate-700 text-[11px]">
                    {r.best_customer ? (
                      <>
                        <div className="font-semibold truncate max-w-[180px]" title={r.best_customer}>{r.best_customer}</div>
                        <div className="font-mono text-slate-500">{fmtMoney(r.best_customer_revenue)}</div>
                      </>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-200 font-extrabold">
              <td colSpan={2} className="px-3 py-2 text-slate-900">TOTAL ({perRep.length} reps)</td>
              <td className="px-3 py-2 text-right font-mono text-blue-900">{fmtInt(grand.count)}</td>
              <td className="px-3 py-2 text-right font-mono text-emerald-900">{fmtMoney(grand.invoiced)}</td>
              <td className="px-3 py-2 text-right font-mono text-teal-900">{fmtMoney(grand.collected)}</td>
              <td className={'px-3 py-2 text-right font-mono ' + (grand.outstanding > 0 ? 'text-amber-900' : 'text-slate-700')}>{fmtMoney(grand.outstanding)}</td>
              <td className={'px-3 py-2 text-right font-mono ' + (grand.collection_rate >= 90 ? 'text-emerald-900' : grand.collection_rate >= 70 ? 'text-amber-800' : 'text-red-800')}>{fmtPct(grand.collection_rate)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
