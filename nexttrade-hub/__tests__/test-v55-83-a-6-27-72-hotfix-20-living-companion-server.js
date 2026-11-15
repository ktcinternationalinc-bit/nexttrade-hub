/* v72 HOTFIX 20 — Living Companion Server (Phase 2 backend scaffold).
 *
 * Standalone Node microservice in /living-companion-server/. Not deployed yet —
 * Max will host on Railway. This test just confirms the scaffold structure
 * matches the spec so the deploy step has all the parts it needs.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var ROOT = path.join(__dirname, '..', 'living-companion-server');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('\n── Repo structure ──');

ok('A1: Microservice lives at /living-companion-server/ (separate from Next.js)',
  fs.existsSync(ROOT) &&
  fs.statSync(ROOT).isDirectory());

ok('A2: Has its own package.json',
  fs.existsSync(path.join(ROOT, 'package.json')));

ok('A3: Has .env.example template',
  fs.existsSync(path.join(ROOT, '.env.example')));

ok('A4: Has README with deploy instructions',
  fs.existsSync(path.join(ROOT, 'README.md')));

ok('A5: Server source under src/',
  fs.existsSync(path.join(ROOT, 'src/server.js')) &&
  fs.existsSync(path.join(ROOT, 'src/socket-handler.js')) &&
  fs.existsSync(path.join(ROOT, 'src/orchestrator.js')));

ok('A6: Provider clients isolated under src/providers/',
  fs.existsSync(path.join(ROOT, 'src/providers/deepgram-client.js')) &&
  fs.existsSync(path.join(ROOT, 'src/providers/claude-client.js')) &&
  fs.existsSync(path.join(ROOT, 'src/providers/elevenlabs-client.js')));

console.log('\n── package.json: ES modules + correct deps ──');

var pkg = JSON.parse(read('package.json'));

ok('B1: ES modules (type: module) — Max chose modern JS over TS',
  pkg.type === 'module');

ok('B2: Has socket.io dependency',
  pkg.dependencies && pkg.dependencies['socket.io']);

ok('B3: Has @deepgram/sdk dependency',
  pkg.dependencies && pkg.dependencies['@deepgram/sdk']);

ok('B4: Has @anthropic-ai/sdk dependency',
  pkg.dependencies && pkg.dependencies['@anthropic-ai/sdk']);

ok('B5: Has ws dependency (for ElevenLabs WebSocket)',
  pkg.dependencies && pkg.dependencies['ws']);

ok('B6: Has express + cors for the HTTP shell',
  pkg.dependencies && pkg.dependencies['express'] && pkg.dependencies['cors']);

ok('B7: Has dotenv for local dev env loading',
  pkg.dependencies && pkg.dependencies['dotenv']);

ok('B8: Has dev script for local iteration',
  pkg.scripts && pkg.scripts.dev);

console.log('\n── server.js entrypoint ──');

var srv = read('src/server.js');

ok('C1: Boot-time check refuses to start without required API keys',
  /REQUIRED_ENV/.test(srv) && /missing\.length > 0/.test(srv) && /process\.exit\(1\)/.test(srv));

ok('C2: Required env includes all three provider keys + voice ids',
  /DEEPGRAM_API_KEY[\s\S]{0,300}ANTHROPIC_API_KEY[\s\S]{0,300}ELEVENLABS_API_KEY[\s\S]{0,400}ELEVENLABS_VOICE_NADIA[\s\S]{0,200}ELEVENLABS_VOICE_JENNA[\s\S]{0,200}ELEVENLABS_VOICE_SARA/.test(srv));

ok('C3: CORS origin allowlist driven by ALLOWED_ORIGINS env',
  /ALLOWED_ORIGINS[\s\S]{0,200}\.split/.test(srv));

ok('C4: Health endpoint for uptime probes',
  /app\.get\('\/health'/.test(srv));

ok('C5: Graceful shutdown on SIGTERM (Railway/Render deploys send SIGTERM)',
  /SIGTERM[\s\S]{0,300}io\.close/.test(srv));

ok('C6: Hard-kill timeout if graceful close hangs',
  /setTimeout[\s\S]{0,300}force-exit/.test(srv));

ok('C7: Unhandled rejection + uncaught exception loggers',
  /unhandledRejection/.test(srv) && /uncaughtException/.test(srv));

console.log('\n── socket-handler.js connection + rooms ──');

var sh = read('src/socket-handler.js');

ok('D1: Each socket joins its own room for isolation',
  /socket\.join\(room\)/.test(sh) &&
  /session:\$\{socket\.id\}/.test(sh));

ok('D2: One Orchestrator per connection',
  /new Orchestrator/.test(sh));

ok('D3: Wires client.audio_chunk event',
  /socket\.on\('client\.audio_chunk'/.test(sh));

ok('D4: Wires client.interrupt event (manual barge-in)',
  /socket\.on\('client\.interrupt'/.test(sh));

ok('D5: Wires client.persona_switch event',
  /socket\.on\('client\.persona_switch'/.test(sh));

ok('D6: Wires client.text_input event (skip STT path)',
  /socket\.on\('client\.text_input'/.test(sh));

ok('D7: Disposes orchestrator on disconnect (no leaked Deepgram/ElevenLabs sockets)',
  /'disconnect'/.test(sh) && /orchestrator\.dispose\(\)/.test(sh));

ok('D8: Validates persona id before switching (rejects unknown personas)',
  /\['nadia', 'jenna', 'sara'\]\.includes/.test(sh));

console.log('\n── Deepgram client per spec ──');

var dg = read('src/providers/deepgram-client.js');

ok('E1: Uses Deepgram nova-2 model by default',
  /'nova-2'/.test(dg));

ok('E2: interim_results enabled (CRITICAL per spec — need partials for break detection)',
  /interim_results: true/.test(dg));

ok('E3: endpointing configured (CRITICAL per spec — rapid utterance endpoints)',
  /endpointing: 300/.test(dg));

ok('E4: VAD events enabled (drives barge-in trigger)',
  /vad_events: true/.test(dg));

ok('E5: Exposes onSpeechStarted callback for VAD-driven barge-in',
  /onSpeechStarted/.test(dg));

ok('E6: Exposes onFinal callback for transcript-driven turn start',
  /onFinal/.test(dg));

ok('E7: abort() method for hard-close on persona switch',
  /function abort\(\)[\s\S]{0,200}requestClose/.test(dg));

console.log('\n── Claude client with AbortController ──');

var cl = read('src/providers/claude-client.js');

ok('F1: Uses Anthropic streaming API',
  /anthropic\.messages\.stream/.test(cl));

ok('F2: Passes AbortSignal to SDK call (barge-in cancellation)',
  /signal: opts\.signal/.test(cl));

ok('F3: Yields text deltas as async generator (streaming, not buffered)',
  /async function\* streamClaudeTokens/.test(cl));

ok('F4: Handles AbortError gracefully (expected during barge-in, not an error)',
  /AbortError[\s\S]{0,300}throw err/.test(cl));

ok('F5: Yields only text_delta events (filters out message metadata)',
  /content_block_delta[\s\S]{0,200}text_delta/.test(cl));

console.log('\n── ElevenLabs Input Streaming WebSocket ──');

var el = read('src/providers/elevenlabs-client.js');

ok('G1: Uses stream-input endpoint (input streaming, not file-based TTS)',
  /stream-input/.test(el));

ok('G2: Per-persona voice id mapping (Nadia/Jenna/Sara → ElevenLabs voice ids)',
  /VOICE_IDS[\s\S]{0,300}nadia[\s\S]{0,200}jenna[\s\S]{0,200}sara/.test(el));

ok('G3: sendText() pushes Claude tokens into ElevenLabs as they arrive',
  /sendText\(text\)[\s\S]{0,300}try_trigger_generation: true/.test(el));

ok('G4: abort() closes the WebSocket immediately (critical — closing socket is what stops generation)',
  /function abort\(\)|abort\(\) \{|abort: function|abort\(\)/.test(el));

ok('G5: Pre-open queue so sendText() before socket opens still works',
  /preOpenQueue/.test(el));

console.log('\n── Orchestrator: three-way pipeline + barge-in ──');

var orc = read('src/orchestrator.js');

ok('H1: One Orchestrator owns one Deepgram + one Claude turn + one ElevenLabs',
  /class Orchestrator/.test(orc));

ok('H2: Monotonic turn counter for stale-callback rejection',
  /_turnCounter\+\+|\+\+this\._turnCounter/.test(orc));

ok('H3: AbortController per turn for Claude cancellation',
  /new AbortController/.test(orc));

ok('H4: sequenceId bumped on every interrupt (client-side stale-message defense)',
  /sequenceId\+\+|this\.sequenceId \+= 1/.test(orc));

ok('H5: Deepgram onSpeechStarted triggers barge-in when TTS is playing',
  /onSpeechStarted[\s\S]{0,400}activeTurn[\s\S]{0,200}_abortActiveTurn/.test(orc));

ok('H6: _startTurn opens ElevenLabs BEFORE Claude tokens arrive (latency optimization)',
  /openElevenLabsSession/.test(orc) && /_runClaudeStream/.test(orc) &&
  orc.indexOf('openElevenLabsSession') < orc.indexOf('this._runClaudeStream'));

ok('H7: Claude tokens piped directly into ElevenLabs as they arrive (no buffering)',
  /for await \(const delta of tokens\)[\s\S]{0,800}turn\.eleven\.sendText\(delta\)/.test(orc));

ok('H8: Abort order: bump sequence → abort Claude → close ElevenLabs → notify client',
  /this\.sequenceId\+\+[\s\S]{0,500}abortController\.abort[\s\S]{0,500}turn\.eleven[\s\S]{0,200}abort\(\)[\s\S]{0,400}server\.interrupted/.test(orc));

ok('H9: Stale-callback guard — every ElevenLabs/Claude callback checks turn.id against currentTurnId',
  /turn\.id !== this\._turnCounter/.test(orc));

ok('H10: Persona switch is implicit interrupt + identity change + history reset',
  /switchPersona\(toPersona\)/.test(orc) &&
  /_abortActiveTurn\('persona_switch'\)/.test(orc) &&
  /this\.personaId = toPersona/.test(orc) &&
  /this\.history = \[\]/.test(orc));

ok('H11: dispose() safe to call on disconnect (closes deepgram + active turn)',
  /dispose\(\)[\s\S]{0,400}_abortActiveTurn[\s\S]{0,300}deepgram\.abort/.test(orc));

ok('H12: avatar_state events fire at thinking + speaking + idle transitions',
  /server\.avatar_state/.test(orc) &&
  /state: 'thinking'/.test(orc) &&
  /state: 'speaking'/.test(orc) &&
  /state: 'idle'/.test(orc));

ok('H13: server.interrupted event emitted on barge-in (client closes mouth NOW)',
  /server\.interrupted/.test(orc));

console.log('\n── Persona prompts (server-side mirror of frontend personalities) ──');

var pp = read('src/lib/persona-prompts.js');

ok('I1: Nadia prompt mentions executive assistant role',
  /Nadia[\s\S]{0,300}executive assistant/i.test(pp));

ok('I2: Jenna prompt mentions HR + confidentiality',
  /Jenna[\s\S]{0,500}confidential/i.test(pp));

ok('I3: Sara prompt mentions work coach + action focus',
  /Sara[\s\S]{0,500}coach/i.test(pp));

ok('I4: getPersonaPrompt(id) helper with fallback',
  /function getPersonaPrompt[\s\S]{0,200}PERSONA_PROMPTS\.nadia/.test(pp));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 20 — Living Companion Server scaffold complete (Phase 2 backend ready for Railway deploy)');
console.log('══════════════════════════════════════════════');
