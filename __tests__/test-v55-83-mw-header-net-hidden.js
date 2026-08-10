// v55.83-MW — Header NET amount hidden by default, eye button to reveal.
//
// Max's request (Aug 10 2026): "toggle off and on the +EGP amount showing on
// the top tool bar.. defaulting to off".
//
// The whole point is the DEFAULT. If a future edit flips useState(false) to
// useState(true), or quietly adds localStorage persistence, the number is
// exposed again on someone's screen and nobody notices until it's on a
// screen-share. These checks exist to make that regression loud.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var whatsNew = read('src/components/WhatsNewWidget.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// Isolate the header NET block so we're not matching stray text elsewhere in
// a 15k-line file (the dashboard has its own TREASURY NET tile).
var netBlockMatch = page.match(/modulePerms\?\.\['Treasury'\] === true\) && \([\s\S]{0,4000}?View Treasury[\s\S]{0,4000}?<\/div>\s*\)\}/);
var netBlock = netBlockMatch ? netBlockMatch[0] : '';

// ══════════════════════════════════════════════════════════════════
// PART A — Default is OFF, and stays off
// ══════════════════════════════════════════════════════════════════

ok('A1: netVisible state exists',
  /const \[netVisible, setNetVisible\] = useState\(/.test(page));
ok('A2: netVisible DEFAULTS TO FALSE (hidden) — the entire point of MW',
  /const \[netVisible, setNetVisible\] = useState\(false\)/.test(page));
// Strip comments first — the source comment legitimately mentions localStorage
// while EXPLAINING why we don't use it. We only care about executable code.
var pageCode = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('A3: netVisible is NOT persisted to localStorage (must re-hide every load)',
  !/localStorage[\s\S]{0,120}netVisible/.test(pageCode) && !/netVisible[\s\S]{0,120}localStorage/.test(pageCode));
ok('A4: no lazy-initialiser reading a saved value into netVisible',
  !/useState\(\s*(function|\(\)\s*=>)[\s\S]{0,200}netVisible/.test(page));
ok('A5: comment records that non-persistence is deliberate, not an oversight',
  /HIDDEN BY DEFAULT[\s\S]{0,900}NOT persisted/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART B — Masked state genuinely hides the figure
// ══════════════════════════════════════════════════════════════════

ok('B1: header NET block was found for inspection', netBlock.length > 0);
ok('B2: the amount only renders when netVisible is true',
  /\{netVisible \? \(/.test(netBlock));
ok('B3: masked state shows dots, not the number',
  /••••••/.test(netBlock));
ok('B4: fE(allTimeNet) sits on the VISIBLE branch only (not rendered while masked)',
  netBlock.indexOf('{netVisible ? (') > -1 &&
  netBlock.indexOf('fE(allTimeNet)') > netBlock.indexOf('{netVisible ? (') &&
  netBlock.indexOf('fE(allTimeNet)') < netBlock.indexOf(') : ('));
ok('B5: the coloured status dot is also suppressed while masked (a green/red dot leaks the sign)',
  netBlock.indexOf('boxShadow') > netBlock.indexOf('{netVisible ? (') &&
  netBlock.indexOf('boxShadow') < netBlock.indexOf(') : ('));
ok('B6: masked dots use a muted grey, never the emerald/red money colours',
  /color: '#52525b' \}/.test(netBlock) && !/••••••[\s\S]{0,200}#34d399/.test(netBlock));

// ══════════════════════════════════════════════════════════════════
// PART C — The toggle itself
// ══════════════════════════════════════════════════════════════════

ok('C1: a toggle handler flips netVisible',
  /setNetVisible\(!netVisible\)|setNetVisible\(\s*(function|\()[^)]*=>\s*!/.test(netBlock));
ok('C2: toggle is a real button with an accessible label',
  /aria-label=\{netVisible \? 'Hide the treasury net amount' : 'Show the treasury net amount'\}/.test(netBlock));
ok('C3: toggle reports its state to screen readers',
  /aria-pressed=\{netVisible\}/.test(netBlock));
ok('C4: hover tooltip explains what the eye does',
  /title=\{netVisible \? 'Hide the net amount' : 'Show the net amount'\}/.test(netBlock));
ok('C5: eye and eye-off icons both present (icon changes with state)',
  /eye-off/.test(netBlock) && /<circle cx="12" cy="12" r="3"/.test(netBlock));

// ══════════════════════════════════════════════════════════════════
// PART D — Nothing else about the header regressed
// ══════════════════════════════════════════════════════════════════

ok('D1: NO nested buttons — the shell is a div, not a button wrapping a button',
  /<div className="flex items-center border border-zinc-800 hover:border-zinc-600 rounded-sm transition-colors"/.test(netBlock) &&
  !/<button[\s\S]{0,1500}<button[\s\S]{0,600}<\/button>[\s\S]{0,1500}<\/button>/.test(netBlock.replace(/<\/button>\s*<button/g, '</button>|<button')));
ok('D2: clicking the NET box still navigates to Treasury in all-time mode',
  /onClick=\{\(\) => \{ setTab\('treasury'\); setMode\('all'\); \}\}/.test(netBlock));
ok('D3: the Treasury permission gate is unchanged',
  /\(isSuperAdmin \|\| modulePerms\?\.\['Treasury'\] === true\) && \(/.test(page));
ok('D4: the NET caption is still shown (only the figure is masked)',
  /uppercase tracking-wider">NET<\/span>/.test(netBlock));
ok('D5: allTimeNet itself is untouched — no change to how the number is calculated',
  /const allTimeNet = useMemo\(\(\) => treasury\.reduce\(\(a, t\) => a \+ Number\(t\.cash_in \|\| 0\) - Number\(t\.cash_out \|\| 0\), 0\), \[treasury\]\)/.test(page));
ok('D6: the dashboard TREASURY NET tile was left alone (out of scope — toolbar only)',
  /label="TREASURY NET"/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART E — Release notes (PERMANENT RULE 1) + the MU/MV backfill
// ══════════════════════════════════════════════════════════════════

ok('E1: header build badge bumped to MW',
  /v55\.83-MW<\/span>/.test(page));
ok('E2: MW has a What\'s New entry',
  /version: 'v55\.83-MW'/.test(whatsNew));
ok('E3: MW entry is first in BUILD_HISTORY (newest at top)',
  whatsNew.indexOf("version: 'v55.83-MW'") < whatsNew.indexOf("version: 'v55.83-MT'"));
ok('E4: MU release note backfilled (shipped with no note)',
  /version: 'v55\.83-MU'/.test(whatsNew));
ok('E5: MV release note backfilled (shipped with no note)',
  /version: 'v55\.83-MV'/.test(whatsNew));
ok('E6: MW public bullets avoid developer jargon',
  !/useState|localStorage|aria-|jsx|component|prop\b/i.test(
    (whatsNew.match(/version: 'v55\.83-MW'[\s\S]*?superAdminOnly/) || [''])[0]
  ));

// ══════════════════════════════════════════════════════════════════

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-MW header NET hidden-by-default');
}
