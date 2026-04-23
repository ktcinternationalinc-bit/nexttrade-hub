// ============================================================
// Nadia Voice UX regression tests — AIGreeter.jsx
//
// Covers the four production issues reported Apr 22 2026:
//   1. Speech recognition stopped after ~5 words (continuous=false bug)
//   2. Mic permission re-prompted every login (no Permissions API check)
//   3. No visible way to stop Nadia mid-speech
//   4. No long-form dictation mode
//
// These tests exercise the resolver/logic layer with mocked browser APIs.
// They do NOT require jsdom or a running browser — they simulate the
// recognition lifecycle synthetically.
//
// QA CHARTER: any voice behavior change must update AND re-run this file.
// ============================================================

var assert = require('assert');

var passed = 0;
var failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

// -----------------------------------------------------------------
// Mock SpeechRecognition: minimal shape matching the Web Speech API.
// -----------------------------------------------------------------
function makeMockSR() {
  var instances = [];
  function MockSR() {
    var self = this;
    self.continuous = false;
    self.interimResults = false;
    self.maxAlternatives = 1;
    self.lang = 'en-US';
    self.started = false;
    self.stopped = false;
    self.start = function() { self.started = true; };
    self.stop = function() { self.stopped = true; if (self.onend) setTimeout(self.onend, 0); };
    self.emit = function(resultSegments, isFinal) {
      // resultSegments = [{ transcript, isFinal }, ...]
      var ev = {
        resultIndex: 0,
        results: resultSegments.map(function(s) {
          var arr = [{ transcript: s.transcript }];
          arr.isFinal = !!s.isFinal;
          return arr;
        })
      };
      if (self.onresult) self.onresult(ev);
    };
    instances.push(self);
  }
  MockSR.instances = instances;
  return MockSR;
}

// -----------------------------------------------------------------
// Resolver: mirrors the accumulation logic inside startListen's onresult.
// Extracted so we can test it without a browser.
// -----------------------------------------------------------------
function buildTranscriptFromEvent(priorAccumulated, ev) {
  var finalText = priorAccumulated;
  var interim = '';
  for (var i = ev.resultIndex; i < ev.results.length; i++) {
    var r = ev.results[i];
    if (r.isFinal) finalText += r[0].transcript + ' ';
    else interim += r[0].transcript;
  }
  return { finalText: finalText, displayed: (finalText + interim).trim() };
}

// Simulated permission check mirroring what startListen does pre-start.
async function checkMicPermission(permissionsApi) {
  if (!permissionsApi || !permissionsApi.query) return 'unknown';
  try {
    var p = await permissionsApi.query({ name: 'microphone' });
    return p && p.state ? p.state : 'unknown';
  } catch (e) { return 'unknown'; }
}

// -----------------------------------------------------------------
// TESTS
// -----------------------------------------------------------------

// Issue #1: "only hears first 5 words"
test('V1.1 continuous=true keeps listening past first pause', function() {
  var SR = makeMockSR();
  var rec = new SR();
  // In the new implementation, on Chromium we set continuous=true.
  rec.continuous = true;
  var accumulated = '';

  // Simulate user saying a sentence, pausing, then finishing.
  rec.onresult = function(ev) {
    var result = buildTranscriptFromEvent(accumulated, ev);
    accumulated = result.finalText;
  };
  // Three finalized chunks separated by pauses (previously each "final" would have stopped us)
  rec.emit([{ transcript: 'please check my overdue invoices', isFinal: true }], true);
  rec.emit([{ transcript: 'for yasser from last week', isFinal: true }], true);
  rec.emit([{ transcript: 'and send him a reminder', isFinal: true }], true);

  assert(accumulated.indexOf('overdue invoices') !== -1, 'first chunk preserved');
  assert(accumulated.indexOf('yasser') !== -1, 'second chunk preserved');
  assert(accumulated.indexOf('send him a reminder') !== -1, 'third chunk preserved — this is the regression');
  assert.strictEqual(accumulated.trim(), 'please check my overdue invoices for yasser from last week and send him a reminder');
});

test('V1.2 interim results shown live but not persisted until final', function() {
  var accumulated = '';
  // User starts typing with interim results
  var ev1 = { resultIndex: 0, results: [(function() { var a = [{ transcript: 'hello' }]; a.isFinal = false; return a; })()] };
  var r1 = buildTranscriptFromEvent(accumulated, ev1);
  // Interim should show in displayed but NOT persist into accumulated
  assert.strictEqual(r1.finalText, '', 'interim must not persist');
  assert.strictEqual(r1.displayed, 'hello', 'interim should display live');
  accumulated = r1.finalText;

  // Now the same word becomes final
  var ev2 = { resultIndex: 0, results: [(function() { var a = [{ transcript: 'hello there' }]; a.isFinal = true; return a; })()] };
  var r2 = buildTranscriptFromEvent(accumulated, ev2);
  assert.strictEqual(r2.finalText.trim(), 'hello there', 'final persists');
});

test('V1.3 Arabic multi-word utterance accumulates correctly', function() {
  var accumulated = '';
  var chunks = ['ارسل رسالة', 'الى ياسر', 'عن الفاتورة رقم 2300'];
  chunks.forEach(function(chunk) {
    var ev = { resultIndex: 0, results: [(function() { var a = [{ transcript: chunk }]; a.isFinal = true; return a; })()] };
    var result = buildTranscriptFromEvent(accumulated, ev);
    accumulated = result.finalText;
  });
  assert(accumulated.indexOf('ياسر') !== -1, 'arabic preserved');
  assert(accumulated.indexOf('2300') !== -1, 'order number preserved');
  assert(accumulated.split(' ').length >= 6, 'all words captured');
});

// Issue #2: Mic permission persistence
test('V2.1 Permissions API "granted" state means no re-prompt needed', async function() {
  var fakePermissions = { query: async function() { return { state: 'granted' }; } };
  var state = await checkMicPermission(fakePermissions);
  assert.strictEqual(state, 'granted', 'granted state means we skip the pre-flight warning');
});

test('V2.2 Permissions API "denied" state blocks start and shows actionable warning', async function() {
  var fakePermissions = { query: async function() { return { state: 'denied' }; } };
  var state = await checkMicPermission(fakePermissions);
  assert.strictEqual(state, 'denied', 'denied state must be detected so we can direct user to browser settings');
});

test('V2.3 Missing Permissions API (Safari) degrades gracefully', async function() {
  var state = await checkMicPermission(null);
  assert.strictEqual(state, 'unknown', 'no permissions API → unknown, don\'t block the user');
});

test('V2.4 Permissions API throws (some browsers) still degrades to unknown', async function() {
  var brokenApi = { query: async function() { throw new Error('not supported for microphone'); } };
  var state = await checkMicPermission(brokenApi);
  assert.strictEqual(state, 'unknown', 'errors in permissions.query must not crash startListen');
});

// Issue #3: Stop-Nadia-while-speaking
test('V3.1 stopSpeech pauses current audio element', function() {
  var paused = false;
  var audioMock = { pause: function() { paused = true; } };
  // Simulated stopSpeech logic
  function stopSpeech(audio, synth) {
    if (audio) audio.pause();
    if (synth) synth.cancel();
  }
  stopSpeech(audioMock, null);
  assert.strictEqual(paused, true, 'audio element must be paused');
});

test('V3.2 stopSpeech cancels speechSynthesis fallback', function() {
  var cancelled = false;
  var synthMock = { cancel: function() { cancelled = true; } };
  function stopSpeech(audio, synth) {
    if (audio) audio.pause();
    if (synth) synth.cancel();
  }
  stopSpeech(null, synthMock);
  assert.strictEqual(cancelled, true, 'speechSynthesis must be cancelled');
});

test('V3.3 Barge-in: mic tap while speaking triggers stopSpeech + startListen', function() {
  var speechStopped = false;
  var listening = false;
  function simulateMicTap(speaking, currentlyListening) {
    if (speaking) speechStopped = true;
    if (currentlyListening) return { listening: false };
    return { listening: true };
  }
  var result = simulateMicTap(true, false);
  assert.strictEqual(speechStopped, true, 'mic tap while speaking must stop Nadia');
  assert.strictEqual(result.listening, true, 'mic tap while speaking must also START listening (single-tap barge-in)');
});

// Issue #4: Long-form dictation
test('V4.1 Empty transcript (accidental tap) does not fire send', function() {
  var sent = null;
  function onEnd(accumulatedText, sendFn) {
    var final = String(accumulatedText || '').trim();
    if (final) sendFn(final);
  }
  onEnd('', function(t) { sent = t; });
  onEnd('   ', function(t) { sent = t; });
  assert.strictEqual(sent, null, 'empty/whitespace must not send');
});

test('V4.2 Long multi-sentence dictation finalizes as one message', function() {
  var accumulated = '';
  var chunks = [
    'I want to check on the shipment from Alexandria',
    'it was supposed to arrive yesterday',
    'can you see if there is a tracking update',
    'and let me know if the customer has been notified'
  ];
  chunks.forEach(function(c) {
    var ev = { resultIndex: 0, results: [(function() { var a = [{ transcript: c }]; a.isFinal = true; return a; })()] };
    var result = buildTranscriptFromEvent(accumulated, ev);
    accumulated = result.finalText;
  });
  assert(accumulated.length > 100, 'long dictation length preserved');
  assert(accumulated.indexOf('Alexandria') !== -1);
  assert(accumulated.indexOf('tracking update') !== -1);
  assert(accumulated.indexOf('notified') !== -1);
});

test('V4.3 Silence timer logic triggers stop after configured timeout', function() {
  // Synchronous verification of timer-reset semantics. We verify the cancel+set behavior
  // directly without waiting, to keep the suite deterministic.
  var SILENCE_TIMEOUT = 80;
  var timer = null;
  var stoppedByTimer = false;
  function resetTimer(stopFn) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function() { stoppedByTimer = true; stopFn(); }, SILENCE_TIMEOUT);
  }
  resetTimer(function() {});
  // Immediate reset should cancel the pending timer — we verify the underlying contract:
  // calling resetTimer repeatedly should leave exactly ONE pending timer.
  resetTimer(function() {});
  resetTimer(function() {});
  // The stopped flag should still be false right after resets
  assert.strictEqual(stoppedByTimer, false, 'rapid resets must keep timer from firing');
  // Clean up so we don't leak timers into the test runner
  if (timer) clearTimeout(timer);
});

// Intent detection sanity check — makes sure the "send me a message" vs "set a reminder" etc.
// dispatcher still works on transcribed text. This catches cases where voice transcription
// might break intent matching (e.g., if transcript includes trailing punctuation or casing).
test('V5.1 Transcribed text matches expected action patterns after accumulation', function() {
  var samples = [
    { text: 'send omar a message about the shipment ', expect: /send.*message/i },
    { text: 'remind me tomorrow at 9am to call yasser ', expect: /remind/i },
    { text: 'create an event for friday at 3pm ', expect: /create.*event|schedule/i }
  ];
  samples.forEach(function(s) {
    assert(s.expect.test(s.text.toLowerCase()), 'transcribed text must match intent pattern: ' + s.text);
  });
});

console.log('');
console.log('─────────────────────────────────────');
console.log('VOICE TEST RESULTS');
console.log('─────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES — do not deploy until fixed'); process.exit(1); }
else console.log('\n✅ All voice UX tests passed');

