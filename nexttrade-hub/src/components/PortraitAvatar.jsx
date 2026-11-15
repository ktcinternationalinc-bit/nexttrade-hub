// ============================================================
// PortraitAvatar — v55.78
//
// World-class audio-reactive overlay for ANY persona photo.
// Replaces the bare static-photo + colored-ring treatment that
// Jenna and Sara had before. Now they pulse with their voice in
// real time, just like NadiaFace's lip sync — but driven by amplitude
// rather than mouth-shape (since we're working with a real photo).
//
// What it does:
//   - speaking: animated concentric rings driven by REAL audio amplitude
//     (FFT of the AudioContext source). When the persona is loud, rings
//     pulse outward; when she pauses, rings settle. This gives the same
//     "she's alive while talking" feeling as NadiaFace.
//   - listening: red breathing ring + soft glow
//   - loading: thinking dots beneath the photo
//   - idle: subtle scale breathing + occasional micro-shimmer
//
// All animation is via React state + CSS. No external libs. The audio
// connection mirrors NadiaFace's hardened pattern: every run disconnects
// prior source before wiring new, RAF is canceled on cleanup, no
// resource leaks across messages.
// ============================================================

import { useEffect, useRef, useState } from 'react';

export default function PortraitAvatar({
  photo,
  alt = '',
  speaking = false,
  listening = false,
  loading = false,
  color = '#6366f1',
  size = 56,
  audioElement = null,
}) {
  // Amplitude in [0, 1] — drives ring scale + opacity while speaking.
  var [amp, setAmp] = useState(0);
  // Idle "breathing" scale — gentle 1.00 ↔ 1.015 oscillation.
  var [breath, setBreath] = useState(1);
  var rafRef = useRef(null);
  var analyserRef = useRef(null);
  var audioCtxRef = useRef(null);
  var sourceRef = useRef(null);

  // Idle breathing — only when NOT speaking and NOT listening.
  useEffect(function () {
    if (speaking || listening) { setBreath(1); return; }
    var i = 0;
    var t = setInterval(function () {
      i++;
      // Slow sine wave around 1.0
      setBreath(1 + Math.sin(i / 8) * 0.012);
    }, 180);
    return function () { clearInterval(t); };
  }, [speaking, listening]);

  // Audio-reactive ring while speaking. Mirrors NadiaFace's hardened
  // teardown pattern so we don't leak analyser nodes across messages.
  useEffect(function () {
    var cancelled = false;
    var localRaf = 0;

    if (!speaking) {
      setAmp(0);
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      return;
    }

    var disconnectPrior = function () {
      try { if (sourceRef.current && sourceRef.current.disconnect) sourceRef.current.disconnect(); } catch (_) {}
      try { if (analyserRef.current && analyserRef.current.disconnect) analyserRef.current.disconnect(); } catch (_) {}
      sourceRef.current = null;
      analyserRef.current = null;
    };

    // Fallback shimmer if we can't tap real audio (e.g. browser TTS).
    // Random target every ~120ms, smoothly interpolated.
    var startFallback = function () {
      var lastUpdate = 0;
      var target = 0.2;
      var step = function (ts) {
        if (cancelled) return;
        if (ts - lastUpdate > 120) {
          target = 0.15 + Math.random() * 0.7;
          lastUpdate = ts;
        }
        setAmp(function (prev) { return prev + (target - prev) * 0.32; });
        localRaf = requestAnimationFrame(step);
        rafRef.current = localRaf;
      };
      localRaf = requestAnimationFrame(step);
      rafRef.current = localRaf;
    };

    if (!audioElement) { startFallback(); return function () { cancelled = true; if (rafRef.current) cancelAnimationFrame(rafRef.current); }; }

    try {
      disconnectPrior();
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { startFallback(); return function () { cancelled = true; if (rafRef.current) cancelAnimationFrame(rafRef.current); }; }
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      var ctx = audioCtxRef.current;
      // resume if it's suspended (mobile autoplay policy)
      if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
      // v55.79 — Defensive: avoid double-hooking the same audio element.
      // createMediaElementSource throws InvalidStateError if called twice
      // on the same element. NadiaFace marks elements with __nadiaHooked;
      // we use __portraitHooked here. If either marker is set, fall back
      // to procedural shimmer instead of crashing.
      if (audioElement.__nadiaHooked || audioElement.__portraitHooked) {
        startFallback();
        return function () { cancelled = true; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
      }
      var src = ctx.createMediaElementSource(audioElement);
      audioElement.__portraitHooked = true;
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      src.connect(analyser);
      analyser.connect(ctx.destination); // keep audio audible
      sourceRef.current = src;
      analyserRef.current = analyser;

      var data = new Uint8Array(analyser.frequencyBinCount);
      var step = function () {
        if (cancelled) return;
        analyser.getByteTimeDomainData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) {
          var d = data[i] - 128;
          sum += d * d;
        }
        var rms = Math.sqrt(sum / data.length); // 0..~80
        var amplitude = Math.min(1, rms / 40);
        setAmp(function (prev) { return prev + (amplitude - prev) * 0.3; });
        localRaf = requestAnimationFrame(step);
        rafRef.current = localRaf;
      };
      localRaf = requestAnimationFrame(step);
      rafRef.current = localRaf;
    } catch (e) {
      // createMediaElementSource throws if audio already has a source —
      // happens if the same audio element is fed to multiple components.
      // Fall back to shimmer instead of crashing.
      startFallback();
    }

    return function () {
      cancelled = true;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      disconnectPrior();
    };
  }, [speaking, audioElement]);

  // Visual layers
  var ringScale = 1 + amp * 0.18;
  var ringOpacity = 0.5 + amp * 0.5;
  var listeningPulse = listening ? 'avatar-listening-pulse' : '';
  var photoScale = speaking ? (1 + amp * 0.04) : breath;

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
      }}>
      {/* OUTER speaking ring — pulses with audio amplitude */}
      {speaking && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: -6,
            borderRadius: '50%',
            border: '2px solid ' + color,
            opacity: ringOpacity,
            transform: 'scale(' + ringScale + ')',
            transition: 'transform 60ms linear, opacity 80ms linear',
            pointerEvents: 'none',
          }}
        />
      )}
      {/* INNER speaking ring — softer, faster */}
      {speaking && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: -2,
            borderRadius: '50%',
            border: '2px solid ' + color,
            opacity: ringOpacity * 0.7,
            transform: 'scale(' + (1 + amp * 0.08) + ')',
            transition: 'transform 50ms linear, opacity 80ms linear',
            pointerEvents: 'none',
          }}
        />
      )}
      {/* LISTENING ring — red breathing */}
      {listening && !speaking && (
        <div
          aria-hidden
          className={listeningPulse}
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: '50%',
            border: '2px solid #ef4444',
            boxShadow: '0 0 12px rgba(239,68,68,0.5)',
            pointerEvents: 'none',
          }}
        />
      )}
      {/* The photo itself, with subtle scale animation */}
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          position: 'relative',
          transform: 'scale(' + photoScale + ')',
          transition: speaking ? 'transform 50ms linear' : 'transform 200ms ease-out',
          boxShadow: speaking
            ? '0 0 0 2px ' + color + ', 0 0 16px ' + color + 'aa'
            : listening
              ? '0 0 0 2px #ef4444aa'
              : '0 0 0 2px ' + color + '60',
        }}>
        <img
          src={photo}
          alt={alt}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            display: 'block',
          }}
          draggable={false}
        />
      </div>
      {/* Loading "thinking dots" beneath */}
      {loading && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -10,
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 3,
          }}>
          {[0, 1, 2].map(function (i) {
            return (
              <span
                key={i}
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: color,
                  opacity: 0.7,
                  animation: 'avatar-loading-dot 1.2s infinite',
                  animationDelay: i * 0.15 + 's',
                }}
              />
            );
          })}
        </div>
      )}
      {/* Inline keyframes — co-located with the component so it works
          without touching globals.css */}
      <style jsx>{`
        @keyframes avatar-loading-dot {
          0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
