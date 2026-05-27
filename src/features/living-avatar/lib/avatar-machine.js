// ============================================================
// Living Avatar — conversational state machine
// ============================================================
// v55.83-A.6.27.72 HOTFIX 18 — XState 5 machine.
//
// Atomic states the avatar can be in:
//   idle         — not engaged. Mic off, no audio, blinks + breath only.
//   listening    — mic open, STT streaming partials.
//   thinking     — STT finalized, LLM is generating but no TTS yet.
//   speaking     — TTS audio is playing; mouth animates from analyser.
//   interrupted  — user barged in. Audio MUST stop within 1s. Transient.
//   error        — recoverable error surface; user can retry or reset.
//
// Why this matters: the previous AIGreeter used boolean React state
// (`speaking`, `listening`, `loading`) — which means glitches like
// "both speaking AND listening" or "loading after interrupt" can sneak in.
// One enum, one transition function = zero race-condition surface.
//
// Events the machine listens to:
//   START_LISTEN, STOP_LISTEN
//   STT_PARTIAL, STT_FINAL
//   LLM_PARTIAL, LLM_FINAL
//   TTS_FIRST_CHUNK, TTS_END
//   INTERRUPT  ←  the "break" command. Fires from voice OR text OR button.
//   SWITCH_PERSONA
//   ERROR, RESET
//
// Context held alongside the state:
//   conversationId, personaId, sequenceId, lastTranscript, lastResponseText
// ============================================================

import { setup, assign } from 'xstate';

/**
 * @typedef {Object} AvatarContext
 * @property {string}  conversationId
 * @property {'nadia'|'jenna'|'sara'} personaId
 * @property {number}  sequenceId           — bumped on interrupt / persona switch
 * @property {string}  lastTranscript
 * @property {string}  lastResponseText
 * @property {string|null} errorMessage
 */

export var INITIAL_CONTEXT = {
  conversationId: '',
  personaId: 'nadia',
  sequenceId: 0,
  lastTranscript: '',
  lastResponseText: '',
  errorMessage: null,
};

export var livingAvatarMachine = setup({
  types: {
    /** @type {{ context: AvatarContext, events: any }} */
    context: /** @type {AvatarContext} */ ({}),
  },
  actions: {
    // Increment sequenceId — any in-flight server message with a lower id
    // will be dropped by the websocket adapter (see isStale in wire-schema).
    bumpSequence: assign(function (args) {
      return { sequenceId: args.context.sequenceId + 1 };
    }),
    storeTranscript: assign(function (args) {
      return { lastTranscript: (args.event && args.event.text) || '' };
    }),
    storeResponse: assign(function (args) {
      return { lastResponseText: (args.event && args.event.text) || args.context.lastResponseText };
    }),
    switchPersona: assign(function (args) {
      return { personaId: args.event.toPersona };
    }),
    storeError: assign(function (args) {
      return { errorMessage: (args.event && args.event.message) || 'Unknown error' };
    }),
    clearError: assign(function () {
      return { errorMessage: null };
    }),
    newConversation: assign(function () {
      return {
        conversationId: typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2),
        sequenceId: 0,
        lastTranscript: '',
        lastResponseText: '',
        errorMessage: null,
      };
    }),
    // Side-effects: cleanup hooks fire these via emit-style actions.
    // The component subscribes to context.sequenceId changes and tears down
    // audio + animation frames whenever it bumps.
    notifyStopAudio: function () { /* component subscribes via useSelector */ },
    notifyStartListening: function () { /* idem */ },
  },
  guards: {
    // Only allow INTERRUPT in states where it makes sense.
    canInterrupt: function (args) {
      // Always allow interrupt from any non-idle non-error state.
      // The machine itself doesn't know which state called — XState chooses
      // the matching transition based on current state. This guard is here
      // as a safety net for global INTERRUPT routed by the parent.
      var s = args.state;
      return s !== 'idle' && s !== 'error';
    },
  },
}).createMachine({
  id: 'livingAvatar',
  initial: 'idle',
  context: INITIAL_CONTEXT,
  on: {
    // Global transitions — work from any state.
    SWITCH_PERSONA: {
      // Persona switch == implicit interrupt. Bump sequence, change persona,
      // land back in idle so the new persona starts fresh.
      target: '.idle',
      actions: ['bumpSequence', 'switchPersona', 'notifyStopAudio'],
    },
    RESET: {
      target: '.idle',
      actions: ['bumpSequence', 'clearError', 'notifyStopAudio'],
    },
  },
  states: {
    idle: {
      on: {
        START_LISTEN: {
          target: 'listening',
          actions: ['newConversation', 'notifyStartListening'],
        },
        // User typed a message — skip listening, go straight to thinking.
        TEXT_INPUT: {
          target: 'thinking',
          actions: ['newConversation', 'storeTranscript'],
        },
      },
    },
    listening: {
      on: {
        STT_PARTIAL: {
          target: 'listening',
          actions: ['storeTranscript'],
        },
        STT_FINAL: {
          target: 'thinking',
          actions: ['storeTranscript'],
        },
        STOP_LISTEN: 'idle',
        ERROR: {
          target: 'error',
          actions: ['storeError'],
        },
      },
    },
    thinking: {
      on: {
        LLM_PARTIAL: {
          target: 'thinking',
          actions: ['storeResponse'],
        },
        TTS_FIRST_CHUNK: 'speaking',
        // Edge case: LLM finished but TTS failed — just go back to idle with
        // the text response visible. Don't lock up.
        LLM_FINAL_NO_AUDIO: 'idle',
        INTERRUPT: {
          target: 'interrupted',
          actions: ['bumpSequence', 'notifyStopAudio'],
        },
        ERROR: {
          target: 'error',
          actions: ['storeError'],
        },
      },
    },
    speaking: {
      on: {
        TTS_END: 'idle',
        INTERRUPT: {
          target: 'interrupted',
          actions: ['bumpSequence', 'notifyStopAudio'],
        },
        ERROR: {
          target: 'error',
          actions: ['storeError'],
        },
      },
    },
    interrupted: {
      // Transient state. Once cleanup completes, fall back to listening so
      // the user can immediately follow up the interrupt with their new
      // request — that's what "barge-in" means in practice.
      after: {
        300: { target: 'listening', actions: ['notifyStartListening'] },
      },
      on: {
        STOP_LISTEN: 'idle',
      },
    },
    error: {
      on: {
        RESET: {
          target: 'idle',
          actions: ['clearError'],
        },
      },
    },
  },
});

// ============================================================
// Helper — derive a public string state name for UI consumption.
// Keeps consumers from importing XState internals everywhere.
// ============================================================
export function getDisplayState(snapshot) {
  if (!snapshot || !snapshot.value) return 'idle';
  return /** @type {'idle'|'listening'|'thinking'|'speaking'|'interrupted'|'error'} */ (snapshot.value);
}
