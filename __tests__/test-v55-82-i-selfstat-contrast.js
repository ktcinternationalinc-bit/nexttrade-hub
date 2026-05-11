// ============================================================
// v55.82-I — Dashboard SelfStat contrast fix
//
// Max May 11 2026 (photo evidence): three SelfStat cards on the
// performance/dashboard view (Customer Touches, Show-Up Rate,
// Daily Log Streak) were rendering pale pastel pink/teal pills
// on the dark dashboard, with rose-700/teal-700 numbers that
// were invisible against the rose-50/teal-50 background. The
// supporting label/hint text used slate-500/600 classes which
// the dark-theme globals.css overrides muted further.
//
// Also: those three cards visually broke from the rest of the
// dashboard which uses consistent dark-glass cards.
//
// Fix: SelfStat now uses ONE consistent dark-glass card surface
// (rgba(255,255,255,0.04) background, white-alpha border, accent
// color on the LEFT BORDER and on the big number text). Tones
// (rose, teal, amber, etc.) now only drive the accent color, not
// the entire pill. Every SelfStat on every tone is high contrast.
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var perfSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MyPerformance.jsx'), 'utf8');

// =====================================================================
// FIX #1 — SelfStat no longer uses pastel light backgrounds
// =====================================================================

// 1a — bg-rose-50 / bg-teal-50 / bg-amber-50 etc not in SelfStat anymore
ok('1a: SelfStat function body no longer uses pastel `bg-*-50` backgrounds',
  (function() {
    var ssStart = perfSrc.indexOf('function SelfStat(');
    if (ssStart < 0) return false;
    // SelfStat is followed by another function declaration. Slice up to it.
    var ssEnd = perfSrc.indexOf('\nfunction ', ssStart + 20);
    if (ssEnd < 0) ssEnd = ssStart + 3000;
    var body = perfSrc.slice(ssStart, ssEnd);
    // Strip line/block comments first so the historical reference in the
    // v55.82-I migration comment ("bg-rose-50, bg-teal-50, etc.") doesn't
    // trigger a false positive.
    body = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return !/bg-(rose|teal|amber|emerald|blue|purple|cyan|indigo|green)-50/.test(body);
  })(),
  'pastel light backgrounds in SelfStat broke contrast on the dark dashboard'
);

// 1b — SelfStat no longer uses text-*-700 classes for the value (was rose-700 etc on rose-50 = invisible)
ok('1b: SelfStat value no longer uses text-*-700 classes (was unreadable on pastel bg)',
  (function() {
    var ssStart = perfSrc.indexOf('function SelfStat(');
    var ssEnd = perfSrc.indexOf('\nfunction ', ssStart + 20);
    var body = perfSrc.slice(ssStart, ssEnd);
    // valueClass map gone or rewritten
    return !/valueClass = \{[\s\S]{0,500}text-rose-700/.test(body);
  })()
);

// =====================================================================
// FIX #2 — Dark-glass card treatment instead
// =====================================================================

ok('2a: SelfStat uses dark-glass background (rgba white-alpha)',
  /background: 'rgba\(255,255,255,0\.04\)'/.test(perfSrc),
  'matches the rest of the dashboard\'s dark-glass cards'
);

ok('2b: SelfStat uses accent-colored LEFT BORDER as the tone indicator',
  /borderLeft: '3px solid ' \+ accentColor/.test(perfSrc),
  'tone drives the accent only — not the entire pill — for visual rhythm'
);

ok('2c: accent-color map has all 9 tones',
  (function() {
    var ssStart = perfSrc.indexOf('function SelfStat(');
    var ssEnd = perfSrc.indexOf('\nfunction ', ssStart + 20);
    var body = perfSrc.slice(ssStart, ssEnd);
    return /accentColor = \{[\s\S]{0,800}green:[\s\S]{0,300}blue:[\s\S]{0,300}purple:[\s\S]{0,300}cyan:[\s\S]{0,300}emerald:[\s\S]{0,300}amber:[\s\S]{0,300}rose:[\s\S]{0,300}indigo:[\s\S]{0,300}teal:/.test(body);
  })()
);

// =====================================================================
// FIX #3 — Label and hint colors readable on dark
// =====================================================================

ok('3a: Big number uses accent color (high-contrast bright color)',
  /<div className="text-2xl font-extrabold" style=\{\{ color: accentColor \}\}>/.test(perfSrc),
  'value pops in the accent color — no more text-rose-700-on-rose-50'
);

ok('3b: Label uses light-slate rgba (readable on dark)',
  /color: 'rgba\(203,213,225,0\.85\)'/.test(perfSrc),
  'label is readable but de-emphasized vs the value'
);

ok('3c: Suffix and hint use light-slate rgba',
  /color: 'rgba\(148,163,184,/.test(perfSrc),
  'support text is readable but de-emphasized'
);

ok('3d: Delta-down uses slate-400 (readable on dark, was slate-500)',
  /deltaCls = 'text-slate-400'/.test(perfSrc)
);

ok('3e: Delta-up uses emerald-400 (bright on dark, was emerald-600)',
  /deltaCls = 'text-emerald-400'/.test(perfSrc)
);

// =====================================================================
// FIX #4 — Behavioural — three problem cards from Max's photo still mount
// =====================================================================

ok('4a: Customer Touches SelfStat still rendered (tone=rose)',
  /<SelfStat label="Customer Touches"[^>]+tone="rose"/.test(perfSrc)
);

ok('4b: Show-Up Rate SelfStat still rendered',
  /<SelfStat label="Show-Up Rate"/.test(perfSrc)
);

ok('4c: Daily Log Streak SelfStat still rendered (tone=teal)',
  /<SelfStat label="Daily Log Streak"[^>]+tone="teal"/.test(perfSrc)
);

// =====================================================================
// Final
// =====================================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-I SelfStat contrast fix tests passed');
