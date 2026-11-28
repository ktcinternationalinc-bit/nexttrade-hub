const assert = require('node:assert/strict');
require('sucrase/register');
const { FakeDb } = require('./fake-supabase');
const { ANY_KEYWORD_MATCH, ALL_KEYWORDS_MATCH, PHRASE_MATCH, parseRuleMatch } = require('../src/lib/bank-rule-match');
const { bestRule, ruleMatches } = require('../src/lib/expense-rules');
const { applyExpenseRules, previewRule, applyRuleToAll, learnRule } = require('../src/lib/expense-rules-server');
const { readRuleModes, writeRuleMode } = require('../src/lib/bank-rule-storage');
const { US_WAVE_BUSINESS_ID } = require('../src/lib/business-of');

async function main() {
  const required = parseRuleMatch('Intuit, QBooks intuit', ALL_KEYWORDS_MATCH);
  const alternatives = parseRuleMatch('QBooks, intuit', ANY_KEYWORD_MATCH);
  assert.deepEqual(required, { match_text: 'intuit, qbooks', match_mode: ALL_KEYWORDS_MATCH });
  assert.equal(ruleMatches(required, 'QBOOKS payment for INTUIT'), true);
  assert.equal(ruleMatches(required, 'QBOOKS payment'), false);
  assert.equal(ruleMatches(alternatives, 'AUTOMATIC PAYMENT *QBOOKS'), true);
  assert.equal(ruleMatches(alternatives, 'UNINTUITIVE QBOOKSTORE'), false);
  assert.equal(ruleMatches(parseRuleMatch('TD', ALL_KEYWORDS_MATCH), 'TD-BANK'), true);
  assert.equal(ruleMatches({ match_text: 'intuit qbooks' }, 'QBOOKS payment for INTUIT'), false);
  assert.ok(parseRuleMatch(', ', ALL_KEYWORDS_MATCH).error);
  assert.ok(parseRuleMatch('intuit.com', ANY_KEYWORD_MATCH).error);

  const anyRule = { ...alternatives, id: 'any', classification: 'accounting', active: true, auto_apply: true, source: 'manual' };
  const allRule = { ...required, id: 'all', classification: 'software', active: true, auto_apply: true, source: 'manual' };
  const otherRule = { match_text: 'intuit, refrigerator', match_mode: ANY_KEYWORD_MATCH, classification: 'other', active: true };
  assert.equal(bestRule([otherRule, allRule], 'QBOOKS payment for INTUIT').id, 'all');

  const db = new FakeDb();
  db.t.us_expense_rules = [anyRule, allRule];
  const row = (id, name, data) => ({ id, name, wave_business_id: US_WAVE_BUSINESS_ID, direction: 'out', pending: false, ...data });
  db.t.bank_transactions = [row('a', 'QBOOKS PAYMENT INTUIT'), row('b', 'INTUIT REF 111'), row('c', 'INTUITIVE DESIGN'),
    row('verified', 'INTUIT QBOOKS', { category_verified: true }), row('other', 'INTUIT QBOOKS', { wave_business_id: 'NEXTRADE_BOOKS' })];
  assert.deepEqual((await previewRule(db, required.match_text, 'software', required.match_mode)).hits.map(x => x.id), ['a', 'verified']);
  const applied = await applyRuleToAll(db, allRule);
  assert.deepEqual([applied.applied, applied.verified_untouched], [1, 1]);
  const scheduled = await applyExpenseRules(db);
  assert.equal(scheduled.applied, 1);
  assert.deepEqual(db.t.bank_transactions.map(x => x.classification), ['software', 'accounting', undefined, undefined, undefined]);

  db.t.us_expense_rules.push({ id: 'manual-keyword', match_mode: ALL_KEYWORDS_MATCH, match_text: 'intuit', classification: 'software', source: 'manual' });
  await learnRule(db, 'Intuit', 'fees', 'operator');
  assert.equal(db.t.us_expense_rules.find(rule => rule.id === 'manual-keyword').classification, 'software');
  assert.equal(db.t.us_expense_rules.find(rule => rule.match_mode === PHRASE_MATCH && rule.match_text === 'intuit').classification, 'fees');

  const fieldMissing = { code: '42703', message: 'column match_mode does not exist' };
  assert.deepEqual(await readRuleModes(columns => columns ? { error: fieldMissing } : { data: ['legacy'] }), { data: ['legacy'] });
  const write = draft => draft.match_mode ? { error: fieldMissing } : { data: draft };
  assert.deepEqual(await writeRuleMode({ match_mode: PHRASE_MATCH, match_text: 'intuit' }, write), { data: { match_text: 'intuit' } });
  assert.match((await writeRuleMode(required, write)).error.message, /bank-rule-keywords\.sql/);
  console.log('Keyword matching, KTC preview and automatic application, legacy schema and learning verified.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
