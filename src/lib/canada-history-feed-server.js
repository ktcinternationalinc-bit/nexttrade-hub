// v55.83-YO — reads the NEW SYSTEM's pounds by CGT grade and month from the NT Warehouse, server-side and READ-ONLY.
// Server-only (no 'use client'). SWC-safe: var + string concatenation.
//
// The Canada archive (old workbook) stops in early 2024; the Canadian records after that are in the warehouse. The
// warehouse answers one read-only question for this, GET /api/hub-feed/grade-flow (beside the existing feed). It exists
// on a warehouse copy only after it is deployed there. Until then this module answers "unavailable" with the reason —
// the screen then says NOT CHECKED, never zero.
//
// Rules (the same as every other warehouse read): the approved-address rule and token of warehouseFeedConfig; a redirect
// never carries the token; the token never reaches the browser; the answer must say which warehouse copy it is; only the
// allow-listed fields are kept (grade name, warehouse name, month, pounds) — nothing else the warehouse might send.
import { warehouseFeedConfig, feedIdentityProblem } from './warehouse-feed-config';
import { archiveTypeForGrade } from './canada-history';

export function gradeFlowUrl(feedUrl) {
  var u = new URL(feedUrl); u.search = ''; u.hash = '';
  // the feed address is …/api/hub-feed/shipping (or …/api/hub-feed); the new question lives beside it
  u.pathname = u.pathname.replace(/\/+$/, '').replace(/\/(shipping|receipts)$/, '') + '/grade-flow';
  return u.toString();
}

function isDay(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v); }
function isYm(v) { return typeof v === 'string' && /^\d{4}-\d{2}$/.test(v); }
var CANADA_WAREHOUSE = /cambridge|canada|ontario/i;

// Pure (tested without a network): the warehouse's answer -> the Canadian flow the Hub uses.
export function normaliseGradeFlow(ans, cfg) {
  var idp = feedIdentityProblem(ans, cfg);
  if (idp) { return { state: 'unavailable', reason: idp }; }
  if (!ans || ans.ok !== true || !Array.isArray(ans.grades) || !Array.isArray(ans.inbound) || !Array.isArray(ans.outbound)) {
    return { state: 'unavailable', reason: 'The warehouse answered, but not in the expected shape.' };
  }
  var gName = {}; var wName = {}; var i;
  for (i = 0; i < ans.grades.length; i++) { var g = ans.grades[i]; if (g && g.id != null && g.grade_name != null) { gName[String(g.id)] = String(g.grade_name).substring(0, 120); } }
  var whs = Array.isArray(ans.warehouses) ? ans.warehouses : [];
  var canadaIds = {}; var anyCanada = false;
  for (i = 0; i < whs.length; i++) { var w = whs[i]; if (w && w.id != null) { wName[String(w.id)] = String(w.name == null ? '' : w.name).substring(0, 120); if (CANADA_WAREHOUSE.test(wName[String(w.id)])) { canadaIds[String(w.id)] = 1; anyCanada = true; } } }
  // Canadian side: a grade that IS a Canadian type by name (… Canada) always counts; a grade with no country in its
  // name (Roofing, PVC, TPO …) counts only from a Canadian warehouse when the warehouse list names one.
  function rows(list) {
    var out = []; var j;
    for (j = 0; j < list.length; j++) {
      var r = list[j]; if (!r || !isYm(r.ym)) { continue; }
      var name = gName[String(r.cgt_id)]; if (!name) { continue; }
      var type = archiveTypeForGrade(name); if (!type) { continue; }
      var lb = Number(r.lb); if (!isFinite(lb)) { continue; }
      var named = /canada/i.test(name);
      if (!named && anyCanada && !canadaIds[String(r.warehouse_id)]) { continue; }
      out.push({ grade: name, ym: r.ym, lb: Math.round(lb * 100) / 100 });
    }
    return out;
  }
  var gen = typeof ans.generated_at === 'string' ? ans.generated_at : '';
  var b = ans.bounds || {};
  if (!isDay(b.first_in) || !isDay(b.last_in) || !isDay(b.first_out) || !isDay(b.last_out) || !/^\d{4}-\d{2}/.test(gen)) {
    return { state: 'unavailable', reason: 'The warehouse answered without its first / last record dates, so real zeros cannot be told from missing months.' };
  }
  return { state: 'ok', site: String(ans.site || cfg.host), source: cfg.source, generated_at: gen, through: gen.slice(0, 7),
    first_in: b.first_in.slice(0, 10), last_in: b.last_in.slice(0, 10), first_out: b.first_out.slice(0, 10), last_out: b.last_out.slice(0, 10),
    rows_in: rows(ans.inbound), rows_out: rows(ans.outbound),
    scope: anyCanada ? 'New-system figures are the Canadian side only: grades named “… Canada”, plus the unnamed grades (Roofing, PVC, TPO …) from the Canadian warehouse.'
      : 'New-system figures: the warehouse list names no Canadian warehouse, so unnamed grades (Roofing, PVC, TPO …) include every warehouse.' };
}

export async function readGradeFlow(env) {
  var cfg = warehouseFeedConfig(env || process.env);
  if (cfg.error) { return { state: 'not_configured', reason: cfg.error }; }
  var url = '';
  try { url = gradeFlowUrl(cfg.url); } catch (eU) { return { state: 'not_configured', reason: 'The warehouse address could not be read.' }; }
  var ctl = null; var timer = null;
  try {
    ctl = new AbortController();
    timer = setTimeout(function () { try { ctl.abort(); } catch (eA) { /* already done */ } }, 20000);
    var res = await fetch(url, { method: 'GET', headers: { 'X-Hub-Feed-Token': cfg.token, 'Accept': 'application/json' }, redirect: 'error', cache: 'no-store', signal: ctl.signal });
    if (res.status === 404) { return { state: 'unavailable', reason: 'the warehouse (' + cfg.host + ') cannot answer “pounds by grade and month” yet — that read-only question has to be added to it first.' }; }
    if (!res.ok) { return { state: 'unavailable', reason: 'the warehouse (' + cfg.host + ') answered ' + res.status + '.' }; }
    var ans = null;
    try { ans = await res.json(); } catch (eJ) { return { state: 'unavailable', reason: 'the warehouse answer could not be read.' }; }
    return normaliseGradeFlow(ans, cfg);
  } catch (e) {
    return { state: 'unavailable', reason: 'the warehouse (' + cfg.host + ') could not be reached.' };
  } finally {
    if (timer) { clearTimeout(timer); }
  }
}
