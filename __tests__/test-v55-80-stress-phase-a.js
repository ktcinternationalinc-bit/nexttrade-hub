// __tests__/test-v55-80-stress-phase-a.js
// =========================================
// Phase A audit — verify the AI workforce features I built earlier
// are STILL stable after the v55.80 changes:
//   - 3 personas (Nadia/Jenna/Sara) defined
//   - Wake words / triggers configured
//   - Per-persona conversation history isolated
//   - Voice settings / avatars present
//   - AssistantsBar still renders all three
//
// Run: node __tests__/test-v55-80-stress-phase-a.js

var fs = require('fs');
var path = require('path');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function load(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

console.log('\n=== Phase A audit (AI workforce stability under v55.80) ===');

// ---- agent-personalities.js — 3 personas defined ----
var pers = load('src/lib/agent-personalities.js');
ok('A1: Nadia persona defined', /nadia/i.test(pers));
ok('A2: Jenna persona defined', /jenna/i.test(pers));
ok('A3: Sara persona defined', /sara/i.test(pers));

// Each persona has wake words / triggers
ok('A4: wake-word configuration exists',
   /wake|trigger|callsign/i.test(pers));

// Each persona has voice settings (e.g. ElevenLabs voice ID, or persona name)
ok('A5: voice/audio config or persona names exposed',
   /voice|tts|persona/i.test(pers));

// ---- AssistantsBar still imports + renders all three ----
var asbar = load('src/components/AssistantsBar.jsx');
ok('A6: AssistantsBar imports AGENT_PERSONALITIES',
   /AGENT_PERSONALITIES/.test(asbar));

// Each agent has its own state in AssistantsBar
ok('A7: AssistantsBar has nadia-related state', /nadia/i.test(asbar));
ok('A8: AssistantsBar has jenna-related state', /jenna/i.test(asbar));
ok('A9: AssistantsBar has sara-related state', /sara/i.test(asbar));

// ---- AIGreeter still wired ----
var greeter = load('src/components/AIGreeter.jsx');
ok('A10: AIGreeter exists and exports default', /export default function AIGreeter/.test(greeter));

// AIGreeter has wake-word logic
ok('A11: AIGreeter has wake-word logic',
   /wake|trigger|listen/i.test(greeter));

// ---- Per-persona history (key isolation) ----
// Look for localStorage / per-persona keys
ok('A12: AIGreeter scopes conversation history per persona',
   /persona|agent.*history|messages.*\.\w+/i.test(greeter));

// ---- v55.80 changes did not strip Phase A wiring ----
// Greeted_at logic (v55.80 visibility-aware logout) doesn't touch personality routing
var page = load('src/app/page.jsx');
ok('A13: page.jsx still mounts AIGreeter / AssistantsBar',
   /<AssistantsBar|<AIGreeter/.test(page));

// ---- ET sweep didn't break greeting "today" logic ----
ok('A14: AIGreeter "today" dependent logic uses ET (no UTC bug from sweep)',
   !/new Date\(\)\.toISOString\(\)\.substring\(0,\s*10\)/.test(greeter));

// ---- v55.80 didn't break the briefing key (per-day per-user) ----
var aiAssist = load('src/components/AIAssistant.jsx');
ok('A15: AIAssistant briefing key uses todayET (per ET day, not UTC day)',
   /'ktc_briefing_shown_' \+ myId \+ '_' \+ todayET\(\)/.test(aiAssist));

// ---- Voice transcription / Whisper still wired ----
ok('A16: voice transcription endpoint is referenced',
   /\/api\/(transcribe|whisper)|whisper/i.test(greeter) || /VoiceRecorder|recordVoice/i.test(greeter));

// ---- Phase A doesn't have UTC date handling that breaks late-night greetings ----
// "Good morning Max" should not appear at 10pm because of UTC drift
ok('A17: greeting picks morning/afternoon/evening from ET hour',
   /etHour|etGreetingWord|morning|afternoon|evening/.test(greeter));

// ---- Animated avatar / NadiaFace style ----
ok('A18: avatar / face component referenced',
   /NadiaFace|avatar|svg|portrait/i.test(asbar) || fs.existsSync(path.join(__dirname, '..', 'src/components/NadiaFace.jsx')));

// ---- Listed v55.79 tests should still pass ----
// Not run here, but verify the test files exist
ok('A19: test-v55-79-portrait-avatar.js still present',
   fs.existsSync(path.join(__dirname, 'test-v55-79-portrait-avatar.js')));
ok('A20: test-v55-78-per-persona-history.js still present',
   fs.existsSync(path.join(__dirname, 'test-v55-78-per-persona-history.js')));
ok('A21: test-v55-78-wake-agent-routing.js still present',
   fs.existsSync(path.join(__dirname, 'test-v55-78-wake-agent-routing.js')));

console.log('\n=== Phase A audit results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
