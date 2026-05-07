'use client';
// ============================================================
// MyHRDesk — v55.65 NEW
//
// Prominent HR card on the personal dashboard. Three jobs:
//
//   1. Be VISIBLE and ENGAGING — this is meant to grab focus the way
//      the AI Performance Coach does. Animated mascot (Maya the HR
//      assistant) waves on hover. Gradient-bordered card with a clear
//      logo lockup.
//
//   2. Quick-file an HR REQUEST (vacation, equipment, schedule, raise,
//      training, expense, etc.) — routine workflow that admins handle.
//
//   3. Quick-file an HR COMPLAINT (interpersonal, manager issue,
//      harassment, safety, workload, pay) — sensitive, goes straight
//      to super_admin and is hidden from regular admins by default.
//
// Both submit to NEW Supabase tables created in
// sql/s41_hr_desk_requests_complaints.sql:
//   - hr_requests (auto-numbered HR-2026-0001)
//   - hr_complaints (auto-numbered HRC-2026-0001)
//
// Also shows the user's last 3 submissions with current status so they
// can see at a glance "did super_admin look at my vacation request yet?".
// ============================================================
import { useState, useEffect } from 'react';
import { supabase, dbInsert } from '../lib/supabase';
import { AGENT_PERSONALITIES } from '../lib/agent-personalities';

// v55.69 — Each category now has a `routing` field that determines where
// the request lands automatically:
//   'manager'      = your line manager / admins can see + super_admin
//   'super_admin'  = super_admin ONLY (HR-sensitive; admins can't see)
//
// Per Max May 7 2026: only routine operational stuff like vacation, sick
// leave, schedule changes, and recognition go to managers/admins. Anything
// HR-sensitive (raises, promotions, complaints, transfers, training that
// touches development plans, etc.) goes straight to super_admin and stays
// hidden from regular admins.
//
// `icon` field is the emoji we render in the topic-tile picker.
var REQUEST_CATEGORIES = [
  // — Operational stuff your manager handles —
  { id: 'vacation',         icon: '🏖️',  label: 'Vacation / Time off',         hint: 'Vacation days, personal time off, leave of absence', routing: 'manager' },
  { id: 'sick_leave',       icon: '🤒',  label: 'Sick leave',                  hint: 'Medical leave, already taken or upcoming',           routing: 'manager' },
  { id: 'schedule_change',  icon: '🕐',  label: 'Schedule change',             hint: 'Start/end times, days off, work pattern',            routing: 'manager' },
  { id: 'recognition',      icon: '🏆',  label: 'Recognize a teammate',         hint: 'Nominate someone who did great work',                routing: 'manager' },
  // — HR-sensitive, super_admin only —
  { id: 'raise',            icon: '💰',  label: 'Raise / Compensation',        hint: 'Salary review or pay-related ask',                   routing: 'super_admin' },
  { id: 'promotion',        icon: '🚀',  label: 'Promotion',                   hint: 'Title change, role expansion, new responsibilities', routing: 'super_admin' },
  { id: 'training',         icon: '📚',  label: 'Training / Course',           hint: 'A course, certification, or learning opportunity',   routing: 'super_admin' },
  { id: 'expense',          icon: '🧾',  label: 'Expense reimbursement',       hint: 'Travel, supplies, client meal, etc.',                routing: 'super_admin' },
  { id: 'transfer',         icon: '🔄',  label: 'Department transfer',         hint: 'Move to another team or location',                   routing: 'super_admin' },
  { id: 'flexible_hours',   icon: '⏱️',  label: 'Flexible hours',              hint: 'Flex schedule, compressed week, etc.',               routing: 'super_admin' },
  { id: 'remote_work',      icon: '🏠',  label: 'Remote work',                 hint: 'Work-from-home day, hybrid schedule',                routing: 'super_admin' },
  { id: 'equipment',        icon: '💻',  label: 'Equipment / Tools',           hint: 'Laptop, phone, headset, software license, etc.',     routing: 'super_admin' },
  { id: 'other',            icon: '📋',  label: 'Other',                       hint: 'Anything else',                                      routing: 'super_admin' },
];

// Concerns are ALWAYS super_admin only — they're sensitive by definition.
var COMPLAINT_CATEGORIES = [
  { id: 'interpersonal_conflict', icon: '👥', label: 'Conflict with a coworker',   hint: 'Tension, disagreement, communication issue' },
  { id: 'manager_issue',          icon: '👔', label: 'Issue with my manager',      hint: 'Concerns about how a manager is treating you or the team' },
  { id: 'harassment',             icon: '🚫', label: 'Harassment',                 hint: 'Unwelcome behavior of any kind' },
  { id: 'discrimination',         icon: '⚖️', label: 'Discrimination',             hint: 'Unfair treatment based on who you are' },
  { id: 'safety',                 icon: '⚠️', label: 'Safety concern',             hint: 'Workplace safety, equipment, environment' },
  { id: 'workload',               icon: '📈', label: 'Workload / Burnout',         hint: 'Unsustainable hours or pressure' },
  { id: 'pay_concern',            icon: '💵', label: 'Pay or compensation issue',  hint: 'Concern about pay accuracy, equity, or process' },
  { id: 'work_environment',       icon: '🏢', label: 'Work environment',           hint: 'Office, equipment, conditions' },
  { id: 'retaliation',            icon: '🛡️', label: 'Retaliation',                hint: 'Punished for raising a concern' },
  { id: 'process_issue',          icon: '🔧', label: 'Process or policy issue',    hint: 'Something the company should change' },
  { id: 'other',                  icon: '📋', label: 'Other',                      hint: 'Anything else' },
];

// Helper: derive visibility from category (so the user never has to choose
// — picking the topic IS the routing decision).
function visibilityFromCategory(cat) {
  var found = REQUEST_CATEGORIES.find(function (c) { return c.id === cat; });
  if (found && found.routing === 'manager') return 'admin';
  return 'super_admin_only';
}

var STATUS_COLORS = {
  submitted:         { bg: 'bg-blue-100',     text: 'text-blue-700',    label: 'Submitted' },
  under_review:      { bg: 'bg-amber-100',    text: 'text-amber-700',   label: 'Under review' },
  approved:          { bg: 'bg-emerald-100',  text: 'text-emerald-700', label: 'Approved' },
  denied:            { bg: 'bg-rose-100',     text: 'text-rose-700',    label: 'Denied' },
  more_info_needed:  { bg: 'bg-purple-100',   text: 'text-purple-700',  label: 'Needs more info' },
  withdrawn:         { bg: 'bg-slate-100',    text: 'text-slate-600',   label: 'Withdrawn' },
  completed:         { bg: 'bg-emerald-100',  text: 'text-emerald-700', label: 'Completed' },
  investigating:     { bg: 'bg-amber-100',    text: 'text-amber-700',   label: 'Investigating' },
  resolved:          { bg: 'bg-emerald-100',  text: 'text-emerald-700', label: 'Resolved' },
  dismissed:         { bg: 'bg-slate-100',    text: 'text-slate-600',   label: 'Dismissed' },
  escalated:         { bg: 'bg-rose-100',     text: 'text-rose-700',    label: 'Escalated' },
};

export default function MyHRDesk({ user, userProfile, users }) {
  var myId = (userProfile && userProfile.id) || (user && user.id);
  var myFirstName = ((userProfile && userProfile.name) || (user && user.email) || 'there').split(' ')[0].split('@')[0];

  var [openModal, setOpenModal] = useState(null); // null | 'request' | 'complaint'
  var [myRecent, setMyRecent] = useState([]); // recent submissions
  var [loading, setLoading] = useState(false);
  var [submitOk, setSubmitOk] = useState(null); // { kind, number }
  var [tableMissing, setTableMissing] = useState(false);
  // hover state for mascot animation
  var [mascotWaving, setMascotWaving] = useState(false);

  // Form state
  var [form, setForm] = useState({
    category: 'vacation',
    title: '',
    description: '',
    priority: 'normal',
    starts_on: '',
    ends_on: '',
    severity: 'medium',
    anonymous_to_admins: true,
    // v55.69 — visibility is auto-derived from category, not user-picked.
    // Initial value matches default category 'vacation' (manager-routed).
    visibility: visibilityFromCategory('vacation'),
    // v55.73 — explicit recipient choice. User can override the auto-default.
    //   'manager'      = send to my reports_to user (super_admin always CC'd)
    //   'super_admin'  = send to Mr. Kandil only (admins never see)
    // Auto-defaults from category but user can change via radio.
    recipient: 'manager', // initial = manager (matches default category 'vacation')
  });

  // v55.73 — resolve who the manager is for the current user, and who the
  // super_admin is. Used to actually dispatch the notification at submit time.
  var safeUsers = users || [];
  var myProfile = safeUsers.find(function (u) { return u.id === myId; });
  var managerId = (myProfile && myProfile.reports_to) || null;
  var manager = managerId ? safeUsers.find(function (u) { return u.id === managerId; }) : null;
  var managerName = (manager && manager.name) || 'your manager';
  var superAdmin = safeUsers.find(function (u) { return u.role === 'super_admin' && u.active !== false; });
  var superAdminName = (superAdmin && superAdmin.name) || 'Mr. Kandil';
  var superAdminId = (superAdmin && superAdmin.id) || null;

  // Load the user's recent HR items so they can see status at a glance.
  // Independent try/catch so a missing table doesn't break the dashboard.
  var loadRecent = async function () {
    if (!myId) return;
    try {
      var reqRes = await supabase.from('hr_requests')
        .select('id,request_number,title,category,status,submitted_at,decision_notes')
        .eq('submitted_by', myId)
        .order('submitted_at', { ascending: false })
        .limit(5);
      var cmpRes = await supabase.from('hr_complaints')
        .select('id,complaint_number,title,category,status,submitted_at,resolution_notes,severity')
        .eq('submitted_by', myId)
        .order('submitted_at', { ascending: false })
        .limit(5);
      if ((reqRes && reqRes.error && /does not exist/i.test(reqRes.error.message))
          || (cmpRes && cmpRes.error && /does not exist/i.test(cmpRes.error.message))) {
        setTableMissing(true);
        return;
      }
      var combined = [].concat(
        (reqRes.data || []).map(function (r) { return Object.assign({}, r, { kind: 'request', number: r.request_number }); }),
        (cmpRes.data || []).map(function (r) { return Object.assign({}, r, { kind: 'complaint', number: r.complaint_number }); })
      ).sort(function (a, b) { return (b.submitted_at || '').localeCompare(a.submitted_at || ''); }).slice(0, 5);
      setMyRecent(combined);
    } catch (e) {
      // Likely missing-table — show friendly "set me up" hint
      if (/does not exist/i.test((e && e.message) || '')) setTableMissing(true);
    }
  };

  useEffect(function () { loadRecent(); }, [myId]);

  // Periodic mascot wave to draw eyes to the card. Every 12s for 2s.
  useEffect(function () {
    var t = setInterval(function () {
      setMascotWaving(true);
      setTimeout(function () { setMascotWaving(false); }, 2000);
    }, 12000);
    return function () { clearInterval(t); };
  }, []);

  var openRequest = function () {
    setForm({
      category: 'vacation', title: '', description: '', priority: 'normal',
      starts_on: '', ends_on: '', severity: 'medium', anonymous_to_admins: true,
      // v55.69 — auto-derived from category (vacation = manager-routed)
      visibility: visibilityFromCategory('vacation'),
    });
    setSubmitOk(null);
    setOpenModal('request');
  };
  var openComplaint = function () {
    setForm({
      category: 'interpersonal_conflict', title: '', description: '', priority: 'normal',
      starts_on: '', ends_on: '', severity: 'medium', anonymous_to_admins: true,
      // Complaints are ALWAYS super_admin-only regardless of category.
      visibility: 'super_admin_only',
    });
    setSubmitOk(null);
    setOpenModal('complaint');
  };
  var closeModal = function () {
    setOpenModal(null);
    setSubmitOk(null);
  };

  var submitRequest = async function () {
    if (loading) return;
    if (!form.title.trim()) {
      alert('Please add a short title so the reviewer knows what this is about.');
      return;
    }
    setLoading(true);
    try {
      // v55.73 — RECIPIENT IS USER-PICKED VIA RADIO. Visibility derives from
      // recipient (not from category) so the user's choice is the source of
      // truth. If they picked "manager" → admin-visible; if they picked
      // "super_admin" → super_admin only.
      var derivedVisibility = form.recipient === 'super_admin' ? 'super_admin_only' : 'admin';
      var payload = {
        submitted_by: myId,
        category: form.category,
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        starts_on: form.starts_on || null,
        ends_on: form.ends_on || null,
        visibility: derivedVisibility,
        status: 'submitted',
      };
      var res = await supabase.from('hr_requests').insert(payload).select().maybeSingle();
      if (res.error) throw new Error(res.error.message);
      var requestNumber = (res.data && res.data.request_number) || 'submitted';

      // v55.73 — ACTUALLY DISPATCH the notification. This was missing in
      // earlier builds: the row got inserted but no email ever went out, so
      // the recipient never knew anything was waiting for them.
      // Reported by Max May 8 2026: "you're not sending it to everyone,
      // you're sending it to me. No matter if they selected the radio button."
      // Now: build the recipient list from the user's radio choice + always
      // CC super_admin (so nothing falls through the cracks). Fire-and-forget;
      // a notification failure must NOT block the submit confirmation since
      // the row is already in Supabase.
      try {
        var recipientIds = [];
        if (form.recipient === 'manager' && managerId) recipientIds.push(managerId);
        if (superAdminId) recipientIds.push(superAdminId);
        // De-dupe + drop self-notify
        recipientIds = recipientIds.filter(function (rid, i, arr) {
          return rid && rid !== myId && arr.indexOf(rid) === i;
        });
        if (recipientIds.length > 0) {
          var senderName = (myProfile && myProfile.name) || ((user && user.email) || 'A teammate').split('@')[0];
          var catLabel = ((REQUEST_CATEGORIES.find(function (c) { return c.id === form.category; }) || {}).label) || form.category;
          var subject = '📝 HR Request: ' + form.title.trim();
          var body =
            senderName + ' filed an HR request via Jenna.\n\n' +
            'Topic: ' + catLabel + '\n' +
            'Reference: ' + requestNumber + '\n' +
            'Priority: ' + form.priority + '\n' +
            (form.starts_on ? 'Dates: ' + form.starts_on + (form.ends_on && form.ends_on !== form.starts_on ? ' to ' + form.ends_on : '') + '\n' : '') +
            (form.description ? '\nDetails:\n' + form.description.trim() + '\n' : '') +
            '\nReview it in KTC Hub → Admin → HR Inbox.';
          fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'hr_request',
              recipientIds: recipientIds,
              subject: subject,
              body: body,
              triggeredBy: myId,
            }),
          }).catch(function (e) { console.warn('[hr_request notify] dispatch failed:', e && e.message); });
        }
      } catch (notifyErr) {
        console.warn('[hr_request notify] build/dispatch error:', notifyErr && notifyErr.message);
      }

      setSubmitOk({ kind: 'request', number: requestNumber });
      await loadRecent();
    } catch (e) {
      alert('Could not submit your request: ' + (e.message || 'unknown'));
    } finally {
      setLoading(false);
    }
  };

  var submitComplaint = async function () {
    if (loading) return;
    if (!form.title.trim()) {
      alert('Please add a short title so super_admin knows what this is about.');
      return;
    }
    setLoading(true);
    try {
      var payload = {
        submitted_by: myId,
        category: form.category,
        title: form.title.trim(),
        description: form.description.trim() || null,
        severity: form.severity,
        anonymous_to_admins: form.anonymous_to_admins,
        status: 'submitted',
      };
      var res = await supabase.from('hr_complaints').insert(payload).select().maybeSingle();
      if (res.error) throw new Error(res.error.message);
      var complaintNumber = (res.data && res.data.complaint_number) || 'submitted';

      // v55.73 — Complaints ALWAYS route to super_admin (Mr. Kandil) only.
      // Regardless of anonymous_to_admins, the super_admin always sees the
      // submitter's name (legal/HR-handling necessity). Anonymous mode just
      // hides the submitter from any regular admins down the chain — but
      // since complaints never go to admins anyway, anonymous_to_admins is
      // a property of how the AdminHRInbox renders the row, not whether
      // super_admin gets notified.
      try {
        if (superAdminId && superAdminId !== myId) {
          var senderLabel = form.anonymous_to_admins
            ? 'A teammate (anonymous to admins, identified to super_admin)'
            : ((myProfile && myProfile.name) || ((user && user.email) || 'A teammate').split('@')[0]);
          var catLabel = ((COMPLAINT_CATEGORIES.find(function (c) { return c.id === form.category; }) || {}).label) || form.category;
          var subject = '🚨 HR Concern (' + form.severity + '): ' + form.title.trim();
          var body =
            senderLabel + ' filed an HR concern via Jenna.\n\n' +
            'Topic: ' + catLabel + '\n' +
            'Reference: ' + complaintNumber + '\n' +
            'Severity: ' + form.severity + '\n' +
            (form.description ? '\nDetails:\n' + form.description.trim() + '\n' : '') +
            '\nReview it in KTC Hub → Admin → HR Inbox (Concerns tab).';
          fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'hr_complaint',
              recipientIds: [superAdminId],
              subject: subject,
              body: body,
              triggeredBy: myId,
            }),
          }).catch(function (e) { console.warn('[hr_complaint notify] dispatch failed:', e && e.message); });
        }
      } catch (notifyErr) {
        console.warn('[hr_complaint notify] build/dispatch error:', notifyErr && notifyErr.message);
      }

      setSubmitOk({ kind: 'complaint', number: complaintNumber });
      await loadRecent();
    } catch (e) {
      alert('Could not submit your complaint: ' + (e.message || 'unknown'));
    } finally {
      setLoading(false);
    }
  };

  var pendingReq = myRecent.filter(function (r) { return r.kind === 'request' && (r.status === 'submitted' || r.status === 'under_review' || r.status === 'more_info_needed'); }).length;
  var pendingCmp = myRecent.filter(function (r) { return r.kind === 'complaint' && (r.status === 'submitted' || r.status === 'investigating'); }).length;
  var hasUpdate = myRecent.some(function (r) { return ['approved','denied','resolved','dismissed','more_info_needed','escalated','completed'].indexOf(r.status) >= 0; });

  return (
    <div className="rounded-xl shadow-sm border-2 border-transparent overflow-hidden mb-4"
      style={{
        background: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #f59e0b, #ec4899, #8b5cf6) border-box',
      }}>
      <div className="p-5">
        {/* Header — title + animated mascot + logo */}
        <div className="flex items-start justify-between mb-4 gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Animated mascot — Maya, the HR assistant */}
            <div
              className="relative flex-shrink-0"
              style={{ width: 64, height: 64 }}
              onMouseEnter={function () { setMascotWaving(true); }}
              onMouseLeave={function () { setMascotWaving(false); }}>
              <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="hr-bg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" />
                    <stop offset="50%" stopColor="#ec4899" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                  <linearGradient id="hr-skin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fde68a" />
                    <stop offset="100%" stopColor="#fbbf24" />
                  </linearGradient>
                </defs>
                {/* Background */}
                <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#hr-bg)" />
                {/* Body / blouse */}
                <rect x="18" y="38" width="28" height="22" rx="6" fill="#ffffff" />
                <rect x="22" y="42" width="20" height="3" rx="1" fill="#8b5cf6" opacity="0.3" />
                {/* Head */}
                <circle cx="32" cy="26" r="11" fill="url(#hr-skin)" />
                {/* Hair */}
                <path d="M 22 22 Q 22 14 32 14 Q 42 14 42 22 Q 42 18 32 18 Q 22 18 22 22 Z" fill="#7c2d12" />
                {/* Eyes */}
                <circle cx="28" cy="26" r="1.4" fill="#1f2937" />
                <circle cx="36" cy="26" r="1.4" fill="#1f2937" />
                {/* Smile */}
                <path d="M 28 30 Q 32 33 36 30" stroke="#1f2937" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                {/* Cheek blush */}
                <circle cx="25" cy="29" r="1.2" fill="#fb7185" opacity="0.4" />
                <circle cx="39" cy="29" r="1.2" fill="#fb7185" opacity="0.4" />
                {/* Waving arm — animated */}
                <g style={{
                  transformOrigin: '46px 42px',
                  transform: mascotWaving ? 'rotate(-30deg)' : 'rotate(15deg)',
                  transition: 'transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}>
                  <rect x="44" y="38" width="5" height="14" rx="2.5" fill="url(#hr-skin)" />
                  {mascotWaving && (
                    <>
                      <circle cx="46.5" cy="33" r="1" fill="#ffffff" opacity="0.7">
                        <animate attributeName="opacity" values="0;0.8;0" dur="0.8s" repeatCount="indefinite" />
                      </circle>
                      <circle cx="49" cy="35" r="0.7" fill="#ffffff" opacity="0.5">
                        <animate attributeName="opacity" values="0;0.7;0" dur="0.8s" begin="0.2s" repeatCount="indefinite" />
                      </circle>
                    </>
                  )}
                </g>
                {/* Other arm at rest */}
                <rect x="15" y="38" width="5" height="12" rx="2.5" fill="url(#hr-skin)" />
                {/* Speech bubble badge — top right */}
                <circle cx="53" cy="11" r="6" fill="#ffffff" />
                <text x="53" y="14" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#8b5cf6">HR</text>
              </svg>
              {/* Pulse dot if there's a pending update for the user */}
              {hasUpdate && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 ring-2 ring-white animate-pulse"></span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-extrabold text-lg text-slate-900">My HR Desk</div>
                <span className="px-1.5 py-0.5 bg-violet-100 text-violet-700 text-[9px] font-bold rounded uppercase">Direct line to super_admin</span>
              </div>
              <div className="text-xs text-slate-500">
                Hi {myFirstName} — Maya is here for requests, time off, equipment, raises, recognitions, and any concerns.
              </div>
              {/* Status counters */}
              <div className="flex gap-3 mt-1.5 flex-wrap text-[10px]">
                {pendingReq > 0 && <span className="text-amber-700 font-bold">⏳ {pendingReq} request{pendingReq === 1 ? '' : 's'} pending</span>}
                {pendingCmp > 0 && <span className="text-rose-700 font-bold">⏳ {pendingCmp} complaint{pendingCmp === 1 ? '' : 's'} pending</span>}
                {pendingReq === 0 && pendingCmp === 0 && myRecent.length === 0 && <span className="text-slate-400">No items filed yet</span>}
                {hasUpdate && <span className="text-emerald-700 font-bold">✨ You have updates below</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Two big quick-action buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <button
            onClick={openRequest}
            className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200 hover:border-amber-400 hover:shadow-md transition text-left">
            <div className="text-3xl flex-shrink-0">📝</div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-amber-900">File a Request</div>
              <div className="text-[11px] text-amber-700">Vacation · Equipment · Raise · Training · Schedule · Recognition</div>
            </div>
          </button>
          <button
            onClick={openComplaint}
            className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-br from-rose-50 to-pink-50 border-2 border-rose-200 hover:border-rose-400 hover:shadow-md transition text-left">
            <div className="text-3xl flex-shrink-0">🛡️</div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-rose-900">File a Concern</div>
              <div className="text-[11px] text-rose-700">Confidential. Goes straight to super_admin. Anonymous to admins by default.</div>
            </div>
          </button>
        </div>

        {/* Missing-table guidance */}
        {tableMissing && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            <strong>Setup needed:</strong> the HR Desk database tables haven't been created yet. Run <code className="bg-white px-1 rounded">sql/s41_hr_desk_requests_complaints.sql</code> in Supabase SQL Editor (one-time).
          </div>
        )}

        {/* Recent submissions list */}
        {myRecent.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Your recent submissions</div>
            <div className="space-y-1.5">
              {myRecent.map(function (r) {
                var sc = STATUS_COLORS[r.status] || STATUS_COLORS.submitted;
                var notes = r.kind === 'request' ? r.decision_notes : r.resolution_notes;
                return (
                  <div key={r.id} className={'rounded-lg p-2 border ' + (r.kind === 'complaint' ? 'border-rose-200 bg-rose-50/30' : 'border-amber-200 bg-amber-50/30')}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-base flex-shrink-0">{r.kind === 'complaint' ? '🛡️' : '📝'}</span>
                        <span className="text-[10px] font-mono text-slate-400">{r.number}</span>
                        <span className="text-xs font-bold text-slate-800 truncate">{r.title}</span>
                      </div>
                      <span className={'px-2 py-0.5 rounded text-[10px] font-bold ' + sc.bg + ' ' + sc.text}>{sc.label}</span>
                    </div>
                    {notes && (
                      <div className="mt-1.5 ml-6 p-1.5 rounded bg-white border-l-2 border-violet-300 text-[10px] text-slate-700 whitespace-pre-wrap">
                        <span className="font-bold text-violet-700">super_admin response:</span> {notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ============ MODAL — Request form ============ */}
      {openModal === 'request' && (
        <div className="fixed inset-0 bg-black/60 z-[280] flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '90vh' }} onClick={function (e) { e.stopPropagation(); }}>
            {/* v55.73 — personable Jenna intro at the top of the modal so the
                user knows WHO is helping them with this request, not just a
                faceless form. Photo + name + role + warm one-line greeting.
                Voice-mode is wired into agent-personalities.js for future
                ElevenLabs TTS. */}
            <div className="p-4 border-b border-slate-100 bg-gradient-to-br from-amber-50 via-rose-50 to-fuchsia-50">
              <div className="flex items-start gap-3">
                <img
                  src={AGENT_PERSONALITIES.jenna.photo}
                  alt={AGENT_PERSONALITIES.jenna.name}
                  className="w-14 h-14 rounded-full ring-2 ring-white shadow-md flex-shrink-0"
                  style={{ objectFit: 'cover' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h2 className="text-base font-extrabold text-rose-900">Hi, I'm {AGENT_PERSONALITIES.jenna.name}</h2>
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-200 text-rose-800">{AGENT_PERSONALITIES.jenna.role}</span>
                  </div>
                  <p className="text-xs text-rose-800 mt-1 leading-snug">{AGENT_PERSONALITIES.jenna.greeting}</p>
                </div>
              </div>
              <h3 className="text-sm font-extrabold text-amber-900 mt-3 flex items-center gap-1.5">📝 File a Request</h3>
              <p className="text-[11px] text-slate-600 mt-0.5">Pick a topic, then choose who you want it sent to.</p>
            </div>
            {submitOk ? (
              <div className="p-8 text-center">
                <div className="text-5xl mb-3">✅</div>
                <h3 className="font-extrabold text-emerald-700 mb-1">Submitted</h3>
                <p className="text-sm text-slate-600 mb-1">Reference number: <strong className="font-mono">{submitOk.number}</strong></p>
                <p className="text-xs text-slate-500 mb-4">You'll see status updates right here on your dashboard.</p>
                <button onClick={closeModal} className="px-5 py-2 bg-amber-500 text-white rounded-lg font-bold hover:bg-amber-600">Done</button>
              </div>
            ) : (
              <>
                <div className="overflow-auto p-5 space-y-3" style={{ flex: '1 1 auto' }}>
                  {/* v55.69 — icon-tile topic picker. Tap an icon to pick.
                      Each topic is grouped by where it routes to so the user
                      sees at a glance "manager handles this" vs "super_admin
                      only". This replaces the old dropdown + visibility
                      selector (the user no longer has to choose visibility
                      manually — picking the topic IS the routing decision). */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-700 block mb-2">What's this about?</label>

                    {/* Manager-routed topics */}
                    <div className="mb-3">
                      <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                        <span>👤</span> Goes to your manager
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {REQUEST_CATEGORIES.filter(function (c) { return c.routing === 'manager'; }).map(function (c) {
                          var selected = form.category === c.id;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={function () { setForm(Object.assign({}, form, { category: c.id, visibility: visibilityFromCategory(c.id), recipient: 'manager' })); }}
                              className={'flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition text-center ' + (selected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300')}
                              title={c.hint}
                            >
                              <span className="text-2xl">{c.icon}</span>
                              <span className={'text-[10px] font-bold leading-tight ' + (selected ? 'text-blue-800' : 'text-slate-600')}>{c.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* super_admin-routed topics (HR-sensitive) */}
                    <div>
                      <div className="text-[10px] font-bold text-violet-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                        <span>🔒</span> Goes to super_admin only (HR-sensitive — admins can't see)
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {REQUEST_CATEGORIES.filter(function (c) { return c.routing === 'super_admin'; }).map(function (c) {
                          var selected = form.category === c.id;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={function () { setForm(Object.assign({}, form, { category: c.id, visibility: visibilityFromCategory(c.id), recipient: 'super_admin' })); }}
                              className={'flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition text-center ' + (selected ? 'border-violet-500 bg-violet-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300')}
                              title={c.hint}
                            >
                              <span className="text-2xl">{c.icon}</span>
                              <span className={'text-[10px] font-bold leading-tight ' + (selected ? 'text-violet-800' : 'text-slate-600')}>{c.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Hint for the chosen topic */}
                    <div className="text-[10px] text-slate-500 mt-2 italic">{(REQUEST_CATEGORIES.find(function (c) { return c.id === form.category; }) || {}).hint}</div>
                  </div>

                  {/* v55.73 — RECIPIENT PICKER. The user explicitly chooses
                      who this goes to via radio buttons. Auto-defaults from
                      category (manager-routed topics → manager, sensitive
                      topics → super_admin) but always overridable.
                      Reported by Max May 8 2026: "There should be radio
                      buttons of who you want to message to — manager or
                      Mr. Kandil. In the background you're not telling him
                      where it actually goes." Now: explicit radio buttons,
                      high-contrast badge, AND actual notification dispatch
                      at submit time (was a no-op before). */}
                  <div className="rounded-lg border-2 border-slate-300 bg-white p-3">
                    <div className="text-[11px] font-extrabold text-slate-800 uppercase tracking-wide mb-2">📨 Send this request to</div>
                    <div className="space-y-2">
                      <label className={'flex items-start gap-2.5 p-2.5 rounded-lg border-2 cursor-pointer transition ' + (form.recipient === 'manager' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300')}>
                        <input
                          type="radio"
                          name="hr-recipient"
                          value="manager"
                          checked={form.recipient === 'manager'}
                          onChange={function () { setForm(Object.assign({}, form, { recipient: 'manager' })); }}
                          className="mt-1 flex-shrink-0"
                          disabled={!managerId} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-slate-900">
                            👤 My manager{manager ? ': ' + managerName : ''}
                          </div>
                          <div className="text-[11px] text-slate-700 mt-0.5">
                            {managerId
                              ? superAdminName + ' is also CC\'d so it doesn\'t fall through the cracks.'
                              : 'You don\'t have a manager assigned. Ask super_admin to set your "reports_to" in Settings.'}
                          </div>
                        </div>
                      </label>
                      <label className={'flex items-start gap-2.5 p-2.5 rounded-lg border-2 cursor-pointer transition ' + (form.recipient === 'super_admin' ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300')}>
                        <input
                          type="radio"
                          name="hr-recipient"
                          value="super_admin"
                          checked={form.recipient === 'super_admin'}
                          onChange={function () { setForm(Object.assign({}, form, { recipient: 'super_admin' })); }}
                          className="mt-1 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-slate-900">
                            🔒 {superAdminName} only (super_admin)
                          </div>
                          <div className="text-[11px] text-slate-700 mt-0.5">
                            Goes straight to {superAdminName}. Regular admins (including your manager) won't see this. Use for HR-sensitive topics: raise, promotion, transfer, complaints, anything personal.
                          </div>
                        </div>
                      </label>
                    </div>
                    {/* Hint based on what the category suggests */}
                    {(function () {
                      var cat = REQUEST_CATEGORIES.find(function (c) { return c.id === form.category; });
                      if (!cat) return null;
                      var suggested = cat.routing === 'manager' ? 'manager' : 'super_admin';
                      if (form.recipient !== suggested) {
                        return (
                          <div className="mt-2 px-2 py-1.5 rounded bg-amber-100 border border-amber-300 text-[11px] text-amber-900 font-semibold">
                            ⚠️ Heads up: most "{cat.label}" requests usually go to {suggested === 'manager' ? 'a manager' : superAdminName}. You can keep your choice — just confirming.
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-700 block mb-1">Short title</label>
                    <input value={form.title} onChange={function (e) { setForm(Object.assign({}, form, { title: e.target.value })); }} placeholder="e.g. Vacation request: June 5-12" maxLength={120} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                  </div>
                  {(form.category === 'vacation' || form.category === 'sick_leave' || form.category === 'training' || form.category === 'flexible_hours' || form.category === 'remote_work') && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-slate-700 block mb-1">Start date</label>
                        <input type="date" value={form.starts_on} onChange={function (e) { setForm(Object.assign({}, form, { starts_on: e.target.value })); }} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-700 block mb-1">End date</label>
                        <input type="date" value={form.ends_on} onChange={function (e) { setForm(Object.assign({}, form, { ends_on: e.target.value })); }} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-bold text-slate-700 block mb-1">Details</label>
                    <textarea value={form.description} onChange={function (e) { setForm(Object.assign({}, form, { description: e.target.value })); }} rows={5} placeholder="Anything that helps the reviewer decide quickly." className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                  </div>
                  <div>
                    {/* v55.69 — visibility dropdown removed; routing is now
                        derived from the category. Priority alone here. */}
                    <label className="text-[10px] font-bold text-slate-700 block mb-1">Priority</label>
                    <select value={form.priority} onChange={function (e) { setForm(Object.assign({}, form, { priority: e.target.value })); }} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
                      <option value="low">Low — whenever</option>
                      <option value="normal">Normal</option>
                      <option value="high">High — soon please</option>
                      <option value="urgent">Urgent — needs response today</option>
                    </select>
                  </div>
                </div>
                <div className="p-3 border-t border-slate-100 flex justify-end gap-2">
                  <button onClick={closeModal} className="px-3 py-2 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
                  <button onClick={submitRequest} disabled={loading} className="px-5 py-2 bg-amber-500 text-white rounded font-bold hover:bg-amber-600 disabled:opacity-50">
                    {loading ? 'Sending…' : 'Submit request'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ============ MODAL — Complaint form ============ */}
      {openModal === 'complaint' && (
        <div className="fixed inset-0 bg-black/60 z-[280] flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '90vh' }} onClick={function (e) { e.stopPropagation(); }}>
            {/* v55.73 — Jenna intro for complaints. Same warm tone, but the
                greeting acknowledges this is sensitive. */}
            <div className="p-4 border-b border-slate-100 bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50">
              <div className="flex items-start gap-3">
                <img
                  src={AGENT_PERSONALITIES.jenna.photo}
                  alt={AGENT_PERSONALITIES.jenna.name}
                  className="w-14 h-14 rounded-full ring-2 ring-white shadow-md flex-shrink-0"
                  style={{ objectFit: 'cover' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h2 className="text-base font-extrabold text-rose-900">Hi, I'm {AGENT_PERSONALITIES.jenna.name}</h2>
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-200 text-rose-800">{AGENT_PERSONALITIES.jenna.role}</span>
                  </div>
                  <p className="text-xs text-rose-800 mt-1 leading-snug">
                    I'll take this directly to {superAdminName}. Whatever you share stays between you and super_admin — regular admins won't see it. You can also stay anonymous to admins (toggle below).
                  </p>
                </div>
              </div>
              <h3 className="text-sm font-extrabold text-rose-900 mt-3 flex items-center gap-1.5">🛡️ File a Concern</h3>
              <p className="text-[11px] text-slate-600 mt-0.5">Goes <strong>directly to {superAdminName}</strong>. Hidden from regular admins by default.</p>
            </div>
            {submitOk ? (
              <div className="p-8 text-center">
                <div className="text-5xl mb-3">✅</div>
                <h3 className="font-extrabold text-emerald-700 mb-1">Received</h3>
                <p className="text-sm text-slate-600 mb-1">Reference number: <strong className="font-mono">{submitOk.number}</strong></p>
                <p className="text-xs text-slate-500 mb-4">super_admin will review and respond. Status updates appear here.</p>
                <button onClick={closeModal} className="px-5 py-2 bg-rose-500 text-white rounded-lg font-bold hover:bg-rose-600">Done</button>
              </div>
            ) : (
              <>
                <div className="overflow-auto p-5 space-y-3" style={{ flex: '1 1 auto' }}>
                  <div className="bg-rose-50 border border-rose-200 rounded p-2 text-[11px] text-rose-800">
                    <strong>Privacy:</strong> Only super_admin sees who submitted this. Regular admins do not see complaints unless super_admin shares them. You can also keep your identity hidden from admins entirely (toggle below).
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-700 block mb-1">What's this about?</label>
                    <select value={form.category} onChange={function (e) { setForm(Object.assign({}, form, { category: e.target.value })); }} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
                      {COMPLAINT_CATEGORIES.map(function (c) { return <option key={c.id} value={c.id}>{c.icon + ' ' + c.label}</option>; })}
                    </select>
                    <div className="text-[10px] text-slate-500 mt-1">{(COMPLAINT_CATEGORIES.find(function (c) { return c.id === form.category; }) || {}).hint}</div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-700 block mb-1">Short title</label>
                    <input value={form.title} onChange={function (e) { setForm(Object.assign({}, form, { title: e.target.value })); }} placeholder="e.g. Concerns about workload pressure" maxLength={120} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-700 block mb-1">What happened? (use as much detail as you're comfortable with)</label>
                    <textarea value={form.description} onChange={function (e) { setForm(Object.assign({}, form, { description: e.target.value })); }} rows={6} placeholder="Dates, times, who was involved, what was said, how it affected you. The more specific, the better super_admin can help." className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-700 block mb-1">How serious is this?</label>
                    <select value={form.severity} onChange={function (e) { setForm(Object.assign({}, form, { severity: e.target.value })); }} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
                      <option value="low">Low — wanted to flag it</option>
                      <option value="medium">Medium — should be looked at</option>
                      <option value="high">High — needs attention soon</option>
                      <option value="critical">Critical — urgent / safety / harm</option>
                    </select>
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.anonymous_to_admins} onChange={function (e) { setForm(Object.assign({}, form, { anonymous_to_admins: e.target.checked })); }} className="mt-0.5" />
                    <span className="text-xs text-slate-700">
                      <strong>Keep my identity hidden from regular admins.</strong> super_admin will still see who I am, but admins will only see "anonymous". (Recommended.)
                    </span>
                  </label>
                </div>
                <div className="p-3 border-t border-slate-100 flex justify-end gap-2">
                  <button onClick={closeModal} className="px-3 py-2 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
                  <button onClick={submitComplaint} disabled={loading} className="px-5 py-2 bg-rose-500 text-white rounded font-bold hover:bg-rose-600 disabled:opacity-50">
                    {loading ? 'Sending…' : 'Submit confidentially'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
