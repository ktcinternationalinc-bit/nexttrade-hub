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
import { PHRASE_MATCH } from './bank-rule-match';
import { readExpensePhraseRule, readRuleModes, writeRuleMode } from './bank-rule-storage';
import { US_WAVE_BUSINESS_ID } from './business-of';
import { autoReviewIfComplete } from './bank-allocation-server'; // v55.83-SW — money sent to a related company is finished when marked
import { audit } from './audit-server';

export async function learnRule(db, txnText, classification, by) {
  try {
    if (!classification || classification === 'needs_clarification') { return { skipped: 'no_classification' }; }
    var key = merchantKey(txnText);
    if (!key) { return { skipped: 'no_merchant_key' }; }
    var ex = await readExpensePhraseRule(db, 'id, classification, source', key);
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
    var ins = await writeRuleMode({ match_text: key, match_mode: PHRASE_MATCH, classification: classification, source: 'learned', auto_apply: true, active: true, created_by: by || null, updated_by: by || null }, function (row) { return db.from('us_expense_rules').insert(row).select('id'); });
    return ins.error ? { skipped: ins.error.message } : { learned: (ins.data && ins.data[0] && ins.data[0].id) || true };
  } catch (e) { return { skipped: (e && e.message) || 'learn failed' }; }
}

// v55.83-PJ (Max): bills get the SAME memory — "categories for bills should be
// a dropdown... remember and categorize later on with new bills automatically
// when imported". Returns the remembered category for a vendor, or null.
export async function suggestCategory(db, text) {
  try {
    if (!text) { return null; }
    var rr = await readRuleModes(function (mode) { return db.from('us_expense_rules').select('id, match_text, classification, active' + mode).eq('active', true).not('classification', 'is', null).limit(1000); });
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
  if (!t.classification) { return t.category_source === 'cleared' ? 'human' : 'blank'; } // v55.83-XU: a person took the category off — not a blank
  if (t.category_source === 'rule') { return t.classification === ruleCls ? 'same' : 'rule'; }
  return t.classification === ruleCls ? 'same' : 'human';
}
async function batchSet(db, ids, cls, mode, outIds) {
  var n = 0;
  for (var i = 0; i < ids.length; i += 200) {
    var chunk = ids.slice(i, i + 200);
    var q = db.from('bank_transactions').update({ classification: cls, category_source: 'rule' }).in('id', chunk)
      .not('category_verified', 'is', true); // a verified row is never touched
    if (mode === 'blank') { q = q.is('classification', null).or('category_source.is.null,category_source.neq.cleared'); } // re-check: never race a person (XU: nor a category a person took off)
    else if (mode === 'rule') { q = q.eq('category_source', 'rule'); }
    var r = await q.select('id');
    if (!r.error && r.data) { n += r.data.length; if (outIds) { r.data.forEach(function (x) { outIds.push(x.id); }); } }
  }
  return n;
}
export async function previewRule(db, matchText, ruleCls, matchMode) {
  var got = await pageBankRows(db, 'id, date, posted_date, amount_abs, direction, name, merchant_name, classification, category_source, category_verified, review_status, account_id, transfer_group_id, pending');
  if (got.error) { return { error: got.error }; }
  var probe = { match_text: matchText, match_mode: matchMode };
  var hits = got.rows.filter(function (t) { return ruleMatches(probe, rowText(t)); });
  var b = { blank: [], rule: [], human: [], verified: [], same: [] };
  hits.forEach(function (t) { b[ruleBucket(t, ruleCls)].push(t); });
  return { scanned: got.rows.length, hits: hits, buckets: b };
}
// v55.83-SW (Max, Nov 16: "select not only expense but if it is RTM or NEXTRADE flag") — a rule can ALSO (or only) mark the
// bank line as money sent to a paid-through company. Same guard rails as a person clicking the 🏢 button, plus: it only ever
// FILLS A BLANK. A line a person already marked, a transfer between our own accounts, a pending line, a duplicate copy and
// money IN are never touched.
export async function partyFlagRows(db, matchText, matchMode) {
  var got = await pageBankRows(db, 'id, date, posted_date, amount_abs, direction, name, merchant_name, third_party_payer, transfer_group_id, review_status',
    function (q) { return q.eq('direction', 'out').is('third_party_payer', null); });
  if (got.error) { return { error: got.error }; }
  var probe = { match_text: matchText, match_mode: matchMode };
  var rows = got.rows.filter(function (t) { return !t.transfer_group_id && t.review_status !== 'duplicate' && ruleMatches(probe, rowText(t)); });
  return { rows: rows };
}
async function partyKind(db, name) {
  try {
    var pr = await db.from('paid_through_parties').select('name, kind, active').eq('active', true);
    var hit = null; ((pr && pr.data) || []).forEach(function (x) { if (String(x.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase()) { hit = x.kind; } });
    if (hit) { return hit; }
  } catch (eK) { /* table missing — fall through */ }
  return /nexttrade/i.test(String(name || '')) ? 'affiliate' : 'service_provider';
}
export async function applyPartyFlag(db, rule, by, competingRules) {
  var payer = String((rule && rule.third_party_payer) || '').trim();
  if (!payer) { return { flagged: 0, ids: [] }; }
  var pf = await partyFlagRows(db, rule.match_text, rule.match_mode);
  if (pf.error) { return { error: pf.error }; }
  var rows = competingRules ? pf.rows.filter(function (t) { return bestRule(competingRules, rowText(t), true) === rule; }) : pf.rows;
  var ids = rows.map(function (t) { return t.id; }); var done = [];
  for (var i = 0; i < ids.length; i += 200) {
    var up = await db.from('bank_transactions').update({ third_party_payer: payer }).in('id', ids.slice(i, i + 200))
      .is('third_party_payer', null).eq('direction', 'out').select('id'); // re-check: never race a person
    if (up.error) { return { error: up.error.message + (/third_party_payer/.test(up.error.message || '') ? ' — run sql/v55-83-QB-rtm-third-party.sql first.' : '') }; }
    (up.data || []).forEach(function (r) { done.push(r.id); });
  }
  if (done.length) {
    var reviewed = 0;
    try { if (by && (await partyKind(db, payer)) === 'affiliate') { reviewed = (await autoReviewIfComplete(db, done, by)).length; } } catch (eR) { /* marking stands; review is a bonus */ }
    try { await audit(db, by || null, 'rule_flagged_paid_through', 'us_expense_rule', rule.id || null, { payer: payer, match_text: rule.match_text, lines: done.length, reviewed: reviewed, bank_transaction_ids: done.slice(0, 200) }); } catch (eA) { /* audit is best-effort here */ }
  }
  return { flagged: done.length, ids: done, candidates: ids.length };
}

export async function applyRuleToAll(db, rule, opts) {
  var o = opts || {};
  var res = { applied: 0, filled_blank: 0, retargeted: 0, overwrote_people: 0, matches: 0, already_right: 0, left_people: 0, verified_untouched: 0, scanned: 0, flagged: 0 };
  if (rule.classification) {
    var pv = await previewRule(db, rule.match_text, rule.classification, rule.match_mode);
    if (pv.error) { return { error: pv.error }; }
    // v55.83-TR (Codex QA 17 Nov) — when a person's single pick spreads to look-alikes, a line in a PRIVATE account, one side of a
    // paired transfer, a pending line and a duplicate copy are never touched (they stay a person's call)
    var keep = function (t) { return true; };
    if (o.lookAlike) {
      var priv = await privateAccountSet(db);
      // Codex QA 17 Nov (recheck P1) — privacy unknown → ZERO look-alike changes (fail closed), with a visible reason
      if (!priv) { return { error: 'Could not check which bank accounts are private, so no look-alike lines were changed. (Your own pick was saved.)', private_unknown: true, applied: 0 }; }
      keep = function (t) { return !t.transfer_group_id && t.pending !== true && t.review_status !== 'duplicate' && !priv[t.account_id]; };
      res.skipped_protected = pv.hits.filter(function (t) { return !keep(t); }).length;
    }
    var ids = function (arr) { return arr.filter(keep).map(function (t) { return t.id; }); };
    res.ids = [];
    var a1 = await batchSet(db, ids(pv.buckets.blank), rule.classification, 'blank', res.ids);
    var a2 = await batchSet(db, ids(pv.buckets.rule), rule.classification, 'rule', res.ids);
    var a3 = o.overwrite_people === true ? await batchSet(db, ids(pv.buckets.human), rule.classification, 'any') : 0;
    // v55.83-WP — what each filled line was BEFORE (its own category and where that came from), so an undo can put back exactly that
    var byIdP = {}; pv.hits.forEach(function (t) { byIdP[t.id] = t; });
    res.before = res.ids.map(function (idP) { var tP = byIdP[idP] || {}; return { id: idP, c: tP.classification || null, s: tP.category_source || null }; });
    res.applied = a1 + a2 + a3; res.filled_blank = a1; res.retargeted = a2; res.overwrote_people = a3; res.matches = pv.hits.length;
    res.already_right = pv.buckets.same.length; res.left_people = o.overwrite_people === true ? 0 : pv.buckets.human.length;
    res.verified_untouched = pv.buckets.verified.length; res.scanned = pv.scanned;
  }
  if (rule.third_party_payer) { // v55.83-SW
    var fl = await applyPartyFlag(db, rule, o.by || null);
    if (fl.error) { if (!rule.classification) { return { error: fl.error }; } res.flag_error = fl.error; }
    else { res.flagged = fl.flagged; if (!rule.classification) { res.matches = fl.candidates; } }
  }
  if (res.applied + res.flagged > 0 && rule.id) {
    await db.from('us_expense_rules').update({ hit_count: (Number(rule.hit_count) || 0) + res.applied + res.flagged, last_hit_at: new Date().toISOString() }).eq('id', rule.id);
  }
  return res;
}

// accounts marked 🔒 private (sql/v55-83-TP-permissions.sql). Codex QA 17 Nov (recheck P1): FAIL CLOSED — a read error, a thrown
// error or the column not existing yet returns null ("unknown"), never "no private accounts".
export async function privateAccountSet(db) {
  try {
    var r = await db.from('plaid_accounts').select('plaid_account_id').eq('is_private', true);
    if (!r || r.error) { return null; }
    var out = {}; (r.data || []).forEach(function (a) { out[a.plaid_account_id] = true; });
    return out;
  } catch (e) { return null; }
}

// v55.83-TR (Max, Nov 17 + Codex QA 17 Nov) — ONE place for "a person categorized a line → the learned rule fills its look-alikes":
// only an ACTIVE rule switched to apply automatically (auto_apply) and for the same category; never "transfer"; protected lines
// skipped (private account, paired transfer, pending, duplicate); and the category's Wave account rides onto the look-alikes it
// updated exactly as on the picked line (only where no Wave account is set and the line was never synced).
export async function applyLookAlikes(db, ruleId, cls, by) {
  var out = { applied: 0, left_people: 0, matches: 0, wave_set: 0, skipped: null, skipped_protected: 0 };
  if (!ruleId || ruleId === true || !cls || cls === 'transfer') { out.skipped = 'not_applicable'; return out; }
  var rr = await readRuleModes(function (mode) { return db.from('us_expense_rules').select('id, match_text, classification, hit_count, active, auto_apply' + mode).eq('id', ruleId).maybeSingle(); });
  if (rr.error || !rr.data) { out.skipped = 'rule_not_found'; return out; }
  if (rr.data.active === false) { out.skipped = 'rule_inactive'; return out; }
  if (rr.data.auto_apply === false) { out.skipped = 'auto_apply_off'; return out; }
  if (rr.data.classification !== cls) { out.skipped = 'rule_other_category'; return out; }
  var ap = await applyRuleToAll(db, rr.data, { overwrite_people: false, by: by, lookAlike: true });
  if (!ap || ap.error) { out.error = (ap && ap.error) || 'not applied'; return out; }
  out.applied = ap.applied || 0; out.left_people = ap.left_people || 0; out.matches = ap.matches || 0; out.skipped_protected = ap.skipped_protected || 0;
  out.ids = ap.ids || []; out.before = ap.before || []; // v55.83-WP — for the undo of a single pick
  if (ap.ids && ap.ids.length) {
    try {
      var wl = await waveAccountForCategory(db, cls);
      if (wl && wl.wave_account_id) {
        out.wave = { id: wl.wave_account_id, name: wl.wave_account_name, rows: [] }; // WP — the lines whose Wave category this fill set, with their status before
        for (var i = 0; i < ap.ids.length; i += 200) {
          var stB = {}; var wb = await db.from('bank_transactions').select('id, category_status').in('id', ap.ids.slice(i, i + 200)).is('wave_account_id', null);
          ((wb && wb.data) || []).forEach(function (x) { stB[x.id] = x.category_status === undefined ? null : x.category_status; });
          var w = await db.from('bank_transactions').update({ wave_account_id: wl.wave_account_id, wave_account_name: wl.wave_account_name, category_status: 'pending_wave_sync' })
            .in('id', ap.ids.slice(i, i + 200)).is('wave_account_id', null).is('wave_transaction_id', null).neq('category_status', 'synced').select('id');
          if (!w.error) { out.wave_set += (w.data || []).length; (w.data || []).forEach(function (x) { out.wave.rows.push({ id: x.id, st: stB[x.id] === undefined ? null : stB[x.id] }); }); }
        }
      }
    } catch (eW) { /* Wave stays empty — never blocks the save */ }
  }
  return out;
}

export async function applyExpenseRules(db, limit) {
  try {
    var rulesRes = await readRuleModes(function (mode) { return db.from('us_expense_rules').select('id, match_text, classification, auto_apply, active, hit_count, third_party_payer' + mode).eq('active', true).eq('auto_apply', true).limit(1000); });
    if (rulesRes.error && /third_party_payer/.test(rulesRes.error.message || '')) { // SW SQL not run yet → exactly as before
      rulesRes = await readRuleModes(function (mode) { return db.from('us_expense_rules').select('id, match_text, classification, auto_apply, active, hit_count' + mode).eq('active', true).eq('auto_apply', true).limit(1000); });
    }
    if (rulesRes.error) { return { error: rulesRes.error.message }; }
    var rules = rulesRes.data || [];
    if (!rules.length) { return { applied: 0, scanned: 0, rules: 0 }; }
    var catRules = rules.filter(function (r) { return !!r.classification; });
    // every row with NO category (any review status, money in and out) — blanks only on the automatic run
    var got = await pageBankRows(db, 'id, name, merchant_name, classification, category_source, category_verified', function (q) { return q.is('classification', null); });
    if (got.error) { return { error: got.error }; }
    var byRule = {};
    got.rows.forEach(function (t) {
      if (t.category_verified === true) { return; }
      if (t.category_source === 'cleared') { return; } // v55.83-XU — a person took this category off: rules never fill it again
      var r = bestRule(catRules, rowText(t));
      if (r) { (byRule[r.id] = byRule[r.id] || []).push(t.id); }
    });
    var applied = 0; var rid;
    for (rid in byRule) {
      if (Object.prototype.hasOwnProperty.call(byRule, rid)) {
        var cur = null;
        for (var k = 0; k < catRules.length; k++) { if (catRules[k].id === rid) { cur = catRules[k]; } }
        var n = await batchSet(db, byRule[rid], cur.classification, 'blank');
        applied += n;
        if (n > 0) { cur.hit_count = (Number(cur.hit_count) || 0) + n; await db.from('us_expense_rules').update({ hit_count: cur.hit_count, last_hit_at: new Date().toISOString() }).eq('id', rid); }
      }
    }
    // Pick the most specific paid-through rule for each line before filling its blank flag.
    var flagRules = rules.filter(function (r) { return !!r.third_party_payer; });
    var flagged = 0;
    for (var f = 0; f < flagRules.length; f++) {
      var fr = await applyPartyFlag(db, flagRules[f], null, flagRules);
      if (!fr.error && fr.flagged > 0) {
        flagged += fr.flagged;
        await db.from('us_expense_rules').update({ hit_count: (Number(flagRules[f].hit_count) || 0) + fr.flagged, last_hit_at: new Date().toISOString() }).eq('id', flagRules[f].id);
      }
    }
    return { applied: applied, flagged: flagged, scanned: got.rows.length, rules: rules.length };
  } catch (e) { return { error: (e && e.message) || 'apply failed' }; }
}

// v55.83-UG (Max, Nov 18: "why does this only work if i click on test? shouldn't it work automatically?") — the rules used to run only
// inside the ClickBooks background job, which stops when its own settings are missing. Now they run by themselves after every bank
// sync and on their own 15-minute timer, and each run is recorded so the rules screen can say when it last ran. Blanks only.
export var RULES_LAST_RUN_KEY = 'expense_rules_last_run';
export async function runRulesAndRecord(db, source) {
  var res = null;
  try { res = await applyExpenseRules(db, 500); } catch (e) { res = { error: (e && e.message) || 'rules failed' }; }
  var rec = { at: new Date().toISOString(), source: source || 'timer', filled: (res && res.applied) || 0, flagged: (res && res.flagged) || 0,
    scanned: (res && res.scanned) || 0, error: (res && res.error) || null };
  // same two shapes as the visibility setting: key/value (jsonb) and the older setting_key/setting_value (text)
  try {
    var up = await db.from('app_settings').upsert({ key: RULES_LAST_RUN_KEY, value: rec, setting_key: RULES_LAST_RUN_KEY, setting_value: JSON.stringify(rec), updated_at: rec.at }, { onConflict: 'key' });
    if (up && up.error && /setting_key|setting_value|column/.test(up.error.message || '')) { await db.from('app_settings').upsert({ key: RULES_LAST_RUN_KEY, value: rec, updated_at: rec.at }, { onConflict: 'key' }); }
  } catch (eS) { /* recording is best-effort */ }
  return Object.assign({}, res || {}, { recorded: rec });
}
export async function readRulesLastRun(db) {
  try {
    var r = await db.from('app_settings').select('*').eq('key', RULES_LAST_RUN_KEY).maybeSingle();
    if (!r || r.error || !r.data) { return null; }
    if (r.data.value && r.data.value.at) { return r.data.value; }
    try { return r.data.setting_value ? JSON.parse(r.data.setting_value) : null; } catch (eJ) { return null; }
  } catch (e) { return null; }
}
