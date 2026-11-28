import { PHRASE_MATCH } from './bank-rule-match';

export const KEYWORD_RULES_SQL_HINT = 'Install sql/bank-rule-keywords.sql to save rules with keywords.';

function missingMatchMode(error) {
  return error && (error.code === '42703' || error.code === 'PGRST204') && /\bmatch_mode\b/.test(error.message || '');
}

export async function readRuleModes(read) {
  const result = await read(', match_mode');
  return missingMatchMode(result.error) ? read('') : result;
}

export async function writeRuleMode(rule, write) {
  const result = await write(rule);
  if (!missingMatchMode(result.error)) { return result; }
  if (rule.match_mode !== PHRASE_MATCH) { return { error: { message: KEYWORD_RULES_SQL_HINT } }; }
  const { match_mode, ...legacy } = rule;
  return write(legacy);
}

export function readExpensePhraseRule(db, columns, text) {
  return readRuleModes(function (modeColumn) {
    let query = db.from('us_expense_rules').select(columns).ilike('match_text', text);
    if (modeColumn) { query = query.eq('match_mode', PHRASE_MATCH); }
    return query.limit(1);
  });
}
