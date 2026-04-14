import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST /api/notify
// Body: { type, recipientIds, subject, body, triggeredBy }
export async function POST(req) {
  try {
    const { type, recipientIds, subject, body, triggeredBy } = await req.json();
    if (!type || !recipientIds || !subject || !body) {
      return Response.json({ error: 'Missing required fields: type, recipientIds, subject, body' }, { status: 400 });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return Response.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
    }

    const FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';

    // Fetch users — support 'all' for broadcast
    let userQuery = supabase.from('users').select('id, email, name').eq('active', true);
    if (recipientIds !== 'all') userQuery = userQuery.in('id', recipientIds);
    const { data: users } = await userQuery;

    if (!users?.length) {
      return Response.json({ sent: 0, skipped: recipientIds.length, reason: 'No active users found' });
    }

    // Fetch notification prefs — check who has this type enabled
    const { data: prefs } = await supabase
      .from('notification_prefs')
      .select('user_id, enabled')
      .in('user_id', recipientIds)
      .eq('notif_type', type);

    const prefsMap = {};
    (prefs || []).forEach(p => { prefsMap[p.user_id] = p.enabled; });

    // Filter: default is ON (enabled=true) unless explicitly set to false
    const eligibleUsers = users.filter(u => prefsMap[u.id] !== false);

    if (!eligibleUsers.length) {
      return Response.json({ sent: 0, skipped: users.length, reason: 'All recipients have this notification disabled' });
    }

    // Fetch triggeredBy name if provided
    let triggeredByName = '';
    if (triggeredBy) {
      const { data: tUser } = await supabase.from('users').select('name').eq('id', triggeredBy).single();
      triggeredByName = tUser?.name || '';
    }

    // Build HTML email
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
            You can manage notification preferences in Settings → Notifications
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
        }).then(r => r.json())
      )
    );

    const sent = results.filter(r => r.status === 'fulfilled' && r.value?.id).length;
    const failed = results.length - sent;

    // Log notifications
    try {
      await supabase.from('notification_log').insert(
        eligibleUsers.map((u, i) => ({
          user_id: u.id,
          notif_type: type,
          subject,
          sent: results[i]?.status === 'fulfilled' && results[i]?.value?.id ? true : false,
          triggered_by: triggeredBy || null,
        }))
      );
    } catch (_) { /* log table may not exist yet, non-fatal */ }

    return Response.json({ sent, failed, total: eligibleUsers.length });
  } catch (err) {
    console.error('Notify error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
