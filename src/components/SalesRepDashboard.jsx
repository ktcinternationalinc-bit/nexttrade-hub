'use client';
// v55.83-A.6.27.65 — Sales-rep KPI dashboard.
// v55.83-A.6.27.66 (C1 + H5, Max May 23 2026) — multi-currency aware.
//
// PREVIOUSLY: invoices were summed regardless of currency. A rep with one
// USD 100k invoice and one EGP 100k invoice appeared as "Invoiced 200,000"
// — meaningless.
//
// NOW: per-rep totals are broken out by currency. Each currency gets its
// own row in the leaderboard (the rep appears once with USD totals, once
// with EGP totals, etc.). Currencies are normalized to USD/EGP/EUR/etc.
// Best customer is also computed per-currency (same customer can be top
// in USD and bottom in EGP — accurate).
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
function normalizeCurrency(c) {
  if (!c) return 'USD';
  return String(c).toUpperCase().trim() || 'USD';
}

export default function SalesRepDashboard(props) {
  // invoices: already-filtered array (the Sales tab's filteredInvoices)
  var invoices = props.invoices || [];
  var label = props.label || 'in selected range';

  // v55.83-A.6.27.66 (H5) — toggle to include or hide unassigned invoices.
  // Defaults to HIDE so the leaderboard isn't dominated by a giant
  // "(Unassigned)" row from legacy invoices with no sales_rep field set.
  var [showUnassigned, setShowUnassigned] = useState(false);

  // Aggregate per (sales_rep × currency). The same rep can appear in
  // multiple currency rows — that's intentional, currencies don't mix.
  var perRepCurrency = useMemo(function () {
    var bucket = {}; // 'rep||currency' → totals
    invoices.forEach(function (inv) {
      var rep = (inv.sales_rep || '').trim() || '(Unassigned)';
      var cur = normalizeCurrency(inv.currency);
      var key = rep + '||' + cur;
      if (!bucket[key]) {
        bucket[key] = {
          rep: rep, currency: cur, count: 0, invoiced: 0, collected: 0,
          outstanding: 0, customers: {},
        };
      }
      var b = bucket[key];
      b.count++;
      // v55.83-A.6.27.66 (M6) — use ?? null check instead of || to allow
      // zero as a legitimate value, then read total_amount/amount fallback
      // correctly. Outstanding may be stale; compute as fallback (H3).
      var invd = Number(inv.total_amount != null ? inv.total_amount : (inv.amount || 0));
      var coll = Number(inv.total_collected != null ? inv.total_collected : 0);
      var outs = inv.outstanding != null ? Number(inv.outstanding) : Math.max(0, invd - coll);
      b.invoiced += invd;
      b.collected += coll;
      b.outstanding += outs;
      var cust = (inv.customer_name_en || inv.customer_name || '(no customer)').trim();
      b.customers[cust] = (b.customers[cust] || 0) + invd;
    });
    var rows = Object.keys(bucket).map(function (k) {
      var b = bucket[k];
      b.avg = b.count > 0 ? b.invoiced / b.count : 0;
      b.collection_rate = b.invoiced > 0 ? (b.collected / b.invoiced) * 100 : 0;
      var best = null; var bestRev = 0;
      Object.keys(b.customers).forEach(function (cust) {
        if (b.customers[cust] > bestRev) { best = cust; bestRev = b.customers[cust]; }
      });
      b.best_customer = best;
      b.best_customer_revenue = bestRev;
      return b;
    });
    // Sort: by invoiced desc, but within same currency
    rows.sort(function (a, b) {
      if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
      return b.invoiced - a.invoiced;
    });
    return rows;
  }, [invoices]);

  var visibleRows = useMemo(function () {
    if (showUnassigned) return perRepCurrency;
    return perRepCurrency.filter(function (r) { return r.rep !== '(Unassigned)'; });
  }, [perRepCurrency, showUnassigned]);

  // Grand totals — broken out by currency
  var grandByCurrency = useMemo(function () {
    var totals = {};
    visibleRows.forEach(function (r) {
      if (!totals[r.currency]) {
        totals[r.currency] = { count: 0, invoiced: 0, collected: 0, outstanding: 0, currency: r.currency };
      }
      var t = totals[r.currency];
      t.count += r.count;
      t.invoiced += r.invoiced;
      t.collected += r.collected;
      t.outstanding += r.outstanding;
    });
    Object.keys(totals).forEach(function (k) {
      totals[k].collection_rate = totals[k].invoiced > 0
        ? (totals[k].collected / totals[k].invoiced) * 100 : 0;
    });
    var arr = Object.values(totals);
    arr.sort(function (a, b) { return a.currency.localeCompare(b.currency); });
    return arr;
  }, [visibleRows]);

  // Count of distinct reps (across all currencies)
  var distinctReps = useMemo(function () {
    var seen = {};
    visibleRows.forEach(function (r) { seen[r.rep] = true; });
    return Object.keys(seen).length;
  }, [visibleRows]);

  // For ranking medals — rank within each currency by invoiced desc
  var rankWithinCurrency = useMemo(function () {
    var ranks = {};
    var byCur = {};
    visibleRows.forEach(function (r) {
      if (!byCur[r.currency]) byCur[r.currency] = [];
      byCur[r.currency].push(r);
    });
    Object.keys(byCur).forEach(function (cur) {
      byCur[cur].forEach(function (r, idx) {
        ranks[r.rep + '||' + r.currency] = idx;
      });
    });
    return ranks;
  }, [visibleRows]);

  if (visibleRows.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center text-slate-600 italic text-sm">
        No invoices {label} to compute KPIs from{!showUnassigned && perRepCurrency.length > 0 ? ' (only unassigned invoices match — toggle "Include unassigned" to see them)' : ''}.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-700 text-white rounded-lg p-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-extrabold">📊 Sales-Rep Leaderboard / لوحة قيادة المبيعات</h3>
          <div className="text-[11px] font-semibold text-blue-100 mt-0.5">
            KPIs computed per currency from filtered invoices ({invoices.length} total) · {label}
          </div>
        </div>
        <label className="flex items-center gap-2 text-[11px] font-bold text-white cursor-pointer bg-white/10 px-3 py-1.5 rounded">
          <input type="checkbox" checked={showUnassigned} onChange={function (e) { setShowUnassigned(e.target.checked); }} />
          Include "(Unassigned)" rep
        </label>
      </div>

      {/* Grand totals — one row per currency */}
      {grandByCurrency.map(function (g) {
        return (
          <div key={g.currency} className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="bg-slate-800 text-white border border-slate-900 rounded p-2 flex flex-col justify-center">
              <div className="text-[9px] font-extrabold uppercase tracking-wider opacity-80">Currency</div>
              <div className="text-lg font-mono font-extrabold">{g.currency}</div>
            </div>
            <div className="bg-slate-100 border border-slate-300 rounded p-2">
              <div className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider">Reps</div>
              <div className="text-base font-mono font-extrabold text-slate-900">{fmtInt(distinctReps)}</div>
            </div>
            <div className="bg-blue-100 border border-blue-300 rounded p-2">
              <div className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wider">Invoices</div>
              <div className="text-base font-mono font-extrabold text-blue-900">{fmtInt(g.count)}</div>
            </div>
            <div className="bg-emerald-100 border border-emerald-300 rounded p-2">
              <div className="text-[10px] font-extrabold text-emerald-900 uppercase tracking-wider">Invoiced {g.currency}</div>
              <div className="text-base font-mono font-extrabold text-emerald-900">{fmtMoney(g.invoiced)}</div>
            </div>
            <div className="bg-teal-100 border border-teal-300 rounded p-2">
              <div className="text-[10px] font-extrabold text-teal-900 uppercase tracking-wider">Collected {g.currency}</div>
              <div className="text-base font-mono font-extrabold text-teal-900">{fmtMoney(g.collected)}</div>
            </div>
            <div className={'border rounded p-2 ' + (g.outstanding > 0 ? 'bg-amber-100 border-amber-300' : 'bg-slate-100 border-slate-300')}>
              <div className={'text-[10px] font-extrabold uppercase tracking-wider ' + (g.outstanding > 0 ? 'text-amber-900' : 'text-slate-700')}>Outstanding {g.currency}</div>
              <div className={'text-base font-mono font-extrabold ' + (g.outstanding > 0 ? 'text-amber-900' : 'text-slate-700')}>{fmtMoney(g.outstanding)}</div>
            </div>
          </div>
        );
      })}

      {/* Per-rep×currency table */}
      <div className="overflow-auto border-2 border-slate-200 rounded">
        <table className="w-full text-xs">
          <thead className="bg-slate-800 text-white">
            <tr>
              <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider">#</th>
              <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider">Sales Rep</th>
              <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider">Cur</th>
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
            {visibleRows.map(function (r) {
              var rankIdx = rankWithinCurrency[r.rep + '||' + r.currency] || 0;
              var rankBg = rankIdx === 0 ? 'bg-amber-50' : rankIdx === 1 ? 'bg-slate-50' : rankIdx === 2 ? 'bg-orange-50' : '';
              var rankEmoji = rankIdx === 0 ? '🥇' : rankIdx === 1 ? '🥈' : rankIdx === 2 ? '🥉' : '';
              var isUnassigned = r.rep === '(Unassigned)';
              return (
                <tr key={r.rep + '_' + r.currency} className={'border-b border-slate-200 hover:bg-slate-50 ' + rankBg + (isUnassigned ? ' opacity-70' : '')}>
                  <td className="px-3 py-1.5 text-slate-700 font-mono font-bold">{rankEmoji || (rankIdx + 1)}</td>
                  <td className="px-3 py-1.5 text-slate-900 font-extrabold">{r.rep}</td>
                  <td className="px-3 py-1.5 text-slate-700 font-mono font-extrabold">{r.currency}</td>
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
                        <div className="font-mono text-slate-500">{fmtMoney(r.best_customer_revenue)} {r.currency}</div>
                      </>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-slate-500 italic">
        💡 Each currency is summed separately. A rep with both USD and EGP invoices appears once per currency.
      </div>
    </div>
  );
}
