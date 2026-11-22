// v55.83-XU (Codex 22 Nov 20:34) — what a ONE-line screen (Bank Review, a Profitability expense line) says after "Remove category":
// the line's own reason when it was kept (the screen has no list to point to), a generic sentence for a line the person may not
// see, the plain message when it worked. Browser-safe. var + concat.
export function singleLineWords(j) {
  if (!j || j.ok !== true) { return { ok: false, text: (j && j.error) || 'Nothing was changed.' }; }
  if ((j.cleared || []).length) { return { ok: true, text: 'Category removed — the line is Uncategorized now and rules will not fill it again.' }; }
  var x = (j.refused || [])[0];
  if (x && x.restricted) { return { ok: false, text: 'Category kept: you may not change this line.' }; }
  if (x && x.why) { return { ok: false, text: 'Category kept: ' + x.why + '.' }; }
  if (j.already) { return { ok: false, text: 'This line has no category already.' }; }
  return { ok: false, text: 'Nothing was changed.' };
}
