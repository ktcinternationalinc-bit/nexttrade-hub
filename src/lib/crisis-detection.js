// =====================================================================
// src/lib/crisis-detection.js — v55.81 QA-17 (Max May 9 2026)
// =====================================================================
// Detects language in user-submitted HR text that suggests they may be
// in a crisis (self-harm intent, suicidal language, threats from
// others, violence, severe duress).
//
// Used at HR-concern submission time to:
//   1) Tag the complaint with a `crisis_flag` so admins see it elevated
//      in their inbox.
//   2) Surface professional crisis resources to the user BEFORE the
//      submission completes, so they have somewhere to turn beyond
//      Jenna routing the form.
//
// IMPORTANT: this is a heuristic keyword/phrase matcher, NOT a clinical
// screening tool. False positives are acceptable; false negatives are
// not. We err toward flagging more than we miss. A flagged item still
// gets submitted normally — the flag just adds the urgency tag and the
// resource overlay.
//
// Resources:
//   US: 988 (Suicide & Crisis Lifeline)
//   Egypt: Behman Hospital crisis line, +20 2 27365400
// =====================================================================

// Phrases that strongly suggest self-harm or suicidal ideation. Matched
// case-insensitive, word-bounded where possible.
var SELF_HARM_PATTERNS = [
  /\bkill\s+myself\b/i,
  /\bend\s+(it|my\s+life|things)\b/i,
  /\b(want|going|tempted|ready)\s+to\s+die\b/i,
  /\bdon'?t\s+want\s+to\s+(live|be\s+alive|exist|be\s+here)\b/i,
  /\b(commit\s+)?suicid(e|al)\b/i,
  /\bhurt\s+myself\b/i,
  /\bharm\s+myself\b/i,
  /\bcut(ting)?\s+myself\b/i,
  /\bno\s+(reason|point)\s+(to\s+)?live\b/i,
  /\bbetter\s+off\s+(dead|gone|without\s+me)\b/i,
  /\bcan'?t\s+(go\s+on|do\s+this\s+anymore|take\s+(it|this)\s+anymore)\b/i,
  /\bthinking\s+(of|about)\s+(killing|ending|hurting)\b/i,
  /\bplanning\s+to\s+(kill|end|hurt)\s+(myself|me)\b/i,
];

// Phrases suggesting threats of violence FROM others or fear for safety.
var THREAT_PATTERNS = [
  /\b(threatened|threatening)\s+(me|to\s+kill|to\s+hurt)\b/i,
  /\bafraid\s+for\s+my\s+(life|safety)\b/i,
  /\bin\s+danger\b/i,
  /\bbeing\s+(stalked|followed|harassed)\b/i,
  /\b(physical|sexual)\s+(abuse|assault|violence)\b/i,
  /\bhit(\s+me)?\b.{0,20}\b(home|husband|wife|partner|boss)\b/i,
  /\b(weapon|gun|knife)\b.{0,30}\b(me|threat)\b/i,
];

// Severe-distress signals that don't quite cross the self-harm bar
// but warrant care. Lower-priority tag.
var DISTRESS_PATTERNS = [
  /\bcan'?t\s+stop\s+crying\b/i,
  /\b(severe|deep)\s+depression\b/i,
  /\bhopeless(ness)?\b/i,
  /\bnot?\s+sleep(ing)?\s+(at\s+all|in\s+\w+\s+(days|weeks))\b/i,
  /\bbreak(ing|down)\s+down\b/i,
  /\bpanic\s+attacks?\s+(every|all)\s+(day|night)\b/i,
];

// Returns one of: 'self_harm', 'threat', 'distress', or null.
// We always return the highest-severity match; self_harm beats threat
// beats distress.
export function detectCrisisLanguage(text) {
  if (!text || typeof text !== 'string') return null;
  var t = text.trim();
  if (t.length < 8) return null;

  for (var i = 0; i < SELF_HARM_PATTERNS.length; i++) {
    if (SELF_HARM_PATTERNS[i].test(t)) return 'self_harm';
  }
  for (var j = 0; j < THREAT_PATTERNS.length; j++) {
    if (THREAT_PATTERNS[j].test(t)) return 'threat';
  }
  for (var k = 0; k < DISTRESS_PATTERNS.length; k++) {
    if (DISTRESS_PATTERNS[k].test(t)) return 'distress';
  }
  return null;
}

// Resource block to show alongside a flagged submission. Plain text;
// the caller wraps it in whatever UI they want (overlay, banner, etc).
export function crisisResources(flag) {
  if (flag === 'self_harm') {
    return {
      title: 'Please reach out — you do not have to go through this alone.',
      lines: [
        'United States: call or text 988 (Suicide & Crisis Lifeline) — 24/7, free, confidential.',
        'Egypt: Behman Hospital crisis line +20 2 27365400, or +20 762 1494 (Befrienders Cairo).',
        'International: findahelpline.com lists hotlines by country.',
        'If you are in immediate danger, please call your local emergency number now.',
      ],
      note: 'Mr. Kandil will see this as urgent. Your message is also being saved exactly as you wrote it — you do not have to repeat anything.',
    };
  }
  if (flag === 'threat') {
    return {
      title: 'If you are in danger, please get to safety first.',
      lines: [
        'United States: call 911 or text "HELP" to 741741 (Crisis Text Line).',
        'Egypt: emergency 122. National Council for Women hotline 15115 for harassment / DV.',
        'You can save this submission as a draft and come back to it once you are safe.',
      ],
      note: 'Mr. Kandil will receive this immediately and will treat it confidentially.',
    };
  }
  if (flag === 'distress') {
    return {
      title: 'It sounds like things are heavy right now. Please consider reaching out.',
      lines: [
        'United States: 988 (Suicide & Crisis Lifeline) for non-emergency support too — they help with anxiety, panic, depression, anything.',
        'Egypt: Behman Hospital +20 2 27365400.',
        'A friend, family member, or family doctor is also a good place to start.',
      ],
      note: 'Mr. Kandil will see this and follow up with you. You are not alone.',
    };
  }
  return null;
}
