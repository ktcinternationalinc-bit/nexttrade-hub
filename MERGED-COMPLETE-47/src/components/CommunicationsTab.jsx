'use client';
import { useState, useEffect } from 'react';

export default function CommunicationsTab({ user, supabase }) {
  const [activeChannel, setActiveChannel] = useState('all');
  const [messages, setMessages] = useState([]);
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [gmailStatus, setGmailStatus] = useState(null); // null=checking, 'connected', 'disconnected'
  const [selectedThread, setSelectedThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeChannel, setComposeChannel] = useState('email');
  const [sending, setSending] = useState(false);
  const [auditLog, setAuditLog] = useState([]);
  const [showAudit, setShowAudit] = useState(false);

  // Load stored messages + check Gmail
  useEffect(function() {
    loadMessages();
    checkGmail();
    loadAudit();
  }, []);

  async function loadMessages() {
    if (!supabase) return;
    try {
      var res = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(50);
      if (res.data) setMessages(res.data);
    } catch(e) { console.warn(e); }
  }

  async function checkGmail() {
    try {
      var res = await fetch('/api/gmail/inbox?maxResults=1');
      var data = await res.json();
      if (data.error === 'no_account' || data.error === 'token_expired') {
        setGmailStatus('disconnected');
      } else {
        setGmailStatus('connected');
      }
    } catch(e) { setGmailStatus('disconnected'); }
  }

  async function loadEmails(query) {
    setLoading(true);
    try {
      var url = '/api/gmail/inbox?maxResults=20';
      if (query) url += '&q=' + encodeURIComponent(query);
      if (user && user.id) url += '&userId=' + user.id;
      var res = await fetch(url);
      var data = await res.json();
      if (data.emails) setEmails(data.emails);
      else if (data.error) { console.error(data.error); setEmails([]); }
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  async function loadThread(threadId) {
    setLoading(true);
    try {
      var res = await fetch('/api/gmail/inbox?threadId=' + threadId);
      var data = await res.json();
      if (data.thread) setThreadMessages(data.thread);
    } catch(e) { console.warn(e); }
    setLoading(false);
  }

  async function loadAudit() {
    if (!supabase) return;
    try {
      var res = await supabase.from('comms_audit').select('*').order('created_at', { ascending: false }).limit(30);
      if (res.data) setAuditLog(res.data);
    } catch(e) { console.warn(e); }
  }

  async function handleSend() {
    if (!composeTo || !composeBody) return;
    setSending(true);
    try {
      if (composeChannel === 'email') {
        var res = await fetch('/api/gmail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: composeTo, subject: composeSubject, body: composeBody, userId: user?.id, triggeredBy: 'manual' })
        });
        var data = await res.json();
        if (data.success) { alert('Email sent!'); setComposeOpen(false); setComposeTo(''); setComposeSubject(''); setComposeBody(''); loadMessages(); }
        else alert('Send failed: ' + (data.error || 'Unknown error'));
      } else {
        var res2 = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: composeTo, body: composeBody, userId: user?.id, triggeredBy: 'manual' })
        });
        var data2 = await res2.json();
        if (data2.success) { alert('WhatsApp sent!'); setComposeOpen(false); setComposeTo(''); setComposeBody(''); loadMessages(); }
        else alert('Send failed: ' + (data2.error || 'Unknown error'));
      }
    } catch(e) { alert('Error: ' + e.message); }
    setSending(false);
  }

  function connectGmail() {
    var url = '/api/gmail/connect';
    if (user && user.id) url += '?userId=' + user.id;
    window.open(url, '_blank', 'width=600,height=700');
  }

  // Filter messages by channel
  var filteredMessages = messages.filter(function(m) {
    if (activeChannel === 'all') return true;
    return m.channel === activeChannel;
  });

  var filteredEmails = emails.filter(function(e) {
    if (!searchQuery) return true;
    var q = searchQuery.toLowerCase();
    return (e.from || '').toLowerCase().indexOf(q) >= 0 || (e.subject || '').toLowerCase().indexOf(q) >= 0;
  });

  var cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16 };
  var btnStyle = function(active) { return { background: active ? 'linear-gradient(135deg, #0ea5e9, #6366f1)' : 'rgba(255,255,255,0.06)', border: '1px solid ' + (active ? 'transparent' : 'rgba(255,255,255,0.1)'), color: active ? 'white' : 'var(--text-secondary)', borderRadius: 12, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }; };

  // Thread detail view
  if (selectedThread) {
    return (
      <div className="space-y-4">
        <button onClick={function() { setSelectedThread(null); setThreadMessages([]); }}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', borderRadius: 12, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
          ← Back to Inbox
        </button>
        <div style={cardStyle} className="p-4">
          <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>{selectedThread.subject || 'Thread'}</h3>
          {loading && <div className="animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading thread...</div>}
          <div className="space-y-4">
            {threadMessages.map(function(m, i) {
              return (
                <div key={i} className="p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs font-semibold" style={{ color: '#38bdf8' }}>{m.from}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{m.date}</span>
                  </div>
                  <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{m.subject}</div>
                  <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>{m.body}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📬 Communications</h2>
        <div className="flex gap-2">
          <button onClick={function() { setComposeOpen(!composeOpen); }} style={btnStyle(composeOpen)}>✏️ Compose</button>
          <button onClick={function() { setShowAudit(!showAudit); }} style={btnStyle(showAudit)}>📋 Audit</button>
        </div>
      </div>

      {/* Gmail Connection Status */}
      {gmailStatus === 'disconnected' && (
        <div style={{ ...cardStyle, borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.06)' }} className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm font-bold" style={{ color: '#fbbf24' }}>📧 Gmail Not Connected</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Connect your Gmail to read and send emails from the app.</div>
            </div>
            <button onClick={connectGmail}
              style={{ background: 'linear-gradient(135deg, #0ea5e9, #3b82f6)', color: 'white', borderRadius: 12, padding: '10px 20px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
              Connect Gmail
            </button>
          </div>
        </div>
      )}
      {gmailStatus === 'connected' && !emails.length && (
        <div style={{ ...cardStyle, borderColor: 'rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.06)' }} className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm" style={{ color: '#10b981' }}>✅ Gmail Connected</div>
            <button onClick={function() { loadEmails(); }}
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white', borderRadius: 12, padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              Load Inbox
            </button>
          </div>
        </div>
      )}

      {/* Channel Tabs */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'email', 'whatsapp'].map(function(ch) {
          return (
            <button key={ch} onClick={function() { setActiveChannel(ch); if (ch === 'email' && gmailStatus === 'connected' && !emails.length) loadEmails(); }}
              style={btnStyle(activeChannel === ch)}>
              {ch === 'all' ? '📬 All' : ch === 'email' ? '📧 Email' : '💬 WhatsApp'}
            </button>
          );
        })}
      </div>

      {/* Compose Panel */}
      {composeOpen && (
        <div style={cardStyle} className="p-4">
          <div className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>New Message</div>
          <div className="flex gap-2 mb-3">
            <button onClick={function() { setComposeChannel('email'); }} style={btnStyle(composeChannel === 'email')}>📧 Email</button>
            <button onClick={function() { setComposeChannel('whatsapp'); }} style={btnStyle(composeChannel === 'whatsapp')}>💬 WhatsApp</button>
          </div>
          <input value={composeTo} onChange={function(e) { setComposeTo(e.target.value); }}
            placeholder={composeChannel === 'email' ? 'To email address...' : 'To phone number (+20...)'}
            className="w-full px-4 py-3 rounded-xl text-sm mb-2"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: 16 }} />
          {composeChannel === 'email' && (
            <input value={composeSubject} onChange={function(e) { setComposeSubject(e.target.value); }}
              placeholder="Subject..."
              className="w-full px-4 py-3 rounded-xl text-sm mb-2"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: 16 }} />
          )}
          <textarea value={composeBody} onChange={function(e) { setComposeBody(e.target.value); }}
            placeholder="Message..."
            rows={4}
            className="w-full px-4 py-3 rounded-xl text-sm mb-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: 16, resize: 'vertical' }} />
          <div className="flex gap-2">
            <button onClick={handleSend} disabled={sending || !composeTo || !composeBody}
              className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white', border: 'none', cursor: 'pointer' }}>
              {sending ? 'Sending...' : (composeChannel === 'email' ? '📧 Send Email' : '💬 Send WhatsApp')}
            </button>
            <button onClick={function() { setComposeOpen(false); }}
              className="px-4 py-3 rounded-xl text-xs"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search (for emails) */}
      {activeChannel !== 'whatsapp' && gmailStatus === 'connected' && (
        <div className="flex gap-2">
          <input value={searchQuery} onChange={function(e) { setSearchQuery(e.target.value); }}
            onKeyDown={function(e) { if (e.key === 'Enter') loadEmails(searchQuery); }}
            placeholder="Search emails (from:name, subject:text, is:unread...)"
            className="flex-1 px-4 py-3 rounded-xl text-sm"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-primary)', fontSize: 16 }} />
          <button onClick={function() { loadEmails(searchQuery); }}
            style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', color: 'white', borderRadius: 12, padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            🔍
          </button>
        </div>
      )}

      {/* Audit Log */}
      {showAudit && (
        <div style={cardStyle} className="p-4">
          <div className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>📋 AI Communications Audit Log</div>
          {auditLog.length === 0 && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>No audit entries yet.</div>}
          <div className="space-y-2 max-h-[300px] overflow-auto">
            {auditLog.map(function(a) {
              return (
                <div key={a.id} className="p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex justify-between">
                    <span className="text-[10px] font-bold" style={{ color: a.triggered_by === 'ai_assistant' ? '#a78bfa' : '#38bdf8' }}>
                      {a.action_type} ({a.triggered_by})
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{(a.created_at || '').substring(0, 16)}</span>
                  </div>
                  {a.input_text && <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>{a.input_text.substring(0, 120)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && <div className="text-center py-4 animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading...</div>}

      {/* Gmail Emails */}
      {(activeChannel === 'all' || activeChannel === 'email') && emails.length > 0 && (
        <div>
          <div className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>📧 GMAIL INBOX ({emails.length})</div>
          <div className="space-y-2">
            {filteredEmails.map(function(e) {
              return (
                <div key={e.id} onClick={function() { setSelectedThread({ subject: e.subject, threadId: e.threadId }); loadThread(e.threadId); }}
                  className="p-3 rounded-xl cursor-pointer transition"
                  style={{ background: e.isUnread ? 'rgba(56,189,248,0.06)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (e.isUnread ? 'rgba(56,189,248,0.2)' : 'rgba(255,255,255,0.06)') }}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold truncate" style={{ color: e.isUnread ? '#38bdf8' : 'var(--text-primary)' }}>
                        {e.isUnread && <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: '#38bdf8' }}></span>}
                        {e.from}
                      </div>
                      <div className="text-sm font-medium truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>{e.subject}</div>
                      <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{e.snippet}</div>
                    </div>
                    <div className="text-[10px] ml-2 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {e.date ? new Date(e.date).toLocaleDateString() : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stored Messages (WhatsApp + sent emails) */}
      {filteredMessages.length > 0 && (
        <div>
          <div className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>
            {activeChannel === 'whatsapp' ? '💬 WHATSAPP MESSAGES' : '📨 MESSAGE HISTORY'} ({filteredMessages.length})
          </div>
          <div className="space-y-2">
            {filteredMessages.map(function(m) {
              var isWA = m.channel === 'whatsapp';
              var isInbound = m.direction === 'inbound';
              return (
                <div key={m.id} className="p-3 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: isWA ? '#10b981' : '#38bdf8' }}>
                          {isWA ? '💬' : '📧'} {isInbound ? '←' : '→'}
                        </span>
                        <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                          {isInbound ? m.from_address : m.to_address}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
                          background: m.status === 'sent' ? 'rgba(16,185,129,0.15)' : m.status === 'received' ? 'rgba(56,189,248,0.15)' : 'rgba(251,191,36,0.15)',
                          color: m.status === 'sent' ? '#10b981' : m.status === 'received' ? '#38bdf8' : '#fbbf24'
                        }}>{m.status}</span>
                      </div>
                      {m.subject && <div className="text-sm font-medium truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>{m.subject}</div>}
                      <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{(m.body || '').substring(0, 120)}</div>
                    </div>
                    <div className="text-[10px] ml-2 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {(m.created_at || '').substring(0, 10)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredMessages.length === 0 && emails.length === 0 && (
        <div style={cardStyle} className="p-8 text-center">
          <div className="text-3xl mb-3">📬</div>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No messages yet</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {gmailStatus === 'disconnected' ? 'Connect your Gmail above to get started.' : 'Load your inbox or use the AI Secretary to check emails.'}
          </div>
        </div>
      )}
    </div>
  );
}
