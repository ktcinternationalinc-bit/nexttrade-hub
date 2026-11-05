// Browser capability state. The server owns authorization; roles and ordinary
// module-permission flags never grant bank balance access here.
export var EMPTY_BANK_VISIBILITY = Object.freeze({
  canViewFullDashboard: false,
  canViewBankBalances: false,
  isVerifiedSuperAdmin: false,
  loading: true,
  error: '',
});

export async function bankSessionHeaders(client, json) {
  var session = await client.auth.getSession();
  var token = session && session.data && session.data.session && session.data.session.access_token;
  if (session.error || typeof token !== 'string' || !token) throw new Error('Sign in again to continue.');
  var headers = { Authorization: 'Bearer ' + token };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export function createBankVisibilityStore(options) {
  var state = EMPTY_BANK_VISIBILITY;
  var listeners = new Set();
  var active = false, signedOut = false, generation = 0;
  var controller = null, timer = null, authSubscription = null, authTimer = null;
  var win = options.window, doc = options.document;
  var schedule = options.setTimeout || setTimeout, unschedule = options.clearTimeout || clearTimeout;
  var every = options.setInterval || setInterval, cancelEvery = options.clearInterval || clearInterval;

  function publish(next) {
    state = next;
    listeners.forEach(function (listener) { listener(); });
  }
  function close(error, loading) {
    publish({ canViewFullDashboard: false, canViewBankBalances: false, isVerifiedSuperAdmin: false, loading: loading === true, error: error || '' });
  }
  function cancel() {
    generation += 1;
    if (controller) controller.abort();
    controller = null;
  }

  async function refresh() {
    if (!active || signedOut || (doc && doc.visibilityState === 'hidden')) return;
    cancel();
    var current = generation;
    var requestController = new AbortController();
    controller = requestController;
    var timeout = schedule(function () { requestController.abort(); }, 10000);
    try {
      var headers = await bankSessionHeaders(options.client, false);
      if (!active || current !== generation) return;
      var response = await options.fetch('/api/bank-visibility', {
        headers: headers, cache: 'no-store', redirect: 'error', signal: requestController.signal,
      });
      if (!active || current !== generation) return;
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error(response.status === 503 ? 'Financial data permissions need server setup.' : 'Financial data access could not be verified.');
      }
      var body = await response.json();
      if (!active || current !== generation) return;
      var caps = body && body.capabilities;
      if (body.ok !== true || !caps || typeof caps.canViewFullDashboard !== 'boolean' || typeof caps.canViewBankBalances !== 'boolean' || typeof caps.isVerifiedSuperAdmin !== 'boolean') {
        throw new Error('Financial data access could not be verified.');
      }
      publish({ canViewFullDashboard: caps.canViewFullDashboard, canViewBankBalances: caps.canViewBankBalances, isVerifiedSuperAdmin: caps.isVerifiedSuperAdmin, loading: false, error: '' });
    } catch (error) {
      if (active && current === generation) close(error && error.name === 'AbortError' ? 'Financial data access could not be verified.' : error && error.message || 'Financial data access could not be verified.', false);
    } finally {
      unschedule(timeout);
      if (controller === requestController) controller = null;
    }
  }

  function invalidate() {
    cancel();
    close('', true);
    return refresh();
  }
  function onFocus() { void refresh(); }
  function onVisibility() { if (!doc || doc.visibilityState !== 'hidden') void refresh(); }
  function onPermissionChange() { void invalidate(); }
  function start() {
    if (active) return;
    active = true; signedOut = false;
    var result = options.client.auth.onAuthStateChange(function (event) {
      if (!['SIGNED_OUT', 'SIGNED_IN', 'USER_UPDATED', 'TOKEN_REFRESHED', 'INITIAL_SESSION'].includes(event)) return;
      cancel();
      close('', event !== 'SIGNED_OUT');
      signedOut = event === 'SIGNED_OUT';
      if (authTimer !== null) unschedule(authTimer);
      // Supabase auth callbacks run under its session lock. Read the new session
      // after the callback has returned, never await getSession in the callback.
      if (!signedOut) authTimer = schedule(function () { authTimer = null; void refresh(); }, 0);
    });
    authSubscription = result && result.data && result.data.subscription;
    if (win) { win.addEventListener('focus', onFocus); win.addEventListener('bank-visibility-changed', onPermissionChange); }
    if (doc) doc.addEventListener('visibilitychange', onVisibility);
    timer = every(function () { void refresh(); }, 60000);
    void refresh();
  }
  function stop() {
    active = false; cancel();
    if (timer !== null) cancelEvery(timer);
    if (authTimer !== null) unschedule(authTimer);
    timer = null; authTimer = null;
    if (authSubscription) authSubscription.unsubscribe();
    authSubscription = null;
    if (win) { win.removeEventListener('focus', onFocus); win.removeEventListener('bank-visibility-changed', onPermissionChange); }
    if (doc) doc.removeEventListener('visibilitychange', onVisibility);
    state = EMPTY_BANK_VISIBILITY;
  }
  return {
    getSnapshot: function () { return state; },
    subscribe: function (listener) {
      listeners.add(listener);
      start();
      return function () { listeners.delete(listener); if (!listeners.size) stop(); };
    },
    refresh: refresh,
    invalidate: invalidate,
  };
}
