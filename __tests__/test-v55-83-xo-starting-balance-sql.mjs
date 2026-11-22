// ═══════════════════════════════════════════════════════════════════════════
// v55.83-XO — sql/v55-83-XO-starting-balance.sql on a REAL Postgres 16 with TWO connections (Max, 21-22 Nov 2026:
// "i need to have a previous balance to nextrade that we will pay bills from" · "b- NEW EXPENSE WHEN USED AFTER 6/1/2026").
// The real stack is loaded first exactly as the WF test does (stub schema, RH … US, then WF), then XO twice.
// Acceptance: add, correction, over-correction refused, pay on / after 1 June works, pay before 1 June / before the as-of date /
// over the balance / overpaying a bill refused, both sources refused, the same click twice, WF functions + the kind constraint +
// party_money_entries unchanged by XO, browsers cannot run it, two people at once, and the report helper on the real rows.
// Needs embedded-postgres + pg: EMBEDDED_PG_DIR = a folder whose node_modules has them. Never touches Supabase.
// ═══════════════════════════════════════════════════════════════════════════
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
var dataDir = path.join(dir, 'data-xo-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
function client() { return new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1100))); }
async function q(c, sql, params) { try { var r = await c.query(sql, params || []); return { rows: (Array.isArray(r) ? r[r.length - 1] : r).rows }; } catch (e) { return { error: String(e.message || e) }; } }
var ACTOR = '11111111-1111-1111-1111-111111111111';
var NT = 'NextTrade Industries', RTM = 'RTM Capital';
var db, db2; var seq = 0; var click = 0;
try {
  console.log('XO — the starting balance with NextTrade / RTM (real Postgres 16, two connections)');
  await server.initialise(); await server.start();
  db = client(); await db.connect(); db2 = client(); await db2.connect();
  var loaded = [];
  async function load(f) { var r = await q(db, fs.readFileSync(path.join(root, f), 'utf8')); loaded.push([f, r.error || 'ok']); return r; }
  await load('__tests__/pg/stub-schema.sql');
  await db.query('DROP TABLE IF EXISTS public.wire_package_lines, public.wire_packages CASCADE');
  for (var role of ['service_role', 'anon', 'authenticated']) { await q(db, 'CREATE ROLE ' + role + ' NOLOGIN'); }
  for (var f of ['RH-wire-packages', 'RI-wire-simple', 'RL-wire-override-delete-reference', 'RZ-wire-ready-sent-paid', 'SP-funded-requests', 'TO-payment-guards', 'TV-repeating-bills', 'TW-company-books', 'TX-advances-fees', 'UB-company-transfers', 'UD-pay-nextrade', 'US-partial-wires']) { await load('sql/v55-83-' + f + '.sql'); }
  await q(db, 'ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS matched_invoice_id uuid, ADD COLUMN IF NOT EXISTS transfer_group_id uuid'); // live columns the WF guards read
  var wfRun = await load('sql/v55-83-WF-party-funds.sql');
  check('the stack under it loads (stub, RH … US, WF)', loaded.every(function (x) { return x[1] === 'ok'; }) && wfRun.rows && wfRun.rows.every(function (r) { return r.result === 'OK'; }), loaded);

  async function transfer(amount, party, date) { seq++; var r = await db.query("INSERT INTO public.bank_transactions (wave_business_id, account_id, direction, amount_abs, date, posted_date, pending, third_party_payer, name) VALUES ('KTC', 'A1', 'out', $1, $2, $2, false, $3, $4) RETURNING id", [amount, date || '2026-09-02', party, 'TRANSFER ' + seq]); return r.rows[0].id; }
  async function bill(total, via, extra) { seq++; var e = extra || {}; var r = await db.query("INSERT INTO public.vendor_bills (vendor_name, bill_number, bill_date, total_amount, record_status, paid_via, currency) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id", ['Vendor ' + seq, 'B-' + seq, e.date || '2026-06-05', total, e.status || 'active', via || null, e.currency || 'USD']); return r.rows[0].id; }
  function addCall(c, p) { click++; return q(c, 'SELECT public.hub_party_opening_add($1::jsonb) AS r', [JSON.stringify(Object.assign({ actor: ACTOR, request_id: 'ob-' + click, reason: 'NextTrade statement of 31 May 2026', visible_to_staff: false }, p))]); }
  function payCall(c, p) { click++; return q(c, 'SELECT public.hub_party_opening_pay($1::jsonb) AS r', [JSON.stringify(Object.assign({ actor: ACTOR, request_id: 'op-' + click, reference: 'NextTrade payment list 3', reason: 'paid from the old balance' }, p))]); }
  function bills(list) { return list.map(function (b) { return { bill_id: b[0], amount: b[1] }; }); }
  async function st(id) { return (await db.query('SELECT public.hub_party_opening_state($1) AS s', [id])).rows[0].s; }
  async function tst(txn) { return (await db.query('SELECT public.hub_party_transfer_state($1, NULL) AS s', [txn])).rows[0].s; }
  async function count(sql, params) { return Number((await db.query(sql, params || [])).rows[0].n); }

  // ── what exists BEFORE XO (nothing of it may change) ──
  var T1 = await transfer(10000, NT, '2026-09-02');
  await db.query("INSERT INTO public.party_money_entries (party, bucket, amount, kind, action_id, reason, created_by) VALUES ($1, 'advance', 75, 'opening_balance', gen_random_uuid(), 'before the Hub (UD)', $2)", [NT, ACTOR]);
  await db.query("INSERT INTO public.party_funding_transfers (bank_transaction_id, party, state, updated_by) VALUES ($1, $2, 'confirmed', $3)", [T1, NT, ACTOR]);
  await q(db, 'SELECT public.hub_party_fee($1::jsonb)', [JSON.stringify({ action: 'mark', party: NT, bank_transaction_id: T1, amount: 500, entry_date: '2026-09-20', reason: 'services', actor: ACTOR, request_id: 'pre-fee-1' })]);
  var FN = ['hub_party_transfer_state', 'wire_funding_summary', 'wire_request_send', 'wire_request_fee_change', 'hub_party_transfer_lock', 'hub_party_transfer_guard', 'hub_party_entry_rules', 'hub_party_transfer_set_state', 'hub_party_fee', 'hub_party_refund', 'hub_party_record_paid', 'hub_party_payment_route', 'hub_refund_line_only', 'hub_party_funds_installed',
    'hub_party_opening', 'hub_party_allocate', 'hub_party_money_append_only', 'hub_wire_line_pay', 'hub_bill_payment_cap', 'hub_bill_payment_final', 'hub_guard_bill_payment', 'hub_wire_line_cap', 'hub_bill_void_guard'];
  var defsSql = "SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY($1) ORDER BY 1, 2";
  var conSql = "SELECT conname, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.party_money_entries'::regclass ORDER BY 1";
  var entSql = "SELECT md5(string_agg(e::text, '|' ORDER BY e.id)) AS h, count(*)::int AS n FROM public.party_money_entries e";
  var trgSql = "SELECT t.tgname, c.relname, md5(pg_get_triggerdef(t.oid)) AS d FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND t.tgname NOT LIKE '%opening%' ORDER BY 2, 1";
  var defsBefore = (await db.query(defsSql, [FN])).rows; var conBefore = (await db.query(conSql)).rows; var entBefore = (await db.query(entSql)).rows[0]; var trgBefore = (await db.query(trgSql)).rows;
  var payBefore = (await db.query("SELECT md5(coalesce(string_agg(p::text, '|' ORDER BY p.id), '')) AS h FROM public.vendor_bill_payments p")).rows[0].h;
  var t1Before = await tst(T1);

  var xo = fs.readFileSync(path.join(root, 'sql/v55-83-XO-starting-balance.sql'), 'utf8');
  check('the XO script never DROPs a table and never redefines a WF / UD / US / TO function', !/DROP\s+TABLE/i.test(xo) && FN.every(function (n) { return xo.indexOf('FUNCTION public.' + n + '(') < 0; }) && !/party_money_entries_kind_check/.test(xo));
  var run1 = await q(db, xo); var run2 = await q(db, xo);
  check('the XO script runs, and runs again; its check says OK on every line (5)', !run1.error && !run2.error && run2.rows.length === 5 && run2.rows.every(function (r) { return r.result === 'OK'; }), [run1.error, run2.error, run2.rows]);
  var defsAfter = (await db.query(defsSql, [FN])).rows; var conAfter = (await db.query(conSql)).rows; var entAfter = (await db.query(entSql)).rows[0]; var trgAfter = (await db.query(trgSql)).rows;
  check('WF / UD / US / TO functions are NOT redefined by XO (' + defsBefore.length + ' definitions, same md5 before and after)', defsBefore.length >= FN.length && JSON.stringify(defsBefore) === JSON.stringify(defsAfter), [defsBefore.length, defsAfter.length]);
  check('the party_money_entries kind constraint (and every other constraint on it) is unchanged', JSON.stringify(conBefore) === JSON.stringify(conAfter) && conBefore.some(function (c) { return c.conname === 'party_money_entries_kind_check' && /fee_from_transfer/.test(c.d); }), [conBefore, conAfter]);
  check('party_money_entries rows unchanged (md5 of every row, same count)', entBefore.h === entAfter.h && entBefore.n === entAfter.n && entAfter.n === 2, [entBefore, entAfter]);
  check('every trigger that existed before is unchanged (XO only adds its own)', JSON.stringify(trgBefore) === JSON.stringify(trgAfter), [trgBefore.length, trgAfter.length]);
  check('existing bill payments unchanged (md5 of every row); the transfer calculation of an existing transfer is unchanged', (await db.query("SELECT md5(coalesce(string_agg(p::text, '|' ORDER BY p.id), '')) AS h FROM public.vendor_bill_payments p")).rows[0].h === payBefore && JSON.stringify(await tst(T1)) === JSON.stringify(t1Before), [t1Before, await tst(T1)]);
  var privs = (await db.query("SELECT has_function_privilege('authenticated', 'public.hub_party_opening_add(jsonb)', 'EXECUTE') AS a1, has_function_privilege('anon', 'public.hub_party_opening_add(jsonb)', 'EXECUTE') AS a2, has_function_privilege('authenticated', 'public.hub_party_opening_pay(jsonb)', 'EXECUTE') AS p1, has_function_privilege('anon', 'public.hub_party_opening_pay(jsonb)', 'EXECUTE') AS p2, has_function_privilege('anon', 'public.hub_party_opening_state(uuid)', 'EXECUTE') AS s1, has_function_privilege('authenticated', 'public.hub_party_opening_state(uuid)', 'EXECUTE') AS s2, has_table_privilege('anon', 'public.party_opening_balances', 'SELECT') AS t1, has_table_privilege('authenticated', 'public.party_opening_balances', 'SELECT') AS t2, has_table_privilege('service_role', 'public.party_opening_balances', 'INSERT') AS t3, has_function_privilege('service_role', 'public.hub_party_opening_pay(jsonb)', 'EXECUTE') AS sp, has_function_privilege('service_role', 'public.hub_party_opening_add(jsonb)', 'EXECUTE') AS sa")).rows[0];
  check('anon / authenticated cannot run add, pay or state and cannot read the table; the Hub server can run them but cannot write the table directly', !privs.a1 && !privs.a2 && !privs.p1 && !privs.p2 && !privs.s1 && !privs.s2 && !privs.t1 && !privs.t2 && !privs.t3 && privs.sp && privs.sa, privs);
  await db.query('SET ROLE authenticated'); var asUser = await q(db, 'SELECT public.hub_party_opening_add($1::jsonb) AS r', [JSON.stringify({ party: NT, amount: 1, as_of: '2026-05-01', reason: 'trying from the browser', visible_to_staff: true, actor: ACTOR, request_id: 'browser-1' })]); await db.query('RESET ROLE');
  check('… and really: as the browser role the call is refused', /permission denied/.test(asUser.error || ''), asUser);

  // ── ADD ──
  var a1 = await addCall(db, { party: NT, amount: 5000, as_of: '2026-05-15', reason: 'NextTrade statement of 15 May 2026: funds held for KTC', visible_to_staff: false });
  var O1 = a1.rows && a1.rows[0].r.id; var s1 = O1 && await st(O1);
  check('add: NextTrade 5,000 as of 15 May 2026 — amount 5,000, used 0, held 5,000, hidden from staff', a1.rows && a1.rows[0].r.ok === true && s1.amount === 5000 && s1.used === 0 && s1.held === 5000 && s1.as_of === '2026-05-15' && s1.visible_to_staff === false && s1.party === NT, [a1, s1]);
  check('add: one audit row (who, amount, as-of, reason, visibility)', await count("SELECT count(*)::int AS n FROM public.hub_audit_log WHERE action = 'party_starting_balance' AND entity_id = $1 AND (details->>'amount')::numeric = 5000 AND details->>'visible_to_staff' = 'false'", [String(O1)]) === 1);
  var same = { party: NT, amount: 300, as_of: '2026-05-20', reason: 'second statement line, May 2026', visible_to_staff: true, actor: ACTOR, request_id: 'ob-same' };
  var d1 = await q(db, 'SELECT public.hub_party_opening_add($1::jsonb) AS r', [JSON.stringify(same)]); var d2 = await q(db, 'SELECT public.hub_party_opening_add($1::jsonb) AS r', [JSON.stringify(same)]);
  var d3 = await q(db, 'SELECT public.hub_party_opening_add($1::jsonb) AS r', [JSON.stringify(Object.assign({}, same, { amount: 301 }))]);
  check('add: the same click twice adds ONCE (second answer says repeat); the same click id for another amount is refused', d1.rows && d2.rows && d2.rows[0].r.repeat === true && d2.rows[0].r.id === d1.rows[0].r.id && /already used/.test(d3.error || '') && await count('SELECT count(*)::int AS n FROM public.party_opening_balances WHERE request_id = $1', ['ob-same']) === 1, [d1, d2, d3]);
  var O2 = d1.rows[0].r.id;
  var bad = [await addCall(db, { party: NT, amount: 100, as_of: '2026-05-01', reason: 'too short' }), await addCall(db, { party: NT, amount: 100, as_of: '2999-01-01' }), await addCall(db, { party: 'Somebody Else', amount: 100, as_of: '2026-05-01' }),
    await addCall(db, { party: NT, amount: 100, as_of: '2026-05-01', visible_to_staff: null }), await addCall(db, { party: NT, amount: 100, as_of: '', reason: 'no date given for it' }), await addCall(db, { party: NT, amount: 100, as_of: '2026-05-01', corrects_id: O1 }),
    await addCall(db, { party: NT, amount: -100 }), await addCall(db, { party: NT, amount: 0, as_of: '2026-05-01' })];
  var badWords = [/at least 10/, /future/, /unknown company/, /staff may see/, /as of/, /only a minus amount/, /pick the starting balance it corrects/, /type the amount/];
  check('add refuses: a reason under 10 characters, a future date, an unknown company, no visibility answer, no as-of date, a plus amount naming a balance, a minus amount naming none, zero', bad.every(function (x, i) { return badWords[i].test(x.error || ''); }) && await count('SELECT count(*)::int AS n FROM public.party_opening_balances') === 2, bad.map(function (x) { return x.error; }));
  var dIns = await q(db, "INSERT INTO public.party_opening_balances (party, amount, as_of, reason, visible_to_staff, request_id, created_by) VALUES ('Nobody', 10, '2026-05-01', 'written straight in', true, 'direct-1', $1)", [ACTOR]);
  check('a row written straight into the table for an unknown company is refused by the table itself', /unknown company/.test(dIns.error || ''), dIns);

  // ── CORRECTION ──
  var c1 = await addCall(db, { party: NT, amount: -500, corrects_id: O1, reason: 'statement re-checked: 4,500 not 5,000' });
  var cRow = c1.rows && (await db.query('SELECT as_of::text AS d, visible_to_staff AS v FROM public.party_opening_balances WHERE id = $1', [c1.rows[0].r.id])).rows[0];
  check('correction: −500 naming the balance → amount 4,500 (original 5,000, corrections −500); the correction takes the balance\'s as-of date and visibility', c1.rows && c1.rows[0].r.action === 'opening_correct' && (await st(O1)).amount === 4500 && (await st(O1)).original === 5000 && (await st(O1)).corrections === -500 && cRow.d === '2026-05-15' && cRow.v === false, [c1, await st(O1), cRow]);
  check('… the state asked through the correction\'s own id answers for the balance', (await st(c1.rows[0].r.id)).id === O1 && (await st(c1.rows[0].r.id)).amount === 4500);
  var cBadParty = await addCall(db, { party: RTM, amount: -10, corrects_id: O1, reason: 'wrong company correction' });
  var cOfCorr = await addCall(db, { party: NT, amount: -10, corrects_id: c1.rows[0].r.id, reason: 'correcting a correction' });
  var cTooMuch = await addCall(db, { party: NT, amount: -4600, corrects_id: O1, reason: 'more than the balance itself' });
  check('correction refused: against another company\'s balance, naming a correction, taking the balance below zero', /same company/.test(cBadParty.error || '') && /same company/.test(cOfCorr.error || '') && /already used|at most/.test(cTooMuch.error || '') && (await st(O1)).amount === 4500, [cBadParty.error, cOfCorr.error, cTooMuch.error]);
  var upd = await q(db, 'UPDATE public.party_opening_balances SET amount = 1 WHERE id = $1', [O1]); var del = await q(db, 'DELETE FROM public.party_opening_balances WHERE id = $1', [O2]); var trn = await q(db, 'TRUNCATE public.party_opening_balances CASCADE');
  check('append-only: a starting balance cannot be edited, deleted or truncated', /never changed or deleted/.test(upd.error || '') && /never changed or deleted/.test(del.error || '') && /never changed or deleted/.test(trn.error || '') && await count('SELECT count(*)::int AS n FROM public.party_opening_balances') === 3, [upd.error, del.error, trn.error]);

  // ── PAY ──
  var B1 = await bill(1000, null); var B2 = await bill(800, NT); var B3 = await bill(5000, null); var BR = await bill(100, RTM); var BC = await bill(100, null, { currency: 'CAD' }); var BV = await bill(100, null, { status: 'void' });
  var p1 = await payCall(db, { party: NT, opening_id: O1, bills: bills([[B1, 600], [B2, 800]]), paid_date: '2026-06-15' });
  var pRows = (await db.query('SELECT bill_id, amount::float AS amount, paid_date::text AS d, bank_transaction_id, party_opening_id, method, request_id FROM public.vendor_bill_payments WHERE party_opening_id = $1 ORDER BY amount', [O1])).rows;
  check('pay on 15 June 2026: 600 of a 1,000 bill + an 800 bill → 2 payments carrying the starting balance, NO bank line, method rtm, the click id; used 1,400, held 3,100', p1.rows && p1.rows[0].r.ok === true && p1.rows[0].r.total === 1400 && pRows.length === 2 && pRows.every(function (r) { return r.party_opening_id === O1 && r.bank_transaction_id === null && r.method === 'rtm' && r.d === '2026-06-15' && !!r.request_id; }) && (await st(O1)).used === 1400 && (await st(O1)).held === 3100, [p1, pRows, await st(O1)]);
  check('… the bill that named no company is now marked paid through NextTrade; one audit row "used" with the reference', (await db.query('SELECT paid_via FROM public.vendor_bills WHERE id = $1', [B1])).rows[0].paid_via === NT && await count("SELECT count(*)::int AS n FROM public.hub_audit_log WHERE action = 'party_starting_balance_used' AND details->>'reference' = 'NextTrade payment list 3'") === 1);
  check('… no bank line, transfer, fee or ledger entry was touched (the transfer still holds the same)', JSON.stringify(await tst(T1)) === JSON.stringify(t1Before) && (await db.query(entSql)).rows[0].h === entBefore.h);
  var samePay = { actor: ACTOR, request_id: 'op-same', party: NT, opening_id: O1, bills: bills([[B1, 100]]), paid_date: '2026-06-16', reference: 'NT list 4', reason: 'same click test' };
  var sp1 = await q(db, 'SELECT public.hub_party_opening_pay($1::jsonb) AS r', [JSON.stringify(samePay)]); var sp2 = await q(db, 'SELECT public.hub_party_opening_pay($1::jsonb) AS r', [JSON.stringify(samePay)]);
  check('pay: the same click twice pays ONCE (repeat), used 1,500', sp1.rows && sp2.rows && sp2.rows[0].r.repeat === true && await count('SELECT count(*)::int AS n FROM public.vendor_bill_payments WHERE request_id = $1', ['op-same']) === 1 && (await st(O1)).used === 1500, [sp1, sp2]);
  var early = await payCall(db, { party: NT, opening_id: O1, bills: bills([[B1, 50]]), paid_date: '2026-05-31' });
  check('pay dated 31 May 2026 (before 1 June) is refused, nothing recorded', /1 June 2026/.test(early.error || '') && (await st(O1)).used === 1500, early);
  var aR = await addCall(db, { party: RTM, amount: 1000, as_of: '2026-07-01', reason: 'RTM balance at 1 July 2026', visible_to_staff: true }); var OR = aR.rows[0].r.id;
  var beforeAsOf = await payCall(db, { party: RTM, opening_id: OR, bills: bills([[BR, 50]]), paid_date: '2026-06-20' });
  check('pay dated before the balance\'s as-of date is refused (RTM as of 1 July, paid 20 June)', /as of 2026-07-01/.test(beforeAsOf.error || '') && (await st(OR)).used === 0, beforeAsOf);
  var future = await payCall(db, { party: NT, opening_id: O1, bills: bills([[B1, 50]]), paid_date: '2999-01-01' });
  check('pay dated in the future is refused', /future/.test(future.error || ''), future);
  var over = await payCall(db, { party: NT, opening_id: O1, bills: bills([[B3, 3001]]), paid_date: '2026-06-20' });
  check('pay over the balance (3,001 > 3,000 left) is refused, nothing recorded, the bill keeps no company mark', /only \$3,000\.00 is left/.test(over.error || '') && (await st(O1)).used === 1500 && (await db.query('SELECT paid_via FROM public.vendor_bills WHERE id = $1', [B3])).rows[0].paid_via === null, over);
  var overBill = await payCall(db, { party: NT, opening_id: O1, bills: bills([[B1, 301]]), paid_date: '2026-06-20' });
  check('overpaying a bill (301 > 300 open of the 1,000 bill) is refused', /only \$300\.00 open/.test(overBill.error || '') && (await st(O1)).used === 1500, overBill);
  var otherCo = await payCall(db, { party: NT, opening_id: O1, bills: bills([[BR, 50]]), paid_date: '2026-06-20' });
  var cad = await payCall(db, { party: NT, opening_id: O1, bills: bills([[BC, 50]]), paid_date: '2026-06-20' });
  var voidB = await payCall(db, { party: NT, opening_id: O1, bills: bills([[BV, 50]]), paid_date: '2026-06-20' });
  var twice = await payCall(db, { party: NT, opening_id: O1, bills: bills([[B1, 10], [B1, 10]]), paid_date: '2026-06-20' });
  var wrongCo = await payCall(db, { party: RTM, opening_id: O1, bills: bills([[BR, 10]]), paid_date: '2026-07-20' });
  var fromCorr = await payCall(db, { party: NT, opening_id: c1.rows[0].r.id, bills: bills([[B1, 10]]), paid_date: '2026-06-20' });
  var noRef = await payCall(db, { party: NT, opening_id: O1, bills: bills([[B1, 10]]), paid_date: '2026-06-20', reference: '' });
  check('pay refuses: a bill paid through RTM, a CAD bill, a void bill, the same bill twice, another company\'s balance, a correction row, no reference', /paid through RTM Capital/.test(otherCo.error || '') && /is in CAD/.test(cad.error || '') && /not active/.test(voidB.error || '') && /listed twice/.test(twice.error || '') && /not a starting balance with RTM/.test(wrongCo.error || '') && /not a starting balance with/.test(fromCorr.error || '') && /reference/.test(noRef.error || '') && (await st(O1)).used === 1500, [otherCo.error, cad.error, voidB.error, twice.error, wrongCo.error, fromCorr.error, noRef.error]);

  // ── the table-level rules (a payment written straight into the table, not through the function) ──
  var both = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id, party_opening_id, method, created_by) VALUES ($1, 10, '2026-09-10', $2, $3, 'rtm', $4)", [B1, T1, O1, ACTOR]);
  check('BOTH sources on one payment (a bank line AND a starting balance) is refused by the database', /EITHER from a bank line OR from a starting balance/.test(both.error || '') || /Wires → New/.test(both.error || ''), both);
  var B4 = await bill(500, NT);
  var bothPlain = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id, party_opening_id, method, created_by) VALUES ($1, 10, '2026-09-10', $2, $3, 'wire', $4)", [B4, await transfer(50, null, '2026-09-01'), O1, ACTOR]);
  check('… also on an ordinary bank line (not money sent to a company): refused, nothing recorded', /EITHER from a bank line OR from a starting balance/.test(bothPlain.error || '') && await count('SELECT count(*)::int AS n FROM public.vendor_bill_payments WHERE bill_id = $1', [B4]) === 0, bothPlain);
  var dEarly = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, party_opening_id, method, created_by) VALUES ($1, 10, '2026-05-20', $2, 'rtm', $3)", [B4, O1, ACTOR]);
  var B5 = await bill(5000, NT); var dOver = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, party_opening_id, method, created_by) VALUES ($1, 3001, '2026-06-20', $2, 'rtm', $3)", [B5, O1, ACTOR]);
  var dVia = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, party_opening_id, method, created_by) VALUES ($1, 10, '2026-06-20', $2, 'rtm', $3)", [B3, O1, ACTOR]);
  check('written straight into the table: dated before 1 June, more than the balance holds, or on a bill not marked paid through the company — each refused', /1 June 2026/.test(dEarly.error || '') && /more than the \$4,500\.00 starting balance/.test(dOver.error || '') && /not marked as paid through/.test(dVia.error || '') && (await st(O1)).used === 1500, [dEarly.error, dOver.error, dVia.error]);

  // ── over-correction once money is used ──
  var oc = await addCall(db, { party: NT, amount: -3001, corrects_id: O1, reason: 'too large a correction now' });
  check('over-correction refused: 4,500 − 3,001 = 1,499 would be below the 1,500 already used (plain message, nothing saved)', /already used/.test(oc.error || '') && /at most \$3,000\.00/.test(oc.error || '') && (await st(O1)).amount === 4500, oc);
  var ok3000 = await addCall(db, { party: NT, amount: -3000, corrects_id: O1, reason: 'down to exactly what was used' });
  check('… a correction down to exactly what is used is accepted (amount 1,500, held 0)', ok3000.rows && (await st(O1)).amount === 1500 && (await st(O1)).held === 0, [ok3000, await st(O1)]);
  var noLeft = await payCall(db, { party: NT, opening_id: O1, bills: bills([[B1, 0.01]]), paid_date: '2026-06-20' });
  check('… and nothing more can be paid from it', /only \$0\.00 is left/.test(noLeft.error || ''), noLeft);
  var pid = (await db.query('SELECT id FROM public.vendor_bill_payments WHERE party_opening_id = $1 AND bill_id = $2 ORDER BY amount DESC LIMIT 1', [O1, B2])).rows[0].id;
  var vd = await q(db, 'UPDATE public.vendor_bill_payments SET voided = true WHERE id = $1', [pid]);
  check('undoing a payment gives the money back to the balance (held 800)', !vd.error && (await st(O1)).held === 800 && (await st(O1)).used === 700, [vd, await st(O1)]);
  var addBank = await q(db, 'UPDATE public.vendor_bill_payments SET bank_transaction_id = $2 WHERE id = $1', [pid, T1]);
  check('a voided payment from a starting balance cannot be given a bank line too', /EITHER from a bank line OR/.test(addBank.error || '') || /Wires → New/.test(addBank.error || ''), addBank);

  // ── closed month ──
  await db.query("CREATE SCHEMA IF NOT EXISTS clickbooks_us; CREATE TABLE IF NOT EXISTS clickbooks_us.books (code text PRIMARY KEY, locked_through date); INSERT INTO clickbooks_us.books VALUES ('KTC_US', '2026-06-30') ON CONFLICT (code) DO UPDATE SET locked_through = EXCLUDED.locked_through;");
  var cm1 = await payCall(db, { party: NT, opening_id: O1, bills: bills([[B1, 100]]), paid_date: '2026-06-25' });
  var cm2 = await payCall(db, { party: NT, opening_id: O1, bills: bills([[B1, 100]]), paid_date: '2026-06-25', allow_closed: true });
  var cm3 = await payCall(db, { party: NT, opening_id: O1, bills: bills([[B1, 100]]), paid_date: '2026-07-02' });
  check('a pay dated inside a closed month is refused; allowed when the Hub server says the person may correct closed months; an open month is not affected', /closed month/.test(cm1.error || '') && cm2.rows && cm2.rows[0].r.ok === true && cm3.rows && cm3.rows[0].r.ok === true && (await st(O1)).used === 900, [cm1.error, cm2, cm3]);

  // ── two people at once ──
  async function race(firstFn, secondFn) {
    await db.query('BEGIN'); var a = await firstFn(db);
    var done = false; var b = null; var pb = secondFn(db2).then(function (r) { done = true; b = r; });
    await new Promise(function (r) { setTimeout(r, 700); }); var waited = !done;
    var cmt = await q(db, 'COMMIT'); if (cmt.error) { await q(db, 'ROLLBACK'); } await pb; return { a: a, b: b, waited: waited, commitError: cmt.error || null };
  }
  var aX = await addCall(db, { party: RTM, amount: 1000, as_of: '2026-08-01', reason: 'RTM balance, race test', visible_to_staff: true }); var OX = aX.rows[0].r.id;
  var XB1 = await bill(700, RTM); var XB2 = await bill(700, RTM);
  var r1 = await race(function (c) { return payCall(c, { party: RTM, opening_id: OX, bills: bills([[XB1, 700]]), paid_date: '2026-08-05' }); }, function (c) { return payCall(c, { party: RTM, opening_id: OX, bills: bills([[XB2, 700]]), paid_date: '2026-08-05' }); });
  check('two people pay 700 each from one 1,000 balance at the same moment: the second WAITS, then is refused; used 700, never 1,400', !r1.a.error && !r1.commitError && r1.waited && /only \$300\.00 is left/.test(r1.b.error || '') && (await st(OX)).used === 700, [r1, await st(OX)]);
  var r2 = await race(function (c) { return addCall(c, { party: RTM, amount: -300, corrects_id: OX, reason: 'correcting while paying' }); }, function (c) { return payCall(c, { party: RTM, opening_id: OX, bills: bills([[XB2, 300]]), paid_date: '2026-08-06' }); });
  check('a correction of the last 300 while someone pays 300 from it: one waits, only ONE succeeds, the balance never goes below what is used', r2.waited && ((!r2.a.error && !r2.commitError && !!r2.b.error) || (!!(r2.a.error || r2.commitError) && !r2.b.error)) && (await st(OX)).held >= 0, [r2, await st(OX)]);

  // ── the report helper on the REAL rows (Max's (b)) ──
  req(path.join(root, 'node_modules/sucrase/register'));
  var PF = req(path.join(root, 'src/lib/party-funds.js'));
  var obs = (await db.query("SELECT id, party, amount::float AS amount, as_of::text AS as_of, reason, visible_to_staff, corrects_id, created_at FROM public.party_opening_balances WHERE party = $1", [NT])).rows;
  var pys = (await db.query("SELECT id, bill_id, amount::float AS amount, paid_date::text AS paid_date, bank_transaction_id, party_opening_id, voided, method FROM public.vendor_bill_payments")).rows;
  var bls = (await db.query("SELECT id, vendor_name, bill_number, bill_date::text AS bill_date, category, total_amount::float AS total_amount, paid_via FROM public.vendor_bills")).rows;
  var bl = (await db.query("SELECT id, date::text AS date, amount_abs::float AS amount_abs, third_party_payer, direction, name FROM public.bank_transactions WHERE id = $1", [T1])).rows;
  var ens = (await db.query("SELECT id, party, bucket, kind, amount::float AS amount, bank_transaction_id, source_bank_transaction_id, wire_package_id, entry_date::text AS entry_date, reason FROM public.party_money_entries WHERE source_bank_transaction_id = $1", [T1])).rows;
  var dbO1 = await st(O1); var dbO2 = await st(O2);
  var rep = PF.partyFundsBreakdown({ parties: [{ name: NT }], bankLines: bl, pays: pys, bills: bls, requests: [], entries: ens, openings: obs, from: '2026-06-01', to: '2026-06-30' })[0];
  var sb1 = rep.starting_balances.filter(function (x) { return x.id === O1; })[0];
  check('REPORT from the real rows: the starting balance agrees with the database (amount, used, held) and is listed as a starting balance', sb1 && sb1.amount === dbO1.amount && sb1.current.used === dbO1.used && sb1.current.held === dbO1.held && rep.starting_balances.length === 2 && rep.current.starting_balance_held === Math.round((dbO1.held + dbO2.held) * 100) / 100, [sb1, dbO1, dbO2, rep.current]);
  check('REPORT: its payments are NOT "paid without a transfer"', rep.paid_without_a_transfer.lifetime_rows.every(function (r) { return !pys.some(function (p) { return p.id === r.payment_id && p.party_opening_id; }); }) && rep.paid_without_a_transfer.lifetime_rows.length === 0, rep.paid_without_a_transfer);
  check('REPORT June 2026: funds sent 0 (a starting balance is never money sent); tax line = the 800 of bills paid from it in June (15 June 600 + 16 June 100 + 25 June 100) — Max\'s (b)', rep.period.funds_sent === 0 && rep.period.from_starting_balance === 800 && rep.period.tax_professional_fees === 800 && rep.period.tax_from_starting_balance === 800, rep.period);
  var repJul = PF.partyFundsBreakdown({ parties: [{ name: NT }], bankLines: bl, pays: pys, bills: bls, requests: [], entries: ens, openings: obs, from: '2026-07-01', to: '2026-07-31' })[0];
  var repSep = PF.partyFundsBreakdown({ parties: [{ name: NT }], bankLines: bl, pays: pys, bills: bls, requests: [], entries: ens, openings: obs, from: '2026-09-01', to: '2026-09-30' })[0];
  check('REPORT July: tax 100 (the 2 July use); September: tax = the 10,000 transfer only (no use from the starting balance then); the sums agree', repJul.period.tax_professional_fees === 100 && repJul.period.funds_sent === 0 && repSep.period.tax_professional_fees === 10000 && repSep.period.from_starting_balance === 0 && rep.arithmetic_ok && repJul.arithmetic_ok && repSep.arithmetic_ok, [repJul.period, repSep.period]);
} catch (e) { failN++; console.log('CRASHED: ' + (e && e.stack || e)); }
finally { try { await db.end(); } catch (e) {} try { await db2.end(); } catch (e) {} try { await server.stop(); } catch (e) {} try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {} }
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
