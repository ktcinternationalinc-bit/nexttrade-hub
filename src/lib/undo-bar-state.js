// v55.83-WS (Codex 21 Nov 08:28, P2) — after an Undo that did not finish, does the Undo bar stay on screen? Decided from the
// SHAPE of the answer, never from its English words:
//   • the server says the undo can be run again (retryable: true — e.g. the line was put back but the look-alike lines could
//     not be read) → keep the bar, with the same undo point, so the person can finish it;
//   • no answer from the server at all (a network or page error made in the browser — every server answer of this route carries
//     api_build_marker) → keep the bar: nothing was decided, the person can try again;
//   • any other refusal (changed since, already undone, too old, not allowed, sent to Wave, in the ledger…) → final: hide it.
export function keepUndoBar(j) {
  if (!j || typeof j !== 'object') { return true; }
  if (j.ok === true) { return false; }
  if (j.retryable === true) { return true; }
  return !Object.prototype.hasOwnProperty.call(j, 'api_build_marker');
}
// a partial result changed some lines already: the screen reloads so it shows them as they are now
export function undoChangedSomething(j) { return !!(j && j.partial === true); }
