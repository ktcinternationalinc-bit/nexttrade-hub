// ============================================================
// LivingCompanionPanel — drop-in integrated panel
// ============================================================
// v55.83-A.6.27.72 HOTFIX 22.
//
// A complete, working integration showing how all the pieces fit:
//
//   useCompanionSocket  →  XState machine + socket transport + audio
//        │
//        ├─→ speakingAudioElement → useMouthSync inside LivingAvatar
//        │
//        ├─→ state ('idle' | 'listening' | 'thinking' | 'speaking' | …)
//        │
//        └─→ startConversation() / interrupt() / switchPersona() / sendText()
//
// This component is the canonical example. A real consumer (e.g. inside
// AssistantsBar or a dedicated /companion page) can copy this layout or
// build a custom UI using the same hook return.
//
// IMPORTANT: this component must be rendered behind the feature flag.
// See feature-flag.js and the usage example at the bottom of this file.
// ============================================================

import { useState } from 'react';
import { useCompanionSocket } from '../hooks/useCompanionSocket.js';
import LivingAvatar from './LivingAvatar.jsx';

// Persona display metadata. Mirrors agent-personalities.js on the legacy
// side so the visual language stays consistent.
var PERSONAS = {
  nadia: {
    name: 'Nadia',
    role: 'Executive Assistant',
    photo: '/avatars/nadia.png',
    accent: '#6366f1',
    panelBorder: 'border-indigo-200',
    badge: 'bg-indigo-600',
  },
  jenna: {
    name: 'Jenna',
    role: 'HR Representative',
    photo: '/avatars/jenna.png',
    accent: '#f43f5e',
    panelBorder: 'border-rose-200',
    badge: 'bg-rose-600',
  },
  sara: {
    name: 'Sara',
    role: 'Work Coach',
    photo: '/avatars/sara.png',
    accent: '#06b6d4',
    panelBorder: 'border-cyan-200',
    badge: 'bg-cyan-600',
  },
};

/**
 * @param {Object} props
 * @param {string} props.serverUrl   — Living Companion Server URL (Railway)
 * @param {'nadia'|'jenna'|'sara'} [props.initialPersona]
 * @param {string} [props.authToken] — optional Supabase JWT
 */
export default function LivingCompanionPanel(props) {
  var initialPersona = props.initialPersona || 'nadia';

  var companion = useCompanionSocket({
    serverUrl: props.serverUrl,
    initialPersona: initialPersona,
    authToken: props.authToken,
    autoConnect: true,
  });

  var textState = useState('');
  var typedMessage = textState[0];
  var setTypedMessage = textState[1];

  var current = PERSONAS[companion.personaId] || PERSONAS.nadia;

  // ────────────────────────────────────────────────
  // Render: three avatars side-by-side (only the active one animates),
  // status strip, transcript area, controls.
  // ────────────────────────────────────────────────
  return (
    <div className={'bg-white rounded-2xl border-2 shadow-sm p-5 ' + current.panelBorder}>
      {/* Connection state strip */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-xs font-bold">
          <span className={'inline-block w-2 h-2 rounded-full ' + (companion.isConnected ? 'bg-emerald-500' : 'bg-slate-400')} />
          <span className="text-slate-700">{companion.isConnected ? 'Connected' : 'Connecting…'}</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-700 uppercase tracking-wider text-[10px]">{companion.state}</span>
        </div>
        {companion.error && (
          <div className="text-[11px] text-red-700 font-bold truncate max-w-[60%]" title={companion.error}>
            ⚠ {companion.error}
          </div>
        )}
      </div>

      {/* Three avatars in a row. Only the active+speaking one animates. */}
      <div className="flex justify-center items-end gap-6 mb-5">
        {['nadia', 'jenna', 'sara'].map(function (p) {
          var meta = PERSONAS[p];
          var isActive = companion.personaId === p;
          return (
            <button
              key={p}
              onClick={function () { if (!isActive) companion.switchPersona(p); }}
              className="flex flex-col items-center gap-2 group"
              aria-label={'Switch to ' + meta.name}
            >
              <LivingAvatar
                personaId={p}
                activePersonaId={companion.personaId}
                speakingPersonaId={companion.speakingPersonaId}
                machineState={companion.state}
                audioElement={companion.speakingAudioElement}
                photo={meta.photo}
                alt={meta.name}
                size={isActive ? 110 : 80}
                accentColor={meta.accent}
              />
              <div className="text-center">
                <div className={'text-xs font-extrabold ' + (isActive ? 'text-slate-900' : 'text-slate-500')}>
                  {meta.name}
                </div>
                <div className={'text-[9px] font-bold uppercase tracking-wide ' + (isActive ? 'text-slate-700' : 'text-slate-400')}>
                  {meta.role}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Status badge for the active persona */}
      <div className="text-center mb-4">
        <span className={'inline-block px-3 py-1 rounded-full text-white text-[10px] font-extrabold uppercase tracking-widest ' + current.badge}>
          {stateLabel(companion.state)}
        </span>
      </div>

      {/* Transcript + response — gives the user a written record alongside the audio */}
      <div className="space-y-2 mb-4 min-h-[80px]">
        {companion.transcript && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">You said</div>
            <div className="text-sm text-slate-900">{companion.transcript}</div>
          </div>
        )}
        {companion.responseText && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 mb-1">{current.name}</div>
            <div className="text-sm text-slate-900">{companion.responseText}</div>
          </div>
        )}
      </div>

      {/* Controls. The "Start Conversation" button is the user gesture that
          unlocks audio playback per Max's guardrail #2. Once unlocked, the
          UI flips to the in-conversation controls. */}
      {!companion.isUnlocked ? (
        <div className="text-center">
          <button
            onClick={companion.startConversation}
            disabled={!companion.isConnected}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-base font-extrabold rounded-xl shadow-md transition"
          >
            🎙 Start Conversation
          </button>
          <div className="text-[11px] text-slate-600 mt-2 font-medium">
            Tap to allow microphone + audio. {current.name} will be listening.
          </div>
        </div>
      ) : (
        <>
          {/* In-conversation controls: interrupt button + text fallback */}
          <div className="flex gap-2 mb-2">
            <button
              onClick={function () { companion.interrupt('manual'); }}
              disabled={companion.state !== 'speaking' && companion.state !== 'thinking'}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-extrabold rounded-lg transition"
              title="Stop the avatar mid-sentence (barge-in)"
            >
              ⏹ Stop
            </button>
            <button
              onClick={companion.stopMic}
              className="flex-1 px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-900 text-sm font-bold rounded-lg transition"
              title="Stop the microphone (end the conversation)"
            >
              🔇 Mute mic
            </button>
          </div>
          {/* Text input fallback for noisy environments */}
          <form
            onSubmit={function (e) {
              e.preventDefault();
              if (typedMessage.trim()) {
                companion.sendText(typedMessage);
                setTypedMessage('');
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={typedMessage}
              onChange={function (e) { setTypedMessage(e.target.value); }}
              placeholder={'Type a message to ' + current.name + '…'}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-medium"
            />
            <button
              type="submit"
              disabled={!typedMessage.trim()}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white text-sm font-bold rounded-lg transition"
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function stateLabel(state) {
  switch (state) {
    case 'idle':         return '⚪ Ready';
    case 'listening':    return '🔴 Listening';
    case 'thinking':     return '💭 Thinking';
    case 'speaking':     return '🗣 Speaking';
    case 'interrupted':  return '⏹ Interrupted';
    case 'error':        return '⚠ Error';
    default:             return state;
  }
}

// ============================================================
// Usage in a parent page (e.g. inside the dashboard or a /companion route)
// ============================================================
//
// import { isLivingAvatarEnabled } from '@/features/living-avatar';
// import LivingCompanionPanel from '@/features/living-avatar/components/LivingCompanionPanel';
//
// export default function DashboardPage() {
//   if (!isLivingAvatarEnabled()) {
//     return <LegacyAssistantsBar />; // legacy HTTP-based avatars
//   }
//   return (
//     <LivingCompanionPanel
//       serverUrl={process.env.NEXT_PUBLIC_COMPANION_SERVER_URL}
//       initialPersona="nadia"
//     />
//   );
// }
//
// Add to .env.local:
//   NEXT_PUBLIC_COMPANION_SERVER_URL=https://your-app.up.railway.app
// ============================================================
