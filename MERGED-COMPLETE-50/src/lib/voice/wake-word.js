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

// Accept "hey nadia", "hi nadia", "hey, nadia", "nadia", "ya nadia" (Arabic
// vocative يا), plus common recognizer mishearings. Also accepts bare
// "nadia" (no "hey") because people naturally just say her name.
// Capture group 1 = anything after the name (the actual command)
var WAKE_RE = /\b(?:(?:hey|hi|ok|ey|ay|yo|yeah|ya)[\s,]*)?(?:nadia|nadya|nadiah|nadja|nadi|nadir|mahdi|media)\b([\s\S]*)$/i;

// Heuristic for "the user was speaking but said nothing meaningful" —
// filters out just the wake word alone with no command.
var MIN_COMMAND_CHARS = 2;

// ------------------------------------------------------------
// Pure detector — given transcript, return { matched, command, rest }
// ------------------------------------------------------------
export function detectWakeWord(transcript) {
  if (!transcript || typeof transcript !== 'string') {
    return { matched: false, command: null, rest: '' };
  }
  var m = transcript.match(WAKE_RE);
  if (!m) return { matched: false, command: null, rest: transcript };
  // Strip leading punctuation/whitespace — recognizers sometimes leave a
  // trailing comma or period from the wake phrase inside the capture.
  var command = (m[1] || '').replace(/^[\s,.:;!?-]+/, '').trim();
  // Return matched even if command is empty — caller decides whether to wait
  return { matched: true, command: command, rest: '' };
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
    var out = { trigger: false, command: null, stillListening: false };

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
        } else {
          // No wake word in current transcript — treat whole transcript
          // as continuation of command
          state.activeCommand = transcript.trim();
        }
        out.stillListening = true;
        // When final, commit
        if (isFinal && state.activeCommand.length >= MIN_COMMAND_CHARS) {
          out.trigger = true;
          out.command = state.activeCommand;
          state.lastTriggeredAt = now;
          state.activeCommand = null;
          state.lastFinalTranscript = '';
        }
        return out;
      } else {
        // Command window expired — commit what we have if any
        if (state.activeCommand && state.activeCommand.length >= MIN_COMMAND_CHARS) {
          out.trigger = true;
          out.command = state.activeCommand;
          state.lastTriggeredAt = now;
        }
        state.activeCommand = null;
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
        state.lastTriggeredAt = now;
        state.lastFinalTranscript = '';
      } else {
        state.activeCommand = det.command;
        state.activeCommandStartedAt = now;
        out.stillListening = true;
      }
    } else {
      // "Hey Nadia" alone with no command yet — open the collection window
      state.activeCommand = '';
      state.activeCommandStartedAt = now;
      out.stillListening = true;
    }
    return out;
  }

  function reset() {
    state.activeCommand = null;
    state.activeCommandStartedAt = 0;
    state.lastFinalTranscript = '';
  }

  function isCollecting() { return state.activeCommand !== null; }

  return { process: process, reset: reset, isCollecting: isCollecting };
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
