// v55.83-XN — Codex 22 Nov 08:36 P2: XN must not touch the WF funding schema. REAL Postgres 16 (embedded), the full stack
// (stub, RH … US) + WF, then XN — in BOTH orders of events Codex reproduced:
//   A. WF installed, a services-rendered fee already recorded, THEN XN (twice);
//   B. WF installed, XN installed before any fee, THEN the first fee.
// After XN: party_money_entries kind rule, existing entries and the WF / UD money functions are unchanged, and fee mark, fee
// reverse and money back (refund) still work. Plus: the cut-off skips a pre-June KTC bill that sits on an OPEN wire (real
// wire tables). Needs EMBEDDED_PG_DIR (embedded-postgres + pg). Never touches Supabase.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var dir = process.env.EMBEDDED_PG_DIR;
if (!dir) { console.log('SKIPPED — set EMBEDDED_PG_DIR. Nothing was checked.'); process.exit(2); }
var req = createRequire(path.join(dir, 'package.json'));
var EmbeddedPostgres, pg;
try { EmbeddedPostgres = (await import('file://' + req.resolve('embedded-postgres').replace(/\\/g, '/'))).default; pg = req('pg'); }
catch (e) { console.log('SKIPPED — embedded-postgres / pg not found in EMBEDDED_PG_DIR. Nothing was checked.'); process.exit(2); }
var dataDir = path.join(dir, 'data-xn-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
function client(dbName) { return new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: dbName || 'postgres' }); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1200))); }
async function q(c, sql, params) { try { var r = await c.query(sql, params || []); return { rows: (Array.isArray(r) ? r[r.length - 1] : r).rows }; } catch (e) { return { error: String(e.message || e) }; } }
var ACTOR = '11111111-1111-1111-1111-111111111111', S1 = '22222222-2222-4222-8222-222222222222', S2 = '33333333-3333-4333-8333-333333333333';
var NT = 'NextTrade Industries'; var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var XN = fs.readFileSync(path.join(root, 'sql/v55-83-XN-nextrade-june-cutoff.sql'), 'utf8');
var WF = fs.readFileSync(path.join(root, 'sql/v55-83-WF-party-funds.sql'), 'utf8');
var STACK = ['RH-wire-packages', 'RI-wire-simple', 'RL-wire-override-delete-reference', 'RZ-wire-ready-sent-paid', 'SP-funded-requests', 'TO-payment-guards', 'TV-repeating-bills', 'TW-company-books', 'TX-advances-fees', 'UB-company-transfers', 'UD-pay-nextrade', 'US-partial-wires'];
var conns = [];
async function freshDb(name) {
  var admin = client(); await admin.connect(); await admin.query('CREATE DATABASE ' + name); await admin.end();
  var c = client(name); await c.connect(); conns.push(c);
  var bad = [];
  // roles belong to the whole server, so the second database must not create them again
  var stub = fs.readFileSync(path.join(here, 'pg/stub-schema.sql'), 'utf8').replace(/CREATE ROLE\s+(\w+)([^;]*);/gi, function (m, r) { return 'DO $r$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'' + r + '\') THEN ' + m + ' END IF; END $r$;'; });
  var s = await q(c, stub); if (s.error) { bad.push(['stub', s.error]); }
  await c.query('DROP TABLE IF EXISTS public.wire_package_lines, public.wire_packages CASCADE');
  for (var role of ['service_role', 'anon', 'authenticated']) { await q(c, 'CREATE ROLE ' + role + ' NOLOGIN'); }
  for (var f of STACK) { var r = await q(c, fs.readFileSync(path.join(root, 'sql/v55-83-' + f + '.sql'), 'utf8')); if (r.error) { bad.push([f, r.error]); } }
  await q(c, 'ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS matched_invoice_id uuid, ADD COLUMN IF NOT EXISTS transfer_group_id uuid');
  var w = await q(c, WF); if (w.error) { bad.push(['WF', w.error]); }
  return { c: c, bad: bad };
}
var seq = 0, click = 0;
async function transfer(c, amount, date) { seq++; return (await c.query("INSERT INTO public.bank_transactions (wave_business_id, account_id, direction, amount_abs, date, posted_date, pending, third_party_payer, name) VALUES ('KTC', 'A1', 'out', $1, $2, $2, false, $3, $4) RETURNING id", [amount, date, NT, 'WIRE TO NEXTRADE ' + seq])).rows[0].id; }
async function incoming(c, amount, date) { seq++; return (await c.query("INSERT INTO public.bank_transactions (wave_business_id, account_id, direction, amount_abs, date, posted_date, pending, name) VALUES ('KTC', 'A1', 'in', $1, $2, $2, false, $3) RETURNING id", [amount, date, 'MONEY BACK ' + seq])).rows[0].id; }
function confirm(c, txn) { return q(c, 'SELECT public.hub_party_transfer_set_state($1::jsonb) AS r', [JSON.stringify({ bank_transaction_id: txn, party: NT, state: 'confirmed', actor: ACTOR, note: 'test' })]); }
function fee(c, p) { click++; return q(c, 'SELECT public.hub_party_fee($1::jsonb) AS r', [JSON.stringify(Object.assign({ actor: ACTOR, request_id: 'xn-click-' + click, reason: 'services rendered', party: NT }, p))]); }
function refund(c, p) { click++; return q(c, 'SELECT public.hub_party_refund($1::jsonb) AS r', [JSON.stringify(Object.assign({ actor: ACTOR, request_id: 'xn-rf-' + click, reason: 'money returned by the company', party: NT }, p))]); }
async function snapshot(c) {
  var k = (await c.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'party_money_entries_kind_check'")).rows[0];
  var e = (await c.query("SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), '')) AS h, count(*)::int AS n FROM (SELECT id, party, bucket, amount, kind, bank_transaction_id, entry_date, reason FROM public.party_money_entries) x")).rows[0];
  var f = (await c.query("SELECT string_agg(p.proname || ':' || md5(pg_get_functiondef(p.oid)), ',' ORDER BY p.proname) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (p.proname LIKE 'hub_party_%' OR p.proname LIKE 'wire_%')")).rows[0];
  var cols = (await c.query("SELECT string_agg(column_name, ',' ORDER BY column_name) AS d FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'party_money_entries'")).rows[0];
  return { kind: k ? k.d : null, entries: e.h + '/' + e.n, funcs: f.d, cols: cols.d };
}
function ok(r) { return !!(r && r.rows && r.rows[0] && r.rows[0].r && r.rows[0].r.ok === true); }
try {
  console.log('XN × WF — the cut-off script leaves the WF funding schema alone (real Postgres 16, full stack)');
  check('XN script has no statement on party_money_entries, hub_party_requests or hub_party_pool_restricted (Codex 08:36)', !/party_money_entries|hub_party_requests|hub_party_pool_restricted/.test(XN));
  await server.initialise(); await server.start();

  // ── A: WF + an existing fee, then XN twice ──
  var A = await freshDb('xn_a'); var a = A.c;
  check('A: the stack (stub, RH … US) and WF load', A.bad.length === 0, A.bad);
  var TA = await transfer(a, 1000, '2026-09-02'); var cA = await confirm(a, TA);
  var fA1 = await fee(a, { action: 'mark', bank_transaction_id: TA, amount: 50, entry_date: '2026-09-20' });
  check('A: before XN, a confirmed $1,000 transfer gets a $50 services-rendered fee (WF)', ok(cA) && ok(fA1), [cA, fA1]);
  var beforeA = await snapshot(a);
  check('A: the kind rule before XN includes WF’s fee_from_transfer, fee_back_to_transfer and refund', /fee_from_transfer/.test(beforeA.kind || '') && /fee_back_to_transfer/.test(beforeA.kind || '') && /'refund'/.test(beforeA.kind || ''), beforeA.kind);
  var x1 = await q(a, XN); var x2 = await q(a, XN);
  check('A: XN installs over existing WF fee rows, and again (safe to re-run)', !x1.error && !x2.error, [x1.error, x2.error]);
  var afterA = await snapshot(a);
  check('A: after XN the kind rule, the entries, the columns and every hub_party_* / wire_* function are EXACTLY as before', JSON.stringify(beforeA) === JSON.stringify(afterA), { before: beforeA, after: afterA });
  var fA2 = await fee(a, { action: 'mark', bank_transaction_id: TA, amount: 30, entry_date: '2026-10-01' });
  var fA3 = await fee(a, { action: 'reverse', bank_transaction_id: TA, amount: 30, fee_id: fA2.rows && fA2.rows[0].r.entry_id, entry_date: '2026-10-02' });
  var INA = await incoming(a, 200, '2026-10-10'); var rA = await refund(a, { bank_transaction_id: TA, incoming_bank_transaction_id: INA, amount: 200 });
  check('A: after XN, a new fee, its reversal and money back (refund) all still work', ok(fA2) && ok(fA3) && ok(rA), [fA2, fA3, rA]);

  // ── B: WF, then XN before any fee, then the first fee ──
  var B = await freshDb('xn_b'); var b = B.c;
  check('B: the stack and WF load', B.bad.length === 0, B.bad);
  var beforeB = await snapshot(b);
  var y1 = await q(b, XN);
  var afterB = await snapshot(b);
  check('B: XN installs before any fee exists and changes nothing in the funding schema', !y1.error && JSON.stringify(beforeB) === JSON.stringify(afterB), [y1.error, beforeB, afterB]);
  var TB = await transfer(b, 1000, '2026-09-02'); var cB = await confirm(b, TB);
  var fB1 = await fee(b, { action: 'mark', bank_transaction_id: TB, amount: 50, entry_date: '2026-09-20' });
  var fB2 = await fee(b, { action: 'reverse', bank_transaction_id: TB, amount: 20, fee_id: fB1.rows && fB1.rows[0].r.entry_id, entry_date: '2026-09-21' });
  var INB = await incoming(b, 100, '2026-10-10'); var rB = await refund(b, { bank_transaction_id: TB, incoming_bank_transaction_id: INB, amount: 100 });
  check('B: the FIRST services-rendered fee after XN works, and so do its reversal and money back', ok(cB) && ok(fB1) && ok(fB2) && ok(rB), [cB, fB1, fB2, rB]);

  // ── the cut-off with REAL wire tables: a pre-June KTC bill on an open wire is left alone and named ──
  await b.query("INSERT INTO public.plaid_accounts VALUES ('NCHK','Nextrade checking','1795','depository','NEXTRADE_BOOKS',false)");
  await q(b, "INSERT INTO public.company_categories (company_id, key, label, kind, direction) VALUES ('NEXTRADE_BOOKS','supplies','Supplies','expense','out')");
  async function nline(amt, date) { return (await b.query("INSERT INTO public.bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) VALUES ('NEXTRADE_BOOKS','NCHK','out',$1,$2,'SUPPLIES CO') RETURNING id", [amt, date])).rows[0].id; }
  async function cat(id, date) { return (await b.query('SELECT public.hub_company_categorize($1::jsonb) AS r', [JSON.stringify({ line_id: id, company_id: 'NEXTRADE_BOOKS', category_key: 'supplies', actor: ACTOR, ktc_category: 'warehouse_supplies', party: NT, source: 'manual', bill: { wave_business_id: US, vendor_name: 'SUPPLIES CO', bill_number: 'NXT-' + String(id).substring(0, 8), bill_date: date, due_date: date, notes: 'Created from Nextrade' } })])).rows[0].r; }
  var W1 = await nline(410, '2026-04-11'); var W2 = await nline(120, '2026-05-12');
  var bw1 = (await cat(W1, '2026-04-11')).bill_id; var bw2 = (await cat(W2, '2026-05-12')).bill_id;
  var pk = (await q(b, "INSERT INTO public.wire_packages (payee_kind, payee_name, fee_amount, status, created_by, signoff1_by, signoff1_at, signoff2_by, signoff2_at) VALUES ('affiliate', $1, 0, 'draft', $2, $3, now(), $4, now()) RETURNING id", [NT, ACTOR, S1, S2]));
  var wl = pk.rows ? await q(b, 'INSERT INTO public.wire_package_lines (package_id, bill_id, amount) VALUES ($1, $2, 410) RETURNING id, is_open', [pk.rows[0].id, bw1]) : pk;
  check('wire setup: the 11 Apr KTC bill is on an OPEN wire line (real RH tables)', !!(wl.rows && wl.rows[0] && wl.rows[0].is_open === true), [pk, wl]);
  var on = (await b.query('SELECT public.hub_company_bill_cutoff($1::jsonb) AS r', [JSON.stringify({ actor: ACTOR, company_id: 'NEXTRADE_BOOKS', on: true, cutoff_date: '2026-06-01' })])).rows[0].r;
  var st1 = (await b.query('SELECT record_status FROM public.vendor_bills WHERE id = $1', [bw1])).rows[0].record_status; var st2 = (await b.query('SELECT record_status FROM public.vendor_bills WHERE id = $1', [bw2])).rows[0].record_status;
  check('ON: the bill on the open wire stays active and is named back ("it is on a wire"); the other pre-June bill is voided', st1 === 'active' && st2 === 'void' && on.count === 1 && on.kept.some(function (k) { return k.bill_id === bw1 && /on a wire/.test(k.why); }), { on: on, st1: st1, st2: st2 });
  var afterOn = await snapshot(b);
  check('… and the button itself writes nothing into the funding ledger (party_money_entries unchanged)', afterOn.entries === (await snapshot(b)).entries && afterOn.kind === beforeB.kind);
} catch (e) { failN++; console.log('  ✗ FAIL: crashed — ' + String(e && e.stack || e).substring(0, 800)); }
finally { for (var c of conns) { try { await c.end(); } catch (e) {} } try { await server.stop(); } catch (e) {} try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {} }
console.log('\nXN × WF: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
