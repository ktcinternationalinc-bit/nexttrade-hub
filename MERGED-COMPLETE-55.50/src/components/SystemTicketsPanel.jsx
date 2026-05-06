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

export default function SystemTicketsPanel({ userId, isAdmin, getUserName, sanitize, toast }) {
  var [tickets, setTickets] = useState([]);
  var [loading, setLoading] = useState(true);
  var [showForm, setShowForm] = useState(false);
  var [submitting, setSubmitting] = useState(false);
  var [confirmDel, setConfirmDel] = useState(null);
  var [busyId, setBusyId] = useState(null);
  var [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    category: 'bug',
  });

  var load = useCallback(async function () {
    setLoading(true);
    try {
      var res = await supabase.from('system_tickets').select('*').order('created_at', { ascending: false });
      if (res.error) throw res.error;
      setTickets(res.data || []);
    } catch (e) {
      try { console.warn('[sys-tickets] load failed:', e && e.message); } catch (_) {}
      if (toast) toast.error('Could not load system tickets: ' + ((e && e.message) || 'unknown error'));
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
      if (toast) toast.error('Could not create ticket: ' + msg);
      else alert('Could not create ticket: ' + msg);
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
  var STATS = { Open: 'bg-blue-100 text-blue-700', 'In Progress': 'bg-amber-100 text-amber-700', Resolved: 'bg-emerald-100 text-emerald-700', Fixed: 'bg-emerald-100 text-emerald-700', Reopened: 'bg-rose-100 text-rose-700', Closed: 'bg-slate-100 text-slate-500' };
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

      {showForm && (
        <div className="bg-white rounded-xl p-4 mb-4 border-2 border-red-200">
          <h3 className="text-sm font-bold mb-2">New System Ticket / تذكرة نظام جديدة</h3>
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
                    </div>
                    <div className="text-sm font-bold">{t.title}</div>
                    {t.description && <div className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{t.description}</div>}
                    {t.claude_fix_notes && (
                      <div className="mt-2 p-2 rounded bg-indigo-50 border-l-2 border-indigo-400">
                        <div className="text-[9px] font-bold text-indigo-600 mb-0.5">🤖 CLAUDE NOTES</div>
                        <div className="text-[11px] text-indigo-900 whitespace-pre-wrap">{t.claude_fix_notes}</div>
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 mt-1">
                      {t.created_at ? new Date(t.created_at).toLocaleDateString() : ''} · {(getUserName && getUserName(t.created_by)) || 'Unknown'}
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
