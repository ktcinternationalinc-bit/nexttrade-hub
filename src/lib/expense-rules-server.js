// v55.83-PI — Expense rules, server side. Two jobs:
//
// learnRule(db, txnText, classification, by): "rules automatically saved and
//   updated if i manually change something" — every HUMAN categorization of
//   an out-transaction upserts a learned rule keyed on the merchant, so the
//   system remembers the pick; changing your mind UPDATES the same rule.
//
// applyExpenseRules(db): the background matcher — untouched expenses
//   (unreviewed, no classification yet, settled, money out) get the category
//   from the most specific ACTIVE auto-apply rule. It only ever fills blanks:
//   it never overwrites a human's pick, never reviews, never verifies.
//   Fails soft everywhere (tables may not exist until the PI SQL runs).
import { merchantKey, bestRule } from './expense-rules';
import { US_WAVE_BUSINESS_ID } from './business-of';

export async function learnRule(db, txnText, classification, by) {
  try {
    if (!classification || classification === 'needs_clarification') { return { skipped: 'no_classification' }; }
    var key = merchantKey(txnText);
    if (!key) { return { skipped: 'no_merchant_key' }; }
    var ex = await db.from('us_expense_rules').select('id, classification, source').ilike('match_text', key).limit(1);
    if (ex.error) { return { skipped: ex.error.message }; }
    if (ex.data && ex.data.length) {
      var row = ex.data[0];
      if (row.classification === classification) { return { kept: row.id }; }
      // The human changed their mind → the rule follows the human. A manual
      // rule is never silently retargeted by the learner — only learned ones.
      if (row.source === 'manual') { return { kept_manual: row.id }; }
      var up = await db.from('us_expense_rules').update({ classification: classification, updated_by: by || null, updated_at: new Date().toISOString(), active: true }).eq('id', row.id).select('id');
      return up.error ? { skipped: up.error.message } : { updated: row.id };
    }
    var ins = await db.from('us_expense_rules').insert({ match_text: key, classification: classification, source: 'learned', auto_apply: true, active: true, created_by: by || null, updated_by: by || null }).select('id');
    return ins.error ? { skipped: ins.error.message } : { learned: (ins.data && ins.data[0] && ins.data[0].id) || true };
  } catch (e) { return { skipped: (e && e.message) || 'learn failed' }; }
}

// v55.83-PJ (Max): bills get the SAME memory — "categories for bills should be
// a dropdown... remember and categorize later on with new bills automatically
// when imported". Returns the remembered category for a vendor, or null.
export async function suggestCategory(db, text) {
  try {
    if (!text) { return null; }
    var rr = await db.from('us_expense_rules').select('id, match_text, classification, active').eq('active', true).limit(1000);
    if (rr.error) { return null; }
    var r = bestRule(rr.data || [], text);
    return r ? r.classification : null;
  } catch (e) { return null; }
}

export async function applyExpenseRules(db, limit) {
  try {
    var rulesRes = await db.from('us_expense_rules').select('id, match_text, classification, auto_apply, active, hit_count').eq('active', true).eq('auto_apply', true).limit(1000);
    if (rulesRes.error) { return { error: rulesRes.error.message }; }
    var rules = rulesRes.data || [];
    if (!rules.length) { return { applied: 0, scanned: 0, rules: 0 }; }
    // Only fill blanks: unreviewed + no classification yet + settled + money out + US.
    var txRes = await db.from('bank_transactions')
      .select('id, name, merchant_name, classification, review_status, direction, pending')
      .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out')
      .eq('review_status', 'unreviewed').is('classification', null)
      .neq('pending', true).limit(limit || 500);
    if (txRes.error) { return { error: txRes.error.message }; }
    var txns = txRes.data || [];
    var applied = 0; var hits = {};
    for (var i = 0; i < txns.length; i++) {
      var t = txns[i];
      var r = bestRule(rules, (t.merchant_name || '') + ' ' + (t.name || ''));
      if (!r) { continue; }
      var upd = await db.from('bank_transactions')
        .update({ classification: r.classification, category_source: 'rule' })
        .eq('id', t.id).eq('review_status', 'unreviewed').is('classification', null) // re-check: never race a human
        .select('id');
      if (!upd.error && upd.data && upd.data.length) { applied++; hits[r.id] = (hits[r.id] || 0) + 1; }
    }
    var rid;
    for (rid in hits) {
      if (Object.prototype.hasOwnProperty.call(hits, rid)) {
        var cur = null;
        for (var k = 0; k < rules.length; k++) { if (rules[k].id === rid) { cur = rules[k]; } }
        await db.from('us_expense_rules').update({ hit_count: ((cur && cur.hit_count) || 0) + hits[rid], last_hit_at: new Date().toISOString() }).eq('id', rid);
      }
    }
    return { applied: applied, scanned: txns.length, rules: rules.length };
  } catch (e) { return { error: (e && e.message) || 'apply failed' }; }
}
