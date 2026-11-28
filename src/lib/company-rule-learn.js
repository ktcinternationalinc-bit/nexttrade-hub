// v55.83-VK — Nextrade / RTM books LEARN from what Max categorizes (Max, 19 Nov 2026: "any categories i enter should be
// learned in nextrade and a rule should be created and used and automatically updated").
// Pure: which words of a bank line become the rule's "description contains" text, and what to do with the rule list.
// Safe on server and browser. SWC-safe (var + concatenation).
import { normMatch, bestCompanyRule } from './companies';
import { isKeywordMatch } from './bank-rule-match';

// words that say nothing about WHO was paid — a rule made only of these would catch unrelated lines, so none is learned
var GENERIC = {};
('check checks deposit deposits transfer transfers xfer payment payments pmt pymt ach wire wires debit credit card pos purchase withdrawal withdrawl online ' +
 'zelle to from the fee fees bill pay paid orig co name id desc descr web ppd ccd mobile banking bank recurring autopay auto electronic external internal ' +
 'incoming outgoing misc service services charge charges in out des indn type ref reference trn trace date entry sec conf confirmation number no and of for ' +
 'usa us inc llc corp ltd visa mastercard amex dda sav savings checking chk account acct').split(' ').forEach(function (w) { GENERIC[w] = true; });

function leadWords(text) {
  var t = normMatch(text); if (!t) { return []; }
  var out = []; var parts = t.split(' ');
  for (var i = 0; i < parts.length && out.length < 6; i++) {
    if (/[0-9]/.test(parts[i])) { if (out.length) { break; } continue; } // a number (date, reference, amount) ends the name; a leading one is skipped
    out.push(parts[i]);
  }
  while (out.length && GENERIC[out[out.length - 1]]) { out.pop(); } // "centerpoint energy payment" → "centerpoint energy"
  return out;
}

// The text a rule should look for in lines like this one, or null when the line says too little to learn from.
export function learnMatchText(line) {
  var l = line || {};
  var tries = [l.merchant_name, l.name];
  for (var i = 0; i < tries.length; i++) {
    var w = leadWords(tries[i]);
    var real = w.filter(function (x) { return !GENERIC[x] && x.length >= 3; });
    var text = w.join(' ');
    if (real.length >= 1 && real.join('').length >= 4 && text.length >= 4) { return text.substring(0, 80); }
  }
  return null;
}

// What to do with the rule list after a person put `line` in category `cat` by hand.
//   rules: every rule of this company (active or not). Returns one of
//   { op: 'none', why }                               nothing to learn (payroll, too little text)
//   { op: 'covered', rule }                           an active rule already gives lines like this the same category
//   { op: 'same', rule }                              the exact rule exists with this category
//   { op: 'update', rule, was, text, direction }      the exact rule exists with another category (or switched off) → it follows the person
//   { op: 'create', text, direction }                 a new rule
export function learnPlan(rules, line, cat) {
  if (!cat || !cat.key) { return { op: 'none', why: 'no category' }; }
  if (cat.is_payroll === true) { return { op: 'none', why: 'payroll' }; } // payroll lines carry people's names — never copied into a rule
  var dir = line && (line.direction === 'in' || line.direction === 'out') ? line.direction : null;
  if (!dir) { return { op: 'none', why: 'no direction' }; }
  var text = learnMatchText(line);
  if (!text) { return { op: 'none', why: 'too little text' }; }
  var exact = (rules || []).filter(function (r) { return r && !isKeywordMatch(r.match_mode) && normMatch(r.match_text) === text && r.direction === dir; })[0] || null;
  if (exact) {
    if (exact.category_key === cat.key && exact.active !== false) { return { op: 'same', rule: exact, text: text, direction: dir }; }
    return { op: 'update', rule: exact, was: exact.category_key, text: text, direction: dir };
  }
  var usable = (rules || []).filter(function (r) { return r && r.active !== false && (r.direction === 'any' || r.direction === dir); });
  var best = bestCompanyRule(usable, String(line.merchant_name || '') + ' ' + String(line.name || ''));
  if (best && best.category_key === cat.key) { return { op: 'covered', rule: best, text: text, direction: dir }; }
  return { op: 'create', text: text, direction: dir };
}

// The Transactions filter: 'all' | 'cat' (has a category) | 'uncat' (none yet) | a category key
export function lineShown(show, line) {
  var has = !!(line && line.company_category);
  if (show === 'all' || !show) { return true; }
  if (show === 'cat') { return has; }
  if (show === 'uncat') { return !has; }
  return has && line.company_category === show;
}

// Of `lines` (not categorized yet), the ones this rule would win — the same choice "Apply rules" makes (longest text wins).
export function linesForRule(rules, ruleId, lines) {
  var active = (rules || []).filter(function (r) { return r && r.active !== false; });
  return (lines || []).filter(function (l) {
    if (!l || l.company_category || l.pending === true) { return false; }
    var usable = active.filter(function (r) { return r.direction === 'any' || r.direction === l.direction; });
    var best = bestCompanyRule(usable, String(l.merchant_name || '') + ' ' + String(l.name || ''));
    return !!best && best.id === ruleId;
  });
}
