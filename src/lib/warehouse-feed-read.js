// v55.83-YA (Max 23 Nov: "something broke with feeds") — read the warehouse feed's answer and say PLAINLY what went wrong.
// The staging warehouse sends its ~10 MB list slowly (no compression); the Hub stops waiting after its time limit, the list
// arrives cut off, and the old message only said "The warehouse feed answered 200". This tells the person what really happened.
// Server-only helper (no 'use client'). It never puts the token or the body's text into a message — only its kind and size.

export function feedIncompleteMessage(secs) {
  return 'The warehouse answered, but the order list was still arriving after ' + (secs || 40) + ' seconds and came in incomplete — ' +
    'the warehouse is sending it too slowly (the list is about 10 MB and not compressed). Nothing was changed in the Hub; try again later.';
}

// res = the fetch Response; ctl = its AbortController (or null); secs = the time limit in seconds (for the message).
// Returns { json } when the body is readable JSON, otherwise { error, incomplete } with a plain message.
export async function readFeedBody(res, ctl, secs) {
  var text = null; var failed = false;
  if (!res || typeof res.text !== 'function') { // a Response without text() (older callers / test doubles): parse as before
    var jj = null; var bad = false;
    try { jj = await res.json(); } catch (eJ0) { bad = true; }
    if (bad && ctl && ctl.signal && ctl.signal.aborted) { return { error: feedIncompleteMessage(secs), incomplete: true }; }
    return jj && typeof jj === 'object' ? { json: jj } : { error: 'The warehouse answered ' + (res && res.status) + ' but did not send a readable order list. Nothing was changed in the Hub.' };
  }
  try { text = await res.text(); } catch (eT) { failed = true; }
  var aborted = !!(ctl && ctl.signal && ctl.signal.aborted);
  if (failed || aborted) { return { error: feedIncompleteMessage(secs), incomplete: true }; }
  var j = null;
  try { j = JSON.parse(text); } catch (eJ) { j = null; }
  if (j && typeof j === 'object') { return { json: j }; }
  var t = String(text || '');
  if (/^\s*\{/.test(t)) { return { error: feedIncompleteMessage(secs), incomplete: true }; } // a JSON list that stops part-way
  var kind = /^\s*</.test(t) ? 'a web page' : (t.trim() ? 'text' : 'an empty answer');
  return { error: 'The warehouse answered ' + res.status + ' but did not send the order list (it sent ' + kind + ', ' + t.length + ' characters) — it may be showing a sign-in, error or maintenance page. Nothing was changed in the Hub.' };
}
