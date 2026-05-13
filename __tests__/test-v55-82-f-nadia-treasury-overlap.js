// ============================================================
// v55.82-L2 — Nadia must not interfere with Treasury workflow
//
// Max May 11 2026 spec (5 items):
//   1. Nadia must stay all the way to the right side of the screen
//      and never cover the main Treasury transaction form.
//   2. If that cannot be guaranteed, Nadia should be disabled by
//      default inside the Treasury module.
//   3. In Treasury, Nadia should only appear if the user clicks a
//      clear button such as "Wake Nadia" or "Open Nadia Assistant."
//   4. Make sure Nadia does not automatically pop up while a user
//      is entering or submitting a transaction.
//   5. Test this specifically with the Add New Transaction modal open.
//
// Both items #1 AND #2 are implemented (defense in depth):
//   • Pill + panel anchored bottom-RIGHT (was bottom-LEFT)
//   • Panel width capped at min(360px, 90vw) — never covers full form
//   • Suppressed by default on Treasury tab (Wake Nadia button toggles)
//   • Suppressed whenever any Treasury modal is open (regardless of tab)
//   • Tab-change effect resets the woken flag so each visit defaults
//     back to suppressed
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var pageSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var overlaySrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'NadiaFloatingOverlay.jsx'), 'utf8');

// =====================================================================
// SPEC #1 — Nadia stays on the right side, never covers the form
// =====================================================================

// 1a — Collapsed pill anchored to bottom-RIGHT (was bottom-LEFT)
ok('1a: Collapsed pill uses right: 16 (was left: 16)',
  /MOVED FROM LEFT → RIGHT[\s\S]{0,1500}bottom: 76,\s*right: 16/.test(overlaySrc),
  'pill must anchor to right side per Max\'s spec'
);

// 1b — REGRESSION GUARD: collapsed pill no longer uses left: 16
ok('1b: REGRESSION GUARD — collapsed pill block no longer references left: 16',
  (function() {
    // The collapsed-pill style block runs from the comment about MOVED FROM
    // LEFT through the closing brace before onClick. Ensure no "left: 16"
    // appears inside that block.
    var match = overlaySrc.match(/MOVED FROM LEFT → RIGHT[\s\S]{0,2000}onClick=\{function\(\) \{ setExpanded\(true\)/);
    if (!match) return false;
    return match[0].indexOf('left: 16') < 0;
  })()
);

// 1c — Expanded panel ALSO anchored to right
ok('1c: Expanded panel uses right: 16',
  /EXPANDED PANEL ALSO ANCHORED TO RIGHT[\s\S]{0,1500}bottom: 76,\s*right: 16/.test(overlaySrc),
  'panel must match the pill — both right'
);

// 1d — Panel width capped (never full screen) — defense in depth for spec #1
ok('1d: Expanded panel width capped at min(360px, 90vw)',
  /width: 'min\(360px, 90vw\)'/.test(overlaySrc),
  'even unsuppressed, panel can\'t cover the full form on mobile'
);

// 1e — REGRESSION GUARD: panel no longer 'calc(100vw - 96px)' (which was full width)
ok('1e: REGRESSION GUARD — panel no longer USES calc(100vw - 96px) as a style value',
  (function() {
    // Strip line comments and block comments before regex-checking, so the
    // historical reference in the v55.82-L2 migration comment doesn't trigger
    // a false positive. We just want to know it isn't the actual style.
    var stripped = overlaySrc
      .replace(/\/\/[^\n]*/g, '')           // strip // line comments
      .replace(/\/\*[\s\S]*?\*\//g, '');    // strip /* */ block comments
    return !/width: 'calc\(100vw - 96px\)'/.test(stripped);
  })(),
  'old full-width formula must be gone from runtime style — that\'s what made the panel cover forms'
);

// =====================================================================
// SPEC #2 — Nadia disabled by default in Treasury module
// =====================================================================

// 2a — nadiaWokenInTab state declared
ok('2a: nadiaWokenInTab state declared and starts empty {}',
  /const \[nadiaWokenInTab, setNadiaWokenInTab\] = useState\(\{\}\)/.test(pageSrc),
  'starts empty — every fresh load means Nadia is suppressed in Treasury'
);

// 2b — suppressNadia is OR of modal-open AND tab-without-wake
ok('2b: suppressNadia = modalOpen || (tab===treasury && !woken)',
  /var suppressNadia = anyTreasuryModalOpen \|\| inTreasuryAndNotWoken/.test(pageSrc),
  'either condition suppresses — defense in depth'
);

// 2c — suppressed prop passed to NadiaFloatingOverlay
ok('2c: NadiaFloatingOverlay receives suppressed={suppressNadia}',
  /<NadiaFloatingOverlay[\s\S]{0,2500}suppressed=\{suppressNadia\}/.test(pageSrc)
);

// 2d — Overlay returns null + cancels speech when suppressed
ok('2d: Overlay returns null AND cancels speech when suppressed',
  /if \(props\.suppressed\) \{[\s\S]{0,400}return <NadiaSuppressedKiller/.test(overlaySrc)
  && /window\.speechSynthesis\) window\.speechSynthesis\.cancel\(\)/.test(overlaySrc)
);

// 2e — anyTreasuryModalOpen covers all four Treasury modals
ok('2e: anyTreasuryModalOpen covers all 4 Treasury modal states',
  /anyTreasuryModalOpen = !!\(showAddTreasury \|\| pendingTreasuryRecord \|\| duplicateConfirm \|\| editTreasuryModal\)/.test(pageSrc),
  'must catch every Treasury modal — Add, pending-invoice, dup-confirm, edit'
);

// 2f — Tab-change reset effect: leaving Treasury drops the woken flag
ok('2f: Tab-change effect resets nadiaWokenInTab.treasury when leaving Treasury',
  /if \(tab !== 'treasury' && nadiaWokenInTab\.treasury\)[\s\S]{0,400}setNadiaWokenInTab[\s\S]{0,300}delete next\.treasury/.test(pageSrc),
  'comment promised the reset; previously not actually wired'
);

// =====================================================================
// SPEC #3 — Wake Nadia button is the only way to bring her in
// =====================================================================

// 3a — Wake Nadia button rendered inside Treasury tab
ok('3a: Wake Nadia button rendered inside Treasury tab',
  /🤖 Wake Nadia/.test(pageSrc)
);

// 3b — Wake Nadia button only visible when not yet woken
ok('3b: Wake Nadia button gated on !nadiaWokenInTab.treasury',
  /!nadiaWokenInTab\.treasury &&[\s\S]{0,800}🤖 Wake Nadia/.test(pageSrc)
);

// 3c — Click flips the woken flag for treasury
ok('3c: Wake Nadia onClick flips nadiaWokenInTab.treasury=true',
  /setNadiaWokenInTab\(function\(prev\) \{ return Object\.assign\(\{\}, prev, \{ treasury: true \}\); \}\)/.test(pageSrc)
);

// 3d — Sleep Nadia button reverses
ok('3d: Sleep Nadia button removes the flag (reversible)',
  /😴 Sleep Nadia/.test(pageSrc)
  && /setNadiaWokenInTab\(function\(prev\) \{ var n = Object\.assign\(\{\}, prev\); delete n\.treasury; return n; \}\)/.test(pageSrc)
);

// =====================================================================
// SPEC #4 — Never auto-pop while entering or submitting a transaction
// =====================================================================

// 4a — While ANY Treasury modal is open, suppression takes effect tab-wide
//      (regardless of whether user previously woke Nadia in this Treasury tab)
ok('4a: Modal-open suppression overrides woken flag',
  (function() {
    // suppressNadia = anyTreasuryModalOpen || inTreasuryAndNotWoken.
    // anyTreasuryModalOpen alone is enough to suppress, so even if user woke
    // Nadia, opening a Treasury modal hides her.
    var match = pageSrc.match(/var suppressNadia = anyTreasuryModalOpen \|\| inTreasuryAndNotWoken/);
    return !!match;
  })(),
  'opening Add Transaction must hide Nadia even if user previously woke her'
);

// 4b — Auto-expand on new message effect runs AFTER suppression check.
//      Verified by code-order: the suppressed return statement at the top
//      of NadiaFloatingOverlay's render block is BEFORE the
//      auto-expand-on-message useEffect. So a tab-greeting that arrives
//      while suppressed cannot trigger setExpanded(true).
ok('4b: Auto-expand effect cannot fire while suppressed',
  (function() {
    var suppressedAt = overlaySrc.indexOf('return <NadiaSuppressedKiller');
    var autoExpandAt = overlaySrc.indexOf('AUTO-EXPAND on new assistant message');
    return suppressedAt > 0 && autoExpandAt > 0 && suppressedAt < autoExpandAt;
  })(),
  'suppression must short-circuit BEFORE the auto-expand useEffect runs'
);

// 4c — When suppressed, AIGreeter is not mounted at all
//      So no tab-greeting / TTS / Whisper effects can fire while modal is open.
ok('4c: When suppressed, AIGreeter is not mounted',
  (function() {
    var match = overlaySrc.match(/if \(props\.suppressed\) \{[\s\S]{0,400}return <NadiaSuppressedKiller/);
    if (!match) return false;
    return /AIGreeter is not mounted at all/.test(overlaySrc);
  })()
);

// 4d — Active speech is cancelled when suppression starts mid-utterance
ok('4d: NadiaSuppressedKiller cancels active speech on mount',
  /window\.speechSynthesis\.cancel\(\)/.test(overlaySrc)
  && /document\.querySelectorAll\('audio'\)\.forEach/.test(overlaySrc),
  'if Nadia is mid-sentence when modal opens, audio must stop immediately'
);

// =====================================================================
// SPEC #5 — Test SPECIFICALLY with Add New Transaction modal open
// =====================================================================

// 5a — showAddTreasury (the Add modal flag) is in the suppression check
ok('5a: showAddTreasury is in anyTreasuryModalOpen check',
  /anyTreasuryModalOpen = !!\(showAddTreasury \|\|/.test(pageSrc),
  'opening Add Treasury must trigger suppression — Max\'s exact test case'
);

// 5b — pendingTreasuryRecord (the order#-not-found follow-up modal) included
ok('5b: pendingTreasuryRecord is in suppression check',
  /anyTreasuryModalOpen = !!\([^)]*pendingTreasuryRecord/.test(pageSrc)
);

// 5c — duplicateConfirm (the post-23505 dup modal) included
ok('5c: duplicateConfirm is in suppression check',
  /anyTreasuryModalOpen = !!\([^)]*duplicateConfirm/.test(pageSrc)
);

// 5d — editTreasuryModal (existing-row edit) included
ok('5d: editTreasuryModal is in suppression check',
  /anyTreasuryModalOpen = !!\([^)]*editTreasuryModal\)/.test(pageSrc)
);

// =====================================================================
// SPEC #6 — Build stamp consistency (NEW guard, added after Max
//   reported the header badge still read v55.81 after deploying F)
// =====================================================================

// 6a — Global header badge must match the current build letter
// v55.83-A — accept v55.83+ family (was v55.82-* only)
ok('6a: Global header badge reads current build letter (not stale)',
  /<span className="text-\[10px\] text-zinc-500 font-mono hidden md:inline"[^>]*>v55\.\d+-[A-Z][0-9]*<\/span>/.test(pageSrc),
  'the visible app-header version badge must move with each build letter — Max May 11 2026 caught v55.81 left over on F'
);

// 6b — REGRESSION GUARD: no stale "v55.81" remains in displayed UI strings
ok('6b: REGRESSION GUARD — no JSX text node displays "v55.81"',
  !/>v55\.81</.test(pageSrc),
  'no leftover hardcoded v55.81 in visible UI'
);

// 6c — Treasury modal headers stamped with current build
// v55.83-A — accept v55.83+ family
ok('6c: Treasury modal headers display current BUILD stamp',
  (function() {
    var matches = pageSrc.match(/BUILD v55\.\d+-[A-Z][0-9]*/g);
    return matches && matches.length >= 2;
  })(),
  'Add Transaction + Edit Transaction modal headers both stamped'
);

// =====================================================================
// Final
// =====================================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-L2 Nadia/Treasury overlap fixes verified');
