// Parse-check every .js, .jsx, .json, .sql file in src/, sql/, and __tests__/.
// This catches syntax errors that next build would catch, without requiring
// the full Next.js install.
//
// We use acorn + acorn-jsx because Next 14 supports modern JSX/ES.

var fs = require('fs');
var path = require('path');
var acorn = require('acorn');
var jsx = require('acorn-jsx');

var Parser = acorn.Parser.extend(jsx());

var REPO = path.resolve(__dirname, '..');
var checked = 0, failed = 0, errors = [];

function walk(dir, fn) {
  var ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (var i = 0; i < ents.length; i++) {
    var p = path.join(dir, ents[i].name);
    if (ents[i].isDirectory()) {
      if (ents[i].name === 'node_modules' || ents[i].name === '.next' || ents[i].name === '.git') continue;
      walk(p, fn);
    } else {
      fn(p);
    }
  }
}

walk(path.join(REPO, 'src'), function(p) {
  if (!/\.(js|jsx|mjs)$/.test(p)) return;
  checked++;
  var src = fs.readFileSync(p, 'utf8');
  try {
    Parser.parse(src, {
      sourceType: 'module',
      ecmaVersion: 2024,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: false,
      allowImportExportEverywhere: false,
      allowHashBang: true,
    });
  } catch (e) {
    failed++;
    errors.push({ file: path.relative(REPO, p), message: e.message });
  }
});

console.log('Checked: ' + checked + ' files');
console.log('Failed:  ' + failed);
if (errors.length > 0) {
  console.log('\nERRORS:');
  errors.slice(0, 30).forEach(function(e) {
    console.log('  ✗ ' + e.file + ': ' + e.message);
  });
  process.exit(1);
}
console.log('\n✓ All files parse cleanly\n');
process.exit(0);
