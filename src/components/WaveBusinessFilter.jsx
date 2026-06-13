'use client';
// v55.83-CH — shared Wave business toggle for list screens (Invoices, Customers).
// Shows a dropdown of registered businesses + a prod/test badge. Picking one sets
// the shared active business (localStorage) so every scoped screen follows it.
// If no business is registered yet, it renders nothing and the lists show all —
// the wall simply isn't turned on, so there's nothing to toggle.
import { useState, useEffect } from 'react';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { getActiveWaveBusiness, setActiveWaveBusiness } from '../lib/wave-business';

export default function WaveBusinessFilter(props) {
  var [registry, setRegistry] = useState([]);
  var [val, setVal] = useState(getActiveWaveBusiness() || '');
  useEffect(function () {
    fetchAllRows('wave_business_registry', '*').then(function (r) {
      var reg = (r && r.data) || [];
      setRegistry(reg);
      if (props.onChange) { props.onChange(getActiveWaveBusiness() || '', reg); }
    }).catch(function () { if (props.onChange) { props.onChange(getActiveWaveBusiness() || '', []); } });
  }, []);
  function pick(v) {
    setVal(v);
    setActiveWaveBusiness(v);
    if (props.onChange) { props.onChange(v, registry); }
  }
  if (!registry || registry.length === 0) { return null; }
  var sel = null;
  registry.forEach(function (b) { if (b.wave_business_id === val) { sel = b; } });
  return (
    <div className="flex items-center gap-2 flex-wrap bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2">
      <span className="text-[11px] font-bold text-slate-200">Wave business:</span>
      <select value={val} onChange={function (e) { pick(e.target.value); }}
        className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs min-w-[220px]">
        <option value="">All businesses (no filter)</option>
        {registry.map(function (b) {
          return <option key={b.wave_business_id} value={b.wave_business_id}>{(b.label || b.wave_business_id) + (b.is_production === false ? ' (Test)' : ' (Real)')}</option>;
        })}
      </select>
      {sel
        ? <span className={'px-2 py-0.5 rounded text-[10px] font-bold ' + (sel.is_production !== false ? 'bg-emerald-100 text-emerald-950' : 'bg-amber-100 text-amber-950')}>{sel.is_production !== false ? '🔒 Real — read-only' : '🧪 Test'}</span>
        : <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-800">Showing all businesses</span>}
    </div>
  );
}
