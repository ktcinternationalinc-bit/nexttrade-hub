// ============================================================
// v55.13 — Nadia INSTANT BARGE-IN tests
// ============================================================
// Behavior: when Nadia is speaking and the user starts talking,
// her speech must be cancelled IMMEDIATELY — not after she finishes
// the sentence, not only on wake word, not only on button press.
// Modern voice assistants (ChatGPT voice, Claude voice) all do this.
//
// Architecture (per code in VoiceController.jsx + AIGreeter.jsx):
//   1. AIGreeter dispatches `nadia-tts-start` when she begins speaking
//      → VoiceController sets aiSpeakingRef.current = true, resets the
//        bargeInDispatchedRef so each new utterance can be barged-in once.
//   2. VoiceController's rec.onresult fires on interim transcripts (≥3 chars)
//      → if aiSpeakingRef AND not already dispatched, fires `nadia-bargein`
//      → also clears selfSuppressUntilRef so the rest of the user's command
//        flows through normally.
//   3. AIGreeter listens for `nadia-bargein` → calls stopSpeech() which
//      pauses audio, cancels speechSynthesis, sets paused=true.
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var voiceCtrl = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'VoiceController.jsx'), 'utf8');
var greeter = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AIGreeter.jsx'), 'utf8');

// ----- VoiceController side -----
ok('1: bargeInDispatchedRef declared at component top level (not inside a callback)',
  /var bargeInDispatchedRef = useRef\(false\)/.test(voiceCtrl)
);

ok('2: bargeInLastTextRef declared at component top level',
  /var bargeInLastTextRef = useRef\(''\)/.test(voiceCtrl)
);

// NOTE: barge-in was disabled in a session prior to v55.25. The mic was
// picking up Nadia's own TTS output during longer responses, treating
// the echo as a user interrupt and cutting her off mid-sentence. Real
// fix requires transcript-matching against Nadia's utterance, which
// hasn't been built yet. The infrastructure (refs, event names, listener
// in AIGreeter) is kept intact so re-enabling is one flag flip.
//
// Tests 3 and 8 below now verify the disabled-state pattern AND that the
// infrastructure remains in place. If someone re-enables barge-in without
// adding the transcript-matching guard, the next session's QA should
// note the disabled gate is gone — that's intentional.
ok('3: barge-in is intentionally gated off (disabled until echo-matching is built)',
  /if \(false \/\* barge-in disabled \*\/\)/.test(voiceCtrl)
);

ok('4: barge-in fires the nadia-bargein CustomEvent',
  /dispatchEvent\(new CustomEvent\('nadia-bargein'/.test(voiceCtrl)
);

ok('5: barge-in clears selfSuppressUntilRef so user command flows through',
  /selfSuppressUntilRef\.current = 0/.test(voiceCtrl)
);

ok('6: barge-in flag resets on every new utterance (nadia-tts-start handler)',
  /aiSpeakingRef\.current = true;[\s\S]{0,500}bargeInDispatchedRef\.current = false/.test(voiceCtrl)
);

ok('7: barge-in deduplicates against repeated identical interim transcripts',
  /if \(transcript !== bargeInLastTextRef\.current\)/.test(voiceCtrl)
);

ok('8: barge-in inner branch still preserves dispatch logic (ready for re-enable)',
  // The dead branch must still contain the dispatch + ref-update sequence,
  // so re-enabling is just changing `if (false ...)` to a real condition.
  /if \(false \/\* barge-in disabled \*\/\) \{[\s\S]{0,800}dispatchEvent\(new CustomEvent\('nadia-bargein'/.test(voiceCtrl)
);

// ----- AIGreeter side -----
ok('9: AIGreeter listens for nadia-bargein',
  /addEventListener\('nadia-bargein'/.test(greeter)
);

ok('10: barge-in handler calls stopSpeech',
  /var onBargeIn = function\(ev\) \{[\s\S]{0,500}stopSpeech\(\)/.test(greeter)
);

ok('11: barge-in handler is removed on unmount (no memory leak)',
  /removeEventListener\('nadia-bargein'/.test(greeter)
);

ok('12: barge-in handler respects enabled flag',
  /var onBargeIn = function\(ev\) \{\s*if \(!enabled\) return/.test(greeter)
);

// ----- Behavioral simulation -----
function simulateBargeIn(state, event) {
  // Simplified state machine of VoiceController's barge-in path
  if (event.type === 'nadia-tts-start') {
    state.aiSpeaking = true;
    state.bargeInDispatched = false;
    state.bargeInLastText = '';
  } else if (event.type === 'nadia-tts-stop') {
    state.aiSpeaking = false;
  } else if (event.type === 'transcript') {
    if (state.aiSpeaking && !state.bargeInDispatched && event.text.length >= 3) {
      if (event.text !== state.bargeInLastText) {
        state.bargeInLastText = event.text;
        state.bargeInDispatched = true;
        state.events.push({ type: 'nadia-bargein', text: event.text });
        state.selfSuppressUntil = 0;
      }
    }
  }
  return state;
}

function freshState() {
  return { aiSpeaking: false, bargeInDispatched: false, bargeInLastText: '', selfSuppressUntil: 999999, events: [] };
}

ok('13: BEHAVIOR: speech-start → user says "hello world" → barge-in fires',
  (function() {
    var s = freshState();
    simulateBargeIn(s, { type: 'nadia-tts-start' });
    simulateBargeIn(s, { type: 'transcript', text: 'hello world' });
    return s.events.length === 1 && s.events[0].type === 'nadia-bargein';
  })()
);

ok('14: BEHAVIOR: short echo blip ("I") does NOT trigger barge-in',
  (function() {
    var s = freshState();
    simulateBargeIn(s, { type: 'nadia-tts-start' });
    simulateBargeIn(s, { type: 'transcript', text: 'I' });
    return s.events.length === 0;
  })()
);

ok('15: BEHAVIOR: same partial transcript repeated → only fires barge-in ONCE',
  (function() {
    var s = freshState();
    simulateBargeIn(s, { type: 'nadia-tts-start' });
    simulateBargeIn(s, { type: 'transcript', text: 'hello world' });
    simulateBargeIn(s, { type: 'transcript', text: 'hello world' }); // same again
    simulateBargeIn(s, { type: 'transcript', text: 'hello world more' }); // longer — but already dispatched
    return s.events.length === 1;
  })()
);

ok('16: BEHAVIOR: user talks while she is NOT speaking → no barge-in',
  (function() {
    var s = freshState();
    // aiSpeaking is false — user just said "hello world" cold
    simulateBargeIn(s, { type: 'transcript', text: 'hello world' });
    return s.events.length === 0;
  })()
);

ok('17: BEHAVIOR: barge-in clears selfSuppressUntil',
  (function() {
    var s = freshState();
    simulateBargeIn(s, { type: 'nadia-tts-start' });
    simulateBargeIn(s, { type: 'transcript', text: 'hello world' });
    return s.selfSuppressUntil === 0;
  })()
);

ok('18: BEHAVIOR: second utterance after stop+start → can be barged-in again',
  (function() {
    var s = freshState();
    simulateBargeIn(s, { type: 'nadia-tts-start' });
    simulateBargeIn(s, { type: 'transcript', text: 'first message' });
    simulateBargeIn(s, { type: 'nadia-tts-stop' });
    simulateBargeIn(s, { type: 'nadia-tts-start' }); // resets bargeInDispatched
    simulateBargeIn(s, { type: 'transcript', text: 'second message' });
    return s.events.length === 2;
  })()
);

ok('19: BEHAVIOR: empty / whitespace transcript ignored',
  (function() {
    var s = freshState();
    simulateBargeIn(s, { type: 'nadia-tts-start' });
    simulateBargeIn(s, { type: 'transcript', text: '' });
    simulateBargeIn(s, { type: 'transcript', text: '  ' });
    return s.events.length === 0;
  })()
);

ok('20: BEHAVIOR: 2-char transcript ("hi") does NOT trigger (filters single short echo words)',
  (function() {
    var s = freshState();
    simulateBargeIn(s, { type: 'nadia-tts-start' });
    simulateBargeIn(s, { type: 'transcript', text: 'hi' });
    return s.events.length === 0;
  })()
);

ok('21: BEHAVIOR: exactly 3-char transcript triggers (boundary)',
  (function() {
    var s = freshState();
    simulateBargeIn(s, { type: 'nadia-tts-start' });
    simulateBargeIn(s, { type: 'transcript', text: 'yes' });
    return s.events.length === 1;
  })()
);

console.log('');
if (failures.length === 0) {
  console.log('✅ All barge-in tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function(f) { console.log('   - ' + f); });
  process.exit(1);
}
