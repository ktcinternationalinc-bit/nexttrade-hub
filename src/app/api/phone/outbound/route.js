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
import { verifyTwilioSignature } from '../../../../lib/phone-auth';

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
    // Read formData ONCE so we can verify the signature AND use the fields
    var formObj = {};
    var rawForm = await req.formData();
    for (var pair of rawForm.entries()) {
      formObj[pair[0]] = String(pair[1]);
    }

    // Verify this came from Twilio. Outbound is reached by Twilio when
    // the browser SDK initiates a call — it's a TwiML Application's
    // Request URL, and Twilio signs every request to it.
    if (!verifyTwilioSignature(req, formObj)) {
      console.error('[phone/outbound] SIGNATURE CHECK FAILED — proceeding anyway. '
        + 'See [twilio-sig] log lines for URL variants tried. v55.56 fail-open.');
      // Fall through — return TwiML rather than break the call
    }

    var to = String(formObj.To || '');           // destination number — passed by SDK
    var from = String(formObj.From || '');       // identity, e.g. "client:user-uuid"
    var callSid = String(formObj.CallSid || ''); // Twilio's call ID

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

    // Validate destination — must be E.164 (start with +) and not premium-rate.
    // Premium-rate prefixes (like +1-900, +1-976) are common scam targets:
    // an attacker dialing those racks up high charges to your account. We block
    // them. If you ever need to call a legit premium number, add an exception.
    var destNormalized = String(to).trim();
    if (!destNormalized.startsWith('+')) {
      console.warn('[phone/outbound] non-E.164 destination rejected:', destNormalized);
      return new Response(errorTwiml('Destination must be in E.164 format starting with plus sign.'), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }
    var digitsOnly = destNormalized.replace(/[^0-9]/g, '');
    if (digitsOnly.length < 7 || digitsOnly.length > 16) {
      return new Response(errorTwiml('Destination number length is invalid.'), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }
    // Block US premium-rate (1-900, 1-976) and toll-free fraud-prone patterns
    if (/^1?9(00|76)/.test(digitsOnly)) {
      console.error('[phone/outbound] PREMIUM-RATE BLOCK on destination:', destNormalized);
      return new Response(errorTwiml('Calls to that number are not permitted.'), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }
    to = destNormalized;

    // Look up the team member to get their assigned KTC number (used as caller ID).
    //
    // v55.29 — three-tier fallback so users who haven't been assigned a
    // personal number can still place outbound calls:
    //   1. The user's assigned phone_numbers row (preferred — shows them as the caller)
    //   2. TWILIO_MAIN_NUMBER env var (legacy override)
    //   3. The shared "main" line in phone_numbers (the company toll-free)
    // If all three fail we surface a clear error to the user instead of
    // letting Twilio reject the call with no useful message.
    var callerId = '';
    var assigned_to = null;
    var recordingEnabled = true; // default to recording on (with disclaimer)
    if (identity && identity !== 'guest') {
      try {
        var lookup = await supabase
          .from('phone_numbers')
          .select('phone_number, recording_enabled, assigned_to')
          .eq('assigned_to', identity)
          .maybeSingle();
        if (lookup.data) {
          callerId = lookup.data.phone_number || '';
          assigned_to = lookup.data.assigned_to;
          recordingEnabled = lookup.data.recording_enabled !== false;
        }
      } catch (e) {
        console.warn('[phone/outbound] number lookup failed:', e.message);
      }
    }
    // Tier 2: env var fallback
    if (!callerId && process.env.TWILIO_MAIN_NUMBER) {
      callerId = process.env.TWILIO_MAIN_NUMBER;
    }
    // Tier 3: shared "main" line from phone_numbers — works without env var
    if (!callerId) {
      try {
        var mainLookup = await supabase
          .from('phone_numbers')
          .select('phone_number')
          .eq('number_type', 'main')
          .limit(1)
          .maybeSingle();
        if (mainLookup.data && mainLookup.data.phone_number) {
          callerId = mainLookup.data.phone_number;
        }
      } catch (e) {
        console.warn('[phone/outbound] main number lookup failed:', e.message);
      }
    }
    // If all three tiers failed, refuse the call with a clear voice message
    // instead of letting Twilio fail silently with no caller ID.
    if (!callerId) {
      console.error('[phone/outbound] no caller ID available — user has no assigned number, no TWILIO_MAIN_NUMBER, no main line in DB');
      return new Response(errorTwiml(
        'No phone number is configured for outgoing calls. Please ask an admin to assign you a phone number in Settings.'
      ), { headers: { 'Content-Type': 'text/xml' } });
    }

    // Try to match the destination to a customer in our DB.
    // We capture both the id (for linking) AND the name (for caller_name
    // display in call history). Previously the name was selected but
    // never used, so the call history showed unfamiliar phone numbers
    // even when the customer was on file.
    var customer_id = null;
    var customer_name = null;
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
          customer_name = custLookup.data[0].name || null;
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
        caller_name: customer_name, // populated when we matched a customer
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
    if (recordingEnabled) {
      twiml += '<Say voice="Polly.Joanna">This call may be recorded for quality and training purposes.</Say>';
    }
    var dialAttrs = 'callerId="' + xmlEscape(callerId) + '"'
      + ' answerOnBridge="true"'
      + ' statusCallback="' + xmlEscape(statusCallbackUrl) + '"'
      + ' statusCallbackEvent="completed"'
      + ' statusCallbackMethod="POST"';
    if (recordingEnabled) {
      dialAttrs += ' record="record-from-answer"'
        + ' recordingStatusCallback="' + xmlEscape(recordingCallbackUrl) + '"'
        + ' recordingStatusCallbackEvent="completed"'
        + ' recordingStatusCallbackMethod="POST"';
    }
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
