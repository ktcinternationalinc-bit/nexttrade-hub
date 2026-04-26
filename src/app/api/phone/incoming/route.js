// ============================================================
// /api/phone/incoming — INBOUND CALL HANDLER
// ============================================================
// What this does:
//   When someone calls one of your KTC phone numbers, Twilio
//   sends an HTTP POST to this endpoint asking "what should I
//   do with this call?" We respond with TwiML (Twilio's
//   instruction language) that:
//
//     1. Plays a friendly greeting
//     2. Plays the legal recording disclaimer (required in
//        US two-party consent states; safe to play everywhere)
//     3. Rings the assigned team member (or shared queue for
//        the toll-free main line)
//     4. If no one answers in 25 seconds, sends to voicemail
//     5. Logs every call in phone_calls table
//
// Key points:
//   • This file is HIT BY TWILIO, not by our app. The webhook
//     URL configured on each phone number in Twilio Console
//     should be: https://your-domain.com/api/phone/incoming
//   • TwiML is XML — Twilio is strict about syntax. We use
//     string concatenation rather than template literals to
//     avoid SWC compiler issues.
//   • We do NOT validate Twilio webhook signatures yet — that's
//     a Phase B hardening step. For now, Vercel's HTTPS + the
//     URL not being public knowledge is reasonable security.
//   • If anything goes wrong, fall back to a generic "please
//     leave a message" voicemail prompt so customers don't get
//     dead air.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Build the public base URL Twilio uses for callbacks
function getPublicBaseUrl(req) {
  // Prefer VERCEL_URL (set automatically on Vercel), else infer from request
  if (process.env.VERCEL_URL) return 'https://' + process.env.VERCEL_URL;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  try {
    var url = new URL(req.url);
    return url.protocol + '//' + url.host;
  } catch (e) {
    return 'https://nexttrade-hub.vercel.app';
  }
}

// XML escape — Twilio is strict. Single quotes & special chars in names break TwiML.
function xmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Build a "no one configured this number yet" fallback TwiML
function buildFallbackTwiml(reason) {
  var msg = 'Thank you for calling KTC International. We are unable to take your call at this time. Please leave a message after the beep.';
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Response>'
    + '<Say voice="Polly.Joanna">' + xmlEscape(msg) + '</Say>'
    + '<Record maxLength="120" playBeep="true" finishOnKey="#" />'
    + '<Say>Thank you. Goodbye.</Say>'
    + '<Hangup />'
    + '</Response>';
}

// POST: Twilio webhook — incoming call arrives here
export async function POST(req) {
  try {
    var formData = await req.formData();
    var to = String(formData.get('To') || '');           // Your KTC number that was called
    var from = String(formData.get('From') || '');       // Customer's number
    var callSid = String(formData.get('CallSid') || ''); // Twilio's unique ID
    var callerName = String(formData.get('CallerName') || ''); // CNAM if enabled

    var baseUrl = getPublicBaseUrl(req);

    // 1. Look up which KTC number was called and find its assigned team member
    var assignment = null;
    try {
      var lookup = await supabase
        .from('phone_numbers')
        .select('id, phone_number, label, number_type, assigned_to, recording_enabled, voicemail_enabled')
        .eq('phone_number', to)
        .maybeSingle();
      assignment = lookup.data;
    } catch (e) {
      console.warn('[phone/incoming] phone_numbers lookup failed:', e.message);
    }

    // If we don't have this number registered yet (e.g. you bought a number
    // but haven't added it to phone_numbers), play the fallback voicemail
    // so customers don't hear silence.
    if (!assignment) {
      console.log('[phone/incoming] number ' + to + ' not registered in phone_numbers');
      return new Response(buildFallbackTwiml('not-registered'), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // 2. Try to match the customer in our DB by phone number
    var customer_id = null;
    try {
      // Strip + and country code variants for fuzzy match
      var normalized = String(from).replace(/[^0-9]/g, '');
      var last10 = normalized.slice(-10);
      if (last10.length >= 7) {
        // Look for any customer whose phone field contains the last 10 digits
        var custLookup = await supabase
          .from('customers')
          .select('id, name')
          .or('phone.ilike.%' + last10 + '%,whatsapp.ilike.%' + last10 + '%')
          .limit(1);
        if (custLookup.data && custLookup.data.length > 0) {
          customer_id = custLookup.data[0].id;
        }
      }
    } catch (e) {
      console.warn('[phone/incoming] customer lookup failed:', e.message);
    }

    // 3. Log the call (creates a phone_calls row we'll update with status callbacks later)
    var callRow = null;
    try {
      var insertRes = await supabase.from('phone_calls').insert({
        twilio_call_sid: callSid,
        direction: 'inbound',
        ktc_number: to,
        customer_number: from,
        customer_id: customer_id,
        user_id: assignment.assigned_to || null,
        status: 'ringing',
        caller_name: callerName || null,
        started_at: new Date().toISOString(),
      }).select().single();
      callRow = insertRes.data;
    } catch (e) {
      // Log failure shouldn't kill the call — keep going
      console.warn('[phone/incoming] phone_calls insert failed:', e.message);
    }

    // 4. Build the TwiML response based on the number's type and configuration
    var greetingText;
    if (assignment.number_type === 'main') {
      greetingText = 'Thank you for calling KTC International.';
    } else {
      greetingText = 'Thank you for calling KTC.';
    }

    var disclaimer = '';
    if (assignment.recording_enabled) {
      disclaimer = '<Say voice="Polly.Joanna">This call may be recorded for quality and training purposes.</Say>';
    }

    var voicemailUrl = baseUrl + '/api/phone/voicemail-record'
      + '?call_id=' + encodeURIComponent(callRow ? callRow.id : '')
      + '&assigned_to=' + encodeURIComponent(assignment.assigned_to || '')
      + '&customer_id=' + encodeURIComponent(customer_id || '');

    var statusCallbackUrl = baseUrl + '/api/phone/call-status';
    var recordingCallbackUrl = baseUrl + '/api/phone/recording-callback';

    // 5. Decide where to ring. For now, since browser-based calling isn't
    // wired up yet (Phase B), we ring an actual phone number if one is
    // configured for the assigned user, otherwise straight to voicemail.
    //
    // In Phase B we'll add <Client> dial which rings the team member's
    // browser via Twilio Voice SDK.
    var ringTarget = null;
    if (assignment.assigned_to) {
      try {
        // Look up the user's personal cell phone for forwarding
        var userLookup = await supabase
          .from('user_profiles')
          .select('forwarding_number')
          .eq('id', assignment.assigned_to)
          .maybeSingle();
        if (userLookup.data && userLookup.data.forwarding_number) {
          ringTarget = userLookup.data.forwarding_number;
        }
      } catch (e) {
        // user_profiles may not have forwarding_number column yet — that's fine
      }
    }

    // 6. Compose the TwiML
    var twiml = '<?xml version="1.0" encoding="UTF-8"?>';
    twiml += '<Response>';
    twiml += '<Say voice="Polly.Joanna">' + xmlEscape(greetingText) + '</Say>';
    twiml += disclaimer;

    if (ringTarget) {
      // Ring the assigned user's forwarding phone with 25s timeout
      // If they don't answer, action= goes to voicemail
      var dialAttrs = 'timeout="25"'
        + ' action="' + xmlEscape(voicemailUrl) + '"'
        + ' method="POST"'
        + ' callerId="' + xmlEscape(to) + '"';
      if (assignment.recording_enabled) {
        dialAttrs += ' record="record-from-answer"'
          + ' recordingStatusCallback="' + xmlEscape(recordingCallbackUrl) + '"'
          + ' recordingStatusCallbackEvent="completed"'
          + ' recordingStatusCallbackMethod="POST"';
      }
      twiml += '<Dial ' + dialAttrs + '>';
      twiml += '<Number>' + xmlEscape(ringTarget) + '</Number>';
      twiml += '</Dial>';
      // If <Dial> verb completed without connecting, fall through to voicemail
      twiml += '<Say>The team is unavailable right now. Please leave a message after the beep.</Say>';
      twiml += '<Record action="' + xmlEscape(voicemailUrl) + '"';
      twiml += ' method="POST"';
      twiml += ' maxLength="180"';
      twiml += ' playBeep="true"';
      twiml += ' finishOnKey="#" />';
    } else {
      // No one to ring — straight to voicemail
      twiml += '<Say>Please leave us a message after the beep, and we will get back to you.</Say>';
      twiml += '<Record action="' + xmlEscape(voicemailUrl) + '"';
      twiml += ' method="POST"';
      twiml += ' maxLength="180"';
      twiml += ' playBeep="true"';
      twiml += ' finishOnKey="#" />';
    }

    twiml += '<Say>Thank you. Goodbye.</Say>';
    twiml += '<Hangup />';
    twiml += '</Response>';

    return new Response(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e) {
    console.error('[phone/incoming] error:', e.message);
    // Always return TwiML even on error — silence is worse
    return new Response(buildFallbackTwiml('error'), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}

// GET: kept for backwards compat with existing scaffolding (outbound call routing)
// This is hit by Twilio when someone places an outbound call from the browser.
// Will be properly implemented in Phase B with the Voice SDK token route.
export async function GET(req) {
  var url = new URL(req.url);
  var to = url.searchParams.get('To') || url.searchParams.get('phone') || '';
  var callerId = url.searchParams.get('CallerId') || process.env.TWILIO_MAIN_NUMBER || '';

  if (!to) {
    var errorTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>No number provided.</Say></Response>';
    return new Response(errorTwiml, { headers: { 'Content-Type': 'text/xml' } });
  }

  var twiml = '<?xml version="1.0" encoding="UTF-8"?>';
  twiml += '<Response>';
  twiml += '<Dial callerId="' + xmlEscape(callerId) + '">';
  twiml += '<Number>' + xmlEscape(to) + '</Number>';
  twiml += '</Dial>';
  twiml += '</Response>';

  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
}
