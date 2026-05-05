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

    // If no Bearer, try to extract sb-access-token from cookies.
    //
    // Supabase ships several cookie formats depending on client version:
    //   • sb-<project>-auth-token         (legacy single cookie)
    //   • sb-<project>-auth-token.0/.1    (split for size — modern SSR)
    //   • sb-<project>-auth-token-code-verifier (PKCE flow, NOT what we want)
    // We try the legacy single-cookie first, then assemble split cookies if
    // present, then JSON-parse. v55.25 — added split-cookie support so users
    // who don't pass an Authorization header still authenticate via cookie.
    if (!token && cookieHeader) {
      // Try single cookie first
      var cookieMatch = cookieHeader.match(/sb-[^=]*-auth-token=([^;]+)/);
      var rawCookieValue = null;
      if (cookieMatch && !/-code-verifier=/.test(cookieMatch[0])) {
        rawCookieValue = decodeURIComponent(cookieMatch[1]);
      } else {
        // Try split cookies sb-...auth-token.0, .1, ... in order
        var parts = [];
        var splitRe = /sb-[^=]*-auth-token\.(\d+)=([^;]+)/g;
        var m;
        while ((m = splitRe.exec(cookieHeader)) !== null) {
          parts[parseInt(m[1], 10)] = decodeURIComponent(m[2]);
        }
        if (parts.length > 0) {
          rawCookieValue = parts.join('');
          // base64-prefixed values from supabase-js
          if (rawCookieValue.startsWith('base64-')) {
            try {
              rawCookieValue = Buffer.from(rawCookieValue.substring(7), 'base64').toString('utf-8');
            } catch (e) { /* fall through */ }
          }
        }
      }

      if (rawCookieValue) {
        try {
          if (rawCookieValue.startsWith('[')) {
            var arr = JSON.parse(rawCookieValue);
            token = typeof arr[0] === 'string' ? arr[0] : (arr[0] && arr[0].access_token);
          } else if (rawCookieValue.startsWith('{')) {
            var obj = JSON.parse(rawCookieValue);
            token = obj.access_token || obj;
          } else {
            token = rawCookieValue;
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
// v55.42 — robust HMAC signature check.
// Twilio signs the EXACT URL it POSTs to. On Vercel, what `req.url` returns
// can be the internal deployment URL (e.g. https://...-abc123.vercel.app/...)
// while Twilio's console is configured with the production domain
// (https://nexttrade-hub.vercel.app/...). The two URLs hash to different
// signatures, so a strict check fails 100% of the time even when the
// request is genuinely from Twilio. Symptom: Twilio plays "an application
// error has occurred" because we returned 403 Forbidden.
//
// Fix: compute the expected signature for SEVERAL plausible URL variants
// and accept the request if ANY of them match. If none match, log
// loudly and reject. This way we get the security benefit of signature
// checking when it works, but a config mismatch (or Vercel quirk)
// can't take production calls down.
function computeSignature(authToken, url, formDataObject) {
  var keys = Object.keys(formDataObject).sort();
  var data = url;
  for (var i = 0; i < keys.length; i++) {
    data += keys[i] + String(formDataObject[keys[i]]);
  }
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

export function verifyTwilioSignature(req, formDataObject) {
  try {
    // Allow disabling for local dev or if explicitly skipped
    if (process.env.SKIP_TWILIO_SIGNATURE === 'true') return true;

    var authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      console.warn('[twilio-sig] TWILIO_AUTH_TOKEN not set — cannot verify signature, failing open');
      return true;
    }

    var twilioSig = req.headers.get('x-twilio-signature');
    if (!twilioSig) {
      console.warn('[twilio-sig] no X-Twilio-Signature header on webhook request — rejecting');
      return false;
    }

    // Build candidate URLs — any one that matches what Twilio signed counts as valid.
    var parsed;
    try { parsed = new URL(req.url); }
    catch (e) {
      console.warn('[twilio-sig] could not parse req.url:', req.url);
      parsed = null;
    }
    var pathAndQuery = parsed ? (parsed.pathname + parsed.search) : '';

    var protocol = req.headers.get('x-forwarded-proto') || 'https';
    var hostHeader = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';

    var candidates = [];

    // Candidate 1 — what we used to use: scheme + Host header + path
    if (hostHeader && pathAndQuery) {
      candidates.push(protocol + '://' + hostHeader + pathAndQuery);
    }
    // Candidate 2 — the literal req.url (Vercel sometimes sets this to the public URL)
    if (req.url) candidates.push(req.url);
    // Candidate 3 — NEXT_PUBLIC_APP_URL (the canonical production URL set in Vercel env)
    if (process.env.NEXT_PUBLIC_APP_URL && pathAndQuery) {
      var base = process.env.NEXT_PUBLIC_APP_URL;
      if (base.endsWith('/')) base = base.slice(0, -1);
      candidates.push(base + pathAndQuery);
    }
    // Candidate 4 — known production fallback (covers the common case where
    // NEXT_PUBLIC_APP_URL isn't set yet but Twilio is still pointing at the
    // default Vercel domain).
    if (pathAndQuery) {
      candidates.push('https://nexttrade-hub.vercel.app' + pathAndQuery);
    }

    // De-dupe candidates so we don't waste cycles re-hashing the same string.
    var seen = {};
    var unique = [];
    for (var c = 0; c < candidates.length; c++) {
      if (!seen[candidates[c]]) { seen[candidates[c]] = true; unique.push(candidates[c]); }
    }

    for (var u = 0; u < unique.length; u++) {
      var expected = computeSignature(authToken, unique[u], formDataObject);
      if (expected === twilioSig) {
        // Match found. If it wasn't candidate 0 (the "preferred" one) leave a
        // breadcrumb so we know which URL Twilio is actually signing — useful
        // for diagnosing Vercel proxy quirks later.
        if (u > 0) {
          console.log('[twilio-sig] signature matched candidate #' + u + ': ' + unique[u]);
        }
        return true;
      }
    }

    // No URL variant matched. Log the host/url details so we can debug
    // without exposing the auth token. This is the message you'll see
    // in Vercel logs when production starts dropping calls.
    console.warn('[twilio-sig] NO candidate matched. Tried:', unique);
    console.warn('[twilio-sig] req.url=' + (req.url || '(none)'));
    console.warn('[twilio-sig] host=' + hostHeader + ' x-forwarded-host=' + (req.headers.get('x-forwarded-host') || '(none)'));
    return false;
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
