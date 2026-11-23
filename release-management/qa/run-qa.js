#!/usr/bin/env node
/*
 * v55.83-XH — Release-gate QA runner (release-governance session, 22 Nov 2026).
 *
 * ONE command, runnable by Claude or Codex:
 *     node release-management/qa/run-qa.js
 *
 * Reads the editable cases in cases.json, asserts each RULE still holds in the
 * source (Hub here, warehouse at ../nextrade_WAREHOUSE/nextrade-app), and writes
 * qa-result.json — the pass/fail the release gate reads.
 *
 * Gate rule (also enforced by the deploy scripts): a change moves to production
 * only when Codex PASSED it AND this suite is PASS for that change's area.
 *
 * No dependencies, no network, writes nothing but qa-result.json. Warehouse
 * cases are SKIPPED (not failed) when that repo is not on this machine, so the
 * suite still runs anywhere. 'manual' cases never fail the gate — they are
 * human reminders.
 *
 * Exit code: 0 when overall is PASS (no real failures), 1 otherwise — so CI /
 * a pre-push hook can gate on it.
 */
'use strict';
var fs = require('fs');
var path = require('path');

var QA_DIR = __dirname;
var CASES_FILE = path.join(QA_DIR, 'cases.json');
var RESULT_FILE = path.join(QA_DIR, 'qa-result.json');

function fail(msg) {
  process.stderr.write('QA runner error: ' + msg + '\n');
  process.exit(2);
}

function readJson(file) {
  var raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

// Resolve a repo root from meta.repos, allowing an env override and absolute paths.
function resolveRepoRoot(repoKey, repos) {
  if (repoKey === 'self' || repoKey === undefined || repoKey === null) { repoKey = 'hub'; }
  var envName = 'QA_REPO_' + String(repoKey).toUpperCase();
  var fromEnv = process.env[envName];
  var base = fromEnv || (repos && repos[repoKey]) || '.';
  if (path.isAbsolute(base)) { return base; }
  // cases.json paths are relative to the Hub repo root (two levels up from QA_DIR).
  var hubRoot = path.resolve(QA_DIR, '..', '..');
  return path.resolve(hubRoot, base);
}

// Pull out one PHP/JS method body by name (brace-matched) so a scoped assertion
// only looks inside that method — more honest than scanning the whole file.
function extractScope(text, name) {
  var idx = text.indexOf('function ' + name);
  if (idx < 0) { return null; }
  var brace = text.indexOf('{', idx);
  if (brace < 0) { return null; }
  var depth = 0;
  for (var i = brace; i < text.length; i++) {
    var ch = text[i];
    if (ch === '{') { depth++; }
    else if (ch === '}') { depth--; if (depth === 0) { return text.slice(brace, i + 1); } }
  }
  return text.slice(brace);
}

function isRegex(needle) {
  return typeof needle === 'string' && needle.length > 1 && needle[0] === '/' && needle[needle.length - 1] === '/';
}
function toMatcher(needle) {
  if (isRegex(needle)) { return new RegExp(needle.slice(1, -1)); }
  return needle;
}
function countOccurrences(text, needle) {
  if (isRegex(needle)) {
    var re = new RegExp(needle.slice(1, -1), 'g');
    var m = text.match(re);
    return m ? m.length : 0;
  }
  var n = 0, from = 0, at;
  while ((at = text.indexOf(needle, from)) >= 0) { n++; from = at + needle.length; }
  return n;
}
function textHas(text, needle) {
  if (isRegex(needle)) { return toMatcher(needle).test(text); }
  return text.indexOf(needle) >= 0;
}

function runCase(c, repos) {
  var res = { id: c.id, title: c.title, area: c.area || 'uncategorized', release: c.release || '', kind: c.kind || (c.manual ? 'manual' : 'lint'), manual: !!c.manual };
  var root;
  try { root = resolveRepoRoot(c.repo, repos); }
  catch (e) { res.status = 'ERROR'; res.detail = 'repo path: ' + e.message; return res; }

  var abs = path.join(root, c.file);
  if (!fs.existsSync(abs)) {
    // A warehouse file that isn't on this machine is a SKIP, not a failure.
    res.status = (c.repo === 'warehouse') ? 'SKIP' : 'FAIL';
    res.detail = (res.status === 'SKIP' ? 'warehouse repo/file not found here: ' : 'file not found: ') + c.file;
    return res;
  }

  var text;
  try { text = fs.readFileSync(abs, 'utf8'); }
  catch (e) { res.status = 'ERROR'; res.detail = 'read: ' + e.message; return res; }

  if (c.scope) {
    var scoped = extractScope(text, c.scope);
    if (scoped === null) { res.status = 'FAIL'; res.detail = "scope '" + c.scope + "' not found in " + c.file; return res; }
    text = scoped;
  }

  var ok = false, detail = '';
  if (c.type === 'present') {
    ok = textHas(text, c.needle);
    detail = ok ? 'found' : 'MISSING: ' + c.needle;
  } else if (c.type === 'absent') {
    ok = !textHas(text, c.needle);
    detail = ok ? 'correctly absent' : 'UNEXPECTEDLY PRESENT: ' + c.needle;
  } else if (c.type === 'count') {
    var min = c.min || 1;
    var n = countOccurrences(text, c.needle);
    ok = n >= min;
    detail = 'found ' + n + ' / need >= ' + min;
  } else if (c.type === 'json_ok') {
    try {
      var obj = JSON.parse(text);
      var missing = (c.keys || []).filter(function (k) { return !(k in obj); });
      ok = missing.length === 0;
      detail = ok ? 'valid JSON, keys present' : 'missing keys: ' + missing.join(', ');
    } catch (e) { ok = false; detail = 'INVALID JSON: ' + e.message; }
  } else {
    res.status = 'ERROR'; res.detail = 'unknown case type: ' + c.type; return res;
  }

  res.status = ok ? 'PASS' : (c.manual ? 'MANUAL' : 'FAIL');
  res.detail = detail;
  res.why = c.why || '';
  return res;
}

function main() {
  if (!fs.existsSync(CASES_FILE)) { fail('cases.json not found at ' + CASES_FILE); }
  var cases;
  try { cases = readJson(CASES_FILE); }
  catch (e) { fail('cases.json is not valid JSON: ' + e.message); }

  var repos = (cases.meta && cases.meta.repos) || {};
  var list = cases.cases || [];
  var results = list.map(function (c) { return runCase(c, repos); });

  // A 'manual' case that its assertion did find is informational; one that did
  // NOT find its needle is reported as MANUAL (a reminder), never a gate fail.
  results.forEach(function (r) {
    if (r.manual && r.status === 'FAIL') { r.status = 'MANUAL'; }
  });

  // This runner does ONLY source lint (present/absent/count/json_ok). NOTHING here is an
  // executed behavioral result, so no release status is ever a behavioral PASS (Codex 13:11 #1).
  var byArea = {};
  function bucket(a) { if (!byArea[a]) { byArea[a] = { pass: 0, fail: 0, skip: 0, manual: 0, error: 0 }; } return byArea[a]; }
  var byRelease = {};
  function relBucket(a) { if (!byRelease[a]) { byRelease[a] = { pass: 0, fail: 0, skip: 0, manual: 0, error: 0 }; } return byRelease[a]; }

  var tally = { pass: 0, fail: 0, skip: 0, manual: 0, error: 0 };
  results.forEach(function (r) {
    var k = r.status.toLowerCase();
    tally[k] = (tally[k] || 0) + 1;
    var ab = bucket(r.area); ab[k] = (ab[k] || 0) + 1;
    if (r.release) { var rb = relBucket(r.release); rb[k] = (rb[k] || 0) + 1; }
  });

  // Source-lint roll-up only: SOURCE-OK / SOURCE-FAIL / UNKNOWN. NEVER "PASS" — the gate reads a
  // separately-recorded behavioral QA bound to the exact SHA, not this supplementary lint.
  function statusOf(b) {
    if (b.error > 0) { return 'SOURCE-ERROR'; }
    if (b.fail > 0) { return 'SOURCE-FAIL'; }
    if (b.pass > 0) { return 'SOURCE-OK'; }
    return 'UNKNOWN'; // only skips/manuals ran
  }
  var areaStatus = {};
  Object.keys(byArea).forEach(function (a) { areaStatus[a] = { status: statusOf(byArea[a]), counts: byArea[a] }; });
  var releaseStatus = {};
  Object.keys(byRelease).forEach(function (a) { releaseStatus[a] = { status: statusOf(byRelease[a]), counts: byRelease[a] }; });

  var overall = (tally.fail > 0 || tally.error > 0) ? 'SOURCE-FAIL' : 'SOURCE-OK';
  var ranAgainstSha = '';
  try { ranAgainstSha = require('child_process').execSync('git rev-parse HEAD', { cwd: path.resolve(QA_DIR, '..', '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { ranAgainstSha = 'unknown'; }

  var out = {
    overall: overall,
    kind: 'source-lint',
    behavioral: false,
    ranAgainstSha: ranAgainstSha,
    generated: new Date().toISOString(),
    runner: 'release-management/qa/run-qa.js',
    gateRule: "THIS FILE IS SUPPLEMENTARY SOURCE LINT, NOT a gate input. A production move needs, bound to the exact candidate SHA + target: (1) a recorded Codex PASS (item.codexRef), (2) a SEPARATE executed behavioral result (item.behavioralQa — PHP/staging/browser, NOT this file), and (3) Max's recorded named go (item.maxApproval). The gate (lib/gate.js) compares all three to the candidate; a SOURCE-OK result here never satisfies the behavioral requirement and never implies Codex approval. Deploy stays dry-run/safe-mode until SSH is authorized + its block is Codex-reviewed; an SSH refusal is not approval.",
    totals: tally,
    byArea: areaStatus,
    byRelease: releaseStatus,
    cases: results
  };

  fs.writeFileSync(RESULT_FILE, JSON.stringify(out, null, 2));

  // Console summary
  var line = '─────────────────────────────────────────────';
  process.stdout.write('\n' + line + '\n Release-gate QA  ·  ' + out.generated + '\n' + line + '\n');
  results.forEach(function (r) {
    var mark = { PASS: 'PASS ', FAIL: 'FAIL ', SKIP: 'SKIP ', MANUAL: 'MAN  ', ERROR: 'ERR  ', UNKNOWN: '?    ' }[r.status] || r.status;
    process.stdout.write(' [' + mark + '] ' + r.id + ' — ' + r.title + '\n');
    if (r.status === 'FAIL' || r.status === 'ERROR') { process.stdout.write('          ' + r.detail + '\n'); }
  });
  process.stdout.write(line + '\n');
  process.stdout.write(' OVERALL: ' + overall + '   pass ' + tally.pass + ' · fail ' + (tally.fail || 0) + ' · skip ' + (tally.skip || 0) + ' · manual ' + (tally.manual || 0) + ' · error ' + (tally.error || 0) + '\n');
  process.stdout.write(' by release:\n');
  Object.keys(releaseStatus).forEach(function (a) { process.stdout.write('   ' + a + ': ' + releaseStatus[a].status + '\n'); });
  process.stdout.write(line + '\n Result written to ' + RESULT_FILE + '\n\n');

  process.exit(overall === 'SOURCE-OK' ? 0 : 1);
}

main();
