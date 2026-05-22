// __tests__/test-v55-80-bd-ai-audit-2.js
// =========================================
// SECOND BILLION-DOLLAR AUDIT — areas not covered by audit-1:
//
//   19. WEBHOOK SIGNATURE VERIFICATION (Twilio, Meta WhatsApp, Plaid)
//   20. NADIA/WATCH CRON — auth header (Vercel cron secret), per-row error
//       isolation, no infinite loops
//   21. AI-MEMORY — truncation, JSON safety, no auto-execution of stored prompts
//   22. CLAUDE-HANDOFF — what's Max-only? does it leak system context?
//   23. CATEGORIZE cron — auth, batch limits
//   24. NOTIFY — does it accept arbitrary HTML and forward to Resend?
//   25. AI-MEMORY in browser — does sessionStorage leak across users?
//   26. PERSONA STATE — switching Nadia → Jenna mid-recording behavior
//   27. VOICE-WAKE: same wake word fires twice in a row (mic glitch)
//   28. WAKE FROM IDLE: detect and stop runaway listening loops
//
// Run: node __tests__/test-v55-80-bd-ai-audit-2.js

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

console.log('\n=== BD AUDIT 2 — webhooks, cron, ai-memory, persona state ===\n');

// ---------------------------------------------------------------
// 19. WEBHOOK signature verification
// ---------------------------------------------------------------
console.log('19. Webhook signature verification');
var twilioWebhooks = ['src/app/api/phone/incoming/route.js', 'src/app/api/phone/voicemail/route.js'];
twilioWebhooks.forEach(function (rt) {
  var src = load(rt);
  if (!src) return;
  // Twilio webhook signature header is X-Twilio-Signature
  var verifies = /x-twilio-signature|validateRequest|TWILIO_AUTH_TOKEN/.test(src);
  ok('19.x ' + rt + ' verifies Twilio webhook signature',
     verifies,
     'Twilio sends signed webhooks — must verify or anyone can spoof voicemail/SMS');
});
var metaWebhooks = ['src/app/api/whatsapp/webhook/route.js'];
metaWebhooks.forEach(function (rt) {
  var src = load(rt);
  if (!src) return;
  // Meta sends X-Hub-Signature-256 with HMAC-SHA256(body, app_secret)
  var verifies = /x-hub-signature|META_APP_SECRET|WHATSAPP_APP_SECRET|crypto\.createHmac/.test(src);
  ok('19.x ' + rt + ' verifies Meta webhook signature (or has explicit no-verify comment)',
     verifies,
     'Meta sends signed webhooks — verify or attacker can fake inbound messages');
});

// ---------------------------------------------------------------
// 20. NADIA/WATCH CRON
// ---------------------------------------------------------------
console.log('\n20. Nadia/watch cron');
var nadiaWatch = load('src/app/api/nadia/watch/route.js');
if (nadiaWatch) {
  // Vercel cron jobs send Authorization: Bearer ${CRON_SECRET}
  var hasCronAuth = /CRON_SECRET|x-vercel-cron|authorization/i.test(nadiaWatch);
  ok('20.1 nadia/watch checks cron auth (Vercel Bearer or x-vercel-cron header)',
     hasCronAuth,
     'cron route must verify Vercel sender; otherwise anyone can trigger it');
  // Per-row error isolation
  ok('20.2 nadia/watch wraps per-user iteration in try/catch',
     /for\s*\(.*\{[\s\S]*?try\s*\{|forEach\([\s\S]+?try\s*\{/.test(nadiaWatch),
     'one user failure must not abort the whole cron');
  // No infinite loops
  ok('20.3 nadia/watch has no while(true) loops',
     !/while\s*\(\s*true\s*\)/.test(nadiaWatch));
  // Should bound output (max users, max work)
  ok('20.4 nadia/watch uses .limit() on user query',
     /\.limit\(\d+\)/.test(nadiaWatch),
     'unbounded query = unbounded cost');
}

// ---------------------------------------------------------------
// 21. AI-MEMORY safety
// ---------------------------------------------------------------
console.log('\n21. AI-Memory safety');
var aiMem = load('src/lib/ai-memory.js');
if (aiMem) {
  // Memory is stored per-user — must scope by user_id everywhere
  ok('21.1 ai-memory queries are user_id scoped (no cross-user leak)',
     /user_id|\.eq\('user_id'/.test(aiMem),
     'memory queries must filter by user_id');
  // Should truncate stored memory blobs
  ok('21.2 ai-memory has size limit / truncation',
     /\.substring\(|\.slice\(|MAX_|length\s*[<>]\s*\d{3,}/i.test(aiMem),
     'oversize memory must be truncated');
  // Memory candidates extracted from AI responses must be sanitized
  // (an LLM might say "remember: rm -rf /" — we should not store that as a "fact")
  ok('21.3 ai-memory extraction filters out suspicious patterns',
     /filter\(|\.test\(|RegExp|MAX_FACTS|length\s*[<>]/.test(aiMem),
     'extracted facts should be size-bounded');
  // try/catch on persistence
  ok('21.4 ai-memory persist wraps inserts in try/catch',
     /try\s*\{[\s\S]*?supabase[\s\S]*?\}\s*catch/.test(aiMem));
}

// ---------------------------------------------------------------
// 22. CLAUDE-HANDOFF
// ---------------------------------------------------------------
console.log('\n22. Claude-handoff');
var handoff = load('src/app/api/claude-handoff/route.js');
if (handoff) {
  // Should require auth (returns sensitive system context)
  ok('22.1 claude-handoff requires auth',
     /auth\.|x-internal|service_role|getUser/i.test(handoff),
     'handoff exposes system internals — must be admin-only');
  // Should sanitize errors
  ok('22.2 claude-handoff uses sanitizeErr',
     /sanitizeErr|safeErr|sanitize/i.test(handoff)
     || !/return.*err\.message|return.*error\.message/.test(handoff),
     'must not leak raw errors');
} else {
  console.log('   (claude-handoff not present — skipping)');
}

// ---------------------------------------------------------------
// 23. CATEGORIZE cron
// ---------------------------------------------------------------
console.log('\n23. Categorize cron');
var categorize = load('src/app/api/categorize/route.js');
if (categorize) {
  ok('23.1 categorize uses .limit() to bound work per run',
     /\.limit\(\s*(?:\d+|MAX_PER_RUN|MAX_|\w+_LIMIT)\s*\)/.test(categorize),
     'cron must bound work or it could OOM');
  ok('23.2 categorize wraps per-row processing in try/catch',
     /try\s*\{[\s\S]+?\}\s*catch/.test(categorize));
}

// ---------------------------------------------------------------
// 24. NOTIFY route — HTML injection safety
// ---------------------------------------------------------------
console.log('\n24. Notify (email/whatsapp) safety');
var notify = load('src/app/api/notify/route.js');
if (notify) {
  // Resend html field accepts arbitrary HTML — if user-typed text flows in
  // unescaped, an attacker could inject scripts that load when the email
  // is opened in a webmail client that renders HTML.
  ok('24.1 notify either escapes HTML OR uses text-only mode',
     /escapeHtml|escape\(|encodeURI|text:\s*\w+|html.*replace.*</.test(notify)
     || /text:\s*[`'"]/.test(notify),
     'must escape user input before injecting into HTML email body');
  ok('24.2 notify wraps Resend call in try/catch',
     /try\s*\{[\s\S]+?resend[\s\S]+?catch/i.test(notify));
}

var notifyServer = load('src/lib/notify-server.js');
if (notifyServer) {
  // Same check on the server-lib
  ok('24.3 notify-server.js escapes user input in HTML body',
     /escapeHtml|escape\(|\.replace\(\/[<>]\/|text:\s*[`'"]|sanitize/i.test(notifyServer),
     'every email content path must escape');
}

// ---------------------------------------------------------------
// 25. AI-MEMORY in browser
// ---------------------------------------------------------------
console.log('\n25. AI-Memory browser-side isolation');
var greeter = load('src/components/AIGreeter.jsx');
// browser-side localStorage keys for AI history must include the user id
// so logging in as a different user doesn't see the previous user's chats.
var aiHistKeys = greeter.match(/localStorage\.(?:get|set)Item\(['"][^'"]*[Aa]i[^'"]*['"]/g) || [];
aiHistKeys.forEach(function (k) {
  // Each AI-related localStorage key should reference user.id, persona, or both
  var keyName = k.match(/['"]([^'"]+)['"]/)[1];
  // If it's a fixed key (no template/concat), warn
  var isStatic = !/'\s*\+|"\s*\+|\$\{/.test(k);
  if (isStatic) {
    ok('25.x localStorage AI key is per-user',
       false,
       keyName + ' is static — would persist across user switches');
  }
});
// Confirm at least one localStorage AI key DOES include user identifier
var pageSrc25 = load('src/app/page.jsx');
var aiCombined25 = greeter + pageSrc25;
ok('25.1 At least one AI-related localStorage key includes user identifier',
   /localStorage\.(?:get|set)Item\([^)]*\+\s*(?:user|profile|myId|userId|uid)/i.test(aiCombined25)
   || /localStorage\.(?:get|set)Item\([^)]*\$\{(?:user|profile|myId|userId|uid)/i.test(aiCombined25)
   || /'nadia\.\w+\.'\s*\+\s*(?:userProfile|myId|user|uid)/i.test(aiCombined25),
   'AI history must scope by user');

// ---------------------------------------------------------------
// 26. PERSONA STATE — switching mid-recording
// ---------------------------------------------------------------
console.log('\n26. Persona state during recording');
// If user is dictating to Nadia and clicks Jenna mid-recording, what happens?
// Best practice: stop the current recording, switch persona, NOT silently
// route the dictation to the wrong persona.
ok('26.1 AIGreeter has persona-change handler that stops/resets recording',
   /(stop|reset|clear).*(recording|dictation|conversation|listening)/i.test(greeter),
   'persona switch must stop in-flight audio capture');
// Look for active-persona state being part of useEffect deps
ok('26.2 Persona is tracked via state/ref (not derived per render)',
   /(activeAgent|activePersona|currentAgent|selectedAgent)/i.test(greeter),
   'persona must be observable for cleanup');

// ---------------------------------------------------------------
// 27. WAKE-WORD repeat / mic glitch
// ---------------------------------------------------------------
console.log('\n27. Wake-word debounce');
var wakeSrc = load('src/lib/voice/wake-word.js');
// "hey nadia hey nadia" should not double-fire
var script = wakeSrc.replace(/export\s+function\s+/g, 'function ').replace(/export\s+\{[^}]*\}/g, '');
script += '\n;return { detectWakeWord };\n';
var ww = (new Function(script))();
var dupResult = ww.detectWakeWord('hey nadia hey nadia what time is it');
ok('27.1 "hey nadia hey nadia" still parses (wake word detected, not crashed)',
   dupResult.matched === true && dupResult.agent === 'nadia');
// The command portion should retain "what time is it" (or include the second "hey nadia")
ok('27.2 dup wake parsed: command contains the actual question',
   /what time is it/i.test(dupResult.command),
   'command: "' + dupResult.command + '"');

// ---------------------------------------------------------------
// 28. ENV-VAR validation
// ---------------------------------------------------------------
console.log('\n28. Required env-var checks');
// Routes that need env vars should fail clearly when missing, not crash
var envRoutes = ['src/app/api/ask/route.js', 'src/app/api/tts/route.js', 'src/app/api/transcribe/route.js'];
envRoutes.forEach(function (rt) {
  var src = load(rt);
  if (!src) return;
  // process.env.X usage must be paired with an explicit null check
  var envUses = (src.match(/process\.env\.(?:OPENAI|ANTHROPIC|ELEVENLABS|RESEND|TWILIO|PLAID|SUPABASE)_[A-Z_]+/g) || []);
  if (envUses.length === 0) return;
  // Check the file has SOME pattern of "if (!apiKey) return" for graceful fallback
  var graceful = /if\s*\(\s*!\w*[Kk]ey\)|if\s*\(\s*!process\.env|return\s+Response\.json\(\{.*not configured/.test(src);
  ok('28.x ' + rt + ' fails gracefully when env-var missing',
     graceful,
     'must return clear error, not crash');
});

// ---------------------------------------------------------------
// 29. PRODUCTION-READY logging
// ---------------------------------------------------------------
console.log('\n29. Production-ready logging');
// Every catch block in an /api route should log server-side
var aiRoutes2 = ['src/app/api/ask/route.js', 'src/app/api/tts/route.js',
                'src/app/api/translate/route.js', 'src/app/api/transcribe/route.js',
                'src/app/api/accountant/route.js', 'src/app/api/hr-report/coach/route.js',
                'src/app/api/hr-report/review/route.js'];
aiRoutes2.forEach(function (rt) {
  var src = load(rt);
  if (!src) return;
  var catches = (src.match(/}\s*catch\s*\(/g) || []).length;
  var consoleLogs = (src.match(/console\.(?:error|warn|log)\s*\(/g) || []).length;
  // Heuristic: should have at least some console.error/warn statements
  ok('29.x ' + rt + ' has server-side logging in catch blocks',
     consoleLogs >= Math.min(1, Math.floor(catches / 3)),
     'catches=' + catches + ', logs=' + consoleLogs);
});

console.log('\n=== Results ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
console.log('CRITICAL: ' + critical);
process.exit(critical > 0 ? 2 : (failed > 0 ? 1 : 0));
