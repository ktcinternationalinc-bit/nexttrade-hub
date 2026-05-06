'use client';
// WhatsAppInbox.jsx — v55.37
// ===========================
// The full WhatsApp inbox UI. Three columns conceptually:
//
//   LEFT  (1/3 width): list of conversations, sortable & filterable
//   RIGHT (2/3 width): message thread for the selected conversation
//                      with a compose box at the bottom
//
// Behaviors:
//   • Live polling — refreshes the conversation list every 20s and
//     the open thread every 15s so new inbound messages show without
//     manual reload.
//   • Claim / release — anyone can claim an unclaimed conversation;
//     the claimed-by indicator shows whose territory it is, but
//     anyone can still reply.
//   • 24-hour window awareness — when the customer's last inbound
//     was more than 24 hours ago, free-text replies are blocked by
//     Meta's policy. We grey out the compose box and prompt to
//     start a template instead.
//   • Read indicator — after opening a conversation, unread_count
//     is reset via /api/whatsapp/conversations/[id]/read.
//   • Diagnostic banner — if the system isn't configured (env vars
//     missing), shows a clear "Connect WhatsApp to start" prompt
//     instead of a broken-looking empty state.

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const FILTERS = [
  ['all', 'All'],
  ['mine', 'Mine'],
  ['unclaimed', 'Unclaimed'],
  ['unread', 'Unread'],
];

const POLL_LIST_MS = 20000;
const POLL_THREAD_MS = 15000;

export default function WhatsAppInbox({ user, userProfile, customers }) {
  const [conversations, setConversations] = useState([]);
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [thread, setThread] = useState({ conversation: null, messages: [] });
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [diag, setDiag] = useState(null);
  const [error, setError] = useState('');
  const [showStart, setShowStart] = useState(false);
  const messagesEndRef = useRef(null);

  const myId = userProfile?.id || user?.id;
  const isSuperAdmin = userProfile?.role === 'super_admin';

  // ---- AUTH FETCH HELPER ----
  // Every API route checks the session, so we must forward the bearer.
  const authedFetch = useCallback(async (url, init) => {
    const initOpts = init || {};
    const headers = Object.assign({}, initOpts.headers || {});
    try {
      const sess = await supabase.auth.getSession();
      const token = sess && sess.data && sess.data.session && sess.data.session.access_token;
      if (token) headers['Authorization'] = 'Bearer ' + token;
    } catch (_) { /* unauthenticated → API will reject */ }
    if (initOpts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(url, Object.assign({}, initOpts, { headers }));
  }, []);

  // ---- LOAD CONVERSATION LIST ----
  const loadList = useCallback(async () => {
    setError('');
    try {
      const res = await authedFetch('/api/whatsapp/conversations?filter=' + encodeURIComponent(filter));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load conversations');
      setConversations(data.conversations || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [authedFetch, filter]);

  // ---- LOAD ONE THREAD ----
  const loadThread = useCallback(async (id) => {
    if (!id) { setThread({ conversation: null, messages: [] }); return; }
    setThreadLoading(true);
    setError('');
    try {
      const res = await authedFetch('/api/whatsapp/conversations/' + id);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load thread');
      setThread({ conversation: data.conversation, messages: data.messages });
      // Mark read in the background
      if (data.conversation && data.conversation.unread_count > 0) {
        authedFetch('/api/whatsapp/conversations/' + id + '/read', { method: 'POST', body: JSON.stringify({}) }).catch(function () {});
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setThreadLoading(false);
    }
  }, [authedFetch]);

  // ---- LOAD DIAGNOSTIC ----
  const loadDiagnostic = useCallback(async () => {
    try {
      const res = await authedFetch('/api/whatsapp/diagnostic');
      const data = await res.json();
      if (res.ok) setDiag(data);
    } catch (_) {}
  }, [authedFetch]);

  // ---- INITIAL LOAD ----
  useEffect(() => {
    setLoading(true);
    loadList();
    loadDiagnostic();
  }, [filter, loadList, loadDiagnostic]);

  // ---- LIST POLLING ----
  useEffect(() => {
    const tick = setInterval(function () { loadList(); }, POLL_LIST_MS);
    return function () { clearInterval(tick); };
  }, [loadList]);

  // ---- THREAD POLLING (only when one is open) ----
  useEffect(() => {
    if (!selectedId) return undefined;
    loadThread(selectedId);
    const tick = setInterval(function () { loadThread(selectedId); }, POLL_THREAD_MS);
    return function () { clearInterval(tick); };
  }, [selectedId, loadThread]);

  // ---- AUTO-SCROLL THREAD TO BOTTOM ON NEW MESSAGE ----
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [thread.messages.length]);

  // ---- ACTIONS ----
  const claim = async () => {
    if (!selectedId) return;
    try {
      const res = await authedFetch('/api/whatsapp/conversations/' + selectedId + '/claim', {
        method: 'POST', body: JSON.stringify({ action: 'claim' }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || 'Claim failed');
      }
      await Promise.all([loadList(), loadThread(selectedId)]);
    } catch (e) { setError(e.message); }
  };

  const release = async () => {
    if (!selectedId) return;
    try {
      const res = await authedFetch('/api/whatsapp/conversations/' + selectedId + '/claim', {
        method: 'POST', body: JSON.stringify({ action: 'release' }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || 'Release failed');
      }
      await Promise.all([loadList(), loadThread(selectedId)]);
    } catch (e) { setError(e.message); }
  };

  const sendReply = async () => {
    if (!selectedId || !composeBody.trim()) return;
    setSending(true);
    setError('');
    try {
      const res = await authedFetch('/api/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({ conversation_id: selectedId, body: composeBody.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');
      setComposeBody('');
      await Promise.all([loadList(), loadThread(selectedId)]);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  // ---- RENDER ----
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Diagnostic banner if not configured */}
      {diag && !diag.env_configured && (
        <div className="bg-amber-50 border-b border-amber-300 p-3 text-xs">
          <div className="font-bold text-amber-900 mb-1">⚠️ WhatsApp not fully configured</div>
          <div className="text-amber-800">
            Some required environment variables are missing. Conversations will load but you can't send or receive yet.
            Missing: {Object.entries(diag.env || {}).filter(([_, v]) => !v).map(([k]) => k).join(', ') || 'none'}.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 min-h-[600px] max-h-[80vh]">
        {/* ---------- LEFT: Conversation list ---------- */}
        <div className="md:col-span-1 border-r border-slate-200 flex flex-col bg-slate-50">
          <div className="p-3 border-b border-slate-200 bg-white">
            <div className="flex items-center justify-between mb-2">
              <div className="font-extrabold text-sm text-slate-800">💬 Inbox</div>
              <button
                onClick={() => setShowStart(true)}
                className="text-[10px] px-2 py-1 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700"
                title="Start a new conversation with someone we haven't messaged"
              >
                + New
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setFilter(v)}
                  className={'text-[10px] px-2 py-1 rounded font-semibold ' +
                    (filter === v ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300')}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && conversations.length === 0 && (
              <div className="text-center text-slate-400 text-xs py-8">Loading…</div>
            )}
            {!loading && conversations.length === 0 && (
              <div className="text-center text-slate-400 text-xs py-8">
                No conversations {filter !== 'all' ? '(in this filter)' : 'yet'}.
              </div>
            )}
            {conversations.map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                selected={c.id === selectedId}
                myId={myId}
                onSelect={() => setSelectedId(c.id)}
              />
            ))}
          </div>
        </div>

        {/* ---------- RIGHT: Message thread + compose ---------- */}
        <div className="md:col-span-2 flex flex-col">
          {!selectedId && (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Select a conversation to read messages.
            </div>
          )}

          {selectedId && thread.conversation && (
            <>
              <ThreadHeader
                conv={thread.conversation}
                myId={myId}
                isSuperAdmin={isSuperAdmin}
                onClaim={claim}
                onRelease={release}
              />

              <div className="flex-1 overflow-y-auto bg-slate-50 p-4 space-y-2">
                {threadLoading && thread.messages.length === 0 && (
                  <div className="text-center text-slate-400 text-xs py-8">Loading messages…</div>
                )}
                {!threadLoading && thread.messages.length === 0 && (
                  <div className="text-center text-slate-400 text-xs py-8">No messages yet.</div>
                )}
                {thread.messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
                <div ref={messagesEndRef} />
              </div>

              <ComposeBox
                inWindow={thread.conversation.in_window}
                composeBody={composeBody}
                setComposeBody={setComposeBody}
                sending={sending}
                onSend={sendReply}
                onStartTemplate={() => setShowStart(true)}
              />
            </>
          )}
        </div>
      </div>

      {/* Error toast */}
      {error && (
        <div className="bg-rose-50 border-t border-rose-200 p-2 text-xs text-rose-800">
          ⚠️ {error}
          <button onClick={() => setError('')} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Start-new-conversation modal */}
      {showStart && (
        <StartConversationModal
          customers={customers || []}
          authedFetch={authedFetch}
          onClose={() => setShowStart(false)}
          onStarted={async (newConversationId) => {
            setShowStart(false);
            await loadList();
            setSelectedId(newConversationId);
          }}
        />
      )}
    </div>
  );
}

// =====================================================================
// SUBCOMPONENTS
// =====================================================================

function ConversationRow({ conv, selected, myId, onSelect }) {
  const displayName = conv.customer_name || conv.display_name || conv.customer_wa_id;
  const isMine = conv.assigned_to === myId;
  const isUnclaimed = !conv.assigned_to;
  const tsLabel = conv.last_inbound_at || conv.last_outbound_at;
  const ago = tsLabel ? timeAgo(new Date(tsLabel)) : '';
  return (
    <button
      onClick={onSelect}
      className={'w-full text-left p-3 border-b border-slate-200 transition ' +
        (selected ? 'bg-emerald-100' : 'hover:bg-white')}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="font-bold text-sm text-slate-800 truncate flex-1">
          {conv.is_pinned && <span className="mr-1">📌</span>}
          {displayName}
        </div>
        <div className="text-[10px] text-slate-500 whitespace-nowrap">{ago}</div>
      </div>
      <div className="text-[10px] text-slate-500 truncate">{conv.customer_wa_id}</div>
      <div className="flex items-center justify-between mt-1">
        <div className="text-[11px] text-slate-600 truncate flex-1 mr-2">
          {conv.last_message_direction === 'outbound' && <span className="text-slate-400">↗ </span>}
          {conv.last_message_preview || '(no messages yet)'}
        </div>
        <div className="flex items-center gap-1">
          {conv.unread_count > 0 && (
            <span className="bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
              {conv.unread_count}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-1 mt-1">
        {isMine && <span className="text-[9px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-semibold">Mine</span>}
        {isUnclaimed && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold">Unclaimed</span>}
        {!isMine && !isUnclaimed && conv.assigned_to_name && (
          <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">→ {conv.assigned_to_name}</span>
        )}
        {!conv.in_window && (
          <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-semibold" title="24-hour reply window has expired">
            ⏰ window expired
          </span>
        )}
      </div>
    </button>
  );
}

function ThreadHeader({ conv, myId, isSuperAdmin, onClaim, onRelease }) {
  const displayName = conv.customer_name || conv.display_name || conv.customer_wa_id;
  const isMine = conv.assigned_to === myId;
  const isUnclaimed = !conv.assigned_to;
  return (
    <div className="border-b border-slate-200 p-3 bg-white flex items-center justify-between gap-2 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="font-extrabold text-base text-slate-800 truncate">{displayName}</div>
        <div className="text-[11px] text-slate-500">{conv.customer_wa_id}</div>
        {conv.assigned_to_name && (
          <div className="text-[10px] text-slate-500 mt-0.5">
            Claimed by: <strong>{isMine ? 'you' : conv.assigned_to_name}</strong>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        {isUnclaimed && (
          <button onClick={onClaim} className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700">
            Claim
          </button>
        )}
        {isMine && (
          <button onClick={onRelease} className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">
            Release
          </button>
        )}
        {!isMine && !isUnclaimed && (isSuperAdmin) && (
          <button onClick={onClaim} className="text-xs px-3 py-1.5 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700"
            title="Take over this conversation (super admin)">
            Take over
          </button>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isOut = msg.direction === 'outbound';
  const isFailed = msg.status === 'failed';
  const status = msg.status;
  return (
    <div className={'flex ' + (isOut ? 'justify-end' : 'justify-start')}>
      <div className={'max-w-[70%] rounded-lg p-2.5 text-sm ' +
        (isFailed ? 'bg-rose-100 border border-rose-300 text-rose-900'
          : isOut ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-800')}>
        {msg.message_type === 'template' && (
          <div className={'text-[9px] font-bold uppercase mb-1 ' + (isOut ? 'text-emerald-100' : 'text-slate-400')}>
            Template: {msg.template_name}
          </div>
        )}
        {msg.media_url && (
          <div className="mb-1">
            {msg.media_mime_type && msg.media_mime_type.indexOf('image') === 0
              ? <img src={msg.media_url} alt="" className="max-w-full rounded" />
              : <a href={msg.media_url} target="_blank" rel="noreferrer" className="underline text-[11px]">
                  📎 {msg.media_filename || 'attachment'}
                </a>}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">{msg.body}</div>
        <div className={'text-[9px] mt-1 ' + (isOut ? 'text-emerald-100' : 'text-slate-400')}>
          {formatMsgTime(msg.created_at)}
          {isOut && <span className="ml-2">{statusIcon(status)}</span>}
          {isFailed && msg.error_message && <span className="block mt-1 text-[10px]">{msg.error_message}</span>}
          {isOut && msg.sent_by_name && <span className="ml-2">· {msg.sent_by_name}</span>}
        </div>
      </div>
    </div>
  );
}

function ComposeBox({ inWindow, composeBody, setComposeBody, sending, onSend, onStartTemplate }) {
  if (!inWindow) {
    return (
      <div className="border-t border-slate-200 p-3 bg-orange-50">
        <div className="text-xs text-orange-900 font-semibold mb-2">
          ⏰ The 24-hour reply window has expired.
        </div>
        <div className="text-[11px] text-orange-800 mb-2">
          To re-engage this customer, you must use an approved template.
        </div>
        <button
          onClick={onStartTemplate}
          className="text-xs px-3 py-1.5 rounded bg-orange-600 text-white font-semibold hover:bg-orange-700"
        >
          Send a template message
        </button>
      </div>
    );
  }
  return (
    <div className="border-t border-slate-200 p-3 bg-white">
      <div className="flex gap-2 items-end">
        <textarea
          value={composeBody}
          onChange={e => setComposeBody(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Type a reply… (⌘/Ctrl+Enter to send)"
          rows={2}
          className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-300"
          disabled={sending}
        />
        <button
          onClick={onSend}
          disabled={sending || !composeBody.trim()}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function StartConversationModal({ customers, authedFetch, onClose, onStarted }) {
  const [phone, setPhone] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [variables, setVariables] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!phone.trim() || !templateName.trim()) {
      setErr('Phone and template name are required.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const vars = variables.split(',').map(s => s.trim()).filter(Boolean);
      const res = await authedFetch('/api/whatsapp/start', {
        method: 'POST',
        body: JSON.stringify({
          to: phone.trim(),
          template_name: templateName.trim(),
          variables: vars,
          customer_id: customerId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start conversation');
      onStarted(data.conversation_id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-5 max-w-md w-full">
        <div className="flex justify-between items-start mb-3">
          <div className="font-extrabold text-base">Start new WhatsApp conversation</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="text-[11px] text-slate-500 mb-3">
          Required: a Meta-approved template name. Free-text messages are only allowed within 24h of the customer's last reply.
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-xs font-semibold text-slate-700 block">Phone (E.164, e.g. +201234567890)</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300 text-sm"
              placeholder="+201234567890"
              disabled={busy}
            />
          </div>
          {customers && customers.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-slate-700 block">Link to CRM customer (optional)</label>
              <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                className="w-full px-3 py-2 rounded border border-slate-300 text-sm" disabled={busy}>
                <option value="">— none —</option>
                {customers.slice(0, 200).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-slate-700 block">Template name</label>
            <input
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300 text-sm"
              placeholder="e.g. shipping_update"
              disabled={busy}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block">Variables (comma-separated, fills {'{{1}}, {{2}}'} ...)</label>
            <input
              value={variables}
              onChange={e => setVariables(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300 text-sm"
              placeholder="Joe, ABC123"
              disabled={busy}
            />
          </div>
        </div>
        {err && <div className="text-xs text-rose-700 bg-rose-50 rounded p-2 mt-2">{err}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={busy} className="text-xs px-3 py-2 rounded border border-slate-300 text-slate-700">Cancel</button>
          <button onClick={submit} disabled={busy} className="text-xs px-4 py-2 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Sending…' : 'Send template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- helpers ----
function timeAgo(d) {
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd';
  return d.toLocaleDateString();
}
function formatMsgTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function statusIcon(s) {
  if (s === 'sending') return '🕒';
  if (s === 'sent') return '✓';
  if (s === 'delivered') return '✓✓';
  if (s === 'read') return '✓✓ read';
  if (s === 'failed') return '⚠️';
  return '';
}
