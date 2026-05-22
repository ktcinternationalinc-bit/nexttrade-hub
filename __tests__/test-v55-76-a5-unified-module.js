// ============================================================
// v55.76 (A5) — Unified AI Workforce Module regression guard
//
// Pins the architectural restructure so it doesn't regress to
// three separate panel cards. Per Max's spec: ONE BRAIN, THREE
// PERSONAS, ONE UNIFIED MODULE. All persona tools + chat surface
// live inside one shared shell that swaps content/colors.
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
console.log('v55.76 (A5) — UNIFIED AI WORKFORCE MODULE');
console.log('============================================================');

var ab = read('src/components/AssistantsBar.jsx');
var pg = read('src/app/page.jsx');

// ============================================================
// 1. Single unified shell wrapping all three persona views
// ============================================================
group('1. ONE shell wraps everything (no separate panel cards)');

check('1.1 Module has id="ai-workforce-module"',
  /id="ai-workforce-module"/.test(ab));
check('1.2 Shell border + bg color SHIFTS based on openPanel (not three separate cards)',
  // Single ternary chain inside one className expression
  /openPanel === 'nadia' \? 'border-indigo[\s\S]{0,400}openPanel === 'jenna' \? 'border-rose[\s\S]{0,400}openPanel === 'sara'/.test(ab));
check('1.3 Shell uses transition-all for smooth color swap (no hard cuts)',
  /transition-all duration-500/.test(ab));
check('1.4 Persona content sits INSIDE the shell, not as sibling cards',
  // Position check: id="ai-workforce-module" appears BEFORE the first
  // {openPanel === 'nadia' && ( in the file (= it's the parent shell).
  ab.indexOf('id="ai-workforce-module"') > 0
  && ab.indexOf("openPanel === 'nadia' && (") > ab.indexOf('id="ai-workforce-module"')
  && (ab.indexOf("openPanel === 'nadia' && (") - ab.indexOf('id="ai-workforce-module"')) < 1500);

// ============================================================
// 2. Three persona content views inside the unified shell
// ============================================================
group('2. Three persona views with proper component renders');

check('2.1 Nadia view renders inside shell (greeting + stats)',
  /openPanel === 'nadia' && \([\s\S]{0,2500}<StatCard label="Need Ack"/.test(ab));
check('2.2 [v55.77] Jenna greeting renders conditionally; MyHRDesk wrapper always-mounted (Fix #4 — preserves form state)',
  /openPanel === 'jenna' && \(/.test(ab)
  && /style=\{\{ display: openPanel === 'jenna' \? 'block' : 'none' \}\}[\s\S]{0,200}<MyHRDesk/.test(ab));
check('2.3 [v55.77] Sara greeting renders conditionally; MyPerformance wrapper always-mounted (Fix #4 — preserves loaded data)',
  /openPanel === 'sara' && \(/.test(ab)
  && /style=\{\{ display: openPanel === 'sara' \? 'block' : 'none' \}\}[\s\S]{0,200}<MyPerformance/.test(ab));

// ============================================================
// 3. Chat surface lives INSIDE the same shell (not after as sibling)
// ============================================================
group('3. Chat surface is the persistent body of the unified module');

check('3.1 chatSurface renders inside ai-workforce-module, not as outer sibling',
  /id="ai-workforce-module"[\s\S]+chatSurface \?/.test(ab)
  && !/<\/div>\s*\{chatSurface \?[\s\S]{0,200}<\/div>\s*<\/div>\s*\);\s*\}\s*$/.test(ab));
check('3.2 Chat surface is inside id="ktc-assistant-chat-surface" sub-region',
  /id="ktc-assistant-chat-surface"/.test(ab));
check('3.3 Chat surface border color matches active persona (continuity)',
  /openPanel === 'nadia' \? 'border-indigo-100[\s\S]{0,300}openPanel === 'jenna' \? 'border-rose-100[\s\S]{0,300}openPanel === 'sara'/.test(ab));

// ============================================================
// 4. NO three-separate-card structure remaining
// ============================================================
group('4. The old three-separate-card pattern is GONE');

check('4.1 No top-level "openPanel === nadia" sibling card outside shell',
  // Old pattern was: {openPanel === 'nadia' && (<div className="mt-3 rounded-2xl border-2 border-indigo-200 bg-gradient-to-br...">)
  // Each persona had its OWN card. Now they're all inside one shell.
  // Count occurrences of the old card-shell signature outside the unified shell:
  !/\{openPanel === 'nadia' && \(\s*<div className="mt-3 rounded-2xl border-2 border-indigo-200/.test(ab));
check('4.2 No standalone Jenna sibling card with rounded-2xl border-rose-200',
  !/\{openPanel === 'jenna' && \(\s*<div className="mt-3 rounded-2xl border-2 border-rose-200/.test(ab));
check('4.3 No standalone Sara sibling card with rounded-2xl border-cyan-200',
  !/\{openPanel === 'sara' && \(\s*<div className="mt-3 rounded-2xl border-2 border-cyan-200/.test(ab));

// ============================================================
// 5. AIGreeter mount + unified-module wiring
// ============================================================
group('5. page.jsx wires the unified module correctly');

check('5.1 AIGreeter receives selectedAssistant prop',
  /selectedAssistant=\{selectedAssistant\}/.test(pg));
check('5.2 Dismissed-state button is persona-aware (not hard-coded "Nadia")',
  /Talk to \{activePersonaName\}/.test(pg));
check('5.3 activePersonaName resolves from selectedAssistant',
  /selectedAssistant === 'jenna' \? 'Ms\. Jenna'[\s\S]{0,100}selectedAssistant === 'sara'  \? 'Sara'/.test(pg));
check('5.4 Dismissed-state button color matches active persona',
  /selectedAssistant === 'jenna' \? 'text-rose-700[\s\S]{0,200}selectedAssistant === 'sara'  \? 'text-cyan-700/.test(pg));
check('5.5 chatSurface is still passed into PersonalDashboard',
  /chatSurface=\{nadiaChatSurface\}/.test(pg));

// ============================================================
// 6. Persona-switching event bus still alive (from v55.73)
// ============================================================
group('6. Switching mechanism unchanged');

check('6.1 togglePanel still dispatches ktc:assistant-changed',
  /window\.dispatchEvent\(new CustomEvent\('ktc:assistant-changed'/.test(ab));
check('6.2 page.jsx still listens for ktc:assistant-changed',
  /window\.addEventListener\('ktc:assistant-changed'/.test(pg));
check('6.3 page.jsx maps event detail to setSelectedAssistant',
  /setSelectedAssistant\(who\)/.test(pg));

// ============================================================
// 7. AI engine not duplicated — chatSurface is a SLOT
// ============================================================
group('7. ONE BRAIN — chatSurface is a slot, AIGreeter mounted ONCE');

check('7.1 AIGreeter is mounted exactly ONCE in page.jsx',
  (pg.match(/<AIGreeter\b/g) || []).length === 1);
check('7.2 AssistantsBar declares chatSurface as a prop slot',
  /chatSurface,/.test(ab) && /chatSurface \?/.test(ab));
check('7.3 No duplicate AIGreeter import inside AssistantsBar (would mean engine duplication)',
  !/import AIGreeter/.test(ab));

// ============================================================
// 8. Visual spec — only active glows, no synced blink (carry-forward from A1)
// ============================================================
group('8. A1 glow carry-forward intact');

check('8.1 ktc-assistant-speaking class still wired',
  /isSpeaking \? ' ktc-assistant-speaking' : ''/.test(ab)
  || /isSpeaking \? 'ktc-assistant-speaking' : (?:isActive \? )?'ktc-assistant-active'?/.test(ab));
check('8.2 Per-tile speaking state still active',
  /var \[speakingState, setSpeakingState\]/.test(ab));
check('8.3 hover state per-tile, no shared timer',
  !/setInterval[\s\S]{0,200}setWave/.test(ab));

console.log('\n--- SUMMARY ---');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f); });
  process.exit(1);
}
console.log('\nAll ' + passed + ' A5 unified-module tests passed.');
