// ============================================================
// v55.82-S — Three asks per Max May 12 2026:
//   1. Closed tickets must visually grey out the ENTIRE card
//      (title strike-through, muted badges, mute pills, grayscale filter)
//   2. "Tap to stop Nadia" must use the ACTIVE assistant's name
//      (Nadia / Jenna / Sara) — not always "Nadia"
//   3. Personal Coach feedback area must have an Arabic toggle that
//      flips both the card chrome AND the actual AI feedback to Arabic
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var ticketsTab = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TicketsTab.jsx'), 'utf8');
var greeter = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AIGreeter.jsx'), 'utf8');
var myPerf = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MyPerformance.jsx'), 'utf8');
var coachApi = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'hr-report', 'coach', 'route.js'), 'utf8');

// =============================================================
// ASK 1 — Closed tickets fully greyed
// =============================================================

ok('1a: Closed ticket outer bg is bg-slate-200 (visible against dark theme)',
  /t\.status === 'Closed' \? 'bg-slate-200 ' : 'bg-white '/.test(ticketsTab));

ok('1b: Closed ticket card has grayscale filter applied (whole-card muting)',
  /filter: t\.status === 'Closed' \? 'grayscale\(0\.55\) opacity\(0\.92\)'/.test(ticketsTab),
  'spec — entire visual container should communicate "closed"');

ok('1c: Closed ticket title uses muted slate-600 + line-through',
  /t\.status === 'Closed' \? 'text-slate-600 line-through decoration-slate-400'/.test(ticketsTab),
  'title should also signal "done"');

ok('1d: Closed ticket status pill rendered in muted slate (not the colored sp.bg/sp.fg)',
  /t\.status === 'Closed'\s*\?\s*\{ background: '#cbd5e1', color: '#475569', border: '1px solid #94a3b8' \}/.test(ticketsTab));

ok('1e: Closed ticket suppresses overdue + due-today badges (no longer urgent)',
  /t\.status !== 'Closed' && daysOverdue > 0/.test(ticketsTab) &&
  /t\.status !== 'Closed' && isDueToday/.test(ticketsTab),
  'spec — reduced visual emphasis when closed');

ok('1f: Closed ticket assignee chips strip vendor color (rendered as plain slate)',
  /t\.status === 'Closed'\s*\?\s*\{ background: '#e2e8f0', color: '#64748b' \}/.test(ticketsTab));

ok('1g: Closed ticket priority dot muted to slate (not priColor)',
  /t\.status === 'Closed' \? '#94a3b8' : priColor/.test(ticketsTab));

ok('1h: Closed ticket description still rendered (preserves readability/access)',
  /t\.description && \([\s\S]{0,200}t\.status === 'Closed' \? 'text-slate-500' : 'text-slate-600'/.test(ticketsTab),
  'spec — preserve accessibility, do not hide closed tickets');

// =============================================================
// ASK 2 — Stop button uses active assistant's name
// =============================================================

ok('2a: Stop button label resolved via activeAgentKey',
  /stopAssistantName = activeAgentKey === 'jenna' \? 'Jenna'\s*:\s*activeAgentKey === 'sara' \? 'Sara'\s*:\s*'Nadia'/.test(greeter));

ok('2b: Arabic label also resolved per assistant (جينا / سارة / ناديا)',
  /activeAgentKey === 'jenna' \? 'جينا'\s*:\s*activeAgentKey === 'sara' \? 'سارة'\s*:\s*'ناديا'/.test(greeter));

ok('2c: Label template includes the resolved name',
  /'Tap to stop ' \+ stopAssistantName/.test(greeter));

ok('2d: REGRESSION GUARD — hardcoded "Tap to stop Nadia" no longer in source',
  // Old: <span>{useLang === 'ar' ? 'إيقاف المساعد' : 'Tap to stop Nadia'}</span>
  !/إيقاف المساعد' : 'Tap to stop Nadia'/.test(greeter),
  'hardcoded Nadia name must be gone — should be dynamic per persona');

// =============================================================
// ASK 3 — Coach Arabic toggle
// =============================================================

ok('3a: coachLang state declared (independent of global lang)',
  // v55.82-V derived the initial value from userProfile.preferred_language.
  // Either literal 'en' or the helper variable name is acceptable.
  /const \[coachLang, setCoachLang\] = useState\((?:'en'|initialCoachLang)\)/.test(myPerf));

ok('3b: requestCoach sends lang in POST body',
  /JSON\.stringify\(\{[\s\S]{0,400}lang: coachLang/.test(myPerf));

ok('3c: API route accepts body.lang and falls back to "en" for invalid values',
  /var lang = body\.lang === 'ar' \? 'ar' : 'en'/.test(coachApi));

ok('3d: API appends Arabic instruction to the system prompt when lang===ar',
  /if \(lang === 'ar'\) \{[\s\S]{0,500}Modern Standard Arabic/.test(coachApi));

ok('3e: UI has EN/AR toggle pills',
  />EN<\/button>/.test(myPerf) && />AR<\/button>/.test(myPerf));

ok('3f: Toggling language clears the cached message (forces a fresh fetch in the new language)',
  /setCoachLang\('ar'\);\s*setCoachMsg\(''\);\s*setCoachError\(''\);/.test(myPerf) &&
  /setCoachLang\('en'\);\s*setCoachMsg\(''\);\s*setCoachError\(''\);/.test(myPerf));

ok('3g: Card body uses dir=bodyDir to flip RTL when Arabic',
  /var bodyDir = isAr \? 'rtl' : 'ltr'/.test(myPerf) &&
  /dir=\{bodyDir\}/.test(myPerf),
  'Arabic text needs RTL rendering to read correctly');

ok('3h: All card chrome labels translated (tLabel.* lookup)',
  /tLabel\.title/.test(myPerf) && /tLabel\.refresh/.test(myPerf) &&
  /tLabel\.getFeedback/.test(myPerf) && /tLabel\.thinking/.test(myPerf) &&
  /tLabel\.yourFeedback/.test(myPerf) && /tLabel\.noFeedback/.test(myPerf) &&
  /tLabel\.cantRespond/.test(myPerf));

ok('3i: REGRESSION GUARD — hardcoded English "Personal Coach" / "Get Coach Feedback" gone from JSX',
  !/<div className="font-bold text-violet-900">Personal Coach<\/div>/.test(myPerf),
  'must read from tLabel.title for AR support');

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-S tests passed');
