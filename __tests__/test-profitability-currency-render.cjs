// Run with node. Exercises the real component's formatters, including redacted values.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const file = 'src/components/ProfitabilityTab.jsx';
const source = process.env.TEST_SOURCE_REF
  ? execFileSync('git', ['show', process.env.TEST_SOURCE_REF + ':' + file], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, file), 'utf8');
const names = ['fmt', 'usd', 'pf', 'fmt4'];
const functions = names.map(name => {
  const line = source.split('\n').find(row => row.startsWith('function ' + name + '('));
  assert.ok(line, name + ' exists in the real component');
  return line;
}).join('\n');
const ctx = vm.createContext({});
vm.runInContext(functions, ctx);
const lock = '\uD83D\uDD12';
for (const [input, expected] of [[0, '$0.00'], [1234.56, '$1,234.56'], [-249980.46, '$-249,980.46'], ['1855.80', '$1,855.80'], [null, '$0.00']]) {
  assert.equal(ctx.usd(input), expected);
  assert.equal(ctx.pf(input), expected);
}
assert.equal(ctx.usd(undefined), lock);
assert.equal(ctx.pf(undefined), lock + ' hidden');
assert.equal(ctx.fmt(undefined), lock);
assert.equal(ctx.fmt4(undefined), lock);
assert.equal(ctx.fmt4(null), '\u2014');
assert.equal(ctx.fmt4(0.12), '$0.1200');
for (let i = 0; i < 10000; i++) assert.equal(ctx.usd(1855.8), '$1,855.80');
console.log('PASS: real currency/profit formatters, zero, negative, null, numeric string, hidden fields and 10,000 repeated cells');
