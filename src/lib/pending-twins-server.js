import { realAccounts, realKeyOf } from './duplicate-detect';
import { sameMoney } from './pending-repair-server';

function text(row) { return String(row.name || row.merchant_name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function reference(row) {
  var m = String(row.name || '').toUpperCase().match(/\b(?:TRN\s*:|TRANSACTION\s*#\s*:)\s*([A-Z0-9-]{6,})/);
  return m ? m[1] : '';
}
function compatibleWork(p, q) {
  if (p.linked_id || p.matched_invoice_id || p.transfer_group_id || p.category_verified) { return false; }
  return ['classification', 'third_party_payer', 'notes', 'customer_id'].every(function (key) { return !p[key] || p[key] === q[key]; });
}
export function reconnectPlan(p, rows, accounts) {
  var real = realAccounts(accounts); var own = real[p.account_id];
  if (!own || own.key.indexOf('real:') !== 0 || !p.wave_business_id) { return null; }
  var all = (rows || []).filter(function (q) {
    if (q.review_status === 'duplicate' || !sameMoney(p, q) || realKeyOf(q.account_id, real) !== own.key) { return false; }
    var days = Math.abs(Date.parse(q.date) - Date.parse(p.date)) / 86400000;
    if (!Number.isFinite(days)) { return false; }
    var ref = reference(p); var sameRef = ref && ref === reference(q);
    return q.pending === true ? days === 0 && !!text(p) && text(p) === text(q) : days <= 7 && (sameRef || (days <= 2 && !!text(p) && text(p) === text(q)));
  });
  var posted = all.filter(function (q) { return q.pending === false; });
  var keeper = null;
  if (posted.length > 1) { return { status: 'ambiguous', explanation: 'Multiple posted copies could match this old hold. Review the bank statement; none will be removed automatically.' }; }
  if (posted.length === 1) { keeper = posted[0]; }
  if (!keeper) {
    var pending = all.filter(function (q) { return q.pending === true; });
    var perAccount = {};
    pending.forEach(function (q) { perAccount[q.account_id] = (perAccount[q.account_id] || 0) + 1; });
    if (Object.keys(perAccount).some(function (k) { return perAccount[k] > 1; })) { return null; }
    var meta = {}; accounts.forEach(function (a) { meta[a.plaid_account_id] = a; });
    pending.sort(function (a, b) {
      var aa = meta[a.account_id] || {}, bb = meta[b.account_id] || {};
      return Number(bb.connection_status === 'active') - Number(aa.connection_status === 'active') || String(bb.connection_created_at || '').localeCompare(String(aa.connection_created_at || '')) || String(a.id).localeCompare(String(b.id));
    });
    if (pending.length > 1 && pending[0].id !== p.id) { keeper = pending[0]; }
  }
  if (!keeper || keeper.account_id === p.account_id) { return null; }
  if (!compatibleWork(p, keeper)) { return { status: 'saved_work', explanation: 'The old pending copy has saved work. Preserve it and review the two records before cleanup.' }; }
  return { status: 'reconnect_copy', keep_id: keeper.id, posted_id: keeper.pending ? null : keeper.id,
    posted_date: keeper.pending ? null : keeper.posted_date || keeper.date, posted_amount: keeper.amount_abs,
    kept_description: keeper.name || keeper.merchant_name || '', kept_date: keeper.date, kept_pending: keeper.pending === true,
    account_label: own.label, explanation: keeper.pending ? 'Duplicate pending copy from another connection. Keep one pending hold; this does NOT mark it paid.' :
      'Posted copy found on the same bank account through another connection. Keep the posted transaction and its payments; archive only this old pending copy.' };
}

export async function loadReconnectContext(db, pendingRows) {
  if (!pendingRows.length) { return { rows: [], accounts: [] }; }
  var aq = await db.from('plaid_accounts').select('plaid_account_id, name, mask, connection_id');
  var cq = await db.from('bank_connections').select('id, institution_name, status, created_at');
  if (aq.error || cq.error) { throw new Error('Could not verify reconnected bank accounts. Nothing repaired.'); }
  var by = {}; (cq.data || []).forEach(function (c) { by[c.id] = c; });
  var accounts = (aq.data || []).map(function (a) { var c = by[a.connection_id] || {}; return Object.assign({}, a, { institution_name: c.institution_name, connection_status: c.status, connection_created_at: c.created_at }); });
  var real = realAccounts(accounts); var keys = {};
  pendingRows.forEach(function (p) { keys[realKeyOf(p.account_id, real)] = true; });
  var ids = accounts.filter(function (a) { return keys[realKeyOf(a.plaid_account_id, real)]; }).map(function (a) { return a.plaid_account_id; });
  if (!ids.length) { return { rows: pendingRows, accounts: accounts }; }
  var dates = pendingRows.map(function (p) { return Date.parse(p.date); }).filter(Number.isFinite);
  if (!dates.length) { return { rows: pendingRows, accounts: accounts }; }
  var from = new Date(Math.min.apply(null, dates) - 7 * 86400000).toISOString().slice(0, 10);
  var to = new Date(Math.max.apply(null, dates) + 7 * 86400000).toISOString().slice(0, 10);
  var rows = [];
  for (var offset = 0; offset < 20000; offset += 1000) {
    var rq = await db.from('bank_transactions').select('*').in('account_id', ids).gte('date', from).lte('date', to).order('id', { ascending: true }).range(offset, offset + 999);
    if (rq.error) { throw new Error('Could not load reconnect candidates. Nothing repaired.'); }
    rows = rows.concat(rq.data || []);
    if ((rq.data || []).length < 1000) { return { rows: rows, accounts: accounts }; }
  }
  throw new Error('Reconnect history exceeds this preview limit. Nothing repaired.');
}
