// v55.83-TU — the REAL settle SQL on a real Postgres (PGlite, in memory): Codex QA 17 Nov reproductions + recheck.
// Run:  npm i --no-save @electric-sql/pglite   then   node __tests__/sql-v55-83-tu-pending-settle.mjs
// (or set PGLITE_MODULE to the path of an installed @electric-sql/pglite entry file).
// Loads sql/v55-83-SO-duplicates.sql and sql/v55-83-TU-pending-settle.sql (TU twice: re-runnable) on stub base tables.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table public.bank_transactions (
  id uuid primary key, plaid_transaction_id text, account_id text, wave_business_id text, date date, posted_date date,
  amount numeric, amount_abs numeric, direction text, iso_currency text, pending boolean default false,
  classification text, category_source text, category_verified boolean default false, category_verified_by uuid, category_verified_at timestamptz,
  review_status text, matched_invoice_id text, transfer_group_id text, linked_id text);
create schema clickbooks_us;
create table clickbooks_us.books (code text, locked_through date);
insert into clickbooks_us.books values ('KTC_US', '2026-10-31');
`);
const SQL = path.join(here, '..', 'sql');
await db.exec(fs.readFileSync(path.join(SQL, 'v55-83-SO-duplicates.sql'), 'utf8'));
for (let i = 0; i < 2; i++) { await db.exec(fs.readFileSync(path.join(SQL, 'v55-83-TU-pending-settle.sql'), 'utf8')); }
const U = n => '00000000-0000-0000-0000-0000000000' + String(n).padStart(2, '0');
async function row(id, o) {
  const r = Object.assign({ account_id: 'A1', wave_business_id: 'KTC', date: '2026-11-10', posted_date: null, amount: 10, amount_abs: 10, direction: 'out', iso_currency: 'USD', pending: false, classification: null, category_source: null, category_verified: false, category_verified_by: null, review_status: 'unreviewed', matched_invoice_id: null }, o);
  await db.query(`insert into public.bank_transactions (id, plaid_transaction_id, account_id, wave_business_id, date, posted_date, amount, amount_abs, direction, iso_currency, pending, classification, category_source, category_verified, category_verified_by, review_status, matched_invoice_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [U(id), 'P' + id, r.account_id, r.wave_business_id, r.date, r.posted_date, r.amount, r.amount_abs, r.direction, r.iso_currency, r.pending, r.classification, r.category_source, r.category_verified, r.category_verified_by, r.review_status, r.matched_invoice_id]);
}
const get = async id => (await db.query(`select * from public.bank_transactions where id = $1`, [U(id)])).rows[0];
const settle = async (p, q) => (await db.query(`select public.hub_settle_pending($1, $2, 'test') as r`, [U(p), q ? U(q) : null])).rows[0].r;
let pass = 0, fail = 0; const check = (l, c, x) => { if (c) pass++; else fail++; console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + l + (c ? '' : ' ' + JSON.stringify(x))); };
console.log('TU SQL — pending lines settled in one guarded step');

await row(1, { pending: true, classification: 'fuel', category_source: 'classification', category_verified: true, category_verified_by: U(99), review_status: 'reviewed' });
await row(2, {});
let r = await settle(1, 2); let p2 = await get(2);
check('same money: category, verified and reviewed carried; pending filed away', r.ok && p2.classification === 'fuel' && p2.category_verified === true && p2.review_status === 'reviewed' && !(await get(1)), { r, p2 });
check('the settlement is recorded (pending → posted)', (await db.query(`select posted_id from public.hub_pending_settlements where pending_id = $1`, [U(1)])).rows[0]?.posted_id === U(2));
check('identical pair again → ok, already', (await settle(1, 2)).already === true);
r = await settle(1, null);
check('Codex recheck: same pending with NO posted line → refused (not the recorded pair)', r.ok === false, r);

await row(3, { pending: true, classification: 'rent', category_verified: true, category_verified_by: U(99), review_status: 'reviewed' });
await row(4, { amount: 12, amount_abs: 12, classification: 'utilities', review_status: 'new' });
r = await settle(3, 4); let p4 = await get(4);
check('Codex: $10 rent verified → $12 utilities new: nothing carried', r.ok && p4.classification === 'utilities' && p4.category_verified === false && p4.review_status === 'new' && p4.category_verified_by === null, { r, p4 });
check('changed-money pair replay → ok, already', (await settle(3, 4)).already === true);
await row(16, {});
r = await settle(3, 16);
check('Codex recheck: changed-money pending replayed against a DIFFERENT posted line → refused', r.ok === false && (await get(16)).classification === null, r);

await row(5, { pending: true, classification: 'rent', category_verified: true, review_status: 'reviewed' });
await row(6, { classification: 'utilities' });
r = await settle(5, 6);
check('same amount, different category already posted → nothing carried', r.ok && (await get(6)).category_verified === false && (await get(6)).review_status === 'unreviewed', await get(6));

await row(7, { pending: true, date: '2026-10-15', classification: 'fuel', category_verified: true, review_status: 'reviewed' });
await row(8, { date: '2026-10-16' });
r = await settle(7, 8);
check('both in a closed month: refused, both unchanged', r.ok === false && /closed month/.test(r.why) && (await get(7))?.pending === true && (await get(8)).classification === null, r);

await row(21, { pending: true, date: '2026-11-10', classification: 'fuel', category_verified: true, review_status: 'reviewed' });
await row(22, { date: '2026-10-20' });
r = await settle(21, 22); const p21 = await get(21), p22 = await get(22);
check('Codex recheck: pending open (Nov) but POSTED line in a closed month (Oct) → refused, both unchanged', r.ok === false && /closed month/.test(r.why) && p21?.pending === true && p22.classification === null && p22.category_verified === false && p22.review_status === 'unreviewed', { r, p22 });
await row(23, { pending: true, date: '2026-11-10', classification: 'fuel' });
await row(24, { date: '2026-11-12', posted_date: '2026-10-30' });
r = await settle(23, 24);
check('the posted line\'s POSTED date counts first (Oct 30 posted, dated Nov 12) → refused', r.ok === false && /closed month/.test(r.why), r);

await row(9, { pending: true, matched_invoice_id: 'invoice-1', classification: 'sales', category_verified: true });
await row(10, {});
r = await settle(9, 10);
check('pending line matched to an invoice: refused, both unchanged, nothing recorded', r.ok === false && (await get(9)) && (await get(10)).classification === null && !(await db.query(`select 1 from public.hub_pending_settlements where pending_id = $1`, [U(9)])).rows.length, r);

await row(11, { pending: true, classification: 'fuel', category_verified: true, review_status: 'reviewed' });
await row(12, { wave_business_id: 'RTM' });
r = await settle(11, 12);
check('different company: nothing carried', r.ok && (await get(12)).classification === null && r.same_money === false, r);
await row(13, { pending: true, classification: 'fuel', category_verified: true });
await row(14, { iso_currency: 'CAD' });
r = await settle(13, 14);
check('different currency: nothing carried', r.ok && (await get(14)).classification === null, r);

await row(15, { pending: false, classification: 'fuel' });
await row(17, {});
r = await settle(15, 17);
check('line no longer pending: refused, untouched', r.ok === false && (await get(15)) && (await get(17)).classification === null, r);

// a line filed away by the ordinary duplicate step (not this settlement) is never accepted as a settled pair
await row(18, { pending: true });
await row(19, {});
await db.query(`select public.bank_duplicate_remove($1, null, null, 'ordinary duplicate')`, [U(18)]);
r = await settle(18, 19);
check('Codex recheck: pending archived by the ordinary duplicate step, then a pair request → refused (no recorded settlement)', r.ok === false, r);
r = await settle(18, null);
check('…and with no posted line → refused too', r.ok === false, r);

console.log(`\nTU SQL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
