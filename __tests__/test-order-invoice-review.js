const assert = require('node:assert/strict');
require('sucrase/register');
const { FakeDb } = require('./fake-supabase');

const live = 'nextrade-live';
const staging = 'nextrade-staging';
const archiveId = '5a93c218-6824-4e6b-8d2d-8afb5f3b2635';
const db = new FakeDb({ order_invoice_reviews: [['source', 'section', 'order_id', 'release_key']] });
const originalFrom = db.from;
db.from = function (table) {
  const query = originalFrom(table);
  const execute = query.exec;
  query.exec = function () {
    const result = execute.call(query);
    if (query.one && Array.isArray(result.data)) { result.data = result.data[0] || null; }
    return result;
  };
  return query;
};
db.t.users = [{ id: 'u1', name: 'Reviewer' }];
db.t.order_report_archive = [{ id: archiveId, source: live, order_id: 11, release_number: '1001-0011',
  choice: 'corrected', archived_at: '2026-11-24T12:00:00Z', archived_by_name: 'Orders reviewer' },
{ source: staging, order_id: 12, release_number: '1001-0012', choice: 'non_issue' },
{ source: live, order_id: 16, release_number: '1001-9999', choice: 'corrected' }];
db.t.accounting_invoices = [{ id: 'inv14', invoice_number: 'INV-14', release_number: '1001-0014',
  record_status: 'active', approval_status: 'draft' }];

const warehouseOrder = (id, release, status = 'shipped') => ({
  id, release_number: release, status, customer_name: 'Fixture Customer', shipped_date: '2026-11-24'
});
const orders = [
  warehouseOrder(11, '1001-0011'), warehouseOrder(12, '1001-0012'), warehouseOrder(13, '1001-0013'),
  warehouseOrder(14, '1001-0014'), warehouseOrder(15, '1001-0015', 'cancelled'), warehouseOrder(16, '1001-0016')
];
let canManage = true;
const audited = [];
function stub(file, exports) {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('next/server', { NextResponse: { json: (body, options) => Response.json(body, options) } });
stub('@supabase/supabase-js', { createClient: () => db });
stub('../src/lib/verified-caller', { verifiedCaller: async () => ({ userId: 'u1' }) });
stub('../src/lib/server-permissions', { assertPermission: async (_db, _id, key) => ({ ok: key !== 'orders.manage' || canManage }) });
stub('../src/lib/audit-server', { audit: async (_db, user, action, entity, id, details) => audited.push({ user, action, id, details }) });
stub('../src/lib/notify-server', { sendAlertEmail: () => assert.fail('No email expected') });
process.env.NEXTRADE_FEED_URL = 'https://nextradeindustries.com/api/hub/shipping';
process.env.NEXTRADE_FEED_TOKEN = 'fixture';
process.env.NEXTRADE_FEED_ALLOW_LIVE = 'yes';
global.fetch = async function (url) {
  const site = new URL(url).host;
  assert.match(site, /^(nextradeindustries|nextrade-staging)\.com$/);
  return Response.json({ ok: true, site, source: site.startsWith('nextrade-staging') ? staging : live, orders,
    obsolete_orders: [{ ...warehouseOrder(11, '1001-0011', 'closed'), shiped_date: '2026-11-24' }], requirements: [] });
};
const { POST } = require('../src/app/api/accounting/order-monitor/route');
async function post(action, body) {
  const response = await POST(new Request('http://fixture/api/accounting/order-monitor', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...body })
  }));
  return { ...await response.json(), status: response.status };
}
async function read(action) {
  const response = await post(action);
  assert.equal(response.status, 200, response.error);
  return response;
}
function review(id, choice, extra) {
  return post('set_invoice_review', { source: live, section: 'main', order_id: id, release_number: '1001-00' + id, choice, ...extra });
}
function reconRow(report, id, source = 'main') {
  return report.rows.find(row => row.order_id === id && row.source === source);
}

async function run() {
  let reconciled = await read('reconcile');
  let report = await read('report');
  assert.equal(reconRow(reconciled, 11).invoice_review.origin, 'orders_archive');
  assert.equal(report.archived.find(row => row.archive.id === archiveId).row.invoice_review.choice, 'corrected');
  assert.equal(reconRow(reconciled, 11, 'obsolete').invoice_review.completed, false);
  assert.equal(reconRow(reconciled, 12).invoice_review.completed, false);
  assert.equal(reconRow(reconciled, 16).invoice_review.completed, false);
  assert.equal(reconRow(reconciled, 14).invoice_review.choice, 'linked');
  assert.equal(reconRow(reconciled, 14).linked[0].approval, 'draft');
  assert.equal(report.rows.find(row => row.id === 14).invoice.state, 'draft_only');
  assert.equal(reconRow(reconciled, 15), undefined);
  console.log('Legacy decisions match only the same release, warehouse copy and section. Draft invoices stay drafts.');

  canManage = false;
  assert.equal((await review(12, 'non_issue')).status, 403);
  assert.equal((await read('reconcile')).can_manage, false);
  canManage = true;
  assert.equal((await review(12, 'non_issue', { source: staging })).status, 409);
  assert.equal((await review(12, 'non_issue', { release_number: '1001-WRONG' })).status, 409);
  assert.equal((await review(12, 'created')).status, 400);
  assert.equal((await review(15, 'corrected')).status, 409);
  assert.equal((await review(12, 'invoice_created')).status, 409);
  console.log('Write permission, copy, order, release and invoice evidence are enforced.');

  const saved = await review(12, 'non_issue', { note: '  Confirmed with accounting  ' });
  assert.equal(saved.status, 200, saved.error);
  reconciled = await read('reconcile');
  report = await read('report');
  assert.deepEqual(reconRow(reconciled, 12).invoice_review, saved.invoice_review);
  assert.deepEqual(report.rows.find(row => row.id === 12).invoice_review, saved.invoice_review);
  assert.equal(saved.invoice_review.note, 'Confirmed with accounting');
  assert.equal(report.rows.find(row => row.id === 12).invoice.state, 'missing_overdue');
  assert.equal(report.rows.find(row => row.id === 12).closable, false);
  const detail = await post('order', { order_id: 12 });
  assert.deepEqual(detail.report.invoice_review, saved.invoice_review);
  const obsolete = await review(11, 'corrected', { section: 'obsolete' });
  assert.equal(obsolete.status, 200, obsolete.error);
  reconciled = await read('reconcile');
  assert.equal(reconRow(reconciled, 11, 'obsolete').invoice_review.origin, 'review');
  assert.equal(reconRow(reconciled, 11).invoice_review.archive_id, archiveId);
  console.log('Both views and order details read the same saved review. Warehouse and invoice state remain factual.');

  const race = await Promise.all([
    review(12, 'open', { revision: saved.invoice_review.revision }),
    review(12, 'corrected', { revision: saved.invoice_review.revision })
  ]);
  assert.deepEqual(race.map(x => x.status).sort(), [200, 409]);
  assert.equal((await review(12, 'corrected')).status, 409);
  const latest = race.find(x => x.ok);
  const reopened = await review(12, 'open', { revision: latest.invoice_review.revision });
  assert.equal(reopened.status, 200, reopened.error);
  assert.equal(reconRow(await read('reconcile'), 12).invoice_review.completed, false);
  assert.equal((await post('unarchive_row', { source: staging, id: archiveId })).status, 409);
  assert.equal((await post('unarchive_row', { source: live, id: archiveId })).status, 200);
  assert.equal(reconRow(await read('reconcile'), 11).invoice_review.completed, false);
  assert.ok((await read('report')).rows.some(row => row.id === 11));
  console.log('Reopening updates both views and stale concurrent writes cannot replace the current decision.');

  const created = await review(14, 'invoice_created');
  assert.equal(created.status, 200, created.error);
  assert.equal(reconRow(await read('reconcile'), 14).invoice_review.choice, 'invoice_created');
  db.t.accounting_invoices[0].record_status = 'void';
  assert.equal(reconRow(await read('reconcile'), 14).invoice_review.invoice_unlinked, true);
  assert.equal((await read('report')).rows.find(row => row.id === 14).invoice_review.completed, false);
  assert.ok(audited.some(row => row.action === 'order_invoice_review_set' && row.details.choice === 'open'));
  console.log('Linked invoices appear in Completed and a voided invoice returns the review to Open.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
