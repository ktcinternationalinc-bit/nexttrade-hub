// ============================================================
// src/lib/phone-auth.js — AUTH HELPERS FOR PHONE API ROUTES
// ============================================================
// Two main protections:
//
// 1. requireUser(req) — for routes called from the browser by
//    a logged-in team member. Validates the Supabase session
//    cookie. Returns { user, error } shape.
//
// 2. verifyTwilioSignature(req, body) — for webhook routes
//    Twilio calls into. Verifies the X-Twilio-Signature header
//    matches what Twilio would have signed with our auth token.
//    This prevents anyone from spoofing webhook data.
//
// 3. checkRateLimit(key, max, windowMs) — simple in-memory rate
//    limit. Not perfect across serverless instances but good
//    enough to slow down attackers.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// In-memory rate limit store. NOTE: This resets on every cold start.
// For production-grade rate limiting, use Vercel KV or Upstash.
// This is a safety net, not a hard guarantee.
var rateLimitMap = new Map();

function cleanupRateLimit() {
  var now = Date.now();
  for (var [k, v] of rateLimitMap.entries()) {
    if (v.expiresAt < now) rateLimitMap.delete(k);
  }
}

export function checkRateLimit(key, max, windowMs) {
  if (rateLimitMap.size > 1000) cleanupRateLimit();
  var now = Date.now();
  var entry = rateLimitMap.get(key);
  if (!entry || entry.expiresAt < now) {
    rateLimitMap.set(key, { count: 1, expiresAt: now + windowMs });
    return { ok: true, remaining: max - 1 };
  }
  if (entry.count >= max) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((entry.expiresAt - now) / 1000) };
  }
  entry.count++;
  return { ok: true, remaining: max - entry.count };
}

// Best-effort identifier for rate limiting (IP first, fallback to a header)
export function getRateLimitKey(req, prefix) {
  var ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  // Take the first IP if multiple comma-separated
  ip = String(ip).split(',')[0].trim();
  return prefix + ':' + ip;
}

// Validate that the request comes from an authenticated Supabase user.
// Returns { user, error }. user is null if not authenticated.
export async function requireUser(req) {
  try {
    var authHeader = req.headers.get('authorization');
    var cookieHeader = req.headers.get('cookie');

    var supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    var supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return { user: null, error: 'Supabase not configured' };
    }

    // Try Bearer token from Authorization header (when frontend sends it)
    var token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    // If no Bearer, try to extract sb-access-token from cookies
    if (!token && cookieHeader) {
      var cookieMatch = cookieHeader.match(/sb-[^=]*-auth-token=([^;]+)/);
      if (cookieMatch) {
        try {
          var raw = decodeURIComponent(cookieMatch[1]);
          // Sometimes wrapped in quotes / array
          if (raw.startsWith('[')) {
            var arr = JSON.parse(raw);
            token = arr[0];
          } else {
            var obj = JSON.parse(raw);
            token = obj.access_token || obj;
          }
        } catch (e) {
          // Fall through — token stays null
        }
      }
    }

    if (!token) {
      return { user: null, error: 'No auth token' };
    }

    var sb = createClient(supabaseUrl, supabaseAnonKey);
    var userRes = await sb.auth.getUser(token);
    if (userRes.error || !userRes.data.user) {
      return { user: null, error: 'Invalid token' };
    }
    return { user: userRes.data.user, error: null };
  } catch (e) {
    return { user: null, error: e.message };
  }
}

// Verify a Twilio webhook signature.
// Twilio signs requests with HMAC-SHA1(authToken, fullUrl + sortedParams).
// We compare against the X-Twilio-Signature header.
//
// Returns true if signature valid OR if validation is disabled (e.g. local dev).
export function verifyTwilioSignature(req, formDataObject) {
  try {
    // Allow disabling for local dev or if explicitly skipped
    if (process.env.SKIP_TWILIO_SIGNATURE === 'true') return true;

    var authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      console.warn('[twilio-sig] TWILIO_AUTH_TOKEN not set — cannot verify signature');
      // Fail open in case of misconfig — better than total outage
      return true;
    }

    var twilioSig = req.headers.get('x-twilio-signature');
    if (!twilioSig) {
      console.warn('[twilio-sig] no X-Twilio-Signature header on webhook request');
      return false;
    }

    // Build the full URL Twilio would have signed.
    // IMPORTANT: must match exactly the URL Twilio POSTed to, including
    // protocol, host, path, and query string.
    var protocol = req.headers.get('x-forwarded-proto') || 'https';
    var host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    var fullUrl = protocol + '://' + host + new URL(req.url).pathname + new URL(req.url).search;

    // Sort form params alphabetically by key, then concat key+value
    var keys = Object.keys(formDataObject).sort();
    var data = fullUrl;
    for (var i = 0; i < keys.length; i++) {
      data += keys[i] + String(formDataObject[keys[i]]);
    }

    var expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
    return expected === twilioSig;
  } catch (e) {
    console.error('[twilio-sig] verify failed:', e.message);
    return false;
  }
}

// Helper for converting Twilio's webhook FormData into a plain object
// (needed for signature verification AND easier downstream use)
export async function readFormDataAsObject(req) {
  var formData = await req.formData();
  var obj = {};
  for (var [k, v] of formData.entries()) {
    obj[k] = String(v);
  }
  return obj;
}
