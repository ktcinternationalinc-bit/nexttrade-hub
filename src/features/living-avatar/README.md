# Living Avatar — Phase 1 Foundation

**Status:** Frontend foundation, no backend yet. Behind a feature flag (off by default). The legacy `AIGreeter` + `AnimatedPortrait` remain the default everywhere.

## What's here

```
src/features/living-avatar/
  feature-flag.js              — isLivingAvatarEnabled() gate
  index.js                     — public exports
  lib/
    wire-schema.js             — JSDoc-typed WebSocket message schema + helpers
    avatar-machine.js          — XState 5 conversational state machine
  hooks/
    useMouthSync.js            — Web Audio analyser → mouth shape (with timed fallback)
    useIdleBlink.js            — probabilistic blink scheduler
  components/
    LivingAvatar.jsx           — the new avatar component
```

## What's NOT here yet

- WebSocket server endpoint (waiting on tech-stack decision)
- The "conversation engine" that wires hooks + machine + websocket together
- Real STT streaming
- Persona switching at the conversation level (the machine handles it, but no UI sits on top yet)
- The "break" voice command (machine has `INTERRUPT` event; needs voice-keyword recognizer in the conversation engine)

## How to flip it on for one user (browser)

```js
localStorage.setItem('useLivingAvatar', '1');
location.reload();
```

To flip it back off:

```js
localStorage.setItem('useLivingAvatar', '0');
location.reload();
```

## How to gate something on it (server- or client-side)

```js
import { isLivingAvatarEnabled } from '../features/living-avatar';

if (isLivingAvatarEnabled()) {
  return <LivingAvatar ... />;
} else {
  return <AnimatedPortrait ... />;  // legacy
}
```

## Tech-stack questions for Phase 2

The original spec said: after frontend lands, ask for tech stack. Confirming
what's already in `package.json`:

- **Next.js**: 14.2.0 ✅
- **React**: 18.3.0 ✅
- **XState**: 5.18.0 ✅ (added in this hotfix)

Still need a decision on:

- **WebSocket lib**: Socket.io (heavier, fallbacks) vs native `ws` (lighter, Next.js 14 supports it via custom server) vs server-sent events (one-way only, no good for barge-in)
- **STT provider**: Whisper (current `/api/transcribe`) doesn't stream — would need swapping to Deepgram / AssemblyAI / OpenAI realtime for true partials
- **TTS provider**: ElevenLabs (current) supports streaming via their websocket endpoint — good fit
- **LLM provider**: Whatever drives the current `/api/chat` — pass-through likely fine

Once those are confirmed I can build the Phase 2 server bridge.

## Design decisions worth knowing

### Why JSDoc instead of TypeScript

The repo is JSX. Vercel SWC compiles it without a TS pass. Adding TS would require either (a) running `tsc` separately or (b) flipping the whole repo to TypeScript. JSDoc gives 90% of the IDE benefit (hover types, autocomplete in VS Code) with zero build-pipeline change.

### Why XState 5 (not 4)

XState 5 has a cleaner `setup({ ... }).createMachine(...)` API and dropped the awkward Interpreter object. It also works with React 18 strict mode out of the box.

### Why the sequenceId pattern

The single hardest bug in real-time voice systems: server is mid-stream sending TTS chunks, user barges in, client says "stop," but a few chunks are already in flight. Without sequenceId you get a half-second of phantom audio after the interrupt. With sequenceId, the client knows "current accepted seq is 42, anything ≤ 42 is dead — drop it." Cheap and bulletproof.

### Why three-layer mouth animation (audio analyser → timed → closed)

- Audio analyser: best realism when it works.
- Timed fallback: when Web Audio refuses (iOS Safari sometimes does), the mouth still moves so the avatar doesn't look frozen.
- Closed at idle: explicit "I am not talking right now" pose.

You never want a frozen open mouth or an oscillating closed mouth.

### Why blinking is suppressed during speech

Real humans blink during speech, but cartoon blinks during talking look uncanny because our overlay isn't pixel-perfect. Pausing them during the speak state hides the seam.
