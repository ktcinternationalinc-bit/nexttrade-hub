-- v55.83-A.6.27.64 — Auto FX snapshot capture + expense-advance tagging prep.
--
-- ──────────────────────────────────────────────────────────────────
-- WHAT THIS DOES (in plain English)
-- ──────────────────────────────────────────────────────────────────
-- Two improvements:
--
-- 1. Receipts now AUTOMATICALLY stamp the EGP cost + FX rate that was
--    in effect on the receipt date. Before: only happened if you wrote
--    SQL manually. After: every newly-finalized receipt records both
--    cost_egp_at_receipt and fx_rate_at_receipt onto its layer.
--    This is what fixes the "EST" badges on new receipts in the FX
--    P&L Report — they'll now have real snapshots, not estimates.
--
-- 2. Sales now AUTOMATICALLY stamp the EGP cost + FX rate that was in
--    effect on the SALE date. Two new columns added to invoice_items:
--    cost_egp_at_sale and fx_rate_at_sale. Filled in by the sale
--    consumption function. Used by FX P&L Report's "Realized FX" column.
--
-- 3. The warehouse expense form will gain a dropdown for "link to an
--    advance" — this SQL doesn't add anything for that, because the
--    advance_id column was already added in .62. UI ships in this build.

-- ──────────────────────────────────────────────────────────────────
-- 1. Add FX-at-sale columns to invoice_items
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS cost_egp_at_sale NUMERIC(14,2);
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS fx_rate_at_sale  NUMERIC(14,6);

-- ──────────────────────────────────────────────────────────────────
-- 2. Update receipt-finalize trigger to stamp FX columns
--    This REPLACES the existing function. The change is additive at the
--    layer-insert step — same INSERT, but adds the 2 new FX columns.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_receipt_finalize_create_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_layer_id          uuid;
  v_existing_layer_id uuid;
  v_layer_currency    text;
  v_fx_rate           numeric;
  v_cost_egp_per_uom  numeric;
BEGIN
  -- Only fire when status transitions to 'finalized' (not already finalized)
  IF NEW.status = 'finalized'
     AND (OLD.status IS NULL OR OLD.status != 'finalized')
     AND NEW.landed_cost_per_uom IS NOT NULL
     AND NEW.quantity > 0
  THEN
    -- Idempotency: don't insert if a layer already exists for this receipt
    SELECT id INTO v_existing_layer_id FROM inventory_layers WHERE source_receipt_id = NEW.id;
    IF v_existing_layer_id IS NULL THEN
      -- v55.83-A.6.27.64 — Compute FX snapshot at receipt date.
      -- If currency is EGP, no FX conversion needed (rate = 1).
      -- If currency is USD/EUR/etc, look up rate via fx_rate_for_date helper.
      -- If no historical rate found, columns stay NULL (graceful fallback).
      v_layer_currency := COALESCE(NEW.currency, 'EGP');
      IF v_layer_currency = 'EGP' THEN
        v_fx_rate := 1;
        v_cost_egp_per_uom := NEW.landed_cost_per_uom;
      ELSE
        BEGIN
          v_fx_rate := fx_rate_for_date(v_layer_currency, 'EGP', NEW.receipt_date);
          IF v_fx_rate IS NOT NULL THEN
            v_cost_egp_per_uom := NEW.landed_cost_per_uom * v_fx_rate;
          ELSE
            v_cost_egp_per_uom := NULL;
          END IF;
        EXCEPTION WHEN undefined_function THEN
          -- fx_rate_for_date helper missing (SQL .63 not run) — graceful
          v_fx_rate := NULL;
          v_cost_egp_per_uom := NULL;
        END;
      END IF;

      -- Insert layer with FX snapshot
      INSERT INTO inventory_layers (
        source_receipt_id, product_id, warehouse_id, receipt_date,
        receipt_number, batch_number,
        qty_received, qty_remaining, uom,
        cost_per_uom, cost_currency, fx_rate_used,
        cost_egp_at_receipt, fx_rate_at_receipt,
        status
      ) VALUES (
        NEW.id, NEW.product_id, NEW.warehouse_id, NEW.receipt_date,
        NEW.receipt_number, NEW.batch_number,
        NEW.quantity, NEW.quantity, NEW.uom,
        NEW.landed_cost_per_uom, v_layer_currency, NEW.fx_rate_used,
        v_cost_egp_per_uom, v_fx_rate,
        'open'
      ) RETURNING id INTO v_layer_id;
    ELSE
      v_layer_id := v_existing_layer_id;
    END IF;

    -- Insert movement (skip if a 'receipt' movement already exists for this receipt)
    IF NOT EXISTS (
      SELECT 1 FROM inventory_movements
      WHERE source_receipt_id = NEW.id AND movement_type = 'receipt'
    ) THEN
      INSERT INTO inventory_movements (
        movement_type, movement_date,
        product_id, warehouse_id,
        quantity, uom,
        cost_per_uom, cost_currency, total_cost,
        source_receipt_id, source_layer_id,
        reference_number, notes,
        created_by
      ) VALUES (
        'receipt', NEW.receipt_date,
        NEW.product_id, NEW.warehouse_id,
        NEW.quantity, NEW.uom,
        NEW.landed_cost_per_uom, COALESCE(NEW.currency, 'EGP'), NEW.landed_total,
        NEW.id, v_layer_id,
        NEW.receipt_number, NEW.notes,
        NEW.finalized_by
      );
    END IF;
  END IF;

  -- Handle CANCELLED → reverse the movement + close the layer
  IF NEW.status = 'cancelled' AND OLD.status = 'finalized' THEN
    INSERT INTO inventory_movements (
      movement_type, movement_date,
      product_id, warehouse_id,
      quantity, uom,
      cost_per_uom, cost_currency, total_cost,
      source_receipt_id,
      reference_number, notes,
      created_by
    ) VALUES (
      'reversal', CURRENT_DATE,
      NEW.product_id, NEW.warehouse_id,
      -NEW.quantity, NEW.uom,
      NEW.landed_cost_per_uom, COALESCE(NEW.currency, 'EGP'), -COALESCE(NEW.landed_total, 0),
      NEW.id,
      NEW.receipt_number, NEW.notes,
      NEW.cancelled_by
    );

    UPDATE inventory_layers
    SET status = 'reversed', qty_remaining = 0, updated_at = now()
    WHERE source_receipt_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────
-- 3. Update sale consumption to stamp FX-at-sale on invoice_items
--    REPLACES consume_invoice_item_inventory.
--    Adds: looks up fx_rate for invoice_date, computes total cost_egp_at_sale
--    as sum across consumed layers (each slice valued at sale-day rate).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION consume_invoice_item_inventory(p_item_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_item              invoice_items%ROWTYPE;
  v_resolved_variant  uuid;
  v_layer             record;
  v_remaining         numeric;
  v_consumed_qty      numeric;
  v_consumed_cost     numeric;
  v_total_cogs        numeric := 0;
  v_total_consumed    numeric := 0;
  v_consumed_layers   jsonb := '[]'::jsonb;
  v_backorder_qty     numeric := 0;
  v_backorder_id      uuid;
  v_template_row      inventory_products%ROWTYPE;
  v_invoice_date      date;
  v_fx_rate_at_sale   numeric;
  v_cost_egp_at_sale  numeric := 0;
  v_layer_fx          numeric;
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
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_uses_inventory');
  END IF;
  IF v_item.variant_id IS NULL THEN
    RAISE EXCEPTION 'Invoice item % marked uses_inventory but has no variant_id', p_item_id;
  END IF;
  IF v_item.sale_quantity IS NULL OR v_item.sale_quantity <= 0 THEN
    RAISE EXCEPTION 'Invoice item % has invalid sale_quantity (% )', p_item_id, v_item.sale_quantity;
  END IF;

  v_resolved_variant := v_item.variant_id;

  SELECT * INTO v_template_row FROM inventory_products WHERE id = v_item.variant_id;
  IF v_template_row.is_family_template = true THEN
    RAISE EXCEPTION 'Invoice item % is linked to family template % (% — % ) — pick a specific variant instead, or use Manual mode',
      p_item_id, v_item.variant_id, v_template_row.quick_code, v_template_row.name_en;
  END IF;

  -- v55.83-A.6.27.64 — Get the invoice date for FX lookup
  SELECT invoice_date INTO v_invoice_date FROM invoices WHERE id = v_item.invoice_id;
  IF v_invoice_date IS NULL THEN v_invoice_date := CURRENT_DATE; END IF;

  v_remaining := v_item.sale_quantity;

  -- Walk FIFO layers oldest-first
  BEGIN
    FOR v_layer IN
      SELECT id, product_id, warehouse_id, cost_per_uom, cost_currency, qty_remaining, receipt_date
      FROM inventory_layers
      WHERE product_id = v_resolved_variant
        AND (v_item.warehouse_id IS NULL OR warehouse_id = v_item.warehouse_id)
        AND qty_remaining > 0
      ORDER BY receipt_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_consumed_qty := LEAST(v_layer.qty_remaining, v_remaining);
      v_consumed_cost := v_consumed_qty * v_layer.cost_per_uom;
      v_total_cogs := v_total_cogs + v_consumed_cost;
      v_total_consumed := v_total_consumed + v_consumed_qty;
      v_remaining := v_remaining - v_consumed_qty;

      -- v55.83-A.6.27.64 — Per-slice FX-at-sale computation.
      -- For each layer slice consumed: if layer was bought in EGP, FX=1
      -- (no FX exposure). If bought in USD/etc, look up the rate at the
      -- INVOICE date (not the layer date) and value this slice's cost
      -- in EGP at that rate. Sum across all slices.
      IF v_layer.cost_currency = 'EGP' OR v_layer.cost_currency IS NULL THEN
        v_cost_egp_at_sale := v_cost_egp_at_sale + v_consumed_cost;
      ELSE
        BEGIN
          v_layer_fx := fx_rate_for_date(v_layer.cost_currency, 'EGP', v_invoice_date);
          IF v_layer_fx IS NOT NULL THEN
            v_cost_egp_at_sale := v_cost_egp_at_sale + (v_consumed_cost * v_layer_fx);
            -- Capture the sale-day rate (most recent slice wins for the row-level stamp)
            v_fx_rate_at_sale := v_layer_fx;
          END IF;
        EXCEPTION WHEN undefined_function THEN
          NULL;
        END;
      END IF;

      UPDATE inventory_layers
      SET qty_remaining = qty_remaining - v_consumed_qty,
          updated_at = now()
      WHERE id = v_layer.id;

      v_consumed_layers := v_consumed_layers || jsonb_build_object(
        'layer_id', v_layer.id,
        'qty_consumed', v_consumed_qty,
        'cost_per_uom', v_layer.cost_per_uom,
        'cost_currency', v_layer.cost_currency,
        'total_cost', v_consumed_cost,
        'receipt_date', v_layer.receipt_date
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

  -- v55.83-A.6.27.64 — Stamp the item with FX snapshots too
  UPDATE invoice_items
  SET consumed_layers       = v_consumed_layers,
      cogs_total            = v_total_cogs,
      gross_profit          = COALESCE(line_total, 0) - v_total_cogs,
      inventory_consumed_at = now(),
      inventory_status      = 'consumed',
      backorder_qty         = v_backorder_qty,
      cost_egp_at_sale      = CASE WHEN v_cost_egp_at_sale > 0 THEN v_cost_egp_at_sale ELSE NULL END,
      fx_rate_at_sale       = v_fx_rate_at_sale
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'item_id', p_item_id,
    'consumed_layers', v_consumed_layers,
    'total_consumed', v_total_consumed,
    'cogs_total', v_total_cogs,
    'cost_egp_at_sale', v_cost_egp_at_sale,
    'fx_rate_at_sale', v_fx_rate_at_sale,
    'gross_profit', COALESCE(v_item.line_total, 0) - v_total_cogs,
    'backorder_qty', v_backorder_qty,
    'backorder_id', v_backorder_id
  );
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────
-- VERIFY (run after migration)
-- ──────────────────────────────────────────────────────────────────
-- 1) Both invoice_items columns exist:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name='invoice_items' AND column_name IN ('cost_egp_at_sale', 'fx_rate_at_sale');
--    Expected: 2 rows
--
-- 2) Trigger function updated (look for the v55.83-A.6.27.64 comment):
--    SELECT proname FROM pg_proc WHERE proname='on_receipt_finalize_create_ledger';
--    Expected: 1 row (it now has FX logic inside)
--
-- 3) Test by finalizing a new receipt with currency=USD and a USD/EGP rate
--    logged for today's date. After finalize, query:
--    SELECT cost_egp_at_receipt, fx_rate_at_receipt FROM inventory_layers
--    WHERE source_receipt_id = '<your-receipt-id>';
--    Expected: both columns populated.

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT (only if catastrophic)
-- ──────────────────────────────────────────────────────────────────
-- This SQL only REPLACES function bodies and ADDS columns. To roll back:
--   ALTER TABLE invoice_items DROP COLUMN IF EXISTS cost_egp_at_sale;
--   ALTER TABLE invoice_items DROP COLUMN IF EXISTS fx_rate_at_sale;
-- Then re-run the original receipt trigger from sql/v55-83-a-6-27-34-inventory-movements-layers.sql
-- and the original consume_invoice_item_inventory from sql/v55-83-a-6-27-44c-line-level-consumption.sql.
