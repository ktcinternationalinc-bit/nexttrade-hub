// v55.83-A.6.9 (Max May 13 2026) — Write-offs Audit Report
//
// Tracks every short-payment write-off applied across all invoices.
// Three views in one page:
//   1. Detail list (every write-off entry, filterable by date/customer/user)
//   2. Summary by Customer (who's costing us the most)
//   3. Summary by Approver (who's writing off the most — accountability)
//
// Reads from invoices.total_written_off + audit_log entries with
// action='write_off' / 'write_off_reverse'.
//
// Bilingual (EN + AR) per Max's rule.

import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fE } from '../lib/utils';

export default function WriteOffsReport({ invoices, customers, users, canView }) {
  if (!canView) {
    return (
      <div className="bg-white rounded-xl p-6 text-center text-sm text-slate-600">
        🔒 You don't have permission to view write-off reports / لا تملك صلاحية عرض تقارير الخصومات
      </div>
    );
  }

  const [auditEntries, setAuditEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('detail'); // detail | by_customer | by_user
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterUser, setFilterUser] = useState('');

  // Load audit log entries for write_off actions
  useEffect(function () {
    setLoading(true);
    supabase.from('audit_log')
      .select('*')
      .in('action', ['write_off', 'write_off_reverse'])
      .order('changed_at', { ascending: false })
      .then(function (res) {
        if (res.data) setAuditEntries(res.data);
        setLoading(false);
      })
      .catch(function (err) {
        console.warn('[WriteOffsReport] audit log fetch failed:', err && err.message);
        setLoading(false);
      });
  }, []);

  // Map audit entries → enriched rows
  const enriched = useMemo(function () {
    var invById = {};
    (invoices || []).forEach(function (inv) { invById[inv.id] = inv; });
    var custByName = {};
    (customers || []).forEach(function (c) { custByName[c.name] = c; custByName[c.id] = c; });
    var userById = {};
    (users || []).forEach(function (u) { userById[u.id] = u; });

    return auditEntries.map(function (e) {
      var inv = invById[e.record_id] || {};
      var u = userById[e.changed_by] || {};
      var v = e.new_values || {};
      return {
        id: e.id,
        date: (e.changed_at || '').substring(0, 10),
        action: e.action, // 'write_off' or 'write_off_reverse'
        amount: Number(v.amount || v.amount_reversed || 0),
        invoice_id: e.record_id,
        order_number: inv.order_number || '?',
        customer_name: inv.customer_name || inv.customer_name_en || '?',
        invoice_total: Number(inv.total_amount || 0),
        approver_name: u.name || u.email || 'Unknown',
        approver_id: e.changed_by,
        soft_cap_overridden: !!v.soft_cap_overridden,
        note_en: v.note_en || '',
        note_ar: v.note_ar || '',
        reason: v.reason || (e.action === 'write_off_reverse' ? 'Reversal' : 'Customer short-payment'),
      };
    });
  }, [auditEntries, invoices, customers, users]);

  // Apply filters
  const filtered = useMemo(function () {
    return enriched.filter(function (r) {
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      if (filterCustomer && !((r.customer_name || '').toLowerCase().includes(filterCustomer.toLowerCase()))) return false;
      if (filterUser && r.approver_id !== filterUser) return false;
      return true;
    });
  }, [enriched, dateFrom, dateTo, filterCustomer, filterUser]);

  // Summary metrics
  const summary = useMemo(function () {
    var total = 0;
    var reversedTotal = 0;
    var overrideCount = 0;
    filtered.forEach(function (r) {
      if (r.action === 'write_off') {
        total += r.amount;
        if (r.soft_cap_overridden) overrideCount++;
      } else if (r.action === 'write_off_reverse') {
        reversedTotal += r.amount;
      }
    });
    return { total: total, reversedTotal: reversedTotal, net: total - reversedTotal, overrideCount: overrideCount };
  }, [filtered]);

  const byCustomer = useMemo(function () {
    var map = {};
    filtered.forEach(function (r) {
      if (r.action !== 'write_off') return;
      if (!map[r.customer_name]) map[r.customer_name] = { customer: r.customer_name, total: 0, count: 0, invoices: [] };
      map[r.customer_name].total += r.amount;
      map[r.customer_name].count += 1;
      map[r.customer_name].invoices.push(r.order_number);
    });
    return Object.values(map).sort(function (a, b) { return b.total - a.total; });
  }, [filtered]);

  const byApprover = useMemo(function () {
    var map = {};
    filtered.forEach(function (r) {
      if (r.action !== 'write_off') return;
      if (!map[r.approver_id]) map[r.approver_id] = { approver: r.approver_name, total: 0, count: 0, overrides: 0 };
      map[r.approver_id].total += r.amount;
      map[r.approver_id].count += 1;
      if (r.soft_cap_overridden) map[r.approver_id].overrides += 1;
    });
    return Object.values(map).sort(function (a, b) { return b.total - a.total; });
  }, [filtered]);

  // Export filtered detail to CSV
  const exportCsv = function () {
    var headers = ['Date', 'Action', 'Amount (EGP)', 'Order #', 'Customer', 'Invoice Total', 'Approver', 'Soft Cap Overridden', 'Reason', 'Notes'];
    var rows = filtered.map(function (r) {
      return [
        r.date, r.action, r.amount, r.order_number, r.customer_name,
        r.invoice_total, r.approver_name,
        r.soft_cap_overridden ? 'YES' : 'no', r.reason, r.note_en
      ];
    });
    var csv = [headers].concat(rows).map(function (row) {
      return row.map(function (c) {
        var s = String(c == null ? '' : c);
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'write-offs-' + (new Date().toISOString().substring(0, 10)) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl p-4 border border-slate-200">
        <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold">📝 Write-offs Audit Report / تقرير الخصومات</h3>
            <p className="text-[10px] text-slate-500">Every short-payment write-off across invoices / كل خصم تم تطبيقه</p>
          </div>
          <button onClick={exportCsv}
            className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-bold hover:bg-emerald-700">
            ⬇ Export CSV / تصدير
          </button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <div>
            <label className="text-[10px] font-semibold text-slate-600">From / من</label>
            <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value); }}
              className="w-full px-2 py-1 rounded border border-slate-200 text-xs" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-600">To / إلى</label>
            <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value); }}
              className="w-full px-2 py-1 rounded border border-slate-200 text-xs" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-600">Customer / العميل</label>
            <input type="text" placeholder="Search customer name" value={filterCustomer}
              onChange={function (e) { setFilterCustomer(e.target.value); }}
              className="w-full px-2 py-1 rounded border border-slate-200 text-xs" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-600">Approver / المعتمد</label>
            <select value={filterUser} onChange={function (e) { setFilterUser(e.target.value); }}
              className="w-full px-2 py-1 rounded border border-slate-200 text-xs">
              <option value="">All / الكل</option>
              {(users || []).map(function (u) {
                return <option key={u.id} value={u.id}>{u.name || u.email}</option>;
              })}
            </select>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <div className="bg-amber-50 rounded p-2 border border-amber-200">
            <div className="text-[10px] text-amber-700">Total written off / المجموع</div>
            <div className="text-lg font-extrabold text-amber-700">{fE(summary.total)}</div>
          </div>
          <div className="bg-slate-50 rounded p-2 border border-slate-200">
            <div className="text-[10px] text-slate-600">Reversals / المُلغى</div>
            <div className="text-lg font-extrabold text-slate-700">{fE(summary.reversedTotal)}</div>
          </div>
          <div className="bg-red-50 rounded p-2 border border-red-200">
            <div className="text-[10px] text-red-700">Net loss / صافي الخسارة</div>
            <div className="text-lg font-extrabold text-red-700">{fE(summary.net)}</div>
          </div>
          <div className="bg-orange-50 rounded p-2 border border-orange-200">
            <div className="text-[10px] text-orange-700">Cap overrides / تجاوزات</div>
            <div className="text-lg font-extrabold text-orange-700">{summary.overrideCount}</div>
          </div>
        </div>

        {/* View tabs */}
        <div className="inline-flex rounded-lg overflow-hidden border border-slate-300 text-[11px] font-bold mb-3">
          <button onClick={function () { setView('detail'); }}
            className={'px-3 py-1 ' + (view === 'detail' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>
            📋 Detail / تفصيل
          </button>
          <button onClick={function () { setView('by_customer'); }}
            className={'px-3 py-1 ' + (view === 'by_customer' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>
            👥 By Customer / حسب العميل
          </button>
          <button onClick={function () { setView('by_user'); }}
            className={'px-3 py-1 ' + (view === 'by_user' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>
            🧑 By Approver / حسب المعتمد
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="text-center text-sm text-slate-500 py-6">Loading audit log... / جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-sm text-slate-500 py-6">No write-offs found in this period / لا توجد خصومات في هذه الفترة</div>
        ) : view === 'detail' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left">Date / تاريخ</th>
                  <th className="px-2 py-1 text-left">Order #</th>
                  <th className="px-2 py-1 text-left">Customer / العميل</th>
                  <th className="px-2 py-1 text-right">Amount / مبلغ</th>
                  <th className="px-2 py-1 text-left">Action</th>
                  <th className="px-2 py-1 text-left">Approver / المعتمد</th>
                  <th className="px-2 py-1 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(function (r) {
                  return (
                    <tr key={r.id} className={'border-t border-slate-100 ' + (r.action === 'write_off_reverse' ? 'bg-slate-50 text-slate-500' : '')}>
                      <td className="px-2 py-1 font-mono">{r.date}</td>
                      <td className="px-2 py-1 font-mono">{r.order_number}</td>
                      <td className="px-2 py-1">{r.customer_name}</td>
                      <td className={'px-2 py-1 text-right font-bold ' + (r.action === 'write_off' ? 'text-amber-700' : 'text-slate-400 line-through')}>
                        {fE(r.amount)}
                      </td>
                      <td className="px-2 py-1">
                        {r.action === 'write_off' ? (
                          <span className="text-amber-700 font-semibold">📝 Write-off</span>
                        ) : (
                          <span className="text-slate-500">↩ Reversal</span>
                        )}
                        {r.soft_cap_overridden && (
                          <span className="ml-1 text-[9px] bg-orange-200 text-orange-900 px-1 rounded font-bold">CAP OVERRIDE</span>
                        )}
                      </td>
                      <td className="px-2 py-1">{r.approver_name}</td>
                      <td className="px-2 py-1 text-[10px] text-slate-600">{r.note_en || r.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : view === 'by_customer' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-1 text-left">Customer / العميل</th>
                  <th className="px-2 py-1 text-right">Total written off / مجموع</th>
                  <th className="px-2 py-1 text-right">Count / العدد</th>
                  <th className="px-2 py-1 text-left">Invoices / الفواتير</th>
                </tr>
              </thead>
              <tbody>
                {byCustomer.map(function (r, i) {
                  return (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-semibold">{r.customer}</td>
                      <td className="px-2 py-1 text-right font-bold text-amber-700">{fE(r.total)}</td>
                      <td className="px-2 py-1 text-right">{r.count}</td>
                      <td className="px-2 py-1 text-[10px] font-mono text-slate-500">{r.invoices.slice(0, 5).join(', ')}{r.invoices.length > 5 ? ' +' + (r.invoices.length - 5) + ' more' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-1 text-left">Approver / المعتمد</th>
                  <th className="px-2 py-1 text-right">Total approved / مجموع</th>
                  <th className="px-2 py-1 text-right">Count / العدد</th>
                  <th className="px-2 py-1 text-right">Cap overrides / تجاوزات</th>
                </tr>
              </thead>
              <tbody>
                {byApprover.map(function (r, i) {
                  return (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-semibold">{r.approver}</td>
                      <td className="px-2 py-1 text-right font-bold text-amber-700">{fE(r.total)}</td>
                      <td className="px-2 py-1 text-right">{r.count}</td>
                      <td className="px-2 py-1 text-right">
                        {r.overrides > 0 ? (
                          <span className="bg-orange-200 text-orange-900 px-1 rounded font-bold">{r.overrides}</span>
                        ) : (
                          <span className="text-slate-300">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
