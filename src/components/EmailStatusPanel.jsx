'use client';
// ============================================================
// EmailStatusPanel — v55.46.
//
// Shows admin: is Resend configured, what FROM address, recent send
// stats, and a "Send test email to me" button so failures surface
// with detailed diagnostic instead of silent.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { fmtET } from '../lib/et-time';

export default function EmailStatusPanel({ userId, userEmail, userName }) {
  var [status, setStatus] = useState(null);
  var [loading, setLoading] = useState(true);
  var [testing, setTesting] = useState(false);
  var [testResult, setTestResult] = useState(null);
  var [error, setError] = useState(null);

  // v55.52 — Bulk "test all teammates" mode
  var [bulkTesting, setBulkTesting] = useState(false);
  var [bulkResult, setBulkResult] = useState(null);
  var [bulkConfirming, setBulkConfirming] = useState(false);

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

  // v55.52 — Send a test email to EVERY active teammate. Results show per-person.
  var sendTestToAll = async function () {
    if (bulkTesting) return;
    setBulkTesting(true);
    setBulkResult(null);
    try {
      var res = await fetch('/api/notify/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, triggered_by_user_id: userId || null }),
      });
      var data = await res.json();
      setBulkResult(data);
      await loadStatus();
    } catch (e) {
      setBulkResult({ ok: false, error: (e && e.message) || 'Network error' });
    } finally {
      setBulkTesting(false);
      setBulkConfirming(false);
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

  // v55.80 (Phase B / Section 13 — silent-failure escalation)
  // ----------------------------------------------------------------
  // The panel previously said "CONFIGURED" green pill even when zero
  // emails were succeeding. The new rule: if Resend is configured but
  // the 24h success count is 0 despite attempts, OR more than half of
  // attempts failed, surface that loudly.
  var attempted = Number(stats.last_24h_attempted || 0);
  var succeeded = Number(stats.last_24h_succeeded || 0);
  var rawFailed = Number(stats.last_24h_failed || 0);
  // v55.80 BUG-12 FIX: server shape isn't strictly enforced —
  // attempted/succeeded/failed are independently counted. If they don't add
  // up, derive failed from (attempted - succeeded) and clamp to 0+.
  var failed = (Math.abs((succeeded + rawFailed) - attempted) > 1)
    ? Math.max(0, attempted - succeeded)
    : rawFailed;
  var silentFailure = isReady && attempted >= 3 && succeeded === 0;
  var degraded = isReady && !silentFailure && attempted >= 5 && (failed / attempted) >= 0.5;
  var escalated = silentFailure || degraded;

  // The pill color shifts from green → red when silent-failure is true,
  // so the viewer can't miss that "configured" doesn't mean "working".
  var pillBg = !isReady ? 'bg-amber-500'
    : silentFailure ? 'bg-rose-600'
    : degraded ? 'bg-amber-500'
    : 'bg-emerald-500';
  var pillLabel = !isReady ? 'NOT CONFIGURED'
    : silentFailure ? 'NOT DELIVERING'
    : degraded ? 'DEGRADED'
    : 'CONFIGURED';
  var panelBg = (!isReady || escalated) ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-200';
  if (silentFailure) panelBg = 'bg-rose-50 border-rose-300';

  return (
    <div className={'rounded-xl p-4 border mb-3 ' + panelBg}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">📧</span>
          <span className="text-sm font-bold text-slate-800">Email (Resend) Status</span>
          <span className={'px-2 py-0.5 rounded text-[10px] font-bold text-white ' + pillBg}>
            {pillLabel}
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

      {/* v55.80 (Phase B / Section 13) — Silent-failure callout.
          Used to be hidden behind a "configured" green pill, which hid
          the worst kind of bug: looks fine, isn't delivering. */}
      {silentFailure && (
        <div className="bg-white border-2 border-rose-300 rounded-lg p-3 mb-2">
          <div className="text-xs font-extrabold text-rose-800 mb-1">🚨 Emails are NOT delivering — {attempted} attempted, 0 sent in last 24h</div>
          <div className="text-[11px] text-rose-700 leading-relaxed">
            Resend is configured but every send in the last 24 hours has failed. Most common causes: the API key is wrong, the FROM address is unverified, or you've hit the Resend free-tier daily limit.
            Click <b>Send test email</b> below — the response will tell you exactly which one.
          </div>
        </div>
      )}
      {degraded && !silentFailure && (
        <div className="bg-white border border-amber-300 rounded-lg p-3 mb-2">
          <div className="text-xs font-bold text-amber-800 mb-1">⚠️ Email delivery is degraded — {failed} of {attempted} failed in last 24h</div>
          <div className="text-[11px] text-amber-700">
            More than half of recent sends failed. Look at the recent failures below to spot a pattern (one bad recipient address vs. a wider outage).
          </div>
        </div>
      )}

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
            {status.from_email_is_default && <div className="text-[9px] text-amber-800 mt-0.5 font-semibold">using fallback</div>}
          </div>
          <div className="bg-white rounded p-2 border border-emerald-100">
            <div className="text-[9px] text-slate-500 font-semibold uppercase">24h sent</div>
            <div className={'text-xs font-bold ' + (silentFailure ? 'text-rose-600' : 'text-emerald-700')}>{succeeded}</div>
          </div>
          <div className="bg-white rounded p-2 border border-emerald-100">
            <div className="text-[9px] text-slate-500 font-semibold uppercase">24h failed</div>
            <div className={'text-xs font-bold ' + (failed > 0 ? 'text-red-600' : 'text-slate-500')}>{failed}</div>
          </div>
        </div>
      )}

      {/* v55.60 — When the FROM address is still the Resend default
          (onboarding@resend.dev), email only delivers to the account owner.
          Show clear, step-by-step instructions inline so the user doesn't
          have to chase external docs. */}
      {isReady && status && status.from_email && /onboarding@resend\.dev/i.test(status.from_email) && (
        <div className="mt-3 bg-amber-50 border border-amber-300 rounded-lg p-3">
          <div className="text-xs font-bold text-amber-900 mb-2">⚠️ Team emails won't deliver until your domain is verified</div>
          <div className="text-[11px] text-amber-800 mb-2">
            You're currently using Resend's testing address (<code className="bg-amber-100 px-1 rounded">onboarding@resend.dev</code>),
            which only delivers to the account owner ({userEmail || 'you'}). To send to teammates, verify <b>ktcus.com</b> and switch the FROM address.
          </div>
          <details className="text-[11px] text-amber-900">
            <summary className="cursor-pointer font-semibold hover:underline">▸ Step-by-step instructions</summary>
            <ol className="list-decimal ml-4 mt-2 space-y-1.5">
              <li>Open <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">resend.com/domains</a> and log in</li>
              <li>Click <b>Add Domain</b> → type <code className="bg-amber-100 px-1 rounded">ktcus.com</code> → click Add</li>
              <li>Resend shows you DNS records (a TXT for <code className="bg-amber-100 px-1 rounded">resend._domainkey</code>, an MX and a TXT for <code className="bg-amber-100 px-1 rounded">send</code>)</li>
              <li>Add those exact records at Bluehost → Domains → DNS Zone Editor for ktcus.com</li>
              <li>Wait 15 minutes to 2 hours for DNS to propagate</li>
              <li>Back in Resend, click <b>Verify DNS Records</b> — should turn green ✓</li>
              <li>In Vercel → Settings → Environment Variables → change <code className="bg-amber-100 px-1 rounded">NOTIFICATION_FROM_EMAIL</code> from <code className="bg-amber-100 px-1 rounded">onboarding@resend.dev</code> to <code className="bg-amber-100 px-1 rounded">notifications@ktcus.com</code></li>
              <li>Redeploy</li>
              <li>Come back here and click <b>📬 Test all teammates</b> — should now deliver to everyone</li>
            </ol>
            <div className="mt-2 text-amber-700">
              <b>Stuck on step 4?</b> Take a screenshot of the Resend domain page (the one showing your DNS records as ✓ Verified or ✗ Not Verified) and ask Claude — I'll tell you exactly which record is wrong.
            </div>
          </details>
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

          {/* v55.52 — Bulk test for all teammates */}
          {!bulkConfirming ? (
            <button
              onClick={() => setBulkConfirming(true)}
              disabled={bulkTesting}
              className={'px-3 py-1.5 rounded-lg text-xs font-bold transition ml-auto ' + (bulkTesting ? 'bg-slate-300 text-slate-500' : 'bg-indigo-500 text-white hover:bg-indigo-600')}
              title="Send a test email to every active teammate"
            >
              {bulkTesting ? '⏳ Sending to all…' : '📬 Test all teammates'}
            </button>
          ) : (
            <div className="ml-auto flex items-center gap-1 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1">
              <span className="text-[10px] text-amber-800 font-semibold">Send a real email to every active teammate?</span>
              <button onClick={sendTestToAll} disabled={bulkTesting} className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500 text-white rounded hover:bg-emerald-600">
                {bulkTesting ? '⏳' : 'Yes'}
              </button>
              <button onClick={() => setBulkConfirming(false)} disabled={bulkTesting} className="px-2 py-0.5 text-[10px] font-bold border border-slate-300 rounded hover:bg-slate-50">
                Cancel
              </button>
            </div>
          )}
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

      {/* v55.52 — Bulk test result — per-teammate table */}
      {bulkResult && (
        <div className={'mt-3 rounded-lg p-3 border text-xs ' + (bulkResult.ok ? 'bg-emerald-50 border-emerald-300' : (bulkResult.succeeded > 0 ? 'bg-amber-50 border-amber-300' : 'bg-red-50 border-red-300'))}>
          <div className="font-bold mb-1">
            {bulkResult.ok ? (
              <span className="text-emerald-700">✅ Test email sent to all {bulkResult.succeeded} teammates</span>
            ) : bulkResult.succeeded > 0 ? (
              <span className="text-amber-800">⚠️ {bulkResult.succeeded} of {bulkResult.total} teammates received the test — {bulkResult.failed} failed</span>
            ) : (
              <span className="text-red-700">❌ All {bulkResult.total || 0} sends failed</span>
            )}
          </div>
          {bulkResult.message && <div className="text-slate-700 mb-2">{bulkResult.message}</div>}
          {bulkResult.error && <div className="text-red-700 mb-2"><b>Reason:</b> {bulkResult.error}</div>}
          {Array.isArray(bulkResult.results) && bulkResult.results.length > 0 && (
            <div className="bg-white rounded border border-slate-200 overflow-hidden mt-2">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-2 py-1 font-semibold text-slate-600">Teammate</th>
                    <th className="text-left px-2 py-1 font-semibold text-slate-600">Email</th>
                    <th className="text-left px-2 py-1 font-semibold text-slate-600">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkResult.results.map(function (r, i) {
                    return (
                      <tr key={r.user_id || i} className={i % 2 ? 'bg-slate-50' : ''}>
                        <td className="px-2 py-1 text-slate-800">{r.name}</td>
                        <td className="px-2 py-1 text-slate-600 font-mono text-[10px]">{r.email}</td>
                        <td className="px-2 py-1">
                          {r.ok ? (
                            <span className="text-emerald-700 font-semibold">✅ Sent ({r.elapsed_ms}ms)</span>
                          ) : (
                            <span className="text-red-700 font-semibold" title={r.error}>❌ {r.error || 'failed'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-slate-500 mt-2 text-[10px]">
            Each teammate should check their inbox (including spam) within a minute. If a row shows ❌, share the reason with them — usually it's an email typo on their user profile or their domain blocking external mail.
          </div>
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
                  <span className="text-slate-400 ml-2">{f.when ? fmtET(f.when, 'datetime') : ''}</span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
