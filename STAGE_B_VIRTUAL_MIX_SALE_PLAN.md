# Stage B — Virtual Stock Mix sale engine (implementation plan + SQL)

Status: **DRAFT for review.** Stage A (read-only preview, v55.83-HA) is live. Stage B actually
consumes real component stock, so it ships in this order: (1) you confirm the allocation rule,
(2) you run the SQL below in Supabase (I can't run migrations from here), (3) I wire the UI behind
a confirm dialog, (4) Codex QA verifies, (5) we enable it.

## The one decision only you can make: the allocation rule
When N units of a virtual mix are sold, how is N split across its component colors?
- **Option A — Proportional to current availability** (what Stage A preview uses):
  `draw_i = N * available_i / total_available`. No per-color shortfall while N ≤ total.
- **Option B — Fixed recipe** (e.g. each mix unit = fixed ratio of specific colors). Needs a
  ratio per component (a column on `inventory_mix_components`, e.g. `units_per_mix`).
- **Option C — Manual at sale time**: the seller types how much of each color to draw.

The El Sayad records should tell us which is real. Until confirmed, the engine below implements
**Option A** and the UI will show the exact per-color drawdown for human confirmation before commit.

## Engine map (verified, from the current code)
- Normal sale consumes via SQL RPC `consume_invoice_item_inventory(p_item_id)` — FIFO over
  `inventory_layers` (`ORDER BY received_at ASC, id ASC`), decrements `qty_remaining`, stamps
  `invoice_items` (`consumed_layers`, `cogs_total`, `gross_profit`, `inventory_status='consumed'`).
- Reversal RPC `reverse_invoice_item_inventory(p_item_id)` re-adds `qty_remaining`, resets the item.
- Invoice save calls the RPC at `src/app/page.jsx` ~9203; the virtual-mix guard blocks it at ~9196.
- Void/delete reverses at `src/app/page.jsx` ~5950.
- ⚠️ TO VERIFY before running: the live layer cost column is `cost_per_uom` and the FIFO order
  column is `received_at` (some tables use `receipt_date`). Confirm against the actual
  `consume_invoice_item_inventory` definition in Supabase and keep the new RPC identical.

## SQL to run in Supabase (DRAFT — review before running)
```sql
-- consume_virtual_mix_inventory: sell a virtual mix by drawing down its component colors.
-- Allocation = proportional to current availability (Option A). Mirrors the conventions of
-- consume_invoice_item_inventory. IDEMPOTENT-ish: refuses if the item is already 'consumed'.
create or replace function consume_virtual_mix_inventory(p_item_id uuid)
returns jsonb language plpgsql as $$
declare
  v_item        record;
  v_mix         record;
  v_total_avail numeric := 0;
  v_comp        record;
  v_alloc       numeric;
  v_layer       record;
  v_take        numeric;
  v_remaining   numeric;
  v_cogs        numeric := 0;
  v_layers      jsonb := '[]'::jsonb;
begin
  select * into v_item from invoice_items where id = p_item_id;
  if not found then return jsonb_build_object('error','item not found'); end if;
  if v_item.inventory_status = 'consumed' then return jsonb_build_object('error','already consumed'); end if;

  select * into v_mix from inventory_products where id = v_item.variant_id;
  if not found or v_mix.is_virtual_mix is not true then
    return jsonb_build_object('error','not a virtual mix');
  end if;

  -- total availability across active components
  select coalesce(sum(l.qty_remaining),0) into v_total_avail
  from inventory_mix_components c
  join inventory_layers l on l.product_id = c.component_product_id and l.qty_remaining > 0
  where c.mix_product_id = v_mix.id and c.is_active = true;

  if v_total_avail <= 0 then return jsonb_build_object('error','no component stock'); end if;
  if v_item.sale_quantity > v_total_avail then
    return jsonb_build_object('error','insufficient mix stock','requested',v_item.sale_quantity,'available',v_total_avail);
  end if;

  -- draw each component proportionally, FIFO within the component
  for v_comp in
    select c.component_product_id,
           coalesce(sum(l.qty_remaining),0) as avail
    from inventory_mix_components c
    left join inventory_layers l on l.product_id = c.component_product_id and l.qty_remaining > 0
    where c.mix_product_id = v_mix.id and c.is_active = true
    group by c.component_product_id
  loop
    v_alloc := v_item.sale_quantity * (v_comp.avail / v_total_avail);
    for v_layer in
      select id, qty_remaining, cost_per_uom from inventory_layers
      where product_id = v_comp.component_product_id and qty_remaining > 0
      order by received_at asc, id asc
    loop
      exit when v_alloc <= 0;
      v_take := least(v_alloc, v_layer.qty_remaining);
      update inventory_layers set qty_remaining = qty_remaining - v_take, updated_at = now()
        where id = v_layer.id;
      v_cogs := v_cogs + v_take * coalesce(v_layer.cost_per_uom,0);
      v_layers := v_layers || jsonb_build_object(
        'component_product_id', v_comp.component_product_id,
        'layer_id', v_layer.id, 'qty', v_take, 'cost_per_uom', v_layer.cost_per_uom);
      v_alloc := v_alloc - v_take;
    end loop;
  end loop;

  update invoice_items
    set consumed_layers = v_layers,
        cogs_total = v_cogs,
        gross_profit = coalesce(line_total,0) - v_cogs,
        inventory_consumed_at = now(),
        inventory_status = 'consumed'
    where id = p_item_id;

  return jsonb_build_object('item_id',p_item_id,'cogs_total',v_cogs,'consumed_layers',v_layers);
end $$;

-- reverse_virtual_mix_inventory: undo the above (void/edit/delete).
create or replace function reverse_virtual_mix_inventory(p_item_id uuid)
returns boolean language plpgsql as $$
declare v_item record; v_l jsonb;
begin
  select * into v_item from invoice_items where id = p_item_id;
  if not found or v_item.consumed_layers is null then return false; end if;
  for v_l in select * from jsonb_array_elements(v_item.consumed_layers) loop
    update inventory_layers
      set qty_remaining = qty_remaining + (v_l->>'qty')::numeric, updated_at = now()
      where id = (v_l->>'layer_id')::uuid;
  end loop;
  update invoice_items
    set inventory_status='reversed', consumed_layers=null, cogs_total=null, gross_profit=null
    where id = p_item_id;
  return true;
end $$;
```

## UI wiring (after SQL is live) — `src/app/page.jsx`
1. ~9196 guard: for `virtualMixIds[item.variant_id]`, instead of the warning, call
   `supabase.rpc('consume_virtual_mix_inventory', { p_item_id: insertedItem.id })` and surface
   any `error` (e.g. insufficient mix stock) to the user.
2. Before commit, show the Stage A breakdown in a confirm dialog ("This will draw down: …") so a
   human approves the exact per-color drawdown.
3. Void/delete (~5950): if an item is a virtual mix, call `reverse_virtual_mix_inventory`.
4. Remove the picker exclusion (~1560/1562) only once the above is verified, so virtual mixes
   become sellable.

## Why this is gated, not auto-shipped
Consuming real inventory on a guessed allocation rule, with an unverified column assumption, is
the exact corruption risk this work was parked for. SQL must be run by you in Supabase and QA'd by
Codex before the UI is enabled. Stage A (preview) already lets the team see the numbers safely.
