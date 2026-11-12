// v55.83-SH — Max, Nov 12 10:30: "the sync is NOT working. figure it out. and also it should give me an option only to sync from
//  last date if i reconnect ... (last previous transaction) .. not bring all of it again if i reconnect"
// A reconnected bank is a NEW Plaid link with new account ids; its first sync used to pull the whole history window again
// (thousands of lines, many Plaid pages) — the pull ran out of time, nothing was saved, and every later click repeated it.
// Now a link that has never finished a sync starts from the NEWEST transaction the Hub already shows for the same real
// accounts (same bank + same last-4, on links that are not archived). Var + concat only.
import { accountTwins } from './account-twins-server';

// → { date: 'YYYY-MM-DD' | null, others: [account ids of the SAME real accounts on OTHER live links] }
export async function hubNewestForConnection(db, conn) {
  var out = { date: null, others: [] };
  try {
    var pa = await db.from('plaid_accounts').select('plaid_account_id').eq('connection_id', conn.id);
    var own = ((pa && pa.data) || []).map(function (a) { return a.plaid_account_id; }).filter(Boolean);
    if (!own.length) { return out; }
    var tw = await accountTwins(db, own);
    var all = {}; own.forEach(function (a) { (tw[a] || []).forEach(function (t) { if (own.indexOf(t) < 0) { all[t] = true; } }); });
    var ids = Object.keys(all);
    if (!ids.length) { return out; }
    // only accounts whose link is still live (an archived duplicate link's rows are not shown on the Hub)
    var pr = await db.from('plaid_accounts').select('plaid_account_id, connection_id').in('plaid_account_id', ids);
    var cids = {}; ((pr && pr.data) || []).forEach(function (r) { if (r.connection_id) { cids[r.connection_id] = true; } });
    var live = {};
    if (Object.keys(cids).length) {
      var cr = await db.from('bank_connections').select('id, status').in('id', Object.keys(cids));
      ((cr && cr.data) || []).forEach(function (c) { if (c.status !== 'archived') { live[c.id] = true; } });
    }
    out.others = ((pr && pr.data) || []).filter(function (r) { return live[r.connection_id]; }).map(function (r) { return r.plaid_account_id; });
    if (!out.others.length) { return out; }
    var nq = await db.from('bank_transactions').select('date').in('account_id', out.others).order('date', { ascending: false }).limit(1);
    var d = nq && nq.data && nq.data[0] && nq.data[0].date;
    out.date = d ? String(d).substring(0, 10) : null;
  } catch (e) { /* fail-soft: no continue point → the normal first pull */ }
  return out;
}
