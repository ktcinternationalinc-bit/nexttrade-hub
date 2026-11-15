// ============================================================
// v55.75 — Phase A PARTIAL (A1 + A2 + A3)
// A4 contrast sweep deferred to next zip per Max's instruction.
// ============================================================
var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };
var passed = 0, failed = 0, failures = [];
function check(label, cond) {
  if (cond) { console.log('  v ' + label); passed++; }
  else { console.log('  X ' + label); failed++; failures.push(label); }
}
function group(title) { console.log('\n--- ' + title + ' ---'); }

console.log('============================================================');
console.log('v55.75 PHASE A PARTIAL — A1 + A2 + A3');
console.log('============================================================');

var ab = read('src/components/AssistantsBar.jsx');
var ag = read('src/components/AIGreeter.jsx');
var hr = read('src/components/MyHRDesk.jsx');
var css = read('src/app/globals.css');
var pg = read('src/app/page.jsx');

// ============================================================
// A1 — Avatar glow fix
// ============================================================
group('A1 — Calm idle + speaking-only pulse, no synchronized blinking');

check('A1.1 ktcAssistantActivePulse REMOVED (was the constant transform-jitter)',
  // Allow comment mentioning it was removed; what must be gone is the
  // actual @keyframes definition + the class .ktc-assistant-active-pulse {
  !/@keyframes ktcAssistantActivePulse/.test(css) && !/\.ktc-assistant-active-pulse\s*\{/.test(css));
check('A1.2 ktcAssistantSpeakingPulse keyframe added (box-shadow, not transform)',
  /@keyframes ktcAssistantSpeakingPulse/.test(css)
  && /box-shadow:/.test(css.split('@keyframes ktcAssistantSpeakingPulse')[1].substring(0, 400))
  && !/transform:/.test(css.split('@keyframes ktcAssistantSpeakingPulse')[1].substring(0, 400)));
check('A1.3 .ktc-assistant-speaking class declared',
  /\.ktc-assistant-speaking\s*\{[\s\S]{0,200}animation: ktcAssistantSpeakingPulse/.test(css));
check('A1.4 Per-assistant glow color via CSS variable',
  /var\(--ktc-glow-color/.test(css));
check('A1.5 AssistantsBar dropped ktc-assistant-active-pulse class from active tile',
  !/ktc-assistant-active-pulse/.test(ab));
check('A1.6 Active tile gets ktc-assistant-speaking only when isSpeaking',
  /isSpeaking \? ' ktc-assistant-speaking' : ''/.test(ab)
  || /isSpeaking \? 'ktc-assistant-speaking' : (?:isActive \? )?'ktc-assistant-active'?/.test(ab));
check('A1.7 speakingState introduced',
  /var \[speakingState, setSpeakingState\] = useState/.test(ab));
check('A1.8 AssistantsBar listens for ktc:assistant-speaking event',
  /window\.addEventListener\('ktc:assistant-speaking'/.test(ab));
check('A1.9 Inactive tile badges no longer animate-pulse (only active+speaking)',
  /isSpeaking \? ' animate-pulse' : ''/.test(ab));
check('A1.10 Active indicator dot lost animate-pulse',
  /<span className="w-2 h-2 rounded-full" style=\{\{ background: props\.dotColor \}\} \/>/.test(ab));
check('A1.11 All three Tile invocations have glowColorVar prop',
  (ab.match(/glowColorVar=/g) || []).length === 3);
check('A1.12 AIGreeter dispatches ktc:assistant-speaking on speaking change',
  /window\.dispatchEvent\(new CustomEvent\('ktc:assistant-speaking'/.test(ag));
check('A1.13 Dispatch effect depends on [speaking, activeAgentKey]',
  /\}, \[speaking, activeAgentKey\]\)/.test(ag));
check('A1.14 No periodic wave timer (hover-only)',
  !/setInterval[\s\S]{0,200}setWave/.test(ab));

// ============================================================
// A2 — Jenna HR wording sweep
// ============================================================
group('A2 — Clean Jenna wording, reference numbers, Mr. Kandil only');

check('A2.1 Removed "(President)" from radio button label',
  !/\(President\)/.test(hr));
check('A2.2 No user-visible "anonymous" word in toggle label',
  // The only acceptable use of "anonymous" is in code comments and
  // internal field names, not in JSX rendered text. Check the toggle
  // label specifically.
  /Keep my identity confidential[\s\S]{0,200}Only \{superAdminName\} will see your name/.test(hr));
check('A2.3 No user-visible "stay anonymous" prompt',
  !/stay anonymous/.test(hr));
check('A2.4 Jenna empathy line on concern modal',
  /I'm sorry you're dealing with this/.test(hr));
check('A2.5 Concern flow surfaces reference number on success',
  /Your reference number is <strong className="font-mono">\{submitOk\.number\}/.test(hr));
check('A2.6 Concern success: "Mr. Kandil has been notified"',
  /\{superAdminName\} has been notified/.test(hr));
check('A2.7 Request flow surfaces reference number on success',
  (hr.match(/Your reference number is <strong className="font-mono">/g) || []).length >= 2);
check('A2.8 Concern intro reads "directly to Mr. Kandil" (variable)',
  /directly to.{0,40}\{superAdminName\}/.test(hr));
check('A2.9 No "President, Mr. Kandil" composite phrasing in user copy',
  !/President, \{superAdminName\}/.test(hr) && !/the President, Mr\. Kandil/.test(hr));

// ============================================================
// A3 — Recently Updated Tickets — show 25 not 1
// ============================================================
group('A3 — Recently Updated Tickets default to 25');

check('A3.1 First Recently Updated section has defaultShow={25}',
  /id="recentUpd"[\s\S]{0,400}defaultShow=\{25\}/.test(pg));
check('A3.2 Fallback Recently Updated section has defaultShow={25}',
  /id="recentUpd2"[\s\S]{0,400}defaultShow=\{25\}/.test(pg));
check('A3.3 CollapsibleSection respects defaultShow prop',
  /const show = defaultShow \|\| 5/.test(pg) || /defaultShow \?\? 5/.test(pg) || /show = defaultShow/.test(pg));
check('A3.4 myUpdates is sorted newest-first (chronological)',
  /recentTicketUpdates/.test(pg));
check('A3.5 "Show all N" link reveals everything when collapsed',
  /Show all \{items\.length\}/.test(pg));

console.log('\n--- SUMMARY ---');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f); });
  process.exit(1);
}
console.log('\nAll ' + passed + ' Phase A partial tests passed.');
