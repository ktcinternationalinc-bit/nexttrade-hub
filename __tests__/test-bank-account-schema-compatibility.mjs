import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const read = path => fs.readFile(new URL(path, import.meta.url), 'utf8');
const source = await read('../src/lib/bank-visibility.js');
const { PLAID_ACCOUNT_METADATA_COLUMNS } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

// Exact columns observed by the read-only schema preflight. The deployment must
// work without optional assignment-audit columns or an unrelated schema change.
const existingColumns = new Set([
  'id', 'connection_id', 'business_id', 'plaid_account_id', 'name', 'official_name',
  'mask', 'type', 'subtype', 'iso_currency', 'current_balance', 'available_balance',
  'is_read_only', 'updated_at', 'wave_business_id',
]);

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function accountSelects(code) {
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
  const constants = new Map(), selects = [];
  walk(ast, node => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init?.type === 'StringLiteral') constants.set(node.id.name, node.init.value);
  });
  walk(ast, node => {
    if (node.type !== 'CallExpression' || node.callee?.property?.name !== 'select') return;
    const from = node.callee.object;
    if (from?.type !== 'CallExpression' || from.callee?.property?.name !== 'from' || from.arguments[0]?.value !== 'plaid_accounts') return;
    const argument = node.arguments[0];
    const columns = argument?.type === 'StringLiteral' ? argument.value : constants.get(argument?.name);
    assert.equal(typeof columns, 'string', 'account selector must resolve to explicit metadata fields');
    selects.push(columns);
  });
  return selects;
}

const projections = [{ name: 'Server metadata projection', columns: PLAID_ACCOUNT_METADATA_COLUMNS }];
for (const name of ['BankTab', 'BankReviewTab']) {
  const selects = accountSelects(await read('../src/components/' + name + '.jsx'));
  assert.equal(selects.length, 1, name + ' must have one explicit account metadata read');
  projections.push({ name, columns: selects[0] });
}

for (const projection of projections) {
  const columns = projection.columns.split(',').map(value => value.trim());
  for (const column of columns) assert.ok(existingColumns.has(column), projection.name + ' requests missing column ' + column);
  for (const key of ['plaid_account_id', 'connection_id', 'name', 'mask', 'wave_business_id']) assert.ok(columns.includes(key), projection.name + ' needs ' + key + ' for account labels, matching and silo assignment');
  for (const key of ['current_balance', 'available_balance', 'access_token', 'sync_cursor']) assert.equal(columns.includes(key), false, projection.name + ' must not fetch ' + key);
  assert.equal(projection.columns, PLAID_ACCOUNT_METADATA_COLUMNS, projection.name + ' must agree with the server metadata contract');
  console.log('PASS ' + projection.name + ' is compatible with the observed account schema and omits balances/tokens.');
}
console.log('All 3 bank account projections are schema-compatible. Operational account and silo identifiers are preserved.');
