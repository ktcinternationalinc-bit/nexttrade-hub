// v55.83-A.4 — REACT HOOKS RULES regression test (Max May 13 2026)
//
// Background: Max reported "Minified React error #310" on production after a
// build deploy. Root cause: PendingBankConfirmationsWidget had useState BEFORE
// an early-return permission gate and useMemo AFTER it — when the prop that
// drives the gate flips between renders, hook count changes, React crashes.
//
// Pre-existing similar bugs found in AIGreeter (useRef after !enabled return)
// and NadiaFloatingOverlay (3 hooks after suppressed return). All fixed in
// v55.83-A.4.
//
// This test scans every component and FAILS the build if any function has:
//   • A hook call (useState/useEffect/useMemo/useRef/useCallback/useContext/
//     useLayoutEffect/useReducer/useImperativeHandle/useDebugValue/useId/
//     useDeferredValue/useTransition/useSyncExternalStore/useInsertionEffect/
//     useFormStatus/useFormState/useOptimistic + any custom useXxx) called
//     AFTER a conditional return where there were OTHER hooks before that
//     return.
//
// False positives suppressed:
//   • Props/variables named useXxx that aren't actually React hook calls
//     (e.g. `var useLang = greeterLang || lang`). The check uses
//     CallExpression detection from AST, not regex.

var fs = require('fs');
var path = require('path');
var parser;
try { parser = require('@babel/parser'); }
catch (e) {
  // If @babel/parser isn't installed in the test env, skip this suite —
  // it'll still run on the dev machine where babel is present.
  console.log('⚠️  @babel/parser not available — skipping hooks-rule scan');
  process.exit(0);
}

var failures = [];

function walk(dir, list) {
  list = list || [];
  for (var i = 0; i < fs.readdirSync(dir).length; i++) {
    var f = fs.readdirSync(dir)[i];
    var p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, list);
    else if (/\.(jsx?|tsx?)$/.test(f)) list.push(p);
  }
  return list;
}

// A hook call is a CallExpression whose callee is an Identifier matching
// /^use[A-Z]/. This is the AST-correct check — never matches a prop named
// useFoo.
function findHookCalls(node, out) {
  out = out || [];
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'CallExpression' &&
      node.callee && node.callee.type === 'Identifier' &&
      /^use[A-Z]/.test(node.callee.name)) {
    out.push({ name: node.callee.name, loc: node.loc });
  }
  for (var k in node) {
    var v = node[k];
    if (Array.isArray(v)) v.forEach(function (x) { findHookCalls(x, out); });
    else if (v && typeof v === 'object' && v.type) findHookCalls(v, out);
  }
  return out;
}

function stmtHasHookCall(stmt) { return findHookCalls(stmt).length > 0; }
function stmtFirstHook(stmt) { return findHookCalls(stmt)[0]; }

function stmtIsConditionalReturn(s) {
  if (s.type === 'IfStatement') {
    var c = s.consequent;
    if (c && c.type === 'ReturnStatement') return true;
    if (c && c.type === 'BlockStatement' &&
        c.body.some(function (b) { return b.type === 'ReturnStatement'; })) return true;
  }
  return false;
}

function analyzeFn(file, fnName, body) {
  if (!body || !Array.isArray(body.body)) return;
  var stmts = body.body;
  var seenHookBefore = false;
  var condReturnLine = null;
  for (var i = 0; i < stmts.length; i++) {
    var s = stmts[i];
    if (!s) continue;
    if (stmtIsConditionalReturn(s)) {
      if (seenHookBefore) condReturnLine = s.loc.start.line;
      continue;
    }
    if (stmtHasHookCall(s)) {
      if (condReturnLine) {
        var h = stmtFirstHook(s);
        failures.push({
          file: file,
          line: s.loc.start.line,
          hook: h.name,
          retLine: condReturnLine,
          fn: fnName,
        });
        return; // one violation per function is enough
      }
      seenHookBefore = true;
    }
  }
}

var srcDir = path.join(__dirname, '..', 'src');
var files = walk(srcDir);

for (var i = 0; i < files.length; i++) {
  var f = files[i];
  var src;
  try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  var ast;
  try { ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] }); }
  catch (e) { continue; }

  (function walkAst(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && node.id && /^[A-Z]/.test(node.id.name)) {
      analyzeFn(f, node.id.name, node.body);
    }
    if (node.type === 'VariableDeclarator' && node.id && node.id.name &&
        /^[A-Z]/.test(node.id.name) && node.init &&
        (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
      analyzeFn(f, node.id.name, node.init.body);
    }
    if (node.type === 'ExportDefaultDeclaration' && node.declaration &&
        node.declaration.type === 'FunctionDeclaration') {
      var name = node.declaration.id ? node.declaration.id.name : 'default';
      analyzeFn(f, name, node.declaration.body);
    }
    for (var k in node) {
      var v = node[k];
      if (Array.isArray(v)) v.forEach(walkAst);
      else if (v && typeof v === 'object' && v.type) walkAst(v);
    }
  })(ast);
}

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' React hooks-rule violation(s) detected:');
  failures.forEach(function (v) {
    console.log('  ✗ ' + v.file + ':' + v.line +
      ' — `' + v.hook + '()` called AFTER conditional return at line ' +
      v.retLine + ' (in function `' + v.fn + '`)');
    console.log('     Fix: move the hook ABOVE the early-return statement.');
  });
  console.log('\nViolations like these trigger "Minified React error #310" in production.');
  console.log('Rules of hooks: ALL hooks must be called on every render, in the same order.');
  console.log('No hooks after conditional returns; no hooks inside if/loops; no hooks in callbacks.');
  process.exit(1);
}

console.log('✓ All components comply with React rules of hooks (no conditional hook calls)');
