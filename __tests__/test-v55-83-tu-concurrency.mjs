// v55.83-TU — TWO SESSIONS AT ONCE on a real, disposable Postgres 16 (Codex QA 17 Nov 20:00/20:15). Never Supabase or staging.
// Loads sql/v55-83-SO-duplicates.sql + sql/v55-83-TU-pending-settle.sql on minimal stub tables, opens two separate connections
// and makes them collide on hub_settle_pending: session A runs it inside a transaction and holds it open; session B runs the
// same (or a competing) call and must wait on A's row locks; then A commits (or rolls back) and B finishes.
// Needs EMBEDDED_PG_DIR = a folder with embedded-postgres + pg installed (e.g. D:/GITHUB/_test-tools/epg). Its own data folder
// and port; the data folder is removed at the end.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var dir = process.env.EMBEDDED_PG_DIR;
if (!dir) { console.log('SKIPPED — set EMBEDDED_PG_DIR. Nothing was checked.'); process.exit(2); }
var req = createRequire(path.join(dir, 'package.json'));
var EmbeddedPostgres = (await import('file://' + req.resolve('embedded-postgres').replace(/\\/g, '/'))).default;
var pg = req('pg');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
var dataDir = path.join(dir, 'data-tu-' + Date.now()); var port = 55000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
function client() { return new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); }
var A, B, X;
var n = 0; function U() { n++; return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); }
try {
  await server.initialise(); await server.start();
  console.log('TU — two sessions at once (real Postgres 16, disposable)');
  X = client(); await X.connect();
  await X.query(`
    create role anon; create role authenticated; create role service_role;
    create table public.bank_transactions (
      id uuid primary key, plaid_transaction_id text, account_id text, wave_business_id text, date date, posted_date date,
      amount numeric, amount_abs numeric, direction text, iso_currency text, pending boolean default false,
      classification text, category_source text, category_verified boolean default false, category_verified_by uuid, category_verified_at timestamptz,
      review_status text, matched_invoice_id text, transfer_group_id text, linked_id text);
    create schema clickbooks_us; create table clickbooks_us.books (code text, locked_through date);
    insert into clickbooks_us.books values ('KTC_US', '2026-10-31');`);
  await X.query(fs.readFileSync(path.join(root, 'sql', 'v55-83-SO-duplicates.sql'), 'utf8'));
  await X.query(fs.readFileSync(path.join(root, 'sql', 'v55-83-TU-pending-settle.sql'), 'utf8'));
  async function line(o) {
    var id = U(); var r = Object.assign({ pending: false, amount_abs: 10, classification: null, category_verified: false, review_status: 'unreviewed', matched_invoice_id: null }, o || {});
    await X.query(`insert into public.bank_transactions (id, plaid_transaction_id, account_id, wave_business_id, date, amount, amount_abs, direction, iso_currency, pending, classification, category_verified, review_status, matched_invoice_id)
      values ($1, $2, 'A1', 'KTC', '2026-11-10', $3, $3, 'out', 'USD', $4, $5, $6, $7, $8)`, [id, 'P-' + id.slice(-6), r.amount_abs, r.pending, r.classification, r.category_verified, r.review_status, r.matched_invoice_id]);
    return id;
  }
  var get = async function (id) { return (await X.query('select * from public.bank_transactions where id=$1', [id])).rows[0]; };
  var count = async function (sql, p) { return Number((await X.query(sql, p || [])).rows[0].n); };
  var SQL = "select public.hub_settle_pending($1::uuid, $2::uuid, 'concurrency test') as r";
  A = client(); B = client(); await A.connect(); await B.connect();
  async function collide(pa, pb, endA) {
    await A.query('BEGIN'); var ra = await A.query(SQL, pa);
    var bDone = false; var rb = null; var eb = null;
    var bp = B.query(SQL, pb).then(function (r) { bDone = true; rb = r; }, function (e) { bDone = true; eb = e; });
    await new Promise(function (r) { setTimeout(r, 700); });
    var waited = !bDone;
    await A.query(endA || 'COMMIT'); await bp;
    return { a: ra.rows[0].r, b: rb ? rb.rows[0].r : null, bErr: eb ? String(eb.message) : null, waited: waited };
  }

  // 1. the SAME pair settled by two syncs at the same moment
  var p1 = await line({ pending: true, classification: 'fuel', category_verified: true, review_status: 'reviewed' }); var q1 = await line();
  var c1 = await collide([p1, q1], [p1, q1]);
  check('same pair, two sessions: the second WAITED for the first', c1.waited === true, c1);
  check('…first settles, second answers "already" (no error, no second archive, one settlement record)', c1.a.ok === true && c1.b && c1.b.ok === true && c1.b.already === true && !c1.bErr &&
    await count('select count(*) n from public.bank_transaction_duplicates where id=$1', [p1]) === 1 && await count('select count(*) n from public.hub_pending_settlements where pending_id=$1', [p1]) === 1, c1);
  var g1 = await get(q1);
  check('…the posted line got the carried work exactly once', g1.classification === 'fuel' && g1.category_verified === true && g1.review_status === 'reviewed', g1);

  // 2. competing destinations: one pending line, two different posted lines
  var p2 = await line({ pending: true, classification: 'rent', category_verified: true }); var q2a = await line(); var q2b = await line();
  var c2 = await collide([p2, q2a], [p2, q2b]);
  check('competing posted lines: the second WAITED, then was REFUSED (the pending line went to the first)', c2.waited === true && c2.a.ok === true && c2.b && c2.b.ok === false, c2);
  check('…the loser\'s posted line is untouched; the record names the winner', (await get(q2b)).classification === null && (await get(q2b)).category_verified === false &&
    (await X.query('select posted_id from public.hub_pending_settlements where pending_id=$1', [p2])).rows[0].posted_id === q2a);

  // 3. session A's settlement is rolled back (a failure after the call) → B, which waited, settles it cleanly
  var p3 = await line({ pending: true, classification: 'fuel', category_verified: true }); var q3 = await line();
  var c3 = await collide([p3, q3], [p3, q3], 'ROLLBACK');
  check('A rolled back: B waited and then settled it itself (no half state left by A)', c3.waited === true && c3.b && c3.b.ok === true && !c3.b.already &&
    await count('select count(*) n from public.bank_transaction_duplicates where id=$1', [p3]) === 1 && (await get(q3)).classification === 'fuel', c3);

  // 4. a refused settlement (pending line matched to an invoice) leaves BOTH lines exactly as they were
  var p4 = await line({ pending: true, classification: 'sales', category_verified: true, matched_invoice_id: 'invoice-1' }); var q4 = await line();
  var r4 = (await X.query(SQL, [p4, q4])).rows[0].r;
  var g4p = await get(p4), g4q = await get(q4);
  check('refused (invoice match): both lines unchanged, nothing archived or recorded', r4.ok === false && g4p && g4p.pending === true && g4q.classification === null && g4q.category_verified === false &&
    await count('select count(*) n from public.bank_transaction_duplicates where id=$1', [p4]) === 0 && await count('select count(*) n from public.hub_pending_settlements where pending_id=$1', [p4]) === 0, { r4: r4 });

  // 5. restore → settle again (lifecycle)
  var rs = (await X.query('select public.bank_duplicate_restore($1, null) as r', [p1])).rows[0].r;
  check('a person restores the filed pending line', rs.ok === true && (await get(p1)).pending === true, rs);
  var re = (await X.query(SQL, [p1, q1])).rows[0].r;
  check('…and the next sync settles it again cleanly (record follows the latest settlement)', re.ok === true && !re.already && !(await get(p1)) &&
    await count('select count(*) n from public.hub_pending_settlements where pending_id=$1', [p1]) === 1, re);
  var c5 = await collide([p1, q1], [p1, q1]);
  check('…and a double call after that answers "already" for both', c5.a.already === true && c5.b && c5.b.already === true, c5);

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
} catch (e) { failN++; console.error('ERROR', e && e.message); }
finally {
  try { if (A) { await A.end(); } } catch (e1) {}
  try { if (B) { await B.end(); } } catch (e2) {}
  try { if (X) { await X.end(); } } catch (e3) {}
  try { await server.stop(); } catch (e4) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e5) {}
}
process.exit(failN ? 1 : 0);
