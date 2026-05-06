// ============================================================
// NadiaFace — Illustrated portrait avatar for the Nadia assistant
//
// S18.3 (Apr 23 2026) — Max asked for "a beautiful image of Nadia who
// is talking instead of this circle thing". Rewrote from an abstract
// circular face to a proper stylized human portrait: oval face,
// flowing hair, eyes with eyelashes and irises, full lips that
// animate with real audio, subtle eyebrows, rosy cheeks.
//
// Everything is still pure inline SVG — no external image files,
// no third-party services, no license concerns. The avatar is
// fully controlled by React state so it responds instantly to:
//   speaking  — lips animate driven by real audio analysis
//   listening — soft pulse around the portrait
//   loading   — subtle thinking-dots beneath
//   idle      — periodic natural blinks
//
// Zero external deps.
// ============================================================

import { useEffect, useRef, useState } from 'react';

export default function NadiaFace({
  speaking = false,
  listening = false,
  loading = false,
  color = '#10b981',
  size = 160,
  audioElement = null,
  lang = 'en',
}) {
  var [blink, setBlink] = useState(false);
  var [mouthOpen, setMouthOpen] = useState(0);
  var [lookDir, setLookDir] = useState(0);
  var rafRef = useRef(null);
  var analyserRef = useRef(null);
  var audioCtxRef = useRef(null);
  var sourceRef = useRef(null);

  useEffect(function() {
    if (speaking) return;
    var t = setInterval(function() {
      setBlink(true);
      setTimeout(function() { setBlink(false); }, 140);
    }, 3200 + Math.random() * 2600);
    return function() { clearInterval(t); };
  }, [speaking]);

  useEffect(function() {
    if (!listening) { setLookDir(0); return; }
    var t = setInterval(function() {
      setLookDir((Math.random() - 0.5) * 1.4);
    }, 1800 + Math.random() * 1400);
    return function() { clearInterval(t); };
  }, [listening]);

  // S22.2 (Apr 23 2026) — Root cause of browser crashes on dashboard:
  // every TTS playback creates a new <audio> element. Every time `speaking`
  // flipped, this effect re-ran. The old code could leave:
  //   - multiple analyser nodes connected to one AudioContext destination
  //   - stale RAF loops calling setMouthOpen() forever
  //   - InvalidStateError swallowed silently, producing zombie state
  // After 10-20 messages, the browser ran out of resources and crashed.
  //
  // New implementation: every run disconnects the previous source before
  // attempting anything new. One analyser at a time. Cleanup always
  // cancels the RAF, even when the try block threw.
  useEffect(function() {
    var cancelled = false;
    var localRaf = 0;

    if (!speaking) {
      setMouthOpen(0);
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      return;
    }

    // Tear down any prior source/analyser before wiring up a new one.
    var disconnectPrior = function() {
      try { if (sourceRef.current && sourceRef.current.disconnect) sourceRef.current.disconnect(); } catch (_) {}
      try { if (analyserRef.current && analyserRef.current.disconnect) analyserRef.current.disconnect(); } catch (_) {}
      sourceRef.current = null;
      analyserRef.current = null;
    };

    var startFallback = function() {
      var lastUpdate = 0;
      var target = 0.2;
      var step = function(ts) {
        if (cancelled) return;
        if (ts - lastUpdate > 110) {
          target = 0.12 + Math.random() * 0.7;
          lastUpdate = ts;
        }
        setMouthOpen(function(prev) { return prev + (target - prev) * 0.35; });
        localRaf = requestAnimationFrame(step);
        rafRef.current = localRaf;
      };
      localRaf = requestAnimationFrame(step);
      rafRef.current = localRaf;
    };

    // Try real audio analysis first; fall through to fallback on any error.
    var tried = false;
    if (audioElement && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        var ctx = audioCtxRef.current || new Ctx();
        audioCtxRef.current = ctx;

        disconnectPrior();

        // createMediaElementSource throws if already called on this element.
        // We gate with a marker so even across NadiaFace remounts we're safe.
        if (!audioElement.__nadiaHooked) {
          var src = ctx.createMediaElementSource(audioElement);
          src.audioElement = audioElement;
          audioElement.__nadiaHooked = true;
          var analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
          analyser.connect(ctx.destination);
          sourceRef.current = src;
          analyserRef.current = analyser;
        }

        // If this element was already hooked by a PREVIOUS NadiaFace mount,
        // we can't get its analyser back — use fallback animation.
        if (!analyserRef.current) {
          tried = false;
        } else {
          var buf = new Uint8Array(analyserRef.current.frequencyBinCount);
          var loop = function() {
            if (cancelled) return;
            if (!analyserRef.current) return;
            try { analyserRef.current.getByteTimeDomainData(buf); } catch (_) { return; }
            var sumSq = 0;
            for (var i = 0; i < buf.length; i++) {
              var v = (buf[i] - 128) / 128;
              sumSq += v * v;
            }
            var rms = Math.sqrt(sumSq / buf.length);
            var aperture = Math.min(1, Math.max(0.02, rms * 4));
            setMouthOpen(aperture);
            localRaf = requestAnimationFrame(loop);
            rafRef.current = localRaf;
          };
          localRaf = requestAnimationFrame(loop);
          rafRef.current = localRaf;
          tried = true;
        }
      } catch (e) {
        tried = false;
      }
    }
    if (!tried) startFallback();

    return function() {
      cancelled = true;
      if (localRaf) { try { cancelAnimationFrame(localRaf); } catch (_) {} }
      if (rafRef.current) { try { cancelAnimationFrame(rafRef.current); } catch (_) {} rafRef.current = null; }
    };
  }, [speaking, audioElement]);

  var W = size, H = size * 1.18;
  var cx = W / 2;
  var faceCy = H * 0.48;
  var faceRx = W * 0.30;
  var faceRy = H * 0.34;
  var eyeY = faceCy - faceRy * 0.10;
  var eyeDx = faceRx * 0.42;
  // S22 — larger, rounder eyes for a softer, more expressive look
  var eyeRx = faceRx * 0.19;
  var eyeRy = faceRy * 0.115;
  var irisR = eyeRx * 0.62;
  var pupilR = irisR * 0.45;
  var pupilShift = lookDir * irisR * 0.5;
  var browY = eyeY - faceRy * 0.18;
  var browDx = eyeDx;
  var browLen = eyeRx * 1.8;
  var noseY = faceCy + faceRy * 0.05;
  var mouthCy = faceCy + faceRy * 0.45;
  // S22 — fuller mouth for a warmer smile
  var mouthW = faceRx * 0.58;
  var mouthH = 2 + mouthOpen * faceRy * 0.38;

  // S22 — softer, warmer palette
  var skinLight  = '#fde0c7';
  var skinBase   = '#f2bf9b';
  var skinShadow = '#c98d6e';
  var hairDark   = '#2a1712';
  var hairMid    = '#4a2820';
  var hairHi     = '#a26a4a';
  var lipBase    = '#d85e6f';
  var lipDeep    = '#9c2e40';
  var lipHi      = '#f4a3ae';
  var toothWhite = '#fbf5eb';
  var irisColor  = '#7a462a';
  var eyeWhite   = '#fdfaf3';
  var lashDark   = '#1a0f0a';
  var blushPink  = '#f0a597';

  var ringColor = listening ? '#10b981' : (loading ? '#6366f1' : (speaking ? color : 'transparent'));
  var ringOpacity = (listening || loading || speaking) ? 1 : 0;

  return (
    <div
      style={{
        width: size,
        height: H,
        position: 'relative',
        animation: loading ? 'nadia-bob 2.4s ease-in-out infinite' : 'none',
      }}
    >
      <style>{
        '@keyframes nadia-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }' +
        '@keyframes nadia-pulse-ring { 0% { transform: scale(1); opacity: 0.75; } 100% { transform: scale(1.25); opacity: 0; } }' +
        '@keyframes nadia-glow { 0%,100% { opacity: 0.55; } 50% { opacity: 0.95; } }'
      }</style>

      {listening && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '2px solid #10b981',
            animation: 'nadia-pulse-ring 1.5s ease-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      <svg width={W} height={H} viewBox={'0 0 ' + W + ' ' + H} xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
        <defs>
          <radialGradient id="nadia-skin" cx="0.35" cy="0.30" r="0.95">
            <stop offset="0%" stopColor={skinLight} />
            <stop offset="55%" stopColor={skinBase} />
            <stop offset="100%" stopColor={skinShadow} />
          </radialGradient>
          <linearGradient id="nadia-hair" x1="0.2" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor={hairDark} />
            <stop offset="55%" stopColor={hairMid} />
            <stop offset="100%" stopColor={hairHi} />
          </linearGradient>
          <linearGradient id="nadia-lip" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lipHi} />
            <stop offset="45%" stopColor={lipBase} />
            <stop offset="100%" stopColor={lipDeep} />
          </linearGradient>
          <radialGradient id="nadia-iris" cx="0.5" cy="0.5" r="0.55">
            <stop offset="0%" stopColor="#2b1308" />
            <stop offset="45%" stopColor={irisColor} />
            <stop offset="100%" stopColor="#3b1e0e" />
          </radialGradient>
          <radialGradient id="nadia-bg" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#fff2e8" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fff2e8" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx={cx} cy={faceCy} r={faceRx * 1.35} fill="url(#nadia-bg)" />

        <ellipse cx={cx} cy={faceCy + faceRy * 0.05} rx={faceRx * 1.18} ry={faceRy * 1.08}
          fill="none" stroke={ringColor} strokeWidth="2" opacity={ringOpacity}
          style={{ animation: speaking ? 'nadia-glow 1.4s ease-in-out infinite' : 'none' }} />

        {/* Hair — back layer */}
        <path
          d={
            'M ' + (cx - faceRx * 1.15) + ' ' + (faceCy - faceRy * 0.2) + ' ' +
            'C ' + (cx - faceRx * 1.35) + ' ' + (faceCy - faceRy * 1.05) + ', ' +
                   (cx + faceRx * 1.35) + ' ' + (faceCy - faceRy * 1.05) + ', ' +
                   (cx + faceRx * 1.15) + ' ' + (faceCy - faceRy * 0.2) + ' ' +
            'L ' + (cx + faceRx * 1.25) + ' ' + (faceCy + faceRy * 0.9) + ' ' +
            'C ' + (cx + faceRx * 0.9) + ' ' + (faceCy + faceRy * 1.05) + ', ' +
                   (cx - faceRx * 0.9) + ' ' + (faceCy + faceRy * 1.05) + ', ' +
                   (cx - faceRx * 1.25) + ' ' + (faceCy + faceRy * 0.9) + ' Z'
          }
          fill="url(#nadia-hair)"
        />

        {/* Neck */}
        <ellipse cx={cx} cy={faceCy + faceRy * 0.92} rx={faceRx * 0.42} ry={faceRy * 0.22} fill={skinShadow} />
        {/* Shoulders / shirt */}
        <path
          d={
            'M ' + (cx - faceRx * 1.35) + ' ' + (faceCy + faceRy * 1.1) + ' ' +
            'Q ' + cx + ' ' + (faceCy + faceRy * 0.95) + ' ' +
                   (cx + faceRx * 1.35) + ' ' + (faceCy + faceRy * 1.1) + ' ' +
            'L ' + (cx + faceRx * 1.35) + ' ' + H + ' ' +
            'L ' + (cx - faceRx * 1.35) + ' ' + H + ' Z'
          }
          fill="#1e293b"
        />

        {/* Face */}
        <ellipse cx={cx} cy={faceCy} rx={faceRx} ry={faceRy} fill="url(#nadia-skin)" />

        {/* Cheek blush */}
        <ellipse cx={cx - faceRx * 0.55} cy={faceCy + faceRy * 0.22} rx={faceRx * 0.25} ry={faceRy * 0.13} fill={blushPink} opacity="0.28" />
        <ellipse cx={cx + faceRx * 0.55} cy={faceCy + faceRy * 0.22} rx={faceRx * 0.25} ry={faceRy * 0.13} fill={blushPink} opacity="0.28" />

        {/* Hair — front side-swept fringe */}
        <path
          d={
            'M ' + (cx - faceRx * 0.95) + ' ' + (faceCy - faceRy * 0.55) + ' ' +
            'C ' + (cx - faceRx * 0.3) + ' ' + (faceCy - faceRy * 1.05) + ', ' +
                   (cx + faceRx * 0.85) + ' ' + (faceCy - faceRy * 1.00) + ', ' +
                   (cx + faceRx * 1.08) + ' ' + (faceCy - faceRy * 0.1) + ' ' +
            'Q ' + (cx + faceRx * 0.6) + ' ' + (faceCy - faceRy * 0.72) + ' ' +
                   (cx - faceRx * 0.1) + ' ' + (faceCy - faceRy * 0.65) + ' ' +
            'Q ' + (cx - faceRx * 0.85) + ' ' + (faceCy - faceRy * 0.78) + ' ' +
                   (cx - faceRx * 0.95) + ' ' + (faceCy - faceRy * 0.55) + ' Z'
          }
          fill="url(#nadia-hair)"
        />

        {/* Eyebrows */}
        <path
          d={'M ' + (cx - browDx - browLen / 2) + ' ' + browY + ' Q ' + (cx - browDx) + ' ' + (browY - faceRy * 0.04) + ' ' + (cx - browDx + browLen / 2) + ' ' + browY}
          stroke={hairDark} strokeWidth={faceRy * 0.035} strokeLinecap="round" fill="none"
        />
        <path
          d={'M ' + (cx + browDx - browLen / 2) + ' ' + browY + ' Q ' + (cx + browDx) + ' ' + (browY - faceRy * 0.04) + ' ' + (cx + browDx + browLen / 2) + ' ' + browY}
          stroke={hairDark} strokeWidth={faceRy * 0.035} strokeLinecap="round" fill="none"
        />

        {/* Eyes */}
        <g>
          <ellipse cx={cx - eyeDx} cy={eyeY} rx={eyeRx} ry={blink ? 0.8 : eyeRy}
            fill={eyeWhite}
            style={{ transition: 'ry 80ms ease' }} />
          <ellipse cx={cx + eyeDx} cy={eyeY} rx={eyeRx} ry={blink ? 0.8 : eyeRy}
            fill={eyeWhite}
            style={{ transition: 'ry 80ms ease' }} />

          {!blink && (
            <g>
              <circle cx={cx - eyeDx + pupilShift * 0.6} cy={eyeY} r={irisR} fill="url(#nadia-iris)" />
              <circle cx={cx + eyeDx + pupilShift * 0.6} cy={eyeY} r={irisR} fill="url(#nadia-iris)" />
            </g>
          )}
          {!blink && (
            <g fill="#0a0a0a">
              <circle cx={cx - eyeDx + pupilShift} cy={eyeY} r={pupilR} />
              <circle cx={cx + eyeDx + pupilShift} cy={eyeY} r={pupilR} />
            </g>
          )}
          {!blink && (
            <g fill="#ffffff" opacity="0.95">
              <circle cx={cx - eyeDx - eyeRx * 0.2 + pupilShift} cy={eyeY - eyeRy * 0.35} r={Math.max(1, eyeRx * 0.12)} />
              <circle cx={cx + eyeDx - eyeRx * 0.2 + pupilShift} cy={eyeY - eyeRy * 0.35} r={Math.max(1, eyeRx * 0.12)} />
            </g>
          )}

          {/* Eyelashes */}
          <path d={'M ' + (cx - eyeDx - eyeRx) + ' ' + (eyeY - eyeRy * 0.7) + ' Q ' + (cx - eyeDx) + ' ' + (eyeY - eyeRy * 1.3) + ' ' + (cx - eyeDx + eyeRx) + ' ' + (eyeY - eyeRy * 0.7)}
            stroke={lashDark} strokeWidth={faceRy * 0.022} fill="none" strokeLinecap="round" />
          <path d={'M ' + (cx + eyeDx - eyeRx) + ' ' + (eyeY - eyeRy * 0.7) + ' Q ' + (cx + eyeDx) + ' ' + (eyeY - eyeRy * 1.3) + ' ' + (cx + eyeDx + eyeRx) + ' ' + (eyeY - eyeRy * 0.7)}
            stroke={lashDark} strokeWidth={faceRy * 0.022} fill="none" strokeLinecap="round" />
          {!blink && (
            <g stroke={lashDark} strokeWidth={Math.max(0.8, faceRy * 0.012)} strokeLinecap="round">
              <line x1={cx - eyeDx - eyeRx * 0.9} y1={eyeY - eyeRy * 0.55} x2={cx - eyeDx - eyeRx * 1.15} y2={eyeY - eyeRy * 0.85} />
              <line x1={cx + eyeDx + eyeRx * 0.9} y1={eyeY - eyeRy * 0.55} x2={cx + eyeDx + eyeRx * 1.15} y2={eyeY - eyeRy * 0.85} />
            </g>
          )}
        </g>

        {/* Nose */}
        <path
          d={'M ' + (cx - faceRx * 0.06) + ' ' + noseY + ' Q ' + (cx - faceRx * 0.1) + ' ' + (noseY + faceRy * 0.17) + ' ' + cx + ' ' + (noseY + faceRy * 0.2)}
          stroke={skinShadow} strokeWidth={Math.max(1, faceRy * 0.012)} fill="none" strokeLinecap="round" opacity="0.55"
        />
        <ellipse cx={cx - faceRx * 0.06} cy={noseY + faceRy * 0.2} rx={faceRx * 0.025} ry={faceRy * 0.012} fill={skinShadow} opacity="0.4" />
        <ellipse cx={cx + faceRx * 0.06} cy={noseY + faceRy * 0.2} rx={faceRx * 0.025} ry={faceRy * 0.012} fill={skinShadow} opacity="0.4" />

        {/* Mouth */}
        <g>
          {mouthOpen > 0.1 && (
            <ellipse
              cx={cx}
              cy={mouthCy}
              rx={mouthW * 0.45}
              ry={Math.max(1.5, mouthH * 0.55)}
              fill="#3a1820"
            />
          )}
          {mouthOpen > 0.4 && (
            <rect
              x={cx - mouthW * 0.33}
              y={mouthCy - mouthH * 0.2}
              width={mouthW * 0.66}
              height={Math.max(1, mouthH * 0.35)}
              rx="2"
              fill={toothWhite}
              opacity={Math.min(0.95, mouthOpen * 1.1)}
            />
          )}
          <path
            d={
              'M ' + (cx - mouthW / 2) + ' ' + mouthCy + ' ' +
              'Q ' + (cx - mouthW * 0.25) + ' ' + (mouthCy - mouthH * 0.55) + ' ' + cx + ' ' + (mouthCy - mouthH * 0.25) + ' ' +
              'Q ' + (cx + mouthW * 0.25) + ' ' + (mouthCy - mouthH * 0.55) + ' ' + (cx + mouthW / 2) + ' ' + mouthCy + ' ' +
              'Q ' + (cx + mouthW * 0.3) + ' ' + (mouthCy - mouthH * 0.15) + ' ' + cx + ' ' + (mouthCy - mouthH * 0.1) + ' ' +
              'Q ' + (cx - mouthW * 0.3) + ' ' + (mouthCy - mouthH * 0.15) + ' ' + (cx - mouthW / 2) + ' ' + mouthCy + ' Z'
            }
            fill="url(#nadia-lip)"
          />
          <path
            d={
              'M ' + (cx - mouthW / 2) + ' ' + mouthCy + ' ' +
              'Q ' + cx + ' ' + (mouthCy + mouthH * 0.9 + 2) + ' ' + (cx + mouthW / 2) + ' ' + mouthCy + ' ' +
              'Q ' + (cx + mouthW * 0.3) + ' ' + (mouthCy + mouthH * 0.25) + ' ' + cx + ' ' + (mouthCy + mouthH * 0.3) + ' ' +
              'Q ' + (cx - mouthW * 0.3) + ' ' + (mouthCy + mouthH * 0.25) + ' ' + (cx - mouthW / 2) + ' ' + mouthCy + ' Z'
            }
            fill="url(#nadia-lip)"
          />
          <ellipse
            cx={cx}
            cy={mouthCy + mouthH * 0.5}
            rx={mouthW * 0.18}
            ry={Math.max(0.5, mouthH * 0.08)}
            fill="#ffffff"
            opacity="0.35"
          />
        </g>

        {loading && (
          <g>
            {[0, 1, 2].map(function(i) {
              return (
                <circle
                  key={i}
                  cx={cx - 14 + i * 14}
                  cy={faceCy + faceRy * 1.3}
                  r="3"
                  fill="#6366f1"
                  opacity="0.85"
                  style={{ animation: 'nadia-glow 1.1s ease-in-out infinite', animationDelay: (i * 180) + 'ms' }}
                />
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
