// __tests__/test-v55-81-build-visibility.js
// =============================================================
// v55.81 Checkpoint 2 #23 + #24
//   #23 — Build visibility: current build, deployment time,
//         "shipped X ago" relative tag, Reload-for-latest button.
//   #24 — Plain-language changelog: BUILD_HISTORY public items
//         free of developer jargon (RLS, payload, schema, hook,
//         endpoint, callback, webhook, codebase, regex, refactor,
//         JSON, props, useEffect, etc.). URL path matches are
//         excluded since literal URLs can't be reworded.
// =============================================================

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var widget = fs.readFileSync(path.join(ROOT, 'src/components/WhatsNewWidget.jsx'), 'utf8');

var failures = [];
function ok(name, cond) {
  if (cond) { console.log('  ✓', name); }
  else { failures.push(name); console.log('  ✗', name); }
}

// =============================================================
// #23 — Build visibility
// =============================================================
console.log('#23 — Build visibility');

ok('relativeTime helper exists',
  /var relativeTime = function \(iso\) \{/.test(widget));
ok('relativeTime returns "today"/"yesterday"/"X days ago" with sensible thresholds',
  /'just now'|'yesterday'|'days ago'|'1 hour ago'/.test(widget));
ok('relativeTime falls back to absolute date for builds older than ~30 days',
  /if \(days < 30\) return Math\.floor\(days \/ 7\) \+ ' weeks ago';/.test(widget));
ok('Dashboard pill appends relative time after the build date',
  /relativeTime\(latest\.date\); return rel \?/.test(widget));

ok('Modal footer has v55.81 #23 marker',
  widget.indexOf('v55.81 #23') !== -1);
ok('Modal footer surfaces the current build version',
  /You're on <span className="font-mono font-bold text-slate-700">\{latest\.version\}<\/span>/.test(widget));
ok('Modal footer surfaces "shipped X ago" or absolute date',
  /shipped ' \+ rel : '.+?fmtDate\(latest\.date\)/.test(widget));
ok('Modal footer has the "Reload for latest" button',
  /\u21bb Reload for latest|↻ Reload for latest/.test(widget));
ok('Reload button uses cache-bust URL or falls back to reload (QA-1 supersedes simple reload)',
  /searchParams\.set\(['"]_v['"], Date\.now\(\)\.toString\(\)\)/.test(widget) ||
  /try \{ window\.location\.reload\(\); \} catch \(_\) \{\} \}\}/.test(widget));
ok('Reload button has a tooltip explaining what it does',
  /Reloads the dashboard so you pick up any newer build/.test(widget));
ok('Footer keeps the "mark all seen" / Close behavior',
  /mark all seen' : 'Close'/.test(widget));

// =============================================================
// #24 — Plain-language changelog audit
// =============================================================
console.log('\n#24 — Plain-language changelog');

// Re-run the sweep here so the test self-validates that no jargon
// has crept back in. Public items = plain-string entries inside
// items: [...] arrays. Guarded items {superAdminOnly, adminOnly}
// are allowed to use jargon.
var startIdx = widget.indexOf('BUILD_HISTORY = [');
var depth = 0, ii = startIdx, endIdx = -1;
// v55.83-A.6.27.13 — respect string literals so square brackets INSIDE
// strings (e.g. '[bank confirmation') don't throw off the matcher.
var outerInStr = false, outerStrCh = null;
while (ii < widget.length) {
  var ch = widget[ii];
  if (outerInStr) {
    if (ch === '\\') { ii += 2; continue; }
    if (ch === outerStrCh) outerInStr = false;
  } else if (ch === "'" || ch === '"' || ch === '`') {
    outerInStr = true; outerStrCh = ch;
  } else if (ch === '[') depth++;
  else if (ch === ']') { depth--; if (depth === 0) { endIdx = ii + 1; break; } }
  ii++;
}
var slice = widget.substring(startIdx, endIdx);

var itemsRx = /items:\s*\[/g;
var itemRanges = [];
var m;
while ((m = itemsRx.exec(slice)) !== null) {
  var s = m.index + m[0].length - 1;
  var d = 1, j = s + 1;
  // v55.83-A.6.27.13 — same string-aware fix on the inner items: [ walker.
  var innerInStr = false, innerStrCh = null;
  while (j < slice.length && d > 0) {
    if (innerInStr) {
      if (slice[j] === '\\') { j += 2; continue; }
      if (slice[j] === innerStrCh) innerInStr = false;
    } else if (slice[j] === "'" || slice[j] === '"' || slice[j] === '`') {
      innerInStr = true; innerStrCh = slice[j];
    } else if (slice[j] === '[') d++;
    else if (slice[j] === ']') d--;
    j++;
  }
  if (d === 0) itemRanges.push({ start: s + 1, end: j - 1 });
}

var publicItems = [];
itemRanges.forEach(function (rg) {
  var body = slice.substring(rg.start, rg.end);
  var parts = [];
  var dpth = 0, inStr = false, strCh = null, partStart = 0;
  for (var k = 0; k < body.length; k++) {
    var c = body[k];
    if (inStr) {
      if (c === '\\') { k++; continue; }
      if (c === strCh) inStr = false;
    } else {
      if (c === "'" || c === '"') { inStr = true; strCh = c; }
      else if (c === '{' || c === '[') dpth++;
      else if (c === '}' || c === ']') dpth--;
      else if (c === ',' && dpth === 0) {
        parts.push(body.substring(partStart, k));
        partStart = k + 1;
      }
    }
  }
  parts.push(body.substring(partStart));
  parts.forEach(function (p) {
    var t = p.trim().replace(/^\s*\/\/[^\n]*\n/g, '').trim();
    if (t.startsWith("'") || t.startsWith('"')) publicItems.push(t);
  });
});

var jargonWords = ['RLS', 'payload', 'schema', 'endpoint', 'callback', 'webhook', 'z-index',
                   'regex', 'refactor', 'snapshot', 'codebase', 'closure', 'mutex',
                   'memoiz', 'memoize', 'middleware', 'CORS', 'CSRF', 'JWT',
                   'JSON', 'localStorage',
                   'props', 'useEffect', 'useMemo', 'useState', 'JSX', 'DOM',
                   'thunk', 'reducer', 'mutation', 'idempotent', 'transpil',
                   'mocks', 'stub', 'monorepo', 'polyfill', 'tree-shaking',
                   'bundler', 'Webpack', 'Vite', 'Babel', 'TypeScript',
                   'AbortController', 'IIFE'];

// API-as-word offenders (skip URL paths like /api/...)
function findOffenders() {
  var found = [];
  publicItems.forEach(function (item) {
    jargonWords.forEach(function (w) {
      var rx = new RegExp('(^|\\W)' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\W|$)', 'i');
      if (rx.test(item)) found.push({ word: w, snippet: item.substring(0, 80) });
    });
    // Special-case: only flag "API" when it's NOT inside a URL path.
    // Matches "API " or " API" but ignores "/api/" within URLs.
    var apiAsWord = /(^|\s)API(\s|\.|,|$)/.test(item);
    if (apiAsWord) found.push({ word: 'API', snippet: item.substring(0, 80) });
  });
  return found;
}

var offenders = findOffenders();
ok('At least 50 public items have been authored (sanity floor)',
  publicItems.length >= 50); // sanity — was 191 at peak, today many entries are superAdminOnly
ok('Webhook → plain-language rewrite (Twilio failure note)',
  /the security check didn\\'t match/.test(widget) ||
  /security check didn[\u2019']t match/.test(widget));
ok('Webhook → plain-language rewrite (WhatsApp inbox)',
  /tell Meta\\'s dashboard where to send incoming messages/.test(widget) ||
  /tell Meta[\u2019']s dashboard where to send incoming messages/.test(widget));
ok('Endpoint → "the way we send messages back"',
  /the way we send messages back/.test(widget));
ok('Codebase → "every file in the project"',
  /every file in the project that references/.test(widget));
ok('Recording-callback → "recording confirmation"',
  /recording confirmation/.test(widget));
ok('JSON output → "what it shows"',
  /share what it shows — that tells us exactly what setting is missing/.test(widget) ||
  /share what it shows[\s\S]{0,40}exactly what setting is missing/.test(widget));
ok('Twilio phone webhooks → "Twilio phone settings"',
  /Twilio phone settings/.test(widget));
ok('Phone-routing-stack diagnostic → "phone system is reachable"',
  /phone system is reachable/.test(widget));
ok('Public BUILD_HISTORY items have at most 2 jargon hits remaining (URL false positives only)',
  offenders.length <= 2);
ok('Any remaining jargon hits are inside literal URL paths',
  offenders.every(function (o) {
    return /\/api\/|\/webhook\//.test(o.snippet);
  }));

// =============================================================
// Style guide is documented in the source so future writers know
// =============================================================
ok('Style guide comment present at top of BUILD_HISTORY',
  /Style guide \(per Max, May 6 2026\)/.test(widget));
ok('Style guide explicitly lists banned jargon words',
  /RLS, payload, schema, endpoint, callback, hook/.test(widget));

console.log('\n' + (failures.length === 0 ? 'PASS' : 'FAIL') + ' — ' + (24 - failures.length) + '/24 assertions');
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  console.log('\nRemaining jargon offenders (for reference):');
  offenders.slice(0, 10).forEach(function (o) {
    console.log('  [' + o.word + '] ' + o.snippet);
  });
  process.exit(1);
}
