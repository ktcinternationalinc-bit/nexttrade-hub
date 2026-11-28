-- Install the transaction used by the scoped U.S. invoice editor.
begin;

CREATE OR REPLACE FUNCTION public.hub_edit_us_invoice(p_invoice uuid, p_actor uuid, p_expected timestamp with time zone, p_floor date, p_due date, p_notes text, p_terms text, p_reason text, p_items jsonb, p_original jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  invoice accounting_invoices%rowtype;
  item record;
  current_items jsonb;
  total numeric;
  paid numeric;
  reopened boolean;
begin
  select * into invoice from accounting_invoices where id = p_invoice for update;
  if not found or invoice.wave_business_id is distinct from 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk'
    or invoice.currency = 'EGP' or coalesce(invoice.record_status, 'active') <> 'active'
    or (p_floor is not null and (invoice.invoice_date is null or invoice.invoice_date < p_floor)) then
    raise exception 'This invoice is outside your U.S. invoice edit access.';
  end if;

  perform id from accounting_invoice_items where invoice_id = p_invoice for update;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'description', description, 'quantity', quantity, 'unit_price', unit_price
  )), '[]'::jsonb)
  into current_items from accounting_invoice_items where invoice_id = p_invoice;
  if invoice.updated_at is distinct from p_expected or
    not (current_items @> p_original and p_original @> current_items) then
    raise exception 'The invoice changed. Close and reopen the editor before saving.';
  end if;

  reopened := coalesce(invoice.approval_status = 'approved', false);
  if reopened and coalesce(length(trim(p_reason)), 0) = 0 then
    raise exception 'Enter a reason for changing the approved invoice.';
  end if;

  select coalesce(sum(round(x.quantity * x.unit_price, 2)), 0) into total
  from jsonb_to_recordset(p_items) as x(quantity numeric(14,3), unit_price numeric(14,2));

  -- Use both Wave-imported and Hub payments. Never let an edit hide an overpayment.
  select round(coalesce(invoice.wave_imported_paid, 0) + coalesce(sum(amount), 0), 2)
    into paid from accounting_invoice_payments
    where accounting_invoice_id = p_invoice and voided is not true
      and lower(coalesce(sync_status, '')) not in ('void', 'voided', 'cancelled', 'reversed', 'deleted');
  if total < paid then
    raise exception 'The new invoice total is below the amount already paid.';
  end if;

  delete from accounting_invoice_items
  where invoice_id = p_invoice and not exists (
    select 1 from jsonb_to_recordset(p_items) as x(id uuid) where x.id = accounting_invoice_items.id
  );
  for item in
    select value->>'description' as description, (value->>'id')::uuid as id,
      (value->>'quantity')::numeric(14,3) as quantity,
      (value->>'unit_price')::numeric(14,2) as unit_price, (ordinality - 1)::integer as position
    from jsonb_array_elements(p_items) with ordinality
  loop
    if item.id is null then
      insert into accounting_invoice_items
        (business_id, invoice_id, description, quantity, unit_price, line_total, sort_order)
      values (invoice.business_id, p_invoice, item.description, item.quantity, item.unit_price,
        round(item.quantity * item.unit_price, 2), item.position);
    else
      update accounting_invoice_items set description = item.description, quantity = item.quantity,
        unit_price = item.unit_price, line_total = round(item.quantity * item.unit_price, 2),
        sort_order = item.position
      where id = item.id and invoice_id = p_invoice;
    end if;
  end loop;

  update accounting_invoices set due_date = p_due, notes = p_notes, terms = p_terms,
    total_amount = total, amount_paid = paid, balance_due = total - paid,
    payment_status = case when paid <= 0 then 'unpaid' when total = paid then 'paid' else 'partial' end,
    approval_status = case when reopened then 'internal_review' else invoice.approval_status end,
    ready_for_wave = case when reopened then false else invoice.ready_for_wave end,
    wave_sync_status = case when invoice.wave_invoice_id is not null then 'pending_sync' else invoice.wave_sync_status end,
    updated_by = p_actor, updated_at = now()
  where id = p_invoice;

  insert into hub_audit_log(actor_id, action, entity, entity_id, details)
  values (p_actor, 'us_invoice_edit', 'accounting_invoice', p_invoice::text,
    jsonb_build_object('reopened', reopened, 'reason', nullif(p_reason, ''),
      'previous_total', invoice.total_amount, 'total', total));
end;
$function$;

revoke all on function public.hub_edit_us_invoice(uuid, uuid, timestamptz, date, date, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.hub_edit_us_invoice(uuid, uuid, timestamptz, date, date, text, text, text, jsonb, jsonb)
  to service_role;

commit;
