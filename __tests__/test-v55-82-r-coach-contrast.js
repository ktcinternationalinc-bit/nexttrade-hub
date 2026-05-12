// ============================================================
// v55.82-R — Long-form AI feedback contrast per Max May 12 2026
// "The text/font appears almost invisible... font color too light
//  against the background... Users should NEVER struggle to read
//  system feedback because of weak color contrast."
//
// Root cause pattern (avoid):
//   <div className="bg-gradient-to-r from-X-50 to-Y-50">
//     <div className="text-slate-800">{longParagraph}</div>
//   </div>
//   On a dark-theme page, the gradient cards render as cream/pale
//   and slate-800 reads as faint mid-grey on cream → unreadable.
//
// Required pattern (use):
//   <div className="bg-gradient-to-r from-X-50 to-Y-50">
//     <div className="bg-white rounded-lg p-4">
//       <div className="text-slate-900 font-medium">{longParagraph}</div>
//     </div>
//   </div>
//   Solid white card surrounds the long-form text → text-slate-900
//   has guaranteed contrast.
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var myPerf = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MyPerformance.jsx'), 'utf8');

// 1) Personal Coach feedback text is NOT direct-on-gradient
ok('1: Personal Coach feedback text wrapped in solid white card',
  /coachMsg && \(\s*<div className="mt-2 p-4 rounded-lg bg-white border border-violet-200/.test(myPerf),
  'spec — feedback text needs a solid white surface, not the gradient parent'
);

// 2) Personal Coach feedback text uses near-black (slate-900) + font-medium
ok('2: Personal Coach feedback body uses text-slate-900 + font-medium',
  /text-sm text-slate-900 font-medium leading-relaxed whitespace-pre-wrap/.test(myPerf),
  'avoid text-slate-800 (too light against pale cards on dark theme)'
);

// 3) REGRESSION GUARD: the old text-slate-800-direct-on-gradient pattern is GONE
ok('3: REGRESSION GUARD — coachMsg no longer rendered directly on gradient',
  !/coachMsg && \(\s*<div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap mt-2"/.test(myPerf),
  'old weak-contrast direct-on-gradient pattern must not return'
);

// 4) Error card contrast bumped (rose-900 + rose-100 surface vs rose-50)
ok('4: Coach error card uses rose-950 on rose-100 (not rose-900 on rose-50)',
  /bg-rose-100 border-2 border-rose-400 text-sm text-rose-950/.test(myPerf)
);

// 5) Empty-state "Get Coach Feedback" prompt uses readable contrast
ok('5: "No feedback yet" prompt uses font-medium + slate-800',
  /No feedback yet[\s\S]{0,300}text-slate-800 font-medium/.test(myPerf)
);

// 6) "Get Coach Feedback" button bumped from violet-600 to violet-700 for better contrast
ok('6: Coach button uses violet-700 bg (not violet-600) for better white-text contrast',
  /bg-violet-700 text-white font-semibold hover:bg-violet-800/.test(myPerf)
);

// 7) Personal Coach heading uses violet-900 (not violet-800)
ok('7: Personal Coach heading uses text-violet-900',
  /font-bold text-violet-900">Personal Coach<\/div>/.test(myPerf)
);

// 8) Wins panel bumped from emerald-50 to emerald-100
ok('8: Wins panel uses emerald-100 + text-emerald-900 (not -50 + -700)',
  /bg-emerald-100 rounded-lg p-3 mb-4 border border-emerald-300/.test(myPerf) &&
  /text-xs font-extrabold text-emerald-900 mb-1/.test(myPerf) &&
  /text-xs text-emerald-900 font-medium space-y-0\.5/.test(myPerf)
);

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-R contrast tests passed');
