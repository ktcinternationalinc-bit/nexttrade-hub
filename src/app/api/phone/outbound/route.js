// ============================================================
// /api/phone/outbound — TwiML APP REQUEST URL (BROWSER → CUSTOMER)
// ============================================================
// What this does:
//   When a team member clicks "Call" in the browser PhoneWidget,
//   the Twilio Voice SDK places a call to Twilio. Twilio then
//   POSTs to this URL asking "what should I do with this call?"
//
//   We respond with TwiML:
//     <Dial callerId="+1xxx">+15551234567</Dial>
//
//   That tells Twilio to dial the customer's number, with our
//   KTC number as the caller ID. Customer sees KTC's number on
//   their phone, not the team member's personal number.
//
// Inputs from Twilio (form-urlencoded POST):
//   • From    — the browser identity (user UUID), e.g. "client:abc-123"
//   • To      — the destination phone number, set by the SDK call params
//   • CallSid — Twilio's unique call ID
//
// We log every outbound call to phone_calls so the history is searchable.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function xmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getPublicBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    var u = process.env.NEXT_PUBLIC_APP_URL;
    if (u.endsWith('/')) u = u.slice(0, -1);
    return u;
  }
  return 'https://nexttrade-hub.vercel.app';
}

function errorTwiml(msg) {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Response>'
    + '<Say voice="Polly.Joanna">' + xmlEscape(msg) + '</Say>'
    + '<Hangup />'
    + '</Response>';
}

export async function POST(req) {
  try {
    var formData = await req.formData();
    var to = String(formData.get('To') || '');           // destination number — passed by SDK
    var from = String(formData.get('From') || '');       // identity, e.g. "client:user-uuid"
    var callSid = String(formData.get('CallSid') || ''); // Twilio's call ID

    // SDK identities come through as "client:UUID" — strip the prefix
    var identity = from;
    if (identity.indexOf('client:') === 0) {
      identity = identity.substring(7);
    }

    if (!to) {
      return new Response(errorTwiml('No destination number provided.'), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // Look up the team member to get their assigned KTC number (used as caller ID).
    // If they don't have an assigned number, fall back to TWILIO_MAIN_NUMBER.
    var callerId = process.env.TWILIO_MAIN_NUMBER || '';
    var assigned_to = null;
    if (identity && identity !== 'guest') {
      try {
        var lookup = await supabase
          .from('phone_numbers')
          .select('phone_number, recording_enabled, assigned_to')
          .eq('assigned_to', identity)
          .maybeSingle();
        if (lookup.data) {
          callerId = lookup.data.phone_number || callerId;
          assigned_to = lookup.data.assigned_to;
        }
      } catch (e) {
        console.warn('[phone/outbound] number lookup failed:', e.message);
      }
    }

    // Try to match the destination to a customer in our DB
    var customer_id = null;
    try {
      var normalized = String(to).replace(/[^0-9]/g, '');
      var last10 = normalized.slice(-10);
      if (last10.length >= 7) {
        var custLookup = await supabase
          .from('customers')
          .select('id, name')
          .or('phone.ilike.%' + last10 + '%,whatsapp.ilike.%' + last10 + '%')
          .limit(1);
        if (custLookup.data && custLookup.data.length > 0) {
          customer_id = custLookup.data[0].id;
        }
      }
    } catch (e) { /* non-fatal */ }

    // Log the outbound call
    try {
      await supabase.from('phone_calls').insert({
        twilio_call_sid: callSid,
        direction: 'outbound',
        ktc_number: callerId,
        customer_number: to,
        customer_id: customer_id,
        user_id: identity && identity !== 'guest' ? identity : null,
        status: 'ringing',
        started_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[phone/outbound] insert failed:', e.message);
    }

    // Build TwiML — dial the destination from the team member's KTC number.
    // Recording is on by default for compliance with the disclaimer that
    // we play on inbound. For outbound, the team member knows it's recorded;
    // the disclaimer is the legal protection for two-party consent states
    // (we play it via <Say> before dialing).
    var baseUrl = getPublicBaseUrl();
    var recordingCallbackUrl = baseUrl + '/api/phone/recording-callback';
    var statusCallbackUrl = baseUrl + '/api/phone/call-status';

    var twiml = '<?xml version="1.0" encoding="UTF-8"?>';
    twiml += '<Response>';
    // Brief recording disclaimer — caller hears this when they answer.
    // Some businesses prefer NO disclaimer on outbound (US two-party consent
    // varies). For now we include it for safety; can be made optional later.
    twiml += '<Say voice="Polly.Joanna">This call may be recorded for quality and training purposes.</Say>';
    var dialAttrs = 'callerId="' + xmlEscape(callerId) + '"'
      + ' record="record-from-answer"'
      + ' recordingStatusCallback="' + xmlEscape(recordingCallbackUrl) + '"'
      + ' recordingStatusCallbackEvent="completed"'
      + ' recordingStatusCallbackMethod="POST"'
      + ' answerOnBridge="true"';
    twiml += '<Dial ' + dialAttrs + '>';
    twiml += '<Number>' + xmlEscape(to) + '</Number>';
    twiml += '</Dial>';
    twiml += '</Response>';

    return new Response(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e) {
    console.error('[phone/outbound] error:', e.message);
    return new Response(errorTwiml('An error occurred placing your call.'), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
