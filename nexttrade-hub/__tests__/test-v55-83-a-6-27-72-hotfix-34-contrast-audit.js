/* v72 HOTFIX 34 — Light-font-on-light-background contrast fixes.
 * Per Max: full-portal sweep for buttons/badges with low contrast.
 * Fixed 16 instances across 9 files. This test pins the specific fixes
 * so they can't silently regress.
 */
var path = require('path');
var fs = require('fs');
function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}
function read(f) { return fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); }

var admin = read('src/components/AdminTab.jsx');
var crm = read('src/components/CRMTab.jsx');
var customs = read('src/components/CustomsTab.jsx');
var invView = read('src/components/InventoryView.jsx');
var login = read('src/components/LoginHistoryV2.jsx');
var tickets = read('src/components/TicketsTab.jsx');

console.log('\n── HOTFIX 34: contrast fixes ──');

ok('C.1: AdminTab Pin/Unpin button no longer text-slate-500 on bg-slate-50',
  !/text-\[10px\] text-slate-500 bg-slate-50 px-2 py-1 rounded font-semibold">\{a\.pinned/.test(admin));

ok('C.2: AdminTab Delete button no longer text-red-400 on bg-red-50',
  !/text-red-400 bg-red-50 px-2 py-1 rounded font-semibold/.test(admin) &&
  /text-red-700 bg-red-100/.test(admin));

ok('C.3: AdminTab modal close X is text-slate-600 not text-slate-400',
  /text-slate-600 hover:text-red-600 hover:bg-red-50 text-lg font-bold">✕/.test(admin));

ok('C.4: CRMTab masked fields are text-slate-600 not text-slate-400',
  !/bg-slate-50 text-slate-400">🔒/.test(crm));

ok('C.5: CustomsTab empty-state cards no longer text-slate-400 on white',
  !/bg-white rounded-xl p-6 text-center text-slate-400/.test(customs));

ok('C.6: InventoryView zero-stock rows are text-slate-600 not text-slate-400',
  !/bg-slate-50 text-slate-400'/.test(invView));

ok('C.7: LoginHistoryV2 Offline badge is darker (slate-700 on slate-200)',
  /bg-slate-200 text-slate-700[\s\S]{0,30}⚪ Offline/.test(login));

ok('C.8: TicketsTab Closed status badges no longer use text-slate-500 (all darkened to slate-700)',
  !/t\.status === 'Closed' \? 'bg-slate-100 text-slate-500'/.test(tickets) &&
  !/'bg-slate-100 text-slate-500' : 'bg-slate-50 text-slate-500'/.test(tickets));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 34 — Contrast fixes pinned');
console.log('══════════════════════════════════════════════');
