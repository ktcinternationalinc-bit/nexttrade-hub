'use client';
// ============================================================
// AdminHRInbox — v55.65 NEW
//
// Inbox for HR requests + complaints. Visibility rules:
//   - super_admin sees EVERYTHING (requests + all complaints, including
//     submitter identity even on anonymous-to-admins items)
//   - regular admin sees:
//       * Requests with visibility='admin'
//       * Complaints flagged anonymous_to_admins=false (rare)
//       * For anonymous complaints → only that they exist, count only
//
// Mounts on the Admin tab. Allows reviewer to:
//   - Change status (under_review → approved/denied/etc.)
//   - Add decision_notes / resolution_notes (visible to submitter)
//   - Filter by status, category, severity
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { supabase, dbUpdate } from '../lib/supabase';
import { fmtET } from '../lib/et-time';

var REQ_STATUSES = ['submitted', 'under_review', 'more_info_needed', 'approved', 'denied', 'completed', 'withdrawn'];
var CMP_STATUSES = ['submitted', 'investigating', 'resolved', 'dismissed', 'escalated', 'withdrawn'];

var STATUS_COLORS = {
  submitted:        { bg: 'bg-blue-100',     text: 'text-blue-700',    label: 'New' },
  under_review:     { bg: 'bg-amber-100',    text: 'text-amber-700',   label: 'Reviewing' },
  approved:         { bg: 'bg-emerald-100',  text: 'text-emerald-700', label: 'Approved' },
  denied:           { bg: 'bg-rose-100',     text: 'text-rose-700',    label: 'Denied' },
  more_info_needed: { bg: 'bg-purple-100',   text: 'text-purple-700',  label: 'Info needed' },
  withdrawn:        { bg: 'bg-slate-100',    text: 'text-slate-600',   label: 'Withdrawn' },
  completed:        { bg: 'bg-emerald-100',  text: 'text-emerald-700', label: 'Done' },
  investigating:    { bg: 'bg-amber-100',    text: 'text-amber-700',   label: 'Investigating' },
  resolved:         { bg: 'bg-emerald-100',  text: 'text-emerald-700', label: 'Resolved' },
  dismissed:        { bg: 'bg-slate-100',    text: 'text-slate-600',   label: 'Dismissed' },
  escalated:        { bg: 'bg-rose-100',     text: 'text-rose-700',    label: 'Escalated' },
};

var SEVERITY_COLORS = {
  low:      'bg-slate-100 text-slate-600',
  medium:   'bg-amber-100 text-amber-700',
  high:     'bg-orange-100 text-orange-700',
  critical: 'bg-rose-100 text-rose-700 ring-2 ring-rose-300',
};

export default function AdminHRInbox({ user, userProfile, isSuperAdmin, users }) {
  var myId = (userProfile && userProfile.id) || (user && user.id);
  var [tab, setTab] = useState('requests');
  var [requests, setRequests] = useState([]);
  var [complaints, setComplaints] = useState([]);
  var [loading, setLoading] = useState(true);
  var [tableMissing, setTableMissing] = useState(false);
  var [filterStatus, setFilterStatus] = useState('open'); // 'open' | 'all' | <specific>
  var [reviewing, setReviewing] = useState(null); // { kind, item, newStatus, notes }
  var [busyId, setBusyId] = useState(null);

  var getUserName = function (uid) {
    var u = (users || []).find(function (x) { return x.id === uid; });
    return u ? (u.name || u.email) : '(unknown user)';
  };

  var load = useCallback(async function () {
    setLoading(true);
    setTableMissing(false);
    try {
      var reqQ = supabase.from('hr_requests').select('*').order('submitted_at', { ascending: false });
      var cmpQ = supabase.from('hr_complaints').select('*').order('submitted_at', { ascending: false });
      var reqRes = await reqQ;
      var cmpRes = await cmpQ;
      if (reqRes.error || cmpRes.error) {
        var err = (reqRes.error || cmpRes.error || {}).message || '';
        if (/does not exist/i.test(err)) { setTableMissing(true); }
        else { console.warn('[AdminHRInbox] load error:', err); }
      }
      setRequests(reqRes.data || []);
      setComplaints(cmpRes.data || []);
    } catch (e) {
      if (/does not exist/i.test((e && e.message) || '')) setTableMissing(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(function () { load(); }, [load]);

  var openItem = function (kind, item) {
    setReviewing({
      kind: kind,
      item: item,
      newStatus: item.status,
      notes: kind === 'request' ? (item.decision_notes || '') : (item.resolution_notes || ''),
    });
  };

  var saveReview = async function () {
    if (!reviewing) return;
    var item = reviewing.item;
    setBusyId(item.id);
    try {
      var nowIso = new Date().toISOString();
      if (reviewing.kind === 'request') {
        await dbUpdate('hr_requests', item.id, {
          status: reviewing.newStatus,
          decision_notes: reviewing.notes || null,
          reviewed_by: myId,
          reviewed_at: nowIso,
          updated_at: nowIso,
          updated_by: myId,
        }, myId);
      } else {
        await dbUpdate('hr_complaints', item.id, {
          status: reviewing.newStatus,
          resolution_notes: reviewing.notes || null,
          reviewed_by: myId,
          reviewed_at: nowIso,
          updated_at: nowIso,
        }, myId);
      }
      setReviewing(null);
      await load();
    } catch (e) {
      alert('Could not save: ' + ((e && e.message) || 'unknown'));
    } finally {
      setBusyId(null);
    }
  };

  // Visibility filter for the LIST
  var visibleRequests = requests.filter(function (r) {
    if (!isSuperAdmin && r.visibility === 'super_admin_only') return false;
    return true;
  });
  // Complaints: regular admin sees only non-anonymous ones (and even then, super_admin first)
  var visibleComplaints = complaints.filter(function (c) {
    if (isSuperAdmin) return true;
    return c.anonymous_to_admins === false;
  });
  var hiddenComplaintsCount = complaints.length - visibleComplaints.length;

  var statusFilter = function (s) {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'open') {
      return ['submitted','under_review','more_info_needed','investigating','escalated'].indexOf(s) >= 0;
    }
    return s === filterStatus;
  };

  var listRequests = visibleRequests.filter(function (r) { return statusFilter(r.status); });
  var listComplaints = visibleComplaints.filter(function (c) { return statusFilter(c.status); });

  var pendingReqCount = visibleRequests.filter(function (r) { return ['submitted','under_review','more_info_needed'].indexOf(r.status) >= 0; }).length;
  var pendingCmpCount = visibleComplaints.filter(function (c) { return ['submitted','investigating','escalated'].indexOf(c.status) >= 0; }).length;

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            <span className="text-2xl">📬</span>
            HR Inbox
            {pendingReqCount + pendingCmpCount > 0 && (
              <span className="px-2 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold rounded-full animate-pulse">
                {pendingReqCount + pendingCmpCount} pending
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-500">
            {isSuperAdmin
              ? 'You see everything. Submitter identities are visible to you on all items.'
              : 'You see admin-visible requests and non-confidential concerns. ' + (hiddenComplaintsCount > 0 ? hiddenComplaintsCount + ' confidential concern(s) are visible only to Mr. Kandil.' : '')}
          </p>
        </div>
        <button onClick={load} className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold hover:bg-slate-50">↻ Refresh</button>
      </div>

      {tableMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 mb-3">
          <strong>Setup needed:</strong> The HR Desk tables haven't been created yet. Run <code className="bg-white px-1 rounded">sql/s41_hr_desk_requests_complaints.sql</code> in Supabase SQL Editor.
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-3">
        <button
          onClick={function () { setTab('requests'); }}
          className={'px-4 py-2 text-xs font-bold border-b-2 transition ' + (tab === 'requests' ? 'border-amber-500 text-amber-700 bg-amber-50' : 'border-transparent text-slate-500 hover:text-slate-700')}>
          📝 Requests ({visibleRequests.length}{pendingReqCount > 0 ? ' · ' + pendingReqCount + ' pending' : ''})
        </button>
        <button
          onClick={function () { setTab('complaints'); }}
          className={'px-4 py-2 text-xs font-bold border-b-2 transition ' + (tab === 'complaints' ? 'border-rose-500 text-rose-700 bg-rose-50' : 'border-transparent text-slate-500 hover:text-slate-700')}>
          🛡️ Concerns ({visibleComplaints.length}{pendingCmpCount > 0 ? ' · ' + pendingCmpCount + ' pending' : ''})
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {['open','all'].concat(tab === 'requests' ? REQ_STATUSES : CMP_STATUSES).map(function (s) {
          return (
            <button
              key={s}
              onClick={function () { setFilterStatus(s); }}
              className={'px-2.5 py-1 rounded text-[10px] font-bold border ' + (filterStatus === s ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
              {s === 'open' ? '📥 Open' : s === 'all' ? '🗂 All' : (STATUS_COLORS[s] || {}).label || s}
            </button>
          );
        })}
      </div>

      {loading && <div className="text-center text-slate-400 py-6 text-sm">Loading…</div>}

      {/* REQUESTS LIST */}
      {!loading && tab === 'requests' && (
        listRequests.length === 0
          ? <div className="text-center text-slate-400 py-8 text-sm">No requests match this filter.</div>
          : (
            <div className="space-y-2">
              {listRequests.map(function (r) {
                var sc = STATUS_COLORS[r.status] || STATUS_COLORS.submitted;
                return (
                  <div key={r.id} onClick={function () { openItem('request', r); }} className="rounded-lg border border-slate-200 hover:border-amber-300 hover:shadow-sm transition cursor-pointer p-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-[10px] font-mono text-slate-500">{r.request_number}</span>
                          {r.priority === 'urgent' && <span className="text-[9px] font-bold bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">🚨 URGENT</span>}
                          {r.priority === 'high' && <span className="text-[9px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">HIGH</span>}
                          {r.visibility === 'super_admin_only' && <span className="text-[9px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">🔒 super_admin only</span>}
                          {/* v55.69 — show "Manager-handled" badge for routine
                              operational requests so the reviewer sees at a
                              glance which queue this is in. */}
                          {r.visibility === 'admin' && <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">👤 Manager-handled</span>}
                        </div>
                        <div className="text-sm font-bold text-slate-800">{r.title}</div>
                        <div className="text-[11px] text-slate-500">
                          {getUserName(r.submitted_by)} · {r.category} · {r.submitted_at ? fmtET(r.submitted_at, 'shortdate') : ''}
                          {r.starts_on && <span> · {r.starts_on}{r.ends_on && r.ends_on !== r.starts_on ? ' → ' + r.ends_on : ''}</span>}
                        </div>
                      </div>
                      <span className={'px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap ' + sc.bg + ' ' + sc.text}>{sc.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
      )}

      {/* COMPLAINTS LIST */}
      {!loading && tab === 'complaints' && (
        listComplaints.length === 0
          ? <div className="text-center text-slate-400 py-8 text-sm">No complaints match this filter.</div>
          : (
            <div className="space-y-2">
              {listComplaints.map(function (c) {
                var sc = STATUS_COLORS[c.status] || STATUS_COLORS.submitted;
                var sevC = SEVERITY_COLORS[c.severity] || SEVERITY_COLORS.medium;
                var displayName = c.anonymous_to_admins && !isSuperAdmin
                  ? '(identity confidential)'
                  : getUserName(c.submitted_by) + (c.anonymous_to_admins ? ' (identity confidential to other team leads)' : '');
                return (
                  <div key={c.id} onClick={function () { openItem('complaint', c); }} className="rounded-lg border border-rose-200 hover:border-rose-400 hover:shadow-sm transition cursor-pointer p-3 bg-rose-50/30">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-[10px] font-mono text-slate-500">{c.complaint_number}</span>
                          <span className={'text-[9px] font-bold px-1.5 py-0.5 rounded ' + sevC}>{(c.severity || 'medium').toUpperCase()}</span>
                          {c.anonymous_to_admins && <span className="text-[9px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">🕶️ Confidential</span>}
                        </div>
                        <div className="text-sm font-bold text-slate-800">{c.title}</div>
                        <div className="text-[11px] text-slate-500">
                          {displayName} · {c.category} · {c.submitted_at ? fmtET(c.submitted_at, 'shortdate') : ''}
                        </div>
                      </div>
                      <span className={'px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap ' + sc.bg + ' ' + sc.text}>{sc.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
      )}

      {/* REVIEW MODAL */}
      {reviewing && (
        <div className="fixed inset-0 bg-black/60 z-[280] flex items-center justify-center p-4" onClick={function () { setReviewing(null); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '90vh' }} onClick={function (e) { e.stopPropagation(); }}>
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                {reviewing.kind === 'request' ? '📝' : '🛡️'} {reviewing.item.title}
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {reviewing.kind === 'request' ? reviewing.item.request_number : reviewing.item.complaint_number} ·
                Submitted by {reviewing.kind === 'complaint' && reviewing.item.anonymous_to_admins && !isSuperAdmin ? '(identity confidential)' : getUserName(reviewing.item.submitted_by)} ·
                {reviewing.item.submitted_at ? ' ' + fmtET(reviewing.item.submitted_at, 'datetime') : ''}
              </p>
            </div>
            <div className="overflow-auto p-5 space-y-3" style={{ flex: '1 1 auto' }}>
              {reviewing.item.description && (
                <div className="bg-slate-50 border border-slate-200 rounded p-3 text-sm whitespace-pre-wrap">{reviewing.item.description}</div>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="font-bold">Category:</span> {reviewing.item.category}</div>
                {reviewing.kind === 'request' && reviewing.item.priority && <div><span className="font-bold">Priority:</span> {reviewing.item.priority}</div>}
                {reviewing.kind === 'complaint' && reviewing.item.severity && <div><span className="font-bold">Severity:</span> {reviewing.item.severity}</div>}
                {reviewing.kind === 'request' && reviewing.item.starts_on && <div><span className="font-bold">From:</span> {reviewing.item.starts_on}</div>}
                {reviewing.kind === 'request' && reviewing.item.ends_on && <div><span className="font-bold">To:</span> {reviewing.item.ends_on}</div>}
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-700 block mb-1">Update status</label>
                <select value={reviewing.newStatus} onChange={function (e) { setReviewing(Object.assign({}, reviewing, { newStatus: e.target.value })); }} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
                  {(reviewing.kind === 'request' ? REQ_STATUSES : CMP_STATUSES).map(function (s) {
                    return <option key={s} value={s}>{(STATUS_COLORS[s] || {}).label || s}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-700 block mb-1">{reviewing.kind === 'request' ? 'Decision notes' : 'Resolution notes'} (visible to submitter)</label>
                <textarea value={reviewing.notes} onChange={function (e) { setReviewing(Object.assign({}, reviewing, { notes: e.target.value })); }} rows={4} placeholder="Approval reason, conditions, follow-up steps, etc." className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
              </div>
            </div>
            <div className="p-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={function () { setReviewing(null); }} className="px-3 py-2 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
              <button onClick={saveReview} disabled={busyId === reviewing.item.id} className="px-5 py-2 bg-violet-600 text-white rounded text-sm font-bold hover:bg-violet-700 disabled:opacity-50">
                {busyId === reviewing.item.id ? 'Saving…' : 'Save & notify submitter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
