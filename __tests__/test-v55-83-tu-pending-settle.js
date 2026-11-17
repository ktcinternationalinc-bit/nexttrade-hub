// ════════════════════════════════════════════════════════════════════════════
// v55.83-TU — Max, Nov 17: "there are items that show as pending in All Transactions. it needs to know at the next sync what to
// do with them if they are no longer pending". Runs the REAL settle step on a small in-memory database:
//   posted → the person's category moves to the posted line, the pending copy is filed away (restorable, not deleted);
//   still pending → left alone; dropped by the bank → filed away; carries a match → left for a person.
// ════════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var S = require(path.join(root, 'src/lib/pending-settle-server.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }

// tiny fake: select/eq/in/order/limit/update + rpc(bank_duplicate_remove) archiving like the real SQL
function fakeDb(rows) {
  var db = { rows: rows, archive: [] };
  function q(table) {
    var f = []; var patch = null; var ord = null; var lim = null;
    var api = {
      select: function () { return api; },
      eq: function (k, v) { f.push(function (r) { return r[k] === v; }); return api; },
      in: function (k, vs) { f.push(function (r) { return vs.indexOf(r[k]) >= 0; }); return api; },
      order: function (k, o) { ord = { k: k, asc: !o || o.ascending !== false }; return api; },
      limit: function (n) { lim = n; return api; },
      update: function (p) { patch = p; return api; },
      then: function (res, rej) {
        var hit = db.rows.filter(function (r) { return f.every(function (fn) { return fn(r); }); });
        if (patch) { hit.forEach(function (r) { Object.assign(r, patch); }); return Promise.resolve({ data: hit, error: null }).then(res, rej); }
        if (ord) { hit = hit.slice().sort(function (a, b) { return (a[ord.k] < b[ord.k] ? -1 : 1) * (ord.asc ? 1 : -1); }); }
        if (lim) { hit = hit.slice(0, lim); }
        return Promise.resolve({ data: hit.map(function (r) { return Object.assign({}, r); }), error: null }).then(res, rej);
      }
    };
    return api;
  }
  db.from = q;
  // mirrors the SQL (the real SQL is run on Postgres in scratchpad pgtest/tu.mjs): guarded archive; settle = archive first,
  // carry only after it succeeded and only per carryPatch's same-money rule
  db.missing = false;
  function archive(id, keep, reason) {
    var d = db.rows.filter(function (r) { return r.id === id; })[0];
    if (!d) { return { ok: false, why: 'gone' }; }
    if (d.matched_invoice_id || d.transfer_group_id) { return { ok: false, why: 'matched', blocked_by: 'invoice match' }; }
    db.archive.push({ id: d.id, kept_id: keep, reason: reason, row: Object.assign({}, d) });
    db.rows = db.rows.filter(function (r) { return r.id !== id; });
    return { ok: true };
  }
  db.rpc = function (name, a) {
    if (db.missing) { return Promise.resolve({ data: null, error: { message: 'Could not find the function public.' + name + ' in the schema cache' } }); }
    if (name === 'bank_duplicate_remove') { return Promise.resolve({ data: archive(a.p_dup, a.p_keep, a.p_reason), error: null }); }
    var pend = db.rows.filter(function (r) { return r.id === a.p_pending; })[0];
    var post = db.rows.filter(function (r) { return r.id === a.p_posted; })[0] || null;
    var patch = S.carryPatch(pend, post);
    var ar = archive(a.p_pending, S.sameMoney(pend, post) ? a.p_posted : null, a.p_reason);
    if (!ar.ok) { return Promise.resolve({ data: ar, error: null }); }
    if (post) { Object.assign(post, patch); }
    return Promise.resolve({ data: { ok: true, carried: Object.keys(patch) }, error: null });
  };
  return db;
}
function row(id, ptid, o) { return Object.assign({ id: id, plaid_transaction_id: ptid, account_id: 'A1', date: '2026-11-10', amount: 50, amount_abs: 50, direction: 'out', pending: false, classification: null, category_source: null, category_verified: false, review_status: 'unreviewed', matched_invoice_id: null, transfer_group_id: null }, o || {}); }

(async function () {
  console.log('TU — pending lines settled at every sync');
  var db = fakeDb([
    row('p1', 'PEND-1', { pending: true, classification: 'fuel', category_source: 'classification', review_status: 'reviewed' }), // posted now
    row('s1', 'POST-1'),                                                                                                          // its posted line (just synced)
    row('p2', 'PEND-2', { pending: true }),                                                                                       // still pending at the bank
    row('p3', 'PEND-3', { pending: true, date: '2026-11-12' }),                                                                   // bank dropped it
    row('p4', 'PEND-4', { pending: true, matched_invoice_id: 'inv9' }),                                                          // dropped but matched → person
    row('p5', 'PEND-5', { pending: true, date: '2026-09-01' }),                                                                   // older than the window → not judged
    row('p6', 'PEND-6', { pending: true, amount: 40, amount_abs: 40 }),                                                           // posted for a different final amount
    row('s6', 'POST-6', { amount: 46, amount_abs: 46 }),
    row('p7', 'PEND-7', { pending: true, account_id: 'A2' }),                                                                     // account the bank did NOT report this sync
    row('p8', 'PEND-8', { pending: true, date: '2026-11-20' })                                                                    // after the window end
  ]);
  var raw = [
    { transaction_id: 'POST-1', pending: false, pending_transaction_id: 'PEND-1', account_id: 'A1' },
    { transaction_id: 'PEND-2', pending: true, account_id: 'A1' },
    { transaction_id: 'POST-6', pending: false, pending_transaction_id: 'PEND-6', account_id: 'A1' }
  ];
  var r = await S.settlePendingLines(db, { rawTxns: raw, accountIds: ['A1', 'A2'], windowStart: '2026-11-01', windowEnd: '2026-11-17', reportedAccounts: { A1: true } });
  var s1 = db.rows.filter(function (x) { return x.id === 's1'; })[0];
  check('posted line takes over the category, its source and the reviewed status a person set on the pending line', s1.classification === 'fuel' && s1.category_source === 'classification' && s1.review_status === 'reviewed', s1);
  check('the pending copy is filed away (archived with the posted line it became), not left showing as pending', !db.rows.some(function (x) { return x.id === 'p1'; }) && db.archive.some(function (a) { return a.id === 'p1' && a.kept_id === 's1'; }), db.archive);
  check('a line the bank still lists as pending is left alone', db.rows.some(function (x) { return x.id === 'p2' && x.pending; }));
  check('a pending line the bank dropped is filed away (restorable), with the reason', db.archive.some(function (a) { return a.id === 'p3' && /no longer lists/.test(a.reason); }));
  check('a dropped pending line that carries a match is NOT filed away — counted for a person', db.rows.some(function (x) { return x.id === 'p4'; }) && r.needs_person === 1, r);
  check('a pending line older than what this sync pulled is not judged', db.rows.some(function (x) { return x.id === 'p5'; }));
  check('posted for a different final amount (tip / hold) → still replaced, filed without claiming the same amount', db.archive.some(function (a) { return a.id === 'p6' && a.kept_id === null && /differ/.test(a.reason); }), db.archive);
  check('an account the bank did not report this sync keeps its pending lines', db.rows.some(function (x) { return x.id === 'p7'; }));
  check('a pending line after the end of the pulled window is not judged', db.rows.some(function (x) { return x.id === 'p8'; }));
  check('the counts add up', r.posted_replaced === 2 && r.dropped === 1 && r.carried === 1, r);
  var od = await S.oldestPendingDate(db, ['A1'], 3650);
  check('the sync reaches back to the oldest line still pending', od === '2026-09-01', od);
  // Codex QA 17 Nov P1 #1 — database step missing → fail closed: a pending line matched to an invoice is NOT marked duplicate
  var db2 = fakeDb([row('m1', 'PEND-M1', { pending: true, matched_invoice_id: 'invoice-1' }), row('m2', 'PEND-M2', { pending: true }), row('m3', 'POST-M3')]);
  db2.missing = true;
  var r2 = await S.settlePendingLines(db2, { rawTxns: [{ transaction_id: 'POST-M3', pending: false, pending_transaction_id: 'PEND-M2', account_id: 'A1' }], accountIds: ['A1'], windowStart: '2026-11-01', windowEnd: '2026-11-17', reportedAccounts: { A1: true } });
  var m1 = db2.rows.filter(function (x) { return x.id === 'm1'; })[0];
  check('SQL missing → nothing touched: the invoice-matched pending line stays pending, not marked duplicate', m1 && m1.pending === true && m1.review_status === 'unreviewed' && db2.rows.length === 3 && db2.archive.length === 0, db2.rows);
  check('SQL missing → the answer says so and names the SQL (dropped=0, needs_sql)', r2.needs_sql === true && r2.dropped === 0 && r2.posted_replaced === 0 && /v55-83-TU-pending-settle\.sql/.test(r2.sql_hint || ''), r2);
  // Codex QA 17 Nov P1 #2 — pending $10 rent verified/reviewed → posted $12 utilities new: nothing carried
  var db3 = fakeDb([row('r1', 'PEND-R1', { pending: true, amount: 10, amount_abs: 10, classification: 'rent', category_verified: true, review_status: 'reviewed' }), row('r2', 'POST-R2', { amount: 12, amount_abs: 12, classification: 'utilities', review_status: 'new' })]);
  await S.settlePendingLines(db3, { rawTxns: [{ transaction_id: 'POST-R2', pending: false, pending_transaction_id: 'PEND-R1', account_id: 'A1' }], accountIds: ['A1'], windowStart: '2026-11-01', windowEnd: '2026-11-17', reportedAccounts: { A1: true } });
  var r2row = db3.rows.filter(function (x) { return x.id === 'r2'; })[0];
  check('changed amount and category → approval NOT carried (utilities stays unverified / new)', r2row.category_verified === false && r2row.review_status === 'new' && r2row.classification === 'utilities', r2row);
  check('carryPatch rule: same money + blank posted → carried; any changed detail → nothing',
    Object.keys(S.carryPatch({ amount_abs: 5, direction: 'out', classification: 'fuel', category_verified: true }, { amount_abs: 5, direction: 'out', classification: null, category_verified: false })).length === 2 &&
    Object.keys(S.carryPatch({ amount_abs: 5, direction: 'out', classification: 'fuel' }, { amount_abs: 5, direction: 'in', classification: null })).length === 0 &&
    Object.keys(S.carryPatch({ amount_abs: 5, direction: 'out', wave_business_id: 'A', classification: 'fuel' }, { amount_abs: 5, direction: 'out', wave_business_id: 'B' })).length === 0);
  var sqlTxt = fs.readFileSync(path.join(root, 'sql/v55-83-TU-pending-settle.sql'), 'utf8');
  check('the database step archives FIRST and carries only after (one transaction), and the module no longer writes review_status itself',
    sqlTxt.indexOf('res := public.bank_duplicate_remove(') < sqlTxt.indexOf('may_carry := same_money') && /HUB_SETTLE_REFUSED/.test(sqlTxt) &&
    !/update\(\{ review_status: 'duplicate' \}\)/.test(fs.readFileSync(path.join(root, 'src/lib/pending-settle-server.js'), 'utf8')));
  var src = fs.readFileSync(path.join(root, 'src/app/api/plaid/transactions/route.js'), 'utf8');
  check('the sync route uses the settle step and no longer hard-deletes pending rows', /settlePendingLines\(supabase, \{ rawTxns: rawTxns/.test(src) && !/\.delete\(\)\.in\('plaid_transaction_id', superseded\)/.test(src) && /if \(oldestPend && oldestPend < effStart\) \{ effStart = oldestPend; \}/.test(src));
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
