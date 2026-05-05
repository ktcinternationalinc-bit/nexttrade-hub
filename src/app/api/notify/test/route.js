// ============================================================
// /api/notify/test
//
// v55.46 — Resend health check + test-email tool.
//
// GET — returns the current Resend configuration status without sending
// anything. Used by the Admin → Email Status panel to show:
//   - Is RESEND_API_KEY set in Vercel env vars?
//   - Which FROM address is configured?
//   - How many emails sent in the last 24 hours (success vs fail)?
//
// POST — sends a single test email to the user_id in the body so the
// admin can verify Resend end-to-end. Returns detailed diagnostic
// (Resend's response, the recipient's email, env-var presence) so any
// failure mode is immediately visible — no more "the bell shows but
// emails don't arrive and we don't know why" mystery.
//
// SWC/Vercel constraint: this file uses string concatenation and `var`
// (no template literals or let/const) per the project convention.
// ============================================================

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// GET /api/notify/test — health check, never sends anything
export async function GET() {
  try {
    var keySet = !!process.env.RESEND_API_KEY;
    var fromEmail = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';
    var fromIsDefault = !process.env.NOTIFICATION_FROM_EMAIL;

    // Pull recent email send stats from notification_log if it exists
    var stats = { last_24h_attempted: 0, last_24h_succeeded: 0, last_24h_failed: 0, recent_failures: [] };
    try {
      var supabase = getSupabase();
      var since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var logRes = await supabase.from('notification_log')
        .select('user_id, notif_type, subject, sent, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200);
      if (!logRes.error && logRes.data) {
        stats.last_24h_attempted = logRes.data.length;
        stats.last_24h_succeeded = logRes.data.filter(function (r) { return r.sent === true; }).length;
        stats.last_24h_failed = stats.last_24h_attempted - stats.last_24h_succeeded;
        // Surface up to 5 most recent failures for admin to look at
        stats.recent_failures = logRes.data
          .filter(function (r) { return r.sent !== true; })
          .slice(0, 5)
          .map(function (r) { return { user_id: r.user_id, type: r.notif_type, subject: r.subject, when: r.created_at }; });
      }
    } catch (statsErr) {
      // Stats are best-effort — table may not exist on older schemas
      try { console.warn('[notify-test] stats lookup failed:', statsErr && statsErr.message); } catch (_) {}
    }

    return Response.json({
      resend_configured: keySet,
      from_email: fromEmail,
      from_email_is_default: fromIsDefault,
      status: keySet ? 'ready' : 'not_configured',
      message: keySet
        ? 'Resend is configured. Use POST /api/notify/test with { user_id } to send a test email.'
        : 'RESEND_API_KEY is not set in Vercel env vars. Add it under Settings → Environment Variables.',
      env_vars_needed: keySet ? [] : ['RESEND_API_KEY', 'NOTIFICATION_FROM_EMAIL (optional)'],
      stats_24h: stats,
    });
  } catch (err) {
    return Response.json({ error: (err && err.message) || 'Unknown error' }, { status: 500 });
  }
}

// POST /api/notify/test — actually send a test email
// Body: { user_id: '<uuid>' }  (optional: { email: 'override@example.com' })
export async function POST(req) {
  try {
    var body = await req.json();
    var userId = body && body.user_id;
    var emailOverride = body && body.email;

    var keySet = !!process.env.RESEND_API_KEY;
    if (!keySet) {
      return Response.json({
        sent: false,
        ok: false,
        reason: 'RESEND_API_KEY not configured',
        next_step: 'Set RESEND_API_KEY in Vercel → Settings → Environment Variables, then redeploy.',
      });
    }

    var supabase = getSupabase();
    var recipientEmail = emailOverride;
    var recipientName = 'Test recipient';

    // If user_id provided, look up their email address
    if (userId && !emailOverride) {
      try {
        var uRes = await supabase.from('users').select('email, name').eq('id', userId).maybeSingle();
        if (uRes && uRes.data) {
          recipientEmail = uRes.data.email;
          recipientName = uRes.data.name || 'User';
        }
      } catch (_) {}
    }

    if (!recipientEmail) {
      return Response.json({
        sent: false,
        ok: false,
        reason: userId ? 'User has no email address on file' : 'No user_id or email provided',
      }, { status: 400 });
    }

    var FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';
    var nowStr = new Date().toLocaleString();

    var html = ''
      + '<div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">'
      + '  <div style="background: linear-gradient(135deg,#0f172a,#1e293b); padding: 20px 24px; border-radius: 12px 12px 0 0;">'
      + '    <h2 style="color:#10b981; margin:0; font-size:18px;">✅ Resend Test — NextTrade Hub</h2>'
      + '    <p style="color:#94a3b8; margin:6px 0 0; font-size:12px;">Sent ' + nowStr + '</p>'
      + '  </div>'
      + '  <div style="background:#fff; border:1px solid #e2e8f0; border-top:none; padding:24px;">'
      + '    <p style="margin:0 0 12px; color:#1e293b; font-size:15px;">Hi ' + recipientName + ',</p>'
      + '    <p style="margin:0 0 12px; color:#475569; line-height:1.6;">If you can read this, Resend email delivery is working end-to-end.</p>'
      + '    <ul style="color:#475569; line-height:1.8; padding-left:20px;">'
      + '      <li>RESEND_API_KEY is set ✓</li>'
      + '      <li>Sender domain (' + FROM_EMAIL + ') is accepted ✓</li>'
      + '      <li>Recipient (' + recipientEmail + ') received the email ✓</li>'
      + '    </ul>'
      + '    <p style="margin:12px 0 0; color:#94a3b8; font-size:12px;">This is a test message — safe to ignore. Triggered from Admin → Email Status.</p>'
      + '  </div>'
      + '  <div style="background:#f8fafc; border:1px solid #e2e8f0; border-top:none; padding:12px 24px; border-radius:0 0 12px 12px;">'
      + '    <p style="color:#94a3b8; font-size:11px; margin:0;">'
      + '      <a href="https://nexttrade-hub.vercel.app" style="color:#3b82f6;">Open NextTrade Hub</a>'
      + '    </p>'
      + '  </div>'
      + '</div>';

    var sendStart = Date.now();
    var resendRes;
    var resendData;
    try {
      resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: recipientEmail,
          subject: '[NextTrade] Resend test — ' + nowStr,
          html: html,
        }),
      });
      resendData = await resendRes.json();
    } catch (fetchErr) {
      return Response.json({
        sent: false,
        ok: false,
        reason: 'Network error contacting Resend: ' + fetchErr.message,
        elapsed_ms: Date.now() - sendStart,
      }, { status: 500 });
    }

    var ok = resendRes.ok && resendData && resendData.id;
    var elapsedMs = Date.now() - sendStart;

    // Log result so the GET stats endpoint can show this in the panel
    try {
      await supabase.from('notification_log').insert({
        user_id: userId || null,
        notif_type: 'test',
        subject: '[NextTrade] Resend test',
        sent: !!ok,
        triggered_by: userId || null,
      });
    } catch (_) {}

    if (!ok) {
      return Response.json({
        sent: false,
        ok: false,
        from: FROM_EMAIL,
        to: recipientEmail,
        http_status: resendRes.status,
        // Resend returns { name, message, statusCode } on errors —
        // surface their text so the admin sees the real cause.
        error: (resendData && (resendData.message || resendData.error || resendData.name)) || 'Resend rejected the message',
        resend_response: resendData,
        elapsed_ms: elapsedMs,
        next_step: 'Common causes: (1) sender domain not verified in Resend, (2) FROM address not allowed, (3) API key revoked or invalid.',
      });
    }

    return Response.json({
      sent: true,
      ok: true,
      from: FROM_EMAIL,
      to: recipientEmail,
      resend_id: resendData.id,
      elapsed_ms: elapsedMs,
      message: 'Test email sent successfully. Check your inbox at ' + recipientEmail + '.',
    });
  } catch (err) {
    try { console.error('[notify-test] FATAL:', err && err.message); } catch (_) {}
    return Response.json({ error: (err && err.message) || 'Unknown error' }, { status: 500 });
  }
}
