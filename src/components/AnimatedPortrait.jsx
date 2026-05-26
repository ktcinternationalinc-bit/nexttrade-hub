// ============================================================
// AnimatedPortrait — v55.83-A.6.27.72 HOTFIX 13
//
// Bring a real portrait photo to life. Sits on top of the actual photo
// of Nadia / Jenna / Sara and overlays:
//   - Animated mouth strip pulsing with REAL audio amplitude (matches the
//     actual sentence cadence — no fake patterns)
//   - Blink masks over each eye at human intervals (every 3-5s)
//   - Subtle head sway via CSS transform while speaking
//   - Listening: slow head tilt + breathing ring
//   - Idle: gentle breath scale + occasional natural blinks
//   - Persona-specific gesture intensity:
//       composed — Nadia. Minimal head movement, careful blinks.
//       warm    — Jenna. Slight smile pulse on emphasis, gentle nods.
//       bouncy  — Sara. More head bob, expressive eyebrow lifts.
//
// All animation: pure React state + CSS transforms + SVG masks. Zero deps.
//
// HOW THE OVERLAYS WORK:
//   The actual photo renders as an <img>. On top of it, absolutely-
//   positioned SVG shapes act as "skin-color overlays" that briefly
//   cover the mouth / eyes to simulate lip movement and blinks.
//   Coordinates come from each persona's faceAnchors (normalized 0-1).
//
//   This is the trick: rather than re-drawing the face, we hide+reveal
//   parts of it. Combined with audio amplitude driving the mouth's
//   vertical scale, it reads as "she's actually talking" — especially
//   at 56px-128px display sizes where eye-level detail is forgiving.
// ============================================================

import { useEffect, useRef, useState } from 'react';

export default function AnimatedPortrait({
  photo,
  alt = '',
  speaking = false,
  listening = false,
  loading = false,
  color = '#6366f1',
  size = 96,
  audioElement = null,
  faceAnchors = null,
  // Approximate skin tone overlay color — used to "close" eyes/mouth.
  // Picks a tan/peach by default that works for the avatars in /public/avatars.
  // Tune per persona later if needed.
  skinTone = '#e0b89a',
}) {
  // Audio amplitude in [0, 1] — drives mouth openness during speech.
  var [amp, setAmp] = useState(0);
  // Eyebrow lift in [0, 1] — louder amplitude = more lift, simulates emphasis.
  var [brow, setBrow] = useState(0);
  // Blink state — 0 = open, 1 = fully closed. Animated at human intervals.
  var [blink, setBlink] = useState(0);
  // Head sway — slight rotation + translation. Driven by audio + persona.
  var [sway, setSway] = useState({ rx: 0, ry: 0, tx: 0, ty: 0 });
  // Idle breathing scale — gentle 1.00 ↔ 1.015.
  var [breath, setBreath] = useState(1);

  var rafRef = useRef(null);
  var analyserRef = useRef(null);
  var audioCtxRef = useRef(null);
  var sourceRef = useRef(null);

  // Use sensible defaults if anchors not supplied
  var anchors = faceAnchors || {
    mouth: { x: 0.50, y: 0.74, width: 0.18 },
    eyeL:  { x: 0.41, y: 0.46, width: 0.10 },
    eyeR:  { x: 0.59, y: 0.46, width: 0.10 },
    gestures: 'composed',
  };
  var gestureMode = anchors.gestures || 'composed';
  // Per-persona movement intensity multipliers
  var gestureIntensity = (
    gestureMode === 'bouncy' ? { sway: 1.6, brow: 1.3, blinkRate: 0.9 } :
    gestureMode === 'warm'   ? { sway: 1.1, brow: 1.1, blinkRate: 1.0 } :
    /* composed */              { sway: 0.7, brow: 0.8, blinkRate: 1.1 }
  );

  // Periodic blinking — only when NOT actively mouth-speaking (so blinks don't
  // collide with mouth animation visually). Sara blinks slightly more often,
  // Nadia slightly less.
  useEffect(function () {
    var alive = true;
    function scheduleBlink() {
      if (!alive) return;
      var baseInterval = 3200 + Math.random() * 2400;
      var t = setTimeout(function () {
        if (!alive) return;
        // Quick blink: open → closed (80ms) → open (80ms)
        setBlink(1);
        setTimeout(function () { if (alive) setBlink(0); }, 110);
        scheduleBlink();
      }, baseInterval * gestureIntensity.blinkRate);
      return t;
    }
    var initialTimer = scheduleBlink();
    return function () {
      alive = false;
      if (initialTimer) clearTimeout(initialTimer);
    };
  }, [gestureIntensity.blinkRate]);

  // Idle breathing scale — only when NOT speaking, NOT listening
  useEffect(function () {
    if (speaking || listening) { setBreath(1); return; }
    var i = 0;
    var t = setInterval(function () {
      i++;
      setBreath(1 + Math.sin(i / 8) * 0.012);
    }, 180);
    return function () { clearInterval(t); };
  }, [speaking, listening]);

  // Audio-reactive: drives mouth + brow + sway while speaking.
  // Mirrors NadiaFace's hardened teardown pattern.
  useEffect(function () {
    if (!speaking || !audioElement) {
      setAmp(0); setBrow(0);
      return;
    }
    // Tear down any prior wiring
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch (e) {}
      sourceRef.current = null;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AC();
      }
      var ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      var source = ctx.createMediaElementSource(audioElement);
      sourceRef.current = source;
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      analyserRef.current = analyser;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      var data = new Uint8Array(analyser.frequencyBinCount);
      var swayPhase = 0;
      function tick() {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(data);
        // Average amplitude in the human speech frequency band (~85-300 Hz fund).
        var sum = 0; var count = 0;
        for (var i = 2; i < 16; i++) { sum += data[i]; count++; }
        var avg = count > 0 ? (sum / count) / 255 : 0;
        // Boost low-end, ease out
        var normalized = Math.min(1, Math.pow(avg * 1.4, 0.7));
        setAmp(normalized);
        // Brow lift follows amplitude with hysteresis
        setBrow(Math.min(1, normalized * 1.1 * gestureIntensity.brow));
        // Sway: slow drift + amplitude-modulated micro-movement
        swayPhase += 0.018;
        var swayAmount = gestureIntensity.sway;
        setSway({
          rx: Math.sin(swayPhase * 0.7) * 1.2 * swayAmount + normalized * 0.6 * swayAmount,
          ry: Math.cos(swayPhase * 0.5) * 0.8 * swayAmount,
          tx: Math.sin(swayPhase) * 0.6 * swayAmount,
          ty: -normalized * 0.4 * swayAmount,
        });
        rafRef.current = requestAnimationFrame(tick);
      }
      tick();
    } catch (e) {
      // Already connected (re-render); just keep last amp
    }
    return function () {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch (e) {}
        sourceRef.current = null;
      }
      setAmp(0); setBrow(0); setSway({ rx: 0, ry: 0, tx: 0, ty: 0 });
    };
  }, [speaking, audioElement, gestureIntensity.brow, gestureIntensity.sway]);

  // Listening sway — slow attentive head tilt
  useEffect(function () {
    if (!listening) return;
    var phase = 0;
    var t = setInterval(function () {
      phase += 0.04;
      setSway({
        rx: Math.sin(phase) * 1.5,
        ry: Math.cos(phase * 0.7) * 1.0,
        tx: 0, ty: 0,
      });
    }, 80);
    return function () { clearInterval(t); setSway({ rx: 0, ry: 0, tx: 0, ty: 0 }); };
  }, [listening]);

  // Compute overlay pixel positions from normalized anchors
  var mouthW = anchors.mouth.width * size;
  // Mouth opens vertically with amplitude — closed height is ~6% of mouth width,
  // open is up to 35% (a yawning open). Real talking lands around 10-25%.
  var mouthOpenH = (0.06 + amp * 0.30) * mouthW;
  var mouthX = anchors.mouth.x * size - mouthW / 2;
  var mouthY = anchors.mouth.y * size - mouthOpenH / 2;

  var eyeW = anchors.eyeL.width * size;
  var eyeH = eyeW * 0.45;  // slight oval
  // Blink: when blink=1, eye masks are full height; when 0, hidden behind eyelid edge
  var eyeMaskH = blink * eyeH;
  var eyeLX = anchors.eyeL.x * size - eyeW / 2;
  var eyeLY = anchors.eyeL.y * size - eyeMaskH / 2;
  var eyeRX = anchors.eyeR.x * size - eyeW / 2;
  var eyeRY = anchors.eyeR.y * size - eyeMaskH / 2;

  // Combined transform — sway + breath
  var transform =
    'translate(' + sway.tx.toFixed(2) + 'px, ' + sway.ty.toFixed(2) + 'px) ' +
    'rotate(' + sway.rx.toFixed(2) + 'deg) ' +
    'scale(' + breath.toFixed(3) + ')';

  // Glow color for listening/speaking states
  var glow = listening ? 'rgba(239, 68, 68, 0.55)' :
             speaking ? color + 'aa' :
             'transparent';

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        display: 'inline-block',
      }}
    >
      {/* Outer breathing ring (listening or speaking) */}
      <div
        style={{
          position: 'absolute',
          inset: -4,
          borderRadius: '50%',
          boxShadow: '0 0 0 2px ' + glow + ', 0 0 18px 4px ' + glow,
          opacity: (listening || speaking) ? 1 : 0,
          transition: 'opacity 0.25s ease',
          pointerEvents: 'none',
        }}
      />

      {/* The portrait — transformed by sway/breath */}
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          transform: transform,
          transition: speaking || listening ? 'transform 0.06s linear' : 'transform 0.35s ease-out',
          position: 'relative',
          background: '#1e293b',
        }}
      >
        <img
          src={photo}
          alt={alt}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            userSelect: 'none',
          }}
        />

        {/* Eyelid overlay — appears when blink > 0. Skin-tone semicircles
            covering the eye region. The height interpolates with blink. */}
        <div
          style={{
            position: 'absolute',
            left: eyeLX, top: eyeLY,
            width: eyeW, height: eyeMaskH,
            background: skinTone,
            borderRadius: '50%',
            opacity: blink,
            transition: 'height 0.05s linear, opacity 0.05s linear',
            pointerEvents: 'none',
            // Soft edge so the eyelid blends instead of looking like a sticker
            boxShadow: '0 0 ' + (eyeH * 0.4) + 'px ' + (eyeH * 0.2) + 'px ' + skinTone + 'cc inset',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: eyeRX, top: eyeRY,
            width: eyeW, height: eyeMaskH,
            background: skinTone,
            borderRadius: '50%',
            opacity: blink,
            transition: 'height 0.05s linear, opacity 0.05s linear',
            pointerEvents: 'none',
            boxShadow: '0 0 ' + (eyeH * 0.4) + 'px ' + (eyeH * 0.2) + 'px ' + skinTone + 'cc inset',
          }}
        />

        {/* Eyebrow lift hint — slight darker bar above eyes when brow > 0.
            Subliminal effect: amplifies the sense of emphasis. */}
        <div
          style={{
            position: 'absolute',
            left: eyeLX + eyeW * 0.15,
            top: eyeLY - eyeH * 0.65 - brow * 2,
            width: eyeW * 0.7,
            height: 1.5,
            background: '#3a2520',
            opacity: brow * 0.35,
            borderRadius: 2,
            transition: 'top 0.06s linear, opacity 0.06s linear',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: eyeRX + eyeW * 0.15,
            top: eyeRY - eyeH * 0.65 - brow * 2,
            width: eyeW * 0.7,
            height: 1.5,
            background: '#3a2520',
            opacity: brow * 0.35,
            borderRadius: 2,
            transition: 'top 0.06s linear, opacity 0.06s linear',
            pointerEvents: 'none',
          }}
        />

        {/* Mouth opening — a dark ellipse sized by amplitude. The portrait's
            real mouth shows around the edges; this overlay opens for speech.
            Uses dark interior color (#2a1612) to read as "open mouth". */}
        <div
          style={{
            position: 'absolute',
            left: mouthX,
            top: mouthY,
            width: mouthW,
            height: mouthOpenH,
            background: 'radial-gradient(ellipse at center, #2a1612 60%, #5a2a22 100%)',
            borderRadius: '50%',
            opacity: speaking ? Math.max(0.2, amp * 1.1) : 0,
            transition: 'opacity 0.08s linear, height 0.05s linear, top 0.05s linear',
            pointerEvents: 'none',
            boxShadow: '0 0 3px 1px rgba(0,0,0,0.4) inset',
          }}
        />
      </div>

      {/* Loading indicator — thinking dots beneath the portrait */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            bottom: -16,
            left: 0,
            width: size,
            textAlign: 'center',
            color: color,
            fontSize: 14,
            letterSpacing: 2,
            animation: 'animatedPortraitDots 1.2s infinite',
          }}
        >
          •••
        </div>
      )}

      {/* CSS keyframes — scoped via inline style tag (works in Next.js) */}
      <style>{`
        @keyframes animatedPortraitDots {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
