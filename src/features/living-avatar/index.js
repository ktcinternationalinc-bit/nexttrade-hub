// ============================================================
// Living Avatar — public exports
// ============================================================
// Single import surface for the parallel new avatar system.
// The legacy AIGreeter + AnimatedPortrait are NOT touched by this module.
// ============================================================

export { default as LivingAvatar } from './components/LivingAvatar.jsx';
export { default as LivingCompanionPanel } from './components/LivingCompanionPanel.jsx';
export { useMouthSync } from './hooks/useMouthSync.js';
export { useIdleBlink } from './hooks/useIdleBlink.js';
export { useMicrophone } from './hooks/useMicrophone.js';
export { useAudioPlaybackQueue } from './hooks/useAudioPlaybackQueue.js';
export { useCompanionSocket } from './hooks/useCompanionSocket.js';
export { livingAvatarMachine, INITIAL_CONTEXT, getDisplayState } from './lib/avatar-machine.js';
export { MESSAGE_TYPES, buildMessage, isStale } from './lib/wire-schema.js';
export { isLivingAvatarEnabled, setLivingAvatarEnabled } from './feature-flag.js';
