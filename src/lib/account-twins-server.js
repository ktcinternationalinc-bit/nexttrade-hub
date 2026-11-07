// v55.83-QS — "Same real account" resolver (Max, Nov 8 01:00: "add a new
// account such as PNC... it should disregard duplicates.. whether through
// another csv upload or if plaid ever gets to work").
//
// A bank account can exist in the hub more than once: a MANUAL account
// (CSV-only, e.g. "PNC •1234" created before Plaid could connect PNC) and,
// later, the Plaid account for the very same bank account. They are TWINS
// when the last-4 (mask) is equal AND the bank names share their first word
// (so a Chase •6338 is never confused with a PNC •6338). Every dedupe check
// looks across twins, so a transaction is stored once no matter which door
// it came through.
function instTok(x) { var m = String(x || '').toLowerCase().match(/[a-z0-9]+/); return m ? m[0] : ''; }

// Returns { [accountId]: [twinAccountId, ...] } for the given account ids
// (each list includes the account itself). Fail-soft: on any error each
// account is only its own twin — dedupe then works per-account, as before.
export async function accountTwins(db, accountIds) {
  var out = {};
  (accountIds || []).forEach(function (a) { out[a] = [a]; });
  try {
    if (!accountIds || !accountIds.length) { return out; }
    var mine = await db.from('plaid_accounts').select('plaid_account_id, mask, connection_id').in('plaid_account_id', accountIds);
    if (mine.error) { return out; }
    var masks = {};
    (mine.data || []).forEach(function (r) { if (r.mask) { masks[String(r.mask)] = true; } });
    var maskList = Object.keys(masks);
    if (!maskList.length) { return out; }
    var cand = await db.from('plaid_accounts').select('plaid_account_id, mask, connection_id').in('mask', maskList);
    if (cand.error) { return out; }
    var connIds = {};
    (mine.data || []).concat(cand.data || []).forEach(function (r) { if (r.connection_id) { connIds[r.connection_id] = true; } });
    var conns = await db.from('bank_connections').select('id, institution_name').in('id', Object.keys(connIds));
    var instOf = {};
    ((conns && conns.data) || []).forEach(function (c) { instOf[c.id] = instTok(c.institution_name); });
    (mine.data || []).forEach(function (m) {
      if (!m.mask) { return; }
      var tok = instOf[m.connection_id] || '';
      (cand.data || []).forEach(function (c2) {
        if (c2.plaid_account_id === m.plaid_account_id) { return; }
        if (String(c2.mask) !== String(m.mask)) { return; }
        if (!tok || tok !== (instOf[c2.connection_id] || '')) { return; }
        if (out[m.plaid_account_id].indexOf(c2.plaid_account_id) < 0) { out[m.plaid_account_id].push(c2.plaid_account_id); }
      });
    });
  } catch (e) { /* fail-soft */ }
  return out;
}
