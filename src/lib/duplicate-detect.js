// v55.83-SO — Duplicate bank lines: detection (pure, no database).
// Max, Nov 15 2026: "Check existing transactions and new imports using amount, currency, date, account,
//   reference, counterparty, and source identifiers. Distinguish likely duplicates from legitimate recurring
//   payments and the two sides of a transfer."
//
// Nothing here removes anything. It only proposes groups for a person to look at side by side.
// Money is never matched loosely: every candidate pair has the SAME amount to the cent, the same
// direction, the same currency and the same real bank account. What differs between the three
// confidence levels is the other evidence (date gap, description, check number, which connection).

var DAY = 86400000;

// where a bank line came from (Codex QA 17 Nov: hand entries were labelled "Bank feed")
export function isHandId(id) { return /^manual-hand-/.test(String(id || '')); }
export function isFeedId(id) { return !!id && !/^manual-/.test(String(id)); }
export function sourceLabel(id) { if (isHandId(id)) { return 'Entered by hand'; } if (/^manual-/.test(String(id || ''))) { return 'Uploaded statement'; } return id ? 'Bank feed' : 'Uploaded or typed in'; }

export function dupText(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80); }
export function dupCents(t) {
  var v = t && t.amount_abs != null ? Number(t.amount_abs) : Math.abs(Number(t && t.amount) || 0);
  return Math.round((Number(v) || 0) * 100);
}
export function dupDate(t) { return String((t && (t.posted_date || t.date)) || '').substring(0, 10); }
export function pairKey(a, b) { return String(a) < String(b) ? a + '|' + b : b + '|' + a; }
function bankTok(x) { var m = String(x || '').toLowerCase().match(/[a-z0-9]+/); return m ? m[0] : ''; }

// accounts: [{ plaid_account_id, name, mask, connection_id, institution_name, connection_status }]
// The same real bank account can be in the Hub twice (a reconnected bank is a new link with new
// account ids). Two Hub accounts are the same real account when the bank's first word and the
// last four digits are equal.
export function realAccounts(accounts) {
  var out = {};
  (accounts || []).forEach(function (a) {
    if (!a || !a.plaid_account_id) { return; }
    var tok = bankTok(a.institution_name);
    var key = a.mask && tok ? ('real:' + tok + ':' + String(a.mask)) : ('acct:' + a.plaid_account_id);
    out[a.plaid_account_id] = {
      key: key,
      label: (a.name || 'Account') + (a.mask ? ' •' + a.mask : ''),
      bank: a.institution_name || '',
      link: a.connection_id || '',
      archived: a.connection_status === 'archived',
    };
  });
  return out;
}
export function realKeyOf(accountId, real) { return (real && real[accountId] && real[accountId].key) || ('acct:' + String(accountId || '')); }

var RANK = { same_line: 3, likely: 2, possible: 1 };
export var DUP_KIND_LABEL = {
  same_line: 'Same bank line, brought in twice',
  likely: 'Likely duplicate',
  possible: 'Possible duplicate — check the statement',
};

// Two rows already known to share amount, direction, currency and real account.
// → { kind, why } | { recurring: true } | null
export function assessPair(a, b) {
  var da = Date.parse(dupDate(a) + 'T00:00:00Z'), db = Date.parse(dupDate(b) + 'T00:00:00Z');
  if (isNaN(da) || isNaN(db)) { return null; }
  var gap = Math.abs(Math.round((da - db) / DAY));
  var ca = dupText(a.check_number), cb = dupText(b.check_number);
  if (ca && cb && ca !== cb) { return null; } // two different cheques are two payments
  var sameCheck = !!ca && ca === cb;
  var ta = dupText(a.name || a.merchant_name), tb = dupText(b.name || b.merchant_name);
  var sameText = !!ta && ta === tb;
  var sameLink = String(a.account_id || '') === String(b.account_id || '');
  // v55.83-TQ (Codex QA 17 Nov) — a line typed in by hand ('manual-hand-…') or uploaded ('manual-…') is NOT a bank-feed line
  var bothFeed = isFeedId(a.plaid_transaction_id) && isFeedId(b.plaid_transaction_id);
  var oneByHand = isHandId(a.plaid_transaction_id) !== isHandId(b.plaid_transaction_id);

  if (!sameLink) {
    // the same real account reached through two connections (or a feed and an uploaded statement)
    if (sameCheck && gap <= 5) { return { kind: 'same_line', why: 'Same cheque number, same account, same amount — it came in through two connections.' }; }
    if (sameText && gap <= 1) { return { kind: 'same_line', why: 'Same account, same amount, same description, ' + (gap === 0 ? 'same day' : 'one day apart') + ' — it came in through two connections of this account.' }; }
    if (gap <= 3) { return { kind: 'possible', why: 'Same account and amount ' + (gap === 0 ? 'on the same day' : gap + ' day' + (gap === 1 ? '' : 's') + ' apart') + ' through two connections, but the descriptions differ.' }; }
    return null;
  }
  // one connection
  if (sameCheck && gap <= 5) { return { kind: 'likely', why: 'Same cheque number and amount on the same account.' }; }
  if (sameText && gap <= 1) {
    if (bothFeed) { return { kind: 'possible', why: 'The bank feed lists these as two separate lines on the same connection. Two identical payments on one day do happen — check the bank statement before removing one.' }; }
    return { kind: 'likely', why: 'Same account, amount and description ' + (gap === 0 ? 'on the same day' : 'one day apart') + ', and at least one was typed in or uploaded — it looks like it was brought in twice.' };
  }
  if (sameText && gap >= 5) { return { recurring: true }; }
  // a line ENTERED BY HAND and the bank's own copy: the descriptions usually differ, so same account + amount + in/out within
  // 3 days is shown for a person to check. Only ever "possible" — never removed automatically (two real payments can match).
  // the explanation names the REAL sources (Codex 20:45: a hand entry next to an uploaded statement line is not "the bank's copy")
  if (oneByHand && gap <= 3) {
    var other = isHandId(a.plaid_transaction_id) ? b.plaid_transaction_id : a.plaid_transaction_id;
    var when = gap === 0 ? 'on the same day' : gap + ' day' + (gap === 1 ? '' : 's') + ' apart';
    var src = sourceLabel(other).toLowerCase();
    return { kind: 'possible', why: 'One line was entered by hand and the other is from the ' + (isFeedId(other) ? 'bank feed' : src) + ', same account and amount ' + when + ', different descriptions — ' + (isFeedId(other) ? 'possibly the bank\'s copy of the hand entry' : 'possibly the same transaction recorded twice') + '. Check before removing one.' };
  }
  return null;
}

// rows: active bank lines. opts: { real, dismissed: {pairKey:true}, protectedIds: {id:true}, onlyIds: {id:true} }
// → { groups: [{ kind, label, why[], rows[], suggest_keep_id }], stats: { scanned, recurring, transfer_sides } }
export function findDuplicates(rows, opts) {
  opts = opts || {};
  var real = opts.real || {}, dismissed = opts.dismissed || {}, prot = opts.protectedIds || {};
  var live = (rows || []).filter(function (t) {
    return t && t.id && t.pending !== true && (t.direction === 'in' || t.direction === 'out') && dupCents(t) > 0 && dupDate(t) && t.review_status !== 'duplicate';
  });
  var buckets = {};
  live.forEach(function (t) {
    var k = String(t.wave_business_id || '') + '|' + realKeyOf(t.account_id, real) + '|' + t.direction + '|' + String(t.iso_currency || 'USD') + '|' + dupCents(t);
    (buckets[k] = buckets[k] || []).push(t);
  });
  var parent = {}, pairInfo = {}, recurring = 0;
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  Object.keys(buckets).forEach(function (k) {
    var b = buckets[k];
    if (b.length < 2) { return; }
    b.sort(function (x, y) { return dupDate(x) < dupDate(y) ? -1 : dupDate(x) > dupDate(y) ? 1 : 0; });
    for (var i = 0; i < b.length; i++) {
      for (var j = i + 1; j < b.length; j++) {
        if ((Date.parse(dupDate(b[j])) - Date.parse(dupDate(b[i]))) / DAY > 40) { break; }
        var r = assessPair(b[i], b[j]);
        if (!r) { continue; }
        if (r.recurring) { recurring++; continue; }
        var pk = pairKey(b[i].id, b[j].id);
        if (dismissed[pk]) { continue; }
        pairInfo[pk] = r;
        if (parent[b[i].id] === undefined) { parent[b[i].id] = b[i].id; }
        if (parent[b[j].id] === undefined) { parent[b[j].id] = b[j].id; }
        parent[find(b[i].id)] = find(b[j].id);
      }
    }
  });
  var byId = {}; live.forEach(function (t) { byId[t.id] = t; });
  var clusters = {};
  Object.keys(parent).forEach(function (id) { var root = find(id); (clusters[root] = clusters[root] || []).push(byId[id]); });
  function score(t) {
    var s = 0;
    if (prot[t.id]) { s += 1000; }
    if (t.review_status === 'approved') { s += 500; } else if (t.review_status === 'reviewed') { s += 350; }
    if (t.matched_invoice_id || t.linked_id || t.transfer_group_id) { s += 250; }
    if (t.category_verified === true) { s += 60; }
    if (t.classification) { s += 50; }
    if (!(real[t.account_id] && real[t.account_id].archived)) { s += 30; }
    return s;
  }
  var groups = [];
  Object.keys(clusters).forEach(function (root) {
    var rs = clusters[root];
    if (!rs || rs.length < 2) { return; }
    if (opts.onlyIds && !rs.some(function (t) { return opts.onlyIds[t.id]; })) { return; }
    var kind = 'possible', why = [];
    for (var i = 0; i < rs.length; i++) {
      for (var j = i + 1; j < rs.length; j++) {
        var p = pairInfo[pairKey(rs[i].id, rs[j].id)];
        if (!p) { continue; }
        if (RANK[p.kind] > RANK[kind]) { kind = p.kind; }
        if (why.indexOf(p.why) < 0) { why.push(p.why); }
      }
    }
    var sorted = rs.slice().sort(function (x, y) {
      var d = score(y) - score(x);
      if (d !== 0) { return d; }
      return String(x.created_at || '').localeCompare(String(y.created_at || '')); // tie: the one the Hub has had longest
    });
    groups.push({
      kind: kind, label: DUP_KIND_LABEL[kind], why: why,
      amount: dupCents(rs[0]) / 100, direction: rs[0].direction, currency: rs[0].iso_currency || 'USD',
      suggest_keep_id: sorted[0].id,
      rows: sorted.map(function (t) {
        var ra = real[t.account_id] || {};
        return {
          id: t.id, date: dupDate(t), account: ra.label || 'Account', bank: ra.bank || '', link: ra.link || '', link_archived: ra.archived === true,
          description: t.name || t.merchant_name || '', counterparty: t.merchant_name || '', check_number: t.check_number || '',
          amount: dupCents(t) / 100, direction: t.direction, currency: t.iso_currency || 'USD',
          source: sourceLabel(t.plaid_transaction_id), source_id: t.plaid_transaction_id ? String(t.plaid_transaction_id).slice(-8) : '',
          category: t.classification || '', review_status: t.review_status || 'unreviewed', verified: t.category_verified === true,
          matched_invoice: !!t.matched_invoice_id, transfer: !!t.transfer_group_id, protected: !!prot[t.id], created_at: t.created_at || '',
        };
      }),
    });
  });
  groups.sort(function (x, y) { return (RANK[y.kind] - RANK[x.kind]) || (y.amount - x.amount); });

  // The two sides of a transfer: same amount, opposite direction, DIFFERENT real accounts, within a
  // week. These are never duplicates; they are only counted so the screen can say they were left alone.
  var tb = {}, sides = 0;
  live.forEach(function (t) {
    var k = String(t.wave_business_id || '') + '|' + String(t.iso_currency || 'USD') + '|' + dupCents(t);
    (tb[k] = tb[k] || []).push(t);
  });
  Object.keys(tb).forEach(function (k) {
    var b = tb[k], outs = b.filter(function (t) { return t.direction === 'out'; }), ins = b.filter(function (t) { return t.direction === 'in'; });
    if (!outs.length || !ins.length) { return; }
    var used = {};
    outs.forEach(function (o) {
      for (var i = 0; i < ins.length; i++) {
        if (used[ins[i].id]) { continue; }
        if (realKeyOf(o.account_id, real) === realKeyOf(ins[i].account_id, real)) { continue; }
        if (Math.abs((Date.parse(dupDate(o)) - Date.parse(dupDate(ins[i]))) / DAY) > 7) { continue; }
        used[ins[i].id] = true; sides++; break;
      }
    });
  });
  return { groups: groups, stats: { scanned: live.length, recurring: recurring, transfer_sides: sides } };
}

// v55.83-SU (Max, Nov 15: "if bank linked twice it should know and prevent duplicates") — which duplicate groups are safe
// to clear WITHOUT a person: only the same bank line that arrived through two connections of the same account.
// Deliberately narrow (money is never matched loosely):
//   · the check itself calls it "same bank line brought in twice" (same real account, amount, direction, currency, text);
//   · exactly TWO copies — three or more could be real repeated payments seen on both connections: a person decides;
//   · the two copies sit on two different connections (account ids) of that one account;
//   · same day (or the same cheque number);
//   · the copy to remove carries no work: not protected, not reviewed/approved, not verified, no invoice, no transfer.
// rowsById: the raw bank rows (for the account id). → [{ remove_id, keep_id, amount, date }]
export function twinAutoPicks(groups, rowsById) {
  var out = [];
  (groups || []).forEach(function (g) {
    if (!g || g.kind !== 'same_line' || !g.rows || g.rows.length !== 2) { return; }
    var keep = g.rows[0].id === g.suggest_keep_id ? g.rows[0] : g.rows[1];
    var dup = g.rows[0].id === g.suggest_keep_id ? g.rows[1] : g.rows[0];
    if (keep.id !== g.suggest_keep_id || keep.id === dup.id) { return; }
    var ka = (rowsById[keep.id] || {}).account_id, da = (rowsById[dup.id] || {}).account_id;
    if (!ka || !da || String(ka) === String(da)) { return; }
    var sameDay = keep.date && keep.date === dup.date;
    var sameCheque = keep.check_number && String(keep.check_number) === String(dup.check_number);
    if (!sameDay && !sameCheque) { return; }
    if (dup.protected || dup.verified || dup.matched_invoice || dup.transfer) { return; }
    if (dup.review_status && dup.review_status !== 'unreviewed') { return; }
    out.push({ remove_id: dup.id, keep_id: keep.id, amount: g.amount, date: dup.date });
  });
  return out;
}
