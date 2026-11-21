// v55.83-WP — "Undo" for the last category picked on a bank line (Max, 21 Nov 2026: "need to be able to undo a category
// selection"). Shown at the bottom of the screen right after a pick, on every screen that picks a category the same way
// (P&L by period, Stats → Income Statement, All Transactions). Stateless: the screen keeps the undo point and does the call.
import React from 'react';
import { createPortal } from 'react-dom';

// props: point ({ id, who, label, hours } or null), busy, onUndo(), onClose()
export default function UndoPickBar(props) {
  var p = props.point; if (!p || !p.id) { return null; }
  var bar = (
    <div role="status" style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 400, background: '#0f172a', color: '#ffffff', borderRadius: 10, padding: '8px 10px', boxShadow: '0 6px 24px rgba(15,23,42,0.35)', display: 'flex', gap: 8, alignItems: 'center', maxWidth: 520, fontSize: 12 }}>
      <span style={{ flex: '1 1 auto' }}>{'Category set' + (p.label ? ' to ' + p.label : '') + (p.who ? ' for “' + String(p.who).substring(0, 40) + '”' : '') + '.'}<span style={{ color: '#cbd5e1' }}>{' Undo puts back this line, the look-alike lines it filled and the rule it made. Offered for ' + (p.hours || 24) + ' hours.'}</span></span>
      {p.ready === false ? <span style={{ color: '#fcd34d', fontWeight: 700, whiteSpace: 'nowrap' }}>Undo needs a one-time database step first</span> : <button type="button" disabled={props.busy === true} onClick={function (e) { e.stopPropagation(); if (props.onUndo) { props.onUndo(); } }} style={{ background: props.busy ? '#94a3b8' : '#f59e0b', color: '#0f172a', fontWeight: 800, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{props.busy ? 'Undoing…' : '↶ Undo'}</button>}
      <button type="button" aria-label="Hide the undo bar" onClick={function (e) { e.stopPropagation(); if (props.onClose) { props.onClose(); } }} style={{ background: 'transparent', color: '#cbd5e1', fontWeight: 800, padding: '2px 6px', cursor: 'pointer' }}>✕</button>
    </div>
  );
  return typeof document !== 'undefined' && document.body ? createPortal(bar, document.body) : bar;
}
