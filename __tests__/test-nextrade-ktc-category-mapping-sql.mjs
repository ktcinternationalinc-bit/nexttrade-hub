import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(resolve(process.env.PGLITE_DIR || '.', 'package.json'));
const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite')).href);
const db = new PGlite();
const sql = (name) => readFileSync(new URL('../sql/' + name, import.meta.url), 'utf8');
const one = async (query, params) => (await db.query(query, params)).rows[0];
const actor = '11111111-1111-1111-1111-111111111111';
const company = 'NEXTRADE_BOOKS';
const ktc = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';

try {
  await db.exec(readFileSync(new URL('./pg/stub-schema.sql', import.meta.url), 'utf8'));
  await db.exec('CREATE ROLE service_role');
  for (const name of [
    'v55-83-TO-payment-guards.sql', 'v55-83-TV-repeating-bills.sql', 'v55-83-TW-company-books.sql',
    'v55-83-TX-advances-fees.sql', 'v55-83-UB-company-transfers.sql', 'v55-83-UD-pay-nextrade.sql',
    'v55-83-VK-rule-apply-guard.sql', 'v55-83-XN-nextrade-june-cutoff.sql',
  ]) {
    await db.exec(sql(name));
  }
  await db.exec(`
    CREATE TABLE public.expense_categories (key text PRIMARY KEY, label text, active boolean DEFAULT true);
    CREATE TABLE public.vendor_bill_lines (bill_id uuid, description text);
    ALTER TABLE public.vendor_bills ADD COLUMN category_source text;
    CREATE SCHEMA hub_private;
    INSERT INTO public.expense_categories (key, label) VALUES
      ('utilities', 'Utilities'), ('facilities', 'Facilities'), ('office', 'Office'), ('payroll', 'Payroll');
    INSERT INTO public.plaid_accounts VALUES
      ('NCHK', 'Nextrade checking', '1795', 'depository', 'NEXTRADE_BOOKS', false),
      ('PRIVATE', 'Private account', '1796', 'depository', 'NEXTRADE_BOOKS', true);
  `);
  const payrollSql = sql('v55-83-ZD-payroll-bills.sql');
  await db.exec(payrollSql.slice(payrollSql.indexOf('CREATE OR REPLACE FUNCTION hub_private.values_are_payroll'), payrollSql.indexOf('CREATE OR REPLACE FUNCTION hub_private.package_is_payroll')));
  await db.exec(sql('nextrade-ktc-category-mapping.sql'));
  await db.exec(sql('nextrade-ktc-category-mapping.sql'));

  const rpc = async (func, data) => (await one('SELECT public.' + func + '($1::jsonb) AS result', [JSON.stringify({ actor, ...data })])).result;
  const save = (ktcCategory, allow = {}) => rpc('hub_save_nextrade_ktc_mapping', { category_key: 'other_expense', ktc_category: ktcCategory, ...allow });
  const makeLine = async (account = 'NCHK', pending = false) => (await one(
    "INSERT INTO public.bank_transactions (wave_business_id, account_id, direction, amount_abs, date, pending) VALUES ($1, $2, 'out', 40, '2026-11-27', $3) RETURNING id",
    [company, account, pending],
  )).id;
  const categorize = (line, source = 'manual') => rpc('hub_company_categorize_with_mapping', {
    line_id: line, company_id: company, source, category_key: 'other_expense', ktc_category: 'office',
    bill: { wave_business_id: ktc, vendor_name: 'Example Vendor', bill_number: 'NXT-' + line, bill_date: '2026-11-27', due_date: '2026-11-30' },
  });
  const category = async (id) => (await one('SELECT category FROM public.vendor_bills WHERE id = $1', [id])).category;

  const inherited = (await categorize(await makeLine())).bill_id;
  assert.equal(await category(inherited), null, 'stale client mapping is ignored');
  assert.deepEqual(await save('utilities'), { ok: true, bills_updated: 1 });
  assert.equal(await category(inherited), 'utilities');
  const manual = (await categorize(await makeLine())).bill_id;
  const attached = (await categorize(await makeLine())).bill_id;
  const privateBill = (await categorize(await makeLine('PRIVATE'))).bill_id;
  const sent = (await categorize(await makeLine())).bill_id;
  await db.query("UPDATE public.vendor_bills SET category_source = 'manual' WHERE id = $1", [manual]);
  await db.query("UPDATE public.company_bill_links SET mode = 'attached' WHERE bill_id = $1", [attached]);
  const sentWire = await one("INSERT INTO public.wire_packages (status) VALUES ('sent') RETURNING id");
  await db.query('INSERT INTO public.wire_package_lines (bill_id, package_id) VALUES ($1, $2)', [sent, sentWire.id]);
  assert.deepEqual(await save('facilities'), { ok: true, bills_updated: 1 });
  assert.equal(await category(inherited), 'facilities');
  for (const bill of [manual, attached, privateBill, sent]) {
    assert.equal(await category(bill), 'utilities');
  }
  const posted = await makeLine();
  const newBill = (await categorize(posted, 'rule')).bill_id;
  assert.equal(await category(newBill), 'facilities');
  assert.equal((await categorize(posted, 'rule')).why, 'already_categorized');
  assert.equal((await categorize(await makeLine('NCHK', true), 'rule')).why, 'pending');
  await assert.rejects(save('payroll'), /super admin/);
  await assert.rejects(save('unknown'), /active KTC category/);
  assert.deepEqual(await save(null), { ok: true, bills_updated: 2 });
  assert.equal(await category(inherited), null);
  assert.equal(await category(newBill), null);

  await db.exec("ALTER TABLE public.hub_audit_log ADD CONSTRAINT test_fail_mapping_audit CHECK (action <> 'nextrade_category_mapped') NOT VALID");
  await assert.rejects(save('office'), /test_fail_mapping_audit/);
  assert.equal(await category(inherited), null, 'bill update rolls back with the mapping');
  assert.equal((await one("SELECT ktc_category FROM public.company_category_map WHERE category_key = 'other_expense'")).ktc_category, null);
  assert.equal((await one("SELECT has_function_privilege('authenticated', 'public.hub_save_nextrade_ktc_mapping(jsonb)', 'EXECUTE') AS allowed")).allowed, false);
  console.log('Nextrade KTC mapping SQL passed.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
