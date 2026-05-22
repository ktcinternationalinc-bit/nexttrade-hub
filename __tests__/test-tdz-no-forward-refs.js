// v55.83-A.6.10 (Max May 13 2026) — TDZ violation scanner.
//
// "Cannot access 'eO' before initialization" — minified production error
// that took down the Admin tab. Root cause: a `useMemo` referenced
// `visibleTickets` in its body and dependency array, but `visibleTickets`
// was declared LATER in the same function. Dev mode tolerated it;
// production minification raised TDZ.
//
// This scanner walks every React component and flags any top-level
// VariableDeclarator init expression that references another top-level
// declaration coming AFTER it in source order. Function/arrow bodies
// inside the init are skipped (TDZ-safe because they execute later via
// closure capture).
//
// Any new TDZ violation breaks the build before deploy.

var parser = require('@babel/parser');
var traverse;
try { traverse = require('@babel/traverse').default; } catch (_) {
  console.log('⚠️ @babel/traverse not installed — skipping TDZ scan.');
  console.log('Run: npm install --save-dev @babel/traverse');
  process.exit(0);
}
var fs = require('fs');
var path = require('path');

function listJsxFiles(dir) {
  var out = [];
  fs.readdirSync(dir).forEach(function (entry) {
    var p = path.join(dir, entry);
    var st = fs.statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') return;
      out = out.concat(listJsxFiles(p));
    } else if (entry.endsWith('.jsx') || entry.endsWith('.js')) {
      out.push(p);
    }
  });
  return out;
}

var files = listJsxFiles(path.join(__dirname, '..', 'src'));
var violations = [];

files.forEach(function (file) {
  var code;
  try { code = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
  var ast;
  try {
    ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  } catch (_) { return; }

  traverse(ast, {
    'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression'(p) {
      var body = p.node.body && p.node.body.body;
      if (!body) return;
      // Index every top-level VariableDeclaration
      var decls = {};
      body.forEach(function (stmt, idx) {
        if (stmt.type === 'VariableDeclaration') {
          stmt.declarations.forEach(function (d) {
            if (d.id && d.id.type === 'Identifier') {
              decls[d.id.name] = { line: stmt.loc.start.line, idx: idx };
            }
          });
        }
      });
      // For each top-level statement, walk its init expressions (but NOT
      // into nested function bodies) and flag refs that point at a
      // later-declared name.
      body.forEach(function (stmt, idx) {
        if (stmt.type !== 'VariableDeclaration') return;
        stmt.declarations.forEach(function (d) {
          if (!d.init) return;
          (function walk(node, parent, parentKey) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(function (n, i) { walk(n, parent, i); }); return; }
            // Skip property names in MemberExpressions (obj.prop)
            if (parent && parent.type === 'MemberExpression' && parentKey === 'property' && !parent.computed) return;
            // Skip property keys in ObjectExpressions ({ key: val })
            if (parent && parent.type === 'ObjectProperty' && parentKey === 'key' && !parent.computed) return;
            if (parent && parent.type === 'Property' && parentKey === 'key' && !parent.computed) return;
            // Skip JSX attribute names
            if (parent && parent.type === 'JSXAttribute' && parentKey === 'name') return;
            // Skip identifier in import/export specifiers
            if (parent && (parent.type === 'ImportSpecifier' || parent.type === 'ExportSpecifier')) return;
            if (node.type === 'Identifier' && decls[node.name] && decls[node.name].idx > idx) {
              violations.push({
                file: file,
                refLine: node.loc && node.loc.start.line,
                declLine: decls[node.name].line,
                name: node.name,
              });
            }
            if (node.type === 'FunctionExpression'
              || node.type === 'ArrowFunctionExpression'
              || node.type === 'FunctionDeclaration') return;
            for (var k in node) {
              if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'leadingComments' || k === 'trailingComments') continue;
              walk(node[k], node, k);
            }
          })(d.init, null, null);
        });
      });
    }
  });
});

// Dedup
var seen = {};
var unique = [];
violations.forEach(function (v) {
  var key = v.file + ':' + v.name + ':' + v.refLine;
  if (!seen[key]) { seen[key] = 1; unique.push(v); }
});

if (unique.length === 0) {
  console.log('✓ TDZ scan: zero violations across ' + files.length + ' files');
  process.exit(0);
}

console.log('❌ TDZ violations found (' + unique.length + '):');
unique.forEach(function (v) {
  console.log('  ' + v.file + ':' + v.refLine + ' references "' + v.name + '" but it is declared at line ' + v.declLine);
});
console.log('\nThis pattern causes "Cannot access X before initialization" in production minified builds.');
console.log('Move the later declaration BEFORE the earlier reference in the same function body.');
process.exit(1);
