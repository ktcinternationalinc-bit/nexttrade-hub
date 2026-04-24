// ============================================================
// Session 17.7 (Apr 23 2026) — Tab-greeting speech + auto-expand fixes
//
// Bugs reported:
//   1. On non-dashboard tabs, Nadia speaks only "good morning Mohamed"
//      even though she types a full response → caused by a fallback that
//      kicked in when the API returned an empty answer.
//   2. Overlay stayed collapsed when Nadia had something new to say, so
//      the user saw typed text only after clicking.
//   3. Tab-greeting prompt was too brief (15 words max) — felt like a
//      robotic summary instead of a colleague noticing something.
//
// Fixes:
//   A. API empty-response → retry once before falling back. Fallback text
//      is now explicitly "loading" rather than faking a greeting.
//   B. Overlay auto-expands when a NEW assistant message arrives, so the
//      tab-greeting is immediately visible + hearable.
//   C. Tab-greeting prompt asks for 2-3 sentences with specific numbers/
//      names. Warmer tone. Must end with an offer to help.
// ============================================================

var fs = require('fs');
var path = require('path');
var assert = require('assert');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
var overlay = fs.readFileSync(path.join(REPO, 'src/components/NadiaFloatingOverlay.jsx'), 'utf8');
var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');

// ======================================================
// FIX A — No more "Hey Mohamed!" fallback when API fails
// ======================================================

test('S17.7.A1 Old "Hey firstName!" fallback is removed', function() {
  // The exact bug: an empty response fell through to "Hey Mohamed!" which
  // sounded like a cold re-greeting. Old code:
  //   if (!aiText) aiText = ... "Hey " + firstName + "!";
  assert(!/if \(!aiText\) aiText = useLang === 'ar' \? 'صباح الخير ' \+ firstName \+ '!' : 'Hey ' \+ firstName \+ '!'/.test(greeter),
    'old unconditional "Hey firstName!" fallback line must be removed');
});

test('S17.7.A2 Empty API response triggers a single retry', function() {
  assert(/if \(!aiText\) \{\s*try \{\s*var res2 = await fetch\(endpoint/.test(greeter),
    'empty response must trigger a retry fetch to the same endpoint');
});

test('S17.7.A3 Retry reuses the same payload', function() {
  // The retry should POST the same payload — body: JSON.stringify(payload)
  assert(/var res2 = await fetch\(endpoint[\s\S]{0,300}body: JSON\.stringify\(payload\)/.test(greeter),
    'retry must send the same payload so the API has the same prompt');
});

test('S17.7.A4 Retry attaches decision + briefing if the second response has them', function() {
  // When the retry succeeds, we want the decision chips and briefing card
  // to still show.
  assert(/if \(data2 && data2\.decision && data2\.decision\.ok\) data\.decision = data2\.decision/.test(greeter),
    'retry must propagate decision to the main data object');
  assert(/if \(data2 && data2\.briefing\) data\.briefing = data2\.briefing/.test(greeter),
    'retry must propagate briefing to the main data object');
});

test('S17.7.A5 Minimal fallback now says "loading" — not a fake greeting', function() {
  // Previously the fallback masqueraded as a greeting. Now it explicitly
  // signals the state so the user knows there was an issue.
  assert(/One sec [^']*firstName[^']*, loading your data\./.test(greeter) ||
         /One sec ' \+ firstName \+ ', loading your data\./.test(greeter),
    'fallback text must explicitly say loading (not fake a greeting)');
});

// ======================================================
// FIX B — Overlay auto-expands on new assistant message
// ======================================================

test('S17.7.B1 Overlay uses useRef to track assistant message count', function() {
  assert(/var assistantCountRef = useRef\(0\)/.test(overlay),
    'overlay must have a ref to track the previous assistant-message count');
});

test('S17.7.B2 Overlay imports useRef', function() {
  assert(/import React, \{ useState, useEffect, useRef \} from 'react'/.test(overlay),
    'useRef must be imported');
});

test('S17.7.B3 Overlay auto-expands when assistant count increases', function() {
  assert(/if \(currentCount > assistantCountRef\.current\)/.test(overlay),
    'auto-expand logic must compare new count to stored count');
  assert(/if \(!expanded\) setExpanded\(true\)/.test(overlay),
    'must call setExpanded(true) when a new assistant message arrives');
});

test('S17.7.B4 Auto-expand effect runs on sessionMsgs length change', function() {
  // The dependency must include the length so changes trigger the effect
  assert(/\}, \[sessionMsgs\.length\]\)/.test(overlay),
    'effect deps must include sessionMsgs.length');
});

test('S17.7.B5 Auto-expand updates the stored count so it does not re-fire', function() {
  assert(/assistantCountRef\.current = currentCount/.test(overlay),
    'after auto-expanding, the ref must update so we do not re-expand on every render');
});

// ======================================================
// FIX C — Richer tab-greeting prompt
// ======================================================

test('S17.7.C1 Old "1 short sentence (max 15 words)" prompt is replaced', function() {
  assert(!/In 1 short sentence \(max 15 words\)/.test(greeter),
    'old terse prompt must be removed');
});

test('S17.7.C2 New tab-greeting asks for 2-3 sentences', function() {
  assert(/Give a 2-3 sentence proactive update/.test(greeter),
    'new prompt must explicitly ask for 2-3 sentences');
});

test('S17.7.C3 New tab-greeting asks for specific numbers/names/dates', function() {
  assert(/cite real numbers, names, counts, or dates/.test(greeter),
    'prompt must instruct Nadia to cite specifics from the context');
});

test('S17.7.C4 New tab-greeting asks for warm colleague tone', function() {
  assert(/warm experienced colleague/.test(greeter),
    'tone guidance must ask for colleague-like warmth');
});

test('S17.7.C5 Tab-greeting still forbids redundant hello/hi/good morning', function() {
  assert(/Do NOT say hello\/hi\/good morning/.test(greeter),
    'must still tell her not to double-greet (she already greeted on login)');
});

test('S17.7.C6 Tab-greeting ends with an offer/question', function() {
  assert(/End with a brief question or offer to help/.test(greeter),
    'prompt must ask her to end with a prompt that invites further conversation');
});

// ======================================================
// REGRESSION — Dashboard Nadia must be unchanged
// ======================================================

test('S17.7.R1 Dashboard AIGreeter mount is still present and unchanged', function() {
  // Exactly one direct mount in page.jsx (the dashboard)
  var count = (page.match(/<AIGreeter\b/g) || []).length;
  assert(count === 1, 'expected exactly 1 direct AIGreeter mount, found ' + count);
  // Its wrapper still uses max-md:order-last (original behavior)
  assert(/<div className="max-md:order-last">\s*\n\s*\{!greeterDismissed/.test(page),
    'dashboard AIGreeter wrapper unchanged (max-md:order-last)');
});

test('S17.7.R2 Dashboard login-greeting effect still intact', function() {
  // The login-greet effect fires doSend(null, true) after a 1200ms delay
  assert(/doSend\(null, true\);/.test(greeter),
    'login greeting still called with isGreeting=true');
  assert(/if \(hasGreeted \|\| !enabled \|\| !loginHistoryLoaded\) return;/.test(greeter),
    'login-greeting gate on hasGreeted/enabled/loginHistoryLoaded intact');
});

test('S17.7.R3 Dashboard does NOT fire tab-greeting (contextTab==="dashboard" returns)', function() {
  assert(/if \(contextTab === 'dashboard'\) return;/.test(greeter),
    'dashboard tab must still early-return from tab-greeting effect');
});

test('S17.7.R4 loginGreet uses EMPTY messages array (resets chat), tabGreet preserves', function() {
  assert(/var msgs = isLoginGreet \? \[\] : \[\]\.concat\(messages\)/.test(greeter),
    'login greeting must reset messages, tab greeting must preserve them');
});

test('S17.7.R5 Briefing still computed only on login greeting (not tab greeting)', function() {
  // isLoginGreet flag is passed to the API as isGreeting
  assert(/isGreeting: isLoginGreet/.test(greeter),
    'API isGreeting flag is true ONLY for login greeting, not tab greeting');
});

test('S17.7.R6 doSpeak still fires for ALL assistant messages (not just greetings)', function() {
  // This is the critical piece — after API response, doSpeak must be called
  // regardless of whether it was a login/tab/reply.
  assert(/doSpeak\(aiText\);\s*doType\(aiText, null\);/.test(greeter),
    'doSpeak fires immediately after the API response for every answer');
});

test('S17.7.R7 doSpeak still honors muted flag', function() {
  assert(/if \(muted\) \{\s*try \{ console\.log\('\[nadia\] muted/.test(greeter),
    'muted check at top of doSpeak intact');
});

test('S17.7.R8 Default muted state is false (she speaks by default)', function() {
  // nadiaMuted in page.jsx reads from localStorage — defaults to false
  // when the key is missing or when localStorage throws.
  assert(/localStorage\.getItem\('nadia\.muted'\) === 'true'/.test(page),
    'only explicit "true" in localStorage makes her muted; default is unmuted');
  assert(/\} catch \(e\) \{ return false; \}/.test(page),
    'localStorage failures default to false (unmuted) so she speaks by default');
});

test('S17.7.R9 Overlay muted state also defaults to false', function() {
  assert(/\} catch \(e\) \{ return false; \}/.test(overlay),
    'overlay internalMuted defaults to false on localStorage error');
});

test('S17.7.R10 Hidden AIGreeter in collapsed overlay still mounts (speech fires)', function() {
  // Ensure the "rendered but offscreen" strategy is intact so effects fire
  assert(/left: -99999, top: -99999[\s\S]{0,300}<AIGreeter \{\.\.\.props\} muted=\{muted\}/.test(overlay),
    'AIGreeter must still be hidden-mounted when collapsed so tab-greeting fires');
});

// ======================================================
// REGRESSION — No earlier functionality broken
// ======================================================

test('S17.7.REG1 Close-with-comment modal still works', function() {
  var ticketsTab = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
  assert(/const finalizeClose = async \(\) => \{/.test(ticketsTab),
    'finalizeClose still defined');
});

test('S17.7.REG2 Check uncollect handler still intact', function() {
  assert(/const handleUncollectCheck = async \(check, reason\) =>/.test(page),
    'handleUncollectCheck still defined');
});

test('S17.7.REG3 Summary card dark palette still intact', function() {
  assert(/linear-gradient\(135deg, #064e3b 0%, #065f46 100%\)/.test(page),
    'Treasury Cash In dark emerald still present');
});

test('S17.7.REG4 Color palette disambiguation still intact (orange vs yellow)', function() {
  assert(/dueToday \? '#f97316'/.test(page),
    'due-today orange vs medium-priority yellow distinction intact');
});

test('S17.7.REG5 Morning briefing engine still wired', function() {
  var briefEngine = fs.readFileSync(path.join(REPO, 'src/lib/briefing-engine.js'), 'utf8');
  assert(/buildBriefing: buildBriefing/.test(briefEngine),
    'briefing engine export intact');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
