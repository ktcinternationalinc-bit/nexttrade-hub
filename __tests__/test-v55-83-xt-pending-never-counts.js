// v55.83-XT — Max 22 Nov: "WE NEED TO IGNORE PENDING TRANSACTIONS UNLESS WE HAVE A WAY TO REMOVE IT WHEN THE FINAL
// TRANSACTION HITS THE ACCOUNT." A pending bank line never counts in a total, never matches, never teaches a rule, never
// goes to Wave. Runs the real guard / totals / age helpers, then checks every reader the audit found carries the rule AND
// imports what it uses (a missing import passes the build but crashes live).
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var G = require(path.join(root, 'src/lib/pending-guard.js'));
var A = require(path.join(root, 'src/lib/pending-age.js'));
var CO = require(path.join(root, 'src/lib/companies.js'));
var FakeDb = require('./fake-supabase').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
function rd(f) { return fs.readFileSync(path.join(root, f), 'utf8'); }

(async function () {
  console.log('XT — the server guard');
  var db = new FakeDb();
  db.t.bank_transactions = [{ id: 'a', pending: true }, { id: 'b', pending: false }, { id: 'c', pending: false }];
  var r = await G.refusePending(db, ['b', 'c']);
  check('posted lines pass', r.ok === true);
  r = await G.refusePending(db, ['b', 'a', null, '']);
  check('a pending line is refused with 409 and named', r.ok === false && r.status === 409 && r.pending_ids.length === 1 && r.pending_ids[0] === 'a', r);
  check('the refusal says it is replaced automatically', /replaces this one automatically/.test(r.error));
  check('no ids: nothing to check', (await G.refusePending(db, [])).ok === true);
  db.fail.bank_transactions = { select: 'boom' };
  r = await G.refusePending(db, ['b']);
  check('cannot read the line: refused (fail closed, 503)', r.ok === false && r.status === 503, r);
  check('notPending drops only pending', G.notPending([{ pending: true }, { pending: false }, {}]).length === 2);

  console.log('XT — company totals skip pending');
  var t = CO.companyTotals([
    { date: '2026-11-01', amount_abs: 100, direction: 'out', company_category: null },
    { date: '2026-11-02', amount_abs: 999, direction: 'out', company_category: null, pending: true },
    { date: '2026-11-03', amount_abs: 50, direction: 'in', company_category: null }], []);
  var tj = JSON.stringify(t);
  check('the 999 pending line is not in any company total', tj.indexOf('999') < 0, t);
  check('the posted 100 and 50 still count', /100/.test(tj) && /50/.test(tj));

  console.log('XT — age flag');
  check('5 days: "Pending, not counted"', A.pendingLabel({ pending: true, date: '2026-11-17' }, '2026-11-22') === 'Pending, not counted');
  check('10 days: not yet flagged', A.isStalePending({ pending: true, date: '2026-11-12' }, '2026-11-22') === false);
  check('11 days: flagged with the day count', A.isStalePending({ pending: true, date: '2026-11-11' }, '2026-11-22') && /Pending 11 days, not counted\. Check with the bank/.test(A.pendingLabel({ pending: true, date: '2026-11-11' }, '2026-11-22')));
  check('a posted line has no pending label', A.pendingLabel({ pending: false, date: '2026-06-01' }, '2026-11-22') === '' && A.pendingAgeDays({ pending: false }) === null);

  console.log('XT — every reader carries the rule');
  var bw = rd('src/app/api/accounting/bank-write/route.js');
  check('bank-write: categorize / match / split / park / update match are guarded', /PENDING_GUARDED = \{ create_unapplied: 1, save_splits: 1, classify: 1, set_wave_category: 1, match_invoice: 1, update_match: 1 \}/.test(bw));
  check('bank-write: reviewed / approved status is guarded', /action === 'set_status' && \(body\.status === 'reviewed' \|\| body\.status === 'approved'\)/.test(bw));
  check('bank-write: the guard runs before any action branch', bw.indexOf('refusePending(db, [body.bank_transaction_id') < bw.indexOf("if (action === 'set_status') {"));
  check('bank-write: unmatch stays open (always undoable)', !/unmatch: 1/.test(bw));
  var er = rd('src/app/api/accounting/expense-rules/route.js');
  check('expense-rules: bulk / single category refused before the update', er.indexOf('refusePending(db, idsB)') > 0 && er.indexOf('refusePending(db, idsB)') < er.indexOf(".update({ classification: clsB, category_source: 'classification' })"));
  check('expense-rules: verify refuses pending', /if \(want && prow\.pending === true\)/.test(er) && /matched_invoice_id, pending'\)\.eq\('id', txid\)/.test(er));
  check('expense-rules: transfer candidates + pairing refuse pending', /refusePending\(db, \[t0\.id\]\)/.test(er) && /refusePending\(db, \[idA, idB\]\)/.test(er));
  check('expense-rules: transfers report skips pending', /not\('transfer_group_id', 'is', null\)\.not\('pending', 'is', true\)/.test(er));
  var cb = rd('src/app/api/accounting/company-books/route.js');
  check('company-books: categorize refuses pending', /some\(function \(l\) \{ return l\.pending === true; \}\)\) \{ return fail\(PENDING_REFUSAL, 409\)/.test(cb));
  check('company-books: "lines this rule would categorize" skips pending', /is\('transfer_group_id', null\)\.not\('pending', 'is', true\)/.test(cb));
  check('company-books: transfer candidates refuse pending', /if \(t0\.pending === true\) \{ return fail\(PENDING_REFUSAL, 409\); \}/.test(cb));
  var bl = rd('src/app/api/accounting/bills/route.js');
  check('bills: advance flag refuses pending (clearing stays open)', /txAv\.data\.pending === true && body\.clear !== true/.test(bl));
  check('bills: deposit match candidates refuse pending', /txDm\.data\.pending === true/.test(bl));
  check('Wave push of a categorized line refuses pending', /bt\.pending === true\) \{ return blocked\(PENDING_REFUSAL, 409\)/.test(rd('src/app/api/wave/push-transaction/route.js')));
  check('Wave push of a payment refuses a pending deposit', /btRes\.data\[0\]\.pending === true\) \{ return blocked\(PENDING_REFUSAL, 409\)/.test(rd('src/app/api/wave/push-payment/route.js')));
  check('Wave payment auto-link never uses a pending line or a marked copy', /t\.pending !== true && t\.review_status !== 'duplicate' && !t\.matched_invoice_id/.test(rd('src/app/api/wave/prefill-payment-links/route.js')));
  check('Wave CSV matching never uses a pending line', /eq\('wave_business_id', waveBusinessId\)\.not\('pending', 'is', true\)/.test(rd('src/app/api/wave/import-transaction-csv/route.js')));
  check('auto "reviewed" never marks a pending line', /eq\('review_status', 'unreviewed'\)\.not\('pending', 'is', true\)/.test(rd('src/lib/bank-allocation-server.js')));
  check('Wave Sync Center never queues a pending line', /if \(bt\.pending === true\) \{ return; \}/.test(rd('src/components/WaveSyncCenter.jsx')));
  var bt = rd('src/components/BankTab.jsx');
  check('Bank tab totals and counts skip pending and marked copies', /countedTxns = scopedTxns\.filter\(t => t\.pending !== true && t\.review_status !== 'duplicate'\)/.test(bt) && !/scopedTxns\.filter\(t => t\.amount < 0\)/.test(bt));
  check('dashboard "unreviewed bank" count skips pending', /t\.pending !== true && \(t\.review_status \|\| 'unreviewed'\) === 'unreviewed'/.test(rd('src/components/AccountingDashboard.jsx')));
  var at = rd('src/components/AllTransactionsTab.jsx');
  check('All Transactions: pending rows cannot be selected or summed', /disabled=\{t\.pending === true\}/.test(at) && /sel\[t\.id\] && t\.pending !== true\) \{ sumSel/.test(at) && /pickable = rows\.filter/.test(at));

  console.log('XT — every file imports what it uses');
  var uses = [
    ['src/app/api/accounting/bank-write/route.js', ['refusePending']],
    ['src/app/api/accounting/expense-rules/route.js', ['refusePending', 'PENDING_REFUSAL']],
    ['src/app/api/accounting/company-books/route.js', ['PENDING_REFUSAL']],
    ['src/app/api/accounting/bills/route.js', ['PENDING_REFUSAL']],
    ['src/app/api/wave/push-transaction/route.js', ['PENDING_REFUSAL']],
    ['src/app/api/wave/push-payment/route.js', ['PENDING_REFUSAL']],
    ['src/components/AllTransactionsTab.jsx', ['isStalePending', 'pendingLabel']],
    ['src/components/BankReviewTab.jsx', ['isStalePending', 'pendingLabel']],
    ['src/components/CompanyBooksTab.jsx', ['isStalePending', 'pendingLabel']],
    ['src/components/PendingBankRepair.jsx', ['isStalePending', 'pendingLabel']],
    ['src/lib/pending-settle-server.js', ['archivedReplacements', 'findLiveCopy', 'pendingWorkBlock']]];
  uses.forEach(function (u) {
    var s = rd(u[0]);
    var imp = (s.match(/^import[^\n]*$/gm) || []).join('\n');
    u[1].forEach(function (name) { check(u[0].split('/').pop() + ' imports ' + name, new RegExp('\\b' + name + '\\b').test(imp)); });
  });
  check('server routes import the server-safe guard (no "use client" in it)', [ 'src/lib/pending-guard.js', 'src/lib/pending-final-copy.js', 'src/lib/pending-age.js' ].every(function (f) { return !/^\s*['"]use client['"]/m.test(rd(f)); }));

  console.log('\n' + pass + ' XT never-counts checks passed' + (failN ? ', ' + failN + ' FAILED' : ''));
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
