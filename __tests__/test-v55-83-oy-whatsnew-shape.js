// ═══════════════════════════════════════════════════════════════════════════
// v55.83-OY — What's-New shape gate (born from a production outage)
//
// Nov 5: Max deployed OX and the ENTIRE hub white-screened for every user:
// "Cannot read properties of undefined (reading 'filter')". Root cause: the
// OX BUILD_HISTORY entry was written with invented fields (bullets/technical)
// instead of the items[] shape, and filterEntry called entry.items.filter on
// undefined. The widget renders on the main page, so one malformed changelog
// entry equaled a total outage.
//
// This gate makes that class of mistake impossible to ship again:
//   1. It EVALUATES the real BUILD_HISTORY array and walks every entry.
//   2. It pins the armor in filterEntry (malformed entry hides, never throws).
//   3. It pins badge === newest entry version, so the deployed badge can
//      never disagree with the changelog again.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

console.log('OY — What’s-New BUILD_HISTORY shape gate');

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'WhatsNewWidget.jsx'), 'utf8');

// ── 1. Extract and EVALUATE the literal BUILD_HISTORY array
// Locate the array by AST, not by hand-rolled bracket walking: comments and
// escaped quotes inside the entries defeat string scanning.
var acorn = require('acorn');
var acornJsx = require('acorn-jsx');
var Parser = acorn.Parser.extend(acornJsx());
var ast = Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
var initRange = null;
ast.body.forEach(function (node) {
  var decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
  if (decl && decl.type === 'VariableDeclaration') {
    decl.declarations.forEach(function (d) {
      if (d.id && d.id.name === 'BUILD_HISTORY' && d.init) initRange = [d.init.start, d.init.end];
    });
  }
});
ok('1a: BUILD_HISTORY found via AST', !!initRange);
var history = null;
try { if (initRange) history = vm.runInNewContext('(' + src.slice(initRange[0], initRange[1]) + ')', {}, { timeout: 5000 }); }
catch (e) { console.log('    eval error: ' + e.message); }
ok('1c: BUILD_HISTORY evaluates as pure data (no code, no imports)', Array.isArray(history) && history.length > 10);

// ── 2. Walk EVERY entry with exactly the widget's expectations
if (Array.isArray(history)) {
  var badEntries = [];
  var seen = {};
  history.forEach(function (e, idx) {
    var problems = [];
    if (!e || typeof e !== 'object') problems.push('not an object');
    else {
      if (typeof e.version !== 'string' || !/^v\d/.test(e.version)) problems.push('version');
      if (typeof e.date !== 'string') problems.push('date');
      if (!Array.isArray(e.items) || e.items.length === 0) problems.push('items[] missing/empty (the OX outage shape)');
      else e.items.forEach(function (it, j) {
        var good = typeof it === 'string' || (it && typeof it === 'object' && typeof it.text === 'string');
        if (!good) problems.push('items[' + j + '] not string or {text}');
      });
      if (e.version && seen[e.version]) problems.push('duplicate version');
      seen[e.version] = true;
    }
    if (problems.length) badEntries.push('#' + idx + ' ' + ((e && e.version) || '?') + ': ' + problems.join(', '));
  });
  ok('2: every entry renderable (version, date, items[] of strings/{text}), versions unique' +
     (badEntries.length ? ' — ' + badEntries.join(' | ') : ''), badEntries.length === 0);
}

// ── 3. Pin the armor: a malformed entry hides itself instead of crashing
ok('3a: filterEntry rejects entries without items[] before any .filter call',
  /if \(!entry \|\| !Array\.isArray\(entry\.items\)\) return null;/.test(src));
ok('3b: non-string items without a string .text are dropped, not rendered',
  /if \(typeof it\.text !== 'string'\) return false;/.test(src));

// ── 4. Badge must equal the newest entry's version
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var badge = (page.match(/v55\.\d+-[A-Z]+<\/span>/) || [''])[0].replace('</span>', '');
ok('4: page badge "' + badge + '" === BUILD_HISTORY[0].version "' + (history && history[0] && history[0].version) + '"',
  !!badge && Array.isArray(history) && history[0] && history[0].version === badge);

console.log('');
console.log('OY shape gate: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
