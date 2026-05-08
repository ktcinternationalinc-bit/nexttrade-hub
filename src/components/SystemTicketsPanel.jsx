'use client';
// ============================================================
// SystemTicketsPanel — v55.45 clean rewrite.
//
// What this fixes vs. the inline version that lived in page.jsx:
//
//   1) "+ New System Ticket" button sometimes did nothing because the
//      previous implementation reused the global `formData` state in
//      page.jsx. Other code paths could overwrite formData mid-flight,
//      wiping `showSysTicket`. This component owns its own React state,
//      isolated from page.jsx.
//
//   2) Submit button could fire twice on a double-tap — there was no
//      guard. Now there's a `submitting` flag that disables the button
//      while the insert is in flight, mirroring the comment-double-submit
//      fix from v55.44.
//
//   3) Status / Claude-flag buttons used `window.__sysTicketsLoaded` to
//      trigger reloads, then called `setFormData(prev => ...)` inside the
//      render's IIFE. Setting state during render is React-illegal and
//      can silently misbehave. Now status changes await dbUpdate then
//      call load() — clean React data flow with useState/useEffect.
//
//   4) Added a Delete button (admin-only) with its own confirmation
//      modal rendered INSIDE this component, so there's no risk of the
//      "modal lives in the wrong return block" bug that hit the regular
//      tickets tab.
//
// Props:
//   userId      — current user id (for created_by + audit)
//   isAdmin     — whether to show admin-only buttons (start/resolve/etc.)
//   getUserName — function from page.jsx that maps id → display name
//   sanitize    — optional sanitizer for title/description (XSS guard)
//   toast       — toast helpers (toast.success, toast.error, toast.warning)
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete } from '../lib/supabase';
import { fmtET } from '../lib/et-time';

export default function SystemTicketsPanel({ userId, isAdmin, getUserName, sanitize, toast }) {
  var [tickets, setTickets] = useState([]);
  var [loading, setLoading] = useState(true);
  var [showForm, setShowForm] = useState(false);
  var [submitting, setSubmitting] = useState(false);
  var [confirmDel, setConfirmDel] = useState(null);
  var [busyId, setBusyId] = useState(null);
  // v55.59 — persistent error banner. Toast disappears in 2s, leaving
  // an empty panel and no clue what failed. Now we surface the error
  // visibly so the user knows whether it's a missing-table issue (run
  // SQL), a permissions issue, or a network blip (try again).
  var [loadError, setLoadError] = useState(null);
  var [createError, setCreateError] = useState(null);
  var [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    category: 'bug',
  });

  var load = useCallback(async function () {
    setLoading(true);
    setLoadError(null);
    try {
      var res = await supabase.from('system_tickets').select('*').order('created_at', { ascending: false });
      if (res.error) throw res.error;
      setTickets(res.data || []);
    } catch (e) {
      var rawMsg = (e && e.message) || String(e || 'unknown error');
      try { console.warn('[sys-tickets] load failed:', rawMsg); } catch (_) {}
      // Detect "table does not exist" / "relation does not exist" / "schema cache" — all
      // signs the SQL setup hasn't been run yet. Show a specific, actionable banner.
      var isMissingTable = /does not exist|schema cache|could not find.*table|404|column .* does not exist/i.test(rawMsg);
      setLoadError({
        kind: isMissingTable ? 'missing-table' : 'load-error',
        message: rawMsg,
      });
      if (toast) toast.error('Could not load system tickets — see the panel for details');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(function () { load(); }, [load]);

  var resetForm = function () {
    setForm({ title: '', description: '', priority: 'medium', category: 'bug' });
  };

  var create = async function () {
    // Hard guard against double-submit (button is also visually disabled
    // while submitting — this is belt-and-suspenders).
    if (submitting) return;
    var title = (form.title || '').trim();
    if (!title) {
      if (toast) toast.warning('Title is required / العنوان مطلوب');
      else alert('Title is required');
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      // Number the new ticket sequentially based on the current count.
      // Using count as the suffix is what the previous implementation did;
      // kept identical for continuity (SYS-0001, SYS-0002...).
      var countRes = await supabase.from('system_tickets').select('*', { count: 'exact', head: true });
      var count = (countRes && countRes.count) || 0;
      await dbInsert('system_tickets', {
        ticket_number: 'SYS-' + String(count + 1).padStart(4, '0'),
        title: sanitize ? sanitize(title) : title,
        description: sanitize ? sanitize(form.description || '') : (form.description || ''),
        category: form.category || 'bug',
        priority: form.priority || 'medium',
        status: 'Open',
        created_by: userId || null,
        assigned_to: null,
      }, userId);
      if (toast) toast.success('System ticket created ✓');
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      var msg = (err && err.message) || String(err);
      // v55.59 — Same persistent error pattern as load(). User can see
      // what went wrong without chasing a 2-second toast.
      var isMissingTable = /does not exist|schema cache|could not find.*table|column .* does not exist/i.test(msg);
      setCreateError({
        kind: isMissingTable ? 'missing-table' : 'create-error',
        message: msg,
      });
      if (toast) toast.error('Could not create ticket — see the form for details');
    } finally {
      setSubmitting(false);
    }
  };

  var updateStatus = async function (id, newStatus, alsoFlagClaude) {
    if (busyId) return; // prevent overlapping per-row actions
    setBusyId(id);
    try {
      var updates = { status: newStatus };
      if (alsoFlagClaude) updates.claude_review_requested = true;
      await dbUpdate('system_tickets', id, updates, userId);
      await load();
    } catch (err) {
      var msg = (err && err.message) || String(err);
      if (toast) toast.error(msg); else alert(msg);
    } finally {
      setBusyId(null);
    }
  };

  var toggleClaudeFlag = async function (id, checked) {
    if (busyId) return;
    setBusyId(id);
    try {
      await dbUpdate('system_tickets', id, { claude_review_requested: checked }, userId);
      await load();
    } catch (err) {
      var msg = (err && err.message) || String(err);
      if (toast) toast.error(msg); else alert(msg);
    } finally {
      setBusyId(null);
    }
  };

  var executeDelete = async function () {
    if (!confirmDel) return;
    var id = confirmDel.id;
    setBusyId(id);
    try {
      await dbDelete('system_tickets', id, userId);
      setConfirmDel(null);
      if (toast) toast.success('Deleted');
      await load();
    } catch (err) {
      var msg = (err && err.message) || String(err);
      if (toast) toast.error('Could not delete: ' + msg);
      else alert('Could not delete: ' + msg);
    } finally {
      setBusyId(null);
    }
  };

  // v55.65 — admin marks a ticket as fixed in the next build, with notes.
  // Setting needs_retest=true puts it on the creator's dashboard for retest.
  var [fixModal, setFixModal] = useState(null); // { ticket, version, notes }
  var openFixModal = function (ticket) {
    setFixModal({
      ticket: ticket,
      version: ticket.claude_fixed_in_build_version || '',
      notes: ticket.claude_fix_notes || '',
    });
  };
  var saveFix = async function () {
    if (!fixModal) return;
    if (!fixModal.version || !fixModal.version.trim()) {
      if (toast) toast.warning('Build version required (e.g. v55.65)');
      else alert('Build version required (e.g. v55.65)');
      return;
    }
    var t = fixModal.ticket;
    setBusyId(t.id);
    try {
      var nowIso = new Date().toISOString();
      await dbUpdate('system_tickets', t.id, {
        claude_fixed_in_build_version: fixModal.version.trim(),
        claude_fix_notes: fixModal.notes || null,
        claude_last_fixed_at: nowIso,
        needs_retest: true,
        status: 'Fixed',
        // Once Claude shipped a fix, the "include in next build" flag is done.
        claude_review_requested: false,
        // Reset prior retest result so re-tested tickets re-open the loop.
        retest_completed_at: null,
        retest_completed_by: null,
        retest_outcome: null,
        retest_notes: null,
      }, userId);
      setFixModal(null);
      if (toast) toast.success('Marked as fixed in ' + fixModal.version + ' — creator will see a retest card');
      await load();
    } catch (err) {
      var msg = (err && err.message) || String(err);
      if (toast) toast.error(msg); else alert(msg);
    } finally {
      setBusyId(null);
    }
  };

  // v55.65 — creator marks the fix retested. Outcome: passed / failed / partial.
  var [retestModal, setRetestModal] = useState(null);
  var openRetestModal = function (ticket) {
    setRetestModal({ ticket: ticket, outcome: 'passed', notes: '' });
  };
  var saveRetest = async function () {
    if (!retestModal) return;
    var t = retestModal.ticket;
    setBusyId(t.id);
    try {
      var patch = {
        retest_completed_at: new Date().toISOString(),
        retest_completed_by: userId,
        retest_outcome: retestModal.outcome,
        retest_notes: retestModal.notes || null,
        needs_retest: false,
      };
      // If the fix didn't work, reopen the ticket. If it passed, close it.
      if (retestModal.outcome === 'failed') {
        patch.status = 'Reopened';
        patch.claude_review_requested = true; // back in queue for next session
      } else if (retestModal.outcome === 'passed') {
        patch.status = 'Closed';
      } // 'partial' keeps current status
      await dbUpdate('system_tickets', t.id, patch, userId);
      setRetestModal(null);
      if (toast) {
        if (retestModal.outcome === 'failed') toast.warning('Marked as still broken — back in Claude\'s queue.');
        else if (retestModal.outcome === 'passed') toast.success('Closed — fix verified, thank you for retesting.');
        else toast.success('Saved — partial fix recorded.');
      }
      await load();
    } catch (err) {
      var msg = (err && err.message) || String(err);
      if (toast) toast.error(msg); else alert(msg);
    } finally {
      setBusyId(null);
    }
  };

  // Sort: Claude-flagged first, then Reopened, then Open, In Progress,
  // Resolved/Fixed, then Closed. Within each bucket, newest first.
  var statusOrder = { 'Reopened': 0, 'Open': 1, 'In Progress': 2, 'Resolved': 3, 'Fixed': 3, 'Closed': 4 };
  var sorted = tickets.slice().sort(function (a, b) {
    if (!!a.claude_review_requested !== !!b.claude_review_requested) return a.claude_review_requested ? -1 : 1;
    var sa = statusOrder[a.status] != null ? statusOrder[a.status] : 5;
    var sb = statusOrder[b.status] != null ? statusOrder[b.status] : 5;
    if (sa !== sb) return sa - sb;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  var CATS = { bug: '🐛', feature: '✨', improvement: '📈', question: '❓', urgent: '🚨' };
  var PRIS = { critical: '🚨', high: '🔴', medium: '🟡', low: '🟢' };
  var STATS = { Open: 'bg-blue-100 text-blue-700', 'In Progress': 'bg-amber-100 text-amber-900', Resolved: 'bg-emerald-100 text-emerald-700', Fixed: 'bg-emerald-100 text-emerald-700', Reopened: 'bg-rose-100 text-rose-700', Closed: 'bg-slate-100 text-slate-500' };
  var claudeCount = sorted.filter(function (t) { return t.claude_review_requested; }).length;

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-xl font-extrabold">🐛 System Tickets / تذاكر النظام</h2>
        <button
          onClick={function () { setShowForm(function (s) { return !s; }); }}
          className="px-4 py-2 bg-red-500 text-white rounded-lg text-xs font-bold hover:bg-red-600 transition"
        >
          {showForm ? '✕ Close form' : '+ New System Ticket / تذكرة جديدة'}
        </button>
      </div>
      <div className="text-xs text-slate-400 mb-3">Report bugs, feature requests, and system issues / الإبلاغ عن الأخطاء وطلبات الميزات</div>

      {/* v55.59 — Persistent load-error banner. If the system_tickets table
          doesn't exist or RLS is blocking reads, you used to see a 2-second
          toast then an empty panel forever. Now we show what failed AND
          what to do about it. */}
      {loadError && (
        <div className={'rounded-xl p-4 mb-4 border-2 ' + (loadError.kind === 'missing-table' ? 'bg-amber-50 border-amber-300' : 'bg-rose-50 border-rose-300')}>
          {loadError.kind === 'missing-table' ? (
            <>
              <div className="font-bold text-amber-900 mb-1">⚠️ Database setup required</div>
              <div className="text-xs text-amber-800 mb-3">
                The system_tickets table is missing or has missing columns. To fix, open Supabase → SQL Editor → New query, paste the SQL from <code className="bg-amber-100 px-1 rounded">supabase/system-tickets-setup.sql</code> in the v55.59 zip, click Run. Then refresh this page.
              </div>
              <div className="text-[10px] font-mono bg-amber-100 text-amber-900 p-2 rounded border border-amber-200 break-all">
                Error: {loadError.message}
              </div>
            </>
          ) : (
            <>
              <div className="font-bold text-rose-900 mb-1">❌ Could not load system tickets</div>
              <div className="text-[10px] font-mono bg-rose-100 text-rose-900 p-2 rounded border border-rose-200 break-all mb-2">
                {loadError.message}
              </div>
              <button onClick={load} className="px-3 py-1 bg-rose-500 text-white rounded text-xs font-bold hover:bg-rose-600">
                Try again
              </button>
            </>
          )}
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-xl p-4 mb-4 border-2 border-red-200">
          <h3 className="text-sm font-bold mb-2">New System Ticket / تذكرة نظام جديدة</h3>

          {/* v55.59 — Persistent create-error banner inside the form so
              the user can see exactly why their submission failed without
              losing their typed text. */}
          {createError && (
            <div className={'rounded-lg p-3 mb-3 border ' + (createError.kind === 'missing-table' ? 'bg-amber-50 border-amber-300' : 'bg-rose-50 border-rose-300')}>
              {createError.kind === 'missing-table' ? (
                <>
                  <div className="font-bold text-amber-900 text-xs mb-1">⚠️ Database setup required</div>
                  <div className="text-[11px] text-amber-800">
                    Run <code className="bg-amber-100 px-1 rounded">supabase/system-tickets-setup.sql</code> in Supabase, then try again.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-bold text-rose-900 text-xs mb-1">❌ Could not save</div>
                  <div className="text-[10px] font-mono text-rose-800 break-all">{createError.message}</div>
                </>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 block mb-1">Category / الفئة</label>
              <select value={form.category} onChange={function (e) { setForm(Object.assign({}, form, { category: e.target.value })); }} className="dark-input">
                <option value="bug">🐛 Bug / خطأ</option>
                <option value="feature">✨ Feature Request / ميزة</option>
                <option value="improvement">📈 Improvement / تحسين</option>
                <option value="question">❓ Question / سؤال</option>
                <option value="urgent">🚨 Urgent Fix / إصلاح عاجل</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 block mb-1">Priority / الأولوية</label>
              <select value={form.priority} onChange={function (e) { setForm(Object.assign({}, form, { priority: e.target.value })); }} className="dark-input">
                <option value="low">🟢 Low / منخفض</option>
                <option value="medium">🟡 Medium / متوسط</option>
                <option value="high">🔴 High / عالي</option>
                <option value="critical">🚨 Critical / حرج</option>
              </select>
            </div>
          </div>
          <input
            value={form.title}
            onChange={function (e) { setForm(Object.assign({}, form, { title: e.target.value })); }}
            placeholder="Title / العنوان *"
            className="dark-input mb-3"
            disabled={submitting}
          />
          <textarea
            value={form.description}
            onChange={function (e) { setForm(Object.assign({}, form, { description: e.target.value })); }}
            placeholder="Description — steps to reproduce, expected vs actual behavior&#10;الوصف — خطوات إعادة الإنتاج، السلوك المتوقع مقابل الفعلي"
            rows={4}
            className="dark-input mb-3"
            disabled={submitting}
          />
          <div className="flex gap-2">
            <button
              onClick={create}
              disabled={submitting || !form.title.trim()}
              className={'px-5 py-2.5 rounded-lg text-sm font-bold text-white transition ' + (submitting || !form.title.trim() ? 'bg-slate-400 cursor-not-allowed opacity-60' : 'bg-red-500 hover:bg-red-600')}
            >
              {submitting ? '⏳ Submitting…' : 'Submit / إرسال'}
            </button>
            <button
              onClick={function () { setShowForm(false); resetForm(); }}
              disabled={submitting}
              className="px-4 py-2.5 border-2 border-slate-300 rounded-lg text-sm font-bold hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-center text-slate-400 text-sm py-8">Loading…</div>}

      {!loading && (
        <div className="space-y-2">
          {claudeCount > 0 && (
            <div className="rounded-xl p-3 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200">
              <div className="flex items-center gap-2">
                <span className="text-lg">🤖</span>
                <div className="flex-1">
                  <div className="text-sm font-bold text-indigo-700">{claudeCount} ticket{claudeCount === 1 ? '' : 's'} flagged for Claude to fix next session</div>
                  <div className="text-[11px] text-indigo-600">Claude will pull these automatically at the start of your next chat session.</div>
                </div>
              </div>
            </div>
          )}
          {sorted.length === 0 && claudeCount === 0 && (
            <div className="text-center text-slate-400 text-sm py-8">No system tickets yet / لا توجد تذاكر نظام</div>
          )}
          {sorted.map(function (t) {
            return (
              <div key={t.id} className="bg-white rounded-xl p-4 border border-slate-100">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-mono text-slate-400">{t.ticket_number}</span>
                      <span>{CATS[t.category] || '🐛'}</span>
                      <span>{PRIS[t.priority] || '🟡'}</span>
                      <span className={'px-2 py-0.5 rounded text-[10px] font-bold ' + (STATS[t.status] || STATS.Open)}>{t.status}</span>
                      {t.claude_review_requested && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">🤖 Claude review requested</span>}
                      {t.claude_last_fixed_at && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700" title={'Fixed by Claude: ' + t.claude_last_fixed_at}>✨ Claude-fixed</span>}
                      {t.claude_fixed_in_build_version && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-800" title="Build version where the fix shipped">📦 {t.claude_fixed_in_build_version}</span>}
                      {t.needs_retest && t.created_by === userId && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 animate-pulse" title="Please retest this fix">🔁 Please retest</span>}
                      {t.retest_outcome === 'passed' && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">✓ Retested OK</span>}
                      {t.retest_outcome === 'failed' && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">✗ Retest failed</span>}
                      {t.retest_outcome === 'partial' && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">~ Partial</span>}
                    </div>
                    <div className="text-sm font-bold">{t.title}</div>
                    {t.description && <div className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{t.description}</div>}
                    {t.claude_fix_notes && (
                      <div className="mt-2 p-2 rounded bg-indigo-50 border-l-2 border-indigo-400">
                        <div className="text-[9px] font-bold text-indigo-600 mb-0.5">🤖 CLAUDE NOTES{t.claude_fixed_in_build_version ? ' · shipped in ' + t.claude_fixed_in_build_version : ''}</div>
                        <div className="text-[11px] text-indigo-900 whitespace-pre-wrap">{t.claude_fix_notes}</div>
                      </div>
                    )}
                    {t.retest_notes && (
                      <div className={'mt-2 p-2 rounded border-l-2 ' + (t.retest_outcome === 'passed' ? 'bg-emerald-50 border-emerald-400' : t.retest_outcome === 'failed' ? 'bg-rose-50 border-rose-400' : 'bg-amber-50 border-amber-400')}>
                        <div className="text-[9px] font-bold mb-0.5">RETEST NOTES · {(getUserName && getUserName(t.retest_completed_by)) || 'creator'}</div>
                        <div className="text-[11px] whitespace-pre-wrap">{t.retest_notes}</div>
                      </div>
                    )}
                    <div className="text-[10px] text-slate-500 mt-1">
                      {t.created_at ? fmtET(t.created_at, 'shortdate') : ''} · {(getUserName && getUserName(t.created_by)) || 'Unknown'}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0 ml-2">
                    {isAdmin && (
                      <label className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 cursor-pointer select-none px-2 py-1 rounded hover:bg-indigo-50">
                        <input
                          type="checkbox"
                          checked={!!t.claude_review_requested}
                          disabled={busyId === t.id}
                          onChange={function (e) { toggleClaudeFlag(t.id, e.target.checked); }}
                        />
                        🤖 Fix next session
                      </label>
                    )}
                    {/* v55.65 — admin "Mark fixed in build" button. Opens the
                        modal that takes a build version + fix notes, sets
                        needs_retest=true so creator gets the dashboard card. */}
                    {isAdmin && t.status !== 'Closed' && (
                      <button
                        onClick={function () { openFixModal(t); }}
                        disabled={busyId === t.id}
                        title="Mark this ticket as fixed in a specific build version + add test notes"
                        className="px-2 py-1 bg-violet-600 text-white rounded text-[10px] font-bold disabled:opacity-50 hover:bg-violet-700">
                        📦 Mark fixed in build
                      </button>
                    )}
                    {/* v55.65 — creator's retest button (only visible to the
                        person who originally filed the ticket, only when
                        needs_retest is true). */}
                    {t.needs_retest && t.created_by === userId && (
                      <button
                        onClick={function () { openRetestModal(t); }}
                        disabled={busyId === t.id}
                        title="Confirm whether the fix worked"
                        className="px-2 py-1 bg-amber-500 text-white rounded text-[10px] font-bold disabled:opacity-50 hover:bg-amber-600">
                        🔁 Retest now
                      </button>
                    )}
                    {isAdmin && t.status !== 'Closed' && (
                      <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
                        {t.status === 'Open' && (
                          <button onClick={function () { updateStatus(t.id, 'In Progress'); }} disabled={busyId === t.id} className="px-2 py-1 bg-amber-500 text-white rounded text-[10px] disabled:opacity-50">Start</button>
                        )}
                        {(t.status === 'Open' || t.status === 'In Progress') && (
                          <button onClick={function () { updateStatus(t.id, 'Resolved'); }} disabled={busyId === t.id} className="px-2 py-1 bg-emerald-500 text-white rounded text-[10px] disabled:opacity-50">Resolve</button>
                        )}
                        <button onClick={function () { updateStatus(t.id, 'Closed'); }} disabled={busyId === t.id} className="px-2 py-1 bg-slate-500 text-white rounded text-[10px] disabled:opacity-50">Close</button>
                      </div>
                    )}
                    {isAdmin && (t.status === 'Closed' || t.status === 'Resolved' || t.status === 'Fixed') && (
                      <button onClick={function () { updateStatus(t.id, 'Reopened', true); }} disabled={busyId === t.id} className="px-2 py-1 bg-rose-500 text-white rounded text-[10px] disabled:opacity-50">Reopen</button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={function () { setConfirmDel(t); }}
                        disabled={busyId === t.id}
                        title="Delete this system ticket"
                        className="px-2 py-1 border border-red-200 text-red-500 rounded text-[10px] hover:bg-red-50 disabled:opacity-50"
                      >
                        🗑 Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* v55.65 — Mark fixed in build modal */}
      {fixModal && (
        <div className="fixed inset-0 bg-black/50 z-[260] flex items-center justify-center p-4" onClick={function () { setFixModal(null); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={function (e) { e.stopPropagation(); }}>
            <h3 className="text-lg font-extrabold text-slate-900 mb-1">📦 Mark fixed in build</h3>
            <p className="text-xs text-slate-500 mb-4">"{fixModal.ticket.title}"</p>
            <div className="mb-3">
              <label className="text-[10px] font-bold text-slate-700 block mb-1">Build version</label>
              <input
                value={fixModal.version}
                onChange={function (e) { setFixModal(Object.assign({}, fixModal, { version: e.target.value })); }}
                placeholder="e.g. v55.65"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
            <div className="mb-3">
              <label className="text-[10px] font-bold text-slate-700 block mb-1">Fix notes / test instructions for the creator</label>
              <textarea
                value={fixModal.notes}
                onChange={function (e) { setFixModal(Object.assign({}, fixModal, { notes: e.target.value })); }}
                placeholder="What was the cause, what was changed, and how to verify."
                rows={5}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
              />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded p-2 text-[10px] text-amber-800 mb-3">
              ⓘ The creator ({(getUserName && getUserName(fixModal.ticket.created_by)) || 'unknown'}) will see a "Please retest" card on their dashboard, and the fix will appear in the build's What's New highlights.
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={function () { setFixModal(null); }} className="px-3 py-2 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
              <button onClick={saveFix} disabled={busyId === fixModal.ticket.id} className="px-4 py-2 bg-violet-600 text-white rounded text-sm font-bold hover:bg-violet-700 disabled:opacity-50">Save & notify creator</button>
            </div>
          </div>
        </div>
      )}

      {/* v55.65 — Retest modal */}
      {retestModal && (
        <div className="fixed inset-0 bg-black/50 z-[260] flex items-center justify-center p-4" onClick={function () { setRetestModal(null); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={function (e) { e.stopPropagation(); }}>
            <h3 className="text-lg font-extrabold text-slate-900 mb-1">🔁 Retest this fix</h3>
            <p className="text-xs text-slate-500 mb-3">"{retestModal.ticket.title}"</p>
            {retestModal.ticket.claude_fix_notes && (
              <div className="bg-indigo-50 border-l-2 border-indigo-400 p-2 rounded mb-3 text-[11px] text-indigo-900 whitespace-pre-wrap">
                <div className="font-bold text-[9px] text-indigo-600 mb-1">CLAUDE'S NOTES</div>
                {retestModal.ticket.claude_fix_notes}
              </div>
            )}
            <div className="mb-3">
              <label className="text-[10px] font-bold text-slate-700 block mb-1">How did the fix work?</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { v: 'passed', l: '✓ Works perfectly', cls: { active: 'border-emerald-500 bg-emerald-50 text-emerald-700' } },
                  { v: 'partial', l: '~ Partly works',   cls: { active: 'border-amber-500 bg-amber-50 text-amber-700' } },
                  { v: 'failed', l: '✗ Still broken',    cls: { active: 'border-rose-500 bg-rose-50 text-rose-700' } },
                ].map(function (o) {
                  return (
                    <button
                      key={o.v}
                      onClick={function () { setRetestModal(Object.assign({}, retestModal, { outcome: o.v })); }}
                      className={'px-3 py-2 rounded text-xs font-bold border-2 ' + (retestModal.outcome === o.v ? o.cls.active : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                      {o.l}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mb-3">
              <label className="text-[10px] font-bold text-slate-700 block mb-1">Notes (optional)</label>
              <textarea
                value={retestModal.notes}
                onChange={function (e) { setRetestModal(Object.assign({}, retestModal, { notes: e.target.value })); }}
                placeholder={retestModal.outcome === 'failed' ? 'What\'s still broken? Reproduction steps help Claude fix it next session.' : 'Any context for the team.'}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
            <div className={'rounded p-2 text-[10px] mb-3 ' + (retestModal.outcome === 'failed' ? 'bg-rose-50 text-rose-800' : retestModal.outcome === 'passed' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>
              {retestModal.outcome === 'failed' && 'ⓘ Submitting will reopen the ticket and put it back in Claude\'s queue.'}
              {retestModal.outcome === 'passed' && 'ⓘ Submitting will close the ticket. Thank you for closing the loop!'}
              {retestModal.outcome === 'partial' && 'ⓘ Submitting will record the partial result without closing the ticket.'}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={function () { setRetestModal(null); }} className="px-3 py-2 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
              <button onClick={saveRetest} disabled={busyId === retestModal.ticket.id} className="px-4 py-2 bg-amber-500 text-white rounded text-sm font-bold hover:bg-amber-600 disabled:opacity-50">Submit retest</button>
            </div>
          </div>
        </div>
      )}

      {/* v55.45 — Delete confirm modal lives INSIDE this component, so there's
          no risk of the "modal in wrong return block" issue that hit the
          regular tickets tab. */}
      {confirmDel && (
        <div className="fixed inset-0 bg-black/50 z-[250] flex items-center justify-center p-4" onClick={function () { setConfirmDel(null); }}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl" onClick={function (e) { e.stopPropagation(); }}>
            <h3 className="text-lg font-bold mb-2 text-red-600">🗑 Delete System Ticket</h3>
            <p className="text-sm text-slate-600 mb-1">Permanently delete <b>{confirmDel.ticket_number}</b>:</p>
            <p className="text-sm font-bold mb-4">"{confirmDel.title}"</p>
            <p className="text-xs text-red-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={function () { setConfirmDel(null); }} disabled={busyId === confirmDel.id} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold disabled:opacity-50">Cancel</button>
              <button
                onClick={executeDelete}
                disabled={busyId === confirmDel.id}
                className={'px-4 py-2 rounded-lg text-sm font-bold text-white ' + (busyId === confirmDel.id ? 'bg-red-300 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600')}
              >
                {busyId === confirmDel.id ? '⏳ Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
