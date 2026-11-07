// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QH — The WIDE duplicate radar (Max, Nov 7 12:26: "duplicates can be
// anything similar that need to be flagged such as same date or reference or
// release number or container number etc") + token-in-URL so Mailgun/
// SendGrid can actually deliver to the bills inbound address.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QH — wide duplicate radar');

// FUNCTIONAL: run refTokens for real
var src = R('src/lib/bill-dup-server.js');
var names = [];
var cjs = src.replace(/^import [^\n]*$/gm, '')
  .replace(/export async function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'async function ' + n; })
  .replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; });
cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
var mod = { exports: {} };
new Function('module', 'exports', cjs)(mod, mod.exports);
var refTokens = mod.exports.refTokens;

var toks = refTokens('Invoice INV-20261107 release AMERICA-1746 container MSKU1234567 freight total USD');
ok('1a: reference tokens — invoice refs, release numbers, container numbers all caught; plain WORDS never match (digit required, ≥5 chars)',
  toks.indexOf('INV-20261107') >= 0 && toks.indexOf('AMERICA-1746') >= 0 && toks.indexOf('MSKU1234567') >= 0 &&
  toks.indexOf('FREIGHT') < 0 && toks.indexOf('TOTAL') < 0 && toks.indexOf('USD') < 0);
ok('1b: capped at 6 tokens, deduped',
  refTokens('A1234 A1234 B1234 C1234 D1234 E1234 F1234 G1234 H1234').length === 6);

ok('2 (12:39 refinement): the radar flags — hard vendor+number (skip), shared reference token anywhere (bill_number OR notes), and ONE combined vendor+amount+SAME-date check — each suspect named with its paid status',
  /or\('bill_number\.ilike\.%' \+ tok \+ '%,notes\.ilike\.%' \+ tok \+ '%'\)/.test(src) &&
  /shares reference "' \+ tok \+ '" with/.test(src) &&
  /same vendor, same amount, same date as/.test(src) &&
  /\.eq\('bill_date', d\.bill_date\)/.test(src) &&
  !/within 10 days/.test(src) &&
  /already PAID/.test(src));
ok('3: fail-soft and bounded — any lookup error means fewer flags (never a blocked import); at most 3 reasons, warning capped at 400 chars',
  /fail-soft: fewer flags, never a blocked import/.test(src) &&
  /reasons\.length < 3/.test(src) && /\.substring\(0, 400\)/.test(src));
ok('4: ONE lib serves BOTH entry paths (file import + email inbound) — no duplicated radar logic left in either route',
  /billDupVerdict/.test(R('src/app/api/accounting/bills/route.js')) &&
  /billDupVerdict/.test(R('src/app/api/accounting/bills/inbound/route.js')) &&
  !/POSSIBLE DUPLICATE of/.test(R('src/app/api/accounting/bills/route.js')) &&
  !/POSSIBLE DUPLICATE of/.test(R('src/app/api/accounting/bills/inbound/route.js')));
ok('5: inbound accepts the token in the URL too (?token=) — Mailgun routes / SendGrid Parse cannot send custom headers; header path unchanged',
  /searchParams\.get\('token'\)/.test(R('src/app/api/accounting/bills/inbound/route.js')));

console.log('');
console.log('QH: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
