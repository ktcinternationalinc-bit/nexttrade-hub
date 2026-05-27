// ============================================================
// Living Avatar — WebSocket message schema (JSDoc)
// ============================================================
// v55.83-A.6.27.72 HOTFIX 18.
//
// JSDoc-typed schema for the bidirectional streaming channel between the
// browser and the (not-yet-implemented) server. Why JSDoc instead of TS:
// the rest of the repo is JSX (Vercel SWC constraint), so we keep that
// consistent and let editors/VS Code do type inference from JSDoc.
//
// Every message MUST include these envelope fields:
//   - type        — discriminator (one of MESSAGE_TYPES below)
//   - conversationId  — UUID of the current conversation
//   - personaId   — 'nadia' | 'jenna' | 'sara'
//   - sequenceId  — monotonically increasing per conversation. Used to
//                   reject stale partials after barge-in / persona switch.
//   - timestamp   — Date.now() millis at send
//   - payload     — type-specific body (see typedefs below)
//
// SERVER → CLIENT messages carry the SAME sequenceId the client sent so
// the client can correlate. After a 'client.interrupt' the server bumps
// sequenceId so any partial in flight gets dropped by the client.
// ============================================================

/**
 * @typedef {(
 *   | 'client.audio_chunk'      // raw PCM/opus mic frame
 *   | 'client.audio_end'        // mic released — finalize utterance
 *   | 'client.interrupt'        // barge-in — stop playback immediately
 *   | 'client.persona_switch'   // change active persona mid-conversation
 *   | 'client.text_input'       // user typed (no STT path)
 *   | 'client.ping'             // keepalive
 *   | 'server.stt_partial'      // streaming transcript (in-progress)
 *   | 'server.stt_final'        // finalized transcript for this utterance
 *   | 'server.llm_partial'      // streaming LLM token chunk
 *   | 'server.llm_final'        // final assembled response text
 *   | 'server.tts_chunk'        // streaming audio buffer
 *   | 'server.tts_end'          // signals last TTS chunk for this turn
 *   | 'server.avatar_state'     // mouth shape / persona animation hint
 *   | 'server.error'            // recoverable / fatal error
 *   | 'server.pong'             // keepalive reply
 * )} MessageType
 */

/**
 * @typedef {Object} BaseEnvelope
 * @property {MessageType} type
 * @property {string}      conversationId
 * @property {'nadia'|'jenna'|'sara'} personaId
 * @property {number}      sequenceId
 * @property {number}      timestamp
 */

// ============================================================
// CLIENT → SERVER payloads
// ============================================================

/**
 * Raw mic frame. Encoded as base64-PCM-16 OR opus depending on negotiation.
 * Chunk size is typically 20-100ms of audio.
 * @typedef {Object} ClientAudioChunkPayload
 * @property {string} audioBase64
 * @property {'pcm16'|'opus'} codec
 * @property {number} sampleRate
 * @property {boolean} [isFirstChunk]
 */

/**
 * Sent when the mic is released or VAD detects end-of-speech.
 * Tells the server it can finalize STT for the current utterance.
 * @typedef {Object} ClientAudioEndPayload
 * @property {number} totalChunks
 * @property {number} totalDurationMs
 */

/**
 * Barge-in. Sent the moment the user starts speaking while TTS is playing
 * (or the user types something while audio is playing). The server MUST:
 *   1. Stop generating LLM tokens for the current turn.
 *   2. Stop sending TTS chunks.
 *   3. Bump sequenceId so any in-flight client.* messages are stale.
 * The client MUST immediately stop audio playback and reset mouth state.
 * @typedef {Object} ClientInterruptPayload
 * @property {'voice'|'text'|'manual'} reason
 */

/**
 * Switch personas mid-conversation. Implicit interrupt — if a persona is
 * speaking when this arrives, treat as interrupt + persona change.
 * @typedef {Object} ClientPersonaSwitchPayload
 * @property {'nadia'|'jenna'|'sara'} toPersona
 */

/**
 * Typed text input (no STT step needed). Triggers LLM + TTS directly.
 * @typedef {Object} ClientTextInputPayload
 * @property {string} text
 * @property {'en'|'ar'} language
 */

// ============================================================
// SERVER → CLIENT payloads
// ============================================================

/**
 * STT partial — sent every few hundred ms while user is speaking.
 * Higher confidence partials supersede lower-confidence ones with same sequenceId.
 * @typedef {Object} ServerSttPartialPayload
 * @property {string} text
 * @property {number} confidence
 */

/**
 * STT final — sent once after client.audio_end. The text the LLM will see.
 * @typedef {Object} ServerSttFinalPayload
 * @property {string} text
 * @property {string} language
 * @property {number} durationMs
 */

/**
 * LLM token chunk — sent as model streams.
 * @typedef {Object} ServerLlmPartialPayload
 * @property {string} delta
 * @property {string} accumulated
 */

/**
 * LLM final — full text + any tool calls the persona invoked.
 * @typedef {Object} ServerLlmFinalPayload
 * @property {string} text
 * @property {{ name: string, args: any, result?: any }[]} [toolCalls]
 */

/**
 * TTS audio frame. Same codec as client side.
 * @typedef {Object} ServerTtsChunkPayload
 * @property {string} audioBase64
 * @property {'pcm16'|'opus'|'mp3'} codec
 * @property {number} sampleRate
 * @property {number} chunkIndex
 */

/** @typedef {Object} ServerTtsEndPayload
 *  @property {number} totalChunks
 *  @property {number} totalDurationMs
 */

/**
 * Avatar animation hint. Most mouth animation comes from the TTS audio
 * stream itself (Web Audio API analyser) — but the server can OPTIONALLY
 * send pre-computed visemes when available for more accurate sync.
 * @typedef {Object} ServerAvatarStatePayload
 * @property {'idle'|'listening'|'thinking'|'speaking'|'interrupted'} state
 * @property {'closed'|'small'|'medium'|'wide'|'smile'} [mouthShape]
 * @property {number} [audioLevel]  // 0..1, for reactive mouth
 * @property {{ time: number, shape: 'closed'|'small'|'medium'|'wide' }[]} [visemes]
 */

/**
 * Recoverable or fatal error.
 * @typedef {Object} ServerErrorPayload
 * @property {string} code
 * @property {string} message
 * @property {boolean} fatal
 */

// ============================================================
// Discriminated union for type-checking call sites
// ============================================================

/**
 * @typedef {BaseEnvelope & ({type: 'client.audio_chunk',     payload: ClientAudioChunkPayload}
 *                        | {type: 'client.audio_end',       payload: ClientAudioEndPayload}
 *                        | {type: 'client.interrupt',       payload: ClientInterruptPayload}
 *                        | {type: 'client.persona_switch',  payload: ClientPersonaSwitchPayload}
 *                        | {type: 'client.text_input',      payload: ClientTextInputPayload}
 *                        | {type: 'client.ping',            payload: {}}
 *                        | {type: 'server.stt_partial',     payload: ServerSttPartialPayload}
 *                        | {type: 'server.stt_final',       payload: ServerSttFinalPayload}
 *                        | {type: 'server.llm_partial',     payload: ServerLlmPartialPayload}
 *                        | {type: 'server.llm_final',       payload: ServerLlmFinalPayload}
 *                        | {type: 'server.tts_chunk',       payload: ServerTtsChunkPayload}
 *                        | {type: 'server.tts_end',         payload: ServerTtsEndPayload}
 *                        | {type: 'server.avatar_state',    payload: ServerAvatarStatePayload}
 *                        | {type: 'server.error',           payload: ServerErrorPayload}
 *                        | {type: 'server.pong',            payload: {}}
 * )} WireMessage
 */

// ============================================================
// Runtime helpers — build / validate envelopes
// ============================================================

export var MESSAGE_TYPES = Object.freeze({
  CLIENT_AUDIO_CHUNK:     'client.audio_chunk',
  CLIENT_AUDIO_END:       'client.audio_end',
  CLIENT_INTERRUPT:       'client.interrupt',
  CLIENT_PERSONA_SWITCH:  'client.persona_switch',
  CLIENT_TEXT_INPUT:      'client.text_input',
  CLIENT_PING:            'client.ping',
  SERVER_STT_PARTIAL:     'server.stt_partial',
  SERVER_STT_FINAL:       'server.stt_final',
  SERVER_LLM_PARTIAL:     'server.llm_partial',
  SERVER_LLM_FINAL:       'server.llm_final',
  SERVER_TTS_CHUNK:       'server.tts_chunk',
  SERVER_TTS_END:         'server.tts_end',
  SERVER_AVATAR_STATE:    'server.avatar_state',
  SERVER_ERROR:           'server.error',
  SERVER_PONG:            'server.pong',
});

/**
 * Build a fully-formed wire envelope. Centralizing this means there's
 * exactly one place that decides what a valid message looks like.
 * @param {MessageType} type
 * @param {{conversationId: string, personaId: 'nadia'|'jenna'|'sara', sequenceId: number, payload: any}} fields
 * @returns {WireMessage}
 */
export function buildMessage(type, fields) {
  return {
    type: type,
    conversationId: fields.conversationId,
    personaId: fields.personaId,
    sequenceId: fields.sequenceId,
    timestamp: Date.now(),
    payload: fields.payload || {},
  };
}

/**
 * Reject server messages whose sequenceId is older than what we last accepted.
 * This is the core defense against stale-message glitches after barge-in.
 * @param {WireMessage} msg
 * @param {number} acceptedSequenceId
 * @returns {boolean}
 */
export function isStale(msg, acceptedSequenceId) {
  if (!msg || typeof msg.sequenceId !== 'number') return true;
  return msg.sequenceId < acceptedSequenceId;
}
