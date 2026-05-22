# Voice Infrastructure — Future Upgrade Path

**Status:** v55.73 — placeholders in place, ready for upgrade
**Owner:** Max / KTC

## Where voice config lives

All three assistants (Nadia, Jenna, Sara) read their voice settings from a
single file:

```
src/lib/agent-personalities.js
```

Each persona has a `voice` block:

```js
voice: {
  provider: 'elevenlabs',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',   // current placeholder
  pitch: 1.0,
  speed: 1.0,
  style: 'professional-warm',
  browserFallback: {                  // used when ElevenLabs key isn't set
    lang: 'en-US',
    nameHints: ['Samantha', 'Karen', 'Microsoft Zira'],
    rate: 1.0,
    pitch: 1.0,
  },
}
```

The TTS dispatcher in `AIGreeter.jsx` reads this block at runtime — no other
code touches voice config. Swapping in a new voice is a one-file edit.

## Current state (placeholders)

Each persona uses a free public ElevenLabs preset voice as a placeholder:

| Persona | Placeholder voice ID | Public preset name |
|---------|----------------------|--------------------|
| Nadia   | `EXAVITQu4vr4xnSDxMaL` | "Sarah" |
| Jenna   | `pFZP5JQG7iQjIQuC4Bku` | "Lily"  |
| Sara    | `XrExE9yKIg1WjnnlVkGX` | "Matilda" |

These work for testing the architecture but should be replaced with custom
KTC-licensed voices before production rollout.

## Upgrade path: ElevenLabs custom voices

### Step 1 — Create / clone voices in ElevenLabs

1. Sign in to https://elevenlabs.io
2. Voice Library → choose option:
   - **Voice Cloning** (instant, ~30 sec): upload a voice sample
   - **Professional Voice Cloning** (best quality): submit longer recordings, takes 24-48h
3. After creation, each voice gets a unique Voice ID like `21m00Tcm4TlvDq8ikWAM`

### Step 2 — Replace voice IDs in agent-personalities.js

Open `src/lib/agent-personalities.js` and update the `voiceId` field for each
persona:

```js
nadia: { voice: { voiceId: 'YOUR_NADIA_VOICE_ID', ... } }
jenna: { voice: { voiceId: 'YOUR_JENNA_VOICE_ID', ... } }
sara:  { voice: { voiceId: 'YOUR_SARA_VOICE_ID',  ... } }
```

### Step 3 — Set the API key

Add to Vercel environment variables:

```
ELEVENLABS_API_KEY=your_key_here
```

The TTS dispatcher in AIGreeter automatically routes to ElevenLabs when this
key is set, and falls back to browser Web Speech API when it isn't. No code
changes needed.

### Step 4 — Tune per-persona voice characteristics

Each persona's `voice` block has these adjustable parameters:

- `pitch`  — relative pitch (1.0 = natural; 1.05 = slightly higher; 0.95 = slightly lower)
- `speed`  — speaking rate (1.0 = natural; 1.05 = slightly faster; 0.98 = slightly slower)
- `style`  — text label only, used in the system prompt context

ElevenLabs natively supports stability + similarity_boost + style_exaggeration
parameters. To expose those, extend the `voice` block:

```js
voice: {
  voiceId: '...',
  stability: 0.5,         // 0-1, lower = more expressive
  similarityBoost: 0.75,  // 0-1, higher = more like source
  styleExaggeration: 0.3, // 0-1, higher = more emotive
}
```

The TTS dispatcher passes these through to the ElevenLabs `/v1/text-to-speech`
endpoint when present.

## Alternative providers (future-ready)

The `provider` field in the voice block is read by the dispatcher. To add
another provider:

```js
voice: {
  provider: 'google_cloud_tts',  // or 'azure_speech', 'openai', etc.
  voiceId: '...',
  ...
}
```

The dispatcher in `AIGreeter.jsx` has a switch statement keyed off `provider`.
Adding a case for a new provider is the only code change needed; per-persona
config stays in `agent-personalities.js`.

## Browser fallback

When `ELEVENLABS_API_KEY` is not set (or any other API call fails), the
dispatcher falls back to the browser's Web Speech API (free, built-in, no
key required). Each persona's `browserFallback` block guides voice selection:

```js
browserFallback: {
  lang: 'en-US',
  nameHints: ['Samantha', 'Karen'],  // tries each in order
  rate: 1.0,
  pitch: 1.0,
}
```

The browser will pick the first matching installed voice. On macOS, Samantha
is usually present; on Windows, Microsoft Zira; on Chrome, Google US English.

## Cost notes

- **Web Speech API:** free, unlimited
- **ElevenLabs:** ~$5/month starter, ~$22/month creator (10k chars + cloning)
  - For ~3 KTC team members each generating ~500 chars/day of TTS, the
    creator tier is plenty (~45k chars/month vs 30k included)
- **Google Cloud TTS / Azure Speech:** pay-per-char, ~$4/million chars

## Where to add the API call

When ready to wire ElevenLabs in production, the integration point is in
`AIGreeter.jsx`. Look for the comment marker:

```js
// === TTS DISPATCH POINT ===
```

Replace the existing browser-only TTS code with:

```js
const voiceId = persona.voice.voiceId;
const apiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY; // or backend proxy
if (apiKey && voiceId) {
  // Call ElevenLabs /v1/text-to-speech/{voiceId}
} else {
  // Fall back to Web Speech API
}
```

For security, the actual API call should go through a backend route
(`/api/tts/speak`) so the API key isn't exposed to the browser.
