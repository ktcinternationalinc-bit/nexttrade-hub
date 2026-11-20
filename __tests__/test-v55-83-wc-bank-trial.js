const assert = require('assert/strict');
require('sucrase/register');
const { matchesTransaction: matches, searchFragments } = require('../src/lib/transaction-search');
const { dedupeImportedRows: dedupe } = require('../src/lib/bank-import-dedupe');
const { settlementWarning, visibleSyncWarning } = require('../src/lib/bank-sync-health');
const { settlePendingLines } = require('../src/lib/pending-settle-server');
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const transfer = { who: 'Online Transfer to CHK', account: 'Checking 6338', date: '2026-11-17', amount: 1250, direction: 'out' };
const fee = { ...transfer, who: 'NSF - fee' };
check('Partial NSF includes transfer, as requested substring behavior', () => assert(matches(transfer, 'nsf', false)));
check('Whole-word NSF excludes transfer', () => assert(!matches(transfer, 'nsf', true)));
check('Whole-word NSF finds an NSF fee', () => assert(matches(fee, ' NSF ', true)));
check('Case-insensitive partial name', () => assert(matches(transfer, 'TrAnS', false)));
check('All query terms required in any order', () => assert(matches(fee, 'fee nsf', true) && !matches(fee, 'fee missing', true)));
check('Full hidden description searched', () => assert(matches({ ...transfer, who_full: 'NSF returned item' }, 'nsf', true)));
check('Amount formats retained', () => ['$1,250.00', '1,250', '1250'].forEach(q => assert(matches(fee, q, false))));
check('Date formats retained', () => ['2026-11-17', '11/17/2026', '11/17'].forEach(q => assert(matches(fee, q, false))));
check('Account and category searchable', () => assert(matches({ ...fee, classification: 'fee' }, '6338 service', false, { fee: 'Service charges' })));
check('Empty search returns all rows', () => assert(matches(fee, ' ', true)));
check('Literal regex symbols do not expand search', () => assert(!matches(fee, '.*', true)));
check('Whole words respect non-ASCII letters', () => assert(!matches({ who: 'NSFé' }, 'NSF', true)));
check('Partial highlights precisely what matched', () => assert.deepEqual(searchFragments('Transfer', 'nsf', false), [{ text: 'Tra', match: false }, { text: 'nsf', match: true }, { text: 'er', match: false } ]));
check('Whole words do not highlight transfer', () => assert(searchFragments('Transfer', 'nsf', true).every(p => !p.match)));
check('Highlighting preserves text including HTML', () => assert.equal(searchFragments('<script>NSF</script>', 'NSF', true).map(p => p.text).join(''), '<script>NSF</script>'));
const bank = { account_id: 'new', date: '2026-11-17', amount_abs: 8000, direction: 'in', plaid_transaction_id: 'posted', pending: false };
const old = { ...bank, account_id: 'old', plaid_transaction_id: 'old-id' };
check('Old pending cannot suppress posted transaction', () => assert.equal(dedupe([bank], [{ ...old, pending: true }], { old: 'new' }).rows.length, 1));
check('Archived duplicate cannot suppress posted transaction', () => assert.equal(dedupe([bank], [{ ...old, review_status: 'duplicate' }], { old: 'new' }).rows.length, 1));
check('Existing same ID always gets updated from bank', () => assert.equal(dedupe([bank], [old], { old: 'new' }, { posted: true }).rows.length, 1));
check('Bank replacement reference always reaches settlement', () => assert.equal(dedupe([{ ...bank, pending_transaction_id: 'hold' }], [old], { old: 'new' }).rows.length, 1));
check('Ordinary imported posted copy still deduplicates', () => assert.equal(dedupe([bank], [old], { old: 'new' }).skipped, 1));
check('Counted slots preserve second legitimate equal payment', () => assert.equal(dedupe([bank, { ...bank, plaid_transaction_id: 'other' }], [old], { old: 'new' }).rows.length, 1));
check('Different accounts and directions never consume slot', () => assert.equal(dedupe([bank], [{ ...old, direction: 'out' }], { old: 'new' }).skipped, 0));
check('Healthy settlement no warning', () => assert.equal(settlementWarning({}), null));
check('Errors, missing SQL, incomplete pass and protected links are actionable', () => [null, { errors: 1 }, { needs_sql: true }, { incomplete: true }, { needs_person: 1 }].forEach(r => assert(settlementWarning(r))));

async function main() {
  const pending = { id: 'hold', plaid_transaction_id: 'hold-bank', pending: true, account_id: 'a', date: '2026-11-17' };
  const options = { rawTxns: [{ transaction_id: 'posted-bank', pending_transaction_id: 'hold-bank', pending: false }], accountIds: ['a'], windowStart: '2026-11-01', windowEnd: '2026-11-20', reportedAccounts: { a: true } };
  function dbWith(result) {
    let calls = 0;
    return { rpc() { throw new Error('Must not archive without a valid posted row'); }, from() {
      const reply = calls++ === 0 ? { data: [pending] } : result;
      const q = { select() { return q; }, eq() { return q; }, in() { return q; }, limit() { return Promise.resolve(reply); }, then(resolve, reject) { return Promise.resolve(reply).then(resolve, reject); } }; return q;
    } };
  }
  let r = await settlePendingLines(dbWith({ data: [], error: { message: 'read failed' } }), options);
  check('Failed posted lookup never retires pending', () => assert.equal(r.errors, 1));
  r = await settlePendingLines(dbWith({ data: [] }), options);
  check('Missing posted row requires review; never archives as cancelled', () => assert.equal(r.needs_person, 1));
  r = await settlePendingLines(dbWith({ data: [{ plaid_transaction_id: 'posted-bank', pending: true }] }), options);
  check('Replacement still pending is not a valid survivor', () => assert.equal(r.needs_person, 1));
  let requests = [];
  const db = { from(table) { return { select(cols) { return { in(key, ids) { requests.push({ table, cols, key, ids }); return Promise.resolve({ data: table === 'plaid_accounts' ? [{ connection_id: 'allowed' }] : [{ last_sync_status: 'partial' }] }); } }; } }; } };
  const warning = await visibleSyncWarning(db, [{ account_id: 'visible' }]);
  check('Visible account receives partial-sync warning', () => assert(warning));
  check('Warning lookup restricted to authorized row account IDs', () => assert.deepEqual(requests[0].ids, ['visible']));
  check('Warning query never selects balances or tokens', () => assert.equal(requests[1].cols, 'last_sync_status'));
  requests = [];
  await visibleSyncWarning(db, []);
  check('No visible rows means no connection query', () => assert.equal(requests.length, 0));
  console.log(passed + ' passed, 0 failed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
