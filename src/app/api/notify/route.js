import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    var parsed = await req.json();
    var type = parsed.type;
    var recipientIds = parsed.recipientIds;
    var subject = parsed.subject;
    var body = parsed.body;
    var triggeredBy = parsed.triggeredBy;
    var to = parsed.to;
    var html = parsed.html;

    if (to && html) {
      var RESEND_KEY = process.env.RESEND_API_KEY;
      if (!RESEND_KEY) return Response.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
      var FROM = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';
      var res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + RESEND_KEY },
        body: JSON.stringify({ from: FROM, to: to, subject: subject || 'KTC Notification', html: html }),
      });
      var data = await res.json();
      return Response.json({ sent: data && data.id ? 1 : 0, resend_response: data });
    }

    if (!type || !recipientIds || !subject || !body) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    var RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      console.log('[notify] RESEND_API_KEY not configured');
      return Response.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
    }

    var FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';
    var isBroadcast = recipientIds === 'all';
    var users = [];
    try {
      var q = supabase.from('users').select('id, email, name, active');
      if (!isBroadcast) {
        var ids = Array.isArray(recipientIds) ? recipientIds : [recipientIds];
        q = q.in('id', ids);
      }
      var result = await q;
      if (result.error) console.log('[notify] User query error:', result.error.message);
      users = (result.data || []).filter(function(u) { return u.active !== false; });
    } catch(e) {
      console.log('[notify] User fetch error:', e.message);
    }
    console.log('[notify] type=' + type + ', found=' + users.length + ' users');

    var eligibleUsers = [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      try {
        var prefResult = await supabase.from('notification_prefs')
          .select('enabled').eq('user_id', u.id).eq('notification_type', type).maybeSingle();
        if (prefResult.data && prefResult.data.enabled === false) continue;
      } catch(e) {}
      if (u.email) eligibleUsers.push(u);
    }

    var triggeredByName = '';
    if (triggeredBy) {
      try {
        var tuResult = await supabase.from('users').select('name').eq('id', triggeredBy).maybeSingle();
        if (tuResult.data) triggeredByName = tuResult.data.name;
      } catch(e) {}
    }

    var htmlBody = '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f8fafc;border-radius:12px;">'
      + '<div style="background:linear-gradient(135deg,#0f172a,#1e1b4b);padding:16px 20px;border-radius:8px 8px 0 0;">'
      + '<h2 style="color:#38bdf8;margin:0;font-size:14px;">NEXTTRADE HUB</h2></div>'
      + '<div style="background:white;padding:20px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;">'
      + '<h3 style="margin:0 0 8px;color:#1e293b;font-size:16px;">' + (subject || '') + '</h3>'
      + '<p style="color:#64748b;font-size:14px;line-height:1.6;margin:0;">' + (body || '').replace(/\n/g, '<br/>') + '</p>'
      + (triggeredByName ? '<p style="color:#94a3b8;font-size:12px;margin-top:16px;border-top:1px solid #f1f5f9;padding-top:12px;">Action by: ' + triggeredByName + '</p>' : '')
      + '</div>'
      + '<p style="color:#94a3b8;font-size:10px;text-align:center;margin-top:12px;">KTC Trading Operations</p></div>';

    var sent = 0;
    var failed = 0;
    for (var j = 0; j < eligibleUsers.length; j++) {
      var eu = eligibleUsers[j];
      try {
        var emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + RESEND_API_KEY },
          body: JSON.stringify({ from: FROM_EMAIL, to: eu.email, subject: '[NextTrade] ' + subject, html: htmlBody }),
        });
        var emailData = await emailRes.json();
        if (!emailRes.ok || !emailData.id) { console.log('[notify] FAIL ' + eu.email); failed++; }
        else { console.log('[notify] SENT ' + eu.email); sent++; }
      } catch(err) {
        console.log('[notify] ERROR ' + eu.email + ': ' + err.message);
        failed++;
      }
      try {
        await supabase.from('notification_log').insert({
          user_id: eu.id, notification_type: type, subject: subject,
          body: body, triggered_by: triggeredBy || null,
          delivery_status: sent > failed ? 'sent' : 'failed',
        });
      } catch(e) {}
    }

    console.log('[notify] DONE: sent=' + sent + ', failed=' + failed);
    return Response.json({ sent: sent, failed: failed, total: eligibleUsers.length });
  } catch (err) {
    console.error('[notify] Error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
