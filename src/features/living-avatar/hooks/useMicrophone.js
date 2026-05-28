// ============================================================
// useMicrophone — mic capture + chunked streaming
// ============================================================
// v55.83-A.6.27.72 HOTFIX 22.
//
// Wraps the browser's MediaRecorder + getUserMedia in a React hook
// that fires a callback every CHUNK_MS with the latest audio blob.
// The consumer (useCompanionSocket) base64-encodes each chunk and
// emits it to the server.
//
// Design choices:
//
//   - MediaRecorder over AudioWorklet:
//     MR gives us a self-contained encoder (browser-native opus) with
//     way less code. AudioWorklet would give finer-grained control and
//     access to raw PCM, but requires a separate worklet file, an
//     audio graph setup, and manual encoding. For the spec's requirements
//     (250ms chunks → server VAD), MR is sufficient.
//
//   - opus codec:
//     Deepgram natively accepts opus. Bandwidth is ~3-6x smaller than
//     equivalent PCM. Safari iOS supports opus in MediaRecorder as of
//     iOS 14.5; older devices fall back to mp4/aac which Deepgram also
//     accepts (server-side handles the codec hint).
//
//   - 250ms chunks:
//     Sweet spot. Smaller = more overhead per chunk and more event-loop
//     churn. Larger = laggier perceived latency for barge-in. Tunable
//     via CHUNK_MS constant if real-world testing wants different.
//
//   - Permission flow:
//     We request mic on hook initialization, not on first chunk. That
//     gives the consumer the chance to render a "grant permission" UI
//     before the user is mid-conversation.
//
// CLEANUP CONTRACT:
//   On unmount or stop(): MediaRecorder.stop() + every track.stop().
//   Forgetting to stop tracks leaves the browser's mic indicator on
//   forever — visually creepy and a real privacy issue.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

var CHUNK_MS = 250;

// Pick the best mime type the browser supports. Order matters — opus
// first because Deepgram handles it natively at lower bandwidth.
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  var candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4', // Safari fallback
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
  }
  return null;
}

/**
 * @param {Object} opts
 * @param {(chunk: Blob, mimeType: string, isFirstChunk: boolean) => void} opts.onChunk
 * @param {(err: Error) => void} [opts.onError]
 * @param {boolean} [opts.autoStart] — if true, start mic on mount. Default false (caller chooses).
 * @returns {{
 *   start: () => Promise<void>,
 *   stop: () => void,
 *   isRecording: boolean,
 *   isSupported: boolean,
 *   permissionDenied: boolean,
 *   error: string | null,
 *   mimeType: string | null
 * }}
 */
export function useMicrophone(opts) {
  var onChunkRef = useRef(opts.onChunk);
  var onErrorRef = useRef(opts.onError);
  useEffect(function () { onChunkRef.current = opts.onChunk; }, [opts.onChunk]);
  useEffect(function () { onErrorRef.current = opts.onError; }, [opts.onError]);

  var recordingState = useState(false);
  var isRecording = recordingState[0];
  var setIsRecording = recordingState[1];

  var deniedState = useState(false);
  var permissionDenied = deniedState[0];
  var setPermissionDenied = deniedState[1];

  var errorState = useState(null);
  var error = errorState[0];
  var setError = errorState[1];

  var streamRef = useRef(null);
  var recorderRef = useRef(null);
  var firstChunkSentRef = useRef(false);
  var mimeTypeRef = useRef(null);

  var isSupported = typeof MediaRecorder !== 'undefined' &&
                    typeof navigator !== 'undefined' &&
                    !!navigator.mediaDevices &&
                    !!navigator.mediaDevices.getUserMedia;

  var start = useCallback(async function () {
    if (!isSupported) {
      var msg = 'mic capture not supported in this browser';
      setError(msg);
      if (onErrorRef.current) onErrorRef.current(new Error(msg));
      return;
    }
    if (recorderRef.current) {
      // Already recording — idempotent.
      return;
    }

    setError(null);
    setPermissionDenied(false);
    firstChunkSentRef.current = false;

    try {
      // 16kHz mono is what speech recognizers prefer — saves bandwidth
      // without losing intelligibility. Browser may ignore exact values
      // and use device defaults; that's fine, Deepgram handles either.
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      var mime = pickMimeType();
      mimeTypeRef.current = mime;
      var recorderOpts = mime ? { mimeType: mime } : {};
      var recorder = new MediaRecorder(stream, recorderOpts);
      recorderRef.current = recorder;

      recorder.ondataavailable = function (ev) {
        if (!ev.data || ev.data.size === 0) return;
        if (!onChunkRef.current) return;
        var isFirst = !firstChunkSentRef.current;
        firstChunkSentRef.current = true;
        try {
          onChunkRef.current(ev.data, mime || ev.data.type || 'audio/webm', isFirst);
        } catch (cbErr) {
          // Don't let the consumer's handler crash the recorder.
          console.warn('[mic] onChunk threw:', cbErr && cbErr.message);
        }
      };

      recorder.onerror = function (ev) {
        var err = (ev && ev.error) || new Error('MediaRecorder error');
        setError(String(err.message || err));
        if (onErrorRef.current) onErrorRef.current(err);
      };

      recorder.onstop = function () {
        setIsRecording(false);
      };

      recorder.start(CHUNK_MS);
      setIsRecording(true);
    } catch (err) {
      // NotAllowedError = user denied permission. SecurityError = insecure context.
      var name = (err && err.name) || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setPermissionDenied(true);
      }
      setError(String((err && err.message) || err));
      if (onErrorRef.current) onErrorRef.current(err);
      // Clean up any partial stream we managed to grab.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
        streamRef.current = null;
      }
    }
  }, [isSupported]);

  var stop = useCallback(function () {
    var recorder = recorderRef.current;
    var stream = streamRef.current;
    recorderRef.current = null;
    streamRef.current = null;

    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch (_) {}
    }
    if (stream) {
      // Stopping individual tracks is what kills the browser's mic indicator.
      // recorder.stop() alone does NOT release the stream.
      stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
    }
    setIsRecording(false);
  }, []);

  // ────────────────────────────────────────────────
  // Cleanup on unmount. Critical — leaked tracks = mic indicator stays on.
  // ────────────────────────────────────────────────
  useEffect(function () {
    return function () {
      stop();
    };
    // We intentionally omit `stop` from deps — useCallback already gives
    // a stable identity, and including it would re-run the effect needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ────────────────────────────────────────────────
  // Optional auto-start. Off by default — most consumers will want to
  // gate this behind a user gesture (button click) so the browser doesn't
  // block the permission prompt.
  // ────────────────────────────────────────────────
  useEffect(function () {
    if (opts.autoStart) {
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.autoStart]);

  return {
    start: start,
    stop: stop,
    isRecording: isRecording,
    isSupported: isSupported,
    permissionDenied: permissionDenied,
    error: error,
    mimeType: mimeTypeRef.current,
  };
}
