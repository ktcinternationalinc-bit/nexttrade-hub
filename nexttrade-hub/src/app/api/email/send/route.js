import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST /api/email/send — Send email via Resend and log it
export async function POST(req) {
  try {
    const { to, subject, body, cc, replyTo, senderName, userId } = await req.json();

    if (!to || !subject || !body) {
      return Response.json({ error: 'to, subject, and body are required' }, { status: 400 });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return Response.json({ error: 'RESEND_API_KEY not configured. Set it in Vercel → Settings → Environment Variables.' }, { status: 500 });
    }

    const FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@ktcus.com';
    const fromDisplay = senderName ? `${senderName} <${FROM_EMAIL}>` : FROM_EMAIL;

    // Build HTML email
    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 650px; margin: 0 auto;">
        <div style="white-space: pre-wrap; font-size: 14px; line-height: 1.7; color: #1e293b;">
${body.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}
        </div>
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
          <div style="font-size: 11px; color: #94a3b8;">Sent via NextTrade Hub · KTC International</div>
        </div>
      </div>
    `;

    // Send via Resend
    const emailPayload = {
      from: fromDisplay,
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      html: htmlBody,
      text: body,
    };
    if (cc) emailPayload.cc = Array.isArray(cc) ? cc : [cc];
    if (replyTo) emailPayload.reply_to = replyTo;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(emailPayload),
    });

    const result = await res.json();

    if (!res.ok) {
      return Response.json({ error: result.message || 'Resend API error', details: result }, { status: res.status });
    }

    // Log to messages table
    try {
      await supabase.from('messages').insert({
        channel: 'email',
        direction: 'outbound',
        from_address: FROM_EMAIL,
        to_address: Array.isArray(to) ? to.join(', ') : to,
        subject: subject,
        body: body.substring(0, 5000),
        status: 'sent',
        sent_by: userId || null,
        resend_id: result.id || null,
      });
    } catch (_) { /* messages table may not have all columns, non-fatal */ }

    return Response.json({ success: true, id: result.id, to: to });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
