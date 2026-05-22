// ============================================================
// v55.78 — Wake-word per-persona routing
//
// "Hey Jenna" routes to Jenna. "Hey Sara" routes to Sara.
// "Hey Nadia" stays Nadia. The agent routing flows through the
// detector → engine → AIGreeter handler → ktc:assistant-changed dispatch.
// We also verify the race fix: doSendRef is deferred 80ms when persona
// switches via wake-word so the API call uses the new persona's brain.
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
console.log('v55.78 — Wake-word per-persona routing');
console.log('============================================================');

// Load wake-word lib via shim (same trick test-full uses)
var wSrc = read('src/lib/voice/wake-word.js');
var shim = wSrc.replace(/export\s+function\s+/g, 'function ')
  + '\nmodule.exports = { detectWakeWord, createWakeEngine, isBargeInCandidate };';
fs.writeFileSync('/tmp/_wake78.js', shim);
delete require.cache['/tmp/_wake78.js'];
var W = require('/tmp/_wake78.js');

// ============================================================
// Detector — per-persona variants
// ============================================================
group('Detector recognizes all three personas');

check('1.1 "hey nadia ..." → agent=nadia',
  W.detectWakeWord('hey nadia show my tickets').agent === 'nadia');
check('1.2 "hey jenna ..." → agent=jenna',
  W.detectWakeWord('hey jenna i need to file vacation').agent === 'jenna');
check('1.3 "hey sara ..." → agent=sara',
  W.detectWakeWord('hey sara how am i doing').agent === 'sara');
check('1.4 "ok jenna ..." accepted (alternate wake filler)',
  W.detectWakeWord('ok jenna help me').agent === 'jenna');
check('1.5 "hi sarah ..." → sara (recognizer variant)',
  W.detectWakeWord('hi sarah what is my score').agent === 'sara');
check('1.6 Bare "jenna ..." (no filler) → jenna',
  W.detectWakeWord('jenna i have a concern').agent === 'jenna');
check('1.7 Non-wake transcript returns agent=null',
  W.detectWakeWord('how are you doing today').agent === null);

group('Variant mishearings → correct agent');
check('2.1 "nadya" → nadia',
  W.detectWakeWord('hey nadya show me').agent === 'nadia');
check('2.2 "gina" → jenna',
  W.detectWakeWord('hey gina file a request').agent === 'jenna');
check('2.3 "sarah" → sara',
  W.detectWakeWord('sarah review my work').agent === 'sara');
check('2.4 "jenny" → jenna',
  W.detectWakeWord('jenny help me').agent === 'jenna');

// ============================================================
// Engine — agent flows through process() and getActiveAgent()
// ============================================================
group('Engine carries agent through interim → final');

var eng = W.createWakeEngine();
var interim = eng.process('hey jenna i need', false);
check('3.1 Interim with "hey jenna" sets stillListening=true',
  interim.stillListening === true);
check('3.2 Interim returns agent=jenna',
  interim.agent === 'jenna');
check('3.3 getActiveAgent() during collection returns jenna',
  eng.getActiveAgent() === 'jenna');
var fin = eng.process('hey jenna i need vacation next week', true);
check('3.4 Final commit triggers',
  fin.trigger === true);
check('3.5 Final commit returns agent=jenna',
  fin.agent === 'jenna');
check('3.6 After commit, getActiveAgent() returns null',
  eng.getActiveAgent() === null);

group('Engine debounces correctly across personas');
var eng2 = W.createWakeEngine();
var f1 = eng2.process('hey jenna do something', true);
check('4.1 First Jenna trigger fires',
  f1.trigger === true && f1.agent === 'jenna');
var f2 = eng2.process('hey nadia what is up', true);
check('4.2 Switching to Nadia within 2s is debounced (no double trigger)',
  f2.trigger === false);

// ============================================================
// AIGreeter wires agent → ktc:assistant-changed + defers doSend
// ============================================================
group('AIGreeter handler routes to right persona + defers doSend');

var ag = read('src/components/AIGreeter.jsx');
check('5.1 Handler reads namedAgent from event detail',
  /var namedAgent = ev && ev\.detail && ev\.detail\.agent/.test(ag));
check('5.2 Handler validates agent is one of nadia/jenna/sara',
  /namedAgent === 'nadia' \|\| namedAgent === 'jenna' \|\| namedAgent === 'sara'/.test(ag));
check('5.3 Handler dispatches ktc:assistant-changed with new agent',
  /ktc:assistant-changed[\s\S]{0,200}detail: \{ agent: namedAgent \}/.test(ag));
check('5.4 personaWillSwitch flag tracks if switch is happening',
  /var personaWillSwitch = false[\s\S]{0,800}personaWillSwitch = true/.test(ag));
check('5.5 doSend deferred 80ms when persona switching (race fix)',
  /personaWillSwitch[\s\S]{0,300}setTimeout\(function \(\) \{[\s\S]{0,200}doSendRef\.current\(cmd, false\)[\s\S]{0,80}\}, 80\)/.test(ag));
check('5.6 Direct doSend path preserved for same-persona wake',
  /\} else \{\s*if \(doSendRef\.current\) doSendRef\.current\(cmd, false\)/.test(ag));

// ============================================================
// VoiceController consumes the agent
// ============================================================
group('VoiceController emits agent on hey-bob-command event');

var vc = read('src/components/VoiceController.jsx');
check('6.1 hey-bob-command event includes agent in detail',
  /detail: \{ command: out\.command, agent: out\.agent \|\| null/.test(vc));
check('6.2 onCommand callback receives agent as 2nd arg',
  /onCommand\(out\.command, out\.agent \|\| null\)/.test(vc));
check('6.3 Reads getActiveAgent on commit-pending paths',
  /engineRef\.current\.getActiveAgent && engineRef\.current\.getActiveAgent/.test(vc));

console.log('\n--- SUMMARY ---');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f); });
  process.exit(1);
}
console.log('\nAll ' + passed + ' v55.78 wake-agent tests passed.');
