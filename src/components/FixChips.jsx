// v55.83-WN — P&L by period, "Lines to fix": what is missing on ONE sale line, as buttons (Max, 20 Nov 2026: "it says it's
// missing shipping, but ... it's not missing ... something I click on and it takes me where I'm supposed to go").
// Each button says the REAL reason (the same one as the numbered list above — a shipping cost that is there but cannot be
// shared is never called "not known") and jumps to the numbered row where that thing is fixed. Stateless.
import React from 'react';

// props: fixes ([{ n, kind, label }] from openTasks().by_line), fallback (plain words when the line has no numbered fix), onGo(fix)
export default function FixChips(props) {
  var list = props.fixes || [];
  if (!list.length) { return <span style={{ color: '#b45309', fontWeight: 700 }}>{props.fallback || ''}</span>; }
  return (
    <span className="flex gap-1 flex-wrap">
      {list.map(function (f) {
        return <button key={f.n + ':' + f.kind} type="button" onClick={function (e) { e.stopPropagation(); if (props.onGo) { props.onGo(f); } }}
          title={'Takes you to number ' + f.n + ' in the list above, where this is fixed'}
          className="px-1.5 py-0.5 rounded font-extrabold text-left" style={{ background: '#fff7ed', color: '#9a3412', border: '1px solid #fdba74', cursor: 'pointer' }}>{f.label + ' → fix #' + f.n}</button>;
      })}
    </span>
  );
}
