'use client';
// v55.83-VV — the box on an imported bill that says which page(s) of the PDF the bill was taken from, which were left out,
// lets the person pick other pages, and (when the pages are not confirmed) holds the tick that unblocks Save.
// Its own file so a test can render it. state = importPagesState(...) from lib/bill-pages-ui.
import React from 'react';
import { PAGE_KINDS } from '../lib/bill-extract';

export default function BillPagesBox(props) {
  var st = props.state; var reading = !!props.reading;
  if (!st || !st.pages) { return null; }
  var many = st.count > 1;
  var nums = []; for (var i = 1; i <= Math.min(st.count, 40); i++) { nums.push(i); }
  return <div data-bill-pages-box={st.review ? 'review' : 'ok'} className="rounded-lg p-2 mb-2" style={st.review ? { background: '#fee2e2', color: '#7f1d1d', border: '2px solid #dc2626' } : { background: '#dcfce7', color: '#14532d', border: '1px solid #16a34a' }}>
    <div className="text-[12px] font-extrabold">{st.pages.words}</div>
    {many && <div className="text-[11px] mt-1 flex flex-wrap items-center gap-2">
      <span className="font-bold">Wrong pages? Tick the page(s) that ARE the bill:</span>
      {nums.map(function (pn) {
        var ig = (st.pages.ignored || []).filter(function (g) { return g.page === pn; })[0];
        return <label key={pn} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: '#ffffff', color: '#0f172a', border: '1px solid #94a3b8' }}>
          <input type="checkbox" checked={!!st.pick[pn]} onChange={function (e) { props.onPick(pn, e.target.checked); }} />
          {'Page ' + pn + (ig && PAGE_KINDS[ig.kind] && ig.kind !== 'other' ? ' · ' + PAGE_KINDS[ig.kind] : '')}
        </label>;
      })}
      <button onClick={props.onReread} disabled={reading} className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff', opacity: reading ? 0.6 : 1 }}>{reading ? 'Reading…' : 'Use these pages instead'}</button>
    </div>}
    {st.review && <label className="flex items-center gap-2 mt-2 px-2 py-1 rounded text-[12px] font-extrabold" style={{ background: '#ffffff', color: '#7f1d1d', border: '2px solid #dc2626' }}>
      <input type="checkbox" data-pages-confirm="1" checked={!!st.confirmed} onChange={function (e) { props.onConfirm(e.target.checked); }} />
      I compared every field below with the bill itself — Save stays blocked until this is ticked.
    </label>}
    <div className="text-[10px] mt-1">The reader still receives the whole file and is TOLD which pages to leave out — it is not proof. Always compare the fields with the bill.{many ? ' Using other pages reads the file again and replaces what is filled in below.' : ''} The WHOLE file ({st.count} {st.count === 1 ? 'page' : 'pages'}) stays attached to the bill either way — nothing is removed.</div>
  </div>;
}
