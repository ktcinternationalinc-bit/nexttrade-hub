// ============================================================
// v55.82-B — UI bug fixes (Max May 9, 2026)
//
// Three problems Max reported with photo evidence:
//
//   PROBLEM 1 (10th time reporting) — yellow text on yellow bg in HR Desk
//   "File a Request" card. Text was unreadable from any angle.
//   FIX: white card surface, slate-900 text, thick amber accent border.
//   Same treatment for the rose "File a Concern" sibling for symmetry.
//
//   PROBLEM 2 — active persona not glowing/pulsing in AssistantsBar.
//   The inline `boxShadow: isActive ? props.activeGlow : undefined` always
//   won over the .ktc-assistant-speaking keyframe animation.
//   FIX: removed inline boxShadow entirely. Two CSS classes drive the
//   glow now: .ktc-assistant-active (idle slow breath) and
//   .ktc-assistant-speaking (faster deep pulse). Both share
//   --ktc-glow-color so per-persona color is preserved.
//
//   PROBLEM 3 — random blinking on all three avatars.
//   transition-all on the Tile combined with the inline boxShadow being
//   added/removed on every React re-render caused all three tiles to
//   flicker.
//   FIX: narrowed transition to transition-[transform,opacity] only.
//   Box-shadow is now ONLY animated by the active/speaking keyframes —
//   never by the React style transition. No more flicker.
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var hrDeskSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MyHRDesk.jsx'), 'utf8');
var assistantsBarSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AssistantsBar.jsx'), 'utf8');
var globalsCssSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

// =====================================================================
// PROBLEM 1 — File a Request card contrast
// =====================================================================

// 1a — File a Request title text is solid slate-900 (near-black), not amber
ok('1a: "File a Request" title uses text-slate-900 (readable from any angle)',
  /<div className="text-sm font-extrabold text-slate-900">File a Request<\/div>/.test(hrDeskSrc),
  'must be slate-900 to guarantee readability'
);

// 1b — Request subtitle uses slate-700 with bold weight (not amber-700)
ok('1b: Request subtitle uses font-semibold text-slate-700 (not text-amber-700)',
  /text-\[12px\] font-semibold text-slate-700">Vacation/.test(hrDeskSrc)
);

// 1c — Card surface is solid white, not the broken amber gradient
ok('1c: Request card uses bg-white not bg-gradient-to-br from-amber-50',
  /onClick=\{openRequest\}[\s\S]{0,400}bg-white border-2 border-amber-500/.test(hrDeskSrc)
);

// 1d — Old broken yellow-on-yellow combo is GONE (regression guard)
ok('1d: REGRESSION GUARD — text-amber-700 + from-amber-50 combo eliminated',
  !/onClick=\{openRequest\}[\s\S]{0,500}text-amber-700/.test(hrDeskSrc)
  && !/onClick=\{openRequest\}[\s\S]{0,500}from-amber-50 to-orange-50/.test(hrDeskSrc),
  'if these reappear we are right back to unreadable'
);

// 1e — Concern card got the same treatment for symmetry
ok('1e: "File a Concern" card also uses bg-white + slate-900 + rose-500 border',
  /onClick=\{openComplaint\}[\s\S]{0,1500}bg-white border-2 border-rose-500[\s\S]{0,800}text-slate-900">File a Concern/.test(hrDeskSrc)
);

// 1f — Emoji + colored border still telegraph the action's meaning
ok('1f: Visual distinction preserved — Request has 📝 + amber border, Concern has 🛡️ + rose border',
  /onClick=\{openRequest\}[\s\S]{0,1500}border-amber-500[\s\S]{0,800}📝/.test(hrDeskSrc)
  && /onClick=\{openComplaint\}[\s\S]{0,1500}border-rose-500[\s\S]{0,800}🛡️/.test(hrDeskSrc)
);

// =====================================================================
// PROBLEM 2 — Active glow not pulsing
// =====================================================================

// 2a — Inline boxShadow is GONE from the Tile's style={} block (root of the override).
//      The comment block above the Tile may still mention "boxShadow" historically;
//      what matters is that the runtime style={} does NOT set it. We scan only the
//      style={Object.assign(...)} block for the real assignment.
ok('2a: inline boxShadow is REMOVED from Tile\'s actual style={} block',
  (function() {
    var m = assistantsBarSrc.match(/style=\{Object\.assign\(\s*\{[\s\S]+?\},\s*\/\/[\s\S]+?\}\s*\)\}/);
    if (!m) return false;
    return m[0].indexOf('boxShadow') < 0;
  })(),
  'root cause of inline-style-overrides-keyframe must be eliminated from runtime style block'
);

// 2b — New activeClass variable computed: 'ktc-assistant-speaking' or 'ktc-assistant-active'
ok('2b: Tile computes activeClass from isActive + isSpeaking',
  /var activeClass = isActive[\s\S]{0,200}'ktc-assistant-speaking'[\s\S]{0,200}'ktc-assistant-active'/.test(assistantsBarSrc)
);

// 2c — activeClass is concatenated into the className string
ok('2c: className string includes activeClass when active',
  /\+ props\.ringColor \+ ' ' \+ activeClass/.test(assistantsBarSrc)
);

// 2d — --ktc-glow-color CSS variable still set per persona
ok('2d: --ktc-glow-color still set on active tile (so keyframes pick up the right color)',
  /'--ktc-glow-color': props\.glowColorVar/.test(assistantsBarSrc)
);

// 2e — Idle active animation defined in globals.css
ok('2e: globals.css defines @keyframes ktcAssistantActiveBreath',
  /@keyframes ktcAssistantActiveBreath/.test(globalsCssSrc)
);

// 2f — .ktc-assistant-active class wires the breath animation
ok('2f: .ktc-assistant-active applies the breath animation',
  /\.ktc-assistant-active \{[\s\S]{0,200}animation: ktcAssistantActiveBreath/.test(globalsCssSrc)
);

// 2g — Speaking animation still uses the box-shadow keyframe (preserved)
ok('2g: .ktc-assistant-speaking still drives the speaking pulse',
  /\.ktc-assistant-speaking \{[\s\S]{0,200}animation: ktcAssistantSpeakingPulse/.test(globalsCssSrc)
);

// 2h — Both keyframes use the shared --ktc-glow-color so colors stay per-persona
ok('2h: both keyframes consume --ktc-glow-color (per-persona color preserved)',
  /ktcAssistantActiveBreath[\s\S]{0,300}var\(--ktc-glow-color\)/.test(globalsCssSrc)
  && /ktcAssistantSpeakingPulse[\s\S]{0,300}var\(--ktc-glow-color\)/.test(globalsCssSrc)
);

// =====================================================================
// PROBLEM 3 — Random blinking on all three avatars
// =====================================================================

// 3a — transition-all REMOVED from Tile (was animating box-shadow alongside everything else)
ok('3a: transition-all is GONE from the Tile className',
  !/className=\{'group relative flex flex-col[\s\S]{0,300}transition-all duration-300/.test(assistantsBarSrc),
  'transition-all was the broad transition that flickered on every re-render'
);

// 3b — narrowed transition list explicitly excludes box-shadow
ok('3b: Tile uses transition-[transform,opacity] (no box-shadow in the list)',
  /transition-\[transform,opacity\] duration-300/.test(assistantsBarSrc),
  'only transform + opacity are React-transitioned; shadow is keyframe-only'
);

// 3c — animation keyframes only animate box-shadow, never transform/opacity
//      (so they don't fight the React-driven transitions for those props)
ok('3c: ktcAssistantActiveBreath keyframes only animate box-shadow',
  (function() {
    var m = globalsCssSrc.match(/@keyframes ktcAssistantActiveBreath \{[\s\S]+?\n\}/);
    if (!m) return false;
    var body = m[0];
    return body.indexOf('box-shadow') >= 0
      && body.indexOf('transform') < 0
      && body.indexOf('opacity') < 0
      && body.indexOf('background') < 0;
  })(),
  'no other property in the keyframe = no fight with React state-driven transitions'
);

// 3d — same for speaking
ok('3d: ktcAssistantSpeakingPulse keyframes only animate box-shadow',
  (function() {
    var m = globalsCssSrc.match(/@keyframes ktcAssistantSpeakingPulse \{[\s\S]+?\n\}/);
    if (!m) return false;
    var body = m[0];
    return body.indexOf('box-shadow') >= 0
      && body.indexOf('transform') < 0
      && body.indexOf('opacity') < 0
      && body.indexOf('background') < 0;
  })()
);

// 3e — comment block in AssistantsBar acknowledges the root cause and fix
ok('3e: Tile comment names QA-23 and explains the inline-style root cause',
  /QA-23[\s\S]{0,1200}inline.{1,5}boxShadow[\s\S]{0,800}keyframe/.test(assistantsBarSrc)
);

// =====================================================================
// Final
// =====================================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-B UI fix tests passed (Problems 1, 2, 3 — Max\'s May 9 photo evidence)');
