// ============================================================
// NadiaFace — Animated SVG avatar for the Nadia assistant
//
// States driven by props:
//   speaking  — mouth animates, gentle head glow
//   listening — outer ring pulses green, eyes wider
//   loading   — subtle bobbing + blue shimmer
//   idle      — periodic blinks, calm
//
// Audio-driven lip sync (optional):
//   Pass `audioElement` prop (an HTMLAudioElement). We attach a Web Audio
//   AnalyserNode and drive mouth aperture from real-time volume. This gives
//   lifelike lip motion without any external service (no D-ID/HeyGen).
//   When audioElement is null we fall back to a clean CSS-driven cadence.
//
// Zero external deps. Uses only React + inline SVG. Fully themeable via
// the `color` prop (defaults to emerald for Nadia).
// ============================================================

import { useEffect, useRef, useState } from 'react';

export default function NadiaFace({
  speaking = false,
  listening = false,
  loading = false,
  color = '#10b981',
  size = 120,
  audioElement = null, // optional HTMLAudioElement for real lip sync
  lang = 'en',
}) {
  var [blink, setBlink] = useState(false);
  var [mouthOpen, setMouthOpen] = useState(0); // 0..1 aperture
  var rafRef = useRef(null);
  var analyserRef = useRef(null);
  var audioCtxRef = useRef(null);
  var sourceRef = useRef(null);

  // Periodic blinking when idle/listening. Not while speaking (less distracting).
  useEffect(function() {
    if (speaking) return;
    var t = setInterval(function() {
      setBlink(true);
      setTimeout(function() { setBlink(false); }, 150);
    }, 3500 + Math.random() * 2500);
    return function() { clearInterval(t); };
  }, [speaking]);

  // Lip-sync engine:
  //   (a) If audioElement is provided, tap its audio stream with an AnalyserNode
  //       and drive mouthOpen from real-time RMS volume.
  //   (b) Otherwise, a pseudo-random cadence that looks like natural speech.
  useEffect(function() {
    if (!speaking) {
      setMouthOpen(0);
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      return;
    }

    // Real audio-driven mouth — only when we have a live audio element
    if (audioElement && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        var ctx = audioCtxRef.current || new Ctx();
        audioCtxRef.current = ctx;

        // Reuse the same MediaElementSource — creating a second one for the same
        // audio element throws "InvalidStateError" in Chromium.
        if (!sourceRef.current || sourceRef.current.audioElement !== audioElement) {
          var src = ctx.createMediaElementSource(audioElement);
          src.audioElement = audioElement;
          var analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
          analyser.connect(ctx.destination);
          sourceRef.current = src;
          analyserRef.current = analyser;
        }

        var buf = new Uint8Array(analyserRef.current.frequencyBinCount);
        var loop = function() {
          analyserRef.current.getByteTimeDomainData(buf);
          // RMS of the waveform — louder = mouth more open
          var sumSq = 0;
          for (var i = 0; i < buf.length; i++) {
            var v = (buf[i] - 128) / 128;
            sumSq += v * v;
          }
          var rms = Math.sqrt(sumSq / buf.length);
          // rms is typically 0..0.3 for speech; map to 0..1 aperture with floor
          var aperture = Math.min(1, Math.max(0.05, rms * 4));
          setMouthOpen(aperture);
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
        return function() {
          if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        };
      } catch (e) {
        // Fall through to pseudo-random cadence
      }
    }

    // Pseudo-speech cadence: random small mouth motions at ~8 Hz
    var lastUpdate = 0;
    var target = 0.2;
    var step = function(ts) {
      if (ts - lastUpdate > 120) {
        target = 0.15 + Math.random() * 0.65;
        lastUpdate = ts;
      }
      setMouthOpen(function(prev) { return prev + (target - prev) * 0.35; });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return function() {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [speaking, audioElement]);

  // Geometry — everything scales off `size`
  var cx = size / 2;
  var cy = size / 2;
  var headR = size * 0.42;
  var eyeY = cy - size * 0.06;
  var eyeDx = size * 0.14;
  var eyeR = size * 0.045;
  var mouthCy = cy + size * 0.14;
  var mouthW = size * 0.22;
  var mouthH = size * 0.02 + mouthOpen * size * 0.14; // expands with aperture

  // Dynamic ring styling based on state
  var ringColor = listening ? '#10b981' : (loading ? '#6366f1' : (speaking ? color : 'transparent'));
  var ringOpacity = (listening || loading || speaking) ? 1 : 0;

  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
        animation: loading ? 'nadia-bob 2s ease-in-out infinite' : 'none',
      }}
    >
      <style>{
        '@keyframes nadia-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }' +
        '@keyframes nadia-pulse-ring { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(1.35); opacity: 0; } }' +
        '@keyframes nadia-glow { 0%,100% { opacity: 0.55; } 50% { opacity: 0.95; } }'
      }</style>

      {/* Listening pulse ring — emanates outward when mic is active */}
      {listening && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '2px solid #10b981',
            animation: 'nadia-pulse-ring 1.4s ease-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      <svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size} xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
        <defs>
          <radialGradient id="nadia-head-grad" cx="0.4" cy="0.35" r="0.75">
            <stop offset="0%" stopColor={color} stopOpacity="0.95" />
            <stop offset="70%" stopColor={color} stopOpacity="0.7" />
            <stop offset="100%" stopColor="#0f172a" stopOpacity="1" />
          </radialGradient>
          <radialGradient id="nadia-eye-grad" cx="0.3" cy="0.3" r="0.8">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="100%" stopColor="#e2e8f0" stopOpacity="1" />
          </radialGradient>
          <filter id="nadia-soft-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={speaking ? 4 : 2} />
          </filter>
        </defs>

        {/* Outer state ring */}
        <circle cx={cx} cy={cy} r={headR + 6} fill="none" stroke={ringColor} strokeWidth="2" opacity={ringOpacity}
          style={{ animation: speaking ? 'nadia-glow 1.2s ease-in-out infinite' : 'none' }} />

        {/* Head */}
        <circle cx={cx} cy={cy} r={headR} fill="url(#nadia-head-grad)" stroke={color} strokeOpacity="0.35" strokeWidth="1" />

        {/* Subtle highlight for 3D feel */}
        <ellipse cx={cx - headR * 0.3} cy={cy - headR * 0.4} rx={headR * 0.25} ry={headR * 0.15}
          fill="#ffffff" opacity="0.12" />

        {/* Eyes — scale Y when blinking */}
        <g>
          <ellipse cx={cx - eyeDx} cy={eyeY} rx={eyeR} ry={blink ? eyeR * 0.08 : eyeR}
            fill="url(#nadia-eye-grad)"
            style={{ transition: 'ry 80ms ease' }} />
          <ellipse cx={cx + eyeDx} cy={eyeY} rx={eyeR} ry={blink ? eyeR * 0.08 : eyeR}
            fill="url(#nadia-eye-grad)"
            style={{ transition: 'ry 80ms ease' }} />
          {/* Pupils — only visible when not blinking */}
          {!blink && (
            <g fill="#0f172a">
              <circle cx={cx - eyeDx + (listening ? 1 : 0)} cy={eyeY} r={eyeR * 0.45} />
              <circle cx={cx + eyeDx + (listening ? 1 : 0)} cy={eyeY} r={eyeR * 0.45} />
            </g>
          )}
          {/* Catch-light specular — adds life */}
          {!blink && (
            <g fill="#ffffff" opacity="0.9">
              <circle cx={cx - eyeDx - eyeR * 0.2} cy={eyeY - eyeR * 0.25} r={eyeR * 0.18} />
              <circle cx={cx + eyeDx - eyeR * 0.2} cy={eyeY - eyeR * 0.25} r={eyeR * 0.18} />
            </g>
          )}
        </g>

        {/* Mouth — animates with lip sync */}
        <g>
          <ellipse
            cx={cx}
            cy={mouthCy}
            rx={mouthW / 2}
            ry={Math.max(1.5, mouthH / 2)}
            fill="#0f172a"
            stroke={color}
            strokeOpacity="0.4"
            strokeWidth="1"
            style={{ transition: 'ry 40ms ease-out' }}
          />
          {/* Bottom-lip highlight (only visible when mouth is open enough) */}
          {mouthOpen > 0.25 && (
            <ellipse
              cx={cx}
              cy={mouthCy + mouthH / 2 - 1}
              rx={mouthW / 2 - 2}
              ry={1}
              fill={color}
              opacity={Math.min(0.6, mouthOpen * 0.8)}
            />
          )}
        </g>

        {/* Thinking dots — only when loading */}
        {loading && (
          <g>
            {[0, 1, 2].map(function(i) {
              return (
                <circle
                  key={i}
                  cx={cx - 12 + i * 12}
                  cy={cy + headR + 14}
                  r="2.5"
                  fill={color}
                  opacity="0.8"
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
