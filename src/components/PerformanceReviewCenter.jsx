'use client';
// PerformanceReviewCenter — v55.83-NK (Max Aug 28 2026)
//
// "a professional review performance report I as a manager can create and then
//  input my own data on this. make it really encompassing"
//
// Three layers, deliberately separate and labelled as such on the report:
//   1. MEASURED — attendance from user_sessions, ticket handling from tickets +
//      ticket_comments, for the chosen period (default: last 12 months).
//      Numbers only; nobody's opinion.
//   2. JENNA'S DRAFT — the AI HR rep writes a professional narrative from the
//      measurements only. Fully editable; it is a draft for the manager, not a
//      verdict.
//   3. MANAGER'S OWN INPUT — rating, strengths, areas to improve, goals, and
//      comments. This is Max's voice and is stored as his, separate from the
//      AI's.
// Saved to hr_performance_reviews with the metrics snapshot frozen in, so a
// review remains exactly what was seen at review time even as live data moves.
import React, { useState, useEffect, useContext } from 'react';
import { ToastContext } from '../lib/toast-context';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { filterActiveUsers } from '../lib/active-users';

export default function PerformanceReviewCenter(props) {
  var userProfile = props.userProfile;
  var users = props.users || [];
  // v55.83-NK — AdminTab does not pass a toast prop; the shared ToastContext is
  // the correct channel (see toast-context.js history — silent fallbacks are the
  // exact "I click and nothing happens" bug that file was created to kill).
  var ctxToast = useContext(ToastContext);
  var toast = props.toast || ctxToast || { success: function (m) { try { window.alert(m); } catch (e) {} }, error: function (m) { try { window.alert(m); } catch (e) {} } };
  var isSuperAdmin = userProfile && userProfile.role === 'super_admin';
  var isAdmin = isSuperAdmin || (userProfile && userProfile.role === 'admin');

  function iso(d) { return d.toISOString().substring(0, 10); }
  var today = new Date();
  var yearAgo = new Date(today); yearAgo.setFullYear(today.getFullYear() - 1);

  var s1 = useState(''); var empId = s1[0]; var setEmpId = s1[1];
  var s2 = useState(iso(yearAgo)); var start = s2[0]; var setStart = s2[1];
  var s3 = useState(iso(today)); var end = s3[0]; var setEnd = s3[1];
  var s4 = useState(false); var loading = s4[0]; var setLoading = s4[1];
  var s5 = useState(null); var report = s5[0]; var setReport = s5[1]; // {metrics, narrative}
  var s6 = useState(null); var mgr = s6[0]; var setMgr = s6[1]; // manager inputs
  var s7 = useState([]); var past = s7[0]; var setPast = s7[1];
  var s8 = useState(false); var saving = s8[0]; var setSaving = s8[1];
  var s9 = useState(null); var loadedReviewId = s9[0]; var setLoadedReviewId = s9[1];

  var team = filterActiveUsers(users).filter(function (u) { return !u.is_ai; });

  function freshMgr() { return { overall_rating: 0, strengths: '', improvements: '', goals: '', manager_comments: '', narrative: '' }; }

  useEffect(function () {
    if (!empId) { setPast([]); return; }
    supabase.from('hr_performance_reviews')
      .select('id, period_start, period_end, overall_rating, status, created_at, reviewer_name')
      .eq('employee_id', empId).order('created_at', { ascending: false }).limit(12)
      .then(function (r) { setPast((r && r.data) || []); })
      .catch(function () { setPast([]); });
  }, [empId]);

  function generate() {
    if (!empId) { toast.error('Pick a team member first.'); return; }
    if (!start || !end || start > end) { toast.error('Check the period dates.'); return; }
    setLoading(true); setReport(null); setLoadedReviewId(null);
    fetch('/api/hr/performance-review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: empId, period_start: start, period_end: end, requester_id: userProfile && userProfile.id, want_ai: true })
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.ok !== true) { toast.error('Generate failed: ' + ((j && j.error) || 'unknown')); return; }
        setReport(j);
        var m = freshMgr();
        m.narrative = j.narrative || '';
        setMgr(m);
        if (j.ai_error) { toast.error('Jenna could not draft the narrative (' + j.ai_error + ') — the measurements are complete; write the narrative yourself or retry.'); }
        else { toast.success('Report generated — review Jenna\'s draft and add your own input.'); }
      })
      .catch(function (e) { toast.error('Generate failed: ' + ((e && e.message) || 'network')); })
      .finally(function () { setLoading(false); });
  }

  function setM(field, val) { setMgr(function (p) { var n = Object.assign({}, p || freshMgr()); n[field] = val; return n; }); }

  function saveReview(finalize) {
    if (!report || !mgr) { return; }
    if (finalize && (!mgr.overall_rating || mgr.overall_rating < 1)) { toast.error('Set an overall rating (1–5) before finalizing.'); return; }
    setSaving(true);
    var row = {
      employee_id: empId,
      employee_name: (report.metrics.employee && report.metrics.employee.name) || '',
      reviewer_id: userProfile && userProfile.id,
      reviewer_name: (userProfile && userProfile.name) || '',
      period_start: start, period_end: end,
      metrics: report.metrics,
      ai_narrative: report.narrative || null,
      narrative_final: mgr.narrative || null,
      overall_rating: mgr.overall_rating || null,
      strengths: mgr.strengths || null,
      improvements: mgr.improvements || null,
      goals: mgr.goals || null,
      manager_comments: mgr.manager_comments || null,
      status: finalize ? 'final' : 'draft'
    };
    var op = loadedReviewId
      ? dbUpdate('hr_performance_reviews', loadedReviewId, row, userProfile && userProfile.id)
      : dbInsert('hr_performance_reviews', row, userProfile && userProfile.id);
    Promise.resolve(op).then(function (res) {
      var saved = res && (res.id ? res : (res.data && res.data[0]));
      if (saved && saved.id) { setLoadedReviewId(saved.id); }
      logActivity(userProfile && userProfile.id, (finalize ? 'Finalized' : 'Saved draft') + ' performance review for ' + row.employee_name + ' (' + start + ' → ' + end + ')', 'hr');
      toast.success(finalize ? 'Review finalized.' : 'Draft saved.');
      // refresh history list
      return supabase.from('hr_performance_reviews').select('id, period_start, period_end, overall_rating, status, created_at, reviewer_name').eq('employee_id', empId).order('created_at', { ascending: false }).limit(12);
    }).then(function (r) { if (r) { setPast((r && r.data) || []); } })
      .catch(function (e) { toast.error('Save failed: ' + ((e && e.message) || 'error') + ' — has the NK SQL been run?'); })
      .finally(function () { setSaving(false); });
  }

  function loadPast(id) {
    supabase.from('hr_performance_reviews').select('*').eq('id', id).single().then(function (r) {
      var d = r && r.data; if (!d) { return; }
      setStart(d.period_start); setEnd(d.period_end);
      setReport({ ok: true, metrics: d.metrics, narrative: d.ai_narrative });
      setMgr({ overall_rating: d.overall_rating || 0, strengths: d.strengths || '', improvements: d.improvements || '', goals: d.goals || '', manager_comments: d.manager_comments || '', narrative: d.narrative_final || d.ai_narrative || '' });
      setLoadedReviewId(d.id);
    });
  }

  function printReview() {
    if (!report || !mgr) { return; }
    var m = report.metrics; var a = m.attendance; var t = m.tickets;
    function row(l, v) { return '<tr><td style="padding:3px 10px;border-bottom:1px solid #ddd;color:#333">' + l + '</td><td style="padding:3px 10px;border-bottom:1px solid #ddd;text-align:right;font-weight:700">' + (v == null ? 'n/a' : v) + '</td></tr>'; }
    var stars = ''; var si; for (si = 1; si <= 5; si++) { stars += si <= (mgr.overall_rating || 0) ? '★' : '☆'; }
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>Performance Review — ' + (m.employee.name || '') + '</title></head>'
      + '<body style="font-family:Arial,sans-serif;padding:24px;max-width:800px;margin:auto;color:#111">'
      + '<h1 style="margin:0">Performance Review</h1>'
      + '<div style="color:#555;margin-bottom:14px">' + (m.employee.name || '') + (m.employee.job_title ? ' — ' + m.employee.job_title : '') + ' · Period ' + m.period.start + ' → ' + m.period.end + ' · Reviewer: ' + ((userProfile && userProfile.name) || '') + '</div>'
      + '<div style="font-size:20px;margin-bottom:14px">Overall: <span style="color:#b45309">' + stars + '</span></div>'
      + '<h3>Attendance & Consistency (measured)</h3><table style="width:100%;border-collapse:collapse;font-size:13px">'
      + row('Active days', a.active_days) + row('Average days per week', a.avg_days_per_week)
      + row('Weeks meeting the 6-day mark', a.weeks_meeting_6_days + ' of ' + a.weeks_observed + (a.six_day_adherence_pct != null ? ' (' + a.six_day_adherence_pct + '%)' : ''))
      + row('Total hours in system', a.total_hours) + row('Average hours per active day', a.avg_hours_per_active_day)
      + row('Typical first login (Cairo)', a.avg_first_login_hour_cairo != null ? ('~' + a.avg_first_login_hour_cairo + ':00') : null)
      + row('Longest daily streak', a.longest_daily_streak + ' days') + '</table>'
      + '<h3>Ticket Handling (measured)</h3><table style="width:100%;border-collapse:collapse;font-size:13px">'
      + row('Tickets assigned in period', t.assigned_in_period) + row('Closed', t.closed)
      + row('Closed on or before deadline', t.closed_on_or_before_due + ' of ' + t.closed_with_due_date + (t.on_time_close_pct != null ? ' (' + t.on_time_close_pct + '%)' : ''))
      + row('Average days to close', t.avg_days_to_close) + row('Average first response (hours)', t.avg_first_response_hours)
      + row('Tickets they engaged on', t.tickets_they_commented_on + ' of ' + t.assigned_in_period + (t.engagement_pct != null ? ' (' + t.engagement_pct + '%)' : ''))
      + row('Updates written in period', t.comments_written_in_period)
      + row('Open now / overdue now', t.open_now + ' / ' + t.overdue_open_now) + row('Reopen events', t.reopened_events) + '</table>'
      + '<h3>Review Narrative</h3><div style="white-space:pre-wrap;font-size:13px;line-height:1.5">' + (mgr.narrative || '').replace(/</g, '&lt;') + '</div>'
      + (mgr.strengths ? '<h3>Strengths (manager)</h3><div style="white-space:pre-wrap;font-size:13px">' + mgr.strengths.replace(/</g, '&lt;') + '</div>' : '')
      + (mgr.improvements ? '<h3>Areas to Improve (manager)</h3><div style="white-space:pre-wrap;font-size:13px">' + mgr.improvements.replace(/</g, '&lt;') + '</div>' : '')
      + (mgr.goals ? '<h3>Goals for Next Period</h3><div style="white-space:pre-wrap;font-size:13px">' + mgr.goals.replace(/</g, '&lt;') + '</div>' : '')
      + (mgr.manager_comments ? '<h3>Manager Comments</h3><div style="white-space:pre-wrap;font-size:13px">' + mgr.manager_comments.replace(/</g, '&lt;') + '</div>' : '')
      + '<div style="margin-top:26px;color:#777;font-size:11px">Measured data compiled by KTC NextTrade Hub from system logs; narrative drafted by Jenna (AI HR) from measurements and edited by the reviewer. Generated ' + new Date().toLocaleDateString() + '.</div>'
      + '<script>window.onload=function(){window.print();}<\/script></body></html>';
    var w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); }
  }

  if (!isAdmin) {
    return <div className="p-3 text-xs rounded" style={{ background: '#fef3c7', color: '#1c1917' }}>Performance reviews are for Owners/Admins.</div>;
  }

  var a = report && report.metrics.attendance;
  var t = report && report.metrics.tickets;

  function card(label, value, sub, tone) {
    var tones = { good: { bg: '#dcfce7', tx: '#052e16' }, warn: { bg: '#fef3c7', tx: '#451a03' }, bad: { bg: '#fee2e2', tx: '#450a0a' }, plain: { bg: '#f1f5f9', tx: '#0f172a' } };
    var c = tones[tone || 'plain'];
    return (
      <div className="rounded-lg p-2.5" style={{ background: c.bg, color: c.tx }}>
        <div className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</div>
        <div className="text-lg font-black">{value == null ? '—' : value}</div>
        {sub && <div className="text-[10px] font-semibold opacity-80">{sub}</div>}
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3">
        <div className="text-sm font-extrabold text-slate-900">🧾 Performance Review Center</div>
        <div className="text-[11px] text-slate-500 mt-0.5 mb-2">
          Measured from real logs (logins + tickets), drafted by Jenna, finished by you. Three layers, clearly labelled — the numbers are nobody's opinion.
        </div>
        <div className="flex gap-2 flex-wrap items-end">
          <div>
            <label className="text-[10px] font-bold text-slate-500 block">Team member</label>
            <select value={empId} onChange={function (e) { setEmpId(e.target.value); setReport(null); setMgr(null); setLoadedReviewId(null); }}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold bg-white text-slate-900">
              <option value="">— pick —</option>
              {team.map(function (u) { return <option key={u.id} value={u.id}>{u.name || u.email}</option>; })}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 block">From</label>
            <input type="date" value={start} onChange={function (e) { setStart(e.target.value); }} className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 block">To</label>
            <input type="date" value={end} onChange={function (e) { setEnd(e.target.value); }} className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold" />
          </div>
          <button onClick={function () { var d = new Date(); var y = new Date(d); y.setFullYear(d.getFullYear() - 1); setStart(iso(y)); setEnd(iso(d)); }}
            className="px-2 py-1.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-600">Last 12 months</button>
          <button onClick={generate} disabled={loading}
            className="px-4 py-2 rounded-lg text-xs font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50">
            {loading ? '⏳ Measuring…' : '📊 Generate report'}
          </button>
        </div>
        {past.length > 0 && (
          <div className="mt-2 flex gap-1.5 flex-wrap items-center">
            <span className="text-[10px] font-bold text-slate-400">Past reviews:</span>
            {past.map(function (p) {
              return <button key={p.id} onClick={function () { loadPast(p.id); }}
                className="text-[10px] font-bold px-2 py-0.5 rounded border"
                style={p.status === 'final' ? { background: '#dcfce7', color: '#052e16', borderColor: '#86efac' } : { background: '#f1f5f9', color: '#334155', borderColor: '#cbd5e1' }}>
                {p.period_start} → {p.period_end} {p.status === 'final' ? '✓' : '(draft)'}
              </button>;
            })}
          </div>
        )}
      </div>

      {report && a && t && mgr && (
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-xs font-extrabold text-slate-900 mb-2">
            {report.metrics.employee.name} — {report.metrics.period.start} → {report.metrics.period.end}
          </div>

          <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400 mb-1">1 · Measured — attendance & consistency</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {card('Active days', a.active_days, a.weeks_observed + ' weeks observed', 'plain')}
            {card('Days / week', a.avg_days_per_week, 'target ~6', a.avg_days_per_week >= 5.5 ? 'good' : a.avg_days_per_week >= 4.5 ? 'warn' : 'bad')}
            {card('6-day weeks', (a.six_day_adherence_pct == null ? '—' : a.six_day_adherence_pct + '%'), a.weeks_meeting_6_days + ' of ' + a.weeks_observed + ' weeks', a.six_day_adherence_pct >= 75 ? 'good' : a.six_day_adherence_pct >= 50 ? 'warn' : 'bad')}
            {card('Hours total', a.total_hours, a.avg_hours_per_active_day + 'h avg / day', 'plain')}
            {card('First login', a.avg_first_login_hour_cairo != null ? '~' + a.avg_first_login_hour_cairo + ':00' : '—', 'Cairo time', 'plain')}
            {card('Longest streak', a.longest_daily_streak + 'd', 'consecutive days', 'plain')}
            {card('Sessions', a.total_sessions, null, 'plain')}
          </div>
          {a.monthly.length > 0 && (
            <div className="overflow-auto mb-3">
              <table className="text-[10px] w-full">
                <thead><tr className="text-slate-500 font-bold"><td className="px-2 py-1">Month</td>{a.monthly.map(function (mrow) { return <td key={mrow.month} className="px-2 py-1 text-right">{mrow.month}</td>; })}</tr></thead>
                <tbody>
                  <tr className="font-bold text-slate-800"><td className="px-2 py-1">Days</td>{a.monthly.map(function (mrow) { return <td key={mrow.month} className="px-2 py-1 text-right">{mrow.days}</td>; })}</tr>
                  <tr className="font-bold text-slate-800"><td className="px-2 py-1">Hours</td>{a.monthly.map(function (mrow) { return <td key={mrow.month} className="px-2 py-1 text-right">{mrow.hours}</td>; })}</tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400 mb-1">1 · Measured — ticket handling</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-1">
            {card('Assigned', t.assigned_in_period, t.open_now + ' open now', 'plain')}
            {card('Closed', t.closed, t.avg_days_to_close != null ? t.avg_days_to_close + 'd avg to close' : null, 'plain')}
            {card('On-time closes', t.on_time_close_pct == null ? '—' : t.on_time_close_pct + '%', t.closed_on_or_before_due + ' of ' + t.closed_with_due_date + ' with deadlines', t.on_time_close_pct >= 80 ? 'good' : t.on_time_close_pct >= 55 ? 'warn' : t.on_time_close_pct == null ? 'plain' : 'bad')}
            {card('First response', t.avg_first_response_hours != null ? t.avg_first_response_hours + 'h' : '—', 'average', t.avg_first_response_hours != null && t.avg_first_response_hours <= 8 ? 'good' : 'plain')}
            {card('Engagement', t.engagement_pct == null ? '—' : t.engagement_pct + '%', t.tickets_they_commented_on + ' tickets updated by them', t.engagement_pct >= 70 ? 'good' : 'warn')}
            {card('Updates written', t.comments_written_in_period, 'in period', 'plain')}
            {card('Overdue now', t.overdue_open_now, null, t.overdue_open_now === 0 ? 'good' : 'bad')}
            {card('Reopens', t.reopened_events, null, t.reopened_events === 0 ? 'good' : 'warn')}
          </div>
          {t.closed_close_time_unknown > 0 && (
            <div className="text-[10px] p-2 rounded mb-3" style={{ background: '#fef3c7', color: '#1c1917' }}>
              {t.closed_close_time_unknown} closed ticket(s) have no recorded close moment (closed before status-tracking existed) — they count as closed but are excluded from the on-time percentage rather than guessed.
            </div>
          )}

          <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400 mb-1 mt-2">2 · Jenna's draft — edit freely, it becomes the review narrative</div>
          <textarea value={mgr.narrative} onChange={function (e) { setM('narrative', e.target.value); }} rows={12}
            className="w-full rounded-lg border border-slate-300 p-2 text-xs font-medium text-slate-900 mb-3" placeholder={report.ai_error ? 'Jenna was unavailable — write the narrative here.' : ''} />

          <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400 mb-1">3 · Your input as manager</div>
          <div className="flex items-center gap-1 mb-2">
            <span className="text-[11px] font-bold text-slate-600 mr-1">Overall rating:</span>
            {[1, 2, 3, 4, 5].map(function (n) {
              return <button key={n} onClick={function () { setM('overall_rating', n); }}
                className="text-xl" style={{ color: n <= (mgr.overall_rating || 0) ? '#d97706' : '#cbd5e1' }}>★</button>;
            })}
          </div>
          <div className="grid sm:grid-cols-2 gap-2 mb-2">
            <div>
              <label className="text-[10px] font-bold text-slate-500">Strengths</label>
              <textarea value={mgr.strengths} onChange={function (e) { setM('strengths', e.target.value); }} rows={4} className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500">Areas to improve</label>
              <textarea value={mgr.improvements} onChange={function (e) { setM('improvements', e.target.value); }} rows={4} className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500">Goals for next period</label>
              <textarea value={mgr.goals} onChange={function (e) { setM('goals', e.target.value); }} rows={4} className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500">Manager comments</label>
              <textarea value={mgr.manager_comments} onChange={function (e) { setM('manager_comments', e.target.value); }} rows={4} className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900" />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button onClick={function () { saveReview(false); }} disabled={saving} className="px-4 py-2 rounded-lg text-xs font-extrabold bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50">💾 Save draft</button>
            <button onClick={function () { saveReview(true); }} disabled={saving} className="px-4 py-2 rounded-lg text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">✅ Finalize review</button>
            <button onClick={printReview} className="px-4 py-2 rounded-lg text-xs font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white">🖨 Print / PDF</button>
          </div>
        </div>
      )}
    </div>
  );
}
