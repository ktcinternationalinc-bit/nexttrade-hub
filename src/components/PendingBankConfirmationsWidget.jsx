// v55.83-A.1 — Pending Bank Confirmations Dashboard Widget
//
// Surfaces invoices where payments have been recorded as bank-channel but
// haven't yet been matched to a real bank statement entry. Helps the
// super admin spot stuck items before they become problems.
//
// Visibility: super_admin sees all; admin sees if they have the
// "View Financial Reports" permission. Hidden from regular users.
import { useState, useMemo } from 'react';

export default function PendingBankConfirmationsWidget({
  invoices,
  isSuperAdmin,
  modulePerms,
  onSelectInvoice,
  fE,
}) {
  var [expanded, setExpanded] = useState(false);

  // Gate
  var canView = isSuperAdmin || (modulePerms && modulePerms['View Financial Reports'] === true);
  if (!canView) return null;

  var pending = useMemo(function () {
    return (invoices || [])
      .filter(function (inv) { return Number(inv.total_pending_bank || 0) > 0; })
      .sort(function (a, b) {
        return Number(b.total_pending_bank || 0) - Number(a.total_pending_bank || 0);
      });
  }, [invoices]);

  if (pending.length === 0) return null;

  var totalPending = pending.reduce(function (sum, inv) {
    return sum + Number(inv.total_pending_bank || 0);
  }, 0);

  var fmt = fE || function (n) { return Number(n).toLocaleString(); };

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-3 mb-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 cursor-pointer"
        onClick={function () { setExpanded(!expanded); }}>
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xl">⏳</span>
          <div>
            <div className="text-xs font-bold text-amber-900">
              {pending.length} invoice{pending.length === 1 ? '' : 's'} awaiting bank confirmation
            </div>
            <div className="text-[11px] text-amber-700 font-semibold">
              {fmt(totalPending)} EGP recorded as bank payments, not yet matched to bank statements
            </div>
          </div>
        </div>
        <button className="text-[10px] text-amber-700 font-bold hover:underline whitespace-nowrap">
          {expanded ? '▲ Hide' : '▼ Show details'}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 bg-white rounded-lg overflow-hidden border border-amber-200">
          <table className="w-full text-xs">
            <thead className="bg-amber-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-amber-900">Order #</th>
                <th className="px-3 py-2 text-left font-semibold text-amber-900">Customer</th>
                <th className="px-3 py-2 text-right font-semibold text-amber-900">Invoiced</th>
                <th className="px-3 py-2 text-right font-semibold text-emerald-700">Confirmed</th>
                <th className="px-3 py-2 text-right font-semibold text-amber-700">⏳ Pending</th>
                <th className="px-3 py-2 text-right font-semibold text-amber-900">Days waiting</th>
              </tr>
            </thead>
            <tbody>
              {pending.slice(0, 25).map(function (inv) {
                var dateMs = inv.invoice_date ? new Date(inv.invoice_date).getTime() : Date.now();
                var daysWaiting = Math.floor((Date.now() - dateMs) / 86400000);
                var urgency = daysWaiting >= 14 ? 'text-red-600 font-extrabold' : daysWaiting >= 7 ? 'text-orange-600 font-bold' : 'text-slate-700';
                return (
                  <tr key={inv.id}
                    onClick={function () { if (onSelectInvoice) onSelectInvoice(inv); }}
                    className="border-t border-amber-100 hover:bg-amber-50 cursor-pointer">
                    <td className="px-3 py-2 font-bold text-blue-600 font-mono">{inv.order_number}</td>
                    <td className="px-3 py-2 text-slate-700">{inv.customer_name || inv.customer_name_en || '—'}</td>
                    <td className="px-3 py-2 text-right font-bold">{fmt(inv.total_amount)}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{fmt(Number(inv.total_confirmed || 0))}</td>
                    <td className="px-3 py-2 text-right text-amber-700 font-bold">{fmt(Number(inv.total_pending_bank || 0))}</td>
                    <td className={'px-3 py-2 text-right ' + urgency}>{daysWaiting}d</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pending.length > 25 && (
            <div className="px-3 py-2 text-[10px] text-amber-700 text-center bg-amber-50 border-t border-amber-200">
              Showing top 25 of {pending.length}. Use the Egypt Bank tab to match pending payments to bank statement entries.
            </div>
          )}
          <div className="px-3 py-2 text-[10px] text-amber-800 bg-amber-50 border-t border-amber-200">
            💡 To clear these: go to Egypt Bank tab, upload your latest bank statement, and run the auto-matcher. Confirmed payments will move from "Pending" to "Confirmed" automatically.
          </div>
        </div>
      )}
    </div>
  );
}
