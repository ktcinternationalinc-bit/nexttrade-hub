// ============================================================
// useMouthSync — audio-reactive mouth shape hook
// ============================================================
// v55.83-A.6.27.72 HOTFIX 18.
//
// PRIMARY PATH:
//   Connect the speaking <audio> element to a Web Audio API analyser.
//   Each animation frame, average frequency-bin amplitude → bucket into
//   one of four shapes: closed / small / medium / wide. Hand the shape
//   to whoever called the hook (a setter prop) so the SVG / image layer
//   can render the right mouth.
//
// FALLBACK PATH:
//   If Web Audio isn't available OR createMediaElementSource throws
//   (Safari iOS sometimes fails on re-used elements), fall back to a
//   simple timed loop: oscillate small ↔ medium ↔ wide every ~120ms
//   while the audio element is playing. Less accurate but never zero.
//
// CLEANUP CONTRACT:
//   On unmount, on speaking=false, on persona switch — the hook MUST:
//     - cancelAnimationFrame the ticker
//     - disconnect the analyser source
//     - clear any timed fallback intervals
//     - reset mouth to 'closed'
//   No exceptions. Stuck-mouth bugs all trace back to skipped cleanup.
// ============================================================

import { useEffect, useRef } from 'react';

/**
 * @typedef {'closed'|'small'|'medium'|'wide'} MouthShape
 */

/**
 * @param {Object} params
 * @param {HTMLAudioElement|null} params.audioElement   The currently-playing TTS <audio>.
 * @param {boolean}               params.speaking       True while the avatar should appear to talk.
 * @param {(shape: MouthShape, level: number) => void} params.onShape   Receives shape + raw 0..1 level.
 * @returns {void}
 */
export function useMouthSync(params) {
  var audioElement = params.audioElement;
  var speaking = params.speaking;
  var onShape = params.onShape;

  // Refs survive re-renders. We use them to hold mutable analyser state
  // without triggering React updates.
  var audioCtxRef = useRef(null);
  var sourceRef   = useRef(null);
  var analyserRef = useRef(null);
  var rafRef      = useRef(null);
  var fallbackTimerRef = useRef(null);
  var onShapeRef  = useRef(onShape);

  // Keep a live ref to onShape so closure inside RAF doesn't go stale.
  useEffect(function () { onShapeRef.current = onShape; }, [onShape]);

  useEffect(function () {
    // ────────────────────────────────────────────────
    // Tear down any prior wiring before doing anything.
    // This runs both on speaking=false and on element swap.
    // ────────────────────────────────────────────────
    function cleanup() {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (fallbackTimerRef.current) {
        clearInterval(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch (e) {}
        sourceRef.current = null;
      }
      // Note: we DON'T close audioCtxRef here — closing it makes it
      // impossible to reuse for the next utterance. Just disconnect.
      if (onShapeRef.current) onShapeRef.current('closed', 0);
    }

    if (!speaking || !audioElement) {
      cleanup();
      return cleanup;
    }

    // ────────────────────────────────────────────────
    // PRIMARY PATH — Web Audio analyser.
    // ────────────────────────────────────────────────
    var AC = (typeof window !== 'undefined') &&
             (window.AudioContext || window.webkitAudioContext);
    if (!AC) {
      // No Web Audio at all — go straight to timed fallback.
      startTimedFallback();
      return cleanup;
    }

    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AC();
      }
      var ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(function () {});
      }

      // createMediaElementSource throws if the same element was already
      // wired in a previous mount. We disconnect aggressively in cleanup
      // but Safari iOS sometimes still complains — catch and fall back.
      var source = ctx.createMediaElementSource(audioElement);
      sourceRef.current = source;
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      analyserRef.current = analyser;
      source.connect(analyser);
      analyser.connect(ctx.destination);

      var data = new Uint8Array(analyser.frequencyBinCount);
      function tick() {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(data);
        // Speech fundamentals live in bins 2-16 (~85-700Hz region) on a
        // 256-bin FFT @ 44.1kHz. Averaging that band is more responsive
        // to vowel openness than averaging the whole spectrum.
        var sum = 0; var count = 0;
        for (var i = 2; i < 16; i++) { sum += data[i]; count++; }
        var avg = count > 0 ? (sum / count) / 255 : 0;
        // Boost low-end, ease curve so quiet phonemes don't read as silence.
        var level = Math.min(1, Math.pow(avg * 1.4, 0.7));
        var shape = bucketize(level);
        if (onShapeRef.current) onShapeRef.current(shape, level);
        rafRef.current = requestAnimationFrame(tick);
      }
      tick();
    } catch (e) {
      // Source already in use, or Web Audio refused — fall back gracefully.
      console.warn('[useMouthSync] analyser failed, using timed fallback:', e && e.message);
      startTimedFallback();
    }

    // ────────────────────────────────────────────────
    // FALLBACK — timed oscillation while audio plays.
    // ────────────────────────────────────────────────
    function startTimedFallback() {
      var shapes = ['small', 'medium', 'wide', 'medium', 'small', 'medium'];
      var i = 0;
      fallbackTimerRef.current = setInterval(function () {
        if (!audioElement || audioElement.paused || audioElement.ended) {
          if (onShapeRef.current) onShapeRef.current('closed', 0);
          return;
        }
        var s = shapes[i % shapes.length];
        i++;
        if (onShapeRef.current) onShapeRef.current(s, 0.5);
      }, 120);
    }

    return cleanup;
  }, [speaking, audioElement]);
}

/**
 * @param {number} level — 0..1 audio amplitude
 * @returns {MouthShape}
 */
function bucketize(level) {
  if (level < 0.05) return 'closed';
  if (level < 0.18) return 'small';
  if (level < 0.38) return 'medium';
  return 'wide';
}
