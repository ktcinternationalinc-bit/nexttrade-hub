'use client';

import React, { useState } from 'react';
import { hubFetch } from '../lib/hub-fetch';
import { COST_ENTRY_UNITS } from '../lib/profitability-work-feed';

export default function CostEntryForm({ task, userId, onSaved, onCancel }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const { kind, per, part, lines } = task.entry;
  const [line, setLine] = useState(lines?.length === 1 ? lines[0].id : '');
  const isUnit = kind === 'unit';
  const canSave = value.trim() && (kind !== 'supplier' || line);
  const label = isUnit ? 'Unit' : kind === 'supplier' ? 'Supplier cost per ' + per + ' (USD)' : (part === 'freight' ? 'Shipping cost' : 'Trucking cost') + ' (USD)';

  async function save(event) {
    event.preventDefault();
    if (busy || !canSave) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await hubFetch('/api/accounting/profitability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cost_work_save', user_id: userId, task: task.key, ...(isUnit ? { unit: value } : { amount: value, line }) }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'The entry could not be saved.');
      onSaved();
    } catch (error) {
      setMessage(error.message || 'The entry could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={save} className="nt-paper w-full space-y-3 p-4" aria-label={task.title}>
    {kind === 'supplier' && <label className="block font-semibold">
      Applies to
      <select className="nt-light ml-3 max-w-full rounded border p-2" required value={line} onChange={event => setLine(event.target.value)}>
        <option value="">Choose a product line</option>
        {(lines || []).map(source => <option key={source.id} value={source.id}>{[source.date, source.invoice && 'Invoice ' + source.invoice, source.release, source.product].filter(Boolean).join(' · ')}</option>)}
        {lines?.length > 1 && <option value="all">All listed lines at the same cost</option>}
      </select>
    </label>}
    <label className="block font-semibold">
      {label}
      {isUnit
        ? <select className="nt-light ml-3 rounded border p-2" required value={value} onChange={event => setValue(event.target.value)}>
            <option value="">Choose a unit</option>
            {COST_ENTRY_UNITS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
          </select>
        : <input className="nt-light ml-3 rounded border p-2" required type="number" inputMode="decimal" min={kind === 'supplier' ? 0.000001 : 0} step="any"
            value={value} onChange={event => setValue(event.target.value)} />}
    </label>
    {message && <p role="alert" style={{ color: '#991b1b' }}>{message}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" className="rounded px-3 py-2 font-semibold" style={{ background: '#0f172a', color: '#fff' }} disabled={busy || !canSave}>{busy ? 'Saving…' : 'Save entry'}</button>
      <button type="button" className="rounded border px-3 py-2 font-semibold" style={{ color: '#0f172a' }} disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
