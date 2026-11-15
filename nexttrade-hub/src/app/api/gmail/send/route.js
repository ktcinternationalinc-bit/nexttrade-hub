import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function getValidToken(account) {
  var now = new Date();
  var expiry = new Date(account.token_expiry || 0);
  if (now < expiry && account.access_token) return account.access_token;
  if (!account.refresh_token) return null;

  var res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'client_id=' + encodeURIComponent(process.env.GOOGLE_CLIENT_ID)
      + '&client_secret=' + encodeURIComponent(process.env.GOOGLE_CLIENT_SECRET)
      + '&refresh_token=' + encodeURIComponent(account.refresh_token)
      + '&grant_type=refresh_token'
  });
  if (!res.ok) return null;
  var data = await res.json();
  await supabase.from('email_accounts').update({
    access_token: data.access_token,
    token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  }).eq('id', account.id);
  return data.access_token;
}

// POST /api/gmail/send
// Body: { to, subject, body, userId, threadId?, inReplyTo?, triggeredBy? }
export async function POST(request) {
  try {
    var reqBody = await request.json();
    var to = reqBody.to;
    var subject = reqBody.subject || '';
    var body = reqBody.body || '';
    var userId = reqBody.userId;
    var threadId = reqBody.threadId;
    var inReplyTo = reqBody.inReplyTo;
    var triggeredBy = reqBody.triggeredBy || 'manual';

    if (!to || !body) return Response.json({ error: 'to and body are required' }, { status: 400 });

    // Get account
    var accountQuery = supabase.from('email_accounts').select('*').eq('is_active', true);
    if (userId) accountQuery = accountQuery.eq('user_id', userId);
    var acctResult = await accountQuery.limit(1).maybeSingle();
    if (!acctResult.data) return Response.json({ error: 'No Gmail account connected' }, { status: 400 });

    var account = acctResult.data;
    var token = await getValidToken(account);
    if (!token) return Response.json({ error: 'Gmail token expired. Reconnect in Settings.' }, { status: 401 });

    // Build RFC 2822 email
    var emailLines = [
      'To: ' + to,
      'From: ' + account.email_address,
      'Subject: ' + subject,
      'Content-Type: text/plain; charset=utf-8',
    ];
    if (inReplyTo) {
      emailLines.push('In-Reply-To: ' + inReplyTo);
      emailLines.push('References: ' + inReplyTo);
    }
    emailLines.push('');
    emailLines.push(body);

    var rawEmail = emailLines.join('\r\n');
    // Base64url encode
    var encoded = btoa(unescape(encodeURIComponent(rawEmail)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Send via Gmail API
    var sendUrl = 'https://www.googleapis.com/gmail/v1/users/me/messages/send';
    var sendBody = { raw: encoded };
    if (threadId) sendBody.threadId = threadId;

    var sendRes = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(sendBody)
    });

    if (!sendRes.ok) {
      var errText = await sendRes.text();
      return Response.json({ error: 'Gmail send failed: ' + errText.substring(0, 300) }, { status: 500 });
    }

    var sendResult = await sendRes.json();

    // Store in messages table
    await supabase.from('messages').insert({
      channel: 'email',
      direction: 'outbound',
      from_address: account.email_address,
      to_address: to,
      subject: subject,
      body: body.substring(0, 10000),
      thread_id: sendResult.threadId || threadId,
      external_id: sendResult.id,
      status: 'sent',
      handled_by: userId || null
    });

    // Audit log
    await supabase.from('comms_audit').insert({
      action_type: 'send_email',
      triggered_by: triggeredBy,
      user_id: userId || null,
      input_text: 'To: ' + to + ' | Subject: ' + subject,
      output_text: 'Sent successfully. Gmail ID: ' + sendResult.id
    });

    return Response.json({ success: true, messageId: sendResult.id, threadId: sendResult.threadId });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
