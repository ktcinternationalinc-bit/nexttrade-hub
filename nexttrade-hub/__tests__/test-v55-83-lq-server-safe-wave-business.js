// v55.83-LQ - Server API routes must not import the client-only wave-business helper.
// A deployed bank_transaction push failed with a minified "(0 , d.ln) is not a function";
// the risky pattern was importing isPlaceholderWaveBusiness from a 'use client' module.
var fs = require('fs');
var path = require('path');
var failures = [];

function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' - ' + hint : '')); console.log('✗ ' + label + (hint ? ' - ' + hint : '')); }
}

function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
    var p = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(p, out); }
    else if (/route\.js$/.test(ent.name)) { out.push(p); }
  });
}

var shared = rd('src/lib/wave-business-shared.js');
var client = rd('src/lib/wave-business.js');
var pushTxn = rd('src/app/api/wave/push-transaction/route.js');
var routeFiles = [];
walk(path.join(__dirname, '..', 'src', 'app', 'api'), routeFiles);

var badRoutes = routeFiles.filter(function (file) {
  var src = fs.readFileSync(file, 'utf8');
  return /from\s+['"][^'"]*lib\/wave-business['"]/.test(src) ||
    /from\s+['"][^'"]*lib\\wave-business['"]/.test(src) ||
    /from\s+['"][^'"]*wave-business['"]/.test(src);
}).map(function (file) {
  return path.relative(path.join(__dirname, '..'), file);
});

ok('1: shared helper exists, exports placeholder constants/check, and is not a client module',
  /export var PLACEHOLDER_WAVE_BUSINESS_IDS/.test(shared) &&
  /export function isPlaceholderWaveBusiness/.test(shared) &&
  !/'use client'/.test(shared));

ok('2: UI helper re-exports the shared placeholder helper for components',
  /from '\.\/wave-business-shared'/.test(client) &&
  /export \{ PLACEHOLDER_WAVE_BUSINESS_IDS, isPlaceholderWaveBusiness \}/.test(client));

ok('3: push-transaction imports the server-safe helper',
  /from '..\/..\/..\/..\/lib\/wave-business-shared'/.test(pushTxn) &&
  !/from '..\/..\/..\/..\/lib\/wave-business'/.test(pushTxn));

ok('4: no API route imports the client-only wave-business module',
  badRoutes.length === 0,
  badRoutes.join(', '));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-LQ server-safe Wave business tests passed');
  process.exit(0);
}
console.log('❌ ' + failures.length + ' FAILED:');
failures.forEach(function (f) { console.log('   - ' + f); });
process.exit(1);
