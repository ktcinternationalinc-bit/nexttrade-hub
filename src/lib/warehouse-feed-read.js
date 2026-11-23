// v55.83-YA (Max 23 Nov: "something broke with feeds") — read the warehouse feed's answer and say PLAINLY what went wrong,
// instead of the old "The warehouse feed answered 200".
// rev2 (Codex 23 Nov 22:15) — the message names only what THIS read shows: a real time-limit abort, a connection that broke
// while the list was arriving, or a list that arrived incomplete / damaged. It never states a size, a compression setting or a
// measured cause (the 23 Nov diagnosis was one observation, not a fact about every failure).
// Server-only helper (no 'use client'). It never puts the token or the body's text into a message — only its kind and size.

var NOTHING_CHANGED = ' Nothing was changed in the Hub.';

// (a) the time limit really fired (the caller's AbortController was aborted) while the list was still arriving
export function feedIncompleteMessage(secs) {
  return 'The warehouse answered, but the order list was still arriving after ' + (secs || 40) + ' seconds and was cut off — ' +
    'the warehouse may be sending it slowly; try again later.' + NOTHING_CHANGED;
}
// (b) reading the body failed and the time limit did NOT fire
export function feedBrokenMessage() {
  return 'The warehouse answered, but the connection broke while the order list was arriving; try again later.' + NOTHING_CHANGED;
}
// (c) the whole body arrived, but it is JSON that stops part-way or is malformed
export function feedDamagedMessage() {
  return 'The warehouse answered, but the order list arrived incomplete or damaged; try again later.' + NOTHING_CHANGED;
}

function abortedOf(ctl) { return !!(ctl && ctl.signal && ctl.signal.aborted); }

// res = the fetch Response; ctl = its AbortController (or null); secs = the time limit in seconds (for the message).
// The caller keeps its timer running until this has returned (the limit covers the WHOLE read, not just the headers).
// Returns { json } when the body is readable JSON, otherwise { error, incomplete?, aborted? } with a plain message.
export async function readFeedBody(res, ctl, secs) {
  if (!res || typeof res.text !== 'function') { // a Response without text() (older callers / test doubles): parse as before
    var jj = null; var bad = false;
    try { jj = await res.json(); } catch (eJ0) { bad = true; }
    if (bad && abortedOf(ctl)) { return { error: feedIncompleteMessage(secs), incomplete: true, aborted: true }; }
    return jj && typeof jj === 'object' ? { json: jj } : { error: 'The warehouse answered ' + (res && res.status) + ' but did not send a readable order list.' + NOTHING_CHANGED };
  }
  var text = null; var failed = false;
  try { text = await res.text(); } catch (eT) { failed = true; }
  if (failed) {
    if (abortedOf(ctl)) { return { error: feedIncompleteMessage(secs), incomplete: true, aborted: true }; }
    return { error: feedBrokenMessage(), incomplete: true };
  }
  var j = null;
  try { j = JSON.parse(text); } catch (eJ) { j = null; }
  if (j && typeof j === 'object') { return { json: j }; } // the whole list arrived and parses
  if (abortedOf(ctl)) { return { error: feedIncompleteMessage(secs), incomplete: true, aborted: true }; }
  var t = String(text || '');
  if (/^\s*[\{\[]/.test(t)) { return { error: feedDamagedMessage(), incomplete: true }; } // JSON that stops part-way or is malformed
  var kind = /^\s*</.test(t) ? 'a web page' : (t.trim() ? 'text' : 'an empty answer');
  return { error: 'The warehouse answered ' + res.status + ' but did not send the order list (it sent ' + kind + ', ' + t.length + ' characters) — it may be showing a sign-in, error or maintenance page.' + NOTHING_CHANGED };
}
