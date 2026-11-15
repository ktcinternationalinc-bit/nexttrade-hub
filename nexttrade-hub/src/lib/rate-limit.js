// src/lib/rate-limit.js
// =====================
// Simple in-memory rate limiter for AI endpoints.
//
// USE CASE:
//   /api/tts and /api/transcribe call ElevenLabs and OpenAI Whisper
//   respectively. Each call costs real money. If a malicious actor (or a
//   buggy client) hammers them, the bill spirals. Rate-limiting caps the
//   damage.
//
// LIMITATIONS (acceptable for KTC's scale; revisit at billion-dollar):
//   - In-memory only. If you scale to multiple Vercel function instances,
//     each instance has its own bucket. Total throughput could be N×limit.
//   - Lost on cold start. Per-user budget resets when the function rehydrates.
//   - Not strict — best-effort cap.
//
// FOR PRODUCTION HARDENING:
//   Swap for Upstash Redis (`@upstash/ratelimit`) when cost/abuse becomes
//   a real concern. Keep the same `checkRateLimit(userId, scope)` API so
//   routes don't change.
//
// USAGE (in an API route):
//   import { checkRateLimit } from '../../../lib/rate-limit';
//   var result = checkRateLimit(userId, 'tts');
//   if (!result.allowed) {
//     return Response.json({ error: 'Too many requests' }, { status: 429 });
//   }
//
// SWC/Vercel constraint: var only, no template literals.

// Per-scope budgets (requests per window).
var BUDGETS = {
  // Generous for normal use, painful for abuse.
  // ElevenLabs costs ~$0.30 per 1k chars; tts truncates to 1k chars per call.
  // 60 calls/hour/user = ~$18/hour worst case per user. Three teammates × 8h
  // = ~$432/day even if they all max out. Real usage will be far lower.
  tts: { max: 60, windowMs: 60 * 60 * 1000 },        // 60 per hour
  // Whisper costs ~$0.006/minute of audio. With per-call file caps below,
  // 30 calls/hour/user is ~$5/hour worst case per user.
  transcribe: { max: 30, windowMs: 60 * 60 * 1000 }, // 30 per hour
  // AI text endpoints (Anthropic). Tokens already capped per-call.
  ask: { max: 120, windowMs: 60 * 60 * 1000 },       // 120 per hour
  // Social content generation — each call produces 3 platform posts.
  // 40/hour/user is generous for real use, caps cost runaway.
  'social-content': { max: 40, windowMs: 60 * 60 * 1000 },
  // Brand learning extraction — reads a doc/URL per call. 30/hour is plenty.
  'brand-learn': { max: 30, windowMs: 60 * 60 * 1000 },
  // Image -> content (vision). 30/hour caps cost; each call sends one image.
  'image-content': { max: 30, windowMs: 60 * 60 * 1000 },
  // SEO audit — fetches + analyzes one page per call. 60/hour.
  'seo-audit': { max: 60, windowMs: 60 * 60 * 1000 },
  // Default (anything else)
  default: { max: 60, windowMs: 60 * 60 * 1000 },
};

// Keyed by userId+scope. Each entry: { count, resetAt }.
// Map preserves insertion order, easy to GC.
var BUCKETS = new Map();

// Periodic cleanup so the Map doesn't grow unbounded across days.
var lastSweepMs = 0;
var SWEEP_INTERVAL_MS = 5 * 60 * 1000; // sweep every 5min when called
function sweepIfDue(now) {
  if (now - lastSweepMs < SWEEP_INTERVAL_MS) return;
  lastSweepMs = now;
  // Iterate and drop expired entries
  var expired = [];
  BUCKETS.forEach(function (entry, key) {
    if (entry.resetAt <= now) expired.push(key);
  });
  for (var i = 0; i < expired.length; i++) BUCKETS.delete(expired[i]);
}

export function checkRateLimit(userId, scope) {
  // Defensive — anonymous request still gets bucketed under a generic key
  // so a single attacker without auth can't bypass entirely.
  var key = (userId || 'anon') + ':' + (scope || 'default');
  var budget = BUDGETS[scope] || BUDGETS.default;
  var now = Date.now();
  sweepIfDue(now);
  var entry = BUCKETS.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + budget.windowMs };
    BUCKETS.set(key, entry);
  }
  entry.count++;
  var remaining = Math.max(0, budget.max - entry.count);
  return {
    allowed: entry.count <= budget.max,
    remaining: remaining,
    resetAt: entry.resetAt,
    limit: budget.max,
  };
}

// Export for tests
export function _resetForTests() {
  BUCKETS.clear();
  lastSweepMs = 0;
}
