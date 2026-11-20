// v55.83-TU (Max, Nov 17: "there are items that show as pending in All Transactions. it needs to know at the next sync what to do
// with them if they are no longer pending") — after every bank sync:
//   1. a pending line that has now POSTED (Plaid names the pending line it replaces) hands its person-made work (category,
//      verified mark, reviewed status, paid-through company) to the posted line, then the pending copy is filed away —
//      archived and restorable through the duplicates log, never deleted outright;
//   2. a pending line the bank no longer lists at all (cancelled authorisation, or posted under a new reference) is filed away
//      the same way;
//   3. WC retains the original UUID when a confirmed same-money replacement has an existing payment link. Conflicts,
//      changed amounts and closed periods still require review. No new payment is created.
// Codex QA 17 Nov (P1 x2) — (a) if the database steps are not installed, NOTHING is touched (fail closed; was: a plain
// 'duplicate' mark that skipped every guard); (b) the carry-over and the filing-away happen in ONE database step
// (hub_settle_pending, sql/v55-83-TU-pending-settle.sql): refused -> both lines unchanged; approval moves only when it is the
// same money (amount, direction, currency, company) and the posted line has no different category.
// Never throws; never blocks the sync. Var + concat only.

import { storedPendingReplacements, sameMoney } from './pending-repair-server';
export { sameMoney } from './pending-repair-server';

var CARRY = ['classification', 'category_source', 'category_verified', 'category_verified_by', 'category_verified_at', 'third_party_payer'];

function isBlank(v) { return v === null || v === undefined || v === '' || v === false; }

// the fields a person set on the pending line that the posted line does not have yet
// the pure rule the database step follows (kept here for tests and the screen)
export function carryPatch(pend, post) {
  var patch = {};
  if (!pend || !post) { return patch; }
  if (!sameMoney(pend, post)) { return patch; } // approval never moves across changed details
  if (!isBlank(post.classification) && post.classification !== pend.classification) { return patch; }
  CARRY.forEach(function (f) {
    if (!(f in pend) || !(f in post)) { return; }
    if (!isBlank(pend[f]) && isBlank(post[f])) { patch[f] = pend[f]; }
  });
  // reviewed carries over only onto a line nobody has reviewed yet
  if (pend.review_status === 'reviewed' && (!post.review_status || post.review_status === 'unreviewed' || post.review_status === 'new')) { patch.review_status = 'reviewed'; }
  return patch;
}

// rawTxns: what the bank returned this sync; accountIds: this connection's accounts; windowStart: first date fully pulled.
export async function settlePendingLines(db, o) {
  var res = { posted_replaced: 0, carried: 0, dropped: 0, needs_person: 0, needs_sql: false, errors: 0 };
  try {
    var raw = (o && o.rawTxns) || [];
    var t0 = Date.now(); var budget = (o && o.budgetMs) || 6000;
    var returned = {}; raw.forEach(function (t) { if (t && t.transaction_id) { returned[t.transaction_id] = true; } });
    var pairs = {}; // pending id → posted id
    raw.forEach(function (t) { if (t && !t.pending && t.pending_transaction_id) { pairs[t.pending_transaction_id] = t.transaction_id; } });

    // every pending line the Hub still shows for these accounts
    var accts = ((o && o.accountIds) || []).filter(Boolean);
    if (!accts.length) { return res; }
    var pq = await db.from('bank_transactions').select('*').eq('pending', true).in('account_id', accts).limit(2000);
    if (pq.error) { res.errors++; return res; }
    var pendRows = pq.data || [];
    if (pendRows.length >= 2000) { res.incomplete = true; }
    if (!pendRows.length) { return res; }

    var postIds = [];
    pendRows.forEach(function (p) { var to = pairs[p.plaid_transaction_id]; if (to) { postIds.push(to); } });
    var postBy = {};
    if (postIds.length) {
      var sq = await db.from('bank_transactions').select('*').in('plaid_transaction_id', postIds);
      if (sq.error) { res.errors++; return res; }
      ((sq && sq.data) || []).forEach(function (r) { postBy[r.plaid_transaction_id] = r; });
    }

    var storedPairs = await storedPendingReplacements(db, pendRows);
    var MISSING = /hub_reconcile_pending|hub_settle_pending|bank_duplicate_|bank_transaction_duplicates|schema cache|does not exist|PGRST202/i;
    // one guarded database step; a missing step means NOTHING is touched (fail closed) and the sync says which SQL to run
    async function callRpc(name, args) {
      var r = await db.rpc(name, args);
      // Keep the installed TU settlement working during the additive WC rollout.
      // Only a missing WC function permits this fallback; accounting refusals never do.
      if (name === 'hub_reconcile_pending' && r.error &&
          (r.error.code === 'PGRST202' || r.error.code === '42883') &&
          /hub_reconcile_pending/.test(String(r.error.message || ''))) {
        res.needs_sql = true;
        res.sql_hint = 'Linked pending-record repair requires sql/v55-83-WC-pending-identity.sql. Existing guarded TU settlement remains active.';
        r = await db.rpc('hub_settle_pending', args);
      }
      if (r.error) { if (MISSING.test(String(r.error.message || ''))) { res.needs_sql = true; res.sql_hint = 'After approval, install sql/v55-83-SO-duplicates.sql, sql/v55-83-TU-pending-settle.sql, then sql/v55-83-WC-pending-identity.sql.'; } else { res.errors++; } return null; }
      if (r.data && r.data.ok === false) { res.needs_person++; return null; }
      return r.data || { ok: true };
    }
    async function fileAway(pend, keepId, reason) { return !!(await callRpc('bank_duplicate_remove', { p_dup: pend.id, p_keep: keepId, p_actor: null, p_reason: reason })); }

    for (var i = 0; i < pendRows.length; i++) {
      if (Date.now() - t0 > budget) { res.incomplete = true; break; }
      var p = pendRows[i];
      if (returned[p.plaid_transaction_id]) { continue; } // the bank still lists it as pending — leave it
      var stored = (storedPairs[p.plaid_transaction_id] || []).filter(function (r) {
        return r.account_id === p.account_id && r.connection_id === p.connection_id && r.wave_business_id === p.wave_business_id;
      });
      if (stored.length > 1) { res.needs_person++; continue; }
      var postId = pairs[p.plaid_transaction_id] || (stored[0] && stored[0].plaid_transaction_id);
      if (postId) {
        var post = postBy[postId] || stored[0] || null;
        // A replacement reported by the bank must actually exist before we retire its pending record.
        if (!post || post.pending === true || post.review_status === 'duplicate') { res.needs_person++; continue; }
        var same = sameMoney(p, post);
        var sr = await callRpc('hub_reconcile_pending', { p_pending: p.id, p_posted: post ? post.id : null,
          p_reason: 'Pending line has posted' + (post ? '' : ' (its posted line was already on the Hub)') + ' — replaced by posted line ' + postId + (same ? '' : ' (final details differ from the pending hold — nothing carried over)') + '. Kept on file, restorable.' });
        if (sr) { res.posted_replaced++; if (sr.carried && sr.carried.length) { res.carried++; } }
        if (res.needs_sql && !sr) { break; } // successful guarded TU fallback may continue; missing dependencies stop the run
        continue;
      }
      // not returned and not replaced: only judged inside the window this sync pulled completely, and only for an account the
      // bank actually reported in this sync (an account it skipped or errored on says nothing about its pending lines)
      var d = String(p.date || '').substring(0, 10);
      if (!d) { continue; }
      if (o && o.windowStart && d < o.windowStart) { continue; }
      if (o && o.windowEnd && d > o.windowEnd) { continue; }
      if (!o || !o.reportedAccounts || !o.reportedAccounts[p.account_id]) { continue; }
      var ok2 = await fileAway(p, null, 'The bank no longer lists this pending line (the hold was cancelled, or it posted under a new reference). Kept on file, restorable.');
      if (ok2) { res.dropped++; }
      if (res.needs_sql) { break; }
    }
  } catch (e) { res.errors++; }
  return res;
}

// the oldest pending line still on the Hub for these accounts — the sync reaches back to it so it can be settled
export async function oldestPendingDate(db, accountIds, capDays) {
  try {
    var accts = (accountIds || []).filter(Boolean);
    if (!accts.length) { return null; }
    var q = await db.from('bank_transactions').select('date').eq('pending', true).in('account_id', accts).order('date', { ascending: true }).limit(1);
    var d = q && q.data && q.data[0] && q.data[0].date;
    if (!d) { return null; }
    d = String(d).substring(0, 10);
    var floor = new Date(Date.now() - (capDays || 90) * 86400000).toISOString().split('T')[0];
    return d < floor ? floor : d;
  } catch (e) { return null; }
}
