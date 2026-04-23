import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const { user_id } = await req.json();
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKey = process.env.TWILIO_API_KEY;
    const apiSecret = process.env.TWILIO_API_SECRET;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

    if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
      return NextResponse.json({ error: 'Twilio not configured. Add TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_TWIML_APP_SID to env vars.' }, { status: 400 });
    }

    // Get user's assigned phone number
    const { data: assignment } = await supabase
      .from('phone_numbers').select('phone_number').eq('assigned_to', user_id).maybeSingle();

    // Generate access token using Twilio REST API
    // We use a JWT approach compatible with edge runtime
    const identity = user_id || 'default';
    const ttl = 3600;
    const now = Math.floor(Date.now() / 1000);

    // Build JWT header and payload
    const header = btoa(JSON.stringify({ typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' })).replace(/=/g, '');
    const grants = {
      identity,
      voice: { incoming: { allow: true }, outgoing: { application_sid: twimlAppSid } }
    };
    const payload = btoa(JSON.stringify({
      jti: `${apiKey}-${now}`,
      iss: apiKey,
      sub: accountSid,
      exp: now + ttl,
      grants
    })).replace(/=/g, '');

    // Sign with HMAC-SHA256
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${payload}`));
    const signature = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const token = `${header}.${payload}.${signature}`;

    return NextResponse.json({
      token,
      identity,
      phone_number: assignment?.phone_number || null,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
