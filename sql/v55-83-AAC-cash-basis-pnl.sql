-- v55.83-AAC — ClickBooks: Profit & Loss on CASH basis (Max 27 Nov 2026: "work exactly like Wave and QuickBooks … for tax reporting").
-- Adds clickbooks_us.report_profit_loss_cash and one new branch ('profit_loss_cash') in the report dispatcher. Nothing else changes:
-- the accrual report, every table, every posting function and every grant stay as they are. No data is written.
--
-- Rule (proven against Wave: KTC 2025 rebuilt to 947,812.89 = Wave cash, 36 accounts identical, 3 within cents):
--  * invoice income counts when a customer payment is received: each payment (journal source 'accounting_invoice_payment') is spread
--    over the income lines of the invoice it pays (that invoice's current, non-reversed 'accounting_invoice' journal), pro rata;
--    rounding remainder goes to the largest line, so every payment is counted to the cent;
--  * if the paid invoice has no journal in the book (issued before the book's opening), the payment goes to the reviewed default
--    invoice-income account (posting_defaults) and is counted in notes.paymentsDefaultIncome;
--  * journals with no line on an accounts-receivable account count as they are (direct bank categorisation);
--  * A/R movements that are neither invoices nor invoice payments are NOT counted; they are listed in notes.unlinkedReceivables for review;
--  * bills (Codex 13:52 AAC-01): a vendor bill is expense when PAID. The book records a bill as expense/Accounts payable ('apbill:'),
--    the payment's cost through its bank line (expense on the payment date) and an 'appay:' entry Accounts payable/expense that takes the
--    bill's accrual back off. So every journal with an Accounts payable line is left out of cash, and the bank line carries the expense
--    once, on the day it was paid. Accounts payable movements with no expense/income line (e.g. settled through a related company) are
--    NOT counted and are listed in notes.payablesNotCounted for review;
--  * reversed journals and their reversals cancel and are left out; opening-balance journals never count.
-- Accounts receivable (Codex 13:52 AAC-02) = the engine's receivables account (code 1100, as the posting functions use) PLUS any account
-- debited by a live 'accounting_invoice' journal, so a payment of an opening receivable is found even when the book has no invoice journal.
-- Accounts payable = the engine's payables account (code 2000, as clickbooks_us.payable_account uses).
create or replace function clickbooks_us.report_profit_loss_cash(p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare b uuid; rows jsonb; income bigint; expense bigint; notes jsonb; dflt uuid;
begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from > p_to or p_to - p_from > 3660 then raise exception 'CB_REPORT_PERIOD'; end if;
 select id into strict b from clickbooks_us.books where code = 'KTC_US';
 select d.invoice_income_account_id into dflt from clickbooks_us.posting_defaults d where d.book_id = b;
 with
 live_j as (  -- posted journals that still count: not reversed, not a reversal, not an opening
   select j.* from clickbooks_us.journals j
    where j.book_id = b and j.status = 'posted' and j.source_kind <> 'opening_balance' and j.reverses_id is null
      and not exists (select 1 from clickbooks_us.journals r where r.reverses_id = j.id and r.status = 'posted')),
 ar as (select a.id from clickbooks_us.accounts a where a.book_id = b and a.code = '1100'
         union select l.account_id from clickbooks_us.journal_lines l join live_j j on j.id = l.journal_id
         where j.source_kind = 'accounting_invoice' and l.debit_cents > 0),
 ap as (select a.id from clickbooks_us.accounts a where a.book_id = b and a.code = '2000'),
 inv as (  -- invoice composition: income lines of each invoice's live journal
   select split_part(j.source_id, ':', 1) invoice_id, l.account_id, sum(l.credit_cents - l.debit_cents) amt
     from live_j j join clickbooks_us.journal_lines l on l.journal_id = j.id join clickbooks_us.accounts a on a.id = l.account_id
    where j.source_kind = 'accounting_invoice' and a.account_type = 'income' group by 1, 2),
 inv_tot as (select invoice_id, sum(amt) tot from inv group by 1 having sum(amt) <> 0),
 pay as (  -- invoice payments received in the period (A/R credit of the payment journal)
   select j.id jid, j.source_id, sum(l.credit_cents - l.debit_cents) paid,
          (select p.accounting_invoice_id::text from public.accounting_invoice_payments p
            where split_part(j.source_id, ':', 1) ~ '^[0-9a-fA-F-]{36}$' and p.id = split_part(j.source_id, ':', 1)::uuid) invoice_id
     from live_j j join clickbooks_us.journal_lines l on l.journal_id = j.id
    where j.source_kind = 'accounting_invoice_payment' and j.entry_date between p_from and p_to and l.account_id in (select id from ar)
    group by 1, 2),
 alloc_raw as (
   select p.jid, i.account_id, round(p.paid::numeric * i.amt / t.tot)::bigint v, p.paid,
          row_number() over (partition by p.jid order by abs(i.amt) desc, i.account_id) rn
     from pay p join inv_tot t on t.invoice_id = p.invoice_id join inv i on i.invoice_id = p.invoice_id),
 alloc as (  -- remainder of each payment's rounding on its largest line
   select a.account_id, a.v + case when a.rn = 1 then a.paid - sum(a.v) over (partition by a.jid) else 0 end v from alloc_raw a),
 pay_default as (select p.paid from pay p where not exists (select 1 from inv_tot t where t.invoice_id = p.invoice_id)),
 direct as (
   select l.account_id, case when a.account_type = 'income' then l.credit_cents - l.debit_cents else l.debit_cents - l.credit_cents end v
     from live_j j join clickbooks_us.journal_lines l on l.journal_id = j.id join clickbooks_us.accounts a on a.id = l.account_id
    where j.entry_date between p_from and p_to and a.account_type in ('income', 'expense')
      and not exists (select 1 from clickbooks_us.journal_lines x where x.journal_id = j.id and (x.account_id in (select id from ar) or x.account_id in (select id from ap)))),
 bills_out as (  -- journals with an Accounts payable line: bill accruals / their take-back (not cash) and payables settled elsewhere
   select j.id, exists (select 1 from clickbooks_us.journal_lines x join clickbooks_us.accounts xa on xa.id = x.account_id
                         where x.journal_id = j.id and xa.account_type in ('income', 'expense')) has_pl,
          (select coalesce(sum(x.debit_cents - x.credit_cents), 0) from clickbooks_us.journal_lines x where x.journal_id = j.id and x.account_id in (select id from ap)) ap_net
     from live_j j
    where j.entry_date between p_from and p_to
      and exists (select 1 from clickbooks_us.journal_lines x where x.journal_id = j.id and x.account_id in (select id from ap))),
 unlinked as (
   select count(*) n, coalesce(sum(l.credit_cents - l.debit_cents), 0) amt
     from live_j j join clickbooks_us.journal_lines l on l.journal_id = j.id
    where j.entry_date between p_from and p_to and l.account_id in (select id from ar)
      and j.source_kind not in ('accounting_invoice', 'accounting_invoice_payment')),
 allrows as (
   select account_id, v from alloc
   union all select dflt, paid from pay_default where dflt is not null
   union all select account_id, v from direct),
 x as (select a.id, a.code, a.name, a.account_type t, sum(r.v)::bigint amount
         from allrows r join clickbooks_us.accounts a on a.id = r.account_id group by 1, 2, 3, 4)
 select coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'type', t, 'amountCents', amount) order by t, code) filter (where amount <> 0), '[]'),
        coalesce(sum(amount) filter (where t = 'income'), 0), coalesce(sum(amount) filter (where t = 'expense'), 0),
        jsonb_build_object(
          'invoicePayments', (select count(*) from pay),
          'paymentsAllocatedCents', (select coalesce(sum(paid), 0) from pay where invoice_id in (select invoice_id from inv_tot)),
          'paymentsDefaultIncome', (select count(*) from pay_default), 'paymentsDefaultIncomeCents', (select coalesce(sum(paid), 0) from pay_default),
          'defaultIncomeAccountMissing', dflt is null and exists (select 1 from pay_default),
          'unlinkedReceivables', (select n from unlinked), 'unlinkedReceivablesCents', (select amt from unlinked),
          'billEntriesLeftOut', (select count(*) from bills_out where has_pl),
          'payablesNotCounted', (select count(*) from bills_out where not has_pl), 'payablesNotCountedCents', (select coalesce(sum(ap_net), 0) from bills_out where not has_pl),
          'receivablesAccountMissing', not exists (select 1 from ar), 'payablesAccountMissing', not exists (select 1 from ap))
   into rows, income, expense, notes from x;
 return jsonb_build_object('report', 'profit_loss_cash', 'basis', 'cash', 'from', p_from, 'to', p_to, 'currency', 'USD', 'rows', rows,
   'revenueCents', income, 'expenseCents', expense, 'netIncomeCents', income - expense, 'notes', notes,
   'method', 'Cash basis: invoice income when paid (spread over the paid invoice''s income lines); bills count when paid (through their bank line); other bank lines as posted; receivables and payables excluded.',
   'readiness', clickbooks_us.reporting_readiness());
end $$;
revoke all on function clickbooks_us.report_profit_loss_cash(date, date) from public, anon, authenticated, service_role;

-- Dispatcher: identical to the deployed definition (sha256 f616c594…, captured 27 Nov) plus ONE branch, 'profit_loss_cash'.
create or replace function public.clickbooks_us_report_read(p_report text,p_from date,p_to date,p_with_bank boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
 case p_report
  when 'readiness' then return clickbooks_us.reporting_readiness();
  when 'profit_loss' then return clickbooks_us.report_profit_loss(p_from,p_to);
  when 'profit_loss_cash' then return clickbooks_us.report_profit_loss_cash(p_from,p_to);
  when 'balance_sheet' then return clickbooks_us.report_balance_sheet(p_to,p_with_bank);
  when 'trial_balance' then return clickbooks_us.report_trial_balance(p_to,p_with_bank);
  when 'general_ledger' then return clickbooks_us.report_general_ledger(p_from,p_to,p_with_bank);
  when 'tax_summary' then return clickbooks_us.report_tax_summary(p_from,p_to);
  when 'cash_flow' then return clickbooks_us.report_cash_flow(p_from,p_to,p_with_bank);
  when 'bank_reconciliation' then return clickbooks_us.report_bank_reconciliation(p_to,p_with_bank);
  else raise exception 'CB_UNKNOWN_REPORT'; end case;
end $$;
-- grants on the dispatcher are kept by CREATE OR REPLACE (postgres + service_role EXECUTE only); re-stated for clarity:
revoke all on function public.clickbooks_us_report_read(text,date,date,boolean) from public,anon,authenticated;
grant execute on function public.clickbooks_us_report_read(text,date,date,boolean) to service_role;
