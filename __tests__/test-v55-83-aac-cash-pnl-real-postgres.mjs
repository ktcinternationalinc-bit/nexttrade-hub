// ═════════════════════════════════════════════════════════════════
// ClickBooks cash-basis P&L — REAL Postgres run (PGlite). Loads the REAL script sql/v55-83-AAC-cash-basis-pnl.sql on top of a
// minimal stub of the clickbooks_us tables it reads, then RUNS clickbooks_us.report_profit_loss_cash and the dispatcher with
// synthetic data only. Needs @electric-sql/pglite: set PGLITE_DIR (not a project dependency). Never touches Supabase.
// ═════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var req = createRequire(path.join(process.env.PGLITE_DIR || root, 'package.json'));
var PGlite;
try { PGlite = (await import('file://' + req.resolve('@electric-sql/pglite').replace(/\\/g, '/'))).PGlite; }
catch (e) { console.log('SKIPPED — @electric-sql/pglite not found (set PGLITE_DIR). Nothing was checked.'); process.exit(2); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('Cash-basis P&L — real Postgres (PGlite)');
var STUBS = `
 do $$ begin begin create role anon nologin; exception when others then null; end; begin create role authenticated nologin; exception when others then null; end; begin create role service_role nologin; exception when others then null; end; end $$;
 create schema clickbooks_us;
 create table clickbooks_us.books (id uuid primary key default gen_random_uuid(), code text unique not null);
 create table clickbooks_us.accounts (id uuid primary key default gen_random_uuid(), book_id uuid not null, code text not null, name text not null, account_type text not null);
 create table clickbooks_us.journals (id uuid primary key default gen_random_uuid(), book_id uuid not null, entry_date date not null, status text not null default 'posted', source_kind text not null, source_id text not null, reverses_id uuid);
 create table clickbooks_us.journal_lines (journal_id uuid not null, line_no int not null, account_id uuid not null, debit_cents bigint not null default 0, credit_cents bigint not null default 0, primary key (journal_id, line_no));
 create table clickbooks_us.posting_defaults (book_id uuid primary key, invoice_income_account_id uuid);
 create function clickbooks_us.reporting_readiness() returns jsonb language sql stable as $f$ select '{"stub":true}'::jsonb $f$;
 create function clickbooks_us.report_profit_loss(date, date) returns jsonb language sql stable as $f$ select '{"report":"profit_loss"}'::jsonb $f$;
 create function clickbooks_us.report_balance_sheet(date, boolean) returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
 create function clickbooks_us.report_trial_balance(date, boolean) returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
 create function clickbooks_us.report_general_ledger(date, date, boolean) returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
 create function clickbooks_us.report_tax_summary(date, date) returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
 create function clickbooks_us.report_cash_flow(date, date, boolean) returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
 create function clickbooks_us.report_bank_reconciliation(date, boolean) returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
 create table public.accounting_invoice_payments (id uuid primary key default gen_random_uuid(), accounting_invoice_id uuid, amount numeric, voided boolean default false);
`;
async function freshDb() { var d = new PGlite(); await d.exec(STUBS); await d.exec(fs.readFileSync(path.join(root, 'sql/v55-83-AAC-cash-basis-pnl.sql'), 'utf8')); return d; }
var db = new PGlite(); await db.exec(STUBS);
var e = null; try { await db.exec(fs.readFileSync(path.join(root, 'sql/v55-83-AAC-cash-basis-pnl.sql'), 'utf8')); } catch (x) { e = String(x.message || x); }
check('script sql/v55-83-AAC-cash-basis-pnl.sql runs', !e, e);
var e2 = null; try { await db.exec(fs.readFileSync(path.join(root, 'sql/v55-83-AAC-cash-basis-pnl.sql'), 'utf8')); } catch (x) { e2 = String(x.message || x); }
check('script runs again (safe to re-run)', !e2, e2);
async function one(sql, p) { return (await db.query(sql, p || [])).rows[0]; }
var B = (await one("insert into clickbooks_us.books(code) values ('KTC_US') returning id")).id;
async function acct(code, name, t) { return (await one('insert into clickbooks_us.accounts(book_id,code,name,account_type) values ($1,$2,$3,$4) returning id', [B, code, name, t])).id; }
var AR = await acct('1100', 'Accounts Receivable', 'asset'), AP = await acct('2000', 'Accounts Payable', 'liability'), DUE = await acct('2100', 'Due to related company', 'liability'), FRT = await acct('6100', 'Freight', 'expense'), BANK = await acct('1000', 'Bank', 'asset'), SALES = await acct('4000', 'Sales', 'income'), PROD = await acct('4010', 'Product Sales', 'income'),
  DISC = await acct('4090', 'Sales Discounts', 'income'), DEF = await acct('4999', 'Default invoice income', 'income'), EXP = await acct('6000', 'Bank fees', 'expense'), OTH = await acct('4500', 'Other income', 'income');
await db.query('insert into clickbooks_us.posting_defaults values ($1,$2)', [B, DEF]);
async function jr(date, kind, sid, lines, reverses) { var j = (await one('insert into clickbooks_us.journals(book_id,entry_date,source_kind,source_id,reverses_id) values ($1,$2,$3,$4,$5) returning id', [B, date, kind, sid, reverses || null])).id; var n = 0; for (var l of lines) { n++; await db.query('insert into clickbooks_us.journal_lines values ($1,$2,$3,$4,$5)', [j, n, l[0], l[1], l[2]]); } return j; }
async function invoice(date, id, parts) { var tot = parts.reduce((s, p) => s + p[1], 0); return jr(date, 'accounting_invoice', id, [[AR, tot, 0]].concat(parts.map(p => p[1] >= 0 ? [p[0], 0, p[1]] : [p[0], -p[1], 0]))); }
async function payment(date, invId, amt) { var p = (await one('insert into public.accounting_invoice_payments(accounting_invoice_id, amount) values ($1,$2) returning id', [invId, amt / 100])).id; await jr(date, 'accounting_invoice_payment', p, [[BANK, amt, 0], [AR, 0, amt]]); return p; }
var I1 = '00000000-0000-0000-0000-000000000001', I2 = '00000000-0000-0000-0000-000000000002', I3 = '00000000-0000-0000-0000-000000000003', I4 = '00000000-0000-0000-0000-000000000004', I5 = '00000000-0000-0000-0000-000000000005';
// F1 invoice Dec 2024: 600 Sales + 400 Product Sales, paid 500 Jan + 500 Feb 2025
await invoice('2024-12-10', I1, [[SALES, 60000], [PROD, 40000]]); await payment('2025-01-15', I1, 50000); await payment('2025-02-15', I1, 50000);
// F2 invoice 2025 unpaid (accrual income, no cash)
await invoice('2025-03-01', I2, [[SALES, 77700]]);
// F3 payment 2025 later voided (reversed) -> excluded
await invoice('2025-03-05', I3, [[SALES, 20000], [DISC, -2000]]); var vpj = (await one("select id from clickbooks_us.journals where source_id=$1", [await payment('2025-03-10', I3, 18000)])).id;
await jr('2025-03-11', 'reversal', 'rev-' + vpj, [[AR, 18000, 0], [BANK, 0, 18000]], vpj);
// F4 invoice reversed and re-posted with a new composition; payment uses the live one
var old4 = await invoice('2025-04-01', I4, [[SALES, 10000]]); await jr('2025-04-02', 'reversal', 'rev-' + old4, [[SALES, 10000, 0], [AR, 0, 10000]], old4);
await jr('2025-04-02', 'accounting_invoice', I4 + ':r1', [[AR, 10000, 0], [PROD, 0, 10000]]); await payment('2025-04-20', I4, 10000);
// F5 direct bank expense 50.00 and direct other income 12.34
await jr('2025-05-01', 'bank_transaction', 'b1', [[EXP, 5000, 0], [BANK, 0, 5000]]); await jr('2025-05-02', 'bank_transaction', 'b2', [[BANK, 1234, 0], [OTH, 0, 1234]]);
// F6 manual A/R credit 70.00 not linked to any invoice -> not counted, reported
await jr('2025-05-03', 'manual', 'm1', [[BANK, 7000, 0], [AR, 0, 7000]]);
// F7 payment for an invoice that has no journal in the book (issued before the opening) -> default income account
await payment('2025-06-01', '00000000-0000-0000-0000-0000000000aa', 25000);
// F8 rounding: invoice 100.00 = 33.33 + 33.33 + 33.34, payment 50.00 -> exactly 50.00
await invoice('2025-07-01', I5, [[SALES, 3333], [PROD, 3333], [OTH, 3334]]); await payment('2025-07-02', I5, 5000);
// F9 opening-balance journal never counts
await jr('2024-12-31', 'opening_balance', 'open', [[BANK, 99999, 0], [OTH, 0, 99999]]);
// F10 (Codex AAC-01) unpaid vendor bill: expense / Accounts payable, never paid -> NOT a cash expense
await jr('2025-08-01', 'manual', 'apbill:B1', [[FRT, 10000, 0], [AP, 0, 10000]]);
// F11 bill 100 (Aug 2025) paid 40 in Sep 2025 and 60 in Jan 2026: the bank line carries the expense, 'appay:' takes the accrual back off
await jr('2025-08-05', 'manual', 'apbill:B2', [[FRT, 10000, 0], [AP, 0, 10000]]);
await jr('2025-09-10', 'bank_transaction', 'bk-p1', [[FRT, 4000, 0], [BANK, 0, 4000]]); await jr('2025-09-10', 'manual', 'appay:P1', [[AP, 4000, 0], [FRT, 0, 4000]]);
await jr('2026-01-12', 'bank_transaction', 'bk-p2', [[FRT, 6000, 0], [BANK, 0, 6000]]); await jr('2026-01-12', 'manual', 'appay:P2', [[AP, 6000, 0], [FRT, 0, 6000]]);
// F12 payable settled through a related company (no expense line): not counted, reported
await jr('2025-10-01', 'manual', 'affbill:A1', [[AP, 5000, 0], [DUE, 0, 5000]]);
async function rep(f, t) { return (await one("select clickbooks_us.report_profit_loss_cash($1,$2) r", [f, t])).r; }
var y = await rep('2025-01-01', '2025-12-31'); var by = {}; y.rows.forEach(r => by[r.code] = Number(r.amountCents));
check('F1 Dec-2024 invoice paid in 2025 counts in 2025 (Sales 600 + 15/30 of F8)', by['4000'] === 60000 + 1667, by);
check('F1+F4+F8: Product Sales = 400 (F1) + 100 (F4 re-posted composition) + 16.67 (F8)', by['4010'] === 40000 + 10000 + 1667, by);
check('F2 unpaid 2025 invoice adds nothing; F3 voided payment adds nothing (no Sales Discounts row)', by['4090'] === undefined, by);
check('F5 direct expense 50.00 counts', by['6000'] === 5000, by);
check('F5+F8 other income = 12.34 direct + 16.66 (largest line takes the -0.01 rounding remainder of the 50.00 payment)', by['4500'] === 1234 + 1666, by);
check('F7 payment for an invoice outside the book goes to the reviewed default income account', by['4999'] === 25000 && y.notes.paymentsDefaultIncome === 1, { by, n: y.notes });
check('F8 the 50.00 payment is counted to the cent across its 3 lines (16.67 + 16.67 + 16.66)', (by['4000'] - 60000) + (by['4010'] - 50000) + (by['4500'] - 1234) === 5000, by);
check('F6 unlinked A/R credit is not income and is reported for review', y.notes.unlinkedReceivables === 1 && Number(y.notes.unlinkedReceivablesCents) === 7000, y.notes);
check('F9 opening balance never counts', !Object.values(by).includes(99999));
check('F10+F11 unpaid bill is not cash; the bill paid 40 in 2025 counts 40 (through its bank line)', by['6100'] === 4000, by);
var sep = await rep('2025-09-01', '2025-09-30'); var bs = {}; sep.rows.forEach(r => bs[r.code] = Number(r.amountCents));
check('F11 September: only the 40 paid that month', bs['6100'] === 4000, bs);
var aug = await rep('2025-08-01', '2025-08-31'); var ba = {}; aug.rows.forEach(r => ba[r.code] = Number(r.amountCents));
check('F10/F11 August (bills received, nothing paid): no freight expense', ba['6100'] === undefined, ba);
var y26 = await rep('2026-01-01', '2026-12-31'); var b26 = {}; y26.rows.forEach(r => b26[r.code] = Number(r.amountCents));
check('F11 2026: the balance 60 paid in January counts in 2026, once', b26['6100'] === 6000, b26);
check('bill entries left out are counted in notes (2025: 2 bills + 1 take-back)', y.notes.billEntriesLeftOut === 3, y.notes);
check('F12 payable settled through a related company is not counted and is reported', y.notes.payablesNotCounted === 1 && Number(y.notes.payablesNotCountedCents) === 5000, y.notes);
var totalIn = Object.entries(by).filter(([k]) => k.startsWith('4')).reduce((s, [, v]) => s + v, 0);
check('revenue = sum of income rows', Number(y.revenueCents) === totalIn, { rev: y.revenueCents, totalIn });
check('net = revenue - expense', Number(y.netIncomeCents) === Number(y.revenueCents) - Number(y.expenseCents), y);
var jan = await rep('2025-01-01', '2025-01-31'); var bj = {}; jan.rows.forEach(r => bj[r.code] = Number(r.amountCents));
check('partial payment in January: 300 Sales / 200 Product Sales only', bj['4000'] === 30000 && bj['4010'] === 20000 && Object.keys(bj).length === 2, bj);
var y24 = await rep('2024-01-01', '2024-12-31');
check('2024: invoice issued but unpaid -> no cash income', y24.rows.length === 0, y24.rows);
check('basis is labelled cash', y.basis === 'cash' && y.report === 'profit_loss_cash');
var d = (await one("select public.clickbooks_us_report_read('profit_loss_cash','2025-01-01','2025-12-31') r")).r;
check('dispatcher routes profit_loss_cash', d.report === 'profit_loss_cash' && Number(d.netIncomeCents) === Number(y.netIncomeCents));
var d2 = (await one("select public.clickbooks_us_report_read('profit_loss','2025-01-01','2025-12-31') r")).r;
check('dispatcher still routes accrual profit_loss unchanged', d2.report === 'profit_loss');
var bad = null; try { await db.query("select public.clickbooks_us_report_read('nope','2025-01-01','2025-12-31')"); } catch (x) { bad = String(x.message); }
check('unknown report still refused', /CB_UNKNOWN_REPORT/.test(bad || ''), bad);
var per = null; try { await db.query("select clickbooks_us.report_profit_loss_cash('2025-02-01','2025-01-01')"); } catch (x) { per = String(x.message); }
check('bad period refused', /CB_REPORT_PERIOD/.test(per || ''), per);
var acl = await one("select coalesce(proacl::text,'') a from pg_proc where proname='report_profit_loss_cash'");
check('cash function not executable by anon/authenticated/service_role', !/anon=|authenticated=|service_role=/.test(acl.a), acl.a);
// AAC-02 (Codex 13:52): a fresh book whose only receivable is the opening one, collected with no invoice journal in the book
var db2 = await freshDb(); async function one2(sql, p) { return (await db2.query(sql, p || [])).rows[0]; }
var B2 = (await one2("insert into clickbooks_us.books(code) values ('KTC_US') returning id")).id;
async function acct2(code, name, t) { return (await one2('insert into clickbooks_us.accounts(book_id,code,name,account_type) values ($1,$2,$3,$4) returning id', [B2, code, name, t])).id; }
var AR2 = await acct2('1100', 'Accounts Receivable', 'asset'), BK2 = await acct2('1000', 'Bank', 'asset'), EQ2 = await acct2('3000', 'Opening equity', 'equity'), DEF2 = await acct2('4999', 'Default invoice income', 'income');
await db2.query('insert into clickbooks_us.posting_defaults values ($1,$2)', [B2, DEF2]);
async function jr2(date, kind, sid, lines) { var j = (await one2('insert into clickbooks_us.journals(book_id,entry_date,source_kind,source_id) values ($1,$2,$3,$4) returning id', [B2, date, kind, sid])).id; var n = 0; for (var l of lines) { n++; await db2.query('insert into clickbooks_us.journal_lines values ($1,$2,$3,$4,$5)', [j, n, l[0], l[1], l[2]]); } }
await jr2('2026-10-31', 'opening_balance', 'open', [[AR2, 10000, 0], [EQ2, 0, 10000]]);
var pay2 = (await one2('insert into public.accounting_invoice_payments(accounting_invoice_id, amount) values ($1, 100) returning id', ['00000000-0000-0000-0000-0000000000bb'])).id;
await jr2('2026-11-10', 'accounting_invoice_payment', pay2, [[BK2, 10000, 0], [AR2, 0, 10000]]);
await jr2('2026-11-12', 'bank_transaction', 'bk-unlinked', [[BK2, 2500, 0], [AR2, 0, 2500]]);
var r2 = (await one2("select clickbooks_us.report_profit_loss_cash('2026-11-01','2026-11-30') r")).r; var b2r = {}; r2.rows.forEach(r => b2r[r.code] = Number(r.amountCents));
check('AAC-02 fresh book, opening receivable collected, no invoice journal: the 100 is counted in the default income account', b2r['4999'] === 10000 && r2.notes.invoicePayments === 1 && r2.notes.paymentsDefaultIncome === 1, { b2r, n: r2.notes });
check('AAC-02 a bank receipt against receivables with no invoice link is reported, not dropped silently', r2.notes.unlinkedReceivables === 1 && Number(r2.notes.unlinkedReceivablesCents) === 2500, r2.notes);
check('AAC-02 receivables account found by its engine code', r2.notes.receivablesAccountMissing === false, r2.notes);
console.log('\n' + pass + ' passed, ' + failN + ' failed'); process.exit(failN ? 1 : 0);
