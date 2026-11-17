// v55.83-TO (Codex QA 16 Nov, P1) — browser helper for calls to Hub routes that MOVE MONEY.
// 1. sends the signed-in person's verified token (the server acts for that person, never for a user_id in the body);
// 2. gives each click ONE request id, so a retry after a lost answer is recognised and never pays twice.
// Same arguments as fetch(url, init). Client-side only.
import { supabase } from './supabase';

var MONEY_ACTIONS = { record_payment: 1, pay_bills_from_bank: 1, void_payment: 1, link_deposit: 1, close_order: 1 };
function newRequestId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) { return crypto.randomUUID(); } } catch (e) { /* older browser */ }
  return 'r' + Date.now().toString(36) + Math.random().toString(36).substring(2, 12);
}

export function hubFetch(url, init) {
  var opts = Object.assign({}, init || {});
  try {
    if (typeof opts.body === 'string') {
      var b = JSON.parse(opts.body);
      if (b && MONEY_ACTIONS[b.action] && !b.request_id) { b.request_id = newRequestId(); opts.body = JSON.stringify(b); }
    }
  } catch (eB) { /* not JSON — sent as is */ }
  return supabase.auth.getSession().then(function (s) {
    var token = s && s.data && s.data.session ? s.data.session.access_token : '';
    opts.headers = Object.assign({}, opts.headers || {}, token ? { Authorization: 'Bearer ' + token } : {});
    return fetch(url, opts);
  }, function () { return fetch(url, opts); });
}
