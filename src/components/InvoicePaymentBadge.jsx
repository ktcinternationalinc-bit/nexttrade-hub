// v55.83-A.1 — Invoice Payment Status Badge
// Shows at-a-glance whether an invoice's payments are fully confirmed by
// bank statements, partially pending, or have no bank component at all.
//
// States (in priority order):
//   🟢 Confirmed     — total_pending_bank == 0 AND total_confirmed > 0
//                      All recorded payments have been verified.
//   🟡 Pending match — total_pending_bank > 0
//                      At least some payments are waiting for bank statement
//                      confirmation. Shows how much is pending.
//   ⚪ No payments   — total_collected == 0
//                      Nothing recorded yet.

export default function InvoicePaymentBadge({ invoice, fE, compact }) {
  if (!invoice) return null;

  // Defensive defaults — if SQL migration hasn't run yet, columns are null.
  // Fall back to legacy behavior: treat everything as confirmed.
  var confirmed = Number(invoice.total_confirmed || 0);
  var pending = Number(invoice.total_pending_bank || 0);
  var collected = Number(invoice.total_collected || 0);

  // Backward compat: if the new columns are zero but total_collected > 0,
  // assume legacy "all trusted" behavior so old invoices don't suddenly
  // show as "no payments" before the migration is applied.
  if (confirmed === 0 && pending === 0 && collected > 0) {
    confirmed = collected;
  }

  var fmt = fE || (function (n) { return Number(n).toLocaleString(); });

  if (collected === 0 && confirmed === 0 && pending === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold"
            title="No payments recorded yet">
        ⚪ {compact ? '' : 'No payments'}
      </span>
    );
  }

  if (pending > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-bold"
            title={'Pending bank confirmation: ' + fmt(pending) + ' EGP. Confirmed: ' + fmt(confirmed) + ' EGP.'}>
        🟡 {compact ? fmt(pending) : ('Pending: ' + fmt(pending))}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-900 text-[10px] font-bold"
          title={'All ' + fmt(confirmed) + ' EGP confirmed'}>
      🟢 {compact ? '' : 'Confirmed'}
    </span>
  );
}
