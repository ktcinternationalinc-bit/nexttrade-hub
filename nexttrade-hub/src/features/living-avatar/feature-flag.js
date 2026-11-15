// ============================================================
// Living Avatar — feature flag
// ============================================================
// v55.83-A.6.27.72 HOTFIX 18 — Parallel build per Max May 27 2026.
//
// The legacy AIGreeter + AnimatedPortrait keep working untouched. The new
// Living Avatar architecture lives in /src/features/living-avatar/ and is
// gated behind this flag. When true, the new <LivingAvatar/> takes over.
// When false (default), the existing avatars are used.
//
// To enable for the current user, set localStorage.useLivingAvatar = '1'.
// To enable globally for everyone, change DEFAULT_ENABLED to true here.
// ============================================================

var DEFAULT_ENABLED = false;

export function isLivingAvatarEnabled() {
  // Server-side render path — always false to avoid hydration mismatch.
  if (typeof window === 'undefined') return DEFAULT_ENABLED;
  try {
    var stored = window.localStorage.getItem('useLivingAvatar');
    if (stored === '1' || stored === 'true') return true;
    if (stored === '0' || stored === 'false') return false;
  } catch (e) {
    // localStorage may throw in private modes
  }
  return DEFAULT_ENABLED;
}

export function setLivingAvatarEnabled(enabled) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('useLivingAvatar', enabled ? '1' : '0');
  } catch (e) {}
}

// v55.83-A.6.27.72 HOTFIX 19 — expose the toggles on window so Max can
// flip the feature flag straight from the browser console without
// importing anything:
//   window.setLivingAvatarEnabled(true)   // turn on
//   window.setLivingAvatarEnabled(false)  // turn off
//   window.isLivingAvatarEnabled()        // check current
if (typeof window !== 'undefined') {
  window.setLivingAvatarEnabled = setLivingAvatarEnabled;
  window.isLivingAvatarEnabled = isLivingAvatarEnabled;
}
