import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST /api/whatsapp/webhook — Twilio sends inbound WhatsApp messages here
export async function POST(request) {
  try {
    var contentType = request.headers.get('content-type') || '';
    var params;

    if (contentType.indexOf('application/x-www-form-urlencoded') >= 0) {
      var text = await request.text();
      params = Object.fromEntries(new URLSearchParams(text));
    } else {
      params = await request.json();
    }

    var from = (params.From || '').replace('whatsapp:', '');
    var to = (params.To || '').replace('whatsapp:', '');
    var body = params.Body || '';
    var messageSid = params.MessageSid || params.SmsMessageSid || '';

    if (!from || !body) {
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // Try to match sender to a customer
    var customerMatch = null;
    if (from) {
      var cleanNum = from.replace(/[^0-9]/g, '');
      var custResult = await supabase.from('customers')
        .select('id, name, name_en')
        .or('phone.ilike.%' + cleanNum.slice(-8) + '%,whatsapp_number.ilike.%' + cleanNum.slice(-8) + '%')
        .limit(1)
        .maybeSingle();
      if (custResult.data) customerMatch = custResult.data;
    }

    // Store message
    await supabase.from('messages').insert({
      channel: 'whatsapp',
      direction: 'inbound',
      from_address: from,
      to_address: to,
      body: body.substring(0, 10000),
      external_id: messageSid,
      status: 'received',
      customer_id: customerMatch ? customerMatch.id : null,
      metadata: { twilio_sid: messageSid, profile_name: params.ProfileName || '' }
    });

    // Return empty TwiML (no auto-reply for now)
    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    });
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    });
  }
}

// GET /api/whatsapp/webhook — Twilio verification
export async function GET() {
  return Response.json({ status: 'WhatsApp webhook active' });
}
