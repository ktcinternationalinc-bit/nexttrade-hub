// v55.83-WL — Sales Report: the quantity cell and the average-price cell of one row. Goods kept in yards are shown in YARDS,
// beside the pounds of the goods counted in pounds; the average is per pound for the pound goods and per yard for the yard
// goods, one under the other, never blended. Stateless: it shows what the server worked out (src/lib/sales-units.js).
import React from 'react';

function n0(v) { return Number(v || 0).toLocaleString('en-US'); }
function d4(v) { return '$' + Number(v).toFixed(4); }
var YD = { color: '#1d4ed8' };

// props: row ({ pounds, yards, pounds_incomplete })
export function SalesQtyCell(props) {
  var r = props.row || {}; var yd = Number(r.yards) > 0; var lb = Number(r.pounds) > 0 || !yd;
  return (
    <span>
      {lb && <span>{n0(r.pounds) + (yd ? ' lb' : '')}</span>}
      {yd && <div style={YD} title="Kept in yards: not converted to pounds">{n0(r.yards) + ' yd'}</div>}
      {r.pounds_incomplete && <div className="text-[9px]" style={{ color: '#b45309' }}>unit not set on some lines</div>}
    </span>
  );
}

// props: row ({ pounds, yards, avg_price_per_lb, avg_price_per_yd })
export function SalesAvgCell(props) {
  var r = props.row || {}; var yd = Number(r.yards) > 0; var lb = Number(r.pounds) > 0 || !yd;
  return (
    <span>
      {lb && <span>{(r.avg_price_per_lb != null ? d4(r.avg_price_per_lb) : '—') + (yd ? ' / lb' : '')}</span>}
      {yd && <div style={YD}>{(r.avg_price_per_yd != null ? d4(r.avg_price_per_yd) : '—') + ' / yd'}</div>}
    </span>
  );
}
