// v55.83-UM (Codex UK follow-up) — the "Are you sure?" rules, as plain functions a test can drive without a browser.
//  • a new question while one is still open answers the open one NO (a click never waits forever, never becomes a yes)
//  • Confirm answers YES, Cancel / Esc / clicking outside answers NO
//  • with no message provider at all, a question is answered NO with a visible notice — never an automatic yes
export function nextConfirmState(prev, opts, resolve) {
  if (prev && typeof prev.resolve === 'function') { prev.resolve(false); }
  return Object.assign({}, opts || {}, { resolve: resolve });
}
export function answerConfirm(state, yes) {
  if (state && typeof state.resolve === 'function') { state.resolve(yes === true); }
  return null;
}
export var HUB_TOAST_FALLBACK = {
  success: function (m) { try { console.warn('[hub] message (no provider):', m); } catch (e) { /* ignore */ } },
  error: function (m) { try { console.error('[hub] error (no provider):', m); } catch (e) { /* ignore */ } },
  warning: function (m) { try { console.warn('[hub] warning (no provider):', m); } catch (e) { /* ignore */ } },
  info: function (m) { try { console.info('[hub] info (no provider):', m); } catch (e) { /* ignore */ } },
  confirm: function () {
    try { if (typeof window !== 'undefined' && window.alert) { window.alert('The confirmation box could not open, so nothing was done. Please reload the page and try again.'); } } catch (e) { /* ignore */ }
    return Promise.resolve(false);
  },
};
