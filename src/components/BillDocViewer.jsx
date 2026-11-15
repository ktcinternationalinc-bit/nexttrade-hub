'use client';
// v55.83-SN — the actual bill, on the Bills screen.
// Max, Nov 14: "If I see all the, you know, the AI stuff about it and stuff like that, where do I view the bill?"
// Shows the bill document next to what the AI read. Private link (1 hour), never a public link for 'pv/' files.
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { docBucket, docKind, docName, newDocPath, DOC_ACCEPT, DOC_MAX_BYTES } from '../lib/bill-doc';

export default function BillDocViewer(props) {
  var bill = props.bill || {};
  var path = bill.attachment_path || '';
  var kind = docKind(path);
  var s1 = useState(''); var url = s1[0]; var setUrl = s1[1];
  var s2 = useState(''); var err = s2[0]; var setErr = s2[1];
  var s3 = useState(false); var busy = s3[0]; var setBusy = s3[1];
  var fileRef = useRef(null);

  useEffect(function () {
    var live = true;
    setUrl(''); setErr('');
    if (!path) { return function () { live = false; }; }
    supabase.storage.from(docBucket(path)).createSignedUrl(path, 3600).then(function (r) {
      if (!live) { return; }
      var u = r && r.data && r.data.signedUrl;
      if (u) { setUrl(u); } else { setErr('The bill file could not be opened. It may have been removed from storage.'); }
    }).catch(function () { if (live) { setErr('The bill file could not be opened. Check your connection and try again.'); } });
    return function () { live = false; };
  }, [path]);

  function attach(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) { return; }
    if (f.size > DOC_MAX_BYTES) { setErr('That file is larger than 15 MB. Attach a smaller PDF or photo.'); e.target.value = ''; return; }
    setBusy(true); setErr('');
    var p = newDocPath(f.name);
    supabase.storage.from('bills-private').upload(p, f, { upsert: false }).then(function (r) {
      if (r && r.error) { throw new Error('upload'); }
      return props.api({ action: 'attach_bill_file', bill_id: bill.id, attachment_path: p });
    }).then(function (j) {
      setBusy(false);
      if (j && j.ok) { if (props.toast) { props.toast.success('Bill file attached.'); } if (props.onChanged) { props.onChanged(); } }
      else { setErr((j && j.error) || 'The file was not attached.'); }
    }).catch(function () { setBusy(false); setErr('The file did not upload. Try again.'); });
  }

  var box = { background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1' };
  return <div className="rounded-xl p-3" style={box}>
    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
      <div className="text-[12px] font-extrabold" style={{ color: '#0f172a' }}>📄 The bill{path ? ' · ' + docName(path) : ''}</div>
      {url && <a href={url} target="_blank" rel="noopener noreferrer" className="px-3 py-1 rounded-lg text-[11px] font-extrabold"
        style={{ background: '#1e293b', color: '#ffffff' }}>Open full size ↗</a>}
    </div>
    {!path && <div>
      <div className="text-[12px] mb-2" style={{ color: '#334155' }}>No file is attached to this bill. It was typed in by hand, or its file did not save when it was imported.</div>
      {props.canManage && <div>
        <input ref={fileRef} type="file" accept={DOC_ACCEPT} onChange={attach} className="nt-light" style={{ display: 'none' }} />
        <button onClick={function () { if (fileRef.current) { fileRef.current.click(); } }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold"
          style={{ background: '#047857', color: '#ffffff' }}>{busy ? 'Attaching…' : '＋ Attach the bill (PDF or photo)'}</button>
      </div>}
    </div>}
    {path && !url && !err && <div className="text-[12px]" style={{ color: '#334155' }}>Opening the bill…</div>}
    {url && kind === 'pdf' && <iframe title="Bill document" src={url} style={{ width: '100%', height: '70vh', minHeight: 420, border: '1px solid #e2e8f0', borderRadius: 8, background: '#ffffff' }} />}
    {url && kind === 'image' && <a href={url} target="_blank" rel="noopener noreferrer"><img alt="Bill document" src={url} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e2e8f0' }} /></a>}
    {url && kind === 'other' && <div className="text-[12px]" style={{ color: '#334155' }}>This file type cannot be shown here. Use “Open full size”.</div>}
    {url && kind === 'pdf' && <div className="text-[10px] mt-1" style={{ color: '#475569' }}>On a phone, a PDF may show only its first page here. “Open full size” shows all of it.</div>}
    {err && <div className="mt-2 rounded-lg px-3 py-2 text-[12px] font-extrabold" style={{ background: '#ffffff', color: '#b91c1c', border: '1px solid #fca5a5' }}>{'⛔ ' + err}</div>}
  </div>;
}

// A button that shows / hides the bill inside another panel (used in the validation checks).
export function BillDocToggle(props) {
  var s = useState(false); var open = s[0]; var setOpen = s[1];
  var has = !!(props.bill && props.bill.attachment_path);
  return <div className="mb-2">
    <button onClick={function () { setOpen(!open); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold"
      style={{ background: '#1e293b', color: '#ffffff' }}>{open ? 'Hide the bill' : (has ? '📄 View the bill' : '📄 View the bill (no file attached)')}</button>
    {open && <div className="mt-2"><BillDocViewer bill={props.bill} api={props.api} toast={props.toast} canManage={props.canManage} onChanged={props.onChanged} /></div>}
  </div>;
}
