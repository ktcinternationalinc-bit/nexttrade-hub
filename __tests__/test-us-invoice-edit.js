const assert = require('node:assert/strict');
require('sucrase/register');

const { FakeDb } = require('./fake-supabase');
const { US_WAVE_BUSINESS_ID, US_INVOICE_EDIT_PERMISSION } = require('../src/lib/business-of');

const actor = 'editor';
const revision = '2026-11-27T00:00:00+00:00';
const makeInvoice = (id, business, currency) => ({
  id, wave_business_id: business, currency, approval_status: 'approved', updated_at: revision,
});
const db = new FakeDb();
db.t = {
  users: [{ id: actor, role: 'team' }],
  module_permissions: [{ user_id: actor, module_name: 'invoice.view', has_access: true }],
  accounting_invoices: [
    makeInvoice('us', US_WAVE_BUSINESS_ID, 'USD'),
    makeInvoice('egypt', 'egypt-business', 'USD'),
    makeInvoice('egp', US_WAVE_BUSINESS_ID, 'EGP'),
    makeInvoice('untagged', null, 'USD'),
  ],
  accounting_invoice_items: [{ id: 'freight', invoice_id: 'us', description: 'Freight', quantity: 1, unit_price: 20 }],
};
const calls = [];
db.rpc = async (name, args) => { calls.push({ name, args }); return { error: null }; };
let who = { userId: actor };
function stub(modulePath, exports) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('../src/lib/verified-caller', { verifiedCaller: async () => who });
stub('@supabase/supabase-js', { createClient: () => db });
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
const { POST } = require('../src/app/api/accounting/invoice-write/route');
const items = [
  { id: 'freight', description: 'Freight', quantity: 1, unit_price: 20 },
  { description: 'Goods', quantity: 2, unit_price: 50 },
];
async function post(overrides) {
  const request = new Request('http://localhost/api/accounting/invoice-write', {
    method: 'POST',
    body: JSON.stringify({
      action: 'edit_us_invoice', invoice_id: 'us', expected_updated_at: revision,
      reason: 'Customer correction', items, ...overrides,
    }),
  });
  return POST(request);
}

async function main() {
  assert.equal((await post({ user_id: 'super-admin' })).status, 403);
  db.t.module_permissions.push({ user_id: actor, module_name: US_INVOICE_EDIT_PERMISSION, has_access: true });
  for (const invoice_id of ['egypt', 'egp', 'untagged']) {
    assert.equal((await post({ invoice_id })).status, 403);
  }
  assert.equal((await post({ action: 'reopen' })).status, 403);
  assert.equal((await post({ action: 'set_approval', status: 'approved' })).status, 403);
  assert.equal((await post({ expected_updated_at: 'stale' })).status, 409);
  assert.equal((await post({ reason: '' })).status, 400);
  assert.equal((await post({ items: [items[1]] })).status, 400);
  assert.equal((await post({ items: [{ ...items[0], unit_price: 1 }, items[1]] })).status, 400);
  assert.equal(calls.length, 0);

  const saved = await post();
  assert.deepEqual(await saved.json(), { ok: true, reopened: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'hub_edit_us_invoice');
  assert.equal(calls[0].args.p_actor, actor);
  assert.equal(calls[0].args.p_invoice, 'us');

  who = { error: 'Sign in again.', status: 401 };
  assert.equal((await post()).status, 401);
  assert.equal(calls.length, 1);
  console.log('U.S. invoice edit permission checks passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });