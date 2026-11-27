// v55.83-AAA rev4 (Codex 27 Nov HOLD: "fetchAll reads only data, ignoring returned query error; {data:null,error:...} resolves as an
// empty array") — read every page of a list, and STOP WITH AN ERROR when any page (the first or a later one) comes back with an error or
// without data. A failed read must never look like "there are no rows": the work feed would then mark real work as resolved.
// runPage(from, to) → a Supabase query promise { data, error }.
export async function fetchAllPagesStrict(runPage, batch) {
  var size = batch || 1000; var all = []; var from = 0;
  for (var guard = 0; guard < 1000; guard++) {
    var res = await runPage(from, from + size - 1);
    if (!res || res.error) { throw new Error('page ' + (guard + 1) + ' could not be read' + (res && res.error && res.error.message ? ': ' + res.error.message : '')); }
    if (!Array.isArray(res.data)) { throw new Error('page ' + (guard + 1) + ' came back without rows'); }
    all = all.concat(res.data);
    if (res.data.length < size) { return all; }
    from += size;
  }
  throw new Error('too many pages');
}
