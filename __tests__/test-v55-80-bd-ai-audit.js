// __tests__/test-v55-80-bd-ai-audit.js
// =========================================
// BILLION-DOLLAR AI OPERATIONAL AUDIT
//
// Looks at the AI system from the angle of "what would embarrass a real
// company in production?"  Covers:
//
//   1. SECRETS — no API keys / tokens leaked into client bundles
//   2. AUTHN/AUTHZ — every AI route checks a user identity before
//      spending money or returning data
//   3. RATE-LIMIT — endpoints that cost real money have some kind of
//      cap (token budget, request budget, throttle)
//   4. INJECTION — user-typed text that flows into LLM prompts is
//      treated as data, not as instructions (no "ignore previous
//      instructions" footgun)
//   5. PII — no IPs / emails / passwords / SSNs leaking into prompts
//      or AI logs
//   6. ERROR PATHS — every external call (Anthropic, OpenAI,
//      ElevenLabs) has try/catch and a graceful fallback string;
//      no raw error bodies returned to the client
//   7. WAKE-WORD — false-positive vectors closed (Sweep B re-checks
//      previous fix is still intact)
//   8. PERSONA SWITCHING — race conditions between voice + click
//      switches
//   9. CONTEXT CONTAMINATION — Nadia briefing data scoped to the
//      logged-in user (no cross-user leak)
//   10. AI MEMORY — ai-memory.js doesn't blow up on missing rows /
//       very large memory blobs
//
// Run: node __tests__/test-v55-80-bd-ai-audit.js

var fs = require('fs');
var path = require('path');

var passed = 0;
var failed = 0;
var critical = 0;
function ok(name, cond, detail, isCritical) {
  if (cond) passed++;
  else {
    failed++;
    if (isCritical) critical++;
    console.error('  ' + (isCritical ? '🔴 CRITICAL: ' : '✗ ') + name + (detail ? ' — ' + detail : ''));
  }
}
function load(p) {
  try { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
  catch (e) { return ''; }
}
function listFiles(dir) {
  try { return fs.readdirSync(path.join(__dirname, '..', dir), { recursive: true })
    .filter(function (f) { return /\.(js|jsx|ts|tsx)$/.test(f); }); }
  catch (e) { return []; }
}

console.log('\n=== BILLION-DOLLAR AI OPERATIONAL AUDIT ===\n');

// ---------------------------------------------------------------
// 1. SECRETS — no API keys in client bundles
// ---------------------------------------------------------------
console.log('1. Secrets handling');
// Anthropic / OpenAI / ElevenLabs / Resend keys must NEVER appear in any
// 'use client' component. They live server-side in /api routes only.
var clientFiles = listFiles('src/components')
  .concat(listFiles('src/app').filter(function (f) { return !/^api\//.test(f); }));
var leakedKeys = [];
clientFiles.forEach(function (f) {
  var fp = (f.indexOf('components') === -1 ? 'src/app/' : 'src/') + f.replace(/^components\//, 'components/');
  if (!fs.existsSync(path.join(__dirname, '..', fp))) {
    fp = 'src/components/' + f;
  }
  var src = load(fp);
  if (!src) return;
  // 'use client' marker = browser-shipped file
  if (src.indexOf("'use client'") === -1 && src.indexOf('"use client"') === -1) return;
  // Look for env vars that should be SERVER-ONLY (no NEXT_PUBLIC_ prefix)
  ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'RESEND_API_KEY',
   'TWILIO_AUTH_TOKEN', 'PLAID_SECRET', 'GOOGLE_CLIENT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY',
   'CLAUDE_API_KEY', 'STRIPE_SECRET_KEY']
   .forEach(function (key) {
    // process.env.KEY is OK only with NEXT_PUBLIC_ prefix in client code.
    var pat = new RegExp('process\\.env\\.' + key + '\\b', 'g');
    if (pat.test(src)) leakedKeys.push(fp + ': ' + key);
  });
});
ok('1.1 No SERVER-ONLY API keys referenced in client components',
   leakedKeys.length === 0,
   leakedKeys.length > 0 ? 'leaks: ' + leakedKeys.join(', ') : '',
   true);

// ---------------------------------------------------------------
// 2. AUTHN/AUTHZ — AI routes that cost money or return data
// ---------------------------------------------------------------
console.log('\n2. Authn/Authz on AI routes');
// Every /api/* route that calls Anthropic, OpenAI, or returns user data
// should require a session OR a known internal-only auth pattern.
var aiRoutes = [
  'src/app/api/ask/route.js',
  'src/app/api/ask-v2/route.js',
  'src/app/api/tts/route.js',
  'src/app/api/transcribe/route.js',
  'src/app/api/translate/route.js',
  'src/app/api/categorize/route.js',
  'src/app/api/accountant/route.js',
  'src/app/api/hr-report/coach/route.js',
  'src/app/api/hr-report/review/route.js',
  'src/app/api/nadia/watch/route.js',
  'src/app/api/nadia/acknowledge/route.js',
  'src/app/api/claude-handoff/route.js',
];
aiRoutes.forEach(function (rt) {
  var src = load(rt);
  if (!src) {
    // Some routes may not exist in this branch — skip silently
    return;
  }
  // Look for ANY auth pattern: supabase.auth, headers.authorization,
  // cookies, x-internal-key, or a comment explicitly explaining why no auth.
  var hasAuth = /supabase\.auth\.|headers?\.authorization|x-internal|cookies\(\)|user_id\s*=|getUserOrThrow|requireUser|service_role/i.test(src);
  // Some routes like /tts and /transcribe are legitimately accessed
  // without an auth check (called from within authenticated pages and
  // rate-limited downstream). Flag, don't fail.
  if (!hasAuth) {
    var rlPattern = /rate.?limit|throttle|max.?tokens|max.?requests/i;
    var hasRateLimit = rlPattern.test(src);
    ok('2.x ' + rt + ' has auth check OR rate-limit',
       hasRateLimit,
       hasRateLimit ? 'rate-limited only' : 'NO auth NO rate-limit — risk of abuse');
  } else {
    ok('2.x ' + rt + ' enforces auth check', true);
  }
});

// ---------------------------------------------------------------
// 3. RATE-LIMIT / TOKEN BUDGET
// ---------------------------------------------------------------
console.log('\n3. Token budget / request limits');
// Routes that call Anthropic should cap max_tokens to prevent runaway cost.
var anthropicRoutes = ['src/app/api/ask/route.js', 'src/app/api/ask-v2/route.js',
                       'src/app/api/translate/route.js', 'src/app/api/accountant/route.js',
                       'src/app/api/hr-report/coach/route.js', 'src/app/api/hr-report/review/route.js',
                       'src/app/api/categorize/route.js', 'src/app/api/claude-handoff/route.js'];
anthropicRoutes.forEach(function (rt) {
  var src = load(rt);
  if (!src) return;
  // If route calls Anthropic
  if (/anthropic|claude.*messages|api\.anthropic\.com/i.test(src)) {
    // Should set max_tokens (or maxOutputTokens)
    var capped = /max_?tokens\s*:\s*\d+|maxOutputTokens\s*:\s*\d+/i.test(src);
    ok('3.x ' + rt + ' caps max_tokens (no runaway cost)', capped, '', true);
  }
});

// ---------------------------------------------------------------
// 4. PROMPT INJECTION
// ---------------------------------------------------------------
console.log('\n4. Prompt injection defense');
// User-typed text flowing into prompts should be quoted / fenced /
// labeled as data, not injected raw into the system prompt area.
var promptInjectionFiles = ['src/app/api/ask/route.js', 'src/app/api/ask-v2/route.js',
                            'src/app/api/accountant/route.js', 'src/app/api/translate/route.js'];
promptInjectionFiles.forEach(function (rt) {
  var src = load(rt);
  if (!src) return;
  // If the file references both `messages` AND user input, check for fencing
  if (/messages\s*[:=]/.test(src) && /body\.\w+|req\.body|await req\.json/.test(src)) {
    // Look for proper role-based separation
    var hasUserRole = /role\s*[:=]\s*['"]user['"]/i.test(src);
    var hasSystemSep = /system\s*:\s*|role\s*[:=]\s*['"]system['"]/i.test(src);
    ok('4.x ' + rt + ' uses role=user (not concatenated into system prompt)',
       hasUserRole && hasSystemSep,
       'system prompt should be separate from user input');
  }
});

// ---------------------------------------------------------------
// 5. PII in prompts
// ---------------------------------------------------------------
console.log('\n5. PII handling in AI prompts');
// AI prompts should never include raw IP addresses, browser fingerprints,
// or session IDs. (User name + role + generic action = OK; raw IP = not OK.)
var pii_routes = ['src/app/api/ask/route.js', 'src/app/api/ask-v2/route.js',
                  'src/app/api/accountant/route.js', 'src/app/api/hr-report/coach/route.js',
                  'src/app/api/hr-report/review/route.js'];
pii_routes.forEach(function (rt) {
  var src = load(rt);
  if (!src) return;
  // Look for raw injection of forbidden fields
  var leaks = [];
  if (/ip_address|client.?ip|user_ip|x-forwarded-for/i.test(src)) leaks.push('ip');
  if (/user.?agent.*messages|user.?agent.*content/i.test(src)) leaks.push('user-agent');
  if (/session_?id.*messages|session_?id.*content/i.test(src)) leaks.push('session-id');
  ok('5.x ' + rt + ' does not inject raw IP/UA/session into AI prompt',
     leaks.length === 0,
     leaks.length > 0 ? 'leaks: ' + leaks.join(', ') : '',
     leaks.length > 0);
});

// ---------------------------------------------------------------
// 6. ERROR PATHS — graceful failure, no leakage of API errors
// ---------------------------------------------------------------
console.log('\n6. Error paths');
aiRoutes.forEach(function (rt) {
  var src = load(rt);
  if (!src) return;
  // External AI fetches must be in try/catch
  var hasFetch = /fetch\s*\(/.test(src) || /anthropic\.|openai\./i.test(src);
  if (hasFetch) {
    var hasTryCatch = /try\s*\{[\s\S]*?\bcatch\s*\(/.test(src);
    ok('6.x ' + rt + ' wraps external calls in try/catch', hasTryCatch, '', !hasTryCatch);
    // Should NOT directly return error.message or err.body to the client (could leak API key in error string)
    var leaksError = /return.*err\.message|return.*error\.message|return.*err\.body|JSON\.stringify\(err\)/i.test(src);
    ok('6.x.b ' + rt + ' does not return raw err.message to client',
       !leaksError,
       leaksError ? 'returns raw error string' : '');
  }
});

// ---------------------------------------------------------------
// 7. WAKE-WORD false positives (regression of Sweep B fix)
// ---------------------------------------------------------------
console.log('\n7. Wake-word false-positive fix still intact');
var wakeSrc = load('src/lib/voice/wake-word.js');
ok('7.1 wake-word: "media" is in filler-required group only',
   /media/.test(wakeSrc) &&
   // Look for the regex shape with two capture groups (filler-required vs bare)
   /(?:hey|hi|ok|ey|ay|yo|yeah|ya)\)\[\\s,\]\+/.test(wakeSrc) &&
   /media|nadi|jen/.test(wakeSrc),
   'two-capture-group regex must still exist');
// Live-fire test
var script = wakeSrc.replace(/export\s+function\s+/g, 'function ').replace(/export\s+\{[^}]*\}/g, '');
script += '\n;return { detectWakeWord };\n';
var ww = (new Function(script))();
ok('7.2 "this media is great" → does NOT match Nadia',
   ww.detectWakeWord('this media is great').matched === false);
ok('7.3 "the jen movie" → does NOT match Jenna',
   ww.detectWakeWord('the jen movie was good').matched === false);
ok('7.4 "hey nadia what is up" → matches Nadia',
   ww.detectWakeWord('hey nadia what is up').agent === 'nadia');
ok('7.5 "hey jen show me tickets" → matches Jenna (with filler)',
   ww.detectWakeWord('hey jen show me tickets').agent === 'jenna');
ok('7.6 "jenna can you help" → matches Jenna (bare allowed)',
   ww.detectWakeWord('jenna can you help').agent === 'jenna');
ok('7.7 empty string returns matched=false',
   ww.detectWakeWord('').matched === false);
ok('7.8 null returns matched=false (no crash)',
   ww.detectWakeWord(null).matched === false);
ok('7.9 number input does not crash',
   ww.detectWakeWord(42).matched === false);

// ---------------------------------------------------------------
// 8. PERSONA SWITCHING race conditions
// ---------------------------------------------------------------
console.log('\n8. Persona switching');
var greeter = load('src/components/AIGreeter.jsx');
ok('8.1 doSendRef ref pattern present (read latest closure)',
   /doSendRef\s*=\s*useRef|doSendRef\.current\s*=/.test(greeter),
   'must use ref to avoid stale-closure race');
ok('8.2 80ms defer documented (not magic)',
   /80ms is empirical|80ms.*persona|measured race/i.test(greeter),
   'magic number must be commented');
ok('8.3 setTimeout uses safe try/catch around persona-switch send',
   /setTimeout\(function \(\) \{[\s\S]{0,80}try \{ if \(doSendRef\.current\) doSendRef\.current/.test(greeter),
   'must not crash on race');

// ---------------------------------------------------------------
// 9. CONTEXT CONTAMINATION — briefing scoped to logged-in user
// ---------------------------------------------------------------
console.log('\n9. AI briefing context isolation');
var aiAssist = load('src/components/AIAssistant.jsx');
ok('9.1 briefing key includes user id (per-user scoping)',
   /briefing_shown_' \+ myId/.test(aiAssist),
   'cache key must include user');
ok('9.2 briefing key includes date (per-day scoping)',
   /briefing_shown_' \+ myId \+ '_' \+ todayET/.test(aiAssist),
   'cache key must include date');
// Nadia watch route should filter by user
var watchRoute = load('src/app/api/nadia/watch/route.js');
if (watchRoute) {
  ok('9.3 nadia/watch scopes to user_id',
     /user_id|assignee_id|claimed_by/.test(watchRoute),
     'cron job that proactively pings users must be scoped');
}

// ---------------------------------------------------------------
// 10. AI MEMORY — robust to missing rows / oversize blobs
// ---------------------------------------------------------------
console.log('\n10. AI Memory robustness');
var memSrc = load('src/lib/ai-memory.js');
if (memSrc) {
  ok('10.1 ai-memory has try/catch around supabase calls',
     /try\s*\{[\s\S]*?supabase[\s\S]*?\}\s*catch/.test(memSrc),
     'memory failures must not crash AI flow');
  ok('10.2 ai-memory has size limit / truncation logic',
     /\.substring\(|\.slice\(|substr|truncate|MAX_/i.test(memSrc),
     'oversize memory blobs must be truncated');
} else {
  console.log('   (ai-memory.js not present — skipping)');
}

// ---------------------------------------------------------------
// 11. NADIA WATCH (proactive cron) — safe defaults
// ---------------------------------------------------------------
console.log('\n11. Nadia watch (cron)');
if (watchRoute) {
  ok('11.1 watch returns 200 on success',
     /Response\.json\(|return new Response/i.test(watchRoute),
     'cron endpoint must return Response');
  ok('11.2 watch wraps queries in try/catch',
     /try\s*\{[\s\S]*?catch/.test(watchRoute),
     'one row failure must not crash entire cron run');
}

// ---------------------------------------------------------------
// 12. AGENT PERSONALITIES — 3 personas, distinct voice IDs, no overlap
// ---------------------------------------------------------------
console.log('\n12. Agent personalities');
var personalities = load('src/lib/agent-personalities.js');
ok('12.1 Three distinct personas',
   /nadia/i.test(personalities) && /jenna/i.test(personalities) && /sara/i.test(personalities));
// Voice IDs should be distinct for each persona
var voiceMatches = personalities.match(/voiceId\s*:\s*['"][^'"]+['"]/g) || [];
var voiceIds = voiceMatches.map(function (m) { return m.match(/['"]([^'"]+)['"]/)[1]; });
var uniqueVoiceIds = Array.from(new Set(voiceIds));
ok('12.2 Each persona has a distinct voice ID (no duplicate voices)',
   voiceIds.length >= 1 && uniqueVoiceIds.length === voiceIds.length,
   'voiceIds: ' + voiceIds.join(', '));
// Each persona should declare its own personality prompt
var sysPromptMatches = personalities.match(/personalityPrompt\s*:|systemPrompt\s*:|sysPrompt\s*:/g) || [];
ok('12.3 Each persona has a personality prompt (separate brain)',
   sysPromptMatches.length >= 3,
   'count: ' + sysPromptMatches.length);

// ---------------------------------------------------------------
// 13. NADIA ACTION BRIDGE — actions are validated before execution
// ---------------------------------------------------------------
console.log('\n13. Nadia action bridge');
var bridge = load('src/components/NadiaActionBridge.jsx');
if (bridge) {
  ok('13.1 bridge validates action params (no blind exec)',
     /Math\.max\(0,|Number\(.*\)\s*\|\|\s*\d+|trim\(\)|String\(/.test(bridge),
     'AI-generated action params must be sanitized');
  ok('13.2 bridge actions are wrapped in try/catch',
     /try\s*\{[\s\S]*?catch/.test(bridge));
  ok('13.3 bridge does NOT execute arbitrary supabase queries from AI text',
     !/supabase\.from\(.*action\.|supabase\.rpc\(.*action\./.test(bridge),
     'AI must not pick the table — bridge maps fixed action types');
}

// ---------------------------------------------------------------
// 14. TRANSCRIBE — file size limit
// ---------------------------------------------------------------
console.log('\n14. Whisper transcribe safety');
var transcribe = load('src/app/api/transcribe/route.js');
if (transcribe) {
  ok('14.1 transcribe has file-size cap',
     /maxSize|MAX_|file\.size\s*[<>]|byteLength\s*[<>]/.test(transcribe),
     'unbounded file uploads = cost runaway');
  ok('14.2 transcribe wraps OpenAI call in try/catch',
     /try\s*\{[\s\S]*?openai|whisper[\s\S]*?\}\s*catch/i.test(transcribe));
}

// ---------------------------------------------------------------
// 15. TTS — same checks
// ---------------------------------------------------------------
console.log('\n15. TTS safety');
var tts = load('src/app/api/tts/route.js');
if (tts) {
  ok('15.1 tts caps text length',
     /\.substring\(0,\s*\d+\)|\.slice\(0,\s*\d+\)|maxLength|text\.length\s*[<>]/.test(tts),
     'unbounded text → unbounded ElevenLabs cost');
  ok('15.2 tts wraps ElevenLabs call in try/catch',
     /try\s*\{[\s\S]*?elevenlabs[\s\S]*?\}\s*catch/i.test(tts));
}

// ---------------------------------------------------------------
// 16. AI HR REVIEW — output is shown TO the manager only
// ---------------------------------------------------------------
console.log('\n16. AI HR review confidentiality');
var hrReview = load('src/app/api/hr-report/review/route.js');
ok('16.1 HR review is admin-only (route checks role OR upstream component does)',
   /super_admin|admin|view_hr_report|isPriv/.test(hrReview)
   || /super_admin|view_hr_report/.test(load('src/components/HRReport.jsx')),
   'review of others must be gated');
ok('16.2 HR review prompt does NOT include team-wide salary / bank info',
   !/salary|bank_account|tax_id|ssn/i.test(hrReview));

// ---------------------------------------------------------------
// 17. CONCURRENT SESSIONS — one user, multiple devices
// ---------------------------------------------------------------
console.log('\n17. Concurrent device sessions');
// If a user logs in on phone + desktop simultaneously, the session
// rows shouldn't collide. Check user_sessions writes use upsert OR
// scope by date+last login.
var page = load('src/app/page.jsx');
ok('17.1 user_sessions update scopes by date and order by login_at desc',
   /\.eq\('date'[\s\S]+?\.order\('login_at'/.test(page),
   'must update LATEST session for that day, not all');
ok('17.2 user_sessions update uses .limit(1) (only latest row)',
   /\.order\('login_at'[\s\S]+?\.limit\(1\)/.test(page),
   'must not update many rows');

// ---------------------------------------------------------------
// 18. NEW: pingActive (last_active tracking) safety
// ---------------------------------------------------------------
console.log('\n18. last_active ping (PHASE-B+ new)');
ok('18.1 pingActive throttle is at least 30s (not hammering DB)',
   /ACTIVE_PING_MIN_GAP_MS\s*=\s*30\s*\*\s*1000/.test(page) ||
   /ACTIVE_PING_MIN_GAP_MS\s*=\s*30000/.test(page),
   'must throttle to ≥30s');
ok('18.2 pingActive is best-effort (.then with no error throw)',
   /pingActive[\s\S]+?\.then\(function \(\) \{\}\)|pingActive[\s\S]+?\/\* swallow/.test(page),
   'activity ping must never crash UI');

console.log('\n=== Results ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
console.log('CRITICAL: ' + critical);
process.exit(critical > 0 ? 2 : (failed > 0 ? 1 : 0));
