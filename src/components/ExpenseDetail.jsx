// v55.83-VT — P&L by period: what is behind ONE expense figure (Max, Nov 20 2026: "click on expenses to see the underlying" ·
// "for me to change if necessary" · "no double counting with professional fees and the underlying fees that it pays").
// Stateless: it shows the make-up worked out by src/lib/pnl-expense-detail.js. The category picker is passed in (the same save
// as Stats → Income Statement), so this file writes nothing by itself.
import React from 'react';
import FundsSent from './FundsSent'; // v55.83-VY
import { negativeInk } from './PeriodPaidComparison';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function money(c) { if (c === null || c === undefined) { return '—'; } var v = c / 100; return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function Row(p) { return <tr style={{ borderTop: '1px solid ' + LINE, color: INK, fontWeight: p.strong ? 800 : 400, background: p.strong ? '#f1f5f9' : '#ffffff' }}><td className="px-2 py-1">{p.label}{p.note ? <div style={{ color: SUB, fontSize: 10, fontWeight: 400 }}>{p.note}</div> : null}</td><td className="px-2 py-1 text-right tabular-nums whitespace-nowrap" style={negativeInk(p.cents)}>{money(p.cents)}</td></tr>; }

// props: makeup (one entry of expenseDetail().byKey), rowsListed (false = the lines were not sent to this person),
//        picker(row) → the category picker for one bank line, or null
export default function ExpenseDetail(props) {
  var m = props.makeup; var picker = props.picker || function () { return null; };
  if (!m) { return <div className="text-[11px] px-2 py-1" style={{ color: SUB }}>Nothing to show for this line.</div>; }
  if (m.remainder && props.funding) {
    // v55.83-VY — a company row (its explicit fee, or what is held with it): the whole picture of the funds sent, with the bills
    return <div><div className="px-2 py-1 text-[11px] font-bold" style={{ color: m.is_explicit_fee || m.is_provisional_fee ? '#7f1d1d' : '#065f46' }}>{m.is_provisional_fee ? 'The RTM remainder goes to Professional Fees until the underlying bills are linked.' : m.is_explicit_fee ? 'This line is the part explicitly marked as their fee — it IS deducted.' : 'This line is NOT an expense: it shows the cash still with the company.'}</div><FundsSent funding={props.funding} catLabel={props.catLabel} onConfirm={props.onConfirm} onOpenBill={props.onOpenBill} /></div>;
  }
  if (m.remainder) {
    var rm = m.remainder;
    return <div className="text-[11px]" style={{ color: INK }}>
      <div className="px-2 py-1" style={{ color: SUB }}>{'This is not a bill. It is what is left of the money sent to ' + rm.payer + (rm.era_note ? ' (' + rm.era_note + ')' : '') + ' in these dates after the bills it paid. The bills it paid are NOT in this figure — each one is counted once, under its own category.'}</div>
      <table className="w-full text-[11px]"><tbody>
        <Row label={'Money sent to ' + rm.payer + ' (' + rm.payments_count + ' bank line(s))'} cents={rm.payments_cents} />
        <Row label="− Bills it paid (counted under their own categories)" cents={-Math.abs(rm.bills_cents)} />
        <Row label="= Left over" cents={rm.left_cents} strong />
        {rm.fees_booked_cents !== 0 && <Row label="   of which: service fee booked on requests" cents={rm.fees_booked_cents} />}
        {rm.waiting_cents !== 0 && <Row label="   of which: still waiting for bills" cents={rm.waiting_cents} />}
        {rm.other_left_cents !== 0 && <Row label="   of which: the rest" cents={rm.other_left_cents} />}
        <Row label="This line" cents={m.cents} strong />
      </tbody></table>
    </div>;
  }
  var b = m.bank || { cents: 0, count: 0, rows: [], listed_cents: 0, unlisted_cents: 0 };
  return <div className="text-[11px]" style={{ color: INK }}>
    <table className="w-full text-[11px]"><tbody>
      {m.net ? <Row label={'Returns taken out by the bank (' + m.net.debit_count + ')'} cents={m.net.debits_cents} /> : null}
      {m.net ? <Row label={'− Deposits that were returned (' + m.net.credit_count + ')'} note="Money that came in and was later taken back by the bank. It is taken off here so the pair is not a cost, and it is not counted as income." cents={-Math.abs(m.net.credits_cents)} /> : null}
      <Row label={m.net ? '= Bank lines under this category, net (' + b.count + ')' : 'Bank lines paid under this category (' + b.count + ')'} cents={b.cents} />
      {m.from_advances_cents !== 0 && <Row label="+ Bills paid from an advance, booked here" cents={m.from_advances_cents} />}
      {m.taken_out.map(function (t, i) { return <Row key={'t' + i} label={'− Money sent to ' + t.payer + (t.era_note ? ' (' + t.era_note + ')' : '') + ', taken out of here'} note={'It is replaced by the bills ' + t.payer + ' paid, so the same money is not counted twice.'} cents={-Math.abs(t.cents)} />; })}
      {m.bills.cents !== 0 && <Row label="+ Bills paid through RTM / NextTrade that belong to this category" cents={m.bills.cents} />}
      {m.nextrade && <Row label={'+ NextTrade charges (' + m.nextrade.count + ')'} cents={m.nextrade.cents} />}
      {m.other_cents !== 0 && <Row label="Other adjustments (not explained by the lists below)" note="Shown so nothing is hidden. Tell Claude if you see this." cents={m.other_cents} />}
      <Row label={'= ' + m.label + (m.adds_up ? ' — adds up' : '')} cents={m.cents} strong />
    </tbody></table>
    {props.rowsListed === false && <div className="px-2 py-1" style={{ color: '#b45309' }}>The bank lines themselves are not shown to you.</div>}
    {b.rows.length > 0 && <div className="mt-1">
      <div className="px-2 py-1 font-extrabold" style={{ background: '#f8fafc', color: INK }}>{'Bank lines (' + b.rows.length + ')'}</div>
      <div className="overflow-auto pl-scroll" style={{ maxHeight: 260 }}><table className="w-full text-[11px]"><tbody>
        {b.rows.map(function (r, i) { return <tr key={r.id || i} style={{ borderTop: '1px solid ' + LINE }}>
          <td className="px-2 py-1 whitespace-nowrap">{r.date}</td><td className="px-2 py-1 font-semibold">{String(r.who).substring(0, 70)}{r.money_in && <div style={{ color: '#065f46', fontWeight: 800 }}>{'money IN: the deposit that was returned' + (r.matched_invoice ? ' · it is matched to an invoice: check that invoice is not shown as paid' : '')}</div>}</td>
          <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap" style={negativeInk(r.cents)}>{money(r.cents)}</td><td className="px-2 py-1 text-right">{picker(r)}</td></tr>; })}
      </tbody></table></div>
      {b.unlisted_cents !== 0 && <div className="px-2 py-1" style={{ color: '#b45309' }}>{'The lines listed add up to ' + money(b.listed_cents) + '; the other ' + money(b.unlisted_cents) + ' is an advance moved in or out of this category, or lines beyond what one list can hold (open a shorter period to see them all).'}</div>}
    </div>}
    {b.rows.length === 0 && b.cents !== 0 && props.rowsListed !== false && <div className="px-2 py-1" style={{ color: '#b45309' }}>No bank lines could be listed for this amount (open a shorter period, or it is an advance moved between categories).</div>}
    {m.nextrade?.rows.length > 0 && <div className="mt-1">
      <div className="px-2 py-1 font-extrabold" style={{ background: '#f8fafc' }}>NextTrade charges by transaction date</div>
      <table className="w-full"><tbody>{m.nextrade.rows.map(function (row, index) {
        return <tr key={row.id || index} style={{ borderTop: '1px solid ' + LINE }}>
          <td className="px-2 py-1 whitespace-nowrap">{row.date}</td>
          <td className="px-2 py-1">{row.who || row.label} (NextTrade){row.bill_id && props.onOpenBill && <button type="button"
            className="ml-2 font-semibold underline" style={{ color: '#1d4ed8' }} onClick={() => props.onOpenBill({ ...row, vendor: row.who, bill_number: row.ref })}>{'Bill ' + row.ref}</button>}<div>{picker(row)}</div></td>
          <td className="px-2 py-1 text-right tabular-nums" style={negativeInk(row.cents)}>{money(row.cents)}</td>
        </tr>;
      })}</tbody></table>
    </div>}
    {m.bills.rows.length > 0 && <div className="mt-1">
      <div className="px-2 py-1 font-extrabold" style={{ background: '#f8fafc', color: INK }}>{'Bills paid through RTM / NextTrade (' + m.bills.rows.length + ') — to change one, change the category on the bill'}</div>
      <div className="overflow-auto pl-scroll" style={{ maxHeight: 260 }}><table className="w-full text-[11px]"><tbody>
        {m.bills.rows.map(function (r, i) { return <tr key={i} style={{ borderTop: '1px solid ' + LINE }}>
          <td className="px-2 py-1 whitespace-nowrap">{r.date}</td><td className="px-2 py-1 font-semibold">{String(r.who).substring(0, 60)}</td><td className="px-2 py-1">{r.ref}</td>
          <td className="px-2 py-1" style={{ color: SUB }}>{'paid by ' + r.payer}<div>{picker(r)}</div></td><td className="px-2 py-1 text-right tabular-nums whitespace-nowrap" style={negativeInk(r.cents)}>{money(r.cents)}</td></tr>; })}
      </tbody></table></div>
      {m.bills.listed_cents !== m.bills.cents && <div className="px-2 py-1" style={{ color: '#b45309' }}>{'The bills listed add up to ' + money(m.bills.listed_cents) + ' of ' + money(m.bills.cents) + ' (the list holds 300 per company).'}</div>}
    </div>}
  </div>;
}
