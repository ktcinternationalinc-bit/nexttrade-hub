/* v72 HOTFIX 23 — Per Max May 27 2026 screenshot #2: the HOTFIX 21 height
 * fix was correct, but the modal centered itself vertically. On a tall
 * viewport with the modal at 100vh-12px, centering means the modal's TOP
 * edge sits at -6px or so — the title bar and first fields scroll
 * off-screen above the viewport with no way to scroll up.
 *
 * Fix: outer overlay flex alignment goes from `items-center` → `items-start`.
 * The modal now anchors to the top of the viewport with the 6px padding
 * above it. Everything else stays the same (height calc, sticky footer,
 * Region 1 cap).
 *
 * No height reduction — that part stayed working. The fix is exclusively
 * about WHERE the modal sits on the Y axis when it opens.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var rec = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryReceiving.jsx'), 'utf8');

console.log('\n── Modal anchored to top, NOT centered ──');

ok('A1: Outer overlay uses items-start (anchor to top of viewport)',
  /fixed inset-0 z-\[200\] bg-black\/70 backdrop-blur-sm flex items-start justify-center/.test(rec));

ok('A2: Old items-center has been removed from the modal overlay',
  !/fixed inset-0 z-\[200\] bg-black\/70 backdrop-blur-sm flex items-center justify-center/.test(rec));

console.log('\n── Everything from HOTFIX 21 preserved ──');

ok('B1: Modal still uses near-fullscreen height (calc(100vh - 12px))',
  /height: 'calc\(100vh - 12px\)'/.test(rec));

ok('B2: Modal still uses overflow:hidden so children stay inside',
  /maxHeight: 'calc\(100vh - 12px\)'[\s\S]{0,200}overflow: 'hidden'/.test(rec));

ok('B3: Inner modal still uses flex column layout',
  /display: 'flex', flexDirection: 'column'/.test(rec));

ok('B4: Region 1 still capped at 45vh with own internal scroll',
  /padding: '20px 20px 0 20px'[\s\S]{0,300}maxHeight: '45vh'[\s\S]{0,200}overflowY: 'auto'/.test(rec));

ok('B5: Footer still has flexShrink:0',
  /flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl[\s\S]{0,200}padding: '12px 20px', flexShrink: 0/.test(rec));

ok('B6: Top bar still has flexShrink:0',
  /background: '#3730a3', padding: '14px 20px', flexShrink: 0/.test(rec));

ok('B7: Region 2 (product lines) still the scroll region',
  /padding: '12px 20px', flex: 1, overflowY: 'auto', minHeight: 0/.test(rec));

ok('B8: Outer padding still 6px (gives equal 6px top + 6px bottom around the modal)',
  /style=\{\{ padding: 6 \}\}/.test(rec));

console.log('\n── Comment trail records the HOTFIX 23 fix ──');

ok('C1: Comment now references HOTFIX 21+23 (combined)',
  /HOTFIX 21\+23 — Max May 27 2026 screenshots/.test(rec));

ok('C2: Comment explains the items-start fix',
  /items-start[\s\S]{0,400}HOTFIX 23/.test(rec) || /HOTFIX 23[\s\S]{0,400}items-start/.test(rec));

ok('C3: Comment explains modal pushed its TOP off-screen (root cause statement)',
  /pushed its TOP off-screen/.test(rec) || /pushed its top off-screen/i.test(rec));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 23 — modal anchored to top, full height preserved, title bar always visible on open');
console.log('══════════════════════════════════════════════');
