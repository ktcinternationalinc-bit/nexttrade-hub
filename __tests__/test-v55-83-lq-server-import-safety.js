// ============================================================
// v55.83-LQ — LIVE P0: bank-transaction push (and every other gated Wave server route) crashed with
// "(0 , d.ln) is not a function". ROOT CAUSE: src/lib/wave-business.js is a 'use client' module, but 10
// SERVER routes imported isPlaceholderWaveBusiness from it. A server file importing a function from a
// 'use client' module gets a CLIENT-REFERENCE PROXY, not the real function — calling it server-side throws
// "(0, x.y) is not a function". The build compiles fine; only a live server call dies (exactly the
// static-tests-miss-runtime-imports trap). Fix: import from the server-safe lib/wave-business-shared.
// This guard scans EVERY api route so the class can never come back.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function walk(dir, acc) {
  var ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  ents.forEach(function (e) { var p = path.join(dir, e.name); if (e.isDirectory()) { walk(p, acc); } else if (e.name === 'route.js') { acc.push(p); } });
  return acc;
}
var apiDir = path.join(__dirname, '..', 'src', 'app', 'api');
var routes = walk(apiDir, []);
// A server route must NOT import from the bare 'use client' wave-business module (the -shared variant is OK).
var offenders = routes.filter(function (f) { return /from\s+'[^']*lib\/wave-business'\s*;/.test(fs.readFileSync(f, 'utf8')); });

ok('1: scanned server routes and NONE import from the \'use client\' lib/wave-business (the runtime "(0,x) is not a function" trap)',
  routes.length > 10 && offenders.length === 0,
  offenders.map(function (f) { return path.relative(path.join(__dirname, '..'), f); }).join(', '));
ok('2: the module split is real — wave-business.js is \'use client\'; wave-business-shared.js is server-safe and exports isPlaceholderWaveBusiness',
  /^['"]use client['"]/.test(rd('src/lib/wave-business.js')) &&
  !/^['"]use client['"]/.test(rd('src/lib/wave-business-shared.js')) &&
  /export function isPlaceholderWaveBusiness/.test(rd('src/lib/wave-business-shared.js')));
ok('3: the reported route (push-transaction) imports isPlaceholderWaveBusiness from wave-business-shared',
  /import \{ isPlaceholderWaveBusiness \} from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/wave-business-shared'/.test(rd('src/app/api/wave/push-transaction/route.js')));
ok('4: the other money-path push routes (payment/customer/invoice) are fixed too',
  /wave-business-shared'/.test(rd('src/app/api/wave/push-payment/route.js')) &&
  /wave-business-shared'/.test(rd('src/app/api/wave/push-customer/route.js')) &&
  /wave-business-shared'/.test(rd('src/app/api/wave/push-invoice-v2/route.js')));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LQ server-import-safety tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
