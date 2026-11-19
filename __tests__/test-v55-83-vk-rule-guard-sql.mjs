// ═══════════════════════════════════════════════════════════════════════════
// v55.83-VK — sql/v55-83-VK-rule-apply-guard.sql on a REAL Postgres 16 with TWO connections (Codex 19 Nov 20:27, P1):
// a rule categorizes a line only if it is STILL waiting when the line is locked. A person's save that lands first
// survives, and no KTC bill is made, changed or voided by the rule.
// Loads the real stack: stub schema, RH, RI, RL, RZ, SP, TO, TV, TW, TX, UB, UD, then the VK script (twice).
// Needs embedded-postgres + pg: EMBEDDED_PG_DIR = a folder whose node_modules has them (not project dependencies).
// Never touches Supabase.
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
var dataDir = path.join(dir, 'data-vk-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
function client() { return new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
async function q(c, sql, params) { try { return { r: await c.query(sql, params || []) }; } catch (e) { return { error: String(e.message || e) }; } }
var ACTOR = '11111111-1111-1111-1111-111111111111';
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var db, db2;
try {
  console.log('VK — rule guard SQL on real Postgres 16 (two connections)');
  await server.initialise(); await server.start();
  db = client(); await db.connect(); db2 = client(); await db2.connect();
  var loaded = [];
  async function load(f) { var r = await q(db, fs.readFileSync(path.join(root, f), 'utf8')); loaded.push([f, r.error || 'ok']); }
  await load('__tests__/pg/stub-schema.sql');
  await db.query('DROP TABLE IF EXISTS public.wire_package_lines, public.wire_packages CASCADE');
  for (var role of ['service_role', 'anon', 'authenticated']) { await q(db, 'CREATE ROLE ' + role + ' NOLOGIN'); }
  for (var f of ['RH-wire-packages', 'RI-wire-simple', 'RL-wire-override-delete-reference', 'RZ-wire-ready-sent-paid', 'SP-funded-requests', 'TO-payment-guards', 'TV-repeating-bills', 'TW-company-books', 'TX-advances-fees', 'UB-company-transfers', 'UD-pay-nextrade']) { await load('sql/v55-83-' + f + '.sql'); }
  check('the stack under it loads (stub, RH … UD)', loaded.every(function (x) { return x[1] === 'ok'; }), loaded);
  var vk = fs.readFileSync(path.join(root, 'sql/v55-83-VK-rule-apply-guard.sql'), 'utf8');
  var before = (await db.query("SELECT pg_get_functiondef('public.hub_company_categorize(jsonb)'::regprocedure) AS d")).rows[0].d;
  var run1 = await q(db, vk); var run2 = await q(db, vk);
  var rows = run2.error ? [] : (Array.isArray(run2.r) ? run2.r[run2.r.length - 1] : run2.r).rows;
  check('the VK script runs, and runs again; its check says OK on both lines', !run1.error && !run2.error && rows.length === 2 && rows.every(function (r) { return r.result === 'OK'; }), [run1.error, run2.error, rows]);
  check('the existing categorize step is NOT changed by it (same definition, byte for byte)', (await db.query("SELECT pg_get_functiondef('public.hub_company_categorize(jsonb)'::regprocedure) AS d")).rows[0].d === before);
  check('the Hub can tell it is installed', (await db.query('SELECT public.hub_company_rule_guard_installed() AS ok')).rows[0].ok === true);
  var privs = (await db.query("SELECT has_function_privilege('authenticated', 'public.hub_company_categorize_if_open(jsonb)', 'EXECUTE') AS a, has_function_privilege('anon', 'public.hub_company_categorize_if_open(jsonb)', 'EXECUTE') AS b, has_function_privilege('service_role', 'public.hub_company_categorize_if_open(jsonb)', 'EXECUTE') AS s")).rows[0];
  check('browser roles cannot run it; the Hub server can', privs.a === false && privs.b === false && privs.s === true, privs);

  await db.query("INSERT INTO company_categories (company_id, key, label, kind) VALUES ('NEXTRADE_BOOKS','elec','Electricity','expense'), ('NEXTRADE_BOOKS','bankfee','Bank fee (no bill)','not_pnl'), ('RTM_BOOKS','rent','Rent','expense'), ('RTM_BOOKS','repairs','Repairs','expense') ON CONFLICT DO NOTHING");
  async function line(company, extra) {
    var e = extra || {};
    return (await db.query("INSERT INTO bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, pending, review_status) VALUES ($1,'A1','out',$2,'2026-11-17','CENTERPOINT ENERGY', $3, $4) RETURNING id", [company, e.amount || 100, e.pending === true, e.review || null])).rows[0].id;
  }
  function billOf(id) { return { wave_business_id: US, vendor_name: 'CenterPoint Energy', bill_number: 'NXT-20261117-' + String(id).substring(0, 6).toUpperCase(), bill_date: '2026-11-17', due_date: '2026-11-30', notes: 'Created from Nextrade' }; }
  function payload(id, company, key) { return JSON.stringify({ line_id: id, company_id: company, category_key: key, actor: ACTOR, ktc_category: 'utilities', party: 'NextTrade Industries', bill: billOf(id), source: 'rule' }); }
  async function rule(c, id, company, key) { var r = await q(c, 'SELECT public.hub_company_categorize_if_open($1::jsonb) AS r', [payload(id, company, key)]); return r.error ? { error: r.error } : r.r.rows[0].r; }
  async function manual(c, id, company, key) { var p = JSON.parse(payload(id, company, key)); p.source = 'manual'; var r = await q(c, 'SELECT public.hub_company_categorize($1::jsonb) AS r', [JSON.stringify(p)]); return r.error ? { error: r.error } : r.r.rows[0].r; }
  async function row(id) { return (await db.query('SELECT company_category, company_category_source FROM bank_transactions WHERE id = $1', [id])).rows[0]; }
  async function billsFor(id) { return (await db.query("SELECT b.record_status, l.status FROM company_bill_links l JOIN vendor_bills b ON b.id = l.bill_id WHERE l.source_bank_transaction_id = $1", [id])).rows; }

  // a line that is still waiting
  var R1 = await line('RTM_BOOKS'); var o1 = await rule(db, R1, 'RTM_BOOKS', 'rent');
  check('RTM: a waiting line is categorized by the rule (source rule)', o1.ok === true && !o1.skipped && (await row(R1)).company_category === 'rent' && (await row(R1)).company_category_source === 'rule', [o1, await row(R1)]);
  var N1 = await line('NEXTRADE_BOOKS', { amount: 412.5 }); var o2 = await rule(db, N1, 'NEXTRADE_BOOKS', 'elec'); var b2 = await billsFor(N1);
  check('Nextrade: a waiting expense line is categorized AND its KTC bill is made (one, active)', o2.ok === true && o2.action === 'created' && b2.length === 1 && b2[0].record_status === 'active' && b2[0].status === 'active', [o2, b2]);

  // not waiting any more → left exactly as it is
  var o3 = await rule(db, R1, 'RTM_BOOKS', 'repairs');
  check('a line that already has a category is LEFT ALONE (skipped: already_categorized)', o3.skipped === true && o3.why === 'already_categorized' && (await row(R1)).company_category === 'rent', o3);
  var o4 = await rule(db, N1, 'NEXTRADE_BOOKS', 'bankfee'); var b4 = await billsFor(N1);
  check('Nextrade: a rule can never void or change the KTC bill of a line that is already categorized', o4.skipped === true && (await row(N1)).company_category === 'elec' && b4.length === 1 && b4[0].record_status === 'active' && b4[0].status === 'active', [o4, b4]);
  var P1 = await line('RTM_BOOKS', { pending: true }); var o5 = await rule(db, P1, 'RTM_BOOKS', 'rent');
  check('a pending line is left alone', o5.skipped === true && o5.why === 'pending' && (await row(P1)).company_category === null, o5);
  var D1 = await line('RTM_BOOKS', { review: 'duplicate' }); var o6 = await rule(db, D1, 'RTM_BOOKS', 'rent');
  check('a line marked duplicate is left alone', o6.skipped === true && o6.why === 'duplicate' && (await row(D1)).company_category === null, o6);
  var T1 = await line('RTM_BOOKS'); await db.query('UPDATE bank_transactions SET transfer_group_id = gen_random_uuid() WHERE id = $1', [T1]); var o7 = await rule(db, T1, 'RTM_BOOKS', 'rent');
  check('a line paired as a transfer is left alone (no error, nothing changed)', o7.skipped === true && o7.why === 'paired_transfer' && (await row(T1)).company_category === null, o7);
  var X1 = await line('NEXTRADE_BOOKS'); var o8 = await rule(db, X1, 'RTM_BOOKS', 'rent');
  check('a line of the OTHER company is left alone', o8.skipped === true && o8.why === 'other_company' && (await row(X1)).company_category === null, o8);
  var o9 = await rule(db, '99999999-9999-4999-8999-999999999999', 'RTM_BOOKS', 'rent');
  check('a line that does not exist: skipped, no error', o9.skipped === true && o9.why === 'not_found', o9);
  var o10 = await rule(db, X1, 'NEXTRADE_BOOKS', '');
  check('a rule with no category is refused', !!o10.error && /must name a category/.test(o10.error), o10);
  var o11 = await rule(db, X1, 'KTC', 'elec');
  check('an unknown company is refused', !!o11.error && /which company/.test(o11.error), o11);
  var o12 = await rule(db, X1, 'NEXTRADE_BOOKS', 'no_such_category');
  check('a category the company does not have is refused by the ordinary step — the line stays waiting', !!o12.error && (await row(X1)).company_category === null, o12);

  // ── TWO SESSIONS: the person's save is in flight when the rule's write arrives ──
  async function race(company, manualKey, ruleKey) {
    var id = await line(company, { amount: 77.25 });
    await db.query('BEGIN'); var m = await manual(db, id, company, manualKey);       // session 1: the person saves, not committed yet
    var pending = rule(db2, id, company, ruleKey);                                    // session 2: the rule — must WAIT on the line's lock
    var waited = await Promise.race([pending.then(function () { return 'returned'; }), new Promise(function (res) { setTimeout(function () { res('waiting'); }, 700); })]);
    await db.query('COMMIT'); var r = await pending;
    return { id: id, manual: m, waited: waited, rule: r, row: await row(id), bills: await billsFor(id) };
  }
  var c1 = await race('RTM_BOOKS', 'repairs', 'rent');
  check('RTM race: the rule WAITS for the person\'s save, then leaves the line alone', c1.waited === 'waiting' && c1.rule.skipped === true && c1.rule.why === 'already_categorized', c1);
  check('RTM race: the person\'s category survives (repairs, source manual)', c1.row.company_category === 'repairs' && c1.row.company_category_source === 'manual', c1.row);
  var c2 = await race('NEXTRADE_BOOKS', 'bankfee', 'elec');
  check('Nextrade race: person picks a no-bill category, rule wants an expense → person wins, NO KTC bill exists', c2.waited === 'waiting' && c2.rule.skipped === true && c2.row.company_category === 'bankfee' && c2.row.company_category_source === 'manual' && c2.bills.length === 0, c2);
  var c3 = await race('NEXTRADE_BOOKS', 'elec', 'bankfee');
  check('Nextrade race: person picks an expense (bill made), rule wants a no-bill category → the bill stays ACTIVE, not voided', c3.rule.skipped === true && c3.row.company_category === 'elec' && c3.bills.length === 1 && c3.bills[0].record_status === 'active' && c3.bills[0].status === 'active', c3);
  // the other order: the rule first, then the person — the person still decides
  var Z = await line('NEXTRADE_BOOKS', { amount: 12 });
  await db2.query('BEGIN'); var zr = await rule(db2, Z, 'NEXTRADE_BOOKS', 'elec'); var zp = manual(db, Z, 'NEXTRADE_BOOKS', 'bankfee');
  var zw = await Promise.race([zp.then(function () { return 'returned'; }), new Promise(function (res) { setTimeout(function () { res('waiting'); }, 700); })]);
  await db2.query('COMMIT'); var zm = await zp; var zb = await billsFor(Z);
  check('other order (rule first, person second): the person waits, then their category stands and the rule\'s bill is voided by THEIR choice', zw === 'waiting' && zr.action === 'created' && zm.ok === true && (await row(Z)).company_category === 'bankfee' && zb.length === 1 && zb[0].record_status === 'void', [zr, zm, zb]);
  // two rule runs at once on one line: exactly one categorizes, one bill
  var Y = await line('NEXTRADE_BOOKS', { amount: 9 });
  var both = await Promise.all([rule(db, Y, 'NEXTRADE_BOOKS', 'elec'), rule(db2, Y, 'NEXTRADE_BOOKS', 'elec')]);
  check('two rule runs at the same moment: one categorizes, the other is skipped, ONE bill', both.filter(function (x) { return x.skipped === true; }).length === 1 && both.filter(function (x) { return x.action === 'created'; }).length === 1 && (await billsFor(Y)).length === 1, both);
  // a failure inside the ordinary step undoes everything the guarded call did
  var F = await line('NEXTRADE_BOOKS', { amount: 5 });
  await db.query("CREATE FUNCTION t_fail() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'injected link failure'; END $f$; CREATE TRIGGER t_fail BEFORE INSERT ON company_bill_links FOR EACH ROW EXECUTE FUNCTION t_fail();");
  var of = await rule(db, F, 'NEXTRADE_BOOKS', 'elec'); await db.query('DROP TRIGGER t_fail ON company_bill_links');
  check('a failure half-way (after the bill insert): error, the line is still waiting, no bill left behind', !!of.error && (await row(F)).company_category === null && Number((await db.query("SELECT count(*)::int AS n FROM vendor_bills WHERE bill_number = $1", [billOf(F).bill_number])).rows[0].n) === 0, of);
} catch (e) { failN++; console.log('CRASHED: ' + (e && e.stack || e)); }
finally { try { await db.end(); } catch (e) {} try { await db2.end(); } catch (e) {} try { await server.stop(); } catch (e) {} try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {} }
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
