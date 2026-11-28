import React, { useState } from 'react';
import { billSplitCents, canSplitInto } from '../lib/nextrade-bill-splits';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const input = 'nt-light rounded border px-2 py-1 text-[12px]';
const blankPart = () => ({ category: '', amount: '', include_ktc: true });

export default function NextradeBillSplitEditor({ line, categories, busy, onSave, onCancel }) {
  const [parts, setParts] = useState(() => line.category_split?.length
    ? line.category_split.map(part => ({ ...part, amount: (part.cents / 100).toFixed(2), include_ktc: part.include_ktc !== false }))
    : [{ ...blankPart(), category: line.company_category || '' }, blankPart()]);
  const options = categories.filter(canSplitInto);
  const allocations = parts.map(part => ({ category: part.category, cents: billSplitCents(part.amount), include_ktc: part.include_ktc }));
  const total = Math.round(Number(line.amount_abs) * 100);
  const remaining = total - allocations.reduce((sum, part) => sum + part.cents, 0);
  const isValid = remaining === 0 && new Set(allocations.map(part => part.category)).size === allocations.length
    && allocations.every(part => part.cents > 0 && options.some(option => option.key === part.category));

  function update(index, patch) {
    setParts(current => current.map((part, i) => i === index ? { ...part, ...patch } : part));
  }

  return <section aria-label="Split bill categories" className="rounded border border-slate-300 p-3" style={{ background: '#f8fafc', color: '#0f172a' }}>
    <h4 className="mb-1 font-bold">Split bill categories</h4>
    <p className="mb-2 text-[12px]">Allocate the full {currency.format(total / 100)}. NextTrade keeps all portions. KTC P&amp;L uses the checked portions.</p>
    {line.bill_split_stale && <p className="mb-2 text-[12px]" style={{ color: '#991b1b' }}>The transaction amount changed. Enter a new split for the current total.</p>}
    <div className="space-y-1.5">
      {parts.map((part, index) => <div key={index} className="flex flex-wrap items-center gap-2">
        <select className={input} aria-label={'Category ' + (index + 1)} value={part.category} disabled={busy} onChange={event => update(index, { category: event.target.value })}>
          <option value="">Choose category</option>
          {part.category && !options.some(option => option.key === part.category) && <option value={part.category} disabled>{part.category}</option>}
          {options.filter(option => option.key === part.category || !parts.some(other => other.category === option.key)).map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
        <input className={input + ' w-28'} aria-label={'Amount ' + (index + 1)} inputMode="decimal" placeholder="0.00" value={part.amount} disabled={busy} onChange={event => update(index, { amount: event.target.value })} />
        <label className="flex items-center gap-1 text-[12px]">
          <input type="checkbox" checked={part.include_ktc} disabled={busy} aria-label={'Include split ' + (index + 1) + ' in KTC P&L'} onChange={event => update(index, { include_ktc: event.target.checked })} /> Include in KTC P&amp;L
        </label>
        {parts.length > 2 && <button type="button" disabled={busy} className="text-[12px] underline" onClick={() => setParts(current => current.filter((_, i) => i !== index))}>Remove row</button>}
      </div>)}
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
      <b style={{ color: remaining < 0 ? '#991b1b' : '#0f172a' }}>{currency.format(remaining / 100)} left to allocate</b>
      <button type="button" disabled={busy || parts.length >= 12 || parts.length >= options.length} className="underline" onClick={() => setParts(current => [...current, blankPart()])}>Add category</button>
      <button type="button" disabled={busy || !isValid} className="rounded bg-[#1e3a8a] px-3 py-1 font-bold text-white disabled:opacity-50" onClick={() => onSave(allocations)}>Save split</button>
      {(line.category_split?.length > 0 || line.bill_split_stale) && <button type="button" disabled={busy} className="underline" onClick={() => onSave([])}>Remove split</button>}
      <button type="button" disabled={busy} className="underline" onClick={onCancel}>Cancel</button>
    </div>
  </section>;
}
