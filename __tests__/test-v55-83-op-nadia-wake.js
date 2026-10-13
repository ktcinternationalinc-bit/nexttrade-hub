// v55.83-OP — Nadia never auto-starts (Max, Oct 13: "the ai helper
// automatically starts talking on each page... wake it first with a button").
var fs = require('fs');
var path = require('path');
function rd(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
var ov = rd('src/components/NadiaFloatingOverlay.jsx');
var pg = rd('src/app/page.jsx');
var failed = [];
function ok(l, c) { if (c) console.log('✓ ' + l); else { failed.push(l); console.log('✗ ' + l); } }

ok('OP1: overlay awake defaults FALSE and is never persisted (no storage key for it)',
  /var \[awake, setAwake\] = useState\(false\);/.test(ov) && !/awake.*localStorage|localStorage.*awake/i.test(ov.split('var [awake')[1].split('useEffect')[0]));
ok('OP2: expanded is NOT restored from storage — every page load starts collapsed + asleep',
  /var \[expanded, setExpanded\] = useState\(false\);/.test(ov) &&
  !/localStorage\.getItem\(EXPANDED_STORAGE_KEY\)/.test(ov));
ok('OP3: asleep = AIGreeter UNMOUNTED in the collapsed state (no hidden mount, no greetings, no TTS)',
  /\{awake && \(/.test(ov) && /mounts ONLY while awake/.test(ov));
ok('OP4: the pill IS the wake button — shows "Wake Nadia" asleep, wakes + expands on click',
  /Wake Nadia/.test(ov) && /onClick=\{function\(\) \{ setAwake\(true\); setExpanded\(true\);/.test(ov) &&
  /💤/.test(ov));
ok('OP5: closing (X) puts her back to sleep AND silences speech immediately',
  /setExpanded\(false\); setAwake\(false\);/.test(ov) && /speechSynthesis\.cancel/.test(ov));
ok('OP6: auto-expand on new messages can never fire while asleep',
  /awake && !expanded && !userCollapsedAt/.test(ov));
ok('OP7: the DASHBOARD greeter no longer auto-mounts — gated on nadiaWokenInTab.dashboard with a Wake button',
  /greeterSettings\.enabled && nadiaWokenInTab\.dashboard\) \? \(/.test(pg) &&
  /Wake \{activePersonaName\}/.test(pg));
ok('OP8: leaving the dashboard puts her back to sleep (mirrors the Treasury pattern)',
  /tab !== 'dashboard' && nadiaWokenInTab\.dashboard/.test(pg) &&
  /tab !== 'treasury' && nadiaWokenInTab\.treasury/.test(pg));

if (failed.length) { console.log('FAILED (' + failed.length + '):'); failed.forEach(function (x) { console.log('  - ' + x); }); process.exit(1); }
else { console.log('ALL CHECKS PASSED — v55.83-OP nadia wake-button'); }
