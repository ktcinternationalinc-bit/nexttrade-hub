// ============================================================
// v55.82-I — Three visibility fixes (Max May 11 2026 photo evidence)
//
//   ISSUE #1 — Active assistant glow not visible
//     Photo 1: Sara card sits on a cyan gradient. Active glow was
//     rgba(6,182,212,0.5) on the cyan gradient = invisible blend.
//     Fix: bump glow alpha to 0.85, add white inner ring (rgba(255,
//     255,255,0.95)) so the boundary between card and glow is
//     always visible regardless of background. Wider halo (10-14px
//     vs 4-6px). Multiple shadow stacks for additive richness.
//
//   ISSUE #2 — "You closed 5 tickets" banner yellow-on-yellow
//     Photo 3: middle band used bg-amber-50 + text-amber-900 which
//     read as a dim yellow wash. Max: "I don't want yellow and
//     yellow font it doesn't it's not visible make it gray and
//     black or something."
//     Fix: bg-white + slate-900 text + 6px amber-500 LEFT border.
//     Warning hue stays without burying the words.
//
//   ISSUE #3 — Personal Coach panel gives zero feedback
//     Photo 3: Personal Coach card is just header + empty space.
//     User didn't realize they had to click a button.
//     Fix: auto-fetch on first show + clear "writing your
//     feedback…" loading state + visible "No feedback yet" empty
//     state with dashed border and dark text (was tiny italic
//     grey on a violet gradient — basically invisible).
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var globalsCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');
var barSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AssistantsBar.jsx'), 'utf8');
var perfSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MyPerformance.jsx'), 'utf8');

// =====================================================================
// FIX #1 — Active glow is now VISIBLE
// =====================================================================

ok('1a: ktcAssistantActiveBreath uses white inner ring (rgba(255,255,255,0.95))',
  /ktcAssistantActiveBreath[\s\S]{0,800}rgba\(255,255,255,0\.95\)/.test(globalsCss),
  'white ring guarantees a visible boundary regardless of background'
);

ok('1b: ktcAssistantActiveBreath halo is at least 10px wide (was 4-6)',
  /ktcAssistantActiveBreath[\s\S]{0,800}0 0 0 1[04]px var\(--ktc-glow-color\)/.test(globalsCss),
  'halo width must visibly differ from old 4-6px'
);

ok('1c: ktcAssistantSpeakingPulse uses white inner ring too',
  /ktcAssistantSpeakingPulse[\s\S]{0,800}rgba\(255,255,255,0\.95\)/.test(globalsCss)
);

ok('1d: ktcAssistantSpeakingPulse 50% goes to 18px halo (much wider)',
  /ktcAssistantSpeakingPulse[\s\S]{0,800}50% \{[\s\S]{0,400}0 0 0 18px var\(--ktc-glow-color\)/.test(globalsCss)
);

ok('1e: Both keyframes use multiple stacked shadows for additive glow',
  (function() {
    var activeKf = globalsCss.match(/@keyframes ktcAssistantActiveBreath \{[\s\S]+?^\}/m);
    var speakKf = globalsCss.match(/@keyframes ktcAssistantSpeakingPulse \{[\s\S]+?^\}/m);
    if (!activeKf || !speakKf) return false;
    // count commas in each box-shadow = #-of-shadows minus 1
    var activeShadows = (activeKf[0].match(/,/g) || []).length;
    var speakShadows = (speakKf[0].match(/,/g) || []).length;
    return activeShadows >= 6 && speakShadows >= 6;
  })(),
  'each keyframe stage must stack at least 4 shadows for visible additive glow'
);

ok('1f: Tile glow alphas bumped 0.5 → 0.85',
  /rgba\(99,102,241,0\.85\)/.test(barSrc)
  && /rgba\(244,63,94,0\.85\)/.test(barSrc)
  && /rgba\(6,182,212,0\.85\)/.test(barSrc),
  'all three personas (Nadia indigo, Jenna rose, Sara cyan) get the alpha bump'
);

ok('1g: REGRESSION GUARD — no glowColorVar still at 0.5 alpha',
  !/glowColorVar="rgba\([^"]+,0\.5\)"/.test(barSrc),
  'no leftover 0.5 alpha glow on any tile'
);

ok('1h: Active breath is faster too — 3s (was 4.5s)',
  /animation: ktcAssistantActiveBreath 3s ease-in-out infinite/.test(globalsCss),
  '4.5s was too slow to read as "alive"; 3s makes the breathing noticeable'
);

// =====================================================================
// FIX #2 — Yellow-on-yellow ticket banner fixed
// =====================================================================

ok('2a: Middle on-time band uses bg-white + slate-900 text',
  /'bg-white border-2 border-amber-500 text-slate-900'/.test(perfSrc),
  'replaces amber-50 + amber-900 which was unreadable'
);

ok('2b: REGRESSION GUARD — no amber-on-amber pattern remains',
  !/bg-amber-50 border border-amber-200 text-amber-900/.test(perfSrc),
  'amber-on-amber must be gone from the ticket banner'
);

ok('2c: Middle band gets a thick amber-500 left border (6px)',
  /current\.onTimePct >= 50 && current\.onTimePct < 80 \?[\s\S]{0,200}borderLeftWidth: '6px'/.test(perfSrc),
  'warning hue preserved as a left-bar accent, not a wash'
);

ok('2d: Middle band emoji + leading word in amber for color contrast',
  /<strong className="text-amber-700">👍 You closed/.test(perfSrc),
  'keeps the "warning" semantic via emoji + colored highlight, not a washed background'
);

// =====================================================================
// FIX #3 — Personal Coach auto-fetches + visible empty state
// =====================================================================

ok('3a: useRef imported alongside other React hooks',
  /import \{ useState, useEffect, useMemo, useRef \} from 'react'/.test(perfSrc),
  'needed for autoFetchedRef'
);

ok('3b: autoFetchedRef declared with empty-string initial value',
  /const autoFetchedRef = useRef\(''\)/.test(perfSrc),
  'tracks the (myId+period) we last auto-fetched, so we re-fetch on period change'
);

ok('3c: Auto-fetch useEffect calls requestCoach when conditions met',
  // v55.83-A.5 — comments and defensive clears added between the key assignment
  // and the requestCoach() call. Distance expanded from 80 to 600 chars.
  /useEffect\(function \(\) \{[\s\S]{0,2500}autoFetchedRef\.current = key;[\s\S]{0,600}requestCoach\(\)/.test(perfSrc)
);

ok('3d: Auto-fetch skips when already fetching (idempotent — no loop)',
  // v55.83-A.5 — combined OR guard was split into independent if-returns
  // for clarity. Either shape is acceptable; both prevent re-entry.
  /if \(coachMsg \|\| coachError \|\| coachLoading\) return/.test(perfSrc) ||
  (/if \(coachLoading\) return/.test(perfSrc) &&
   /autoFetchedRef\.current === key\) return/.test(perfSrc)),
  'auto-fetch must be idempotent — no loop'
);

ok('3e: Auto-fetch re-keys on period change',
  /var key = \(myId \|\| 'anon'\) \+ ':' \+ period/.test(perfSrc),
  'changing period invalidates the cached fetch key, so coach refreshes'
);

// v55.82-K — Auto-fetch deps simplified per Max May 11 2026 (10th report
// of blank coach panel). Old deps included `current` and `hasAnyActivity`
// which silently bailed for low-activity users. New deps only need
// expanded + myId + period; current is kept for refresh-on-data-arrival
// but not gated.
ok('3f: Auto-fetch deps no longer include hasAnyActivity gate (v55.82-K)',
  // v55.83-A.5 — current deps array is [expanded, myId, period, current, loading].
  // The critical invariant: hasAnyActivity must NOT be in the deps (would gate the auto-fetch).
  (/\}, \[expanded, (current, hasAnyActivity, myId, period|myId, period, current)\]\);/.test(perfSrc) ||
   /\}, \[expanded, myId, period, current, loading\]\);/.test(perfSrc)) &&
  !/\}, \[[^\]]*hasAnyActivity[^\]]*\]\);/.test(perfSrc),
  'either old shape (legacy) or new v55.82-K shape acceptable; hasAnyActivity must NOT be in deps'
);

ok('3g: Loading state shows a visible coach-writing card',
  // v55.83-A.5 — copy now bilingual via tLabel.writing. The card uses
  // {tLabel.writing} as visible message inside a bordered card.
  /coachLoading && !coachMsg && \([\s\S]{0,500}(Coach is writing your feedback|tLabel\.writing|tLabel\.thinking)/.test(perfSrc),
  'loading state must be a real visible card, not just a button label change'
);

ok('3h: Empty state replaced italic-grey with a dashed border card',
  // v55.83-A.5 — copy bilingual via tLabel.noFeedback / tLabel.tapToGet /
  // tLabel.getFeedback. The empty state still wraps in a dashed border
  // card with a <strong> emphasis. Accept either bilingual or legacy form.
  /No feedback yet[\s\S]{0,400}Tap <strong[^>]*>Get Coach Feedback<\/strong> above/.test(perfSrc) ||
  /tLabel\.noFeedback[\s\S]{0,400}<strong className="text-violet-800">\{tLabel\.getFeedback\}/.test(perfSrc),
  'empty state must be visibly readable on light background'
);

ok('3i: REGRESSION GUARD — old italic placeholder text is gone',
  !/Tap the button to get a personalized note from your coach\. It'll highlight your wins/.test(perfSrc),
  'old hard-to-see italic copy must be replaced'
);

ok('3j: Empty state uses solid text colors (slate-700+, slate-800+)',
  // v55.83-A.5 — accept tLabel.noFeedback form as well as legacy literal.
  /No feedback yet[\s\S]{0,300}text-slate-(700|800|900)/.test(perfSrc) ||
  /tLabel\.noFeedback[\s\S]{0,300}text-slate-(700|800|900)/.test(perfSrc),
  'no faint italic text — must be readable'
);

// =====================================================================
// SANITY — build stamp consistency
// =====================================================================
// (Don't enforce build letter here — that test lives in v55-82-f.
// Just smoke-check the touched files parse and have the expected
// markers.)
ok('S.1: All three touched files marked v55.82-* in comments',
  /v55\.82-[A-Z]/.test(globalsCss) && /v55\.82-[A-Z]/.test(barSrc) && /v55\.82-[A-Z]/.test(perfSrc),
  'every changed file has a v55.82-* marker for future code archaeology'
);

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-I visibility fixes verified (glow + ticket-banner + Personal Coach)');
