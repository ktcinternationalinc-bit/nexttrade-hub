// ============================================================
// useCompanionSocket — Socket.io client + XState bridge
// ============================================================
// v55.83-A.6.27.72 HOTFIX 22.
//
// This is the single integration point that ties together:
//   - The XState machine (from HOTFIX 18) — owns UI state
//   - The Socket.io client — transport to /living-companion-server
//   - The microphone hook — captures + chunks audio
//   - The playback queue — receives audio + drives mouth animation
//
// Strictly provider-agnostic on the client. The browser never knows that
// "Deepgram" or "ElevenLabs" exist — it only knows about wire-schema
// event names (client.audio_chunk, server.avatar_state, etc.). If we
// swap providers tomorrow, none of this code changes.
//
// XState ownership contract:
//   - The XState machine is the SOURCE OF TRUTH for UI state. React state
//     and refs only hold things outside its scope (sockets, audio elements,
//     mic recorders).
//   - Socket events do NOT directly set React state for UI concerns —
//     they `send()` events into the machine, and the UI re-renders off
//     the machine snapshot.
//   - The machine never knows about sockets. The bridge is one-way:
//     socket → machine.send(EVENT) → UI re-renders.
//
// Barge-in flow (the whole point of this architecture):
//
//   ┌─────────────────────────────────────────────────────────┐
//   │ User hits "Stop" button (or starts talking again)        │
//   │   ↓                                                       │
//   │ 1. machine.send({ type: 'INTERRUPT' })                   │
//   │    → machine transitions to 'interrupted', bumps seqId   │
//   │ 2. playbackQueue.flush()                                  │
//   │    → SourceBuffer wiped, audio paused, currentTime jumped │
//   │ 3. socket.emit('client.interrupt', {reason})              │
//   │    → server aborts Claude stream + closes ElevenLabs WS   │
//   │    → server emits 'server.interrupted'                    │
//   │ 4. (eventual) playbackQueue.reset()                       │
//   │    → fresh MediaSource for the next turn                  │
//   └─────────────────────────────────────────────────────────┘
//
// All four steps run synchronously / immediately. The whole pipeline is
// clear of "zombie audio" before the user even finishes saying "stop".
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import { io } from 'socket.io-client';

import { livingAvatarMachine, getDisplayState } from '../lib/avatar-machine.js';
import { MESSAGE_TYPES, buildMessage, isStale } from '../lib/wire-schema.js';
import { useMicrophone } from './useMicrophone.js';
import { useAudioPlaybackQueue } from './useAudioPlaybackQueue.js';

/**
 * @param {Object} opts
 * @param {string} opts.serverUrl                — e.g. https://yourapp.up.railway.app
 * @param {'nadia'|'jenna'|'sara'} opts.initialPersona
 * @param {string} [opts.authToken]              — optional Supabase JWT (sent in handshake auth)
 * @param {boolean} [opts.autoConnect]           — default true; connect on mount
 * @returns {{
 *   // XState surface
 *   state: 'idle'|'listening'|'thinking'|'speaking'|'interrupted'|'error',
 *   personaId: 'nadia'|'jenna'|'sara',
 *   transcript: string,            // last STT result (partial or final)
 *   responseText: string,          // streaming LLM text
 *   sequenceId: number,            // monotonic; used by LivingAvatar to ignore stale callbacks
 *
 *   // Connection
 *   isConnected: boolean,
 *   isUnlocked: boolean,           // audio context unlocked by user gesture?
 *   error: string | null,
 *
 *   // The audio element to feed into useMouthSync
 *   speakingAudioElement: HTMLAudioElement | null,
 *   speakingPersonaId: 'nadia'|'jenna'|'sara'|null,
 *
 *   // Imperative actions (call from button handlers)
 *   startConversation: () => Promise<void>,  // user gesture: unlock audio + connect + start mic
 *   stopMic: () => void,
 *   interrupt: (reason?: string) => void,
 *   switchPersona: (id: 'nadia'|'jenna'|'sara') => void,
 *   sendText: (text: string) => void,
 * }}
 */
export function useCompanionSocket(opts) {
  var serverUrl = opts.serverUrl;
  var initialPersona = opts.initialPersona || 'nadia';
  var autoConnect = opts.autoConnect !== false; // default true

  // ────────────────────────────────────────────────
  // XState machine — the source of truth for UI state.
  // We hold the snapshot + send fn from @xstate/react.
  // ────────────────────────────────────────────────
  var machineTuple = useMachine(livingAvatarMachine, {
    input: { personaId: initialPersona },
  });
  var snapshot = machineTuple[0];
  var send = machineTuple[1];

  // ────────────────────────────────────────────────
  // Underlying audio + mic + socket. None of these set state directly
  // for UI concerns — they go through the machine.
  // ────────────────────────────────────────────────
  var playback = useAudioPlaybackQueue();
  var socketRef = useRef(null);
  // We keep the speakingPersonaId in a ref synced from the machine context.
  var speakingPersonaIdRef = useRef(null);

  // Sequence id we last accepted from the server. Anything older = stale = drop.
  var lastAcceptedSeqRef = useRef(0);

  // Connected-state mirror. Lives in React state so consumers re-render
  // on (dis)connect. The socket event handlers (which run inside the
  // useEffect closure below) use connStateSetterRef to flip it without
  // creating a stale-closure problem.
  var connStateTuple = useState(false);
  var isConnected = connStateTuple[0];
  var setIsConnected = connStateTuple[1];
  var connStateSetterRef = useRef(setIsConnected);
  useEffect(function () { connStateSetterRef.current = setIsConnected; }, [setIsConnected]);

  // ────────────────────────────────────────────────
  // Microphone wiring. The onChunk callback base64-encodes each blob
  // and emits over the socket.
  // ────────────────────────────────────────────────
  var mic = useMicrophone({
    onChunk: function (blob, mimeType, isFirstChunk) {
      var socket = socketRef.current;
      if (!socket || !socket.connected) return;
      // Convert Blob → base64 (async via FileReader).
      var reader = new FileReader();
      reader.onload = function () {
        // result is "data:audio/webm;base64,XXXX". Strip the prefix.
        var dataUrl = reader.result;
        if (typeof dataUrl !== 'string') return;
        var commaIdx = dataUrl.indexOf(',');
        var base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
        var codec = mimeType.indexOf('opus') >= 0 ? 'opus' : 'pcm16';
        socket.emit('client.audio_chunk', buildMessage(MESSAGE_TYPES.CLIENT_AUDIO_CHUNK, {
          conversationId: snapshot.context.conversationId || '',
          personaId: snapshot.context.personaId,
          sequenceId: snapshot.context.sequenceId,
          payload: {
            audioBase64: base64,
            codec: codec,
            sampleRate: 16000,
            isFirstChunk: isFirstChunk,
          },
        }));
      };
      reader.readAsDataURL(blob);
    },
    onError: function (err) {
      send({ type: 'ERROR', message: 'mic: ' + (err && err.message) });
    },
  });

  // ────────────────────────────────────────────────
  // Socket lifecycle. Set up exactly once per (serverUrl, authToken) pair.
  // ────────────────────────────────────────────────
  useEffect(function () {
    if (!autoConnect || !serverUrl) return;

    var socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      auth: opts.authToken ? { token: opts.authToken } : undefined,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on('connect', function () {
      if (connStateSetterRef.current) connStateSetterRef.current(true);
    });

    socket.on('disconnect', function (reason) {
      if (connStateSetterRef.current) connStateSetterRef.current(false);
      // Don't toggle the machine to 'error' on every disconnect — the
      // socket auto-reconnects. We only surface errors that are fatal.
      if (reason === 'io server disconnect') {
        send({ type: 'ERROR', message: 'server closed the connection' });
      }
    });

    socket.on('connect_error', function (err) {
      console.warn('[companion-socket] connect_error:', err && err.message);
    });

    // ────────────────────────────────────────────────
    // SERVER → CLIENT event router. Each event MAYBE drops on staleness,
    // then mutates the playback queue and/or sends into the XState machine.
    // ────────────────────────────────────────────────
    function handleServerEvent(msg, mapToMachine) {
      // Wire-schema messages carry sequenceId. Drop anything older than
      // what we last accepted — that's the defense against zombie events
      // arriving after a barge-in.
      if (isStale(msg, lastAcceptedSeqRef.current)) return;
      if (typeof msg.sequenceId === 'number') {
        lastAcceptedSeqRef.current = msg.sequenceId;
      }
      mapToMachine(msg);
    }

    socket.on('server.stt_partial', function (msg) {
      handleServerEvent(msg, function (m) {
        send({ type: 'STT_PARTIAL', text: m.payload && m.payload.text });
      });
    });

    socket.on('server.stt_final', function (msg) {
      handleServerEvent(msg, function (m) {
        send({ type: 'STT_FINAL', text: m.payload && m.payload.text });
      });
    });

    socket.on('server.llm_partial', function (msg) {
      handleServerEvent(msg, function (m) {
        send({ type: 'LLM_PARTIAL', text: m.payload && m.payload.accumulated });
      });
    });

    socket.on('server.llm_final', function (msg) {
      handleServerEvent(msg, function (m) {
        send({ type: 'LLM_FINAL', text: m.payload && m.payload.text });
      });
    });

    socket.on('server.tts_chunk', function (msg) {
      if (isStale(msg, lastAcceptedSeqRef.current)) return;
      lastAcceptedSeqRef.current = msg.sequenceId;
      // Feed audio chunk into playback queue. The machine state will
      // already be 'speaking' by the time the first chunk arrives
      // (server emits avatar_state=speaking before tts_chunk #0).
      var payload = msg.payload;
      if (payload && payload.audioBase64) {
        playback.appendChunk(payload.audioBase64);
        // First-chunk side effect: fire the machine transition into
        // 'speaking' if it hasn't already.
        if (payload.chunkIndex === 0) {
          send({ type: 'TTS_FIRST_CHUNK' });
        }
      }
    });

    socket.on('server.tts_end', function (msg) {
      handleServerEvent(msg, function () {
        send({ type: 'TTS_END' });
      });
    });

    socket.on('server.avatar_state', function (msg) {
      // The server hints at state transitions — we let the machine make
      // the final call, but we use the persona id on the message to
      // populate speakingPersonaIdRef so LivingAvatar can route audio.
      if (isStale(msg, lastAcceptedSeqRef.current)) return;
      lastAcceptedSeqRef.current = msg.sequenceId;
      var state = msg.payload && msg.payload.state;
      if (state === 'speaking') {
        speakingPersonaIdRef.current = msg.personaId;
      } else if (state === 'idle' || state === 'interrupted') {
        speakingPersonaIdRef.current = null;
      }
    });

    socket.on('server.interrupted', function (msg) {
      // Server confirmed an interrupt landed. The client may have
      // initiated it (in which case we already flushed) or the server
      // detected VAD barge-in (in which case we need to flush now).
      if (typeof msg.sequenceId === 'number') {
        lastAcceptedSeqRef.current = msg.sequenceId;
      }
      // Hard flush — even if redundant, it's cheap and guarantees no
      // ghost audio. The "guarantee" is what Max wanted.
      playback.flush();
      send({ type: 'INTERRUPT' });
      // Once the machine settles, rebuild the MediaSource so the next
      // turn starts on a fresh pipeline. Defer with setTimeout so the
      // flush() effects have a tick to propagate.
      setTimeout(function () { playback.reset(); }, 50);
      speakingPersonaIdRef.current = null;
    });

    socket.on('server.error', function (msg) {
      var p = msg.payload || {};
      send({ type: 'ERROR', message: p.message || p.code || 'server error' });
    });

    socket.on('server.pong', function () { /* keepalive ack */ });

    // ────────────────────────────────────────────────
    // Cleanup. On unmount: disconnect socket, flush playback, stop mic.
    // Ordering matters: stop mic FIRST so no more chunks get emitted
    // after the socket disconnects.
    // ────────────────────────────────────────────────
    return function () {
      try { mic.stop(); } catch (_) {}
      try { playback.flush(); } catch (_) {}
      try { socket.disconnect(); } catch (_) {}
      socketRef.current = null;
    };
    // We intentionally include only the connection inputs in deps.
    // Re-connecting on every state change would be catastrophic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, opts.authToken, autoConnect]);

  // ────────────────────────────────────────────────
  // Heartbeat ping so server-side connection_idle logic has something
  // to count. Lightweight; every 25s matches server pingInterval.
  // ────────────────────────────────────────────────
  useEffect(function () {
    var id = setInterval(function () {
      var socket = socketRef.current;
      if (socket && socket.connected) {
        socket.emit('client.ping', buildMessage(MESSAGE_TYPES.CLIENT_PING, {
          conversationId: snapshot.context.conversationId || '',
          personaId: snapshot.context.personaId,
          sequenceId: snapshot.context.sequenceId,
          payload: {},
        }));
      }
    }, 25_000);
    return function () { clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ────────────────────────────────────────────────
  // Public actions
  // ────────────────────────────────────────────────

  /**
   * The "Start Conversation" button handler. Single user gesture that
   * unlocks audio playback, ensures the socket is connected, and starts
   * the mic. This must be the entry point — calling it from anywhere
   * other than a click/touch handler will fail the autoplay policy on
   * Safari.
   */
  var startConversation = useCallback(async function () {
    // 1. Unlock audio FIRST — must happen synchronously inside the
    //    user gesture. Doing it after await microphone start might
    //    push it outside the gesture window on Safari.
    await playback.unlock();
    // 2. Start the mic. This triggers the permission prompt on first call.
    await mic.start();
    // 3. Transition the machine to 'listening'. The server will start
    //    emitting STT partials as audio chunks arrive.
    send({ type: 'START_LISTEN' });
  }, [playback, mic, send]);

  var stopMic = useCallback(function () {
    mic.stop();
    var socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit('client.audio_end', buildMessage(MESSAGE_TYPES.CLIENT_AUDIO_END, {
        conversationId: snapshot.context.conversationId || '',
        personaId: snapshot.context.personaId,
        sequenceId: snapshot.context.sequenceId,
        payload: { totalChunks: 0, totalDurationMs: 0 },
      }));
    }
    send({ type: 'STOP_LISTEN' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic, send]);

  /**
   * Manual barge-in trigger. Fires from a "Stop" button OR from any
   * other client-side detection of "user wants to interrupt".
   *
   * Sequence here is critical and explicit (Max's guardrail #1):
   *   1. Send into the machine so React re-renders to 'interrupted'
   *   2. Flush the playback queue (kills zombie audio)
   *   3. Emit to server so it stops generating
   *   4. Reset playback pipeline for the next turn
   */
  var interrupt = useCallback(function (reason) {
    var r = reason || 'manual';
    send({ type: 'INTERRUPT' });
    playback.flush();
    var socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit('client.interrupt', buildMessage(MESSAGE_TYPES.CLIENT_INTERRUPT, {
        conversationId: snapshot.context.conversationId || '',
        personaId: snapshot.context.personaId,
        sequenceId: snapshot.context.sequenceId,
        payload: { reason: r },
      }));
    }
    speakingPersonaIdRef.current = null;
    setTimeout(function () { playback.reset(); }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback, send]);

  var switchPersona = useCallback(function (toPersona) {
    if (!toPersona || ['nadia', 'jenna', 'sara'].indexOf(toPersona) === -1) return;
    // Local: tell the machine. Implicit interrupt is part of the
    // machine's SWITCH_PERSONA handler — see avatar-machine.js.
    send({ type: 'SWITCH_PERSONA', toPersona: toPersona });
    // Server: flush playback + send the switch message.
    playback.flush();
    var socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit('client.persona_switch', buildMessage(MESSAGE_TYPES.CLIENT_PERSONA_SWITCH, {
        conversationId: snapshot.context.conversationId || '',
        personaId: snapshot.context.personaId,
        sequenceId: snapshot.context.sequenceId,
        payload: { toPersona: toPersona },
      }));
    }
    setTimeout(function () { playback.reset(); }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback, send]);

  var sendText = useCallback(function (text) {
    if (!text || !text.trim()) return;
    var socket = socketRef.current;
    if (!socket || !socket.connected) return;
    socket.emit('client.text_input', buildMessage(MESSAGE_TYPES.CLIENT_TEXT_INPUT, {
      conversationId: snapshot.context.conversationId || '',
      personaId: snapshot.context.personaId,
      sequenceId: snapshot.context.sequenceId,
      payload: { text: text.trim(), language: 'en' },
    }));
    send({ type: 'TEXT_INPUT', text: text.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send]);

  // ────────────────────────────────────────────────
  // Derived view-state. Snapshot once per render so consumers see a
  // consistent picture.
  // ────────────────────────────────────────────────
  var view = useMemo(function () {
    return {
      state: getDisplayState(snapshot),
      personaId: snapshot.context.personaId,
      transcript: snapshot.context.lastTranscript,
      responseText: snapshot.context.lastResponseText,
      sequenceId: snapshot.context.sequenceId,
    };
  }, [snapshot]);

  return {
    state: view.state,
    personaId: view.personaId,
    transcript: view.transcript,
    responseText: view.responseText,
    sequenceId: view.sequenceId,
    isConnected: isConnected,
    isUnlocked: playback.isUnlocked,
    error: playback.error || snapshot.context.errorMessage,
    speakingAudioElement: playback.audioElement,
    speakingPersonaId: view.state === 'speaking' ? speakingPersonaIdRef.current : null,
    startConversation: startConversation,
    stopMic: stopMic,
    interrupt: interrupt,
    switchPersona: switchPersona,
    sendText: sendText,
  };
}

// ────────────────────────────────────────────────
// End of public API. Implementation notes:
//
// Why pipe socket events through the XState machine instead of straight
// into React state? Because the machine encodes legal transitions. If
// the server sends `server.llm_partial` while the machine is in 'idle'
// (which would happen if we just barge-in'd and a stale message arrived
// faster than the sequenceId check could catch it), the machine ignores
// the event. With raw setState, we'd update React state to a nonsensical
// combination — "I'm idle, but I have streaming response text" — and the
// UI would render confusingly.
//
// The flush() → reset() pair on barge-in is intentional and ordered:
// flush is synchronous and stops audio NOW; reset rebuilds the
// MediaSource on a 50ms delay so the SourceBuffer's abort + remove
// have had time to settle. Doing both in the same tick can race on
// some browsers and leave the SourceBuffer in 'updating' state forever.
// ────────────────────────────────────────────────
