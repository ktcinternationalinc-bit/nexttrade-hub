import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// v55.72 — Plain-text-to-HTML formatter that PRESERVES the formatting the
// sender typed: line breaks, blank-line paragraph breaks, bullet lists
// (lines starting with -, *, •), numbered lists (1. 2. 3.), and basic
// indentation. Reported by Max May 7 2026: "When I post a reminder, it
// should be formatted the way I submit it. I don't want one running
// message which is hard to read if it's a long message."
//
// Rules:
//   1. If the body already looks like HTML (starts with <), return as-is.
//   2. Escape HTML special chars FIRST (so user can't inject markup).
//   3. Split on blank lines (\n\s*\n) → each chunk becomes a <p> or <ul>.
//   4. Within a chunk, lines starting with -, *, • become <li> items in <ul>.
//   5. Within a chunk, lines starting with "N." become <li> items in <ol>.
//   6. Mixed/normal lines just get \n→<br/> inside <p>.
//   7. Trim trailing whitespace on lines so leading spaces (indent)
//      get preserved via white-space:pre-wrap on the wrapper div.
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function formatBodyAsHtml(raw) {
  var s = String(raw || '');
  if (!s.trim()) return '';
  // If body already looks like HTML (sender or upstream already formatted it),
  // pass through untouched. Heuristic: starts with a tag.
  if (/^\s*<(p|div|ul|ol|h[1-6]|table|br|strong|em|span)\b/i.test(s)) return s;
  // Escape first. Then process formatting.
  var escaped = escapeHtml(s);
  // Split on blank lines (one or more empty/whitespace-only lines)
  var paragraphs = escaped.split(/\r?\n\s*\r?\n/);
  var html = '';
  for (var p = 0; p < paragraphs.length; p++) {
    var chunk = paragraphs[p];
    if (!chunk.trim()) continue;
    var lines = chunk.split(/\r?\n/);
    // Detect bullet/numbered list: every non-empty line starts with a marker
    var bulletRe = /^\s*[-*•]\s+(.+)$/;
    var numRe = /^\s*\d+[\.\)]\s+(.+)$/;
    var allBullets = lines.every(function (ln) { return !ln.trim() || bulletRe.test(ln); });
    var allNumbered = lines.every(function (ln) { return !ln.trim() || numRe.test(ln); });
    if (allBullets && lines.some(function (ln) { return bulletRe.test(ln); })) {
      html += '<ul style="margin:8px 0;padding-left:24px;">';
      for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(bulletRe);
        if (m) html += '<li style="margin:4px 0;">' + m[1] + '</li>';
      }
      html += '</ul>';
    } else if (allNumbered && lines.some(function (ln) { return numRe.test(ln); })) {
      html += '<ol style="margin:8px 0;padding-left:24px;">';
      for (var j = 0; j < lines.length; j++) {
        var n = lines[j].match(numRe);
        if (n) html += '<li style="margin:4px 0;">' + n[1] + '</li>';
      }
      html += '</ol>';
    } else {
      // Plain paragraph — preserve single line breaks within as <br/>
      html += '<p style="margin:8px 0;line-height:1.6;">' + lines.join('<br/>') + '</p>';
    }
  }
  return html;
}

// POST /api/notify
export async function POST(req) {
  try {
    const { type, recipientIds, subject, body, triggeredBy, to, html } = await req.json();

    // Legacy support: direct email send (used by announcements)
    if (to && html) {
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      // v55.46 — Soft-degrade when Resend not configured. Previously returned
      // 500 which broke announcements entirely; now we return 200 with a
      // clear flag so callers can show "email disabled" instead of a hard error.
      if (!RESEND_API_KEY) {
        console.log('[notify] direct-send: RESEND_API_KEY not configured, skipping');
        return Response.json({ sent: 0, email_disabled: true, reason: 'RESEND_API_KEY not configured in Vercel env vars' });
      }
      const FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({ from: FROM_EMAIL, to, subject: subject || 'KTC Notification', html }),
        });
        const data = await res.json();
        if (!res.ok || !data?.id) {
          // v55.46 — surface Resend's error message so admin can debug
          // (typical causes: domain not verified, FROM not allowed, key revoked).
          console.log('[notify] direct-send Resend error:', JSON.stringify(data));
          return Response.json({ sent: 0, error: data?.message || data?.error || 'Resend rejected the message', resend_response: data, http_status: res.status });
        }
        return Response.json({ sent: 1, resend_response: data });
      } catch (sendErr) {
        console.log('[notify] direct-send exception:', sendErr.message);
        return Response.json({ sent: 0, error: sendErr.message }, { status: 500 });
      }
    }

    if (!type || !recipientIds || !subject || !body) {
      return Response.json({ error: 'Missing required fields: type, recipientIds, subject, body' }, { status: 400 });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    // v55.44 — Resend is now OPTIONAL. If it isn't configured, we skip the
    // email step entirely but STILL write to the dashboard notifications
    // table (bell). Previously a missing RESEND_API_KEY returned 500 and
    // killed dashboard notifications too. That left users with no signal
    // at all that a ticket changed.
    const emailEnabled = !!RESEND_API_KEY;
    if (!emailEnabled) {
      console.log('[notify] RESEND_API_KEY not configured — sending dashboard bell only');
    }

    const FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';
    const isBroadcast = recipientIds === 'all';

    // Fetch users — safe query that works with or without active column
    let users = [];
    try {
      let q = supabase.from('users').select('id, email, name, active');
      if (!isBroadcast) {
        const ids = Array.isArray(recipientIds) ? recipientIds : [recipientIds];
        q = q.in('id', ids);
      }
      const { data, error } = await q;
      if (error) {
        console.log('[notify] User query error:', error.message);
        // Retry without active column
        let q2 = supabase.from('users').select('id, email, name');
        if (!isBroadcast) q2 = q2.in('id', Array.isArray(recipientIds) ? recipientIds : [recipientIds]);
        const { data: d2 } = await q2;
        users = d2 || [];
      } else {
        // Filter out inactive users if active column exists
        users = (data || []).filter(u => u && u.active !== false && u.active !== null);
      }
    } catch (e) {
      console.log('[notify] User fetch error:', e.message);
    }

    console.log(`[notify] type=${type}, recipients=${isBroadcast ? 'ALL' : JSON.stringify(recipientIds)}, found=${users.length} users`);

    if (!users.length) {
      return Response.json({ sent: 0, reason: 'No users found for: ' + JSON.stringify(recipientIds) });
    }

    // Check global notification settings
    try {
      const { data: setting } = await supabase
        .from('notification_settings')
        .select('enabled')
        .eq('notification_type', type)
        .maybeSingle();
      if (setting && setting.enabled === false) {
        console.log(`[notify] type '${type}' globally disabled`);
        return Response.json({ sent: 0, reason: `Type '${type}' is disabled in settings` });
      }
    } catch (_) { /* table doesn't exist = all enabled */ }

    // Filter to users with emails (for the email send below). The dashboard
    // bell, on the other hand, should reach EVERYONE in the recipient list,
    // even users without an email address.
    const eligibleUsers = users.filter(u => u.email);
    console.log(`[notify] ${eligibleUsers.length} users with email: ${eligibleUsers.map(u => u.email).join(', ')}`);
    const bellTargetUsers = users; // every recipient gets the bell entry
    console.log(`[notify] ${bellTargetUsers.length} users will get a dashboard bell entry`);

    if (!bellTargetUsers.length) {
      return Response.json({ sent: 0, reason: 'No users found in recipient list' });
    }

    // Get triggeredBy name
    let triggeredByName = '';
    if (triggeredBy) {
      try {
        const { data: tUser } = await supabase.from('users').select('name').eq('id', triggeredBy).single();
        triggeredByName = tUser?.name || '';
      } catch (_) {}
    }

    // Build HTML
    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #0f172a, #1e293b); padding: 20px 24px; border-radius: 12px 12px 0 0;">
          <h2 style="color: #38bdf8; margin: 0; font-size: 18px;">🔔 NextTrade Hub</h2>
          <p style="color: #94a3b8; margin: 4px 0 0; font-size: 12px;">KTC Trading Operations</p>
        </div>
        <div style="background: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
          <h3 style="margin: 0 0 12px; color: #1e293b; font-size: 16px;">${subject}</h3>
          <div style="color: #475569; font-size: 14px; line-height: 1.6; white-space: normal;">${formatBodyAsHtml(body)}</div>
          ${triggeredByName ? `<p style="color: #94a3b8; font-size: 12px; margin-top: 16px; border-top: 1px solid #f1f5f9; padding-top: 12px;">Action by: ${triggeredByName}</p>` : ''}
        </div>
        <div style="background: #f8fafc; padding: 12px 24px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
          <p style="color: #94a3b8; font-size: 11px; margin: 0;">
            <a href="https://nexttrade-hub.vercel.app" style="color: #3b82f6;">Open NextTrade Hub</a> · 
            Manage preferences in Settings
          </p>
        </div>
      </div>
    `;

    // Send via Resend (only if email is enabled — otherwise we still hit
    // the dashboard bell insert below)
    const results = emailEnabled ? await Promise.allSettled(
      eligibleUsers.map(u =>
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: u.email,
            subject: `[NextTrade] ${subject}`,
            html: htmlBody,
          }),
        }).then(async r => {
          const data = await r.json();
          if (!r.ok || !data.id) console.log(`[notify] RESEND FAIL for ${u.email}:`, JSON.stringify(data));
          else console.log(`[notify] SENT to ${u.email}, id=${data.id}`);
          return data;
        }).catch(err => {
          console.log(`[notify] FETCH ERROR for ${u.email}:`, err.message);
          throw err;
        })
      )
    ) : [];

    const sent = results.filter(r => r.status === 'fulfilled' && r.value?.id).length;
    const failed = emailEnabled ? results.length - sent : 0;
    console.log(`[notify] DONE: emailEnabled=${emailEnabled}, sent=${sent}, failed=${failed}`);

    // v55.44 — DASHBOARD BELL. Every notification ALSO writes a row to the
    // `notifications` table so it shows up in the user's bell with a red
    // unread dot. Previously only emails fired; the dashboard bell never saw
    // ticket updates. Now it does. One row per recipient (including users
    // without email — they still get the bell). Plain text body.
    // Best-effort: a failure here NEVER breaks the email send.
    try {
      const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const bellRows = bellTargetUsers.map(u => ({
        target_user: u.id,
        type: type,
        title: subject,
        body: stripHtml(body).slice(0, 300),
        created_by: triggeredBy || null,
      }));
      const { error: bellErr } = await supabase.from('notifications').insert(bellRows);
      if (bellErr) {
        console.log('[notify] bell insert failed:', bellErr.message);
      } else {
        console.log('[notify] bell rows inserted:', bellRows.length);
      }
    } catch (bellEx) {
      console.log('[notify] bell insert exception:', bellEx.message);
    }

    // Log (non-fatal). Only logs email attempts (one row per email-eligible
    // user) — bell-only deliveries are tracked via the bell insert above.
    if (emailEnabled && eligibleUsers.length) {
      try {
        await supabase.from('notification_log').insert(
          eligibleUsers.map((u, i) => ({
            user_id: u.id, notif_type: type, subject,
            sent: results[i]?.status === 'fulfilled' && results[i]?.value?.id ? true : false,
            triggered_by: triggeredBy || null,
          }))
        );
      } catch (_) {}
    }

    return Response.json({
      sent,
      failed,
      total: eligibleUsers.length,
      bell_targets: bellTargetUsers.length,
      email_enabled: emailEnabled,
    });
  } catch (err) {
    console.error('[notify] FATAL:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
