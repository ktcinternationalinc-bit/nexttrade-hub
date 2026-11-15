-- v55.83-A.6.27.44c — Line-level FIFO consumption for inventory-linked invoice items.
--
-- 44a created consume_invoice_inventory(p_invoice_id) which assumed single-line invoices.
-- Reality: invoices are multi-line. Each LINE has its own variant_id + sale_quantity + warehouse_id.
-- So we need a line-level function instead.
--
-- This function does NOT replace the invoice-level function — keeps it for legacy/single-line
-- callers. The new line-level function is what the invoice save flow will call.

CREATE OR REPLACE FUNCTION consume_invoice_item_inventory(p_item_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_item             invoice_items%ROWTYPE;
  v_resolved_variant uuid;
  v_layer            record;
  v_remaining        numeric;
  v_consumed_qty     numeric;
  v_consumed_cost    numeric;
  v_total_cogs       numeric := 0;
  v_total_consumed   numeric := 0;
  v_consumed_layers  jsonb := '[]'::jsonb;
  v_backorder_qty    numeric := 0;
  v_backorder_id     uuid;
  v_template_row     inventory_products%ROWTYPE;
BEGIN
  -- Lock + load item
  SELECT * INTO v_item FROM invoice_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice item % not found', p_item_id; END IF;

  -- Idempotency: if already consumed, return existing data
  IF v_item.inventory_status = 'consumed' THEN
    RETURN jsonb_build_object(
      'already_consumed', true,
      'consumed_layers', v_item.consumed_layers,
      'cogs_total', v_item.cogs_total,
      'item_id', p_item_id
    );
  END IF;

  IF v_item.uses_inventory IS NOT TRUE THEN
    -- Item not flagged for inventory — silently skip (no error). Caller is robust.
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_uses_inventory');
  END IF;
  IF v_item.variant_id IS NULL THEN
    RAISE EXCEPTION 'Invoice item % marked uses_inventory but has no variant_id', p_item_id;
  END IF;
  IF v_item.sale_quantity IS NULL OR v_item.sale_quantity <= 0 THEN
    RAISE EXCEPTION 'Invoice item % has invalid sale_quantity (% )', p_item_id, v_item.sale_quantity;
  END IF;

  v_resolved_variant := v_item.variant_id;

  -- If the variant is a family template, we can't consume directly from it.
  -- Templates are abstractions — they have no FIFO layers. Real receipts always
  -- create concrete variants. So if operator picked a template at invoice time,
  -- we cannot resolve it here without spec dropdowns. Error clearly.
  SELECT * INTO v_template_row FROM inventory_products WHERE id = v_item.variant_id;
  IF v_template_row.is_family_template = true THEN
    RAISE EXCEPTION 'Invoice item % is linked to family template % (% — % ) — pick a specific variant instead, or use Manual mode',
      p_item_id, v_item.variant_id, v_template_row.quick_code, v_template_row.name_en;
  END IF;

  v_remaining := v_item.sale_quantity;

  -- Walk FIFO layers oldest-first
  BEGIN
    FOR v_layer IN
      SELECT id, product_id, warehouse_id, cost_per_uom, qty_remaining, received_at
      FROM inventory_layers
      WHERE product_id = v_resolved_variant
        AND (v_item.warehouse_id IS NULL OR warehouse_id = v_item.warehouse_id)
        AND qty_remaining > 0
      ORDER BY received_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_consumed_qty := LEAST(v_layer.qty_remaining, v_remaining);
      v_consumed_cost := v_consumed_qty * v_layer.cost_per_uom;
      v_total_cogs := v_total_cogs + v_consumed_cost;
      v_total_consumed := v_total_consumed + v_consumed_qty;
      v_remaining := v_remaining - v_consumed_qty;

      UPDATE inventory_layers
      SET qty_remaining = qty_remaining - v_consumed_qty,
          updated_at = now()
      WHERE id = v_layer.id;

      v_consumed_layers := v_consumed_layers || jsonb_build_object(
        'layer_id', v_layer.id,
        'qty_consumed', v_consumed_qty,
        'cost_per_uom', v_layer.cost_per_uom,
        'total_cost', v_consumed_cost,
        'received_at', v_layer.received_at
      );
    END LOOP;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'inventory_layers table missing — run Build 4.3 SQL before submitting inventory-linked invoices';
  END;

  -- Backorder for any leftover
  IF v_remaining > 0 THEN
    v_backorder_qty := v_remaining;
    INSERT INTO inventory_backorders (
      invoice_id, variant_id, warehouse_id, qty_short, uom, status, notes
    ) VALUES (
      v_item.invoice_id, v_resolved_variant, v_item.warehouse_id,
      v_backorder_qty, v_item.uom, 'open',
      'Auto-created at invoice submit — sale qty (' || v_item.sale_quantity || ') exceeded available stock (' || v_total_consumed || ')'
    ) RETURNING id INTO v_backorder_id;
  END IF;

  -- Stamp the item
  UPDATE invoice_items
  SET consumed_layers       = v_consumed_layers,
      cogs_total            = v_total_cogs,
      gross_profit          = COALESCE(line_total, 0) - v_total_cogs,
      inventory_consumed_at = now(),
      inventory_status      = 'consumed',
      backorder_qty         = v_backorder_qty
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'item_id', p_item_id,
    'consumed_layers', v_consumed_layers,
    'total_consumed', v_total_consumed,
    'cogs_total', v_total_cogs,
    'gross_profit', COALESCE(v_item.line_total, 0) - v_total_cogs,
    'backorder_qty', v_backorder_qty,
    'backorder_id', v_backorder_id
  );
END;
$$ LANGUAGE plpgsql;

-- ── Reverse: restores layer qty_remaining and cancels backorders for a single item ──
CREATE OR REPLACE FUNCTION reverse_invoice_item_inventory(p_item_id uuid)
RETURNS boolean AS $$
DECLARE
  v_item  invoice_items%ROWTYPE;
  v_entry jsonb;
  v_layer_id uuid;
  v_qty   numeric;
BEGIN
  SELECT * INTO v_item FROM invoice_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice item % not found', p_item_id; END IF;

  IF v_item.inventory_status != 'consumed' THEN
    RAISE EXCEPTION 'Invoice item % is not consumed (current: %)', p_item_id, v_item.inventory_status;
  END IF;

  IF v_item.consumed_layers IS NOT NULL AND jsonb_typeof(v_item.consumed_layers) = 'array' THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_item.consumed_layers)
    LOOP
      v_layer_id := (v_entry->>'layer_id')::uuid;
      v_qty := (v_entry->>'qty_consumed')::numeric;
      BEGIN
        UPDATE inventory_layers
        SET qty_remaining = qty_remaining + v_qty,
            updated_at = now()
        WHERE id = v_layer_id;
      EXCEPTION WHEN undefined_table THEN NULL;
      END;
    END LOOP;
  END IF;

  -- Cancel open backorders linked to this invoice (covers all lines that produced backorders)
  UPDATE inventory_backorders
  SET status = 'cancelled',
      notes = COALESCE(notes, '') || ' | Auto-cancelled when invoice item was reversed at ' || now()::text
  WHERE invoice_id = v_item.invoice_id AND status = 'open' AND variant_id = v_item.variant_id;

  UPDATE invoice_items
  SET inventory_status      = 'reversed',
      consumed_layers       = NULL,
      cogs_total            = NULL,
      gross_profit          = NULL,
      inventory_consumed_at = NULL,
      backorder_qty         = 0
  WHERE id = p_item_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;
