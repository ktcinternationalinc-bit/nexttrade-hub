# Living Avatar — Phase 1 + Phase 2 Foundation

**Status:** Complete end-to-end groundwork. Frontend wires to the standalone real-time server via Socket.io. Behind a feature flag (off by default). The legacy `AIGreeter` + `AnimatedPortrait` remain the default everywhere.

## Architecture

```
┌─────────────────────────── browser ───────────────────────────┐
│                                                                │
│  LivingCompanionPanel ─┐                                       │
│                        ├── useCompanionSocket ──┬── useMachine │
│                        │                         │   (XState)   │
│                        │                         │              │
│                        ├── useMicrophone ────────┤              │
│                        │   (MediaRecorder 250ms) │              │
│                        │                         │              │
│                        ├── useAudioPlaybackQueue ┤              │
│                        │   (MediaSource → <audio>)              │
│                        │                                         │
│                        └── socket.io-client ────────┐           │
│                                                       │           │
│  LivingAvatar (per persona)                          │           │
│   ├── useMouthSync ◄────── speakingAudioElement ─────┘           │
│   └── useIdleBlink                                                │
│                                                                    │
└─────────────────────────────│──────────────────────────────────────┘
                              │ wss
                              ▼
            living-companion-server (Railway)
            Deepgram → Claude → ElevenLabs
```

## What's here

```
src/features/living-avatar/
  feature-flag.js              — isLivingAvatarEnabled() gate
  index.js                     — public exports
  README.md
  lib/
    wire-schema.js             — JSDoc-typed Socket.io message format + helpers
    avatar-machine.js          — XState 5 conversational state machine
  hooks/
    useMouthSync.js            — Web Audio analyser → mouth shape
    useIdleBlink.js            — probabilistic blink scheduler
    useMicrophone.js           — mic capture + 250ms opus chunks    [HOTFIX 22]
    useAudioPlaybackQueue.js   — MediaSource + <audio> playback     [HOTFIX 22]
    useCompanionSocket.js      — Socket.io + XState bridge          [HOTFIX 22]
  components/
    LivingAvatar.jsx           — single avatar (face + mouth + eyes)
    LivingCompanionPanel.jsx   — drop-in panel: 3 avatars + controls [HOTFIX 22]
```

## How to flip it on for one user (browser console)

```js
window.setLivingAvatarEnabled(true);
location.reload();
```

To turn back off:

```js
window.setLivingAvatarEnabled(false);
location.reload();
```

## How to mount the panel

In a parent page or dashboard component:

```jsx
import { isLivingAvatarEnabled, LivingCompanionPanel } from '@/features/living-avatar';

if (isLivingAvatarEnabled()) {
  return (
    <LivingCompanionPanel
      serverUrl={process.env.NEXT_PUBLIC_COMPANION_SERVER_URL}
      initialPersona="nadia"
    />
  );
}
return <LegacyAssistantsBar />; // existing avatars
```

Set in `.env.local`:

```
NEXT_PUBLIC_COMPANION_SERVER_URL=https://your-app.up.railway.app
```

## How the pieces talk to each other

**XState is the source of truth for UI state.** The socket hook never sets React state for state-machine concerns. When a socket event arrives, `useCompanionSocket` calls `machine.send({ type: 'XYZ' })` and the machine decides whether that's a legal transition.

**Audio routes through one HTMLAudioElement.** The playback queue returns a real `<audio>` element. We hand that same element to `LivingAvatar` as the `audioElement` prop, and `useMouthSync` connects its analyser to it. Two consumers of the same element with no second audio plumbing.

**Sequence ids defend against zombie events.** Every server message carries a `sequenceId`. The bridge tracks the highest one accepted and drops anything older. After a barge-in, the server bumps its sequence, so any TTS chunks already on the wire arrive with an old id and get silently dropped.

## Barge-in flow (the whole point)

When the user clicks "Stop" (or any path that calls `interrupt()`):

1. `send({ type: 'INTERRUPT' })` → machine transitions to `interrupted`, bumps its own sequence.
2. `playback.flush()` → SourceBuffer aborts in-flight append, removes all queued bytes, audio pauses, `currentTime` jumps to `duration`. No zombie audio.
3. `socket.emit('client.interrupt', ...)` → server aborts the Claude stream and closes the ElevenLabs socket.
4. Server emits `server.interrupted` back, bumping its sequence id.
5. Client `setTimeout(50ms) → playback.reset()` rebuilds a fresh MediaSource for the next turn.

All four happen synchronously. The 50ms before reset lets the SourceBuffer abort settle on slower browsers.

## Autoplay policy (Max guardrail #2)

`audioElement.play()` only works from a user gesture. The "Start Conversation" button on `LivingCompanionPanel` is that gesture. It calls `playback.unlock()` synchronously inside the click handler, which calls `.play()` on an empty MediaSource (which resolves immediately) — the browser then marks the element as user-permitted, and subsequent `.play()` calls inside event handlers work.

Without that button, Safari refuses to play any audio. Don't skip it.

## What's still NOT built

- **Persistent conversation memory.** History lives in-memory per socket on the server. Closing the tab forgets everything. Phase 3 work: write to Supabase.
- **Authentication.** Socket handshake accepts an `auth.token` but the server doesn't validate it. Production should validate a Supabase JWT before accepting any messages.
- **Reconnect-mid-utterance.** If the socket drops mid-conversation, audio in-flight is lost. The client doesn't buffer audio chunks for replay. Not a Phase 1/2 concern.
- **Per-user rate limiting.** Every socket can burn through your provider quotas.
- **Multi-language.** STT language hint is hardcoded to `'en'` in the orchestrator. Wire up persona-driven language selection in Phase 3.

## Tech-stack confirmation (Phase 2 inputs)

- **Next.js**: 14.2.0 ✅
- **React**: 18.3.0 ✅
- **XState**: 5.18.0 ✅
- **@xstate/react**: 4.1.3 ✅
- **socket.io-client**: 4.7.5 ✅

## Pre-flight checklist before flipping the flag on

- [ ] Server deployed to Railway, public URL noted
- [ ] `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` set on Railway
- [ ] `ELEVENLABS_VOICE_NADIA` / `JENNA` / `SARA` set with real voice ids from your ElevenLabs library
- [ ] `ALLOWED_ORIGINS` on Railway includes your Vercel domain (and `http://localhost:3000` for local dev)
- [ ] `NEXT_PUBLIC_COMPANION_SERVER_URL` set on Vercel pointing at the Railway URL
- [ ] `LivingCompanionPanel` mounted somewhere in the UI (gated on `isLivingAvatarEnabled()`)
- [ ] Flag flipped on your dev machine: `window.setLivingAvatarEnabled(true)`
- [ ] Browser mic permission granted

If all 8 boxes are checked, hit "Start Conversation" and Nadia should answer.

## What I'm uncertain about until you wire it up live

1. **Browser codec negotiation.** `useMicrophone` picks opus first, falls back to mp4. Deepgram is told `codec: 'opus'` if the mime type contains `opus`, else `pcm16`. If Safari sends mp4/aac, the server side may need a `codec: 'mp4'` branch added.

2. **MediaSource latency on Safari.** I've used MediaSource on Chrome/Firefox extensively but it's been historically rougher on Safari. If audio sounds choppy on iOS, we may need to switch playback to AudioBufferSourceNode + manual MP3 decoder — that's a contained change inside `useAudioPlaybackQueue.js`.

3. **The `setTimeout(50)` before `reset()` after barge-in.** Heuristic — might need bumping to 100ms on slower devices. Easy to tune.

4. **`useMouthSync` createMediaElementSource binding.** The hook calls `createMediaElementSource` on the audio element. That can only be called ONCE per element. After a MediaSource rebuild on barge-in, we keep the same HTMLAudioElement (don't recreate) so the binding stays valid. If we ever DO recreate the audio element, useMouthSync will throw — keep them stable.
