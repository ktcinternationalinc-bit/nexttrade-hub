// v55.83-VV — the decisions of the one-file bill import screen about PAGES, kept out of the screen so a test can RUN them:
// what the page box holds after a read, and whether Save is allowed. Pure: no React, no network.
// This is a guard of THIS screen only. The server does not know whether the person ticked the box (Codex 21:26: not
// claimed as server enforcement).

// j = the extract_bill answer; browserCount = pages counted in the browser (may be null).
// → null (nothing to show: a valid one-page file or a photo) or the box state. `confirmed` ALWAYS starts false:
//   every new file and every re-read asks for the tick again.
export function importPagesState(j, browserCount) {
  var pgs = (j && j.pages) || null;
  if (!pgs) { return null; }
  var n = pgs.count || browserCount || null;
  if (!(n > 1 || pgs.status === 'unclear')) { return null; }
  var pick = {}; (pgs.used || []).forEach(function (u) { pick[u] = true; });
  return { pages: pgs, count: n || 1, pick: pick, review: !!(j && j.pages_need_review === true), confirmed: false };
}
// the pages a person ticked, sorted
export function pickedPages(state) {
  var want = []; Object.keys((state && state.pick) || {}).forEach(function (k) { if (state.pick[k]) { want.push(Number(k)); } });
  want.sort(function (a, b) { return a - b; });
  return want;
}
// the read's problems without the page sentence when that sentence has its own box
export function problemsBesidesPages(j, state) {
  var w = state && state.pages ? state.pages.words : null;
  return ((j && j.problems) || []).filter(function (p) { return !(w && p === w); });
}
// where a release taken from an attached page came from — kept in the bill's notes
export function releaseSourceNote(pgs) {
  return (pgs && pgs.release_from_attached) ? 'Release ' + pgs.attached_release + ' taken from an attached page (page ' + pgs.attached_release_page + '), not printed on the bill itself.' : '';
}
export function notesWithReleaseSource(notes, pgs) {
  var r = releaseSourceNote(pgs); var n = String(notes || '');
  return (n + (r ? (n ? ' · ' : '') + r : '')).substring(0, 500);
}
export var PAGES_CONFIRMED_NOTE = 'Pages not confirmed by the reader — fields checked against the bill by the person who saved it.';
export var PAGES_BLOCK_MESSAGE = 'NOT SAVED — the pages of this file are not confirmed. Check the fields against the bill itself, then tick the box in the red area, or pick the pages.';
// d = the bill being saved (the form); state = the box state. → { blocked, message, notes }
// Only a NEW imported bill whose pages need review is gated; when the person ticked, the fact is written into the notes (once).
export function importSaveGate(d, state) {
  var bill = d || {}; var notes = bill.notes == null ? '' : String(bill.notes);
  if (!(bill._imported && !bill.id && state && state.review)) { return { blocked: false, message: null, notes: bill.notes }; }
  if (!state.confirmed) { return { blocked: true, message: PAGES_BLOCK_MESSAGE, notes: bill.notes }; }
  if (notes.indexOf('Pages not confirmed by the reader') >= 0) { return { blocked: false, message: null, notes: notes }; }
  return { blocked: false, message: null, notes: (notes + (notes ? ' · ' : '') + PAGES_CONFIRMED_NOTE).substring(0, 900) };
}
