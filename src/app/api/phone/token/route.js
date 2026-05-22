// ============================================================
// /api/phone/token — TWILIO VOICE SDK ACCESS TOKEN
// ============================================================
// What this does:
//   The Twilio Voice SDK (running in your team member's browser)
//   needs a signed JWT "access token" to register as a client
//   and make/receive calls. This endpoint generates that token.
//
// v55.23 (Apr 27 2026) — REWRITTEN to use Twilio's official
// `twilio` npm package instead of a hand-rolled JWT.
//
// Background: the previous version built the JWT manually with
// crypto.subtle.sign(). It validated against a JWT decoder but
// the Voice SDK v2 client rejected it with "Client version not
// supported" — the v2 SDK is strict about the exact grant
// structure, JTI format, and signature algorithm flag, and our
// hand-rolled token was just slightly off. The official package
// gets it right by construction and handles version differences
// internally.
//
// How it works:
//   1. Browser calls POST /api/phone/token with { user_id }
//   2. We require a valid Supabase session (anti-impersonation)
//   3. We sign a JWT using twilio.jwt.AccessToken with:
//        • identity = user_id (so <Client>user_id</Client> reaches them)
//        • VoiceGrant with incomingAllow + outgoingApplicationSid
//   4. Browser uses the token to register with Twilio
//
// Security:
//   • API Secret never leaves the server (only used here for signing)
//   • Tokens expire after 1 hour — browser refreshes via tokenWillExpire
//   • identity = the team member's UUID, ties to our DB
//
// Required env vars:
//   TWILIO_ACCOUNT_SID     — your account ID (starts with AC)
//   TWILIO_API_KEY_SID     — API Key SID (starts with SK)
//   TWILIO_API_KEY_SECRET  — API Key Secret (long random string)
//   TWILIO_TWIML_APP_SID   — TwiML App SID (starts with AP)
//
// If any are missing, the endpoint returns a clear error listing
// which ones — so the team member sees a meaningful message
// instead of a silent SDK failure.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';
import { requireUser, checkRateLimit, getRateLimitKey } from '../../../../lib/phone-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Force Node.js runtime — the Twilio SDK uses Node-only APIs (crypto module
// classes, Buffer). It will not run in Edge runtime.
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    // Rate limit — 10 token requests per minute per IP. Tokens are valid
    // for 1 hour so we shouldn't need many. This blocks DoS / cost-spam.
    var rl = checkRateLimit(getRateLimitKey(req, 'token'), 10, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: 'rate limit exceeded' }, {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfter || 60) },
      });
    }

    // Auth — require a valid Supabase session. Anonymous requests are blocked.
    var auth = await requireUser(req);
    if (!auth.user) {
      return NextResponse.json({ error: 'authentication required' }, { status: 401 });
    }

    var body = await req.json();
    var user_id = body.user_id;

    // The user_id in the body must match the authenticated user.
    // Otherwise a logged-in user could request a token AS another user
    // and intercept their incoming calls.
    if (user_id && user_id !== auth.user.id) {
      console.warn('[phone/token] user_id mismatch — auth user', auth.user.id, 'requested', user_id);
      return NextResponse.json({ error: 'user_id mismatch' }, { status: 403 });
    }
    // Default to authenticated user's id if body didn't supply one
    user_id = user_id || auth.user.id;

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

    // identity = the user's UUID
    // This is what <Client>X</Client> uses in TwiML to reach this browser.
    var identity = user_id;

    // Look up the user's assigned phone number (so the UI can show "you're using +1...")
    var assignedNumber = null;
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

    // ---- Build the token using the official Twilio SDK ----
    var AccessToken = twilio.jwt.AccessToken;
    var VoiceGrant = AccessToken.VoiceGrant;

    // 1 hour TTL — matches what the Voice SDK expects to refresh against
    var ttl = 3600;

    var token = new AccessToken(
      accountSid,
      apiKeySid,
      apiKeySecret,
      {
        identity: identity,
        ttl: ttl,
      }
    );

    var voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    });
    token.addGrant(voiceGrant);

    var jwt = token.toJwt();

    return NextResponse.json({
      token: jwt,
      identity: identity,
      phone_number: assignedNumber ? assignedNumber.phone_number : null,
      label: assignedNumber ? assignedNumber.label : null,
      expires_at: Math.floor(Date.now() / 1000) + ttl,
    });
  } catch (e) {
    console.error('[phone/token] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
