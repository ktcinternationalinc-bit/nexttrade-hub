// v55.83-WY — customer balances TODAY: held for the customer (overpaid) and still owed by the customer (underpaid).
// Max, 21 Nov 2026. Never part of a profit figure and never part of the tax P&L: shown so it is not forgotten. Stateless: it
// shows what src/lib/customer-balances.js worked out on the server. Money is whole cents.
import React from 'react';

function money(c) { var v = (Number(c) || 0) / 100; return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
var HELD = '#065f46'; var OWED = '#9a3412'; var SUB = '#64748b';

// One cell for the "By customer" table: two separate amounts, never netted.
// props: c (the customer's balance row or null), loading, error
export function BalanceCell(props) {
  if (props.loading) { return <span style={{ color: SUB }}>…</span>; }
  if (props.error) { return <span style={{ color: SUB }} title={props.error}>not loaded</span>; }
  var c = props.c;
  if (!c || (!c.held_cents && !c.owed_cents && !(c.recon || []).length)) { return <span style={{ color: SUB }}>—</span>; }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      {c.held_cents ? <span style={{ color: HELD, fontWeight: 700 }} title="Paid to us beyond their invoices — held for the customer, to return or apply">{'held ' + money(c.held_cents)}</span> : null}
      {c.owed_cents ? <span style={{ color: OWED, fontWeight: 700 }} title="Invoice balances not fully paid yet">{'owed ' + money(c.owed_cents)}</span> : null}
      {(c.recon || []).length ? <span style={{ color: '#b45309', fontSize: 10 }}>{(c.recon || []).length + ' to check'}</span> : null}
    </span>
  );
}

// The full panel: totals, one line per customer (open it for the invoices and credits), and money with no customer.
// props: data (the server answer), loading, error, onOpenInvoice(id), compact (true in the pop-up: totals + first customers)
export default function CustomerBalances(props) {
  var d = props.data; var open = React.useState(null); var opened = open[0]; var setOpened = open[1];
  var head = <div style={{ fontWeight: 800, fontSize: 12, color: '#0f172a' }}>Customer balances today <span style={{ fontWeight: 600, color: SUB }}>— not in the profit and not in the tax P&L; noted so nothing is forgotten</span></div>;
  if (props.loading) { return <div className="px-3 py-2 text-[11px]">{head}<div style={{ color: SUB }}>Loading…</div></div>; }
  if (props.error) { return <div className="px-3 py-2 text-[11px]">{head}<div style={{ color: '#991b1b' }}>{props.error}</div></div>; }
  if (!d) { return null; }
  var t = d.totals || {}; var list = d.customers || []; var shown = props.compact ? list.slice(0, 8) : list;
  function invoiceRef(row, color) {
    if (!props.onOpenInvoice) { return <b>{row.number || 'invoice'}</b>; }
    return <button type="button" onClick={function (e) { e.stopPropagation(); props.onOpenInvoice(row.invoice_id); }} style={{ color: color, fontWeight: 800, textDecoration: 'underline' }}>{row.number || 'invoice'}</button>;
  }
  return (
    <div className="px-3 py-2 text-[11px]" style={{ color: '#0f172a' }}>
      {head}
      <div style={{ color: SUB, marginBottom: 4 }}>{'Balances as they are today (' + (d.as_of || '') + '), not this month’s activity.' + (d.window_floor ? ' Only invoices and credits from ' + d.window_floor + ' on, the history you may see.' : '')}</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <span><b style={{ color: HELD }}>{'Held for customers ' + money(t.held_cents)}</b></span>
        <span><b style={{ color: OWED }}>{'Still owed by customers ' + money(t.owed_cents)}</b>{' (part paid ' + money(t.owed_partly_cents) + ' · not paid at all ' + money(t.owed_unpaid_cents) + ')'}</span>
        {t.unidentified_cents ? <span><b>{'Customer not identified ' + money(t.unidentified_cents)}</b></span> : null}
        {t.recon_count ? <span style={{ color: '#b45309' }}><b>{t.recon_count + ' invoice(s) to check'}</b>{' — their own figures disagree, so they are left out of both amounts'}</span> : null}
      </div>
      <table className="w-full"><tbody>
        {shown.map(function (c) { var k = c.customer_id || c.customer; var isO = opened === k; return [
          <tr key={k} onClick={function () { setOpened(isO ? null : k); }} style={{ borderTop: '1px solid #e2e8f0', cursor: 'pointer' }}>
            <td className="py-1">{(isO ? '▾ ' : '▸ ') + c.customer}</td>
            <td className="py-1 text-right" style={{ color: HELD }}>{c.held_cents ? 'held ' + money(c.held_cents) : ''}</td>
            <td className="py-1 text-right" style={{ color: OWED }}>{c.owed_cents ? 'owed ' + money(c.owed_cents) + ' (' + c.owed.length + ' invoice' + (c.owed.length === 1 ? '' : 's') + ')' : ''}</td>
          </tr>,
          isO ? <tr key={k + ':x'}><td colSpan={3} style={{ background: '#f8fafc', padding: 4 }}>
            {c.owed.map(function (r) { return <div key={r.invoice_id} style={{ display: 'flex', gap: 8 }}>{invoiceRef(r, '#1d4ed8')}<span>{r.date + (r.total_cents !== undefined ? ' · total ' + money(r.total_cents) + ' · paid ' + money(r.paid_cents) : '') + ' · '}<b style={{ color: OWED }}>{'owed ' + money(r.balance_cents)}</b>{(r.partly ? ' · part paid' : ' · not paid') + (r.age_days !== null && r.age_days !== undefined ? ' · ' + r.age_days + ' days' : '')}</span></div>; })}
            {c.held.map(function (h) { return <div key={h.kind + h.id}><b style={{ color: HELD }}>{'held ' + money(h.cents)}</b>{' · ' + (h.kind === 'credit' ? 'customer credit' : 'deposit not applied') + (h.date ? ' since ' + h.date : '') + ' — to return by wire or apply to a next invoice'}</div>; })}
            {(c.recon || []).map(function (r) { return <div key={'r' + r.invoice_id} style={{ color: '#b45309' }}>{invoiceRef(r, '#b45309')}{' to check: ' + (r.reason || 'its figures disagree') + (r.total_cents !== undefined ? ' — total ' + money(r.total_cents) + ', paid ' + money(r.paid_cents) + (r.credit_applied_cents ? ', credit applied ' + money(r.credit_applied_cents) : '') + ', balance on the invoice ' + money(r.balance_cents) : '') + '. Not counted in either amount until checked.'}</div>; })}
            {Object.keys(c.other_currency || {}).map(function (cur) { return <div key={cur} style={{ color: SUB }}>{'Also owed in ' + cur + ': ' + ((c.other_currency[cur] || 0) / 100).toFixed(2) + ' ' + cur + ' (not added to the dollars)'}</div>; })}
          </td></tr> : null]; })}
      </tbody></table>
      {props.compact && list.length > shown.length ? <div style={{ color: SUB }}>{'+ ' + (list.length - shown.length) + ' more customers — see Profitability → By customer'}</div> : null}
      {(d.unidentified || []).length ? <div style={{ marginTop: 4 }}><b>Customer not identified</b>{(d.unidentified || []).map(function (u) { return <div key={u.id} style={{ color: SUB }}>{money(u.cents) + (u.date ? ' since ' + u.date : '') + ' — a deposit not yet tied to a customer; never added to any customer'}</div>; })}</div> : null}
    </div>
  );
}
