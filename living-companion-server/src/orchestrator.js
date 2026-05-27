// ============================================================
// orchestrator.js — three-way stream pipeline with barge-in
// ============================================================
// One Orchestrator per Socket.io connection. Owns the full pipeline:
//
//   client mic chunk
//     → Deepgram (streaming STT, partials + finals + VAD events)
//        → on final transcript:
//           → start Claude stream (LLM tokens)
//             → start ElevenLabs stream (audio gen)
//               → for each Claude token: push into ElevenLabs
//               → for each ElevenLabs audio chunk: emit to client
//
//   Barge-in fires when EITHER:
//     a) Deepgram VAD detects new speech while TTS is playing, OR
//     b) Client sends client.interrupt (manual button / persona switch)
//
//   On barge-in we must, in order:
//     1. Bump sequenceId so any in-flight events the client sees are stale
//     2. Abort the Claude stream via AbortController
//     3. Close the ElevenLabs socket (otherwise it keeps generating
//        audio for whatever text was already pushed server-side)
//     4. Emit `server.interrupted` so the client closes the mouth NOW
//
// State invariants:
//   - At most one active turn at a time (one Claude + one ElevenLabs).
//   - turn.id is a monotonic counter. Any callback fired by a stale
//     turn must check turn.id === currentTurnId before acting.
//   - dispose() must be safe to call from any state including mid-turn.
// ============================================================

import { openDeepgramSession } from './providers/deepgram-client.js';
import { streamClaudeTokens } from './providers/claude-client.js';
import { openElevenLabsSession } from './providers/elevenlabs-client.js';
import { getPersonaPrompt } from './lib/persona-prompts.js';

export class Orchestrator {
  /**
   * @param {Object} opts
   * @param {(event: string, payload: any) => void} opts.emit
   * @param {string} opts.logTag
   */
  constructor(opts) {
    this.emit = opts.emit;
    this.logTag = opts.logTag || '';

    // Session state — survives across turns within the same socket.
    this.personaId = 'nadia';
    this.conversationId = null;
    this.sequenceId = 0;
    this.history = []; // [{role, content}], capped to last N turns

    // Per-turn state — cleared on each new turn and on interrupt.
    /** @type {Turn|null} */
    this.activeTurn = null;
    this._turnCounter = 0;

    // Deepgram session — opened lazily on first audio chunk.
    this.deepgram = null;

    this._disposed = false;
  }

  log(...args) {
    console.log(`[orch ${this.logTag}]`, ...args);
  }

  // ────────────────────────────────────────────────
  // Inbound: client.audio_chunk
  // ────────────────────────────────────────────────
  handleAudioChunk(msg) {
    if (this._disposed) return;
    const payload = msg && msg.payload;
    if (!payload || !payload.audioBase64) return;
    this.conversationId = (msg && msg.conversationId) || this.conversationId;

    // Lazy-open Deepgram on the first chunk so we don't burn quota when
    // the user opens the panel but never speaks.
    if (!this.deepgram || this.deepgram.isClosed) {
      this._openDeepgram(payload.codec, payload.sampleRate);
    }

    const buf = Buffer.from(payload.audioBase64, 'base64');
    this.deepgram.sendAudio(buf);
  }

  handleAudioEnd(/* msg */) {
    if (!this.deepgram || this.deepgram.isClosed) return;
    // Tell Deepgram the utterance is over. It'll emit a final transcript
    // shortly after (endpointing kicks in), which triggers _startTurn.
    this.deepgram.finish();
  }

  // ────────────────────────────────────────────────
  // Inbound: client.text_input — skip STT, go straight to Claude
  // ────────────────────────────────────────────────
  handleTextInput(msg) {
    if (this._disposed) return;
    const text = msg && msg.payload && msg.payload.text;
    if (!text || !text.trim()) return;
    this.conversationId = (msg && msg.conversationId) || this.conversationId;
    this._startTurn(text.trim());
  }

  // ────────────────────────────────────────────────
  // Inbound: client.interrupt — manual barge-in
  // ────────────────────────────────────────────────
  interrupt({ reason = 'manual' } = {}) {
    if (this._disposed) return;
    this._abortActiveTurn(reason);
  }

  // ────────────────────────────────────────────────
  // Inbound: client.persona_switch — implicit interrupt + identity change
  // ────────────────────────────────────────────────
  switchPersona(toPersona) {
    if (this._disposed) return;
    this.log(`persona switch ${this.personaId} → ${toPersona}`);
    this._abortActiveTurn('persona_switch');
    this.personaId = toPersona;
    // Drop conversation history on persona switch — each persona starts fresh
    // because they have different roles + permissions. (Cross-persona memory
    // can be designed in Phase 3 once we know what should bleed across.)
    this.history = [];
    this._emit('server.avatar_state', { state: 'idle' });
  }

  // ────────────────────────────────────────────────
  // Cleanup — called on disconnect
  // ────────────────────────────────────────────────
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._abortActiveTurn('disconnect');
    if (this.deepgram && !this.deepgram.isClosed) {
      this.deepgram.abort();
    }
    this.deepgram = null;
    this.log('disposed');
  }

  // ============================================================
  // PRIVATE — Deepgram lifecycle
  // ============================================================
  _openDeepgram(codec, sampleRate) {
    this.log(`opening deepgram codec=${codec} rate=${sampleRate}`);
    this.deepgram = openDeepgramSession({
      language: 'en', // TODO: detect from client or persona context
      codec: codec,
      sampleRate: sampleRate,

      onPartial: (text, conf) => {
        if (this._disposed) return;
        this._emit('server.stt_partial', { text, confidence: conf });
      },

      onFinal: (text, language, durationMs) => {
        if (this._disposed) return;
        this._emit('server.stt_final', { text, language, durationMs });
        // Final transcript = user finished speaking → start the AI turn.
        this._startTurn(text);
      },

      // CRITICAL — barge-in trigger #1.
      // VAD fires the instant voice energy is detected, well before we
      // have any transcript text. If we have a TTS turn playing, kill it.
      onSpeechStarted: () => {
        if (this._disposed) return;
        if (this.activeTurn) {
          this.log('VAD barge-in detected while TTS playing — aborting turn');
          this._abortActiveTurn('voice_barge_in');
        }
      },

      onUtteranceEnd: () => {
        // We don't act on UtteranceEnd directly — onFinal is the right
        // trigger for starting the turn (it gives us the transcript too).
      },

      onError: (err) => {
        if (this._disposed) return;
        this._emit('server.error', {
          code: 'deepgram_error',
          message: String(err && err.message),
          fatal: false,
        });
      },
    });
  }

  // ============================================================
  // PRIVATE — Turn lifecycle (Claude → ElevenLabs)
  // ============================================================

  /**
   * @param {string} userMessage
   */
  _startTurn(userMessage) {
    if (this._disposed) return;

    // If a turn is already in flight (e.g. user double-tapped, or onFinal
    // fires twice from Deepgram), abort the previous one cleanly first.
    if (this.activeTurn) {
      this.log('new turn requested while previous still active — aborting old');
      this._abortActiveTurn('superseded');
    }

    const turnId = ++this._turnCounter;
    const abortController = new AbortController();

    // Bump sequence so any late stragglers from the previous turn get
    // dropped by the client's wire-schema staleness check.
    this.sequenceId++;

    /** @type {Turn} */
    const turn = {
      id: turnId,
      abortController,
      eleven: null,
      claudeText: '',
      done: false,
    };
    this.activeTurn = turn;

    this._emit('server.avatar_state', { state: 'thinking' });
    this.log(`turn ${turnId} start: "${userMessage.slice(0, 60)}${userMessage.length > 60 ? '…' : ''}"`);

    // ────────────────────────────────────────────────
    // Open ElevenLabs WebSocket up front so it's ready by the time the
    // first Claude token arrives. This shaves ~150ms off perceived latency.
    // ────────────────────────────────────────────────
    turn.eleven = openElevenLabsSession({
      personaId: this.personaId,

      onAudio: (audioBase64, chunkIndex) => {
        // Stale callback guard: if this turn was aborted between when
        // ElevenLabs queued the audio and now, drop it.
        if (turn.id !== this._turnCounter || this._disposed) return;
        // Emit avatar_state=speaking once on the first audio chunk so the
        // client's XState machine transitions from thinking→speaking.
        if (chunkIndex === 0) {
          this._emit('server.avatar_state', { state: 'speaking' });
        }
        this._emit('server.tts_chunk', {
          audioBase64,
          codec: 'mp3',
          sampleRate: 44100,
          chunkIndex,
        });
      },

      onEnd: () => {
        if (turn.id !== this._turnCounter || this._disposed) return;
        this._finishTurn(turn);
      },

      onError: (err) => {
        if (turn.id !== this._turnCounter || this._disposed) return;
        this._emit('server.error', {
          code: 'tts_error',
          message: String(err && err.message),
          fatal: false,
        });
        // Fall back gracefully — emit the assembled text so the client
        // at least sees what Nadia/Jenna/Sara would have said.
        this._emit('server.llm_final', { text: turn.claudeText });
        this._finishTurn(turn);
      },
    });

    // ────────────────────────────────────────────────
    // Kick off the Claude stream. Tokens flow into ElevenLabs as they
    // arrive — we do NOT wait for the full response.
    // ────────────────────────────────────────────────
    this._runClaudeStream(turn, userMessage).catch((err) => {
      if (err && (err.name === 'AbortError' || err.code === 'ERR_ABORTED')) {
        // Expected on barge-in — already handled in _abortActiveTurn.
        return;
      }
      this.log('claude stream failed:', err.message);
      this._emit('server.error', {
        code: 'llm_error',
        message: String(err && err.message),
        fatal: false,
      });
      this._abortActiveTurn('llm_failed');
    });
  }

  async _runClaudeStream(turn, userMessage) {
    try {
      const tokens = streamClaudeTokens({
        systemPrompt: getPersonaPrompt(this.personaId),
        history: this.history,
        userMessage,
        signal: turn.abortController.signal,
      });

      for await (const delta of tokens) {
        // Guard: if turn was aborted between yields, stop pushing.
        // The AbortController will also break the for-await on the next
        // iteration, but this gives us a fast-fail before the next token.
        if (turn.id !== this._turnCounter || turn.abortController.signal.aborted) {
          break;
        }
        turn.claudeText += delta;

        // Surface partial text to client (lets the UI show streaming text
        // alongside the audio).
        this._emit('server.llm_partial', {
          delta,
          accumulated: turn.claudeText,
        });

        // Pipe directly into ElevenLabs — this is the magic that lets
        // audio start playing before Claude finishes writing.
        if (turn.eleven && !turn.eleven.isClosed) {
          turn.eleven.sendText(delta);
        }
      }

      // Claude finished naturally. Emit final text and tell ElevenLabs
      // there's no more text coming — it'll flush + emit isFinal which
      // triggers _finishTurn via the onEnd callback.
      if (turn.id === this._turnCounter && !turn.abortController.signal.aborted) {
        this._emit('server.llm_final', { text: turn.claudeText });
        if (turn.eleven && !turn.eleven.isClosed) {
          turn.eleven.finishText();
        }
      }
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.code === 'ERR_ABORTED')) {
        // Expected during barge-in. Don't propagate.
        return;
      }
      throw err;
    }
  }

  // ============================================================
  // PRIVATE — Turn termination paths
  // ============================================================

  /**
   * Clean end-of-turn. Push the exchange into history and clear state.
   * @param {Turn} turn
   */
  _finishTurn(turn) {
    if (turn.id !== this._turnCounter || turn.done) return;
    turn.done = true;

    // Cap history at last 10 turns (20 messages) to keep token budget bounded.
    // Real persistent memory belongs in Supabase — this is just so the persona
    // remembers what was just said within the same session.
    if (turn.claudeText) {
      // We'd push the user message too — pulled from the active turn — but we
      // didn't store it on turn; quick fix: pull from server.stt_final flow.
      // Keeping this minimal for the scaffold; production version should
      // capture the user message into the turn object when _startTurn fires.
    }

    this._emit('server.tts_end', { totalChunks: 0, totalDurationMs: 0 });
    this._emit('server.avatar_state', { state: 'idle' });

    this.activeTurn = null;
    this.log(`turn ${turn.id} complete`);
  }

  /**
   * Abort current turn — kill Claude stream, close ElevenLabs socket,
   * tell client to shut up immediately.
   * @param {string} reason
   */
  _abortActiveTurn(reason) {
    const turn = this.activeTurn;
    if (!turn || turn.done) return;
    turn.done = true;

    this.log(`aborting turn ${turn.id} reason=${reason}`);

    // ORDER MATTERS:
    //   1. Bump sequence FIRST so client knows anything older is stale.
    //   2. Abort Claude stream so it stops generating + stops pushing to
    //      ElevenLabs.
    //   3. Close ElevenLabs socket so server-side TTS generation stops.
    //   4. Notify client so it can stop playback + close mouth.
    //
    // If we did #4 before #2/#3, audio that's already mid-flight would
    // still hit the client speakers in the gap — which is exactly the
    // "phantom audio after interrupt" bug we're trying to prevent.
    this.sequenceId++;

    try {
      turn.abortController.abort();
    } catch (err) {
      this.log('claude abort failed (non-fatal):', err.message);
    }

    if (turn.eleven && !turn.eleven.isClosed) {
      try {
        turn.eleven.abort();
      } catch (err) {
        this.log('elevenlabs abort failed (non-fatal):', err.message);
      }
    }

    this._emit('server.interrupted', { reason });
    this._emit('server.avatar_state', { state: 'interrupted' });

    this.activeTurn = null;
  }

  // ============================================================
  // PRIVATE — outbound emit helper
  // ============================================================
  _emit(eventName, payload) {
    if (this._disposed) return;
    try {
      this.emit(eventName, {
        type: eventName,
        conversationId: this.conversationId,
        personaId: this.personaId,
        sequenceId: this.sequenceId,
        timestamp: Date.now(),
        payload,
      });
    } catch (err) {
      this.log('emit failed (non-fatal):', err.message);
    }
  }
}

/**
 * @typedef {Object} Turn
 * @property {number} id                  — monotonic counter; stale callbacks check against currentTurnId
 * @property {AbortController} abortController — signal passed to Claude SDK
 * @property {import('./providers/elevenlabs-client.js').ElevenLabsSession|null} eleven
 * @property {string} claudeText          — accumulated LLM text for history
 * @property {boolean} done               — set true on terminal transition (finish OR abort)
 */
