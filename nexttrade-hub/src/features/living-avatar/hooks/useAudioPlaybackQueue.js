// ============================================================
// audio-playback-queue — seamless MP3 chunk playback via MediaSource
// ============================================================
// v55.83-A.6.27.72 HOTFIX 22.
//
// Stitches incoming MP3 audio chunks into a continuous, seamless playback
// stream by feeding them into a MediaSource SourceBuffer attached to a
// hidden <audio> element. The hook returns the <audio> element so
// useMouthSync (which expects an HTMLAudioElement) can analyse it
// directly — no second audio plumbing needed.
//
// Why MediaSource + a real <audio> element instead of decodeAudioData +
// AudioBufferSourceNode?
//
//   1. MP3 chunks can't be reliably decoded one-at-a-time with
//      decodeAudioData — most decoders need the whole frame structure
//      and choke on partial frames. MediaSource was designed exactly for
//      this case (DASH/HLS streaming).
//
//   2. useMouthSync already speaks HTMLAudioElement (it does the
//      createMediaElementSource → analyser dance). Reusing that contract
//      means zero changes to the mouth animation code we already shipped
//      in HOTFIX 18.
//
//   3. The Web Audio context tied to a media element handles all the
//      buffering, timing, and gapless playback for us — fighting MP3
//      seams in userland is a losing battle.
//
// CRITICAL — barge-in / "zombie audio" prevention (Max guardrail #1):
//
//   When abort() is called, we must do ALL of these:
//     a) recorder.abort() on the SourceBuffer to cancel in-flight append
//     b) sourceBuffer.remove(0, audio.duration) to wipe queued bytes
//     c) audio.pause() to stop playback NOW
//     d) audio.currentTime = audio.duration (jump past everything)
//     e) Drop any queued chunks waiting for SourceBuffer to become idle
//
//   Skipping any of (a)-(e) means a few hundred ms of "ghost speech"
//   plays the next time the avatar opens her mouth. The combined effect
//   feels haunted. We don't want haunted.
//
// CRITICAL — autoplay policy (Max guardrail #2):
//
//   Browsers block <audio>.play() unless it was triggered by a user
//   gesture. The caller MUST call `unlock()` (or `play()`) at least once
//   from a click/touch handler before any audio arrives. The hook exposes
//   `isUnlocked` so the consumer can render a "Start Conversation"
//   button until that's done.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

var DEFAULT_MIME = 'audio/mpeg';

/**
 * @returns {{
 *   audioElement: HTMLAudioElement | null,
 *   isReady: boolean,             // MediaSource open and ready to receive chunks
 *   isUnlocked: boolean,          // user gesture happened; <audio>.play() will work
 *   isPlaying: boolean,
 *   unlock: () => Promise<void>,  // call from a user gesture (e.g. button click)
 *   appendChunk: (base64: string) => void,
 *   flush: () => void,            // hard cancel: clear buffer + stop playback (barge-in)
 *   reset: () => void,            // rebuild the MediaSource from scratch
 *   error: string | null
 * }}
 */
export function useAudioPlaybackQueue() {
  // ────────────────────────────────────────────────
  // State exposed to consumers.
  // ────────────────────────────────────────────────
  var readyState = useState(false);
  var isReady = readyState[0];
  var setIsReady = readyState[1];

  var unlockedState = useState(false);
  var isUnlocked = unlockedState[0];
  var setIsUnlocked = unlockedState[1];

  var playingState = useState(false);
  var isPlaying = playingState[0];
  var setIsPlaying = playingState[1];

  var errorState = useState(null);
  var error = errorState[0];
  var setError = errorState[1];

  // ────────────────────────────────────────────────
  // Refs hold the mutable audio plumbing. We don't want React to re-render
  // every time a chunk lands — that would be 4-10 renders per second of
  // speech, none of which carry useful state.
  // ────────────────────────────────────────────────
  var audioRef = useRef(null);              // HTMLAudioElement
  var mediaSourceRef = useRef(null);        // MediaSource
  var sourceBufferRef = useRef(null);       // SourceBuffer
  var pendingChunksRef = useRef([]);        // ArrayBuffers waiting for SourceBuffer to be idle
  var disposedRef = useRef(false);
  var aborted = useRef(false);              // True between flush() and reset() — drops new chunks

  // ────────────────────────────────────────────────
  // Initialize the <audio> element + MediaSource on first mount.
  // We re-build on reset() so a barge-in can guarantee a fresh buffer.
  // ────────────────────────────────────────────────
  var buildPipeline = useCallback(function () {
    if (disposedRef.current) return;
    if (typeof window === 'undefined' || typeof MediaSource === 'undefined') {
      setError('MediaSource not supported in this browser');
      return;
    }
    if (!MediaSource.isTypeSupported(DEFAULT_MIME)) {
      setError('audio/mpeg not supported by MediaSource on this browser');
      return;
    }

    // Tear down any prior pipeline before building a new one. We don't
    // share state across rebuilds — each turn gets a fresh MediaSource.
    teardownPipelineInternal();

    var audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = 'auto';
      // No autoplay — caller must call unlock() from a user gesture.
      audio.autoplay = false;
      // Hide from a11y tree; this is plumbing, not UI.
      audio.setAttribute('aria-hidden', 'true');
      audio.onplay = function () { setIsPlaying(true); };
      audio.onpause = function () { setIsPlaying(false); };
      audio.onended = function () { setIsPlaying(false); };
      audio.onerror = function () {
        setError('audio element error: ' + ((audio.error && audio.error.message) || 'unknown'));
      };
      audioRef.current = audio;
    }

    var ms = new MediaSource();
    mediaSourceRef.current = ms;
    audio.src = URL.createObjectURL(ms);

    ms.addEventListener('sourceopen', function () {
      if (disposedRef.current || aborted.current) return;
      try {
        var sb = ms.addSourceBuffer(DEFAULT_MIME);
        sb.mode = 'sequence'; // chunks are timestamped sequentially, not at original offsets
        sourceBufferRef.current = sb;

        sb.addEventListener('updateend', function () {
          // When the buffer finishes appending, drain anything queued.
          drainPending();
        });

        sb.addEventListener('error', function (e) {
          console.warn('[audio-queue] source buffer error:', e);
        });

        setIsReady(true);
        // If chunks arrived before sourceopen fired, drain them now.
        drainPending();
      } catch (err) {
        setError('addSourceBuffer failed: ' + (err && err.message));
      }
    });

    aborted.current = false;
  }, []);

  function teardownPipelineInternal() {
    var sb = sourceBufferRef.current;
    var ms = mediaSourceRef.current;
    sourceBufferRef.current = null;
    mediaSourceRef.current = null;
    pendingChunksRef.current = [];
    setIsReady(false);

    if (sb) {
      try { if (sb.updating) sb.abort(); } catch (_) {}
    }
    if (ms) {
      try {
        if (ms.readyState === 'open') ms.endOfStream();
      } catch (_) {}
    }
    // We DO NOT null out audioRef.current here — we want the same
    // HTMLAudioElement instance to persist across MediaSource rebuilds
    // so useMouthSync's createMediaElementSource binding stays valid.
    // (Calling createMediaElementSource twice on the same element throws.)
  }

  // ────────────────────────────────────────────────
  // Drain pending chunks into the SourceBuffer when it's idle.
  // SourceBuffer can only accept appendBuffer when updating === false.
  // We queue chunks in a ref array and feed them one at a time.
  // ────────────────────────────────────────────────
  function drainPending() {
    if (disposedRef.current || aborted.current) return;
    var sb = sourceBufferRef.current;
    if (!sb || sb.updating) return;
    var next = pendingChunksRef.current.shift();
    if (!next) return;
    try {
      sb.appendBuffer(next);
    } catch (err) {
      // QuotaExceededError: buffer full. Evict old data and retry.
      if (err && err.name === 'QuotaExceededError') {
        try {
          var audio = audioRef.current;
          var keepFrom = Math.max(0, (audio && audio.currentTime || 0) - 1);
          sb.remove(0, keepFrom);
          // Push the chunk back to the front of the queue; we'll retry
          // on the next updateend.
          pendingChunksRef.current.unshift(next);
        } catch (e2) {
          console.warn('[audio-queue] eviction failed:', e2 && e2.message);
        }
      } else {
        console.warn('[audio-queue] appendBuffer failed:', err && err.message);
      }
    }
  }

  // ────────────────────────────────────────────────
  // Decode base64 → ArrayBuffer (server sends chunks as base64 strings).
  // We do this synchronously; the chunks are small (< 100KB typically).
  // ────────────────────────────────────────────────
  function base64ToArrayBuffer(b64) {
    var binary = atob(b64);
    var len = binary.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // ────────────────────────────────────────────────
  // Public: unlock the audio context via a user gesture.
  // Browsers (Safari especially) require an HTMLAudioElement.play() call
  // that originates from a click/touch handler before any audio is allowed.
  // We play a single silent frame to satisfy the gesture requirement.
  // ────────────────────────────────────────────────
  var unlock = useCallback(async function () {
    if (isUnlocked) return;
    var audio = audioRef.current;
    if (!audio) {
      // Build the pipeline if it hasn't happened yet.
      buildPipeline();
      audio = audioRef.current;
    }
    if (!audio) {
      setError('unlock failed — audio element not initialized');
      return;
    }
    try {
      // play() returns a promise that rejects if autoplay is blocked.
      // Calling it from a user gesture grants the permission.
      // The MediaSource is empty so playback ends immediately — but the
      // browser's autoplay flag flips, so subsequent .play() calls work.
      var p = audio.play();
      if (p && typeof p.then === 'function') {
        await p.catch(function () { /* expected: no data yet */ });
      }
      // Now pause — we don't want to be "playing" silence in a loop.
      audio.pause();
      setIsUnlocked(true);
    } catch (err) {
      setError('unlock failed: ' + (err && err.message));
    }
  }, [isUnlocked, buildPipeline]);

  // ────────────────────────────────────────────────
  // Public: append a base64 audio chunk to the queue.
  // ────────────────────────────────────────────────
  var appendChunk = useCallback(function (base64) {
    if (disposedRef.current || aborted.current) return;
    if (!base64) return;
    var sb = sourceBufferRef.current;
    var buf = base64ToArrayBuffer(base64);
    if (!sb || sb.updating) {
      pendingChunksRef.current.push(buf);
      return;
    }
    try {
      sb.appendBuffer(buf);
    } catch (err) {
      // Fall back to queue + retry on updateend.
      pendingChunksRef.current.push(buf);
    }
    // Auto-play once we have data — but only if unlock() has been called.
    var audio = audioRef.current;
    if (audio && audio.paused && isUnlocked) {
      audio.play().catch(function () { /* swallow — paused state will retry */ });
    }
  }, [isUnlocked]);

  // ────────────────────────────────────────────────
  // Public: FLUSH — the barge-in path. Implements Max's guardrail (a)-(e).
  // ────────────────────────────────────────────────
  var flush = useCallback(function () {
    aborted.current = true;
    pendingChunksRef.current = [];     // (e) drop queued chunks

    var sb = sourceBufferRef.current;
    var audio = audioRef.current;

    if (sb) {
      try {
        if (sb.updating) sb.abort();    // (a) cancel in-flight append
      } catch (_) {}
      try {
        // (b) wipe all buffered bytes. We use audio.duration not Infinity
        // because remove() on an Infinity-end range can throw on some engines.
        if (audio && isFinite(audio.duration) && audio.duration > 0) {
          sb.remove(0, audio.duration);
        }
      } catch (_) {}
    }

    if (audio) {
      try { audio.pause(); } catch (_) {}                    // (c) stop NOW
      try {
        if (isFinite(audio.duration)) {
          audio.currentTime = audio.duration;                // (d) jump past everything
        }
      } catch (_) {}
    }
    setIsPlaying(false);
  }, []);

  // ────────────────────────────────────────────────
  // Public: RESET — rebuild MediaSource from scratch for the next turn.
  // Called AFTER flush() once we're ready to receive fresh audio.
  // ────────────────────────────────────────────────
  var reset = useCallback(function () {
    buildPipeline();
  }, [buildPipeline]);

  // ────────────────────────────────────────────────
  // First mount: build pipeline. Cleanup on unmount: tear it down +
  // revoke the object URL so we don't leak Blob URLs.
  // ────────────────────────────────────────────────
  useEffect(function () {
    buildPipeline();
    return function () {
      disposedRef.current = true;
      teardownPipelineInternal();
      var audio = audioRef.current;
      if (audio) {
        try { audio.pause(); } catch (_) {}
        try {
          if (audio.src) URL.revokeObjectURL(audio.src);
        } catch (_) {}
        audio.src = '';
      }
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    audioElement: audioRef.current,
    isReady: isReady,
    isUnlocked: isUnlocked,
    isPlaying: isPlaying,
    unlock: unlock,
    appendChunk: appendChunk,
    flush: flush,
    reset: reset,
    error: error,
  };
}
