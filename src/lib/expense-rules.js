// v55.83-PI — Expense rules: pure matching math (Max, Nov 6: "automatically
// remember previous selections for the future and use them... rules
// automatically saved and updated if i manually change something").
//
// merchantKey turns a noisy bank description into a stable key so the SAME
// merchant always maps to the SAME rule: lowercase, strip card/reference
// numbers and dates, keep the first few words. Pure functions; the launch
// test runs the real math.

export function merchantKey(name) {
  if (!name) { return null; }
  var s = String(name).toLowerCase();
  s = s.replace(/https?:\/\/\S+/g, ' ');            // urls
  s = s.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' '); // dates
  s = s.replace(/[#*]\s*\d+/g, ' ');                // #1234 / *9876 refs
  s = s.replace(/\b\w*\d{3,}\w*\b/g, ' ');          // tokens with long digit runs (card/ref/store ids)
  s = s.replace(/[^a-z& ]+/g, ' ');                 // punctuation + stray digits → space
  s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  if (!s) { return null; }
  var toks = s.split(' ').slice(0, 4);
  var key = toks.join(' ');
  if (key.length < 3) { return null; }              // too short to be a safe rule
  return key;
}

// A rule matches when the transaction's text CONTAINS the rule's match_text.
export function ruleMatches(rule, txnText) {
  if (!rule || !rule.match_text || !txnText) { return false; }
  return String(txnText).toLowerCase().indexOf(String(rule.match_text).toLowerCase()) >= 0;
}

// Best rule = the most specific (longest match_text) ACTIVE rule that matches.
export function bestRule(rules, txnText) {
  var best = null;
  (rules || []).forEach(function (r) {
    if (!r || r.active === false) { return; }
    if (!ruleMatches(r, txnText)) { return; }
    if (!best || String(r.match_text).length > String(best.match_text).length) { best = r; }
  });
  return best;
}
