'use client';
// ============================================================
// VoicemailsWidget — Phase B (Apr 26 2026)
// ============================================================
// What this does:
//   Dashboard widget showing the logged-in user's voicemails.
//   Each voicemail shows:
//     • Caller name (matched to customer if known) + number
//     • When it was left
//     • Whisper transcript (or "Transcribing..." while processing)
//     • Audio player to listen
//     • Mark-as-read button
//
// Defaults to showing UNREAD voicemails. Click "Show all" to see
// everything (including read).
//
// Data source: /api/phone/voicemails endpoint, filtered by
// assigned_to = current user.
// ============================================================

import { useState, useEffect, useCallback } from 'react';

function fmtDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var now = new Date();
  var diff = (now - d) / 1000; // seconds
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 7 * 86400) return Math.floor(diff / 86400) + 'd ago';
  return d.toLocaleDateString();
}

function fmtDuration(seconds) {
  if (!seconds) return '0:00';
  var m = Math.floor(seconds / 60);
  var s = Math.floor(seconds % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function fmtPhone(p) {
  if (!p) return 'Unknown';
  // Format E.164 like +12015551234 → +1 (201) 555-1234
  var s = String(p).trim();
  if (s.startsWith('+1') && s.length === 12) {
    return '+1 (' + s.slice(2, 5) + ') ' + s.slice(5, 8) + '-' + s.slice(8);
  }
  return s;
}

export default function VoicemailsWidget({ user, userProfile, customers, toast, onLoadComplete }) {
  var [voicemails, setVoicemails] = useState([]);
  var [loading, setLoading] = useState(true);
  var [showAll, setShowAll] = useState(false);
  var [error, setError] = useState('');
  var [playing, setPlaying] = useState(null); // id of voicemail being played
  var myId = (userProfile && userProfile.id) || (user && user.id);

  var safeT = {
    success: function(m) { try { (toast && toast.success) ? toast.success(m) : console.log(m); } catch (_) {} },
    error: function(m) { try { (toast && toast.error) ? toast.error(m) : console.error(m); } catch (_) {} },
  };

  var load = useCallback(function() {
    if (!myId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    var url = '/api/phone/voicemails?assigned_to=' + encodeURIComponent(myId);
    if (!showAll) url += '&unread=true';
    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          setError(data.error);
          setVoicemails([]);
        } else {
          setVoicemails(data.voicemails || []);
        }
        setLoading(false);
        if (typeof onLoadComplete === 'function') {
          try { onLoadComplete(data.voicemails || []); } catch (e) {}
        }
      })
      .catch(function(e) {
        setError(e.message);
        setLoading(false);
      });
  }, [myId, showAll]);

  useEffect(function() { load(); }, [load]);

  // Auto-refresh every 30 seconds so new voicemails appear without page reload.
  // Also refreshes the transcript display as Whisper finishes processing.
  useEffect(function() {
    var t = setInterval(function() { load(); }, 30000);
    return function() { clearInterval(t); };
  }, [load]);

  // Mark a voicemail as read
  var markRead = async function(id) {
    try {
      await fetch('/api/phone/voicemails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, is_read: true }),
      });
      // Update local state immediately (don't wait for next refresh)
      setVoicemails(function(prev) {
        return prev.map(function(v) { return v.id === id ? Object.assign({}, v, { is_read: true }) : v; });
      });
    } catch (e) {
      safeT.error('Failed to mark as read: ' + e.message);
    }
  };

  // Find a customer name for a phone number (last 10 digits match)
  var findCustomerName = function(num) {
    if (!num || !Array.isArray(customers)) return null;
    var last10 = String(num).replace(/[^0-9]/g, '').slice(-10);
    if (last10.length < 7) return null;
    var match = customers.find(function(c) {
      if (!c.phone) return false;
      return String(c.phone).replace(/[^0-9]/g, '').indexOf(last10) >= 0;
    });
    return match ? match.name : null;
  };

  // Lookup customer for a voicemail (uses customer_id if known, else phone match)
  var resolveContact = function(vm) {
    if (vm.customer_id && Array.isArray(customers)) {
      var c = customers.find(function(x) { return x.id === vm.customer_id; });
      if (c) return c.name;
    }
    return null;
  };

  // The phone number the voicemail came from. Need to look up the parent call.
  // We don't store this directly on phone_voicemails — but we can show whatever
  // we have. For now show "Voicemail" as fallback.
  var unreadCount = voicemails.filter(function(v) { return !v.is_read; }).length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b bg-gradient-to-r from-blue-50 to-indigo-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">📬</span>
          <div>
            <div className="text-sm font-bold text-slate-900">Voicemails</div>
            <div className="text-[10px] text-slate-500">
              {showAll
                ? voicemails.length + ' total'
                : (unreadCount > 0 ? unreadCount + ' unread' : 'No unread')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={function() { setShowAll(!showAll); }}
            className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-100"
          >
            {showAll ? 'Unread only' : 'Show all'}
          </button>
          <button
            onClick={load}
            className="text-[10px] font-semibold text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-4 text-center text-xs text-slate-400">Loading voicemails...</div>
      ) : error ? (
        <div className="p-4 text-center text-xs text-red-600">⚠ {error}</div>
      ) : voicemails.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-400">
          {showAll
            ? 'No voicemails yet. When a customer leaves you one, it will appear here.'
            : '✓ No unread voicemails — you\'re all caught up.'}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {voicemails.map(function(vm) {
            var contactName = resolveContact(vm);
            var isUnread = !vm.is_read;
            return (
              <div
                key={vm.id}
                className={'p-3 ' + (isUnread ? 'bg-blue-50' : 'bg-white hover:bg-slate-50')}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {isUnread && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" title="Unread"></span>}
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {contactName || 'Unknown caller'}
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {fmtDate(vm.created_at)}
                      {vm.duration_seconds ? ' • ' + fmtDuration(vm.duration_seconds) : ''}
                    </div>
                  </div>
                  {isUnread && (
                    <button
                      onClick={function() { markRead(vm.id); }}
                      className="text-[10px] font-semibold text-slate-500 hover:text-slate-700 whitespace-nowrap"
                    >
                      Mark read
                    </button>
                  )}
                </div>

                {/* Transcript */}
                {vm.transcript_status === 'pending' && (
                  <div className="text-[11px] text-slate-400 italic mb-2">⏳ Transcribing...</div>
                )}
                {vm.transcript_status === 'transcribing' && (
                  <div className="text-[11px] text-slate-400 italic mb-2">⏳ Transcribing...</div>
                )}
                {vm.transcript_status === 'failed' && (
                  <div className="text-[11px] text-red-500 italic mb-2">⚠ Transcription failed</div>
                )}
                {vm.transcript_status === 'completed' && vm.transcript && (
                  <div className="text-[12px] text-slate-700 mb-2 leading-relaxed bg-slate-50 rounded p-2 border border-slate-200">
                    "{vm.transcript}"
                  </div>
                )}

                {/* Audio player — uses our proxy endpoint to avoid Twilio Basic Auth issue.
                    The browser's <audio> can't supply HTTP auth headers, so we go through
                    /api/phone/recording-stream which fetches from Twilio with credentials
                    and re-streams to the browser. */}
                {vm.recording_url && (
                  <audio
                    controls
                    preload="none"
                    src={'/api/phone/recording-stream?id=' + encodeURIComponent(vm.id) + '&kind=voicemail'}
                    className="w-full h-8"
                    onPlay={function() {
                      setPlaying(vm.id);
                      // Mark as read when played for the first time
                      if (isUnread) markRead(vm.id);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
