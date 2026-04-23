import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST /api/notify
export async function POST(req) {
  try {
    const { type, recipientIds, subject, body, triggeredBy, to, html } = await req.json();

    // Legacy support: direct email send (used by announcements)
    if (to && html) {
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      if (!RESEND_API_KEY) return Response.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
      const FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from: FROM_EMAIL, to, subject: subject || 'KTC Notification', html }),
      });
      const data = await res.json();
      return Response.json({ sent: data?.id ? 1 : 0, resend_response: data });
    }

    if (!type || !recipientIds || !subject || !body) {
      return Response.json({ error: 'Missing required fields: type, recipientIds, subject, body' }, { status: 400 });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      console.log('[notify] RESEND_API_KEY not configured');
      return Response.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
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
        users = (data || []).filter(u => u.active !== false);
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

    // Filter to users with emails
    const eligibleUsers = users.filter(u => u.email);
    console.log(`[notify] ${eligibleUsers.length} users with email: ${eligibleUsers.map(u => u.email).join(', ')}`);

    if (!eligibleUsers.length) {
      return Response.json({ sent: 0, reason: 'No users with email addresses' });
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
          <div style="color: #475569; font-size: 14px; line-height: 1.6;">${body}</div>
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

    // Send via Resend
    const results = await Promise.allSettled(
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
    );

    const sent = results.filter(r => r.status === 'fulfilled' && r.value?.id).length;
    const failed = results.length - sent;
    console.log(`[notify] DONE: sent=${sent}, failed=${failed}`);

    // Log (non-fatal)
    try {
      await supabase.from('notification_log').insert(
        eligibleUsers.map((u, i) => ({
          user_id: u.id, notif_type: type, subject,
          sent: results[i]?.status === 'fulfilled' && results[i]?.value?.id ? true : false,
          triggered_by: triggeredBy || null,
        }))
      );
    } catch (_) {}

    return Response.json({ sent, failed, total: eligibleUsers.length });
  } catch (err) {
    console.error('[notify] FATAL:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
