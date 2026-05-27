// ============================================================
// socket-handler.js — Socket.io connection + event routing
// ============================================================
// Each connected client gets its own Orchestrator instance. The
// Orchestrator owns:
//   - One Deepgram streaming connection (mic ingest)
//   - At most one in-flight Claude stream (LLM tokens)
//   - At most one in-flight ElevenLabs stream (audio out)
//   - A monotonic sequenceId for stale-message rejection
//
// "Room" model:
//   We don't actually use multi-client rooms. Each socket joins ITS OWN
//   room named after socket.id so the orchestrator can broadcast to that
//   single client without leaking across sessions. This keeps the surface
//   compatible with future features (e.g. "supervisor listens in") without
//   forcing that complexity now.
// ============================================================

import { Orchestrator } from './orchestrator.js';

/**
 * Wire all socket events to the orchestrator.
 * @param {import('socket.io').Server} io
 */
export function attachSocketHandlers(io) {
  io.on('connection', (socket) => {
    const room = `session:${socket.id}`;
    socket.join(room);
    console.log(`[socket] connected sid=${socket.id} ip=${socket.handshake.address}`);

    // Each socket owns one orchestrator. When the socket dies, so does its pipeline.
    const orchestrator = new Orchestrator({
      emit: (eventName, payload) => {
        // We emit to the room (not socket directly) so future listeners can join.
        io.to(room).emit(eventName, payload);
      },
      logTag: `sid=${socket.id.slice(0, 8)}`,
    });

    // ────────────────────────────────────────────────
    // CLIENT → SERVER events. These mirror the wire-schema enum from
    // /src/features/living-avatar/lib/wire-schema.js so the client side
    // can speak the same language without translation.
    // ────────────────────────────────────────────────

    socket.on('client.audio_chunk', (msg) => {
      // msg: { conversationId, personaId, sequenceId, payload: { audioBase64, codec, sampleRate, isFirstChunk } }
      try {
        orchestrator.handleAudioChunk(msg);
      } catch (err) {
        console.error('[socket] audio_chunk error:', err);
        socket.emit('server.error', { code: 'audio_chunk_failed', message: String(err && err.message), fatal: false });
      }
    });

    socket.on('client.audio_end', (msg) => {
      try {
        orchestrator.handleAudioEnd(msg);
      } catch (err) {
        console.error('[socket] audio_end error:', err);
      }
    });

    socket.on('client.interrupt', (msg) => {
      // Manual interrupt from the client (button press, "stop" keyword detected
      // client-side, or persona switch). Deepgram-detected speech-while-speaking
      // is handled inside the orchestrator separately — see Orchestrator.onSpeechStarted.
      console.log(`[socket] interrupt sid=${socket.id} reason=${msg?.payload?.reason}`);
      orchestrator.interrupt({ reason: (msg && msg.payload && msg.payload.reason) || 'manual' });
    });

    socket.on('client.persona_switch', (msg) => {
      // Persona switch is an implicit interrupt + identity change.
      const to = msg && msg.payload && msg.payload.toPersona;
      if (!to || !['nadia', 'jenna', 'sara'].includes(to)) {
        socket.emit('server.error', { code: 'bad_persona', message: 'unknown personaId', fatal: false });
        return;
      }
      orchestrator.switchPersona(to);
    });

    socket.on('client.text_input', (msg) => {
      // Typed message — skip STT, feed Claude directly.
      try {
        orchestrator.handleTextInput(msg);
      } catch (err) {
        console.error('[socket] text_input error:', err);
      }
    });

    socket.on('client.ping', () => {
      socket.emit('server.pong', { timestamp: Date.now() });
    });

    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnect sid=${socket.id} reason=${reason}`);
      // Tear down everything the orchestrator owns. This must be idempotent
      // and never throw — disconnect handlers that throw cause socket.io
      // to log scary errors and can mask the real disconnect cause.
      try {
        orchestrator.dispose();
      } catch (err) {
        console.error('[socket] dispose error (non-fatal):', err);
      }
    });
  });

  io.engine.on('connection_error', (err) => {
    // Surface low-level handshake failures (bad origin, transport mismatch, etc).
    console.warn('[socket] connection_error:', err.code, err.message);
  });
}
