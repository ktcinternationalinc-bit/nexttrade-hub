// ============================================================
// /api/phone/token — TWILIO VOICE SDK ACCESS TOKEN
// ============================================================
// What this does:
//   The Twilio Voice SDK (running in your team member's browser)
//   needs a signed JWT "access token" to register as a client
//   and make/receive calls. This endpoint generates that token,
//   signed with your API Key + Secret.
//
// How it works:
//   1. Browser calls POST /api/phone/token with { user_id }
//   2. We sign a JWT with:
//        • identity = user_id (so <Client>user_id</Client> in TwiML reaches them)
//        • voice grants for incoming calls + outgoing via TwiML App
//   3. Browser uses the token to register with Twilio
//   4. Browser then rings when a call arrives, and can place outbound
//
// Security:
//   • API Secret never leaves the server (only used here for signing)
//   • Tokens expire after 1 hour — browser refreshes as needed
//   • identity = the team member's UUID, ties to our DB
//
// Required env vars (from Phase B Twilio setup):
//   TWILIO_ACCOUNT_SID     — your account ID (Phase A)
//   TWILIO_API_KEY_SID     — starts with SK (Phase B)
//   TWILIO_API_KEY_SECRET  — long random string (Phase B)
//   TWILIO_TWIML_APP_SID   — starts with AP (Phase B)
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Convert a string to URL-safe base64 (no padding) — used for JWT parts
function b64url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlBytes(buffer) {
  // For binary data (signature)
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export const runtime = 'nodejs';

export async function POST(req) {
  try {
    var body = await req.json();
    var user_id = body.user_id;

    var accountSid = process.env.TWILIO_ACCOUNT_SID;
    var apiKeySid = process.env.TWILIO_API_KEY_SID;
    var apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
    var twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      var missing = [];
      if (!accountSid) missing.push('TWILIO_ACCOUNT_SID');
      if (!apiKeySid) missing.push('TWILIO_API_KEY_SID');
      if (!apiKeySecret) missing.push('TWILIO_API_KEY_SECRET');
      if (!twimlAppSid) missing.push('TWILIO_TWIML_APP_SID');
      return NextResponse.json({
        error: 'Twilio Voice SDK not configured. Missing env vars: ' + missing.join(', ')
      }, { status: 500 });
    }

    // identity = the user's UUID (or 'guest' if no user)
    // This is what <Client>X</Client> uses in TwiML to reach this browser.
    var identity = user_id || 'guest';

    // Look up the user's assigned phone number (so the UI can show "you're using +1...")
    var assignedNumber = null;
    if (user_id) {
      try {
        var lookup = await supabase
          .from('phone_numbers')
          .select('phone_number, label')
          .eq('assigned_to', user_id)
          .maybeSingle();
        if (lookup.data) {
          assignedNumber = lookup.data;
        }
      } catch (e) {
        // Non-fatal — token still works without an assigned number
      }
    }

    // Build the JWT — Twilio Voice "fpa;v=1" format
    var ttl = 3600; // 1 hour
    var now = Math.floor(Date.now() / 1000);

    var header = {
      typ: 'JWT',
      alg: 'HS256',
      cty: 'twilio-fpa;v=1', // required by Twilio Voice SDK
    };

    var grants = {
      identity: identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: twimlAppSid },
      },
    };

    var payload = {
      jti: apiKeySid + '-' + now,
      iss: apiKeySid,
      sub: accountSid,
      iat: now,
      exp: now + ttl,
      grants: grants,
    };

    var headerB64 = b64url(JSON.stringify(header));
    var payloadB64 = b64url(JSON.stringify(payload));
    var signingInput = headerB64 + '.' + payloadB64;

    // Sign with HMAC-SHA256
    var encoder = new TextEncoder();
    var key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(apiKeySecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    var sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
    var sigB64 = b64urlBytes(new Uint8Array(sigBuffer));

    var token = signingInput + '.' + sigB64;

    return NextResponse.json({
      token: token,
      identity: identity,
      phone_number: assignedNumber ? assignedNumber.phone_number : null,
      label: assignedNumber ? assignedNumber.label : null,
      expires_at: now + ttl,
    });
  } catch (e) {
    console.error('[phone/token] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
