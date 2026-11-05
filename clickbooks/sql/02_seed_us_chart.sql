-- Read only the exact production US Wave silo; never select by USD alone.
do $$
declare src text; bid uuid; expected bigint;
begin
 select wave_business_id into strict src from public.wave_business_registry where is_production=true and label='KTC INTERNATIONAL ENTERPRISES LLC';
 insert into clickbooks_us.books(code,name,wave_business_id) values('KTC_US','KTC International Enterprises LLC - US Accounting',src) on conflict(code) do nothing;
 select id into strict bid from clickbooks_us.books where code='KTC_US' and wave_business_id=src;
 if exists(select 1 from public.wave_categories where wave_business_id=src and coalesce(wave_account_type,type,'') not in ('Assets','Liabilities & Credit Cards','Equity','Income','Expenses')) then raise exception 'CB_UNKNOWN_WAVE_ACCOUNT_TYPE'; end if;
 if exists(select 1 from public.wave_categories where wave_business_id=src and (wave_account_id is null or wave_account_name is null)) then raise exception 'CB_INCOMPLETE_WAVE_ACCOUNT'; end if;
 insert into clickbooks_us.accounts(book_id,code,name,account_type,normal_side,is_bank_sensitive,needs_review,origin)
 select bid,v.code,v.name,v.typ,v.side,v.sensitive,v.review,'control' from (values
 ('1000','Bank settlement clearing','asset','debit',true,true),
 ('1090','Inter-account transfer clearing','asset','debit',true,true),
 ('1100','Accounts receivable control','asset','debit',false,false),
 ('2000','Accounts payable control','liability','credit',false,false),
 ('2200','Payroll clearing','liability','credit',false,true),
 ('2300','Sales tax payable control','liability','credit',false,true),
 ('2400','Unapplied customer receipts','liability','credit',false,false),
 ('3000','Opening balance offset - reconciliation required','equity','credit',false,true)
 ) v(code,name,typ,side,sensitive,review) on conflict(book_id,code) do nothing;
 with raw as (
 select w.*,case coalesce(wave_account_type,type) when 'Assets' then 'asset' when 'Liabilities & Credit Cards' then 'liability' when 'Equity' then 'equity' when 'Income' then 'income' when 'Expenses' then 'expense' end typ,
 (subtype in ('Depreciation and Amortization','Discount')) contra
 from public.wave_categories w where wave_business_id=src and coalesce(subtype,'') not in ('System Receivable Invoice','System Receivable Non-Invoice','System Payable Bill','System Payable Non-Bill','Transfers'))
 insert into clickbooks_us.accounts(book_id,code,name,account_type,normal_side,is_contra,is_bank_sensitive,is_active,needs_review,origin)
 select bid,'W-'||md5(wave_account_id),wave_account_name,typ,case when (typ in ('asset','expense')) <> coalesce(contra,false) then 'debit' else 'credit' end,
 coalesce(contra,false),coalesce(subtype in ('Cash & Bank','Money in Transit','Credit Card'),false),coalesce(is_active,true),true,'wave' from raw
 on conflict(book_id,code) do nothing;
 insert into clickbooks_us.source_account_map(book_id,source_account_id,account_id,source_subtype,mapping_policy)
 select bid,w.wave_account_id,a.id,w.subtype,
 case when w.subtype in ('System Receivable Invoice','System Receivable Non-Invoice') then 'receivable_control' when w.subtype in ('System Payable Bill','System Payable Non-Bill') then 'payable_control' when w.subtype='Transfers' then 'transfer_clearing' else 'one_to_one' end
 from public.wave_categories w join clickbooks_us.accounts a on a.book_id=bid and a.code=case when w.subtype in ('System Receivable Invoice','System Receivable Non-Invoice') then '1100' when w.subtype in ('System Payable Bill','System Payable Non-Bill') then '2000' when w.subtype='Transfers' then '1090' else 'W-'||md5(w.wave_account_id) end
 where w.wave_business_id=src on conflict(book_id,source_account_id) do nothing;
 select count(distinct wave_account_id) into expected from public.wave_categories where wave_business_id=src;
 if (select count(*) from clickbooks_us.source_account_map where book_id=bid)<>expected then raise exception 'CB_MAPPING_COVERAGE_MISMATCH'; end if;
end $$;
