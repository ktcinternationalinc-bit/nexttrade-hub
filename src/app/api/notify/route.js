import { createClient } from '@supabase/supabase-js';
import { notifySender, recipientProblem, isUuid } from '../../../lib/notify-auth'; // v55.83-ZM — only a verified signed-in Hub person (or the server secret) may send

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
    const { type, recipientIds, subject, body, triggeredBy: triggeredByBody, to, html } = await req.json();
    // v55.83-ZM (Codex 25 Nov; Max 26 Nov) — WHO is sending is checked first. Until now anyone on the internet could post here and the
    // route mailed (and, once the bell columns were right, would have written bell rows for) any Hub user. Now: a verified signed-in
    // Hub person, or an internal server call with CRON_SECRET. The sender is the verified person, never the triggeredBy in the body.
    var sender = await notifySender(req, createClient, process.env);
    if (sender.error) { return Response.json({ sent: 0, error: sender.error }, { status: sender.status }); }
    var triggeredBy = sender.internal ? (isUuid(triggeredByBody) ? triggeredByBody : null) : sender.userId;

    // Legacy support: direct email send (used by announcements)
    if (to && html) {
      // v55.83-ZM rev2 (Codex 26 Nov HOLD: "the raw to+HTML announcement send remains available to any verified user") — this is the
      // dashboard ANNOUNCEMENT e-mail (page.jsx, shown to admins only). Now, on the server:
      //   1. only an admin / super admin (role read from the database by notifySender) or the internal server secret may send it;
      //   2. the 'announcement' type switch in notification_settings is obeyed (off = nothing sent);
      //   3. every address must belong to an active Hub user, and the mail goes to THAT user's own stored address, one mail each —
      //      never to the text sent in the request.
      if (!sender.internal && !sender.isAdmin) { return Response.json({ sent: 0, error: 'Only an admin can send an announcement e-mail.' }, { status: 403 }); }
      var toList = (Array.isArray(to) ? to : [to]).map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean);
      if (!toList.length || toList.length > 200) { return Response.json({ sent: 0, error: 'A message goes to 1 to 200 Hub people.' }, { status: 400 }); }
      try {
        var annSet = await supabase.from('notification_settings').select('enabled').eq('notification_type', 'announcement').maybeSingle();
        if (annSet && annSet.data && annSet.data.enabled === false) { return Response.json({ sent: 0, reason: "Type 'announcement' is disabled in settings" }); }
      } catch (eSet) { /* no settings table = every type on (as for the other notices) */ }
      var hubRes = await supabase.from('users').select('id, email, active');
      if (hubRes.error) { return Response.json({ sent: 0, error: 'The Hub could not check who the message is for — not sent.' }, { status: 503 }); }
      var hubByEmail = {}; (hubRes.data || []).forEach(function (u) { if (u && u.email && u.active !== false && u.active !== null) { hubByEmail[String(u.email).trim().toLowerCase()] = u; } });
      var outsiders = toList.filter(function (e) { return !hubByEmail[e]; });
      if (outsiders.length) { return Response.json({ sent: 0, error: 'This message can only go to active Hub people — ' + outsiders.length + ' address(es) are not one.' }, { status: 403 }); }
      var seenU = {}; var targets = []; toList.forEach(function (e) { var u = hubByEmail[e]; if (!seenU[u.id]) { seenU[u.id] = true; targets.push(u); } });
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      // v55.46 — Soft-degrade when Resend not configured (200 with a clear flag, so the screen can say e-mail is off).
      if (!RESEND_API_KEY) {
        console.log('[notify] direct-send: RESEND_API_KEY not configured, skipping');
        return Response.json({ sent: 0, email_disabled: true, reason: 'RESEND_API_KEY not configured in Vercel env vars' });
      }
      const FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';
      var sentN = 0; var errs = [];
      for (var ti = 0; ti < targets.length; ti++) {
        var tu = targets[ti];
        try {
          var res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + RESEND_API_KEY },
            body: JSON.stringify({ from: FROM_EMAIL, to: tu.email, subject: subject || 'KTC Notification', html: html }),
          });
          var data = await res.json();
          if (!res.ok || !data || !data.id) { console.log('[notify] direct-send Resend error:', JSON.stringify(data)); errs.push((data && (data.message || data.error)) || 'Resend rejected the message'); }
          else { sentN++; }
        } catch (sendErr) { console.log('[notify] direct-send exception:', sendErr.message); errs.push(sendErr.message); }
      }
      return Response.json({ sent: sentN, total: targets.length, error: errs.length ? errs[0] : undefined });
    }

    if (!type || !recipientIds || !subject || !body) {
      return Response.json({ error: 'Missing required fields: type, recipientIds, subject, body' }, { status: 400 });
    }
    var whoProblem = recipientProblem(sender, recipientIds); // v55.83-ZM — 'all' is admins only; a list is 1-200 real Hub ids
    if (whoProblem) { return Response.json({ sent: 0, error: whoProblem }, { status: 403 }); }

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
        user_id: u.id, // v55.83-ZM — the live table has user_id / read (target_user / created_by never existed, so this insert always failed)
        type: type,
        title: subject,
        body: stripHtml(body).slice(0, 300),
        read: false,
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
