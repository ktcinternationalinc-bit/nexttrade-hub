// v55.83-VV — "Keep in yards": what the switch changes, shown BEFORE it is saved (Max, Nov 20 2026: "how can we implement
// something like that without causing mayhem"). Stateless: it shows what keepYardsPreview() worked out on the server.
import React from 'react';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function money(c) { if (c === null || c === undefined) { return '—'; } var v = c / 100; return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function num(n) { return (Number(n) || 0).toLocaleString('en-US'); }
function qty(s) { var a = []; if (s.pounds > 0) { a.push(num(s.pounds) + ' lb'); } if (s.yards > 0) { a.push(num(s.yards) + ' yd'); } return a.length ? a.join(' + ') : '0'; }

// props: ask ({ names, keep, loading?, error?, preview? }), busy, onConfirm, onCancel
export default function KeepYardsPreview(props) {
  var k = props.ask; if (!k) { return null; }
  var pv = k.preview; var on = k.keep === true;
  var head = on ? 'Keep in yards (not converted to pounds)' : 'Convert to pounds again';
  function row(label, a, b, note) { var same = a === b; return <tr style={{ borderTop: '1px solid ' + LINE }}><td className="px-3 py-1">{label}{note ? <div style={{ color: SUB, fontSize: 10 }}>{note}</div> : null}</td><td className="px-3 py-1 text-right tabular-nums">{a}</td><td className="px-3 py-1 text-right tabular-nums font-extrabold" style={{ color: same ? INK : '#1d4ed8' }}>{b}</td></tr>; }
  return <div role="dialog" aria-modal="true" aria-label={head} style={{ background: '#ffffff', color: INK, borderRadius: 12, border: '2px solid #0f172a', width: 560, maxWidth: '94vw', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 16px 40px rgba(15,23,42,0.4)' }}>
    <div className="px-3 py-2 font-extrabold text-[13px]" style={{ background: '#0f172a', color: '#ffffff' }}>{head}</div>
    {k.loading && <div className="px-3 py-4 text-[12px]">Working out what this changes…</div>}
    {k.error && <div className="px-3 py-3 text-[12px] font-bold" style={{ color: '#b91c1c' }}>{k.error}</div>}
    {pv && <div className="text-[12px]">
      <div className="px-3 py-2"><b>{pv.names.length === 1 ? 'Description:' : pv.names.length + ' descriptions:'}</b> {pv.names.map(function (n) { return n.name + ' (' + n.lines + ' sale line' + (n.lines === 1 ? '' : 's') + ')'; }).join(' · ')}</div>
      {pv.skipped && pv.skipped.length > 0 && <div className="px-3 pb-2" style={{ color: '#b45309' }}>{'Left out: ' + pv.skipped.map(function (x) { return '“' + x.name + '” — ' + x.why; }).join('; ') + '.'}</div>}
      <table className="w-full text-[12px]"><thead><tr style={{ background: '#f1f5f9', color: '#334155' }}><th className="px-3 py-1 text-left">In the dates of the report</th><th className="px-3 py-1 text-right">Now</th><th className="px-3 py-1 text-right">After</th></tr></thead><tbody>
        {row('Quantity counted', qty(pv.before), qty(pv.after), on ? 'Yards are shown as yards and leave the Pounds total' : 'Yards become pounds again')}
        {row('Goods revenue', money(pv.before.goods_revenue), money(pv.after.goods_revenue), 'What was sold does not change')}
        {row('Goods cost', money(pv.before.base_cost), money(pv.after.base_cost), 'From supplier bills in yards — the same dollars')}
        {row('Commission', money(pv.before.commission), money(pv.after.commission), 'Only what is on the supplier bills; no rate is added')}
        {row('Inbound allowance ($0.02 per lb)', money(pv.before.inbound_allowance), money(pv.after.inbound_allowance), on ? 'Not charged on goods kept in yards' : 'Charged again on the converted pounds')}
        {pv.before.goods_profit !== undefined && row('Goods profit (lines with a known cost)', money(pv.before.goods_profit), money(pv.after.goods_profit))}
        {row('Lines with a known cost', pv.before.cost_known + ' of ' + pv.before.lines, pv.after.cost_known + ' of ' + pv.after.lines)}
      </tbody></table>
      {pv.cost_lost > 0 && <div className="px-3 py-2 font-bold" style={{ background: '#fef3c7', color: '#92400e' }}>{pv.cost_lost + ' line' + (pv.cost_lost === 1 ? '' : 's') + ' would lose ' + (pv.cost_lost === 1 ? 'its' : 'their') + ' cost' + (pv.why_lost.bought_by_weight ? ' — ' + pv.why_lost.bought_by_weight + ' bought by weight (a supplier line in pounds is not converted)' : '') + (pv.why_lost.typed_per_pound ? ' — ' + pv.why_lost.typed_per_pound + ' with a cost typed in the other unit' : '') + '. After saving, type the cost per ' + (on ? 'yard' : 'pound') + ' for those lines; until then their profit is not counted.'}</div>}
      <div className="px-3 py-2 text-[11px]" style={{ color: SUB }}>{'Other products: ' + (pv.other_lines_changed === 0 ? 'no other line changes.' : pv.other_lines_changed + ' other line(s) would change — do not save, tell Claude.') + ' Shipping cost shared with other lines: ' + (pv.shipping_shares_changed === 0 ? 'unchanged (shared by shipping weight as before).' : pv.shipping_shares_changed + ' line(s) change.') + ' Invoices, bills and Wave are not touched — this is a report setting and can be switched back.'}</div>
    </div>}
    <div className="px-3 py-2 flex gap-2 justify-end" style={{ borderTop: '1px solid ' + LINE }}>
      <button onClick={props.onCancel} className="px-3 py-1.5 rounded-lg text-[12px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Cancel — change nothing</button>
      {pv && <button onClick={props.onConfirm} disabled={props.busy || pv.other_lines_changed > 0} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: (props.busy || pv.other_lines_changed > 0) ? '#94a3b8' : '#1d4ed8', color: '#ffffff' }}>{on ? 'Yes, keep in yards' : 'Yes, convert to pounds'}</button>}
    </div>
  </div>;
}
