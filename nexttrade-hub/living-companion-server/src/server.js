// ============================================================
// Living Companion Server — entrypoint
// ============================================================
// Standalone Node service that owns the real-time voice pipeline.
// Lives outside the Next.js Vercel deployment (Vercel kills long-lived
// websockets). Deploy target: Railway or Render.
//
// Responsibilities:
//   1. Health check endpoint for the platform's uptime probe
//   2. Socket.io server with strict CORS origin allowlist
//   3. Per-connection orchestrator that pipes mic → STT → LLM → TTS → client
//   4. Graceful shutdown so in-flight audio doesn't get cut mid-word on deploy
//
// What this file does NOT do:
//   - serve any HTML, static assets, or Next.js routes (those stay on Vercel)
//   - keep any cross-session state (each socket is independent;
//     conversation history lives on the client + Supabase, not here)
// ============================================================

import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';

import { attachSocketHandlers } from './socket-handler.js';

const PORT = Number(process.env.PORT) || 3001;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ────────────────────────────────────────────────
// Sanity-check provider keys at boot. We refuse to start if a required
// key is missing — it's better to fail loudly here than to have the user
// click a microphone button and get an unhelpful 500 from an internal stream.
// ────────────────────────────────────────────────
const REQUIRED_ENV = [
  'DEEPGRAM_API_KEY',
  'ANTHROPIC_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_NADIA',
  'ELEVENLABS_VOICE_JENNA',
  'ELEVENLABS_VOICE_SARA',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k] || process.env[k].startsWith('__'));
if (missing.length > 0) {
  console.error('[boot] missing required env vars: ' + missing.join(', '));
  console.error('[boot] set these in your Railway/Render dashboard, or in .env for local dev');
  process.exit(1);
}

// ────────────────────────────────────────────────
// Express app — only used for health/diagnostic HTTP routes.
// All real work happens over Socket.io.
// ────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.disable('x-powered-by');

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    version: '0.1.0',
  });
});

// Catch-all so accidental browser traffic doesn't dump a stack trace.
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', hint: 'this server speaks Socket.io, not HTTP' });
});

const httpServer = http.createServer(app);

// ────────────────────────────────────────────────
// Socket.io server. The exposed surface is intentionally narrow:
// the client emits a handful of well-typed events, the server emits
// stream chunks back. State lives on the client's XState machine —
// the server is a thin orchestrator.
// ────────────────────────────────────────────────
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
  // Match the client's wire-schema sequenceId pattern: each socket gets
  // its own room for cross-tab isolation if a user has the portal open
  // in multiple tabs. Default config is fine for everything else.
  pingInterval: 25000,
  pingTimeout: 60000,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e7, // 10 MB — large enough for any single audio chunk
});

attachSocketHandlers(io);

// ────────────────────────────────────────────────
// Graceful shutdown — important for Railway/Render which sends SIGTERM
// during deploys. We give in-flight conversations 10 seconds to drain
// before forcing the socket closed.
// ────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`[shutdown] received ${signal} — closing connections`);
  io.close(() => {
    console.log('[shutdown] socket.io closed');
    httpServer.close(() => {
      console.log('[shutdown] http server closed — exiting');
      process.exit(0);
    });
  });
  // Hard kill if graceful close takes too long.
  setTimeout(() => {
    console.warn('[shutdown] force-exit after 10s grace period');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Crash-loop protection: log unhandled rejections so Railway/Render show
// the real reason a process died instead of just "container exited".
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception:', err);
  // Don't exit — Socket.io should keep going; the bad call already failed.
});

httpServer.listen(PORT, () => {
  console.log(`[boot] living companion server listening on :${PORT}`);
  console.log(`[boot] CORS allowlist: ${ALLOWED_ORIGINS.join(', ')}`);
});
