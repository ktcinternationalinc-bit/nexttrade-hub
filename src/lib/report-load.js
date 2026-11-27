// v55.83-ZQ (Codex re-review of ZN rev2, 26/27 Nov, P2): Profitability's report load, in one place, so it can be tested as it runs.
// Every load is numbered (seqRef). An answer that is no longer the NEWEST load's answer changes NOTHING: not the report data, not
// the dates shown, not the refresh status / error, not the busy flag, no message. Before, only the status was guarded, so two
// reloads finishing out of order (the newer one first) left the newer "ok" status on top of the OLDER figures, and the fix list
// could say "Still open" (or a false "Fixed"). Client-side, no network of its own: d.call does the request.
//   d = { seqRef: { current }, call(payload) → Promise<answer>, setRefresh, setBusy, setData, setApplied, toastError(text) }
//   returns Promise<true (this load's report is now shown) | false (it failed, or a newer load replaced it)>
export function runReportLoad(d, f, t) {
  var my = ++d.seqRef.current;
  function current() { return my === d.seqRef.current; }
  d.setRefresh({ seq: my, state: 'loading', error: '' });
  d.setBusy(true);
  function fail(er) {
    if (!current()) { return false; } // a newer load is running or done: its outcome is the one that counts
    d.toastError(er); d.setRefresh({ seq: my, state: 'failed', error: er }); d.setBusy(false);
    return false;
  }
  return Promise.resolve().then(function () { return d.call({ action: 'report', date_from: f || null, date_to: t || null }); }).then(function (j) {
    if (!current()) { return false; } // obsolete answer: dropped before it touches anything
    if (!j || j.ok !== true) { return fail((j && j.error) || 'The report did not load.'); }
    d.setData(j); d.setApplied({ from: f || '', to: t || '' }); d.setRefresh({ seq: my, state: 'ok', error: '' }); d.setBusy(false);
    return true;
  }, function (e) { return fail('The report did not load (' + ((e && e.message) || 'error') + ').'); });
}
