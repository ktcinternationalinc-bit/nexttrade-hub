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
import { merchantKey, bestRule, ruleMatches } from './expense-rules';
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

// v55.83-PZ (Max, Nov 7 11:22): "whatever done in all transactions should
// automatically update in the wave accounting section as well... if not
// compatible remain empty in wave or select the closest one that is
// compatible on the wave side and save."
// Resolution order: 1) the category's explicit 🌊 link; 2) an EXACT
// (normalized) name match against Wave's own chart — found once, SAVED onto
// the category so it shows in the 🏷 editor; 3) nothing — Wave stays empty.
// "Closest" never means fuzzy guessing into the books: equal names only,
// and only when exactly ONE Wave account matches.
function normName(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
export async function waveAccountForCategory(db, clsKey) {
  try {
    if (!clsKey || clsKey === 'needs_clarification' || clsKey === 'transfer') { return null; } // a transfer is never a Wave income/expense category
    var cat = await db.from('expense_categories').select('id, key, label, wave_account_id, wave_account_name').eq('key', clsKey).maybeSingle();
    if (!cat.data) { return null; }
    if (cat.data.wave_account_id) { return { wave_account_id: cat.data.wave_account_id, wave_account_name: cat.data.wave_account_name || null, how: 'linked' }; }
    var wc = await db.from('wave_categories').select('wave_account_id, wave_account_name, is_active').eq('wave_business_id', US_WAVE_BUSINESS_ID).limit(3000);
    if (wc.error) { return null; }
    var want1 = normName(cat.data.label); var want2 = normName(String(cat.data.key).replace(/_/g, ' '));
    var hits = [];
    (wc.data || []).forEach(function (w) {
      if (w.is_active === false) { return; }
      var nm = normName(w.wave_account_name);
      if (nm && (nm === want1 || nm === want2)) { hits.push(w); }
    });
    if (hits.length !== 1) { return null; } // ambiguous or none → Wave stays empty (Max's fallback)
    // SAVE the discovered link on the category, so it is visible and editable
    await db.from('expense_categories').update({ wave_account_id: hits[0].wave_account_id, wave_account_name: hits[0].wave_account_name || null, updated_at: new Date().toISOString() }).eq('id', cat.data.id);
    return { wave_account_id: hits[0].wave_account_id, wave_account_name: hits[0].wave_account_name || null, how: 'name_match_saved' };
  } catch (e) { return null; }
}

// v55.83-RC (Max, Nov 8 13:59: "it should automatically apply regardless..
// but clicking on apply is not working"). One engine for the 15-minute job,
// "apply now" and saving a rule:
//   • money IN and OUT (a rule has no direction), every date, paged past the
//     1,000-row cap, settled rows only, never a marked duplicate;
//   • fills every row with NO category (any review status);
//   • re-targets rows a rule filled earlier when the rule now says otherwise;
//   • with overwrite_people=true (explicit button) also replaces categories a
//     PERSON picked — a VERIFIED row is never touched, in any mode;
//   • batched updates (one call per 200 rows), so a big apply finishes
//     inside the server time limit instead of silently timing out.
async function pageBankRows(db, cols, extra) {
  var out = [];
  for (var pg = 0; pg < 40; pg++) {
    var q = db.from('bank_transactions').select(cols)
      .eq('wave_business_id', US_WAVE_BUSINESS_ID)
      .not('pending', 'is', true)                                  // settled (NULL counts as settled)
      .or('review_status.is.null,review_status.neq.duplicate');   // never a marked duplicate copy
    if (extra) { q = extra(q); }
    var r = await q.order('id', { ascending: true }).range(pg * 1000, pg * 1000 + 999);
    if (r.error) { return { error: r.error.message }; }
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < 1000) { break; }
  }
  return { rows: out };
}
export function rowText(t) { return ((t.merchant_name || '') + ' ' + (t.name || '')).trim(); }
export function ruleBucket(t, ruleCls) {
  if (t.category_verified === true) { return 'verified'; }
  if (!t.classification) { return 'blank'; }
  if (t.category_source === 'rule') { return t.classification === ruleCls ? 'same' : 'rule'; }
  return t.classification === ruleCls ? 'same' : 'human';
}
async function batchSet(db, ids, cls, mode) {
  var n = 0;
  for (var i = 0; i < ids.length; i += 200) {
    var chunk = ids.slice(i, i + 200);
    var q = db.from('bank_transactions').update({ classification: cls, category_source: 'rule' }).in('id', chunk)
      .not('category_verified', 'is', true); // a verified row is never touched
    if (mode === 'blank') { q = q.is('classification', null); }           // re-check: never race a person
    else if (mode === 'rule') { q = q.eq('category_source', 'rule'); }
    var r = await q.select('id');
    if (!r.error && r.data) { n += r.data.length; }
  }
  return n;
}
export async function previewRule(db, matchText, ruleCls) {
  var got = await pageBankRows(db, 'id, date, posted_date, amount_abs, direction, name, merchant_name, classification, category_source, category_verified, review_status');
  if (got.error) { return { error: got.error }; }
  var probe = { match_text: matchText };
  var hits = got.rows.filter(function (t) { return ruleMatches(probe, rowText(t)); });
  var b = { blank: [], rule: [], human: [], verified: [], same: [] };
  hits.forEach(function (t) { b[ruleBucket(t, ruleCls)].push(t); });
  return { scanned: got.rows.length, hits: hits, buckets: b };
}
export async function applyRuleToAll(db, rule, opts) {
  var o = opts || {};
  var pv = await previewRule(db, rule.match_text, rule.classification);
  if (pv.error) { return { error: pv.error }; }
  var ids = function (arr) { return arr.map(function (t) { return t.id; }); };
  var a1 = await batchSet(db, ids(pv.buckets.blank), rule.classification, 'blank');
  var a2 = await batchSet(db, ids(pv.buckets.rule), rule.classification, 'rule');
  var a3 = o.overwrite_people === true ? await batchSet(db, ids(pv.buckets.human), rule.classification, 'any') : 0;
  var applied = a1 + a2 + a3;
  if (applied > 0 && rule.id) {
    await db.from('us_expense_rules').update({ hit_count: (Number(rule.hit_count) || 0) + applied, last_hit_at: new Date().toISOString() }).eq('id', rule.id);
  }
  return { applied: applied, filled_blank: a1, retargeted: a2, overwrote_people: a3, matches: pv.hits.length,
    already_right: pv.buckets.same.length, left_people: o.overwrite_people === true ? 0 : pv.buckets.human.length,
    verified_untouched: pv.buckets.verified.length, scanned: pv.scanned };
}

export async function applyExpenseRules(db, limit) {
  try {
    var rulesRes = await db.from('us_expense_rules').select('id, match_text, classification, auto_apply, active, hit_count').eq('active', true).eq('auto_apply', true).limit(1000);
    if (rulesRes.error) { return { error: rulesRes.error.message }; }
    var rules = rulesRes.data || [];
    if (!rules.length) { return { applied: 0, scanned: 0, rules: 0 }; }
    // every row with NO category (any review status, money in and out) — blanks only on the automatic run
    var got = await pageBankRows(db, 'id, name, merchant_name, classification, category_verified', function (q) { return q.is('classification', null); });
    if (got.error) { return { error: got.error }; }
    var byRule = {};
    got.rows.forEach(function (t) {
      if (t.category_verified === true) { return; }
      var r = bestRule(rules, rowText(t));
      if (r) { (byRule[r.id] = byRule[r.id] || []).push(t.id); }
    });
    var applied = 0; var rid;
    for (rid in byRule) {
      if (Object.prototype.hasOwnProperty.call(byRule, rid)) {
        var cur = null;
        for (var k = 0; k < rules.length; k++) { if (rules[k].id === rid) { cur = rules[k]; } }
        var n = await batchSet(db, byRule[rid], cur.classification, 'blank');
        applied += n;
        if (n > 0) { await db.from('us_expense_rules').update({ hit_count: (Number(cur.hit_count) || 0) + n, last_hit_at: new Date().toISOString() }).eq('id', rid); }
      }
    }
    return { applied: applied, scanned: got.rows.length, rules: rules.length };
  } catch (e) { return { error: (e && e.message) || 'apply failed' }; }
}
