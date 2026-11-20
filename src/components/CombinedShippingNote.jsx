'use client';
// v55.83-VS (Max to Codex, Nov 20 2026 · Codex 07:20 P2) — the neutral note for releases whose transportation cost is ONE
// combined amount (trucking and freight together). It is information, not a warning: the cost is known and used as it is.
// Shown on its own, also when a period has nothing at all to fix. Shows only what it is given.
import React from 'react';

function usd(n) { return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function CombinedShippingNote(props) {
  var list = props.combined || [];
  if (!list.length) { return null; }
  return <div className="mb-2 px-2 py-1 rounded text-[11px]" style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}>
    {list.length + ' release(s) use a combined transportation cost; breakdown not separated ('
      + list.slice(0, 8).map(function (x) { return x.release + ' ' + usd(x.amount); }).join(', ') + (list.length > 8 ? ' …' : '')
      + '). It is used in the profit as it is — nothing to fix.'}
  </div>;
}
