const assert = require('node:assert/strict');
const Module = require('node:module');
require('../node_modules/sucrase/register');
const { readUsStatementText } = require('../src/lib/us-bank-statement-pdf');

function word(str, x, y) { return { str, x, y, w: str.length * 5 }; }
function right(str, edge, y) { return word(str, edge - str.length * 5, y); }
function header(y) {
  return [
    word('Posting Date', 50, y), word('Transaction Description', 115, y),
    right('Other Credits (+)', 439, y), right('Other Debits (-)', 598, y), right('Balance', 749, y)
  ];
}
const first = [
  word('BUSINESS CHECKING 1234567890', 50, 450),
  ...header(400),
  word('06/01/2026', 50, 380), word('Beginning Balance', 115, 380), right('$100.00', 749, 380),
  word('06/03/2026', 50, 365), word('Incoming transfer', 115, 365), right('$25.10', 439, 365),
  word('Reference ABC-123', 115, 354)
];
const second = [
  ...header(410),
  word('06/03/2026', 50, 390), word('Outgoing transfer', 115, 390), right('($8.20)', 598, 390), right('116.90', 749, 390),
  word('06/25/2026', 50, 370), word('Another debit', 115, 370), right('16.90', 598, 370), right('100.00', 749, 370),
  word('Ending Balance:', 50, 350), right('$100.00', 749, 350),
  word('Totals are not transactions', 50, 320)
];

const result = readUsStatementText([[], first, second, []]);
assert.deepEqual(result, {
  rows: [
    { date: '2026-06-03', name: 'Incoming transfer Reference ABC-123', direction: 'in', amount_abs: 25.10 },
    { date: '2026-06-03', name: 'Outgoing transfer', direction: 'out', amount_abs: 8.20 },
    { date: '2026-06-25', name: 'Another debit', direction: 'out', amount_abs: 16.90 }
  ],
  accountMask: '7890', checkedBalances: 2, pages: 4
});
const change = (page, from, to) => page.map(item => item.str === from ? { ...item, str: to } : item);
for (const [pages, error] of [
  [[first, change(second, '116.90', '116.91')], /printed balance/],
  [[first, change(second, '$100.00', '$99.99')], /printed closing balance/],
  [[first, change(second, '06/25/2026', '02/31/2026')], /unreadable date/],
  [[first, second.slice(0, -3)], /closing balance could not be found/],
  [[first, second, second], /more than one account/],
  [[[]], /no readable text/],
  [[[word('An unrelated text PDF', 50, 400)]], /layout is unsupported/]
]) {
  const rejected = readUsStatementText(pages);
  assert.deepEqual(rejected.rows, []);
  assert.match(rejected.error, error);
}

const splitHeader = [
  word('ACCOUNT NUMBER', 380, 500), word('STATEMENT PERIOD', 488, 500),
  word('1234567890', 398, 486), word('01/01/26 - 01/31/26', 495, 486),
  word('BEGINNING BALANCE', 370, 455), right('$100.00', 570, 455),
  word('ENDING BALANCE', 370, 430), right('$70.00', 570, 430),
  word('POSTING', 30, 392), word('DEPOSITS & OTHER', 328, 392), word('WITHDRAWALS &', 419, 392), word('DAILY', 528, 392),
  word('TRANSACTION DESCRIPTION', 142, 387),
  word('DATE', 37, 383), right('CREDITS (+)', 391, 383), right('OTHER DEBITS (-)', 488, 383), right('BALANCE', 560, 383),
  word('01/01/2026', 28, 365), word('BEGINNING BALANCE', 79, 365), right('$100.00', 572, 365),
  word('01/21/2026', 28, 350), word('Electronic debit', 79, 350), right('$20.00', 485, 350),
  word('Ref A', 79, 340), right('80.00', 572, 340),
  word('01/23/2026', 28, 327), word('Transfer out', 79, 327), right('10.00', 485, 327),
  word('Ref B', 79, 317), right('70.00', 572, 317),
  word('NUMBER OF DEPOSITS/CHECKS PAID', 79, 305), word('0', 390, 305), word('0', 477, 305)
];
assert.deepEqual(readUsStatementText([splitHeader, []]), {
  rows: [
    { date: '2026-01-21', name: 'Electronic debit Ref A', direction: 'out', amount_abs: 20 },
    { date: '2026-01-23', name: 'Transfer out Ref B', direction: 'out', amount_abs: 10 }
  ],
  accountMask: '7890', checkedBalances: 2, pages: 2
});
assert.match(readUsStatementText([change(splitHeader, '80.00', '80.01')]).error, /printed balance on 2026-01-21/);
assert.match(readUsStatementText([change(splitHeader, '$70.00', '$70.01')]).error, /printed closing balance/);
assert.match(readUsStatementText([splitHeader.map(item =>
  item.y === 455 && item.str === '$100.00' ? { ...item, str: '$100.01' } : item
)]).error, /printed opening balances disagree/);

function mock(id, exports) {
  const filename = require.resolve(id);
  const entry = new Module(filename, module);
  entry.exports = exports;
  entry.loaded = true;
  require.cache[filename] = entry;
}
const transactions = [];
const audits = [];
const mask = '7890';
function from(table) {
  const chain = {
    select() { return chain; }, eq() { return chain; }, in() { return chain; },
    gte() { return chain; }, lte() { return chain; }, order() { return chain; },
    async range() { return { data: transactions.slice() }; },
    async maybeSingle() {
      return { data: table === 'plaid_accounts'
        ? { name: 'Fixture checking', mask, wave_business_id: 'fixture-books', connection_id: 'conn-1' }
        : { institution_name: 'Fixture Bank' } };
    },
    async upsert(rows) {
      for (const row of rows) {
        assert(!transactions.some(item => item.plaid_transaction_id === row.plaid_transaction_id));
        transactions.push({ ...row, id: transactions.length + 1 });
      }
      return { error: null };
    }
  };
  return chain;
}
mock('@supabase/supabase-js', { createClient: () => ({ from }) });
mock('../src/lib/verified-caller', { verifiedCaller: async () => ({ userId: 'fixture-user' }) });
mock('../src/lib/server-permissions', { assertPermission: async () => ({ ok: true }) });
mock('../src/lib/audit-server', { audit: async (...args) => audits.push(args.at(-1)) });
mock('../src/lib/account-twins-server', { accountTwins: async () => ({}) });
mock('../src/lib/duplicates-server', { autoTwinCheck: async () => null });
mock('../src/lib/wire-auto-match', { autoMatchSentWires: async () => null });

const { POST } = require('../src/app/api/accounting/statement-import/route');
const importRows = async (options = {}) => {
  const request = { action: 'import_rows', target_plaid_account_id: 'fixture-account', rows: result.rows, source_format: 'pdf', statement_account_last4: mask, ...options };
  const response = await POST({ json: async () => request });
  return { status: response.status, body: await response.json() };
};

(async () => {
  assert.equal((await importRows({ statement_account_last4: '1111' })).status, 409);
  assert.equal(transactions.length, 0);
  assert.equal((await importRows()).body.imported, 3);
  assert(transactions.every(row => row.bank_source === '[PDF] Fixture Bank' && row.raw.source === 'pdf_statement_import'));
  assert.equal(audits[0].source_format, 'pdf');
  assert.equal((await importRows()).body.skipped_existing, 3);
  const csvOverlap = await importRows({ source_format: 'csv', rows: [{ ...result.rows[0], name: 'CSV description differs' }] });
  assert.equal(csvOverlap.status, 409);
  assert.match(csvOverlap.body.error, /Possible PDF\/CSV overlap/);
  assert.equal(transactions.length, 3);
  const exactCsv = await importRows({ source_format: 'csv', rows: [result.rows[0]] });
  assert.equal(exactCsv.body.skipped_existing, 1);
  const newCsv = await importRows({ source_format: 'csv', rows: [{ ...result.rows[0], date: '2026-06-28', name: 'New CSV transaction' }] });
  assert.equal(newCsv.body.imported, 1);
  assert.equal(transactions.at(-1).bank_source, '[CSV] Fixture Bank');
  console.log('US PDF parsing and statement-import route checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
