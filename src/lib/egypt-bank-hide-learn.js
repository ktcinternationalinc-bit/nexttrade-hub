// v55.83-VG — Egypt Bank: HIDE ONE, LEARN, HIDE THE REST (Max, Nov 19 2026: "IF I HIDE SOMETHING IT SHOULD BE ABLE TO LEARN AND HIDE
// ALL OTHER ITEMS WITH THE SAME WORD DESCRIPTIONS").
// Pure helpers. The learning itself is an ordinary PRIVATE hide rule (egypt_bank_rules, "description contains …"), so it can be
// seen, switched off or deleted under ⚙ Rules like any other rule, and the existing rules engine hides future imports too.

// The words of a bank description that repeat from one transaction to the next: everything BEFORE the first word that carries a
// digit (a reference, an account number, a date, an amount). "Outward Swift Charges FT26277RSPSR\BNK AC-1000…" → "Outward Swift Charges".
// No such words (the description starts with a reference) → the whole description, so only identical ones match.
export function hidePhraseFrom(description) {
  var d = String(description || '').replace(/\s+/g, ' ').trim();
  if (!d) { return ''; }
  var words = d.split(' '); var keep = [];
  for (var i = 0; i < words.length; i++) { if (/\d/.test(words[i])) { break; } keep.push(words[i]); }
  var phrase = keep.join(' ').replace(/[\s:\-–—|\/\\,.;]+$/, '').trim();
  return phrase.length >= 3 ? phrase : d;
}
// a phrase a rule may be built from: at least 3 characters that are not spaces (one or two letters would hide half the account)
export function hidePhraseUsable(phrase) { return String(phrase || '').replace(/\s+/g, '').length >= 3; }
// how many OTHER transactions that are not hidden yet contain the phrase (same "contains, capitals ignored" as the rules engine)
export function countHideMatches(transactions, phrase, exceptIds) {
  var p = String(phrase || '').replace(/\s+/g, ' ').trim().toLowerCase(); if (!hidePhraseUsable(p)) { return 0; }
  var skip = {}; (exceptIds || []).forEach(function (id) { skip[id] = true; });
  return (transactions || []).filter(function (t) { return t && !skip[t.id] && t.hidden !== true && String(t.description || '').replace(/\s+/g, ' ').toLowerCase().indexOf(p) >= 0; }).length;
}
// the question shown after a Hide click
export function hideLearnQuestion(phrase, others) {
  return 'Hidden.\n\nAlso hide EVERY transaction whose description contains these words — ' + others + ' other' + (others === 1 ? '' : 's') + ' on screen now, and new ones as they are imported?\n\n' +
    'Change the words if they are too wide or too narrow. Press Cancel to hide only this one.\n\nإخفاء كل المعاملات التي يحتوي وصفها على هذه الكلمات؟';
}
// the rule that is saved (private: only the super admin sees it; it only hides, it never categorises)
export function hideRuleFor(phrase, userId) {
  var p = String(phrase || '').replace(/\s+/g, ' ').trim();
  return { match_description: p, match_amount: null, match_account_id: null, set_category: null, set_subcategory: null, set_hidden: true,
    rule_name: ('Hide: ' + p).substring(0, 120), notes: 'Learned from a Hide click', is_private: true, active: true, created_by: userId || null };
}
