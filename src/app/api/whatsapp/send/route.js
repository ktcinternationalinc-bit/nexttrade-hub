import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST /api/whatsapp/send
// Body: { to, body, userId, triggeredBy? }
export async function POST(request) {
  try {
    var reqBody = await request.json();
    var to = reqBody.to;
    var body = reqBody.body || '';
    var userId = reqBody.userId;
    var triggeredBy = reqBody.triggeredBy || 'manual';

    if (!to || !body) return Response.json({ error: 'to and body are required' }, { status: 400 });

    var accountSid = process.env.TWILIO_ACCOUNT_SID;
    var authToken = process.env.TWILIO_AUTH_TOKEN;
    var fromNumber = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !fromNumber) {
      return Response.json({ error: 'Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM in Vercel env vars.' }, { status: 500 });
    }

    // Clean phone number
    var cleanTo = to.replace(/[^0-9+]/g, '');
    if (!cleanTo.startsWith('+')) cleanTo = '+' + cleanTo;
    var waTo = 'whatsapp:' + cleanTo;
    var waFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : 'whatsapp:' + fromNumber;

    // Send via Twilio REST API
    var twilioUrl = 'https://api.twilio.com/2010-04-01/Accounts/' + accountSid + '/Messages.json';
    var twilioBody = 'To=' + encodeURIComponent(waTo)
      + '&From=' + encodeURIComponent(waFrom)
      + '&Body=' + encodeURIComponent(body);

    var authHeader = 'Basic ' + btoa(accountSid + ':' + authToken);

    var sendRes = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: twilioBody
    });

    var sendResult = await sendRes.json();

    if (sendResult.error_code || sendResult.code) {
      return Response.json({
        error: 'Twilio error: ' + (sendResult.message || sendResult.more_info || 'Unknown'),
        code: sendResult.error_code || sendResult.code
      }, { status: 400 });
    }

    // Store in messages
    await supabase.from('messages').insert({
      channel: 'whatsapp',
      direction: 'outbound',
      from_address: waFrom.replace('whatsapp:', ''),
      to_address: cleanTo,
      body: body.substring(0, 10000),
      external_id: sendResult.sid,
      status: 'sent',
      handled_by: userId || null
    });

    // Audit
    await supabase.from('comms_audit').insert({
      action_type: 'send_whatsapp',
      triggered_by: triggeredBy,
      user_id: userId || null,
      input_text: 'To: ' + cleanTo,
      output_text: 'Sent. SID: ' + sendResult.sid
    });

    return Response.json({ success: true, sid: sendResult.sid });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
