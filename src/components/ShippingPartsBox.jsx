'use client';
// v55.83-WH — the INTERNAL breakdown of an invoice's shipping (Max, Nov 20 2026: "a way to signify what the charges are for in
// terms of shipping to break it down internally when creating invoice but not what is shown or printed to the client. So when
// you get bills you can match where they belong ... the 2100 also includes bond fees. It might include something else").
// It sits under the shipping terms on the invoice edit window. What is typed here is OUR EXPECTED COST of each part of the
// shipment (release): trucking, freight, other — and the bond amount inside the charge, for information. It is saved for the
// release through the Profitability route (its own permission), NOT into the invoice: the invoice, its PDF and what is sent to
// Wave never see it. A trucking bill later replaces only the trucking figure; the others stay.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Pure: what was TYPED for one release — nothing else. (Codex 17:40: this box is for entering costs. It shows NO margin and NO
// "effective cost": the cost the report really uses also depends on bills that arrived and on a combined amount, and profit is
// shown only to people who may see it — both are worked out in Profitability, in one place, never a second time here.)
// parts = { trucking: { amount }, freight: { amount }, other: { amount, note }, bond: { amount } } (each optional).
// Returns { typed (trucking + freight + other that have a figure), known (how many of those three have a figure), bond }.
export function typedParts(parts) {
  var p = parts || {}; function num(x) { return x && x.amount !== null && x.amount !== undefined && x.amount !== '' && !isNaN(Number(x.amount)) ? Number(x.amount) : null; }
  var t = num(p.trucking); var f = num(p.freight); var o = num(p.other);
  return { typed: Math.round(((t || 0) + (f || 0) + (o || 0)) * 100) / 100, known: [t, f, o].filter(function (v) { return v !== null; }).length, bond: num(p.bond) };
}
export function releasesOfText(text) { return String(text || '').split(/[\/,;]+/).map(function (x) { return x.trim(); }).filter(function (x) { return !!x; }).slice(0, 6); }
function relKey(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

var PARTS = [['trucking', 'Trucking'], ['freight', 'Freight / shipping'], ['other', 'Other'], ['bond', 'Bond / brokerage']];

// props: releaseText (the invoice's Release # box), charged (number), userId, toast, disabled, call (tests: replaces the server call)
export default function ShippingPartsBox(props) {
  var rels = releasesOfText(props.releaseText); var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState(props.initialData || null); var data = s1[0]; var setData = s1[1];   // { parts: { relKey: { part: { amount, note } } }, can_edit }
  var s2 = useState({}); var draft = s2[0]; var setDraft = s2[1];
  var s3 = useState(''); var err = s3[0]; var setErr = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState(props.initialOpen === true); var open = s5[0]; var setOpen = s5[1];
  function call(payload) {
    if (props.call) { return props.call(payload); }
    return supabase.auth.getSession().then(function (sres) {
      var token = sres && sres.data && sres.data.session ? sres.data.session.access_token : '';
      return fetch('/api/accounting/profitability', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(Object.assign({ user_id: props.userId }, payload)) });
    }).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load() { if (!rels.length) { setData(null); return; } call({ action: 'release_parts', releases: rels }).then(function (j) { if (j && j.ok) { setData(j); setErr(''); } else { setData(null); setErr((j && j.error) || 'Could not be loaded.'); } }); }
  useEffect(function () { if (open) { load(); } }, [open, rels.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  function save(rel, part) {
    var k = relKey(rel) + ':' + part; var v = draft[k]; var nk = k + ':note';
    setBusy(true);
    call({ action: 'set_part_estimate', release: rel, part: part, amount: v === undefined ? '' : v, note: part === 'other' ? (draft[nk] || '') : '' }).then(function (j) {
      setBusy(false);
      if (j && j.ok) { toast.success((part === 'bond' ? 'Bond amount noted' : 'Saved') + ' for release ' + rel + '. The invoice itself is not changed.'); var o = Object.assign({}, draft); delete o[k]; delete o[nk]; setDraft(o); load(); }
      else { toast.error((j && j.error) || 'Not saved.'); setErr((j && j.error) || 'Not saved.'); }
    });
  }
  if (!rels.length) { return <div className="mt-2 text-[11px] text-slate-400">To break the shipping down internally (trucking / freight / bond / other), type the Release # above first.</div>; }
  return <div className="mt-2 rounded p-2" style={{ border: '1px dashed #64748b' }}>
    <button type="button" onClick={function () { setOpen(!open); }} className="text-[11px] font-bold text-slate-200" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>{(open ? '▾ ' : '▸ ') + 'Inside the shipping — our cost, part by part (INTERNAL: never printed, never sent to the customer or to Wave)'}</button>
    {open && <div className="mt-1">
      {err && <div className="text-[11px] font-bold" style={{ color: '#fca5a5' }}>{err}</div>}
      {!data && !err && <div className="text-[11px] text-slate-400">Loading…</div>}
      {data && rels.map(function (rel) {
        var pr = (data.parts || {})[relKey(rel)] || {}; var m = typedParts(pr);
        return <div key={rel} className="mb-2">
          <div className="text-[11px] text-slate-300 mb-1">{'Release ' + rel + ' — these figures belong to the RELEASE: any other invoice on release ' + rel + ' shows and changes the same figures' + (rels.length > 1 ? '. This invoice is on ' + rels.length + ' releases; each has its own row' : '') + '.'}</div>
          <div className="flex flex-wrap gap-2 items-end">
            {PARTS.map(function (pp) { var k = relKey(rel) + ':' + pp[0]; var cur = pr[pp[0]]; var shown = draft[k] !== undefined ? draft[k] : (cur && cur.amount !== null && cur.amount !== undefined ? String(cur.amount) : ''); var changed = draft[k] !== undefined && String(draft[k]) !== (cur && cur.amount !== null && cur.amount !== undefined ? String(cur.amount) : '');
              return <label key={pp[0]} className="block text-[11px] text-slate-400">{pp[1] + (pp[0] === 'bond' ? ' (info)' : '')}
                <span className="flex gap-1 items-center"><span>$</span><input value={shown} disabled={props.disabled || busy || !data.can_edit} onChange={function (e) { var o = Object.assign({}, draft); o[k] = e.target.value; setDraft(o); }} placeholder="0.00" aria-label={pp[1] + ' cost for release ' + rel} className="px-2 py-1 rounded text-xs" style={{ width: 96, background: '#0f172a', color: '#f8fafc', border: '1px solid #475569' }} />
                  {pp[0] === 'other' && <input value={draft[k + ':note'] !== undefined ? draft[k + ':note'] : ((cur && cur.note) || '')} disabled={props.disabled || busy || !data.can_edit} onChange={function (e) { var o = Object.assign({}, draft); o[k + ':note'] = e.target.value; if (o[k] === undefined) { o[k] = shown; } setDraft(o); }} placeholder="what it is" aria-label={'What the other cost is, release ' + rel} className="px-2 py-1 rounded text-xs" style={{ width: 130, background: '#0f172a', color: '#f8fafc', border: '1px solid #475569' }} />}
                  {data.can_edit && (changed || (pp[0] === 'other' && draft[k + ':note'] !== undefined)) && <button type="button" disabled={busy} onClick={function () { save(rel, pp[0]); }} className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>Save</button>}</span></label>; })}
          </div>
          <div className="text-[11px] mt-1 text-slate-300">{(m.known ? 'Typed here for this release: $' + fmt(m.typed) + ' (' + m.known + ' of 3 parts)' : 'Nothing typed yet for this release') + (props.terms === 'CNF_INCLUDED' ? '. On this invoice the shipping is inside the price.' : ' · shipping line(s) on this invoice: $' + fmt(props.charged)) + '.'}</div>
          <div className="text-[11px] text-slate-400">This is not the final shipping cost and no profit is shown here. The cost the report uses (bills that arrived, a combined amount) and the shipping profit are in Accounting → Profitability.</div>
          {m.bond !== null && <div className="text-[11px] text-slate-400">{'Bond / brokerage inside this charge: $' + fmt(m.bond) + ' — noted for information. The bond cost is already counted with the goods (per Houston container), so it is not counted a second time as a shipping cost.'}</div>}
        </div>; })}
      {data && !data.can_edit && <div className="text-[11px] text-slate-400">You can see these figures; changing them needs “P&L: Edit Product Costs”.</div>}
      <div className="text-[10px] text-slate-500">Leave a part empty if you do not know it; 0 means there was none. While only ONE of trucking / freight is typed, a combined shipping amount (the box above, or one typed for the release) stays the cost — typing one part, also 0, never wipes it out; both parts typed replace it. A trucking bill replaces only the trucking figure, a freight bill only the freight figure. Empty + Save clears a figure. The “Our shipping cost (freight + trucking)” box above is the combined amount for invoices that are not broken down.</div>
    </div>}
  </div>;
}
