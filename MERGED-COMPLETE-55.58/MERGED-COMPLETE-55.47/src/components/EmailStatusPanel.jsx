'use client';
// ============================================================
// EmailStatusPanel — v55.46.
//
// Shows admin: is Resend configured, what FROM address, recent send
// stats, and a "Send test email to me" button so failures surface
// with detailed diagnostic instead of silent.
// ============================================================
import { useState, useEffect, useCallback } from 'react';

export default function EmailStatusPanel({ userId, userEmail, userName }) {
  var [status, setStatus] = useState(null);
  var [loading, setLoading] = useState(true);
  var [testing, setTesting] = useState(false);
  var [testResult, setTestResult] = useState(null);
  var [error, setError] = useState(null);

  var loadStatus = useCallback(async function () {
    setError(null);
    try {
      var res = await fetch('/api/notify/test');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      setStatus(data);
    } catch (e) {
      setError((e && e.message) || 'Could not load email status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(function () { loadStatus(); }, [loadStatus]);

  var sendTest = async function () {
    if (testing || !userId) return;
    setTesting(true);
    setTestResult(null);
    try {
      var res = await fetch('/api/notify/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      var data = await res.json();
      setTestResult(data);
      // Refresh stats after the test send
      await loadStatus();
    } catch (e) {
      setTestResult({ sent: false, ok: false, error: (e && e.message) || 'Network error' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl p-4 border border-slate-200 mb-3">
        <div className="text-sm text-slate-400">Loading email status…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 rounded-xl p-4 border border-red-200 mb-3">
        <div className="text-sm font-bold text-red-700">📧 Email status unavailable</div>
        <div className="text-xs text-red-600 mt-1">{error}</div>
      </div>
    );
  }

  var isReady = status && status.resend_configured;
  var stats = (status && status.stats_24h) || {};
  var failures = stats.recent_failures || [];

  return (
    <div className={'rounded-xl p-4 border mb-3 ' + (isReady ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-300')}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">📧</span>
          <span className="text-sm font-bold text-slate-800">Email (Resend) Status</span>
          <span className={'px-2 py-0.5 rounded text-[10px] font-bold ' + (isReady ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white')}>
            {isReady ? 'CONFIGURED' : 'NOT CONFIGURED'}
          </span>
        </div>
        <button
          onClick={loadStatus}
          className="px-2 py-1 text-[10px] font-semibold border border-slate-300 rounded hover:bg-slate-50"
          title="Refresh"
        >
          ↻ Refresh
        </button>
      </div>

      {!isReady && (
        <div className="bg-white rounded-lg p-3 mt-2 border border-amber-200">
          <div className="text-xs font-bold text-amber-800 mb-1">⚠️ Email notifications are NOT being sent.</div>
          <div className="text-xs text-slate-700 mb-2">
            The dashboard bell still works without Resend, but emails won't go out until you configure it.
          </div>
          <div className="text-xs text-slate-700">
            <b>Setup steps:</b>
            <ol className="list-decimal pl-5 mt-1 space-y-0.5">
              <li>Create a Resend account at <a href="https://resend.com" target="_blank" rel="noreferrer" className="text-blue-600 underline">resend.com</a></li>
              <li>Add your sending domain (e.g. ktcus.com) and the DNS records they provide</li>
              <li>Generate an API key</li>
              <li>In Vercel → Project Settings → Environment Variables, add:
                <ul className="list-disc pl-5 mt-0.5 font-mono text-[11px]">
                  <li>RESEND_API_KEY = re_xxxxx</li>
                  <li>NOTIFICATION_FROM_EMAIL = notifications@ktcus.com (optional)</li>
                </ul>
              </li>
              <li>Redeploy (Vercel → Deployments → ⋯ → Redeploy)</li>
              <li>Come back here and tap "Send test email"</li>
            </ol>
          </div>
        </div>
      )}

      {isReady && (
        <div className="grid grid-cols-3 gap-2 mt-2">
          <div className="bg-white rounded p-2 border border-emerald-100">
            <div className="text-[9px] text-slate-500 font-semibold uppercase">From address</div>
            <div className="text-xs font-mono text-slate-800 truncate" title={status.from_email}>{status.from_email}</div>
            {status.from_email_is_default && <div className="text-[9px] text-amber-600 mt-0.5">using fallback</div>}
          </div>
          <div className="bg-white rounded p-2 border border-emerald-100">
            <div className="text-[9px] text-slate-500 font-semibold uppercase">24h sent</div>
            <div className="text-xs font-bold text-emerald-700">{stats.last_24h_succeeded || 0}</div>
          </div>
          <div className="bg-white rounded p-2 border border-emerald-100">
            <div className="text-[9px] text-slate-500 font-semibold uppercase">24h failed</div>
            <div className={'text-xs font-bold ' + ((stats.last_24h_failed || 0) > 0 ? 'text-red-600' : 'text-slate-500')}>{stats.last_24h_failed || 0}</div>
          </div>
        </div>
      )}

      {/* Test button — only useful when Resend is configured AND we have a user with email */}
      {isReady && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            onClick={sendTest}
            disabled={testing || !userEmail}
            className={'px-3 py-1.5 rounded-lg text-xs font-bold transition ' + (testing || !userEmail ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600')}
            title={!userEmail ? 'You need an email address on file in your user profile' : 'Send a test email to your address'}
          >
            {testing ? '⏳ Sending…' : '📨 Send test email to me'}
          </button>
          <span className="text-[10px] text-slate-500">
            → {userEmail || '(no email on your user record)'}
          </span>
        </div>
      )}

      {/* Test result detail */}
      {testResult && (
        <div className={'mt-3 rounded-lg p-3 border text-xs ' + (testResult.ok ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300')}>
          {testResult.ok ? (
            <>
              <div className="font-bold text-emerald-700 mb-1">✅ Test email sent</div>
              <div className="text-slate-700">
                Sent to <b>{testResult.to}</b> · From <b>{testResult.from}</b> · Resend ID <code className="font-mono text-[10px]">{testResult.resend_id}</code> · {testResult.elapsed_ms}ms
              </div>
              <div className="text-slate-500 mt-1 text-[11px]">
                Check your inbox. If it doesn't arrive within 1 minute, check spam folder. If still missing, the sender domain may not be verified in Resend.
              </div>
            </>
          ) : (
            <>
              <div className="font-bold text-red-700 mb-1">❌ Test email FAILED</div>
              <div className="text-slate-800 mb-1">
                <b>Reason:</b> {testResult.reason || testResult.error || 'Unknown error'}
              </div>
              {testResult.http_status && <div className="text-slate-600 text-[11px]">HTTP {testResult.http_status}</div>}
              {testResult.next_step && (
                <div className="text-slate-700 mt-2 text-[11px] bg-white rounded p-2 border border-red-200">
                  💡 {testResult.next_step}
                </div>
              )}
              {testResult.resend_response && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-slate-500 text-[10px]">Raw Resend response</summary>
                  <pre className="text-[9px] bg-white p-2 rounded mt-1 overflow-x-auto border border-red-100">{JSON.stringify(testResult.resend_response, null, 2)}</pre>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {/* Recent failures from notification_log */}
      {failures.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-red-700">
            ⚠️ Recent failures ({failures.length})
          </summary>
          <div className="mt-2 space-y-1">
            {failures.map(function (f, i) {
              return (
                <div key={i} className="text-[10px] bg-white rounded p-2 border border-red-100">
                  <span className="font-semibold text-slate-700">{f.type || 'unknown'}</span>
                  <span className="text-slate-500 mx-1">·</span>
                  <span className="text-slate-700">{f.subject}</span>
                  <span className="text-slate-400 ml-2">{f.when ? new Date(f.when).toLocaleString() : ''}</span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
