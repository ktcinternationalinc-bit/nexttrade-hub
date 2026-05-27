// ============================================================
// providers/claude-client.js — Claude streaming (Anthropic SDK)
// ============================================================
// Streams Claude tokens AND surfaces them as they arrive. The orchestrator
// pipes these tokens into the ElevenLabs WebSocket so audio generation
// can start before the full sentence is written — that's how we get
// sub-second perceived latency.
//
// CRITICAL: this returns an AsyncIterable. The orchestrator MUST be able
// to break out of the iteration immediately when barge-in fires. We
// achieve this by passing an AbortSignal into the SDK call — Anthropic's
// stream rejects with AbortError, which the orchestrator catches.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

/**
 * @param {Object} opts
 * @param {string} opts.systemPrompt       — persona-specific system prompt
 * @param {{role: 'user'|'assistant', content: string}[]} opts.history
 * @param {string} opts.userMessage
 * @param {AbortSignal} opts.signal        — barge-in cancellation
 * @returns {AsyncGenerator<string, void>}  yields token deltas as they arrive
 */
export async function* streamClaudeTokens(opts) {
  // The Anthropic SDK has two streaming APIs. We use the lower-level
  // `messages.stream()` because we need precise control over the event
  // loop — `messages.create({ stream: true })` also works but the iterator
  // ergonomics are slightly noisier.
  const stream = anthropic.messages.stream(
    {
      model: MODEL,
      max_tokens: 1024,
      system: opts.systemPrompt,
      messages: [
        ...(opts.history || []),
        { role: 'user', content: opts.userMessage },
      ],
    },
    {
      // SDK respects AbortSignal — when the orchestrator fires abort(),
      // the underlying fetch is cancelled and `for await` throws AbortError.
      signal: opts.signal,
    }
  );

  try {
    for await (const event of stream) {
      // Event shapes per Anthropic SDK:
      //   content_block_delta → { delta: { type: 'text_delta', text: '...' } }
      //   message_delta       → stop reason, usage info (ignore for streaming)
      //   message_stop        → end marker
      if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
        const text = event.delta.text;
        if (text) yield text;
      }
    }
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'ERR_ABORTED')) {
      // Expected on barge-in. Re-throw so the orchestrator's try/catch
      // can clean up ElevenLabs in the same code path.
      throw err;
    }
    console.error('[claude] stream error:', err);
    throw err;
  }
}
