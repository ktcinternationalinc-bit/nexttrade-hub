'use client';
import { useState, useMemo } from 'react';
import { EXPENSE_CATS, COLORS } from '../lib/utils';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function ReportsTab({ treasury, invoices, warehouseExpenses }) {
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().substring(0, 10); });
  const [dateTo, setDateTo] = useState(new Date().toISOString().substring(0, 10));
  const [view, setView] = useState('overview'); // overview | income | expenses | categories | comparison
  const [selCategory, setSelCategory] = useState(null);
  const [chartType, setChartType] = useState('bar'); // bar | line

  // Filter by date range
  const filteredTreasury = useMemo(() => treasury.filter(t => t.transaction_date >= dateFrom && t.transaction_date <= dateTo), [treasury, dateFrom, dateTo]);
  const filteredInvoices = useMemo(() => invoices.filter(i => i.date >= dateFrom && i.date <= dateTo), [invoices, dateFrom, dateTo]);
  const filteredWarehouse = useMemo(() => (warehouseExpenses || []).filter(w => w.date >= dateFrom && w.date <= dateTo), [warehouseExpenses, dateFrom, dateTo]);

  // Monthly data
  const monthlyData = useMemo(() => {
    const months = {};
    filteredTreasury.forEach(t => {
      const m = t.transaction_date ? t.transaction_date.substring(0, 7) : null;
      if (!m) return;
      if (!months[m]) months[m] = { month: m, income: 0, expenses: 0, net: 0, txnCount: 0 };
      months[m].income += Number(t.cash_in || 0);
      months[m].expenses += Number(t.cash_out || 0);
      months[m].net += Number(t.cash_in || 0) - Number(t.cash_out || 0);
      months[m].txnCount++;
    });
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredTreasury]);

  // Category breakdown (expenses)
  const expenseByCategory = useMemo(() => {
    const cats = {};
    filteredTreasury.filter(t => Number(t.cash_out || 0) > 0).forEach(t => {
      const cat = EXPENSE_CATS[t.category] || t.category || 'Uncategorized';
      if (!cats[cat]) cats[cat] = { category: cat, total: 0, count: 0, subcats: {} };
      cats[cat].total += Number(t.cash_out || 0);
      cats[cat].count++;
      const sub = t.subcategory || 'General';
      if (!cats[cat].subcats[sub]) cats[cat].subcats[sub] = 0;
      cats[cat].subcats[sub] += Number(t.cash_out || 0);
    });
    return Object.values(cats).sort((a, b) => b.total - a.total);
  }, [filteredTreasury]);

  // Category breakdown (income)
  const incomeByCategory = useMemo(() => {
    const cats = {};
    filteredTreasury.filter(t => Number(t.cash_in || 0) > 0).forEach(t => {
      const cat = EXPENSE_CATS[t.category] || t.category || 'Customer Payment';
      if (!cats[cat]) cats[cat] = { category: cat, total: 0, count: 0 };
      cats[cat].total += Number(t.cash_in || 0);
      cats[cat].count++;
    });
    return Object.values(cats).sort((a, b) => b.total - a.total);
  }, [filteredTreasury]);

  // Subcategory detail for selected category
  const subcatDetail = useMemo(() => {
    if (!selCategory) return [];
    const cat = expenseByCategory.find(c => c.category === selCategory);
    if (!cat) return [];
    return Object.entries(cat.subcats).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  }, [selCategory, expenseByCategory]);

  // Year-over-year comparison
  const yearlyData = useMemo(() => {
    const years = {};
    filteredTreasury.forEach(t => {
      const y = t.transaction_date ? t.transaction_date.substring(0, 4) : null;
      if (!y) return;
      if (!years[y]) years[y] = { year: y, income: 0, expenses: 0 };
      years[y].income += Number(t.cash_in || 0);
      years[y].expenses += Number(t.cash_out || 0);
    });
    return Object.values(years).sort((a, b) => a.year.localeCompare(b.year));
  }, [filteredTreasury]);

  // Totals
  const totalIncome = filteredTreasury.reduce((s, t) => s + Number(t.cash_in || 0), 0);
  const totalExpenses = filteredTreasury.reduce((s, t) => s + Number(t.cash_out || 0), 0);
  const totalInvoiced = filteredInvoices.reduce((s, i) => s + Number(i.amount || i.total || 0), 0);
  const netCash = totalIncome - totalExpenses;

  const fmtE = (n) => 'E£' + Math.abs(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const fmtMonth = (m) => { const [y, mo] = m.split('-'); return MONTHS[parseInt(mo) - 1] + ' ' + y; };

  // Simple SVG bar/line chart
  const Chart = ({ data, bars, width = 700, height = 300 }) => {
    if (!data.length) return <div className="text-center py-8 text-slate-400 text-xs">No data for this period</div>;
    const maxVal = Math.max(...data.flatMap(d => bars.map(b => Math.abs(d[b.key] || 0))), 1);
    const barW = Math.min(40, (width - 80) / data.length / bars.length - 2);
    const chartH = height - 60;

    return (
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: Math.max(width, data.length * 50) }}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => (
            <g key={pct}>
              <line x1="60" y1={30 + chartH * (1 - pct)} x2={width - 10} y2={30 + chartH * (1 - pct)} stroke="#f1f5f9" strokeWidth="1" />
              <text x="55" y={34 + chartH * (1 - pct)} textAnchor="end" fill="#94a3b8" fontSize="9">{fmtE(maxVal * pct)}</text>
            </g>
          ))}
          {/* Bars or lines */}
          {bars.map((bar, bi) => {
            if (chartType === 'line') {
              const points = data.map((d, i) => {
                const x = 70 + (i * (width - 90) / Math.max(data.length - 1, 1));
                const y = 30 + chartH * (1 - Math.abs(d[bar.key] || 0) / maxVal);
                return `${x},${y}`;
              }).join(' ');
              return (
                <g key={bar.key}>
                  <polyline points={points} fill="none" stroke={bar.color} strokeWidth="2.5" strokeLinejoin="round" />
                  {data.map((d, i) => {
                    const x = 70 + (i * (width - 90) / Math.max(data.length - 1, 1));
                    const y = 30 + chartH * (1 - Math.abs(d[bar.key] || 0) / maxVal);
                    return <circle key={i} cx={x} cy={y} r="4" fill={bar.color} />;
                  })}
                </g>
              );
            }
            return data.map((d, i) => {
              const groupW = (width - 90) / data.length;
              const x = 70 + i * groupW + bi * (barW + 2) + (groupW - bars.length * (barW + 2)) / 2;
              const val = Math.abs(d[bar.key] || 0);
              const h = (val / maxVal) * chartH;
              return (
                <g key={`${bar.key}-${i}`}>
                  <rect x={x} y={30 + chartH - h} width={barW} height={h} fill={bar.color} rx="3" opacity="0.85" />
                  {val > 0 && h > 15 && <text x={x + barW / 2} y={30 + chartH - h - 4} textAnchor="middle" fill={bar.color} fontSize="8" fontWeight="700">{fmtE(val)}</text>}
                </g>
              );
            });
          })}
          {/* X axis labels */}
          {data.map((d, i) => {
            const groupW = (width - 90) / data.length;
            const x = 70 + i * groupW + groupW / 2;
            return <text key={i} x={x} y={height - 5} textAnchor="middle" fill="#64748b" fontSize="9" fontWeight="600">{d.label || d.month ? fmtMonth(d.month) : d.year || ''}</text>;
          })}
          {/* Legend */}
          {bars.map((b, i) => (
            <g key={b.key} transform={`translate(${70 + i * 120}, 12)`}>
              <rect width="10" height="10" fill={b.color} rx="2" />
              <text x="14" y="9" fill="#475569" fontSize="10" fontWeight="600">{b.label}</text>
            </g>
          ))}
        </svg>
      </div>
    );
  };

  // Pie chart for categories
  const PieChart = ({ data, size = 200 }) => {
    if (!data.length) return null;
    const total = data.reduce((s, d) => s + d.total, 0);
    let cumAngle = 0;
    const slices = data.slice(0, 10).map((d, i) => {
      const angle = (d.total / total) * 360;
      const startAngle = cumAngle;
      cumAngle += angle;
      const midAngle = (startAngle + angle / 2) * Math.PI / 180;
      const r = size / 2 - 10;
      const x1 = size / 2 + r * Math.cos((startAngle - 90) * Math.PI / 180);
      const y1 = size / 2 + r * Math.sin((startAngle - 90) * Math.PI / 180);
      const x2 = size / 2 + r * Math.cos((startAngle + angle - 90) * Math.PI / 180);
      const y2 = size / 2 + r * Math.sin((startAngle + angle - 90) * Math.PI / 180);
      const large = angle > 180 ? 1 : 0;
      const path = `M ${size / 2} ${size / 2} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
      return { ...d, path, color: COLORS[i % COLORS.length], pct: ((d.total / total) * 100).toFixed(1) };
    });

    return (
      <div className="flex items-center gap-4 flex-wrap justify-center">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} stroke="white" strokeWidth="2" />)}
        </svg>
        <div className="space-y-1">
          {slices.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 px-2 py-0.5 rounded"
              onClick={() => setSelCategory(selCategory === s.category ? null : s.category)}>
              <div className="w-3 h-3 rounded" style={{ background: s.color }} />
              <span className="font-semibold">{s.category}</span>
              <span className="text-slate-400 ml-auto">{fmtE(s.total)} ({s.pct}%)</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Quick date presets
  const setPreset = (p) => {
    const now = new Date();
    const to = now.toISOString().substring(0, 10);
    let from;
    if (p === 'ytd') { from = now.getFullYear() + '-01-01'; }
    else if (p === '1y') { const d = new Date(); d.setFullYear(d.getFullYear() - 1); from = d.toISOString().substring(0, 10); }
    else if (p === '6m') { const d = new Date(); d.setMonth(d.getMonth() - 6); from = d.toISOString().substring(0, 10); }
    else if (p === '3m') { const d = new Date(); d.setMonth(d.getMonth() - 3); from = d.toISOString().substring(0, 10); }
    else if (p === '1m') { const d = new Date(); d.setMonth(d.getMonth() - 1); from = d.toISOString().substring(0, 10); }
    else if (p === 'all') { from = '2014-01-01'; }
    setDateFrom(from); setDateTo(to);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-extrabold">📊 Reports / التقارير</h2>
        <div className="flex gap-1">
          {[['bar', '📊'], ['line', '📈']].map(([v, icon]) => (
            <button key={v} onClick={() => setChartType(v)} className={'px-2 py-1 rounded text-xs font-semibold ' + (chartType === v ? 'bg-blue-500 text-white' : 'bg-slate-100')}>{icon}</button>
          ))}
        </div>
      </div>

      {/* Date range */}
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        {[['1m', '1M'], ['3m', '3M'], ['6m', '6M'], ['ytd', 'YTD'], ['1y', '1Y'], ['all', 'All']].map(([v, l]) => (
          <button key={v} onClick={() => setPreset(v)} className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">{l}</button>
        ))}
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded-lg px-2 py-1 text-xs" />
        <span className="text-xs text-slate-400">→</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border rounded-lg px-2 py-1 text-xs" />
      </div>

      {/* View tabs */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {[['overview', '📊 Overview'], ['income', '💰 Income'], ['expenses', '💸 Expenses'], ['categories', '🏷️ Categories'], ['comparison', '📅 Year Compare']].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (view === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{l}</button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="bg-blue-50 rounded-xl p-3 border border-blue-200">
          <div className="text-[10px] text-blue-600 font-bold">Invoiced / الفواتير</div>
          <div className="text-lg font-black text-blue-700">{fmtE(totalInvoiced)}</div>
          <div className="text-[10px] text-blue-400">{filteredInvoices.length} invoices</div>
        </div>
        <div className="bg-green-50 rounded-xl p-3 border border-green-200">
          <div className="text-[10px] text-green-600 font-bold">Cash In / وارد</div>
          <div className="text-lg font-black text-green-700">{fmtE(totalIncome)}</div>
        </div>
        <div className="bg-red-50 rounded-xl p-3 border border-red-200">
          <div className="text-[10px] text-red-600 font-bold">Cash Out / صادر</div>
          <div className="text-lg font-black text-red-700">{fmtE(totalExpenses)}</div>
        </div>
        <div className={'rounded-xl p-3 border ' + (netCash >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')}>
          <div className={'text-[10px] font-bold ' + (netCash >= 0 ? 'text-emerald-600' : 'text-red-600')}>Net / الصافي</div>
          <div className={'text-lg font-black ' + (netCash >= 0 ? 'text-emerald-700' : 'text-red-700')}>{netCash >= 0 ? '+' : '-'}{fmtE(netCash)}</div>
        </div>
      </div>

      {/* ===== OVERVIEW ===== */}
      {view === 'overview' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <h3 className="font-bold text-sm mb-3">Monthly Income vs Expenses / الدخل مقابل المصروفات</h3>
            <Chart data={monthlyData} bars={[{ key: 'income', label: 'Income', color: '#10b981' }, { key: 'expenses', label: 'Expenses', color: '#ef4444' }]} />
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <h3 className="font-bold text-sm mb-3">Net Cash Flow / صافي التدفق النقدي</h3>
            <Chart data={monthlyData} bars={[{ key: 'net', label: 'Net Cash', color: '#3b82f6' }]} />
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <h3 className="font-bold text-sm mb-3">Expense Breakdown / تقسيم المصروفات</h3>
            <PieChart data={expenseByCategory} />
          </div>
        </div>
      )}

      {/* ===== INCOME ===== */}
      {view === 'income' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <h3 className="font-bold text-sm mb-3">Monthly Income / الدخل الشهري</h3>
            <Chart data={monthlyData} bars={[{ key: 'income', label: 'Income', color: '#10b981' }]} />
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <h3 className="font-bold text-sm mb-3">Income by Category / الدخل حسب الفئة</h3>
            <div className="space-y-1">
              {incomeByCategory.map((c, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50">
                  <div className="w-3 h-3 rounded" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-xs font-semibold flex-1">{c.category}</span>
                  <span className="text-xs text-slate-400">{c.count} txns</span>
                  <span className="text-sm font-bold text-green-600">{fmtE(c.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== EXPENSES ===== */}
      {view === 'expenses' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <h3 className="font-bold text-sm mb-3">Monthly Expenses / المصروفات الشهرية</h3>
            <Chart data={monthlyData} bars={[{ key: 'expenses', label: 'Expenses', color: '#ef4444' }]} />
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <h3 className="font-bold text-sm mb-3">Top Expense Categories / أكبر فئات المصروفات</h3>
            <div className="space-y-1.5">
              {expenseByCategory.map((c, i) => {
                const pct = totalExpenses > 0 ? (c.total / totalExpenses * 100) : 0;
                return (
                  <div key={i} className="cursor-pointer hover:bg-slate-50 rounded-lg p-2" onClick={() => setSelCategory(selCategory === c.category ? null : c.category)}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="text-xs font-bold">{c.category}</span>
                        <span className="text-[10px] text-slate-400">{c.count} txns</span>
                      </div>
                      <span className="text-sm font-bold text-red-600">{fmtE(c.total)} <span className="text-[10px] text-slate-400">({pct.toFixed(1)}%)</span></span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: pct + '%', background: COLORS[i % COLORS.length] }} />
                    </div>
                    {selCategory === c.category && subcatDetail.length > 0 && (
                      <div className="mt-2 ml-5 space-y-1">
                        {subcatDetail.map((s, j) => (
                          <div key={j} className="flex justify-between text-[10px] py-0.5">
                            <span className="text-slate-600">{s.name}</span>
                            <span className="font-semibold text-red-500">{fmtE(s.total)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== CATEGORIES ===== */}
      {view === 'categories' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <h3 className="font-bold text-sm mb-3">Expense Categories / فئات المصروفات</h3>
            <PieChart data={expenseByCategory} size={220} />
          </div>
          {selCategory && subcatDetail.length > 0 && (
            <div className="bg-white rounded-xl p-4 shadow-sm border">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-sm">📂 {selCategory} — Subcategories</h3>
                <button onClick={() => setSelCategory(null)} className="text-xs text-slate-400">✕ Close</button>
              </div>
              <div className="space-y-1.5">
                {subcatDetail.map((s, i) => {
                  const catTotal = expenseByCategory.find(c => c.category === selCategory)?.total || 1;
                  const pct = (s.total / catTotal * 100);
                  return (
                    <div key={i} className="p-2 bg-slate-50 rounded-lg">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-semibold">{s.name}</span>
                        <span className="text-xs font-bold text-red-600">{fmtE(s.total)} ({pct.toFixed(1)}%)</span>
                      </div>
                      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-red-400" style={{ width: pct + '%' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <h3 className="font-bold text-sm mb-3">Monthly Category Trend / اتجاه الفئات الشهري</h3>
            {(() => {
              const topCats = expenseByCategory.slice(0, 5);
              const catMonthly = {};
              filteredTreasury.filter(t => Number(t.cash_out || 0) > 0).forEach(t => {
                const m = t.transaction_date ? t.transaction_date.substring(0, 7) : null;
                const cat = EXPENSE_CATS[t.category] || t.category || 'Uncategorized';
                if (!m || !topCats.find(c => c.category === cat)) return;
                if (!catMonthly[m]) catMonthly[m] = { month: m };
                catMonthly[m][cat] = (catMonthly[m][cat] || 0) + Number(t.cash_out || 0);
              });
              const data = Object.values(catMonthly).sort((a, b) => a.month.localeCompare(b.month));
              const bars = topCats.map((c, i) => ({ key: c.category, label: c.category, color: COLORS[i] }));
              return <Chart data={data} bars={bars} height={350} />;
            })()}
          </div>
        </div>
      )}

      {/* ===== YEAR COMPARISON ===== */}
      {view === 'comparison' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <h3 className="font-bold text-sm mb-3">Yearly Comparison / مقارنة سنوية</h3>
            <Chart data={yearlyData} bars={[{ key: 'income', label: 'Income', color: '#10b981' }, { key: 'expenses', label: 'Expenses', color: '#ef4444' }]} />
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <h3 className="font-bold text-sm mb-3">Year Details / تفاصيل السنوات</h3>
            <div className="space-y-2">
              {yearlyData.map(y => (
                <div key={y.year} className="bg-slate-50 rounded-xl p-3">
                  <div className="font-bold text-sm mb-1">{y.year}</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><span className="text-slate-400">Income:</span> <span className="font-bold text-green-600">{fmtE(y.income)}</span></div>
                    <div><span className="text-slate-400">Expenses:</span> <span className="font-bold text-red-600">{fmtE(y.expenses)}</span></div>
                    <div><span className="text-slate-400">Net:</span> <span className={'font-bold ' + (y.income - y.expenses >= 0 ? 'text-emerald-600' : 'text-red-600')}>{y.income - y.expenses >= 0 ? '+' : ''}{fmtE(y.income - y.expenses)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
