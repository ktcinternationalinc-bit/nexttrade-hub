'use client';
// v55.83-SO — CHECK FOR DUPLICATES (Max, Nov 15 2026):
//   "Add a clearly labeled 'Check for duplicates' button."
//   "Let me review matches side by side and choose the transaction to retain."
//   "Preserve the original record and an audit trail, with an option to restore it."
// Nothing is removed until a person presses a button that says what it will remove.
// White panels, explicit dark text (readable in the dark skin). No browser pop-ups.
import React, { useState } from 'react';
import { hubFetch } from '../lib/hub-fetch'; // v55.83-WQ — every accounting call carries the signed-in person's token

function money(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
var KIND_STYLE = {
  same_line: { background: '#fee2e2', color: '#7f1d1d', border: '1px solid #fca5a5' },
  likely: { background: '#ffedd5', color: '#7c2d12', border: '1px solid #fdba74' },
  possible: { background: '#fef9c3', color: '#713f12', border: '1px solid #fde047' },
};
var PANEL = { background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1' };
var BTN_DARK = { background: '#1e293b', color: '#ffffff' };
var BTN_LIGHT = { background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1' };

// Pairs a batch may remove: "same bank line" groups of exactly two where the suggested one is kept
// and the other carries no accounting work. Anything else is left for a person to decide.
export function batchPairs(groups) {
  var out = [];
  (groups || []).forEach(function (g) {
    if (!g || g.kind !== 'same_line' || !g.rows || g.rows.length !== 2) { return; }
    var keep = null, drop = null;
    g.rows.forEach(function (r) { if (r.id === g.suggest_keep_id) { keep = r; } else { drop = r; } });
    if (!keep || !drop || drop.protected) { return; }
    out.push({ keep_id: keep.id, dup_id: drop.id, amount: g.amount });
  });
  return out;
}

export default function DuplicateCheckPanel(props) {
  var toast = props.toast || { success: function () {}, error: function () {} };
  var userId = props.userProfile && props.userProfile.id;
  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(''); var err = s3[0]; var setErr = s3[1];
  var s4 = useState({}); var keep = s4[0]; var setKeep = s4[1];       // group index → id to keep
  var s5 = useState({}); var rowErr = s5[0]; var setRowErr = s5[1];   // group index → message
  var s6 = useState(null); var removed = s6[0]; var setRemoved = s6[1];
  var s7 = useState(false); var askBatch = s7[0]; var setAskBatch = s7[1];
  var s8 = useState(false); var askParked = s8[0]; var setAskParked = s8[1];

  function api(payload) {
    return hubFetch('/api/accounting/duplicates', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userId }, payload)) }).then(function (r) { return r.json(); });
  }
  function scan() {
    setBusy(true); setErr(''); setRowErr({}); setAskBatch(false); setAskParked(false);
    api({ action: 'scan', created_since: props.createdSince || null }).then(function (j) {
      setBusy(false);
      if (j && j.ok) { setData(j); setKeep({}); loadRemoved(); }
      else { setErr((j && j.error) || 'The check did not run.'); }
    }).catch(function () { setBusy(false); setErr('The check did not run. Check your connection and try again.'); });
  }
  function loadRemoved() {
    api({ action: 'removed_list' }).then(function (j) { if (j && j.ok) { setRemoved(j); } else { setRemoved(null); } }).catch(function () {});
  }
  function changed() { if (props.onChanged) { props.onChanged(); } }
  function keepOf(g, gi) { return keep[gi] || g.suggest_keep_id; }

  function removeOthers(g, gi) {
    var k = keepOf(g, gi);
    var others = g.rows.filter(function (r) { return r.id !== k; });
    var blocked = others.filter(function (r) { return r.protected; });
    if (blocked.length) {
      var m = {}; m[gi] = 'The other copy cannot be removed (' + (blocked[0].protected_why || 'it is in use') + '). Keep that one instead, or undo that work first.';
      setRowErr(Object.assign({}, rowErr, m)); return;
    }
    setBusy(true);
    api({ action: 'remove_many', pairs: others.map(function (r) { return { dup_id: r.id, keep_id: k }; }), reason: g.label }).then(function (j) {
      setBusy(false);
      if (j && j.removed > 0) { toast.success(j.removed + ' duplicate' + (j.removed === 1 ? '' : 's') + ' removed from the books. You can restore ' + (j.removed === 1 ? 'it' : 'them') + ' below.'); changed(); }
      if (j && j.failed && j.failed.length) { var m2 = {}; m2[gi] = j.failed[0].why; setRowErr(Object.assign({}, rowErr, m2)); if (!(j.removed > 0)) { return; } }
      scan();
    }).catch(function () { setBusy(false); var m3 = {}; m3[gi] = 'Not removed. Try again.'; setRowErr(Object.assign({}, rowErr, m3)); });
  }
  function notDuplicates(g, gi) {
    setBusy(true);
    api({ action: 'dismiss', ids: g.rows.map(function (r) { return r.id; }) }).then(function (j) {
      setBusy(false);
      if (j && j.ok) { toast.success('Left as they are. They will not be suggested again.'); scan(); }
      else { var m = {}; m[gi] = (j && j.error) || 'Not saved.'; setRowErr(Object.assign({}, rowErr, m)); }
    }).catch(function () { setBusy(false); });
  }
  function runBatch() {
    var pairs = batchPairs(data && data.groups);
    setBusy(true); setAskBatch(false);
    api({ action: 'remove_many', pairs: pairs.slice(0, 200).map(function (p) { return { dup_id: p.dup_id, keep_id: p.keep_id }; }), reason: 'Same bank line, brought in twice' }).then(function (j) {
      setBusy(false);
      if (j && j.removed > 0) { toast.success(j.removed + ' extra copies removed from the books.'); changed(); }
      if (j && j.failed && j.failed.length) { setErr(j.failed.length + ' could not be removed. First reason: ' + j.failed[0].why); }
      scan();
    }).catch(function () { setBusy(false); setErr('The batch did not finish. Run the check again to see what is left.'); });
  }
  function removeParked() {
    var list = (data && data.parked) || [];
    setBusy(true); setAskParked(false);
    api({ action: 'remove_many', pairs: list.slice(0, 200).map(function (p) { return { dup_id: p.id, keep_id: null }; }), reason: 'Marked duplicate earlier in Bank Review' }).then(function (j) {
      setBusy(false);
      if (j && j.removed > 0) { toast.success(j.removed + ' removed from the books.'); changed(); }
      if (j && j.failed && j.failed.length) { setErr(j.failed.length + ' could not be removed. First reason: ' + j.failed[0].why); }
      scan();
    }).catch(function () { setBusy(false); });
  }
  function restore(x) {
    setBusy(true);
    api({ action: 'restore', id: x.id }).then(function (j) {
      setBusy(false);
      if (j && j.ok) { toast.success('Restored. It is back in the books exactly as it was.'); changed(); scan(); }
      else { setErr((j && j.error) || 'Not restored.'); }
    }).catch(function () { setBusy(false); setErr('Not restored. Try again.'); });
  }

  var groups = (data && data.groups) || [];
  var batch = batchPairs(groups);
  var batchTotal = 0; batch.forEach(function (p) { batchTotal += Number(p.amount) || 0; });

  return <div className="rounded-xl p-3 mb-3" style={PANEL}>
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={scan} className="px-4 py-2 rounded-lg text-[13px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>{busy ? 'Checking…' : '🔍 Check for duplicates'}</button>
      <div className="text-[11px]" style={{ color: '#334155' }}>Looks for the same bank line recorded twice. Nothing is removed until you say so, and anything removed can be restored.</div>
    </div>
    {err && <div className="mt-2 rounded-lg px-3 py-2 text-[12px] font-extrabold" style={{ background: '#ffffff', color: '#b91c1c', border: '1px solid #fca5a5' }}>{'⛔ ' + err}</div>}

    {data && <div className="mt-3">
      <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: '#f1f5f9', color: '#0f172a' }}>
        <b>{(data.stats.scanned || 0).toLocaleString('en-US')}</b> settled bank lines checked{props.createdSince ? ' (showing only groups that include a newly imported line)' : ''}.{' '}
        <b>{data.group_count}</b> {data.group_count === 1 ? 'group looks' : 'groups look'} like a duplicate.
        <div className="text-[11px] mt-1" style={{ color: '#334155' }}>
          Left alone on purpose: <b>{data.stats.recurring}</b> repeating payments (same payee and amount, 5 or more days apart) and <b>{data.stats.transfer_sides}</b> transfer pairs (same amount out of one account and into another).
          {data.truncated ? ' Only the newest 20,000 lines were checked.' : ''}
        </div>
      </div>
      {data.installed === false && <div className="mt-2 rounded-lg px-3 py-2 text-[12px] font-bold" style={{ background: '#fef3c7', color: '#78350f', border: '1px solid #fcd34d' }}>
        You can review the groups now, but removing and restoring needs the v55.83-SO database step to be run in Supabase first.
      </div>}

      {batch.length > 0 && <div className="mt-2 rounded-lg px-3 py-2" style={{ background: '#fee2e2', color: '#7f1d1d', border: '1px solid #fca5a5' }}>
        <div className="text-[12px] font-extrabold">{batch.length} {batch.length === 1 ? 'pair is' : 'pairs are'} the same bank line brought in through two connections of one account (${money(batchTotal)} counted twice).</div>
        {!askBatch && <button onClick={function () { setAskBatch(true); }} className="mt-1 px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#b91c1c', color: '#ffffff' }}>Remove the extra copy in all {batch.length}…</button>}
        {askBatch && <div className="mt-1">
          <div className="text-[12px]">This keeps the suggested copy in each pair (the one with work on it, or the one the Hub has had longest) and removes the other {Math.min(batch.length, 200)} from the books. Each one can be restored.</div>
          <div className="flex gap-2 mt-1">
            <button onClick={runBatch} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#b91c1c', color: '#ffffff' }}>{busy ? 'Working…' : 'Yes, remove ' + Math.min(batch.length, 200)}</button>
            <button onClick={function () { setAskBatch(false); }} className="px-3 py-1.5 rounded-lg text-[12px] font-bold" style={BTN_LIGHT}>Keep them all for now</button>
          </div>
        </div>}
      </div>}

      {groups.length === 0 && <div className="mt-2 text-[12px] font-bold" style={{ color: '#047857' }}>✓ No duplicates found.</div>}

      {groups.map(function (g, gi) {
        var k = keepOf(g, gi);
        return <div key={gi} className="mt-3 rounded-xl p-3" style={{ background: '#f8fafc', color: '#0f172a', border: '1px solid #cbd5e1' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded text-[11px] font-extrabold" style={KIND_STYLE[g.kind]}>{g.label}</span>
            <span className="text-[13px] font-extrabold tabular-nums" style={{ color: '#0f172a' }}>${money(g.amount)} {g.direction === 'in' ? 'in' : 'out'}{g.currency && g.currency !== 'USD' ? ' ' + g.currency : ''}</span>
          </div>
          {g.why.map(function (w, wi) { return <div key={wi} className="text-[11px] mt-1" style={{ color: '#334155' }}>{w}</div>; })}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
            {g.rows.map(function (r) {
              var isKeep = r.id === k;
              return <div key={r.id} className="rounded-lg p-2" style={{ background: '#ffffff', color: '#0f172a', border: isKeep ? '2px solid #047857' : '1px solid #cbd5e1' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-extrabold">{r.date}</span>
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded" style={isKeep ? { background: '#d1fae5', color: '#064e3b' } : { background: '#fee2e2', color: '#7f1d1d' }}>{isKeep ? 'KEEP' : 'REMOVE'}</span>
                </div>
                <div className="text-[12px] font-bold mt-1" style={{ color: '#0f172a' }}>{r.description || '(no description)'}</div>
                <div className="text-[11px] mt-1" style={{ color: '#334155' }}>
                  <div><b>Account:</b> {r.account}{r.bank ? ' · ' + r.bank : ''}{r.link_archived ? ' · old connection' : ''}</div>
                  <div><b>Came from:</b> {r.source}{r.source_id ? ' · id …' + r.source_id : ''}{r.check_number ? ' · cheque ' + r.check_number : ''}</div>
                  <div><b>Status:</b> {r.review_status}{r.category ? ' · ' + r.category : ' · no category'}{r.verified ? ' · verified' : ''}{r.matched_invoice ? ' · matched to an invoice' : ''}{r.transfer ? ' · part of a transfer' : ''}</div>
                  {r.protected && <div className="font-bold" style={{ color: '#7c2d12' }}>Can only be kept: {r.protected_why}.</div>}
                </div>
                {!isKeep && <button onClick={function () { var m = {}; m[gi] = r.id; setKeep(Object.assign({}, keep, m)); var e2 = Object.assign({}, rowErr); delete e2[gi]; setRowErr(e2); }}
                  className="mt-2 px-3 py-1 rounded-lg text-[11px] font-extrabold" style={BTN_LIGHT}>Keep this one instead</button>}
              </div>;
            })}
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <button onClick={function () { removeOthers(g, gi); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#b91c1c', color: '#ffffff' }}>
              {busy ? 'Working…' : 'Remove the ' + (g.rows.length === 2 ? 'other one' : 'other ' + (g.rows.length - 1)) + ' and keep the one marked KEEP'}</button>
            <button onClick={function () { notDuplicates(g, gi); }} className="px-3 py-1.5 rounded-lg text-[12px] font-bold" style={BTN_LIGHT}>Not duplicates — leave {g.rows.length === 2 ? 'both' : 'all'}</button>
          </div>
          {rowErr[gi] && <div className="mt-2 rounded-lg px-3 py-2 text-[12px] font-extrabold" style={{ background: '#ffffff', color: '#b91c1c', border: '1px solid #fca5a5' }}>{'⛔ ' + rowErr[gi]}</div>}
        </div>;
      })}

      {data.parked_count > 0 && <div className="mt-3 rounded-xl p-3" style={{ background: '#fff7ed', color: '#7c2d12', border: '1px solid #fdba74' }}>
        <div className="text-[12px] font-extrabold">{data.parked_count} bank {data.parked_count === 1 ? 'line was' : 'lines were'} marked “duplicate” earlier in Bank Review and {data.parked_count === 1 ? 'is' : 'are'} still stored with the live transactions.</div>
        <div className="text-[11px] mt-1">Most reports already skip them, but not every screen does. Removing them here takes them out of everything, and each can be restored.</div>
        {!askParked && <button onClick={function () { setAskParked(true); }} className="mt-1 px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#9a3412', color: '#ffffff' }}>Remove these {Math.min(data.parked_count, 200)} from the books…</button>}
        {askParked && <div className="flex gap-2 mt-1">
          <button onClick={removeParked} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#9a3412', color: '#ffffff' }}>{busy ? 'Working…' : 'Yes, remove ' + Math.min(data.parked_count, 200)}</button>
          <button onClick={function () { setAskParked(false); }} className="px-3 py-1.5 rounded-lg text-[12px] font-bold" style={BTN_LIGHT}>Leave them</button>
        </div>}
      </div>}

      {removed && (removed.removed.length > 0 || removed.restored.length > 0) && <div className="mt-3 rounded-xl p-3" style={PANEL}>
        <div className="text-[12px] font-extrabold" style={{ color: '#0f172a' }}>Removed duplicates ({removed.removed.length}) — out of every total and report, kept on file</div>
        {removed.removed.length === 0 && <div className="text-[11px]" style={{ color: '#334155' }}>None right now.</div>}
        {removed.removed.map(function (x) {
          return <div key={x.seq} className="flex items-center gap-2 py-1.5 flex-wrap" style={{ borderTop: '1px solid #e2e8f0' }}>
            <div className="text-[11px] flex-1" style={{ color: '#0f172a', minWidth: 200 }}>
              <b>{x.date}</b> · ${money(x.amount)} {x.direction === 'in' ? 'in' : 'out'} · {x.account} · {x.description || '(no description)'}
              <div style={{ color: '#475569' }}>Removed {String(x.removed_at || '').substring(0, 10)}{x.removed_by ? ' by ' + x.removed_by : ''}{x.reason ? ' — ' + x.reason : ''}</div>
            </div>
            <button onClick={function () { restore(x); }} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={BTN_DARK}>↩ Restore</button>
          </div>;
        })}
        {removed.restored.length > 0 && <div className="text-[11px] mt-2" style={{ color: '#475569' }}>
          Put back earlier: {removed.restored.slice(0, 20).map(function (x) { return x.date + ' $' + money(x.amount) + (x.restored_by ? ' (by ' + x.restored_by + ')' : ''); }).join(' · ')}
        </div>}
      </div>}
    </div>}
  </div>;
}
