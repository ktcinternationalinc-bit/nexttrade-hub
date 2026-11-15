/* v72 HOTFIX 22 — Client-side adapter (Phase 1 → Phase 2 bridge).
 *
 * Connects the LivingAvatar component + XState machine (HOTFIX 18) to
 * the Living Companion Server (HOTFIX 20) via Socket.io. Three new hooks
 * plus a drop-in panel component that wires it all together.
 *
 * Guardrails from Max:
 *   1. Audio buffer flush — barge-in must clear queued audio so the next
 *      turn doesn't play "zombie audio" from the previous one
 *   2. Browser autoplay — explicit unlock() called from a user gesture
 *      (the "Start Conversation" button) before any audio plays
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var FEAT = path.join(__dirname, '..', 'src/features/living-avatar');

function read(rel) { return fs.readFileSync(path.join(FEAT, rel), 'utf8'); }

var mic  = read('hooks/useMicrophone.js');
var pq   = read('hooks/useAudioPlaybackQueue.js');
var sock = read('hooks/useCompanionSocket.js');
var panel = read('components/LivingCompanionPanel.jsx');
var machine = read('lib/avatar-machine.js');
var index = read('index.js');
var pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

console.log('\n── Dependencies ──');

ok('A1: @xstate/react added to package.json',
  pkg.dependencies && pkg.dependencies['@xstate/react']);

ok('A2: socket.io-client added to package.json',
  pkg.dependencies && pkg.dependencies['socket.io-client']);

console.log('\n── useMicrophone hook ──');

ok('B1: Uses MediaRecorder (not AudioWorklet) per architectural decision',
  /new MediaRecorder/.test(mic));

ok('B2: Requests mic via getUserMedia',
  /navigator\.mediaDevices\.getUserMedia/.test(mic));

ok('B3: Slices audio every 250ms (CHUNK_MS constant)',
  /var CHUNK_MS = 250/.test(mic) && /recorder\.start\(CHUNK_MS\)/.test(mic));

ok('B4: Prefers opus codec (Deepgram-native, low bandwidth)',
  /'audio\/webm;codecs=opus'/.test(mic));

ok('B5: Falls back through opus/webm/ogg/mp4 (Safari coverage)',
  /'audio\/mp4'/.test(mic));

ok('B6: Returns mimeType so consumer can hint server',
  /mimeType:\s*mimeTypeRef\.current/.test(mic));

ok('B7: Cleanup stops every MediaStream track (kills mic indicator)',
  /stream\.getTracks\(\)\.forEach\(function \(t\) \{ try \{ t\.stop\(\); \} catch/.test(mic));

ok('B8: Surfaces permissionDenied flag on NotAllowedError',
  /NotAllowedError[\s\S]{0,200}setPermissionDenied\(true\)/.test(mic));

ok('B9: onChunk callback receives isFirst flag (positional third arg)',
  /firstChunkSentRef\.current = true/.test(mic) &&
  /var isFirst = !firstChunkSentRef\.current/.test(mic));

console.log('\n── useAudioPlaybackQueue (MediaSource playback) ──');

ok('C1: Uses MediaSource API for seamless chunk stitching',
  /new MediaSource/.test(pq));

ok('C2: Feeds chunks into SourceBuffer via appendBuffer',
  /sb\.appendBuffer\(/.test(pq));

ok('C3: Plays through a single <audio> element (HTMLAudioElement)',
  /new Audio\(\)/.test(pq));

ok('C4: Returns audioElement so useMouthSync can analyse it',
  /audioElement:\s*audioRef\.current/.test(pq));

ok('C5: GUARDRAIL #2: explicit unlock() function for user gesture',
  /var unlock = useCallback\(async function/.test(pq));

ok('C6: unlock() calls audio.play() to satisfy autoplay policy',
  /var p = audio\.play\(\)/.test(pq));

ok('C7: isUnlocked flag exposed so UI can render "Start Conversation" button',
  /isUnlocked:\s*isUnlocked/.test(pq));

ok('C8: GUARDRAIL #1: flush() exists and aborts SourceBuffer in-flight append',
  /var flush = useCallback/.test(pq) && /sb\.abort\(\)/.test(pq));

ok('C9: GUARDRAIL #1: flush() removes ALL buffered bytes (sb.remove)',
  /sb\.remove\(0, audio\.duration\)/.test(pq));

ok('C10: GUARDRAIL #1: flush() pauses audio + jumps currentTime past end',
  /audio\.pause\(\)/.test(pq) && /audio\.currentTime = audio\.duration/.test(pq));

ok('C11: GUARDRAIL #1: flush() drops queued chunks (pendingChunksRef = [])',
  /pendingChunksRef\.current = \[\]/.test(pq));

ok('C12: GUARDRAIL #1: aborted ref prevents new chunks from being appended after flush',
  /aborted\.current = true/.test(pq) && /if \(disposedRef\.current \|\| aborted\.current\) return/.test(pq));

ok('C13: reset() rebuilds MediaSource for the next turn',
  /var reset = useCallback/.test(pq) && /buildPipeline\(\)/.test(pq));

ok('C14: QuotaExceededError eviction so long sessions don\'t OOM',
  /QuotaExceededError/.test(pq) && /sb\.remove\(0, keepFrom\)/.test(pq));

ok('C15: Cleanup on unmount revokes the blob URL (no leaks)',
  /URL\.revokeObjectURL\(audio\.src\)/.test(pq));

ok('C16: Same HTMLAudioElement persists across MediaSource rebuilds (so createMediaElementSource binding stays valid)',
  /We DO NOT null out audioRef\.current/.test(pq));

console.log('\n── useCompanionSocket (Socket.io + XState bridge) ──');

ok('D1: Provider-agnostic — no Deepgram/ElevenLabs/Anthropic calls in client code (comments mentioning them are fine — they explain the architecture)',
  (function () {
    // Strip line comments + block comments before scanning. Provider names
    // appearing in comments (e.g. the header docstring) are fine — they
    // help future readers; the rule is no actual code that imports or
    // references provider SDKs.
    var stripped = sock.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return !/deepgram/i.test(stripped) && !/elevenlabs/i.test(stripped) && !/anthropic/i.test(stripped);
  })());

ok('D2: Speaks wire-schema event names only (client.audio_chunk, server.tts_chunk, etc.)',
  /'client\.audio_chunk'/.test(sock) &&
  /'server\.tts_chunk'/.test(sock) &&
  /'server\.avatar_state'/.test(sock));

ok('D3: Uses @xstate/react useMachine for state-machine ownership',
  /import \{ useMachine \} from '@xstate\/react'/.test(sock));

ok('D4: Socket events route through send(EVENT) into the XState machine',
  /send\(\{ type: 'STT_PARTIAL'/.test(sock) &&
  /send\(\{ type: 'STT_FINAL'/.test(sock) &&
  /send\(\{ type: 'TTS_END' \}\)/.test(sock));

ok('D5: Wire-schema stale-message check (isStale) drops zombie events after barge-in',
  /import.*isStale/.test(sock) && /isStale\(msg, lastAcceptedSeqRef\.current\)/.test(sock));

ok('D6: server.interrupted handler does the full flush + reset + machine.INTERRUPT',
  /'server\.interrupted'[\s\S]{0,500}playback\.flush\(\)[\s\S]{0,200}send\(\{ type: 'INTERRUPT' \}\)/.test(sock));

ok('D7: server.tts_chunk feeds the playback queue + transitions machine on chunkIndex===0',
  /'server\.tts_chunk'[\s\S]{0,800}playback\.appendChunk[\s\S]{0,500}chunkIndex === 0[\s\S]{0,300}TTS_FIRST_CHUNK/.test(sock));

ok('D8: startConversation() unlocks audio BEFORE starting mic (autoplay policy ordering)',
  /var startConversation = useCallback[\s\S]{0,500}await playback\.unlock\(\)[\s\S]{0,300}await mic\.start\(\)/.test(sock));

ok('D9: interrupt() does the synchronous sequence: machine → flush → emit → reset',
  /var interrupt = useCallback[\s\S]{0,600}send\(\{ type: 'INTERRUPT' \}\)[\s\S]{0,200}playback\.flush\(\)[\s\S]{0,400}client\.interrupt[\s\S]{0,500}playback\.reset/.test(sock));

ok('D10: switchPersona() flushes playback (implicit interrupt)',
  /var switchPersona = useCallback[\s\S]{0,600}playback\.flush\(\)/.test(sock));

ok('D11: Returns speakingAudioElement so LivingAvatar can analyse it',
  /speakingAudioElement:\s*playback\.audioElement/.test(sock));

ok('D12: socket.io-client used (not raw WebSocket)',
  /import \{ io \} from 'socket\.io-client'/.test(sock));

ok('D13: Auth token passed in handshake (Supabase JWT ready)',
  /auth:\s*opts\.authToken/.test(sock));

ok('D14: Auto-reconnect configured',
  /reconnection: true/.test(sock) && /reconnectionAttempts: Infinity/.test(sock));

ok('D15: Heartbeat ping every 25s matches server pingInterval',
  /25_000/.test(sock));

console.log('\n── XState machine updates ──');

ok('E1: Machine now accepts input.personaId so consumers can seed initial persona',
  /context: function \(args\)[\s\S]{0,300}input\.personaId/.test(machine));

console.log('\n── LivingCompanionPanel (drop-in integration example) ──');

ok('F1: Renders three avatars side-by-side (nadia + jenna + sara)',
  /\['nadia', 'jenna', 'sara'\]\.map/.test(panel));

ok('F2: Each avatar gets the same speakingAudioElement so only the active+speaking one talks',
  /audioElement=\{companion\.speakingAudioElement\}/.test(panel));

ok('F3: "Start Conversation" button gates audio unlock (autoplay policy)',
  /companion\.startConversation/.test(panel) &&
  /!companion\.isUnlocked/.test(panel) &&
  /Start Conversation/.test(panel));

ok('F4: Stop button calls companion.interrupt for manual barge-in',
  /companion\.interrupt\('manual'\)/.test(panel));

ok('F5: Persona switch buttons call companion.switchPersona',
  /companion\.switchPersona\(p\)/.test(panel));

ok('F6: Text input fallback uses companion.sendText (skip STT path)',
  /companion\.sendText\(typedMessage\)/.test(panel));

ok('F7: Renders connection state (isConnected) so user sees disconnect clearly',
  /companion\.isConnected/.test(panel));

ok('F8: Renders state badge (idle/listening/thinking/speaking/interrupted)',
  /function stateLabel/.test(panel));

ok('F9: Transcript + response shown alongside audio (visual confirmation)',
  /companion\.transcript/.test(panel) && /companion\.responseText/.test(panel));

console.log('\n── Index barrel exports ──');

ok('G1: useMicrophone exported',
  /export \{ useMicrophone \}/.test(index));

ok('G2: useAudioPlaybackQueue exported',
  /export \{ useAudioPlaybackQueue \}/.test(index));

ok('G3: useCompanionSocket exported',
  /export \{ useCompanionSocket \}/.test(index));

ok('G4: LivingCompanionPanel exported (drop-in integration)',
  /LivingCompanionPanel/.test(index));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 22 — Client-side adapter wired (mic + playback + socket + XState bridge complete)');
console.log('══════════════════════════════════════════════');
