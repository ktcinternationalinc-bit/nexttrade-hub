import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const sql = fs.readFileSync(process.argv[2], 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const check = (l, c, x) => { if (c) pass++; else fail++; console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + l + (c ? '' : ' ' + JSON.stringify(x))); };
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
await db.exec(sql); await db.exec(sql); // safe to run twice
const one = async (q, p) => (await db.query(q, p)).rows;
const run = async () => (await one("INSERT INTO pl_warehouse_sync_runs (trigger, source) VALUES ('button','nextrade-staging') RETURNING id"))[0].id;
const row = (id, rel, fu, extra) => Object.assign({ source: 'nextrade-staging', section: 'main', order_id: id, release_number: rel, release_key: rel.replace(/[^0-9]/g, ''), status: 'shipped', freight_used: fu, trucking_used: 741, combined_used: fu + 741, cost_status: 'provisional', currency: 'USD', currency_confirmed: false, conflict: false, invoice_matches: [], review_only_invoices: [], bill_checks: [], flags: ['x'], detail: {}, last_checked_at: '2026-11-16T12:00:00Z', last_changed_at: '2026-11-16T12:00:00Z' }, extra || {});
const pub = (r, rows, ch) => db.query('SELECT pl_warehouse_publish($1, $2, $3::jsonb, $4::jsonb, $5::jsonb) AS x', [r, 'nextrade-staging', JSON.stringify(rows), JSON.stringify(ch), '{}']);
const count = async (t, w) => Number((await one('SELECT count(*)::int n FROM ' + t + (w ? ' WHERE ' + w : '')))[0].n);

console.log('first publish');
let r1 = await run();
await pub(r1, [row(1695, '1001-1669', 1950), row(1519, '1002-1156', 3475)], { 'main|1695': { kind: 'created', changes: { a: 1 } }, 'main|1519': { kind: 'created', changes: { a: 1 } } });
check('2 rows, 2 history, run ok', await count('pl_warehouse_shipping') === 2 && await count('pl_warehouse_shipping_history') === 2 && (await one('SELECT ok FROM pl_warehouse_sync_runs WHERE id=$1', [r1]))[0].ok === true);
check('leading zeros / raw release kept', (await one("SELECT release_number FROM pl_warehouse_shipping WHERE order_id=1695"))[0].release_number === '1001-1669');

console.log('a failure part-way keeps NOTHING of the run (atomic)');
let r2 = await run();
let err = null;
try { await pub(r2, [row(1695, '1001-1669', 2000), row(1519, '1002-1156', 3475, { ship_date: 'not-a-date' })], { 'main|1695': { kind: 'sync_change', changes: { freight_used: { from: 1950, to: 2000 } } } }); } catch (e) { err = e.message; }
check('the bad second row makes the publish fail', !!err, err);
check('the GOOD first row was NOT changed either (still 1950)', Number((await one("SELECT freight_used FROM pl_warehouse_shipping WHERE order_id=1695"))[0].freight_used) === 1950);
check('no half history written (still 2)', await count('pl_warehouse_shipping_history') === 2);
check('the run is still unfinished (the route then marks it FAILED)', (await one('SELECT finished_at FROM pl_warehouse_sync_runs WHERE id=$1', [r2]))[0].finished_at === null);
await db.query("UPDATE pl_warehouse_sync_runs SET finished_at=now(), ok=false, error='x' WHERE id=$1", [r2]);

console.log('retry publishes the change once, with its history');
let r3 = await run();
await pub(r3, [row(1695, '1001-1669', 2000), row(1519, '1002-1156', 3475)], { 'main|1695': { kind: 'sync_change', changes: { freight_used: { from: 1950, to: 2000 } } } });
check('value updated, exactly ONE history entry for that change', Number((await one("SELECT freight_used FROM pl_warehouse_shipping WHERE order_id=1695"))[0].freight_used) === 2000 && await count('pl_warehouse_shipping_history', "kind='sync_change'") === 1);
check('same rows updated, never duplicated', await count('pl_warehouse_shipping') === 2);

console.log('fencing and one-sync-at-a-time');
err = null; try { await pub(r3, [row(1695, '1001-1669', 9999)], {}); } catch (e) { err = e.message; }
check('a finished run cannot publish again', !!err && Number((await one("SELECT freight_used FROM pl_warehouse_shipping WHERE order_id=1695"))[0].freight_used) === 2000);
let r4 = await run(); err = null;
try { await run(); } catch (e) { err = e.message; }
check('a second unfinished run cannot even start', !!err && /duplicate|unique/i.test(err), err);

console.log('a person’s correction');
const id1519 = (await one("SELECT id FROM pl_warehouse_shipping WHERE order_id=1519"))[0].id;
await db.query('SELECT pl_warehouse_set_manual($1,$2,$3,$4,$5)', [id1519, 'max', null, 2100, 'trucker invoice 34224 checked']);
check('correction saved with its history', Number((await one('SELECT manual_trucking FROM pl_warehouse_shipping WHERE id=$1', [id1519]))[0].manual_trucking) === 2100 && await count('pl_warehouse_shipping_history', "kind='manual_correction'") === 1);
err = null; try { await db.query('SELECT pl_warehouse_set_manual($1,$2,$3,$4,$5)', ['00000000-0000-0000-0000-000000000000', 'max', 1, 1, 'x']); } catch (e) { err = e.message; }
check('unknown record → refused, no history', !!err && await count('pl_warehouse_shipping_history', "kind='manual_correction'") === 1);
await pub(r4, [row(1519, '1002-1156', 3475)], {});
check('a later sync does NOT overwrite the correction', Number((await one('SELECT manual_trucking FROM pl_warehouse_shipping WHERE id=$1', [id1519]))[0].manual_trucking) === 2100);
check('an order missing from the latest feed is kept but marked not in the feed', (await one("SELECT in_latest_feed FROM pl_warehouse_shipping WHERE order_id=1695"))[0].in_latest_feed === false && await count('pl_warehouse_shipping') === 2);
check('settings: P&L switch OFF, source staging', (await one("SELECT value FROM pl_warehouse_settings WHERE key='use_in_pnl'"))[0].value === false && (await one("SELECT value FROM pl_warehouse_settings WHERE key='active_source'"))[0].value === 'nextrade-staging');
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
