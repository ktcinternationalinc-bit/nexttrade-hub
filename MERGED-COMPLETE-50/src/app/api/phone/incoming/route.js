import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST: Twilio sends incoming call here — return TwiML to route to browser
export async function POST(req) {
  try {
    const formData = await req.formData();
    const to = formData.get('To') || '';
    const from = formData.get('From') || '';
    const callSid = formData.get('CallSid') || '';

    // Find which user owns this number
    const { data: assignment } = await supabase
      .from('phone_numbers').select('assigned_to, phone_number').eq('phone_number', to).maybeSingle();

    // Log incoming call
    if (assignment) {
      await supabase.from('call_logs').insert({
        user_id: assignment.assigned_to,
        phone_number: from,
        direction: 'inbound',
        status: 'ringing',
        call_sid: callSid,
        called_at: new Date().toISOString(),
      });
    }

    const clientId = assignment?.assigned_to || 'default';

    // Return TwiML to connect call to browser client
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Client>${clientId}</Client>
  </Dial>
</Response>`;

    return new Response(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an error occurred.</Say></Response>`;
    return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
  }
}

// Handle outbound calls from browser (TwiML App voice URL)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const to = searchParams.get('To') || searchParams.get('phone') || '';
  const callerId = searchParams.get('CallerId') || process.env.TWILIO_DEFAULT_NUMBER || '';

  if (!to) {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>No number provided.</Say></Response>`, {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}">
    <Number>${to}</Number>
  </Dial>
</Response>`;

  return new Response(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
