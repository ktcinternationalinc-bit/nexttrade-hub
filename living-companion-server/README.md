# Living Companion Server

Real-time voice orchestrator for the KTC NextTrade Living Avatar system. Routes mic audio through Deepgram → Claude → ElevenLabs and streams audio back to the browser over Socket.io, with full barge-in support.

This service lives **outside** the Next.js Vercel deployment because Vercel kills long-lived WebSockets. Deploy it as a standalone Node service on Railway or Render.

## Architecture

```
                ┌─── Browser ───┐
                │   Socket.io   │
                │    client     │
                └───┬─────────▲─┘
                    │ wss     │ wss
                    ▼         │
   ┌──────────────────────────┴────────────────┐
   │     living-companion-server (this)        │
   │  ┌──────────────────────────────────────┐ │
   │  │  Orchestrator (per socket)           │ │
   │  │  ───────────────────────────────     │ │
   │  │  mic chunks ──► Deepgram (STT) ─┐    │ │
   │  │                                 ▼    │ │
   │  │              ┌── Claude (LLM streaming)─┐
   │  │              │   tokens                 │
   │  │              ▼                          │
   │  │           ElevenLabs (TTS streaming) ──┘
   │  │              │ audio chunks            │
   │  │              ▼                         │
   │  │           Socket.io client ────────────┘
   │  └──────────────────────────────────────┘ │
   └──────────────────┬────────────────────────┘
                      │ direct WSS to providers
                      ▼
            Deepgram · Anthropic · ElevenLabs
```

The orchestrator's job is to keep three streaming providers in sync and abort all three cleanly when the user barges in. Everything else (state machine, mouth animation, persona switching UI) lives on the client.

## Layout

```
living-companion-server/
  package.json
  .env.example           ← copy to .env for local dev
  src/
    server.js            ← entrypoint, Express + Socket.io boot
    socket-handler.js    ← per-connection event routing
    orchestrator.js      ← the three-way pipeline + abort logic
    providers/
      deepgram-client.js   ← Deepgram Nova-2 streaming wrapper
      claude-client.js     ← Anthropic SDK streaming with AbortSignal
      elevenlabs-client.js ← ElevenLabs Input Streaming WebSocket
    lib/
      persona-prompts.js   ← system prompts for Nadia / Jenna / Sara
```

## Deploy on Railway

1. `railway init` from this directory.
2. In the Railway dashboard, set the env vars from `.env.example`:
   - `DEEPGRAM_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_NADIA` / `JENNA` / `SARA`
   - `ALLOWED_ORIGINS=https://your-vercel-domain.vercel.app,http://localhost:3000`
3. `railway up` — Railway auto-detects Node and runs `npm start`.
4. Note the public URL Railway gives you (`*.up.railway.app`). The Next.js frontend will connect to that.

## Deploy on Render

1. New "Web Service" → connect this folder.
2. Build: `npm install` · Start: `npm start`.
3. Set the same env vars in the Render dashboard.

## Local dev

```bash
cd living-companion-server
cp .env.example .env       # fill in real keys
npm install
npm run dev                # auto-restart on file changes
```

Then in `src/features/living-avatar/` on the Next.js side, point the Socket.io client at `http://localhost:3001` and flip the feature flag with `window.setLivingAvatarEnabled(true)`.

## What's NOT in this scaffold

This is the foundation. Things that need to be added once it's deployed and reachable:

- **Client-side Socket.io adapter** that wires the new server into the XState machine on the frontend. The current `LivingAvatar` component is built but has no transport layer yet.
- **Persistent conversation history.** The orchestrator keeps the last few turns in memory per socket, but doesn't write to Supabase. Cross-session memory is Phase 3.
- **Authentication.** Right now any client with the right CORS origin can connect. Production should validate a Supabase JWT in the Socket.io handshake.
- **Rate limiting.** Each socket can blow through your Deepgram/Claude/ElevenLabs quota. Add per-user budgets before going wide.
- **Observability.** Wire in logs to a real logger (pino, winston) and metrics to a real platform (Railway logs are fine for now, but add structured events for "turn started", "barge-in fired", "provider error" so you can debug the inevitable production weirdness).
- **Audio codec validation.** The current code trusts the client's claimed codec/sample-rate. Production should validate or transcode.

## What I'm specifically uncertain about until you wire it up live

These are the parts most likely to need adjustment once real audio flows through:

1. **Deepgram VAD timing.** The `onSpeechStarted` callback drives barge-in. If users find it too sensitive (cuts off mid-thought when they cough) or too slow (lets a chunk of audio leak past their interrupt), tune the `endpointing` ms and consider adding a confidence/energy threshold.

2. **ElevenLabs chunk_length_schedule.** I picked `[120, 160, 250, 290]` from their docs as a reasonable default. If first-audio latency feels sluggish, drop the first value to 80 or so. If output sounds choppy, raise it.

3. **AbortController + WebSocket close race.** The order in `_abortActiveTurn` is correct in theory: bump sequence → abort Claude → close ElevenLabs → notify client. In practice, if ElevenLabs is mid-send when we close the socket, a single audio chunk might still hit the wire. That's actually fine — the client's stale-message check (sequenceId) will drop it. But worth verifying in real testing.

4. **Reconnect behavior on flaky networks.** Socket.io handles transport-level reconnects automatically, but a mid-utterance disconnect means Deepgram loses context. The client should re-send any in-flight audio buffer on reconnect, which means buffering on the client. Not built yet.
