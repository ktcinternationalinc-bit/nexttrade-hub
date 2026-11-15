// ============================================================
// providers/deepgram-client.js — Deepgram Nova-2 streaming
// ============================================================
// Wraps Deepgram's official SDK live-transcription connection in a tiny
// interface the orchestrator can use without knowing SDK details.
//
// Per spec:
//   - model: nova-2
//   - interim_results: true   (we need partials for "break" detection)
//   - endpointing: true       (we need rapid utterance endpoints)
//
// We also enable VAD events so the orchestrator can hear "user started
// speaking" the instant it happens — that's the trigger for barge-in.
// ============================================================

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

/**
 * @param {Object} opts
 * @param {string} opts.language        — 'en' | 'ar' (Deepgram nova-2 supports both)
 * @param {'pcm16'|'opus'} opts.codec   — incoming audio codec from client
 * @param {number} opts.sampleRate
 * @param {(text:string, conf:number) => void} opts.onPartial
 * @param {(text:string, language:string, durationMs:number) => void} opts.onFinal
 * @param {() => void} opts.onSpeechStarted  — VAD: user started talking. Critical for barge-in.
 * @param {() => void} opts.onUtteranceEnd   — VAD: user stopped talking
 * @param {(err:Error) => void} opts.onError
 * @returns {DeepgramSession}
 */
export function openDeepgramSession(opts) {
  const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

  // ────────────────────────────────────────────────
  // Encoding mapping. Deepgram wants `encoding=linear16` for raw PCM
  // or `encoding=opus` for Opus. Browser MediaRecorder typically gives
  // us webm/opus — we let the client tell us which it sent.
  // ────────────────────────────────────────────────
  const encoding = opts.codec === 'opus' ? 'opus' : 'linear16';

  const connection = deepgram.listen.live({
    model: process.env.DEEPGRAM_MODEL || 'nova-2',
    language: opts.language || 'en',
    encoding: encoding,
    sample_rate: opts.sampleRate || 16000,
    channels: 1,
    // CRITICAL per spec — partials let us spot the user starting to talk.
    interim_results: true,
    // Endpoint detection: how long of a silence before we finalize the
    // utterance. 300ms is aggressive but gives snappy turn-taking.
    endpointing: 300,
    // VAD events surface speech_started / utterance_end on the wire,
    // separate from the transcript stream. These drive barge-in.
    vad_events: true,
    // Punctuation + smart formatting make the transcript LLM-ready
    // without a cleanup pass.
    punctuate: true,
    smart_format: true,
    // Confidence filter — drop ultra-low-confidence partials so we
    // don't burn LLM budget on phantom transcripts.
    filler_words: false,
  });

  let closed = false;

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log('[deepgram] connection open');
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    if (closed) return;
    const alt = data && data.channel && data.channel.alternatives && data.channel.alternatives[0];
    if (!alt) return;
    const text = (alt.transcript || '').trim();
    if (!text) return;
    const conf = Number(alt.confidence || 0);

    if (data.is_final) {
      const language = (data && data.metadata && data.metadata.language) || opts.language || 'en';
      const durationMs = Math.round(Number(data.duration || 0) * 1000);
      if (opts.onFinal) opts.onFinal(text, language, durationMs);
    } else {
      if (opts.onPartial) opts.onPartial(text, conf);
    }
  });

  connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
    if (closed) return;
    // This is the magic event — fires the moment VAD sees voice energy,
    // BEFORE any transcript text exists. The orchestrator hooks this to
    // abort an in-flight TTS response (barge-in).
    if (opts.onSpeechStarted) opts.onSpeechStarted();
  });

  connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
    if (closed) return;
    if (opts.onUtteranceEnd) opts.onUtteranceEnd();
  });

  connection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('[deepgram] error:', err);
    if (opts.onError) opts.onError(err);
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    closed = true;
    console.log('[deepgram] connection closed');
  });

  /**
   * Push an audio chunk into the Deepgram stream.
   * @param {Buffer|Uint8Array} chunk
   */
  function sendAudio(chunk) {
    if (closed) return;
    try {
      connection.send(chunk);
    } catch (err) {
      console.warn('[deepgram] send failed (connection may be closing):', err.message);
    }
  }

  /**
   * Signal end-of-utterance to Deepgram and close the WebSocket.
   * After this, no more transcripts will arrive.
   */
  function finish() {
    if (closed) return;
    closed = true;
    try {
      connection.finish();
    } catch (err) {
      console.warn('[deepgram] finish failed:', err.message);
    }
  }

  /**
   * Hard-close the connection (e.g. on persona switch). Doesn't wait
   * for Deepgram to send a final transcript.
   */
  function abort() {
    if (closed) return;
    closed = true;
    try {
      connection.requestClose();
    } catch (err) {
      // SDK versions differ; fall back to whichever close method exists.
      try { connection.finish(); } catch (_) {}
    }
  }

  return { sendAudio, finish, abort, get isClosed() { return closed; } };
}

/**
 * @typedef {Object} DeepgramSession
 * @property {(chunk: Buffer|Uint8Array) => void} sendAudio
 * @property {() => void} finish
 * @property {() => void} abort
 * @property {boolean} isClosed
 */
