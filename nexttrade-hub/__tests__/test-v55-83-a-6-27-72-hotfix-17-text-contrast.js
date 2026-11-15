/* v72 HOTFIX 17 — Max May 27 2026: light fonts blending with the panel
 * gradient backgrounds where the persona's saturated header bleeds in.
 * Fix: wrap greeting blocks in solid white card backdrops + stronger
 * heading colors + darker StatCard labels (true black #0f172a).
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var ab = fs.readFileSync(path.join(__dirname, '..', 'src/components/AssistantsBar.jsx'), 'utf8');
var hr = fs.readFileSync(path.join(__dirname, '..', 'src/components/MyHRDesk.jsx'), 'utf8');

console.log('\n── Nadia greeting card: white backdrop guarantees contrast ──');

ok('A1: Nadia panel wraps greeting in white card with indigo border + shadow',
  /openPanel === 'nadia'[\s\S]{0,400}bg-white rounded-xl border border-indigo-200 shadow-sm/.test(ab));

ok('A2: "Hi, I\'m Nadia" heading uses text-slate-900 (was text-indigo-900)',
  /text-base font-extrabold text-slate-900">Hi, I'm \{AGENT_PERSONALITIES\.nadia\.name\}/.test(ab));

ok('A3: Nadia role badge uses solid bg-indigo-600 + text-white (was light pastel)',
  /bg-indigo-600 text-white px-2 py-0\.5 rounded uppercase tracking-wide/.test(ab));

ok('A4: Nadia auto-opens badge uses solid bg-emerald-600 + text-white',
  /bg-emerald-600 text-white px-2 py-0\.5 rounded uppercase tracking-wide/.test(ab));

ok('A5: Greeting paragraph uses text-slate-700 (was text-indigo-800)',
  /openPanel === 'nadia'[\s\S]{0,4000}text-xs text-slate-700 mt-1 leading-snug/.test(ab));

console.log('\n── Jenna + Sara greeting cards ──');

ok('B1: Jenna greeting wrapped in white card with rose border',
  /openPanel === 'jenna'[\s\S]{0,200}bg-white rounded-xl border border-rose-200 shadow-sm/.test(ab));

ok('B2: Jenna heading uses text-slate-900 + role badge bg-rose-600 + text-white',
  /text-base font-extrabold text-slate-900">Hi, I'm \{AGENT_PERSONALITIES\.jenna\.name\}[\s\S]{0,200}bg-rose-600 text-white/.test(ab));

ok('B3: Sara greeting wrapped in white card with cyan border',
  /openPanel === 'sara'[\s\S]{0,200}bg-white rounded-xl border border-cyan-200 shadow-sm/.test(ab));

ok('B4: Sara heading uses text-slate-900 + role badge bg-cyan-600 + text-white',
  /text-base font-extrabold text-slate-900">Hey, I'm \{AGENT_PERSONALITIES\.sara\.name\}[\s\S]{0,200}bg-cyan-600 text-white/.test(ab));

console.log('\n── StatCard contrast bump ──');

ok('C1: StatCard label uses inline true-black color (#0f172a)',
  /color: '#0f172a'/.test(ab));

ok('C2: StatCard bg deepened from -100 to -200 for stronger contrast',
  /amber: 'bg-amber-200 border-amber-500'/.test(ab));

ok('C3: StatCard border deepened from -400 to -500',
  /border-amber-500[\s\S]{0,50}sky: 'bg-sky-200 border-sky-500'/.test(ab) ||
  /border-amber-500/.test(ab) && /border-sky-500/.test(ab) && /border-rose-500/.test(ab) && /border-violet-500/.test(ab));

console.log('\n── MyHRDesk header card ──');

ok('D1: MyHRDesk header block wrapped in white card with rose border',
  /bg-white rounded-lg border border-rose-200 shadow-sm[\s\S]{0,500}My HR Desk/.test(hr));

ok('D2: "DIRECT LINE TO" badge now solid violet-600 + white text (was bg-violet-100 + text-violet-700)',
  /bg-violet-600 text-white text-\[10px\] font-extrabold rounded uppercase[\s\S]{0,100}Direct line to/.test(hr));

ok('D3: New-update badge now solid emerald-600 + white text',
  /bg-emerald-600 text-white text-\[10px\] font-extrabold rounded uppercase/.test(hr));

ok('D4: Subtitle "File requests, raise concerns" darkened from slate-500 to slate-700',
  /text-xs text-slate-700 font-semibold[\s\S]{0,200}File requests, raise concerns/.test(hr));

ok('D5: Status counters use text-amber-900 + text-rose-900 (was text-amber-900 + text-rose-800)',
  /text-amber-900 font-extrabold[\s\S]{0,300}text-rose-900 font-extrabold/.test(hr));

console.log('\n── Recent submissions: darker labels ──');

ok('E1: "Your recent submissions" section label uses text-slate-800 font-extrabold (was text-slate-500 font-bold)',
  /text-\[11px\] font-extrabold text-slate-800 uppercase[\s\S]{0,100}Your recent submissions/.test(hr));

ok('E2: Submission row title uses text-slate-900 font-extrabold (was text-slate-800 font-bold)',
  /text-xs font-extrabold text-slate-900 truncate/.test(hr));

ok('E3: Row number darkened from slate-500 to slate-700 + bold',
  /text-\[10px\] font-mono font-bold text-slate-700/.test(hr));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 17 — light fonts replaced with high-contrast dark text on white backdrops');
console.log('══════════════════════════════════════════════');
