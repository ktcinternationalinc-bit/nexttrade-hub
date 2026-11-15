/* v72 HOTFIX 21 — Per Max May 27 2026 screenshot: Inbound Shipments modal
 * was appearing short with bottom Cancel/Save/Submit buttons scrolled off
 * below the fold. Root cause: outer overlay had overflow-y-auto AND
 * Region 1 had flexShrink:0 with no max-height cap — so when its content
 * grew (Expected Totals block + expanded Shipment Info), the inner box
 * overflowed and the WHOLE overlay scrolled, hiding the footer.
 *
 * Triple fix:
 *   1. Outer overlay swapped from `overflow-y-auto` → `flex items-center`
 *      so it can't scroll; the inner box is the only scroll container.
 *   2. Inner box gets `overflow: hidden` so its children can't push past it.
 *   3. Region 1 gets `maxHeight: 45vh` + own `overflowY: auto` — if its
 *      content is huge it scrolls internally instead of pushing the footer off.
 *   4. Region 3 (footer) + top bar both get `flexShrink: 0` so they're
 *      never compressed by an oversized sibling.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var rec = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryReceiving.jsx'), 'utf8');

console.log('\n── Fix 1: outer overlay no longer scrolls ──');

ok('A1: Outer overlay uses flex with no scrolling — anchored to top (HOTFIX 23: items-start instead of items-center so the modal opens at the top of the viewport)',
  /fixed inset-0 z-\[200\] bg-black\/70 backdrop-blur-sm flex items-start justify-center/.test(rec));

ok('A2: Old "overflow-y-auto" removed from overlay (would have made whole overlay scrollable)',
  !/className="fixed inset-0 z-\[200\] bg-black\/70 backdrop-blur-sm overflow-y-auto"/.test(rec));

console.log('\n── Fix 2: inner box clips overflow ──');

ok('B1: Inner modal box has overflow:hidden so children stay inside',
  /maxHeight: 'calc\(100vh - 12px\)'[\s\S]{0,200}overflow: 'hidden'/.test(rec));

ok('B2: Inner modal still uses near-fullscreen height (calc(100vh - 12px))',
  /height: 'calc\(100vh - 12px\)'/.test(rec));

ok('B3: Inner modal uses flex column layout',
  /display: 'flex', flexDirection: 'column'/.test(rec));

console.log('\n── Fix 3: Region 1 has max-height cap with internal scroll ──');

ok('C1: Region 1 max-height capped at 45vh (no more pushing footer off-screen)',
  /padding: '20px 20px 0 20px'[\s\S]{0,300}maxHeight: '45vh'/.test(rec));

ok('C2: Region 1 has its own overflowY:auto so tall content scrolls inside',
  /padding: '20px 20px 0 20px'[\s\S]{0,400}overflowY: 'auto'/.test(rec));

ok('C3: Region 1 still has flexShrink:0 (does not collapse below content min)',
  /padding: '20px 20px 0 20px'[\s\S]{0,200}flexShrink: 0/.test(rec));

ok('C4: Region 1 still has borderBottom separator',
  /padding: '20px 20px 0 20px'[\s\S]{0,300}borderBottom: '1px solid #e2e8f0'/.test(rec));

console.log('\n── Fix 4: footer + top bar pinned with flexShrink:0 ──');

ok('D1: Footer (Cancel/Save Draft/Submit) has flexShrink:0',
  /flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl[\s\S]{0,200}padding: '12px 20px', flexShrink: 0/.test(rec));

ok('D2: Top bar (modal header) has flexShrink:0',
  /background: '#3730a3', padding: '14px 20px', flexShrink: 0/.test(rec));

console.log('\n── Behavior: Region 2 (product lines) still the scroll region ──');

ok('E1: Region 2 still uses flex:1 + overflowY:auto + minHeight:0 (the legit scroll area)',
  /padding: '12px 20px', flex: 1, overflowY: 'auto', minHeight: 0/.test(rec));

console.log('\n── Comment trail ──');

ok('F1: HOTFIX 21 explanation comment still present in the source (HOTFIX 23 extended it instead of replacing)',
  /HOTFIX 21\+23 — Max May 27 2026 screenshots/.test(rec) ||
  /HOTFIX 21 — Max May 27 2026 screenshot/.test(rec));

ok('F2: HOTFIX 21+23 comment names the three fixes',
  /\(1\)[\s\S]{0,400}\(2\)[\s\S]{0,400}\(3\)/.test(rec) &&
  /flex items-start/.test(rec) &&
  /overflow: hidden/.test(rec) &&
  /flexShrink: 0/.test(rec));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 21 — Inbound Shipments modal now fills viewport with sticky footer always visible');
console.log('══════════════════════════════════════════════');
