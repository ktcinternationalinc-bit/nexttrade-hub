// v55.83-ZQ — Codex re-review of ZN rev2 (P2): two Profitability reloads finishing OUT OF ORDER must not leave old figures under a
// newer "ok" status. Runs the REAL runReportLoad (src/lib/report-load.js, the function ProfitabilityTab's load() calls) with
// deferred answers resolved in both orders — including an older FAILURE after a newer success — and then the REAL openTasks +
// returnVerdict on whatever data ended up on screen, so the fix list's verdict is checked end to end. Made-up figures.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var RL = require(path.join(root, 'src/lib/report-load.js'));
var P = require(path.join(root, 'src/lib/pnl-period.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('ZQ — an out-of-order report answer changes nothing (real load path)');

function cell(o) { return Object.assign({ invoice_date: '2026-06-10', release: '1002-1158', pounds: 1000, base_cost: 100, transport_revenue: 0, trucking_cost: 10, freight_cost: 10, goods_revenue: 500, goods_profit: 1, transport_profit: 1, profit: 2, flags: [] }, o); }
var OLD = { ok: true, cells: [cell({ invoice: 'America 1747', invoice_id: 'i1', description: 'STOCK PVC ROLLS BY KGs', product: 'STOCK PVC ROLLS BY KGs', pounds: null, base_cost: null, transport_revenue: null, goods_revenue: null, goods_profit: null, transport_profit: null, profit: null })], tag: 'old (issue still there)' };
var NEW = { ok: true, cells: [cell({ invoice: 'America 1747', invoice_id: 'i1', description: 'STOCK PVC ROLLS BY KGs', product: 'STOCK PVC ROLLS BY KGs' })], tag: 'new (fixed)' };
var KEY = 'pounds:STOCK PVC ROLLS BY KGs';

// a screen-state recorder and a call() whose answers we release by hand
function world() {
  var w = { seqRef: { current: 0 }, data: null, applied: null, refresh: { seq: 0, state: 'idle' }, busy: false, toasts: [], dataSets: 0, pending: [] };
  w.d = { seqRef: w.seqRef,
    call: function () { return new Promise(function (res, rej) { w.pending.push({ res: res, rej: rej }); }); },
    setRefresh: function (x) { w.refresh = x; }, setBusy: function (b) { w.busy = b; },
    setData: function (j) { w.data = j; w.dataSets++; }, setApplied: function (a) { w.applied = a; }, toastError: function (m) { w.toasts.push(m); } };
  return w;
}
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
function verdict(w, seqWaited) { var tasks = P.openTasks((w.data && w.data.cells) || [], false, {}).tasks; return P.returnVerdict({ key: KEY, seq: seqWaited }, w.refresh, tasks).state; }

(async function () {
  // A) Codex's case: newer #2 answers first (fixed), then the older #1 (issue still there)
  var w = world(); var p1 = RL.runReportLoad(w.d, '2026-06-01', ''); var p2 = RL.runReportLoad(w.d, '2026-06-01', ''); await tick();
  w.pending[1].res(NEW); var r2 = await p2; w.pending[0].res(OLD); var r1 = await p1;
  check('A newer-first: the newer answer is shown, the late OLDER answer is dropped (data set once, still the new one)', r2 === true && r1 === false && w.data === NEW && w.dataSets === 1, { r1: r1, r2: r2, tag: w.data && w.data.tag, sets: w.dataSets });
  check('A …status stays {seq 2, ok}, busy is off, no message', w.refresh.seq === 2 && w.refresh.state === 'ok' && w.busy === false && w.toasts.length === 0, w.refresh);
  check('A …so the fix list says ✓ Fixed (Codex saw "Still open" here before)', verdict(w, 2) === 'fixed', verdict(w, 2));

  // B) older first: #1 answers (old), then #2 (new) — #1 is already obsolete when it lands (a newer load was started)
  w = world(); p1 = RL.runReportLoad(w.d, '2026-06-01', ''); p2 = RL.runReportLoad(w.d, '2026-06-01', ''); await tick();
  w.pending[0].res(OLD); r1 = await p1;
  check('B older-first: the older answer lands while #2 is still running → dropped; status stays "loading", busy stays ON, data untouched', r1 === false && w.data === null && w.refresh.seq === 2 && w.refresh.state === 'loading' && w.busy === true, { refresh: w.refresh, busy: w.busy });
  check('B …while #2 runs the fix list says "checking", not a verdict', verdict(w, 2) === 'loading');
  w.pending[1].res(NEW); r2 = await p2;
  check('B …then #2 lands: new data, {seq 2, ok}, busy off → ✓ Fixed', r2 === true && w.data === NEW && w.refresh.state === 'ok' && w.busy === false && verdict(w, 2) === 'fixed');

  // C) the reverse data — the newer answer still has the issue, a late older one would have said fixed: no false "Fixed"
  w = world(); p1 = RL.runReportLoad(w.d, '2026-06-01', ''); p2 = RL.runReportLoad(w.d, '2026-06-01', ''); await tick();
  w.pending[1].res(OLD); await p2; w.pending[0].res(NEW); await p1;
  check('C reverse data: the late older "fixed" answer is dropped — the list honestly says ⚠ Still open (no false Fixed)', w.data === OLD && w.dataSets === 1 && verdict(w, 2) === 'still_open', { tag: w.data && w.data.tag, v: verdict(w, 2) });

  // D) an older FAILURE after a newer success: no error message, no "failed" status, the newer report stays
  w = world(); p1 = RL.runReportLoad(w.d, '2026-06-01', ''); p2 = RL.runReportLoad(w.d, '2026-06-01', ''); await tick();
  w.pending[1].res(NEW); await p2; w.pending[0].res({ ok: false, error: 'The report did not load.' }); r1 = await p1;
  check('D older failure after a newer success: dropped — no message, status stays ok, the new report stays, ✓ Fixed', r1 === false && w.toasts.length === 0 && w.refresh.state === 'ok' && w.refresh.seq === 2 && w.data === NEW && verdict(w, 2) === 'fixed', { toasts: w.toasts, refresh: w.refresh });
  w = world(); p1 = RL.runReportLoad(w.d, '2026-06-01', ''); p2 = RL.runReportLoad(w.d, '2026-06-01', ''); await tick();
  w.pending[1].res(NEW); await p2; w.pending[0].rej(new Error('network down')); r1 = await p1;
  check('D′ an older REJECTED call after a newer success: dropped the same way', r1 === false && w.toasts.length === 0 && w.refresh.state === 'ok' && w.data === NEW);

  // E) a newer FAILURE after an older success: the failure counts (retry), the old data is not used for a verdict
  w = world(); p1 = RL.runReportLoad(w.d, '2026-06-01', ''); p2 = RL.runReportLoad(w.d, '2026-06-01', ''); await tick();
  w.pending[0].res(OLD); await p1; w.pending[1].res({ ok: false, error: 'The report did not load.' }); r2 = await p2;
  check('E newer failure: status {seq 2, failed} with ONE message, busy off; the older answer never reached the screen → retry, no verdict', r2 === false && w.refresh.seq === 2 && w.refresh.state === 'failed' && w.toasts.length === 1 && w.busy === false && w.data === null && verdict(w, 2) === 'failed', { refresh: w.refresh, toasts: w.toasts });

  // F) the single-load cases still work (ZN rev2: last issue, retry)
  w = world(); p1 = RL.runReportLoad(w.d, '2026-06-01', '2026-06-30'); await tick(); w.pending[0].res(NEW); r1 = await p1;
  check('F one load OK: data, dates applied, {seq 1, ok}, busy off; the last issue of the period → ✓ Fixed', r1 === true && w.data === NEW && w.applied.from === '2026-06-01' && w.applied.to === '2026-06-30' && w.refresh.state === 'ok' && w.busy === false && verdict(w, 1) === 'fixed' && P.returnVerdict({ key: KEY, seq: 1 }, w.refresh, P.openTasks(NEW.cells, false, {}).tasks).none_left === true);
  w = world(); p1 = RL.runReportLoad(w.d, '2026-06-01', ''); await tick(); w.pending[0].rej(new Error('offline')); r1 = await p1;
  check('F one load fails: {failed} + one message, busy off → the retry case', r1 === false && w.refresh.state === 'failed' && /offline/.test(w.refresh.error) && w.toasts.length === 1 && w.busy === false && verdict(w, 1) === 'failed');
  p2 = RL.runReportLoad(w.d, '2026-06-01', ''); await tick(); w.pending[1].res(NEW); r2 = await p2;
  check('F …Try again (a new load) succeeds → ✓ Fixed', r2 === true && w.refresh.seq === 2 && verdict(w, 2) === 'fixed');

  // CONTROL — the ZN rev2 load (as live on bdd772ad: only the status guarded) on the same newer-first case gives Codex's wrong answer
  function oldLoad(d) { var my = ++d.seqRef.current; d.setRefresh({ seq: my, state: 'loading', error: '' }); d.setBusy(true);
    return d.call({}).then(function (j) { if (!j || j.ok !== true) { d.toastError('x'); if (my === d.seqRef.current) { d.setRefresh({ seq: my, state: 'failed', error: 'x' }); } return false; }
      d.setData(j); d.setApplied({}); if (my === d.seqRef.current) { d.setRefresh({ seq: my, state: 'ok', error: '' }); } return true; }).finally(function () { d.setBusy(false); }); }
  w = world(); p1 = oldLoad(w.d); p2 = oldLoad(w.d); w.pending[1].res(NEW); await p2; w.pending[0].res(OLD); await p1;
  check('CONTROL: the OLD load, same order, leaves {seq 2, ok} on top of the OLD figures → "Still open" (the bug this fixes)', w.refresh.seq === 2 && w.refresh.state === 'ok' && w.data === OLD && verdict(w, 2) === 'still_open', { tag: w.data && w.data.tag, v: verdict(w, 2) });

  // G) the screen uses exactly this path, and nothing else writes the report data
  var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
  check('SCREEN: load() calls runReportLoad with the screen’s own setters and its sequence; no other setData / setApplied in the screen', tab.indexOf("return runReportLoad({ seqRef: loadSeq, call: call, setRefresh: setRefresh, setBusy: setBusy, setData: setData, setApplied: setApplied, toastError: function (m) { toast.error(m); } }, f === undefined ? from : f, t === undefined ? to : t);") > 0 && !/setData\(|setApplied\(/.test(tab) && tab.indexOf("import { runReportLoad } from '../lib/report-load';") > 0);

  console.log('\nZQ: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
