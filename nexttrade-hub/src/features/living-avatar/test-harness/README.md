# Playback Queue Test Harness

Self-contained HTML page that validates the `useAudioPlaybackQueue` flush
behavior (guardrail #1) without involving any provider, server, or React.

## How to use

1. Open `playback-queue-harness.html` directly in Chrome and Safari (file:// is fine).
2. Click **▶ Start Streaming** — a 6-second test MP3 starts feeding into the
   playback queue in 12 chunks. The orange "mouth" pill expands/contracts
   based on the audio level via the real `useMouthSync` algorithm.
3. Mid-playback, click **⏹ INTERRUPT**.
4. Observe:
   - Mouth closes within ~50-150ms (well under the 800ms spec)
   - Audio stops immediately
   - The log panel records every step of the flush
   - "flush → mouth closed" timing cell shows the measured value
5. Click **↻ Restart** then **▶ Start Streaming** again — confirms no
   zombie audio from the previous turn.

## Automated test suite

The **▶ Run full test sequence** button runs the entire critical-path
flow programmatically and reports pass/fail for 14 assertions:

- T1: unlock() works
- T2: SourceBuffer ready after init
- T3: Audio is playing mid-stream
- T4: Chunks fed > 0
- **T5: Mouth closes <800ms after INTERRUPT** (the headline guarantee)
- T6: aborted flag set after flush
- T7: Audio element paused
- T8: pendingChunks cleared
- T9: Bytes dropped > 0
- **T10: New chunks dropped while aborted=true** (no zombie audio)
- T11: reset() rebuilds MediaSource
- T12: SourceBuffer ready after reset
- T13: appendChunk works post-reset
- T14: Audio plays cleanly after restart

The harness is one-shot per page load (createMediaElementSource is a
one-shot binding). To re-run, reload the page.

## What this proves

If T5 + T10 pass in both Chrome and Safari, the buffer-flush guardrail
works correctly in isolation. We can then connect to the real providers
with confidence that the worst-case "zombie audio after interrupt"
class of bug is structurally impossible.

## What this does NOT prove

- Real provider behavior (Deepgram VAD, ElevenLabs close-vs-buffered race)
- Network-induced delays in chunk arrival
- Mobile Safari microphone quirks
- Authentication / origin / CORS interactions

Those need live testing with the deployed Railway service.
