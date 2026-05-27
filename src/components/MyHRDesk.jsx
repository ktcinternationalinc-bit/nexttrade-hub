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
// v55.83-A.6.27.66 (bug sweep, Max May 23 2026) — use the shared helper to
// reject both active===false AND active===null when picking the routing
// super_admin. Previously a deactivated super_admin with active=null could
// receive HR submissions silently.
import { isActiveUser } from '../lib/active-users';
// v55.81 QA-17 (Max May 9 2026): crisis-language detection in HR
// submissions. Surfaces hotline resources to users whose text suggests
// self-harm, threat, or severe distress, and tags the submission
// urgent so admins see it elevated.
import { detectCrisisLanguage, crisisResources } from '../lib/crisis-detection';

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
  under_review:      { bg: 'bg-amber-100',    text: 'text-amber-900',   label: 'Under review' },
  approved:          { bg: 'bg-emerald-100',  text: 'text-emerald-700', label: 'Approved' },
  denied:            { bg: 'bg-rose-100',     text: 'text-rose-700',    label: 'Denied' },
  more_info_needed:  { bg: 'bg-purple-100',   text: 'text-purple-700',  label: 'Needs more info' },
  withdrawn:         { bg: 'bg-slate-100',    text: 'text-slate-600',   label: 'Withdrawn' },
  completed:         { bg: 'bg-emerald-100',  text: 'text-emerald-700', label: 'Completed' },
  investigating:     { bg: 'bg-amber-100',    text: 'text-amber-900',   label: 'Investigating' },
  resolved:          { bg: 'bg-emerald-100',  text: 'text-emerald-700', label: 'Resolved' },
  dismissed:         { bg: 'bg-slate-100',    text: 'text-slate-600',   label: 'Dismissed' },
  escalated:         { bg: 'bg-rose-100',     text: 'text-rose-700',    label: 'Escalated' },
};

export default function MyHRDesk({ user, userProfile, users, active }) {
  // v55.77 — Fix #G — `active` prop signals whether Jenna's panel is the
  // currently open persona. Defaults to true for backward compat (older
  // mounts). When false on first render, the HR table fetches are deferred
  // until the user actually opens Jenna. Once opened, data stays loaded so
  // re-opens don't re-fetch.
  var isActive = active === undefined ? true : !!active;
  var [hasBeenActive, setHasBeenActive] = useState(isActive);
  useEffect(function () {
    if (isActive && !hasBeenActive) setHasBeenActive(true);
  }, [isActive, hasBeenActive]);

  var myId = (userProfile && userProfile.id) || (user && user.id);
  var myFirstName = ((userProfile && userProfile.name) || (user && user.email) || 'there').split(' ')[0].split('@')[0];

  var [openModal, setOpenModal] = useState(null); // null | 'request' | 'complaint'
  var [myRecent, setMyRecent] = useState([]); // recent submissions
  var [loading, setLoading] = useState(false);
  var [submitOk, setSubmitOk] = useState(null); // { kind, number }
  var [tableMissing, setTableMissing] = useState(false);
  // v55.81 QA-17: shown when a submission's text trips the crisis detector.
  // null = no flag. { flag: 'self_harm'|'threat'|'distress', resources: {...} }
  var [crisisOverlay, setCrisisOverlay] = useState(null);
  // hover state for mascot animation
  // v55.77 — mascotWaving state removed (Fix #11). Was driving the cartoon
  // "Maya" SVG mascot which got replaced by the real Jenna photo above.

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
  var superAdmin = safeUsers.find(function (u) { return u.role === 'super_admin' && isActiveUser(u); });
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

  useEffect(function () {
    // v55.77 — Fix #G — Defer until Jenna's panel has been opened at least
    // once. Without this gate, MyHRDesk fetched HR tables on every page
    // load even when the user never clicked Jenna — wasted Supabase round
    // trips and console errors if hr_requests / hr_complaints aren't set up.
    if (!hasBeenActive) return;
    loadRecent();
  }, [myId, hasBeenActive]);

  // v55.77 — Fix #L — Close any open modal when the user switches persona,
  // but PRESERVE the form draft. The unified module's display:none would
  // hide the modal anyway, but if the user switches BACK to Jenna, the
  // modal would pop back open with their draft — surprising behavior.
  // Better: collapse the modal so they see the desk, but keep the form
  // state. If they tap "File a Request" again, their draft re-loads.
  useEffect(function () {
    if (typeof window === 'undefined') return;
    var handler = function (ev) {
      var to = ev && ev.detail && ev.detail.to;
      // Only close the modal if the user switched AWAY from Jenna.
      // If they switched TO Jenna, leave whatever was open (rare path).
      if (to && to !== 'jenna' && openModal) {
        setOpenModal(null);
      }
    };
    window.addEventListener('ktc:assistant-changed-cleanup', handler);
    return function () { window.removeEventListener('ktc:assistant-changed-cleanup', handler); };
  }, [openModal]);

  // v55.77 — Removed mascotWaving state + interval. The cartoon "Maya" SVG
  // mascot was deleted (Fix #11) — the real Jenna photo lives in the unified
  // module header. State + periodic timer are now dead code.

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
      alert('Please add a short title so ' + (superAdminName || 'Mr. Kandil') + ' knows what this is about.');
      return;
    }

    // v55.81 QA-17 (Max May 9 2026): crisis-language detection. If the
    // submitter's title or description suggests self-harm, a credible
    // threat, or severe distress, surface professional resources right
    // here BEFORE the submission completes — they need somewhere
    // additional to turn beyond Jenna routing the form. We also auto-
    // bump severity to 'critical' for self-harm or 'high' for the
    // others so Mr. Kandil sees the row visually elevated.
    var crisisFlag = detectCrisisLanguage((form.title || '') + ' ' + (form.description || ''));
    var effectiveSeverity = form.severity;
    if (crisisFlag === 'self_harm') effectiveSeverity = 'critical';
    else if (crisisFlag === 'threat' || crisisFlag === 'distress') {
      // Don't downgrade if user already picked critical
      if (effectiveSeverity !== 'critical') effectiveSeverity = 'high';
    }

    setLoading(true);
    try {
      var payload = {
        submitted_by: myId,
        category: form.category,
        title: form.title.trim(),
        description: form.description.trim() || null,
        severity: effectiveSeverity,
        anonymous_to_admins: form.anonymous_to_admins,
        status: 'submitted',
        // crisis_flag column is added by migration v55.81-qa17. If the
        // column doesn't exist yet, the insert will fail; we catch that
        // and retry without the column so the submission still goes
        // through during the rollout window.
        crisis_flag: crisisFlag,
      };
      var res = await supabase.from('hr_complaints').insert(payload).select().maybeSingle();
      if (res.error && /crisis_flag/i.test(res.error.message || '')) {
        // Column not migrated yet — retry without
        delete payload.crisis_flag;
        res = await supabase.from('hr_complaints').insert(payload).select().maybeSingle();
      }
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
            ? 'A teammate (your identity stays private from other team leads)'
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
      // v55.81 QA-17: if crisis language was detected, show the resource
      // overlay. The submission already went through; this is the
      // "and here's where you can also turn for help" moment, not a
      // gate. The overlay component is rendered in the JSX below.
      if (crisisFlag) {
        var resources = crisisResources(crisisFlag);
        if (resources) {
          setCrisisOverlay({ flag: crisisFlag, resources: resources, complaintNumber: complaintNumber });
        }
      }
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
        {/* Header — title + status counters.
            v55.77 — Fix #11 — Removed the legacy cartoon "Maya" SVG mascot.
            The real Jenna photo + greeting now live in the unified module
            header above (see AssistantsBar). Two Jennas on the same screen
            was visually confusing. The HR Desk header is now compact:
            title + status counters only. */}
        {/* v55.83-A.6.27.72 HOTFIX 17 — Per Max May 27 2026: title + counters
            were getting washed out where the persona's gradient header bleeds
            into the panel. Wrapping the entire header block in a solid white
            card with light border + shadow guarantees dark text always has a
            light, predictable surface to sit on, regardless of what color the
            outer panel chose. */}
        <div className="bg-white rounded-lg border border-rose-200 shadow-sm p-3 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-extrabold text-lg text-slate-900">My HR Desk</div>
                  <span className="px-2 py-0.5 bg-violet-600 text-white text-[10px] font-extrabold rounded uppercase tracking-wide">Direct line to {superAdminName}</span>
                  {hasUpdate && (
                    <span className="px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-extrabold rounded uppercase tracking-wide animate-pulse">✨ New update</span>
                  )}
                </div>
                <div className="text-xs text-slate-700 font-semibold mt-0.5">
                  File requests, raise concerns, and see responses below.
                </div>
                {/* Status counters */}
                <div className="flex gap-3 mt-1.5 flex-wrap text-[11px]">
                  {pendingReq > 0 && <span className="text-amber-900 font-extrabold">⏳ {pendingReq} request{pendingReq === 1 ? '' : 's'} pending</span>}
                  {pendingCmp > 0 && <span className="text-rose-900 font-extrabold">⏳ {pendingCmp} concern{pendingCmp === 1 ? '' : 's'} pending</span>}
                  {pendingReq === 0 && pendingCmp === 0 && myRecent.length === 0 && <span className="text-slate-600 font-bold">No items filed yet</span>}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Two big quick-action buttons
            v55.82-B (QA-22) — BULLETPROOF CONTRAST FIX.
            Before: the "File a Request" card used text-amber-900 / amber-900
            on a from-amber-50 to-orange-50 gradient. On certain screens the
            subtitle was effectively yellow text on yellow background and
            unreadable from any angle. Max reported this 10+ times.
            Now: white card surface with a thick amber accent border for the
            request action and a thick rose accent border for the concern
            action. Title text is solid slate-900 (near-black) for guaranteed
            readability. Subtitle is slate-700 with bold weight. The colored
            border + emoji still telegraph the action's meaning at a glance.
            Tested against light + dark wallpapers + both iOS and desktop. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <button
            onClick={openRequest}
            className="flex items-center gap-3 p-3 rounded-lg bg-white border-2 border-amber-500 hover:border-amber-600 hover:shadow-md transition text-left">
            <div className="text-3xl flex-shrink-0">📝</div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-slate-900">File a Request</div>
              <div className="text-[12px] font-semibold text-slate-700">Vacation · Equipment · Raise · Training · Schedule · Recognition</div>
            </div>
          </button>
          <button
            onClick={openComplaint}
            className="flex items-center gap-3 p-3 rounded-lg bg-white border-2 border-rose-500 hover:border-rose-600 hover:shadow-md transition text-left">
            <div className="text-3xl flex-shrink-0">🛡️</div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-slate-900">File a Concern</div>
              <div className="text-xs font-semibold text-slate-700">Confidential. Goes straight to {superAdminName}. Stays private from other team leads.</div>
            </div>
          </button>
        </div>

        {/* Missing-table guidance */}
        {tableMissing && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
            <strong>Setup needed:</strong> the HR Desk database tables haven't been created yet. Run <code className="bg-white px-1 rounded">sql/s41_hr_desk_requests_complaints.sql</code> in Supabase SQL Editor (one-time).
          </div>
        )}

        {/* Recent submissions list */}
        {myRecent.length > 0 && (
          <div>
            {/* v55.83-A.6.27.72 HOTFIX 17 — Section label darkened from slate-500 to slate-800
                so the "YOUR RECENT SUBMISSIONS" header stays legible when the panel sits
                on top of a colored gradient. */}
            <div className="text-[11px] font-extrabold text-slate-800 uppercase tracking-wide mb-2">Your recent submissions</div>
            <div className="space-y-1.5">
              {myRecent.map(function (r) {
                var sc = STATUS_COLORS[r.status] || STATUS_COLORS.submitted;
                var notes = r.kind === 'request' ? r.decision_notes : r.resolution_notes;
                return (
                  <div key={r.id} className={'rounded-lg p-2 border bg-white ' + (r.kind === 'complaint' ? 'border-rose-300' : 'border-amber-300')}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-base flex-shrink-0">{r.kind === 'complaint' ? '🛡️' : '📝'}</span>
                        <span className="text-[10px] font-mono font-bold text-slate-700">{r.number}</span>
                        <span className="text-xs font-extrabold text-slate-900 truncate">{r.title}</span>
                      </div>
                      <span className={'px-2 py-0.5 rounded text-[10px] font-extrabold ' + sc.bg + ' ' + sc.text}>{sc.label}</span>
                    </div>
                    {notes && (
                      <div className="mt-1.5 ml-6 p-1.5 rounded bg-slate-50 border-l-2 border-violet-400 text-[11px] text-slate-800 whitespace-pre-wrap">
                        <span className="font-extrabold text-violet-800">{superAdminName} response:</span> {notes}
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
              <p className="text-xs text-slate-700 mt-0.5">Pick a topic, then choose who you want it sent to.</p>
            </div>
            {submitOk ? (
              <div className="p-8 text-center">
                <div className="text-5xl mb-3">✅</div>
                <h3 className="font-extrabold text-emerald-700 mb-2">Thank you</h3>
                {/* v55.75 (A2) — Polished wording. Symmetrical with concern flow. */}
                <p className="text-sm text-slate-700 mb-1">Your request has been submitted.</p>
                <p className="text-sm text-slate-700 mb-4">Your reference number is <strong className="font-mono">{submitOk.number}</strong>.</p>
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
                    <label className="text-xs font-bold text-slate-800 block mb-2">What's this about?</label>

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
                        <span>🔒</span> Goes to {superAdminName} only (private — other team leads can't see)
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
                    <div className="text-xs text-slate-700 mt-2 italic">{(REQUEST_CATEGORIES.find(function (c) { return c.id === form.category; }) || {}).hint}</div>
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
                          <div className="text-xs text-slate-700 mt-0.5">
                            {managerId
                              ? superAdminName + ' is also notified so it doesn\'t fall through the cracks.'
                              : 'You don\'t have a manager assigned. Ask ' + (superAdminName || 'Mr. Kandil') + ' to set your reporting line in Settings.'}
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
                            🔒 {superAdminName}
                          </div>
                          <div className="text-xs text-slate-700 mt-0.5">
                            Goes straight to {superAdminName}. Other team leads (including your manager) won't see this. Use for sensitive topics: raise, promotion, transfer, concerns, anything personal.
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
                    <label className="text-xs font-bold text-slate-800 block mb-1">Short title</label>
                    <input value={form.title} onChange={function (e) { setForm(Object.assign({}, form, { title: e.target.value })); }} placeholder="e.g. Vacation request: June 5-12" maxLength={120} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                  </div>
                  {(form.category === 'vacation' || form.category === 'sick_leave' || form.category === 'training' || form.category === 'flexible_hours' || form.category === 'remote_work') && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-bold text-slate-800 block mb-1">Start date</label>
                        <input type="date" value={form.starts_on} onChange={function (e) { setForm(Object.assign({}, form, { starts_on: e.target.value })); }} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-800 block mb-1">End date</label>
                        <input type="date" value={form.ends_on} onChange={function (e) { setForm(Object.assign({}, form, { ends_on: e.target.value })); }} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-bold text-slate-800 block mb-1">Details</label>
                    <textarea data-ktc-draft-active={form.description && form.description.length > 0 ? 'true' : 'false'} value={form.description} onChange={function (e) { setForm(Object.assign({}, form, { description: e.target.value })); }} rows={5} placeholder="Anything that helps the reviewer decide quickly." className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                  </div>
                  <div>
                    {/* v55.69 — visibility dropdown removed; routing is now
                        derived from the category. Priority alone here. */}
                    <label className="text-xs font-bold text-slate-800 block mb-1">Priority</label>
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
                    {/* v55.75 (A2) — Final wording approved by Max May 8 2026:
                        clean professional language. No "super_admin", no
                        "anonymous", no internal jargon. Confidentiality
                        toggle below still works under the hood. */}
                    I'm sorry you're dealing with this. I'll take it directly to {superAdminName}. Only {superAdminName} will see it — other team leads won't. You can also keep your identity confidential (toggle below).
                  </p>
                </div>
              </div>
              <h3 className="text-sm font-extrabold text-rose-900 mt-3 flex items-center gap-1.5">🛡️ File a Concern</h3>
              <p className="text-xs text-slate-700 mt-0.5">This concern will go <strong>directly to {superAdminName}</strong>. It stays private from other team leads.</p>
            </div>
            {submitOk ? (
              <div className="p-8 text-center">
                {/* v55.81 QA-17 (Max May 9 2026): if the submission text
                    triggered a crisis-language flag, show the resource
                    overlay first. The submission already succeeded —
                    this is "and here's where else to turn for help",
                    not a gate. */}
                {crisisOverlay ? (
                  <div className="mb-5 text-left bg-rose-50 border-2 border-rose-300 rounded-xl p-4">
                    <div className="text-3xl mb-2">🤝</div>
                    <h4 className="font-extrabold text-rose-900 mb-2">{crisisOverlay.resources.title}</h4>
                    <ul className="text-sm text-rose-900 list-disc pl-5 space-y-1 mb-3">
                      {crisisOverlay.resources.lines.map(function (line, idx) {
                        return <li key={idx}>{line}</li>;
                      })}
                    </ul>
                    <div className="text-xs text-rose-800 italic mb-3">{crisisOverlay.resources.note}</div>
                  </div>
                ) : null}
                <div className="text-5xl mb-3">✅</div>
                <h3 className="font-extrabold text-emerald-700 mb-2">Thank you</h3>
                {/* v55.75 (A2) — exact wording per Max's spec May 8 2026:
                    "Thank you. Your concern has been submitted. Your reference
                    number is HRC-2026-0001. Mr. Kandil has been notified." */}
                <p className="text-sm text-slate-700 mb-1">Your concern has been submitted.</p>
                <p className="text-sm text-slate-700 mb-1">Your reference number is <strong className="font-mono">{submitOk.number}</strong>.</p>
                <p className="text-sm text-slate-700 mb-4">{superAdminName} has been notified.</p>
                <p className="text-xs text-slate-500 mb-4">Status updates will appear right here on your dashboard.</p>
                <button onClick={function () { setCrisisOverlay(null); closeModal(); }} className="px-5 py-2 bg-rose-500 text-white rounded-lg font-bold hover:bg-rose-600">Done</button>
              </div>
            ) : (
              <>
                <div className="overflow-auto p-5 space-y-3" style={{ flex: '1 1 auto' }}>
                  <div className="bg-rose-50 border border-rose-200 rounded p-2 text-xs text-rose-900">
                    <strong>Privacy:</strong> Only {superAdminName} sees who submitted this. Other team leads do not see concerns unless {superAdminName} chooses to share them. You can also keep your identity hidden entirely (toggle below).
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-800 block mb-1">What's this about?</label>
                    <select value={form.category} onChange={function (e) { setForm(Object.assign({}, form, { category: e.target.value })); }} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
                      {COMPLAINT_CATEGORIES.map(function (c) { return <option key={c.id} value={c.id}>{c.icon + ' ' + c.label}</option>; })}
                    </select>
                    <div className="text-xs text-slate-700 mt-1">{(COMPLAINT_CATEGORIES.find(function (c) { return c.id === form.category; }) || {}).hint}</div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-800 block mb-1">Short title</label>
                    <input value={form.title} onChange={function (e) { setForm(Object.assign({}, form, { title: e.target.value })); }} placeholder="e.g. Concerns about workload pressure" maxLength={120} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-800 block mb-1">What happened? (use as much detail as you're comfortable with)</label>
                    <textarea data-ktc-draft-active={form.description && form.description.length > 0 ? 'true' : 'false'} value={form.description} onChange={function (e) { setForm(Object.assign({}, form, { description: e.target.value })); }} rows={6} placeholder={"Dates, times, who was involved, what was said, how it affected you. The more specific, the better " + superAdminName + " can help."} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-800 block mb-1">How serious is this?</label>
                    <select value={form.severity} onChange={function (e) { setForm(Object.assign({}, form, { severity: e.target.value })); }} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
                      <option value="low">Low — wanted to flag it</option>
                      <option value="medium">Medium — should be looked at</option>
                      <option value="high">High — needs attention soon</option>
                      <option value="critical">Critical — urgent / safety / harm</option>
                    </select>
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.anonymous_to_admins} onChange={function (e) { setForm(Object.assign({}, form, { anonymous_to_admins: e.target.checked })); }} className="mt-0.5" />
                    {/* v55.75 (A2) — Per Max May 8 2026: "Keep [the toggle],
                        but under the hood you send to Mr Kandil but do not
                        put in label." Toggle keeps its function (the
                        anonymous_to_admins flag still flows through), but
                        the label no longer mentions "super_admin" or
                        "anonymous to admins" — both confusing internal
                        jargon. Replaced with: only Mr. Kandil sees you. */}
                    <span className="text-xs text-slate-700">
                      <strong>Keep my identity confidential.</strong> Only {superAdminName} will see your name on this concern. (Recommended.)
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
