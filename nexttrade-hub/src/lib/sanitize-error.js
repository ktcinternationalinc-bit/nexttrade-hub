// src/lib/sanitize-error.js
// =========================
// Strips secrets and API keys from error messages before returning to the
// client. Use this on every catch block in an /api route that handles
// external API errors (Anthropic, OpenAI, ElevenLabs, Resend, Plaid,
// Twilio, Supabase admin).
//
// WHY:
//   External APIs sometimes return error messages that include the literal
//   key in the body, e.g.:
//     "Authentication failed: Invalid Bearer token sk-ant-api03-XXXX"
//   If we forward that string to the browser, the key gets shipped in
//   plaintext to anyone who triggers the error.
//
// USAGE:
//   import { sanitizeErr } from '../../../lib/sanitize-error';
//   try { ... } catch (err) {
//     console.error('[my-route]', err);  // log full error server-side
//     return Response.json({ error: sanitizeErr(err) }, { status: 500 });
//   }
//
// SWC/Vercel constraint: API routes must use var (no let/const) and no
// template literals. This file uses ES export but no template-literal
// strings, so it's safe.

// Regexes for things we MUST strip from any error string before sending
// it back to the browser.
var SECRET_PATTERNS = [
  // Anthropic API key (sk-ant-... or sk-ant-api03-...)
  /sk-ant-[a-zA-Z0-9-_]{20,}/g,
  // OpenAI API key (sk-... or sk-proj-...)
  /sk-(?:proj-)?[a-zA-Z0-9]{20,}/g,
  // Generic "Bearer <token>" header content
  /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
  // ElevenLabs key (32 hex chars typical)
  /xi-api-key[:\s]+[a-zA-Z0-9]{20,}/gi,
  // Resend API key (re_...)
  /re_[a-zA-Z0-9]{20,}/g,
  // Generic JWT (three base64 segments separated by dots)
  /eyJ[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_.+/=-]{10,}/g,
  // AWS keys (AKIA prefix)
  /AKIA[A-Z0-9]{16}/g,
  // Twilio Auth Token (32-char hex)
  /\b[a-f0-9]{32}\b/gi,
  // SUPABASE_SERVICE_ROLE_KEY pattern (eyJ-prefix JWT, caught above)
  // Supabase anon-key environment value
  /SUPABASE_(?:SERVICE_ROLE|ANON)_KEY[:\s=]+\S+/gi,
];

// Friendly fallback messages keyed by error markers we recognize. If the
// raw error contains one of these signals, we return a plain message
// instead of the raw string. Fail-secure default.
var FRIENDLY_MAP = [
  { match: /401|unauthorized|invalid.*api.?key|bad.*token/i,
    msg: 'AI service authentication failed. Please contact support.' },
  { match: /429|rate.?limit|too many requests/i,
    msg: 'AI service is busy. Please try again in a moment.' },
  { match: /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i,
    msg: 'AI service did not respond in time. Please try again.' },
  { match: /500|503|service unavailable|server error|ENOTFOUND|ECONNREFUSED/i,
    msg: 'AI service is temporarily unavailable. Please try again shortly.' },
  { match: /content.*policy|safety|harmful/i,
    msg: 'Request was blocked by content safety. Please rephrase.' },
];

export function sanitizeErr(err) {
  // Defensive — null / undefined / weird types
  if (err == null) return 'Unknown error.';
  var raw;
  if (typeof err === 'string') raw = err;
  else if (err && typeof err.message === 'string') raw = err.message;
  else {
    try { raw = JSON.stringify(err); } catch (e) { raw = 'Unknown error.'; }
  }
  // Strip every known secret pattern
  var stripped = raw;
  for (var i = 0; i < SECRET_PATTERNS.length; i++) {
    stripped = stripped.replace(SECRET_PATTERNS[i], '[redacted]');
  }
  // If the error matches a known friendly category, return that message
  for (var j = 0; j < FRIENDLY_MAP.length; j++) {
    if (FRIENDLY_MAP[j].match.test(raw)) return FRIENDLY_MAP[j].msg;
  }
  // Cap length so a runaway stack trace doesn't ship to the browser
  if (stripped.length > 200) stripped = stripped.substring(0, 200) + '...';
  return stripped;
}
