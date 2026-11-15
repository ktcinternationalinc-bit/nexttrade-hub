// ============================================================
// LivingAvatar — the new avatar component
// ============================================================
// v55.83-A.6.27.72 HOTFIX 18.
//
// Renders a real portrait + animated mouth + animated eyelids. Subscribes
// to the XState machine via the `state` prop (the parent owns the actor
// so persona switching can interrupt cleanly across multiple LivingAvatars).
//
// Hard rule from spec:
//   shouldAnimate = avatar.id === activePersonaId
//                && avatar.id === speakingPersonaId
//                && machineState === 'speaking'
//
// Inactive avatars MUST stay closed-mouth + still.
// ============================================================

import { useState } from 'react';
import { useMouthSync } from '../hooks/useMouthSync';
import { useIdleBlink } from '../hooks/useIdleBlink';

/**
 * Per-persona face anchor + tone defaults. Mirrors the legacy
 * AnimatedPortrait values measured against the real photos.
 */
var DEFAULT_ANCHORS = {
  nadia: {
    mouth: { x: 0.50,  y: 0.515, width: 0.13 },
    eyeL:  { x: 0.435, y: 0.37,  width: 0.075 },
    eyeR:  { x: 0.555, y: 0.37,  width: 0.075 },
    skinTone: '#d8a988',
  },
  jenna: {
    mouth: { x: 0.50,  y: 0.525, width: 0.12 },
    eyeL:  { x: 0.425, y: 0.37,  width: 0.07 },
    eyeR:  { x: 0.555, y: 0.37,  width: 0.07 },
    skinTone: '#d8a886',
  },
  sara: {
    mouth: { x: 0.55,  y: 0.52,  width: 0.12 },
    eyeL:  { x: 0.49,  y: 0.32,  width: 0.07 },
    eyeR:  { x: 0.615, y: 0.32,  width: 0.07 },
    skinTone: '#e8c4a0',
  },
};

/**
 * @param {Object} props
 * @param {'nadia'|'jenna'|'sara'} props.personaId       — which face to render
 * @param {'nadia'|'jenna'|'sara'} props.activePersonaId — which face is selected
 * @param {'nadia'|'jenna'|'sara'|null} props.speakingPersonaId — which face is producing audio
 * @param {string} props.machineState                    — 'idle'|'listening'|'thinking'|'speaking'|'interrupted'|'error'
 * @param {HTMLAudioElement|null} props.audioElement     — the TTS audio source (only matters when speakingPersonaId === personaId)
 * @param {string} props.photo                           — image URL
 * @param {string} [props.alt]
 * @param {number} [props.size]                          — pixel size, default 96
 * @param {string} [props.accentColor]                   — used for listening glow ring
 */
export default function LivingAvatar(props) {
  var personaId        = props.personaId;
  var activePersonaId  = props.activePersonaId;
  var speakingPersonaId = props.speakingPersonaId;
  var machineState     = props.machineState;
  var audioElement     = props.audioElement;
  var photo            = props.photo;
  var alt              = props.alt || personaId;
  var size             = props.size || 96;
  var accentColor      = props.accentColor || '#6366f1';

  var anchors = DEFAULT_ANCHORS[personaId] || DEFAULT_ANCHORS.nadia;

  // ────────────────────────────────────────────────
  // Hard rule: only the active+speaking persona animates.
  // ────────────────────────────────────────────────
  var isActive   = personaId === activePersonaId;
  var isSpeaking = isActive && speakingPersonaId === personaId && machineState === 'speaking';
  var isListening = isActive && machineState === 'listening';

  // ────────────────────────────────────────────────
  // Mouth + blink state — local to this avatar.
  // ────────────────────────────────────────────────
  var mouthState = useState('closed');
  var mouthShape = mouthState[0];
  var setMouthShape = mouthState[1];
  var levelState = useState(0);
  var audioLevel = levelState[0];
  var setAudioLevel = levelState[1];

  var blinkState = useState(false);
  var blinking = blinkState[0];
  var setBlinking = blinkState[1];

  // Audio → mouth (only when this avatar is the speaking one)
  useMouthSync({
    audioElement: isSpeaking ? audioElement : null,
    speaking: isSpeaking,
    onShape: function (shape, level) {
      setMouthShape(shape);
      setAudioLevel(level);
    },
  });

  // Idle blinking (suppressed while speaking — blinks during talk look weird)
  useIdleBlink({
    paused: isSpeaking,
    onBlink: function (b) { setBlinking(b); },
  });

  // ────────────────────────────────────────────────
  // Compute pixel positions from normalized anchors.
  // ────────────────────────────────────────────────
  var mouthW = anchors.mouth.width * size;
  var mouthH = mouthShapeToHeight(mouthShape) * mouthW;
  var mouthX = anchors.mouth.x * size - mouthW / 2;
  var mouthY = anchors.mouth.y * size - mouthH / 2;

  var eyeW = anchors.eyeL.width * size;
  var eyeH = eyeW * 0.45;
  var blinkH = blinking ? eyeH : 0;
  var eyeLX = anchors.eyeL.x * size - eyeW / 2;
  var eyeLY = anchors.eyeL.y * size - blinkH / 2;
  var eyeRX = anchors.eyeR.x * size - eyeW / 2;
  var eyeRY = anchors.eyeR.y * size - blinkH / 2;

  // Listening pulse — soft red glow ring
  var glow = isListening ? 'rgba(239, 68, 68, 0.55)' :
             isSpeaking  ? accentColor + 'aa' :
             'transparent';

  return (
    <div
      role="img"
      aria-label={alt + ' avatar'}
      data-state={machineState}
      data-persona={personaId}
      data-speaking={isSpeaking ? 'true' : 'false'}
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        display: 'inline-block',
        opacity: isActive ? 1 : 0.55,
        filter: isActive ? 'none' : 'grayscale(0.4)',
        transition: 'opacity 0.25s ease, filter 0.25s ease',
      }}
    >
      {/* Glow ring for listening / speaking states */}
      <div
        style={{
          position: 'absolute',
          inset: -4,
          borderRadius: '50%',
          boxShadow: '0 0 0 2px ' + glow + ', 0 0 18px 4px ' + glow,
          opacity: (isListening || isSpeaking) ? 1 : 0,
          transition: 'opacity 0.25s ease',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          position: 'relative',
          background: '#1e293b',
        }}
      >
        <img
          src={photo}
          alt={alt}
          draggable={false}
          onError={function (e) {
            // Same fallback strategy as legacy AnimatedPortrait: persona
            // initial on a colored circle so missing files are obvious.
            e.currentTarget.style.display = 'none';
            var parent = e.currentTarget.parentNode;
            if (parent && !parent.querySelector('.living-avatar-fallback')) {
              var div = document.createElement('div');
              div.className = 'living-avatar-fallback';
              div.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:white;font-size:' + (size * 0.4) + 'px;font-weight:800;background:' + accentColor + ';';
              div.textContent = (alt || '?').charAt(0).toUpperCase();
              parent.appendChild(div);
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            userSelect: 'none',
          }}
        />

        {/* Eyelid overlays — appear only when blinking */}
        <div
          style={{
            position: 'absolute',
            left: eyeLX, top: eyeLY,
            width: eyeW, height: blinkH,
            background: anchors.skinTone,
            borderRadius: '50%',
            opacity: blinking ? 1 : 0,
            transition: 'height 0.05s linear, opacity 0.05s linear',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: eyeRX, top: eyeRY,
            width: eyeW, height: blinkH,
            background: anchors.skinTone,
            borderRadius: '50%',
            opacity: blinking ? 1 : 0,
            transition: 'height 0.05s linear, opacity 0.05s linear',
            pointerEvents: 'none',
          }}
        />

        {/* Mouth opening — sized by current shape */}
        <div
          style={{
            position: 'absolute',
            left: mouthX,
            top: mouthY,
            width: mouthW,
            height: mouthH,
            background: 'radial-gradient(ellipse at center, #2a1612 60%, #5a2a22 100%)',
            borderRadius: '50%',
            opacity: isSpeaking && mouthShape !== 'closed' ? Math.max(0.2, audioLevel * 1.1) : 0,
            transition: 'opacity 0.08s linear, height 0.05s linear, top 0.05s linear',
            pointerEvents: 'none',
            boxShadow: '0 0 3px 1px rgba(0,0,0,0.4) inset',
          }}
        />
      </div>
    </div>
  );
}

function mouthShapeToHeight(shape) {
  switch (shape) {
    case 'wide':   return 0.36;
    case 'medium': return 0.22;
    case 'small':  return 0.12;
    case 'closed':
    default:       return 0.06;
  }
}
