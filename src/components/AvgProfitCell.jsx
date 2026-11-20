// v55.83-WK — P&L by period: "Avg profit / lb" for one row (Codex 18:46: an UNKNOWN profit must never be shown as 0).
// Stateless: it shows what avgProfitPerUnit() (src/lib/pnl-period.js) worked out. A unit's average is a number only when EVERY
// sale line of that unit in the row has a known goods profit and a quantity; otherwise it is a dash that says why. A genuine
// zero is a number (0.0000). Rows with both kinds show per pound and, under it, per yard.
import React from 'react';

function f4(n) { return (Number(n) || 0).toFixed(4); }

// props: avg ({ lb, yd, lb_lines, yd_lines, lb_missing, yd_missing } — lb / yd in dollars or null), hidden (profit not shown to this person)
export default function AvgProfitCell(props) {
  if (props.hidden) { return <span>🔒</span>; }
  var a = props.avg || {}; var hasLb = a.lb_lines > 0; var hasYd = a.yd_lines > 0;
  function part(v, missing, unit, showUnit) {
    if (v === null || v === undefined) { return <span style={{ color: '#b45309' }} title={missing > 0 ? missing + ' sale line(s) sold by the ' + (unit === 'lb' ? 'pound' : 'yard') + ' have no cost yet, so their profit is not known — no average is shown' : 'No quantity to divide by'}>{'—' + (showUnit ? ' / ' + unit : '') + (missing > 0 ? ' (cost missing)' : '')}</span>; }
    return <span>{f4(v) + (showUnit ? ' / ' + unit : '')}</span>;
  }
  if (!hasLb && !hasYd) { return <span>—</span>; }
  if (hasLb && hasYd) { return <span title="Profit per pound on the pound goods, per yard on the yard goods">{part(a.lb, a.lb_missing, 'lb', true)}<div style={{ color: '#1d4ed8' }}>{part(a.yd, a.yd_missing, 'yd', true)}</div></span>; }
  if (hasYd) { return part(a.yd, a.yd_missing, 'yd', true); }
  return part(a.lb, a.lb_missing, 'lb', false);
}
