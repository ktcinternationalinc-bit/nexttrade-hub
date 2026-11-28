export const PHRASE_MATCH = 'phrase';
export const ANY_KEYWORD_MATCH = 'any_keyword';
export const ALL_KEYWORDS_MATCH = 'all_keywords';

export function isKeywordMatch(mode) {
  return mode === ANY_KEYWORD_MATCH || mode === ALL_KEYWORDS_MATCH;
}

const word = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*$/u;

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase();
}

export function parseRuleMatch(text, mode, normalizePhrase = value => String(value ?? '').trim().toLowerCase()) {
  const matchMode = mode ?? PHRASE_MATCH;
  if (isKeywordMatch(matchMode)) {
    const keywords = normalize(text).split(/[\s,]+/u).filter(Boolean);
    if (!keywords.length || keywords.some(keyword => !word.test(keyword))) {
      return { error: 'Enter one or more words or codes separated by commas or spaces.' };
    }
    return { match_mode: matchMode, match_text: [...new Set(keywords)].sort().join(', ') };
  }
  if (matchMode !== PHRASE_MATCH) { return { error: 'Choose a match type.' }; }
  const phrase = normalizePhrase(text);
  if (phrase.length < 3) { return { error: 'Enter a phrase of at least 3 characters.' }; }
  return { match_mode: matchMode, match_text: phrase };
}

export function transactionWords(text) {
  return new Set(normalize(text).match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) || []);
}

export function keywordMatchLength(rule, words) {
  const required = rule.match_mode === ALL_KEYWORDS_MATCH;
  let specificity = 0;
  for (const keyword of normalize(rule.match_text).split(/[\s,]+/u).filter(Boolean)) {
    if (!words.has(keyword)) {
      if (required) { return 0; }
    } else {
      specificity = required ? specificity + keyword.length : Math.max(specificity, keyword.length);
    }
  }
  return specificity;
}

export function ruleMatchLabel(rule) {
  if (rule.match_mode === ALL_KEYWORDS_MATCH) { return 'All keywords · ' + rule.match_text; }
  if (rule.match_mode === ANY_KEYWORD_MATCH) { return 'Any keyword · ' + rule.match_text; }
  return '“' + rule.match_text + '”';
}
