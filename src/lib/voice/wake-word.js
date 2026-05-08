// ============================================================
// src/lib/voice/wake-word.js
//
// Pure logic for detecting the wake phrase "Hey Nadia" in a stream of
// live speech-recognition transcripts. No DOM, no React. Testable.
//
// Why a dedicated detector instead of just `if (text.includes('hey nadia'))`:
//   1. People drop filler words: "hey, nadia...", "hey Nadia can you", "ay nadia"
//   2. Recognizers emit partial/interim transcripts that double back on
//      themselves — we have to remember what we already processed so we
//      don't re-trigger on the same utterance.
//   3. After the wake phrase, everything that follows IS the command and
//      must be captured until the user stops speaking.
//   4. Speech recognition often mishears "Nadia" as "Nadya", "Nadiah",
//      "Nadi", "Nadja", "nadir", "media", "Mahdi" — we accept common
//      variants so Max doesn't have to enunciate precisely.
// ============================================================

// v55.78 — Three-persona wake-word detection.
// Before this change, only "Hey Nadia" was a wake-word. Saying "Hey Jenna"
// or "Hey Sara" did nothing — even though Max wanted three distinct AI
// personas. Now each persona has her own wake variants AND we return
// `agent` so the caller can route the command to the right persona.
//
// Pattern: a leading filler ("hey/hi/ok/yo/ya"), then the persona name
// (with common recognizer mishearings), then the actual command.
//
// Recognizer variants per persona:
//   Nadia  — nadia, nadya, nadiah, nadja, nadi, nadir, mahdi, media
//   Jenna  — jenna, gina, jeanna, jana, gianna, jen, jenn, jenny
//            (Note: "jen" alone is a common mis-hear of "ten" and "then" —
//             we still accept it but with stricter context check)
//   Sara   — sara, sarah, sarra, sera, sarai
//
// Capture group 1 = persona variant matched (used to identify agent).
// Capture group 2 = anything after the name (the actual command).
//
// v55.80 BUG-15 FIX: false-positive vector closed. The most ambiguous
// variants — "media" (could appear in any media-talk), "nadi" (subset of
// many words), "jen" (subset of "ten/then/again/general") — now REQUIRE
// the leading filler. Saying "this media is great" no longer triggers
// Nadia. Saying "hey, media" still does.
//
// Two regexes — one for variants that are safe alone, one for variants
// that need the filler. Combined to retain a single capture group structure.
var WAKE_RE = /\b(?:(?:hey|hi|ok|ey|ay|yo|yeah|ya)[\s,]+(nadia|nadya|nadiah|nadja|nadir|mahdi|media|nadi|jenna|gina|jeanna|jana|gianna|jenn|jenny|jen|sara|sarah|sarra|sera|sarai)|(nadia|nadya|nadiah|nadja|nadir|mahdi|jenna|gina|jeanna|jana|gianna|jenn|jenny|sara|sarah|sarra|sera|sarai))\b([\s\S]*)$/i;

// Map detected variant string → canonical agent ID.
var VARIANT_TO_AGENT = {
  // Nadia
  nadia: 'nadia', nadya: 'nadia', nadiah: 'nadia', nadja: 'nadia',
  nadir: 'nadia', mahdi: 'nadia', media: 'nadia', nadi: 'nadia',
  // Jenna
  jenna: 'jenna', gina: 'jenna', jeanna: 'jenna', jana: 'jenna',
  gianna: 'jenna', jenn: 'jenna', jenny: 'jenna', jen: 'jenna',
  // Sara
  sara: 'sara', sarah: 'sara', sarra: 'sara', sera: 'sara', sarai: 'sara',
};

// Heuristic for "the user was speaking but said nothing meaningful" —
// filters out just the wake word alone with no command.
var MIN_COMMAND_CHARS = 2;

// ------------------------------------------------------------
// Pure detector — given transcript, return:
//   { matched, command, rest, agent }
// where agent is one of 'nadia' | 'jenna' | 'sara' | null.
// Old consumers that only check `matched` and `command` keep working.
// ------------------------------------------------------------
export function detectWakeWord(transcript) {
  if (!transcript || typeof transcript !== 'string') {
    return { matched: false, command: null, rest: '', agent: null };
  }
  var m = transcript.match(WAKE_RE);
  if (!m) return { matched: false, command: null, rest: transcript, agent: null };
  // Strip leading punctuation/whitespace — recognizers sometimes leave a
  // trailing comma or period from the wake phrase inside the capture.
  // m[1] = variant that REQUIRED a filler ("hey jen", "hey media", "hey nadi")
  // m[2] = variant that ALLOWED bare ("nadia", "jenna", "sara")
  // m[3] = command (anything after the name)
  // Whichever capture group matched is the variant.
  var variant = (m[1] || m[2] || '').toLowerCase();
  var command = (m[3] || '').replace(/^[\s,.:;!?-]+/, '').trim();
  var agent = VARIANT_TO_AGENT[variant] || 'nadia'; // safe default
  // Return matched even if command is empty — caller decides whether to wait
  return { matched: true, command: command, rest: '', agent: agent };
}

// ------------------------------------------------------------
// Stateful engine — keeps a memory of "last processed" so interim
// results from the recognizer don't cause duplicate triggers.
//
// Typical use (in the VoiceController):
//   var eng = new WakeEngine();
//   recognizer.onresult = function(ev) {
//     var interim = Array.from(ev.results).map(...).join(' ');
//     var out = eng.process(interim, ev.results[last].isFinal);
//     if (out.trigger) { onWake(out.command); }
//   };
// ------------------------------------------------------------
export function createWakeEngine() {
  var state = {
    lastFinalTranscript: '',  // everything finalized so far
    lastTriggeredAt: 0,       // timestamp of last wake trigger (for debouncing)
    activeCommand: null,      // when wake-detected, we collect more words
    activeCommandStartedAt: 0,
    activeAgent: null,        // v55.78 — which persona was named in this utterance
  };

  // Debounce: after one trigger, ignore any re-detection for 2 seconds.
  // Prevents double-triggering on the same spoken phrase when interim
  // results re-emit the same text.
  var DEBOUNCE_MS = 2000;

  // Once wake is detected, keep collecting for up to 8 seconds OR until
  // a final result comes in. This is how we capture "hey bob, what's on
  // my calendar today" as one command.
  var COMMAND_WINDOW_MS = 8000;

  function process(transcript, isFinal) {
    var now = Date.now();
    var out = { trigger: false, command: null, stillListening: false, agent: null };

    if (!transcript) return out;

    // If we're currently collecting a command, extend it
    if (state.activeCommand !== null) {
      // Still in the command-collection window?
      if (now - state.activeCommandStartedAt < COMMAND_WINDOW_MS) {
        // Try to find the wake word in the transcript — if found, use
        // everything AFTER it as the command (this handles the case
        // where interim results keep including "hey bob" at the start)
        var d = detectWakeWord(transcript);
        if (d.matched && d.command) {
          state.activeCommand = d.command;
          // v55.78 — if a different persona is named in the continuation,
          // update the active agent (rare but possible: user starts saying
          // "Hey Nadia" then changes mind and says "actually, hey Jenna...").
          if (d.agent) state.activeAgent = d.agent;
        } else {
          // No wake word in current transcript — treat whole transcript
          // as continuation of command
          state.activeCommand = transcript.trim();
        }
        out.stillListening = true;
        out.agent = state.activeAgent;
        // When final, commit
        if (isFinal && state.activeCommand.length >= MIN_COMMAND_CHARS) {
          out.trigger = true;
          out.command = state.activeCommand;
          out.agent = state.activeAgent;
          state.lastTriggeredAt = now;
          state.activeCommand = null;
          state.activeAgent = null;
          state.lastFinalTranscript = '';
        }
        return out;
      } else {
        // Command window expired — commit what we have if any
        if (state.activeCommand && state.activeCommand.length >= MIN_COMMAND_CHARS) {
          out.trigger = true;
          out.command = state.activeCommand;
          out.agent = state.activeAgent;
          state.lastTriggeredAt = now;
        }
        state.activeCommand = null;
        state.activeAgent = null;
        return out;
      }
    }

    // Not currently in a command — look for wake word
    if (now - state.lastTriggeredAt < DEBOUNCE_MS) return out;

    var det = detectWakeWord(transcript);
    if (!det.matched) {
      if (isFinal) state.lastFinalTranscript = transcript;
      return out;
    }

    // Wake word found
    if (det.command && det.command.length >= MIN_COMMAND_CHARS) {
      // Command included in same utterance — commit immediately if final,
      // otherwise start collection window
      if (isFinal) {
        out.trigger = true;
        out.command = det.command;
        out.agent = det.agent;
        state.lastTriggeredAt = now;
        state.lastFinalTranscript = '';
      } else {
        state.activeCommand = det.command;
        state.activeCommandStartedAt = now;
        state.activeAgent = det.agent;
        out.stillListening = true;
        out.agent = det.agent;
      }
    } else {
      // "Hey Nadia/Jenna/Sara" alone with no command yet — open the
      // collection window and remember which persona was invoked.
      state.activeCommand = '';
      state.activeAgent = det.agent;
      state.activeCommandStartedAt = now;
      out.stillListening = true;
      out.agent = det.agent;
    }
    return out;
  }

  function reset() {
    state.activeCommand = null;
    state.activeAgent = null;
    state.activeCommandStartedAt = 0;
    state.lastFinalTranscript = '';
  }

  function isCollecting() { return state.activeCommand !== null; }

  // v54.5 — Force-commit any pending command. Called by VoiceController
  // when the recognizer ends mid-collection (the user paused for 1-2s
  // and Web Speech terminated the session). The natural pause IS the
  // user's intent to send, so we commit whatever was collected even
  // without an isFinal event.
  // Returns the command text or null if there was nothing meaningful.
  // v55.78 — commitPending stays string-returning for backward compat with
  // VoiceController (which dispatches the bare string to listeners). New
  // consumers can read the agent via getActiveAgent() BEFORE calling
  // commitPending — the agent is cleared on commit.
  function commitPending() {
    if (state.activeCommand === null) return null;
    var cmd = state.activeCommand.trim();
    state.activeCommand = null;
    state.activeAgent = null;
    state.lastFinalTranscript = '';
    if (cmd.length < MIN_COMMAND_CHARS) return null;
    state.lastTriggeredAt = Date.now();
    return cmd;
  }

  // v55.78 — Returns the persona the user named in the most recent wake.
  // Read this BEFORE commitPending() — commit clears the active agent.
  function getActiveAgent() { return state.activeAgent; }

  return { process: process, reset: reset, isCollecting: isCollecting, commitPending: commitPending, getActiveAgent: getActiveAgent };
}

// ------------------------------------------------------------
// Quick barge-in helper — "is this transcript meaningful enough that
// we should interrupt the AI's current speech?"
//
// Used when AI's audio is playing and user's mic is still hot. If they
// say anything substantive (2+ words) we cut the audio.
// ------------------------------------------------------------
export function isBargeInCandidate(transcript) {
  if (!transcript) return false;
  var trimmed = String(transcript).trim();
  if (trimmed.length < 3) return false;
  // "uh", "um" alone doesn't count
  var words = trimmed.split(/\s+/).filter(function(w) {
    return w.length > 1 && !/^(uh|um|mm|er|ah)$/i.test(w);
  });
  return words.length >= 2;
}
