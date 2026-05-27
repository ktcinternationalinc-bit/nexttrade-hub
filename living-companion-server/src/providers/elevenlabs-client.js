// ============================================================
// providers/elevenlabs-client.js — ElevenLabs Input Streaming WebSocket
// ============================================================
// ElevenLabs' "Input Streaming" endpoint lets us push text chunks INTO
// a WebSocket and receive audio chunks back. This is exactly what we
// need: we feed Claude tokens in as they arrive, ElevenLabs streams
// audio out as it generates.
//
// API surface used:
//   wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input
//
// Outbound message shape:
//   { text: " hello", flush: false }                  ← keep streaming
//   { text: " world", try_trigger_generation: true }  ← hint to generate
//   { text: "" }                                       ← signal end-of-text
//
// Inbound message shape:
//   { audio: "<base64 mp3>", isFinal: false }
//   { audio: null, isFinal: true }
//
// CRITICAL: when we abort mid-generation we MUST close the WebSocket.
// Just stopping sends does NOT stop generation — ElevenLabs keeps producing
// audio for whatever text is already buffered server-side until end-of-stream.
// ============================================================

import WebSocket from 'ws';

const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';
const VOICE_IDS = {
  nadia: process.env.ELEVENLABS_VOICE_NADIA,
  jenna: process.env.ELEVENLABS_VOICE_JENNA,
  sara: process.env.ELEVENLABS_VOICE_SARA,
};

/**
 * Open an ElevenLabs streaming session. Returns an object with:
 *   sendText(chunk)    — feed Claude token (or any text fragment)
 *   finishText()       — signal no more text coming; let generation finish
 *   abort()            — kill the connection immediately (barge-in)
 *
 * @param {Object} opts
 * @param {'nadia'|'jenna'|'sara'} opts.personaId
 * @param {(audioBase64: string, chunkIndex: number) => void} opts.onAudio
 * @param {() => void} opts.onEnd                        — fired when ElevenLabs signals isFinal
 * @param {(err: Error) => void} opts.onError
 * @returns {ElevenLabsSession}
 */
export function openElevenLabsSession(opts) {
  const voiceId = VOICE_IDS[opts.personaId];
  if (!voiceId) throw new Error(`no ElevenLabs voice id configured for persona "${opts.personaId}"`);

  const url = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input`
  );
  url.protocol = 'wss:';
  url.searchParams.set('model_id', ELEVENLABS_MODEL);
  url.searchParams.set('output_format', 'mp3_44100_128');
  // optimize_streaming_latency=3 gives the lowest perceived latency at a
  // small quality cost. Persona panels expect snappy responses.
  url.searchParams.set('optimize_streaming_latency', '3');

  const ws = new WebSocket(url.toString(), {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
  });

  let closed = false;
  let opened = false;
  let chunkIndex = 0;
  // Buffer text sent before the socket finishes opening — replay it
  // once we get the 'open' event.
  const preOpenQueue = [];

  ws.on('open', () => {
    opened = true;
    console.log(`[elevenlabs] open persona=${opts.personaId} voice=${voiceId.slice(0, 8)}`);

    // First message must include voice settings + bos:true (beginning of stream).
    // Stability/similarity are persona-tunable later; defaults are fine for v1.
    const initMsg = {
      text: ' ',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        speed: 1.0,
      },
      generation_config: {
        chunk_length_schedule: [120, 160, 250, 290],
      },
    };
    safeSend(initMsg);

    // Drain anything queued before the connection finished opening.
    while (preOpenQueue.length > 0) {
      const item = preOpenQueue.shift();
      safeSend(item);
    }
  });

  ws.on('message', (raw) => {
    if (closed) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      console.warn('[elevenlabs] bad json from server:', err.message);
      return;
    }
    if (msg.audio) {
      if (opts.onAudio) opts.onAudio(msg.audio, chunkIndex++);
    }
    if (msg.isFinal) {
      if (opts.onEnd) opts.onEnd();
    }
    if (msg.error) {
      console.error('[elevenlabs] server error msg:', msg.error);
      if (opts.onError) opts.onError(new Error(String(msg.error)));
    }
  });

  ws.on('error', (err) => {
    console.error('[elevenlabs] socket error:', err.message);
    if (opts.onError) opts.onError(err);
  });

  ws.on('close', (code, reason) => {
    closed = true;
    opened = false;
    console.log(`[elevenlabs] close code=${code} reason=${reason || '(none)'}`);
  });

  function safeSend(obj) {
    if (closed) return;
    if (!opened) {
      preOpenQueue.push(obj);
      return;
    }
    try {
      ws.send(JSON.stringify(obj));
    } catch (err) {
      console.warn('[elevenlabs] send failed:', err.message);
    }
  }

  return {
    /** Stream a text fragment (typically a Claude token delta). */
    sendText(text) {
      if (closed || !text) return;
      safeSend({ text: text, try_trigger_generation: true });
    },

    /** Signal end-of-text. ElevenLabs will flush remaining audio and emit isFinal. */
    finishText() {
      if (closed) return;
      // Per ElevenLabs docs, sending text:"" signals EOS.
      safeSend({ text: '' });
    },

    /**
     * Hard abort — close the socket immediately. Used for barge-in.
     * Any text already buffered server-side is dropped without rendering.
     */
    abort() {
      if (closed) return;
      closed = true;
      try {
        // 1000 = normal closure; ElevenLabs treats it as a clean cancel.
        ws.close(1000, 'client_aborted');
      } catch (err) {
        try { ws.terminate(); } catch (_) {}
      }
    },

    get isClosed() { return closed; },
  };
}

/**
 * @typedef {Object} ElevenLabsSession
 * @property {(text: string) => void} sendText
 * @property {() => void} finishText
 * @property {() => void} abort
 * @property {boolean} isClosed
 */
